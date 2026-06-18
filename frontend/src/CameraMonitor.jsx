import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';

const DETECT_INTERVAL_MS = 1500;
const MODEL_URL = '/models';

export function CameraMonitor({ sessionId, reportEvent }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const faceWasPresent = useRef(true);
  const [status, setStatus] = useState('loading'); // loading | ready | no-face | face

  const startCamera = useCallback(async () => {
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setStatus('face');
      }
    } catch (err) {
      console.error('Camera/model error:', err);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
    };
  }, [startCamera]);

  const runDetection = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || video.readyState < 2 || !canvas) return;

    const detections = await faceapi.detectAllFaces(
      video,
      new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 })
    );

    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, displaySize);
    const resized = faceapi.resizeResults(detections, displaySize);

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, resized);

    const facePresent = detections.length > 0;

    if (!facePresent && faceWasPresent.current) {
      faceWasPresent.current = false;
      setStatus('no-face');
      reportEvent(sessionId, 1, 'Face not detected — user may have left frame', 'error');
    } else if (facePresent && !faceWasPresent.current) {
      faceWasPresent.current = true;
      setStatus('face');
      reportEvent(sessionId, 2, 'Face detected again — user returned to frame', 'info');
    } else if (facePresent) {
      setStatus('face');
    }
  }, [sessionId, reportEvent]);

  const handleVideoPlay = () => {
    setStatus('face');
    intervalRef.current = setInterval(runDetection, DETECT_INTERVAL_MS);
  };

  const statusStyles = {
    'loading': { border: '3px solid #888', label: 'Loading model...' },
    'ready':   { border: '3px solid #888', label: 'Ready' },
    'face':    { border: '3px solid #22c55e', label: 'Face detected' },
    'no-face': { border: '3px solid #ef4444', label: 'No face in frame!' },
    'error':   { border: '3px solid #f97316', label: 'Camera error' },
  };
  const s = statusStyles[status] || statusStyles['loading'];

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
