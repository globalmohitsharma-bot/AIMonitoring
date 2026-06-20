import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';
import { shardBase64, modelManifest } from './tinyFaceDetectorModel.js';

const DETECT_INTERVAL_MS = 1000;
const MISS_THRESHOLD     = 3;
const HIT_THRESHOLD      = 2;
const MULTI_THRESHOLD    = 2;
const FRAME_INTERVAL_MS  = 2000;

let modelLoading = false;
let modelLoaded  = false;

async function loadModelSafely() {
  if (modelLoaded || faceapi.nets.tinyFaceDetector.isLoaded) { modelLoaded = true; return; }
  if (modelLoading) return;
  modelLoading = true;
  try {
    const binary  = atob(shardBase64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const weightMap = faceapi.tf.io.decodeWeights(bytes.buffer, modelManifest[0].weights);
    faceapi.nets.tinyFaceDetector.loadFromWeightMap(weightMap);
    modelLoaded = true;
  } finally {
    modelLoading = false;
  }
}

export function CameraMonitor({ sessionId, reportEvent, sendFrame }) {
  const videoRef         = useRef(null);
  const canvasRef        = useRef(null);
  const intervalRef      = useRef(null);
  const frameIntervalRef = useRef(null);
  const missStreak       = useRef(0);
  const hitStreak        = useRef(0);
  const faceConfirmed    = useRef(false);
  const alertActive      = useRef(false);
  const multiStreak      = useRef(0);
  const multiAlertActive = useRef(false);

  const [status,   setStatus]   = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const runDetection = useCallback(async () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || video.readyState < 2 || !canvas) return;
    if (!faceapi.nets.tinyFaceDetector.isLoaded)  return;

    let detections = [];
    try {
      detections = await faceapi.detectAllFaces(
        video,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4, inputSize: 224 })
      );
    } catch { return; }

    const size = { width: video.videoWidth || 640, height: video.videoHeight || 480 };
    faceapi.matchDimensions(canvas, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, faceapi.resizeResults(detections, size));

    if (detections.length > 0) {
      missStreak.current = 0;
      hitStreak.current += 1;

      if (!faceConfirmed.current && hitStreak.current >= HIT_THRESHOLD) {
        faceConfirmed.current = true;
      }
      if (faceConfirmed.current) {
        setStatus('face');
        if (alertActive.current) {
          alertActive.current = false;
          reportEvent(sessionId, 2, 'Face detected again — user returned to frame', 'info');
        }
      }

      if (detections.length > 1) {
        multiStreak.current += 1;
        if (multiStreak.current >= MULTI_THRESHOLD && !multiAlertActive.current) {
          multiAlertActive.current = true;
          reportEvent(sessionId, 7, `Multiple faces detected (${detections.length})`, 'error');
          setStatus('multi-face');
        }
      } else {
        multiStreak.current = 0;
        multiAlertActive.current = false;
      }
    } else {
      hitStreak.current = 0;
      missStreak.current += 1;

      if (faceConfirmed.current && !alertActive.current && missStreak.current >= MISS_THRESHOLD) {
        alertActive.current = true;
        setStatus('no-face');
        reportEvent(sessionId, 1, 'Face not detected — user may have left frame', 'error');
      }
    }
  }, [sessionId, reportEvent]);

  const startDetectionLoop = useCallback(() => {
    clearInterval(intervalRef.current);
    clearInterval(frameIntervalRef.current);

    intervalRef.current = setInterval(runDetection, DETECT_INTERVAL_MS);

    if (sendFrame) {
      frameIntervalRef.current = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        const w = 320;
        const h = Math.round(w * (video.videoHeight || 240) / (video.videoWidth || 320));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(video, 0, 0, w, h);
        sendFrame(sessionId, c.toDataURL('image/jpeg', 0.4).split(',')[1]);
      }, FRAME_INTERVAL_MS);
    }
  }, [runDetection, sessionId, sendFrame]);

  const startCamera = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');

    // ── Step 1: get camera stream immediately (don't wait for model) ──
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch {
      // fallback: try without constraints
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (err) {
        setStatus('error');
        setErrorMsg(
          err.name === 'NotAllowedError'
            ? 'Camera permission denied — click the camera icon in the address bar to allow'
            : err.name === 'NotFoundError'
            ? 'No camera found on this device'
            : `Camera unavailable: ${err.message}`
        );
        return;
      }
    }

    // ── Step 2: attach stream & play immediately ──────────────────────
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      setStatus('scanning');
      try { await videoRef.current.play(); } catch { /* autoPlay attr covers this */ }
    }

    // ── Step 3: load face model concurrently ──────────────────────────
    loadModelSafely().catch(err => console.warn('Face model load failed:', err.message));
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      clearInterval(intervalRef.current);
      clearInterval(frameIntervalRef.current);
      videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
    };
  }, [startCamera]);

  // onPlay fires when video actually starts rendering frames
  const handleVideoPlay = useCallback(() => {
    setStatus(s => (s === 'loading' ? 'scanning' : s));
    startDetectionLoop();
  }, [startDetectionLoop]);

  const statusStyles = {
    loading:      { border: '3px solid #64748b', label: 'Starting camera…' },
    scanning:     { border: '3px solid #3b82f6', label: 'Scanning for face…' },
    face:         { border: '3px solid #22c55e', label: 'Face detected ✓' },
    'no-face':    { border: '3px solid #ef4444', label: 'No face in frame!' },
    'multi-face': { border: '3px solid #f59e0b', label: 'Multiple faces detected!' },
    error:        { border: '3px solid #f97316', label: errorMsg || 'Camera error' },
  };
  const s = statusStyles[status] ?? statusStyles.scanning;

  return (
    <div className="camera-container">
      <div className="camera-frame" style={{ border: s.border }}>
        <video
          ref={videoRef}
          autoPlay muted playsInline
          onPlay={handleVideoPlay}
          onLoadedData={handleVideoPlay}
          style={{ width: '100%', borderRadius: 6, display: 'block' }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
        {status === 'error' && (
          <div className="camera-error-overlay">
            <span>📷</span>
            <p>{errorMsg}</p>
            <button className="btn" style={{ marginTop: 8, fontSize: '0.8rem' }} onClick={startCamera}>
              Retry
            </button>
          </div>
        )}
      </div>
      <div className={`status-badge status-${status}`}>{s.label}</div>
    </div>
  );
}
