import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist-mono/latin-400.css';
import './style.css';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('Request lab root is missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
