import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, LoaderCircle, UsersRound } from 'lucide-react'
import Modal from '../common/Modal'
import AttendanceStatusPicker from '../common/AttendanceStatusPicker'
import type { ScheduleSlot, StudentAttendanceRosterRow } from '../../domain/types'
import { formatDate } from '../../lib/formatters'

type AttendanceStatus = 'present' | 'absent' | 'excused'
type Notice = (tone: 'success' | 'error' | 'info', text: string) => void
type Props = { slot: ScheduleSlot; date: string; close: () => void; notify: Notice; afterSaved: () => Promise<void>; level?: number }

export default function StudentAttendanceDialog({ slot, date, close, notify, afterSaved, level = 0 }: Props) {
  const [rows, setRows] = useState<StudentAttendanceRosterRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, AttendanceStatus | ''>>({})
  const [dirty, setDirty] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [includeOutsideEnrollmentDates, setIncludeOutsideEnrollmentDates] = useState(false)
  const visibleRows = useMemo(() => rows.filter(row => row.eligibleForDate || row.eligibilityReason === 'paused' || includeOutsideEnrollmentDates), [rows, includeOutsideEnrollmentDates])
  const eligibleCount = useMemo(() => rows.filter(row => row.eligibleForDate).length, [rows])
  const outsideEnrollmentCount = useMemo(() => rows.filter(row => !row.eligibleForDate && row.eligibilityReason !== 'paused').length, [rows])
  const changedCount = useMemo(() => dirty.size, [dirty])

  useEffect(() => {
    let live = true
    const load = async () => {
      setLoading(true); setLoadError(''); setRows([]); setDrafts({}); setDirty(new Set()); setIncludeOutsideEnrollmentDates(false)
      try {
        const response = await fetch(`/api/student-attendance/roster?scheduleSlotId=${encodeURIComponent(slot.id)}&date=${encodeURIComponent(date)}`, { credentials: 'include', cache: 'no-store' })
        if (!response.ok) throw new Error('تعذر تحميل قائمة الطلاب لهذه الحصة.')
        const data = await response.json() as StudentAttendanceRosterRow[]
        if (!live) return
        setRows(data)
        setIncludeOutsideEnrollmentDates(false)
        setDrafts(Object.fromEntries(data.map(row => [row.enrollmentId, row.status ?? ''])))
        setDirty(new Set())
      } catch (error) { if (live) setLoadError(error instanceof Error ? error.message : 'تعذر تحميل الطلاب.') }
      finally { if (live) setLoading(false) }
    }
    void load()
    return () => { live = false }
  }, [slot.id, date])

  const changeStatus = (enrollmentId: string, status: AttendanceStatus | '') => {
    setDrafts(current => ({ ...current, [enrollmentId]: status }))
    setDirty(current => new Set(current).add(enrollmentId))
  }

  const save = async () => {
    const pending = visibleRows.filter(row => dirty.has(row.enrollmentId) && drafts[row.enrollmentId] && (row.eligibleForDate || row.eligibilityReason === 'before-enrollment-start'))
    const historicalPending = pending.filter(row => row.eligibilityReason === 'before-enrollment-start')
    if (historicalPending.length > 0 && !window.confirm(`هناك ${historicalPending.length} طالب خارج فترة الالتحاق المسجلة لهذا التاريخ. سيتم حفظ الحضور كتسجيل تاريخي مع تسجيل الاستثناء في سجل التغييرات. هل تريد المتابعة؟`)) return
    if (pending.length === 0) { notify('info', 'غيّر حالة طالب واحد على الأقل قبل الحفظ.'); return }
    setSaving(true)
    const results = await Promise.all(pending.map(async row => {
      try {
        const response = await fetch('/api/student-attendance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduleSlotId: slot.id, enrollmentId: row.enrollmentId, sessionDate: date, status: drafts[row.enrollmentId], note: row.note ?? null, allowHistoricalEntry: row.eligibilityReason === 'before-enrollment-start' }) })
        if (response.ok) return { row, ok: true as const, message: '' }
        let message = 'تعذر حفظ سجل الحضور.'
        try { const body = await response.json(); message = body.message ?? message } catch { /* response may not be JSON */ }
        return { row, ok: false as const, message: `${row.studentName}: ${message}` }
      } catch { return { row, ok: false as const, message: `${row.studentName}: تعذر الاتصال بالخادم.` } }
    }))
    setSaving(false)
    const successIds = new Set(results.filter(result => result.ok).map(result => result.row.enrollmentId))
    const success = successIds.size
    const failures = results.filter(result => !result.ok).map(result => result.message)
    if (success > 0) {
      await afterSaved()
      if (failures.length === 0) { notify('success', `تم حفظ حضور ${success} طالبًا.`); close(); return }
      notify('error', `تم حفظ ${success} سجلًا، وتعذر حفظ ${failures.length}. راجع الحالات التي لم تُحفظ وأعد المحاولة.`)
      setDirty(current => new Set([...current].filter(id => !successIds.has(id))))
    } else notify('error', failures[0] ?? 'لم يتم حفظ أي سجل.')
  }

  return <Modal level={level} wide title={`حضور الطلاب · ${slot.circleName}`} subtitle={`${formatDate(date)} · ${slot.teacherName || 'معلمة غير محددة'} · ${slot.startsAt.slice(0,5)}`} close={close}>
    <div className="student-attendance-dialog">
      <div className="system-panel-heading"><div><span className="eyebrow">تسجيل الحصة</span><h3>قائمة الطلاب</h3><p>اختَر الحالة لكل طالب ثم احفظ التغييرات. لا تُسجّل الحالات غير المحددة تلقائيًا.</p></div><span className="system-heading-icon"><UsersRound size={20}/></span></div>
      {loading ? <div className="dialog-loading"><LoaderCircle className="spin" size={20}/> جارٍ تحميل الطلاب…</div> : loadError ? <div className="error-panel">{loadError}</div> : rows.length === 0 ? <div className="empty-state compact-empty"><strong>لا يوجد طالب ملتحق بهذه الحلقة حتى الآن.</strong><p>ألحِق الطالب بالحلقة من ملف الطالب أو من تفاصيل الحلقة أولًا؛ تسجيل الحضور لا ينقل الطالب إلى حلقة جديدة تلقائيًا.</p></div> : <>
        {outsideEnrollmentCount > 0 && <label className="attendance-historical-toggle"><input type="checkbox" checked={includeOutsideEnrollmentDates} onChange={event => { if (dirty.size > 0 && !window.confirm('تغيير نطاق القائمة سيمسح التعديلات غير المحفوظة. هل تريد المتابعة؟')) return; setIncludeOutsideEnrollmentDates(event.target.checked); setDirty(new Set()) }}/><span><strong>إظهار كل الملتحقين بهذه الحلقة</strong><small>يعرض الحالات التي لا تنطبق عليها الأهلية. يسمح الإدخال التاريخي فقط بالتاريخ السابق لبداية الالتحاق المسجلة؛ ولا يتجاوز بداية الحلقة أو الإيقاف أو نهاية الالتحاق.</small></span><b>{includeOutsideEnrollmentDates ? 'يشمل التاريخية' : `${eligibleCount} مناسبين للتاريخ`}</b></label>}
        {visibleRows.length === 0 ? <div className="empty-state compact-empty"><strong>لا يوجد التحاق صالح لهذا التاريخ المحدد.</strong><p>يمكنك اختيار «إظهار كل الملتحقين» لإدخال حضور تاريخي إذا كانت تواريخ الالتحاق الحالية لا تعكس الواقع القديم.</p><button className="secondary-button" type="button" onClick={() => setIncludeOutsideEnrollmentDates(true)}>إظهار كل الملتحقين</button></div> : <div className="table-scroll"><table className="students-table wide-table"><thead><tr><th>الطالب</th><th>الكود</th><th>حالة الالتحاق في التاريخ</th><th>حالة الحضور</th></tr></thead><tbody>{visibleRows.map(row => <tr key={row.enrollmentId} className={row.eligibleForDate ? '' : 'attendance-outside-enrollment'}><td><strong>{row.studentName}</strong></td><td>{row.studentCode}</td><td>{row.eligibilityReason === 'paused' ? <span className="status-pill status-paused">التحاق متوقف في هذا التاريخ</span> : row.eligibleForDate ? <span className="status-pill status-active">ضمن فترة الالتحاق</span> : <span className="status-pill pay-unpaid">خارج فترة الالتحاق</span>}</td><td>{row.eligibleForDate || (includeOutsideEnrollmentDates && row.eligibilityReason === 'before-enrollment-start') ? <AttendanceStatusPicker value={drafts[row.enrollmentId] ?? ''} onChange={value => changeStatus(row.enrollmentId, value)} label={`حضور ${row.studentName}`}/> : <small className="sub-cell">{row.status ? `سجل محفوظ: ${row.status === 'present' ? 'حاضر' : row.status === 'absent' ? 'غائب' : 'غائب بعذر'}` : row.eligibilityReason === 'paused' ? 'لا يمكن تسجيل حضور خلال فترة الإيقاف' : row.eligibilityReason === 'before-circle-start' ? 'الحلقة لم تبدأ في هذا التاريخ' : row.eligibilityReason === 'after-enrollment-end' ? 'التاريخ بعد نهاية الالتحاق' : row.eligibilityReason === 'before-enrollment-start' ? 'يتطلب تفعيل الإدخال التاريخي' : 'الالتحاق لم يكن نشطًا في هذا التاريخ'}</small>}</td></tr>)}</tbody></table></div>}
      </>}
      <div className="modal-actions"><span className="muted-text">تغييرات غير محفوظة: {changedCount}</span><button type="button" className="secondary-button" onClick={close}>إغلاق</button><button type="button" className="primary-button" onClick={() => void save()} disabled={loading || saving || changedCount===0 || !visibleRows.some(row => row.eligibleForDate || (includeOutsideEnrollmentDates && row.eligibilityReason === 'before-enrollment-start'))}>{saving ? <LoaderCircle className="spin" size={15}/> : <CheckCircle2 size={15}/>} حفظ الحضور</button></div>
    </div>
  </Modal>
}
