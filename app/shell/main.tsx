import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import './tokens.css';
import './base.css';
import './shell.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProviderBoundary } from './auth/AuthContext';
import { chooseProvider } from './auth/choose-provider';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no #root element');
}

createRoot(root).render(
  <StrictMode>
    <AuthProviderBoundary provider={chooseProvider(import.meta.env)}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProviderBoundary>
  </StrictMode>,
);
