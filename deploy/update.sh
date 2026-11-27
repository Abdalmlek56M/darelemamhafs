#!/usr/bin/env bash
# =============================================================================
# Dar production update - backup, pull, build, migrate, swap, smoke, roll back
# =============================================================================
# Purpose : one safe command to deploy the current origin/main commit to the
#           production host (Ubuntu 24.04 + Nginx + systemd + PostgreSQL 17).
# Requires: root, or the deploy user with passwordless sudo.
#           A git checkout at /opt/dar tracking origin/main.
#           deploy/.env, /etc/dar/api.env, published backup timer.
# Usage   : sudo bash deploy/update.sh [--dry-run] [--skip-build] [--allow-stopped-services]
#
# Order of operations (never reordered):
#   1. preflight (deploy/preflight.sh) - read-only checks, abort on blockers.
#   2. mandatory database backup: pg_dump -Fc + pg_restore --list + sha256.
#   3. git pull --ff-only (aborts on dirty tree or diverged history).
#   4. build: npm ci + npm run build, dotnet publish legacy + api.
#   5. migrations: dotnet run --project src/Host/Dar.Api -- --migrate.
#   6. verify web_schema_migrations count equals database/*.sql count.
#   7. stop services, swap binaries, start services.
#   8. smoke: /health/ready (5080 + 5081), /, /management, /teacher,
#      /supervisor, /api/v1/ping. On failure: automatic binary rollback.
#   9. retention: keep the last 5 app copies and 30 days of pre-deploy dumps.
#  10. succinct summary + log path + rollback command.
#
# Safety:
#   * The database is never rolled back automatically. Migrations are additive;
#     a failed binary swap is undone with the previous binaries while the schema
#     stays forward-compatible.
#   * No secret is ever printed. Database credentials are read from
#     /etc/dar/backup.env (preferred) or /etc/dar/api.env.
#   * --dry-run prints the plan and changes nothing.
#   * --skip-build reuses app/legacy.new + app/api.new from a previous interrupted run.
#   * --allow-stopped-services is only for the very first deploy.
#
# Layout:
#   This file is only the entry point. The implementation lives in small,
#   single-responsibility files under deploy/lib/ (sourced in the order listed by
#   deploy/lib/update-functions.sh): configuration/args, credentials, preflight,
#   database backup + migrations, build, swap, health/smoke, binary rollback,
#   retention, deploy state and the main sequence.
# =============================================================================
# shellcheck disable=SC1091
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib/update-functions.sh
. "$SCRIPT_DIR/lib/update-functions.sh"

main "$@"
