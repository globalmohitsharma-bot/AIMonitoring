import { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';
import { shardBase64, modelManifest } from './tinyFaceDetectorModel.js';

const DETECT_MS  = 1000;
const FRAME_MS   = 2000;
const MISS_LIMIT = 3;
const HIT_LIMIT  = 2;
const MULTI_LIMIT = 2;

// Module-level flags so model only loads once across remounts
let _modelLoaded  = false;
let _modelPending = false;

function loadModel() {
  if (_modelLoaded || faceapi.nets.tinyFaceDetector.isLoaded) { _modelLoaded = true; return Promise.resolve(); }
  if (_modelPending) return Promise.resolve();
  _modelPending = true;
  return new Promise((resolve) => {
    setTimeout(() => { // defer heavy decode off the main render tick
      try {
        const binary = atob(shardBase64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const wm = faceapi.tf.io.decodeWeights(bytes.buffer, modelManifest[0].weights);
        faceapi.nets.tinyFaceDetector.loadFromWeightMap(wm);
        _modelLoaded = true;
      } catch (e) {
        console.warn('Face model load failed:', e.message);
      } finally {
        _modelPending = false;
        resolve();
      }
    }, 100);
  });
}

export function CameraMonitor({ sessionId, reportEvent, sendFrame, candidateName }) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const detectRef   = useRef(null);
  const frameRef    = useRef(null);
  const streamRef   = useRef(null);

  // Detection state (all refs — never cause re-renders in the loop)
  const miss        = useRef(0);
  const hit         = useRef(0);
  const confirmed   = useRef(false);
  const alertOn     = useRef(false);
  const multiStreak = useRef(0);
  const multiOn     = useRef(false);

  const [phase,    setPhase]    = useState('idle'); // idle|requesting|active|denied|error
  const [errMsg,   setErrMsg]   = useState('');
  const [faceMsg,  setFaceMsg]  = useState('Scanning for face…');
  const [border,   setBorder]   = useState('#64748b');

  // ── Camera stream ────────────────────────────────────────────────────────
  const requestCamera = async () => {
    setPhase('requesting');
    setErrMsg('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('error');
      setErrMsg('Camera API not available in this browser. Please use Chrome or Edge on HTTPS.');
      return;
    }

    let stream;
    try {
      // Simple constraint — most reliable cross-browser
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPhase('denied');
        setErrMsg('Camera access was denied. Click the camera icon in your browser address bar and select "Allow", then refresh.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setPhase('error');
        setErrMsg('No camera found. Please connect a webcam and try again.');
      } else {
        setPhase('error');
        setErrMsg(`Camera error: ${err.message}`);
      }
      return;
    }

    streamRef.current = stream;

    const video = videoRef.current;
    if (!video) { stream.getTracks().forEach(t => t.stop()); return; }

    video.srcObject = stream;
    setPhase('active');
    setFaceMsg('Scanning for face…');
    setBorder('#3b82f6');

    try { await video.play(); } catch { /* autoPlay attribute handles this */ }

    // Load face model after camera is running (non-blocking)
    loadModel().then(() => {
      startDetection(video);
    });
  };

  // ── Face detection loop ──────────────────────────────────────────────────
  const startDetection = (video) => {
    clearInterval(detectRef.current);
    clearInterval(frameRef.current);

    detectRef.current = setInterval(async () => {
      if (!video || video.readyState < 2) return;
      if (!faceapi.nets.tinyFaceDetector.isLoaded)  return;

      let detections = [];
      try {
        detections = await faceapi.detectAllFaces(
          video,
          new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4, inputSize: 224 })
        );
      } catch { return; }

      const canvas = canvasRef.current;
      if (canvas) {
        const size = { width: video.videoWidth || 640, height: video.videoHeight || 480 };
        faceapi.matchDimensions(canvas, size);
        const ctx2d = canvasRef.current.getContext('2d');
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        faceapi.draw.drawDetections(canvas, faceapi.resizeResults(detections, size));
        // Watermark: candidate name + timestamp
        const name = candidateName || '';
        const ts   = new Date().toLocaleTimeString();
        ctx2d.font = '13px monospace';
        ctx2d.fillStyle = 'rgba(0,0,0,0.55)';
        ctx2d.fillRect(0, size.height - 22, size.width, 22);
        ctx2d.fillStyle = '#fbbf24';
        ctx2d.fillText(`${name}  •  ${ts}`, 8, size.height - 6);
      }

      if (detections.length > 0) {
        miss.current = 0;
        hit.current += 1;
        if (!confirmed.current && hit.current >= HIT_LIMIT) confirmed.current = true;

        if (confirmed.current) {
          setFaceMsg('Face detected ✓');
          setBorder('#22c55e');
          if (alertOn.current) {
            alertOn.current = false;
            reportEvent(sessionId, 2, 'Face detected again — user returned to frame', 'info');
          }
        }

        if (detections.length > 1) {
          multiStreak.current += 1;
          if (multiStreak.current >= MULTI_LIMIT && !multiOn.current) {
            multiOn.current = true;
            setFaceMsg('Multiple faces detected!');
            setBorder('#f59e0b');
            reportEvent(sessionId, 7, `Multiple faces detected (${detections.length})`, 'error');
          }
        } else {
          if (multiOn.current) { multiOn.current = false; }
          multiStreak.current = 0;
        }
      } else {
        hit.current = 0;
        miss.current += 1;
        if (confirmed.current && !alertOn.current && miss.current >= MISS_LIMIT) {
          alertOn.current = true;
          setFaceMsg('No face in frame!');
          setBorder('#ef4444');
          reportEvent(sessionId, 1, 'Face not detected — user may have left frame', 'error');
        }
      }
    }, DETECT_MS);

    if (sendFrame) {
      frameRef.current = setInterval(() => {
        if (!video || video.readyState < 2) return;
        const w = 320, h = Math.round(w * (video.videoHeight || 240) / (video.videoWidth || 320));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(video, 0, 0, w, h);
        sendFrame(sessionId, c.toDataURL('image/jpeg', 0.4).split(',')[1]);
      }, FRAME_MS);
    }
  };

  // ── Mount / unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    requestCamera();
    return () => {
      clearInterval(detectRef.current);
      clearInterval(frameRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="camera-container">
      <div className="camera-frame" style={{ border: `3px solid ${border}` }}>

        {/* Video always in DOM so ref is valid before stream is ready */}
        <video
          ref={videoRef}
          autoPlay muted playsInline
          style={{ width: '100%', minHeight: 320, display: 'block', borderRadius: 6, background: '#0f172a' }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />

        {/* Overlay for non-active states */}
        {phase !== 'active' && (
          <div className="camera-overlay">
            {phase === 'idle' || phase === 'requesting' ? (
              <div className="camera-overlay-msg">
                <div className="camera-spinner" />
                <span>{phase === 'requesting' ? 'Requesting camera…' : 'Initialising…'}</span>
              </div>
            ) : (
              <div className="camera-overlay-msg camera-overlay-err">
                <span className="cam-err-icon">📷</span>
                <p>{errMsg}</p>
                <button className="btn" style={{ marginTop: 10, fontSize: '0.82rem' }} onClick={requestCamera}>
                  Retry Camera
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="cam-status-bar" style={{ background: phase === 'active' ? undefined : '#1e293b' }}>
        {phase === 'active' ? (
          <span style={{ color: border }}>{faceMsg}</span>
        ) : phase === 'denied' ? (
          <span style={{ color: '#f87171' }}>⛔ Camera blocked</span>
        ) : phase === 'error' ? (
          <span style={{ color: '#f97316' }}>⚠ Camera error</span>
        ) : (
          <span style={{ color: '#94a3b8' }}>Starting camera…</span>
        )}
      </div>
    </div>
  );
}
