import React, { lazy } from 'react'
import { createRoot } from 'react-dom/client'
import LazyBoundary from './components/common/LazyBoundary'
import './styles/index.css'

const AdminApp = lazy(() => import('./App'))
const HomePage = lazy(() => import('./home/HomePage'))
const TeacherApp = lazy(() => import('./teacher/TeacherApp'))
const path = window.location.pathname
const isHome = path === '/' || path === '/home'
const isSupervisor = path === '/supervisor' || path.startsWith('/supervisor/')
const isTeacher = path === '/teacher' || path.startsWith('/teacher/')

if (isHome) {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><LazyBoundary label="جارٍ تحميل الصفحة…"><HomePage /></LazyBoundary></React.StrictMode>,
  )
} else if (isTeacher || isSupervisor) {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/manifest-teacher.webmanifest')
  document.title = 'بوابة المعلمة — دار الإمام حفص'
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LazyBoundary label="جارٍ تحميل البوابة…">
        <TeacherApp mode={isSupervisor ? 'supervisor' : 'teacher'} />
      </LazyBoundary>
    </React.StrictMode>,
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><LazyBoundary label="جارٍ تحميل لوحة الإدارة…"><AdminApp /></LazyBoundary></React.StrictMode>,
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
