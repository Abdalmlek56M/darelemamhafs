import type { CircleProfitSummary, TeacherPaySummary } from '../domain/types'
import { safeDownload } from '../lib/reportExports'
import { toCsvText } from '../lib/csv'

type DashboardProfit = {
  billed: number
  collected: number
  balance: number
  teacherPay: number
  advertising: number
  otherExpenses: number
  net: number
  withoutChargeCount: number
  unmarkedPastSessions: number
}

type ProfitSummaryArgs = {
  brandName: string
  currentMonthValue: string
  dashboardProfit: DashboardProfit
  teacherPaySummary: TeacherPaySummary[]
  circleProfitSummary: CircleProfitSummary[]
}

/** Builds the Arabic operations-profit CSV and triggers a local download. */
export function downloadProfitSummary({
  brandName,
  currentMonthValue,
  dashboardProfit,
  teacherPaySummary,
  circleProfitSummary,
}: ProfitSummaryArgs) {
  const rows: [string, string | number][] = [
    ['الدار', brandName], ['الشهر', currentMonthValue],
    ['الاستحقاقات المسجلة', dashboardProfit.billed], ['المحصل فعليًا', dashboardProfit.collected], ['المتبقي للتحصيل', dashboardProfit.balance],
    ['أجور الحضور المستحقة', dashboardProfit.teacherPay], ['تكلفة الإعلانات', dashboardProfit.advertising],
    ['المصروفات التشغيلية الأخرى', dashboardProfit.otherExpenses], ['صافي التشغيل التقديري', dashboardProfit.net],
    ['التحاقات بلا استحقاق مسجل', dashboardProfit.withoutChargeCount], ['حصص فات موعدها بلا تسجيل حضور', dashboardProfit.unmarkedPastSessions],
    ['ملاحظة', 'صافي تقديري من السجلات المدخلة، وليس رصيدًا نقديًا. لا يشمل التكاليف غير المسجلة.'],
    ['— تفصيل أجور المعلمات —', ''],
  ]
  for (const teacher of teacherPaySummary) {
    rows.push([`المعلمة: ${teacher.teacherName} | عدد الحصص`, teacher.sessions])
    rows.push([`المعلمة: ${teacher.teacherName} | ساعات الحضور`, Number(teacher.hours.toFixed(2))])
    rows.push([`المعلمة: ${teacher.teacherName} | مستحق الأجر`, teacher.payable])
  }
  rows.push(['— مساهمة كل حلقة —', ''])
  for (const circle of circleProfitSummary) {
    rows.push([`الحلقة: ${circle.circleName} | الاستحقاق`, circle.billed])
    rows.push([`الحلقة: ${circle.circleName} | المحصل`, circle.collected])
    rows.push([`الحلقة: ${circle.circleName} | أجور المعلمات`, circle.teacherPay])
    rows.push([`الحلقة: ${circle.circleName} | الإعلانات`, circle.advertising])
    rows.push([`الحلقة: ${circle.circleName} | المصروفات المرتبطة`, circle.linkedExpenses])
    rows.push([`الحلقة: ${circle.circleName} | الصافي التقديري`, circle.net])
  }
  safeDownload(
    `نتيجة-تشغيل-الدار-${currentMonthValue}.csv`,
    toCsvText(rows),
    'text/csv;charset=utf-8',
  )
}
