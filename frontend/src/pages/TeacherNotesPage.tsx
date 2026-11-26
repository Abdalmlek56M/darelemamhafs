import { useCallback, useEffect, useMemo, useState } from 'react'
import { Megaphone, MessageSquareText, RefreshCw } from 'lucide-react'
import { api } from '../system/api'
import { requestPage } from '../services/apiClient'
import Pager from '../components/common/Pager'
import { ADMIN_PAGE_SIZE } from '../lib/pagination'
import type { AdminTeacherNote, AdminTeacherNotesResponse } from '../system/types'

type Kind = 'all' | 'session' | 'student'

function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export default function TeacherNotesPage() {
  const [data, setData] = useState<AdminTeacherNotesResponse | null>(null)
  const [kind, setKind] = useState<Kind>('all')
  const [teacherId, setTeacherId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const load = useCallback(async (nextKind: Kind, nextTeacherId: string, requestedPage = page) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (nextKind !== 'all') params.set('kind', nextKind)
      if (nextTeacherId) params.set('teacherId', nextTeacherId)
      params.set('page', String(requestedPage))
      params.set('pageSize', String(ADMIN_PAGE_SIZE))
      const response = await requestPage<AdminTeacherNotesResponse>(`/api/admin/teacher-notes?${params.toString()}`, undefined, ADMIN_PAGE_SIZE)
      setData(response.data)
      setTotal(response.meta.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل ملاحظات المعلمات.')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { void load(kind, teacherId, page) }, [kind, teacherId, page, load])

  const notes = data?.notes ?? []
  const teachers = data?.teachers ?? []
  const teacherOptions = useMemo(() => [...teachers].sort((a, b) => a.name.localeCompare(b.name, 'ar')), [teachers])

  return (
    <section className="admin-insights-page">
      <div className="page-toolbar">
        <div className="toolbar-copy">
          <h2>ملاحظات المعلمات</h2>
          <p>ملاحظات الحصص وملاحظات الطالبات التي كتبتها المعلمات أثناء الحضور، مع إمكانية التصفية حسب النوع أو المعلمة.</p>
        </div>
        <div className="toolbar-actions">
          <button className="secondary-button" onClick={() => void load(kind, teacherId)} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : undefined} /> تحديث
          </button>
        </div>
      </div>

      {data?.banner && <div className="admin-notes-banner"><Megaphone size={17} /><div><strong>الرسالة المنشورة للمشرفات</strong><p>{data.banner}</p></div></div>}

      <div className="admin-insight-toolbar">
        <div className="admin-insight-segment">
          {(['all', 'session', 'student'] as const).map((value) => (
            <button key={value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>
              {value === 'all' ? 'الكل' : value === 'session' ? 'ملاحظات الحصص' : 'ملاحظات الطالبات'}
            </button>
          ))}
        </div>
        <label className="admin-notes-teacher-filter">
          <span>المعلمة</span>
          <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
            <option value="">كل المعلمات</option>
            {teacherOptions.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select>
        </label>
        <span className="admin-insight-count">{notes.length} ملاحظة</span>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(kind, teacherId)}>إعادة المحاولة</button></div>}
      {loading && notes.length === 0 && <div className="empty-inline">جارٍ تحميل الملاحظات…</div>}
      {!loading && notes.length === 0 && <div className="empty-inline">لا توجد ملاحظات في هذا التصنيف.</div>}

      {notes.length > 0 && (
        <div className="system-panel glass admin-notes-panel">
          <div className="table-scroll">
            <table className="students-table wide-table admin-notes-table">
              <thead><tr><th>التاريخ</th><th>المعلمة</th><th>الحلقة</th><th>النوع</th><th>الطالبة</th><th>الملاحظة</th></tr></thead>
              <tbody>
                {notes.map((item, index) => (
                  <tr key={`${item.date}-${item.teacherId}-${index}`}>
                    <td>{dateLabel(item.date)}</td>
                    <td><strong>{item.teacherName}</strong></td>
                    <td>{item.circleName}</td>
                    <td><span className={`admin-note-kind kind-${item.kind}`}><MessageSquareText size={12} /> {item.kind === 'session' ? 'حصة' : 'طالبة'}</span></td>
                    <td>{item.studentName ? <>{item.studentName}<small className="sub-cell">{item.studentCode}</small></> : '—'}</td>
                    <td className="admin-note-text">{item.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pager page={page} pageSize={ADMIN_PAGE_SIZE} total={total} onPageChange={setPage} label="ملاحظة" />
      <div className="admin-note-cards">
        {notes.map((item: AdminTeacherNote, index) => (
          <article className="admin-note-card" key={`${item.date}-${item.teacherId}-${index}`}>
            <div className="admin-note-card-head">
              <span className={`admin-note-kind kind-${item.kind}`}><MessageSquareText size={12} /> {item.kind === 'session' ? 'ملاحظة حصة' : 'ملاحظة طالبة'}</span>
              <time>{dateLabel(item.date)}</time>
            </div>
            <strong>{item.teacherName} · {item.circleName}</strong>
            {item.studentName && <small>{item.studentName} {item.studentCode ? `(${item.studentCode})` : ''}</small>}
            <p>{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  )
}