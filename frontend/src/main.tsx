import React, { lazy } from 'react'
import { createRoot } from 'react-dom/client'
import LazyBoundary from './components/common/LazyBoundary'
import RootErrorBoundary from './components/common/RootErrorBoundary'
import { reportUiError } from './lib/errorReporting'
import './styles/index.css'

const AdminApp = lazy(() => import('./App'))
const HomePage = lazy(() => import('./home/HomePage'))
const UnifiedLoginPage = lazy(() => import('./pages/UnifiedLoginPage'))
const MemberPortalComingSoonPage = lazy(() => import('./pages/MemberPortalComingSoonPage'))
const MeetingRoomPage = lazy(() => import('./room/MeetingRoomPage'))
const TeacherApp = lazy(() => import('./teacher/TeacherApp'))
const ZZErrorBomb = import.meta.env.VITE_ZZ_TEST_ERRORS === '1' ? lazy(() => import('./test/ErrorBomb')) : null
const path = window.location.pathname
const isHome = path === '/' || path === '/home'
const isLogin = path === '/login' || path === '/login/'
const isPortal = path === '/portal' || path.startsWith('/portal/')
const isRoom = path === '/room' || path.startsWith('/room/')
const isSupervisor = path === '/supervisor' || path.startsWith('/supervisor/')
const isTeacher = path === '/teacher' || path.startsWith('/teacher/')

if (isHome) {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><RootErrorBoundary page="الرئيسية" homeHref="/">
      {ZZErrorBomb && <ZZErrorBomb scope="app" />}
      <LazyBoundary page="الرئيسية" label="جارٍ تحميل الصفحة…"><HomePage /></LazyBoundary>
    </RootErrorBoundary></React.StrictMode>,
  )
} else if (isLogin) {
  document.title = 'تسجيل الدخول — دار الإمام حفص'
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><RootErrorBoundary page="تسجيل الدخول" homeHref="/login">
      {ZZErrorBomb && <ZZErrorBomb scope="app" />}
      <LazyBoundary page="تسجيل الدخول" label="جارٍ تحميل صفحة الدخول…"><UnifiedLoginPage /></LazyBoundary>
    </RootErrorBoundary></React.StrictMode>,
  )
} else if (isPortal) {
  document.title = 'بوابة الطالب وولي الأمر — دار الإمام حفص'
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><RootErrorBoundary page="بوابتك قريبًا" homeHref="/portal">
      {ZZErrorBomb && <ZZErrorBomb scope="app" />}
      <LazyBoundary page="بوابتك قريبًا" label="جارٍ تحميل البوابة…"><MemberPortalComingSoonPage /></LazyBoundary>
    </RootErrorBoundary></React.StrictMode>,
  )
} else if (isRoom) {
  document.title = 'غرفة الحلقة — دار الإمام حفص'
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><RootErrorBoundary page="غرفة الحلقة" homeHref="/login">
      {ZZErrorBomb && <ZZErrorBomb scope="app" />}
      <LazyBoundary page="غرفة الحلقة" label="جارٍ تحميل غرفة الحلقة…"><MeetingRoomPage /></LazyBoundary>
    </RootErrorBoundary></React.StrictMode>,
  )
} else if (isTeacher || isSupervisor) {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/manifest-teacher.webmanifest')
  document.title = 'بوابة المعلمة — دار الإمام حفص'
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RootErrorBoundary page={isSupervisor ? 'بوابة المشرفة' : 'بوابة المعلمة'} homeHref={isSupervisor ? '/supervisor' : '/teacher'}>
        {ZZErrorBomb && <ZZErrorBomb scope="app" />}
        <LazyBoundary page={isSupervisor ? 'بوابة المشرفة' : 'بوابة المعلمة'} label="جارٍ تحميل البوابة…">
          <TeacherApp mode={isSupervisor ? 'supervisor' : 'teacher'} />
        </LazyBoundary>
      </RootErrorBoundary>
    </React.StrictMode>,
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode><RootErrorBoundary page="لوحة الإدارة" homeHref="/management">
      {ZZErrorBomb && <ZZErrorBomb scope="app" />}
      <LazyBoundary page="لوحة الإدارة" label="جارٍ تحميل لوحة الإدارة…"><AdminApp /></LazyBoundary>
    </RootErrorBoundary></React.StrictMode>,
  )
}

function currentPageName() {
  if (isHome) return 'الرئيسية'
  if (isLogin) return 'تسجيل الدخول'
  if (isPortal) return 'بوابتك قريبًا'
  if (isRoom) return 'غرفة الحلقة'
  if (isSupervisor) return 'بوابة المشرفة'
  if (isTeacher) return 'بوابة المعلمة'
  return 'لوحة الإدارة'
}
window.addEventListener('error', () => reportUiError({ scope: 'global', page: currentPageName(), componentStack: '' }))
window.addEventListener('unhandledrejection', () => reportUiError({ scope: 'global', page: currentPageName(), componentStack: '' }))

// PWA baseline: cache only the shell, never API responses or sensitive administrative data.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('تعذر تسجيل Service Worker:', error)
    })
  })
}
