import React from 'react';
import { createRoot } from 'react-dom/client';
// Fix: Use named import for App as it's defined as a named export in App.tsx
import { App } from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}