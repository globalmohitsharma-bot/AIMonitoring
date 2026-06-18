import { useState, useEffect, useCallback } from 'react';
import { useSignalR } from './useSignalR';
import { useTabMonitor } from './useTabMonitor';
import { CameraMonitor } from './CameraMonitor';
import { EventLog } from './EventLog';
import { QuizPanel } from './QuizPanel';
import './App.css';

const SESSION_ID = `session-${Date.now()}`;

function AlertBanner({ events }) {
  const lastCritical = events.find(e => e.severity === 'error' || e.type === 0);
  if (!lastCritical) return null;
  return (
    <div className="alert-banner">
      {lastCritical.type === 0 ? 'Tab switch detected!' : 'Face not in frame!'}
      <span className="alert-time">{new Date(lastCritical.timestamp).toLocaleTimeString()}</span>
    </div>
  );
}

export default function App() {
  const { connected, events, reportEvent, sendFrame, submitQuiz } = useSignalR(SESSION_ID);
  const [monitoring, setMonitoring] = useState(false);

  useTabMonitor(SESSION_ID, reportEvent);

  useEffect(() => {
    if (connected && monitoring) {
      reportEvent(SESSION_ID, 3, 'Monitoring session started', 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitoring]);

  const handleQuizSubmit = useCallback((result) => {
    submitQuiz(result);
  }, [submitQuiz]);

  const tabSwitches = events.filter(e => e.type === 0).length;
  const faceAlerts  = events.filter(e => e.type === 1).length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>AI Proctoring Monitor</h1>
          <span className={`conn-badge ${connected ? 'conn-ok' : 'conn-off'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="header-right">
          <div className="stat-pill">Tab Switches: <b>{tabSwitches}</b></div>
          <div className="stat-pill">Face Alerts: <b>{faceAlerts}</b></div>
          <button
            className={`btn ${monitoring ? 'btn-stop' : 'btn-start'}`}
            onClick={() => setMonitoring(m => !m)}
          >
            {monitoring ? 'Stop' : 'Start Monitoring'}
          </button>
        </div>
      </header>

      <AlertBanner events={events} />

      <main className="app-main">
        <section className="camera-section">
          <h2>Camera Feed</h2>
          <p className="section-desc">
            Face detection runs every 1 s. Move out of frame to trigger an alert.
          </p>
          {monitoring ? (
            <CameraMonitor sessionId={SESSION_ID} reportEvent={reportEvent} sendFrame={sendFrame} />
          ) : (
            <div className="camera-placeholder">Press Start Monitoring to enable camera</div>
          )}
        </section>

        <section className="log-section">
          {monitoring && (
            <QuizPanel sessionId={SESSION_ID} onSubmit={handleQuizSubmit} />
          )}
          <EventLog events={events} />
        </section>
      </main>

      <footer className="app-footer">
        Session ID: <code>{SESSION_ID}</code>
      </footer>
    </div>
  );
}
