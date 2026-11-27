import { useState, type FormEvent } from 'react'
import Modal from '../common/Modal'
import Field from '../common/Field'
import ModalActions from '../common/ModalActions'
import { money } from '../../lib/formatters'
import { remainingAmountForCharge, validatePaymentAmount } from '../../lib/validation'
import type { DarApplicationContext } from '../../application/useDarApplication'

type Props = { ctx: DarApplicationContext }

export default function PaymentDialog({ ctx }: Props) {
  const [error, setError] = useState<string | null>(null)
  const remaining = remainingAmountForCharge(ctx.collections, ctx.paymentForm.monthlyChargeId)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validation = validatePaymentAmount(ctx.paymentForm.amount, remaining)
    if (!validation.ok) {
      // Same message the API returns for an overpayment; the request is never sent.
      setError(validation.error)
      ctx.setToast({ tone: 'error', text: validation.error })
      return
    }
    setError(null)
    void ctx.savePayment(event)
  }

  return <Modal title="تسجيل تحصيل" subtitle="يمكن تسجيل دفعة جزئية؛ يمنع النظام تحصيل مبلغ أكبر من المتبقي." close={()=>{if(!ctx.saving){ctx.setPaymentModal(false);ctx.setPaymentReceipt(null);ctx.setPaymentReceiptPreview(null)}}}><form onSubmit={submit} noValidate><div className="form-grid">
    <Field label="المبلغ المدفوع *">
      <input
        type="number"
        min="0.01"
        step="0.01"
        required
        max={remaining == null ? undefined : remaining.toFixed(2)}
        aria-label="المبلغ المدفوع"
        aria-invalid={error ? true : undefined}
        value={ctx.paymentForm.amount}
        onChange={e=>{setError(null);ctx.setPaymentForm(f=>({...f,amount:e.target.value}))}}
      />
      {remaining != null && <small className="sub-cell">المتبقي على هذا الاستحقاق: {money(remaining)}</small>}
    </Field>
    <Field label="طريقة الدفع"><select value={ctx.paymentForm.method} onChange={e=>ctx.setPaymentForm(f=>({...f,method:e.target.value}))}><option value="cash">نقدي</option><option value="transfer">تحويل</option><option value="instapay">إنستاباي</option><option value="wallet">محفظة إلكترونية</option><option value="other">أخرى</option></select></Field>
    <Field label="مرجع / رقم إيصال"><input maxLength={120} value={ctx.paymentForm.reference} onChange={e=>ctx.setPaymentForm(f=>({...f,reference:e.target.value}))}/></Field>
    <Field label="ملاحظات"><input value={ctx.paymentForm.note} onChange={e=>ctx.setPaymentForm(f=>({...f,note:e.target.value}))}/></Field>
    <Field label="صورة إيصال التحصيل (اختياري)" wide><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0]??null;if(file&&file.size>8*1024*1024){ctx.setToast({tone:'error',text:'حجم صورة الإيصال يجب ألا يتجاوز 8 ميجابايت.'});e.target.value='';return}ctx.setPaymentReceipt(file);ctx.setPaymentReceiptPreview(file?URL.createObjectURL(file):null)}}/><small className="sub-cell">JPG أو PNG أو WebP، بحد أقصى 8 ميجابايت. تُحفظ الصورة داخل قاعدة البيانات، وتظهر في التفاصيل المالية فقط.</small>{ctx.paymentReceiptPreview&&<img className="payment-receipt-preview" src={ctx.paymentReceiptPreview} alt="معاينة إيصال التحصيل"/>}</Field>
    {error && <p className="error-inline wide" role="alert">{error}</p>}
  </div><ModalActions saving={ctx.saving} onCancel={()=>{ctx.setPaymentModal(false);ctx.setPaymentReceipt(null);ctx.setPaymentReceiptPreview(null)}} saveLabel="حفظ التحصيل"/></form></Modal>
}
