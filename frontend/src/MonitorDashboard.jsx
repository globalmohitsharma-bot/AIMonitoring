import { useEffect, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';

const HUB_URL = import.meta.env.DEV
  ? 'http://localhost:5165/hub/monitoring'
  : `${window.location.origin}/hub/monitoring`;

const TYPE_LABELS = {
  0: 'Tab Switch', 1: 'Face Lost', 2: 'Face Returned',
  3: 'Session Start', 4: 'Session End', 5: 'Tab Returned',
};

function shortId(id) {
  return id.length > 18 ? '…' + id.slice(-14) : id;
}

function SessionCard({ session, frame }) {
  const faceOk = session.faceStatus === 'ok';
  const faceAlert = session.faceStatus === 'alert';
  const tabSwitched = session.tabStatus === 'switched';
  const hasAlert = faceAlert || tabSwitched;

  return (
    <div className={`session-card ${hasAlert ? 'session-card-alert' : ''}`}>
      {/* Video thumbnail */}
      <div className="session-thumb">
        {frame
          ? <img src={`data:image/jpeg;base64,${frame}`} alt="live feed" className="session-video-img" />
          : <div className="session-thumb-placeholder">
              {session.faceStatus === 'unknown' ? 'Waiting for camera…' : 'No feed'}
            </div>
        }
        {hasAlert && <div className="session-alert-overlay">⚠ Alert</div>}
      </div>

      {/* Session info */}
      <div className="session-card-info">
        <div className="session-card-id">{shortId(session.sessionId)}</div>
        <div className="session-card-chips">
          {faceOk    && <span className="chip chip-ok">✓ Face OK</span>}
          {faceAlert && <span className="chip chip-alert">✗ No Face</span>}
          {!faceOk && !faceAlert && <span className="chip chip-unknown">— Scanning</span>}

          {tabSwitched
            ? <span className="chip chip-warn">⚠ Tab Away</span>
            : <span className="chip chip-ok">✓ Tab Active</span>
          }
        </div>
        <div className="session-card-meta">
          {session.eventCount} event{session.eventCount !== 1 ? 's' : ''} · started {new Date(session.startedAt).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

export default function MonitorDashboard() {
  const connRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [frames,   setFrames]   = useState({}); // { sessionId: base64 }
  const [events,   setEvents]   = useState([]);

  useEffect(() => {
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect()
      .build();

    conn.on('SessionsSnapshot', (data) => setSessions(data));

    conn.on('SessionUpdated', (session) => {
      setSessions(prev => {
        const idx = prev.findIndex(s => s.sessionId === session.sessionId);
        if (idx >= 0) { const next = [...prev]; next[idx] = session; return next; }
        return [...prev, session];
      });
    });

    conn.on('EventReceived', (evt) => {
      setEvents(prev => [evt, ...prev].slice(0, 200));
    });

    conn.on('VideoFrame', (sessionId, frameData) => {
      setFrames(prev => ({ ...prev, [sessionId]: frameData }));
    });

    conn.onreconnected(() => {
      setConnected(true);
      conn.invoke('JoinMonitor').catch(console.error);
    });

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

        {/* Video card grid */}
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
                <SessionCard key={s.sessionId} session={s} frame={frames[s.sessionId]} />
              ))}
            </div>
          )}
        </div>

        {/* Live events feed */}
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
