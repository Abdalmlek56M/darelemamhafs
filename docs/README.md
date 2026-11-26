# RIGX Dar — Documentation Index

> ابدأ من `deepseek.md` في جذر المشروع، ثم هذا الفهرس. **مصدر الحقيقة للحالة الحالية هو `docs/00-current-state.md`، وللخطة `docs/17-master-plan.md`.**
> قاعدة: الوثيقة الأحدث لا تُلغي الوثيقة الأصح — أي تعارض يُحل بالرجوع إلى `docs/00-current-state.md` ثم `docs/17-master-plan.md`.

---

## Reading Order

1. [`../deepseek.md`](../deepseek.md) — تعليمات التشغيل والقراءة الأولى.
2. [`00-current-state.md`](00-current-state.md) — **الحالة الآن** (Stack، المسارات، الوضع المالي، الاختبارات).
3. [`17-master-plan.md`](17-master-plan.md) — **الخطة الثابتة المعتمدة** وترتيب المراحل.
4. [`01-business.md`](01-business.md) — المجال، الأدوار، القواعد المالية المعتمدة.
5. [`02-architecture.md`](02-architecture.md) — الحالة والهدف المعماري (React+Vite نهائي).
6. [`03-security.md`](03-security.md) — الأمان والصلاحيات.
7. [`04-engineering-standards.md`](04-engineering-standards.md) — معايير الكود.
8. [`06-operations.md`](06-operations.md) — التشغيل والنشر والنسخ.
9. [`08-testing.md`](08-testing.md) — الاختبارات وعزلها.
10. [`11-deployment.md`](11-deployment.md) — النشر الفعلي على الـhost.
11. [`adr/`](adr/) — القرارات الملزمة (واجهة، مالية، خزنة، لغة، Reverse/Void).
12. آخر ملف في [`checkpoints/`](checkpoints/).

---

## Documents

| File | Purpose | Status |
|---|---|---|
| `00-current-state.md` | الحالة الحالية الموثقة (مصدر الحقيقة) | 🟢 حيّ |
| `17-master-plan.md` | الخطة الثابتة والمراحل والقرارات | 🟢 حيّ — معتمد 22 Nov 2026 |
| `01-business.md` | المجال، الأدوار، القواعد المالية | 🟢 محدّث 22 Nov 2026 |
| `02-architecture.md` | الحالة والهدف المعماري | 🟢 محدّث 22 Nov 2026 |
| `03-security.md` | Auth, RBAC, hardening, audit | 🟢 محدّث 22 Nov 2026 |
| `04-engineering-standards.md` | C#/React+Vite standards, review, DoD | 🟢 محدّث 22 Nov 2026 |
| `05-roadmap.md` | مراحل 0–1 القديمة | 🟡 تاريخي |
| `06-operations.md` | Setup, migrations, backups, deploy | 🟢 محدّث 22 Nov 2026 |
| `07-gap-audit.md` | فحص المشروع القديم (15–16 Nov) | 🟡 تاريخي |
| `08-testing.md` | Test strategy, isolation, CI | 🟢 محدّث 22 Nov 2026 |
| `09-legacy-refactor-plan.md` | خطة تفكيك الملفات القديمة | 🟡 تاريخي/مرجعي |
| `10-code-review.md` | مراجعة الكود (16 Nov) | 🟡 تاريخي |
| `11-deployment.md` | Host + domain deployment | 🟢 حيّ |
| `13-teacher-portal-requirements.md` | متطلبات بوابة المعلمة | 🟢 محدّث |
| `14-ui-audit-and-mobile-direction.md` | UI audit واتجاه الموبايل | 🟢 محدّث — التجارب مستمرة |
| `15-legacy-reuse-audit.md` | تدقيق إعادة استخدام القديم | 🟢 محدّث ماليًا |
| `16-supervision-workspace-plan.md` | خطة مساحة الإشراف والتواصل | 🟢 محدّث الحالة |
| `18-meet-recording-plan.md` | خطة تسجيل وبث Google Meet + Calendar + Drive | ✅ Phase 3.0–3.3 منفّذة — الباقي مؤجل |
| `19-meet-operations.md` | تشغيل البوت وGoogle/Meet | 🟢 حيّ |
| `20-meet-recorder-handoff.md` | تسليم تقني كامل للبوت | 🟢 حيّ |
| `21-audio-only-mode-brief.md` | وضع تسجيل صوتي فقط (تخفيف الحمل) | 📋 brief للتنفيذ |
| `22-inhouse-meetings-design.md` | تصميم منصة اجتماعات داخلية + قرار/خطة | 📝 مقترحة — بانتظار قرار المالك |
| `adr/` | ADRs (0001–0005) | 🟢 حيّ |
| `audits/` | تقارير تدقيق (تداخل المواعيد، تجاوب الموبايل) | 🟢 جديد |
| `checkpoints/` | سجل Done/Remaining/Decisions لكل خطوة | 🟢 حيّ |
| `samples/` | نماذج PDF/تقارير | 🟡 مرجعي |

> لا يوجد `docs/12-*` — الترقيم يقفز من 11 إلى 13 (وثيقة قديمة أُزيلت).

---

## Current Status (22 Nov 2026)

- **النظام Live** على `<deployment-host>` (Nginx + systemd + PostgreSQL 17).
- **الواجهة:** React 19 + Vite (نهائي) — `/`، `/management`، `/teacher`، `/supervisor`.
- **Backend:** legacy API (كل الدومين) + new API `/api/v1` (Identity + Secretariat + Teaching).
- **الترحيلات:** 24 في المستودع (001→024)؛ الإنتاج على 23 حتى النشر القادم.
- **الاختبارات:** 16 unit + 20 integration + 6 Vitest؛ لا Playwright/Contract بعد.
- **تم 22 Nov:** 2.0 Docs Reset + 2.1 تأمين النشر/النسخ (تحتاج rehearsal) + 2.2 تداخل المواعيد (45/45 + تحصين 17/17) + 2.3 Reverse/Void + 2.4-a/b تجاوب (shell/جداول/لمس/ConfirmSheet/MonthPicker) + 2.5-a CI/proxy.
- **التالي:** 2.4-c QA بصري وتلميع + 2.5-b contract/E2E/deploy — التفاصيل في `docs/17-master-plan.md`.
- **مؤجل بقرار المالك:** الإنجليزية، القيد المزدوج، مسير/قسائم الرواتب، خصومات/خطط رسوم، إيصالات مرقّمة، بوابة ولي الأمر.

---

## Rules

- الحالة الحالية الموثقة في `docs/00`؛ الخطة في `docs/17`؛ لا تخترع قرارًا.
- الوثائق الأحدث تُحدّث مع كل checkpoint.
- لا أسرار في الوثائق.
- كل قاعدة مالية = كود + اختبار + وثيقة (ADR عند التغيير).
- العربية هي لغة المنتج والتوثيق الحالية؛ الإنجليزية مؤجلة.
