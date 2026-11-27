#!/usr/bin/env bash
# =============================================================================
# Dar production update - backup, pull, quality gate, build, migrate, swap,
# smoke (incl. real login + money read), meet-bot, roll back
# =============================================================================
# Purpose : one safe command to deploy the current origin/main commit to the
#           production host (Ubuntu 24.04 + Nginx + systemd + PostgreSQL 17).
# Requires: root, or the deploy user with passwordless sudo.
#           A git checkout at /opt/dar tracking origin/main.
#           deploy/.env, /etc/dar/api.env, published backup timer.
# Usage   : sudo bash deploy/update.sh [--dry-run] [--skip-build]
#                    [--allow-stopped-services] [--skip-quality-gate]
#
# Order of operations (never reordered):
#   1. single-deploy flock (update.lock): a second concurrent deploy fails fast.
#   2. preflight (deploy/preflight.sh) - read-only checks, abort on blockers;
#      also detects an installed meet recorder bot.
#   3. mandatory database backup: pg_dump -Fc + pg_restore --list + sha256.
#   4. git pull --ff-only (aborts on dirty tree or diverged history).
#   5. CI/quality gate: bash -n every deploy script, node --check + run the
#      tier2-deploy / backup-source / repo-secrets static-contract suites.
#      --skip-quality-gate skips it explicitly (recorded in the deploy state).
#   6. build: npm ci + npm run build, dotnet publish legacy + api; when the meet
#      recorder bot is installed, also build it into /opt/dar-meet-bot.new.
#   7. migrations: dotnet run --project src/Host/Dar.Api -- --migrate.
#   8. verify web_schema_migrations count equals database/*.sql count.
#   9. stop services, swap binaries (+ optional meet-bot build), start services.
#  10. smoke: /health/ready (5080 + 5081), /, /management, /teacher,
#      /supervisor, /api/v1/ping; then, when /etc/dar/smoke.env provides
#      credentials, a real POST /api/auth/login followed by one money read
#      (GET /api/collections). On failure: automatic binary rollback.
#  11. retention: keep the last 5 app/bot copies and 30 days of pre-deploy dumps.
#  12. succinct summary + log path + rollback commands.
#
# Safety:
#   * The database is never rolled back automatically. Migrations are additive;
#     a failed binary swap is undone with the previous binaries while the schema
#     stays forward-compatible. A manual DB rollback (restore the pre-deploy dump
#     into a fresh database, point the env files at it, restart) is documented in
#     docs/runbooks/rollback-db.md and lives in deploy/rollback-db.sh.
#   * No secret is ever printed. Database credentials are read from
#     /etc/dar/backup.env (preferred) or /etc/dar/api.env; smoke credentials from
#     /etc/dar/smoke.env (or DAR_SMOKE_* env vars) are written to 0600 temp files,
#     never passed on the command line and never logged.
#   * --dry-run prints the plan and changes nothing (no lock, no backup).
#   * --skip-build reuses app/legacy.new + app/api.new (and the staged bot build)
#     from a previous interrupted run.
#   * --allow-stopped-services is only for the very first deploy.
#
# Layout:
#   This file is only the entry point. The implementation lives in small,
#   single-responsibility files under deploy/lib/ (sourced in the order listed by
#   deploy/lib/update-functions.sh): configuration/args, single-deploy lock +
#   quality gate, credentials, preflight, database backup + migrations, build,
#   swap, health/smoke, binary rollback, retention, deploy state and the main
#   sequence.
# =============================================================================
# shellcheck disable=SC1091
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib/update-functions.sh
. "$SCRIPT_DIR/lib/update-functions.sh"

main "$@"
