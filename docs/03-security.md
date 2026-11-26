# RIGX Dar — Security

**Status:** Baseline rules + implementation status (22 Nov 2026).
**Scope:** Auth, authorization, data protection, API hardening, infrastructure, audit, tests.
**Source of truth:** `docs/00-current-state.md` يحدد ما هو منفّذ فعليًا؛ هذا الملف يحدد القواعد والهدف.

---

## 1. Principles

1. **Never trust the client.** Prices, totals, discounts, permissions, attendance and payroll are computed on the server.
2. **Least privilege.** Every endpoint declares a permission; every query is scoped.
3. **No secrets in the repo.** `.env*` ignored; production secrets from the host's secret store.
4. **Every write is audited.** Actor, time, before/after, correlation id.
5. **No hard deletes** of business data. Soft delete to trash; purge is owner-only and audited.
6. **Validate every input.** Length, range, enum, file type/size.
7. **No PII/secrets in logs.** Mask phone/email where possible; never log passwords/tokens.
8. **Rate-limit anything public** that sends email/WhatsApp or searches by phone.
9. **Defense in depth.** WAF → reverse proxy → app → DB → backups.
10. **Assume breach.** Design for containment, revocation and recovery.

---

## 2. Authentication

### 2.1 Model — Resolved

**Email OTP + Google**, with a temporary password fallback during migration.

- No SMS.
- Works for an administrative system where every staff member has an email.
- Google is optional per user; email OTP is the fallback.
- No public self-registration; accounts are created by the owner/admin.
- Step-up email code for destructive actions.
- If a teacher has no email, the owner creates an account with a managed email alias; this is an operational decision, not a code change.
- **Migration:** collect emails manually; keep password login temporarily for accounts without email; remove passwords after all active users are migrated.
- **Credential handling:** never store admin credentials in docs, code, logs, or repository. Use a password manager. The current weak credential must be changed before production. Do not reuse it for OTP/Google.

> **Implementation status (22 Nov 2026):** this section is the target security model; what follows is what is actually live.
>
> **Live today:** password login (PBKDF2-SHA256, 210k) — مسار Email OTP مُنفّذ لكن SMTP غير مُعد؛ Google مؤجل؛ HttpOnly/Secure cookies؛ `session_version` revocation عند تغيير كلمة المرور/الصلاحيات؛ rate limit 10/دقيقة لكل IP على مسارات auth؛ login audit؛ security headers؛ same-origin guard على الطلبات غير الآمنة؛ منع purge المالي؛ OTP hashed + pepper fail-closed؛ first-run setup token/loopback؛ forwarded headers؛ صلاحيات trash لكل كيان؛ append-only audit trigger؛ إزالة مسارات DELETE القديمة.
>
> **Not implemented yet — أولويات سبرنت الأمان القادم (Phase 2.7):**
> 1. **Per-account lockout** + throttle لكل حساب (5 محاولات/15 دقيقة) — الحالي per-IP فقط.
> 2. **Antiforgery token (CSRF)** لكل POST/PUT/PATCH/DELETE — الحالي Origin/Referer guard فقط.
> 3. **HSTS على مستوى Nginx** لكل الردود (HTML/static) + CSP مناسب لـVite — التطبيق يضع HSTS على `/api` فقط.
> 4. **تقييد origin على Cloudflare IPs** في UFW/Nginx (docs تقول إنه موجود — الواقع لا).
> 5. `__Host-` cookie prefix + سياسة عمر جلسة/remember-device موحّدة بين الـhostين.
> 6. تنظيف بقايا desktop من الـproduction binary والواجهة (`DAR_ISOLATED_*`, `desktopCredentialBridge`).
>
> See `docs/00-current-state.md` for evidence؛ `docs/10-code-review.md` سجل تاريخي (16 Nov).

### 2.2 Sessions

- Cookie: `HttpOnly`, `Secure` outside Development, `SameSite=Lax`, `__Host-` prefix.
- Server-side session/ticket store.
- Session lifetime: 12h browser session; "remember device" 30 days.
- Revocation: single session, all sessions, on password change.
- New-device alert email.
- No tokens in `localStorage`/`sessionStorage`.

### 2.3 CSRF

- **الحالي:** Origin/Referer guard + SameSite cookies + no CORS (بدون token).
- **الهدف:** token لكل unsafe method (`POST/PUT/PATCH/DELETE`) — double-submit cookie أو header `X-CSRF-TOKEN`.
- SameSite=Lax/Strict as defense in depth.
- No CORS; same-origin only.
- الطلب يُرفض 403 إذا غاب الـtoken في الهدف — يُضاف في سبرنت الأمان.

### 2.4 OTP

- 6 digits, 5 minutes, 5 attempts, single use.
- Stored encrypted at rest; never logged.
- Resend timer (e.g., 60 seconds).
- Generic responses to avoid account enumeration.
- Rate limit per IP + email (منفّذ جزئيًا: per-IP 10/min + per-email throttle في Identity module).
- Lockout after repeated failures (هدف — غير منفّذ بعد).
- المسار الحالي مؤقتًا password؛ عند اكتمال OTP/Google تُزال كلمات المرور نهائيًا (target).

### 2.5 Google

- ID-token flow: validate signature, issuer, audience, lifetime.
- No client secret stored.
- Link one Google account per user.
- Unlink requires step-up.
- First use links to the account with the same verified email or creates a staff account only if invited.

---

## 3. Authorization

- RBAC: roles + permission constants.
- Resource policies:
  - Teacher sees own groups/students/sessions only.
  - Accountant sees finance, not academic edits.
  - Secretary sees academic + collections, not payroll approval.
  - Supervisor sees academic, not salaries.
  - Auditor read-only.
- `RequirePermission(...)` on every admin endpoint.
- Row-level scoping in queries; never rely on UI.
- Test matrix: positive + negative for every role.
- Owner-only permissions cannot be granted to custom roles.

### Required negative tests

- No token → 401.
- Expired token → 401.
- Wrong role → 403.
- IDOR: teacher requests another teacher's group → 403/404.
- Accountant edits attendance → 403.
- Secretary approves payroll → 403.
- Modify locked payroll → 409.
- Delete posted payment → 405/409.
- Access another branch (if branches) → 403.

---

## 4. Input & Output

- FluentValidation per request.
- Whitelist fields; no mass assignment.
- Max lengths, ranges, enums.
- Body limit 1MB JSON; file uploads separate.
- File uploads:
  - allowed types; max size 10MB.
  - random names.
  - stored outside web root.
  - images re-encoded; EXIF/GPS stripped.
  - private files served only by authorized endpoints.
  - optional ClamAV scan.
- Output DTOs explicit; never serialize entities.
- Public DTOs exclude cost, salary, national ID, phone, address, private notes.
- HTML: no raw user HTML; React escapes by default. If rich text, sanitize server-side.

---

## 5. API Hardening

- HTTPS only; HSTS (المطلوب على Nginx لكل الردود؛ حاليًا يضيفه التطبيق على `/api` فقط).
- Security headers: CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy.
- **CSP plan for Vite (بدل Next.js nonce):** `default-src 'self'`؛ `script-src 'self'` (الـbundle ملفات خارجية — لا inline scripts)؛ `style-src 'self' 'unsafe-inline'` مؤقتًا لحين فصل الـinline styles؛ `img-src 'self' data:`؛ `frame-ancestors 'none'`؛ `connect-src 'self'`. لا nonce ولا `unsafe-eval` (لا SSR).
- Rate limits — **الحالي مقابل الهدف**:
  - login/OTP: الحالي 10/دقيقة per IP؛ الهدف 5/15 دقيقة per IP+account + lockout.
  - global: 100/min per user (هدف).
  - public requests: 5/10 min per IP (هدف).
  - reports: 10/min (هدف).
  - search: 30/min (هدف).
- Request timeouts; DB `statement_timeout`.
- Idempotency for financial POSTs.
- Concurrency token for edits.
- ProblemDetails without stack traces.
- OpenAPI docs disabled or Basic Auth/IP allowlist in production.
- No `Server`/framework version headers.
- No CORS unless a future mobile app needs it; then allowlist.

---

## 6. Data Protection

- PostgreSQL not public; 127.0.0.1 على نفس الـhost (Docker/Caddy متقاعد).
- Separate DB roles (`app_rw`, `app_migrator`, `backup`, `readonly`).
- No superuser for app.
- Encryption at rest: host disk/volume encryption; encrypted backups.
- Backups: `pg_dump` + media + manifest; encrypted offsite.
- PII minimization: only what is needed.
- Retention: define per data type; no indefinite logs.
- Data export: permission + audit; CSV formula neutralization.
- Data deletion: soft delete; purge owner-only; financial records retained.
- Secrets: ملفات `/etc/dar/*.env` (640 root:dar) أو env؛ rotate؛ لا أسرار في الـlogs.
- Data protection keys: certificate-protected outside Development.

---

## 7. Audit

- Business audit log:
  - actor, time, action, entity, entity id, before/after changed fields, IP, user agent, correlation id.
  - append-only (DB trigger rejects UPDATE/DELETE/TRUNCATE).
  - secrets masked (`***`).
  - written in the same transaction.
- Security events:
  - login success/failure.
  - password/OTP changes.
  - permission/role changes.
  - session revocation.
  - step-up actions.
  - export/backup/reset.
- Audit query endpoint needs `System.ViewAuditLogs`.
- Restore of old values: owner-only + step-up + allowlist; never money/stock/roles.

---

## 8. Infrastructure

- Ubuntu 24.04 LTS.
- Cloudflare DNS/WAF, SSL Full (strict), HSTS.
- **Nginx + Certbot** TLS + reverse proxy (Docker/Caddy stack متقاعد على الإنتاج).
- UFW: 22 (restricted), 80, 443 only — **تقييد Cloudflare IPs غير منفَّذ** (هدف).
- SSH keys only; no root; fail2ban.
- الخدمات: systemd `dar-legacy` و`dar-api` تعمل بمستخدم `dar`؛ لا حاويات في الإنتاج.
- non-root users، healthchecks، log rotation (systemd/journald).
- PostgreSQL غير منشور (127.0.0.1:5432).
- Backups يومية + offsite (Google Drive)؛ manifest/healthcheck للنسخ = Phase 2.2.
- Dependency audit + secret scan in CI.
- Container scan (Trivy): لا ينطبق حتى إعادة تفعيل الحاويات.
- External pen test before launch (recommended).

---

## 9. Security Test Matrix

| Area | Test |
|---|---|
| Auth | no token, expired, revoked, wrong OTP, OTP reuse, lockout |
| CSRF | missing/invalid token on POST |
| RBAC | each role vs each module; negative cases |
| IDOR | change IDs across teachers/students/groups |
| SQLi | raw query inputs; EF parameterization |
| XSS | user text in names/notes; no `dangerouslySetInnerHTML` |
| File upload | wrong type, oversized, path traversal, EXIF |
| Rate limit | burst login/OTP/public request |
| Money | negative amount, overflow, rounding, double submit |
| Payroll | locked period, rate change, cancellation, substitute |
| Audit | update/delete audit row rejected |
| Backups | restore drill, checksum |
| Headers | CSP/HSTS/X-Frame-Options |
| Dependencies | `dotnet list package --vulnerable`, `npm audit` |

---

## 10. Gaps to Close — Updated 22 Nov 2026

| Gap | Severity | Phase |
|---|---|---|
| Per-account lockout + per-account auth throttle | High | 2.7 |
| Antiforgery token (CSRF) on unsafe methods | High | 2.7 |
| HSTS on Nginx for all responses + full CSP | Medium | 2.7 |
| Origin restriction to Cloudflare IPs | Medium | 2.7 |
| `__Host-` cookies + unified session lifetime | Low | later (3.0+) |
| Backup manifest/checksum + failure alerts + restore drill | High | 2.1 |
| Deploy scripts idempotent + backup/migrate/rollback gate | High | 2.1 |
| Email/OTP provider activation (SMTP + pepper) | High | when provider chosen |
| External pen test | High | before public growth |
| Data retention policy | Medium | later |
| Step-up scope | Medium | later |
| Desktop remnants cleanup (`DAR_ISOLATED_*`, WebView bridges) | Low | 2.7 + 2.8 |

---

## 11. Rules Every Change Must Keep

1. Server computes money, permissions, attendance, payroll.
2. Every admin endpoint has a permission.
3. Every write is audited.
4. No hard delete of business data.
5. No secrets in code/logs/docs.
6. Validate all input.
7. No PII in public DTOs.
8. Rate-limit public sensitive endpoints.
9. Tests never use production data/DB.
10. Backup before migration.

## 12. Tier-0 owner decisions (Nov 2026)

1. **payments.paid_at is server-owned.** The legacy payment JSON endpoint and the receipt-upload endpoint ignore any browser-supplied paidAt; the server writes DateTimeOffset.UtcNow. Client clocks are never trusted for money records.
2. **Public health is status-only.** /health, /health/live and /health/ready return { status } only. Service name, database state and build stage live behind GET /api/health/details (authenticated).
3. **Payroll lock blocks request reopen.** Reopening an approved attendance request restores its previous attendance effect, so the endpoint returns 409 when the request-date month is payroll-locked (payroll_locks.is_locked = TRUE). Unlocking the month allows the reopen. Covered by 	ests/regression/tier0-money.4. **One SPA security-header policy.** /, /teacher, /supervisor, /management and static assets all receive X-Content-Type-Options, X-Frame-Options: DENY, Referrer-Policy, Permissions-Policy, an enforced CSP and HSTS over HTTPS. The duplicate Report-Only CSP was removed. style-src 'unsafe-inline' stays for now because the React UI sets inline style attributes; removing it needs a nonce/class migration. The SPA fallback now only serves known entry paths and returns a real 404 for /.git/config, /swagger, /metrics and any other non-route path.5. **The proxy owns X-Forwarded-For.** nginx sends $remote_addr (overwrite) instead of appending a client-supplied chain; the app trusts only headers from configured ForwardedHeaders:KnownProxies.
6. **Unpaid notifications follow the ledger.** Migration 32_paid_notification_ledger.sql excludes voided payments from the paid sum and fires the resolver when monthly_charges.amount_due changes. Regression: 	ests/regression/tier0-trigger.
## 13. Real client IP behind Cloudflare (single setting)

The repo cannot see the live DNS, so both deployment shapes are supported and documented:

- **Cloudflare in front (default, matching the Turnstile/Insights CSP):** DAR_REAL_IP_MODE=cloudflare (or setup-nginx.sh --real-ip-mode cloudflare). The script installs deploy/nginx/cloudflare-realip.conf as /etc/nginx/conf.d/00-dar-cloudflare-realip.conf, which trusts CF-Connecting-IP **only** from Cloudflare's published address ranges (set_real_ip_from ...; real_ip_header CF-Connecting-IP; real_ip_recursive on;). nginx then proxies X-Real-IP/X-Forwarded-For from its resolved $remote_addr; a client-supplied XFF chain is never forwarded.
- **Direct connection (no CDN):** DAR_REAL_IP_MODE=direct. The Cloudflare snippet is removed, no proxy header is trusted, and $remote_addr is the TCP peer.

In both modes the app trusts only a header named X-Real-IP arriving from ForwardedHeaders:KnownProxies (loopback by default), so a missing/incorrect mode cannot make login lockout trust a spoofed value.

**NOT VERIFIED (requires the live host):** whether the origin currently accepts CF edge IPs only, whether nginx in production was reloaded with cloudflare-realip.conf, the current CF published ranges, and whether the origin firewall blocks non-CF traffic. Run ash deploy/setup-nginx.sh once Cloudflare is confirmed, then verify X-Real-IP in the request logs.
## 14. Money-write idempotency (FINAL 0.1)

- `POST /api/payments`, `POST /api/payments/with-receipt` and `POST /api/charges` accept a client-generated `Idempotency-Key` header (max 128 chars). The first request stores it in `payments.client_key` / `monthly_charges.client_key` (migration `033_idempotency_keys.sql`); a replay returns the existing row with `replayed: true` instead of inserting a duplicate. A different key on the same charge month still returns the normal `409` conflict.
- Frontend: `savePayment`, `saveCharge`, `saveEnrollment`, `saveScheduleSlot` and `saveAdExpense` write first and refresh afterwards in a **separate** try/catch, so a failed reload cannot turn a successful write into a false error that invites a duplicate retry. Payment/charge dialogs keep one key per attempt (`useRef`) so retrying after a refresh failure replays the same row.
- Regression: `tests/regression/tier0-idempotency` (charge replay, payment replay, distinct keys create distinct rows) plus `frontend/src/lib/idempotency.test.ts`.
- The regression harness now applies `database/03[2-9]_*.sql` to every disposable schema so the tests exercise the same schema a deploy would install.
## 15. Server-authoritative money (FINAL 0.3)

- `GET /api/summary/profit?month=YYYY-MM` is the single source of truth for billed/collected/balance, advertising, teacher pay, operating expenses, net profit, per-teacher pay and per-circle profit. It is computed with PostgreSQL `numeric` decimals and `MoneyRules.RoundCurrency`; the frontend renders these values (dashboard + profit report) instead of reproducing the formula with floating point.
- The client keeps only a fallback for the first paint before the summary arrives. `frontend/src/lib/money.ts` centralizes integer-minor-unit helpers (`toMinorUnits`, `sumMoney`) and `parseMoneyInput`, which rejects non-finite/negative/over-precision input and is used by payment, charge, enrollment fee, advertising cost and operating-expense forms.
- Regression: `tests/regression/tier0-profit` seeds a deterministic month and asserts the exact dashboard, teacher and circle numbers (no floating-point tolerance); `frontend/src/lib/money.test.ts` covers minor units and parser edge cases.
- **NOT VERIFIED:** the endpoint was exercised against the disposable regression schema only; production numbers were not compared and no live page render was verified.
## 16. Scope fail-closed for unlisted routes (FINAL 0.6)

- `ScopedAccessEndpointFilter` now **denies by default** when `ScopeTargetResolution` cannot map the request to a circle/teacher target (`403 هذا السجل خارج نطاقك`) instead of calling the handler. Previously any route the resolver did not list was effectively unscoped for scoped users.
- Regression: `tests/regression/scope-enforcement` adds `unresolved_restore_target_403` (scoped user attempts a filtered route whose target does not resolve).
- **Audit lead correction:** "empty scopes" is *not* an accidental fail-open. `database/019_app_user_scopes.sql`, the supervision checkpoints and `docs/00-current-state.md` document "no rows for a user = all circles/teachers" as the owner's backward-compatible decision for the existing supervisor account. Changing it to deny-by-default needs an explicit all-scope marker, admin UI support and a data migration for the live supervisor; that is **not** included here. New/unlisted *routes* are now denied; an account with zero scope rows still keeps the documented all-scope behavior until the owner decides otherwise. **NOT VERIFIED / decision required** for the empty-scope half of the finding.
## 17. New-backend scope holes (FINAL 0.7)

- **Secretariat** (`GET /api/v1/students`, `GET /api/v1/students/{id}`): both now resolve the caller scope and filter by enrollments in the allowed circles; a student outside scope returns 404. Creation stays permission-gated (new students are unlinked).
- **Supervisor teacher detail**: the attendance summary, scheduled-session count and history rows are now restricted to the caller's circles (previously a teacher allowed through one circle leaked their totals/rows from circles outside the supervisor's scope).
- **Meet link**: a scoped user can no longer re-link an event whose current circle is outside their scope (the target circle was already checked; the existing owner was not).
- **Adjust attendance**: re-checked; it already requires `attendance.correct` plus `finance.read` for a manual amount and rejects out-of-scope attendance with 403. The audit lead was stale; the regression now locks the behaviour (`adjust_outside_403` / `adjust_inside_200`).
- Regression: `tests/regression/scope-enforcement` adds `secretariat_list_scoped`, `secretariat_get_outside_404`, `meet_link_steal_forbidden`, `adjust_outside_403`, `adjust_inside_200`, `teacher_detail_outside_404` and `teacher_detail_summary_scoped`.
## 18. Meet Telegram token at rest (FINAL 0.5)

- The bot token is encrypted with the same AES-256-GCM `MeetCrypto` service used for the Google refresh token before it is written to `meet_settings.telegram_bot_token` (no new column; the stored value is ciphertext).
- `GET /api/v1/meet/settings` and the `PUT` response return only `hasTelegramBotToken`; the token is never echoed to the browser.
- Saving settings with a blank token keeps the stored token (it is not wiped). A legacy plaintext value is detected by a failed decrypt and encrypted on the next save; the alert notifier falls back to reading legacy plaintext until then.
- Regression: `tests/regression/tier0-meet-settings` (no token in GET/PUT responses, ciphertext at rest, blank save preserves the token). The disposable new-API process gets `Meet__EncryptionKey` from the regression harness.
- **NOT VERIFIED:** the live Meet settings row was not migrated/read; the bot's actual delivery against Telegram and the production encryption key are untested.
## 19. Repository leak scrub and test secrets (FINAL 0.10)

- Removed the live server IP, production hostname and production database name from tracked tests, deploy scripts, docs and examples. Deployment-specific values now come from the untracked `deploy/.env` (`DAR_DOMAIN`, `POSTGRES_DB`, `PGDATABASE`) or from test env (`DAR_FORBIDDEN_HOSTS`, `DAR_FORBIDDEN_DB`); guard lists no longer embed live values.
- `deploy/scripts/meet-login.sh` uses `<deploy-user>@<server-address>` placeholders.
- `deploy/setup-nginx.sh` requires `DAR_DOMAIN`/`--domain` instead of a baked production hostname; `deploy/setup-host-db.sh` / `setup-host-backup.sh` read `POSTGRES_DB` from `deploy/.env`.
- `tests/run-regression.sh` generates a random disposable superuser password per run and reads the schema-template database from `DAR_BASELINE_DB` (no baked production name/password).
- Turnstile `ExpectedHostname` no longer defaults to the production hostname: the app now fails fast when Turnstile is enabled without `Auth:Turnstile:ExpectedHostname`, and the test fixture uses `turnstile.example.invalid`.
- New regression suite `tests/regression/repo-secrets` scans backend/src/frontend/tests/deploy/services/packages/database for the live identifiers, the hardcoded superuser password and the non-configurable baseline DB, and fails the regression if any reappear.
- **Secrets to rotate (owner action):** the old regression superuser password (`RegressionPass123`, previously committed test-only), the Cloudflare API token mentioned in old checkpoint docs, the server SSH access used for deployments, and any `deploy/.env` value that previously appeared in docs. No live credential was changed by this commit.
- **NOT VERIFIED:** production hostnames/IPs/DNS in the live deployment, firewall/Cloudflare rules, and whether the live `deploy/.env` contains the placeholders. Docs that describe historic deployments were rewritten with placeholders; live runbooks must be re-generated from `deploy/.env`.
## 20. Backup coverage and verified retention (FINAL 0.9)

`deploy/scripts/dar-backup.sh` now produces a per-run backup set:

- `dar-<stamp>.dump` — database custom-format dump, `pg_restore --list` checked and SHA-256 hashed.
- `globals-<stamp>.sql` — `pg_dumpall --globals-only` (roles/grants/tablespaces), hashed in the manifest.
- `config-<stamp>.tar.gz` — the configured env files and encryption/Data Protection key directories (`BACKUP_CONFIG_FILES`, `BACKUP_KEY_DIRS`), mode 600.
- `media-<stamp>-*.tar.gz` — optional recording/media archives (`BACKUP_MEDIA_ENABLED=1`).
- Off-site copies include those extra files; the script inspects the rclone remote type and records `offsite.encrypted` in the manifest, warning (not silently passing) when the remote is not `crypt`.
- **Retention keeps the last `BACKUP_KEEP_COUNT` VERIFIED backups** (default 30). A verified dump is deleted only when enough newer verified backups exist; failed/unverified dumps are kept for investigation. Off-site retention uses the same keep set, never age-only deletion.
- Regression: `tests/regression/backup-source` checks the source contract (globals/config/keys/media, crypt inspection, count-based retention, no `-mtime … -delete`) and runs `bash -n`.

**NOT VERIFIED (needs the live host):** whether the production rclone remote is actually `crypt`, the live `BACKUP_CONFIG_FILES`/key paths, the media directory size/retention, the systemd timer run, and an actual off-site restore. The owner must confirm the rclone remote type; if it is not `crypt`, the manifest warning will show `offsite.encrypted=false`.
## 21. Portal vs admin session identity (FINAL 0.12)

Two independent cookies can share one browser: the legacy admin cookie `DarEltahfeez.Admin` and the modular portal session `dar_session`. `Dar.Session` previously tried the admin cookie first, so a portal request that carried both cookies could answer as the admin identity.

- Portal clients (`/teacher`, `/supervisor`) now send the explicit `X-Dar-Portal: teacher` marker on every `/api/v1` request (`frontend/src/lib/portalHeaders.ts`). The `DarSessionHandler` then authenticates **only** `dar_session`; it never falls back to the admin bridge.
- Requests without the marker keep the documented admin-bridge-first behaviour (the admin SPA relies on it). A marker without a valid portal session returns `401`, even when the admin cookie is valid.
- Portal logout clears only `dar_session`; the separate admin session remains alive (different credential, SameSite=Strict). The portal client keeps sending the marker after logout, so it cannot silently continue as admin.
- Regression: `tests/regression/tier0-sessions` (both cookies; header returns teacher, no header returns admin; portal logout 401 with marker while admin still answers; marker without session 401) plus `frontend/src/lib/portalHeaders.test.ts`.
- **NOT VERIFIED:** a real browser with both cookies, the live DataProtection key ring, cross-tab logout behaviour, and non-portal clients that omit the marker (those still get admin-first identity when both cookies are present, by design). No production session was changed.