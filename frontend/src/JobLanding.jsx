import { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5165' : '';

function SkillBadge({ name, matched }) {
  return (
    <span className={`skill-badge ${matched ? 'skill-matched' : 'skill-missing'}`}>
      {matched ? '✓' : '○'} {name}
    </span>
  );
}

function ScoreRing({ pct, passed }) {
  const radius = 54;
  const circ   = 2 * Math.PI * radius;
  const fill   = (pct / 100) * circ;
  const color  = pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="score-ring-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#1e293b" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={radius}
          fill="none" stroke={color} strokeWidth="12"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dasharray 1s ease' }}
        />
      </svg>
      <div className="score-ring-text">
        <span className="score-pct" style={{ color }}>{pct}%</span>
        <span className="score-label">{passed ? 'Qualified' : 'Not Qualified'}</span>
      </div>
    </div>
  );
}

export default function JobLanding() {
  const [jd,        setJd]        = useState(null);
  const [phase,     setPhase]     = useState('landing'); // landing | analyzing | result
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState('');
  const [dragging,  setDragging]  = useState(false);
  const [fileName,  setFileName]  = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/resume/jd`)
      .then(r => r.json())
      .then(setJd)
      .catch(() => {});
  }, []);

  const analyze = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setPhase('analyzing');
    setError('');

    const form = new FormData();
    form.append('file', file);

    try {
      const res  = await fetch(`${API_BASE}/api/resume/analyze`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Analysis failed.'); setPhase('landing'); return; }
      setResult(data);
      setPhase('result');
    } catch {
      setError('Network error — please try again.');
      setPhase('landing');
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf','docx','doc','txt'].includes(ext)) {
      setError('Supported formats: PDF, DOCX, TXT');
      return;
    }
    analyze(file);
  };

  const proceedToExam = () => {
    sessionStorage.setItem('resumeMatch', JSON.stringify({
      score: result.matchPercentage,
      matched: result.matchedSkills,
      missing: result.missingSkills,
    }));
    window.location.href = '/exam';
  };

  if (!jd) return (
    <div className="landing-page">
      <div className="landing-card" style={{ textAlign: 'center', color: '#64748b' }}>Loading job details…</div>
    </div>
  );

  return (
    <div className="landing-page">
      <div className="landing-card">

        {/* Header */}
        <div className="landing-header">
          <div className="landing-logo">🎯</div>
          <div>
            <h1 className="landing-title">AI Proctoring Assessment</h1>
            <p className="landing-sub">Upload your resume to check eligibility</p>
          </div>
        </div>

        {/* JD section */}
        <div className="jd-section">
          <div className="jd-title-row">
            <div>
              <h2 className="jd-role">{jd.title}</h2>
              <p className="jd-desc">{jd.description}</p>
            </div>
            <span className="jd-badge">Min {jd.minMatch}% match required</span>
          </div>

          <div className="jd-skills-label">Required Skills</div>
          <div className="jd-skills-grid">
            {jd.skills.map(s => (
              <span key={s} className="skill-badge skill-neutral">○ {s}</span>
            ))}
          </div>
        </div>

        {/* Upload / Analyzing / Result */}
        {phase === 'landing' && (
          <>
            <div
              className={`upload-zone ${dragging ? 'upload-dragging' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            >
              <input
                ref={fileRef} type="file"
                accept=".pdf,.docx,.doc,.txt"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />
              <div className="upload-icon">📄</div>
              <div className="upload-text">
                <b>Click to upload</b> or drag & drop your resume
              </div>
              <div className="upload-hint">PDF, DOCX, TXT — max 10 MB</div>
              {error && <div className="upload-error">{error}</div>}
            </div>

            <div className="skip-row">
              <span className="skip-divider">or</span>
              <button
                className="btn skip-btn"
                onClick={() => window.location.href = '/exam'}
              >
                Skip — Go directly to interview →
              </button>
            </div>
          </>
        )}

        {phase === 'analyzing' && (
          <div className="analyzing-box">
            <div className="analyzing-spinner" />
            <div className="analyzing-text">Analyzing <b>{fileName}</b>…</div>
            <div className="analyzing-sub">Matching your skills against the job description</div>
          </div>
        )}

        {phase === 'result' && result && (
          <div className="result-box">
            <ScoreRing pct={result.matchPercentage} passed={result.passed} />

            <p className="result-message">{result.message}</p>

            <div className="result-skills">
              <div>
                <div className="result-skills-label">✓ Matched ({result.matchedSkills.length})</div>
                <div className="skills-wrap">
                  {result.matchedSkills.map(s => <SkillBadge key={s} name={s} matched />)}
                </div>
              </div>
              {result.missingSkills.length > 0 && (
                <div>
                  <div className="result-skills-label">○ Missing ({result.missingSkills.length})</div>
                  <div className="skills-wrap">
                    {result.missingSkills.map(s => <SkillBadge key={s} name={s} matched={false} />)}
                  </div>
                </div>
              )}
            </div>

            {result.passed ? (
              <button className="btn btn-start proceed-btn" onClick={proceedToExam}>
                Proceed to Assessment →
              </button>
            ) : (
              <div className="rejected-box">
                <p>Unfortunately your profile does not meet the minimum requirement of {jd.minMatch}% for this role.</p>
                <button className="btn" style={{ background:'#334155', color:'#94a3b8', marginTop:12 }}
                  onClick={() => { setPhase('landing'); setResult(null); setFileName(''); }}>
                  Try with another resume
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
