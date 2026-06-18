import { useEffect, useRef } from 'react';

const INACTIVITY_MS = 60_000; // 60 s of no mouse/keyboard
const COOLDOWN_MS   = 90_000; // only re-alert every 90 s

export function InactivityMonitor({ sessionId, reportEvent, active }) {
  const timerRef     = useRef(null);
  const lastAlertRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const reset = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const now = Date.now();
        if (now - lastAlertRef.current > COOLDOWN_MS) {
          lastAlertRef.current = now;
          reportEvent(sessionId, 9, 'No mouse or keyboard activity for 60 s — candidate may be idle', 'warning');
        }
        // keep watching after alert
        reset();
      }, INACTIVITY_MS);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    reset(); // start the initial timer

    return () => {
      clearTimeout(timerRef.current);
      events.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [active, sessionId, reportEvent]);

  return null; // headless
}
