import React from 'react';
import ReactDOM from 'react-dom/client';
import './utils/api'; // patches global fetch with JWT
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// Register Service Worker for PWA offline support
if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[BCK SW] Registered:', reg.scope))
      .catch(err => console.warn('[BCK SW] Registration failed:', err));
  });
}
