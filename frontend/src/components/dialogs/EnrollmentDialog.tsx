import Modal from '../common/Modal'
import Field from '../common/Field'
import ModalActions from '../common/ModalActions'
import type { DarApplicationContext } from '../../application/useDarApplication'
import { AlertTriangle } from 'lucide-react'


type Props = { ctx: DarApplicationContext }

export default function EnrollmentDialog({ ctx }: Props) {
  const canReadFinance = ctx.has('finance.read')
  const canEditFinancials = canReadFinance && ctx.has('finance.edit')
  const selectedCircle = ctx.circles.find(circle => circle.id === ctx.enrollmentForm.circleId)
  return <Modal level={2} title="إلحاق طالب بحلقة" subtitle="كل التحاق يحتفظ بتاريخ بدايته ونهايته ورسومه الشهرية المتفق عليها." close={()=>!ctx.saving&&ctx.setEnrollmentModal(false)}>
    <form onSubmit={ctx.saveEnrollment}>
      <div className="enrollment-multi-circle-hint"><strong>الطالب ممكن يلتحق بأكثر من حلقة.</strong><span>اختَر نفس الطالب مع حلقة مختلفة لإنشاء التحاق مستقل؛ لا تنشئ ملف طالب مكررًا. لكل حلقة تاريخ بداية ورسوم وحضور منفصل.</span></div>
      <div className="form-grid">
        <Field label="الطالب *" wide><select required value={ctx.enrollmentForm.studentId} onChange={e=>ctx.setEnrollmentForm(f=>({...f,studentId:e.target.value}))}><option value="">اختَر طالبًا</option>{ctx.students.filter(s=>s.status==='active').map(s=><option key={s.id} value={s.id}>{s.fullName} — {s.studentCode}</option>)}</select></Field>
        <Field label="الحلقة *" wide><select required value={ctx.enrollmentForm.circleId} onChange={e=>{const circle=ctx.circles.find(x=>x.id===e.target.value);ctx.setEnrollmentForm(f=>({...f,circleId:e.target.value,agreedMonthlyFee:circle?.monthlyFee==null?'':String(circle.monthlyFee),allowClosedCircle:false}))}}><option value="">اختَر حلقة</option>{ctx.circles.filter(c=>c.isActive||ctx.has('circles.edit')).map(c=><option key={c.id} value={c.id}>{c.name} — {c.teacherName||'دون معلمة'}{!c.isActive?' (متوقفة)':''}</option>)}</select></Field>
        <Field label="تاريخ البداية *"><input type="date" required value={ctx.enrollmentForm.startsOn} onChange={e=>ctx.setEnrollmentForm(f=>({...f,startsOn:e.target.value}))}/></Field>
        {canEditFinancials ? <Field label="الرسوم الشهرية المتفق عليها *"><input type="number" min="0" step="0.01" required value={ctx.enrollmentForm.agreedMonthlyFee} onChange={e=>ctx.setEnrollmentForm(f=>({...f,agreedMonthlyFee:e.target.value}))}/></Field> : canReadFinance ? <div className="form-field"><span>الرسوم الافتراضية للحلقة</span><input disabled value={selectedCircle?.monthlyFee==null?'غير متاحة':selectedCircle.monthlyFee.toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2})+' ج.م'} /><small>سيستخدم النظام رسوم الحلقة الافتراضية. تخصيص رسوم مختلفة يحتاج صلاحية تعديل المالية.</small></div> : <p className="muted-text wide">لن تظهر الرسوم في هذا الحساب. سيستخدم النظام الرسوم الافتراضية المحفوظة للحلقة، دون إظهار قيمتها.</p>}
        {selectedCircle&&!selectedCircle.isActive&&ctx.has('circles.edit')&&<label className="system-toggle-field wide closed-circle-override"><input type="checkbox" checked={ctx.enrollmentForm.allowClosedCircle} onChange={e=>ctx.setEnrollmentForm(f=>({...f,allowClosedCircle:e.target.checked}))}/><span><strong><AlertTriangle size={14}/> السماح باستثناء وإلحاق طالب بحلقة متوقفة</strong><small>استخدمه فقط للحالات الاستثنائية. سيظل سجل الحلقة والتاريخ المالي محفوظين، ولن تُنشأ رسوم شهرية تلقائيًا.</small></span></label>}
      </div>
      <ModalActions saving={ctx.saving} onCancel={()=>ctx.setEnrollmentModal(false)} saveLabel="حفظ الالتحاق"/>
    </form>
  </Modal>
}
