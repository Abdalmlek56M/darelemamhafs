# ADR-0009 — سجل حالات الالتحاق: مفاتيح خارجية، القفل، والاحتفاظ

**Status:** Accepted — منفّذ (batch 3)
**Date:** 27 Nov 2026
**Decider:** مالك الدار (مراجعة 2cd9dcf: مفاتيح 039 يجب ألا تكسر التصفير/الحذف/الاحتفاظ)
**Related:** `database/039a_enrollment_status_history_table.sql`, `database/039b_enrollment_status_history_backfill.sql`, `docs/03-security.md` §27، `tests/regression/tier2-history*`

## Context

migration 039 أضاف جدول `enrollment_status_history` مملوءًا من `audit_log` مع FK إلى
`circle_enrollments(id)` وإلى `audit_log(id)`. المراجعة طلبت إثبات أن هذا لا يكسر:
(أ) مهمة الاحتفاظ (retention)، (ب) التصفير (data reset)، (ج) حذف طالب/تسجيل.

## Decision

1. **`enrollment_id` → `circle_enrollments(id) ON DELETE CASCADE`**: السجل مشتق من الـenrollment،
   فإذا حُذف الـenrollment فعليًا (تصفير/تنظيف maintenance/تنظيف اختبارات) تختفي صفوفه المشتقة
   معه. الحذف الفعلي للـenrollment محمي أصلًا بمفاتيح `RESTRICT` للمالية والحضور (014/006/001)،
   أي أن CASCADE هنا لا يتجاوز حماية أي بيانات مالية.
2. **append-only guard يسمح بحذف cascade فقط**: `trg_enrollment_status_history_append_only`
   يرفض `UPDATE`/`DELETE` المباشر (trigger depth = 1)، لكنه يسمح بـ`DELETE` القادم من FK cascade
   (depth > 1). وبهذا يبقى الجدول append-only للتطبيق، وقابلًا للحذف المشتق عند حذف الأصل.
3. **`source_audit_id` → `audit_log(id) ON DELETE RESTRICT` يبقى**: `audit_log` هو الدليل
   الأصلي، ولا يوجد أي مسار مدعوم يحذفه:
   - `RetentionService` لا يمس `audit_log` إطلاقًا (auth/otp/notifications/communication فقط).
   - التصفير في الواجهة = نقل السجلات الحية إلى سلة المهملات (soft delete) وليس حذف أرشيف.
   - trigger `015` يمنع UPDATE/DELETE على audit_log، واختبارات `tier2-history-fk` تثبت ذلك.
   أي تقليم مستقبلي لـ`audit_log` سيحتاج قرار migration صريح (وليس حذفًا صامتًا) للحفاظ على
   قابلية التتبع، ولذلك RESTRICT هو الافتراضي الآمن.
4. **تقسيم 039 إلى ملفين**: `039a` = جدول + فهارس + حراس + trigger المزامنة، `039b` = backfill +
   assertions + الصفوف الاصطناعية + تحويل دوال الأهلية. كل ملف < 400 سطر، والاسم يُطبّق بالترتيب
   (`039a` قبل `039b` قبل `040`)، وإعادة التطبيق no-op. سبب التقسيم: حد الـ400 سطر وللفصل بين
   schema (آمن/سريع) وbackfill (طويل نسبيًا).
5. **القفل/الوقت**: `039a` لا يأخذ قفلًا طويلًا على `audit_log` (إنشاء الـtrigger فقط يأخذ
   ShareRowExclusive قصير). `039b` يأخذ `SHARE ROW EXCLUSIVE ON audit_log` داخل معاملته فقط،
   لأن trigger المزامنة أصبح مثبتًا قبل الـbackfill (أي insert متزامن يُلتقط بالـtrigger،
   والـbackfill مع `ON CONFLICT` يكمّل فقط الصفوف القديمة)، فيمكن تقليل زمن القفل.
   - عند تشغيل الإنتاج: الـbackfill يقرأ صفوف `audit_log` من نوع enrollment/action lifecycle
     فقط (بـindex من 011) ويكتب صفوفًا بحجم مشابه. الزمن يتناسب مع عدد أحداث دورة حياة
     الالتحاق وليس مع حجم `audit_log` كاملًا.
   - **قياس فعلي (PostgreSQL 17، disposable DB، 103,000 صف audit منها 3,000 lifecycle):**
     `039a` = 0.22s، `039b` = 0.31s (وتكرار `039b` = 0.28s no-op). الـlock يُحجز داخل معاملة
     `039b` فقط، أي ~0.3s عند هذا الحجم؛ القراءات لا تتأثر، والكتابة على audit تنتظر فقط
     مدة المعاملة.
   - **تقدير الإنتاج (من كتالوج الإنتاج فقط، بدون قراءة صفوف):** `audit_log` ≈ 514 صف
     (reltuples) وحجمه ≈ 584 kB بـindexين؛ `circle_enrollments` ≈ 56 kB. أي أن الـbackfill
     على الإنتاج متوقع أن يكون أقل بكثير من ثانية، والـlock غير ملحوظ عمليًا. القيم تقديرية
     من الـcatalog وقد تتغير مع autovacuum/analyze.
   - أفضل نافذة: نفس نافذة الـdeploy المعتادة قبل swap (الـdeploy يأخذ backup أولًا).

## Consequences

- حذف الطالب/التسجيل/التصفير والـmaintenance cleanup لا تُحجبها صفوف السجل المشتقة.
- الاستعلامات (دوال الأهلية) تعمل كما هي؛ سحب/تعديل الصلاحيات لا علاقة له.
- الاختبارات: `tier2-history` (تكافؤ + idempotency)، `tier2-history-fk` (retention لا يمس
  audit، audit/التاريخ append-only، حذف cascade، trash move/restore)،
  `docs-migration-count` (عدد/نطاق الملفات).
- **NOT VERIFIED:** تشغيل migration على قاعدة الإنتاج لم يحدث؛ أرقام القفل/الزمن تقديرية من
  disposable DB، وتحتاج نافذة deploy معتمدة من المالك.
