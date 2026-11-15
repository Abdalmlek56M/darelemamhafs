import { motion } from 'framer-motion'
import { LockKeyhole, Pencil, Plus, ShieldCheck } from 'lucide-react'
import { knownPermissionNames } from '../domain/permissions'
import { formatDate } from '../lib/formatters'
import type { DarApplicationContext } from '../application/useDarApplication'


type Props = { ctx: DarApplicationContext }

export default function UsersPage({ ctx }: Props) {
  const session = ctx.session
  if (!session) return null
  return <motion.section key="users" className="students-page" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}}>
          <div className="page-toolbar"><div className="toolbar-copy"><h2>الحسابات والصلاحيات</h2><p>أنشئ حسابًا لكل شخص وحدد صلاحيات القراءة والإضافة والتعديل والحذف بشكل مستقل.</p></div><div className="toolbar-actions"><button className="primary-button" onClick={ctx.openUserCreate}><Plus size={17}/> إنشاء حساب</button></div></div>
          <div className="permissions-note glass"><ShieldCheck size={21}/><div><strong>الصلاحيات تُفرض على الخادم</strong><p>إخفاء القسم أو الزر في الواجهة ليس الحماية الوحيدة؛ كل عملية API تتحقق من صلاحية الحساب الحالي. يمكن تحديد الصلاحيات لكل حساب منفردًا.</p></div></div>
          <div className="table-card glass"><div className="table-heading"><div><h3>حسابات لوحة الإدارة</h3><span>{ctx.users.length} حساب</span></div></div><div className="table-scroll"><table className="students-table wide-table"><thead><tr><th>الحساب</th><th>الحالة</th><th>الصلاحيات</th><th>تاريخ الإنشاء</th><th>إجراء</th></tr></thead><tbody>{ctx.users.map(u=><tr key={u.id}><td><div className="student-name-cell"><span className="student-avatar"><ShieldCheck size={16}/></span><span><strong>{u.displayName}</strong><small>@{u.username}</small></span></div></td><td><span className={`status-pill ${u.isActive?'status-active':'status-archived'}`}>{u.isActive?'نشط':'معطّل'}</span></td><td><span className="permission-count">{u.permissionCodes.length} صلاحية</span><small className="sub-cell">{u.permissionCodes.slice(0,3).map(c=>knownPermissionNames[c]??'صلاحية إضافية').join('، ')}{u.permissionCodes.length>3?' …':''}</small></td><td>{formatDate(u.createdAt)}</td><td><div className="row-actions"><button className="small-icon-button" title="تعديل الحساب والصلاحيات" onClick={()=>ctx.openUserEdit(u)}><Pencil size={15}/></button>{u.isActive&&u.id!==session.id&&<button className="small-icon-button danger-action" title="تعطيل الحساب" onClick={()=>void ctx.deactivateUser(u)}><LockKeyhole size={15}/></button>}</div></td></tr>)}</tbody></table></div></div>
        </motion.section>
}
