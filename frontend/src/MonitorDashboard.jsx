import { useEffect, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';

const HUB_URL = import.meta.env.DEV
  ? 'http://localhost:5165/hub/monitoring'
  : `${window.location.origin}/hub/monitoring`;

const TYPE_LABELS = {
  0: 'Tab Switch',
  1: 'Face Lost',
  2: 'Face Returned',
  3: 'Session Start',
  4: 'Session End',
  5: 'Tab Returned',
};

function FaceChip({ status }) {
  if (status === 'ok')      return <span className="chip chip-ok">✓ Face OK</span>;
  if (status === 'alert')   return <span className="chip chip-alert">✗ No Face</span>;
  return                           <span className="chip chip-unknown">— Not started</span>;
}

function TabChip({ status }) {
  if (status === 'switched') return <span className="chip chip-warn">⚠ Switched</span>;
  return                            <span className="chip chip-ok">✓ Active</span>;
}

function shortId(id) {
  return id.length > 20 ? '…' + id.slice(-16) : id;
}

export default function MonitorDashboard() {
  const connRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState([]);
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

  const alertSessions = sessions.filter(s => s.faceStatus === 'alert' || s.tabStatus === 'switched').length;

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
          <div className="stat-pill">Alerts: <b style={{ color: alertSessions > 0 ? '#f87171' : undefined }}>{alertSessions}</b></div>
          <a href="/" className="btn btn-start" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>
            ← Tester View
          </a>
        </div>
      </header>

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>

        {/* Sessions table */}
        <div>
          <h2 style={{ fontSize: '1rem', color: '#f1f5f9', marginBottom: '12px' }}>
            Active Sessions <span className="badge">{sessions.length}</span>
          </h2>

          {sessions.length === 0 ? (
            <div className="camera-placeholder">
              No sessions yet — share the tester URL and ask testers to click Start Monitoring
            </div>
          ) : (
            <div className="monitor-table-wrap">
              <table className="monitor-table">
                <thead>
                  <tr>
                    <th>Session ID</th>
                    <th>Started</th>
                    <th>Last Seen</th>
                    <th>Face</th>
                    <th>Tab</th>
                    <th>Events</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.sessionId} className={s.faceStatus === 'alert' || s.tabStatus === 'switched' ? 'row-alert' : ''}>
                      <td className="session-id-cell">{shortId(s.sessionId)}</td>
                      <td>{new Date(s.startedAt).toLocaleTimeString()}</td>
                      <td>{new Date(s.lastSeen).toLocaleTimeString()}</td>
                      <td><FaceChip status={s.faceStatus} /></td>
                      <td><TabChip  status={s.tabStatus} /></td>
                      <td style={{ textAlign: 'center' }}>{s.eventCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Live events feed */}
        <div>
          <h2 style={{ fontSize: '1rem', color: '#f1f5f9', marginBottom: '12px' }}>
            Live Events Feed <span className="badge">{events.length}</span>
          </h2>
          <div className="event-log" style={{ maxHeight: '380px' }}>
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
