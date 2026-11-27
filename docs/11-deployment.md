# RIGX Dar — Host + Domain Deployment

**Status:** Live on Contabo VPS <server-ip> at **https://<deployment-host>** (since 16 Nov 2026).
**Architecture:** Ubuntu 24.04 + Nginx + Certbot + systemd + host PostgreSQL 17 + .NET 10 + React 19/Vite.
**Last hardened:** 27 Nov 2026 — hardening batch (B7 slim admin cookie + ADR-0008، B10 scheme-aware cookie، staging، Z1 splits). راجع `docs/OVERNIGHT-REPORT.md` و`docs/23-hardening-plan.md`.
**Legacy note:** the earlier Docker/Caddy stack is retired; its files (`deploy/docker-compose.yml`, two Dockerfiles, `deploy/Caddyfile`) were **deleted from the repo** (Tier 2 / 2.15). Any host volumes left from that experiment are rollback copies only and are not used by live services.

> ✅ **Phase 2.1 scripts are exercised:** `deploy/update.sh` ran the full backup → pull → build → migrate → swap → smoke path in the 22–24 Nov deployments (e.g. `20261122-215854`, P0/P1 fixes). The update flow now lives in `deploy/update.sh` as the single entry point (helper libraries under `deploy/lib/` may change without changing the order below). What is still **NOT verified**: a full `rollback.sh` rehearsal on the production host and a fresh-host bootstrap run.

---

## 1. What Runs

| Component | Purpose | Public? |
|---|---|---|
| Nginx | TLS, HTTP→HTTPS, reverse proxy, security headers | Ports 80/443 |
| dar-legacy.service | legacy API + React SPA (/, /management, /teacher, /supervisor) + /api/* — 127.0.0.1:5080 | via Nginx |
| dar-api.service | /api/v1/* + /health/* — 127.0.0.1:5081 | via Nginx |
| PostgreSQL 17 | <database> database on 127.0.0.1:5432 | no |
| dar-backup.timer | daily pg_dump + manifest + Google Drive offsite (30-day retention) | no |
| dar-healthcheck.timer | every 6h: services, health, disk, backup age, TLS, nginx | no |
| dar-meet-bot.service (`dar-meet.slice`) | Meet recorder bot: Xvfb + PulseAudio + FFmpeg; calls `/internal/meet` on loopback only | no |
| dar-restore-drill.timer | weekly restore drill into disposable databases (`restore-drill.sh`) | no |

Routing:
- /api/v1/* → 127.0.0.1:5081
- everything else → 127.0.0.1:5080

---

## 2. Server Baseline

- Contabo Cloud VPS 4: 4 vCPU / 8 GB RAM / 100 GB SSD / 200 Mbit/s / EU.
- Ubuntu 24.04.5 LTS, timezone Africa/Cairo, 2 GB swap.
- Docker 29.x + Compose (installed by `bootstrap-server.sh`; **not used by live services** — the Docker/Caddy files were removed from the repo in Tier 2 / 2.15).
- .NET SDK 10.0.115, Node.js 24.22.3, PostgreSQL 17.12, Nginx 1.24.0, Certbot 2.9.0, rclone 1.60.1.
- UFW: 22, 80, 443. fail2ban sshd jail + unattended upgrades.
- SSH key-only for root/deploy; password auth disabled.
- Users: deploy (sudo + docker) and **dar** (system user, nologin, home /var/lib/dar) للملفات والخدمات.
- Directories: /opt/dar (git checkout, deploy:deploy)؛ /opt/dar/app/{legacy,api}؛ /var/lib/dar/{backups/db,deploy,logs,.local/share/DarEltahfeez/Logs}؛ /var/log/dar.
- Local SSH key: C:\Users\Abdalmlek\.ssh\dar_deploy_ed25519.

---

## 3. First Deploy (fresh host — الترتيب الإلزامي)

    1) scp deploy/bootstrap-server.sh deploy@<server-ip>:/root/
       ssh root@<server-ip> 'bash /root/bootstrap-server.sh'
       # OS bootstrap idempotent: users, dirs, docker, ufw, ssh, fail2ban, swap

    2) # Host packages: .NET 10, Node 24, PostgreSQL 17, Nginx, Certbot, rclone

    3) sudo mkdir -p /opt/dar && sudo chown deploy:deploy /opt/dar
       sudo -u deploy git clone git@github.com:Abdalmlek56M/darelemamhafs.git /opt/dar

    4) sudo bash deploy/setup-host-services.sh --skip-start   # env + systemd units

    5) sudo bash deploy/setup-host-backup.sh                  # backup + healthcheck timers

    6) sudo bash deploy/setup-nginx.sh
       sudo certbot --nginx -d <deployment-host> --non-interactive --agree-tos -m admin@example.invalid --redirect

    7) sudo bash deploy/setup-host-db.sh --dump /path/to/database.dump
       # قاعدة موجودة فيها بيانات: --confirm-restore ثم --confirm-restore --force

    8) sudo bash deploy/update.sh --allow-stopped-services    # أول نشر

    9) sudo systemctl status dar-legacy dar-api nginx postgresql
       sudo bash deploy/preflight.sh

**ملاحظات:** لا تعتمد على الترتيب القديم (docker cp / Caddy) — Docker stack متقاعد (القسم 10). DNS-01 مطلوب لهذا الدومين (القسم 5). أول تشغيل لـsetup-host-db على قاعدة غير فاضية يأخذ نسخة موثقة أولًا ويرفض بدون تأكيد.

---

## 4. Environment Files

- /etc/dar/legacy.env (root:dar, 640) — connection string, backup path, setup token (فارغ بعد bootstrap), TZ, forwarded headers.
- /etc/dar/api.env (root:dar, 640) — connection string, OTP pepper, SMTP, Google client ID.
- /etc/dar/backup.env (**dar:dar, 600**) — PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD، RCLONE_CONFIG، RCLONE_REMOTE، BACKUP_RETENTION_DAYS (اختياري).
- /etc/dar/healthcheck.env (اختياري، القيم الافتراضية كافية) — thresholds/URLs للـhealthcheck.
- /var/lib/dar/rclone/rclone.conf (dar:dar, 600، parent 0700) — Google Drive remote. لا تنقله تحت /etc/dar (rclone يحتاج كتابة token refresh).
- /opt/dar/deploy/.env (deploy:deploy, 600) — أسرار التثبيت الأصلية؛ مرجع فقط، لا يُرفع.
- deploy/.env.example — أسماء المتغيرات فقط.

**ممنوع:** أسرار في git/الوثائق/اللوجات. أي سكربت يقرأ الأسرار لا يطبعها. setup-host-services يخزّن نسخة من env القديم في /var/backups/dar-config/<stamp>/ قبل الكتابة.

---

## 5. Nginx + TLS

- Site file: /etc/nginx/sites-available/dar-elemam-hafs (يُولَّد من deploy/setup-nginx.sh — **مصدر الحقيقة**، مطابق لـdeploy/nginx/dar-elemam-hafs.conf).
- Rate limiting (FINAL 2.13): zones في `deploy/nginx/00-dar-ratelimit.conf` تُثبَّت إلى `/etc/nginx/conf.d/00-dar-ratelimit.conf` عبر setup-nginx.sh — `dar_auth` لـ`/api/auth/` (5r/m burst=10)، `dar_api` لـ`/api/v1/`، `dar_general` لبقية الموقع؛ `limit_req_status 429`.
- gzip مضبوط في server block (JSON/JS/CSS، `gzip_min_length 256`، level 5) داخل setup-nginx.sh والملف المرجعي.
- client_max_body_size 12m؛ proxy_buffer_size 32k / proxy_buffers 8 32k / proxy_busy_buffers_size 64k؛ proxy_read_timeout 120s/180s؛ server_tokens off.
- Security headers على مستوى Nginx: HSTS (TLS فقط)، X-Content-Type-Options، Referrer-Policy، X-Frame-Options: DENY، Permissions-Policy.
- X-Forwarded-Proto https صريح لأن Cloudflare يُنهي TLS.
- Certificate: /etc/letsencrypt/live/<deployment-host>/ — كتلة Certbot تُحفظ كما هي.
- Renewal: certbot.timer. **DNS-01** مُعد بعد فشل HTTP-01 عبر Cloudflare proxy:
  - Token: /root/.secrets/cloudflare.ini (600 root:root)، scoped Zone:DNS:Edit.
  - certbot renew --dry-run --no-random-sleep-on-renew يجب أن ينجح.
- أي تغيير في setup-nginx.sh يجب أن يحافظ على buffers (إصلاح 502) + headers؛ السكربت ينسخ النسخة القديمة إلى /var/backups/dar-config/<stamp>/ ويسترجعها تلقائيًا لو nginx -t فشل.

---

## 6. Backups (Phase 2.1 — manifest + verify)

**السكربت:** deploy/scripts/dar-backup.sh → مثبّت في /usr/local/bin/dar-backup عبر deploy/setup-host-backup.sh.
**التوقيت:** dar-backup.timer يوميًا ~02:30 Africa/Cairo (+randomized delay).
**الوجهات:** محلي /var/lib/dar/backups/db/ + Google Drive gdrive:dar-backups/dar/db/ (retention 30 يوم — BACKUP_RETENTION_DAYS).

**ماذا تنتج كل نسخة:**
- dar-<stamp>.dump — pg_dump -Fc.
- dar-<stamp>.manifest.json — schema_version، status(success/failed)، started/finished، hostname، database، file، size_bytes، sha256، toc_entries (من pg_restore --list)، server_version، web_schema_migrations count، retention_days، rclone_remote، offsite{status, uploaded, verified(size|size+sha256), size_bytes, sha256, error}، warnings[].
- .dump.sha256 (sidecar).

**التحقق:** pg_restore --list (TOC) + SHA-256 + التحقق من النسخة البعيدة (الحجم دائمًا؛ SHA-256 عند دعم الريموت — Google Drive غالبًا MD5/SHA1 فيسجّل verified=size). فشل النسخ البعيد لا يفقد النسخة المحلية، لكنه exit غير صفري + OnFailure=dar-healthcheck.service.
**قفل:** flock على <BACKUP_DIR>/.dar-backup.lock يمنع التداخل (تشغيل متراكب = WARN + exit 0).
**Retention:** يحذف dumps+manifests أقدم من 30 يوم محليًا وبعيدًا (فشل التنظيف = warning فقط).

**Manual verification:**

    sudo systemctl start dar-backup.service
    ls -lh /var/lib/dar/backups/db
    cat /var/lib/dar/backups/db/$(ls -t /var/lib/dar/backups/db | grep '.manifest.json' | head -1)
    sudo -u dar rclone --config /var/lib/dar/rclone/rclone.conf ls gdrive:dar-backups/dar/db/

**Restore drill (شهري — لا تُعدّل قاعدة حية):**

    sudo -u postgres createdb dar_restore_check
    sudo -u postgres pg_restore --clean --if-exists --no-owner --dbname=dar_restore_check /var/lib/dar/backups/db/dar-<stamp>.dump
    sudo -u postgres psql -d dar_restore_check -c "select count(*) from app_users; select count(*) from web_schema_migrations;"
    sudo -u postgres dropdb dar_restore_check

---

## 7. Operations (Runbooks)

### 7.1 Preflight (قبل أي تحديث)

    sudo bash deploy/preflight.sh                   # exit 0 = جاهز، 1 = blockers
    sudo bash deploy/preflight.sh --allow-inactive   # لأول نشر قبل تشغيل الخدمات

يفحص: git branch/dirty/remote، deploy/.env وصلاحياته، /etc/dar/*.env (640 root:dar) وOTP pepper، toolchain، الخدمات، /health/ready 5080/5081، nginx -t، الشهادة (<7 أيام فشل، <21 تحذير)، القرص (used>85% فشل، >75% تحذير)، عمر آخر backup (<26h)، pg_isready، وجود البيناريز/SPA.

### 7.2 Update (كل نشر)

    sudo bash deploy/update.sh --dry-run    # اطبع الخطة بدون أي تغيير
    sudo bash deploy/update.sh              # التنفيذ الكامل

الترتيب الثابت (FINAL 2.8): **flock واحد** (نشر متزامن واحد فقط عبر `/var/lib/dar/deploy/update.lock`) → preflight → **نسخة DB إلزامية** (pg_dump -Fc + pg_restore --list + sha256) → git pull --ff-only → **CI/quality gate** (`bash -n` لكل سكربتات deploy + `node --check` + suites `tier2-deploy`/`backup-source`/`repo-secrets`؛ يُتخطّى فقط بـ`--skip-quality-gate` ويُسجَّل في last-deploy.env) → build (npm ci + npm run build + dotnet publish للاثنين + dist→wwwroot، و**meet-bot** يُبنى إلى `/opt/dar-meet-bot.new` إن كان مثبَّتًا) → migrations (--migrate بـProduction) → تحقق عدد web_schema_migrations = عدد database/*.sql → stop services → swap إلى /opt/dar/app/*.old.<stamp> (و`/opt/dar-meet-bot.old.<stamp>`) → start + readiness + انتظار بقاء dar-meet-bot active → **smoke سبع نقاط** (/health/ready 5080/5081، /، /management، /teacher، /supervisor، /api/v1/ping) → **login حقيقي + قراءة مالية واحدة** من `/etc/dar/smoke.env` (لا تُطبع الأسرار؛ يُتخطّى بتحذير إن لم توجد، ورفض الاعتماد ليس فشلًا إلا مع `DAR_SMOKE_STRICT=1`) → عند أي فشل: **rollback تلقائي للبيناريز + البوت** (قاعدة البيانات لا تُرجع تلقائيًا) → retention (آخر 5 نسخ app/bot + 30 يوم dumps) → state في /var/lib/dar/deploy/last-deploy.env + log في /var/log/dar/update-<stamp>.log.
خيارات: --skip-build (إعادة استخدام legacy.new/api.new/بوت من محاولة متوقفة)، --allow-stopped-services (أول نشر فقط)، --skip-quality-gate (طوارئ موثَّقة فقط).
**livekit ليس جزءًا من update.sh** ولا يُثبَّت تلقائيًا (راجع القسم 11).

### 7.3 Rollback (طوارئ)

**أ) بيناريز فقط (الافتراضي — لا يلمس قاعدة البيانات):**

    sudo bash deploy/rollback.sh --list
    sudo bash deploy/rollback.sh <stamp>

لا يلمس قاعدة البيانات. لو فشل smoke بعد rollback يعيد البيناريز الحالية تلقائيًا.

**ب) قاعدة البيانات (يدوي بالكامل، لا يعمل تلقائيًا أبدًا — FINAL 2.9):**

    sudo bash deploy/rollback-db.sh --list
    sudo bash deploy/rollback-db.sh --backup /var/lib/dar/backups/db/dar-pre-deploy-<stamp>.dump
    sudo bash deploy/rollback-db.sh --backup /var/lib/dar/backups/db/dar-pre-deploy-<stamp>.dump --confirm
    sudo bash deploy/rollback-db.sh --revert --confirm    # العودة لقاعدة ما قبل الـrollback

يسترجع dump ما قبل النشر في **قاعدة جديدة** `dar_rollback_<stamp>`، يتحقق من العدّادات والـledger، ينسخ `/etc/dar/*.env` إلى `/var/backups/dar-config/` ثم يوجّه `Database=`/`PGDATABASE=` للقاعدة الجديدة، يعيد تشغيل dar-legacy + dar-api (+ dar-meet-bot إن وُجد) وينتظر `/health/ready`. القاعدة الحيّة **لا تُسترجع فوقها ولا تُحذف ولا تُعاد تسميتها**؛ عند فشل إعادة التشغيل تُستعاد env تلقائيًا. تفاصيل البوابة والتحقق والرجوع: `docs/runbooks/rollback-db.md`.

### 7.4 Status / Logs / Restart

    systemctl status nginx postgresql dar-legacy dar-api
    systemctl list-timers 'dar-backup.timer' 'dar-healthcheck.timer' 'certbot.timer'
    journalctl -u dar-legacy -f
    journalctl -u dar-api -f
    tail -f /var/log/nginx/error.log
    sudo bash deploy/scripts/dar-healthcheck.sh --json
    ls -t /var/log/dar | head
    sudo systemctl restart dar-legacy dar-api
    sudo systemctl reload nginx

### 7.5 Healthcheck

    sudo bash deploy/scripts/dar-healthcheck.sh           # نصي
    sudo bash deploy/scripts/dar-healthcheck.sh --json    # للآلة (JSON مبني بـjq)

يفحص (FINAL 2.10): خدمات systemd، /health/ready 5080/5081، /api/v1/ping، **PostgreSQL مباشرة** (SELECT 1 + عدّاد web_schema_migrations ببيانات `/etc/dar/backup.env`)، business-integrity SQL، القرص >15%، عمر آخر backup <26h + وجود ملف الدمب، نتيجة آخر dar-backup.service، **حداثة النسخة البعيدة (offsite) من `.offsite.status/finished_at`**، شهادة TLS >14 يوم، nginx -t، **meet-bot** (dar-meet-bot.service إن كان مثبتًا؛ غير مثبَّت = ok)، و**LiveKit** (اختياري: auto فقط إن كان dar-livekit.service موجودًا). exit 0 = ok/warning، 1 = critical، 2 = usage؛ HEALTHCHECK_STRICT=1 يجعل التحذيرات فشلًا. الـlibs تُثبَّت إلى `/usr/local/lib/dar/healthcheck/`. التنبيهات: **Telegram opt-in** عبر `HEALTHCHECK_TELEGRAM_BOT_TOKEN` + `HEALTHCHECK_TELEGRAM_CHAT_ID` في `/etc/dar/healthcheck.env` (يُرسل عند warning/critical؛ التوكن لا يظهر في argv/output). `--json` يتطلب jq. dar-healthcheck.timer كل 6 ساعات + OnFailure من dar-backup.service.

### 7.6 Update from Git (الطريقة القديمة — أُلغيت)

git pull + restart فقط **ممنوع** الآن. المسار المعتمد هو update.sh لأنه يضمن backup + migrations + smoke + rollback. إن احتجت git يدويًا: cd /opt/dar ثم git pull --ff-only لقراءة التغييرات فقط، ثم sudo bash deploy/update.sh.

---

## 8. Smoke Checklist (بعد كل نشر)

- [x] https://<deployment-host>/ → 200
- [x] /health/ready → database connected
- [x] /api/v1/ping → ok
- [x] Admin login + /api/auth/me → permissions
- [x] /management، /teacher، /supervisor → 200
- [x] Full backup created (.dump + .manifest.json + .sha256 + TOC)
- [x] dar-healthcheck.service → exit 0 (أو warnings معروفة)
- [x] UFW active؛ password SSH disabled؛ fail2ban active
- [x] Cloudflare DNS-01 renewal + dry-run
- [x] Offsite rclone copy + verification
- [x] GitHub deploy key + git pull (عبر update.sh)
- [x] Restore drill (شهري)
- [x] Admin password changed؛ ملفات أسرار مؤقتة محذوفة

---

## 9. GitHub Deploy Key

The server's read-only deploy key:

    ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILYgHunQJEMXH3Mx5blGCqvkHHwjtcRc4qPdosx6pcub dar-server-deploy

Added to GitHub. /opt/dar is a Git checkout tracking origin/main:

    cd /opt/dar
    git fetch origin
    git reset --hard origin/main
    git branch --set-upstream-to=origin/main main
    git pull --ff-only

.env، app/، backups/ غير متتبعة وتبقى في مكانها.

---

## 10. Retired Docker Stack (removed from the repo)

`deploy/docker-compose.yml`، `deploy/legacy.Dockerfile`، `deploy/api.Dockerfile` و`deploy/Caddyfile`
**حُذفت من الريبو** (Tier 2 / 2.15) — لا توجد أي ملفات Compose/Dockerfile/Caddy متتبعة الآن.
الـhost قد يحتفظ بصور/volumes قديمة من التجربة الأولى؛ هي نسخة rollback فقط وممنوع الاعتماد عليها.
`bootstrap-server.sh` ما زال يثبّت Docker على host جديد، لكن خدمات الإنتاج (Nginx/systemd/PostgreSQL host) لا تستخدمه.

---

## 11. Known Gaps / Pending (27 Nov 2026)

- **Production is behind the repo:** الإنتاج على ledger **26/26** وcommit `a823b32` حتى آخر نشر مسجل (22 Nov 2026). `main` يحمل دفعات التحصين حتى migrations **040** (+ 039/040 في دفعة batch 2) — لا تدّعِ أي سلوك إنتاجي جديد قبل نشر موثّق.
- **Deploy tooling under cleanup:** عملية النشر موثّقة أعلاه، لكن `deploy/update.sh` ومساعداته تحت تنظيف/tقسيم (batch 2)؛ نقطة الدخول المعتمدة تبقى `sudo bash deploy/update.sh`. لا regression deploy تلقائي.
- **rclone 1.60.1 يستخدم shared Google Drive client ID المخطط لإيقافه خلال 2026** — أنشئ OAuth client ID مخصص وأعد تفويض gdrive:؛ راقب النسخ أسبوعيًا حتى ذلك.
- **تناوب Cloudflare API token** الذي شارك في محادثة سابقة — بدّل /root/.secrets/cloudflare.ini ثم certbot renew --dry-run.
- **تناوب Google OAuth grant** إن كان التفويض سبق تعريض token.
- **dar-healthcheck.timer / dar-restore-drill.timer:** الوحدات والتنبيهات موجودة في الريبو؛ التشغيل الفعلي على الـhost ونتيجة drill حقيقية لم تُوثَّقا بعد.
- **الواجهة الإنجليزية** مؤجلة (ADR-0004)؛ الواجهة عربية فقط الآن.
- **الـmonitoring** الحالي = healthcheck timer + journal؛ لا Uptime Kuma/تنبيهات خارجية بعد (Phase 2.7).
- **أي تعديل على setup-nginx.sh** يجب أن يطابق الـvhost الفعلي (buffers/timeouts/12m/certbot) — ستُضاف خطوة diff في preflight لاحقًا.
- **Teacher/supervisor/notification APIs** live (migration 017+، Dar.Modules.Teaching). Supervisor temp password: change + delete `/etc/dar/supervisor-initial-password` إن وُجد.
- **Production E2E** غير موجود بعد (Phase 2.5/2.9)؛ كل smoke يدوي حاليًا.
- **staging environment** منفصل على نفس الـhost — راجع `docs/staging-environment.md` (IP allow-list، plain HTTP، cookie nosecure shim).
- **DB roles + PostgreSQL tuning (FINAL 2.13):** السكربتات والوثائق جاهزة في الريبو (`deploy/setup-host-db-roles.sh` + `deploy/sql/db-roles.sql` + `deploy/postgresql/dar-postgresql-tuning.conf` + `docs/runbooks/db-roles-and-tuning.md`) لكنها **لم تُطبَّق على أي host** — نشرها قرار مالك (owner action) بعد مراجعة الكوتا/الذاكرة.
- **LiveKit M0 spike (FINAL 2.14):** المؤشِّر أصبح feature-flagged: التثبيت يتطلب `--enable-livekit-test`، التنزيل يتحقق من SHA-256 مثبَّت، صفحة الاختبار العامة `/live-test/` (CDN) لم تعد تُثبَّت/تُوجَّه افتراضيًا، وفتح/إغلاق منافذ 7881/7882 **إجراء مالك**. **BLOCKED** على الـlive host: إغلاق 7881/tcp + 7882/udp إن كانا مفتوحين من التجربة السابقة — راجع `docs/runbooks/livekit-m0.md`.
- **Healthcheck/alerts:** التنبيه الخارجي الموجود الآن هو Telegram opt-in داخل healthcheck؛ لا Uptime Kuma/تنبيهات منفصلة بعد.
