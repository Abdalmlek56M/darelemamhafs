# ADR-0005 — Reverse/Void بدل الحذف المالي

**Status:** Accepted
**Date:** 22 Nov 2026
**Decider:** مالك الدار
**Related:** `deepseek.md` القاعدة رقم 3؛ `docs/01-business.md` §5.3، §5.5، §6.5؛ `docs/15-legacy-reuse-audit.md` R10

## Context

قاعدة المشروع الصريحة: **لا حذف لتاريخ مالي أو حضور؛ التصحيح يكون بعكس/إلغاء مع أثر.**

الواقع الحالي:

- زر «حذف الاستحقاق» في لوحة الإدارة ينقل `monthly_charges` إلى الـtrash (soft delete) وليس إلغاءً دلاليًا؛ الصف يختفي من القوائم والتقارير.
- `payments` ممنوع حذفها/إرجاعها (purge المالي محجوب عبر migration 014 والحُرّاس، وrestore المالي معطّل)، لكن لا توجد آلية Void/Reversal واضحة.
- `payments.amount > 0` يمنع صفوفًا سالبة؛ لذلك لا بد من تمثيل العكس بشكل متوافق مع القيد.
- النتيجة الحالية: لا يوجد أثر واضح «ملغي/معكوس» في السجل، والقاعدة تُخترق شكليًا عبر مسار trash بدل الإلغاء.

## Decision

### المبدأ

1. أي سجل مالي (استحقاق `monthly_charges` أو دفعة `payments`) **لا يُحذف ولا يُنقل للـtrash كإلغاء نهائي**.
2. الإلغاء = **Void/Reverse** بسبب إلزامي (+10 أحرف)، فاعل معروف، وقت، وAudit؛ والسجل يبقى ظاهرًا في السجل والتقارير بحالة «ملغي».

### مخطط البيانات المقترح (migration `024_financial_voids.sql`)

على `monthly_charges`:

```sql
ALTER TABLE monthly_charges
  ADD COLUMN voided_at   TIMESTAMPTZ NULL,
  ADD COLUMN voided_by   UUID NULL REFERENCES app_users(id),
  ADD COLUMN void_reason TEXT NULL,
  ADD CONSTRAINT monthly_charges_void_reason_check
    CHECK (void_reason IS NULL OR length(btrim(void_reason)) >= 10);
```

على `payments`:

```sql
ALTER TABLE payments
  ADD COLUMN entry_kind    VARCHAR(10) NOT NULL DEFAULT 'payment'
    CHECK (entry_kind IN ('payment','reversal')),
  ADD COLUMN voided_at     TIMESTAMPTZ NULL,
  ADD COLUMN voided_by     UUID NULL REFERENCES app_users(id),
  ADD COLUMN void_reason   TEXT NULL,
  ADD COLUMN reversal_of_id UUID NULL REFERENCES payments(id),
  ADD CONSTRAINT payments_void_reason_check
    CHECK (void_reason IS NULL OR length(btrim(void_reason)) >= 10),
  ADD CONSTRAINT payments_reversal_target_check
    CHECK ((entry_kind = 'reversal') = (reversal_of_id IS NOT NULL));
```

### السلوك

1. **إلغاء استحقاق:** `POST /api/v1/admin/charges/{id}/void` — يرفض 409 إذا وُجدت دفعات نشطة (يلزم إلغاء الدفعات أولًا)، ويرفض إذا كان الشهر مقفلًا. الاستحقاق الملغي لا يدخل في «المستحق/المتبقي».
2. **إلغاء دفعة:** `POST /api/v1/admin/payments/{id}/void` — ينشئ صف عكس `entry_kind='reversal'` بنفس المبلغ و`reversal_of_id=original`، ويضع `voided_at/by/reason` على الأصل مع سبب العكس. الأصل يبقى معروضًا «ملغي».
3. **الاحتساب:** المجاميع المدفوعة = مجموع `payments` النشطة ناقص مجموع `reversal`؛ لا تُعدَّل أعمدة الأصل، ولا تُحذف صفوف.
4. **الصلاحيات:** `finance.delete` (أو الصلاحية المخصّصة للـVoid عند توحيد كتالوج الصلاحيات) + Audit إلزامي؛ فاعل ووقت وسبب في `audit_log`.
5. **قفل الشهر:** لا Void/Reverse لشهر مقفول؛ التصحيح عبر فتح بقرار أو شهر لاحق.
6. **الـTrash:** تُزال أنواع السجلات المالية من مسار trash بعد تنفيذ الـVoid؛ ويبقى منع الـpurge وقائيًا دائمًا.
7. **الواجهة:** يستبدل زر «حذف الاستحقاق» بزر «إلغاء (Void)» مع حوار سبب إلزامي؛ الصفوف الملغاة تظهر بشارة + سبب + اسم المنفذ + الوقت.
8. **التقارير/الاستعلامات:** يتم تعديل كل استعلام يحسب المستحق/المدفوع/المتبقي ليعتمد `voided_at IS NULL` و`entry_kind`، وإلا ظهرت أرقام خاطئة بعد أول Void.

### خارج النطاق الآن

- عكس حضور/أجور (لها مسار تصحيح منفصل مع audit).
- إشعارات دائنة/استرداد نقدي كاملة (backlog ADR-0002).
- ترحيل السجلات القديمة الموجودة في الـtrash: تُراجع يدويًا وتُعالج بقرار مالك، ولا تُحذف آليًا.

## Consequences

- يتحقق شرط «لا حذف مالي» بشكل دلالي وقابل للتدقيق بدل الـtrash.
- تغييرات إلزامية في استعلامات المالية (collections/unpaid/statement/reports) في نفس الـmigration — بدونها تصبح الأرقام غير صحيحة.
- يحتاج اختبارات: void charge مع دفعات (409)، void payment مرة واحدة (idempotent/409)، احتساب المتبقي بعد العكس، إخفاء الصفوف الملغاة من المجاميع مع بقاء عرضها، audit، ومنع purge.
- يقلل الاعتماد على trash المالي تدريجيًا؛ يمكن لاحقًا منع trash المالي نهائيًا.
- تنفيذ هذا الـADR يسبق أي تحسين لواجهة المدفوعات، ويأتي بعد تأمين النشر/الـBackup.

## Affected files

- `database/024_financial_voids.sql` (جديد + قيود check)
- `backend/DarEltahfeez.Api/DomainEndpoints.Collections.cs` (charges/payments/collections)
- `backend/DarEltahfeez.Api/DomainEndpoints.History.cs` (كشف حساب الطالبة)
- `backend/DarEltahfeez.Api/SystemAdminEndpoints.Trash.cs` (إزالة المالي من trash)
- `frontend/src/pages/PaymentsPage.tsx`
- `frontend/src/application/useDarApplication.ts` (`deleteCharge` → `voidCharge`)
- `frontend/src/components/ChargeAuditPanel.tsx`
- `tests/Dar.IntegrationTests/` (اختبارات Void)
- `docs/01-business.md` §5.3، §6.5؛ `docs/15-legacy-reuse-audit.md` R10
