import { useCallback } from 'react'
import { motion } from 'framer-motion'
import { LockKeyhole, Pencil, Plus, ShieldCheck } from 'lucide-react'
import { knownPermissionNames } from '../domain/permissions'
import { formatDate } from '../lib/formatters'
import type { AdminUser } from '../domain/types'
import Pager from '../components/common/Pager'
import ResponsiveTable, { type ResponsiveColumn } from '../components/common/ResponsiveTable'
import { requestPage } from '../services/apiClient'
import { usePagedResource } from '../hooks/usePagedResource'
import { ADMIN_PAGE_SIZE } from '../lib/pagination'
import { buildListQuery } from '../lib/listQuery'
import type { DarApplicationContext } from '../application/useDarApplication'

type Props = { ctx: DarApplicationContext }

export default function UsersPage({ ctx }: Props) {
  const session = ctx.session
  if (!session) return null

  const fetchUsers = useCallback(async (page: number, pageSize: number) => {
    const response = await requestPage<AdminUser[]>(`/api/admin/users${buildListQuery({ page, pageSize })}`, undefined, ADMIN_PAGE_SIZE)
    return { items: response.data, meta: response.meta }
  }, [])
  const usersPage = usePagedResource<AdminUser>({ fetcher: fetchUsers, deps: [], pageSize: ADMIN_PAGE_SIZE })
  const rows = usersPage.items

  const columns: ResponsiveColumn<AdminUser>[] = [
    {
      key: 'account', header: 'الحساب', primary: true,
      render: (user) => <div className="student-name-cell">
        <span className="student-avatar"><ShieldCheck size={16}/></span>
        <span><strong>{user.displayName}</strong><small dir="ltr">@{user.username}</small></span>
      </div>,
    },
    { key: 'status', header: 'الحالة', render: (user) => <span className={`status-pill ${user.isActive ? 'status-active' : 'status-archived'}`}>{user.isActive ? 'نشط' : 'معطّل'}</span> },
    {
      key: 'permissions', header: 'الصلاحيات',
      render: (user) => <><span className="permission-count">{user.permissionCodes.length} صلاحية</span>
        <small className="sub-cell">{user.permissionCodes.slice(0, 3).map((code) => knownPermissionNames[code] ?? 'صلاحية إضافية').join('، ')}{user.permissionCodes.length > 3 ? ' …' : ''}</small></>,
    },
    { key: 'created', header: 'تاريخ الإنشاء', render: (user) => formatDate(user.createdAt) },
  ]

  return <motion.section key="users" className="students-page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
    <div className="page-toolbar">
      <div className="toolbar-copy">
        <h2>الحسابات والصلاحيات</h2>
        <p>أنشئ حسابًا لكل شخص وحدد صلاحيات القراءة والإضافة والتعديل والحذف بشكل مستقل.</p>
      </div>
      <div className="toolbar-actions"><button className="primary-button" onClick={ctx.openUserCreate}><Plus size={17}/> إنشاء حساب</button></div>
    </div>
    <div className="permissions-note glass">
      <ShieldCheck size={21}/>
      <div><strong>الصلاحيات تُفرض على الخادم</strong><p>إخفاء القسم أو الزر في الواجهة ليس الحماية الوحيدة؛ كل عملية API تتحقق من صلاحية الحساب الحالي. يمكن تحديد الصلاحيات لكل حساب منفردًا.</p></div>
    </div>
    <div className="table-card glass">
      <div className="table-heading"><div><h3>حسابات لوحة الإدارة</h3><span>{usersPage.meta.total} حساب</span></div></div>
      <ResponsiveTable
        caption="قائمة حسابات لوحة الإدارة"
        rows={rows}
        columns={columns}
        rowKey={(user) => user.id}
        empty={<div className="empty-inline">لا توجد حسابات حتى الآن.</div>}
        actions={(user) => <>
          <button className="small-icon-button" title="تعديل الحساب والصلاحيات" onClick={() => ctx.openUserEdit(user)}><Pencil size={15}/></button>
          {user.isActive && user.id !== session.id && <button className="small-icon-button danger-action" title="تعطيل الحساب" onClick={() => void ctx.deactivateUser(user)}><LockKeyhole size={15}/></button>}
        </>}
      />
      <Pager
        page={usersPage.page}
        pageSize={usersPage.pageSize}
        total={usersPage.meta.total}
        onPageChange={usersPage.setPage}
        label="حساب"
      />
    </div>
  </motion.section>
}
