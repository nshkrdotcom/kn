import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/index.css';
import NinjaSelector from './components/NinjaSelector/NinjaSelector';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <NinjaSelector />
  </React.StrictMode>
);
