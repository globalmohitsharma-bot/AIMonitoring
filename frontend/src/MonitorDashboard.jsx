import { useEffect, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';

const HUB_URL = import.meta.env.DEV
  ? 'http://localhost:5165/hub/monitoring'
  : `${window.location.origin}/hub/monitoring`;

const TYPE_LABELS = {
  0: 'Tab Switch', 1: 'Face Lost', 2: 'Face Returned',
  3: 'Session Start', 4: 'Session End', 5: 'Tab Returned', 6: 'Quiz Completed',
};

const MONITOR_PASSWORD = 'Qazwsx';

// ── Password gate ─────────────────────────────────────────────
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
      setError(true);
      setShake(true);
      setValue('');
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
          <input
            type="password"
            className={`pw-input ${error ? 'pw-input-error' : ''}`}
            value={value}
            onChange={e => { setValue(e.target.value); setError(false); }}
            placeholder="Password"
            autoFocus
          />
          {error && <p className="pw-error">Incorrect password — try again</p>}
          <button type="submit" className="btn btn-start pw-btn">Enter</button>
        </form>
      </div>
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────
function shortId(id) {
  return id.length > 18 ? '…' + id.slice(-14) : id;
}

function QuizChip({ quiz }) {
  if (!quiz) return <span className="chip chip-unknown">— Quiz pending</span>;
  const pct = quiz.total > 0 ? Math.round(quiz.score / quiz.total * 100) : 100;
  const cls = pct === 100 ? 'chip-ok' : pct >= 60 ? 'chip-warn' : 'chip-alert';
  return <span className={`chip ${cls}`}>Quiz {quiz.score}/{quiz.total} ({pct}%)</span>;
}

function SessionCard({ session, frame, quiz }) {
  const faceOk      = session.faceStatus === 'ok';
  const faceAlert   = session.faceStatus === 'alert';
  const tabSwitched = session.tabStatus  === 'switched';
  const hasAlert    = faceAlert || tabSwitched;

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
        <div className="session-card-id">{shortId(session.sessionId)}</div>
        <div className="session-card-chips">
          {faceOk    && <span className="chip chip-ok">✓ Face OK</span>}
          {faceAlert && <span className="chip chip-alert">✗ No Face</span>}
          {!faceOk && !faceAlert && <span className="chip chip-unknown">— Scanning</span>}
          {tabSwitched
            ? <span className="chip chip-warn">⚠ Tab Away</span>
            : <span className="chip chip-ok">✓ Tab Active</span>}
          <QuizChip quiz={quiz} />
        </div>
        <div className="session-card-meta">
          {session.eventCount} event{session.eventCount !== 1 ? 's' : ''} · started {new Date(session.startedAt).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

// ── Main dashboard (only mounts after auth) ───────────────────
function Dashboard() {
  const connRef = useRef(null);
  const [connected,   setConnected]   = useState(false);
  const [sessions,    setSessions]    = useState([]);
  const [frames,      setFrames]      = useState({});
  const [events,      setEvents]      = useState([]);
  const [quizResults, setQuizResults] = useState({});

  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect()
      .build();

    conn.on('SessionsSnapshot', (data) => setSessions(data));
    conn.on('SessionUpdated',   (session) => {
      setSessions(prev => {
        const idx = prev.findIndex(s => s.sessionId === session.sessionId);
        if (idx >= 0) { const next = [...prev]; next[idx] = session; return next; }
        return [...prev, session];
      });
    });
    conn.on('EventReceived', (evt) => setEvents(prev => [evt, ...prev].slice(0, 200)));
    conn.on('VideoFrame',    (sessionId, frameData) => setFrames(prev => ({ ...prev, [sessionId]: frameData })));
    conn.on('QuizResultsSnapshot', (results) => {
      const map = {};
      results.forEach(r => { map[r.sessionId] = r; });
      setQuizResults(map);
    });
    conn.on('QuizCompleted', (result) => setQuizResults(prev => ({ ...prev, [result.sessionId]: result })));
    conn.onreconnected(() => { setConnected(true); conn.invoke('JoinMonitor').catch(console.error); });

    conn.start()
      .then(() => { setConnected(true); conn.invoke('JoinMonitor').catch(console.error); })
      .catch(console.error);

    connRef.current = conn;
    return () => conn.stop();
  }, []);

  const alertCount = sessions.filter(s => s.faceStatus === 'alert' || s.tabStatus === 'switched').length;

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
          <div className="stat-pill">
            Alerts: <b style={{ color: alertCount > 0 ? '#f87171' : undefined }}>{alertCount}</b>
          </div>
          <a href="/" className="btn btn-start" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>
            ← Tester View
          </a>
        </div>
      </header>

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
        <div>
          <h2 style={{ fontSize: '1rem', color: '#f1f5f9', marginBottom: '12px' }}>
            Live Feeds <span className="badge">{sessions.length}</span>
          </h2>
          {sessions.length === 0 ? (
            <div className="camera-placeholder">
              No sessions yet — share the tester URL and ask testers to click Start Monitoring
            </div>
          ) : (
            <div className="session-grid">
              {sessions.map(s => (
                <SessionCard key={s.sessionId} session={s} frame={frames[s.sessionId]} quiz={quizResults[s.sessionId]} />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 style={{ fontSize: '1rem', color: '#f1f5f9', marginBottom: '12px' }}>
            Live Events Feed <span className="badge">{events.length}</span>
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

// ── Entry point — auth check before mounting Dashboard ────────
export default function MonitorDashboard() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('monitor_auth') === '1');
  return authed ? <Dashboard /> : <PasswordGate onSuccess={() => setAuthed(true)} />;
}
