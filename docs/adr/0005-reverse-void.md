# ADR-0005 — Reverse/Void بدل الحذف المالي

**Status:** Accepted — **منفّذ** (22 Nov 2026)
**Date:** 22 Nov 2026
**Decider:** مالك الدار
**Related:** deepseek.md القاعدة رقم 3؛ docs/01-business.md §5.3، §5.5، §6.5؛ docs/15-legacy-reuse-audit.md R10؛ checkpoint 2.3

## Context

قاعدة المشروع الصريحة: **لا حذف لتاريخ مالي أو حضور؛ التصحيح يكون بعكس/إلغاء مع أثر.**

الواقع قبل التنفيذ:

- زر «حذف الاستحقاق» في لوحة الإدارة كان ينقل monthly_charges إلى الـtrash (soft delete) وليس إلغاءً دلاليًا؛ الصف يختفي من القوائم والتقارير.
- payments ممنوع حذفها/إرجاعها (purge المالي محجوب عبر migration 014 والحُرّاس، وrestore المالي معطّل)، لكن لا توجد آلية Void/Reversal واضحة.
- payments.amount > 0 يمنع صفوفًا سالبة.
- النتيجة: لا يوجد أثر واضح «ملغي/معكوس» في السجل، والقاعدة تُخترق شكليًا عبر مسار trash بدل الإلغاء.

## Decision

### المبدأ

1. أي سجل مالي (استحقاق monthly_charges أو دفعة payments) **لا يُحذف ولا يُنقل للـtrash كإلغاء نهائي**.
2. الإلغاء = **Void/Reverse** بسبب إلزامي (**3–500 حرف** بعد trim)، فاعل معروف، وقت، وAudit؛ والسجل يبقى ظاهرًا في السجل والتقارير بحالة «ملغي».
3. يُستبعد الملغي من كل المجاميع (المستحق/المدفوع/المتبقي/المتأخرات/الإيرادات) — لا يُحذف الصف.

### المخطط الفعلي (migration 024_financial_void.sql)

على monthly_charges و payments:

    ADD COLUMN voided_at   TIMESTAMPTZ NULL
    ADD COLUMN voided_by   UUID NULL REFERENCES app_users(id) ON DELETE SET NULL
    ADD COLUMN void_reason TEXT NULL
    CHECK: إما الثلاثة NULL، أو voided_at وسبب 3..500 حرف (btrim)

- استبدال القيد الفريد القديم unique(enrollment_id, billing_month) بفهرس جزئي فريد
  uq_monthly_charges_active_enrollment_month WHERE voided_at IS NULL AND is_trashed = FALSE
  → بعد Void (أو trash) يمكن إنشاء استحقاق صحيح لنفس الشهر، والنشط يبقى فريدًا.
- فهارس جزئية: monthly_charges(enrollment_id, billing_month) وpayments(monthly_charge_id, paid_at) حيث voided_at IS NULL.

### دوال قاعدة البيانات (المنطق الذري)

    dar_void_charge(p_charge uuid, p_actor uuid, p_reason text) RETURNS integer
    dar_void_payment(p_payment uuid, p_actor uuid, p_reason text) RETURNS integer

قيم الإرجاع: 0 = نجح، 1 = غير موجود/في trash، 2 = ملغي بالفعل، 3 = الاستحقاق عليه دفعات سارية (ألغِ الدفعات أولًا)، 4 = مدخل غير صالح (سبب/فاعل). كلاهما يقفل الصف FOR UPDATE داخل معاملة.

### السلوك المنفذ

1. **إلغاء استحقاق:** POST /api/charges/{id}/void بجسم {reason} — يرفض 409 إذا وُجدت دفعات سارية (يلزم إلغاء الدفعات أولًا)، ويرفض 409 إذا كان ملغيًا بالفعل. الاستحقاق الملغي لا يدخل في «المستحق/المتبقي» ولا في الإيرادات.
2. **إلغاء دفعة:** POST /api/payments/{id}/void بجسم {reason} — يضع voided_at/by/reason على الدفعة نفسها؛ لا تُنشأ صفوف سالبة. الدفعة الملغاة تبقى معروضة «ملغاة» وتُستبعد من المجاميع.
3. **الاحتساب:** كل استعلام يحسب المستحق/المدفوع/المتبقي/المتأخرات/الإيرادات يضيف:
   - monthly_charges: AND voided_at IS NULL (حيث «النشط» مطلوب)
   - payments: AND voided_at IS NULL
   والاستثناء الوحيد: كشف حساب الطالبة (History) يعرض الملغي بشارة وسبب وسطر سحب.
4. **الصلاحية:** finance.void جديدة (seed + backfill لكل من يملك finance.edit على مستوى user_permissions وrole_permissions). غير ممنوحة تلقائيًا لأي حساب آخر. Audit إلزامي: charge.void details {amountDue, voidReason} و payment.void details {chargeId, amount, voidReason} في نفس المعاملة؛ لا Audit عند الفشل.
5. **الـTrash:** منع move-to-trash لـ monthly-charge و payment (409 «السجلات المالية لا تُحذف — استخدم الإلغاء (Void)»). purge المالي يبقى محجوبًا وقائيًا دائمًا. أرشفة طالب/حلقة/التحاق قد تنقل سجلات مالية تابعة للـtrash (سلوك قديم؛ purge يبقى محجوبًا) — تحسين لاحق.
6. **الواجهة:** زر «إلغاء الاستحقاق (Void)» بدل «حذف الاستحقاق»؛ حوار سبب إلزامي (3..500)؛ الصفوف الملغاة تظهر بشارة «ملغي» + السبب + التاريخ + سطر سحب (في سجل الطالب)، مع منع إلغاء الملغي.
7. **قفل الشهر:** قفل الرواتب/الحضور الحالي (payroll_locks، migration 022) لا يغطي إقفال فواتير الشهر؛ سياسة «لا Void بعد إقفال مالي» لم تُنفذ بعد وتحتاج قرارًا في المرحلة 2.6 (خزنة/تقفيل).
8. **التقارير/الاستعلامات:** تم تعديل كل استعلامات المال في الـbackend القديم والـAPI الجديد (teacher subscriptions، supervisor unpaid/students، NotificationSync، dashboard، collections، roster، charge audit) لتستبعد الملغي، وإلا ظهرت أرقام خاطئة بعد أول Void.

## خارج النطاق الآن

- عكس حضور/أجور (لها مسار تصحيح منفصل مع audit).
- إشعارات دائنة/استرداد نقدي كاملة (backlog ADR-0002).
- ترحيل السجلات القديمة الموجودة في الـtrash: تُراجع يدويًا وتُعالج بقرار مالك، ولا تُحذف آليًا.
- إقفال شهري مالي يمنع Void بعد التقفيل (المرحلة 2.6).

## Consequences

- يتحقق شرط «لا حذف مالي» بشكل دلالي وقابل للتدقيق بدل الـtrash.
- تغييرات إلزامية في كل استعلام مالي — نُفذت في legacy + new API.
- الاختبارات: tests/regression/sql/financial_void_verify.sql — 23 نتيجة، **23/23 PASS** على PostgreSQL 17 معزول (schema 001→024 + backfill + كل السيناريوهات + CHECKs + idempotency).
- متبقٍ: اختبار تكامل API (لأن legacy API لا يملك test host)؛ ومراجعة قواعد التقرير/الطباعة يدويًا.
- يمكن لاحقًا منع trash المالي نهائيًا.

## Affected files (المنفذ فعليًا)

- database/024_financial_void.sql (جديد)
- tests/regression/sql/financial_void_verify.sql (جديد)
- backend/DarEltahfeez.Api/DomainEndpoints.Collections.cs / History.cs / Circles.cs / DomainEndpoints.cs
- backend/DarEltahfeez.Api/SystemAdminEndpoints.Trash.cs / Insights.cs / SystemAdminEndpoints.cs
- backend/DarEltahfeez.Api/Security.cs + src/Common/Dar.Common/Domain/PermissionCodes.cs
- src/Modules/Teaching/.../Supervisor/StudentsEndpoint.cs + UnpaidEndpoint.cs + Teacher/MoneyEndpoints.cs
- src/Host/Dar.Api/Features/System/NotificationSync/NotificationSyncService.cs
- frontend/src/pages/PaymentsPage.tsx، application/useDarApplication.ts، components/dialogs/{VoidDialog,ApplicationDialogs,StudentHistoryDialog}.tsx، domain/{types,permissions}.ts، system/constants.ts
- docs/01-business.md §5.3، §6.5؛ docs/15 R10؛ docs/00؛ docs/17
