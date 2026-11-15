import Modal from '../common/Modal'
import Field from '../common/Field'
import ModalActions from '../common/ModalActions'
import type { DarApplicationContext } from '../../application/useDarApplication'
import { localDateString } from '../../lib/dates'

type Props = { ctx: DarApplicationContext }
export default function EndEnrollmentDialog({ctx}: Props) {
  const item=ctx.endingEnrollment
  if(!item)return null
  return <Modal level={2} title="إنهاء التحاق طالب" subtitle={`${item.studentName} · ${item.circleName}`} close={()=>!ctx.saving&&ctx.setEndingEnrollment(null)}><form onSubmit={event=>{event.preventDefault();void ctx.confirmEndEnrollment()}}><div className="form-grid"><Field label="تاريخ نهاية الالتحاق *" wide><input type="date" required max={localDateString()} value={ctx.endEnrollmentDate} onChange={e=>ctx.setEndEnrollmentDate(e.target.value)}/></Field><div className="wide end-enrollment-note"><strong>السجل المالي والتاريخي سيظلان محفوظين</strong><p>إنهاء الالتحاق لا يحذف التحصيلات أو الاستحقاقات السابقة. لو محتاج تسوية رسوم الشهر الحالي بسبب الانسحاب، راجع الاستحقاق وعدّله من قسم التحصيلات؛ لا يتم تقسيم الرسوم تلقائيًا.</p></div></div><ModalActions saving={ctx.saving} onCancel={()=>ctx.setEndingEnrollment(null)} saveLabel="تأكيد نهاية الالتحاق"/></form></Modal>
}
