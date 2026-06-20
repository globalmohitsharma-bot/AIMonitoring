import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import MonitorDashboard from './MonitorDashboard.jsx';
import JobLanding from './JobLanding.jsx';
import PBDashboard from './PBDashboard.jsx';

const path = window.location.pathname;

let Page;
if (path === '/monitor') {
  Page = MonitorDashboard;
} else if (path === '/exam') {
  Page = App;
} else if (path === '/pb') {
  Page = PBDashboard;
} else {
  Page = JobLanding;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Page />
  </StrictMode>
);
