import { useCallback, useState } from 'react'
import { MessageSquareText, Megaphone, RefreshCw } from 'lucide-react'
import { teacherApi } from './teacherApi'
import type { SupervisorTeacherNote } from './teacherTypes'
import { dateLabel } from './supervisorFormat'
import { demoTeacherNotes } from './supervisorDemo'
import Pager from '../components/common/Pager'
import { usePagedResource } from '../hooks/usePagedResource'
import { defaultMeta } from '../lib/pagination'

type Props = { demo: boolean }
type Filter = 'all' | 'session' | 'student'

export default function SupervisorTeacherNotes({ demo }: Props) {
  const [banner, setBanner] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const fetchNotes = useCallback(async (page: number, pageSize: number) => {
    if (demo) {
      const rows = filter === 'all' ? demoTeacherNotes : demoTeacherNotes.filter((item) => item.kind === filter)
      setBanner('يُرجى كتابة ملاحظة واضحة لكل طالبة قبل إنهاء الحصة. هذه رسالة تجريبية يتحكم بها مدير الدار من الإعدادات.')
      return { items: rows, meta: defaultMeta(rows.length, 1, pageSize) }
    }
    const response = await teacherApi.supervisorTeacherNotesPage({ kind: filter, page, pageSize })
    setBanner(response.data.banner)
    return { items: response.data.notes, meta: response.meta }
  }, [demo, filter])
  const notesPage = usePagedResource<SupervisorTeacherNote>({ fetcher: fetchNotes, deps: [demo, filter] })
  const notes = notesPage.items

  return (
    <div className="sup-page">
      <div className="sup-page-head">
        <div><span className="sup-eyebrow">متابعة تعليمية</span><h1>ملاحظات المعلمات</h1><p>ملاحظات الحصص وملاحظات الطالبات التي كتبتها المعلمات أثناء الحضور.</p></div>
        <button className="sup-icon-button" onClick={notesPage.reload} disabled={notesPage.loading} aria-label="تحديث"><RefreshCw size={18} /></button>
      </div>

      {banner && <div className="sup-notes-banner"><Megaphone size={16} /><p>{banner}</p></div>}

      <div className="sup-segment">
        {(['all', 'session', 'student'] as const).map((value) => (
          <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
            {value === 'all' ? 'الكل' : value === 'session' ? 'ملاحظات الحصص' : 'ملاحظات الطالبات'}
          </button>
        ))}
      </div>

      {notesPage.error && <div className="t-error-card"><p>{notesPage.error}</p><button className="t-secondary" onClick={notesPage.reload}>إعادة المحاولة</button></div>}
      {notesPage.loading && notes.length === 0 && <div className="t-empty">جارٍ تحميل الملاحظات…</div>}
      {!notesPage.loading && notes.length === 0 && <div className="t-empty">لا توجد ملاحظات معلمات في هذا التصنيف.</div>}

      <div className="sup-table-wrap">
        <table className="sup-table">
          <thead><tr><th>التاريخ</th><th>المعلمة</th><th>الحلقة</th><th>النوع</th><th>الطالبة</th><th>الملاحظة</th></tr></thead>
          <tbody>
            {notes.map((item) => (
              <tr key={item.id}>
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
        {notes.map((item) => (
          <article className="sup-card" key={item.id}>
            <span className="sup-kpi-icon"><MessageSquareText size={16} /></span>
            <div className="sup-row-copy">
              <strong>{item.teacherName} · {item.circleName}</strong>
              <small>{dateLabel(item.date)} · {item.kind === 'session' ? 'ملاحظة حصة' : `ملاحظة الطالبة ${item.studentName ?? ''}`}</small>
              <small>{item.note}</small>
            </div>
          </article>
        ))}
      </div>

      <Pager
        page={notesPage.page}
        pageSize={notesPage.pageSize}
        total={notesPage.meta.total}
        onPageChange={notesPage.setPage}
        buttonClassName="t-secondary"
        label="ملاحظة"
      />
    </div>
  )
}
