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
