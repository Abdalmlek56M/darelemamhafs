import { AnimatePresence } from 'framer-motion'
import ToastView from '../common/ToastView'
import type { DarApplicationContext } from '../../application/useDarApplication'
import StudentDialog from './StudentDialog'
import TeacherDialog from './TeacherDialog'
import TeacherHistoryDialog from './TeacherHistoryDialog'
import CircleDialog from './CircleDialog'
import EnrollmentDialog from './EnrollmentDialog'
import ChargeDialog from './ChargeDialog'
import PaymentDialog from './PaymentDialog'
import UserDialog from './UserDialog'
import StudentHistoryDialog from './StudentHistoryDialog'
import CircleDetailsDialog from './CircleDetailsDialog'
import SavedReportDialog from './SavedReportDialog'
import EndEnrollmentDialog from './EndEnrollmentDialog'

type Props = { ctx: DarApplicationContext }

export default function ApplicationDialogs({ ctx }: Props) {
  return <>
    <AnimatePresence>
      {ctx.studentModal && <StudentDialog ctx={ctx} />}
      {ctx.teacherModal && <TeacherDialog ctx={ctx} />}
      {ctx.circleModal && <CircleDialog ctx={ctx} />}
      {ctx.enrollmentModal && <EnrollmentDialog ctx={ctx} />}
      {ctx.endingEnrollment && <EndEnrollmentDialog ctx={ctx} />}
      {ctx.chargeModal && <ChargeDialog ctx={ctx} />}
      {ctx.paymentModal && <PaymentDialog ctx={ctx} />}
      {ctx.userModal && <UserDialog ctx={ctx} />}
      {(ctx.history !== null || (ctx.historyLoading && ctx.selectedStudentPreview !== null)) && <StudentHistoryDialog ctx={ctx} />}
      {ctx.selectedTeacherDetails !== null && <TeacherHistoryDialog ctx={ctx} />}
      {ctx.selectedCircle && <CircleDetailsDialog ctx={ctx} />}
      {ctx.reportView && <SavedReportDialog ctx={ctx} />}
    </AnimatePresence>
    <ToastView toast={ctx.toast} clear={() => ctx.setToast(null)} />
  </>
}
