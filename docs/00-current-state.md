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
| قاعدة البيانات | PostgreSQL 17 — `public` schema — **24 migration في المستودع (001→024)**؛ الإنتاج على 23 حتى تطبيق `deploy/update.sh` القادم |
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
| **Overlap protection** | ✅ 45/45 PASS على PostgreSQL 17 معزول + 3360 نقطة استقصائية |
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

**تم مؤخرًا:** Docs Reset + قرارات المالك (2.0)؛ تأمين سكربتات النشر/النسخ + healthcheck (2.1 — تحتاج rehearsal)؛ التحقق الكامل من منع تداخل المواعيد (2.2 — 45/45 PASS)؛ تدقيق تجاوب لوحة الإدارة (جاهز للتنفيذ).

**التالي بالترتيب:**
- 2.3 Reverse/Void للسجلات المالية (ADR-0005 جاهز + مخطط migration 024).
- 2.4 تجاوب لوحة الإدارة 100% على الموبايل (2.4-a/b/c من تقرير التدقيق).
- إصلاحات 2.2: حارس سباق + ذرية حفظ الحلقة/المواعيد + رسالة التفرد + PUT للموعد.
- 2.5 CI/CD + Contract + E2E + scripts typecheck/lint.
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

- **Phase 2.3 Reverse/Void:** منفّذة (migration 024 + دوال + endpoints + صلاحية finance.void + استبعاد الملغي من legacy وnew API + UI حوار/شارة + SQL verify 23/23 PASS).
- **Phase 2.4-a Responsive shell:** منفّذة (Drawer + Bottom Nav + viewport dvh + Modal bottom-sheet + إصلاح تسريب CSS + إزالة بقايا desktop من shell). 2.4-b/c متبقيتان.

- اعتماد المالك النهائي للقرارات D1–D8 وتثبيت الخطة في `docs/17-master-plan.md`.
- Docs Reset شامل (كل الوثائق المتعارضة صُححت؛ 05/07/10 صارت سجلات تاريخية).
- ADRs 0001–0005 مضافة.
- تأمين النشر: `update.sh` / `rollback.sh` / `preflight.sh` + setup scripts idempotent + backups بmanifest/SHA/TOC + healthcheck timer.
- التحقق من تداخل المواعيد: 45/45 PASS؛ ثغرات سباق/ذرية موثقة للإصلاح.
- تدقيق تجاوب لوحة الإدارة جاهز (398 سطر) لتنفيذ 2.4.
- Checkpoint: `docs/checkpoints/2.0-docs-reset-1.0.md`.
