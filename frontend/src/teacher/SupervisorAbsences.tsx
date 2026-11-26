import { useCallback, useState } from 'react'
import { CalendarDays, Phone, RefreshCw, UserRound, Users } from 'lucide-react'
import { teacherApi } from './teacherApi'
import type { SupervisorAbsencesResponse } from './teacherTypes'
import { dateLabel, statusLabel, statusTone, todayCairo, formatTime12 } from './supervisorFormat'
import { demoAbsences } from './supervisorDemo'
import Pager from '../components/common/Pager'
import { usePagedResource, type PagedPage } from '../hooks/usePagedResource'
import { defaultMeta } from '../lib/pagination'
import WhatsAppButton from './WhatsAppButton'

type Props = { demo: boolean; onOpenTeacher?: (id: string) => void; onOpenCircle?: (id: string) => void; canCommunicate?: boolean }

export default function SupervisorAbsences({ demo, onOpenTeacher, onOpenCircle, canCommunicate = false }: Props) {
  const [date, setDate] = useState(todayCairo())

  const fetchAbsences = useCallback(async (page: number, pageSize: number): Promise<PagedPage<SupervisorAbsencesResponse>> => {
    if (demo) return { items: [demoAbsences], meta: defaultMeta(demoAbsences.absences.length, 1, pageSize) }
    const response = await teacherApi.supervisorAbsencesPage({ date, page, pageSize }); return { items: [response.data], meta: response.meta }
  }, [demo, date])
  const absencesPage = usePagedResource({ fetcher: fetchAbsences, deps: [demo, date] })
  const data = absencesPage.items[0] ?? null
  const teachers = data?.teachers ?? []
  const students = data?.absences ?? []

  return (
    <div className="sup-page">
      <div className="sup-page-head">
        <div><span className="sup-eyebrow">متابعة يومية</span><h1>الغياب</h1><p>المعلمات التي لم تسجل والطالبات الغائبات في يوم واحد.</p></div>
        <div className="sup-head-actions">
          <label className="sup-date"><CalendarDays size={16} /><input type="date" value={date} max={todayCairo()} onChange={(event) => setDate(event.target.value || todayCairo())} /></label>
          <button className="sup-icon-button" onClick={absencesPage.reload} disabled={absencesPage.loading} aria-label="تحديث"><RefreshCw size={18} /></button>
        </div>
      </div>

      {absencesPage.error && <div className="t-error-card"><p>{absencesPage.error}</p><button className="t-secondary" onClick={absencesPage.reload}>إعادة المحاولة</button></div>}

      <div className="sup-kpi-grid sup-kpi-grid-three">
        <div className="sup-kpi"><span className="sup-kpi-icon is-warn"><Users size={18} /></span><span>معلمات لم يسجلن</span><strong>{teachers.length}</strong><small>{dateLabel(date)}</small></div>
        <div className="sup-kpi"><span className="sup-kpi-icon"><UserRound size={18} /></span><span>طالبات غائبات</span><strong>{absencesPage.meta.total}</strong><small>{students.filter((item) => item.status === 'excused').length} بعذر في هذه الصفحة</small></div>
        <div className="sup-kpi"><span className="sup-kpi-icon"><CalendarDays size={18} /></span><span>إجمالي المتابعات</span><strong>{teachers.length + absencesPage.meta.total}</strong><small>تحتاج إجراء</small></div>
      </div>

      <section className="sup-panel">
        <div className="sup-panel-head"><div><h2>معلمات لم يسجلن</h2><span>{teachers.length}</span></div></div>
        {absencesPage.loading && teachers.length === 0 && <p className="sup-muted">جارٍ التحميل…</p>}
        {!absencesPage.loading && teachers.length === 0 && <p className="sup-muted">لا توجد معلمات متأخرات عن التسجيل.</p>}
        <div className="sup-list">
          {teachers.map((item) => (
            <div className="sup-row" key={`${item.scheduleSlotId}-${formatTime12(item.startsAt)}`}>
              <span className="sup-kpi-icon is-warn"><Users size={16} /></span>
              <div className="sup-row-copy"><strong><button className="sup-link" onClick={() => onOpenTeacher?.(item.teacherId)}>{item.teacherName}</button></strong><small><button className="sup-link" onClick={() => onOpenCircle?.(item.circleId)}>{item.circleName}</button> · {formatTime12(item.startsAt)} · {item.durationMinutes} دقيقة</small></div>
              {item.phone && <span className="sup-phone" dir="ltr"><Phone size={12} /> {item.phone}</span>}
              <WhatsAppButton recipientType="teacher" recipientId={item.teacherId} templateKey="absence" canCommunicate={canCommunicate} demo={demo} />
              <span className="t-badge t-badge-bad">لم تسجل</span>
            </div>
          ))}
        </div>
      </section>

      <section className="sup-panel">
        <div className="sup-panel-head"><div><h2>طالبات غائبات</h2><span>{absencesPage.meta.total}</span></div></div>
        {absencesPage.loading && students.length === 0 && <p className="sup-muted">جارٍ التحميل…</p>}
        {!absencesPage.loading && students.length === 0 && <p className="sup-muted">لا يوجد غياب مسجل في هذا اليوم.</p>}
        <div className="sup-list">
          {students.map((item) => (
            <div className="sup-row" key={item.attendanceId}>
              <span className="sup-kpi-icon"><UserRound size={16} /></span>
              <div className="sup-row-copy"><strong>{item.studentName}</strong><small>{item.circleName} · {item.teacherName} · {item.studentCode}</small>{item.note && <small>{item.note}</small>}</div>
              {item.guardianPhone && <span className="sup-phone" dir="ltr"><Phone size={12} /> {item.guardianPhone}</span>}
              <WhatsAppButton recipientType="student_guardian" recipientId={item.studentId} templateKey="absence" canCommunicate={canCommunicate} demo={demo} />
              <span className={statusTone(item.status)}>{statusLabel(item.status)}</span>
            </div>
          ))}
        </div>
        <Pager
          page={absencesPage.page}
          pageSize={absencesPage.pageSize}
          total={absencesPage.meta.total}
          onPageChange={absencesPage.setPage}
          buttonClassName="t-secondary"
          label="غياب"
        />
      </section>

      <p className="sup-footnote">الغياب يظهر بعد انتهاء وقت الحلقة. النطاق يحدد المعلمات والطالبات الظاهرة.</p>
    </div>
  )
}
