import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock3, GraduationCap, LockKeyhole, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { money } from '../lib/formatters'
import { teacherStatusLabels } from '../domain/labels'
import type { Teacher, TeacherStatus } from '../domain/types'
import Empty from '../components/common/EmptyState'
import Pager from '../components/common/Pager'
import ResponsiveTable, { type ResponsiveColumn } from '../components/common/ResponsiveTable'
import { requestPage } from '../services/apiClient'
import { usePagedResource } from '../hooks/usePagedResource'
import { ADMIN_PAGE_SIZE } from '../lib/pagination'
import { buildListQuery } from '../lib/listQuery'
import type { DarApplicationContext } from '../application/useDarApplication'

type Props = { ctx: DarApplicationContext }

export default function TeachersPage({ ctx }: Props) {
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | TeacherStatus>('all')

  const fetchTeachers = useCallback(async (page: number, pageSize: number) => {
    const query = buildListQuery({
      page,
      pageSize,
      search: appliedSearch,
      status: statusFilter === 'all' ? '' : statusFilter,
    })
    const response = await requestPage<Teacher[]>(`/api/teachers${query}`, undefined, ADMIN_PAGE_SIZE)
    return { items: response.data, meta: response.meta }
  }, [appliedSearch, statusFilter])
  const teachersPage = usePagedResource<Teacher>({
    fetcher: fetchTeachers,
    deps: [appliedSearch, statusFilter],
    pageSize: ADMIN_PAGE_SIZE,
  })
  const rows = ctx.has('teachers.read') ? teachersPage.items : []

  const columns: ResponsiveColumn<Teacher>[] = [
    {
      key: 'teacher', header: 'المعلمة', primary: true,
      render: (teacher) => <button type="button" className="text-link teacher-name-link" title="فتح ملف المعلمة وتفاصيلها" onClick={() => void ctx.openTeacherDetails(teacher)}>
        <span className="student-avatar"><GraduationCap size={17}/></span>
        <span><strong>{teacher.fullName}</strong><small>{teacher.teacherCode} · فتح الملف</small></span>
      </button>,
    },
    { key: 'phone', header: 'الهاتف', ltr: true, render: (teacher) => teacher.phone || '—' },
    ...(ctx.has('finance.read') ? [{
      key: 'rate', header: 'أجر الساعة',
      render: (teacher: Teacher) => <><strong>{money(teacher.hourlyRate)}</strong><small className="sub-cell">لكل ساعة</small></>,
    }] : []),
    {
      key: 'circles', header: 'الحلقات المسندة',
      render: (teacher) => <><span>{teacher.circleNames || 'غير مسندة لحلقات'}</span><small className="sub-cell">{teacher.circleCount} حلقة مسندة</small></>,
    },
    {
      key: 'status', header: 'الحالة',
      render: (teacher) => <span className={`status-pill ${teacher.status === 'active' ? 'status-active' : teacher.status === 'inactive' ? 'status-paused' : 'status-archived'}`}>{teacherStatusLabels[teacher.status]}</span>,
    },
  ]

  return <motion.section key="teachers" className="students-page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
    <div className="page-toolbar">
      <div className="toolbar-copy">
        <h2>المعلمات</h2>
        <p>حدد أجر الساعة لكل معلمة، واربط بها أي عدد من الحلقات.</p>
      </div>
      <div className="toolbar-actions">{ctx.has('teachers.create') && <button className="primary-button" onClick={ctx.openTeacherCreate}><Plus size={17}/> إضافة معلمة</button>}</div>
    </div>
    <div className="student-filters glass">
      <label className="search-field">
        <Search size={17}/>
        <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setAppliedSearch(search.trim()) }} placeholder="ابحث باسم المعلمة أو الهاتف…"/>
      </label>
      <button type="button" className="secondary-button" onClick={() => setAppliedSearch(search.trim())}>بحث</button>
      <div className="status-filters">
        {([{ value: 'all', label: 'الكل' }, { value: 'active', label: 'نشطة' }, { value: 'inactive', label: 'غير نشطة' }, { value: 'archived', label: 'مؤرشفة' }] as const).map((filter) =>
          <button key={filter.value} className={statusFilter === filter.value ? 'filter-chip selected' : 'filter-chip'} onClick={() => setStatusFilter(filter.value)}>{filter.label}</button>)}
      </div>
    </div>
    <div className="table-card glass">
      <div className="table-heading">
        <div><h3>سجل المعلمات</h3><span>{teachersPage.meta.total} معلمة</span></div>
      </div>
      <ResponsiveTable
        caption="قائمة المعلمات"
        rows={rows}
        columns={columns}
        rowKey={(teacher) => teacher.id}
        empty={ctx.has('teachers.read')
          ? <Empty icon={<GraduationCap size={25}/>} title="لا توجد معلمات مسجلات" text="أضف المعلمات أولًا، ثم اختَر المعلمة المسؤولة عند إنشاء الحلقة."/>
          : <Empty icon={<LockKeyhole size={22}/>} title="عرض السجلات غير مسموح" text="يمكنك تنفيذ العمليات التي منحك المدير صلاحيتها دون استعراض قائمة المعلمات."/>}
        actions={(teacher) => <>
          {ctx.has('teachers.edit') && <button className="small-icon-button" title="تعديل بيانات المعلمة" onClick={() => ctx.openTeacherEdit(teacher)}><Pencil size={15}/></button>}
          {ctx.has('teachers.delete') && ctx.has('trash.manage') && <button className="small-icon-button danger-action" title="نقل المعلمة إلى سلة المهملات" onClick={() => void ctx.deleteTeacher(teacher)}><Trash2 size={15}/></button>}
        </>}
      />
      <Pager
        page={teachersPage.page}
        pageSize={teachersPage.pageSize}
        total={teachersPage.meta.total}
        onPageChange={teachersPage.setPage}
        label="معلمة"
      />
    </div>
    <p className="page-footnote"><Clock3 size={14}/> أجر الساعة مسجل لكل معلمة. البحث والفلترة يطبقان على السيرفر قبل العدّ.</p>
  </motion.section>
}
