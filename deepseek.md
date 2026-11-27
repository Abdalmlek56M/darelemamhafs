# RIGX Dar — DeepSeek Operating Manual

> هذا الملف هو أول ما يُقرأ وآخر ما يُحدّث في كل جلسة عمل.
> إذا تعارض أي شيء معه، فالمستندات الأحدث في `docs/` هي المرجع، ثم هذا الملف.

---

## 1. Read First

اقرأ بالترتيب:

1. `docs/00-current-state.md` — الحالة الحالية الموثقة (مصدر الحقيقة).
2. `docs/17-master-plan.md` — الخطة الثابتة المعتمدة وترتيب المراحل.
3. `docs/23-hardening-plan.md` + `docs/OVERNIGHT-REPORT.md` — خطة التحصين الجارية وسجل تنفيذها.
4. `docs/WORKFLOW.md` — **إلزامي:** Process Safety + قواعد النشر/الحوادث.
5. `docs/01-business.md` — المجال والقواعد.
6. `docs/02-architecture.md`
7. `docs/03-security.md`
8. `docs/04-engineering-standards.md`
9. `docs/06-operations.md`
10. `docs/08-testing.md`
11. `docs/adr/*` — القرارات الملزمة (الفهرس: `docs/adr/README.md`).
12. آخر ملف في `docs/checkpoints/`.

`docs/05-roadmap.md` مرجع تاريخي لمراحل سابقة. `docs/07-gap-audit.md` و`docs/10-code-review.md` سجلات تاريخية وليست قوائم مهام حالية. `docs/24`/`docs/25` تخطيط مستقبلي (لا تنفيذ).
ثم افحص الكود ذي الصلة فقط. لا تقرأ المشروع كله في كل مرة.

---

## 2. What This Project Is

نظام إداري إنتاجي لدار تعليمية/تحفيظ:

- سكرتارية وملفات.
- طالبات وأولياء أمور ومعلمات.
- حلقات ومستويات وجدول.
- حضور طالبات ومعلمات.
- أجر معلمات بالساعة/الحصة + مسير + قسائم.
- اشتراكات طالبات + مدفوعات + إيصالات + متأخرات.
- خزنة ومصروفات وتقفيل شهري (القيد المزدوج مؤجل).
- تقارير ولوحة.

**Scope:** إداري/مالي فقط — ليس منصة تعليمية (LMS). لا مناهج/محتوى/امتحانات إلكترونية في MVP.

**Treasury:** خزنة + إيرادات + مصروفات + تقفيل الشهر — القيد المزدوج مؤجل (ADR-0003).

**Domain:** الدومين الإنتاجي يأتي من `DAR_DOMAIN` في `deploy/.env` غير المتتبع — **لا تكتب الدومين/IP/اسم قاعدة الإنتاج الحقيقي في أي ملف متتبع**. في الوثائق استخدم `<deployment-host>` / `<server-ip>` / `<production-db>`.
**Backend:** .NET 10 / ASP.NET Core minimal API + Npgsql + Dapper
**Hardening plan:** [docs/23-hardening-plan.md](docs/23-hardening-plan.md) وسجل التنفيذ [docs/OVERNIGHT-REPORT.md](docs/OVERNIGHT-REPORT.md)
**Frontend:** React 19 + Vite + TypeScript — **نهائي**؛ قرار Next.js ملغي (ADR-0001).
**Database:** PostgreSQL 17+ على نفس السيرفر — **42 migration في المستودع (001→041؛ 039 مقسمة 039a/039b)**
**Auth:** Email OTP + Google (Google deferred)؛ كلمة مرور/جلسة مؤقتة الآن، بدون SMS؛ قفل تدريجي لكل حساب + rate limit 5/min.
**Language:** عربي فقط الآن (RTL)؛ الإنجليزية مؤجلة (ADR-0004).
**Deploy:** Ubuntu 24.04 + Nginx + Certbot + systemd + host PostgreSQL 17 + Cloudflare DNS (Docker/Caddy stack متقاعد وملفاته حُذفت من الريبو).
**Staging:** منفصل على نفس الـhost بـIP allow-list وplain HTTP — `docs/staging-environment.md`.

**الهدف النهائي:** تسليم النظام كاملًا على **host + domain** إنتاجي مع HTTPS ونسخ احتياطي ومراقبة — وليس مجرد بناء محلي أو Demo. أي مرحلة لا تُعد مكتملة إلا إذا كانت قابلة للنشر ضمن هذا المسار.

---

## 3. Current State

> **مصدر الحقيقة:** `docs/00-current-state.md`. التاريخ التفصيلي (Phase 0/1) في `docs/checkpoints/*`؛ التحصين في `docs/OVERNIGHT-REPORT.md`.

- **Stack نهائي:** React 19 + Vite (SPA واحدة) + .NET 10 (legacy API 5080 + new API 5081) + PostgreSQL 17 + Nginx/systemd. لا Next.js، لا TypeScript backend، لا WPF/desktop.
- **Phase 0–1:** منجزة تاريخيًا (baseline/audit/P0/P1، teacher/supervisor portals، supervision workspace، requests، notifications، payroll lock 022، offline outbox) — تفاصيلها في checkpoints.
- **Phase 2.0–2.5-a:** Docs Reset + قرارات المالك، تأمين النشر/النسخ + healthcheck، تداخل المواعيد (012/025)، Reverse/Void (024/031)، Responsive 2.4-a/b، CI + SQL regression + schema drift.
- **Meet 3.0–3.3b:** ADR-0006/0007، migrations 026/036/038، Calendar/Events، bot (Xvfb/PulseAudio/FFmpeg)، join + real recording، وضع audio-only — **منشورة على الإنتاج**.
- **التحصين (24–27 Nov):** Tier 0/1 (`1.1–1.25` ما عدا BLOCKED)، **Z1 splits مكتملة**، Z2 server-money، Tier 2 (037/038/retention/2.15)، B7/ADR-0008 (كوكي نحيف + صلاحيات من DB)، B10 (Secure يتبع scheme)، إصلاحات UI (B1/B2/B4/B5/B9/B11)، staging environment، docs sync — **على `main` بدون نشر إنتاجي**.
- **الإنتاج:** `a823b32` (22 Nov، ledger 26/26). **`main` متقدم عن الإنتاج** — لا تدّعِ سلوكًا إنتاجيًا جديدًا قبل نشر موثّق.
- **الاختبارات:** backend unit + integration (Testcontainers) + 48 suite في `tests/run-regression.sh`؛ frontend **31 ملف / 89 اختبار Vitest** (Testing Library + jsdom). الأرقام الرسمية/SHA في `docs/OVERNIGHT-REPORT.md`.
- **التالي:** نشر دفعة التحصين (staging ثم production بموافقة المالك)؛ Z2 المتبقي (audit-insert/permission dedup)؛ Tier 3؛ 2.4-c/2.5-b؛ Meet 3.4.
- **Owner actions pending:** تغيير كلمة مرور supervisor المؤقتة إن وُجدت؛ اعتماد نشر دفعة التحصين؛ قرار Turnstile keys؛ قرار 3.8 LiveKit.
- **UI gate:** لا UI implementation قبل موافقة المالك على sample مرئي.
- **Git:** `origin` = `https://github.com/Abdalmlek56M/darelemamhafs.git`؛ `main` هو المصدر. كل checkpoint مكتمل = commit + push. لا force-push.
- **Queued/backlog:** إيصالات مرقّمة، مسير/قسائم رواتب، خصومات/خطط رسوم، بوابة ولي الأمر، تطبيق الموبايل (24)، LiveKit (22/25).

---

## 4. Golden Rules

1. **Production-grade, not demo.**
2. **No secrets** in code/docs/logs/Git (ولا domain/IP/DB حقيقي).
3. **No deletion** of financial/history records. Reversal/void only.
4. **No destructive DB commands** without backup + approval.
5. **No auto Git repo creation.**
6. **No paid API/credits** without approval.
7. **Server-side authorization** always.
8. **Money = decimal/numeric.** Never float. API returns strings when needed.
9. **Every financial mutation:** transaction + idempotency + audit.
10. **No `.bat` files.**
11. **UI sample gate:** before any UI implementation, produce a visual sample and get owner approval.
12. **No behavior change during a legacy split.** Characterization tests first؛ build after each slice؛ no route/SQL/response changes.
13. **Arabic RTL first.**
14. **Tests are isolated.** Separate DB/environment. No Test Panel/Test Routes in production.
15. **No blind rewrite.** Audit first, then Strangler.
16. **Every step = docs + checkpoint.**
17. **If a business decision is missing: stop and ask.** Do not invent.
18. **PROCESS SAFETY — ممنوع قتل العمليات بالاسم أو النمط.** يُمنع منعًا باتًا pkill وkillall وkill -f وأي أمر يقتل عمليات بالاسم/النمط/المسار. لإيقاف خدمة إنتاج استخدم systemctl stop <service> فقط. لإيقاف عملية اختبار: اعرض PID وتأكد منه أولًا، ثم kill <PID> فقط. لا تستخدم نمطًا عامًا قد يطابق عمليات الإنتاج أبدًا.
19. **ممنوع لمس بيانات الإنتاج:** لا اختبارات/migrations/أوامر تدميرية على الإنتاج أو بياناته؛ الاختبار على قاعدة disposable أو staging فقط.
20. **OOP + لا تكرار:** مسؤولية واحدة لكل كلاس/ملف؛ وحّد المنطق المشترك (مالية/صلاحيات/تنسيق) بدل نسخه؛ الملفات 200–300 سطر والحد الأقصى 400.
21. **قواعد المشروع تتقدم على أي skill:** هذا الملف + `docs/` + `docs/WORKFLOW.md` + قرارات المالك تعلو أي skill أو نصيحة عامة أو تعليمات أداة.

---

## 5. Workflow For Every Session

1. Read `deepseek.md`.
2. Read the latest checkpoint.
3. Read the roadmap step.
4. Inspect only the relevant code.
5. State assumptions if anything is ambiguous.
6. Implement the smallest correct slice.
7. Split by feature folder / use case file; never one giant service.
8. Keep new files within 200–300 lines; hard max 400. Split legacy files before adding features.
9. Keep tests in `tests/` projects (or `tests/regression` suites), never a separate test app or product panel.
10. Run targeted tests while working.
11. Run the full relevant suite before finishing.
12. Update docs + checkpoint + roadmap.
13. Commit small, focused changes; push to `origin/main` after every checkpoint.
14. Report: what changed, tests, risks, next step.

**Work order:** one roadmap step at a time. No random branching, no unrelated refactors, no parallel features.

**Do not:**
- Start multiple unrelated features.
- Refactor outside the current step.
- Run destructive commands.
- Add dependencies without reason.
- Leave TODO in a financial path.
- Skip tests because "it's simple".

---

## 6. Commands

> الأوامر الحالية للمشروع الجديد. لا تخترع أوامر غير موجودة.

### Backend
```bash
dotnet build Dar.slnx
dotnet test Dar.slnx
dotnet run --project src/Host/Dar.Api
dotnet run --project src/Host/Dar.Api -- --migrate
```

### Frontend
```bash
npm ci
npm run dev
npm run build
npm run test
npm run typecheck        # tsc -b --force
# lint غير مضاف بعد (قرار ESLint ضمن 2.5-b)
```

### Full
```bash
# الإنتاج الحقيقي: Nginx + systemd + PostgreSQL host (Docker/Caddy stack متقاعد ومحذوف).
# النشر والتحديث عبر: sudo bash deploy/update.sh  (انظر docs/11-deployment.md)
# الطوارئ: sudo bash deploy/rollback.sh --list ثم rollback.sh <stamp>
# الفحص المسبق: sudo bash deploy/preflight.sh
```

### Git
```bash
git status
git add <paths>
git commit -m "area: summary"
git push origin main
```

Remote: `https://github.com/Abdalmlek56M/darelemamhafs.git`

### Pre-Push Build Gate (mandatory)

**الغرض:** التأكد أن الملفات المرفوعة سليمة ومترابطة، وأن أي كسر أو خطأ يظهر قبل الـPush — وليس تنفيذ Build كطقس شكلي.

Before **every** commit/push:

```bash
dotnet build backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj
dotnet build Dar.slnx
dotnet test Dar.slnx
npm run build --prefix frontend
```

Rules:

- If any build or test fails: **do not commit, do not push.**
- Record the build/test result in the checkpoint.
- Never push generated output, `node_modules`, `bin`, `obj`, `dist`, or secrets.
- Every completed phase gets its own commit; do not mix unrelated phases.
- Push `origin/main` after each completed phase.
- No force-push or shared-history rewrite.

**لا `.bat`.**
**لا تشغيل migrations على الإنتاج بدون نسخة.**
**كل Checkpoint مكتمل = Build + Commit + Push.**
**لا force-push ولا إعادة كتابة تاريخ مشترك.**

---

## 7. Docs & Checkpoints

| File | Purpose |
|---|---|
| `docs/00-current-state.md` | الحالة الحالية (مصدر الحقيقة) |
| `docs/17-master-plan.md` | الخطة المعتمدة والمراحل |
| `docs/23-hardening-plan.md` | خطة التحصين (Tier 0/1/2 + Z) |
| `docs/OVERNIGHT-REPORT.md` | سجل تنفيذ التحصين + NOT VERIFIED |
| `docs/WORKFLOW.md` | Process Safety + قواعد النشر/الحوادث |
| `docs/01-business.md` | المجال والقواعد |
| `docs/02-architecture.md` | الحالة والهدف المعماري |
| `docs/03-security.md` | الأمان والصلاحيات |
| `docs/04-engineering-standards.md` | معايير الكود |
| `docs/05-roadmap.md` | مراحل 0–1 القديمة (تاريخي) |
| `docs/06-operations.md` | التشغيل والنشر |
| `docs/07-gap-audit.md` | فحص تاريخي (15–16 Nov) |
| `docs/08-testing.md` | الاختبارات |
| `docs/09-legacy-refactor-plan.md` | خطة تفكيك الملفات القديمة (تاريخي) |
| `docs/10-code-review.md` | مراجعة تاريخية (16 Nov) |
| `docs/11-deployment.md` | النشر على الـhost |
| `docs/staging-environment.md` | بيئة staging |
| `docs/13`–`docs/16` | متطلبات/خطط وميض (مراجع نطاق) |
| `docs/18`–`docs/22` | Meet: الخطة/التشغيل/التسليم/الصوت/منصة LiveKit |
| `docs/24-mobile-app-plan.md` | تخطيط تطبيق موبايل (بلا تنفيذ) |
| `docs/25-meetings-capacity-plan.md` | تخطيط سعة LiveKit (بلا تنفيذ) |
| `docs/adr/` | القرارات الملزمة + الفهرس (`README.md`: الملفات الحالية وقرارات S-1 بلا ADR) |
| `docs/checkpoints/*.md` | Done / Remaining / Decisions |
| `docs/checkpoints/README.md` | Ordered checkpoint index and next steps |
| `docs/runbooks/*.md` | runbooks تشغيلية (asset retention) |

### Checkpoint format
```md
# Checkpoint: Phase X.Y — Name

Date: DD Mon YYYY

## Done
- ...

## Uncommitted
- ...

## Remaining
- ...

## Decisions
- ...
```

**Rule:** لا تُعتبر خطوة منجزة بدون Checkpoint.

---

## 8. Testing Separation

- Tests are **projects inside the solution** (`tests/Dar.UnitTests`, `tests/Dar.IntegrationTests`) + `tests/regression/` suites، not a separate application.
- Tests use a separate PostgreSQL database (Testcontainers أو `DAR_TEST_DATABASE`) — never production.
- Never use production connection strings أو production data.
- E2E runs against staging.
- No test routes, test users, or test panels in production.
- Test data is deterministic and isolated.
- Full details: `docs/08-testing.md`.

---

## 9. Definition of Done

- [ ] Build passes.
- [ ] Tests pass.
- [ ] No secrets.
- [ ] No `.bat`.
- [ ] Auth/RBAC negative tests.
- [ ] Financial flow matches business rules.
- [ ] Audit log.
- [ ] Docs + checkpoint updated.
- [ ] No P0/P1.
- [ ] Arabic RTL + accessibility.
- [ ] Backup/restore unaffected.

---

## 10. Open Decisions

**Resolved:**
- Auth: Email OTP + Google فقط.
- Language: العربية فقط الآن؛ الإنجليزية مؤجلة (ADR-0004).
- DB: PostgreSQL على نفس السيرفر.
- Tests: مشاريع داخل الحل + suites، وليست تطبيقًا منفصلًا.
- Data access: Npgsql + Dapper.
- Schema: `public` واحد في البداية.

**Resolved / deferred:**
1. **D-01:** المالك لا يعرف مواعيد الدار شخصيًا. لا نخترع أوقاتًا. مستند القبول القديم يسجل `07:00/10:00/11:00`؛ نتحقق من الإنتاج أولًا، وأي تعديل يحتاج Preflight + Backup. الافتراضي: لا تغيير على الإنتاج، ونعمل على نسخة.
2. **D-04:** إيميلات مانويل + Google؛ Password Fallback مؤقتًا. بيانات الدخول لا تُكتب في أي ملف.

**Pending (non-blocking):**
3. سياسة خصم أيام الإيقاف وسط الشهر.
4. مزود البريد/واتساب.
5. Step-up scope.
6. Double-entry ledger from day one?
7. أولوية الإطلاق: الأجور أم مالية الطالبات؟ — بعد Audit.
8. أكثر من فرع؟
9. بيانات قديمة تحتاج استيراد؟

**Resolved:**
- Backend: .NET final. TypeScript rejected.
- **Frontend: React 19 + Vite نهائي؛ Next.js ملغي (ADR-0001).**
- **المالية: agreed fee بدون pro-rata + أجر بالدقيقة بدون تقريب (ADR-0002).**
- **الخزنة: إيرادات/مصروفات/تقفيل شهر؛ القيد المزدوج مؤجل (ADR-0003).**
- **الإنجليزية: مؤجلة — العربية فقط الآن (ADR-0004).**
- **Reverse/Void بدل حذف أي سجل مالي — منفّذ (ADR-0005، migration 024/031).**
- **كوكي الأدمن النحيف: الصلاحيات من `user_permissions` في كل طلب (ADR-0008).**
- Google: deferred. Password + session is the current path.
- File size: 200–300 target, 400 hard max; legacy exceptions listed in `docs/04-engineering-standards.md`.

---

## 11. Update Protocol

- غيّر قرارًا معماريًا → ADR + `docs/02` + هذا الملف.
- غيّر قاعدة مالية → `docs/01` + اختبارات + موافقة.
- غيّر صلاحية → `docs/03` + اختبارات سلبية.
- غيّر نشرًا → `docs/06`/`docs/11` + `docs/staging-environment.md` إذا لزم.
- أنهيت خطوة → Checkpoint + تحديث `docs/00-current-state.md` + `docs/17-master-plan.md` + `docs/OVERNIGHT-REPORT.md`.
- الخطة الثابتة هي `docs/17-master-plan.md`؛ لا تغيّر ترتيب المراحل بدون موافقة المالك.
- إذا شككت → توقف واسأل.
- رد بالعربية المصرية، مختصر وواضح.

---

## 12. Approved Master Plan (22 Nov 2026)

> ⏸️ **المسار 2.x موقوف مؤقتًا** بطلب المالك لإضافة مميزات جديدة. نقطة التوقف الكاملة + المتبقي + طريقة الاستئناف في `docs/00-current-state.md` §12.
> 🔧 **مسار التحصين (24–27 Nov) هو المسار النشط:** `docs/23-hardening-plan.md` + `docs/OVERNIGHT-REPORT.md` — والنشر هو الخطوة القادمة.
> ✅ **Meet 3.0–3.3b منفّذة ومنشورة** (ADR-0006/0007 + migrations 026/036/038). التوقف قبل 3.4 حتى قرار المالك.

الخطة الثابتة المعتمدة بترتيب المراحل والقرارات الملزمة في `docs/17-master-plan.md`:

1. **2.0** Docs Reset + القرارات.
2. **2.1** تأمين سكربتات النشر والنسخ الاحتياطي.
3. **2.2** التحقق 100% من منع تداخل المواعيد.
4. **2.3** Reverse/Void للسجلات المالية.
5. **2.4** تجاوب لوحة الإدارة 100% على الموبايل.
6. **2.5** CI/CD + Contract + اختبارات.
7. **2.6** الخزنة والإيرادات وتقفيل الشهر.
8. **2.7–2.9** أمان وتنظيف وجودة إطلاق.

المؤجل بقرار المالك: الإنجليزية، القيد المزدوج، مسير/قسائم الرواتب، خصومات/خطط رسوم، إيصالات مرقّمة، بوابة ولي الأمر، تطبيق الموبايل، منصة LiveKit.

---

## Current hardening state (Nov 2026)

- Repo `main` includes the hardening work: Tier 0/1، **Z1 splits مكتملة** (AuthEndpoints/SystemAdminEndpoints/Requests/MeetCalendarRepository/MeetBotJobRepository/teacherTypes/TeacherApp/useDarApplication)، Z2 server-authoritative money، Tier 2 (037/038/retention/2.15)، B7/ADR-0008، B10، UI fixes. Migration files are now **001→041** — 42 files, with 039 split into `039a_…` + `039b_…` (`database/` is the source of truth).
- Plan and decisions: [docs/23-hardening-plan.md](docs/23-hardening-plan.md)، [docs/OVERNIGHT-REPORT.md](docs/OVERNIGHT-REPORT.md)، [docs/03-security.md](docs/03-security.md).
- **Production is not the same as `main`:** no deploy was performed during the hardening sessions (production is `a823b32`/ledger 26). Check the deployed SHA/backups before claiming any production behaviour.
- **REMAINING:** Z2 audit-insert/permission dedup، Tier 3 (frontend/CSS/UI)، staging redeploy from `main`، production deploy + rollback rehearsal، E2E/contract (2.5-b). The live domain is configured only through `DAR_DOMAIN` in `deploy/.env` and must not be committed.
