import { useState } from 'react';

export default function CandidateRegistration({ onComplete }) {
  const [name,  setName]  = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const n = name.trim();
    const em = email.trim();
    if (!n)                        { setError('Please enter your name.');           return; }
    if (!em || !em.includes('@'))  { setError('Please enter a valid email.');       return; }
    sessionStorage.setItem('candidateInfo', JSON.stringify({ name: n, email: em }));
    onComplete({ name: n, email: em });
  };

  return (
    <div className="reg-overlay">
      <div className="reg-card">
        <div className="reg-icon">📋</div>
        <h2 className="reg-title">Candidate Details</h2>
        <p className="reg-sub">Please provide your information before starting the assessment.</p>
        <form onSubmit={submit} className="reg-form">
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
              placeholder="e.g. mohit@example.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
            />
          </div>
          {error && <p className="reg-error">{error}</p>}
          <button type="submit" className="btn btn-start reg-btn">Start Assessment →</button>
        </form>
      </div>
    </div>
  );
}
