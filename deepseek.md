# RIGX Dar — DeepSeek Operating Manual

> هذا الملف هو أول ما يُقرأ وآخر ما يُحدّث في كل جلسة عمل.
> إذا تعارض أي شيء معه، فالمستندات الأحدث في `docs/` هي المرجع، ثم هذا الملف.

---

## 1. Read First

اقرأ بالترتيب:

1. `docs/07-gap-audit.md` — P0/P1/P2 الحالية.
2. `docs/01-business.md`
3. `docs/02-architecture.md`
4. `docs/03-security.md`
5. `docs/04-engineering-standards.md`
6. `docs/05-roadmap.md`
7. `docs/06-operations.md`
8. `docs/08-testing.md`
9. آخر ملف في `docs/checkpoints/`

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
- خزنة ومصروفات ودفتر قيود.
- تقارير ولوحة.

**Scope:** إداري/مالي فقط — ليس منصة تعليمية (LMS). لا مناهج/محتوى/امتحانات إلكترونية في MVP.

**Domain:** `darelemamhaf.rigxhardware.com`
**Backend:** .NET 10 / ASP.NET Core minimal API + EF Core
**Frontend:** Next.js 16 + React 19
**Database:** PostgreSQL 17+ على نفس السيرفر
**Auth:** Email OTP + Google فقط، بدون كلمات مرور أو SMS
**Language:** عربي + إنجليزي
**Deploy:** Ubuntu 24.04 + Docker Compose + Caddy + Cloudflare

---

## 3. Current State

- **Phase 0.1:** Docs + Skill — ✅ done.
- **Phase 0.2:** Intake existing project — ✅ done. Project at `DarEltahfeez/`.
- **Phase 0.3:** Baseline build/run — ✅ partial (screenshots pending).
- **Phase 0.4:** Audit — ✅ done. See `docs/07-gap-audit.md`.
- **Phase 0.6:** Legacy docs consolidation — ✅ done (old folder archived).
- **Phase 1.1:** P0 fixes — 🟡 partial (rate limit, login audit, headers, financial purge guard).
- **Phase 1.2:** `.bat` removal — ✅ done (12 files; backup + direct PowerShell commands).
- **Phase 2.1:** New .NET solution — ✅ done (`Dar.slnx`, Host, Common, tests, 0 warnings).
- **Phase 2.3:** Identity — 🟡 first slice done (Email OTP, Google path, password fallback, sessions, logout; SMTP/Google config pending).
- **Phase 2.4:** Migration runner — ✅ done (checksums, advisory lock, 13 migrations, idempotent).
- **Phase 2.5:** OpenAPI + generated TS client — ✅ done (12 paths, 10 schemas, `openapi-typescript` + `openapi-fetch`, typecheck passes).
- **Phase 2.6:** CI baseline — ✅ done (backend/frontend/api-client/security jobs).
- **Phase 3.1:** Secretariat — 🟡 students list/get/create done.
- **Phase 1.5.1:** Legacy backend split — 🟡 started (`DomainEndpoints` → partial + `DomainEndpoints.Reports.cs`; Test Center GUI archived).
- **UI gate:** no UI implementation before the owner approves a visual sample.
- **Backend decision:** ✅ .NET is final (owner, 15 Nov 2026). TypeScript/NestJS is rejected; do not propose or build a second backend.
- **Google login:** deferred; temporary password + sessions is the current path.
- **Git:** `origin` = `https://github.com/Abdalmlek56M/darelemamhafs.git`; `main` pushed (`d8c7b29`).
- **Git rule:** every completed checkpoint = commit + push. No force-push.
- **Next:** finish the legacy backend split (1.5.1), then frontend split (1.5.2), tests (1.5.3), then security gate (2.7), DB hardening (2.8), UI sample gate (5.0), Next.js shell (5.1).
- **Legacy stack:** .NET 10 minimal API + React 19/Vite + PostgreSQL 17 + WPF/WebView2 + PowerShell Test Center. No `.bat` files remain.

### What Was Done vs. What Was Not

**Legacy code modified (P0 guards only):**
- `Program.cs` — rate limit, security headers, auto-migrate gate.
- `AuthEndpoints.cs` — login rate limit + login audit.
- `SystemAdminEndpoints.cs` — block permanent purge of financial/history records.
- `SystemAdminService.cs` — financial purge guard.
- Deleted all 12 `.bat` files; added `database/013_auth_email_otp.sql`.
- **Not touched:** `DomainEndpoints.cs`, the legacy frontend, WPF host, business logic.

**New code added (parallel foundation):**
- `Dar.slnx`, `src/Host/Dar.Api`, `src/Common/Dar.Common`.
- `src/Modules/Identity` (Email OTP, password fallback, sessions, logout, set email).
- `src/Modules/Secretariat` (students list/get/create, paged search).
- `tests/Dar.UnitTests`, `tests/Dar.IntegrationTests`.
- `docs/`, `README.md`, `.gitattributes`.

**Not done yet:**
- The legacy 1,680-line `DomainEndpoints.cs` is not split.
- The legacy frontend is not migrated to Next.js.
- The new API covers only Identity + Students; teachers/circles/attendance/finance/reports are still legacy.
- The .NET vs TypeScript final decision is unresolved.
- **Current code:** 11 C# files, 3 giant endpoint files, 874-line frontend hook, 12 migrations, 25 tables.
- **Migration:** Strangler, not big-bang. Legacy stays runnable until replacement passes.
- **Old docs:** read, extracted into `docs/`; replace after migration.
- **Auth:** resolved — Email OTP + Google (temporary password fallback during migration).
- **Language:** resolved — Arabic + English.
- **DB:** resolved — PostgreSQL on the same server; one `public` schema initially.
- **Data access:** resolved — Npgsql + Dapper, not EF Core.
- **Tests:** resolved — projects inside the solution, not a separate app.

---

## 4. Golden Rules

1. **Production-grade, not demo.**
2. **No secrets** in code/docs/logs/Git.
3. **No deletion** of financial/history records. Reversal/void only.
4. **No destructive DB commands** without backup + approval.
5. **No auto Git repo creation.**
6. **No paid API/credits** without approval.
7. **Server-side authorization** always.
8. **Money = decimal/numeric.** Never float. API returns strings when needed.
9. **Every financial mutation:** transaction + idempotency + audit.
10. **No `.bat` files.**
11. **UI sample gate:** before any UI implementation, produce a visual sample and get owner approval.
12. **No behavior change during a legacy split.** Build after each slice; no route/SQL/response changes.
13. **Arabic RTL first.**
14. **Tests are isolated.** Separate DB/environment. No Test Panel/Test Routes in production.
15. **No blind rewrite.** Audit first, then Strangler.
16. **Every step = docs + checkpoint.**
17. **If a business decision is missing: stop and ask.** Do not invent.

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
9. Keep tests in `tests/` projects, never a separate test app or product panel.
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
npm install
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
```

### Full
```bash
docker compose up -d postgres
docker compose up -d
```

### Git
```bash
git status
git add <paths>
git commit -m "area: summary"
git push origin main
```

Remote: `https://github.com/Abdalmlek56M/darelemamhafs.git`

**لا `.bat`.**
**لا تشغيل migrations على الإنتاج بدون نسخة.**
**كل Checkpoint مكتمل = Commit + Push.**
**لا force-push ولا إعادة كتابة تاريخ مشترك.**

---

## 7. Docs & Checkpoints

| File | Purpose |
|---|---|
| `docs/01-business.md` | المجال والقواعد |
| `docs/02-architecture.md` | الحالة الحالية + المستهدفة |
| `docs/03-security.md` | الأمان |
| `docs/04-engineering-standards.md` | معايير الكود |
| `docs/05-roadmap.md` | الخطوات |
| `docs/06-operations.md` | التشغيل والنشر |
| `docs/07-gap-audit.md` | نتائج الفحص |
| `docs/08-testing.md` | الاختبارات |
| `docs/09-legacy-refactor-plan.md` | خطة تفكيك الملفات القديمة |
| `docs/checkpoints/*.md` | Done / Uncommitted / Remaining / Decisions |
| `docs/checkpoints/README.md` | Ordered checkpoint index and next steps |

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

- Tests are **projects inside the solution** (`tests/Unit`, `tests/Integration`, `tests/Contract`, `tests/E2E`), not a separate application.
- Tests use a separate PostgreSQL database (`dar_test`) or Testcontainers.
- Never use production connection strings.
- E2E runs against a dedicated test/staging environment.
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
- Language: عربي + إنجليزي.
- DB: PostgreSQL على نفس السيرفر.
- Tests: مشاريع داخل الحل، وليست تطبيقًا منفصلًا.
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
10. GitHub remote URL + `gh auth login` للـpush.

**Resolved:**
- Backend: .NET final. TypeScript rejected.
- Google: deferred. Password + session is the current path.
- File size: 200–300 target, 400 hard max; legacy exceptions listed in `docs/04-engineering-standards.md`.

---

## 11. Update Protocol

- غيّر قرارًا معماريًا → ADR + `docs/02` + هذا الملف.
- غيّر قاعدة مالية → `docs/01` + اختبارات + موافقة.
- غيّر صلاحية → `docs/03` + اختبارات سلبية.
- غيّر نشرًا → `docs/06`.
- أنهيت خطوة → Checkpoint + `docs/05`.
- إذا شككت → توقف واسأل.
- رد بالعربية المصرية، مختصر وواضح.
