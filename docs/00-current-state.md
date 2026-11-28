# RIGX Dar — Current State (Snapshot)

**Date:** 27 Nov 2026 (hardening batch).
**Rule:** هذا الملف هو **مصدر الحقيقة الواحد للحالة الحالية**. أي وثيقة تخالفه فهي إمّا هدف مستقبلي أو تاريخي. يتم تحديثه في نهاية كل مرحلة.
**Git:** `main` يحمل دفعات التحصين (Tier 0/1، Z1 splits، Z2، Tier 2، B7/B10/UI) حتى `4166fd0`+؛ سجل التنفيذ الكامل في `docs/OVERNIGHT-REPORT.md`.
**Production:** آخر نشر مسجل `a823b32` (deploy stamp `20261122-215854`، ledger **26/26**) — **لم يُنشر أي شيء من دفعات التحصين إلى الإنتاج بعد**.

---

## 1. ما هو المنتج

نظام إداري/مالي لدار تحفيظ قرآن (ليس منصة تعليمية): سكرتارية وطالبات وأولياء أمور ومعلمات، حلقات وجدول أسبوعي، حضور طالبات ومعلمات، أجر معلمات، اشتراكات ومدفوعات، خزنة ومصروفات، تقارير وصلاحيات ــ واجهة عربية RTL فقط حاليًا.

**الحيّ الآن:** https://<deployment-host>

---

## 2. الـStack الحقيقي (المعتمد نهائيًا)

| الطبقة | التقنية |
|---|---|
| الواجهة | **React 19 + Vite + TypeScript** + CSS tokens + framer-motion — **لا Next.js** (القرار ملغي نهائيًا، ADR-0001) |
| Backend (قديم) | ASP.NET Core 10 Minimal API — `backend/DarEltahfeez.Api` على 5080 (يخدم الـSPA + كل الـdomain APIs) |
| Backend (جديد) | `Dar.slnx`: `src/Host/Dar.Api` على 5081 — `/api/v1/*` (Identity + Secretariat + Teaching + Meet) |
| قاعدة البيانات | PostgreSQL 17 — `public` schema — **46 migration في المستودع (001→045؛ 039 مقسمة 039a/039b؛ 045 أحدث ملف)** |
| النشر | Ubuntu 24.04 + Nginx + Certbot + systemd + منافذ داخلية 5080/5081؛ staging منفصل على نفس الـhost (`docs/staging-environment.md`) |
| الاختبارات | backend unit + integration (Testcontainers) + 48 suite في `tests/run-regression.sh`؛ frontend **47 ملف / 155 اختبار Vitest** (Testing Library + jsdom) |
| اللغة | العربية فقط الآن — الإنجليزية مؤجلة (ADR-0004) |

---

## 3. المسارات الحيّة

| المسار | ماذا يخدم | المنفذ الداخلي |
|---|---|---|
| `/` | Homepage عامة | legacy 5080 |
| `/management` | لوحة الإدارة (SPA) | legacy 5080 |
| `/teacher` | بوابة المعلمة (PWA) | legacy 5080 (static) + `/api/v1/teacher/*` → 5081 |
| `/supervisor` | مساحة المشرفة | legacy 5080 (static) + `/api/v1/supervisor/*` → 5081 |
| `/api/v1/*` | API الجديد | 5081 |
| `/api/*` (غيره) | API القديم (كل الدومين + الإدارة) | 5080 |
| `/health/*` | فحوصات صحة (5080) | 5080 |

**ملاحظة:** كلا الـAPIs على نفس الـorigin عبر Nginx؛ الجلسات مختلفة: `DarEltahfeez.Admin` (legacy) و`dar_session` (new).

---

## 4. الكود — خريطة الملكية

| المجلد | المحتوى | ملاحظات |
|---|---|---|
| `backend/DarEltahfeez.Api/` | 77 ملف C# — 105 route mapping — كل الإدارة/المالية/الحضور/التقارير (partials بعد Z1) | لا يزال مصدر معظم الوظائف |
| `src/Host/Dar.Api/` + `src/Modules/*` | 128 ملف C# — Identity/Secretariat/Teaching/**Meet** — 82 route mapping | هوست جديد + وحدات؛ Meet = تقويم Google + أحداث + نطاق تسجيل (3.1) |
| `frontend/src/` | 180 ملف TS/TSX (82 ts + 98 tsx) — SPA واحدة تحمل admin + teacher + supervisor + home | admin: `App.tsx`/`SystemAdminView.tsx`/`pages/` + `meet/` — teacher/supervisor: `teacher/` |
| `database/` | 46 ملف SQL مرتّب + ledger في `web_schema_migrations` | legacy `schema_migrations` متوقف عند 16 |
| `tests/` | UnitTests + IntegrationTests (Testcontainers) + `tests/regression` (node/bash، 48 suite) | PowerShell runners/catalog **أُزيلت** |
| `deploy/` | Nginx/systemd/backup/setup/update scripts + `deploy/lib` (split قيد التنفيذ) | Docker/Caddy stack حُذف من الريبو (2.15) |
| `services/meet-recorder/` | بوت التسجيل (Node 24 + TypeScript) — 26 ملف src | خدمة `dar-meet-bot` + `dar-meet.slice` (3.2) |
| `.opencode/` | 157 ملف skills للوكلاء | يُنقل خارج الريبو في التنظيف (2.8) |

---

## 5. الوضع المالي الفعلي (بعد قرارات 22 Nov)

- **استحقاق الطالبة:** `agreed_monthly_fee` المسجّل وقت الالتحاق — **لا pro-rata**، ولا تقريب لأقرب 5 جنيه.
- **أجر المعلمة:** `hourly_rate_snapshot × payable_duration_minutes ÷ 60`، منزلتان عشريتان AwayFromZero — **لا تقريب 5 دقائق/5 جنيه**. القابل للدفع = scheduled عند بلوغ المدة، و= actual عند الانصراف المبكر؛ **صفر دقيقة فعلية = صفر أجر (لا حد أدنى دقيقة — تعديل المالك 27 Nov 2026)**؛ الوقت الإضافي يُسجّل ولا يُدفع آليًا. المبالغ المخزنة/المعتمدة سابقًا في الإنتاج **لم يُعَد حسابها** بهذا التعديل.
- **الإلغاء/البديلة/التأخير/التعويض:** غير منفّذة — قواعد مؤجلة تحتاج قرار مالك.
- **الحذف المالي:** ممنوع — **Reverse/Void منفّذ (Phase 2.3، migration 024، ADR-0005)**: `voided_at/by/reason` على الاستحقاقات والدفعات + `finance.void` + Audit + استبعاد الملغي من كل المجاميع مع بقائه ظاهرًا في سجل الطالب. نقل السجلات المالية للـtrash ممنوع (409).
- **الخزنة:** مصروفات + دفعات/استحقاقات فقط حاليًا؛ الإيرادات وتقفيل الشهر يُنفّذان في Phase 2.6. لا قيد مزدوج (مؤجل).
- **الإيصالات:** لا receipt_no متسلسل بعد (backlog).

---

## 6. الصلاحيات والأدوار الحالية

- `user_permissions` مسطّحة (لا أدوار مستخدمة فعليًا) + role templates seed.
- كتالوج الصلاحيات مكرر في **4 مصادر**: `backend/.../Security.cs`، `src/Common/Dar.Common/Domain/PermissionCodes.cs`، seed في `database/017`/`018`/`026`/`027` (**`meet.bot.control` أُضيف في Tier 1**)، و`frontend/src/domain/permissions.ts`.
- Scopes: `app_user_scopes` (circle/teacher) — لا صفوف = الكل. تطبَّق أيضًا على بيانات Meet (`MeetAccessScope`).
- المالية مخفية تمامًا بدون `finance.read` (UI + API).
- **Meet (3.1):** `meet.view` / `meet.manage` / `meet.calendar.manage` / `meet.media.view` / `meet.media.delete` — المالك/الأدمن (users.manage) يأخذ الخمسة، المشرفة تأخذ view + media.view قابلة للسحب.

---

## 7. الاختبارات والبناء (آخر تحقق فعلي — 27 Nov 2026)

| البند | الحالة |
|---|---|
| **dotnet build** (legacy + Dar.slnx) | ✅ 0 warnings / 0 errors (بالأعلام الآمنة -m:1 -nodeReuse:false) |
| **TypeScript** (frontend tsc -b + api-client) | ✅ 0 errors (`npm run typecheck`) |
| **Unit/Integration .NET** | ✅ عبر CI و`tests/run-regression.sh`؛ `dotnet test` المحلي قد يُحجب (testhost `Win32Exception 5`) وTestcontainers يحتاج Docker — CI هو الحكم |
| **Frontend tests** | ✅ **47 ملف / 155 اختبارًا** (Vitest + Testing Library + jsdom) عبر `npm test` |
| **Full regression harness** | `tests/run-regression.sh` — **48 suite** + UNIT؛ أحدث `UNIT/SUITES/PASS` + SHA في `docs/OVERNIGHT-REPORT.md` |
| **Overlap protection** | ✅ 45/45 + تحصين 025 (17/17) + migration 012 |
| **Vite build** | ✅ `npm run build` — dist مقسّمة chunks (lazy pages + manualChunks) |
| **bash -n لسكربتات النشر** | ✅ في CI؛ غير قابل للتنفيذ دائمًا محليًا (MSYS sandbox) |
| **GitHub Actions** | ⚠️ لم يُتحقق من أول تشغيل فعلي بعد |
| **E2E / Contract** | ❌ غير موجودة (2.5-b) |

## 8. الوثائق — ترتيب المرجعية

1. `docs/00-current-state.md` (هذا الملف) — الحالة الآن.
2. `docs/17-master-plan.md` — **الخطة الثابتة المعتمدة** وترتيب المراحل.
3. `docs/23-hardening-plan.md` + `docs/OVERNIGHT-REPORT.md` — خطة التحصين وسجل تنفيذها.
4. `docs/WORKFLOW.md` — Process Safety وقواعد التشغيل/النشر.
5. `docs/01-business.md` → `02-architecture` → `03-security` → `04-engineering-standards` → `06-operations` → `08-testing` → `11-deployment` → `staging-environment`.
6. `docs/adr/*` — القرارات المعمارية والمالية الملزمة (الفهرس: `docs/adr/README.md`).
7. `docs/checkpoints/*` — سجل خطوة بخطوة. `docs/07-gap-audit.md` و`docs/10-code-review.md` **سجلات تاريخية** (15–16 Nov 2026) وليست قائمة مهام.
8. `docs/16`, `docs/13`, `docs/14`, `docs/15` — مراجع نطاق ومتطلبات؛ `docs/24`/`docs/25` تخطيط مستقبلي (بلا تنفيذ).

---

## 9. ما هو ناقص/مؤجل (27 Nov 2026)

**تم (حتى 27 Nov):** Docs Reset (2.0)؛ تأمين النشر/النسخ + healthcheck (2.1)؛ تداخل المواعيد 2.2؛ Reverse/Void 2.3؛ Responsive 2.4-a/b؛ CI/proxy 2.5-a؛ Meet 3.0–3.3 + 3.3b (منشورة على الإنتاج)؛ **التحصين:** Tier 0/1 (1.1–1.25 ما عدا BLOCKED)، Z1 splits، Z2 server-money، Tier 2 (037/038/retention/2.15)، B7/ADR-0008، B10، إصلاحات UI (B1/B2/B4/B5/B9/B11)، staging environment، docs sync.

**التالي بالترتيب:**
- **نشر دفعة التحصين إلى staging ثم الإنتاج** (بموافقة المالك) + rehearsal rollback.
- Z2 المتبقي: permission-helper dedup؛ audit-insert dedup قيد batch 2 (`AuditLogWriter` + `z2-audit-writer`) — يُعتمد Done في `docs/OVERNIGHT-REPORT.md` عند اكتماله.
- Tier 3 (frontend/CSS/UI) حسب `docs/23-hardening-plan.md`.
- 2.4-c (تلميع/طباعة/RTL نهائي) و2.5-b (contract/E2E/lint/deploy job).
- 2.6 الخزنة والإيرادات وتقفيل الشهر (بدون قيد مزدوج).
- 2.7 أمان وتشغيل: antiforgery، تقييد Cloudflare origin، rotation، monitoring/تنبيهات.
- 2.8 تنظيف: `.opencode` خارج الريبو، `SystemAdminView.tsx` (401)، إزالة `DatabaseInitializer` القديم.
- 2.9 جودة الإطلاق (E2E شامل، restore drill، load/pen، PDF sign-off، handover).

**مؤجل بقرار المالك:** الإنجليزية، القيد المزدوج، مسير/قسائم الرواتب، خصومات/خطط رسوم، إيصالات مرقّمة، بوابة ولي الأمر، تطبيق الموبايل (`docs/24`)، منصة LiveKit (`docs/22`/`docs/25`).

**NOT VERIFIED:** لا نشر لأي من دفعات التحصين؛ production timers/migrations 034→042/Google/Telegram/SMTP/recorder لم تُجرّب إنتاجيًا — التفاصيل في `docs/OVERNIGHT-REPORT.md`.

## 10. قواعد ثابتة

- كل مرحلة = كود + tests + توثيق + checkpoint + commit (وثيقة deepseek).
- لا حذف لتاريخ مالي/حضور — Reverse/Void فقط.
- لا أسرار في الريبو/الوثائق/اللوجات.
- المال decimal ونسبيًا لا float؛ الأرقام المالية من الخادم فقط.
- الصلاحيات تُفحص على الخادم دائمًا.
- أي قرار عمل جديد = ADR + تحديث `docs/00` + `docs/17`.

---

## 11. سجل تاريخي — تحديثات 22 Nov 2026

> ⚠️ هذا سجل تاريخي (قبل دفعات التحصين) — محفوظ للمرجعية. الحالة الحالية في أعلى الملف + §12 + `docs/OVERNIGHT-REPORT.md`.

- **Phase 3.2 — بوت التسجيل (deploy `20261122-234642`، commits `db0beda` + `8c98b13`):** خدمة `dar-meet-bot` تعمل في `dar-meet.slice` (MemoryMax=3G، CPUQuota=180%) — Xvfb + PulseAudio تابعة + FFmpeg ينتجان MP4(faststart) + HLS + poster + SHA-256، وطابور claim/heartbeat/status عبر `/internal/meet` محمي بتوكن خدمة (لا يصل من الإنترنت). **Self-test 30s على الإنتاج: MP4 513KB، 7 مقاطع HLS، poster حقيقي**. التفاصيل: `docs/checkpoints/3.2-meet-bot-1.0.md`، التشغيل: `docs/19` §10.
- **نشر 3.0/3.1 على الإنتاج (deploy `20261122-215854`، commit `a823b32`):** نسخة DB قبلية مُتحقَّقة + migrations **024/025/026** (ledger 26/26) + بناء جديد + تبديل + smoke كامل (200 لكل المسارات). Meet endpoints تعمل و**401** بدون جلسة، 8 جداول `meet_*`، 5 صلاحيات، وbackfill (view=3، media.view=3، manage/calendar/delete=1). أُبطلت جلسات الإدارة مرة واحدة (ADR-0006). التفاصيل: `docs/checkpoints/3.1-meet-deploy-1.0.md`.
- **مساحة السيرفر:** `docker builder prune` استرجع **65.93GB** (build cache فقط) → 87G متاحة بدل 26G، بلا مساس بأي container/image/volume أو مشاريع أخرى.
- **Phase 3.0/3.1 — Meet Calendar + Recording scope:** ADR-0006 (جسر جلسة الأدمن: Data Protection مشترك + `dar_admin_bridge`) + ADR-0007 (المعمارية) + migration **026** (`meet_calendar_accounts`/`meet_events`/`meet_event_links`/`meet_circle_settings`/`meet_bot_jobs`/`meet_sessions`/`meet_media_assets`/`meet_settings` + 5 صلاحيات + backfill) + وحدة `Dar.Modules.Meet` (OAuth offline، مزامنة incremental/full بـsyncToken، اقتراح وربط الحلقة، نطاق التسجيل، Audit) + واجهة **التسجيل والمحاضرات** في `/management`. لم يُنفّذ البوت بعد (3.2).
- **Phase 2.2-fix (تحصين التداخل):** migration 025 — advisory locks لكل معلمة + رفض غير READ COMMITTED + رسالة تكرار منفصلة + حفظ ذري للحلقة/المواعيد + PUT للموعد + اختبارات (17/17 + 45/45 PASS).
- **Phase 2.4-b (جداول/لمس):** ResponsiveTable (16 جدولًا → كروت <768px)، ConfirmSheet بدل 16 `window.confirm`، MonthPicker بدل 7 `type=month`، responsive-admin.css (44px، خطوط ≥14/12، تباين، حقول 16px، segmented filters). متبقٍ: 3 جداول SystemAdminView + QA بصري (2.4-c).
- **Phase 2.5-a (CI/proxy):** `npm run typecheck` + إصلاح Vite proxy (`/api/v1`→5081 قبل `/api`→5080) + CI: typecheck، migration-count dynamic، asserts لـVoid/التداخل، تشغيل SQL regression scripts، schema-drift للـapi-client. المتبقي: contract حقيقي/E2E/deploy job (2.5-b).

- **Phase 2.3 Reverse/Void:** منفّذة (migration 024 + دوال + endpoints + صلاحية finance.void + استبعاد الملغي من legacy وnew API + UI حوار/شارة + SQL verify 23/23 PASS).
- **Phase 2.4-a Responsive shell:** منفّذة (Drawer + Bottom Nav + viewport dvh + Modal bottom-sheet + إصلاح تسريب CSS + إزالة بقايا desktop من shell). 2.4-b/c متبقيتان.

- اعتماد المالك النهائي للقرارات D1–D8 وتثبيت الخطة في `docs/17-master-plan.md`.
- Docs Reset شامل (كل الوثائق المتعارضة صُححت؛ 05/07/10 صارت سجلات تاريخية).
- ADRs 0001–0005 مضافة.
- تأمين النشر: `update.sh` / `rollback.sh` / `preflight.sh` + setup scripts idempotent + backups بmanifest/SHA/TOC + healthcheck timer.
- التحقق من تداخل المواعيد: 45/45 PASS؛ ثغرات سباق/ذرية موثقة للإصلاح.
- تدقيق تجاوب لوحة الإدارة جاهز (398 سطر) لتنفيذ 2.4.
- Checkpoint: `docs/checkpoints/2.0-docs-reset-1.0.md`.

---

## 12. نقطة التوقف الحالية (27 Nov 2026) — Resume Here

> **الحالة:** دفعات التحصين مكتملة على `main` حتى `4166fd0`+ (Tier 0/1، Z1 splits، Z2، Tier 2، B7/ADR-0008، B10، إصلاحات UI B1/B2/B4/B5/B9/B11، staging، docs sync) — **لم تُنشر إلى الإنتاج**. نقطة الاستئناف: نشر الدفعة (staging ثم production بموافقة المالك) ثم استكمال Z2/Tier 3، وبعدها العودة للمسار 2.x (2.4-c/2.5-b/2.6) أو Meet 3.4 حسب قرار المالك. Meet 3.0–3.3 و3.3b ما زالت منشورة على الإنتاج.

### آخر commit/نشر
- **الإنتاج:** `a823b32` (deploy stamp `20261122-215854`، ledger **26/26**) — لم يُنشر أي commit من دفعات التحصين.
- **`main` (repo):** يشمل دفعات التحصين + docs؛ سجل الـcommits/SHAs في `docs/OVERNIGHT-REPORT.md`.
- **staging:** نُشرت نسخة أقدم (`eb2a0a4`) — إعادة نشر من `main` مطلوبة قبل اختبار إصلاحات UI الأخيرة (`docs/staging-environment.md`).

### المنجز (بالترتيب)
| المرحلة | الحالة | checkpoint / dump |
|---|---|---|
| 2.0 Docs Reset + قرارات المالك | ✅ | `docs/checkpoints/2.0-docs-reset-1.0.md` |
| 2.1 تأمين النشر/النسخ + healthcheck | ✅ (rollback rehearsal متبقٍ) | `2.0-docs-reset-1.0.md` |
| 2.2 تداخل المواعيد (45/45) + تحصين 025 (17/17) | ✅ | `2.2fix-2.4b-2.5a-1.0.md` |
| 2.3 Reverse/Void مالي (migration 024، SQL verify 23/23) | ✅ | `2.3-2.4a-void-responsive-1.0.md` |
| 2.4-a/b Responsive shell + جداول/لمس | ✅ (2.4-c متبقية) | `2.3-2.4a…` + `2.2fix…` |
| 2.5-a CI (typecheck/migration-count/SQL regression/schema drift) + Vite proxy | ✅ | `2.2fix-2.4b-2.5a-1.0.md` |
| 3.0–3.3 + 3.3b Meet (Calendar/Events/Bot/Join/audio-only) | ✅ منشورة على الإنتاج | `3.0-3.1…`, `3.1-meet-deploy…`, `3.2-meet-bot…`, `3.3-meet-join-recording…`, `3.3b-audio-only-mode…` |
| **التحصين Tier 0/1 + Z1 + Z2 + Tier 2** | ✅ على `main` — تفاصيل/RESIDUAL في `docs/OVERNIGHT-REPORT.md` | commits 24–27 Nov |
| **B7/ADR-0008 + B10 + إصلاحات UI** | ✅ على `main` (لا نشر) | `f750897`, `73780bf`, `32dbfa4` |
| **staging environment** | ✅ منشأ (نسخة قديمة — إعادة نشر مطلوبة) | `docs/staging-environment.md` |

### المتبقي بالترتيب
1. **نشر دفعة التحصين:** إعادة نشر staging من `main` → smoke + Golden Paths/UI → backup production → `sudo bash deploy/update.sh` → smoke سبع نقاط + مراقبة → rollback plan جاهز.
2. **Z2 المتبقي:** audit-insert dedup (29 copies) + permission-helper dedup + أي duplication متبقٍ.
3. **Tier 3:** frontend/CSS/UI المتبقي حسب `docs/23-hardening-plan.md`.
4. **2.4-c / 2.5-b:** تلميع/طباعة/RTL، contract test حقيقي، Playwright smoke، lint، deploy job.
5. **2.6 → 2.9:** الخزنة/الإقفال ثم الأمان/التنظيف/جودة الإطلاق.
6. **Meet:** 3.4 Drive + الحذف المحمي، 3.5 reaper/فحص جلسة، 3.6 media/SSE، 3.7 QA؛ 3.8 LiveKit مقترحة بانتظار المالك.

### Blockers/قيود معروفة
- **لا blocker للـgit:** الدفعات مدفوعة إلى `main`؛ أي push جديد يحتاج credentials كما في `docs/WORKFLOW.md` (لا force-push).
- **الإنتاج متأخر عن `main`** — النشر يحتاج موافقة المالك ونافذة + backup، وممنوع `git pull + restart` المباشر.
- **Google OAuth كان في Testing** (22 Nov) → التوكن ينتهي بعد 7 أيام؛ إن لم يُحدَّث الوضع، إعادة الربط مطلوبة قبل التسجيل الإنتاجي.
- **بيئة التحقق المحلية محدودة:** `dotnet test` (testhost `Win32Exception 5`)، Docker/Testcontainers، esbuild أحيانًا — الحكم CI أو جهاز غير مقيّد.
- **NOT VERIFIED:** كل ما لم يُنشر: production timers، migrations 034→042، retention الحقيقي، Google/Telegram/SMTP/recorder الحي.

### للاستئناف
1. اقرأ `docs/OVERNIGHT-REPORT.md` (FINAL continuation) + `docs/23-hardening-plan.md` ثم قرر نشر الدفعة.
2. staging: أعد النشر من `main`، اختبر UI flows (B1/B2/B4/B5/B9/B11) + B7/B10 cookie flows.
3. production: backup + `deploy/update.sh` + smoke سبع نقاط + راقب 24 ساعة.
4. بعد النشر: Z2 المتبقي / Tier 3، أو 3.4 إن قدّم المالك Meet.

---

> ⚠️ **سجل تاريخي (22–24 Nov 2026)** — الأقسام التالية محفوظة كمرجع تنفيذي قديم (Meet 3.x، نشر 22 Nov، P0/P1 fixes). ليست نقطة التوقف الحالية.

## 14. تحديث 23 Nov 2026 — تشخيص صوت البوت + مقترح منصة داخلية (Lead)

- **البوت منفّذ ويعمل إنتاجيًا** (3.0–3.3) لكن **الصوت يتقطع**؛ السبب المقاس (docs/21): بافر إخراج Chromium صغير + تزاحم CPU على سيرفر مشترك + FFmpeg يعيد الترميز. الإصلاحات خفّضت الانقطاع من 105 إلى 17/دقيقة وضياع النهاية من 16% إلى 0.7% — تحسّن لكن ليس نقيًا 100%.
- **الحلول المقترحة (docs/22 الجزء الثاني):**
  1. تخفيف فوري: دمج/نشر إصلاح بافر Chromium (الفرع `fix/chrome-audio-buffer`) + تنفيذ **BOT_RECORD_MODE=audio** (docs/21) + دراسة نقل البوت لـVPS منفصل.
  2. حل معماري: **منصة اجتماعات داخلية LiveKit** — تحليل مقارن + شبكة/TURN/Cloudflare + تسجيل Track Egress + 인증/ضيوف + خطة M0–M5 (~2–3 أسابيع MVP) + 16 خطرًا/معالجة + قرارات مطلوبة.
- **الخطة:** أُضيفت كـ**Phase 3.8 (مقترحة — بانتظار قرار المالك)** في `docs/17-master-plan.md`، وتفاصيلها في `docs/22-inhouse-meetings-design.md`.
- **قرار مرحلي مقترح:** تنفيذ وضع التسجيل الصوتي فقط كحل فوري (أخف بكثير: لا x264/x11grab) **بالتوازي** مع Spike محلي للمنصة (بلا مخاطرة على الإنتاج)، ثم القرار بعد Pilot.
- **حالة Git:** الفرع الحالي `fix/chrome-audio-buffer` (commit `3577b93` للإصلاح + توثيق)؛ `origin/main` = `2d9de50`؛ الـpush محجوب بيئيًا (GitHub write credentials) — المالك يدفع يدويًا عند الحاجة.

### 3.3b — وضع التسجيل الصوتي فقط (منفّذ ومنشور 23 Nov 2026)
- `BOT_RECORD_MODE=audio` على السيرفر: parecord فقط أثناء الحصة ثم تحويل AAC/MP4؛ **لا x264/x11grab ولا HLS/poster ولا بث حي**.
- الهدف: إزالة حمل الترميز (~54% core) عن سيرفر مشترك وحماية نقاء الصوت.
- سيلفتست إنتاجي: `{ ok: true, durationSeconds: 15.2 }`؛ الخدمة `active`؛ الحصص القادمة 15:19 و20:00 ستُسجَّل audio-only.
- التفاصيل + الرجوع: `docs/21` و`docs/19` و`docs/checkpoints/3.3b-audio-only-mode-1.0.md`.

### 24 Nov 2026 — تحسين إلحاق الطلاب الجماعي (طلب مالك)
- حوار إلحاق الطلاب بالحلقة أصبح يدعم: بحث، تحديد الكل/إلغاء، **رسوم متفق عليها لكل طالب** (افتراضي = سعر الحلقة)، سعر موحّد يُطبّق على المحددين، وإجمالي شهري.
- الـAPI: `POST /api/circle-enrollments/bulk` يقبل `students: [{studentId, agreedMonthlyFee}]` (مع توافق خلفي مع `studentIds`)، يتحقق من صلاحية `finance.edit` عند تمرير رسوم، يطبّق المعاملة ذريًا (jsonb_to_recordset + partial unique index)، ويسجل `feesSet` في الـaudit.
- build: legacy 0W/0E + tsc 0 errors. يحتاج نشر عبر `deploy/update.sh` (بدون migration).

### 24 Nov 2026 02:05 — نشر إلحاق الطلاب الجماعي على الإنتاج (يدوي عبر SSH)
- تم بناء نسخة الإنتاج يدويًا: clone من `/opt/dar` + تطبيق الملفات الثلاثة المعدّلة، ثم `npm run build` + `dotnet publish -c Release`، ثم نسخ DB backup إلى `/var/lib/dar/backups/db/predeploy-20261124-020527.dump`، وتبديل `/opt/dar/app/legacy` مع الاحتفاظ بـ`legacy.old.20261124-020527` للرجوع.
- الدليل: smoke محلي `/health/ready` و`/` و`/management` = 200، `POST /api/circle-enrollments/bulk` عبر أصل مطابق = 401 (route موجودة)، marker `bulk-fee-toolbar` في bundle، والموقع العام (https) = 200 للصفحات الثلاث. الخدمة active.
- ملاحظة مهمة: نسخة git في `/opt/dar` لم تتغير؛ الـcommit `3b11e46` يجب دفعه إلى origin ثم `deploy/update.sh` حتى لا تفقد التغيير في أول نشر قادم.

### 24 Nov 2026 02:09 — إصلاح عطل النسخ الاحتياطي خارج الموقع (offsite backup)
- **العطل:** `/var/lib/dar/rclone/rclone.conf` كان مملوكًا `root:dar 600` بينما خدمة النسخ تعمل بمستخدم `dar` → فشل قراءة الإعدادات، وفشل رفع النسخ إلى Google Drive منذ **18 Nov** (آخر نسخة خارجية ناجحة 2026-11-18 23:43). النسخ المحلية كانت تُنشأ لكن بلا offsite.
- **الإصلاح:** `chown dar:dar` + `chmod 600` للملف. تشغيل `dar-backup.service` يدويًا الآن انتهى **Result=success**، والنسخة `dar-20261124-020909.dump` ظهرت على Drive (`gdrive:dar-backups/dar/db/`). تايمر النسخ اليومي 02:30 يعمل.
- **Drive quota:** حوالي **5 TiB** إجمالي، المستخدم 1.5 GiB (Other 22 GiB) → مساحة الأرشفة السحابية المجانية وفيرة حاليًا.

### 24 Nov 2026 — نشر حوار إلحاق الطلاب الجماعي (يدوي SSH)
- نُشر على الإنتاج 02:05 عبر بناء clone من `/opt/dar` + الملفات المعدّلة، مع DB backup `/var/lib/dar/backups/db/predeploy-20261124-020527.dump` واحتفاظ `/opt/dar/app/legacy.old.20261124-020527`.
- Smoke: `/health/ready`, `/`, `/management` = 200، `POST /api/circle-enrollments/bulk` (Origin مطابق) = 401، marker الواجهة في bundle، والموقع العام https = 200.
- **تنبيه:** git في `/opt/dar` ما زال على `e88503a`؛ الـcommit `3b11e46` لازم يُدفع من عندك قبل أي `deploy/update.sh` قادم وإلا ضاع التغيير.

### 24 Nov 2026 04:35 — تحسين UI إلحاق الطلاب + نشر واجهة فقط
- `BulkEnrollmentDialog` أعيد تصميمه: تخطيط عمودين (قائمة + ملخص ثابت)، بحث أيقوني، «تحديد الكل»، شارة المحددات، رسوم لكل طالبة مع «ج.م» وحالة خطأ، سعر موحّد، إجمالي شهري، تعطيل الحفظ عند رسوم غير صالحة، وإخفاء أزرار المعاينة.
- نُشر على الإنتاج نسخ واجهة فقط إلى `/opt/dar/app/legacy/wwwroot` (بدون إعادة تشغيل خدمة، بدون backend/DB): نسخة احتياطية `wwwroot.bak.20261124-043451`، smoke 200 للصفحات الثلاث، وmarker `be-layout` موجود في الأصول.
- أوراق المراجعة (PDF) استُخرجت ونُقّشت: تؤكد تجاوز قفل المرتبات في مسار مراجعة الطلبات، ونطاق التسجيلات غير المقيّد، وخطأ `null` في ملاحظة التصحيح، وحذف outbox عند 4xx، وغياب security headers عن SPA، و`/api/students` بدون pagination. تصحيح واحد: كان يوجد rate limit **10/دقيقة لكل IP وقتها** على auth (لكن بلا قفل حساب/2FA) — صار لاحقًا 5/دقيقة + قفل تدريجي (P1-1).
- عطل النسخ الاحتياطي خارج الموقع (18→24 Nov) تم إصلاحه والتحقق منه اليوم (راجع البند أعلاه).

### 24 Nov 2026 — P0-1: قفل المرتبات في مسار مراجعة الطلبات (إصلاح + اختبار قبل/بعد)
- **الثغرة:** مسار اعتماد طلب تصحيح في `SupervisorRequestEndpoints.Review` يعدّل `teacher_attendance` و`teacher_sessions` (المدة/الأجر) بدون فحص `PayrollLock`، بينما `AdjustEndpoint` يفحصه. نفس الشيء لمسار إنهاء الحصة عند المعلمة (`SessionEndpoints`) الذي يُنشئ حضورًا وأجرًا.
- **الإصلاح:** حرس مركزي واحد `PayrollLock.CheckAsync` في `TeachingHelpers.cs` برسالة موحدة، ويُستدعى من: اعتماد طلب تصحيح، اعتماد غياب/إلغاء، إنهاء الحصة، والتعديل المباشر (ت unification). شهر مقفول → 409 دون أي تعديل.
- **اختبار جديد:** `tests/Dar.IntegrationTests/Payroll/PayrollLockReviewTests.cs` (يتطلب `DAR_TEST_DATABASE` لقاعدة disposable). قبل الإصلاح: الحالة المقفولة **FAIL** (Expected 409، Actual 200) والمفتوحة PASS. بعد الإصلاح: **PASS 2/2**.
- **تشغيل الاختبار:** قاعدة disposable `dar_p0_payroll_*` من schema-only dump للإنتاج + `dotnet test --filter PayrollLockReviewTests` على السيرفر (SQL حقيقي، لا Docker).
- **النشر:** `dar-api` فقط (لا legacy، لا frontend، لا migrations) مع نسخة احتياطية `api.old.*` + smoke. التفاصيل في البند التالي.

#### P0-1 شواهد التشغيل والنشر (24 Nov 05:04)
- **قبل الإصلاح** (على الكود الأصلي من `/opt/dar` + الاختبار الجديد): `Review_Correction_OnLockedMonth...` **FAIL** — `Assert.Equal` Expected 409 Actual 200؛ والحالة المفتوحة PASS. أي إعادة إنتاج للثغرة: اعتماد طلب تصحيح في شهر مقفول كان ينجح 200 ويعدّل الأجر.
- **بعد الإصلاح**: `dotnet test --filter PayrollLockReviewTests` → **Passed: 2 / Failed: 0**.
- **بيئة الاختبار:** قاعدة disposable `dar_p0_payroll_20261124050107` أُنشئت من `pg_dump -s -O -x <database>` (schema الإنتاج)، والاختبارات استخدمت `DAR_TEST_DATABASE`؛ بعد النجاح تم **إسقاط القاعدة والدور**.
- **النشر:** `dar-api` فقط: نسخة `/opt/dar/app/api.old.20261124-050456`، DB backup `/var/lib/dar/backups/db/predeploy-P0-20261124-050456.dump`، smoke: `health/ready`=200، `/api/v1/meet/sessions` غير مصرح=401، `/management`=200. لم تُنشر أي تغييرات legacy/frontend/migrations في هذا البند.

### 24 Nov 2026 — P0-1: تجهيز الاختبار الخارجي + عائق الـpush
- **قفل أكتوبر:** أُدخل `payroll_locks('2026-10-01', is_locked=TRUE)` بملاحظة «قفل اختباري P0-1 — سيُفتح بعد اختبار المالك» مع سطر audit (`payroll.lock`). قابل للفتح من واجهة الأدمن (المسير) أو بإسقاط الصف/تحديثه.
- **بيانات ZZ-TEST للاختبار:** معلمة/حلقة/موعد/حضور بتاريخ `2026-10-05` وطلب تصحيح معلّق (`attendance_requests.id = 23092146-42dd-41c4-a788-e21aa2f86d2c`, teacher code `ZZ-P0-T`). يتوقع عند اعتماده من صفحة الطلبات: **409** وعدم تغيّر المدة/الأجر. بعد الاختبار تُمسح هذه الصفوف (ZZ-P0-*).
- **push:** لا يمكن من بيئة الوكيل (HTTPS بلا credentials) ولا من السيرفر (مفتاح GitHub deploy للقراءة فقط: «key ... marked as read only»). GitHub `main = 2d9de50`، بينما `/opt/dar` HEAD = `e88503a` (أقدم). الـcommit الجاهز للدمج محفوظ كـpatch: `/var/lib/dar/patches/0001-fix-teaching-enforce-payroll-lock-on-correction-revi.patch` (16K). **أي `update.sh` قبل دفع/دمج الإصلاح في main سيعيد الكود بلا الإصلاح.**

### 24 Nov 2026 — باج جديد (backlog): تسريب جلسة الإدارة إلى بوابة المعلمة
- **السبب من الكود:** بوابة المعلمة و/management على نفس الأصل، ولهم كوكيز منفصلة: `DarEltahfeez.Admin` (legacy) و`dar_session` (new API). `AdminSessionBridge` يختار **كوكي الأدمن أولًا** لكل `/api/v1`، و`LogoutEndpoint` يوقّع خروج `AuthSession.Scheme` فقط — لذا خروج بوابة المعلمة لا يمسح كوكي الأدمن، وتظل البوابة ترى هوية الأدمن بلا `teacher_id`.
- **إصلاح مقترح (P1):** `logout` يوقّع خروج الكوكيز الاثنين، وبوابة المعلمة عند اكتشاف هوية إدارة تعرض «خروج جلسة الإدارة»؛ لاحقًا فصل scheme/سياسة للـteacher APIs عن admin bridge.

### 24 Nov 2026 05:33 — تم دفع الـcommits إلى GitHub
- أضاف المالك مفتاح `github_dar_push` كـ**deploy key مع write access**؛ تم الدفع عبر السيرفر (نقل bundle + مفتاح مؤقت ثم حذفه بعد الدفع).
- **`fix/chrome-audio-buffer`** و**`main`** تحركا fast-forward: `main = a59b217` (كان `2d9de50`). يشمل دفعة العمل كاملة: وضع الصوت فقط، LiveKit M0، إصلاح إلحاق الطلاب + UI، وتوثيق P0-1، و**إصلاح قفل المرتبات** `d43c89c`.
- بعد الدفع أصبح `deploy/update.sh` آمنًا من ناحية فقدان الإصلاح؛ `/opt/dar` نفسه ما زال عند `e88503a` حتى يتم `git pull`/تحديث الإنتاج.

### 24 Nov 2026 — P0-2: نطاق المشرفة على قائمة التسجيلات والتشغيل/التنزيل (إصلاح + اختبار قبل/بعد)
- **الثغرة:** `GET /api/v1/meet/sessions` و`GET /api/v1/meet/media/{id}` كانا يفحصان `meet.media.view` فقط؛ `MeetMediaRepository` كان يجيب كل الجلسات/الملفات بدون فلتر `MeetAccessScope` → مشرفة نطاق أ تقدر تسمع/تنزّل تسجيل حلقة ب بالـid المباشر.
- **الإصلاح:** `ListSessionsAsync`/`GetAssetAsync` يستقبلان `MeetAccessScope` ويطبقان `(@all OR s.circle_id = ANY(@circles))`؛ endpoints تحمّل النطاق من `MeetAccessScope.LoadAsync` (admin/بلا نطاق = All). **التسجيلات اليدوية بدون circle_id تبقى للأدمن فقط** (سياسة صريحة).
- **اختبار:** `tests/Dar.IntegrationTests/Meet/MeetMediaScopeTests.cs` (WebApplicationFactory + `DAR_TEST_DATABASE`). قبل الإصلاح: **2 Failed** — قائمة المشرفة 3 بدل 1 (Expected 1, Actual 3) و`GET media/{out-of-scope}` **200 بدل 404**؛ وبعد الإصلاح: **4/4 Passed** (القائمة/التشغيل داخل النطاق/الخارجي 404/الأدمن يدخل التسجيل اليدوي).
- **بيئة الاختبار:** قاعدة disposable `dar_p02_media_20261124054033` من schema-only dump للإنتاج؛ أُسقطت بعد الاختبار.
- **النشر (dar-api فقط):** backup `/var/lib/dar/backups/db/predeploy-P02-20261124-054226.dump`، rollback `/opt/dar/app/api.old.20261124-054226`، smoke: `health/ready`=200، `/api/v1/meet/sessions` غير مصرح=401، `/management`=200. لا legacy/frontend/migrations.
- **التالي:** P0-3 (الملاحظة الاختيارية الفاضية = 500) ثم P0-4 (outbox 4xx).

### 24 Nov 2026 — P0-3: الملاحظة الاختيارية الفاضية في اعتماد الطلب = 500 (إصلاح + اختبار قبل/بعد)
- **الثغرة:** في مسار اعتماد طلب التصحيح، `AddWithValue("note", (object?)proposedNote ?? DBNull.Value)` بدون نوع → `btrim(@note)` يفشل بـ**42P08: could not determine data type of parameter $3** → HTTP 500. نفس النمط في ملاحظة جلسة الغياب/الإلغاء و`review_note`.
- **الإصلاح:** تعريف كل ملاحظة اختيارية صراحةً بـ`NpgsqlParameter("note", NpgsqlDbType.Text)` في 4 مواضع (`SupervisorRequestEndpoints.cs`) — بدون تغيير سلوك القيم غير الفارغة.
- **اختبار:** `tests/Dar.IntegrationTests/Payroll/ReviewOptionalNoteTests.cs` — ثلاث حالات: note غائبة/null/فاضية، والشهر مفتوح. **قبل:** FAIL بـ`Npgsql.PostgresException 42P08` (Stack: SupervisorRequestEndpoints.cs:245). **بعد:** الثلاث حالات تنجح والاعتماد يطبق المدة/الأجر.
- **تأكيد عدم التراجع:** شغّلنا الثلاث مجموعات معًا بعد الإصلاح: `PayrollLockReviewTests` (2) + `MeetMediaScopeTests` (4) + `ReviewOptionalNoteTests` (1) = **7/7 Passed**.
- **النشر (dar-api فقط):** backup `/var/lib/dar/backups/db/predeploy-P03-20261124-060910.dump`، rollback `/opt/dar/app/api.old.20261124-060910`، smoke: `health/ready`=200، `/api/v1/meet/sessions` غير مصرح=401، `/management`=200. القاعدة المؤقتة أُسقطت.
- **التالي:** P0-4 — outbox الحضور الأوفلاين يمسح العملية على أي 4xx.

### 24 Nov 2026 — P0-3b: اعتماد طلب الغياب بدون ملاحظة (المسار القديم) = 500
- **السبب الجذري:** صفحة طلبات الأدمن في `/management` بتنادي **الـlegacy API** `/api/admin/requests/{id}/review`، مش الـAPI الجديد. إصلاح P0-3 (06:09) كان في `SupervisorRequestEndpoints` بالـAPI الجديد فقط، والـlegacy app المنشور كان مبنيًا منذ 02:05 فما كانش فيه أي إصلاح → 500 استمر.
- **الإصلاح:** في `backend/DarEltahfeez.Api/SystemAdminEndpoints.Requests.cs` عُرّفت 4 ملاحظات اختيارية بـ`NpgsqlParameter("note", NpgsqlDbType.Text)` (غياب/إلغاء، تصحيح حضور، تصحيح جلسة، review_note).
- **قبل/بعد E2E على قاعدة disposable:** النسخة الأصلية → `HTTP 500` مع `42P08: could not determine data type of parameter $1` في log؛ بعد الإصلاح → `HTTP 200` والطلب `approved` والحضور `absent`. واختبار شامل للنسخة **المنشورة فعليًا**: absence=200 (approved|absent)، correction=200 (30 دقيقة/30 ج.م).
- **تأكيد أن المنشور هو آخر بناء:** `DEPLOYED_LEGACY_SHA=40e000a323825d08ccaf8ba42a2ae56fdbea4c548f6990240191526231eeff83` (نفس DLL المبني من أحدث مصادر legacy)، `DEPLOYED_API_SHA=c9214ff995042cec0386242c1b0684c3205983c8d8c39b9726ac9e03cc558fad` (06:09، يشمل P0-1/2/3). الواجهة الحالية محفوظة (marker `be-layout` موجود)، والموقع العام 200.
- **النشر:** legacy فقط (preserve wwwroot): DB backup `predeploy-P03b-20261124-062941.dump`، backup `legacy.bak.20261124-062941`، smoke: `health/ready`/`/`/`/management`=200 ومسارات review/enrollment غير مصرحة=401.
- **متبقي:** دفع الـcommit على GitHub ثم retest المالك لاعتماد غياب بدون ملاحظة.

### 24 Nov 2026 — P0-4: outbox الحضور الأوفلاين كان بيمسح التسجيل على أي 4xx (إصلاح + اختبار قبل/بعد)
- **الثغرة:** `useTeacherOutbox` كان يحذف العملية من IndexedDB على أي `4xx` — بما فيها **401** (جلسة منتهية) و**429** (rate limit) و**409/422** (قرار مطلوب) — فتفقد المعلمة حضورًا محفوظًا بصمت. الطابور كان مفتاحه `sessionId` فقط بلا هوية مستخدم، فحساب آخر على نفس الجهاز قد يرسل طابور غيره.
- **الإصلاح:** سياسة واحدة `classifyOutboxFailure` في `outboxPolicy.ts`: **401** → يبقى لحين تسجيل الدخول، **408/425/429/5xx/شبكة** → إعادة بـexponential backoff (30ث→30د)، **400/403/404/409/422** → `needs-review` (يبقى + رسالة للمعلمة + زر إعادة محاولة). الطابور v2 (`attendance-queue`) مفتاحه `userId:sessionId` مع `attempts/lastError/needsReview`، ومخزن v1 **لا يُحذف عند الترقية**. الواجهة تعرض سبب الفشل وزر «إعادة المحاولة».
- **اختبار قبل/بعد:** `frontend/src/teacher/outboxPolicy.test.ts` ضد السلوك القديم: **3 failed / 2 passed** (401→delete بدل retry-after-login، 429→delete بدل retry، 4xx→delete بدل needs-review)؛ بعد الإصلاح: **5/5 Passed**. وبناء الواجهة + tsc ناجحان.
- **النشر (واجهة فقط إلى `/opt/dar/app/legacy/wwwroot`):** backup `wwwroot.bak.20261124-064547`، smoke: `/`و`/management`و`/teacher`=200، وعلامة P0-4 في الأصول المنشورة: `TeacherApp-BlkggQoD.css` SHA `abb7b912…` و`TeacherApp-D67FiKVM.js` SHA `bd772ca6…`.
- **ملاحظة سلوكية (سؤال المالك):** اعتماد طلب تصحيح على سجل حالته `absent` يعدّل المدة/الأجر ويترك الحالة `absent`؛ الـpayload (في `TeacherRequestEndpoints`) يحمل `status: present` لكن مساري المراجعة (legacy + new) يتجاهلان الحالة. يبدو **ثغرة منطقية** لا سلوكًا مقصودًا؛ مرشّح P0-5 بعد قرار المالك.

### 24 Nov 2026 — P0-5: اعتماد التصحيح يطبق الحالة مع المدة والأجر (المسارين)
- **السلوك الجديد:** `requested_payload.status` (present/absent/cancelled) يُطبَّق مع المدة والأجر في نفس الـtransaction. الحالة `present` فقط تُدفع؛ `absent`/`cancelled` → `payable_amount=0` و`payable_duration_minutes=NULL` (القيود تسمح NULL أو 1..360). الطلبات القديمة بدون status تحتفظ بالحالة الحالية (توافق خلفي). status غير صالح → 400. الشهر المقفول → 409 قبل أي تعديل.
- **الاختبار الجديد (API جديد):** `tests/Dar.IntegrationTests/Payroll/ReviewCorrectionStatusTests.cs` — قبل: **4 Failed / 1 Passed** (غياب→حاضر فضل absent، حاضر→غياب فضل present، status غير صالح رجع 200، شهر مقفول رجع 200)؛ بعد: **5/5 Passed**. المجموعة المجمعة P0-1/2/3/5 = **12/12 Passed**.
- **E2E للمسار القديم (legacy app + disposable DB):** قبل: A2P رجع 200 والحالة فضلت `absent|30|30`، P2A فضل `present|45|45`. بعد: A2P → `present|30|30`، P2A → `absent|45|0`، والشهر المقفول → **409** والحالة/المبلغ بدون تغيير والطلب `pending`.
- **النشر (الاثنان تأثروا):** dar-api وdar-legacy. البصمات المنشورة: `Dar.Api.dll = 6858541890945572dcac6c23194a9fe4ac4667aee1b8c4b7d26fb05673a9858e`، `DarEltahfeez.Api.dll = bee3fc273c1ee286996c5a8dc87d55d9e4fff474fe8f4241918c004d0f594e8f`. Backups: `api.old.20261124-070908` و`legacy.bak.20261124-070908`، DB `predeploy-P05-20261124-070908.dump`. Smoke: API health=200/meet=401، legacy `/`/`/management`/`/teacher`=200، review=401، والواجهة (t-outbox-retry) سليمة. الموقع العام 200 ولا أخطاء في اللوج.
- **التالي:** P0-6 (ترحيل outbox v1→v2) بعد تأكيد المالك الخارجي لـP0-5.

### 24 Nov 2026 — P0-6: ترحيل حضور outbox من v1 إلى v2/v3 (منشور، **مؤكد خارجيًا**)
- **المشكلة:** مخزن IndexedDB v1 (`attendance` بمفتاح sessionId) كان متجاهلًا بعد P0-4 لأن الكود يقرأ v2 فقط؛ سجلات قديمة لا تُرسل ولا تُعرض (لكنها لا تُمحى).
- **الإصلاح:** DB v3 — عند الترقية تُنسخ سجلات v1 إلى `attendance-queue` كسجلات `userId='__legacy__'` و`needsReview=true`، **بدون إرسال تلقائي**، ومخزن v1 **لا يُمسح**. الـhook يعرض عدد legacy في الـbanner وزر «نقل إلى حسابي» (claim صريح) ثم flush. أي جهاز مشترك لا يرسل طابور حساب لحساب آخر.
- **الملفات:** `offlineOutbox.ts` (v3 + migration + claim)، `useTeacherOutbox.ts`، `TeacherApp.tsx`، `calendar-history.css`، `package.json`+lock (`fake-indexeddb` dev فقط)، واختبارات `offlineOutbox.migration.test.ts` + `offlineOutbox.legacy.test.ts`.
- **الاختبار:** قبل (كود v2): migration test **FAIL** (queue=0 بدل 2). بعد: **3/3 اختبارات Passed** (migration + legacy claim) و`tsc` ناجح. ملاحظة: أول محاولة اختبار أثناء النشر فشلت لأسباب بيئة (ملف log غير قابل للكتابة، npm install فشل) وليست فشل كود؛ أُعيد التشغيل كـdeploy user في 07:42:23 ونجح على نفس commit `64b9532`.
- **النشر (واجهة فقط):** بدأ 2026-11-24 **07:40:33**، backup `wwwroot.bak.20261124-074033`، smoke محلي/عام `/`و`/management`و`/teacher`=200. الأصول المنشورة تحتوي `__legacy__` و«نقل إلى حسابي»: `TeacherApp-CGuzh9Ne.js` SHA `3645678b81e92d1b158312605c46f3dc84f9d69dce1fe69137beba6ce53ce57d`، وCSS `TeacherApp-C8Xn83in.css` SHA `d2e661324804584f2666692fb1b3ba9fff3855efba8ee6ef0887bf65f6ae879e`، و`index-BIZeKr29.js` SHA `5ecf4f78f1364a942c32010d20225381fd8395c8c1fd2b936d51cb513d75ad65`.
- **الرجوع:** استعادة `wwwroot.bak.20261124-074033` — آمن: الترحيل إضافي وv1 لم يُمسح.
- **تحقق إضافي على متصفح حقيقي (headless Chromium ضد الموقع الحي):** زرع سجل v1 ثم فتح `/teacher` → ترقية القاعدة إلى **v3**، ونُسخ السجل إلى `attendance-queue` كـ`userId=__legacy__`/`needsReview=true` مع بقاء v1 (1 صف). واختبار `claim` في متصفح حقيقي (harness على نفس الوحدة): `legacyBefore=1, claimed=1, legacyAfter=0, queueMine(user-real, needsReview=false)=1, queueOther=0, v1Rows=1`.
- **ما زال غير متحقق:** نقر زر «نقل إلى حسابي» من واجهة React بعد تسجيل دخول معلمة (UI wiring) — هذا الجزء فقط.
- **التأكيد الخارجي:** المالك أكد نجاح الاختبار الخارجي لـP0-6 في 24 Nov 2026 → **P0-6 Done**.

### 24 Nov 2026 — P1-1 المرحلة 1: قفل دخول تدريجي + IP حقيقي ورا Cloudflare (منشور، **غير مكتمل: Turnstile مؤجل**)
- **المشكلة:** مساري الدخول `/api/auth/login` و`/api/v1/auth/password` كانا محميين بحد IP فقط (10/دقيقة)، بدون تتبّع محاولات لكل حساب. `is_locked` اليدوي فقط. ولا قفل تدريجي.
- **الإصلاح:** migration `029_login_lockout.sql` (أعمدة إضافية على `app_users`: `failed_login_attempts`, `login_locked_until`, `last_failed_login_at`)؛ قفل تدريجي لكل حساب بعد **5 محاولات**: 30ث ثم تصاعد حتى 15د، مع `429 + Retry-After` ورسالة عربية؛ تصفير عند النجاح؛ `is_locked` اليدوي منفصل. حد IP صار 5/دقيقة (قابل للضبط `Auth__RateLimit__PermitLimit`) في الاثنين. لا frontend في هذه المرحلة.
- **الملفات:** migration 029؛ `backend/DarEltahfeez.Api/{AuthEndpoints,Program,LoginLockoutPolicy}.cs`؛ `src/Common/Dar.Common/Domain/AppException.cs` + `AppExceptionHandler.cs`؛ `src/Host/Dar.Api/Program.cs`؛ Identity (`AuthUser`, `IIdentityRepository`, `IdentityRepository`, `PasswordSignIn`, `LoginLockoutPolicy`)؛ اختبار `tests/Dar.IntegrationTests/Identity/LoginLockoutTests.cs`؛ Nginx `/etc/nginx/conf.d/00-dar-cloudflare-realip.conf`.
- **اختبار قبل/بعد (new API، قاعدة disposable):** قبل: **Failed 2 / Passed 1** (المحاولة الخامسة 401). بعد إصلاح تحويل timestamptz: **3/3 Passed**. (بدون `DAR_TEST_DATABASE` الاختبارات تُرجِع early-return — انظر الباك لوج).
- **اختبار E2E للـlegacy (disposable DB):** قبل: 5 محاولات خاطئة → كلها 401 والحالة `0|NULL` (لا قفل). بعد: الخامسة **429 / Retry-After: 30**؛ كلمة المرور الصحيحة أثناء القفل **429**؛ الحساب B سليم ويسجّل 200 (`0|NULL`)؛ بعد انتهاء القفل دخول 200 وتصفير `0|NULL`. **تأكيد عدم قفل حساب آخر:** B بقي 0/NULL وسجّل بنجاح أثناء قفل A.
- **تحقق IP الحقيقي ورا proxy:** (1) فعّلت `real_ip_header CF-Connecting-IP` مع كل نطاقات Cloudflare في Nginx (لا يثق إلا بأقران Cloudflare). (2) طلب عبر الويب الحي من harness egress `203.0.113.10` ظهر **بنفسه** كأول حقل في `/var/log/nginx/access.log` وليس IP حافة Cloudflare. (3) اختبار التطبيق: 6 طلبات دخول بـ`X-Forwarded-For: 203.0.113.21` → السادس **429**، وطلب بـ`203.0.113.22` → **401** (تقسيم الحد حسب الـIP الحقيقي من proxy الموثوق loopback).
- **النشر:** بدأ 2026-11-24 **08:39:39** (EET)، الخدمات Active من **08:39:56**. Backup كامل قبل الهجرة: `/var/lib/dar/backups/db/predeploy-P11-20261124-083939.dump` (265K). migration ledger=29 والأعمدة الثلاثة موجودة. بصمات المنشور: `Dar.Api.dll = d6b7140f51e56829995b60f0dcf51ea9f4dfb63611c0ec464102806d14a7420a`، `DarEltahfeez.Api.dll = 798cffa22f4dbfb12fe5e5efa7e5810c5e963b85a57bff1975a1c31def2d57c6`. Smoke: API health 200/meet 401، legacy `/`و`/management`و`/teacher`=200، review=401؛ الموقع العام 200. Backups: `api.old.20261124-083939` و`legacy.bak.20261124-083939`.
- **الرجوع:** استعادة مجلدات API/legacy من backups؛ الأعمدة الإضافية يمكن تركها (الكود القديم يتجاهلها)؛ Nginx: حذف ملف real-ip وإعادة التحميل. **قابل للرجوع نعم.**
- **Turnstile (المرحلة 2):** مؤجل حتى تتوفر مفاتيح Cloudflare Site/Secret Keys. **P1-1 ليس Done** — يلزم Turnstile + تأكيد خارجي.

### باك لوج صغير بعد P1-1 (من مراجعة P0 المستقلة)
1. **قفل مرتبات شهر:** سباق ضيق بين قفل الشهر وتعديل/اعتماد في نفس اللحظة — إضافة advisory lock/صف معاملة عند القفل والاعتماد.
2. **صلاحية «التسجيلات» بدون نطاق:** حساب عنده الصلاحية بدون scope يرى كل التسجيلات — تقرير: منع/تحديد نطاق افتراضي.






### 24 Nov 2026 — P1-2: عزل جلسة بوابة المعلمة عن جلسة الأدمن بنفس المتصفح (منشور، غير Done)
- المشكلة: الـnew API كان يفحص كوكي الأدمن DarEltahfeez.Admin أولًا لكل /api/v1، فبوابة المعلمة ترى هوية الأدمن لما الكوكيان موجودين، وlogout المعلمة لا يمسح كوكي الأدمن.
- الحل: header اختياري X-Dar-Portal: teacher من كل طلبات بوابة المعلمة. DarSessionHandler لو الـheader موجود يستخدم dar_session فقط ولا يرجع لكوكي الأدمن؛ بدون header السلوك القديم كما هو (admin أولًا ثم teacher fallback) لحماية مسارات الأدمن المقصودة مثل /api/v1/supervisor/scopes و/notifications.
- تغطية الـheader: كل طلبات teacherApi تضيفه مركزيًا. لا يوجد fetch مباشر آخر في frontend/src/teacher (تم التحقق). outbox الحضور يستخدم teacherApi.submit (لا fetch مباشر). service worker يتخطى /api/ صراحة ولا يعترضها، فالطلبات تمر عبر teacherApi حاملة الـheader. الأصول المنشورة تحتوي X-Dar-Portal، وsw.js المنشور يحتوي تخطي /api/.
- شرح النسخة القديمة: الواجهة القديمة (بدون header) تظل تعمل بنفس السلوك السابق؛ لا 401/500 جديد. مع جلسة معلمة فقط تعمل عبر fallback، ومع أدمن+معلمة تبقى المشكلة القديمة (رؤية الأدمن) حتى تحديث الصفحة/الأصول. الواجهة الجديدة قبل نشر الـAPI القديم: الـAPI يتجاهل header ويستخدم السلوك القديم، فلا كسر. النشر كان API ثم الواجهة مباشرة، والأصول محفوظة بـhashes وsw network-first.
- اختبارات قبل/بعد على DB disposable وZZ-TEST، بمتصفح/كوكيز أدمن ومعلمة معًا:
  - قبل (b388ebf): WITH_HEADER_ME=p12_admin، NO_HEADER_ME=p12_admin، scopes with header=200.
  - بعد (b7b00e1): WITH_HEADER_ME=p12_teacher، NO_HEADER_ME=p12_admin، SCOPES_NO_HEADER=200، SCOPES_WITH_HEADER=403، teacher logout=200 ثم ME_HEADER=401 وLEGACY_ME=200، admin-only + header=401.
  - نفس السيناريو أُعيد على الباينريات/الأصول المنشورة فعليًا: نفس النتائج (deployed asset header=yes، deployed sw bypass=yes).
  - frontend tests: 4/4 Passed (teacherApi header + SW bypass + outbox coverage). ملاحظة: أول تشغيل فشل بسبب عيب في الـmock نفسه (Response معاد استخدامه: Body already read)؛ أُصلح في commit 34b4146 (test فقط، بدون تغيير كود إنتاج).
- النشر: API فقط + واجهة. commit الكود b7b00e1 (بعد test fix 34b4146). Backup DB /var/lib/dar/backups/db/predeploy-P12-20261124-125145.dump (270K)، API backup /opt/dar/app/api.old.20261124-125145، frontend backup /opt/dar/app/legacy/wwwroot.bak.20261124-125145. بدأ 12:51:45 والخدمات Active 12:52:42. بصمات: Dar.Api.dll=e96a3057cec8fe7aab2b5928a271d91e00497066f7a261f39d75b3b7052582ef، legacy DLL بلا تغيير 75210b1541d6018a3ac9d8c2eb055b13ac12bf3fa8926aa05bea2c5714de0c0a، TeacherApp-BoIQkPNg.js=df0c4704ac92a19016ee3cdf885ec3a913df89f0fc48c0a6c977df3b22243aad. legacy DLL/DB/Nginx/legacy env لم تتغير. smoke: API health 200، legacy health 200، الصفحات العامة 200، MGMT Turnstile enabled=true، TEACHER Turnstile enabled=false.
- الرجوع: استعادة /opt/dar/app/api.old.20261124-125145 إلى api، وwwwroot.bak.20261124-125145 إلى wwwroot، ثم restart dar-api/dar-legacy. لا آثار DB.
- غير متحقق: اختبار المالك الخارجي على متصفح حقيقي بحساب ZZ-TEST؛ الاختبارات هنا على disposable DB وباينريات منشورة. P1-2 ليس Done.

