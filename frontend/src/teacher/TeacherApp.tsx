import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CloudUpload, LogOut, WifiOff } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type {
  EarningsResponse, EndResponse, NotificationsResponse, Page, RosterResponse, Slot,
  SubscriptionsResponse, TeacherSession, TodayResponse,
} from './teacherTypes'
import TeacherLogin from './TeacherLogin'
import TeacherHome from './TeacherHome'
import TeacherCalendar from './TeacherCalendar'
import TeacherHistory from './TeacherHistory'
import TeacherLive from './TeacherLive'
import TeacherRoster from './TeacherRoster'
import TeacherNotifications from './TeacherNotifications'
import TeacherSubscriptions from './TeacherSubscriptions'
import TeacherAccount from './TeacherAccount'
import TeacherRequests from './TeacherRequests'
import SupervisorWorkspace from './SupervisorWorkspace'
import TeacherNav from './TeacherNav'
import { listQueuedAttendance, queueAttendance, removeQueuedAttendance } from './offlineOutbox'
import './teacher.css'
import './calendar-history.css'

type Props = { mode: 'teacher' | 'supervisor' }

function has(session: TeacherSession | null, permission: string) {
  return !!session?.permissionCodes.includes(permission)
}

export default function TeacherApp({ mode }: Props) {
  const [session, setSession] = useState<TeacherSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>(mode === 'supervisor' ? 'supervisor' : 'home')

  const [today, setToday] = useState<TodayResponse | null>(null)
  const [earnings, setEarnings] = useState<EarningsResponse | null>(null)
  const [todayLoading, setTodayLoading] = useState(false)
  const [todayError, setTodayError] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null)
  const [endResult, setEndResult] = useState<EndResponse | null>(null)

  const [roster, setRoster] = useState<RosterResponse | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)

  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null)
  const [notifLoading, setNotifLoading] = useState(false)
  const [notifError, setNotifError] = useState<string | null>(null)

  const [subscriptions, setSubscriptions] = useState<SubscriptionsResponse | null>(null)
  const [subsLoading, setSubsLoading] = useState(false)
  const [subsError, setSubsError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pendingOutbox, setPendingOutbox] = useState(0)
  const todayRequested = useRef(false)
  const notificationsRequested = useRef(false)

  const canTeacher = has(session, 'teacher.portal')
  const canSupervisor = has(session, 'supervisor.portal')
  const canSubscriptions = has(session, 'teacher.subscriptions.read')
  const canEarnings = has(session, 'teacher.earnings.self')
  const canSelfPassword = has(session, 'account.password.self')
  const canTeacherRequests = has(session, 'teacher.requests')
  const canFinance = has(session, 'finance.read')
  const canUnpaid = has(session, 'supervisor.unpaid') || canFinance
  const canLive = has(session, 'supervisor.live')
  const canAbsences = has(session, 'supervisor.absences')
  const canStudents = has(session, 'supervisor.students.read')
  const canStudentsNotes = has(session, 'supervisor.students.notes')
  const canCircles = has(session, 'supervisor.circles.read')
  const canTeachers = has(session, 'supervisor.teachers.read')
  const canTeacherNotes = has(session, 'supervisor.teachers.notes')
  const canRequests = has(session, 'supervisor.attendance.requests')
  const canCommunicate = has(session, 'supervisor.communication')
  const canCorrect = has(session, 'supervisor.attendance.correct') || has(session, 'attendance.edit')
  const unread = notifications?.counts.unread ?? 0

  const loadToday = useCallback(async () => {
    if (!has(session, 'teacher.portal')) return null
    setTodayLoading(true)
    setTodayError(null)
    try {
      const data = await teacherApi.today()
      setToday(data)
      if (canEarnings) {
        try { setEarnings(await teacherApi.earnings()) } catch { /* optional if the permission is missing */ }
      } else {
        setEarnings(null)
      }
      return data
    } catch (err) {
      if (err instanceof TeacherApiError && err.status === 401) {
        setSession(null)
        return null
      }
      setTodayError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل حلقاتك.')
      return null
    } finally {
      setTodayLoading(false)
    }
  }, [session, canEarnings])

  const loadNotifications = useCallback(async () => {
    setNotifLoading(true)
    setNotifError(null)
    try {
      setNotifications(await teacherApi.notifications('all'))
    } catch (err) {
      setNotifError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل التنبيهات.')
    } finally {
      setNotifLoading(false)
    }
  }, [])

  const loadSubscriptions = useCallback(async () => {
    setSubsLoading(true)
    setSubsError(null)
    try {
      setSubscriptions(await teacherApi.subscriptions())
    } catch (err) {
      setSubsError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الاشتراكات.')
    } finally {
      setSubsLoading(false)
    }
  }, [])

  const refreshOutbox = useCallback(async () => {
    try { setPendingOutbox((await listQueuedAttendance()).length) } catch { /* IndexedDB is optional */ }
  }, [])

  const flushOutbox = useCallback(async () => {
    if (!session || !navigator.onLine) return
    const items = await listQueuedAttendance().catch(() => [])
    for (const item of items) {
      try {
        await teacherApi.submit(item.sessionId, item.marks)
        await removeQueuedAttendance(item.sessionId)
      } catch (err) {
        if (err instanceof TeacherApiError && err.status >= 400 && err.status < 500) {
          await removeQueuedAttendance(item.sessionId)
          continue
        }
        break
      }
    }
    await refreshOutbox()
  }, [session, refreshOutbox])

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    void refreshOutbox()
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [refreshOutbox])

  useEffect(() => {
    if (online && session) void flushOutbox()
  }, [online, session, flushOutbox])

  useEffect(() => {
    let mounted = true
    teacherApi.me()
      .then((me) => {
        if (!mounted) return
        setSession(me)
        const teacher = me.permissionCodes.includes('teacher.portal')
        const supervisor = me.permissionCodes.includes('supervisor.portal')
        setPage(mode === 'supervisor' && supervisor ? 'supervisor' : teacher ? 'home' : supervisor ? 'supervisor' : 'home')
      })
      .catch((err) => {
        if (mounted && !(err instanceof TeacherApiError)) setLoginError('تعذر الاتصال بالخادم.')
      })
      .finally(() => { if (mounted) setChecking(false) })
    return () => { mounted = false }
  }, [mode])

  useEffect(() => {
    if (!session || !canTeacher || todayRequested.current) return
    todayRequested.current = true
    void loadToday()
  }, [session, canTeacher, loadToday])

  // Poll just before the next slot so the start button unlocks without a manual refresh.
  useEffect(() => {
    if (!session || !canTeacher || !today) return
    const next = today.slots
      .filter(slot => !slot.sessionId && slot.sessionStatus !== 'completed' && !slot.canStart && (slot.minutesUntilStart ?? 0) > 0)
      .sort((a, b) => (a.minutesUntilStart ?? 0) - (b.minutesUntilStart ?? 0))[0]
    if (!next) return
    const delay = Math.min(Math.max((next.minutesUntilStart ?? 1) * 60_000 + 1_500, 1_000), 60_000)
    const timer = window.setTimeout(() => void loadToday(), delay)
    return () => window.clearTimeout(timer)
  }, [session, canTeacher, today, loadToday])

  useEffect(() => {
    if (!session || notificationsRequested.current) return
    notificationsRequested.current = true
    void loadNotifications()
  }, [session, loadNotifications])

  useEffect(() => {
    if (!session) return
    if (page === 'notifications') void loadNotifications()
    if (page === 'subscriptions' && canSubscriptions) void loadSubscriptions()
  }, [page, session, canSubscriptions, loadNotifications, loadSubscriptions])

  const login = async (username: string, password: string, rememberMe: boolean) => {
    setLoginBusy(true)
    setLoginError(null)
    try {
      const signedIn = await teacherApi.login(username, password, rememberMe)
      todayRequested.current = false
      notificationsRequested.current = false
      setSession(signedIn)
      setError(null)
      try {
        const raw = localStorage.getItem('dar-teacher-profiles')
        const old = raw ? JSON.parse(raw) : []
        const profiles = Array.isArray(old) ? old.filter((item) => item && typeof item.username === 'string') : []
        const next = [
          { username: signedIn.username, displayName: signedIn.displayName, lastUsedAt: new Date().toISOString() },
          ...profiles.filter((item) => String(item.username).toLowerCase() !== signedIn.username.toLowerCase()),
        ].slice(0, 5)
        localStorage.setItem('dar-teacher-profiles', JSON.stringify(next))
        localStorage.setItem('dar-teacher-last-username', signedIn.username)
      } catch { /* saved profiles are a convenience; never block login */ }
      const teacher = signedIn.permissionCodes.includes('teacher.portal')
      const supervisor = signedIn.permissionCodes.includes('supervisor.portal')
      setPage(mode === 'supervisor' && supervisor ? 'supervisor' : teacher ? 'home' : supervisor ? 'supervisor' : 'home')
    } catch (err) {
      setLoginError(err instanceof TeacherApiError ? err.message : 'تعذر تسجيل الدخول.')
    } finally {
      setLoginBusy(false)
    }
  }

  const logout = async () => {
    try { await teacherApi.logout() } catch { /* clear local state anyway */ }
    setSession(null)
    setPage('home')
    setToday(null)
    setEarnings(null)
    setNotifications(null)
    setActiveSessionId(null)
    setActiveSlot(null)
    setRoster(null)
    todayRequested.current = false
    notificationsRequested.current = false
  }

  const start = async (slot: Slot) => {
    setBusy(true)
    setError(null)
    try {
      const started = await teacherApi.start(slot.id)
      setActiveSessionId(started.sessionId)
      const data = await loadToday()
      setActiveSlot(data?.slots.find((item) => item.sessionId === started.sessionId) ?? { ...slot, sessionId: started.sessionId, sessionStatus: started.status })
      setPage('live')
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر بدء الحلقة.')
    } finally {
      setBusy(false)
    }
  }

  const openLive = async (sessionId: string) => {
    let slot = today?.slots.find((item) => item.sessionId === sessionId) ?? null
    if (!slot) {
      const data = await loadToday()
      slot = data?.slots.find((item) => item.sessionId === sessionId) ?? null
    }
    setActiveSessionId(sessionId)
    setActiveSlot(slot)
    setPage('live')
  }

  const loadRoster = async (sessionId: string) => {
    setRosterLoading(true)
    setRosterError(null)
    try {
      setRoster(await teacherApi.roster(sessionId))
    } catch (err) {
      setRosterError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الطالبات.')
    } finally {
      setRosterLoading(false)
    }
  }

  const openRoster = async (sessionId: string) => {
    setActiveSessionId(sessionId)
    const slot = today?.slots.find((item) => item.sessionId === sessionId) ?? activeSlot
    setActiveSlot(slot ?? null)
    setEndResult(null)
    setPage('roster')
    await loadRoster(sessionId)
  }

  const end = async (note: string) => {
    if (!activeSessionId) return
    setBusy(true)
    setError(null)
    try {
      const result = await teacherApi.end(activeSessionId, note)
      setEndResult(result)
      await Promise.all([loadRoster(activeSessionId), loadToday(), loadNotifications()])
      setPage('roster')
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر إنهاء الحلقة.')
      throw err
    } finally {
      setBusy(false)
    }
  }

  const submit = async (marks: { enrollmentId: string; status: 'present' | 'excused' | 'absent' }[]) => {
    if (!activeSessionId) throw new Error('لا توجد حلقة.')
    const counts = { present: marks.filter((mark) => mark.status === 'present').length, excused: marks.filter((mark) => mark.status === 'excused').length, absent: marks.filter((mark) => mark.status === 'absent').length, total: marks.length }
    setBusy(true)
    setError(null)
    try {
      if (!navigator.onLine) {
        await queueAttendance(activeSessionId, marks)
        await refreshOutbox()
        return { ...counts, queued: true }
      }
      const result = await teacherApi.submit(activeSessionId, marks)
      await Promise.all([loadToday(), loadNotifications()])
      return result
    } catch (err) {
      if (!(err instanceof TeacherApiError)) {
        try {
          await queueAttendance(activeSessionId, marks)
          await refreshOutbox()
          return { ...counts, queued: true }
        } catch {
          setError('تعذر حفظ الحضور محليًا. أعد المحاولة عندما يعود الاتصال.')
          throw err
        }
      }
      setError(err.message)
      throw err
    } finally {
      setBusy(false)
    }
  }

  const read = async (id: string) => {
    try {
      await teacherApi.read(id)
      setNotifications((current) => current ? {
        ...current,
        counts: { ...current.counts, unread: Math.max(0, current.counts.unread - 1) },
        notifications: current.notifications.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item),
      } : current)
    } catch { /* reading is best-effort */ }
  }

  const readAll = async () => {
    try {
      await teacherApi.readAll()
      setNotifications((current) => current ? {
        ...current,
        counts: { ...current.counts, unread: 0 },
        notifications: current.notifications.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
      } : current)
    } catch { /* reading is best-effort */ }
  }

  const resolve = async (id: string, note: string) => {
    await teacherApi.resolve(id, note)
    setNotifications((current) => current ? {
      ...current,
      counts: { ...current.counts, open: Math.max(0, current.counts.open - 1) },
      notifications: current.notifications.map((item) => item.id === id ? { ...item, status: 'resolved', resolutionNote: note } : item),
    } : current)
  }

  const openAction = (url: string) => {
    if (url.startsWith('/teacher/roster/')) {
      const id = url.split('/').pop()
      if (id) void openRoster(id)
      return
    }
    if (url.startsWith('/supervisor')) {
      setPage('supervisor')
      return
    }
    setPage('home')
  }

  useEffect(() => {
    if (!session) return
    if (page === 'home' && !canTeacher && canSupervisor) setPage('supervisor')
    if (page === 'supervisor' && !canSupervisor && canTeacher) setPage('home')
  }, [session, page, canTeacher, canSupervisor])

  const liveSlot = useMemo(() => activeSlot ?? today?.slots.find((item) => item.sessionId === activeSessionId) ?? null, [activeSlot, today, activeSessionId])

  if (checking) return <div className="teacher-app"><div className="t-empty">جارٍ التحقق من الجلسة…</div></div>
  if (!session) return <div className="teacher-app"><TeacherLogin busy={loginBusy} error={loginError} onLogin={login} /></div>

  if (!canTeacher && !canSupervisor) {
    return <div className="teacher-app"><div className="t-login"><div className="t-login-card"><h1>لا يوجد وصول</h1><p className="t-muted">هذا الحساب غير مرتبط بصلاحية معلمة أو مشرفة. راجع المدير.</p><button className="t-secondary" onClick={() => void logout()}><LogOut size={16} /> خروج</button></div></div></div>
  }

  if (page === 'supervisor' && canSupervisor) {
    return (
      <SupervisorWorkspace
        session={session}
        unread={unread}
        canTeacherPortal={canTeacher}
        canLive={canLive}
        canAbsences={canAbsences}
        canStudents={canStudents}
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
      />
    )
  }

  return (
    <div className={`teacher-app teacher-shell ${page === 'supervisor' ? 'is-supervisor' : ''} ${(!online || pendingOutbox > 0) ? 'has-connectivity' : ''}`}>
      {(!online || pendingOutbox > 0) && (
        <div className={`t-connectivity-banner ${online ? 'is-pending' : 'is-offline'}`} role="status">
          {online ? <CloudUpload size={14} /> : <WifiOff size={14} />}
          <span>{online ? `${pendingOutbox} تسجيل حضور بانتظار الإرسال.` : 'لا يوجد اتصال. الحضور الذي تسجله سيُحفظ على الجهاز ويُرسل تلقائيًا.'}</span>
        </div>
      )}
      <main className="teacher-main">
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
            data={notifications}
            loading={notifLoading}
            error={notifError}
            canResolve={canCorrect}
            busy={busy}
            onRefresh={() => void loadNotifications()}
            onRead={(id) => void read(id)}
            onReadAll={() => void readAll()}
            onResolve={resolve}
            onAction={openAction}
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
