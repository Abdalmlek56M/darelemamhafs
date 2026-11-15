import { useState } from 'react'
import { UserRoundCheck, AlertTriangle } from 'lucide-react'
import Modal from '../common/Modal'
import type { ScheduleSlot, Teacher } from '../../domain/types'
import type { DarApplicationContext } from '../../application/useDarApplication'

type Props = { ctx: DarApplicationContext; slot: ScheduleSlot; date: string; close: () => void; onSaved: () => void }

export default function TeacherSubstitutionDialog({ ctx, slot, date, close, onSaved }: Props) {
  const [teacherId, setTeacherId] = useState('')
  const [saving, setSaving] = useState(false)
  const activeTeachers: Teacher[] = ctx.teachers.filter(teacher => teacher.status === 'active' && teacher.id !== slot.teacherId)
  const save = async () => {
    if (!teacherId) { ctx.notifySystem('error', 'اختَر المعلمة البديلة أولًا.'); return }
    setSaving(true)
    try { if (await ctx.markAttendance(slot, date, 'present', teacherId)) onSaved() }
    finally { setSaving(false) }
  }
  return <Modal level={1} title="تسجيل معلمة بديلة" subtitle={`${slot.circleName} · ${date}`} close={close}>
    <div className="teacher-substitution-dialog">
      <div className="inline-notice warning-notice"><AlertTriangle size={17}/><span>هذا التغيير لهذه الحصة فقط، ولا يغيّر المعلمة المسندة للحلقة في بقية المواعيد.</span></div>
      <label className="form-field"><span>المعلمة التي ستقدم الحصة *</span><select value={teacherId} onChange={event => setTeacherId(event.target.value)}><option value="">اختَر معلمة نشطة</option>{activeTeachers.map(teacher => <option value={teacher.id} key={teacher.id}>{teacher.fullName}{teacher.hourlyRate==null?'':' · أجر الساعة '+teacher.hourlyRate.toLocaleString('ar-EG')+' ج.م'}</option>)}</select></label>
      <p className="muted-text">سيُحسب المستحق من أجر المعلمة البديلة، ويُسجل في ملاحظة الحصة أنها بديلة عن {slot.teacherName || 'المعلمة الأساسية'}.</p>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={close} disabled={saving}>إلغاء</button><button type="button" className="primary-button" onClick={() => void save()} disabled={saving || !teacherId}><UserRoundCheck size={15}/>{saving ? 'جارٍ الحفظ…' : 'تسجيل حضور البديلة'}</button></div>
    </div>
  </Modal>
}
