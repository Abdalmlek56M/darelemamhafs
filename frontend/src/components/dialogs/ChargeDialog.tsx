import { useEffect, useMemo, useState } from 'react'
import Modal from '../common/Modal'
import Field from '../common/Field'
import ModalActions from '../common/ModalActions'
import type { DarApplicationContext } from '../../application/useDarApplication'

function suggestedCharge(row: { agreedMonthlyFee:number; circleStartsOn:string; enrollmentStartsOn:string; enrollmentEndsOn:string|null }, monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number)
  if (!year || !month) return row.agreedMonthlyFee
  const monthStart = new Date(year, month - 1, 1, 12)
  const monthEnd = new Date(year, month, 0, 12)
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  const monthStartKey = key(monthStart), monthEndKey = key(monthEnd)
  const start = [row.circleStartsOn, row.enrollmentStartsOn, monthStartKey].sort().at(-1)!
  const end = row.enrollmentEndsOn && row.enrollmentEndsOn < monthEndKey ? row.enrollmentEndsOn : monthEndKey
  if (start > end || start > monthEndKey) return 0
  const activeDays = Number(end.slice(8,10)) - Number(start.slice(8,10)) + 1
  return Math.round(row.agreedMonthlyFee * Math.max(0,activeDays) / monthEnd.getDate() * 100) / 100
}

type Props = { ctx: DarApplicationContext }
export default function ChargeDialog({ ctx }: Props) {
  const [manualAmount, setManualAmount] = useState(false)
  const selected = useMemo(() => ctx.collections.find(row => row.enrollmentId === ctx.chargeForm.enrollmentId) ?? null, [ctx.collections, ctx.chargeForm.enrollmentId])
  const suggestion = selected ? suggestedCharge(selected, ctx.chargeForm.billingMonth) : Number(ctx.chargeForm.amountDue || 0)
  useEffect(() => { setManualAmount(Boolean(ctx.editingChargeId)) }, [ctx.chargeModal, ctx.editingChargeId, ctx.chargeForm.enrollmentId])
  useEffect(() => {
    if (!ctx.chargeModal || ctx.editingChargeId || manualAmount || !selected) return
    ctx.setChargeForm(current => ({ ...current, amountDue: suggestion.toFixed(2) }))
  }, [ctx.chargeModal, ctx.editingChargeId, manualAmount, selected?.enrollmentId, ctx.chargeForm.billingMonth, suggestion])
  return <Modal title={ctx.editingChargeId?'تعديل الاستحقاق الشهري':'تحديد استحقاق شهري'} subtitle="المبلغ هنا هو المطلوب لهذا الطالب في هذه الحلقة لهذا الشهر فقط." close={()=>!ctx.saving&&ctx.setChargeModal(false)}><form onSubmit={ctx.saveCharge}><div className="form-grid"><Field label="الشهر *"><input type="month" required value={ctx.chargeForm.billingMonth} onChange={e=>ctx.setChargeForm(f=>({...f,billingMonth:e.target.value}))}/></Field><Field label="المبلغ المستحق بالجنيه *"><input type="number" required min="0" step="0.01" value={ctx.chargeForm.amountDue} onChange={e=>{setManualAmount(true);ctx.setChargeForm(f=>({...f,amountDue:e.target.value}))}}/><small>{selected && !ctx.editingChargeId ? `اقتراح محسوب من تاريخ بدء الحلقة/التحاق الطالب: ${suggestion.toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2})} ج.م. يمكنك تعديله يدويًا.` : 'المبلغ المحفوظ لا يتغير إلا بعد حفظ التعديل.'}</small>{selected && !ctx.editingChargeId && manualAmount && <button type="button" className="text-link" onClick={()=>{setManualAmount(false);ctx.setChargeForm(f=>({...f,amountDue:suggestion.toFixed(2)}))}}>استخدام المبلغ المقترح</button>}</Field><Field label="ملاحظات الاستحقاق" wide><textarea rows={3} value={ctx.chargeForm.note} onChange={e=>ctx.setChargeForm(f=>({...f,note:e.target.value}))}/></Field></div><ModalActions saving={ctx.saving} onCancel={()=>ctx.setChargeModal(false)} saveLabel={ctx.editingChargeId?'حفظ التعديل':'حفظ الاستحقاق'}/></form></Modal>
}
