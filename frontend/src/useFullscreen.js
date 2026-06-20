import { useEffect, useRef, useCallback, useState } from 'react';

export function useFullscreen(sessionId, reportEvent, active) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exitCount,    setExitCount]    = useState(0);
  const exitCountRef = useRef(0);
  const wasFullRef   = useRef(false);

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    try {
      if      (el.requestFullscreen)            el.requestFullscreen();
      else if (el.webkitRequestFullscreen)      el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen)         el.mozRequestFullScreen();
    } catch {}
  }, []);

  useEffect(() => {
    if (!active) return;
    // 80ms is within the browser's user-activation lifetime from the registration submit click
    const t = setTimeout(enterFullscreen, 80);

    const onChange = () => {
      const full = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(full);
      if (!full && wasFullRef.current) {
        exitCountRef.current += 1;
        setExitCount(exitCountRef.current);
        reportEvent(sessionId, 11,
          `Fullscreen exited — violation #${exitCountRef.current}`, 'error');
      }
      wasFullRef.current = full;
    };

    document.addEventListener('fullscreenchange',       onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      clearTimeout(t);
      document.removeEventListener('fullscreenchange',       onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [active, sessionId, reportEvent, enterFullscreen]);

  return { isFullscreen, exitCount, enterFullscreen };
}
