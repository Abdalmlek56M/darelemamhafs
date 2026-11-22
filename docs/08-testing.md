# RIGX Dar — Testing

**Status:** Baseline + الواقع الحالي (22 Nov 2026 — Docs Reset).
**Scope:** Strategy, layers, data, environments, CI, what not to test.
**Source of truth:** `docs/00-current-state.md` — يحدد ما هو منفّذ الآن.

---

## 0. الواقع الحالي (22 Nov 2026)

| Layer | الموجود | الحالة |
|---|---|---|
| Unit (.NET) | 16 حالة في `tests/Dar.UnitTests` (Money + PasswordHasher) | ✅ |
| Integration (.NET) | 20 حالة في `tests/Dar.IntegrationTests` — Health (3)، SameOriginGuard (3)، Supervision (14) عبر Testcontainers `postgres:17` | ✅ في CI (يحتاج Docker) |
| Frontend | 6 حالات Vitest في `frontend/src/application/selectors.test.ts` | ✅ |
| Contract | غير موجود | ❌ Phase 2.5 |
| E2E / Playwright | غير موجود | ❌ 2.5 (smoke) / 2.9 (كامل) |
| Visual / A11y | مراجعة يدوية فقط | ⚠️ |
| Financial regression | `tests/regression` (C#) + `tests/regression/sql` | ❌ خارج CI — تُنقل في Phase 2.5 |
| PowerShell runners | 36 في `tests/runners`؛ 11 يشيرون إلى `TestCenter.ps1` المؤرشف | ⚠️ تُؤرشف/تُحوَّل |

**آخر تحقق بناء (HEAD `43cf810`):** `dotnet build Dar.slnx` ✅ 0W/0E بالأعلام الآمنة (`-m:1 -nodeReuse:false`)؛ 16/16 unit ✅؛ 6/6 integration بلا DB ✅؛ 14 integration تحتاج Docker (غير متاح في جلسة التحقق)؛ `tsc -b` ✅؛ Vite build غير متحقق محليًا (قيود sandbox على esbuild). **يجب تشغيل البوابة كاملة على CI/جهاز غير مقيّد.**

**حدود CI الحالي:** الوظائف موجودة لكن CI لا يلمس أي مسار مالي legacy ولا ينفّذ E2E/contract؛ الثقة في المسارات المالية تأتي من الاختبارات اليدوية/السابقة فقط حتى Phase 2.5.

---

## 1. Principle

> الاختبارات مشاريع داخل الحل (Solution)، لكنها ليست جزءًا من التطبيق المنشور.

> **Legacy GUI Test Center is archived.** No test panel in the product. Individual `tests/runners/Verify-*.ps1` scripts remain only as conversion references; valuable scenarios move to xUnit/Testcontainers/Playwright.

- **ليست تطبيقًا منفصلًا.** هي `tests/Unit`, `tests/Integration`, `tests/Contract`, `tests/E2E` داخل نفس الحل.
- لا Test Panel في الواجهة.
- لا Test Routes في الإنتاج.
- لا Test Users/Test Data في قاعدة الإنتاج.
- لا اختبارات تعتمد على بيانات حقيقية.
- الاختبارات تُشغّل في CI أو محليًا أو بيئة اختبار مخصصة.
- يتم تشغيلها بـ `dotnet test` و`npx playwright test`، وليس بتشغيل تطبيق اختبار منفصل.

---

## 2. Test Pyramid

| Layer | Tool | Scope | Speed | الحالة |
|---|---|---|---|---|
| Unit | xUnit (C#), Vitest (TS) | domain rules, pure functions | fast | ✅ 16 + 6 |
| Integration | xUnit + Testcontainers | API + PostgreSQL + transactions | medium | ✅ 20 |
| Contract | OpenAPI diff | API/client consistency | fast | ❌ Phase 2.5 |
| E2E | Playwright | critical user journeys | slow | ❌ 2.5/2.9 |
| Visual | Playwright screenshots | key screens/states | slow | ❌ |
| Accessibility | axe-core | WCAG AA | medium | ❌ |
| Performance | k6 + Lighthouse | API/pages | slow | ❌ |
| Security | audits/scans | deps/secrets | medium | ✅ جزئي (dependency + secret scan) |

**Rule:** most tests are unit; few are E2E; every critical money path has at least one integration + one E2E.

---

## 3. What Must Be Tested

### Domain / Money
- Wage calculation:
  - hourly vs session.
  - effective rate by date.
  - late/grace.
  - cancellation by admin/teacher/student.
  - substitute.
  - make-up.
  - rounding.
- Billing:
  - monthly charge.
  - agreed-fee charge (no pro-rata — ADR-0002).
  - discount percentage/fixed.
  - payment allocation oldest first.
  - refund/credit.
  - arrears aging.
- Ledger:
  - debit = credit.
  - account balances.
  - period lock.
- Attendance:
  - duplicate prevention.
  - approval.
  - edit after approval.
  - locked payroll.

### Security
- No token / expired / revoked.
- Wrong role.
- IDOR.
- CSRF.
- Rate limit.
- File upload validation.
- Locked record edit.

### UI
- Login.
- Attendance marking.
- Payroll run.
- Payment + receipt.
- Student statement.
- Reports filters.
- RTL layout.
- Loading/empty/error.
- Long text.
- Mobile attendance.

---

## 4. Test Environments

| Environment | Purpose | Data |
|---|---|---|
| Local | dev + unit/integration | seed/fake |
| CI | automated tests | Testcontainers ephemeral |
| Staging | E2E/visual/UAT | anonymized/synthetic |
| Production | real users | real data — no tests |

### Isolation rules

- Separate database name: `dar_test` / `dar_e2e`.
- Separate connection string via env var.
- Testcontainers for integration: fresh DB per run.
- E2E resets/seeds its own DB.
- Never run migrations/tests against production.
- Guard: fail fast if `ASPNETCORE_ENVIRONMENT=Production` and test flag is on.

---

## 5. Test Data

- Deterministic seed scripts.
- Known scenarios:
  - 3 teachers with different rates.
  - 10 students with different plans.
  - 1 group, 1 schedule.
  - 5 sessions with attendance states.
  - 2 payroll periods.
  - 3 charges/payments.
- No real names/phones/emails.
- No production dump in repo.
- Factories/builders for entities.
- Each test creates its own data or uses a transaction rollback.

---

## 6. Unit Tests — .NET

```
tests/Unit/Payroll/PayrollCalculatorTests.cs
tests/Unit/Billing/ProrationTests.cs
tests/Unit/Attendance/AttendanceRulesTests.cs
```

- No DB, no HTTP.
- One behavior per test.
- Arrange/Act/Assert.
- Naming: `Method_State_Expected`.
- Test edge cases: zero, negative, max, rounding, leap day, DST, month end.

### 6.1 Frontend — Vitest

- `npm test` runs `vitest run` (6 حالات حاليًا).
- `src/application/selectors.test.ts` يغطي: فلترة النص/الحالة للطلاب والمعلمات، مجاميع الشهر الحالي، **اقتراح الاستحقاق = `agreed_monthly_fee` بلا pro-rata** (ADR-0002)، ربح اللوحة، وصافي الحلقة.
- لا مكوّنات/DOM داخل الاختبارات؛ تبقى pure selectors سريعة.

---

## 7. Integration Tests — .NET

**الحالي:** `tests/Dar.IntegrationTests` — 20 حالة عبر `WebApplicationFactory` + Testcontainers `postgres:17`:

- `HealthEndpointTests` (3): live/ready/database.
- `SameOriginGuardTests` (3): رفض cross-origin على unsafe methods + dev origin المسموح.
- `SupervisionAccessTests` (14): finance/scope على unpaid، adjust خارج النطاق 403، notifications scope، subscription scoped، notes-kind قبل LIMIT، اعتماد request يحوّل correction (75 دقيقة → 62.50 عند 50/ساعة)، صلاحية communications + `wa.me`، templates/banner.
- `SupervisionFixture`: يطبّق كل الـmigrations ويزرع حلقتين/معلمتين/طلاب/charges/payments/slots/attendance/إشعارات scoped.
- Clean DB per test class (Testcontainers fresh).

**الهدف:** idempotency، concurrency (طلبان متوازيان)، قيود DB، ومسارات الـlegacy المالية بعد نقل regression — Phase 2.5.

---

## 8. Contract Tests (planned — Phase 2.5)

**غير موجودة حاليًا.** `packages/api-client/openapi.v1.json` ناقص (27 path مقابل 52 endpoint فعلي في `src/`) و`@dar/api-client` غير مستخدم في الواجهة؛ الأنواع مكتوبة يدويًا مؤقتًا.

الهدف:
- regenerate الـspec من `/api/openapi/v1.json` بعد تشغيل `src/Host/Dar.Api`.
- Test compares generated spec with committed file → fail on diff.
- Frontend typecheck uses generated types؛ Breaking change requires version/migration.

---

## 9. E2E — Playwright (planned — smoke في 2.5، كامل في 2.9)

**غير موجودة حاليًا.** بعد إنشاء staging. Critical journeys:

1. Login → dashboard.
2. Create student → enroll in group.
3. Mark attendance → approve.
4. Generate payroll → approve → lock → payslip.
5. Create charge → payment → receipt → statement.
6. Report filter → export/print.
7. Permission denial.

Rules:

- Run against staging/test DB.
- Stable selectors (`data-testid`).
- No arbitrary sleeps; wait for state.
- Screenshots/traces on failure.
- Seed data via API or script.
- Clean up after run.

---

## 10. Visual QA

- Screenshots at 1440/1024/390.
- RTL.
- Light/dark (if applicable).
- Empty/loading/error/long text/0/1/1000 rows.
- Visual regression with threshold.
- Review diffs manually.
- Include print layouts.

---

## 11. Accessibility

- axe-core on key pages.
- Keyboard-only pass.
- Focus visible.
- Contrast.
- Labels/errors.
- Screen reader spot check.
- RTL reading order.

---

## 12. Performance

- Lighthouse for pages.
- API latency for list/report endpoints.
- k6 for attendance/payroll bursts.
- DB query plans for slow queries.
- Bundle analyzer.
- Budgets: LCP < 2.5s, INP < 200ms, CLS < 0.1.

---

## 13. CI Gates

**الحالي — `.github/workflows/ci.yml` (22 Nov 2026):**

- `backend`: build legacy + build `Dar.slnx` + `dotnet test`.
- `migrations`: تطبيق كل الـmigrations على PostgreSQL 17 service + التحقق من الجداول/الصلاحيات.
- `frontend`: `npm ci` + `npm test` + `npm run build`.
- `api-client`: `npm ci` + typecheck.
- `deployment`: `docker compose config` على الـstack المتقاعد فقط.
- `security`: `dotnet list package --vulnerable` + `npm audit --omit=dev` + built-in secret scan (git-grep regex، ليس gitleaks).
- لا E2E، لا contract diff، لا تغطية للمسارات المالية legacy، لا deploy/rollback.
- **أول تشغيل على GitHub لم يُتحقق منه بعد.**

**المطلوب (Phase 2.5):**

- إضافة scripts `typecheck`/`lint` للواجهة (غير موجودة في `frontend/package.json`).
- Contract diff + توليد الـclient.
- Playwright E2E smoke على staging.
- نقل الاختبارات المالية من `tests/regression` إلى test projects.
- التحقق من أول run فعلي على GitHub Actions.
- deploy job + rollback verification بعد تأمين سكربتات النشر.

No merge with failing tests, secrets, or contract drift.

---

## 14. Coverage

- Domain/money rules: high (≥ 90% of critical branches).
- Overall: meaningful, not a vanity number.
- New code should have tests for behavior.
- Don't test trivial getters/setters.
- Don't chase 100%.

---

## 15. What Not to Test

- Framework behavior.
- Trivial DTO mapping.
- Third-party library internals.
- Exact CSS pixel values (use visual snapshots for layout).
- Generated code.

---

## 16. Legacy UI Acceptance Checklist — To Re-run on Web

منقولة من `SESSION18_UI_ACCEPTANCE_AND_PILOT_READINESS_AR.md` كمرجع يدوي، وليست بديلًا عن Playwright.

- [ ] الدخول والخروج، ظهور الاسم/الصلاحيات، فتح لوحة التحكم.
- [ ] الطلاب: بحث، ملف طالب، إضافة/تعديل، إلحاق، إيقاف/استئناف/إنهاء.
- [ ] المعلمات: ملف، حلقات، مواعيد، سجل حضور، أجر.
- [ ] الحلقات: تفاصيل، roster، رسوم، التحاقات.
- [ ] المواعيد: عرض الأسبوع، كشف حضور، تعارضات، «جزء تبارك» (07:00/10:00/11:00 بعد اعتماد الإصلاح).
- [ ] المالية: استحقاق، دفعة كاملة/جزئية، إيصال، متبقي، منع الزيادة.
- [ ] المصروفات: تشغيلية/إعلانية، توزيع الشهر، صافي تقديري.
- [ ] التقارير: 6 تقارير PDF، RTL، طباعة، Snapshot محفوظ، CSV/JSON.
- [ ] الإدارة: حسابات، صلاحيات، Audit، Trash، Backup، Export.
- [ ] إغلاق/إعادة تشغيل، صحة الاتصال، عدم فقد بيانات.

**Pilot rules:** جولة القراءة فقط أولًا، لا كتابة على الإنتاج، سجّل PASS/FAIL/NOT CHECKED، ولا تبدأ Pilot قبل Backup موثق.

---

## 17. Definition of Done — Testing

- [ ] Critical money paths tested.
- [ ] Auth/RBAC negative tests.
- [ ] Contract test passes.
- [ ] E2E smoke passes.
- [ ] No test data in production.
- [ ] No test routes/panel.
- [ ] CI green.
- [ ] Flaky tests fixed or quarantined with issue.
