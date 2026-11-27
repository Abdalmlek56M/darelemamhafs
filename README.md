# Dar Eltahfeez — نظام إدارة الدار

نظام إداري/مالي لدار تحفيظ قرآن — ليس منصة تعليمية. واجهة عربية RTL.

**الحالة الحيّة:** `https://<deployment-host>` (الدومين الحقيقي في `DAR_DOMAIN` داخل `deploy/.env` غير المتتبع — لا تكتبه في الريبو). آخر نشر إنتاجي مسجل: 22 Nov 2026 (ledger **26/26**)؛ جلسات التحصين (24–27 Nov) لم تنشر إلى الإنتاج.
**Git:** `main` هو المصدر؛ state الحالي في `docs/00-current-state.md` وسجل التحصين في `docs/OVERNIGHT-REPORT.md`.

## الـStack المعتمد

| الطبقة | التقنية |
|---|---|
| الواجهة | **React 19 + Vite 6 + TypeScript** — SPA واحدة. **لا Next.js** (القرار ملغي — ADR-0001) |
| Backend (legacy) | ASP.NET Core 10 Minimal API — `backend/DarEltahfeez.Api` على 5080 (يخدم الـSPA + معظم الـAPIs) |
| Backend (new) | `Dar.slnx`: `src/Host/Dar.Api` على 5081 — `/api/v1/*` (Identity + Secretariat + Teaching + Meet) |
| قاعدة البيانات | PostgreSQL 17 — **40 migration في المستودع** (001→040؛ 039/040 في دفعة batch 2) — الإنتاج على 26 حتى النشر القادم — ledger `web_schema_migrations` |
| النشر | Ubuntu 24.04 + Nginx + Certbot + systemd (Docker/Caddy متقاعد وملفاته حُذفت من الريبو) |
| اللغة | العربية فقط الآن؛ الإنجليزية مؤجلة (ADR-0004) |
| الخزنة | خزنة + إيرادات + مصروفات + تقفيل شهري؛ **بدون قيد مزدوج** (ADR-0003) |

## المسارات الحيّة

| المسار | ماذا يخدم |
|---|---|
| `/` | الصفحة العامة |
| `/management` | لوحة الإدارة |
| `/teacher` | بوابة المعلمة (PWA) |
| `/supervisor` | مساحة المشرفة |
| `/api/v1/*` | API الجديد (5081) |
| `/api/*` | API القديم (5080) |
| `/internal/*` | 404 عند الـedge — control plane للبوت loopback فقط |

## الاختبارات والحالة

- **الواجهة:** 31 ملف Vitest / **89 اختبارًا** (Testing Library + jsdom) عبر `npm test`.
- **Backend:** مشاريع `tests/Dar.UnitTests` + `tests/Dar.IntegrationTests` (Testcontainers PostgreSQL 17). آخر أرقام full regression وPASS/SHA في `docs/OVERNIGHT-REPORT.md`.
- لا Contract test ولا Playwright/E2E بعد؛ CI في `.github/workflows/ci.yml` (backend + meet-recorder + migrations + frontend + api-client + security).
- **الحالة الحالية الكاملة:** `docs/00-current-state.md`.
- **الخطة المعتمدة:** `docs/17-master-plan.md`؛ **خطة التحصين الجارية:** `docs/23-hardening-plan.md`؛ **سجل التنفيذ:** `docs/OVERNIGHT-REPORT.md`.
- **القرارات الملزمة:** `docs/adr/` (0001–0008).

## البنية

```
backend/DarEltahfeez.Api   legacy API + hosting للـSPA (partials بعد Z1)
src/Host/Dar.Api           new API host (health, OpenAPI, security headers, migrations)
src/Common/Dar.Common      shared primitives (AppException, Money, PagedResult, PermissionCodes)
src/Modules/Identity       users/sessions/OTP/password
src/Modules/Secretariat    students
src/Modules/Teaching       teacher + supervisor + notifications + communication
src/Modules/Meet           Google Calendar + events + recordings + bot control plane
database/                  40 ordered SQL migrations
tests/                     Dar.UnitTests + Dar.IntegrationTests
services/meet-recorder/    Dar meet recorder bot (Node 24 + Playwright + FFmpeg)
frontend/                  React 19 + Vite SPA (admin + teacher + supervisor + home)
deploy/                    Nginx/systemd/backup/setup/update scripts
docs/                      current state, plans, ADRs, checkpoints, overnight report
deepseek.md                AI operating manual
```

## التشغيل السريع

```bash
# legacy API (SPA + معظم الوظائف) — 127.0.0.1:5080
dotnet run --project backend/DarEltahfeez.Api

# new API (/api/v1) — 127.0.0.1:5081
dotnet run --project src/Host/Dar.Api -- --migrate
dotnet run --project src/Host/Dar.Api

# الواجهة
cd frontend
npm ci
npm run dev       # Vite على 5173 (proxy /api/v1 → 5081 و/api → 5080)
npm run typecheck
npm run build
npm run test

# الاختبارات على مستوى الحل
dotnet build Dar.slnx
dotnet test Dar.slnx
```

> **Dev proxy (2.5-a):** `vite.config.ts` يوجّه `/api/v1` → 5081 (new API) و`/api` → 5080 (legacy) بالترتيب الصحيح؛ شغّل الـAPI القديم والجديد معًا لاختبار كل الواجهات محليًا. راجع `docs/06-operations.md` §2.

## قواعد ثابتة

- **إنتاج/بيانات حقيقية:** لا تُشغّل اختبارات أو migrations أو أي أمر تدميري على الإنتاج أو بياناته؛ الاختبار على قاعدة disposable/staging فقط.
- لا أسرار في المستودع/الوثائق/اللوجات (لا domain/IP/DB حقيقي).
- **لا حذف لتاريخ مالي أو حضور** — Reverse/Void فقط بسبب إلزامي + Audit (ADR-0005).
- المال `decimal`/`numeric` وليس float؛ والأرقام المالية تُحسب في الخادم فقط.
- كل صلاحية تُفحص على الخادم؛ المالية تختفي تمامًا بدون `finance.read`.
- الاستحقاق = `agreed_monthly_fee` (لا pro-rata)، وأجر المعلمة بالدقيقة (لا تقريب 5) — ADR-0002.
- OOP: مسؤولية واحدة لكل ملف/كلاس، بلا تكرار (لا نسخ منطق مالي/صلاحيات/تنسيق).
- ملفات جديدة: 200–300 سطر، الحد الأقصى 400.
- الاختبارات داخل `tests/`، ولا test panel/routes في المنتج.
- لا `.bat` — النشر عبر systemd/Nginx و`deploy/update.sh` فقط.
- راجع بالترتيب: `deepseek.md` → `docs/00-current-state.md` → `docs/17-master-plan.md` → `docs/23-hardening-plan.md` → `docs/OVERNIGHT-REPORT.md`.
