import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';
import { shardBase64, modelManifest } from './tinyFaceDetectorModel.js';

const DETECT_INTERVAL_MS = 1000;
const MISS_THRESHOLD     = 3;   // consecutive no-face frames before alert (~3 s)
const HIT_THRESHOLD      = 2;   // consecutive face frames before confirmed

async function loadModelSafely() {
  if (faceapi.nets.tinyFaceDetector.isLoaded) return;
  const binary = atob(shardBase64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const weightMap = faceapi.tf.io.decodeWeights(bytes.buffer, modelManifest[0].weights);
  faceapi.nets.tinyFaceDetector.loadFromWeightMap(weightMap);
  faceapi.tf.dispose(weightMap);
}

export function CameraMonitor({ sessionId, reportEvent }) {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const intervalRef = useRef(null);

  // All detection tracking in refs — never read from React state inside the loop
  const missStreak    = useRef(0);
  const hitStreak     = useRef(0);
  const faceConfirmed = useRef(false); // face seen at least once
  const alertActive   = useRef(false); // currently in "no face" alert state

  const [status,   setStatus]   = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const startCamera = useCallback(async () => {
    setStatus('loading');
    try {
      await loadModelSafely();
    } catch (err) {
      setStatus('error');
      setErrorMsg(`Model load failed: ${err.message}`);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      setStatus('error');
      setErrorMsg(
        err.name === 'NotAllowedError' ? 'Camera permission denied' :
        err.name === 'NotFoundError'   ? 'No camera found' :
        `Camera error: ${err.message}`
      );
    }
  }, []);

  // Stable detection function — NO React state in dependency array.
  // Uses only refs for tracking so the setInterval closure never goes stale.
  const runDetection = useCallback(async () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || video.readyState < 2 || !canvas) return;
    if (!faceapi.nets.tinyFaceDetector.isLoaded) return;

    let detections = [];
    try {
      detections = await faceapi.detectAllFaces(
        video,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4, inputSize: 224 })
      );
    } catch {
      return;
    }

    // Draw boxes on canvas overlay
    const size = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, faceapi.resizeResults(detections, size));

    if (detections.length > 0) {
      // ── Face present ──
      missStreak.current = 0;
      hitStreak.current += 1;

      if (!faceConfirmed.current && hitStreak.current >= HIT_THRESHOLD) {
        faceConfirmed.current = true;
        setStatus('face');
      }

      if (faceConfirmed.current) {
        setStatus('face');
        if (alertActive.current) {
          alertActive.current = false;
          reportEvent(sessionId, 2, 'Face detected again — user returned to frame', 'info');
        }
      }
    } else {
      // ── No face ──
      hitStreak.current = 0;
      missStreak.current += 1;

      if (faceConfirmed.current && !alertActive.current && missStreak.current >= MISS_THRESHOLD) {
        alertActive.current = true;
        setStatus('no-face');
        reportEvent(sessionId, 1, 'Face not detected — user may have left frame', 'error');
      }
    }
  }, [sessionId, reportEvent]); // stable — no 'status' dependency

  useEffect(() => {
    startCamera();
    return () => {
      clearInterval(intervalRef.current);
      videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
    };
  }, [startCamera]);

  const handleVideoPlay = useCallback(() => {
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(runDetection, DETECT_INTERVAL_MS);
  }, [runDetection]);

  const statusStyles = {
    loading:    { border: '3px solid #888',    label: 'Scanning for face...' },
    face:       { border: '3px solid #22c55e', label: 'Face detected' },
    'no-face':  { border: '3px solid #ef4444', label: 'No face in frame!' },
    error:      { border: '3px solid #f97316', label: errorMsg || 'Camera error' },
  };
  const s = statusStyles[status] ?? statusStyles.loading;

  return (
    <div className="camera-container">
      <div className="camera-frame" style={{ border: s.border }}>
        <video
          ref={videoRef}
          autoPlay muted playsInline
          onPlay={handleVideoPlay}
          style={{ width: '100%', borderRadius: 6 }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
      </div>
      <div className={`status-badge status-${status}`}>{s.label}</div>
    </div>
  );
}
