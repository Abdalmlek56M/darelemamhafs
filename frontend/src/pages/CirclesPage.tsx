import { motion } from 'framer-motion'
import { BookOpen, Eye, GraduationCap, Pencil, Plus, Trash2, Users, Wallet } from 'lucide-react'
import { money } from '../lib/formatters'
import Empty from '../components/common/EmptyState'
import type { DarApplicationContext } from '../application/useDarApplication'


type Props = { ctx: DarApplicationContext }

export default function CirclesPage({ ctx }: Props) {
  return <motion.section key="circles" className="students-page" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}}>
          <div className="page-toolbar"><div className="toolbar-copy"><h2>الحلقات</h2><p>كل حلقة مرتبطة بمعلمة ورسوم شهرية افتراضية، ويمكن تغيير رسوم الطالب عند التحاقه.</p></div><div className="toolbar-actions">{ctx.has('circles.create')&&<button className="primary-button" onClick={ctx.openCircleCreate}><Plus size={17}/> إنشاء حلقة</button>}</div></div>
          <div className="circle-card-grid">{ctx.circles.map(c=><article className="circle-card glass" key={c.id}><div className="circle-card-top"><span className="stat-icon"><BookOpen size={20}/></span><span className={`status-pill ${c.isActive?'status-active':'status-archived'}`}>{c.isActive?'نشطة':'متوقفة'}</span></div><button className="text-link circle-title" onClick={()=>void ctx.openCircleDetails(c)}>{c.name}</button><p className="circle-meta"><GraduationCap size={14}/>{c.teacherName||'لم تُحدد معلمة'}</p><p className="circle-meta"><Users size={14}/>{c.activeStudentCount} طالب نشط</p>{ctx.has('finance.read')&&<p className="circle-meta"><Wallet size={14}/>{money(c.monthlyFee)} رسوم افتراضية شهريًا</p>}{c.scheduleText&&<p className="circle-schedule">{c.scheduleText}</p>}<div className="circle-card-actions"><button className="secondary-button" onClick={()=>void ctx.openCircleDetails(c)}><Eye size={15}/> تفاصيل الحلقة</button>{ctx.has('circles.edit')&&<button className="small-icon-button" onClick={()=>ctx.openCircleEdit(c)} title="تعديل"><Pencil size={15}/></button>}{ctx.has('circles.delete')&&<button className="small-icon-button danger-action" onClick={()=>void ctx.deleteCircle(c)} title="حذف"><Trash2 size={15}/></button>}</div></article>)}{ctx.circles.length===0&&<div className="panel glass"><Empty icon={<BookOpen size={25}/>} title="لا توجد حلقات" text="أنشئ حلقة وحدد معلمتها والرسوم والمواعيد، ثم ابدأ إلحاق الطلاب بها."/>{ctx.has('circles.create')&&<button className="primary-button" onClick={ctx.openCircleCreate}><Plus size={16}/> إنشاء أول حلقة</button>}</div>}</div>
        </motion.section>
}
