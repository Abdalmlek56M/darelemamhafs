import { useMemo, useState, type FormEvent } from 'react'
import Modal from '../common/Modal'
import Field from '../common/Field'
import { request } from '../../services/apiClient'
import { localDateString } from '../../lib/dates'
import type { Circle } from '../../domain/types'
import type { DarApplicationContext } from '../../application/useDarApplication'

type Props = { ctx: DarApplicationContext; circle: Circle; close: () => void }

const roundToCents = (value: number) => Math.round(value * 100) / 100

export default function BulkEnrollmentDialog({ ctx, circle, close }: Props) {
  const canEditFinancials = ctx.has('finance.edit')
  const existing = useMemo(() => new Set(ctx.circleRoster.filter(row => row.enrollmentStatus === 'active' || row.enrollmentStatus === 'paused').map(row => row.studentId)), [ctx.circleRoster])
  const available = useMemo(() => ctx.students.filter(student => student.status === 'active' && !existing.has(student.id)), [ctx.students, existing])
  const defaultFee = circle.monthlyFee != null ? String(circle.monthlyFee) : ''

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [fees, setFees] = useState<Record<string, string>>({})
  const [bulkFee, setBulkFee] = useState(defaultFee)
  const [startsOn, setStartsOn] = useState(localDateString())
  const [allowClosed, setAllowClosed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = available.filter(student => {
    const term = search.trim()
    return !term || student.fullName.includes(term) || student.studentCode.includes(term)
  })

  const toggleStudent = (studentId: string, checked: boolean) => {
    setSelected(current => checked ? [...current, studentId] : current.filter(value => value !== studentId))
    if (canEditFinancials) setFees(current => ({ ...current, [studentId]: checked ? (current[studentId] ?? defaultFee) : '' }))
  }

  const selectAllVisible = () => {
    const ids = filtered.map(student => student.id)
    setSelected(current => [...new Set([...current, ...ids])])
    if (canEditFinancials) setFees(current => {
      const next = { ...current }
      for (const id of ids) next[id] = next[id] ?? defaultFee
      return next
    })
  }

  const clearSelection = () => setSelected([])

  const applyBulkFee = () => {
    if (!canEditFinancials) return
    setFees(current => {
      const next = { ...current }
      for (const id of selected) next[id] = bulkFee
      return next
    })
  }

  const feeFor = (studentId: string) => fees[studentId] ?? defaultFee
  const validFee = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const value = Number(trimmed.replace(/,/g, '.'))
    if (!Number.isFinite(value) || value < 0) return undefined
    if (Math.abs(roundToCents(value) - value) > 1e-9) return undefined
    return value
  }

  const totalSelected = canEditFinancials
    ? selected.reduce((sum, id) => sum + (validFee(feeFor(id)) ?? 0), 0)
    : null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (selected.length === 0) { setError('اختر طالبًا واحدًا على الأقل.'); return }
    const students = selected.map(studentId => {
      const parsed = canEditFinancials ? validFee(feeFor(studentId)) : null
      if (parsed === undefined) {
        const student = available.find(item => item.id === studentId)
        setError('الرسوم المتفق عليها غير صالحة للطالب: ' + (student?.fullName ?? studentId) + ' — رقم غير سالب بمنزلتين عشريتين على الأكثر.')
        return null
      }
      return { studentId, agreedMonthlyFee: parsed }
    })
    if (students.some(item => item === null)) return
    setSaving(true)
    setError(null)
    try {
      const result = await request<{ added: number; skipped: number; feesApplied?: number }>('/api/circle-enrollments/bulk', {
        method: 'POST',
        body: JSON.stringify({ circleId: circle.id, startsOn, allowClosedCircle: allowClosed, students }),
      })
      const feeNote = canEditFinancials && result.feesApplied ? '، وسُجلت رسوم ' + result.feesApplied + ' طالب' : ''
      ctx.notifySystem('success', 'تم إلحاق ' + result.added + ' طالب' + (result.skipped ? '، وتجاهل ' + result.skipped + ' موجودين بالفعل' : '') + feeNote + '.')
      await ctx.openCircleDetails(circle)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إلحاق الطلاب.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal level={1} title={'إلحاق مجموعة بحلقة ' + circle.name} subtitle="اختر عدة طلاب من قائمة الطلاب الحاليين، وحدّد الرسوم المتفق عليها لكل طالب دفعة واحدة بدل فتح نموذج الإلحاق لكل طالب." wide close={close}>
    <form onSubmit={submit}>
      <div className="form-grid">
        <Field label="بحث بالاسم أو الكود" wide><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="اكتب اسم الطالب أو كوده" /></Field>
        <Field label="تاريخ بداية الالتحاق *"><input type="date" required value={startsOn} onChange={event => setStartsOn(event.target.value)} /></Field>
        <Field label="الطلاب المحددون"><output className="calculated-amount">{selected.length} طالب</output></Field>
        {!circle.isActive && ctx.has('circles.edit') && <label className="system-toggle-field wide"><input type="checkbox" checked={allowClosed} onChange={event => setAllowClosed(event.target.checked)} /><span><strong>السماح بالإلحاق في حلقة متوقفة</strong><small>سيُحفظ الالتحاق دون إنشاء رسوم شهرية تلقائية حتى تعود الحلقة نشطة.</small></span></label>}

        {canEditFinancials && <div className="bulk-fee-toolbar wide">
          <Field label="سعر موحّد تطبّقه على المحددين"><input type="number" min="0" step="0.01" inputMode="decimal" value={bulkFee} onChange={event => setBulkFee(event.target.value)} placeholder="مثال: 250" /></Field>
          <button type="button" className="secondary-button" onClick={applyBulkFee} disabled={selected.length === 0}>تطبيق السعر على المحددين</button>
          <span className="bulk-fee-note">السعر الافتراضي لكل طالب = سعر الحلقة ({defaultFee || 'غير محدد'} ج.م)، ويمكن تعديله لكل طالب على حدة.</span>
        </div>}

        <div className="form-field wide">
          <div className="bulk-list-heading">
            <span>الطلاب المتاحون ({filtered.length})</span>
            <div className="bulk-list-actions">
              <button type="button" className="text-link" onClick={selectAllVisible} disabled={filtered.length === 0}>تحديد الكل</button>
              <button type="button" className="text-link" onClick={clearSelection} disabled={selected.length === 0}>إلغاء التحديد</button>
            </div>
          </div>
          <div className="bulk-enrollment-list">
            {filtered.length === 0 && <div className="empty-inline">لا توجد طلاب متاحون لهذه الحلقة.</div>}
            {filtered.map(student => {
              const isSelected = selected.includes(student.id)
              return <label className={'bulk-enrollment-row' + (isSelected ? ' is-selected' : '')} key={student.id}>
                <input type="checkbox" checked={isSelected} onChange={event => toggleStudent(student.id, event.target.checked)} />
                <span className="bulk-student-copy"><strong>{student.fullName}</strong><small>{student.studentCode} · {student.circleNames || 'بدون حلقة'}</small></span>
                {canEditFinancials && isSelected && <span className="bulk-fee-field">
                  <small>الرسوم المتفق عليها (ج.م)</small>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={feeFor(student.id)} onChange={event => setFees(current => ({ ...current, [student.id]: event.target.value }))} aria-label={'الرسوم المتفق عليها للطالب ' + student.fullName} />
                </span>}
              </label>
            })}
          </div>
        </div>

        {canEditFinancials && <p className="bulk-total wide">إجمالي الشهري للمحددين: <strong>{totalSelected?.toFixed(2)} ج.م</strong></p>}
        {error && <p className="error-inline wide">{error}</p>}
      </div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={close} disabled={saving}>إلغاء</button><button type="submit" className="primary-button" disabled={saving || selected.length === 0}>{saving ? 'جارٍ الإلحاق…' : 'إلحاق المحدد (' + selected.length + ')'}</button></div>
    </form>
  </Modal>
}
