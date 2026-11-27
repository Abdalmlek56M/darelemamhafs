import { motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, ArrowUpRight, BookOpen, CalendarDays, Database, Download, GraduationCap, ShieldCheck, Users, Wallet, CircleDollarSign, CalendarClock, BellRing } from 'lucide-react'
import Stat from '../components/common/Stat'
import { money } from '../lib/formatters'
import Empty from '../components/common/EmptyState'
import MonthPicker from '../components/common/MonthPicker'
import ResponsiveTable, { type ResponsiveColumn } from '../components/common/ResponsiveTable'
import { weekDays } from '../domain/defaults'
import { formatTime12, remainingLabel } from '../lib/dates'
import type { DarApplicationContext } from '../application/useDarApplication'
import { findTeacherCircleByName } from '../application/selectors'


type Props = { ctx: DarApplicationContext }

export default function DashboardPage({ ctx }: Props) {
  const circleColumns: ResponsiveColumn<(typeof ctx.circleProfitSummary)[number]>[] = [
    { key: 'circle', header: 'الحلقة', primary: true, render: (row) => <><strong>{row.circleName}</strong>{row.uncharged > 0 && <small className="sub-cell">{row.uncharged} التحاق بلا استحقاق</small>}</> },
    { key: 'billed', header: 'الاستحقاق المسجل', render: (row) => money(row.billed) },
    { key: 'collected', header: 'المحصل', render: (row) => money(row.collected) },
    { key: 'teacher', header: 'أجر المعلمة', render: (row) => money(row.teacherPay) },
    { key: 'ads', header: 'الإعلانات', render: (row) => money(row.advertising) },
    { key: 'linked', header: 'مصروف مرتبط', render: (row) => money(row.linkedExpenses) },
    { key: 'net', header: 'الصافي التقديري', render: (row) => <strong className={row.net >= 0 ? 'good-text' : 'warn-text'}>{money(row.net)}</strong> },
  ]
  const teacherColumns: ResponsiveColumn<(typeof ctx.teacherPaySummary)[number]>[] = [
    { key: 'teacher', header: 'المعلمة', primary: true, render: (row) => <strong>{row.teacherName}</strong> },
    { key: 'sessions', header: 'الحصص الحاضرة', render: (row) => row.sessions },
    { key: 'hours', header: 'إجمالي الساعات', render: (row) => money(row.hours) },
    { key: 'avg', header: 'متوسط الأجر الفعلي/ساعة', render: (row) => money(row.avgHourlyRate) },
    { key: 'payable', header: 'المستحق', render: (row) => <strong>{money(row.payable)}</strong> },
  ]
  return <motion.div key="dashboard" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}} transition={{duration:.2}}>
          <section className="hero glass">
<div className="hero-orb orb-one"/>
<div className="hero-orb orb-two"/>
<div className="hero-content">
<span className="hero-kicker">
<CalendarDays size={15}/> إدارة منظمة وواضحة</span>
<h2>كل تفاصيل الدار،<br/>
<em>في مكان واحد.</em>
</h2>
<p>لوحة داخلية للمدير والحسابات التي تمنحها صلاحيات. سجلات الطلاب والمعلمات والحلقات والتحصيلات محفوظة على الخادم المحلي.</p>{ctx.has('students.create')&&<button className="primary-button" onClick={ctx.openStudentCreate}>إضافة طالب <ArrowUpRight size={17}/>
</button>}</div>
<div className="hero-illustration" aria-hidden="true">
<div className="book-ring ring-a"/>
<div className="book-ring ring-b"/>
<div className="book-tile">
<BookOpen size={62}/>
<span>اقرأ وارتقِ</span>
</div>
</div>
</section>
          <section className="section-heading">
<div>
<span className="eyebrow">ملخص فعلي</span>
<h2>نظرة عامة</h2>
</div>
<span className={`data-note ${ctx.health==='connected'?'text-success':''}`}>{ctx.health==='connected'?'البيانات متصلة بقاعدة PostgreSQL':'الاتصال غير متاح'}</span>
</section>
          <section className="stats-grid">
            {ctx.has('students.read')&&<Stat icon={<Users size={20}/>} label="الطلاب" value={String(ctx.students.length)} note="إجمالي السجلات المسجلة"/>}
            {ctx.has('teachers.read')&&<Stat icon={<GraduationCap size={20}/>} label="المعلمات النشطات" value={String(ctx.teachers.filter(t=>t.status==='active').length)} note="الأجر بالساعة والحلقات المسندة"/>}
            {ctx.has('circles.read')&&<Stat icon={<BookOpen size={20}/>} label="الحلقات النشطة" value={String(ctx.circles.filter(c=>c.isActive).length)} note="معلمات ورسوم مخصصة لكل حلقة"/>}
            {ctx.has('finance.read')&&<Stat icon={<Wallet size={20}/>} label="تحصيل الشهر" value={money(ctx.currentMonthTotals.paid)} note={`المتبقي ${money(ctx.currentMonthTotals.balance)}`}/>}
          </section>
          {ctx.has('finance.read')&&<section className="dashboard-profit glass">
<div className="dashboard-finance-heading">
<div>
<span className="eyebrow">ملخص مالي شهري</span>
<h2>صافي نتيجة الشهر</h2>
<p>الاستحقاقات المسجلة مطروحًا منها الإعلانات وأجور الحضور والمصروفات التشغيلية المسجلة.</p>
</div>
<div className="dashboard-finance-actions">
<label className="month-picker">
<CalendarDays size={16}/>
<MonthPicker value={ctx.currentMonthValue} onChange={ctx.setCurrentMonthValue} ariaLabel="شهر الملخص المالي"/>
</label>{(ctx.has('attendance.read')||ctx.has('attendance.edit'))&&<button className="secondary-button" onClick={ctx.downloadProfitSummary}>
<Download size={15}/> تنزيل ملخص الشهر</button>}</div>
</div>
            {(ctx.has('attendance.read')||ctx.has('attendance.edit'))?<>
<div className="dashboard-profit-main">
<div className={`profit-result-card ${ctx.dashboardProfit.net>=0?'profit-positive':'profit-negative'}`}>
<span>صافي التشغيل التقديري</span>
<strong>{money(ctx.dashboardProfit.net)}</strong>
<small>{ctx.dashboardProfit.net>=0?'فائض تشغيلي مبدئي':'عجز تشغيلي مبدئي'} · لا يشمل تكاليف غير مسجلة أو ضرائب</small>
<div className="profit-equation">
<span>استحقاقات {money(ctx.dashboardProfit.billed)}</span>
<span>− إعلانات {money(ctx.dashboardProfit.advertising)}</span>
<span>− أجور {money(ctx.dashboardProfit.teacherPay)}</span>
<span>− أخرى {money(ctx.dashboardProfit.otherExpenses)}</span>
</div>
</div>
<div className="profit-detail-grid">
<div className="profit-detail-item">
<span>الاشتراكات المستحقة والمسجلة</span>
<strong>{money(ctx.dashboardProfit.billed)}</strong>
</div>
<div className="profit-detail-item">
<span>المحصل فعليًا</span>
<strong className="good-text">{money(ctx.dashboardProfit.collected)}</strong>
</div>
<div className="profit-detail-item">
<span>المتبقي للتحصيل</span>
<strong className="warn-text">{money(ctx.dashboardProfit.balance)}</strong>
</div>
<div className="profit-detail-item">
<span>أجور المعلمات المستحقة</span>
<strong>{money(ctx.dashboardProfit.teacherPay)}</strong>
</div>
<div className="profit-detail-item">
<span>تكلفة إعلانات الشهر</span>
<strong>{money(ctx.dashboardProfit.advertising)}</strong>
</div>
<div className="profit-detail-item">
<span>المصروفات التشغيلية الأخرى</span>
<strong>{money(ctx.dashboardProfit.otherExpenses)}</strong>
</div>
</div>
</div>
              {(ctx.dashboardProfit.withoutChargeCount>0||ctx.dashboardProfit.unmarkedPastSessions>0)&&<div className="profit-data-warnings">{ctx.dashboardProfit.withoutChargeCount>0&&<p>
<AlertCircle size={15}/> يوجد {ctx.dashboardProfit.withoutChargeCount} التحاق نشط لم يُسجّل له استحقاق في هذا الشهر؛ النتيجة لا تتضمن رسومه حتى تُسجّل.</p>}{ctx.dashboardProfit.unmarkedPastSessions>0&&<p>
<AlertCircle size={15}/> توجد {ctx.dashboardProfit.unmarkedPastSessions} حصة مضى موعدها دون تسجيل الحضور؛ أجور المعلمات والنتيجة قد تكون أقل من الواقع.</p>}</div>}
              <div className="profit-circle-breakdown">
<div className="profit-circle-heading">
<div>
<h3>مساهمة كل حلقة</h3>
<p>الاستحقاق المسجل ناقص أجر المعلمة والإعلانات والمصروفات المرتبطة بهذه الحلقة. المصروفات العامة غير موزعة هنا.</p>
</div>
</div>
<ResponsiveTable
                  caption="مساهمة كل حلقة"
                  tableClassName="students-table wide-table profit-circle-table"
                  rows={ctx.circleProfitSummary}
                  columns={circleColumns}
                  rowKey={(row) => row.circleId}
                  empty={<Empty icon={<BookOpen size={19}/>} title="لا توجد بيانات حلقات لهذا الشهر" text="أنشئ الحلقات وسجل الاستحقاقات والمصروفات والحضور لتظهر مقارنة الحلقات."/>}
                />
</div>
              <div className="profit-circle-breakdown">
<div className="profit-circle-heading">
<div>
<h3>تفصيل أجور المعلمات</h3>
<p>مستحقات الحصص التي تم تأكيد حضورها في الشهر المختار، مع حفظ أجر الساعة وقت تسجيل الحضور.</p>
</div>
</div>
<ResponsiveTable
                  caption="تفصيل أجور المعلمات"
                  tableClassName="students-table wide-table profit-circle-table"
                  rows={ctx.teacherPaySummary}
                  columns={teacherColumns}
                  rowKey={(row) => row.teacherId}
                  empty={<Empty icon={<GraduationCap size={19}/>} title="لا توجد حصص حضور مؤكدة" text="سجّل حضور المعلمات في جدول المواعيد ليظهر التفصيل هنا."/>}
                />
</div>
              <p className="profit-footnote">الحساب يعتمد على استحقاقات التحصيل التي سجلتها، والحضور المؤكد، والإعلانات والمصروفات المسجلة لهذا الشهر. المحصل الفعلي معروض منفصلًا؛ هذه ليست سيولة نقدية متاحة وليست حسابًا محاسبيًا نهائيًا.</p>
            </>:<div className="profit-permission-note">
<ShieldCheck size={18}/> لا يمكن حساب صافي التشغيل الكامل لحسابك قبل منحه صلاحية قراءة حضور المعلمات وأجورهن.</div>}
          </section>}
          <section className="bottom-grid">
<article className="panel glass">
<div className="panel-heading">
<div>
<span className="eyebrow">حفظ البيانات</span>
<h3>سجلات قابلة للمراجعة</h3>
</div>
<span className="step-number">
<Database size={17}/>
</span>
</div>
<ul className="principles">
<li>لكل طالب ملف يجمع الحلقات القديمة والملاحظات والمدفوعات.</li>
<li>التقارير المحفوظة هي لقطات ثابتة يمكن فتحها وتنزيلها لاحقًا.</li>
<li>الحذف النهائي يحتاج تأكيدًا، والصلاحيات تُراجع داخل الـ API وليس في إخفاء الأزرار فقط.</li>
</ul>
</article>{ctx.has('finance.read')&&<article className="panel glass">
<div className="panel-heading">
<div>
<span className="eyebrow">تنبيه محاسبي</span>
<h3>تحصيل الشهر الحالي</h3>
</div>
<span className="step-number">
<CircleDollarSign size={17}/>
</span>
</div>
<div className="metric-line">
<span>المستحق</span>
<strong>{money(ctx.currentMonthTotals.due)}</strong>
</div>
<div className="metric-line">
<span>المحصل</span>
<strong className="good-text">{money(ctx.currentMonthTotals.paid)}</strong>
</div>
<div className="metric-line">
<span>المتبقي</span>
<strong className="warn-text">{money(ctx.currentMonthTotals.balance)}</strong>
</div>
<button className="secondary-button" onClick={()=>ctx.changePage('payments')}>فتح التحصيل <ArrowLeft size={16}/>
</button>
</article>}{ctx.has('teachers.read')&&<article className="panel glass assigned-circles-panel">
<div className="panel-heading">
<div>
<span className="eyebrow">توزيع الحلقات</span>
<h3>الحلقات المسندة للمعلمات</h3>
</div>
<span className="step-number">
<GraduationCap size={17}/>
</span>
</div>
<div className="assigned-circles-list">{ctx.teachers.filter(t=>t.circleCount>0).map(t=>
<div className="assigned-teacher-row" key={t.id}>
<strong>{t.fullName}</strong>
<div>{t.circleNames.split('، ').map((name,index)=>{const circle=findTeacherCircleByName(ctx.circles,t.id,name);return <span className="teacher-circle-item" key={`${t.id}-${index}`}>{ctx.has('circles.read')&&circle?<button className="text-link" onClick={()=>void ctx.openCircleDetails(circle)}>{name}</button>:name}{index<t.circleNames.split('، ').length-1?'، ':''}</span>})}</div>
</div>)}{ctx.teachers.filter(t=>t.circleCount>0).length===0&&<p className="muted-text">لم تُسند حلقات لأي معلمة حتى الآن.</p>}</div>{ctx.has('teachers.create')&&<button className="secondary-button" onClick={()=>ctx.changePage('teachers')}>إدارة المعلمات <ArrowLeft size={15}/>
</button>}</article>}{(ctx.has('schedule.read')||ctx.has('schedule.edit'))&&<article className="panel glass dashboard-schedule-panel">
<div className="panel-heading">
<div>
<span className="eyebrow">المواعيد القادمة</span>
<h3>مؤقت الحلقات</h3>
</div>
<span className="step-number">
<CalendarClock size={17}/>
</span>
</div>{ctx.nextSessions.slice(0,3).map(slot=>
<div className="next-session-row" key={slot.id}>
<div>
<strong>{slot.circleName}</strong>
<small>{weekDays[slot.dayOfWeek]} · {formatTime12(slot.startsAt)} · {slot.teacherName}</small>
</div>
<span>{slot.isRunning?`جارية الآن · متبقي ${remainingLabel(slot.endsAt.getTime()-ctx.clockNow)}`:remainingLabel(slot.target.getTime()-ctx.clockNow)}</span>
</div>)}{ctx.nextSessions.length===0&&<p className="muted-text">أضف المواعيد من قسم المواعيد والحضور.</p>}<div className="dashboard-schedule-actions">
<button className="secondary-button" onClick={()=>ctx.changePage('schedule')}>
<CalendarClock size={14}/> جدول الحلقات والحضور</button>
<button className="small-icon-button" title="تفعيل إشعارات المتصفح" onClick={()=>void ctx.enableNotifications()}>
<BellRing size={15}/>
</button>
</div>
</article>}</section>
        </motion.div>
}
