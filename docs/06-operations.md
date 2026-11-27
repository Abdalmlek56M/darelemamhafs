# RIGX Dar — Operations

**Status:** Live runbook (27 Nov 2026 — بعد تحصين Batch). الأوامر المعلّمة "هدف" لم تُنفَّذ بعد.
**Scope:** Local setup, migrations, tests, backups, deployment, monitoring, incidents.
**Source of truth:** `docs/00-current-state.md` — والتفاصيل التشغيلية في `docs/11-deployment.md`.

> **Deployment (live):** Ubuntu + Nginx + Certbot + systemd + PostgreSQL 17. الـDocker/Caddy stack **متقاعد وملفاته حُذفت من الريبو** (Tier 2 / 2.15). لا توجد أدوات Windows/desktop في الشجرة.

---

## 1. Requirements

| Tool | Version | Notes |
|---|---|---|
| .NET SDK | 10 LTS | 10.0.401 |
| Node.js | 24 LTS | v24.22.1 |
| npm | 10+ | 11.x |
| PostgreSQL | 17+ | host محلي أو container |
| Docker | 27+ (اختياري) | **غير مستخدم على الإنتاج**؛ محليًا لـTestcontainers فقط |
| Playwright | — | مستخدم داخل `services/meet-recorder` (البوت)؛ لا Playwright E2E لتطبيق الويب بعد (2.5/2.9) |

**No `.bat` files.** استخدم أوامر terminal، والنشر عبر systemd/Nginx على الـhost.

### لا أدوات Windows/desktop

`tools/`، `desktop-host/`، `tests/runners/`، `tests/catalog.json` **أُزيلت من الريبو** (Tier 2 / 2.15)؛ لا `run-desktop.ps1` ولا `TestCenter.ps1` ولا `Verify-*.ps1` ولا WPF/WebView2. البدائل الحالية:

- `deploy/sql/integrity-checks.sql` — فحوصات تكامل read-only.
- `deploy/scripts/dar-healthcheck.sh` — صحة الخدمات/القاعدة/النسخ/الشهادة.
- `deploy/scripts/dar-backup.sh` — نسخ manifest + SHA-256 + offsite.
- `deploy/scripts/restore-drill.sh` — تدريب استرجاع مجدول.
- `tests/regression/` — suites آلية (node/bash) بدل runners الـPowerShell.

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
npm run dev       # Vite على http://localhost:5173 — proxy: /api/v1 → 5081 (new API)، /api → 5080 (legacy)
npm run typecheck # tsc -b --force (فحص أنواع كامل بدون build)
npm run build     # tsc -b && vite build → dist/
npm run test      # vitest run
npm run preview
```

**تم إصلاح dev proxy (2.5-a):** `vite.config.ts` يعرّف `/api/v1` → 5081 قبل `/api` → 5080 (الترتيب مهم — Vite يحل أول تطابق بادئة). شغّل الـAPI القديم والجديد معًا لاختبار لوحة الإدارة وبوابتي المعلمة/المشرفة محليًا. `npm run typecheck` موجود الآن؛ `lint` لم يُضف بعد (قرار ESLint مؤجل ضمن 2.5-b).

### 2.4 المنافذ الفعلية

| Service | Port |
|---|---|
| legacy API + SPA | 5080 |
| new API (`/api/v1`) | 5081 |
| Vite dev | 5173 |
| PostgreSQL | 5432 (host) — 5433 كان في تثبيت Docker القديم (غير مستخدم) |

---

## 3. Configuration

- Local: `.env` (not committed).
- Production: `/etc/dar/{legacy,api,backup,healthcheck}.env` (640 root:dar) + `deploy/.env` (600 deploy:deploy)؛ لا Docker secrets بعد تقاعد الـstack.
- Never commit `.env`, connection strings, SMTP passwords, JWT keys.
- `deploy/.env.example` contains names only (لا يحتوي Caddy/Docker vars — أُزيلت).

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

`MigrationRunner` يسجّل checksums في `web_schema_migrations` ويتبنّى الـledger القديم عند أول تشغيل. الـlegacy `schema_migrations` متوقف عند 16. `DatabaseInitializer` القديم **ما زال موجودًا لكنه مقيّد بـDevelopment** (`Database:ApplyMigrationsOnStartup=true` فقط، ومُعطَّل صراحةً في Production) — إزالته الكاملة وحدَث الـledger متبقية ضمن تنظيف 2.8. أي migration مطبّقة لا تُعدَّل (تغيير checksum يوقف الـrunner) — التصحيح دائمًا عبر migration جديد. العدد في المستودع الآن **001→040** (آخر ملفين 039/040 في دفعة batch 2) والإنتاج متأخر حتى 026 حتى النشر القادم.

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

**الواقع (27 Nov 2026):** backend: `tests/Dar.UnitTests` + `tests/Dar.IntegrationTests` (Testcontainers PostgreSQL 17)؛ frontend: **31 ملف Vitest / 89 اختبارًا** (Testing Library + jsdom). لا Contract ولا E2E/Playwright للويب بعد. الأرقام الرسمية لآخر full regression (UNIT/SUITES/PASS + SHA) في `docs/OVERNIGHT-REPORT.md`.

```bash
# Backend
dotnet test Dar.slnx
# ملاحظة: `dotnet test` قد يُحجب في sandbox محلي (testhost Win32Exception 5)؛ CI هو الحكم
# وعلى Windows المقيّد استخدم -m:1 -nodeReuse:false للـbuild.

# One area
dotnet test --filter "FullyQualifiedName~Supervision"

# Frontend
cd frontend
npm run test        # Vitest
npm run build       # tsc -b + vite build
```

**Test isolation:**

- المشاريع داخل الحل: `tests/Dar.UnitTests` و`tests/Dar.IntegrationTests` فقط حاليًا (Contract/E2E لاحقًا).
- Testcontainers PostgreSQL 17 لاختبارات التكامل — تحتاج Docker (تُتخطّى/تفشل بدونه حسب الـsuite).
- Never production connection string / never production data.
- E2E سيعمل على staging (الموجود حاليًا — `docs/staging-environment.md`).
- No test routes/panel in production.
- الاختبارات المالية والـSQL regression: `.github/workflows/ci.yml` job `migrations` يشغّل `tests/regression/sql/*` وsuites الـregression في `tests/regression/` (راجع `docs/08-testing.md` §13).
- See `docs/08-testing.md`.

---

## 7. Backups

**الواقع (27 Nov 2026):** `deploy/scripts/dar-backup.sh` عبر `dar-backup.timer` يوميًا (~02:30 Cairo):

- `pg_dump -Fc` → `/var/lib/dar/backups/db/dar-YYYYmmdd-HHMMSS.dump` + `pg_restore --list` TOC + SHA-256 + `.manifest.json` (status، حجم، sha256، TOC count، ledger count، offsite{status, uploaded, verified، warning}).
- globals (`pg_dumpall --globals-only`) + config/keys archive حسب `BACKUP_CONFIG_FILES` / `BACKUP_KEY_DIRS`، وmedia اختياري (`BACKUP_MEDIA_ENABLED`).
- `rclone copy` إلى Google Drive (`gdrive:dar-backups/dar/db`) مع تحقق الحجم دائمًا وSHA-256 عند دعم الريموت؛ فشل الرفع = exit non-zero + تنبيه عبر `dar-healthcheck`.
- Retention: يحتفظ بآخر **BACKUP_KEEP_COUNT=30 نسخة موثّقة** (لا حذف بالعمر فقط).
- `dar-healthcheck.timer` كل 6 ساعات + `dar-restore-drill.timer` أسبوعي (تدريب استرجاع مجدول).
- **NOT VERIFIED:** نوع rclone remote (crypt؟)، تشغيل الـtimers على الـhost الإنتاجي، واسترجاع فعلي كامل للنسخة offsite — راجع `docs/11-deployment.md` §11.

### 7.1 Restore (manual, never from web)

1. اختر أحدث نسخة تم التحقق منها (manifest + SHA).
2. أوقف `dar-legacy` و`dar-api` (لا كتابة).
3. استعد إلى قاعدة منفصلة:
   ```bash
   sudo -u postgres createdb dar_restore_check
   sudo pg_restore --no-owner --no-privileges -d dar_restore_check <dump>
   ```
4. تحقق: `app_users`، `web_schema_migrations`، عينات مالية، ثم `deploy/sql/integrity-checks.sql`.
5. أعد تشغيل الخدمات وافحص `/health/ready`.
6. اسجّل النتيجة ثم أسقط قاعدة الفحص.

**تدريب مجدول:** `deploy/scripts/restore-drill.sh` + `dar-restore-drill.timer` يستخدمان `/etc/dar/restore-drill.env` ويستعيدان إلى قواعد disposable فقط.

**لا تستعد فوق القاعدة الحية أبدًا.**

---

## 8. Deployment

### 8.1 Topology (live)

```
Cloudflare → Nginx:443 → SPA + legacy /api (5080) → PostgreSQL (127.0.0.1:5432)
                       ↘ /api/v1/* → new API (5081) → PostgreSQL
```

- `<deployment-host>` → Nginx؛ الـAPIs داخلية فقط.
- PostgreSQL غير منشور.
- Nginx يحمل TLS (Certbot) والـproxy buffers (إصلاح 502).

### 8.2 Host

- Ubuntu 24.04 LTS + systemd.
- `deploy` user للنشر (sudo)، `dar` user لتشغيل الخدمات.
- UFW: 22 restricted، 80، 443؛ fail2ban؛ unattended upgrades.
- **لا Docker لخدمات الإنتاج** (stack متقاعد وملفاته حُذفت من الريبو؛ الـhost قد يحتفظ بصور/volumes قديمة كـrollback فقط).

### 8.3 Services & Files

| Component | Notes |
|---|---|
| `nginx` | TLS + reverse proxy (`/etc/nginx/sites-available/dar-elemam-hafs` — copy في `deploy/nginx/`) |
| `dar-legacy.service` | SPA + `/api/*` على 5080 |
| `dar-api.service` | `/api/v1/*` على 5081 |
| `postgresql` | 17 على 127.0.0.1:5432 |
| `dar-meet-bot.service` (+ `dar-meet.slice`) | bot التسجيل على `/internal/meet` عبر loopback فقط (3.2+) |
| `dar-backup.timer` | dump يومي + manifest + offsite |
| `dar-healthcheck.timer` | خدمات/health/disk/عمر النسخة/شهادة كل 6h |
| `dar-restore-drill.timer` | تدريب استرجاع أسبوعي إلى قواعد disposable |
| `certbot.timer` | تجديد الشهادات |
| `/etc/dar/legacy.env` + `api.env` | 640 root:dar |
| `/etc/dar/backup.env` + `/etc/dar/healthcheck.env` + `/var/lib/dar/rclone/rclone.conf` | 600 dar:dar |
| `/opt/dar` | git checkout يتابع `origin/main` |

### 8.4 سكربتات النشر (موجودة ومُجرّبة — Phase 2.1)

- `deploy/preflight.sh`: فحص الخدمات/القاعدة/المساحة/حديث النسخة قبل أي تغيير.
- `deploy/update.sh`: **backup إلزامي → `--migrate` → publish → swap → restart → smoke → rollback تلقائي** عند الفشل (نقطة الدخول الوحيدة؛ قد تُقسَّم مساعداتها تحت `deploy/lib/` دون تغيير الترتيب).
- `deploy/rollback.sh`: استرجاع آخر نسخة binaries؛ قاعدة البيانات لا تُرجَع destructively (forward fix أو restore موثّق).
- `bootstrap-server.sh` / `setup-host-db.sh` / `setup-host-services.sh` / `setup-nginx.sh`: إعداد idempotent (إنشاء `dar`، buffers، pg_restore على قاعدة جديدة بعد نسخة).
- **ممنوع** تحديث الـhost يدويًا بدون المرور على `update.sh`.
- جرّبت العملية فعليًا في نشرات 22–24 Nov؛ المتبقي غير المتحقق هو rehearsal كامل لـ`rollback.sh` على الـhost.

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
| `<deployment-host>` | Cloudflare → host (live) |
| `www` | غير مُعد (redirect لاحقًا إن لزم) |
| `staging` | موجود على نفس الـhost عبر `http://<deployment-host>:8088/` وvhost منفصل (IP allow-list، بلا DNS/certificate) — `docs/staging-environment.md` |

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

1. Email provider (SMTP) لتفعيل OTP فعليًا.
2. Monitoring alert channel (Telegram/Email) + Uptime.
3. rclone OAuth client ID مخصص + تدوير Cloudflare token (قبل تقاعد shared client في 2026).
4. نشر دفعة التحصين (main حتى 040) إلى staging ثم الإنتاج — بموافقة المالك ونافذة نشر.
