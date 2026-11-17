import { useCallback, useEffect, useState } from 'react'
import { MessageSquareText, RefreshCw } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorTeacherNote } from './teacherTypes'
import { dateLabel } from './supervisorFormat'
import { demoTeacherNotes } from './supervisorDemo'

type Props = { demo: boolean }
type Filter = 'all' | 'session' | 'student'

export default function SupervisorTeacherNotes({ demo }: Props) {
  const [notes, setNotes] = useState<SupervisorTeacherNote[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (kind: Filter) => {
    if (demo) {
      setNotes(kind === 'all' ? demoTeacherNotes : demoTeacherNotes.filter((item) => item.kind === kind))
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await teacherApi.supervisorTeacherNotes(kind)
      setNotes(data.notes)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل ملاحظات المعلمات.')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => { void load(filter) }, [filter, load])

  return (
    <div className="sup-page">
      <div className="sup-page-head">
        <div><span className="sup-eyebrow">متابعة تعليمية</span><h1>ملاحظات المعلمات</h1><p>ملاحظات الحصص وملاحظات الطالبات التي كتبتها المعلمات أثناء الحضور.</p></div>
        <button className="sup-icon-button" onClick={() => void load(filter)} disabled={loading} aria-label="تحديث"><RefreshCw size={18} /></button>
      </div>

      <div className="sup-segment">
        {(['all', 'session', 'student'] as const).map((value) => (
          <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
            {value === 'all' ? 'الكل' : value === 'session' ? 'ملاحظات الحصص' : 'ملاحظات الطالبات'}
          </button>
        ))}
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(filter)}>إعادة المحاولة</button></div>}
      {loading && notes.length === 0 && <div className="t-empty">جارٍ تحميل الملاحظات…</div>}
      {!loading && notes.length === 0 && <div className="t-empty">لا توجد ملاحظات معلمات في هذا التصنيف.</div>}

      <div className="sup-table-wrap">
        <table className="sup-table">
          <thead><tr><th>التاريخ</th><th>المعلمة</th><th>الحلقة</th><th>النوع</th><th>الطالبة</th><th>الملاحظة</th></tr></thead>
          <tbody>
            {notes.map((item, index) => (
              <tr key={`${item.date}-${index}`}>
                <td>{dateLabel(item.date)}</td>
                <td>{item.teacherName}</td>
                <td>{item.circleName}</td>
                <td><span className="t-badge t-badge-muted"><MessageSquareText size={11} /> {item.kind === 'session' ? 'حصة' : 'طالبة'}</span></td>
                <td>{item.studentName ?? '—'}</td>
                <td className="sup-note-cell">{item.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sup-card-list">
        {notes.map((item, index) => (
          <article className="sup-card" key={`${item.date}-${index}`}>
            <span className="sup-kpi-icon"><MessageSquareText size={16} /></span>
            <div className="sup-row-copy">
              <strong>{item.teacherName} · {item.circleName}</strong>
              <small>{dateLabel(item.date)} · {item.kind === 'session' ? 'ملاحظة حصة' : `ملاحظة الطالبة ${item.studentName ?? ''}`}</small>
              <small>{item.note}</small>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
