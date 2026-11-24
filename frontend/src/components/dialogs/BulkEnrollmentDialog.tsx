import { useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, Search, Users, X } from 'lucide-react'
import Modal from '../common/Modal'
import Field from '../common/Field'
import { request } from '../../services/apiClient'
import { localDateString } from '../../lib/dates'
import type { Circle } from '../../domain/types'
import type { DarApplicationContext } from '../../application/useDarApplication'

type Props = { ctx: DarApplicationContext; circle: Circle; close: () => void }

const roundToCents = (value: number) => Math.round(value * 100) / 100
const parseFee = (raw: string): number | null | undefined => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed.replace(/,/g, '.'))
  if (!Number.isFinite(value) || value < 0) return undefined
  if (Math.abs(roundToCents(value) - value) > 1e-9) return undefined
  return value
}
const money = (value: number) => value.toFixed(2)

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

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const feeFor = (studentId: string) => fees[studentId] ?? defaultFee
  const invalidIds = useMemo(() => {
    if (!canEditFinancials) return new Set<string>()
    return new Set(selected.filter(studentId => parseFee(feeFor(studentId)) === undefined))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, fees, defaultFee, canEditFinancials])

  const totalSelected = canEditFinancials
    ? selected.reduce((sum, studentId) => sum + (parseFee(feeFor(studentId)) ?? 0), 0)
    : null

  const allVisibleSelected = filtered.length > 0 && filtered.every(student => selectedSet.has(student.id))

  const toggleStudent = (studentId: string, checked: boolean) => {
    setSelected(current => checked ? [...current, studentId] : current.filter(value => value !== studentId))
    if (canEditFinancials) setFees(current => ({ ...current, [studentId]: checked ? (current[studentId] ?? defaultFee) : '' }))
  }

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filtered.map(student => student.id))
      setSelected(current => current.filter(studentId => !visibleIds.has(studentId)))
      return
    }
    const ids = filtered.map(student => student.id)
    setSelected(current => [...new Set([...current, ...ids])])
    if (canEditFinancials) setFees(current => {
      const next = { ...current }
      for (const id of ids) next[id] = next[id] ?? defaultFee
      return next
    })
  }

  const applyBulkFee = () => {
    if (!canEditFinancials) return
    if (parseFee(bulkFee) === undefined) { setError('السعر الموحّد غير صالح: رقم غير سالب بمنزلتين عشريتين على الأكثر.'); return }
    setError(null)
    setFees(current => {
      const next = { ...current }
      for (const id of selected) next[id] = bulkFee
      return next
    })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (selected.length === 0) { setError('اختر طالبة واحدة على الأقل.'); return }
    if (invalidIds.size > 0) { setError('راجع الرسوم المظللة بالأحمر قبل الحفظ.'); return }
    const students = selected.map(studentId => ({
      studentId,
      agreedMonthlyFee: canEditFinancials ? (parseFee(feeFor(studentId)) ?? null) : null,
    }))
    setSaving(true)
    setError(null)
    try {
      const result = await request<{ added: number; skipped: number; feesApplied?: number }>('/api/circle-enrollments/bulk', {
        method: 'POST',
        body: JSON.stringify({ circleId: circle.id, startsOn, allowClosedCircle: allowClosed, students }),
      })
      const feeNote = canEditFinancials && result.feesApplied ? '، وسُجلت رسوم ' + result.feesApplied + ' طالبة' : ''
      ctx.notifySystem('success', 'تم إلحاق ' + result.added + ' طالبة' + (result.skipped ? '، وتجاهل ' + result.skipped + ' موجودات بالفعل' : '') + feeNote + '.')
      await ctx.openCircleDetails(circle)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إلحاق الطالبات.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal level={1} title={'إلحاق مجموعة بحلقة ' + circle.name} subtitle="اختاري الطالبات، وحدّدي الرسوم المتفق عليها لكل طالبة دفعة واحدة — بدون فتح نموذج الإلحاق لكل طالبة." wide close={close}>
    <form onSubmit={submit} className="be-form">
      <div className="be-layout">
        <section className="be-main" aria-label="قائمة الطالبات المتاحات">
          <div className="be-search">
            <Search size={16} aria-hidden className="be-search-icon" />
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }}
              placeholder="ابحثي بالاسم أو كود الطالبة…"
              aria-label="بحث عن طالبة بالاسم أو الكود"
            />
            {search && <button type="button" className="be-search-clear" onClick={() => setSearch('')} aria-label="مسح البحث"><X size={14}/></button>}
          </div>

          <div className="be-list-head">
            <label className="be-select-all">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={filtered.length === 0} />
              <span>تحديد الكل ({filtered.length})</span>
            </label>
            <span className={'be-selected-badge' + (selected.length ? ' is-active' : '')}><CheckCircle2 size={13}/> {selected.length} محددة</span>
          </div>

          <div className="be-list" role="group" aria-label="الطالبات المتاحات">
            {filtered.length === 0 && <div className="be-empty"><Users size={20}/><p>لا توجد طالبات متاحات لهذه الحلقة{search ? ' بهذا البحث' : ''}.</p></div>}
            {filtered.map(student => {
              const isSelected = selectedSet.has(student.id)
              const rawFee = feeFor(student.id)
              const feeInvalid = isSelected && canEditFinancials && parseFee(rawFee) === undefined
              return <label key={student.id} className={'be-row' + (isSelected ? ' is-selected' : '')}>
                <input type="checkbox" checked={isSelected} onChange={event => toggleStudent(student.id, event.target.checked)} aria-label={'تحديد ' + student.fullName} />
                <span className="be-avatar" aria-hidden>{student.fullName.trim().charAt(0) || 'ط'}</span>
                <span className="be-student"><strong>{student.fullName}</strong><small>{student.studentCode}{student.circleNames ? ' · ' + student.circleNames : ' · بدون حلقة'}</small></span>
                {canEditFinancials && isSelected && <span className="be-fee">
                  <small>الرسوم المتفق عليها</small>
                  <span className={'be-fee-box' + (feeInvalid ? ' is-invalid' : '')}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={rawFee}
                      onChange={event => setFees(current => ({ ...current, [student.id]: event.target.value }))}
                      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }}
                      aria-label={'الرسوم المتفق عليها للطالبة ' + student.fullName}
                      aria-invalid={feeInvalid}
                    />
                    <em>ج.م</em>
                  </span>
                  {feeInvalid && <small className="be-fee-error">رقم غير صالح</small>}
                </span>}
              </label>
            })}
          </div>
        </section>

        <aside className="be-side" aria-label="ملخص الإلحاق">
          <div className="be-card">
            <h4>بيانات الإلحاق</h4>
            <Field label="تاريخ بداية الالتحاق *"><input type="date" required value={startsOn} onChange={event => setStartsOn(event.target.value)} /></Field>
            {!circle.isActive && ctx.has('circles.edit') && <label className="system-toggle-field"><input type="checkbox" checked={allowClosed} onChange={event => setAllowClosed(event.target.checked)} /><span><strong>السماح بالإلحاق في حلقة متوقفة</strong><small>سيُحفظ الالتحاق دون إنشاء رسوم شهرية حتى تعود الحلقة نشطة.</small></span></label>}

            {canEditFinancials && <div className="be-bulk-fee">
              <span className="be-label">سعر موحّد للمحددات</span>
              <div className="be-bulk-row">
                <span className="be-fee-box"><input type="number" min="0" step="0.01" inputMode="decimal" value={bulkFee} onChange={event => setBulkFee(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} aria-label="سعر موحّد يُطبّق على المحددات" /><em>ج.م</em></span>
                <button type="button" className="secondary-button" onClick={applyBulkFee} disabled={selected.length === 0}>تطبيق</button>
              </div>
              <small className="be-hint">الافتراضي لكل طالبة = سعر الحلقة ({defaultFee ? defaultFee + ' ج.م' : 'غير محدد'})، ويمكن تعديله لكل طالبة على حدة.</small>
            </div>}

            <dl className="be-summary">
              <div><dt>المحددات</dt><dd>{selected.length}</dd></div>
              {canEditFinancials && <div className="be-summary-total"><dt>إجمالي الشهري</dt><dd>{money(totalSelected ?? 0)} ج.م</dd></div>}
              <div><dt>المتاحات بعد البحث</dt><dd>{filtered.length}</dd></div>
            </dl>

            {error && <p className="be-error" role="alert">{error}</p>}
          </div>

          <div className="be-actions">
            <button type="submit" className="primary-button" disabled={saving || selected.length === 0 || invalidIds.size > 0}>{saving ? 'جارٍ الإلحاق…' : 'إلحاق المحددات (' + selected.length + ')'}</button>
            <button type="button" className="secondary-button" onClick={close} disabled={saving}>إلغاء</button>
          </div>
        </aside>
      </div>
    </form>
  </Modal>
}