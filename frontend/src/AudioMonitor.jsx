import { useEffect, useRef } from 'react';

const VOLUME_THRESHOLD  = 0.18; // 0–1 normalised RMS — above this = talking
const SUSTAINED_MS      = 3000; // must be loud for 3s to trigger
const COOLDOWN_MS       = 30000; // don't re-alert within 30s

export function AudioMonitor({ sessionId, reportEvent, active }) {
  const audioCtxRef  = useRef(null);
  const streamRef    = useRef(null);
  const loudSinceRef = useRef(null);
  const lastAlertRef = useRef(0);
  const rafRef       = useRef(null);

  useEffect(() => {
    if (!active) return;

    let analyser, dataArray;

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        streamRef.current = stream;
        const ctx     = new AudioContext();
        audioCtxRef.current = ctx;
        const source  = ctx.createMediaStreamSource(stream);
        analyser      = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        const check = () => {
          if (!analyser) return;
          analyser.getByteTimeDomainData(dataArray);

          // RMS volume
          const rms = Math.sqrt(dataArray.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / dataArray.length);

          const now = Date.now();
          if (rms > VOLUME_THRESHOLD) {
            if (!loudSinceRef.current) loudSinceRef.current = now;
            const duration = now - loudSinceRef.current;
            if (duration >= SUSTAINED_MS && now - lastAlertRef.current > COOLDOWN_MS) {
              lastAlertRef.current = now;
              loudSinceRef.current = null;
              reportEvent(sessionId, 8, 'Sustained audio detected — possible talking or noise', 'warning');
            }
          } else {
            loudSinceRef.current = null;
          }

          rafRef.current = requestAnimationFrame(check);
        };
        check();
      })
      .catch(() => {}); // mic permission denied — silently skip

    return () => {
      cancelAnimationFrame(rafRef.current);
      audioCtxRef.current?.close();
      streamRef.current?.getTracks().forEach(t => t.stop());
      analyser = null;
    };
  }, [active, sessionId, reportEvent]);

  return null; // headless — no UI
}
