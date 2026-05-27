import React from 'react';
import ReactDOM from 'react-dom/client';
import './utils/api'; // patches global fetch with JWT
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
