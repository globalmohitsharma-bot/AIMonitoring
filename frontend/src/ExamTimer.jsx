import { useState, useEffect, useRef } from 'react';

const WARN_AT_SECONDS = 300; // show warning colour at 5 min remaining

export function ExamTimer({ durationMinutes = 30, onExpire, active }) {
  const totalSecs  = durationMinutes * 60;
  const [secs, setSecs] = useState(totalSecs);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    setSecs(totalSecs);
    intervalRef.current = setInterval(() => {
      setSecs(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          onExpire?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [active, totalSecs, onExpire]);

  if (!active) return null;

  const mins    = Math.floor(secs / 60);
  const s       = String(secs % 60).padStart(2, '0');
  const warn    = secs <= WARN_AT_SECONDS;
  const critical = secs <= 60;
  const color   = critical ? '#ef4444' : warn ? '#f59e0b' : '#22c55e';

  return (
    <div className="exam-timer" style={{ color }}>
      <span className="timer-icon">⏱</span>
      <span className="timer-value">{mins}:{s}</span>
      {warn && <span className="timer-warn">{critical ? 'Almost done!' : '5 min left'}</span>}
    </div>
  );
}
