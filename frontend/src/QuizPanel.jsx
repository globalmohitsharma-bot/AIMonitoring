import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5165' : '';

// ── Voice helpers ─────────────────────────────────────────────────────────────
const YES_WORDS  = ['yes', 'yeah', 'yep', 'correct', 'true', 'sure', 'affirmative', 'yea', 'ok', 'okay'];
const NO_WORDS   = ['no', 'nope', 'nah', 'negative', 'false', 'incorrect', 'not'];

const OPTION_WORDS = {
  0: ['one', 'first', '1', 'a', 'option one', 'option 1'],
  1: ['two', 'second', '2', 'b', 'option two', 'option 2'],
  2: ['three', 'third', '3', 'c', 'option three', 'option 3'],
  3: ['four', 'fourth', '4', 'd', 'option four', 'option 4'],
};

function parseVoiceYesNo(t) {
  const lower = t.toLowerCase();
  if (YES_WORDS.some(w => lower.includes(w))) return 'yes';
  if (NO_WORDS.some(w =>  lower.includes(w))) return 'no';
  return null;
}

function parseVoiceMcq(t, options) {
  const lower = t.toLowerCase();
  // Try to match by index word
  for (const [idx, words] of Object.entries(OPTION_WORDS)) {
    if (idx < options.length && words.some(w => lower.includes(w))) return options[+idx];
  }
  // Try to match by partial option text
  for (const opt of options) {
    if (lower.includes(opt.toLowerCase().split(' ')[0])) return opt;
  }
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

const SpeechRecAPI    = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceSupported  = !!SpeechRecAPI;

// ── Component ─────────────────────────────────────────────────────────────────
export function QuizPanel({ sessionId, onSubmit }) {
  const [questions, setQuestions] = useState([]);
  const [current,   setCurrent]   = useState(0);
  const [answers,   setAnswers]   = useState([]);
  const [phase,     setPhase]     = useState('loading');
  const [result,    setResult]    = useState(null);
  const [voiceMode, setVoiceMode] = useState(voiceSupported);
  const [vState,    setVState]    = useState('idle');
  const [heard,     setHeard]     = useState('');

  const recRef    = useRef(null);
  const handleRef = useRef(null);
  const activeRef = useRef(false);

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

    const q         = questions[current];
    const isCorrect = q.correctAnswer == null ? null : (value === q.correctAnswer);
    const newAnswers = [...answers, {
      questionId: q.id, questionText: q.text, answer: value, isCorrect,
    }];
    setAnswers(newAnswers);
    setHeard('');

    if (current + 1 >= questions.length) {
      finishQuiz(newAnswers);
    } else {
      setCurrent(c => c + 1);
      setTimeout(() => { activeRef.current = false; }, 300);
    }
  }, [current, questions, answers, finishQuiz]);

  handleRef.current = handleAnswer;

  const startListening = useCallback(() => {
    if (!voiceSupported) return;
    const q   = questions[current];
    const rec = new SpeechRecAPI();
    rec.continuous = false; rec.interimResults = false;
    rec.lang = 'en-US'; rec.maxAlternatives = 3;

    rec.onstart = () => setVState('listening');
    rec.onend   = () => setVState('idle');
    rec.onerror = (e) => { if (e.error !== 'aborted') setVState('idle'); };

    rec.onresult = (event) => {
      const text = Array.from(event.results[0]).map(r => r.transcript).join(' ');
      setHeard(text);
      const ans = q?.type === 'mcq'
        ? parseVoiceMcq(text, q.options ?? [])
        : parseVoiceYesNo(text);
      if (ans !== null) {
        handleRef.current(ans);
      } else {
        const hint = q?.type === 'mcq'
          ? 'Please say the option number, like "one", "two", "three", or "four".'
          : "Please say yes or no.";
        setVState('speaking');
        speak(`I didn't catch that. ${hint}`).then(startListening);
      }
    };

    recRef.current = rec;
    try { rec.start(); } catch {}
  }, [questions, current]);

  useEffect(() => {
    if (phase !== 'quiz' || questions.length === 0 || !voiceMode) return;
    activeRef.current = false;
    setHeard('');
    setVState('speaking');

    const q = questions[current];
    const speakQuestion = async () => {
      await speak(q.text);
      if (q.type === 'mcq' && q.options?.length) {
        const opts = q.options.map((o, i) => `Option ${i + 1}: ${o}`).join('. ');
        await speak(opts);
      } else {
        await speak('Please answer yes or no.');
      }
      startListening();
    };
    speakQuestion();

    return () => {
      window.speechSynthesis.cancel();
      try { recRef.current?.abort(); } catch {}
    };
  }, [current, phase, questions, voiceMode, startListening]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (phase === 'loading') return (
    <div className="quiz-panel"><p className="empty">Loading questions…</p></div>
  );
  if (phase === 'error') return (
    <div className="quiz-panel"><p style={{ color: '#f87171' }}>Failed to load questions.</p></div>
  );

  // ── Results ───────────────────────────────────────────────────────────────
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
              <span className="qa-val">{String(a.answer).charAt(0).toUpperCase() + String(a.answer).slice(1)}</span>
            </li>
          ))}
        </ul>
        <div className={`quiz-final-label ${cls}`}>{label}</div>
      </div>
    );
  }

  // ── Active quiz ───────────────────────────────────────────────────────────
  const q        = questions[current];
  const isMcq    = q.type === 'mcq';
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
      {isMcq && <p className="quiz-type-hint">Multiple choice — select one option</p>}

      {/* Voice indicator */}
      {voiceMode && (
        <div className="voice-indicator">
          {vState === 'speaking' && (
            <div className="voice-state voice-speaking">
              <span className="voice-icon">🔊</span><span>Speaking question…</span>
            </div>
          )}
          {vState === 'listening' && (
            <div className="voice-state voice-listening">
              <span className="voice-icon">🎤</span>
              <span>Listening… {isMcq ? 'say "one", "two"…' : 'say Yes or No'}</span>
              <span className="voice-dots"><span/><span/><span/></span>
            </div>
          )}
          {vState === 'idle' && (
            <div className="voice-state voice-idle">
              <button className="quiz-btn quiz-btn-mic" onClick={startListening}>🎤 Tap to speak</button>
            </div>
          )}
          {heard && <div className="voice-heard">Heard: "<em>{heard}</em>"</div>}
        </div>
      )}

      {/* MCQ options */}
      {isMcq ? (
        <div className="mcq-options">
          {q.options.map((opt, i) => (
            <button key={i} className="mcq-option-btn" onClick={() => handleAnswer(opt)}>
              <span className="mcq-option-num">{i + 1}</span>
              <span className="mcq-option-text">{opt}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="quiz-btn-row">
          <button className="quiz-btn quiz-btn-no"  onClick={() => handleAnswer('no')}>No</button>
          <button className="quiz-btn quiz-btn-yes" onClick={() => handleAnswer('yes')}>Yes</button>
        </div>
      )}

      {!voiceSupported && (
        <p style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>
          Voice not supported in this browser — use buttons above
        </p>
      )}
    </div>
  );
}
