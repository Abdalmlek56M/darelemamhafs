# Dar Eltahfeez — نظام إدارة الدار

نظام إداري/مالي لدار تحفيظ قرآن — ليس منصة تعليمية. واجهة عربية RTL.

**الحالة الحيّة:** https://dar-elemam-hafs.rigxhardware.com — آخر commit متحقق: `43cf810` (main).

## الـStack المعتمد

| الطبقة | التقنية |
|---|---|
| الواجهة | **React 19 + Vite 6 + TypeScript** — SPA واحدة. **لا Next.js** (القرار ملغي — ADR-0001) |
| Backend (legacy) | ASP.NET Core 10 Minimal API — `backend/DarEltahfeez.Api` على 5080 (يخدم الـSPA + معظم الـAPIs) |
| Backend (new) | `Dar.slnx`: `src/Host/Dar.Api` على 5081 — `/api/v1/*` (Identity + Secretariat + Teaching) |
| قاعدة البيانات | PostgreSQL 17 — **23 migration** (001→023) — ledger `web_schema_migrations` |
| النشر | Ubuntu 24.04 + Nginx + Certbot + systemd (Docker/Caddy متقاعد) |
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

## الاختبارات والحالة

- **16 unit + 20 integration** (Testcontainers PostgreSQL 17) + **6 Vitest**.
- 14 اختبار تكامل يحتاج Docker/Testcontainers (لا تُتخطّى بصمت — تفشل بدونه).
- لا Contract test ولا Playwright/E2E بعد؛ أول تشغيل GitHub Actions لم يُتحقق منه.
- **الحالة الحالية الكاملة:** `docs/00-current-state.md`.
- **الخطة والمراحل:** `docs/17-master-plan.md`.
- **القرارات الملزمة:** `docs/adr/`.

## البنية

```
backend/DarEltahfeez.Api   legacy API + hosting للـSPA
src/Host/Dar.Api           new API host (health, OpenAPI, security headers, migrations)
src/Common/Dar.Common      shared primitives (AppException, Money, PagedResult, PermissionCodes)
src/Modules/Identity       users/sessions/OTP/password
src/Modules/Secretariat    students
src/Modules/Teaching       teacher + supervisor + notifications + communication
database/                  23 ordered SQL migrations
tests/                     Dar.UnitTests + Dar.IntegrationTests (+ legacy regression/runners)
frontend/                  React 19 + Vite SPA (admin + teacher + supervisor + home)
deploy/                    Nginx/systemd/backup/setup scripts
docs/                      current state, plan, ADRs, checkpoints
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
npm install
npm run dev      # Vite على 5173 (proxy /api → 5080)
npm run build
npm run test

# الاختبارات على مستوى الحل
dotnet build Dar.slnx
dotnet test Dar.slnx
```

> **قيد معروف:** `vite.config.ts` يوجّه `/api` إلى 5080 فقط، بينما بوابة المعلمة/المشرفة تتكلم `/api/v1` على 5081. لاختبارها محليًا شغّل الـnew API على 5080 مؤقتًا أو عدّل الـproxy يدويًا؛ الإصلاح الدائم ضمن Phase 2.8 (Vite dev proxy). انظر `docs/06-operations.md` §2.

## قواعد ثابتة

- لا أسرار في المستودع/الوثائق/اللوجات.
- **لا حذف لتاريخ مالي أو حضور** — Reverse/Void فقط بسبب إلزامي + Audit (ADR-0005).
- المال `decimal`/`numeric` وليس float؛ والأرقام المالية تُحسب في الخادم فقط.
- كل صلاحية تُفحص على الخادم؛ المالية تختفي تمامًا بدون `finance.read`.
- الاستحقاق = `agreed_monthly_fee` (لا pro-rata)، وأجر المعلمة بالدقيقة (لا تقريب 5) — ADR-0002.
- ملفات جديدة: 200–300 سطر، الحد الأقصى 400.
- الاختبارات داخل `tests/`، ولا test panel/routes في المنتج.
- لا `.bat` — النشر عبر systemd/Nginx.
- راجع بالترتيب: `deepseek.md` → `docs/00-current-state.md` → `docs/17-master-plan.md`.
