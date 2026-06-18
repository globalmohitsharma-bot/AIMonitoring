import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import MonitorDashboard from './MonitorDashboard.jsx';

const isMonitor = window.location.pathname === '/monitor';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isMonitor ? <MonitorDashboard /> : <App />}
  </StrictMode>
);
