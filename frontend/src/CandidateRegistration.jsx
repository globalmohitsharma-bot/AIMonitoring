import { useState } from 'react';

const RULES = [
  { icon: '⛶', text: 'Fullscreen is mandatory — exiting fullscreen more than once will terminate your exam.' },
  { icon: '📷', text: 'Camera must be on and your face clearly visible at all times.' },
  { icon: '🧑', text: 'Stay within the camera frame. Looking away will be flagged.' },
  { icon: '🔇', text: 'Ensure a quiet environment — audio spikes are monitored.' },
  { icon: '🚫', text: 'Do not switch tabs or open other applications.' },
  { icon: '⌨️', text: 'Copy-paste is disabled. Type all answers manually.' },
  { icon: '🖥️', text: 'Only one monitor allowed — external displays must be disconnected.' },
  { icon: '⏱️', text: 'The exam is timed. Auto-submits when time runs out.' },
];

export default function CandidateRegistration({ onComplete }) {
  const [name,    setName]    = useState('');
  const [email,   setEmail]   = useState('');
  const [agreed,  setAgreed]  = useState(false);
  const [error,   setError]   = useState('');

  const submit = (e) => {
    e.preventDefault();
    const n  = name.trim();
    const em = email.trim();
    if (!n)                       { setError('Please enter your name.');         return; }
    if (!em || !em.includes('@')) { setError('Please enter a valid email.');     return; }
    if (!agreed)                  { setError('You must accept the rules to continue.'); return; }

    // Request fullscreen NOW — this click is the user gesture browsers require
    try {
      const el = document.documentElement;
      if      (el.requestFullscreen)        el.requestFullscreen();
      else if (el.webkitRequestFullscreen)  el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen)     el.mozRequestFullScreen();
    } catch {}

    sessionStorage.setItem('candidateInfo', JSON.stringify({ name: n, email: em }));
    onComplete({ name: n, email: em });
  };

  return (
    <div className="reg-overlay">
      <div className="reg-card reg-card-wide">
        <div className="reg-icon">📋</div>
        <h2 className="reg-title">Before You Begin</h2>
        <p className="reg-sub">Read the exam rules carefully, then enter your details to start.</p>

        {/* ── Rules panel ─────────────────────────────────── */}
        <div className="rules-panel">
          <h3 className="rules-heading">Exam Rules &amp; Requirements</h3>
          <ul className="rules-list">
            {RULES.map((r, i) => (
              <li key={i} className="rules-item">
                <span className="rules-icon">{r.icon}</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
          <p className="rules-warn">
            Violations are recorded and reviewed by the proctor. Repeated violations
            will <strong>automatically terminate</strong> your exam and submit your answers as-is.
          </p>
        </div>

        {/* ── Form ────────────────────────────────────────── */}
        <form onSubmit={submit} className="reg-form">
          <div className="reg-fields-row">
            <div className="reg-field">
              <label className="reg-label">Full Name</label>
              <input
                className="reg-input"
                type="text"
                placeholder="e.g. Mohit Sharma"
                value={name}
                onChange={e => { setName(e.target.value); setError(''); }}
                autoFocus
              />
            </div>
            <div className="reg-field">
              <label className="reg-label">Email Address</label>
              <input
                className="reg-input"
                type="email"
                placeholder="e.g. global.mohitsharma@gmail.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
              />
            </div>
          </div>

          <label className="rules-agree">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => { setAgreed(e.target.checked); setError(''); }}
            />
            <span>I have read and agree to all exam rules. I understand violations will be monitored and may terminate my exam.</span>
          </label>

          {error && <p className="reg-error">{error}</p>}
          <button type="submit" className="btn btn-start reg-btn" disabled={!agreed}>
            Start Assessment in Fullscreen →
          </button>
        </form>
      </div>
    </div>
  );
}
