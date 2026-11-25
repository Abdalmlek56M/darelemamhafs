import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Copy, Database, LockKeyhole, Pencil, Plus, Search, Trash2, UserRound, Users } from 'lucide-react'
import { formatDate, money } from '../lib/formatters'
import { statusLabels } from '../domain/labels'
import type { StudentStatus } from '../domain/types'
import Empty from '../components/common/EmptyState'
import ResponsiveTable, { type ResponsiveColumn } from '../components/common/ResponsiveTable'
import type { DarApplicationContext } from '../application/useDarApplication'


type Props = { ctx: DarApplicationContext }

const PAGE_SIZE = 25

export default function StudentsPage({ ctx }: Props) {
  const [page, setPage] = useState(1)
  const rows = ctx.has('students.read') ? ctx.filteredStudents : []
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage],
  )

  useEffect(() => { setPage(1) }, [ctx.query, ctx.statusFilter])
  useEffect(() => { setPage((current) => Math.min(current, pageCount)) }, [pageCount])

  const columns: ResponsiveColumn<(typeof rows)[number]>[] = [
    {
      key: 'student', header: 'الطالب', primary: true,
      render: (student) => <button className="text-link student-name-link" onClick={() => void ctx.openHistory(student.id)}>
        <span className="student-avatar"><UserRound size={17}/></span>
        <span><strong>{student.fullName}</strong><small>{student.studentCode}</small></span>
      </button>,
    },
    { key: 'age', header: 'العمر', render: (student) => student.ageYears == null ? '—' : student.ageYears + ' سنة' },
    {
      key: 'phone', header: 'الهاتف',
      render: (student) => <>{student.phone || '—'}{student.guardianPhone && <small className="sub-cell">ولي الأمر: <span dir="ltr">{student.guardianPhone}</span></small>}</>,
    },
    {
      key: 'circle', header: 'الحلقة',
      render: (student) => student.circleNames
        ? (ctx.has('circles.read')
          ? <button className="text-link circle-link" onClick={() => { const first = student.circleNames.split('، ')[0]; const match = ctx.circles.find((item) => item.name === first); if (match) void ctx.openCircleDetails(match); else ctx.changePage('circles') }}>{student.circleNames}</button>
          : <span>{student.circleNames}</span>)
        : <span className="muted-text">غير ملتحق</span>,
    },
    {
      key: 'payment', header: 'تحصيل الشهر',
      render: (student) => ctx.has('finance.read')
        ? <><span className={`status-pill pay-${student.currentMonthPaymentStatus ?? 'not-set'}`}>{student.currentMonthPaymentStatus === 'not-set' ? 'لم يُحدد الاستحقاق' : student.currentMonthPaymentStatus === 'paid' ? 'دافع بالكامل' : student.currentMonthPaymentStatus === 'partial' ? 'دفع جزئيًا' : student.currentMonthPaymentStatus === 'unpaid' ? 'لم يدفع' : '—'}</span>
          <small className="sub-cell">{money(student.currentMonthPaid)} / {money(student.currentMonthDue)}</small></>
        : <span className="muted-text">مقيد بصلاحية المالية</span>,
    },
    { key: 'joined', header: 'الالتحاق', render: (student) => formatDate(student.joinedOn) },
    { key: 'status', header: 'الحالة', render: (student) => <span className={`status-pill status-${student.status}`}>{statusLabels[student.status]}</span> },
  ]

  return <motion.section key="students" className="students-page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
    <div className="page-toolbar">
      <div className="toolbar-copy">
        <h2>سجل الطلاب</h2>
        <p>اضغط على اسم الطالب لعرض تاريخه الكامل، أو على اسم الحلقة لفتح سجلها.</p>
      </div>
      <div className="toolbar-actions">{ctx.has('students.create') && <button className="primary-button" onClick={ctx.openStudentCreate}><Plus size={17}/> إضافة طالب</button>}</div>
    </div>
    <div className="student-filters glass">
      <label className="search-field">
        <Search size={17}/>
        <input value={ctx.query} onChange={(event) => { ctx.setQuery(event.target.value); setPage(1) }} placeholder="ابحث بالاسم أو الكود أو الهاتف أو الحلقة…"/>
      </label>
      <div className="status-filters">
        {([{ value: 'all', label: 'الكل' }, { value: 'active', label: 'نشط' }, { value: 'paused', label: 'متوقف' }, { value: 'withdrawn', label: 'منسحب' }, { value: 'archived', label: 'مؤرشف' }] as const).map((filter) =>
          <button key={filter.value} className={ctx.statusFilter === filter.value ? 'filter-chip selected' : 'filter-chip'} onClick={() => { ctx.setStatusFilter(filter.value); setPage(1) }}>{filter.label}</button>)}
      </div>
    </div>
    <div className="table-card glass">
      <div className="table-heading">
        <div>
          <h3>الطلاب المسجلون</h3>
          <span>{ctx.has('students.read') ? rows.length + ' سجل · حالة تحصيل الشهر الحالي' : 'لا تملك صلاحية عرض قائمة الطلاب'}</span>
        </div>
        <span className="table-heading-note"><Database size={14}/> حفظ مباشر</span>
      </div>
      <ResponsiveTable
        caption="قائمة الطلاب"
        rows={pageRows}
        columns={columns}
        rowKey={(student) => student.id}
        empty={ctx.has('students.read')
          ? <Empty icon={<Users size={25}/>} title={ctx.students.length ? 'لا توجد نتائج مطابقة' : 'لا يوجد طلاب حتى الآن'} text={ctx.students.length ? 'غيّر البحث أو فلتر الحالة.' : 'ابدأ بإضافة الطلاب وربطهم بالحلقات عند الحاجة.'}/>
          : <Empty icon={<LockKeyhole size={22}/>} title="عرض السجلات غير مسموح" text="يمكنك تنفيذ العمليات التي منحك المدير صلاحيتها، لكن لا يمكنك تصفح سجل الطلاب."/>}
        actions={(student) => <>
          {ctx.has('students.edit') && <button className="small-icon-button" title="تعديل" onClick={() => ctx.openStudentEdit(student)}><Pencil size={15}/></button>}
          {ctx.has('students.edit') && student.status === 'active' && <button className="small-icon-button" title="إلحاق بحلقة" onClick={() => ctx.openEnrollmentCreate(student.id, '', 0)}><BookOpen size={15}/></button>}
          {ctx.has('students.create') && <button className="small-icon-button" title="تكرار بيانات الطالب لإنشاء سجل مستقل" aria-label={`نسخ بيانات ${student.fullName} لإنشاء سجل مستقل`} onClick={() => ctx.duplicateStudent(student)}><Copy size={15}/></button>}
          {ctx.has('students.delete') && ctx.has('trash.manage') && <button className="small-icon-button danger-action" title="نقل إلى سلة المهملات" onClick={() => void ctx.deleteStudent(student)}><Trash2 size={15}/></button>}
          <select className="inline-status-select" title="الانسحاب النهائي ينهي جميع التحاقات الطالب. الإيقاف الإداري لا يوقف التحاقات الحلقات." aria-label={`حالة ${student.fullName}`} value={student.status} disabled={!ctx.has('students.edit')} onChange={(event) => void ctx.changeStudentStatus(student, event.target.value as StudentStatus)}>
            {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{String(label)}</option>)}
          </select>
        </>}
      />
      {rows.length > PAGE_SIZE && (
        <div className="student-pagination" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '12px 14px', borderTop: '1px solid var(--line)' }}>
          <button type="button" className="secondary-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1} aria-label="الصفحة السابقة">السابق</button>
          <span style={{ color: 'var(--muted)', fontSize: 12 }} aria-live="polite">صفحة {safePage} من {pageCount} · {rows.length} سجل</span>
          <button type="button" className="secondary-button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={safePage >= pageCount} aria-label="الصفحة التالية">التالي</button>
        </div>
      )}
    </div>
  </motion.section>
}