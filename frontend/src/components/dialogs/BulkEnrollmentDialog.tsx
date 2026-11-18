import { useMemo, useState, type FormEvent } from 'react'
import Modal from '../common/Modal'
import Field from '../common/Field'
import { request } from '../../services/apiClient'
import { localDateString } from '../../lib/dates'
import type { Circle } from '../../domain/types'
import type { DarApplicationContext } from '../../application/useDarApplication'

type Props = { ctx: DarApplicationContext; circle: Circle; close: () => void }

export default function BulkEnrollmentDialog({ ctx, circle, close }: Props) {
  const existing = useMemo(() => new Set(ctx.circleRoster.filter(row => row.enrollmentStatus === 'active' || row.enrollmentStatus === 'paused').map(row => row.studentId)), [ctx.circleRoster])
  const available = useMemo(() => ctx.students.filter(student => student.status === 'active' && !existing.has(student.id)), [ctx.students, existing])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [startsOn, setStartsOn] = useState(localDateString())
  const [allowClosed, setAllowClosed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = available.filter(student => {
    const term = search.trim()
    return !term || student.fullName.includes(term) || student.studentCode.includes(term)
  })

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (selected.length === 0) { setError('اختر طالبًا واحدًا على الأقل.'); return }
    setSaving(true)
    setError(null)
    try {
      const result = await request<{ added: number; skipped: number }>('/api/circle-enrollments/bulk', {
        method: 'POST',
        body: JSON.stringify({ circleId: circle.id, startsOn, studentIds: selected, allowClosedCircle: allowClosed }),
      })
      ctx.notifySystem('success', `تم إلحاق ${result.added} طالب${result.skipped ? `، وتجاهل ${result.skipped} موجودين بالفعل` : ''}.`)
      await ctx.openCircleDetails(circle)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إلحاق الطلاب.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal level={1} title={`إلحاق مجموعة بحلقة ${circle.name}`} subtitle="اختر عدة طلاب من قائمة الطلاب الحاليين بدل فتح نموذج الإلحاق لكل طالب." wide close={close}>
    <form onSubmit={submit}>
      <div className="form-grid">
        <Field label="بحث بالاسم أو الكود" wide><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="اكتب اسم الطالب أو كوده" /></Field>
        <Field label="تاريخ بداية الالتحاق *"><input type="date" required value={startsOn} onChange={event => setStartsOn(event.target.value)} /></Field>
        <Field label="الطلاب المحددون"><output className="calculated-amount">{selected.length} طالب</output></Field>
        {!circle.isActive && ctx.has('circles.edit') && <label className="system-toggle-field wide"><input type="checkbox" checked={allowClosed} onChange={event => setAllowClosed(event.target.checked)} /><span><strong>السماح بالإلحاق في حلقة متوقفة</strong><small>سيُحفظ الالتحاق دون إنشاء رسوم شهرية تلقائية حتى تعود الحلقة نشطة.</small></span></label>}
        <div className="form-field wide">
          <span>الطلاب المتاحون ({filtered.length})</span>
          <div className="bulk-enrollment-list">
            {filtered.length === 0 && <div className="empty-inline">لا توجد طلاب متاحون لهذه الحلقة.</div>}
            {filtered.map(student => <label className="bulk-enrollment-row" key={student.id}>
              <input type="checkbox" checked={selected.includes(student.id)} onChange={event => setSelected(current => event.target.checked ? [...current, student.id] : current.filter(value => value !== student.id))} />
              <span><strong>{student.fullName}</strong><small>{student.studentCode} · {student.circleNames || 'بدون حلقة'}</small></span>
            </label>)}
          </div>
        </div>
        {error && <p className="error-inline wide">{error}</p>}
      </div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={close} disabled={saving}>إلغاء</button><button type="submit" className="primary-button" disabled={saving || selected.length === 0}>{saving ? 'جارٍ الإلحاق…' : `إلحاق المحدد (${selected.length})`}</button></div>
    </form>
  </Modal>
}
