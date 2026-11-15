import Modal from '../common/Modal'
import Field from '../common/Field'
import type { TeacherStatus } from '../../domain/types'
import { teacherStatusLabels } from '../../domain/labels'
import ModalActions from '../common/ModalActions'
import type { DarApplicationContext } from '../../application/useDarApplication'


type Props = { ctx: DarApplicationContext }

export default function TeacherDialog({ ctx }: Props) {
  const canReadFinance = ctx.has('finance.read')
  const canEditFinancials = canReadFinance && ctx.has('finance.edit')
  return <Modal title={ctx.editingTeacher?'تعديل بيانات المعلمة':'إضافة معلمة'} subtitle="تعيين الحلقات يتم من شاشة الحلقة، وتُدار بيانات الأجر بصلاحية المالية." close={()=>!ctx.saving&&ctx.setTeacherModal(false)}>
    <form onSubmit={ctx.saveTeacher}>
      <div className="form-grid">
        <Field label="اسم المعلمة *" wide><input required maxLength={180} value={ctx.teacherForm.fullName} onChange={e=>ctx.setTeacherForm(f=>({...f,fullName:e.target.value}))}/></Field>
        <Field label="كود المعلمة"><input maxLength={40} value={ctx.teacherForm.teacherCode} onChange={e=>ctx.setTeacherForm(f=>({...f,teacherCode:e.target.value}))} placeholder="يتولد تلقائيًا"/></Field>
        <Field label="رقم الهاتف"><input value={ctx.teacherForm.phone} onChange={e=>ctx.setTeacherForm(f=>({...f,phone:e.target.value}))}/></Field>
        {canEditFinancials ? <Field label="أجر الساعة بالجنيه *"><input type="number" min="0" step="0.01" required value={ctx.teacherForm.hourlyRate} onChange={e=>ctx.setTeacherForm(f=>({...f,hourlyRate:e.target.value}))}/></Field> : canReadFinance ? <Field label="أجر الساعة بالجنيه"><input disabled value={ctx.teacherForm.hourlyRate || 'غير محدد'} /><small>التعديل يحتاج صلاحية تعديل البيانات المالية.</small></Field> : <p className="muted-text wide">بيانات أجر المعلمة محجوبة. عند إنشاء المعلمة سيظل الأجر الابتدائي صفرًا حتى يسجله حساب لديه صلاحية المالية.</p>}
        <Field label="الحالة"><select value={ctx.teacherForm.status} onChange={e=>ctx.setTeacherForm(f=>({...f,status:e.target.value as TeacherStatus}))}>{Object.entries(teacherStatusLabels).map(([k,v])=><option key={k} value={k}>{String(v)}</option>)}</select></Field>
        <Field label="ملاحظات" wide><textarea rows={3} value={ctx.teacherForm.notes} onChange={e=>ctx.setTeacherForm(f=>({...f,notes:e.target.value}))}/></Field>
      </div>
      <ModalActions saving={ctx.saving} onCancel={()=>ctx.setTeacherModal(false)} saveLabel={ctx.editingTeacher?'حفظ التعديلات':'حفظ المعلمة'}/>
    </form>
  </Modal>
}
