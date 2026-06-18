import { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5165' : '';

export function QuizPanel({ sessionId, onSubmit }) {
  const [questions, setQuestions] = useState([]);
  const [current,   setCurrent]   = useState(0);
  const [answers,   setAnswers]   = useState([]);
  const [phase,     setPhase]     = useState('loading'); // loading | quiz | result | error
  const [result,    setResult]    = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/quiz/questions`)
      .then(r => r.json())
      .then(data => { setQuestions(data); setPhase('quiz'); })
      .catch(() => setPhase('error'));
  }, []);

  const handleAnswer = useCallback((value) => {
    const q = questions[current];
    const isCorrect = q.correctAnswer == null ? null : value === q.correctAnswer;
    const newAnswer = { questionId: q.id, questionText: q.text, answer: value, isCorrect };
    const newAnswers = [...answers, newAnswer];
    setAnswers(newAnswers);

    if (current + 1 >= questions.length) {
      const score = newAnswers.filter(a => a.isCorrect === true).length;
      const total = newAnswers.filter(a => a.isCorrect !== null).length;
      const res = { sessionId, answers: newAnswers, score, total };
      setResult(res);
      setPhase('result');
      onSubmit?.(res);
    } else {
      setCurrent(c => c + 1);
    }
  }, [current, questions, answers, sessionId, onSubmit]);

  if (phase === 'loading') {
    return (
      <div className="quiz-panel">
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading questions…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="quiz-panel">
        <p style={{ color: '#f87171', fontSize: '0.875rem' }}>Failed to load questions.</p>
      </div>
    );
  }

  if (phase === 'quiz') {
    const q = questions[current];
    const progress = (current / questions.length) * 100;

    return (
      <div className="quiz-panel">
        <div className="quiz-header">
          <h3 className="quiz-title">Pre-Exam Questionnaire</h3>
          <span className="quiz-counter">{current + 1} / {questions.length}</span>
        </div>

        <div className="quiz-progress-bar">
          <div className="quiz-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <p className="quiz-question-text">{q.text}</p>

        <div className="quiz-btn-row">
          <button className="quiz-btn quiz-btn-no"  onClick={() => handleAnswer(false)}>No</button>
          <button className="quiz-btn quiz-btn-yes" onClick={() => handleAnswer(true)}>Yes</button>
        </div>
      </div>
    );
  }

  // ── Result phase ──────────────────────────────────────────
  const pct    = result.total > 0 ? Math.round(result.score / result.total * 100) : 100;
  const label  = pct === 100 ? 'All Clear' : pct >= 60 ? 'Some Concerns' : 'Review Required';
  const cls    = pct === 100 ? 'quiz-ok' : pct >= 60 ? 'quiz-warn' : 'quiz-fail';

  return (
    <div className="quiz-panel">
      <div className="quiz-header">
        <h3 className="quiz-title">Quiz Complete</h3>
        <span className={`quiz-score-badge ${cls}`}>
          {result.score} / {result.total} &nbsp;·&nbsp; {pct}%
        </span>
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
