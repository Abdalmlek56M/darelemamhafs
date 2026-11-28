import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { GraduationCap, LockKeyhole, Search, ShieldCheck, UserCheck, UserRound, Users } from 'lucide-react'
import Empty from '../components/common/EmptyState'
import ResponsiveTable, { type ResponsiveColumn } from '../components/common/ResponsiveTable'
import { requestPage } from '../services/apiClient'
import { MAX_PAGE_SIZE } from '../lib/pagination'
import { buildListQuery } from '../lib/listQuery'
import type { AdminUser, Student, Teacher } from '../domain/types'
import {
  buildUnifiedMembers,
  filterUnifiedMembers,
  memberKindLabels,
  type MemberKind,
  type MemberTypeFilter,
  type UnifiedMember,
} from '../domain/members'
import type { DarApplicationContext } from '../application/useDarApplication'

type Props = { ctx: DarApplicationContext }

const typeFilterOptions: { value: MemberTypeFilter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'student', label: 'الطلاب' },
  { value: 'guardian', label: 'أولياء الأمور' },
  { value: 'teacher', label: 'المعلمات' },
  { value: 'supervisor', label: 'المشرفات' },
]

function MemberIcon({ kind }: { kind: MemberKind }) {
  if (kind === 'teacher') return <GraduationCap size={17} />
  if (kind === 'supervisor') return <ShieldCheck size={17} />
  if (kind === 'guardian') return <UserCheck size={17} />
  return <UserRound size={17} />
}

export default function MembersPage({ ctx }: Props) {
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<MemberTypeFilter>('all')
  const [students, setStudents] = useState<Student[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)

  const canReadStudents = ctx.has('students.read')
  const canReadTeachers = ctx.has('teachers.read')
  const canManageUsers = ctx.has('users.manage')
  const canReadAny = canReadStudents || canReadTeachers || canManageUsers

  const loadMembers = useCallback(async () => {
    if (!canReadAny) return
    setLoading(true)
    try {
      const query = buildListQuery({ page: 1, pageSize: MAX_PAGE_SIZE, search: appliedSearch })
      const [studentsRes, teachersRes, usersRes] = await Promise.all([
        canReadStudents ? requestPage<Student[]>(`/api/students${query}`, undefined, MAX_PAGE_SIZE) : Promise.resolve(null),
        canReadTeachers ? requestPage<Teacher[]>(`/api/teachers${query}`, undefined, MAX_PAGE_SIZE) : Promise.resolve(null),
        canManageUsers ? requestPage<AdminUser[]>(`/api/admin/users${buildListQuery({ page: 1, pageSize: MAX_PAGE_SIZE })}`, undefined, MAX_PAGE_SIZE) : Promise.resolve(null),
      ])
      setStudents(studentsRes?.data ?? [])
      setTeachers(teachersRes?.data ?? [])
      setUsers(usersRes?.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [appliedSearch, canManageUsers, canReadAny, canReadStudents, canReadTeachers])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  const allMembers = useMemo(
    () => buildUnifiedMembers(students, teachers, users),
    [students, teachers, users],
  )
  const filteredMembers = useMemo(
    () => filterUnifiedMembers(allMembers, typeFilter, appliedSearch),
    [allMembers, typeFilter, appliedSearch],
  )

  const openProfile = (member: UnifiedMember) => {
    if (member.target.kind === 'student') {
      void ctx.openHistory(member.target.student.id)
      return
    }
    if (member.target.kind === 'guardian') {
      void ctx.openHistory(member.target.studentId)
      return
    }
    if (member.target.kind === 'teacher') {
      void ctx.openTeacherDetails(member.target.teacher)
      return
    }
    ctx.openUserEdit(member.target.user)
  }

  const columns: ResponsiveColumn<UnifiedMember>[] = [
    {
      key: 'member',
      header: 'العضو',
      primary: true,
      render: (member) => (
        <button type="button" className="text-link student-name-link" onClick={() => openProfile(member)}>
          <span className="student-avatar"><MemberIcon kind={member.kind} /></span>
          <span><strong>{member.name}</strong><small>{member.codeOrUsername} · فتح الملف</small></span>
        </button>
      ),
    },
    {
      key: 'kind',
      header: 'النوع',
      render: (member) => <span className="status-pill">{memberKindLabels[member.kind]}</span>,
    },
    {
      key: 'phone',
      header: 'الهاتف',
      ltr: true,
      render: (member) => member.phone || '—',
    },
    {
      key: 'details',
      header: 'التفاصيل',
      render: (member) => <span>{member.subtitle}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (member) => <span className={`status-pill ${member.statusClass}`}>{member.statusLabel}</span>,
    },
  ]

  return (
    <motion.section key="members" className="students-page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
      <div className="page-toolbar">
        <div className="toolbar-copy">
          <h2>دليل الأعضاء الموحد</h2>
          <p>عرض موحد للطلاب وأولياء الأمور والمعلمات والمشرفات مع فتح ملف كل عضو مباشرة.</p>
        </div>
      </div>
      <div className="student-filters glass">
        <label className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') setAppliedSearch(search.trim()) }}
            placeholder="ابحث بالاسم أو الكود أو الهاتف…"
          />
        </label>
        <button type="button" className="secondary-button" onClick={() => setAppliedSearch(search.trim())}>بحث</button>
        <div className="status-filters">
          {typeFilterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={typeFilter === option.value ? 'filter-chip selected' : 'filter-chip'}
              onClick={() => setTypeFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="table-card glass">
        <div className="table-heading">
          <div>
            <h3>قائمة الأعضاء</h3>
            <span>{loading ? 'جارٍ التحميل…' : `${filteredMembers.length} عضو`}</span>
          </div>
        </div>
        <ResponsiveTable
          caption="قائمة الأعضاء الموحدة"
          rows={filteredMembers}
          columns={columns}
          rowKey={(member) => member.key}
          empty={canReadAny
            ? <Empty icon={<Users size={25} />} title="لا توجد نتائج مطابقة" text="جرّب تغيير البحث أو نوع العضو." />
            : <Empty icon={<LockKeyhole size={22} />} title="عرض الأعضاء غير مسموح" text="تحتاج صلاحية عرض الطلاب أو المعلمات أو إدارة الحسابات." />}
          actions={(member) => (
            <button type="button" className="secondary-button" onClick={() => openProfile(member)}>
              فتح الملف
            </button>
          )}
        />
      </div>
    </motion.section>
  )
}
