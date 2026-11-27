import { useEffect, useMemo, useState } from 'react'
import Modal from '../common/Modal'
import { formatDate, money } from '../../lib/formatters'
import { formatTime12 } from '../../lib/dates'
import { addCairoDays, cairoToday, cairoWeekday, dayKeyWeekday } from '../../lib/cairoDate'
import { Archive, CheckCircle2, Pause, Play, Plus, RefreshCw, Users } from 'lucide-react'
import Empty from '../common/EmptyState'
import ResponsiveTable, { type ResponsiveColumn } from '../common/ResponsiveTable'
import { confirmAction } from '../common/confirmService'
import StudentAttendanceDialog from './StudentAttendanceDialog'
import BulkEnrollmentDialog from './BulkEnrollmentDialog'
import type { DarApplicationContext } from '../../application/useDarApplication'
import type { ScheduleSlot } from '../../domain/types'


type Props = { ctx: DarApplicationContext }

function recentDatesForWeekday(dayOfWeek: number, count = 52) {
  // Latest occurrence of the weekday on the Cairo calendar (never the device one).
  const latest = addCairoDays(cairoToday(), -((cairoWeekday() - dayOfWeek + 7) % 7))
  return Array.from({ length: count }, (_, index) => addCairoDays(latest, -index * 7))
}
function mostRecentDateForWeekday(dayOfWeek: number, startsOn?: string) {
  const latest = recentDatesForWeekday(dayOfWeek, 1)[0]
  const start = startsOn?.slice(0, 10)
  if (!start || latest >= start) return latest
  return addCairoDays(start, (dayOfWeek - dayKeyWeekday(start) + 7) % 7)
}

export default function CircleDetailsDialog({ ctx }: Props) {
  const selectedCircle = ctx.selectedCircle
  const circleSlots = selectedCircle ? ctx.scheduleSlots.filter(slot => slot.circleId === selectedCircle.id) : []
  const defaultSlot = circleSlots[0] ?? null
  const [attendancePickerOpen, setAttendancePickerOpen] = useState(false)
  const [attendanceSlotId, setAttendanceSlotId] = useState('')
  const [attendanceDate, setAttendanceDate] = useState(() => defaultSlot ? mostRecentDateForWeekday(defaultSlot.dayOfWeek, selectedCircle?.startsOn) : cairoToday())
  const [attendanceDialogSession, setAttendanceDialogSession] = useState<{ slot: ScheduleSlot; date: string } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const selectedSlot = circleSlots.find(slot => slot.id === attendanceSlotId) ?? circleSlots[0] ?? null
    const selectedDateMatchesSlot = Boolean(selectedSlot && attendanceDate && dayKeyWeekday(attendanceDate) === selectedSlot.dayOfWeek)
  useEffect(() => { setAttendanceSlotId(''); setAttendanceDate(defaultSlot ? mostRecentDateForWeekday(defaultSlot.dayOfWeek, selectedCircle?.startsOn) : cairoToday()); setAttendancePickerOpen(false); setAttendanceDialogSession(null) }, [selectedCircle?.id, defaultSlot?.id])
  if (!selectedCircle) return null
  const rosterColumns: ResponsiveColumn<(typeof ctx.circleRoster)[number]>[] = [
    {
      key: 'student', header: 'الطالب', primary: true,
      render: (row) => ctx.has('students.read')
        ? <button className="text-link" onClick={() => void ctx.openHistory(row.studentId, { id: row.studentId, fullName: row.studentName, studentCode: row.studentCode })}>{row.studentName}<small>{row.studentCode}</small></button>
        : <span>{row.studentName}<small className="sub-cell">{row.studentCode}</small></span>,
    },
    {
      key: 'status', header: 'الحالة',
      render: (row) => <span className={`status-pill ${row.enrollmentStatus === 'ended' ? 'status-ended' : row.enrollmentStatus === 'paused' ? 'status-paused' : 'status-active'}`}>{row.enrollmentStatus === 'ended' ? 'منتهي' : row.enrollmentStatus === 'paused' ? 'متوقف مؤقتًا' : 'نشط'}</span>,
    },
    { key: 'age', header: 'العمر', render: (row) => row.ageYears == null ? '—' : row.ageYears + ' سنة' },
    { key: 'joined', header: 'تاريخ الالتحاق', render: (row) => <>{formatDate(row.startsOn)}{row.endsOn && <small className="sub-cell">حتى {formatDate(row.endsOn)}</small>}</> },
    ...(ctx.has('finance.read') ? [
      { key: 'fee', header: 'الرسوم المتفق عليها', render: (row: (typeof ctx.circleRoster)[number]) => money(row.agreedMonthlyFee) },
      { key: 'paid', header: 'تحصيل الشهر', render: (row: (typeof ctx.circleRoster)[number]) => <>{money(row.currentMonthPaid)} / {money(row.currentMonthDue)}</> },
    ] : []),
  ]
  const openStudentAttendance = async (slot: ScheduleSlot) => {
    if (!selectedDateMatchesSlot && !(await confirmAction({ title: 'تأكيد تاريخ استثنائي', message: `التاريخ المختار لا يوافق يوم الموعد الأسبوعي (${['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][slot.dayOfWeek]}). هل تريد تسجيلها كحصة استثنائية في هذا التاريخ؟`, confirmLabel: 'متابعة' }))) return
    setAttendancePickerOpen(false); setAttendanceDialogSession({ slot, date: attendanceDate })
  }
  return <>
    <Modal title={`الحلقة: ${selectedCircle.name}`} subtitle={`${selectedCircle.teacherName||'لم تُحدد معلمة'} · ${ctx.has('finance.read') ? `الرسوم الافتراضية ${money(selectedCircle.monthlyFee)}` : 'البيانات المالية مقيدة بصلاحية المالية'}`} wide close={()=>ctx.setSelectedCircle(null)}>
      <div className="circle-detail-header">
        <div className="circle-detail-meta">
<span>وصف الجدول: {selectedCircle.scheduleText||'غير مسجل'}</span>
<span>المواعيد المتكررة الفعلية: {circleSlots.length} موعد</span>
<span>{selectedCircle.activeStudentCount} طالب نشط</span>
<span>بدء الحلقة الفعلي: {formatDate(selectedCircle.startsOn)}</span>
</div>
        <div className="toolbar-actions circle-detail-actions">
          {ctx.has('attendance.edit')&&<button className="secondary-button" onClick={()=>setAttendancePickerOpen(open=>!open)}>
<CheckCircle2 size={15}/> حضور الطلاب وتسجيل الغياب</button>}
          {ctx.has('students.edit')&&selectedCircle.isActive&&<button className="secondary-button" onClick={()=>setBulkOpen(true)}>
<Users size={15}/> إلحاق مجموعة</button>}
          {ctx.has('students.edit')&&<button className="primary-button" onClick={()=>ctx.openEnrollmentCreate('',selectedCircle.id,selectedCircle.monthlyFee)}>
<Plus size={15}/> إلحاق طالب</button>}
        </div>
      </div>
      {attendancePickerOpen&&ctx.has('attendance.edit')&&<section className="student-attendance-launcher panel glass">
        <div>
<span className="eyebrow">تسجيل حضور من ملف الحلقة</span>
<h3>سجّل حضور الطلاب للحصة</h3>
<p>اختَر يوم الحصة وموعدها. حدّد لكل طالب حاضر أو غائب أو غائب بعذر، ثم احفظ مرة واحدة. التسجيل سيظهر في ملف الطالب وتقارير الحلقة.</p>
</div>
        {circleSlots.length===0?<div className="empty-state compact-empty">
<strong>لا يوجد موعد أسبوعي مسجل لهذه الحلقة.</strong>
<p>أضف موعدًا من صفحة «المواعيد وحضور المعلمات» أولًا.</p>
</div>:<div className="student-attendance-launcher-fields">
          <label className="form-field">
<span>الموعد الأسبوعي</span>
<select value={selectedSlot?.id??''} onChange={event=>{const nextId=event.target.value;setAttendanceSlotId(nextId);const nextSlot=circleSlots.find(slot=>slot.id===nextId);if(nextSlot)setAttendanceDate(mostRecentDateForWeekday(nextSlot.dayOfWeek, selectedCircle.startsOn))}}>{circleSlots.map(slot=>
<option key={slot.id} value={slot.id}>{['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][slot.dayOfWeek]} · {formatTime12(slot.startsAt)} · {slot.durationMinutes} دقيقة{slot.isActive?'':' · موعد تاريخي موقوف'}</option>)}</select>
</label>
          <label className="form-field attendance-date-field">
<span>تاريخ الحصة</span>
<input type="date" value={attendanceDate} onChange={event=>setAttendanceDate(event.target.value)}/>
<small>يُقترح تلقائيًا آخر موعد يوافق جدول الحلقة. يمكنك تغييره لتسجيل حضور قديم، بما في ذلك تاريخ قبل اليوم إن كان السجل التاريخي يحتاج تصحيحًا.</small>
</label>
          <div className="attendance-launcher-actions">
<button className="primary-button" type="button" disabled={!selectedSlot||!attendanceDate||attendanceDate>cairoToday()} onClick={() => { if (selectedSlot && attendanceDate) void openStudentAttendance(selectedSlot) }}>
<Users size={15}/> فتح كشف الطلاب</button>
</div>
<small className="attendance-selected-session">الموعد المختار: {selectedSlot?`${['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][selectedSlot.dayOfWeek]} · ${formatTime12(selectedSlot.startsAt)} · ${selectedSlot.durationMinutes} دقيقة`:'—'} — التاريخ {attendanceDate||'—'}. يُقترح تلقائيًا حسب الموعد، ويمكن تغييره لتسجيل حضور قديم.</small>{selectedSlot&&attendanceDate&&!selectedDateMatchesSlot&&<span className="error-inline">التاريخ المختار لا يوافق يوم الموعد الأسبوعي ({['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][selectedSlot.dayOfWeek]}). اختَر تاريخًا صحيحًا أو غيّر الموعد.</span>}
        </div>}
      </section>}
      {ctx.circleDetailsLoading?<div className="loading-inline">
<RefreshCw className="spin" size={17}/> جارٍ تحميل الطلاب…</div>:<ResponsiveTable
        caption="طلاب الحلقة"
        rows={ctx.circleRoster}
        columns={rosterColumns}
        rowKey={(row) => row.enrollmentId}
        empty={<Empty icon={<Users size={22}/>} title="لا يوجد التحاقات في هذه الحلقة" text="يمكنك إلحاق طالب جديد من هنا."/>}
        actions={(row) => <>
          {ctx.has('students.edit') && row.enrollmentStatus === 'active' && <button className="small-icon-button" title="إيقاف هذا الالتحاق مؤقتًا دون التأثير على حلقات الطالب الأخرى" disabled={ctx.saving} onClick={() => void ctx.pauseEnrollment(row.enrollmentId, row.studentId, row.studentName, selectedCircle.name, selectedCircle.id)}><Pause size={14}/></button>}
          {ctx.has('students.edit') && row.enrollmentStatus === 'paused' && <button className="small-icon-button attendance-present" title="استئناف هذا الالتحاق" disabled={ctx.saving} onClick={() => void ctx.resumeEnrollment(row.enrollmentId, row.studentId, row.studentName, selectedCircle.name, selectedCircle.id)}><Play size={14}/></button>}
          {(row.enrollmentStatus === 'active' || row.enrollmentStatus === 'paused') && ctx.has('students.edit') && <button className="small-icon-button danger-action" title="إنهاء الالتحاق مع حفظ تاريخه" disabled={ctx.saving} onClick={() => void ctx.endEnrollment(row.enrollmentId, row.studentId, row.studentName, selectedCircle.name, selectedCircle.id)}><Archive size={14}/></button>}
        </>}
      />}
    </Modal>
    {attendanceDialogSession && <StudentAttendanceDialog key={`${attendanceDialogSession.slot.id}:${attendanceDialogSession.date}`} slot={attendanceDialogSession.slot} date={attendanceDialogSession.date} level={1} close={()=>setAttendanceDialogSession(null)} notify={ctx.notifySystem} afterSaved={async()=>{await ctx.openCircleDetails(selectedCircle)}}/>}
    {bulkOpen && <BulkEnrollmentDialog ctx={ctx} circle={selectedCircle} close={()=>setBulkOpen(false)}/>}
  </>
}
