import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5165' : '';

const YES_WORDS = ['yes', 'yeah', 'yep', 'correct', 'true', 'sure', 'affirmative', 'yea', 'ok', 'okay'];
const NO_WORDS  = ['no', 'nope', 'nah', 'negative', 'false', 'incorrect', 'not'];

function parseVoice(transcript) {
  const t = transcript.toLowerCase();
  if (YES_WORDS.some(w => t.includes(w))) return true;
  if (NO_WORDS.some(w =>  t.includes(w))) return false;
  return null;
}

function speak(text) {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92; u.pitch = 1;
    u.onend = resolve; u.onerror = resolve;
    window.speechSynthesis.speak(u);
  });
}

const SpeechRecAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceSupported = !!SpeechRecAPI;

export function QuizPanel({ sessionId, onSubmit }) {
  const [questions,  setQuestions]  = useState([]);
  const [current,    setCurrent]    = useState(0);
  const [answers,    setAnswers]    = useState([]);
  const [phase,      setPhase]      = useState('loading');
  const [result,     setResult]     = useState(null);
  const [voiceMode,  setVoiceMode]  = useState(voiceSupported);
  const [vState,     setVState]     = useState('idle'); // speaking | listening | idle
  const [heard,      setHeard]      = useState('');

  // Refs so callbacks always see latest values without stale closures
  const recRef       = useRef(null);
  const handleRef    = useRef(null);
  const activeRef    = useRef(false); // prevents double-fire

  useEffect(() => {
    fetch(`${API_BASE}/api/quiz/questions`)
      .then(r => r.json())
      .then(data => { setQuestions(data); setPhase('quiz'); })
      .catch(() => setPhase('error'));
  }, []);

  const finishQuiz = useCallback((newAnswers) => {
    const score = newAnswers.filter(a => a.isCorrect === true).length;
    const total = newAnswers.filter(a => a.isCorrect !== null).length;
    const res   = { sessionId, answers: newAnswers, score, total };
    setResult(res); setPhase('result'); setVState('idle'); setHeard('');
    const pct = total > 0 ? Math.round(score / total * 100) : 100;
    speak(`Quiz complete. Your score is ${score} out of ${total}, ${pct} percent.`);
    onSubmit?.(res);
  }, [sessionId, onSubmit]);

  const handleAnswer = useCallback((value) => {
    if (activeRef.current) return;
    activeRef.current = true;

    window.speechSynthesis.cancel();
    try { recRef.current?.abort(); } catch {}

    const q = questions[current];
    const isCorrect = q.correctAnswer == null ? null : value === q.correctAnswer;
    const newAnswers = [...answers, { questionId: q.id, questionText: q.text, answer: value, isCorrect }];
    setAnswers(newAnswers);
    setHeard('');

    if (current + 1 >= questions.length) {
      finishQuiz(newAnswers);
    } else {
      setCurrent(c => c + 1);
      setTimeout(() => { activeRef.current = false; }, 300);
    }
  }, [current, questions, answers, finishQuiz]);

  // Keep handleRef current so the recognition callback never goes stale
  handleRef.current = handleAnswer;

  const startListening = useCallback(() => {
    if (!voiceSupported) return;
    const rec = new SpeechRecAPI();
    rec.continuous = false; rec.interimResults = false;
    rec.lang = 'en-US'; rec.maxAlternatives = 3;

    rec.onstart  = () => setVState('listening');
    rec.onend    = () => setVState('idle');
    rec.onerror  = (e) => { if (e.error !== 'aborted') setVState('idle'); };

    rec.onresult = (event) => {
      const text = Array.from(event.results[0]).map(r => r.transcript).join(' ');
      setHeard(text);
      const ans = parseVoice(text);
      if (ans !== null) {
        handleRef.current(ans);
      } else {
        setVState('speaking');
        speak('I didn\'t catch that. Please say yes or no.').then(startListening);
      }
    };

    recRef.current = rec;
    try { rec.start(); } catch {}
  }, []);

  // Speak question then listen whenever question index changes
  useEffect(() => {
    if (phase !== 'quiz' || questions.length === 0 || !voiceMode) return;
    activeRef.current = false;
    setHeard('');
    setVState('speaking');

    const q = questions[current];
    speak(q.text)
      .then(() => speak('Please answer yes or no.'))
      .then(startListening);

    return () => {
      window.speechSynthesis.cancel();
      try { recRef.current?.abort(); } catch {}
    };
  }, [current, phase, questions, voiceMode, startListening]);

  // ── Render ──────────────────────────────────────────────────

  if (phase === 'loading') return (
    <div className="quiz-panel"><p className="empty">Loading questions…</p></div>
  );
  if (phase === 'error') return (
    <div className="quiz-panel"><p style={{ color: '#f87171' }}>Failed to load questions.</p></div>
  );

  // ── Results ──────────────────────────────────────────────────
  if (phase === 'result') {
    const pct   = result.total > 0 ? Math.round(result.score / result.total * 100) : 100;
    const label = pct === 100 ? 'All Clear' : pct >= 60 ? 'Some Concerns' : 'Review Required';
    const cls   = pct === 100 ? 'quiz-ok' : pct >= 60 ? 'quiz-warn' : 'quiz-fail';
    return (
      <div className="quiz-panel">
        <div className="quiz-header">
          <h3 className="quiz-title">Quiz Complete</h3>
          <span className={`quiz-score-badge ${cls}`}>{result.score}/{result.total} · {pct}%</span>
        </div>
        <ul className="quiz-answers-list">
          {result.answers.map((a, i) => (
            <li key={i} className={`quiz-answer-row ${a.isCorrect === true ? 'qa-correct' : a.isCorrect === false ? 'qa-wrong' : 'qa-neutral'}`}>
              <span className="qa-icon">{a.isCorrect === true ? '✓' : a.isCorrect === false ? '✗' : '·'}</span>
              <span className="qa-text">{a.questionText}</span>
              <span className="qa-val">{a.answer ? 'Yes' : 'No'}</span>
            </li>
          ))}
        </ul>
        <div className={`quiz-final-label ${cls}`}>{label}</div>
      </div>
    );
  }

  // ── Active quiz ───────────────────────────────────────────────
  const q        = questions[current];
  const progress = (current / questions.length) * 100;

  return (
    <div className="quiz-panel">
      <div className="quiz-header">
        <h3 className="quiz-title">Pre-Exam Questionnaire</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="quiz-counter">{current + 1} / {questions.length}</span>
          {voiceSupported && (
            <button
              className={`voice-toggle ${voiceMode ? 'voice-on' : 'voice-off'}`}
              onClick={() => {
                window.speechSynthesis.cancel();
                try { recRef.current?.abort(); } catch {}
                setVoiceMode(m => !m);
                setVState('idle');
              }}
              title={voiceMode ? 'Switch to buttons' : 'Switch to voice'}
            >
              {voiceMode ? '🎤 Voice' : '🖱 Buttons'}
            </button>
          )}
        </div>
      </div>

      <div className="quiz-progress-bar">
        <div className="quiz-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <p className="quiz-question-text">{q.text}</p>

      {/* Voice state indicator */}
      {voiceMode && (
        <div className="voice-indicator">
          {vState === 'speaking' && (
            <div className="voice-state voice-speaking">
              <span className="voice-icon">🔊</span>
              <span>Speaking question…</span>
            </div>
          )}
          {vState === 'listening' && (
            <div className="voice-state voice-listening">
              <span className="voice-icon">🎤</span>
              <span>Listening… say <b>Yes</b> or <b>No</b></span>
              <span className="voice-dots"><span/><span/><span/></span>
            </div>
          )}
          {vState === 'idle' && voiceMode && (
            <div className="voice-state voice-idle">
              <button className="quiz-btn quiz-btn-mic" onClick={startListening}>
                🎤 Tap to speak
              </button>
            </div>
          )}
          {heard && (
            <div className="voice-heard">Heard: "<em>{heard}</em>"</div>
          )}
        </div>
      )}

      {/* Buttons — always shown as fallback / alternative */}
      <div className="quiz-btn-row">
        <button className="quiz-btn quiz-btn-no"  onClick={() => handleAnswer(false)}>No</button>
        <button className="quiz-btn quiz-btn-yes" onClick={() => handleAnswer(true)}>Yes</button>
      </div>

      {!voiceSupported && (
        <p style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>
          Voice not supported in this browser — use buttons above
        </p>
      )}
    </div>
  );
}
