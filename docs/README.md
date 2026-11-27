# RIGX Dar — Documentation Index

> ابدأ من `deepseek.md` في جذر المشروع، ثم هذا الفهرس. **الوكلاء يقرأون [`../AGENTS.md`](../AGENTS.md) أولًا** (قواعد إلزامية: بيانات الإنتاج/الترحيلات/الأسرار/حدود الملفات/التحقق). **مصدر الحقيقة للحالة الحالية هو `docs/00-current-state.md`، ولفهرس الخطة `docs/17-master-plan.md`، ولتفاصيل التحصين `docs/23-hardening-plan.md`، ولسجل التنفيذ `docs/OVERNIGHT-REPORT.md`.**
> قاعدة: الوثيقة الأحدث لا تُلغي الوثيقة الأصح — أي تعارض يُحل بالرجوع إلى `docs/00-current-state.md` ثم `docs/17-master-plan.md`، وقواعد التشغيل في `docs/WORKFLOW.md` ملزمة. قرارات S-1 بلا ADR وفهرس القرارات في `docs/adr/README.md`.

---

## Reading Order

1. [`../AGENTS.md`](../AGENTS.md) — قواعد الوكلاء الملزمة (بيانات الإنتاج، الأسرار، الملفات، الاختبارات، الأوامر).
2. [`../deepseek.md`](../deepseek.md) — تعليمات التشغيل والقراءة الأولى.
3. [`00-current-state.md`](00-current-state.md) — **الحالة الآن** (Stack، المسارات، الوضع المالي، الاختبارات).
4. [`17-master-plan.md`](17-master-plan.md) — **فهرس الخطة** (ترتيب المراحل المعتمد + القرارات D1–D9 + خريطة الوثائق).
5. [`23-hardening-plan.md`](23-hardening-plan.md) — **تفاصيل خطة التحصين** (Tier 0/1/2 + Z، وبنود P/Q/S)؛ الحالة والأدلة في `OVERNIGHT-REPORT.md`.
6. [`OVERNIGHT-REPORT.md`](OVERNIGHT-REPORT.md) — سجل تنفيذ التحصين الوحيد (Done/PARTIAL/BLOCKED/NOT VERIFIED).
7. [`WORKFLOW.md`](WORKFLOW.md) — قواعد التشغيل الإلزامية (Process Safety حادثة 24 Nov + نشر).
8. [`01-business.md`](01-business.md) — المجال، الأدوار، القواعد المالية المعتمدة.
9. [`02-architecture.md`](02-architecture.md) — الحالة والهدف المعماري (React+Vite نهائي).
10. [`03-security.md`](03-security.md) — الأمان والصلاحيات.
11. [`04-engineering-standards.md`](04-engineering-standards.md) — معايير الكود.
12. [`06-operations.md`](06-operations.md) — التشغيل والنشر والنسخ؛ [`runbooks/`](runbooks/) — إجراءات deploy/rollback/backup-restore/incident.
13. [`08-testing.md`](08-testing.md) — الاختبارات وعزلها.
14. [`11-deployment.md`](11-deployment.md) — النشر الفعلي على الـhost؛ [`staging-environment.md`](staging-environment.md) — بيئة staging.
15. [`naming.md`](naming.md) — أسماء الريبو/النشر/الخدمات/قواعد البيانات (production vs staging vs disposable).
16. [`adr/`](adr/) — القرارات الملزمة (كل ملفات `adr/NNNN-*.md`) وفهرس القرارات بلا ADR: [`adr/README.md`](adr/README.md).
17. آخر ملف في [`checkpoints/`](checkpoints/).

---

## Documents

| File | Purpose | Status |
|---|---|---|
| [`../AGENTS.md`](../AGENTS.md) | قواعد الوكلاء الملزمة (الإنتاج/الترحيلات/الأسرار/الملفات/الأوامر/التحقق) — اقرأها أولًا | 🟢 إلزامي |
| `00-current-state.md` | الحالة الحالية الموثقة (مصدر الحقيقة) | 🟢 حيّ — محدّث 27 Nov 2026 |
| `17-master-plan.md` | **فهرس الخطة**: ترتيب المراحل المعتمد + القرارات D1–D9 + خريطة مصادر الحالة | 🟢 حيّ — معتمد 22 Nov 2026 |
| `23-hardening-plan.md` | **تفاصيل خطة التحصين** (Tier 0/1/2 + Z، وبنود P/Q/S)؛ الحالة في `OVERNIGHT-REPORT.md` | 🟢 حيّ — جرد 24 Nov مجمّد |
| `OVERNIGHT-REPORT.md` | سجل تنفيذ التحصين خطوة بخطوة (المصدر الوحيد للحالة/الأدلة/NOT VERIFIED) | 🟢 حيّ |
| `naming.md` | أسماء الريبو/النشر/الخدمات/قواعد البيانات: production vs staging vs disposable + placeholders | 🟢 جديد — 27 Nov 2026 |
| `WORKFLOW.md` | Process Safety + قواعد النشر/الحوادث | 🟢 إلزامي |
| `01-business.md` | المجال، الأدوار، القواعد المالية | 🟢 محدّث 22 Nov 2026 |
| `02-architecture.md` | الحالة والهدف المعماري | 🟢 محدّث 27 Nov 2026 |
| `03-security.md` | Auth, RBAC, hardening, audit | 🟢 محدّث 27 Nov 2026 |
| `04-engineering-standards.md` | C#/React+Vite standards, review, DoD | 🟢 محدّث 27 Nov 2026 |
| `05-roadmap.md` | مراحل 0–1 القديمة | 🟡 تاريخي |
| `06-operations.md` | Setup, migrations, backups, deploy | 🟢 محدّث 27 Nov 2026 |
| `07-gap-audit.md` | فحص المشروع القديم (15–16 Nov) | 🟡 تاريخي |
| `08-testing.md` | Test strategy, isolation, CI | 🟢 محدّث 27 Nov 2026 |
| `09-legacy-refactor-plan.md` | خطة تفكيك الملفات القديمة | 🟡 تاريخي/مرجعي |
| `10-code-review.md` | مراجعة الكود (16 Nov) | 🟡 تاريخي |
| `11-deployment.md` | Host + domain deployment | 🟢 حيّ |
| `staging-environment.md` | بيئة staging على نفس الـhost | 🟢 حيّ — محدّث 27 Nov 2026 |
| `13-teacher-portal-requirements.md` | متطلبات بوابة المعلمة | 🟢 محدّث |
| `14-ui-audit-and-mobile-direction.md` | UI audit واتجاه الموبايل | 🟢 محدّث — التجارب مستمرة |
| `15-legacy-reuse-audit.md` | تدقيق إعادة استخدام القديم | 🟢 محدّث ماليًا |
| `16-supervision-workspace-plan.md` | خطة مساحة الإشراف والتواصل | 🟢 محدّث الحالة |
| `18-meet-recording-plan.md` | خطة تسجيل وبث Google Meet + Calendar + Drive | 🟢 Phase 3.0–3.3 منفّذة — الباقي مؤجل |
| `19-meet-operations.md` | تشغيل البوت وGoogle/Meet | 🟢 حيّ |
| `20-meet-recorder-handoff.md` | تسليم تقني كامل للبوت | 🟢 حيّ |
| `21-audio-only-mode-brief.md` | وضع تسجيل صوتي فقط (تخفيف الحمل) | ✅ منفّذ ومنشور (3.3b) |
| `22-inhouse-meetings-design.md` | تصميم منصة اجتماعات داخلية + قرار/خطة | 📝 مقترحة — بانتظار قرار المالك |
| `24-mobile-app-plan.md` | تخطيط تطبيق موبايل (Google Play/App Store) | 📋 تخطيط مستقبلي — لا تنفيذ |
| `25-meetings-capacity-plan.md` | تخطيط سعة اجتماعات LiveKit/WebRTC | 📋 تخطيط هندسي — لا تنفيذ |
| `adr/` | القرارات الملزمة (كل ملفات `NNNN-*.md`)؛ الفهرس الموحّد + قرارات S-1 بلا ADR في `adr/README.md` | 🟢 حيّ |
| `audits/` | تقارير تدقيق (تداخل المواعيد، تجاوب الموبايل) | 🟢 جديد |
| `runbooks/` | إجراءات التشغيل: [README](runbooks/README.md) — deploy / rollback (+ `rollback-db`) / backup-restore / incident-response / db-roles-and-tuning / livekit-m0 / asset-retention | 🟢 حيّ — 27 Nov 2026 |
| `checkpoints/` | سجل Done/Remaining/Decisions لكل خطوة | 🟢 حيّ (سجلات تاريخية) |
| `samples/` | نماذج PDF/تقارير | 🟡 مرجعي |

> لا يوجد `docs/12-*` — الترقيم يقفز من 11 إلى 13 (وثيقة قديمة أُزيلت).

---

## Current Status (27 Nov 2026)

- **الإنتاج:** `https://<deployment-host>` (Nginx + systemd + PostgreSQL 17) — آخر نشر مسجل 22 Nov 2026 على ledger **26/26**؛ جلسات التحصين لم تنشر.
- **`main`:** دفعات التحصين (Tier 0/1، Z1 splits، Z2، Tier 2، B7/B10/UI) مدموجة؛ التفاصيل في `docs/OVERNIGHT-REPORT.md`.
- **الواجهة:** React 19 + Vite (نهائي) — `/`، `/management`، `/teacher`، `/supervisor`؛ **46 ملف / 154 اختبار Vitest** (Testing Library + jsdom).
- **Backend:** legacy API (كل الدومين) + new API `/api/v1` (Identity + Secretariat + Teaching + Meet)؛ unit + integration (Testcontainers).
- **الترحيلات:** **43** في المستودع (001→042؛ 039 مقسمة 039a/039b؛ 042 أحدث ملف)؛ الإنتاج على 26 حتى النشر القادم.
- **staging:** موجود على نفس الـhost (منفصل DB/مجلدات/منافذ/vhost + IP allow-list؛ تفاصيل في `staging-environment.md`).
- **التالي:** نشر دفعة التحصين إلى staging ثم الإنتاج (بموافقة المالك)؛ Z2 dedup المتبقي؛ Tier 3؛ E2E contract.
- **مؤجل بقرار المالك:** الإنجليزية، القيد المزدوج، مسير/قسائم الرواتب، خصومات/خطط رسوم، إيصالات مرقّمة، بوابة ولي الأمر، تطبيق الموبايل (24)، منصة LiveKit (22/25).

---

## Rules

- الحالة الحالية الموثقة في `docs/00`؛ فهرس الخطة في `docs/17`؛ تفاصيل التحصين في `docs/23` وسجل الحالة الوحيد في `docs/OVERNIGHT-REPORT.md`؛ لا تخترع قرارًا.
- **عدّاد الترحيلات له مصدر واحد:** العدد الحقيقي = عدد ملفات `database/*.sql`، ويُذكر فقط في `README.md` و`docs/00-current-state.md` (يرفض CI أي اختلاف: `tests/regression/docs-migration-count/run.mjs`). لا تكرر العدد في وثائق أخرى.
- الوثائق الأحدث تُحدّث مع كل checkpoint. أي قرار معماري = ADR في `docs/adr/` + صف في `docs/adr/README.md` (والقرارات بلا ADR تُسجَّل هناك بحالة `needs owner confirmation` إن لم يكن قرار المالك موثقًا).
- لا أسرار في الوثائق (لا domain/IP/server/DB حقيقي) — القواعد في `docs/03-security.md` §19 و`docs/naming.md`؛ الـplaceholders فقط.
- كل قاعدة مالية = كود + اختبار + وثيقة (ADR عند التغيير)؛ أي تعديل مالي (مثل أجر صفر الدقائق 27 Nov 2026) يوثّق أثره على المبالغ المخزنة سابقًا.
- كل نشر/rollback/استرجاع/حادثة يتبع `docs/runbooks/` — لا إجراء من الذاكرة.
- العربية هي لغة المنتج والتوثيق الحالية؛ الإنجليزية مؤجلة.
