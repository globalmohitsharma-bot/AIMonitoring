import { useState, useEffect, useCallback } from 'react';
import { useSignalR }          from './useSignalR';
import { useTabMonitor }       from './useTabMonitor';
import { CameraMonitor }       from './CameraMonitor';
import { EventLog }            from './EventLog';
import { QuizPanel }           from './QuizPanel';
import { AudioMonitor }        from './AudioMonitor';
import { InactivityMonitor }   from './InactivityMonitor';
import { ExamTimer }           from './ExamTimer';
import CandidateRegistration   from './CandidateRegistration';
import './App.css';

const SESSION_ID = `session-${Date.now()}`;

// Read stored data from sessionStorage (set by JobLanding before redirect)
const storedMatch     = (() => { try { return JSON.parse(sessionStorage.getItem('resumeMatch')     || 'null'); } catch { return null; } })();
const storedCandidate = (() => { try { return JSON.parse(sessionStorage.getItem('candidateInfo') || 'null'); } catch { return null; } })();

function ResumeBanner({ match }) {
  if (!match) return null;
  const color = match.score >= 70 ? '#22c55e' : '#f59e0b';
  return (
    <div className="resume-banner">
      <span>Resume match: <b style={{ color }}>{match.score}%</b></span>
      <span className="resume-banner-skills">Matched: {match.matched.join(', ')}</span>
    </div>
  );
}

function AlertBanner({ events }) {
  const lastCritical = events.find(e => e.severity === 'error' || e.type === 0);
  if (!lastCritical) return null;
  const msgs = {
    0: 'Tab switch detected!',
    1: 'Face not in frame!',
    7: 'Multiple faces detected!',
    8: 'Audio alert triggered!',
    9: 'Inactivity detected!',
  };
  return (
    <div className="alert-banner">
      {msgs[lastCritical.type] ?? 'Alert!'}
      <span className="alert-time">{new Date(lastCritical.timestamp).toLocaleTimeString()}</span>
    </div>
  );
}

export default function App() {
  const [candidateInfo, setCandidateInfo] = useState(storedCandidate);
  const [monitoring,    setMonitoring]    = useState(true);  // auto-start
  const [examDone,      setExamDone]      = useState(false);

  const { connected, events, reportEvent, sendFrame, submitQuiz } =
    useSignalR(SESSION_ID, candidateInfo);

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

  const handleTimerExpire = useCallback(() => {
    reportEvent(SESSION_ID, 10, 'Exam time expired — session auto-ended', 'error');
    setExamDone(true);
    setMonitoring(false);
  }, [reportEvent]);

  const tabSwitches  = events.filter(e => e.type === 0).length;
  const faceAlerts   = events.filter(e => e.type === 1).length;
  const multiAlerts  = events.filter(e => e.type === 7).length;

  // ── Candidate registration gate ────────────────────────────────
  if (!candidateInfo) {
    return <CandidateRegistration onComplete={setCandidateInfo} />;
  }

  // ── Time-up screen ─────────────────────────────────────────────
  if (examDone) {
    return (
      <div className="app">
        <div className="timeup-screen">
          <div className="timeup-icon">⏰</div>
          <h2>Time's Up!</h2>
          <p>Your exam session has ended. Thank you, <b>{candidateInfo.name}</b>.</p>
          <p className="timeup-sub">Results have been submitted to the proctor.</p>
        </div>
      </div>
    );
  }

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
          {monitoring && <ExamTimer durationMinutes={30} onExpire={handleTimerExpire} active={monitoring} />}
          <div className="stat-pill">Switches: <b>{tabSwitches}</b></div>
          <div className="stat-pill">Face: <b>{faceAlerts}</b></div>
          {multiAlerts > 0 && <div className="stat-pill stat-danger">Multi-face: <b>{multiAlerts}</b></div>}
          <button
            className={`btn ${monitoring ? 'btn-stop' : 'btn-start'}`}
            onClick={() => setMonitoring(m => !m)}
          >
            {monitoring ? 'Stop' : 'Start Monitoring'}
          </button>
        </div>
      </header>

      <ResumeBanner match={storedMatch} />
      <AlertBanner events={events} />

      {/* Headless monitors */}
      <AudioMonitor      sessionId={SESSION_ID} reportEvent={reportEvent} active={monitoring} />
      <InactivityMonitor sessionId={SESSION_ID} reportEvent={reportEvent} active={monitoring} />

      <main className="app-main">
        <section className="camera-section">
          <h2>Camera Feed</h2>
          <p className="section-desc">
            Hello <b>{candidateInfo.name}</b> — face detection runs every second. Stay in frame.
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
        Session: <code>{SESSION_ID}</code> · Candidate: <code>{candidateInfo.email}</code>
      </footer>
    </div>
  );
}
