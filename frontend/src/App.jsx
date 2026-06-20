import { useState, useEffect, useCallback } from 'react';
import { useSignalR }          from './useSignalR';
import { useTabMonitor }       from './useTabMonitor';
import { useFullscreen }       from './useFullscreen';
import { useAntiCheat }        from './useAntiCheat';
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
  const [candidateInfo,    setCandidateInfo]    = useState(storedCandidate);
  const [monitoring,       setMonitoring]       = useState(true);
  const [examDone,         setExamDone]         = useState(false);
  const [audioLevel,       setAudioLevel]       = useState(0);
  const [terminated,       setTerminated]       = useState(false);
  const [terminateReason,  setTerminateReason]  = useState('');

  const VIOLATION_LIMIT = 5;

  const { connected, events, reportEvent, sendFrame, submitQuiz } =
    useSignalR(SESSION_ID, candidateInfo);

  const active = !!candidateInfo && monitoring;
  const { isFullscreen, exitCount, enterFullscreen } = useFullscreen(SESSION_ID, reportEvent, active);
  const { multiMonitor } = useAntiCheat(SESSION_ID, reportEvent, active);
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

  // Auto-terminate when violations exceed limit
  useEffect(() => {
    if (!monitoring || terminated) return;
    if (tabSwitches >= VIOLATION_LIMIT) {
      const reason = `Tab switched ${tabSwitches} times — limit of ${VIOLATION_LIMIT} exceeded`;
      reportEvent(SESSION_ID, 4, `Exam auto-terminated: ${reason}`, 'error');
      setTerminated(true);
      setTerminateReason(reason);
      setMonitoring(false);
    } else if (faceAlerts >= VIOLATION_LIMIT) {
      const reason = `Face not detected ${faceAlerts} times — limit of ${VIOLATION_LIMIT} exceeded`;
      reportEvent(SESSION_ID, 4, `Exam auto-terminated: ${reason}`, 'error');
      setTerminated(true);
      setTerminateReason(reason);
      setMonitoring(false);
    }
  }, [tabSwitches, faceAlerts, monitoring, terminated, reportEvent]);

  // ── Candidate registration gate ────────────────────────────────
  if (!candidateInfo) {
    return <CandidateRegistration onComplete={setCandidateInfo} />;
  }

  // ── Auto-terminated screen ─────────────────────────────────────
  if (terminated) {
    return (
      <div className="app">
        <div className="timeup-screen">
          <div className="timeup-icon">⛔</div>
          <h2 style={{ color: '#f87171' }}>Exam Terminated</h2>
          <p>Your exam has been <b>automatically stopped</b>, <b>{candidateInfo.name}</b>.</p>
          <p className="timeup-sub" style={{ color: '#fca5a5', marginTop: 6 }}>{terminateReason}</p>
          <p className="timeup-sub" style={{ marginTop: 12 }}>
            Your answers so far have been submitted to the proctor.
          </p>
        </div>
      </div>
    );
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
          <div className={`stat-pill ${tabSwitches >= VIOLATION_LIMIT - 1 ? 'stat-danger' : tabSwitches >= 3 ? 'stat-warn' : ''}`}>
            Switches: <b>{tabSwitches}</b>/{VIOLATION_LIMIT}
          </div>
          <div className={`stat-pill ${faceAlerts >= VIOLATION_LIMIT - 1 ? 'stat-danger' : faceAlerts >= 3 ? 'stat-warn' : ''}`}>
            Face off: <b>{faceAlerts}</b>/{VIOLATION_LIMIT}
          </div>
          {multiAlerts > 0 && <div className="stat-pill stat-danger">Multi-face: <b>{multiAlerts}</b></div>}
          {monitoring && !isFullscreen && (
            <button className="btn btn-start" onClick={enterFullscreen} style={{ background: '#7c2d12', borderColor: '#ea580c' }}>
              ⛶ Enter Fullscreen
            </button>
          )}
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

      {/* Dual-monitor blocking overlay */}
      {multiMonitor && (
        <div className="fs-warning-overlay">
          <div className="fs-warning-card">
            <div className="fs-warning-icon">🖥️</div>
            <h2 style={{ color: '#fbbf24' }}>External Monitor Detected</h2>
            <p>Multiple displays are not allowed during the exam.</p>
            <p className="fs-warning-sub">Please disconnect your external monitor and refresh to continue.</p>
          </div>
        </div>
      )}

      {/* Fullscreen exit warning overlay */}
      {monitoring && !isFullscreen && exitCount > 0 && (
        <div className="fs-warning-overlay">
          <div className="fs-warning-card">
            <div className="fs-warning-icon">⚠</div>
            <h2>Fullscreen Required</h2>
            <p>Exiting fullscreen has been recorded as <b>violation #{exitCount}</b>.</p>
            <p className="fs-warning-sub">The proctor has been notified.</p>
            <button className="btn btn-start" style={{ marginTop: 16 }} onClick={enterFullscreen}>
              Return to Fullscreen →
            </button>
          </div>
        </div>
      )}

      {/* Headless monitors */}
      <AudioMonitor      sessionId={SESSION_ID} reportEvent={reportEvent} active={monitoring} onLevel={setAudioLevel} />
      <InactivityMonitor sessionId={SESSION_ID} reportEvent={reportEvent} active={monitoring} />

      <main className="app-main">
        <section className="camera-section">
          <div className="camera-section-header">
            <h2>Camera Feed</h2>
            <div className="proctoring-status-bar">
              <span className={`proc-badge ${isFullscreen ? 'proc-ok' : 'proc-warn'}`}>
                {isFullscreen ? '⛶ Fullscreen' : '⚠ Not Fullscreen'}
              </span>
              {exitCount > 0 && (
                <span className="proc-badge proc-alert">↗ {exitCount} exit{exitCount > 1 ? 's' : ''}</span>
              )}
              <div className="audio-level-wrap" title="Microphone level">
                <span className="audio-level-icon">🎤</span>
                <div className="audio-level-bar">
                  <div
                    className="audio-level-fill"
                    style={{
                      width: `${Math.min(audioLevel * 500, 100)}%`,
                      background: audioLevel > 0.18 ? '#ef4444' : '#22c55e',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <p className="section-desc">
            Hello <b>{candidateInfo.name}</b> — stay in frame. Fullscreen is required.
          </p>
          {monitoring ? (
            <CameraMonitor
              sessionId={SESSION_ID}
              reportEvent={reportEvent}
              sendFrame={sendFrame}
              candidateName={candidateInfo.name}
            />
          ) : (
            <div className="camera-placeholder">Press Start Monitoring to enable camera</div>
          )}
        </section>

        <section className="log-section">
          {monitoring && (
            <QuizPanel sessionId={SESSION_ID} onSubmit={handleQuizSubmit} reportEvent={reportEvent} terminated={terminated} />
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
