# RIGX Dar — Current State (Snapshot)

**Date:** 22 Nov 2026
**Rule:** هذا الملف هو **مصدر الحقيقة الواحد للحالة الحالية**. أي وثيقة تخالفه فهي إمّا هدف مستقبلي أو تاريخي. يتم تحديثه في نهاية كل مرحلة.
**آخر Commit على `origin/main` ومُنشور:** `a823b32` (deploy stamp `20261122-215854`). التحديثات المحلية اللاحقة (docs + إصلاح update.sh) تنتظر push المالك.

---

## 1. ما هو المنتج

نظام إداري/مالي لدار تحفيظ قرآن (ليس منصة تعليمية): سكرتارية وطالبات وأولياء أمور ومعلمات، حلقات وجدول أسبوعي، حضور طالبات ومعلمات، أجر معلمات، اشتراكات ومدفوعات، خزنة ومصروفات، تقارير وصلاحيات ــ واجهة عربية RTL فقط حاليًا.

**الحيّ الآن:** https://dar-elemam-hafs.rigxhardware.com

---

## 2. الـStack الحقيقي (المعتمد نهائيًا)

| الطبقة | التقنية |
|---|---|
| الواجهة | **React 19 + Vite + TypeScript** + CSS tokens + framer-motion — **لا Next.js** (القرار ملغي نهائيًا، ADR-0001) |
| Backend (قديم) | ASP.NET Core 10 Minimal API — `backend/DarEltahfeez.Api` على 5080 (يخدم الـSPA + كل الـdomain APIs) |
| Backend (جديد) | `Dar.slnx`: `src/Host/Dar.Api` على 5081 — `/api/v1/*` (Identity + Secretariat + Teaching فقط) |
| قاعدة البيانات | PostgreSQL 17 — `public` schema — **26 migration في المستودع (001→026)**؛ **الإنتاج على 26/26** (نُشرت 024 Void + 025 تحصين + 026 Meet في 22 Nov) |
| النشر | Ubuntu 24.04 + Nginx + Certbot + systemd + منافذ داخلية 5080/5081 |
| الاختبارات | 16 unit سابقة + **22 unit جديدة لـMeet** + 20 integration (Testcontainers) + 6 Vitest |
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
| `backend/DarEltahfeez.Api/` | 33 ملف C# — 91 endpoint — كل الإدارة/المالية/الحضور/التقارير | لا يزال مصدر معظم الوظائف |
| `src/Host/Dar.Api/` + `src/Modules/*` | 94 ملف C# — Identity/Secretariat/Teaching/**Meet** (+12 endpoint) | هوست جديد + وحدات؛ Meet = تقويم Google + أحداث + نطاق تسجيل (3.1) |
| `frontend/src/` | 120 ملف TS/TSX — SPA واحدة تحمل admin + teacher + supervisor + home | admin: `App.tsx`/`SystemAdminView.tsx`/`pages/` + `meet/` — teacher/supervisor: `teacher/` |
| `database/` | 23 ملف SQL مرتّب + ledger في `web_schema_migrations` | legacy `schema_migrations` متوقف عند 16 |
| `tests/` | UnitTests + IntegrationTests (Testcontainers) + regression قديمة + 36 runner قديم | 11 runner يشير لـTestCenter المؤرشف |
| `deploy/` | Nginx/systemd/backup/setup scripts + Docker stack قديم (متقاعد) | يُعاد تأمينها في Phase 2.1 |
| `services/meet-recorder/` | بوت التسجيل (Node 24 + TypeScript) — 17 ملفًا | خدمة `dar-meet-bot` + `dar-meet.slice` (3.2) |
| `tools/` + `desktop-host/` | أدوات Windows قديمة + WPF/WebView2 | حطام مطلوب تنظيفه (Phase 2.9) |
| `.opencode/` | 204 ملف skills للوكلاء (5.2MB) | يُنقل خارج الريبو في التنظيف |

---

## 5. الوضع المالي الفعلي (بعد قرارات 22 Nov)

- **استحقاق الطالبة:** `agreed_monthly_fee` المسجّل وقت الالتحاق — **لا pro-rata**، ولا تقريب لأقرب 5 جنيه.
- **أجر المعلمة:** `hourly_rate_snapshot × payable_duration_minutes ÷ 60`، منزلتان عشريتان AwayFromZero — **لا تقريب 5 دقائق/5 جنيه**. القابل للدفع = scheduled عند بلوغ المدة، و= actual (بحد أدنى دقيقة) عند الانصراف المبكر؛ الوقت الإضافي يُسجّل ولا يُدفع آليًا.
- **الإلغاء/البديلة/التأخير/التعويض:** غير منفّذة — قواعد مؤجلة تحتاج قرار مالك.
- **الحذف المالي:** ممنوع — **Reverse/Void منفّذ (Phase 2.3، migration 024، ADR-0005)**: `voided_at/by/reason` على الاستحقاقات والدفعات + `finance.void` + Audit + استبعاد الملغي من كل المجاميع مع بقائه ظاهرًا في سجل الطالب. نقل السجلات المالية للـtrash ممنوع (409).
- **الخزنة:** مصروفات + دفعات/استحقاقات فقط حاليًا؛ الإيرادات وتقفيل الشهر يُنفّذان في Phase 2.6. لا قيد مزدوج (مؤجل).
- **الإيصالات:** لا receipt_no متسلسل بعد (backlog).

---

## 6. الصلاحيات والأدوار الحالية

- `user_permissions` مسطّحة (لا أدوار مستخدمة فعليًا) + role templates seed.
- كتالوج الصلاحيات مكرر في **4 مصادر**: `backend/.../Security.cs`، `src/Common/Dar.Common/Domain/PermissionCodes.cs`، seed في `database/017`/`018`/**`026`**، و`frontend/src/domain/permissions.ts`.
- Scopes: `app_user_scopes` (circle/teacher) — لا صفوف = الكل. تطبَّق أيضًا على بيانات Meet (`MeetAccessScope`).
- المالية مخفية تمامًا بدون `finance.read` (UI + API).
- **Meet (3.1):** `meet.view` / `meet.manage` / `meet.calendar.manage` / `meet.media.view` / `meet.media.delete` — المالك/الأدمن (users.manage) يأخذ الخمسة، المشرفة تأخذ view + media.view قابلة للسحب.

---

## 7. الاختبارات والبناء (آخر تحقق فعلي — 22 Nov 2026)

| البند | الحالة |
|---|---|
| **dotnet build** (legacy + Dar.slnx) | ✅ 0 warnings / 0 errors (بالأعلام الآمنة -m:1 -nodeReuse:false) |
| **TypeScript** (frontend tsc -b + api-client) | ✅ 0 errors |
| **Unit tests** | ✅ **38/38** (16 سابقة + 22 Meet) عبر reflection runner — `dotnet test` نفسه محجوب محليًا (testhost: `Win32Exception 5` على العملية الأب)؛ CI هو الحكم |
| **Integration بلا DB** | ✅ 6/6 (Health + SameOrigin) |
| **Integration بـDB (14)** | ⏭️ تحتاج Docker/Testcontainers — غير متاحة في الساندبوكس المحلي |
| **Overlap protection** | ✅ 45/45 + 3360 نقطة (012)؛ تحصين 025: 17/17 PASS + اختبار تزامن Testcontainers للـCI |
| **Vite build** | ✅ البناء الإنتاجي نجح (2096 module) بعد توجيه `TMP/TEMP` داخل مساحة العمل؛ تحذير حجم chunk قائم مسبقًا. Vitest يبقى في CI |
| **bash -n لسكربتات النشر** | ⚠️ غير قابل للتنفيذ محليًا (MSYS sandbox) — بديل shfmt + فحص بنيوي؛ الحكم في CI |
| **GitHub Actions** | ⚠️ لم يُتحقق من أول تشغيل فعلي بعد |
| **E2E / Contract** | ❌ غير موجودة (Phase 2.5) |

## 8. الوثائق — ترتيب المرجعية

1. `docs/00-current-state.md` (هذا الملف) — الحالة الآن.
2. `docs/17-master-plan.md` — **الخطة الثابتة المعتمدة** وترتيب المراحل.
3. `docs/01-business.md` → `02-architecture` → `03-security` → `04-engineering-standards` → `06-operations` → `08-testing` → `11-deployment`.
4. `docs/adr/*` — القرارات المعمارية والمالية الملزمة.
5. `docs/checkpoints/*` — سجل خطوة بخطوة. `docs/07-gap-audit.md` و`docs/10-code-review.md` **سجلات تاريخية** (15–16 Nov 2026) وليست قائمة مهام.
6. `docs/16`, `docs/13`, `docs/14`, `docs/15` — مراجع نطاق ومتطلبات (مع تحديث الحالة).

---

## 9. ما هو ناقص/مؤجل (22 Nov 2026)

**تم:** Docs Reset + قرارات المالك (2.0)؛ تأمين النشر/النسخ + healthcheck (2.1 — تحتاج rehearsal)؛ التحقق 45/45 من تداخل المواعيد + تحصين 025 (2.2)؛ Reverse/Void مالي (2.3)؛ Responsive shell + جداول/لمس/ConfirmSheet/MonthPicker (2.4-a/b)؛ CI typecheck/migration-count/SQL regression/schema-drift + إصلاح Vite proxy (2.5-a)؛ **Meet 3.0/3.1** (ADR-0006/0007 + migration 026 + تقويم Google + واجهة الأحداث ونطاق التسجيل).

**التالي بالترتيب:**
- **مراجعة المالك لـ3.1** ثم **3.2** (بوت التسجيل + self-test) — هي نقطة التوقف الحالية.
- 3.3 التقاط حي + HLS/DVR + SSE + المشغل؛ 3.4 رفع Drive + دورة حياة الوسائط؛ 3.5 تحكم يدوي + موثوقية؛ 3.6 أمان/صلاحيات؛ 3.7 QA/نشر.
- 2.4-c: QA بصري 390/1440، 3 جداول SystemAdminView، print/reduced-motion، pagination، مراجعة RTL نهائية.
- 2.5-b: contract حقيقي مقابل API يعمل، Playwright E2E، deploy/rollback verification، lint.
- 2.6 الخزنة والإيرادات وتقفيل الشهر (بدون قيد مزدوج).
- 2.7 أمان وتشغيل (lockout، antiforgery، HSTS/Nginx، Cloudflare origin، rotation، monitoring).
- 2.8 تنظيف وإعادة هيكلة (ملفات >400، desktop-host/tools/runners، .opencode، Vite dev proxy).
- 2.9 جودة الإطلاق (E2E شامل، restore drill، load/pen، PDF sign-off، handover).

**مؤجل بقرار المالك:** الإنجليزية، القيد المزدوج، مسير/قسائم الرواتب، خصومات/خطط رسوم، إيصالات مرقّمة، بوابة ولي الأمر.

## 10. قواعد ثابتة

- كل مرحلة = كود + tests + توثيق + checkpoint + commit (وثيقة deepseek).
- لا حذف لتاريخ مالي/حضور — Reverse/Void فقط.
- لا أسرار في الريبو/الوثائق/اللوجات.
- المال decimal ونسبيًا لا float؛ الأرقام المالية من الخادم فقط.
- الصلاحيات تُفحص على الخادم دائمًا.
- أي قرار عمل جديد = ADR + تحديث `docs/00` + `docs/17`.

---

## 11. آخر التحديثات (22 Nov 2026)

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

## 12. نقطة التوقف الحالية (22 Nov 2026) — Resume Here

> **الحالة:** **3.0 + 3.1 منفذتان ومُcommit محليًا**؛ التنفيذ متوقف بطلب المالك لمراجعة النتيجة قبل **3.2 (بوت التسجيل)**. المسار 2.x (2.4-c/2.5-b) لا يزال مؤجلًا بقرار المالك لصالح مميزات Meet.

### آخر commit
- الإنتاج: `a823b32` (deploy stamp `20261122-215854`) — نسخة DB قبلية `dar-pre-deploy-20261122-215854.dump`.
- **محليًا commits لاحقة (docs + إصلاح update.sh) بانتظار push المالك** — الـpush من هذه البيئة محجوب (لا يوجد GitHub write credential؛ مفتاح السيرفر read-only).
- تفاصيل النشر: `docs/checkpoints/3.1-meet-deploy-1.0.md`.

### المنجز (بالترتيب)
| المرحلة | الحالة | checkpoint |
|---|---|---|
| 2.0 Docs Reset + قرارات المالك | ✅ | `docs/checkpoints/2.0-docs-reset-1.0.md` |
| 2.1 تأمين النشر/النسخ + healthcheck | ✅ (تحتاج rehearsal) | `2.0-docs-reset-1.0.md` |
| 2.2 تداخل المواعيد (45/45) + تحصين 025 (17/17) | ✅ | `2.0…` + `2.2fix-2.4b-2.5a-1.0.md` |
| 2.3 Reverse/Void مالي (migration 024، SQL verify 23/23) | ✅ | `2.3-2.4a-void-responsive-1.0.md` |
| 2.4-a Responsive shell (Drawer/Bottom Nav/Modal sheet/CSS leak) | ✅ | `2.3-2.4a…` |
| 2.4-b جداول/لمس/ConfirmSheet/MonthPicker | ✅ (16 جدولًا؛ 3 SystemAdminView متبقية) | `2.2fix-2.4b-2.5a-1.0.md` |
| 2.5-a CI (typecheck/migration-count/SQL regression/schema drift) + Vite proxy | ✅ | `2.2fix-2.4b-2.5a-1.0.md` |
| **3.0 Meet — ADRs + جسر الجلسة + الصلاحيات** | ✅ منفّذة ومنشورة | `3.0-3.1-meet-calendar-1.0.md` |
| **3.1 Meet — migration 026 + Calendar + Events UI** | ✅ **منشورة على الإنتاج** | `3.0-3.1-meet-calendar-1.0.md` + `3.1-meet-deploy-1.0.md` |
| **3.2 Meet — بوت التسجيل + self-test** | ✅ **منشورة على الإنتاج** (خدمة `dar-meet-bot` تعمل) | `3.2-meet-bot-1.0.md` |
| **3.3 Meet — دخول مضيف + تسجيل حقيقي** | ✅ **منشورة ومختبرة** (job ready، جلسة 176s، MP4 7.79MB) | `3.3-meet-join-recording-1.0.md` |

### المتبقي بالترتيب (عند الاستئناف)
1. **3.4:** رفع MP4 إلى Drive (rclone + checksum + رابط) + **الحذف اليدوي بضغطتين** + منع الحذف قبل التحقق.
2. **3.5:** reaper للمهام المعلّقة، إعادة انضمام تلقائية، **فحص جلسة Google قبل كل حصة 15 دقيقة + تنبيه**.
3. **3.6:** مسارات `/media/meet/*` محمية بـX-Accel + SSE + مشغل في الواجهة + اختبارات صلاحيات سلبية.
4. **3.7:** QA بصري/E2E + نشرة + docs/11.
5. **T0.2/T0.3:** تعديل/حذف حصة من اللوحة + شاشة إعدادات التسجيل.
6. **2.4-c / 2.5-b / 2.6 → 2.9:** المسار 2.x كما هو.

### Blockers/قيود معروفة
- **push** محجوب بيئيًا: لا يوجد GitHub write credential (مفتاح الدخول للسيرفر ليس مفتاح GitHub، ومفتاح GitHub على السيرفر **read-only**) → المالك يدفع يدويًا. الإنتاج الآن على `db0beda` + إصلاح وحدة `8c98b13` مطبَّق يدويًا، وGitHub على `a823b32`.
- **تم النشر:** الإنتاج على **26/26** migration وخدمة `dar-meet-bot` تعمل؛ ربط Google تمّ فعليًا (128 حدثًا) في وضع Testing.
- **Google OAuth ما زال Testing** → التوكن يقع بعد 7 أيام. النشر يحتاج **Home page + Privacy policy** في Branding ثم Publish + إعادة ربط.
- **تحقق بصري/E2E/Testcontainers/bash -n/dotnet test (testhost)** محجوبة في الساندبوكس (esbuild EPERM / no Docker / process handles) → CI أو جهاز غير مقيّد.
- **3.2 لم يجرّب على Meet فعليًا** — الخدمة تلتقط شاشة وهمية؛ الانضمام للاجتماع في 3.3.
- **سكربتات Phase 2.1** جُرّبت الآن فعليًا بالكامل في النشر (نسخة + pull + build + migrate + swap + smoke) ✅ — بقي rehearsal الـrollback نفسه.
- **cleanup**: مجلد `.tmp-deploy` متبقٍ (pip temp، متجاهل في git ولا يؤثر).

### للاستئناف
1. `git push origin main` (التحديثات المحلية: docs النشر + إصلاح `update.sh`).
2. إدخال مفاتيح Google في `/etc/dar/meet.env` ثم `systemctl restart dar-api`، ثم «ربط Google» + «مزامنة الآن» والتحقق من صفحة **التسجيل والمحاضرات**.
3. مراجعة المالك لنتيجة 3.1 ثم البدء في **3.2** — أو العودة إلى 2.4-c إن أراد إكمال المسار 2.x أولًا.

### Phase 3.0 (22 Nov 2026) — معتمدة
- القرارات السبعة في `docs/18-meet-recording-plan.md` §9؛ التنفيذ بدأ بـ3.0/3.1 (هذا الـcheckpoint)؛ 3.2+ بانتظار المراجعة.

---

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
- أوراق المراجعة (PDF) استُخرجت ونُقّشت: تؤكد تجاوز قفل المرتبات في مسار مراجعة الطلبات، ونطاق التسجيلات غير المقيّد، وخطأ `null` في ملاحظة التصحيح، وحذف outbox عند 4xx، وغياب security headers عن SPA، و`/api/students` بدون pagination. تصحيح واحد: يوجد rate limit 10/دقيقة لكل IP على auth (لكن بلا قفل حساب/2FA).
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
- **بيئة الاختبار:** قاعدة disposable `dar_p0_payroll_20261124050107` أُنشئت من `pg_dump -s -O -x dareltahfeez` (schema الإنتاج)، والاختبارات استخدمت `DAR_TEST_DATABASE`؛ بعد النجاح تم **إسقاط القاعدة والدور**.
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

### 24 Nov 2026 — P0-6: ترحيل حضور outbox من v1 إلى v2/v3 (منشور، بانتظار اختبار خارجي)
- **المشكلة:** مخزن IndexedDB v1 (`attendance` بمفتاح sessionId) كان متجاهلًا بعد P0-4 لأن الكود يقرأ v2 فقط؛ سجلات قديمة لا تُرسل ولا تُعرض (لكنها لا تُمحى).
- **الإصلاح:** DB v3 — عند الترقية تُنسخ سجلات v1 إلى `attendance-queue` كسجلات `userId='__legacy__'` و`needsReview=true`، **بدون إرسال تلقائي**، ومخزن v1 **لا يُمسح**. الـhook يعرض عدد legacy في الـbanner وزر «نقل إلى حسابي» (claim صريح) ثم flush. أي جهاز مشترك لا يرسل طابور حساب لحساب آخر.
- **الملفات:** `offlineOutbox.ts` (v3 + migration + claim)، `useTeacherOutbox.ts`، `TeacherApp.tsx`، `calendar-history.css`، `package.json`+lock (`fake-indexeddb` dev فقط)، واختبارات `offlineOutbox.migration.test.ts` + `offlineOutbox.legacy.test.ts`.
- **الاختبار:** قبل (كود v2): migration test **FAIL** (queue=0 بدل 2). بعد: **3/3 اختبارات Passed** (migration + legacy claim) و`tsc` ناجح. ملاحظة: أول محاولة اختبار أثناء النشر فشلت لأسباب بيئة (ملف log غير قابل للكتابة، npm install فشل) وليست فشل كود؛ أُعيد التشغيل كـdeploy user في 07:42:23 ونجح على نفس commit `64b9532`.
- **النشر (واجهة فقط):** بدأ 2026-11-24 **07:40:33**، backup `wwwroot.bak.20261124-074033`، smoke محلي/عام `/`و`/management`و`/teacher`=200. الأصول المنشورة تحتوي `__legacy__` و«نقل إلى حسابي»: `TeacherApp-CGuzh9Ne.js` SHA `3645678b81e92d1b158312605c46f3dc84f9d69dce1fe69137beba6ce53ce57d`، وCSS `TeacherApp-C8Xn83in.css` SHA `d2e661324804584f2666692fb1b3ba9fff3855efba8ee6ef0887bf65f6ae879e`، و`index-BIZeKr29.js` SHA `5ecf4f78f1364a942c32010d20225381fd8395c8c1fd2b936d51cb513d75ad65`.
- **الرجوع:** استعادة `wwwroot.bak.20261124-074033` — آمن: الترحيل إضافي وv1 لم يُمسح.
- **تحقق إضافي على متصفح حقيقي (headless Chromium ضد الموقع الحي):** زرع سجل v1 ثم فتح `/teacher` → ترقية القاعدة إلى **v3**، ونُسخ السجل إلى `attendance-queue` كـ`userId=__legacy__`/`needsReview=true` مع بقاء v1 (1 صف). واختبار `claim` في متصفح حقيقي (harness على نفس الوحدة): `legacyBefore=1, claimed=1, legacyAfter=0, queueMine(user-real, needsReview=false)=1, queueOther=0, v1Rows=1`.
- **ما زال غير متحقق:** نقر زر «نقل إلى حسابي» من واجهة React بعد تسجيل دخول معلمة (UI wiring)، والتأكيد الخارجي من المالك.
