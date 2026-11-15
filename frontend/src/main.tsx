import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)


// PWA baseline: cache only the shell, never API responses or sensitive administrative data.
if (import.meta.env.PROD && import.meta.env.MODE !== 'desktop' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('تعذر تسجيل Service Worker:', error)
    })
  })
}
