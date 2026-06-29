import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import './ResumePage.css';

// Point worker at the bundled copy shipped with pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDF_URL = '/resume.pdf';

function PdfPage({ pdf, pageNum }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    pdf.getPage(pageNum).then(page => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: window.devicePixelRatio >= 2 ? 2.2 : 1.8 });
      const canvas   = canvasRef.current;
      if (!canvas) return;
      canvas.height = viewport.height;
      canvas.width  = viewport.width;
      canvas.style.width  = '100%';
      canvas.style.height = 'auto';
      page.render({ canvasContext: canvas.getContext('2d'), viewport });
    });
    return () => { cancelled = true; };
  }, [pdf, pageNum]);

  return <canvas ref={canvasRef} className="resume-page-canvas" />;
}

export default function ResumePage() {
  const [pdf,     setPdf]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    pdfjsLib.getDocument(PDF_URL).promise
      .then(doc => { setPdf(doc); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <div className="resume-root">
      <header className="resume-header">
        <div className="resume-header-left">
          <div className="resume-avatar-wrap">
            <img src="/mohit.png" alt="Mohit Sharma" className="resume-avatar-img"
              onError={e => { e.target.style.display='none'; }} />
          </div>
          <div>
            <h1 className="resume-name">Mohit Kumar Sharma</h1>
            <p className="resume-role">Senior Advanced Software Engineer · Technical Lead · 15+ Years</p>
          </div>
        </div>
        <div className="resume-header-right">
          <a className="resume-btn resume-btn-outline"
            href="https://www.linkedin.com/in/globalmohitsharma/"
            target="_blank" rel="noopener noreferrer">
            🔗 LinkedIn
          </a>
          <a className="resume-btn resume-btn-primary"
            href={PDF_URL} download="Mohit_Sharma_Resume.pdf">
            ⬇ Download
          </a>
        </div>
      </header>

      <div className="resume-body">
        {loading && (
          <div className="resume-loading">
            <div className="resume-spinner" />
            <p>Loading resume…</p>
          </div>
        )}
        {error && (
          <div className="resume-error">
            <p>⚠ Could not load PDF — <a href={PDF_URL} target="_blank" rel="noopener noreferrer">open directly</a></p>
          </div>
        )}
        {pdf && (
          <div className="resume-pages">
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <div key={i + 1} className="resume-page-wrap">
                <PdfPage pdf={pdf} pageNum={i + 1} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
