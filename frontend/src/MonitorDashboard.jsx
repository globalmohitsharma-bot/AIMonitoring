import { useEffect, useRef, useState, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';

const HUB_URL  = import.meta.env.DEV
  ? 'http://localhost:5165/hub/monitoring'
  : `${window.location.origin}/hub/monitoring`;

const API_BASE = import.meta.env.DEV ? 'http://localhost:5165' : '';

const TYPE_LABELS = {
  0:  'Tab Switch',      1:  'Face Lost',      2:  'Face Returned',
  3:  'Session Start',   4:  'Session End',     5:  'Tab Returned',
  6:  'Quiz Done',       7:  'Multi-Face',      8:  'Audio Alert',
  9:  'Inactivity',      10: 'Timer Expired',
  11: '⛶ Fullscreen Exit', 12: '⎘ Paste Attempt', 13: '🔧 DevTools Block',
  15: '🖥️ Multi-Monitor',
};

const MONITOR_PASSWORD = 'Qazwsx';

// ── Sound alert ───────────────────────────────────────────────────────────────
function playAlertBeep() {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    ctx.close();
  } catch {}
}

// ── Export report ─────────────────────────────────────────────────────────────
function exportReport(session, events, quizResult) {
  const riskColor = session.riskScore >= 80 ? '#22c55e' : session.riskScore >= 50 ? '#f59e0b' : '#ef4444';
  const evRows = events
    .filter(e => e.sessionId === session.sessionId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map(e => `<tr>
      <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
      <td>${TYPE_LABELS[e.type] ?? e.type}</td>
      <td style="color:${e.severity==='error'?'#ef4444':e.severity==='warning'?'#f59e0b':'#22c55e'}">${e.severity}</td>
      <td>${e.message}</td>
    </tr>`).join('');

  const qRows = quizResult
    ? quizResult.answers.map(a => `<tr>
        <td>${a.questionText}</td>
        <td>${a.answer}</td>
        <td style="color:${a.isCorrect===true?'#22c55e':a.isCorrect===false?'#ef4444':'#888'}">${a.isCorrect===true?'Correct':a.isCorrect===false?'Wrong':'N/A'}</td>
      </tr>`).join('')
    : '<tr><td colspan="3">Not completed</td></tr>';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Exam Report — ${session.candidateName ?? session.sessionId}</title>
  <style>
    body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:32px;margin:0}
    h1{font-size:1.4rem;margin-bottom:4px} h2{font-size:1rem;margin:24px 0 8px;color:#94a3b8}
    .meta{display:flex;gap:32px;flex-wrap:wrap;background:#1e293b;padding:16px;border-radius:8px;margin-bottom:16px}
    .meta div{display:flex;flex-direction:column;gap:2px}
    .label{font-size:0.7rem;color:#64748b;text-transform:uppercase}
    .value{font-size:1rem;font-weight:600}
    table{width:100%;border-collapse:collapse;font-size:0.82rem}
    th{text-align:left;padding:6px 10px;background:#1e293b;color:#94a3b8;font-weight:500}
    td{padding:6px 10px;border-bottom:1px solid #1e293b}
    @media print{body{background:#fff;color:#000} th{background:#eee;color:#000} td{border-color:#ddd}}
  </style></head><body>
  <h1>Exam Report</h1>
  <div class="meta">
    <div><span class="label">Candidate</span><span class="value">${session.candidateName ?? '—'}</span></div>
    <div><span class="label">Email</span><span class="value">${session.candidateEmail ?? '—'}</span></div>
    <div><span class="label">Session</span><span class="value" style="font-size:0.75rem">${session.sessionId}</span></div>
    <div><span class="label">Risk Score</span><span class="value" style="color:${riskColor}">${session.riskScore}</span></div>
    <div><span class="label">Quiz Score</span><span class="value">${session.quizScore != null ? `${session.quizScore}/${session.quizTotal}` : '—'}</span></div>
    <div><span class="label">Started</span><span class="value">${new Date(session.startedAt).toLocaleString()}</span></div>
  </div>
  <h2>Event Timeline (${events.filter(e=>e.sessionId===session.sessionId).length} events)</h2>
  <table><thead><tr><th>Time</th><th>Type</th><th>Severity</th><th>Message</th></tr></thead>
  <tbody>${evRows || '<tr><td colspan="4">No events</td></tr>'}</tbody></table>
  <h2>Quiz Answers</h2>
  <table><thead><tr><th>Question</th><th>Answer</th><th>Result</th></tr></thead>
  <tbody>${qRows}</tbody></table>
  <p style="margin-top:32px;font-size:0.75rem;color:#64748b">Generated ${new Date().toLocaleString()} · AI Proctoring Monitor</p>
  <script>window.onload=()=>setTimeout(()=>window.print(),400)</script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// ── Password gate ─────────────────────────────────────────────────────────────
function PasswordGate({ onSuccess }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (value === MONITOR_PASSWORD) {
      sessionStorage.setItem('monitor_auth', '1');
      onSuccess();
    } else {
      setError(true); setShake(true); setValue('');
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div className="pw-overlay">
      <div className={`pw-card ${shake ? 'pw-shake' : ''}`}>
        <div className="pw-icon">🔒</div>
        <h2 className="pw-title">Admin Monitor</h2>
        <p className="pw-subtitle">Enter password to access the dashboard</p>
        <form onSubmit={submit} className="pw-form">
          <input type="password" className={`pw-input ${error ? 'pw-input-error' : ''}`}
            value={value} onChange={e => { setValue(e.target.value); setError(false); }}
            placeholder="Password" autoFocus />
          {error && <p className="pw-error">Incorrect password</p>}
          <button type="submit" className="btn btn-start pw-btn">Enter</button>
        </form>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortId(id) { return id.length > 18 ? '…' + id.slice(-14) : id; }

function RiskBadge({ score }) {
  const cls = score >= 80 ? 'risk-low' : score >= 50 ? 'risk-med' : 'risk-high';
  return <span className={`chip risk-chip ${cls}`}>Risk {score}</span>;
}

function QuizChip({ quiz }) {
  if (!quiz) return <span className="chip chip-unknown">— Quiz pending</span>;
  const pct = quiz.total > 0 ? Math.round(quiz.score / quiz.total * 100) : 100;
  const cls = pct === 100 ? 'chip-ok' : pct >= 60 ? 'chip-warn' : 'chip-alert';
  return <span className={`chip ${cls}`}>Quiz {quiz.score}/{quiz.total} ({pct}%)</span>;
}

function SessionCard({ session, frame, quiz, allEvents, onExport }) {
  const faceOk      = session.faceStatus === 'ok';
  const faceAlert   = session.faceStatus === 'alert';
  const faceMulti   = session.faceStatus === 'multi';
  const tabSwitched = session.tabStatus  === 'switched';
  const hasAlert    = faceAlert || faceMulti || tabSwitched;

  return (
    <div className={`session-card ${hasAlert ? 'session-card-alert' : ''}`}>
      <div className="session-thumb">
        {frame
          ? <img src={`data:image/jpeg;base64,${frame}`} alt="live feed" className="session-video-img" />
          : <div className="session-thumb-placeholder">
              {session.faceStatus === 'unknown' ? 'Waiting for camera…' : 'No feed'}
            </div>
        }
        {hasAlert && <div className="session-alert-overlay">⚠ Alert</div>}
      </div>
      <div className="session-card-info">
        <div className="session-card-name">
          {session.candidateName
            ? <><b>{session.candidateName}</b><span className="session-card-email">{session.candidateEmail}</span></>
            : shortId(session.sessionId)
          }
        </div>
        <div className="session-card-chips">
          {faceOk    && <span className="chip chip-ok">✓ Face OK</span>}
          {faceAlert && <span className="chip chip-alert">✗ No Face</span>}
          {faceMulti && <span className="chip chip-alert">⚠ Multi-Face</span>}
          {!faceOk && !faceAlert && !faceMulti && <span className="chip chip-unknown">— Scanning</span>}
          {tabSwitched
            ? <span className="chip chip-warn">⚠ Tab Away</span>
            : <span className="chip chip-ok">✓ Tab Active</span>}
          <QuizChip quiz={quiz} />
          <RiskBadge score={session.riskScore} />
        </div>
        <div className="session-card-meta">
          {session.eventCount} events · started {new Date(session.startedAt).toLocaleTimeString()}
        </div>
        <button className="export-btn" onClick={() => onExport(session, allEvents, quiz)}>
          ↓ Export Report
        </button>
      </div>
    </div>
  );
}

// ── Question editor ───────────────────────────────────────────────────────────
function QuestionEditor({ questions, onSave }) {
  const [local, setLocal] = useState(questions.map(q => ({ ...q, options: [...(q.options ?? [])] })));
  const [open,  setOpen]  = useState(false);

  useEffect(() => {
    setLocal(questions.map(q => ({ ...q, options: [...(q.options ?? [])] })));
  }, [questions]);

  const updateField = (idx, field, value) => {
    setLocal(prev => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q));
  };
  const updateOption = (qi, oi, value) => {
    setLocal(prev => prev.map((q, i) => {
      if (i !== qi) return q;
      const opts = [...q.options]; opts[oi] = value; return { ...q, options: opts };
    }));
  };
  const addOption = (qi) => {
    setLocal(prev => prev.map((q, i) => i !== qi ? q : { ...q, options: [...q.options, ''] }));
  };
  const removeQuestion = (idx) => setLocal(prev => prev.filter((_, i) => i !== idx));
  const addQuestion = () => setLocal(prev => [
    ...prev,
    { id: Date.now(), text: '', type: 'yesno', options: [], correctAnswer: 'yes' }
  ]);

  return (
    <div className="qeditor-section">
      <button className="qeditor-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▲' : '▼'} Manage Questions ({local.length})
      </button>
      {open && (
        <div className="qeditor-body">
          {local.map((q, qi) => (
            <div key={qi} className="qeditor-card">
              <div className="qeditor-row">
                <select className="qeditor-select" value={q.type}
                  onChange={e => updateField(qi, 'type', e.target.value)}>
                  <option value="yesno">Yes / No</option>
                  <option value="mcq">Multiple Choice</option>
                </select>
                <input className="qeditor-input qeditor-text" value={q.text}
                  placeholder="Question text…"
                  onChange={e => updateField(qi, 'text', e.target.value)} />
                <input className="qeditor-input qeditor-answer" value={q.correctAnswer ?? ''}
                  placeholder={q.type === 'yesno' ? 'yes / no' : 'Correct option text'}
                  onChange={e => updateField(qi, 'correctAnswer', e.target.value || null)} />
                <button className="qeditor-del" onClick={() => removeQuestion(qi)}>✕</button>
              </div>
              {q.type === 'mcq' && (
                <div className="qeditor-options">
                  {q.options.map((opt, oi) => (
                    <input key={oi} className="qeditor-input qeditor-opt"
                      value={opt} placeholder={`Option ${oi + 1}`}
                      onChange={e => updateOption(qi, oi, e.target.value)} />
                  ))}
                  {q.options.length < 4 && (
                    <button className="qeditor-add-opt" onClick={() => addOption(qi)}>+ Add option</button>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="qeditor-actions">
            <button className="btn" style={{ background: '#334155', color: '#94a3b8', fontSize: '0.85rem' }}
              onClick={addQuestion}>+ Add Question</button>
            <button className="btn btn-start" style={{ fontSize: '0.85rem' }}
              onClick={() => onSave(local)}>Save & Push to Testers</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard() {
  const connRef       = useRef(null);
  const soundEnabledRef = useRef(true);
  const [connected,   setConnected]   = useState(false);
  const [sessions,    setSessions]    = useState([]);
  const [frames,      setFrames]      = useState({});
  const [events,      setEvents]      = useState([]);
  const [quizResults, setQuizResults] = useState({});
  const [questions,   setQuestions]   = useState([]);
  const [soundOn,     setSoundOn]     = useState(true);
  const [history,     setHistory]     = useState([]);
  const [histOpen,    setHistOpen]    = useState(true);

  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect()
      .build();

    conn.on('SessionsSnapshot', (data) => setSessions(data));
    conn.on('SessionUpdated',   (session) => setSessions(prev => {
      const idx = prev.findIndex(s => s.sessionId === session.sessionId);
      if (idx >= 0) { const next = [...prev]; next[idx] = session; return next; }
      return [...prev, session];
    }));
    conn.on('EventReceived', (evt) => {
      setEvents(prev => [evt, ...prev].slice(0, 300));
      if (soundEnabledRef.current && evt.severity === 'error') playAlertBeep();
    });
    conn.on('VideoFrame',    (sid, fd) => setFrames(prev => ({ ...prev, [sid]: fd })));
    conn.on('QuizResultsSnapshot', (results) => {
      const map = {}; results.forEach(r => { map[r.sessionId] = r; });
      setQuizResults(map);
    });
    conn.on('QuizCompleted',    (r) => setQuizResults(prev => ({ ...prev, [r.sessionId]: r })));
    conn.on('QuestionsSnapshot', (q) => setQuestions(q));
    conn.onreconnected(() => { setConnected(true); conn.invoke('JoinMonitor').catch(console.error); });

    conn.start()
      .then(() => { setConnected(true); conn.invoke('JoinMonitor').catch(console.error); })
      .catch(console.error);

    connRef.current = conn;
    return () => conn.stop();
  }, []);

  // Refresh candidate history from REST endpoint (persistent data)
  const refreshHistory = useCallback(() => {
    fetch(`${API_BASE}/api/sessions`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setHistory(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshHistory();
    const id = setInterval(refreshHistory, 30_000); // refresh every 30s
    return () => clearInterval(id);
  }, [refreshHistory]);

  const saveQuestions = useCallback((qs) => {
    connRef.current?.invoke('AdminUpdateQuestions', qs).catch(console.error);
    setQuestions(qs);
  }, []);

  const toggleSound = () => {
    soundEnabledRef.current = !soundEnabledRef.current;
    setSoundOn(s => !s);
  };

  const alertCount = sessions.filter(s => s.faceStatus === 'alert' || s.faceStatus === 'multi' || s.tabStatus === 'switched').length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>Admin Monitor</h1>
          <span className={`conn-badge ${connected ? 'conn-ok' : 'conn-off'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="header-right">
          <div className="stat-pill">Sessions: <b>{sessions.length}</b></div>
          <div className="stat-pill">Alerts: <b style={{ color: alertCount > 0 ? '#f87171' : undefined }}>{alertCount}</b></div>
          <button className="btn" style={{ background: soundOn ? '#14532d' : '#334155', color: soundOn ? '#86efac' : '#94a3b8', fontSize: '0.82rem' }}
            onClick={toggleSound} title="Toggle sound alerts">
            {soundOn ? '🔔 Sound On' : '🔕 Sound Off'}
          </button>
          <a href="/api/reports/excel" download className="btn"
            style={{ textDecoration:'none', fontSize:'0.82rem', background:'#14532d', color:'#86efac', border:'1px solid #16a34a' }}>
            ⬇ Export Excel
          </a>
          <a href="/exam" className="btn btn-start" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>← Tester View</a>
        </div>
      </header>

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>

        {/* Question editor */}
        <QuestionEditor questions={questions} onSave={saveQuestions} />

        {/* Live feeds */}
        <div>
          <h2 style={{ fontSize: '1rem', color: '#f1f5f9', marginBottom: '12px' }}>
            Live Feeds <span className="badge">{sessions.length}</span>
          </h2>
          {sessions.length === 0 ? (
            <div className="camera-placeholder">No sessions yet — share the tester URL</div>
          ) : (
            <div className="session-grid">
              {sessions.map(s => (
                <SessionCard
                  key={s.sessionId}
                  session={s}
                  frame={frames[s.sessionId]}
                  quiz={quizResults[s.sessionId]}
                  allEvents={events}
                  onExport={(session, evts, quiz) => exportReport(session, evts, quiz)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Candidate history */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h2 style={{ fontSize: '1rem', color: '#f1f5f9' }}>
              Candidate History <span className="badge">{history.length}</span>
            </h2>
            <button
              onClick={() => setHistOpen(o => !o)}
              style={{ background: 'none', border: '1px solid #334155', borderRadius: 6,
                       color: '#64748b', fontSize: '0.75rem', padding: '2px 10px', cursor: 'pointer' }}
            >
              {histOpen ? 'Collapse ▲' : 'Expand ▼'}
            </button>
            <button
              onClick={refreshHistory}
              style={{ background: 'none', border: '1px solid #334155', borderRadius: 6,
                       color: '#64748b', fontSize: '0.75rem', padding: '2px 10px', cursor: 'pointer' }}
            >
              ↺ Refresh
            </button>
          </div>
          {histOpen && (
            history.length === 0 ? (
              <div className="camera-placeholder">No candidates yet — history persists across restarts</div>
            ) : (
              <div className="candidate-history-grid">
                {history.map(item => {
                  const riskCls = item.riskScore >= 80 ? 'risk-low' : item.riskScore >= 50 ? 'risk-med' : 'risk-high';
                  const quizPct = item.quizTotal > 0 ? Math.round(item.quizScore / item.quizTotal * 100) : null;
                  return (
                    <div key={item.sessionId} className="cand-card">
                      {item.snapshot
                        ? <img src={`data:image/jpeg;base64,${item.snapshot}`} alt="snapshot" className="cand-snapshot" />
                        : <div className="cand-snapshot-placeholder">No snapshot</div>
                      }
                      <div className="cand-info">
                        <span className="cand-name">{item.candidateName || '—'}</span>
                        <span className="cand-email">{item.candidateEmail || '—'}</span>
                        <span className="cand-date">{new Date(item.startedAt).toLocaleString()}</span>
                        <div className="cand-chips">
                          <span className={`chip risk-chip ${riskCls}`}>Risk {item.riskScore}</span>
                          {quizPct !== null && (
                            <span className={`chip ${quizPct >= 80 ? 'chip-ok' : quizPct >= 50 ? 'chip-warn' : 'chip-alert'}`}>
                              Quiz {quizPct}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Event feed */}
        <div>
          <h2 style={{ fontSize: '1rem', color: '#f1f5f9', marginBottom: '12px' }}>
            Live Events <span className="badge">{events.length}</span>
          </h2>
          <div className="event-log" style={{ maxHeight: '320px' }}>
            {events.length === 0 && <p className="empty">Waiting for events…</p>}
            <ul>
              {events.map(evt => (
                <li key={evt.id} className={`event-item severity-${evt.severity}`}
                    style={{ gridTemplateColumns: '70px 140px 110px 1fr' }}>
                  <span className="event-time">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>{shortId(evt.sessionId)}</span>
                  <span className="event-type">{TYPE_LABELS[evt.type] ?? evt.type}</span>
                  <span className="event-msg">{evt.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────
export default function MonitorDashboard() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('monitor_auth') === '1');
  return authed ? <Dashboard /> : <PasswordGate onSuccess={() => setAuthed(true)} />;
}
