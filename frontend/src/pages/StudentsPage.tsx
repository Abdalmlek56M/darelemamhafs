import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Copy, Database, LockKeyhole, Pencil, Plus, Search, Trash2, UserRound, Users } from 'lucide-react'
import { formatDate, money } from '../lib/formatters'
import { statusLabels } from '../domain/labels'
import type { Student, StudentStatus } from '../domain/types'
import Empty from '../components/common/EmptyState'
import Pager from '../components/common/Pager'
import ResponsiveTable, { type ResponsiveColumn } from '../components/common/ResponsiveTable'
import { requestPage } from '../services/apiClient'
import { usePagedResource } from '../hooks/usePagedResource'
import { ADMIN_PAGE_SIZE } from '../lib/pagination'
import { buildListQuery } from '../lib/listQuery'
import type { DarApplicationContext } from '../application/useDarApplication'

type Props = { ctx: DarApplicationContext }

export default function StudentsPage({ ctx }: Props) {
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | StudentStatus>('all')

  const fetchStudents = useCallback(async (page: number, pageSize: number) => {
    const query = buildListQuery({
      page,
      pageSize,
      search: appliedSearch,
      status: statusFilter === 'all' ? '' : statusFilter,
    })
    const response = await requestPage<Student[]>(`/api/students${query}`, undefined, ADMIN_PAGE_SIZE)
    return { items: response.data, meta: response.meta }
  }, [appliedSearch, statusFilter])
  const studentsPage = usePagedResource<Student>({
    fetcher: fetchStudents,
    deps: [appliedSearch, statusFilter],
    pageSize: ADMIN_PAGE_SIZE,
  })
  const rows = ctx.has('students.read') ? studentsPage.items : []

  const columns: ResponsiveColumn<Student>[] = [
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
        ? <span>{student.circleNames}</span>
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
        <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setAppliedSearch(search.trim()) }} placeholder="ابحث بالاسم أو الكود أو الهاتف…"/>
      </label>
      <button type="button" className="secondary-button" onClick={() => setAppliedSearch(search.trim())}>بحث</button>
      <div className="status-filters">
        {([{ value: 'all', label: 'الكل' }, { value: 'active', label: 'نشط' }, { value: 'paused', label: 'متوقف' }, { value: 'withdrawn', label: 'منسحب' }] as const).map((filter) =>
          <button key={filter.value} className={statusFilter === filter.value ? 'filter-chip selected' : 'filter-chip'} onClick={() => setStatusFilter(filter.value)}>{filter.label}</button>)}
      </div>
    </div>
    <div className="table-card glass">
      <div className="table-heading">
        <div>
          <h3>الطلاب المسجلون</h3>
          <span>{ctx.has('students.read') ? studentsPage.meta.total + ' سجل · حالة تحصيل الشهر الحالي' : 'لا تملك صلاحية عرض قائمة الطلاب'}</span>
        </div>
        <span className="table-heading-note"><Database size={14}/> تحميل بصفحات</span>
      </div>
      <ResponsiveTable
        caption="قائمة الطلاب"
        rows={rows}
        columns={columns}
        rowKey={(student) => student.id}
        empty={ctx.has('students.read')
          ? <Empty icon={<Users size={25}/>} title={studentsPage.meta.total ? 'لا توجد نتائج مطابقة' : 'لا يوجد طلاب حتى الآن'} text={studentsPage.meta.total ? 'غيّر البحث أو فلتر الحالة.' : 'ابدأ بإضافة الطلاب وربطهم بالحلقات عند الحاجة.'}/>
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
      <Pager
        page={studentsPage.page}
        pageSize={studentsPage.pageSize}
        total={studentsPage.meta.total}
        onPageChange={studentsPage.setPage}
        label="سجل"
      />
    </div>
    <p className="page-footnote"><Database size={14}/> يتم تحميل صفحة واحدة من السيرفر؛ البحث والفلترة يطبقان قبل العدّ.</p>
  </motion.section>
}
