import { ArrowRight, RefreshCw, Wallet } from 'lucide-react'
import type { SubscriptionsResponse } from './teacherTypes'
import { money } from './teacherFormat'

type Props = {
  data: SubscriptionsResponse | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onBack: () => void
}

const labels: Record<string, string> = {
  paid: 'مدفوع',
  partial: 'جزئي',
  unpaid: 'غير مدفوع',
  'not-set': 'لم يُحدد',
}

export default function TeacherSubscriptions({ data, loading, error, onRefresh, onBack }: Props) {
  return (
    <div className="t-page">
      <header className="t-subheader">
        <button className="t-icon-button" aria-label="رجوع" onClick={onBack}><ArrowRight size={20} /></button>
        <div><span className="t-eyebrow">متابعة اشتراكات طالباتي</span><h1>الاشتراكات</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={onRefresh} disabled={loading}><RefreshCw size={18} /></button>
      </header>

      <p className="t-hint">تعرض هذه الشاشة حالة السداد والمتبقي لطالباتك فقط. لا تعرض إيصالات أو حركات مالية إدارية.</p>
      {loading && !data && <div className="t-empty">جارٍ تحميل الاشتراكات…</div>}
      {error && <p className="t-error">{error}</p>}
      {data?.students.length === 0 && <div className="t-empty">لا توجد طالبات نشطات في حلقاتك.</div>}

      <div className="t-list">
        {data?.students.map((student) => (
          <div className="t-sub-row" key={`${student.studentCode}-${student.circleName}`}>
            <span className="t-avatar"><Wallet size={16} /></span>
            <div className="t-row-copy">
              <strong>{student.studentName}</strong>
              <small>{student.circleName} · {student.studentCode}</small>
              <small>انضمت {student.joinedOn}</small>
            </div>
            <div className="t-sub-amount">
              <span className={`t-badge ${student.status === 'paid' ? 't-badge-ok' : student.status === 'unpaid' ? 't-badge-bad' : 't-badge-gold'}`}>{labels[student.status]}</span>
              <strong>{student.balance === null ? '—' : money(student.balance)}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
