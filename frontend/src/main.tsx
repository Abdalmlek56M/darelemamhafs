import React, { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import HomePage from './home/HomePage'
import './styles/index.css'

const TeacherApp = lazy(() => import('./teacher/TeacherApp'))
const path = window.location.pathname
const isHome = path === '/' || path === '/home'
const isSupervisor = path === '/supervisor' || path.startsWith('/supervisor/')
const isTeacher = path === '/teacher' || path.startsWith('/teacher/')

if (isHome) {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><HomePage /></React.StrictMode>,
  )
} else if (isTeacher || isSupervisor) {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/manifest-teacher.webmanifest')
  document.title = 'بوابة المعلمة — دار الإمام حفص'
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#080e19', color: '#95a4ba', fontFamily: 'Cairo, Tahoma, sans-serif' }}>جارٍ التحميل…</div>}>
        <TeacherApp mode={isSupervisor ? 'supervisor' : 'teacher'} />
      </Suspense>
    </React.StrictMode>,
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>,
  )
}

// PWA baseline: cache only the shell, never API responses or sensitive administrative data.
if (import.meta.env.PROD && import.meta.env.MODE !== 'desktop' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('تعذر تسجيل Service Worker:', error)
    })
  })
}
