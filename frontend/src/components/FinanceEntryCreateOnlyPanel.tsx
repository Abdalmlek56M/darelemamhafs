import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, LoaderCircle, Plus, Wallet } from 'lucide-react'
import Field from './common/Field'
import { request, requestForm } from '../services/apiClient'
import type { DarApplicationContext } from '../application/useDarApplication'

type EnrollmentOption = { enrollmentId: string; studentCode: string; studentName: string; circleName: string; teacherName: string }
type ChargeOption = { monthlyChargeId: string; studentCode: string; studentName: string; circleName: string; billingMonth: string }
type EntryOptions = { billingMonth: string; enrollments: EnrollmentOption[]; charges: ChargeOption[] }
type Props = { ctx: DarApplicationContext }

export default function FinanceEntryCreateOnlyPanel({ ctx }: Props) {
  const [options, setOptions] = useState<EntryOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'charge' | 'payment'>('charge')
  const [enrollmentId, setEnrollmentId] = useState('')
  const [chargeId, setChargeId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [receipt, setReceipt] = useState<File | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    request<EntryOptions>(`/api/finance-entry-options?month=${encodeURIComponent(ctx.currentMonthValue)}`)
      .then(data => { if (live) { setOptions(data); setEnrollmentId(current => data.enrollments.some(row => row.enrollmentId === current) ? current : data.enrollments[0]?.enrollmentId ?? ''); setChargeId(current => data.charges.some(row => row.monthlyChargeId === current) ? current : data.charges[0]?.monthlyChargeId ?? '') } })
      .catch(error => { if (live) ctx.setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل خيارات تسجيل الحركة.' }) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [ctx.currentMonthValue, refreshKey])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) { ctx.setToast({ tone: 'error', text: 'اكتب مبلغًا أكبر من صفر.' }); return }
    setSaving(true)
    try {
      if (mode === 'charge') {
        if (!enrollmentId) throw new Error('اختَر الطالب والحلقة أولًا.')
        await request('/api/charges', { method: 'POST', body: JSON.stringify({ enrollmentId, billingMonth: ctx.currentMonthValue, amountDue: parsedAmount, note: note.trim() || null }) })
        setAmount(''); setNote(''); setMode('payment')
        ctx.setToast({ tone: 'success', text: 'تم تسجيل الاستحقاق. يمكنك الآن تسجيل التحصيل دون عرض الرصيد أو الدفتر المالي.' })
      } else {
        if (!chargeId) throw new Error('اختَر الاستحقاق المراد تسجيل التحصيل عليه.')
        const data = { monthlyChargeId: chargeId, amount: parsedAmount, paidAt: new Date().toISOString(), method: method || null, reference: reference.trim() || null, note: note.trim() || null }
        if (receipt) {
          const form = new FormData()
          Object.entries(data).forEach(([key, value]) => form.append(key, value == null ? '' : String(value)))
          form.append('receipt', receipt)
          await requestForm('/api/payments/with-receipt', form)
        } else {
          await request('/api/payments', { method: 'POST', body: JSON.stringify(data) })
        }
        setAmount(''); setNote(''); setReference(''); setReceipt(null)
        ctx.setToast({ tone: 'success', text: receipt ? 'تم تسجيل التحصيل وحفظ صورة الإيصال.' : 'تم تسجيل التحصيل.' })
      }
      setRefreshKey(value => value + 1)
    } catch (error) {
      ctx.setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل الحركة.' })
    } finally { setSaving(false) }
  }

  return <section className="panel glass finance-create-only-panel">
    <div className="panel-heading"><div><span className="eyebrow">تسجيل حركة دون كشف الدفاتر</span><h3>إدخال الاستحقاقات والتحصيلات</h3><p className="muted-text">يمكنك تسجيل حركة مالية. لا يعرض هذا النموذج قيمة الاستحقاق أو المدفوعات أو الرصيد أو حالة السداد. يتحقق الخادم من صحة المبلغ ويمنع التحصيل الزائد.</p></div><span className="step-number"><Wallet size={17}/></span></div>
    <form id="finance-create-only-form" onSubmit={save} className="form-grid">
      <Field label="نوع الحركة"><select value={mode} onChange={event => { setMode(event.target.value as 'charge' | 'payment'); setAmount(''); setNote(''); setReference(''); setReceipt(null) }}><option value="charge">تسجيل استحقاق</option><option value="payment">تسجيل تحصيل</option></select></Field>
      <Field label="الشهر"><input type="month" value={ctx.currentMonthValue} readOnly/></Field>
      {mode === 'charge' ? <Field label="الطالب والحلقة *" wide><select required value={enrollmentId} onChange={event => setEnrollmentId(event.target.value)} disabled={loading || !options?.enrollments.length}><option value="">{loading ? 'جارٍ تحميل الخيارات…' : 'اختَر الطالب والحلقة'}</option>{options?.enrollments.map(row => <option key={row.enrollmentId} value={row.enrollmentId}>{row.studentName} ({row.studentCode}) · {row.circleName}</option>)}</select><small>لا تظهر أي رسوم أو أرصدة أو حالة تحصيل.</small></Field> : <Field label="الاستحقاق *" wide><select required value={chargeId} onChange={event => setChargeId(event.target.value)} disabled={loading || !options?.charges.length}><option value="">{loading ? 'جارٍ تحميل الخيارات…' : 'اختَر الطالب والحلقة'}</option>{options?.charges.map(row => <option key={row.monthlyChargeId} value={row.monthlyChargeId}>{row.studentName} ({row.studentCode}) · {row.circleName}</option>)}</select><small>الخيارات تعرض هوية السجل فقط. لا يتم عرض المبلغ أو الرصيد.</small></Field>}
      <Field label={mode === 'charge' ? 'قيمة الاستحقاق *' : 'المبلغ المستلم *'}><input type="number" min="0.01" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00"/></Field>
      {mode === 'payment' && <Field label="طريقة الدفع"><select value={method} onChange={event => setMethod(event.target.value)}><option value="cash">نقدي</option><option value="transfer">تحويل</option><option value="instapay">إنستاباي</option><option value="wallet">محفظة إلكترونية</option><option value="other">أخرى</option></select></Field>}
      {mode === 'payment' && <Field label="مرجع / رقم إيصال"><input maxLength={120} value={reference} onChange={event => setReference(event.target.value)}/></Field>}
      {mode === 'payment' && <Field label="صورة الإيصال (اختياري)" wide><input key={mode} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0] ?? null; if (file && file.size > 8 * 1024 * 1024) { ctx.setToast({ tone: 'error', text: 'حجم صورة الإيصال يجب ألا يتجاوز 8 ميجابايت.' }); event.target.value = ''; return } setReceipt(file) }}/></Field>}
      <Field label="ملاحظات" wide><textarea rows={2} maxLength={5000} value={note} onChange={event => setNote(event.target.value)}/></Field>
      <div className="schedule-save-row"><button className="primary-button" type="submit" disabled={saving || loading || (mode === 'charge' ? !enrollmentId : !chargeId)}><Plus size={15}/>{saving ? 'جارٍ الحفظ…' : mode === 'charge' ? 'حفظ الاستحقاق' : 'حفظ التحصيل'}</button></div>
    </form>
    {loading && <div className="muted-text"><LoaderCircle className="spin" size={14}/> جارٍ تحميل بيانات الاختيار…</div>}
    {!loading && mode === 'charge' && !options?.enrollments.length && <div className="empty-inline">لا توجد التحاقات لها أيام نشاط مؤهلة في الشهر المحدد لتسجيل استحقاق جديد.</div>}
    {!loading && mode === 'payment' && !options?.charges.length && <div className="empty-inline">لا توجد استحقاقات متاحة للتحصيل في هذا الشهر.</div>}
    <small className="sub-cell"><CheckCircle2 size={13}/> لن يعرض هذا الحساب كشف التحصيل أو المتبقي أو إجماليات المالية. النتائج التفصيلية تتطلب finance.read.</small>
  </section>
}
