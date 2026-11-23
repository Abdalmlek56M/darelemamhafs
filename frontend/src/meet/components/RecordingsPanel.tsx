import { useCallback, useEffect, useState } from 'react'
import { Download, Film, Play, RefreshCw, Video } from 'lucide-react'
import Modal from '../../components/common/Modal'
import Empty from '../../components/common/EmptyState'
import { meetApi } from '../meetApi'
import { cairoDateTime } from '../format'
import type { MeetSession } from '../types'

type Props = { canView: boolean }

const statusLabels: Record<string, string> = {
  live: 'جارية الآن',
  finalizing: 'قيد المعالجة',
  uploading: 'جارٍ الرفع',
  ready: 'جاهزة',
  partial: 'جزئية',
  failed: 'فاشلة',
}

function statusClass(status: string) {
  if (status === 'ready') return 'status-pill status-active'
  if (status === 'failed') return 'status-pill status-archived'
  return 'status-pill pay-partial'
}

function durationLabel(seconds: number | null) {
  if (!seconds || seconds <= 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function sizeLabel(bytes: number | null) {
  if (!bytes) return '—'
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

/** Lists finished recordings with an inline player and a download action. */
export default function RecordingsPanel({ canView }: Props) {
  const [sessions, setSessions] = useState<MeetSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<MeetSession | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await meetApi.sessions()
      setSessions(response.sessions)
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'تعذّر تحميل التسجيلات.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (!canView) {
    return <section className="panel glass meet-events-panel">
      <Empty icon={<Video size={24} />} title="لا تملك صلاحية المشاهدة"
        text="صلاحية meet.media.view مطلوبة لمشاهدة تسجيلات الحلقات." />
    </section>
  }

  return <section className="panel glass meet-events-panel">
    <div className="meet-filters">
      <div className="toolbar-copy">
        <h2 style={{ fontSize: 14, margin: 0 }}>تسجيلات الحلقات</h2>
        <p style={{ margin: 0 }}>مشاهدة الملفات المسجّلة وتحميلها — الملفات الأصلية تبقى على السيرفر حتى الحذف اليدوي.</p>
      </div>
      <div className="toolbar-actions">
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} /> تحديث
        </button>
      </div>
    </div>

    {error && <p className="meet-page-error" role="alert">{error}</p>}

    {loading && sessions.length === 0 && <p className="meet-muted">جارٍ تحميل التسجيلات…</p>}

    {!loading && sessions.length === 0 && <Empty icon={<Film size={24} />} title="لا توجد تسجيلات بعد"
      text="أول حصة تُسجَّل ستظهر هنا مع مدتها وحجمها ورابط المشاهدة." />}

    <div className="meet-sessions">
      {sessions.map((session) => <article key={session.id} className="meet-session-card">
        <div className="meet-session-poster">
          {session.posterUrl
            ? <img src={session.posterUrl} alt="" loading="lazy" />
            : <Film size={22} />}
        </div>
        <div className="meet-session-body">
          <strong>{session.summary ?? 'تسجيل بدون عنوان'}</strong>
          <span className="meet-muted">
            {session.circleName ?? 'بدون حلقة'} · {cairoDateTime(session.startedAt)}
          </span>
          <span className="meet-session-meta">
            <span className={statusClass(session.status)}>{statusLabels[session.status] ?? session.status}</span>
            <span className="meet-muted">المدة {durationLabel(session.durationSeconds)}</span>
            <span className="meet-muted">{sizeLabel(session.sizeBytes)}</span>
            {session.uploadedToDrive && <span className="meet-muted">مرفوع لـDrive</span>}
          </span>
        </div>
        <div className="meet-session-actions">
          <button type="button" className="primary-button" disabled={!session.streamUrl}
            onClick={() => setPlaying(session)}>
            <Play size={15} /> تشغيل
          </button>
          {session.streamUrl && <a className="secondary-button" href={`${session.streamUrl}?download=true`}>
            <Download size={15} /> تحميل
          </a>}
        </div>
      </article>)}
    </div>

    {playing && playing.streamUrl && <Modal
      title={playing.summary ?? 'تسجيل الحصة'}
      subtitle={`${playing.circleName ?? 'بدون حلقة'} · ${cairoDateTime(playing.startedAt)}`}
      wide
      close={() => setPlaying(null)}
    >
      <video
        className="meet-player"
        src={playing.streamUrl}
        poster={playing.posterUrl ?? undefined}
        controls
        autoPlay
        playsInline
      />
    </Modal>}
  </section>
}
