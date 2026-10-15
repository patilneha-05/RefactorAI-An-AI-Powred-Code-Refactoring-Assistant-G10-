import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ApiStatusProvider } from './context/ApiStatusContext.jsx';
import { ProjectProvider } from './context/ProjectContext.jsx';
import { AgentSettingsProvider } from './context/AgentSettings.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <ApiStatusProvider>
          <ProjectProvider>
            <AgentSettingsProvider>
              <App />
            </AgentSettingsProvider>
          </ProjectProvider>
        </ApiStatusProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
