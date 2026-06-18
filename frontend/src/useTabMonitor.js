import { useEffect, useRef } from 'react';

export function useTabMonitor(sessionId, reportEvent) {
  const switchCount = useRef(0);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'hidden') {
        switchCount.current += 1;
        reportEvent(
          sessionId,
          0, // TabSwitch enum value
          `Tab switch detected (#${switchCount.current})`,
          'warning'
        );
      }
    };

    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [sessionId, reportEvent]);
}
