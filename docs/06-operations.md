# RIGX Dar — Operations

**Status:** Live runbook (22 Nov 2026 — Docs Reset). الأوامر المعلّمة "هدف" لم تُنفَّذ بعد.
**Scope:** Local setup, migrations, tests, backups, deployment, monitoring, incidents.
**Source of truth:** `docs/00-current-state.md` — والتفاصيل التشغيلية في `docs/11-deployment.md`.

> **Deployment (live):** Ubuntu + Nginx + Certbot + systemd + PostgreSQL 17. الـDocker/Caddy stack **متقاعد** على الإنتاج (ملفات موجودة كمرجع/محلي فقط).

---

## 1. Requirements

| Tool | Version | Notes |
|---|---|---|
| .NET SDK | 10 LTS | 10.0.401 |
| Node.js | 24 LTS | v24.22.1 |
| npm | 10+ | 11.x |
| PostgreSQL | 17+ | host محلي أو container |
| Docker | 27+ (اختياري) | **غير مستخدم على الإنتاج**؛ محليًا لـTestcontainers فقط |
| Playwright | — | لم يُثبَّت بعد (smoke في 2.5 / E2E كامل في 2.9) |

**No `.bat` files.** استخدم أوامر terminal، والنشر عبر systemd/Nginx على الـhost.

### Legacy Desktop Commands (temporary)

الأدوات القديمة (Windows/desktop) ما زالت في الريبو لكنها **غير مستخدمة في الإنتاج**؛ إزالتها/أرشفتها = Phase 2.7/2.8. أوامر PowerShell التالية مرجعية فقط ولا تُستخدم في التشغيل الحالي:

```powershell
# Start legacy desktop app (source or installed)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\run-desktop.ps1

# Build React + API for acceptance (does not start PostgreSQL or apply migrations)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\Build-DarForRehearsal.ps1

# Legacy Test Center GUI is archived. Run individual Verify-*.ps1 runners
# only while converting them to tests/ projects.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tests\runners\Verify-FinancialRounding.ps1

# System Center
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\Start-SystemCenter.ps1

# Port/diagnostics helpers
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\Show-DarPortOwner.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\Export-Diagnostics.ps1
```

هذه الأوامر **legacy فقط** وغير مستخدمة في الإنتاج؛ إزالة الأدوات نفسها ضمن Phase 2.7/2.8.

---

## 2. Local Setup

> الواقع: لا `.env.example` في الجذر (الموجود `deploy/.env.example` للـhost). لا `dotnet tool restore` (لا `dotnet-tools.json`). Docker ليس شرطًا للتشغيل المحلي، لكنه مطلوب لـTestcontainers.

### 2.1 المتطلبات

- .NET SDK 10، Node 24 + npm 11، PostgreSQL 17 (محلي أو Docker).
- الواجهة React 19 + Vite فقط — لا Node backend ولا Next.js.

### 2.2 Backend

```bash
# legacy API: SPA + معظم الوظائف (admin/domain)
dotnet run --project backend/DarEltahfeez.Api           # http://127.0.0.1:5080

# new API: /api/v1 فقط
dotnet run --project src/Host/Dar.Api                   # http://127.0.0.1:5081
dotnet run --project src/Host/Dar.Api -- --migrate      # يطبّق migrations في web_schema_migrations
```

- الاتصال محليًا: `ConnectionStrings__DarDatabase` (legacy) و`ConnectionStrings__Default` (new) عبر env أو إعداد محلي غير متتبَّع.
- `Auth:Otp:Pepper` مطلوب خارج Development (يفشل مغلقًا بدونه).

### 2.3 Frontend

```bash
cd frontend
npm install
npm run dev       # Vite على http://localhost:5173 — proxy /api → 5080 (legacy فقط)
npm run build     # tsc -b && vite build → dist/
npm run test      # vitest run
npm run preview
```

**قيد حالي:** `vite.config.ts` يوجّه `/api` إلى 5080 فقط؛ بوابة المعلمة/المشرفة تتكلم `/api/v1` على 5081. لاختبارها محليًا شغّل الـnew API على 5080 مؤقتًا أو أضِف مسار proxy؛ الإصلاح الدائم ضمن Phase 2.8 (Vite dev proxy)، وscripts `typecheck`/`lint` تُضاف في Phase 2.5.

### 2.4 المنافذ الفعلية

| Service | Port |
|---|---|
| legacy API + SPA | 5080 |
| new API (`/api/v1`) | 5081 |
| Vite dev | 5173 |
| PostgreSQL | 5432 (host) — 5433 في تثبيت Docker القديم |

---

## 3. Configuration

- Local: `.env` (not committed).
- Production: host secret store / Docker secrets.
- Never commit `.env`, connection strings, SMTP passwords, JWT keys.
- `.env.example` contains names only.

Required configuration groups:

| Group | Examples |
|---|---|
| Database | `ConnectionStrings__Default` |
| Auth | `Auth__Otp__Pepper`, `Auth__Otp__ExpiryMinutes`, `Auth__Otp__MaxAttempts` |
| Google | `Auth__Google__ClientId` |
| Email | `Auth__Smtp__Host`, `Port`, `User`, `Password`, `From`, `EnableSsl` |
| Storage | media root / S3-compatible |
| Backup | destinations, retention, pg_dump path |
| Observability | log level, alert webhook |

---

## 3.5 Git & GitHub

- Git repo is initialized locally only by explicit owner request.
- `.gitignore` excludes `node_modules`, `bin`, `obj`, `dist`, `.env*`, backups, archives, and secrets.
- Commit messages: `area: imperative summary`.
- No secrets, logs, screenshots, ZIPs, or DB dumps in Git.
- Push requires a confirmed remote and `gh auth login`.

```bash
git status
git add .
git commit -m "chore: baseline project and new foundation"
git remote add origin <repo-url>
git push -u origin main
```

If `gh` is not authenticated:

```bash
gh auth login
```

Never force-push shared history. Ask before rewriting history.

---

## 4. Database Migrations

Migrations are ordered SQL files in `database/`, initially one schema.

```bash
# Apply all, ordered (checksums + advisory lock)
dotnet run --project src/Host/Dar.Api -- --migrate

# Add a migration
# create database/0NN_short_name.sql with IF NOT EXISTS / expand-contract rules
```

`MigrationRunner` يسجّل checksums في `web_schema_migrations` ويتبنّى الـledger القديم عند أول تشغيل. الـlegacy `schema_migrations` متوقف عند 16، ويُوقَف `DatabaseInitializer` نهائيًا قبل اعتماد أي migration جديد (ضمن التنظيف — Phase 2.8). أي migration مطبّقة لا تُعدَّل (تغيير checksum يوقف الـrunner) — التصحيح دائمًا عبر migration جديد.

Rules:

- Backup before production migration.
- Expand/contract.
- No destructive change without approval.
- Test on staging.
- Migration runner is the single ordered list.
- App role has no DDL; migration role is separate.

---

## 5. First Owner Account

- حساب المالك أُنشئ فعليًا على الـhost، وكلمة المرور المؤقتة أُعيد تدويرها وحُذف ملفها.
- لا self-registration: كل الحسابات تُنشأ من لوحة الإدارة.
- **المسار الحالي:** password + sessions. مسار Email OTP مُنفّذ لكنه يحتاج SMTP + pepper؛ Google مؤجل.
- first-run setup (legacy API): يتطلب `Auth:SetupToken` أو loopback فقط.

---

## 6. Tests

**الواقع (22 Nov 2026):** 16 unit + 20 integration (Testcontainers) + 6 Vitest. لا Contract ولا E2E/Playwright بعد.

```bash
# Backend
dotnet test Dar.slnx
# على Windows داخل sandbox مقيّد: أضف -m:1 -nodeReuse:false للـbuild

# One area
dotnet test --filter "FullyQualifiedName~Supervision"

# Frontend
cd frontend
npm run test        # Vitest
npm run build       # tsc -b + vite build
```

**Test isolation:**

- المشاريع داخل الحل: `tests/Dar.UnitTests` و`tests/Dar.IntegrationTests` فقط حاليًا (Contract/E2E لاحقًا).
- Testcontainers PostgreSQL 17 لاختبارات التكامل — تحتاج Docker (14 حالة تُتخطّى بدونه).
- Never production connection string.
- E2E سيعمل على staging مخصص (غير مُنشأ بعد).
- No test routes/panel in production.
- الاختبارات المالية القديمة (`tests/regression`) خارج CI حتى Phase 2.5؛ 11 runner يشير لـ`TestCenter.ps1` المؤرشف.
- See `docs/08-testing.md`.

---

## 7. Backups

**الواقع (22 Nov 2026):** `deploy/scripts/dar-backup.sh` عبر `dar-backup.timer` يوميًا (~02:30 Cairo):

- `pg_dump -Fc` → `/var/lib/dar/backups/db/dar-YYYYmmdd-HHMMSS.dump`.
- `rclone copy` إلى Google Drive (`gdrive:dar-backups/dar/db`).
- Retention: 30 يومًا محليًا وبعيدًا؛ الفشل البعيد يُرجع exit non-zero (يظهر في `systemctl --failed`).
- **لا manifest/checksum ولا تنبيه مركزي بعد.**

### 7.1 المطلوب — Phase 2.1

- `manifest.json`: وقت، migrations count، حجم DB، SHA-256، عدد الملفات.
- التحقق من النسخة بـ`pg_restore --list` قبل اعتمادها.
- healthcheck + تنبيه عند الفشل (systemd + قناة تنبيه).
- restore drill شهري موثّق.

### 7.2 Restore (manual, never from web)

1. اختر أحدث نسخة تم التحقق منها.
2. أوقف `dar-legacy` و`dar-api` (لا كتابة).
3. استعد إلى قاعدة منفصلة:
   ```bash
   sudo -u postgres createdb dar_restore_check
   sudo pg_restore --no-owner --no-privileges -d dar_restore_check <dump>
   ```
4. تحقق: `app_users`، `web_schema_migrations`، عينات مالية.
5. أعد تشغيل الخدمات وافحص `/health/ready`.
6. اسجّل النتيجة ثم أسقط قاعدة الفحص.

**لا تستعد فوق القاعدة الحية أبدًا.**

---

## 8. Deployment

### 8.1 Topology (live)

```
Cloudflare → Nginx:443 → SPA + legacy /api (5080) → PostgreSQL (127.0.0.1:5432)
                       ↘ /api/v1/* → new API (5081) → PostgreSQL
```

- `dar-elemam-hafs.rigxhardware.com` → Nginx؛ الـAPIs داخلية فقط.
- PostgreSQL غير منشور.
- Nginx يحمل TLS (Certbot) والـproxy buffers (إصلاح 502).

### 8.2 Host

- Ubuntu 24.04 LTS + systemd.
- `deploy` user للنشر (sudo)، `dar` user لتشغيل الخدمات.
- UFW: 22 restricted، 80، 443؛ fail2ban؛ unattended upgrades.
- **لا Docker على الإنتاج** (stack متقاعد؛ الـvolumes محفوظة كـrollback).

### 8.3 Services & Files

| Component | Notes |
|---|---|
| `nginx` | TLS + reverse proxy (`/etc/nginx/sites-available/dar-elemam-hafs` — copy في `deploy/nginx/`) |
| `dar-legacy.service` | SPA + `/api/*` على 5080 |
| `dar-api.service` | `/api/v1/*` على 5081 |
| `postgresql` | 17 على 127.0.0.1:5432 |
| `dar-backup.timer` | dump يومي + offsite |
| `certbot.timer` | تجديد الشهادات |
| `/etc/dar/legacy.env` + `api.env` | 640 root:dar |
| `/etc/dar/backup.env` + `/var/lib/dar/rclone/rclone.conf` | 600 dar:dar |
| `/opt/dar` | git checkout يتابع `origin/main` |

### 8.4 سكربتات النشر (Phase 2.1 — تُصلَح/تُنشأ)

- `deploy/preflight.sh`: فحص الخدمات/القاعدة/المساحة/حديث النسخة قبل أي تغيير.
- `deploy/update.sh`: **backup إلزامي → `--migrate` → publish → swap → restart → smoke → rollback تلقائي** عند الفشل.
- `deploy/rollback.sh`: استرجاع آخر نسخة binaries؛ قاعدة البيانات لا تُرجَع destructively (forward fix أو restore موثّق).
- إصلاح `bootstrap-server.sh` / `setup-host-db.sh` / `setup-host-services.sh` / `setup-nginx.sh` لتكون idempotent (إنشاء `dar`، buffers، pg_restore على قاعدة جديدة بعد نسخة).
- **ممنوع** تحديث الـhost يدويًا بدون المرور على `update.sh`.

### 8.5 Rollback

- احتفظ بنسخ `/opt/dar/app/*.old.<stamp>` (موجودة فعلًا).
- Rollback للـapp أولًا؛ قاعدة البيانات لا تُرجَع destructively.
- وثّق الحادثة في checkpoint.

---

## 9. Monitoring

| Check | Tool |
|---|---|
| HTTP uptime | غير مُنشأ بعد (هدف Phase 2.x) |
| API health | `/health/live`, `/health/ready` (legacy 5080 عبر Nginx) |
| Logs | journald + `DarFileLoggerProvider` (legacy) |
| Errors | لا Sentry؛ مراجعة لوجات يدوية |
| DB | connections/slow queries/disk — يدوي |
| Backups | `dar-backup.timer` + `systemctl --failed` |
| Disk/CPU/RAM | host metrics — يدوي |

Alerts: Telegram/email. No paid service without approval.

---

## 10. Runbooks

### 10.1 API down

1. Check systemd status/logs (`systemctl status dar-legacy dar-api`؛ `journalctl -u dar-legacy`).
2. Check DB connectivity.
3. Check disk.
4. Restart API if safe.
5. Rollback if deploy-related.
6. Record incident.

### 10.2 DB down

1. Stop writes.
2. Check PostgreSQL status/logs/disk.
3. Restart PostgreSQL.
4. If corrupted: restore from verified backup.
5. Verify financial balances before reopening.

### 10.3 Disk full

1. Identify large files/logs.
2. Rotate/clean logs.
3. Clean old backups per retention.
4. Do not delete DB volumes.
5. Add disk if recurring.

### 10.4 Secret exposure

1. Rotate affected secret.
2. Revoke sessions/tokens.
3. Check audit logs.
4. Patch source of leak.
5. Document.

### 10.5 Failed migration

1. Stop deploy.
2. Do not run destructive rollback.
3. Inspect migration.
4. Restore backup if data affected.
5. Fix forward and retest on staging.

---

## 11. Domain & DNS

| Record | Value |
|---|---|
| `dar-elemam-hafs.rigxhardware.com` | Cloudflare → host (live) |
| `www` | غير مُعد (redirect لاحقًا إن لزم) |
| `staging` | غير مُنشأ (Phase 2.5 smoke / 2.9 E2E) |

- SSL Full (strict) + Certbot DNS-01 (Cloudflare token في `/root/.secrets/cloudflare.ini`؛ يحتاج تدويرًا).
- HSTS: التطبيق يضيفه على `/api`؛ **Nginx يحتاج HSTS لكل الردود** (سبرنت الأمان).
- تقييد origin على Cloudflare IPs: **غير منفَّذ**.
- No direct API subdomain.

---

## 12. Data Retention & Privacy

- Student/guardian data: retained while active + legal/accounting retention.
- Financial records: retained (no deletion).
- Audit logs: retained per policy.
- Backups: retention above.
- Logs: 30–90 days, no PII.
- Export: permission + audit.

---

## 13. Operational Decisions

### Resolved

- **DB:** PostgreSQL 17 على نفس السيرفر.
- **Frontend:** React 19 + Vite — Next.js ملغي (ADR-0001).
- **Auth (current):** password + sessions؛ OTP path جاهز؛ Google مؤجل.
- **Language:** العربية الآن؛ الإنجليزية مؤجلة (ADR-0004).
- **WhatsApp:** deep links `wa.me` فقط (لا API مدفوع).
- **Backup offsite:** Google Drive عبر rclone — 30 يومًا.
- **Host:** Contabo VPS 4 (4 vCPU / 8GB / 100GB).
- **Tests:** projects inside the solution، وليست تطبيقًا منفصلًا.

### Open

1. Staging: نفس الـhost أم host منفصل؟ (مطلوب لـE2E)
2. Email provider (SMTP) لتفعيل OTP فعليًا.
3. Monitoring alert channel (Telegram/Email) + Uptime.
4. rclone OAuth client ID مخصص + تدوير Cloudflare token (قبل تقاعد shared client في 2026).
