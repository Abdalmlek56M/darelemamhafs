import { useEffect, useMemo, useState } from 'react'
import Modal from '../common/Modal'
import Field from '../common/Field'
import ModalActions from '../common/ModalActions'
import MonthPicker from '../common/MonthPicker'
import type { DarApplicationContext } from '../../application/useDarApplication'
import { getSuggestedMonthlyCharge } from '../../application/selectors'

type Props = { ctx: DarApplicationContext }
export default function ChargeDialog({ ctx }: Props) {
  const [manualAmount, setManualAmount] = useState(false)
  const selected = useMemo(() => ctx.collections.find(row => row.enrollmentId === ctx.chargeForm.enrollmentId) ?? null, [ctx.collections, ctx.chargeForm.enrollmentId])
  const suggestion = selected ? getSuggestedMonthlyCharge(selected) : Number(ctx.chargeForm.amountDue || 0)
  useEffect(() => { setManualAmount(Boolean(ctx.editingChargeId)) }, [ctx.chargeModal, ctx.editingChargeId, ctx.chargeForm.enrollmentId])
  useEffect(() => {
    if (!ctx.chargeModal || ctx.editingChargeId || manualAmount || !selected) return
    ctx.setChargeForm(current => ({ ...current, amountDue: suggestion.toFixed(2) }))
  }, [ctx.chargeModal, ctx.editingChargeId, manualAmount, selected?.enrollmentId, ctx.chargeForm.billingMonth, suggestion])
  return <Modal title={ctx.editingChargeId?'تعديل الاستحقاق الشهري':'تحديد استحقاق شهري'} subtitle="المبلغ هنا هو المطلوب لهذا الطالب في هذه الحلقة لهذا الشهر فقط." close={()=>!ctx.saving&&ctx.setChargeModal(false)}><form onSubmit={ctx.saveCharge}><div className="form-grid"><Field label="الشهر *"><MonthPicker value={ctx.chargeForm.billingMonth} onChange={value => ctx.setChargeForm(form => ({ ...form, billingMonth: value }))} ariaLabel="شهر الاستحقاق"/></Field><Field label="المبلغ المستحق بالجنيه *"><input type="number" required min="0" step="0.01" value={ctx.chargeForm.amountDue} onChange={e=>{setManualAmount(true);ctx.setChargeForm(f=>({...f,amountDue:e.target.value}))}}/><small>{selected && !ctx.editingChargeId ? `الرسوم المتفق عليها لهذا الالتحاق: ${suggestion.toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2})} ج.م. يمكنك تعديل المبلغ يدويًا عند الحاجة.` : 'المبلغ المحفوظ لا يتغير إلا بعد حفظ التعديل.'}</small>{selected && !ctx.editingChargeId && manualAmount && <button type="button" className="text-link" onClick={()=>{setManualAmount(false);ctx.setChargeForm(f=>({...f,amountDue:suggestion.toFixed(2)}))}}>استخدام الرسوم المتفق عليها</button>}</Field><Field label="ملاحظات الاستحقاق" wide><textarea rows={3} value={ctx.chargeForm.note} onChange={e=>ctx.setChargeForm(f=>({...f,note:e.target.value}))}/></Field></div><ModalActions saving={ctx.saving} onCancel={()=>ctx.setChargeModal(false)} saveLabel={ctx.editingChargeId?'حفظ التعديل':'حفظ الاستحقاق'}/></form></Modal>
}
