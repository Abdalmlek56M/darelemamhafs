import { useState, type FormEvent } from 'react'
import Modal from '../common/Modal'
import Field from '../common/Field'
import { sanitizePhoneInput } from '../../lib/phone'
import type { Gender, StudentStatus } from '../../domain/types'
import { genderLabels, statusLabels } from '../../domain/labels'
import ModalActions from '../common/ModalActions'
import { validateNewStudentStatus } from '../../lib/validation'
import type { DarApplicationContext } from '../../application/useDarApplication'

type Props = { ctx: DarApplicationContext }

export default function StudentDialog({ ctx }: Props) {
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validationError = validateNewStudentStatus(ctx.studentForm.status, Boolean(ctx.editingStudent))
    if (validationError) {
      setError(validationError)
      ctx.setToast({ tone: 'error', text: validationError })
      return
    }
    setError(null)
    void ctx.saveStudent(event)
  }

  return <Modal title={ctx.editingStudent?'تعديل بيانات الطالب':'إضافة طالب جديد'} subtitle="العمر اختياري، وتاريخ الالتحاق يحفظ ضمن السجل." close={()=>!ctx.saving&&ctx.setStudentModal(false)}><form onSubmit={submit} noValidate><div className="form-grid">
        <Field label="اسم الطالب *" wide><input required autoFocus maxLength={180} value={ctx.studentForm.fullName} onChange={e=>ctx.setStudentForm(f=>({...f,fullName:e.target.value}))}/></Field><Field label="كود الطالب (اختياري)"><input maxLength={40} value={ctx.studentForm.studentCode} onChange={e=>ctx.setStudentForm(f=>({...f,studentCode:e.target.value}))} placeholder="يتولد تلقائيًا"/></Field><Field label="جنس الطالب"><select value={ctx.studentForm.gender} onChange={e=>ctx.setStudentForm(f=>({...f,gender:e.target.value as '' | Gender}))}><option value="">غير محدد</option>{Object.entries(genderLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field><Field label="العمر بالسنوات"><input type="number" min="0" max="120" value={ctx.studentForm.ageYears} onChange={e=>ctx.setStudentForm(f=>({...f,ageYears:e.target.value}))} placeholder="مثال: 12"/></Field><Field label="تاريخ الالتحاق"><input type="date" required value={ctx.studentForm.joinedOn} onChange={e=>ctx.setStudentForm(f=>({...f,joinedOn:e.target.value}))}/></Field><Field label="رقم هاتف الطالب"><input type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={40} value={ctx.studentForm.phone} onChange={e=>ctx.setStudentForm(f=>({...f,phone:sanitizePhoneInput(e.target.value)}))}/></Field><Field label="اسم ولي الأمر"><input maxLength={180} value={ctx.studentForm.guardianName} onChange={e=>ctx.setStudentForm(f=>({...f,guardianName:e.target.value}))}/></Field><Field label="جنس ولي الأمر"><select value={ctx.studentForm.guardianGender} onChange={e=>ctx.setStudentForm(f=>({...f,guardianGender:e.target.value as '' | Gender}))}><option value="">غير محدد</option>{Object.entries(genderLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field><Field label="هاتف ولي الأمر"><input type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={40} value={ctx.studentForm.guardianPhone} onChange={e=>ctx.setStudentForm(f=>({...f,guardianPhone:sanitizePhoneInput(e.target.value)}))}/></Field>{!ctx.editingStudent && ctx.has?.('users.manage') && <><Field label="اسم المستخدم لحساب ولي الأمر (اختياري)"><input minLength={3} maxLength={100} autoComplete="off" value={ctx.studentForm.accountUsername ?? ''} onChange={e=>ctx.setStudentForm(f=>({...f,accountUsername:e.target.value}))} placeholder="اختياري — يُنشئ حسابًا مربوطًا بولي الأمر"/></Field><Field label="كلمة المرور للحساب"><input type="password" minLength={6} maxLength={200} autoComplete="new-password" value={ctx.studentForm.accountPassword ?? ''} onChange={e=>ctx.setStudentForm(f=>({...f,accountPassword:e.target.value}))}/></Field></>}{ctx.editingStudent ? <Field label="الحالة الحالية"><input value={statusLabels[ctx.studentForm.status]} readOnly disabled/><small>تُغيّر الحالة من قائمة الحالة في سجل الطلاب حتى تُنفّذ إجراءات الالتحاقات المرتبطة. «موقوف إداريًا» لا يوقف التحاقًا بعينه.</small></Field> : <Field label="الحالة"><select value={ctx.studentForm.status} onChange={e=>{setError(null);ctx.setStudentForm(f=>({...f,status:e.target.value as StudentStatus}))}}>{Object.entries(statusLabels).map(([k,v])=><option key={k} value={k}>{String(v)}</option>)}</select></Field>}<Field label="ملاحظات مبدئية" wide><textarea rows={3} maxLength={10000} value={ctx.studentForm.notes} onChange={e=>ctx.setStudentForm(f=>({...f,notes:e.target.value}))}/></Field>
        {error && <p className="error-inline wide" role="alert">{error}</p>}
      </div><ModalActions saving={ctx.saving} onCancel={()=>ctx.setStudentModal(false)} saveLabel={ctx.editingStudent?'حفظ التعديلات':'حفظ الطالب'}/></form></Modal>
}
