import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Archive, BookOpen, CalendarDays, CheckCircle2, Clock3, GraduationCap, Plus, Trash2, Wallet, X, CalendarClock, BellRing, BellOff, UserCheck, UsersRound, Pencil, Save } from 'lucide-react'
import Field from '../components/common/Field'
import { weekDays } from '../domain/defaults'
import { formatTime12, remainingLabel } from '../lib/dates'
import { cairoDayKey } from '../lib/cairoDate'
import Empty from '../components/common/EmptyState'
import MonthPicker from '../components/common/MonthPicker'
import ResponsiveTable, { type ResponsiveColumn } from '../components/common/ResponsiveTable'
import { formatDate, money } from '../lib/formatters'
import Stat from '../components/common/Stat'
import type { DarApplicationContext } from '../application/useDarApplication'
import type { ScheduleSlot } from '../domain/types'
import StudentAttendanceDialog from '../components/dialogs/StudentAttendanceDialog'
import TeacherSubstitutionDialog from '../components/dialogs/TeacherSubstitutionDialog'
import PayrollLockPanel from '../components/PayrollLockPanel'
import Pager from '../components/common/Pager'

const SCHEDULE_PAGE_SIZE = 25


type Props = { ctx: DarApplicationContext }

export default function SchedulePage({ ctx }: Props) {
  const [studentSession, setStudentSession] = useState<{slot: ScheduleSlot; date: string} | null>(null)
  const [substituteSession, setSubstituteSession] = useState<{slot: ScheduleSlot; date: string} | null>(null)
  const [editingDurationId, setEditingDurationId] = useState<string | null>(null)
  const [durationDraft, setDurationDraft] = useState('60')
  const [circleFilter, setCircleFilter] = useState('all')
  const [teacherFilter, setTeacherFilter] = useState('all')
  const [page, setPage] = useState(1)
  const circleOptions = useMemo(() => Array.from(new Map(ctx.scheduleSlots.filter(slot => teacherFilter === 'all' || slot.teacherId === teacherFilter).map(slot => [slot.circleId, { id: slot.circleId, name: slot.circleName }])).values()), [ctx.scheduleSlots, teacherFilter])
  const teacherOptions = useMemo(() => Array.from(new Map(ctx.scheduleSlots.filter(slot => circleFilter === 'all' || slot.circleId === circleFilter).filter(slot => slot.teacherId).map(slot => [slot.teacherId as string, { id: slot.teacherId as string, name: slot.teacherName }])).values()), [ctx.scheduleSlots, circleFilter])
  const matchesScheduleFilter = useCallback((slot: ScheduleSlot) => (circleFilter === 'all' || slot.circleId === circleFilter) && (teacherFilter === 'all' || slot.teacherId === teacherFilter), [circleFilter, teacherFilter])
  const visibleSlots = useMemo(() => ctx.scheduleSlots.filter(matchesScheduleFilter).slice().sort((a,b) => Number(b.isActive)-Number(a.isActive) || a.dayOfWeek-b.dayOfWeek || a.startsAt.localeCompare(b.startsAt) || a.circleName.localeCompare(b.circleName,'ar')), [ctx.scheduleSlots, matchesScheduleFilter])
  const duplicateSlotKeys = useMemo(() => { const counts = new Map<string, number>(); for (const slot of visibleSlots) if (slot.isActive) { const key = `${slot.circleId}|${slot.dayOfWeek}|${slot.startsAt.slice(0,5)}`; counts.set(key, (counts.get(key) ?? 0) + 1) } return new Set(Array.from(counts.entries()).filter(([,count]) => count > 1).map(([key]) => key)) }, [visibleSlots])
  const visibleNextSessions = useMemo(() => ctx.nextSessions.filter(slot => slot.circleIsActive !== false && matchesScheduleFilter(slot)), [ctx.nextSessions, matchesScheduleFilter])
  const visibleMonthSessions = useMemo(() => ctx.monthSessions.filter(item => (circleFilter === 'all' || item.slot.circleId === circleFilter) && (teacherFilter === 'all' || (item.attendance?.teacherId ?? item.slot.teacherId) === teacherFilter)), [ctx.monthSessions, circleFilter, teacherFilter])
  const visibleAttendanceRows = useMemo(() => ctx.attendanceRows.filter(row => (circleFilter === 'all' || row.circleId === circleFilter) && (teacherFilter === 'all' || row.teacherId === teacherFilter)), [ctx.attendanceRows, circleFilter, teacherFilter])
  const safePage = Math.min(Math.max(page, 1), Math.max(1, Math.ceil(visibleMonthSessions.length / SCHEDULE_PAGE_SIZE)));
  const pagedMonthSessions = useMemo(() => visibleMonthSessions.slice((safePage - 1) * SCHEDULE_PAGE_SIZE, safePage * SCHEDULE_PAGE_SIZE), [visibleMonthSessions, safePage]);
  useEffect(() => { setPage(1) }, [circleFilter, teacherFilter, ctx.currentMonthValue])
  const studentSummaryIndex = useMemo(() => new Map(ctx.studentAttendanceSummaries.map(row => [`${row.scheduleSlotId}|${row.sessionDate.slice(0,10)}`, row] as const)), [ctx.studentAttendanceSummaries])
  const canReadFinance = ctx.has('finance.read')
  const [payrollLocked, setPayrollLocked] = useState(false)
  const visibleTeacherPay = useMemo(() => { const values = new Map<string, {teacherId:string;teacherName:string;present:number;hours:number;payable:number}>(); for (const row of visibleAttendanceRows) { if (row.status !== 'present') continue; const item = values.get(row.teacherId) ?? { teacherId: row.teacherId, teacherName: row.teacherName, present: 0, hours: 0, payable: 0 }; item.present++; item.hours += row.durationMinutes / 60; if (canReadFinance) item.payable += row.payableAmount ?? 0; values.set(row.teacherId, item) } return Array.from(values.values()).sort((a,b) => a.teacherName.localeCompare(b.teacherName, 'ar')) }, [visibleAttendanceRows, canReadFinance])
  const sessionMeta = (item: (typeof visibleMonthSessions)[number]) => {
    const metaAttendance = item.attendance
    const circle = ctx.circles.find((entry) => entry.id === item.slot.circleId)
    return {
      isFuture: item.target.getTime() > ctx.clockNow,
      circle,
      circleInactive: item.slot.circleIsActive === false,
      a: metaAttendance,
      statusLabel: metaAttendance?.status === 'present' ? 'حاضرة' : metaAttendance?.status === 'absent' ? 'غائبة' : metaAttendance?.status === 'cancelled' ? 'أُلغيت الحصة' : 'لم يُسجل',
      summary: studentSummaryIndex.get(`${item.slot.id}|${item.date}`),
      duration: metaAttendance?.durationMinutes ?? item.slot.durationMinutes,
      recordedTeacher: metaAttendance?.teacherName ?? item.slot.teacherName,
      historical: Boolean(circle?.startsOn && item.date < circle.startsOn),
    }
  }
  const sessionColumns: ResponsiveColumn<(typeof visibleMonthSessions)[number]>[] = [
    {
      key: 'date', header: 'التاريخ', primary: true,
      render: (item) => {
        const meta = sessionMeta(item)
        return <>{formatDate(item.date)}<small className="sub-cell">{weekDays[item.slot.dayOfWeek]}</small>{meta.historical && <small className="sub-cell historical-session-badge">قبل تاريخ بدء الحلقة</small>}</>
      },
    },
    { key: 'circle', header: 'الحلقة', render: (item) => <strong>{item.slot.circleName}</strong> },
    {
      key: 'teacher', header: 'المعلمة المسجلة',
      render: (item) => {
        const meta = sessionMeta(item)
        return <>{meta.recordedTeacher || 'غير محددة'}{meta.a?.teacherId && item.slot.teacherId && meta.a.teacherId !== item.slot.teacherId && <small className="sub-cell">بديلة عن {item.slot.teacherName}</small>}</>
      },
    },
    { key: 'time', header: 'الموعد', render: (item) => formatTime12(item.slot.startsAt) },
    {
      key: 'duration', header: 'المدة',
      render: (item) => {
        const meta = sessionMeta(item)
        return meta.a && editingDurationId === meta.a.id
          ? <div className="duration-edit-cell">
            <input aria-label="مدة الحضور بالدقائق" type="number" min="15" max="360" step="5" value={durationDraft} onChange={(event) => setDurationDraft(event.target.value)}/>
            <button className="small-icon-button attendance-present" title="حفظ المدة" onClick={() => { const value = Number(durationDraft); if (!Number.isInteger(value) || value < 15 || value > 360) { ctx.notifySystem('error', 'مدة الحضور يجب أن تكون بين 15 و360 دقيقة.'); return } void ctx.updateAttendanceDuration(meta.a!.id, value); setEditingDurationId(null) }}><Save size={13}/></button>
            <button className="small-icon-button" title="إلغاء التعديل" onClick={() => setEditingDurationId(null)}><X size={13}/></button>
          </div>
          : <span>{meta.duration} دقيقة {meta.a?.status === 'present' && !payrollLocked && ctx.has('attendance.edit') && <button className="small-icon-button duration-edit-button" title="تعديل مدة الحضور" onClick={() => { setEditingDurationId(meta.a!.id); setDurationDraft(String(meta.a!.durationMinutes)) }}><Pencil size={13}/></button>}{meta.a && meta.a.status !== 'present' && <small className="sub-cell attendance-duration-locked">لا يُعدّل وقت حصة الغياب أو الإلغاء</small>}</span>
      },
    },
    {
      key: 'status', header: 'حضور المعلمة',
      render: (item) => { const meta = sessionMeta(item); return <span className={`status-pill ${meta.a?.status === 'present' ? 'status-active' : meta.a ? 'status-archived' : 'pay-unpaid'}`}>{meta.statusLabel}</span> },
    },
    {
      key: 'students', header: 'الطلاب الحاضرون',
      render: (item) => {
        const meta = sessionMeta(item)
        const total = Math.max(meta.summary?.totalStudents ?? 0, ctx.circles.find((circle) => circle.id === item.slot.circleId)?.activeStudentCount ?? 0)
        return <>{meta.summary ? `${meta.summary.presentStudents} من ${total}` : `0 من ${total}`}<small className="sub-cell">الحاضر / إجمالي طلاب الحلقة</small></>
      },
    },
    ...(canReadFinance ? [{
      key: 'payable', header: 'المستحق',
      render: (item: (typeof visibleMonthSessions)[number]) => {
        const meta = sessionMeta(item)
        return <>{meta.a ? (meta.a.payableAmount == null ? '—' : money(meta.a.payableAmount)) : '—'}{meta.a?.status === 'present' && meta.a.hourlyRateSnapshot != null && <small className="sub-cell">أجر الساعة {money(meta.a.hourlyRateSnapshot)}</small>}</>
      },
    }] : []),
  ]
  const payColumns: ResponsiveColumn<(typeof visibleTeacherPay)[number]>[] = [
    { key: 'teacher', header: 'المعلمة', primary: true, render: (row) => row.teacherName },
    { key: 'sessions', header: 'عدد الحصص', render: (row) => row.present },
    { key: 'hours', header: 'ساعات الحضور', render: (row) => row.hours.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 }) },
    { key: 'payable', header: 'المستحق', render: (row) => <strong className="good-text">{money(row.payable)}</strong> },
  ]
  const slotColumns: ResponsiveColumn<(typeof visibleSlots)[number]>[] = [
    {
      key: 'circle', header: 'الحلقة', primary: true,
      render: (slot) => <><strong>{slot.circleName}</strong>{duplicateSlotKeys.has(`${slot.circleId}|${slot.dayOfWeek}|${slot.startsAt.slice(0, 5)}`) && <small className="status-pill status-ended schedule-duplicate-pill">تكرار يحتاج مراجعة</small>}</>,
    },
    { key: 'teacher', header: 'المعلمة', render: (slot) => slot.teacherName || 'لم تحدد معلمة' },
    { key: 'day', header: 'اليوم', render: (slot) => weekDays[slot.dayOfWeek] },
    { key: 'time', header: 'وقت البداية', render: (slot) => formatTime12(slot.startsAt) },
    { key: 'duration', header: 'المدة', render: (slot) => slot.durationMinutes + ' دقيقة' },
    {
      key: 'status', header: 'الحالة',
      render: (slot) => slot.isActive && slot.circleIsActive !== false ? <span className="status-pill status-active">نشط</span> : slot.isActive ? <span className="status-pill status-archived">حلقة متوقفة</span> : <span className="status-pill status-archived">تاريخي موقوف</span>,
    },
    {
      key: 'alert', header: 'تنبيه الموعد',
      render: (slot) => slot.isActive
        ? <label className="schedule-alert-toggle" title={ctx.isScheduleAlertEnabled(slot.id) ? 'التنبيه مفعّل لهذا الموعد' : 'التنبيہ متوقف لهذا الموعد'}>
          <input type="checkbox" checked={ctx.isScheduleAlertEnabled(slot.id)} onChange={(event) => ctx.setScheduleAlertEnabled(slot.id, event.target.checked)} aria-label={`تنبيه ${slot.circleName}`}/>
          <span className="schedule-alert-toggle-track"/>
          <span className="schedule-alert-toggle-label">{ctx.isScheduleAlertEnabled(slot.id) ? 'مفعّل' : 'متوقف'}</span>
        </label>
        : <span className="muted-text">محفوظ للسجل التاريخي</span>,
    },
  ]
  return <motion.section key="schedule" className="students-page" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}}>
          <div className="page-toolbar">
<div className="toolbar-copy">
<h2>المواعيد والحضور</h2>
<p>سجّل حضور المعلمة لحساب أجرها، أو افتح «حضور الطلاب» لتسجيل كل طالب في الحلقة نفسها حسب التاريخ والموعد.</p>
</div>
<div className="toolbar-actions">{(ctx.has('schedule.read')||ctx.has('schedule.edit'))&&<button className={`secondary-button schedule-notifications-toggle ${ctx.scheduleNotificationsEnabled?'is-enabled':'is-disabled'}`} aria-pressed={ctx.scheduleNotificationsEnabled} onClick={()=>void ctx.toggleScheduleNotifications()} title={ctx.scheduleNotificationsEnabled?'اضغط لإيقاف كل تنبيهات المواعيد':'اضغط لتفعيل تنبيهات المواعيد'}>{ctx.scheduleNotificationsEnabled?<BellRing size={15}/>:<BellOff size={15}/>}{ctx.scheduleNotificationsEnabled?'التنبيهات مفعلة':'التنبيهات متوقفة'}</button>}{(ctx.has('attendance.read')||ctx.has('attendance.edit'))&&<label className="month-picker">
<CalendarDays size={16}/>
<MonthPicker value={ctx.currentMonthValue} onChange={ctx.setCurrentMonthValue} ariaLabel="شهر المواعيد والحضور"/>
</label>}</div>
</div>
          <div className="schedule-filter-bar glass">
<div className="schedule-filter-title">
<CalendarDays size={17}/>
<strong>تصفية المواعيد والحضور</strong>
<span>اختر كل الحلقات أو حلقة واحدة أو معلمة لتظهر الحلقات المسندة إليها.</span>
</div>
<label className="form-field">
<span>المعلمة</span>
<select value={teacherFilter} onChange={event=>{setTeacherFilter(event.target.value);setCircleFilter('all')}}>
<option value="all">كل المعلمات</option>{teacherOptions.map(teacher=>
<option value={teacher.id} key={teacher.id}>{teacher.name}</option>)}</select>
</label>
<label className="form-field">
<span>الحلقة</span>
<select value={circleFilter} onChange={event=>{setCircleFilter(event.target.value);setTeacherFilter('all')}}>
<option value="all">كل الحلقات</option>{circleOptions.map(circle=>
<option value={circle.id} key={circle.id}>{circle.name}</option>)}</select>
</label>
<button className="secondary-button compact-button" type="button" onClick={()=>{setCircleFilter('all');setTeacherFilter('all')}}>عرض الكل</button>
</div>
          <PayrollLockPanel month={ctx.currentMonthValue} canLock={ctx.has('finance.edit')} canUnlock={ctx.has('users.manage')} onChange={setPayrollLocked} />
          {(ctx.has('attendance.read')||ctx.has('attendance.edit'))&&<>
<div className="table-card glass">
<div className="table-heading">
<div>
<h3>حضور المعلمات والطلاب — {ctx.currentMonthValue}</h3>
<span>تظهر كل التواريخ الأسبوعية في الشهر المحدد. التواريخ السابقة لبدء الحلقة تحمل علامة تاريخية حتى تقدر تسجل بيانات قديمة عند الحاجة؛ الحضور الفعلي فقط يُحتسب في أجر المعلمة.</span>
</div>
</div>
<section className="stats-grid compact-stats attendance-pay-stats">
<Stat icon={<UserCheck size={18}/>} label="الحصص التي تم تسجيل حضورها" value={String(visibleAttendanceRows.filter(a=>a.status==='present').length)} note="في الشهر المحدد"/>
<Stat icon={<Clock3 size={18}/>} label="إجمالي ساعات الحضور" value={new Intl.NumberFormat('ar-EG-u-nu-latn',{maximumFractionDigits:2}).format(visibleAttendanceRows.filter(a=>a.status==='present').reduce((sum,a)=>sum+a.durationMinutes/60,0))} note="للحضور المسجل فقط"/>{canReadFinance && <Stat icon={<Wallet size={18}/>} label="إجمالي الأجر المستحق" value={money(visibleAttendanceRows.filter(a=>a.status==='present').reduce((sum,a)=>sum+(a.payableAmount ?? 0),0))} note="بناء على أجر الساعة المحفوظ وقت الحضور"/>}</section>
<ResponsiveTable
          caption="حضور المعلمات والطلاب"
          tableClassName="students-table wide-table schedule-session-table"
          rows={pagedMonthSessions}
          columns={sessionColumns}
          rowKey={(item) => item.slot.id + '-' + item.date}
          empty={<Empty icon={<CalendarClock size={22}/>} title="لا توجد حصص لهذا الشهر" text="أضف مواعيد أسبوعية للحلقات أولًا."/>}
          actions={(item) => {
            const meta = sessionMeta(item)
            if (meta.isFuture) return <small className="sub-cell">لم يحن الموعد</small>
            if (meta.circleInactive) return <small className="sub-cell">الحلقة متوقفة — عرض تاريخي</small>
            if (payrollLocked || !ctx.has('attendance.edit')) return <small className="sub-cell">غير متاح</small>
            return <>
              <button className="small-icon-button attendance-present" title="تسجيل حضور المعلمة المسندة" onClick={() => void ctx.markAttendance(item.slot, item.date, 'present')}><CheckCircle2 size={15}/></button>
              <button className="small-icon-button danger-action" title="تسجيل غياب المعلمة" onClick={() => void ctx.markAttendance(item.slot, item.date, 'absent')}><X size={15}/></button>
              <button className="small-icon-button" title="إلغاء الحصة" onClick={() => void ctx.markAttendance(item.slot, item.date, 'cancelled')}><Archive size={15}/></button>
              <button className="secondary-button compact-button" title="تسجيل معلمة بديلة لهذه الحصة فقط" onClick={() => setSubstituteSession({ slot: item.slot, date: item.date })}>بديلة</button>
              <button className="secondary-button compact-button student-attendance-action" title="فتح قائمة الطلاب وتسجيل حضورهم" onClick={() => setStudentSession({ slot: item.slot, date: item.date })}><UsersRound size={14}/> حضور الطلاب</button>
            </>
          }}
        />
        <Pager page={safePage} pageSize={SCHEDULE_PAGE_SIZE} total={visibleMonthSessions.length} onPageChange={setPage} label="حصة" />
</div>
          {canReadFinance && <div className="table-card glass">
<div className="table-heading">
<div>
<h3>ملخص المستحق لكل معلمة</h3>
<span>إجمالي الحضور المسجل للشهر فقط</span>
</div>
</div>
<ResponsiveTable
          caption="ملخص المستحق لكل معلمة"
          rows={visibleTeacherPay}
          columns={payColumns}
          rowKey={(row) => row.teacherId}
          empty={<Empty icon={<Wallet size={20}/>} title="لا توجد أجور حضور مسجلة" text="سجّل حضور المعلمة بعد انعقاد الحصة لتظهر القيمة المستحقة هنا."/>}
        />
</div>}</>}
          {(ctx.has('schedule.edit'))&&<div className="panel glass schedule-form-panel">
<div className="panel-heading">
<div>
<span className="eyebrow">مواعيد أسبوعية</span>
<h3>إضافة موعد حلقة</h3>
</div>
<span className="step-number">
<CalendarClock size={17}/>
</span>
</div>
<form onSubmit={ctx.saveScheduleSlot} className="form-grid schedule-form-grid">
<Field label="الحلقة *" wide>
<select required value={ctx.scheduleForm.circleId} onChange={e=>ctx.setScheduleForm(f=>({...f,circleId:e.target.value}))}>
<option value="">اختَر حلقة نشطة</option>{ctx.circles.filter(c=>c.isActive&&Boolean(c.teacherId)).map(c=>
<option key={c.id} value={c.id}>{c.name} · {c.teacherName}</option>)}</select>
</Field>
<Field label="اليوم *">
<select value={ctx.scheduleForm.dayOfWeek} onChange={e=>ctx.setScheduleForm(f=>({...f,dayOfWeek:e.target.value}))}>{weekDays.map((day,index)=>
<option key={day} value={index}>{day}</option>)}</select>
</Field>
<Field label="وقت البداية (24 ساعة) *">
<input dir="ltr" lang="en" aria-label="وقت البداية بصيغة 24 ساعة، الساعة ثم الدقائق" type="time" required value={ctx.scheduleForm.startsAt} onChange={e=>ctx.setScheduleForm(f=>({...f,startsAt:e.target.value}))}/>
</Field>
<Field label="مدة الحلقة بالدقائق *">
<input type="number" min="15" max="360" step="15" required value={ctx.scheduleForm.durationMinutes} onChange={e=>ctx.setScheduleForm(f=>({...f,durationMinutes:e.target.value}))}/>
</Field>
<div className="schedule-save-row">
<button className="primary-button" type="submit" disabled={ctx.saving||!ctx.circles.some(c=>c.id===ctx.scheduleForm.circleId&&c.isActive&&Boolean(c.teacherId))}>
<Plus size={15}/> حفظ الموعد الأسبوعي</button>
</div>
</form>
</div>}
          {(ctx.has('schedule.read')||ctx.has('schedule.edit'))&&<>
<div className="table-card glass">
<div className="table-heading">
<div>
<h3>المواعيد الأسبوعية المسجلة</h3>
<span>{visibleSlots.filter(slot=>slot.isActive&&slot.circleIsActive!==false).length} موعد نشط{visibleSlots.some(slot=>!slot.isActive)?` · ${visibleSlots.filter(slot=>!slot.isActive).length} موعد تاريخي`:''} · تنبيه قبل الموعد بـ10 دقائق وعند البداية</span>
</div>
</div>
<ResponsiveTable
          caption="المواعيد الأسبوعية المسجلة"
          rows={visibleSlots}
          columns={slotColumns}
          rowKey={(slot) => slot.id}
          empty={<Empty icon={<CalendarClock size={20}/>} title="لم تسجل مواعيد بعد" text="أضف موعدًا واحدًا أو أكثر لكل حلقة من النموذج بالأعلى."/>}
          actions={(slot) => slot.isActive && ctx.has('schedule.edit') && ctx.has('trash.manage')
            ? <button className="small-icon-button danger-action" title="نقل الموعد إلى سلة المهملات" onClick={() => void ctx.removeScheduleSlot(slot)}><Trash2 size={14}/></button>
            : null}
        />
</div>
          <section className="section-heading">
<div>
<span className="eyebrow">مربوط بالوقت الفعلي</span>
<h2>أقرب الحلقات القادمة</h2>
</div>
<span className="data-note">{visibleNextSessions.length} موعد نشط · الوقت حسب الساعة المحلية على هذا الجهاز</span>
</section>
          <div className="schedule-upcoming-grid">{visibleNextSessions.map(slot=>
<article className="schedule-upcoming-card glass" key={slot.id}>
<div className="schedule-card-head">
<span className="stat-icon">
<BookOpen size={18}/>
</span>
<span className="schedule-day-pill">{weekDays[slot.dayOfWeek]}</span>
</div>
<strong>{slot.circleName}</strong>
<p>
<GraduationCap size={14}/>{slot.teacherName||'لم تحدد معلمة'}</p>
<p>
<Clock3 size={14}/>{formatTime12(slot.startsAt)} · {slot.durationMinutes} دقيقة</p>
<div className="countdown-label">{slot.isRunning?'الوقت المتبقي من الحلقة':'متبقي على الحلقة'}</div>
<div className="countdown-value">{slot.isRunning?remainingLabel(slot.endsAt.getTime()-ctx.clockNow):remainingLabel(slot.target.getTime()-ctx.clockNow)}</div>
<small>{formatDate(cairoDayKey(slot.target))}</small>
<div className={`schedule-alert-state ${ctx.isScheduleAlertEnabled(slot.id)?'is-alert-enabled':'is-alert-disabled'}`}>
<BellRing size={12}/>{ctx.isScheduleAlertEnabled(slot.id)?'التنبيه مفعّل':'التنبيه متوقف'}</div>
</article>)}{visibleNextSessions.length===0&&<div className="panel glass">
<Empty icon={<CalendarClock size={23}/>} title="لا توجد مواعيد قادمة مطابقة" text="أضف يومًا ووقتًا ومدة لكل حلقة حتى تظهر التذكيرات هنا."/>
</div>}</div>
</>}
          {studentSession && <StudentAttendanceDialog key={`${studentSession.slot.id}:${studentSession.date}`} slot={studentSession.slot} date={studentSession.date} close={()=>setStudentSession(null)} notify={ctx.notifySystem} afterSaved={async()=>{await ctx.loadAttendance()}}/>}
          {substituteSession && <TeacherSubstitutionDialog ctx={ctx} slot={substituteSession.slot} date={substituteSession.date} close={()=>setSubstituteSession(null)} onSaved={()=>setSubstituteSession(null)}/>}
        </motion.section>
}
