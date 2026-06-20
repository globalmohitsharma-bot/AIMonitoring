import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5165' : '';

// ── Constants ─────────────────────────────────────────────────────────────────
const YES_WORDS = ['yes','yeah','yep','correct','true','sure','affirmative','ok','okay'];
const NO_WORDS  = ['no','nope','nah','negative','false','incorrect'];
const OPTION_WORDS = {
  0: ['one','first','1','a'],
  1: ['two','second','2','b'],
  2: ['three','third','3','c'],
  3: ['four','fourth','4','d'],
};
const STOP_WORDS = new Set([
  'the','a','an','is','it','in','of','to','and','or','for','that','this','are',
  'with','we','has','have','can','not','be','as','by','at','its','on','which',
  'when','while','from','but','so','do','does','if','then','than','was','were',
  'will','would','should','could','any','all','also','into','their','they',
  'what','how','why','about','just','more','been','very','some','most','per',
  'using','used','use','make','get','set','put','two','each','both','only',
]);

// ── Pure helpers ──────────────────────────────────────────────────────────────
function extractKeywords(text) {
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s#.]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  )];
}

function evalOpenEnded(userText, correctText) {
  if (!correctText) return { pct: 100, matched: [], missing: [], grade: 'good', isCorrect: true };
  const keys    = extractKeywords(correctText);
  const lower   = userText.toLowerCase();
  const matched = keys.filter(k => lower.includes(k));
  const missing = keys.filter(k => !lower.includes(k));
  const pct     = keys.length > 0 ? Math.round((matched.length / keys.length) * 100) : 100;
  return {
    pct,
    matched:   matched.slice(0, 8),
    missing:   missing.slice(0, 5),
    grade:     pct >= 50 ? 'good' : pct >= 25 ? 'partial' : 'poor',
    isCorrect: pct >= 50,
  };
}

function parseYesNo(t) {
  const l = t.toLowerCase();
  if (YES_WORDS.some(w => l.includes(w))) return 'yes';
  if (NO_WORDS.some(w => l.includes(w)))  return 'no';
  return null;
}

function parseMcq(t, options) {
  const l = t.toLowerCase();
  for (const [idx, words] of Object.entries(OPTION_WORDS)) {
    if (+idx < options.length && words.some(w => l.includes(w))) return options[+idx];
  }
  for (const opt of options) {
    if (l.includes(opt.toLowerCase().split(' ')[0])) return opt;
  }
  return null;
}

function speak(text) {
  return new Promise(resolve => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9; u.pitch = 1; u.lang = 'en-US';
    u.onend = resolve; u.onerror = resolve;
    window.speechSynthesis.speak(u);
  });
}

const SpeechRecAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceOK      = !!SpeechRecAPI;

// ── Component ─────────────────────────────────────────────────────────────────
export function QuizPanel({ sessionId, onSubmit }) {
  const [questions, setQuestions] = useState([]);
  const [current,   setCurrent]   = useState(0);
  const [answers,   setAnswers]   = useState([]);
  const [phase,     setPhase]     = useState('loading');  // loading|quiz|result|error
  const [qPhase,    setQPhase]    = useState('speaking'); // speaking|listening|feedback
  const [voiceMode, setVoiceMode] = useState(voiceOK);
  const [liveText,  setLiveText]  = useState('');
  const [feedback,  setFeedback]  = useState(null);
  const [result,    setResult]    = useState(null);

  // Refs to avoid stale closures in async/recognition callbacks
  const answersRef   = useRef([]);
  const currentRef   = useRef(0);
  const questionsRef = useRef([]);
  const recRef       = useRef(null);
  const silenceRef   = useRef(null);
  const autoTimerRef = useRef(null);
  const finalRef     = useRef('');
  const busyRef      = useRef(false);
  const doSubmitRef  = useRef(null);
  const doListenRef  = useRef(null);
  const doAdvanceRef = useRef(null);

  // Keep refs in sync
  answersRef.current   = answers;
  currentRef.current   = current;
  questionsRef.current = questions;

  // ── Load questions ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/quiz/questions`)
      .then(r => r.json())
      .then(data => { setQuestions(data); setPhase('quiz'); })
      .catch(() => setPhase('error'));
  }, []);

  // ── Advance to next question ────────────────────────────────────────────────
  const doAdvance = useCallback((newAnswers) => {
    clearTimeout(silenceRef.current);
    clearTimeout(autoTimerRef.current);
    window.speechSynthesis.cancel();
    try { recRef.current?.abort(); } catch {}
    busyRef.current = false;

    const c  = currentRef.current;
    const qs = questionsRef.current;

    if (c + 1 >= qs.length) {
      const score = newAnswers.filter(a => a.isCorrect === true).length;
      const total = newAnswers.filter(a => a.isCorrect !== null).length;
      const res   = { sessionId, answers: newAnswers, score, total };
      setResult(res);
      setPhase('result');
      const pct = total > 0 ? Math.round((score / total) * 100) : 100;
      speak(`Quiz complete. Your score is ${score} out of ${total}, that is ${pct} percent.`);
      onSubmit?.(res);
    } else {
      setAnswers(newAnswers);
      setCurrent(c + 1);
      setFeedback(null);
      setLiveText('');
      setQPhase('speaking');
    }
  }, [sessionId, onSubmit]);

  doAdvanceRef.current = doAdvance;

  // ── Submit and evaluate an answer ──────────────────────────────────────────
  const doSubmit = useCallback((transcript, q) => {
    if (busyRef.current) return;
    busyRef.current = true;

    window.speechSynthesis.cancel();
    try { recRef.current?.stop(); recRef.current?.abort(); } catch {}
    clearTimeout(silenceRef.current);

    const currentAnswers = answersRef.current;
    let isCorrect = null;
    let evalRes   = null;

    if (q.type === 'openended') {
      evalRes   = evalOpenEnded(transcript, q.correctAnswer ?? '');
      isCorrect = evalRes.isCorrect;
    } else if (q.type === 'mcq') {
      isCorrect = transcript === q.correctAnswer;
    } else {
      isCorrect = q.correctAnswer == null ? null : transcript === q.correctAnswer;
    }

    const newAnswer  = { questionId: q.id, questionText: q.text, answer: transcript, isCorrect };
    const newAnswers = [...currentAnswers, newAnswer];

    setAnswers(newAnswers);
    setFeedback({ transcript, evalRes, q, isCorrect });
    setQPhase('feedback');

    // Compose spoken feedback
    let msg;
    if (q.type === 'openended' && evalRes) {
      if (evalRes.grade === 'good') {
        msg = `Good answer. You covered ${evalRes.matched.length} key concepts.`;
      } else if (evalRes.grade === 'partial') {
        msg = `Partial answer. You missed: ${evalRes.missing.slice(0, 3).join(', ')}.`;
      } else {
        msg = `Needs improvement. Try to mention: ${evalRes.missing.slice(0, 3).join(', ')}.`;
      }
    } else if (isCorrect === true) {
      msg = 'Correct!';
    } else if (isCorrect === false) {
      msg = `Incorrect. The correct answer was ${q.correctAnswer}.`;
    } else {
      msg = 'Answer noted.';
    }

    speak(msg).then(() => {
      autoTimerRef.current = setTimeout(() => doAdvanceRef.current(newAnswers), 5000);
    });
  }, []);

  doSubmitRef.current = doSubmit;

  // ── Start voice recognition ─────────────────────────────────────────────────
  const doListen = useCallback((q) => {
    if (!voiceOK) { setQPhase('listening'); return; }
    finalRef.current = '';
    setLiveText('');

    const rec = new SpeechRecAPI();
    rec.lang            = 'en-US';
    rec.maxAlternatives = 1;
    rec.continuous      = q.type === 'openended';
    rec.interimResults  = q.type === 'openended';

    rec.onstart = () => {
      setQPhase('listening');
      if (q.type === 'openended') {
        clearTimeout(silenceRef.current);
        silenceRef.current = setTimeout(() => { try { rec.stop(); } catch {} }, 20000);
      }
    };

    rec.onresult = (e) => {
      if (q.type === 'openended') {
        // Each new speech chunk resets the 2.5 s silence timer
        clearTimeout(silenceRef.current);
        silenceRef.current = setTimeout(() => { try { rec.stop(); } catch {} }, 2500);

        let interim = '';
        finalRef.current = '';
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalRef.current += e.results[i][0].transcript + ' ';
          else                      interim           += e.results[i][0].transcript;
        }
        setLiveText(finalRef.current + interim);
      } else {
        const text = Array.from(e.results[0]).map(r => r.transcript).join(' ').trim();
        finalRef.current = text;
        setLiveText(text);

        const ans = q.type === 'mcq'
          ? parseMcq(text, q.options ?? [])
          : parseYesNo(text);

        if (ans !== null) {
          doSubmitRef.current(ans, q);
        } else {
          const hint = q.type === 'mcq'
            ? 'Please say the option number: one, two, three, or four.'
            : 'Please say yes or no clearly.';
          finalRef.current = '';
          setLiveText('');
          speak(`I didn't catch that. ${hint}`).then(() => doListenRef.current(q));
        }
      }
    };

    rec.onend = () => {
      clearTimeout(silenceRef.current);
      if (q.type === 'openended') {
        const trimmed = finalRef.current.trim();
        if (trimmed && !busyRef.current) {
          doSubmitRef.current(trimmed, q);
        } else if (!trimmed && !busyRef.current) {
          speak('I did not hear anything. Please speak your answer.').then(() => doListenRef.current(q));
        }
      }
    };

    rec.onerror = (e) => {
      clearTimeout(silenceRef.current);
      if (e.error === 'aborted') return;
      if (!busyRef.current) {
        if (e.error === 'no-speech') {
          speak('I did not hear anything. Please try again.').then(() => doListenRef.current(q));
        } else {
          console.warn('SpeechRecognition error:', e.error);
          setQPhase('listening'); // fall back to buttons/textarea
        }
      }
    };

    recRef.current = rec;
    try { rec.start(); } catch (err) {
      console.warn('rec.start() failed:', err);
      setQPhase('listening');
    }
  }, []);

  doListenRef.current = doListen;

  // ── Speak question whenever current question or phase changes ──────────────
  useEffect(() => {
    // Only run when entering speaking phase (guards against feedback/listening re-triggers)
    if (phase !== 'quiz' || questions.length === 0 || qPhase !== 'speaking') return;

    busyRef.current = false;
    setLiveText('');
    setFeedback(null);
    clearTimeout(silenceRef.current);
    clearTimeout(autoTimerRef.current);

    const q = questions[current];

    const run = async () => {
      await speak(q.text);
      if (q.type === 'mcq' && q.options?.length) {
        await speak(q.options.map((o, i) => `Option ${i + 1}: ${o}`).join('. '));
      } else if (q.type === 'openended') {
        await speak('Please speak your answer, or type it below.');
      } else {
        await speak('Please answer yes or no.');
      }
      if (voiceMode) doListenRef.current(q);
      else setQPhase('listening');
    };

    run();

    return () => {
      window.speechSynthesis.cancel();
      clearTimeout(silenceRef.current);
      try { recRef.current?.abort(); } catch {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, phase, questions, qPhase, voiceMode]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => () => {
    window.speechSynthesis.cancel();
    clearTimeout(silenceRef.current);
    clearTimeout(autoTimerRef.current);
    try { recRef.current?.abort(); } catch {}
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (phase === 'loading') return (
    <div className="quiz-panel"><p className="empty">Loading questions…</p></div>
  );
  if (phase === 'error') return (
    <div className="quiz-panel"><p style={{ color: '#f87171' }}>Failed to load questions.</p></div>
  );

  // ── Results screen ──────────────────────────────────────────────────────────
  if (phase === 'result') {
    const pct   = result.total > 0 ? Math.round((result.score / result.total) * 100) : 100;
    const cls   = pct >= 80 ? 'quiz-ok' : pct >= 50 ? 'quiz-warn' : 'quiz-fail';
    const label = pct >= 80 ? 'Excellent' : pct >= 50 ? 'Satisfactory' : 'Needs Improvement';
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
              <div className="qa-content">
                <span className="qa-text">{a.questionText}</span>
                <span className="qa-val">{a.answer.length > 80 ? a.answer.slice(0, 80) + '…' : a.answer}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className={`quiz-final-label ${cls}`}>{label}</div>
      </div>
    );
  }

  // ── Active question ─────────────────────────────────────────────────────────
  const q      = questions[current];
  const isOpen = q.type === 'openended';
  const isMcq  = q.type === 'mcq';
  const prog   = (current / questions.length) * 100;

  return (
    <div className="quiz-panel">
      <div className="quiz-header">
        <h3 className="quiz-title">C# Interview Quiz</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="quiz-counter">{current + 1} / {questions.length}</span>
          {voiceOK && (
            <button
              className={`voice-toggle ${voiceMode ? 'voice-on' : 'voice-off'}`}
              onClick={() => {
                window.speechSynthesis.cancel();
                try { recRef.current?.abort(); } catch {}
                clearTimeout(silenceRef.current);
                setVoiceMode(m => !m);
                if (qPhase !== 'feedback') setQPhase('listening');
              }}
            >
              {voiceMode ? '🎤 Voice' : '🖱 Buttons'}
            </button>
          )}
        </div>
      </div>

      <div className="quiz-progress-bar">
        <div className="quiz-progress-fill" style={{ width: `${prog}%` }} />
      </div>

      <p className="quiz-question-text">{q.text}</p>

      {/* ── FEEDBACK PHASE ────────────────────────────────────── */}
      {qPhase === 'feedback' && feedback && (
        <div className="quiz-feedback">
          <div className="qf-heard">
            <span className="qf-label">You said:</span>
            <span className="qf-transcript">
              &ldquo;{feedback.transcript.length > 140
                ? feedback.transcript.slice(0, 140) + '…'
                : feedback.transcript}&rdquo;
            </span>
          </div>

          {isOpen && feedback.evalRes && (
            <>
              <div className={`qf-score qf-${feedback.evalRes.grade}`}>
                <span>
                  {feedback.evalRes.grade === 'good'    && '✓ Good answer'}
                  {feedback.evalRes.grade === 'partial' && '◑ Partial answer'}
                  {feedback.evalRes.grade === 'poor'    && '✗ Needs more detail'}
                </span>
                <span className="qf-pct">{feedback.evalRes.pct}% match</span>
              </div>
              {feedback.evalRes.matched.length > 0 && (
                <div className="qf-keywords">
                  <span className="qf-kw-label">Mentioned:</span>
                  {feedback.evalRes.matched.map(k => (
                    <span key={k} className="kw-badge kw-matched">{k}</span>
                  ))}
                </div>
              )}
              {feedback.evalRes.missing.length > 0 && (
                <div className="qf-keywords">
                  <span className="qf-kw-label">Missed:</span>
                  {feedback.evalRes.missing.map(k => (
                    <span key={k} className="kw-badge kw-missing">{k}</span>
                  ))}
                </div>
              )}
              {q.correctAnswer && (
                <div className="qf-model-answer">
                  <span className="qf-label">Model answer:</span>
                  <span className="qf-answer-text">{q.correctAnswer}</span>
                </div>
              )}
            </>
          )}

          {!isOpen && (
            <div className={`qf-score ${feedback.isCorrect === true ? 'qf-good' : feedback.isCorrect === false ? 'qf-poor' : 'qf-partial'}`}>
              {feedback.isCorrect === true  && '✓ Correct!'}
              {feedback.isCorrect === false && `✗ Correct answer: ${q.correctAnswer}`}
              {feedback.isCorrect === null  && '· Noted'}
            </div>
          )}

          <button
            className="btn btn-start qf-next-btn"
            onClick={() => {
              clearTimeout(autoTimerRef.current);
              doAdvanceRef.current(answers);
            }}
          >
            {current + 1 >= questions.length ? 'See Results →' : 'Next Question →'}
          </button>
          <p className="qf-auto-hint">Auto-advances in 5 seconds…</p>
        </div>
      )}

      {/* ── SPEAKING / LISTENING PHASE ────────────────────────── */}
      {qPhase !== 'feedback' && (
        <>
          {voiceMode && (
            <div className="voice-indicator">
              {qPhase === 'speaking' && (
                <div className="voice-state voice-speaking">
                  <span className="voice-icon">🔊</span>
                  <span>Speaking question…</span>
                </div>
              )}
              {qPhase === 'listening' && (
                <div className="voice-state voice-listening">
                  <span className="voice-icon">🎤</span>
                  <span>
                    {isOpen
                      ? 'Listening… speak freely — auto-submits after you pause'
                      : isMcq
                      ? 'Say "one", "two", "three" or "four"'
                      : 'Say Yes or No'}
                  </span>
                  <span className="voice-dots"><span /><span /><span /></span>
                </div>
              )}
              {liveText && (
                <div className="voice-heard"><em>{liveText}</em></div>
              )}
              {qPhase === 'listening' && isOpen && (
                <button
                  className="qf-done-btn"
                  onClick={() => { try { recRef.current?.stop(); } catch {} }}
                >
                  ✓ Done Speaking
                </button>
              )}
            </div>
          )}

          {/* Open-ended: show textarea in listening phase */}
          {isOpen && qPhase === 'listening' && (
            <div className="openended-input">
              <textarea
                className="openended-textarea"
                placeholder={voiceMode ? 'Or type your answer here…' : 'Type your answer here…'}
                rows={4}
                id="oe-answer-input"
              />
              <button
                className="btn btn-start"
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => {
                  const v = document.getElementById('oe-answer-input')?.value?.trim();
                  if (v) {
                    try { recRef.current?.abort(); } catch {}
                    doSubmitRef.current(v, q);
                  }
                }}
              >
                Submit Answer
              </button>
            </div>
          )}

          {/* MCQ buttons */}
          {isMcq && qPhase === 'listening' && (
            <div className="mcq-options">
              {q.options.map((opt, i) => (
                <button key={i} className="mcq-option-btn" onClick={() => doSubmitRef.current(opt, q)}>
                  <span className="mcq-option-num">{i + 1}</span>
                  <span className="mcq-option-text">{opt}</span>
                </button>
              ))}
            </div>
          )}

          {/* Yes/No buttons */}
          {!isOpen && !isMcq && qPhase === 'listening' && (
            <div className="quiz-btn-row">
              <button className="quiz-btn quiz-btn-no"  onClick={() => doSubmitRef.current('no',  q)}>No</button>
              <button className="quiz-btn quiz-btn-yes" onClick={() => doSubmitRef.current('yes', q)}>Yes</button>
            </div>
          )}
        </>
      )}

      {!voiceOK && (
        <p style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center', marginTop: 8 }}>
          Voice not supported in this browser — use the text input above
        </p>
      )}
    </div>
  );
}
