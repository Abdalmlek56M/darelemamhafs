import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CloudUpload, LogOut, WifiOff } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type {
  EarningsResponse, EndResponse, NotificationsResponse, Page, RosterResponse, Slot,
  SubscriptionsResponse, TeacherSession, TodayResponse,
} from './teacherTypes'
import TeacherLogin from './TeacherLogin'
import TeacherNav from './TeacherNav'
import LazyBoundary from '../components/common/LazyBoundary'

const TeacherHome = lazy(() => import('./TeacherHome'))
const TeacherCalendar = lazy(() => import('./TeacherCalendar'))
const TeacherHistory = lazy(() => import('./TeacherHistory'))
const TeacherLive = lazy(() => import('./TeacherLive'))
const TeacherRoster = lazy(() => import('./TeacherRoster'))
const TeacherNotifications = lazy(() => import('./TeacherNotifications'))
const TeacherSubscriptions = lazy(() => import('./TeacherSubscriptions'))
const TeacherAccount = lazy(() => import('./TeacherAccount'))
const TeacherRequests = lazy(() => import('./TeacherRequests'))
const SupervisorWorkspace = lazy(() => import('./SupervisorWorkspace'))
const ZZErrorBomb = import.meta.env.VITE_ZZ_TEST_ERRORS === '1' ? lazy(() => import('../test/ErrorBomb')) : null

const PAGE_TITLES: Record<string, string> = { home: 'اليوم', live: 'الحلقة', roster: 'الحضور', notifications: 'التنبيهات', subscriptions: 'الاشتراكات', account: 'حسابي', requests: 'الطلبات', calendar: 'التقويم', history: 'السجل' }
import { loginErrorMessage } from '../lib/userMessages'
import { useTeacherOutbox } from './useTeacherOutbox'
import './teacher.css'
import './calendar-history.css'

type Props = { mode: 'teacher' | 'supervisor' }

function has(session: TeacherSession | null, permission: string) {
  return !!session?.permissionCodes.includes(permission)
}

import { useTeacherAppState } from './useTeacherAppState'

type TeacherAppState = ReturnType<typeof useTeacherAppState>

export default function TeacherAppView(props: TeacherAppState) {
  const {
    session, setSession, checking, setChecking,
    loginBusy, setLoginBusy, loginError, setLoginError,
    page, setPage, today, setToday,
    earnings, setEarnings, todayLoading, setTodayLoading,
    todayError, setTodayError, activeSessionId, setActiveSessionId,
    activeSlot, setActiveSlot, endResult, setEndResult,
    roster, setRoster, rosterLoading, setRosterLoading,
    rosterError, setRosterError, notifications, setNotifications,
    notifLoading, setNotifLoading, notifError, setNotifError,
    subscriptions, setSubscriptions, subsLoading, setSubsLoading,
    subsError, setSubsError, busy, setBusy,
    error, setError, todayRequested, notificationsRequested,
    canTeacher, outbox, canSupervisor, canSubscriptions,
    canEarnings, canSelfPassword, canTeacherRequests, canFinance,
    canUnpaid, canLive, canAbsences, canStudents,
    canAddStudents, canStudentsNotes, canCircles, canTeachers,
    canTeacherNotes, canRequests, canCommunicate, canCorrect,
    unread, loadToday, loadNotifications, loadSubscriptions,
    login, logout, start, openLive,
    loadRoster, openRoster, end, submit,
    read, readAll, resolve, openAction,
    liveSlot,
  } = props
  if (checking) return <div className="teacher-app"><div className="t-empty">جارٍ التحقق من الجلسة…</div></div>
  if (!session) return <div className="teacher-app"><TeacherLogin busy={loginBusy} error={loginError} onLogin={login} /></div>

  if (!canTeacher && !canSupervisor) {
    return <div className="teacher-app"><div className="t-login"><div className="t-login-card"><h1>لا يوجد وصول</h1><p className="t-muted">هذا الحساب غير مرتبط بصلاحية معلمة أو مشرفة. راجع المدير.</p><button className="t-secondary" onClick={() => void logout()}><LogOut size={16} /> خروج</button></div></div></div>
  }

  if (page === 'supervisor' && canSupervisor) {
    return (
      <LazyBoundary key="supervisor" label="جارٍ تحميل مساحة الإشراف…" page="مساحة الإشراف" onHome={() => setPage(canTeacher ? 'home' : 'supervisor')}>
      <SupervisorWorkspace
        session={session}
        unread={unread}
        canTeacherPortal={canTeacher}
        canLive={canLive}
        canAbsences={canAbsences}
        canStudents={canStudents}
        canAddStudents={canAddStudents}
        canStudentsNotes={canStudentsNotes}
        canCircles={canCircles}
        canTeachers={canTeachers}
        canTeacherNotes={canTeacherNotes}
        canRequests={canRequests}
        canCommunicate={canCommunicate}
        canUnpaid={canUnpaid}
        canFinance={canFinance}
        canCorrect={canCorrect}
        onBackToTeacher={canTeacher ? () => setPage('home') : undefined}
        onAccount={() => setPage('account')}
        onLogout={() => void logout()}
        onNotificationsRefresh={() => void loadNotifications()}
      />
      </LazyBoundary>
    )
  }

  return (
    <div className={`teacher-app teacher-shell ${page === 'supervisor' ? 'is-supervisor' : ''} ${(!outbox.online || outbox.pending > 0 || outbox.legacy > 0) ? 'has-connectivity' : ''}`}>
      {(!outbox.online || outbox.pending > 0 || outbox.legacy > 0) && (
        <div className={`t-connectivity-banner ${outbox.online ? 'is-pending' : 'is-offline'}`} role="status">
          {outbox.online ? <CloudUpload size={14} /> : <WifiOff size={14} />}
          <span>{outbox.online ? `${outbox.pending} تسجيل حضور بانتظار الإرسال.` : 'لا يوجد اتصال. الحضور الذي تسجله سيُحفظ على الجهاز ويُرسل تلقائيًا.'}</span>
          {outbox.legacy > 0 && <span className="t-outbox-legacy">{outbox.legacy} تسجيل حضور قديم بحاجة للنقل إلى حسابك.</span>}
          {outbox.needsReview > 0 && <span className="t-outbox-warn">{outbox.needsReview} تسجيل بحاجة لمراجعة يدوية.</span>}
          {outbox.lastError && <span className="t-outbox-error">{outbox.lastError}</span>}
          {outbox.online && outbox.legacy > 0 && (
            <button type="button" className="t-outbox-claim" onClick={() => void outbox.claimLegacy()}>نقل إلى حسابي</button>
          )}
          {outbox.online && outbox.pending > 0 && (
            <button type="button" className="t-outbox-retry" onClick={() => void outbox.retryAll()}>إعادة المحاولة</button>
          )}
        </div>
      )}
      <main className="teacher-main">
        <LazyBoundary key={page} label="جارٍ تحميل الصفحة…" page={PAGE_TITLES[page] || 'بوابة المعلمة'} onHome={() => setPage('home')}>
        {ZZErrorBomb && <ZZErrorBomb scope="page" />}
        {page === 'home' && canTeacher && (
          <TeacherHome
            today={today}
            earnings={earnings}
            loading={todayLoading}
            error={todayError ?? error}
            onRefresh={() => void loadToday()}
            onStart={(slot) => void start(slot)}
            onOpenLive={(id) => void openLive(id)}
            onOpenRoster={(id) => void openRoster(id)}
            onNotifications={() => setPage('notifications')}
            onSubscriptions={() => setPage('subscriptions')}
            onCalendar={() => setPage('calendar')}
            onHistory={() => setPage('history')}
            onLogout={() => void logout()}
            canSubscriptions={canSubscriptions}
            canEarnings={canEarnings}
            unread={unread}
            canRequests={canTeacherRequests}
            onRequests={() => setPage('requests')}
          />
        )}
        {page === 'live' && activeSessionId && (
          <TeacherLive
            slot={liveSlot}
            sessionId={activeSessionId}
            hourlyRate={today?.teacher.hourlyRate ?? 0}
            scheduledMinutes={liveSlot?.durationMinutes ?? 90}
            startedAt={liveSlot?.startedAt ?? null}
            busy={busy}
            error={error}
            canEarnings={canEarnings}
            onBack={() => setPage('home')}
            onEnd={end}
          />
        )}
        {page === 'roster' && activeSessionId && (
          <TeacherRoster
            roster={roster}
            slot={liveSlot}
            endResult={endResult}
            hourlyRate={today?.teacher.hourlyRate ?? 0}
            loading={rosterLoading}
            busy={busy}
            error={rosterError ?? error}
            canEarnings={canEarnings}
            onBack={() => setPage('home')}
            onSubmit={submit}
            onDone={() => { setPage('home'); setRoster(null); setActiveSessionId(null); setActiveSlot(null); setEndResult(null) }}
          />
        )}
        {page === 'notifications' && (
          <TeacherNotifications
            loading={notifLoading}
            error={notifError}
            canResolve={canCorrect}
            busy={busy}
            onRefresh={() => void loadNotifications()}
            onRead={(id) => void read(id)}
            onReadAll={() => void readAll()}
            onResolve={resolve}
            onAction={openAction}
            onUnreadChange={(value) => setNotifications((current) => current ? { ...current, counts: { ...current.counts, unread: value } } : current)}
          />
        )}
        {page === 'subscriptions' && canSubscriptions && (
          <TeacherSubscriptions
            data={subscriptions}
            loading={subsLoading}
            error={subsError}
            onRefresh={() => void loadSubscriptions()}
            onBack={() => setPage('home')}
          />
        )}
        {page === 'account' && (
          <TeacherAccount
            session={session}
            canSelfPassword={canSelfPassword}
            onBack={canTeacher || canSupervisor ? () => setPage(canTeacher ? 'home' : 'supervisor') : undefined}
            onLogout={() => void logout()}
          />
        )}
        {page === 'requests' && canTeacherRequests && <TeacherRequests today={today} />}
        {page === 'calendar' && <TeacherCalendar onBack={() => setPage('home')} onOpenLive={(id) => void openLive(id)} onOpenRoster={(id) => void openRoster(id)} />}
        {page === 'history' && <TeacherHistory onBack={() => setPage('home')} />}
        </LazyBoundary>
      </main>

      <TeacherNav
        page={page}
        unread={unread}
        canTeacher={canTeacher}
        canRequests={canTeacherRequests}
        activeSessionId={activeSessionId}
        onNavigate={setPage}
        onOpenRoster={(sessionId) => void openRoster(sessionId)}
      />
    </div>
  )
}
