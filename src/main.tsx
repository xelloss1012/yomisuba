import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { startStateMirror } from './utils/stateMirror';

// In the Android app the reading data is mirrored to the app's private files: if the WebView's storage
// was cleared, it is brought back here, before the app reads it.
void startStateMirror().finally(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
