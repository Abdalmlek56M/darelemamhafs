import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Eye, GraduationCap, Pencil, Plus, Search, Trash2, Users, Wallet } from 'lucide-react'
import { money } from '../lib/formatters'
import { circleTypeLabels } from '../domain/labels'
import type { Circle } from '../domain/types'
import Empty from '../components/common/EmptyState'
import Pager from '../components/common/Pager'
import { requestPage } from '../services/apiClient'
import { usePagedResource } from '../hooks/usePagedResource'
import { ADMIN_PAGE_SIZE } from '../lib/pagination'
import { buildListQuery } from '../lib/listQuery'
import type { DarApplicationContext } from '../application/useDarApplication'

type Props = { ctx: DarApplicationContext }

export default function CirclesPage({ ctx }: Props) {
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  const fetchCircles = useCallback(async (page: number, pageSize: number) => {
    const response = await requestPage<Circle[]>(`/api/circles${buildListQuery({ page, pageSize, search: appliedSearch })}`, undefined, ADMIN_PAGE_SIZE)
    return { items: response.data, meta: response.meta }
  }, [appliedSearch])
  const circlesPage = usePagedResource<Circle>({
    fetcher: fetchCircles,
    deps: [appliedSearch],
    pageSize: ADMIN_PAGE_SIZE,
  })

  return <motion.section key="circles" className="students-page" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}}>
    <div className="page-toolbar">
      <div className="toolbar-copy"><h2>الحلقات</h2><p>كل حلقة مرتبطة بمعلمة ورسوم شهرية افتراضية، ويمكن تغيير رسوم الطالب عند التحاقه.</p></div>
      <div className="toolbar-actions">{ctx.has('circles.create')&&<button className="primary-button" onClick={ctx.openCircleCreate}><Plus size={17}/> إنشاء حلقة</button>}</div>
    </div>
    <div className="student-filters glass">
      <label className="search-field">
        <Search size={17}/>
        <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setAppliedSearch(search.trim()) }} placeholder="ابحث باسم الحلقة أو المعلمة…"/>
      </label>
      <button type="button" className="secondary-button" onClick={() => setAppliedSearch(search.trim())}>بحث</button>
    </div>
    <div className="circle-card-grid">
      {circlesPage.items.map((circle) => <article className="circle-card glass" key={circle.id}>
        <div className="circle-card-top"><span className="stat-icon"><BookOpen size={20}/></span><div className="circle-badges"><span className="status-pill">{circleTypeLabels[circle.circleType ?? 'group']}</span>{circle.isChildren && <span className="status-pill">أطفال</span>}<span className={`status-pill ${circle.isActive?'status-active':'status-archived'}`}>{circle.isActive?'نشطة':'متوقفة'}</span></div></div>
        <button className="text-link circle-title" onClick={()=>void ctx.openCircleDetails(circle)}>{circle.name}</button>
        <p className="circle-meta"><GraduationCap size={14}/>{circle.teacherName||'لم تُحدد معلمة'}</p>
        <p className="circle-meta"><Users size={14}/>{circle.activeStudentCount} طالب نشط</p>
        {ctx.has('finance.read')&&<p className="circle-meta"><Wallet size={14}/>{money(circle.monthlyFee)} رسوم افتراضية شهريًا</p>}
        {circle.scheduleText&&<p className="circle-schedule">{circle.scheduleText}</p>}
        <div className="circle-card-actions">
          <button className="secondary-button" onClick={()=>void ctx.openCircleDetails(circle)}><Eye size={15}/> تفاصيل الحلقة</button>
          {ctx.has('circles.edit')&&<button className="small-icon-button" onClick={()=>ctx.openCircleEdit(circle)} title="تعديل"><Pencil size={15}/></button>}
          {ctx.has('circles.delete')&&<button className="small-icon-button danger-action" onClick={()=>void ctx.deleteCircle(circle)} title="حذف"><Trash2 size={15}/></button>}
        </div>
      </article>)}
      {circlesPage.items.length===0&&<div className="panel glass"><Empty icon={<BookOpen size={25}/>} title="لا توجد حلقات" text="أنشئ حلقة وحدد معلمتها والرسوم والمواعيد، ثم ابدأ إلحاق الطلاب بها."/>{ctx.has('circles.create')&&<button className="primary-button" onClick={ctx.openCircleCreate}><Plus size={16}/> إنشاء أول حلقة</button>}</div>}
    </div>
    <Pager
      page={circlesPage.page}
      pageSize={circlesPage.pageSize}
      total={circlesPage.meta.total}
      onPageChange={circlesPage.setPage}
      label="حلقة"
    />
  </motion.section>
}
