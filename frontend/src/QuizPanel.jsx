import { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5165' : '';

// ── Keyword scoring ───────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'the','a','an','is','it','in','of','to','and','or','for','that','this','are',
  'with','we','has','have','can','not','be','as','by','at','its','on','which',
  'when','while','from','but','so','do','does','if','then','than','was','were',
  'will','would','should','could','any','all','also','into','their','they',
  'what','how','why','about','just','more','been','very','some','most','per',
  'using','used','use','make','get','set','put','two','each','both','only',
]);

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

// ── Component ─────────────────────────────────────────────────────────────────
export function QuizPanel({ sessionId, onSubmit }) {
  const [questions, setQuestions] = useState([]);
  const [current,   setCurrent]   = useState(0);
  const [answers,   setAnswers]   = useState([]);
  const [phase,     setPhase]     = useState('loading'); // loading|quiz|result|error
  const [feedback,  setFeedback]  = useState(null);      // null = answering, obj = showing result
  const [result,    setResult]    = useState(null);
  const textareaRef = useRef(null);

  // ── Load + shuffle questions ────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/quiz/questions`)
      .then(r => r.json())
      .then(data => {
        for (let i = data.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [data[i], data[j]] = [data[j], data[i]];
        }
        setQuestions(data);
        setPhase('quiz');
      })
      .catch(() => setPhase('error'));
  }, []);

  // ── Clear textarea when question advances ───────────────────────────────────
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.value = '';
    setFeedback(null);
  }, [current, phase]);

  // ── Submit answer ───────────────────────────────────────────────────────────
  const submit = (transcript) => {
    const q = questions[current];
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
    const newAnswers = [...answers, newAnswer];
    setAnswers(newAnswers);
    setFeedback({ transcript, evalRes, q, isCorrect, newAnswers });
  };

  // ── Advance to next ─────────────────────────────────────────────────────────
  const advance = () => {
    const { newAnswers } = feedback;
    if (current + 1 >= questions.length) {
      const score = newAnswers.filter(a => a.isCorrect === true).length;
      const total = newAnswers.filter(a => a.isCorrect !== null).length;
      const res   = { sessionId, answers: newAnswers, score, total };
      setResult(res);
      setPhase('result');
      onSubmit?.(res);
    } else {
      setCurrent(c => c + 1);
      setFeedback(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
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
        <span className="quiz-counter">{current + 1} / {questions.length}</span>
      </div>

      <div className="quiz-progress-bar">
        <div className="quiz-progress-fill" style={{ width: `${prog}%` }} />
      </div>

      <p className="quiz-question-text">{q.text}</p>

      {/* ── ANSWERING ─────────────────────────────────────────── */}
      {!feedback && (
        <>
          {isOpen && (
            <div className="openended-input">
              <textarea
                ref={textareaRef}
                className="openended-textarea"
                placeholder="Type your answer here…"
                rows={4}
                id="oe-answer-input"
              />
              <button
                className="btn btn-start"
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => {
                  const v = textareaRef.current?.value?.trim();
                  if (v) submit(v);
                }}
              >
                Submit Answer
              </button>
            </div>
          )}

          {isMcq && (
            <div className="mcq-options">
              {q.options.map((opt, i) => (
                <button key={i} className="mcq-option-btn" onClick={() => submit(opt)}>
                  <span className="mcq-option-num">{i + 1}</span>
                  <span className="mcq-option-text">{opt}</span>
                </button>
              ))}
            </div>
          )}

          {!isOpen && !isMcq && (
            <div className="quiz-btn-row">
              <button className="quiz-btn quiz-btn-no"  onClick={() => submit('no')}>No</button>
              <button className="quiz-btn quiz-btn-yes" onClick={() => submit('yes')}>Yes</button>
            </div>
          )}
        </>
      )}

      {/* ── FEEDBACK ──────────────────────────────────────────── */}
      {feedback && (
        <div className="quiz-feedback">
          {/* What the user wrote */}
          <div className="qf-heard">
            <span className="qf-label">Your answer:</span>
            <span className="qf-transcript">{feedback.transcript}</span>
          </div>

          {/* Open-ended score + keywords */}
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
                  <span className="qf-kw-label">Covered:</span>
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
            </>
          )}

          {/* MCQ / yes-no verdict */}
          {!isOpen && (
            <div className={`qf-score ${feedback.isCorrect === true ? 'qf-good' : feedback.isCorrect === false ? 'qf-poor' : 'qf-partial'}`}>
              {feedback.isCorrect === true  && '✓ Correct!'}
              {feedback.isCorrect === false && `✗ Correct answer: ${q.correctAnswer}`}
              {feedback.isCorrect === null  && '· Noted'}
            </div>
          )}

          {/* Model answer */}
          {q.correctAnswer && (
            <div className="qf-model-answer">
              <span className="qf-label">Model answer:</span>
              <span className="qf-answer-text">{q.correctAnswer}</span>
            </div>
          )}

          <button className="btn btn-start qf-next-btn" onClick={advance}>
            {current + 1 >= questions.length ? 'See Results →' : 'Next Question →'}
          </button>
        </div>
      )}
    </div>
  );
}
