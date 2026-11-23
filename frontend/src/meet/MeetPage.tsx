import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, Film, Plus, RefreshCw, Video } from 'lucide-react'
import { confirmAction } from '../components/common/confirmService'
import type { DarApplicationContext } from '../application/useDarApplication'
import { meetApi } from './meetApi'
import CalendarStatusCard from './components/CalendarStatusCard'
import CalendarEventsPanel from './components/CalendarEventsPanel'
import RecordingScopePanel from './components/RecordingScopePanel'
import RecordingsPanel from './components/RecordingsPanel'
import BotControlCard from './components/BotControlCard'
import LinkEventDialog from './components/LinkEventDialog'
import CreateEventDialog, { type CreateEventInput } from './components/CreateEventDialog'
import { addDays, cairoDayKey } from './format'
import type {
  MeetCalendarStatus,
  MeetCircleSetting,
  MeetEvent,
  MeetFilter,
  MeetRecordingMode,
  MeetSettings,
} from './types'
import './meet.css'

type Props = { ctx: DarApplicationContext }
type Tab = 'events' | 'recordings' | 'scope'

const pageSize = 25
const callbackMessages: Record<string, string> = {
  connected: 'تم ربط تقويم Google بنجاح. شغّل «مزامنة الآن» لجلب الأحداث.',
  denied: 'أُلغي منح الوصول لتقويم Google.',
  invalid_state: 'انتهت مهلة الربط أو أن الحالة غير صالحة. أعد المحاولة.',
  invalid_code: 'لم يكتمل الربط مع Google. أعد المحاولة.',
  error: 'تعذّر إكمال ربط تقويم Google. راجع الإعدادات ثم أعد المحاولة.',
}

export default function MeetPage({ ctx }: Props) {
  const [status, setStatus] = useState<MeetCalendarStatus | null>(null)
  const [settings, setSettings] = useState<MeetSettings | null>(null)
  const [circles, setCircles] = useState<MeetCircleSetting[]>([])
  const [scoped, setScoped] = useState(false)
  const [events, setEvents] = useState<MeetEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<MeetFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState(() => cairoDayKey(addDays(new Date(), -7)))
  const [to, setTo] = useState(() => cairoDayKey(addDays(new Date(), 45)))
  const [showAll, setShowAll] = useState(false)
  const meetOnly = !showAll
  const [tab, setTab] = useState<Tab>('events')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [linkTarget, setLinkTarget] = useState<MeetEvent | null>(null)
  const [linking, setLinking] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const requestRef = useRef(0)

  const canManage = ctx.has('meet.manage')
  const canCalendar = ctx.has('meet.calendar.manage')

  const loadStatus = useCallback(async () => {
    const [nextStatus, nextSettings] = await Promise.all([meetApi.status(), meetApi.settings()])
    setStatus(nextStatus)
    setSettings(nextSettings)
  }, [])

  const loadCircles = useCallback(async () => {
    const data = await meetApi.circles()
    setCircles(data.circles)
    setScoped(data.scoped)
  }, [])

  const loadEvents = useCallback(async () => {
    const ticket = ++requestRef.current
    setLoading(true)
    try {
      const data = await meetApi.events({ from, to, filter, search, page, pageSize, meetOnly })
      if (ticket !== requestRef.current) return
      setEvents(data.items)
      setTotal(data.total)
      setError(null)
    } catch (exception) {
      if (ticket !== requestRef.current) return
      setError(exception instanceof Error ? exception.message : 'تعذّر تحميل أحداث التقويم.')
    } finally {
      if (ticket === requestRef.current) setLoading(false)
    }
  }, [from, to, filter, search, page, meetOnly])

  useEffect(() => {
    void loadStatus().catch((exception: unknown) => setError(exception instanceof Error ? exception.message : 'تعذّر تحميل حالة التقويم.'))
    void loadCircles().catch(() => undefined)
  }, [loadStatus, loadCircles])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('meet')
    if (!result) return
    ctx.setToast({ tone: result === 'connected' ? 'success' : 'error', text: callbackMessages[result] ?? 'نتيجة غير معروفة.' })
    params.delete('meet')
    const query = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash)
    if (result === 'connected') void loadStatus().catch(() => undefined)
    // Runs once for the OAuth return navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connect = async () => {
    setBusy('connect')
    try {
      const { authorizationUrl } = await meetApi.connect()
      window.location.assign(authorizationUrl)
    } catch (exception) {
      setBusy(null)
      ctx.setToast({ tone: 'error', text: exception instanceof Error ? exception.message : 'تعذّر بدء ربط Google.' })
    }
  }

  const sync = async (full: boolean) => {
    setBusy(full ? 'sync-full' : 'sync')
    try {
      const result = await meetApi.sync(full)
      ctx.setToast({
        tone: 'success',
        text: `تمت المزامنة: ${result.added} جديد، ${result.updated} محدَّث، ${result.cancelled} ملغى، ${result.autoLinked} ربط تلقائي.`,
      })
      await Promise.all([loadStatus(), loadEvents(), loadCircles()])
    } catch (exception) {
      ctx.setToast({ tone: 'error', text: exception instanceof Error ? exception.message : 'تعذّرت المزامنة.' })
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    const confirmed = await confirmAction({
      title: 'فصل تقويم Google',
      message: 'سيتوقف جلب الأحداث الجديدة فورًا. الأحداث والروابط الحالية تبقى محفوظة، ويمكنك إعادة الربط لاحقًا.',
      confirmLabel: 'فصل التقويم',
      danger: true,
    })
    if (!confirmed) return
    setBusy('disconnect')
    try {
      await meetApi.disconnect()
      ctx.setToast({ tone: 'success', text: 'تم فصل تقويم Google.' })
      await loadStatus()
    } catch (exception) {
      ctx.setToast({ tone: 'error', text: exception instanceof Error ? exception.message : 'تعذّر فصل التقويم.' })
    } finally {
      setBusy(null)
    }
  }

  const toggleCircle = async (circle: MeetCircleSetting, autoRecord: boolean, autoLink: boolean) => {
    setBusyId(circle.circleId)
    try {
      await meetApi.saveCircle(circle.circleId, autoRecord, autoLink)
      await loadCircles()
      ctx.setToast({
        tone: 'success',
        text: autoRecord
          ? `حلقة «${circle.name}» أصبحت ضمن نطاق التسجيل التلقائي.`
          : `أُخرجت حلقة «${circle.name}» من نطاق التسجيل التلقائي.`,
      })
    } catch (exception) {
      ctx.setToast({ tone: 'error', text: exception instanceof Error ? exception.message : 'تعذّر حفظ إعداد الحلقة.' })
    } finally {
      setBusyId(null)
    }
  }

  const saveLink = async (circleId: string, enableRecording: boolean) => {
    if (!linkTarget) return
    setLinking(true)
    try {
      await meetApi.link(linkTarget.id, circleId, enableRecording)
      setLinkTarget(null)
      await Promise.all([loadEvents(), loadCircles()])
      ctx.setToast({ tone: 'success', text: 'تم ربط الحدث بالحلقة.' })
    } catch (exception) {
      ctx.setToast({ tone: 'error', text: exception instanceof Error ? exception.message : 'تعذّر ربط الحدث.' })
    } finally {
      setLinking(false)
    }
  }

  const unlink = async (event: MeetEvent) => {
    const confirmed = await confirmAction({
      title: 'فك ربط الحدث',
      message: `فك ربط «${event.summary ?? 'الحدث'}» عن حلقة «${event.circleName ?? ''}»؟`,
      confirmLabel: 'فك الربط',
      danger: true,
    })
    if (!confirmed) return
    setBusyId(event.id)
    try {
      await meetApi.unlink(event.id)
      await loadEvents()
      ctx.setToast({ tone: 'success', text: 'تم فك ربط الحدث.' })
    } catch (exception) {
      ctx.setToast({ tone: 'error', text: exception instanceof Error ? exception.message : 'تعذّر فك الربط.' })
    } finally {
      setBusyId(null)
    }
  }

  const changeMode = async (event: MeetEvent, mode: MeetRecordingMode) => {
    setBusyId(event.id)
    try {
      await meetApi.setRecordingMode(event.id, mode)
      await loadEvents()
    } catch (exception) {
      ctx.setToast({ tone: 'error', text: exception instanceof Error ? exception.message : 'تعذّر تحديث قاعدة التسجيل.' })
    } finally {
      setBusyId(null)
    }
  }

  const changeAccess = async (event: MeetEvent, access: 'open' | 'trusted' | null) => {
    setBusyId(event.id)
    try {
      await meetApi.setEventAccess(event.id, access)
      await loadEvents()
      ctx.setToast({
        tone: 'success',
        text: access === null ? 'عاد الاجتماع للوصول الافتراضي.' : `الوصول الآن ${access}.`,
      })
    } catch (exception) {
      ctx.setToast({ tone: 'error', text: exception instanceof Error ? exception.message : 'تعذّر تحديث نوع الوصول.' })
    } finally {
      setBusyId(null)
    }
  }

  const createEvent = async (input: CreateEventInput) => {
    setCreating(true)
    try {
      const created = await meetApi.createEvent(input)
      setCreateOpen(false)
      await Promise.all([loadEvents(), loadCircles()])
      ctx.setToast({
        tone: 'success',
        text: created.meetLink
          ? 'تم إنشاء الموعد في تقويم Google مع رابط Meet، وربطه بالحلقة.'
          : 'تم إنشاء الموعد، لكن Google لم يُرجع رابط Meet. راجع إعداد التقويم.',
      })
    } catch (exception) {
      ctx.setToast({ tone: 'error', text: exception instanceof Error ? exception.message : 'تعذّر إنشاء الموعد.' })
    } finally {
      setCreating(false)
    }
  }

  return <motion.section
    key="meet"
    className="meet-page"
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -5 }}
  >
    <div className="page-toolbar">
      <div className="toolbar-copy">
        <h2>التسجيل والمحاضرات</h2>
        <p>ربط تقويم Google يحدد الحلقات التي تُسجَّل تلقائيًا. التسجيل نفسه يعمل خلال المراحل القادمة (البوت)، والواجهة هنا لاختيار النطاق وربط الأحداث.</p>
      </div>
      <div className="toolbar-actions">
        {canManage && <button type="button" className="primary-button" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> إنشاء حصة
        </button>}
        <button type="button" className="secondary-button" onClick={() => { void loadStatus(); void loadEvents(); void loadCircles() }}>
          <RefreshCw size={16} /> تحديث
        </button>
      </div>
    </div>

    <CalendarStatusCard
      status={status}
      settings={settings}
      canManage={canCalendar}
      busy={busy}
      onConnect={() => void connect()}
      onSync={(full) => void sync(full)}
      onDisconnect={() => void disconnect()}
    />

    <BotControlCard
      canControl={ctx.has('meet.bot.control')}
      settings={settings}
      onSettingsSaved={(next) => setSettings(next)}
    />

    <div className="meet-tabs" role="tablist" aria-label="أقسام التسجيل">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'events'}
        className={'meet-tab' + (tab === 'events' ? ' is-active' : '')}
        onClick={() => setTab('events')}
      ><CalendarDays size={16} /> أحداث التقويم</button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'recordings'}
        className={'meet-tab' + (tab === 'recordings' ? ' is-active' : '')}
        onClick={() => setTab('recordings')}
      ><Film size={16} /> التسجيلات</button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'scope'}
        className={'meet-tab' + (tab === 'scope' ? ' is-active' : '')}
        onClick={() => setTab('scope')}
      ><Video size={16} /> نطاق التسجيل ({circles.filter((circle) => circle.autoRecord).length})</button>
    </div>

    {error && <p className="meet-page-error" role="alert">{error}</p>}

    {tab === 'events' && <CalendarEventsPanel
        events={events}
        total={total}
        page={page}
        pageSize={pageSize}
        filter={filter}
        search={searchInput}
        from={from}
        to={to}
        loading={loading}
        canManage={canManage}
        busyId={busyId}
        onFilter={(next) => { setFilter(next); setPage(1) }}
        onSearch={setSearchInput}
        onFrom={(next) => { setFrom(next); setPage(1) }}
        onTo={(next) => { setTo(next); setPage(1) }}
        onPage={setPage}
        onLink={setLinkTarget}
        onUnlink={(event) => void unlink(event)}
        onMode={(event, mode) => void changeMode(event, mode)}
        showAll={showAll}
        onShowAll={(value) => { setShowAll(value); setPage(1) }}
        onAccess={(event, access) => void changeAccess(event, access)}
      />}

    {tab === 'recordings' && <RecordingsPanel canView={ctx.has('meet.media.view')} />}

    {tab === 'scope' && <RecordingScopePanel
        circles={circles}
        scoped={scoped}
        canManage={canManage}
        busyId={busyId}
        onToggle={(circle, autoRecord, autoLink) => void toggleCircle(circle, autoRecord, autoLink)}
      />}

    {linkTarget && <LinkEventDialog
      event={linkTarget}
      circles={circles}
      saving={linking}
      close={() => setLinkTarget(null)}
      save={(circleId, enableRecording) => void saveLink(circleId, enableRecording)}
    />}

    {createOpen && <CreateEventDialog
      circles={circles}
      today={cairoDayKey(new Date())}
      saving={creating}
      close={() => setCreateOpen(false)}
      save={(input) => void createEvent(input)}
    />}
  </motion.section>
}
