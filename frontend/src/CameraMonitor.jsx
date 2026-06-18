import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';
import { shardBase64, modelManifest } from './tinyFaceDetectorModel.js';

const DETECT_INTERVAL_MS = 1000; // check every second
const MISS_THRESHOLD     = 3;    // alert after 3 consecutive no-face frames (~3 s)
const HIT_THRESHOLD      = 2;    // confirm face after 2 consecutive face frames

async function loadModelSafely() {
  if (faceapi.nets.tinyFaceDetector.isLoaded) return;
  const binary = atob(shardBase64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const weightMap = faceapi.tf.io.decodeWeights(bytes.buffer, modelManifest[0].weights);
  faceapi.nets.tinyFaceDetector.loadFromWeightMap(weightMap);
  faceapi.tf.dispose(weightMap);
  if (!faceapi.nets.tinyFaceDetector.isLoaded) {
    throw new Error('Model params not set after loadFromWeightMap');
  }
}

export function CameraMonitor({ sessionId, reportEvent }) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const intervalRef = useRef(null);

  // Debounce counters — prevents single-frame glitches from triggering alerts
  const missStreak     = useRef(0);   // consecutive frames with no face
  const hitStreak      = useRef(0);   // consecutive frames with face
  const faceConfirmed  = useRef(false); // true once face has been seen at least once

  const [status,   setStatus]   = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const startCamera = useCallback(async () => {
    try {
      setStatus('loading');
      await loadModelSafely();
    } catch (err) {
      setStatus('error');
      setErrorMsg(`Model load failed: ${err.message}`);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      setStatus('error');
      setErrorMsg(
        err.name === 'NotAllowedError' ? 'Camera permission denied — please allow access' :
        err.name === 'NotFoundError'   ? 'No camera found on this device' :
        `Camera error: ${err.message}`
      );
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
    };
  }, [startCamera]);

  const runDetection = useCallback(async () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || video.readyState < 2 || !canvas) return;
    if (!faceapi.nets.tinyFaceDetector.isLoaded) return;

    let detections;
    try {
      detections = await faceapi.detectAllFaces(
        video,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5, inputSize: 224 })
      );
    } catch {
      return; // skip this frame on error
    }

    // Draw bounding boxes
    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, displaySize);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, faceapi.resizeResults(detections, displaySize));

    const faceNow = detections.length > 0;

    if (faceNow) {
      missStreak.current = 0;
      hitStreak.current += 1;

      if (!faceConfirmed.current && hitStreak.current >= HIT_THRESHOLD) {
        // First confirmed face — establish baseline
        faceConfirmed.current = true;
        setStatus('face');
      } else if (faceConfirmed.current) {
        setStatus('face');
        // If we were in no-face state and face returned
        if (status === 'no-face') {
          reportEvent(sessionId, 2, 'Face detected again — user returned to frame', 'info');
        }
      }
    } else {
      hitStreak.current = 0;
      missStreak.current += 1;

      if (faceConfirmed.current && missStreak.current >= MISS_THRESHOLD) {
        setStatus('no-face');
        if (missStreak.current === MISS_THRESHOLD) {
          // Fire exactly once per absence event
          reportEvent(sessionId, 1, 'Face not detected — user may have left frame', 'error');
        }
      }
    }
  }, [sessionId, reportEvent, status]);

  const handleVideoPlay = () => {
    // Don't set status to 'face' yet — wait for confirmed detection
    setStatus('loading');
    intervalRef.current = setInterval(runDetection, DETECT_INTERVAL_MS);
  };

  const statusStyles = {
    'loading': { border: '3px solid #888',    label: 'Scanning for face...' },
    'face':    { border: '3px solid #22c55e', label: 'Face detected' },
    'no-face': { border: '3px solid #ef4444', label: 'No face in frame!' },
    'error':   { border: '3px solid #f97316', label: errorMsg || 'Camera error' },
  };
  const s = statusStyles[status] ?? statusStyles['loading'];

  return (
    <div className="camera-container">
      <div className="camera-frame" style={{ border: s.border }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
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
