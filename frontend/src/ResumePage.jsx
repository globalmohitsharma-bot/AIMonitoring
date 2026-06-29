import './ResumePage.css';

const PDF_URL = '/resume.pdf';

export default function ResumePage() {
  return (
    <div className="resume-root">
      <header className="resume-header">
        <div className="resume-header-left">
          <div className="resume-avatar-wrap">
            <img src="/mohit.png" alt="Mohit Sharma" className="resume-avatar-img"
              onError={e => { e.target.style.display = 'none'; }} />
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

      <div className="resume-viewer">
        <iframe
          src={`${PDF_URL}#view=FitH`}
          className="resume-iframe"
          title="Mohit Sharma Resume"
        />
      </div>
    </div>
  );
}
