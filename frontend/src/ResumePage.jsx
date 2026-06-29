import './ResumePage.css';

export default function ResumePage() {
  const pdfUrl = '/resume.pdf';

  return (
    <div className="resume-root">
      <header className="resume-header">
        <div className="resume-header-left">
          <span className="resume-avatar">👤</span>
          <div>
            <h1 className="resume-name">Mohit Kumar Sharma</h1>
            <p className="resume-role">Senior Advanced Software Engineer · Technical Lead</p>
          </div>
        </div>
        <a className="resume-download" href={pdfUrl} download="Mohit_Sharma_Resume.pdf">
          ⬇ Download PDF
        </a>
      </header>

      <div className="resume-viewer">
        {/* Native PDF embed — works in all desktop browsers */}
        <object
          data={pdfUrl}
          type="application/pdf"
          className="resume-object"
        >
          {/* Fallback for mobile browsers that don't embed PDFs */}
          <div className="resume-fallback">
            <div className="resume-fallback-icon">📄</div>
            <p>Your browser doesn't support inline PDF viewing.</p>
            <a className="resume-fallback-btn" href={pdfUrl} target="_blank" rel="noopener noreferrer">
              Open PDF →
            </a>
            <a className="resume-fallback-btn resume-fallback-dl" href={pdfUrl} download="Mohit_Sharma_Resume.pdf">
              ⬇ Download PDF
            </a>
          </div>
        </object>
      </div>
    </div>
  );
}
