import Modal from '../common/Modal'
import Field from '../common/Field'
import type { DarApplicationContext } from '../../application/useDarApplication'
import { VOID_REASON_MAX_LENGTH, VOID_REASON_MIN_LENGTH } from '../../system/constants'

type Props = { ctx: DarApplicationContext }

/**
 * Void/Reverse dialog for financial records (ADR-0005).
 * The record is never deleted: it stays in the register marked as voided, with a mandatory reason
 * that is written to the audit log. This component NEVER exposes a delete action.
 */
export default function VoidDialog({ ctx }: Props) {
  const target = ctx.voidTarget
  if (!target) return null
  const reason = ctx.voidReason
  const trimmedLength = reason.trim().length
  const valid = trimmedLength >= VOID_REASON_MIN_LENGTH && trimmedLength <= VOID_REASON_MAX_LENGTH
  const isCharge = target.kind === 'charge'
  const close = () => { if (!ctx.saving) ctx.closeVoidDialog() }
  const note = isCharge
    ? 'الاستحقاق سيظل في السجل ملغيًا (Void) ولا يمكن حذفه، ولن تدخل قيمته في المستحق أو المتبقي.'
    : 'حركة التحصيل ستبقى في السجل ملغاة ولا يمكن حذفها، وسيُعاد احتساب المدفوع والمتبقي من واقع الحركات السارية فقط.'
  return <Modal title={isCharge ? 'إلغاء الاستحقاق (Void)' : 'إلغاء حركة التحصيل (Void)'} subtitle={target.label} close={close}>
    <form onSubmit={ctx.submitVoid}>
      <div className="inline-notice" role="note" style={{ marginBottom: 14, lineHeight: 1.9 }}>
        <strong>تنبيه:</strong> {note} تُسجَّل العملية بالسبب والفاعل والوقت في سجل التدقيق.
      </div>
      <div className="form-grid">
        <Field label="سبب الإلغاء *" wide>
          <textarea
            id="void-reason"
            rows={4}
            required
            autoFocus
            minLength={VOID_REASON_MIN_LENGTH}
            maxLength={VOID_REASON_MAX_LENGTH}
            value={reason}
            onChange={event => ctx.setVoidReason(event.target.value)}
            placeholder="اكتب سببًا واضحًا (مثال: استحقاق مكرر، خطأ في المبلغ، انسحاب الطالبة…) — من 3 إلى 500 حرف."
          />
          <small>{trimmedLength} / {VOID_REASON_MAX_LENGTH} حرف{trimmedLength > 0 && !valid ? ' — يجب ألا يقل السبب عن 3 أحرف.' : ''}</small>
        </Field>
      </div>
      <p className="muted-text">لا يمكن التراجع عن الإلغاء من هذه الشاشة؛ أي تصحيح لاحق يكون بإلغاء/قيد جديد مع سبب موثق.</p>
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={close} disabled={ctx.saving}>تراجع</button>
        <button type="submit" className="danger-button" disabled={!valid || ctx.saving}>{ctx.saving ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء (Void)'}</button>
      </div>
    </form>
  </Modal>
}
