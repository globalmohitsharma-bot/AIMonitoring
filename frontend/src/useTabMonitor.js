import { useEffect, useRef } from 'react';

export function useTabMonitor(sessionId, reportEvent) {
  const switchCount = useRef(0);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'hidden') {
        switchCount.current += 1;
        reportEvent(sessionId, 0, `Tab switch detected (#${switchCount.current})`, 'warning');
      } else if (document.visibilityState === 'visible' && switchCount.current > 0) {
        reportEvent(sessionId, 5, 'User returned to tab', 'info');
      }
    };

    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [sessionId, reportEvent]);
}
