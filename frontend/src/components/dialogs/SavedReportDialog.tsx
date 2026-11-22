import Modal from '../common/Modal'
import { formatDateTime, money } from '../../lib/formatters'
import Stat from '../common/Stat'
import { CheckCircle2, Download, FileImage, Wallet, CircleDollarSign } from 'lucide-react'
import { safeDownload, makeReportSvg } from '../../lib/reportExports'
import { payLabels } from '../../domain/labels'
import ResponsiveTable, { type ResponsiveColumn } from '../common/ResponsiveTable'
import type { DarApplicationContext } from '../../application/useDarApplication'


type Props = { ctx: DarApplicationContext }

export default function SavedReportDialog({ ctx }: Props) {
  const reportView = ctx.reportView
  if (!reportView) return null
  type SnapshotRow = (typeof reportView.snapshot.rows)[number]

  const columns: ResponsiveColumn<SnapshotRow>[] = [
    { key: 'student', header: 'الطالب', primary: true, render: (row) => <>{row.studentName}<small>{row.studentCode}</small></> },
    { key: 'circle', header: 'الحلقة', render: (row) => row.circleName },
    { key: 'due', header: 'المستحق', render: (row) => money(row.amountDue) },
    { key: 'paid', header: 'المدفوع', render: (row) => money(row.paidAmount) },
    { key: 'balance', header: 'المتبقي', render: (row) => money(row.balance) },
    { key: 'status', header: 'الحالة', render: (row) => payLabels[row.paymentStatus] },
  ]

  return <Modal title={reportView.title} subtitle={`لقطة محفوظة للشهر ${reportView.billingMonth} · ${formatDateTime(reportView.createdAt)}`} wide close={() => ctx.setReportView(null)}>
    <div className="report-snapshot">
      <section className="stats-grid compact-stats">
        <Stat icon={<CircleDollarSign size={18}/>} label="المستحق وقت الحفظ" value={money(reportView.snapshot.totalDue)} note={`${reportView.snapshot.rowCount} سجل`} />
        <Stat icon={<CheckCircle2 size={18}/>} label="المحصل وقت الحفظ" value={money(reportView.snapshot.totalPaid)} note="لا يتغير بعد الحفظ"/>
        <Stat icon={<Wallet size={18}/>} label="المتبقي وقت الحفظ" value={money(reportView.snapshot.totalBalance)} note="نسخة ثابتة"/>
      </section>
      <div className="toolbar-actions report-download-actions">
        <button className="secondary-button" onClick={() => ctx.downloadSavedCsv(reportView)}><Download size={15}/> تنزيل CSV</button>
        <button className="secondary-button" onClick={() => ctx.downloadSavedJson(reportView)}><Download size={15}/> تنزيل JSON</button>
        <button className="secondary-button" onClick={() => safeDownload(`تحصيل-${reportView.billingMonth}.svg`, makeReportSvg(reportView.title, reportView.billingMonth.slice(0, 7), reportView.snapshot.rows, { due: reportView.snapshot.totalDue, paid: reportView.snapshot.totalPaid, balance: reportView.snapshot.totalBalance }), 'image/svg+xml;charset=utf-8')}><FileImage size={15}/> تنزيل صورة</button>
      </div>
      <ResponsiveTable
        caption="لقطة تقرير التحصيل المحفوظ"
        rows={reportView.snapshot.rows}
        columns={columns}
        rowKey={(row) => row.enrollmentId}
        empty={<span className="muted-text">لا توجد صفوف في هذه اللقطة.</span>}
      />
    </div>
  </Modal>
}
