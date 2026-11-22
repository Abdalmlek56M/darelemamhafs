# RIGX Dar — Current State (Snapshot)

**Date:** 22 Nov 2026
**Rule:** هذا الملف هو **مصدر الحقيقة الواحد للحالة الحالية**. أي وثيقة تخالفه فهي إمّا هدف مستقبلي أو تاريخي. يتم تحديثه في نهاية كل مرحلة.
**آخر Commit مُتحقق منه:** `43cf810` (main) — قبل مرحلة Docs Reset الحالية.

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
| قاعدة البيانات | PostgreSQL 17 — `public` schema — **25 migration في المستودع (001→025)**؛ الإنتاج على 23 حتى تطبيق `deploy/update.sh` القادم (يتضمن 024 Void + 025 تحصين التداخل) |
| النشر | Ubuntu 24.04 + Nginx + Certbot + systemd + منافذ داخلية 5080/5081 |
| الاختبارات | 16 unit + 20 integration (Testcontainers) + 6 Vitest |
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
| `src/Host/Dar.Api/` + `src/Modules/*` | 79 ملف C# — 52 endpoint — Identity/Secretariat/Teaching | هوست جديد + وحدات |
| `frontend/src/` | 135 ملف TS/TSX — SPA واحدة تحمل admin + teacher + supervisor + home | admin: `App.tsx`/`SystemAdminView.tsx`/`pages/` — teacher/supervisor: `teacher/` |
| `database/` | 23 ملف SQL مرتّب + ledger في `web_schema_migrations` | legacy `schema_migrations` متوقف عند 16 |
| `tests/` | UnitTests + IntegrationTests (Testcontainers) + regression قديمة + 36 runner قديم | 11 runner يشير لـTestCenter المؤرشف |
| `deploy/` | Nginx/systemd/backup/setup scripts + Docker stack قديم (متقاعد) | يُعاد تأمينها في Phase 2.1 |
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
- كتالوج الصلاحيات مكرر في 3 مصادر: `backend/.../Security.cs`، `src/Common/Dar.Common/Domain/PermissionCodes.cs`، وseed في `database/017` و`018`.
- Scopes: `app_user_scopes` (circle/teacher) — لا صفوف = الكل.
- المالية مخفية تمامًا بدون `finance.read` (UI + API).

---

## 7. الاختبارات والبناء (آخر تحقق فعلي — 22 Nov 2026)

| البند | الحالة |
|---|---|
| **dotnet build** (legacy + Dar.slnx) | ✅ 0 warnings / 0 errors (بالأعلام الآمنة -m:1 -nodeReuse:false) |
| **TypeScript** (frontend tsc -b + api-client) | ✅ 0 errors |
| **Unit tests** | ✅ 16/16 (reflection runner) |
| **Integration بلا DB** | ✅ 6/6 (Health + SameOrigin) |
| **Integration بـDB (14)** | ⏭️ تحتاج Docker/Testcontainers — غير متاحة في الساندبوكس المحلي |
| **Overlap protection** | ✅ 45/45 + 3360 نقطة (012)؛ تحصين 025: 17/17 PASS + اختبار تزامن Testcontainers للـCI |
| **Vite build / Vitest** | ❌ محجوب محليًا (esbuild spawn EPERM) — الحكم في CI |
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

**تم:** Docs Reset + قرارات المالك (2.0)؛ تأمين النشر/النسخ + healthcheck (2.1 — تحتاج rehearsal)؛ التحقق 45/45 من تداخل المواعيد + تحصين 025 (2.2)؛ Reverse/Void مالي (2.3)؛ Responsive shell + جداول/لمس/ConfirmSheet/MonthPicker (2.4-a/b)؛ CI typecheck/migration-count/SQL regression/schema-drift + إصلاح Vite proxy (2.5-a).

**التالي بالترتيب:**
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

> **الحالة:** الخطة موقوفة مؤقتًا بناءً على طلب المالك (22 Nov 2026) لإضافة **مميزات جديدة**. كل الشغل متسجل ومُcommit محليًا، وشجرة العمل نظيفة. الـgoal الخاص بالخطة **Paused** (يمكن استئنافه بكلمة واحدة).

### آخر commit
- `HEAD` = 5 مراحل مالية/UX/CI + commit توثيق نقطة التوقف (راجع `git log --oneline -12`).
- **محليًا 12+ commit قبل `origin/main`** — الـpush محجوب من الساندبوكس (SEC_E_NO_CREDENTIALS). المطلوب: `git push origin main` من طرفية عادية.

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

### المتبقي بالترتيب (عند الاستئناف)
1. **2.4-c:** QA بصري 390/1440 لكل صفحة (محجوب محليًا — يحتاج متصفح)، 3 جداول `SystemAdminView`، print CSS، reduced-motion، pagination/«عرض المزيد»، مراجعة RTL نهائية، تقليل blur/perf.
2. **2.5-b:** contract حقيقي (spec مقابل API يعمل)، Playwright E2E، deploy/rollback verification، **أول تشغيل GitHub Actions**، lint (يحتاج قرار إضافة ESLint).
3. **2.6:** الخزنة + الإيرادات + المصروفات + تقفيل الشهر + منع Void بعد التقفيل.
4. **2.7:** أمان/تشغيل (lockout، antiforgery، HSTS/Nginx، Cloudflare origin، rotation، monitoring).
5. **2.8:** تنظيف/إعادة هيكلة (>400 سطر: `useDarApplication.ts` 404، `SystemAdminView`، `AuthEndpoints` 472، `SystemAdminEndpoints.Requests` 484، `TeacherApp` 475، `teacherTypes` 406) + إزالة `desktop-host`/`tools`/`runners`/vbs + إخراج `.opencode` من الريبو.
6. **2.9:** E2E شامل، restore drill آلي، load/pen test، PDF sign-off، handover.

### Blockers/قيود معروفة
- **push** محجوب بيئيًا (Windows Credential Manager) → تنفيذ يدوي.
- **نشر** migration 024/025 لم يُطبّق على الإنتاج بعد (الإنتاج على 23 migration) → عبر `deploy/update.sh` مع نسخة قبلية.
- **تحقق بصري/E2E/Testcontainers/bash -n** محجوبة في الساندبوكس (esbuild EPERM / no Docker / MSYS pipes) → CI أو جهاز غير مقيّد.
- **سكربتات Phase 2.1** لم تُجرّب على host بعد (rehearsal مطلوب).
- **cleanup**: مجلد `.tmp-deploy` متبقٍ (pip temp، متجاهل في git ولا يؤثر).

### للاستئناف
1. `git push origin main` (أو من طرفية المالك).
2. استئناف الـgoal من `docs/17-master-plan.md` — التالي 2.4-c ثم 2.5-b.

### طلب جديد قيد التخطيط (22 Nov 2026)
- **Phase 3.0 — Meet Recording & Live Streaming:** خطة كاملة + تحليل + تقسيم ملفات + قرارات مطلوبة في `docs/18-meet-recording-plan.md`. **بانتظار موافقة المالك** قبل أي كود. لا تبدأ التنفيذ قبل اعتماد القرارات العشرة في §9 من الوثيقة.
