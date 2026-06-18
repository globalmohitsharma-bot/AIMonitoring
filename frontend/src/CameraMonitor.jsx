import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';
import { shardBase64, modelManifest } from './tinyFaceDetectorModel.js';

const DETECT_INTERVAL_MS = 1500;

// Loads TinyFaceDetector weights from the bundled base64 string — zero network
// requests. Uses faceapi.tf.io.decodeWeights (which handles uint8 quantization)
// to build the NamedTensorMap, then calls loadFromWeightMap directly.
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
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const faceWasPresent = useRef(true);
  const [status, setStatus] = useState('loading');
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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setStatus('error');
      if (err.name === 'NotAllowedError') {
        setErrorMsg('Camera permission denied — please allow camera access');
      } else if (err.name === 'NotFoundError') {
        setErrorMsg('No camera found on this device');
      } else {
        setErrorMsg(`Camera error: ${err.message}`);
      }
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
    'loading': { border: '3px solid #888',    label: 'Loading AI model...' },
    'face':    { border: '3px solid #22c55e', label: 'Face detected' },
    'no-face': { border: '3px solid #ef4444', label: 'No face in frame!' },
    'error':   { border: '3px solid #f97316', label: errorMsg || 'Camera error' },
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
