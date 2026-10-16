import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ApiStatusProvider } from './context/ApiStatusContext.jsx';
import { ProjectProvider } from './context/ProjectContext.jsx';
import { AgentSettingsProvider } from './context/AgentSettings.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { maybeCompleteGoogleRedirect } from './services/googleOAuth';

// If this document is the Google OAuth popup's redirect target, forward the
// credential to the opener and stop — there is no app to render.
const handledGoogleRedirect = maybeCompleteGoogleRedirect();

if (!handledGoogleRedirect) {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ApiStatusProvider>
              <ProjectProvider>
                <AgentSettingsProvider>
                  <App />
                </AgentSettingsProvider>
              </ProjectProvider>
            </ApiStatusProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}
