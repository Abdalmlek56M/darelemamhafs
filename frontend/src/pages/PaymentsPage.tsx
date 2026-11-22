import { motion } from 'framer-motion'
import { Ban, CalendarDays, CheckCircle2, Download, Eye, FileImage, FileText, Pencil, Plus, Trash2, Wallet, CircleDollarSign, Megaphone } from 'lucide-react'
import Stat from '../components/common/Stat'
import { formatDate, formatDateTime, money } from '../lib/formatters'
import { safeDownload, toCsv } from '../lib/reportExports'
import { payLabels } from '../domain/labels'
import Empty from '../components/common/EmptyState'
import Field from '../components/common/Field'
import MonthPicker from '../components/common/MonthPicker'
import ResponsiveTable, { type ResponsiveColumn } from '../components/common/ResponsiveTable'
import type { DarApplicationContext } from '../application/useDarApplication'
import type { AdExpense, CollectionRow, OperatingExpense } from '../domain/types'
import FinanceEntryCreateOnlyPanel from '../components/FinanceEntryCreateOnlyPanel'
import ChargeAuditPanel from '../components/ChargeAuditPanel'


type Props = { ctx: DarApplicationContext }

export default function PaymentsPage({ ctx }: Props) {
  const canReadFinance = ctx.has('finance.read')

  const collectionColumns: ResponsiveColumn<CollectionRow>[] = [
    {
      key: 'student', header: 'الطالب', primary: true,
      render: (row) => ctx.has('students.read')
        ? <button className="text-link" onClick={() => void ctx.openHistory(row.studentId)}><strong>{row.studentName}</strong><small>{row.studentCode}</small></button>
        : <><strong>{row.studentName}</strong><small className="sub-cell">{row.studentCode}</small></>,
    },
    {
      key: 'circle', header: 'الحلقة / المعلمة',
      render: (row) => <>{ctx.has('circles.read')
        ? <button className="text-link" onClick={() => { const circle = ctx.circles.find((item) => item.id === row.circleId); if (circle) void ctx.openCircleDetails(circle) }}>{row.circleName}</button>
        : <span>{row.circleName}</span>}
        <small className="sub-cell">{row.teacherName || 'لم تُحدد معلمة'}</small></>,
    },
    {
      key: 'due', header: 'الاستحقاق',
      render: (row) => <>{row.chargeId && ctx.has('finance.edit')
        ? <button className="text-link amount-button" onClick={() => {
          ctx.setEditingChargeId(row.chargeId)
          ctx.setChargeForm({ enrollmentId: row.enrollmentId, billingMonth: ctx.currentMonthValue, amountDue: String(row.amountDue), note: row.note ?? '' })
          ctx.setChargeModal(true)
        }}>{money(row.amountDue)} <Pencil size={12}/></button>
        : money(row.amountDue)}
        {!row.chargeId && <small className="sub-cell">رسوم الاتفاق: {money(row.agreedMonthlyFee)}</small>}</>,
    },
    { key: 'paid', header: 'المدفوع', render: (row) => money(row.paidAmount) },
    { key: 'balance', header: 'المتبقي', render: (row) => <strong className={row.balance > 0 ? 'warn-text' : 'good-text'}>{money(row.balance)}</strong> },
    { key: 'status', header: 'الحالة', render: (row) => <span className={`status-pill pay-${row.paymentStatus}`}>{payLabels[row.paymentStatus]}</span> },
  ]

  const adColumns: ResponsiveColumn<AdExpense>[] = [
    { key: 'circle', header: 'الحلقة', primary: true, render: (ad) => <><strong>{ad.circleName}</strong>{ad.note && <small className="sub-cell">{ad.note}</small>}</> },
    { key: 'platform', header: 'المنصة', render: (ad) => ad.platform || '—' },
    { key: 'start', header: 'بداية الإعلان', render: (ad) => formatDate(ad.startDate) },
    { key: 'days', header: 'المدة الكلية', render: (ad) => ad.daysCount + ' يوم' },
    { key: 'overlap', header: 'الأيام داخل الشهر', render: (ad) => ad.overlapDays + ' يوم' },
    { key: 'daily', header: 'سعر اليوم', render: (ad) => money(ad.dailyCost) },
    { key: 'month', header: 'تكلفة الشهر', render: (ad) => <strong>{money(ad.monthAmount)}</strong> },
    { key: 'total', header: 'إجمالي الحملة', render: (ad) => money(ad.totalAmount) },
  ]

  const expenseColumns: ResponsiveColumn<OperatingExpense>[] = [
    { key: 'date', header: 'التاريخ', render: (expense) => formatDate(expense.expenseDate) },
    { key: 'category', header: 'التصنيف', render: (expense) => expense.category },
    { key: 'description', header: 'الوصف', primary: true, render: (expense) => <strong>{expense.description}</strong> },
    { key: 'circle', header: 'الحلقة', render: (expense) => expense.circleName || 'مصروف عام' },
    { key: 'amount', header: 'المبلغ', render: (expense) => <strong>{money(expense.amount)}</strong> },
    { key: 'note', header: 'ملاحظات', render: (expense) => expense.note || '—' },
  ]

  return <motion.section key="payments" className="students-page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
    <div className="page-toolbar">
      <div className="toolbar-copy">
        <h2>الاشتراكات والتحصيل</h2>
        <p>{canReadFinance ? 'حدد استحقاق كل طالب في كل حلقة، سجّل الدفعات الجزئية، واحفظ لقطة ثابتة للتقرير.' : 'يمكنك تسجيل الحركات المالية المصرح بها دون كشف الدفاتر. عرض الأرصدة والتفاصيل التاريخية يتطلب صلاحية قراءة المالية.'}</p>
      </div>
      <div className="toolbar-actions">
        <label className="month-picker"><CalendarDays size={16}/><MonthPicker value={ctx.currentMonthValue} onChange={ctx.setCurrentMonthValue} ariaLabel="شهر التحصيل"/></label>
      </div>
    </div>

    {canReadFinance && <section className="stats-grid compact-stats finance-stats">
      <Stat icon={<CircleDollarSign size={19}/>} label="إجمالي الاستحقاق" value={money(ctx.currentMonthTotals.due)} note="حسب الاستحقاقات المحددة"/>
      <Stat icon={<CheckCircle2 size={19}/>} label="إجمالي المحصل" value={money(ctx.currentMonthTotals.paid)} note="كل الدفعات المسجلة"/>
      <Stat icon={<Wallet size={19}/>} label="المتبقي" value={money(ctx.currentMonthTotals.balance)} note="المستحق ناقص المدفوع"/>
      <Stat icon={<Megaphone size={19}/>} label="تكلفة إعلانات الشهر" value={money(ctx.advertisingExpenses.reduce((sum, ad) => sum + ad.monthAmount, 0))} note="إجمالي الحملات المرتبطة بالحلقات"/>
    </section>}

    {canReadFinance && <ChargeAuditPanel ctx={ctx} />}

    {canReadFinance && <div className="report-toolbar">
      <div><strong>كشف التحصيل الشهري</strong><small>تقدر تحفظ نسخة من البيانات الحالية وتفتحها لاحقًا دون أن تتغير بتغير السجلات الجديدة.</small></div>
      <div className="toolbar-actions">
        {ctx.has('finance.create') && <button className="primary-button" onClick={() => void ctx.createReport()} disabled={ctx.saving}><FileText size={16}/>{ctx.saving ? 'جارٍ الحفظ…' : 'حفظ تقرير التحصيل'}</button>}
        <button className="secondary-button" onClick={() => safeDownload(`تحصيل-${ctx.currentMonthValue}.csv`, toCsv(ctx.collections), 'text/csv;charset=utf-8')}><Download size={16}/> تنزيل CSV</button>
        <button className="secondary-button" onClick={ctx.downloadCollectionSvg}><FileImage size={16}/> تنزيل صورة التقرير</button>
      </div>
    </div>}

    {canReadFinance
      ? <div className="table-card glass">
        <div className="table-heading">
          <div>
            <h3>الاستحقاقات والدفعات</h3>
            <span>{ctx.collections.length} التحاق ظاهر في شهر {ctx.currentMonthValue} · الإلغاء (Void) يحفظ السجل ولا يحذفه</span>
          </div>
        </div>
        <ResponsiveTable
          caption="الاستحقاقات والدفعات"
          rows={ctx.collections}
          columns={collectionColumns}
          rowKey={(row) => row.enrollmentId}
          empty={<Empty icon={<Wallet size={25}/>} title="لا توجد التحاقات نشطة لهذا الشهر" text="أنشئ حلقات وألحق الطلاب بها أولًا. وبعدها حدّد الاستحقاقات للشهر الذي تختاره."/>}
          actions={(row) => <>
            {!row.chargeId && ctx.has('finance.create') && <button className="secondary-button compact-button" onClick={() => ctx.openChargeCreate(row)}><Plus size={13}/> تحديد الاستحقاق</button>}
            {row.chargeId && row.balance > 0 && ctx.has('finance.create') && <button className="primary-button compact-button" onClick={() => ctx.openPaymentCreate(row)}><Wallet size={13}/> تسجيل تحصيل</button>}
            {row.chargeId && ctx.has('students.read') && <button className="small-icon-button" title="تفاصيل الطالب والمدفوعات" onClick={() => void ctx.openHistory(row.studentId)}><Eye size={14}/></button>}
            {row.chargeId && ctx.has('finance.void') && <button className="small-icon-button" title="إلغاء الاستحقاق (Void) مع الاحتفاظ بالسجل" aria-label="إلغاء الاستحقاق (Void)" onClick={() => ctx.openVoidCharge(row.chargeId!, 'استحقاق ' + row.studentName + ' · ' + row.circleName + ' · ' + ctx.currentMonthValue, row.studentId)}><Ban size={14}/></button>}
          </>}
        />
      </div>
      : !ctx.has('finance.create') ? <div className="panel glass permission-note"><p>عرض الاستحقاقات والدفعات والتقارير المحفوظة يتطلب صلاحية <strong>finance.read</strong>.</p></div>
        : null}

    {!canReadFinance && ctx.has('finance.create') && <FinanceEntryCreateOnlyPanel ctx={ctx}/>}

    <div className="panel glass ad-expense-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">مصروفات تسويقية</span>
          <h3>إعلانات كل حلقة</h3>
          <p className="muted-text">سجّل المنصة وعدد الأيام والتكلفة اليومية؛ يحسب النظام الإجمالي تلقائيًا ويربط الحملة بالحلقة.</p>
        </div>
        <span className="step-number"><Megaphone size={17}/></span>
      </div>
      {ctx.has('finance.create') && <form onSubmit={ctx.saveAdExpense} className="form-grid ad-expense-form">
        <Field label="الحلقة *" wide><select required value={ctx.adExpenseForm.circleId} onChange={(event) => ctx.setAdExpenseForm((form) => ({ ...form, circleId: event.target.value }))}><option value="">اختَر الحلقة المستهدفة</option>{ctx.circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}</select></Field>
        <Field label="المنصة الإعلانية"><input maxLength={120} placeholder="Facebook / Instagram…" value={ctx.adExpenseForm.platform} onChange={(event) => ctx.setAdExpenseForm((form) => ({ ...form, platform: event.target.value }))}/></Field>
        <Field label="تاريخ بداية الإعلان *"><input type="date" required value={ctx.adExpenseForm.startDate} onChange={(event) => ctx.setAdExpenseForm((form) => ({ ...form, startDate: event.target.value }))}/></Field>
        <Field label="عدد الأيام *"><input type="number" min="1" max="3650" required value={ctx.adExpenseForm.daysCount} onChange={(event) => ctx.setAdExpenseForm((form) => ({ ...form, daysCount: event.target.value }))}/></Field>
        <Field label="التكلفة في اليوم (ج.م) *"><input type="number" min="0" step="0.01" required value={ctx.adExpenseForm.dailyCost} onChange={(event) => ctx.setAdExpenseForm((form) => ({ ...form, dailyCost: event.target.value }))}/></Field>
        <Field label="الإجمالي التلقائي"><output className="calculated-amount">{money((Number(ctx.adExpenseForm.daysCount) || 0) * (Number(ctx.adExpenseForm.dailyCost) || 0))}</output></Field>
        <Field label="ملاحظات" wide><textarea rows={2} maxLength={5000} value={ctx.adExpenseForm.note} onChange={(event) => ctx.setAdExpenseForm((form) => ({ ...form, note: event.target.value }))}/></Field>
        <div className="schedule-save-row"><button className="primary-button" type="submit" disabled={ctx.saving || !ctx.adExpenseForm.circleId}><Plus size={15}/> حفظ مصروف الإعلان</button></div>
      </form>}
      {canReadFinance && <ResponsiveTable
        caption="إعلانات كل حلقة"
        className="ad-expenses-list"
        rows={ctx.advertisingExpenses}
        columns={adColumns}
        rowKey={(ad) => ad.id}
        empty={<Empty icon={<Megaphone size={20}/>} title="لا توجد حملات إعلانية مسجلة" text="سجّل إعلانًا واربطه بالحلقة لمعرفة تكلفة التسويق لكل حلقة."/>}
        actions={(ad) => ctx.has('finance.delete') && ctx.has('trash.manage')
          ? <button className="small-icon-button danger-action" title="نقل إعلان إلى سلة المهملات" onClick={() => void ctx.deleteAdExpense(ad)}><Trash2 size={14}/></button>
          : null}
      />}
    </div>

    <div className="panel glass operating-expenses-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">مصاريف الدار</span>
          <h3>المصروفات التشغيلية الأخرى</h3>
          <p className="muted-text">سجّل أي تكلفة غير الإعلانات، مثل الإنترنت أو الأدوات أو الطباعة. لا تسجل الحملة الإعلانية نفسها هنا مرة ثانية. هذه السجلات تخص نتيجة الشهر ولا تنشئ حركة نقدية تلقائيًا.</p>
        </div>
        <span className="step-number"><Wallet size={17}/></span>
      </div>
      {ctx.has('finance.create') && <form onSubmit={ctx.saveOperatingExpense} className="form-grid ad-expense-form">
        <Field label="تاريخ المصروف *"><input type="date" required value={ctx.operatingExpenseForm.expenseDate} onChange={(event) => ctx.setOperatingExpenseForm((form) => ({ ...form, expenseDate: event.target.value }))}/></Field>
        <Field label="التصنيف *"><input required maxLength={100} value={ctx.operatingExpenseForm.category} onChange={(event) => ctx.setOperatingExpenseForm((form) => ({ ...form, category: event.target.value }))} placeholder="مثال: إنترنت، أدوات، طباعة"/></Field>
        <Field label="وصف المصروف *" wide><input required maxLength={240} value={ctx.operatingExpenseForm.description} onChange={(event) => ctx.setOperatingExpenseForm((form) => ({ ...form, description: event.target.value }))} placeholder="اكتب ما تم دفعه أو تسجيله"/></Field>
        <Field label="المبلغ بالجنيه *"><input type="number" min="0.01" step="0.01" required value={ctx.operatingExpenseForm.amount} onChange={(event) => ctx.setOperatingExpenseForm((form) => ({ ...form, amount: event.target.value }))}/></Field>
        <Field label="الحلقة المرتبطة (اختياري)"><select value={ctx.operatingExpenseForm.circleId} onChange={(event) => ctx.setOperatingExpenseForm((form) => ({ ...form, circleId: event.target.value }))}><option value="">مصروف عام للدار</option>{ctx.circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}</select></Field>
        <Field label="ملاحظات" wide><textarea rows={2} maxLength={5000} value={ctx.operatingExpenseForm.note} onChange={(event) => ctx.setOperatingExpenseForm((form) => ({ ...form, note: event.target.value }))}/></Field>
        <div className="schedule-save-row">
          <button className="primary-button" type="submit" disabled={ctx.saving}><Plus size={15}/>{ctx.saving ? 'جارٍ الحفظ…' : ctx.editingOperatingExpenseId ? 'حفظ تعديل المصروف' : 'تسجيل المصروف'}</button>
          {ctx.editingOperatingExpenseId && <button className="secondary-button" type="button" onClick={ctx.resetOperatingExpenseForm}>إلغاء التعديل</button>}
        </div>
      </form>}
      {canReadFinance && <ResponsiveTable
        caption="المصروفات التشغيلية"
        className="ad-expenses-list"
        rows={ctx.operatingExpenses}
        columns={expenseColumns}
        rowKey={(expense) => expense.id}
        empty={<Empty icon={<Wallet size={20}/>} title="لا توجد مصروفات تشغيلية أخرى" text="أضف المصروفات العامة لتظهر في صافي نتيجة الشهر."/>}
        actions={(expense) => <>
          {ctx.has('finance.edit') && <button className="small-icon-button" title="تعديل المصروف" onClick={() => ctx.editOperatingExpense(expense)}><Pencil size={14}/></button>}
          {ctx.has('finance.delete') && ctx.has('trash.manage') && <button className="small-icon-button danger-action" title="نقل المصروف إلى سلة المهملات" onClick={() => void ctx.deleteOperatingExpense(expense)}><Trash2 size={14}/></button>}
        </>}
      />}
    </div>

    {canReadFinance && <div className="table-card glass saved-reports">
      <div className="table-heading"><div><h3>التقارير المحفوظة</h3><span>لقطات ثابتة قابلة للعرض والتنزيل</span></div></div>
      <div className="saved-report-list">
        {ctx.reports.map((report) => <div className="saved-report-row" key={report.id}>
          <span className="report-file-icon"><FileText size={18}/></span>
          <div className="saved-report-copy"><strong>{report.title}</strong><small>الشهر {report.billingMonth.slice(0, 7)} · حُفظ في {formatDateTime(report.createdAt)}</small></div>
          <button className="secondary-button" onClick={() => void ctx.openSavedReport(report)}><Eye size={15}/> عرض</button>
          {ctx.has('finance.delete') && ctx.has('trash.manage') && <button className="small-icon-button danger-action" title="نقل التقرير إلى سلة المهملات" onClick={() => void ctx.deleteReport(report)}><Trash2 size={14}/></button>}
        </div>)}
        {ctx.reports.length === 0 && <div className="empty-inline">لم يتم حفظ تقارير لهذا الشهر بعد.</div>}
      </div>
    </div>}
  </motion.section>
}
