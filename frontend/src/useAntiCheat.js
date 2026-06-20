import { useEffect } from 'react';

const BLOCKED_KEYS = new Set(['F12']);
const DEVTOOLS_COMBOS = new Set(['i','I','j','J','k','K','c','C']);

export function useAntiCheat(sessionId, reportEvent, active) {
  useEffect(() => {
    if (!active) return;

    // Block right-click
    const onContextMenu = (e) => e.preventDefault();

    // Block DevTools / inspect / print / source shortcuts
    const onKeyDown = (e) => {
      if (BLOCKED_KEYS.has(e.key)) {
        e.preventDefault();
        reportEvent(sessionId, 13, `${e.key} blocked — DevTools attempt`, 'warning');
        return;
      }
      if (e.ctrlKey && e.shiftKey && DEVTOOLS_COMBOS.has(e.key)) {
        e.preventDefault();
        reportEvent(sessionId, 13, `Ctrl+Shift+${e.key} blocked — DevTools shortcut`, 'warning');
        return;
      }
      if (e.ctrlKey && ['u','U','p','P','s','S'].includes(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        reportEvent(sessionId, 13, 'PrintScreen blocked', 'warning');
      }
    };

    // Window blur = user switched to another app
    let blurTimer;
    const onBlur  = () => { blurTimer = setTimeout(() => {
      reportEvent(sessionId, 0, 'Application focus lost — user may have switched apps', 'warning');
    }, 1500); };
    const onFocus = () => clearTimeout(blurTimer);

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown',     onKeyDown, true);
    window.addEventListener('blur',          onBlur);
    window.addEventListener('focus',         onFocus);

    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown',     onKeyDown, true);
      window.removeEventListener('blur',  onBlur);
      window.removeEventListener('focus', onFocus);
      clearTimeout(blurTimer);
    };
  }, [active, sessionId, reportEvent]);
}
