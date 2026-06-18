import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';

const DETECT_INTERVAL_MS = 1500;
const MODEL_URL = '/models';

// TensorFlow.js (inside face-api.js) doesn't send the ngrok session cookie when
// fetching model shard files, so ngrok returns its tiny interstitial HTML instead
// of the real 193 KB binary. TF.js then tries to parse that HTML as float32 data
// and throws the "144 values expected, got 10" error.
//
// Fix: pre-fetch both files ourselves with credentials + bypass header, keep the
// raw bytes in memory, then intercept every fetch call face-api.js makes and
// serve from our in-memory cache instead of the network.
async function loadModelSafely() {
  if (faceapi.nets.tinyFaceDetector.isLoaded) return;

  const bypassHeaders = { 'ngrok-skip-browser-warning': '1' };
  const fetchOpts = { credentials: 'include', headers: bypassHeaders };

  // --- Step 1: fetch both files ourselves ---
  const manifestRes = await fetch(`${MODEL_URL}/tiny_face_detector_model-weights_manifest.json`, fetchOpts);
  if (!manifestRes.ok) throw new Error(`Manifest fetch failed: HTTP ${manifestRes.status}`);
  const manifestJson = await manifestRes.json();

  const shardName = manifestJson[0].paths[0]; // "tiny_face_detector_model-shard1"
  const shardRes  = await fetch(`${MODEL_URL}/${shardName}`, fetchOpts);
  if (!shardRes.ok) throw new Error(`Shard fetch failed: HTTP ${shardRes.status} (${shardRes.headers.get('content-type')})`);

  const shardBuffer = await shardRes.arrayBuffer();
  if (shardBuffer.byteLength < 50_000) {
    throw new Error(`Shard too small (${shardBuffer.byteLength} B) — server returned non-binary data`);
  }

  // --- Step 2: build blob URLs so face-api.js can fetch from memory ---
  const shardBlobUrl = URL.createObjectURL(
    new Blob([shardBuffer], { type: 'application/octet-stream' })
  );
  const patchedManifest = [{ ...manifestJson[0], paths: [shardBlobUrl] }];
  const manifestBlobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(patchedManifest)], { type: 'application/json' })
  );

  // --- Step 3: intercept fetch — redirect model file requests to our blobs ---
  const origFetch = window.fetch.bind(window);
  window.fetch = (url, opts = {}) => {
    const urlStr = typeof url === 'string' ? url : url.url;
    if (urlStr?.includes('tiny_face_detector_model-weights_manifest')) return origFetch(manifestBlobUrl, opts);
    if (urlStr?.includes('tiny_face_detector_model-shard'))            return origFetch(shardBlobUrl, opts);
    return origFetch(url, { ...opts, credentials: 'include', headers: { ...(opts.headers || {}), ...bypassHeaders } });
  };

  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  } finally {
    window.fetch = origFetch;
    URL.revokeObjectURL(shardBlobUrl);
    URL.revokeObjectURL(manifestBlobUrl);
  }
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
