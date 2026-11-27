import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// FINAL Tier 2.8-2.14: source-level contracts for the deploy tooling. These checks
// fail when a hardening step is removed: single-deploy flock, CI/quality gate,
// meet-bot build/swap/restart, post-swap login+money smoke, manual DB rollback,
// healthcheck alerting/checks, nginx rate limiting+gzip, DB roles/tuning, and the
// feature-flagged + checksum-verified LiveKit spike.
const files = {
  updateSh: 'deploy/update.sh',
  config: 'deploy/lib/update-config.sh',
  funcs: 'deploy/lib/update-functions.sh',
  lock: 'deploy/lib/update-lock.sh',
  main: 'deploy/lib/update-main.sh',
  preflight: 'deploy/lib/update-preflight.sh',
  build: 'deploy/lib/update-build.sh',
  swap: 'deploy/lib/update-swap.sh',
  health: 'deploy/lib/update-health.sh',
  rollbackBin: 'deploy/rollback.sh',
  rollbackDb: 'deploy/rollback-db.sh',
  rollbackDbHelpers: 'deploy/lib/rollback-db-helpers.sh',
  hc: 'deploy/scripts/dar-healthcheck.sh',
  hcChecks: 'deploy/scripts/lib/healthcheck-checks.sh',
  hcChecksOps: 'deploy/scripts/lib/healthcheck-checks-ops.sh',
  hcReport: 'deploy/scripts/lib/healthcheck-report.sh',
  setupNginx: 'deploy/setup-nginx.sh',
  nginxRef: 'deploy/nginx/dar-elemam-hafs.conf',
  nginxZones: 'deploy/nginx/00-dar-ratelimit.conf',
  rolesSql: 'deploy/sql/db-roles.sql',
  rolesSetup: 'deploy/setup-host-db-roles.sh',
  tuning: 'deploy/postgresql/dar-postgresql-tuning.conf',
  lkInstaller: 'deploy/livekit/install-livekit-test.sh',
  lkNginx: 'deploy/livekit/nginx-livekit-locations.conf',
  lkPageDisabled: 'deploy/livekit/nginx-livekit-test-page.conf.disabled',
  lkReadme: 'deploy/livekit/README.md',
  lkRunbook: 'docs/runbooks/livekit-m0.md',
  rollbackRunbook: 'docs/runbooks/rollback-db.md',
  deploymentDoc: 'docs/11-deployment.md',
  envExample: 'deploy/.env.example',
  smokeExample: 'deploy/smoke.env.example',
  meetSetup: 'deploy/setup-host-meet.sh',
  meetUnit: 'deploy/systemd/dar-meet-bot.service',
};
for (const [name, path] of Object.entries(files)) {
  assert.ok(existsSync(path), `${name} is missing: ${path}`);
}
const source = Object.fromEntries(Object.entries(files).map(([name, path]) => [name, readFileSync(path, 'utf8')]));

const cases = [];
const failures = [];
function check(name, fn) {
  try {
    fn();
    cases.push(name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
const must = (text, pattern, message) => assert.match(text, pattern, message);
const lineCount = (text) => text.split('\n').length;
const indexOf = (text, needle, label) => {
  const index = text.indexOf(needle);
  assert.notEqual(index, -1, `${label}: '${needle}' not found`);
  return index;
};

// ---------------------------------------------------------------------------
// 2.8 update.sh hardening: lock, quality gate, meet-bot, login+money smoke
// ---------------------------------------------------------------------------
check('update sources lock + quality libs', () => {
  must(source.funcs, /update-lock\.sh/, 'aggregator does not source deploy/lib/update-lock.sh');
  must(source.lock, /acquire_deploy_lock/, 'lock lib has no acquire function');
  must(source.lock, /release_deploy_lock/, 'lock lib has no release function');
});

check('single concurrent deploy uses flock', () => {
  must(source.lock, /command -v flock/, 'lock lib does not require the flock utility');
  must(source.lock, /exec 9>"\$LOCK_FILE"/, 'lock lib does not hold fd 9 on the lock file');
  must(source.lock, /flock -n 9/, 'lock lib does not take a non-blocking flock');
  must(source.lock, /another deploy is already running/, 'lock lib has no clear "already running" failure');
  must(source.config, /LOCK_FILE=/, 'update config does not define the lock file');
  must(source.main, /acquire_deploy_lock/, 'main does not acquire the deploy lock');
  must(source.lock, /release_deploy_lock/, 'main does not release the lock (EXIT trap helper missing)');
  const acquire = indexOf(source.main, 'acquire_deploy_lock', 'main lock call');
  const backup = indexOf(source.main, 'take_db_backup', 'main backup call');
  assert.ok(acquire < backup, 'deploy lock must be taken before the DB backup/build work');
});

check('CI/quality gate is on by default and skippable only by flag', () => {
  must(source.config, /--skip-quality-gate/, 'update config does not parse --skip-quality-gate');
  must(source.config, /SKIP_QUALITY_GATE=0/, 'quality gate is not enabled by default');
  must(source.lock, /run_quality_gate\(\)/, 'quality gate function is missing');
  must(source.lock, /bash -n/, 'quality gate does not run bash -n');
  must(source.lock, /node --check/, 'quality gate does not run node --check');
  must(source.lock, /tier2-deploy/, 'quality gate does not run the tier2-deploy contract suite');
  must(source.lock, /backup-source/, 'quality gate does not run the backup-source suite');
  must(source.lock, /repo-secrets/, 'quality gate does not run the secret-scan suite');
  must(source.updateSh, /--skip-quality-gate/, 'update.sh header does not document --skip-quality-gate');
  const gate = indexOf(source.main, 'run_quality_gate', 'main gate call');
  const build = indexOf(source.main, 'build_and_stage', 'main build call');
  assert.ok(gate < build, 'quality gate must run after git pull and before building');
});

check('meet-bot is built, swapped and restarted only when its deploy path exists', () => {
  for (const path of [files.meetSetup, files.meetUnit, 'services/meet-recorder/package.json']) {
    assert.ok(existsSync(path), `meet-bot deploy path is missing: ${path}`);
  }
  must(source.config, /MEET_BOT_DIR=/, 'update config has no meet-bot dir');
  must(source.config, /MEET_BOT_SERVICE=/, 'update config has no meet-bot unit name');
  must(source.preflight, /detect_meet_bot/, 'preflight does not detect an installed meet-bot');
  must(source.build, /stage_meet_bot\(\)/, 'build lib does not stage the meet-bot');
  must(source.build, /npm run build/, 'meet-bot staging does not build the bot');
  must(source.swap, /swap_meet_bot\(\)/, 'swap lib does not swap the meet-bot');
  must(source.swap, /MEET_BOT_SERVICE/, 'swap lib does not restart the meet-bot service');
  must(source.health, /wait_meet_bot_active/, 'health lib does not wait for the meet-bot to stay active');
  must(source.preflight, /MEET_BOT_ENABLED=1/, 'preflight never enables the optional bot');
});

check('post-swap smoke performs a real login + one money read without printing secrets', () => {
  must(source.health, /smoke_login_and_money_read\(\)/, 'login/money smoke function is missing');
  must(source.health, /\/api\/auth\/login/, 'login smoke does not call the real login endpoint');
  must(source.health, /\/api\/collections/, 'login smoke does not perform a money read');
  must(source.health, /--data @"\$payload"/, 'login smoke must read the JSON body from a file, not argv');
  must(source.health, /SMOKE_ENV_FILE/, 'login smoke does not read the credentials env file');
  must(source.health, /mktemp/, 'login smoke does not use private temporary files');
  assert.equal(/curl[^\n]*PASSWORD/.test(source.health), false, 'login smoke passes a password in argv');
  assert.equal(/echo[^\n]*SMOKE_PASSWORD/.test(source.health), false, 'login smoke echoes the password');
  const restart = indexOf(source.health, 'restart_and_smoke()', 'health restart function');
  assert.ok(restart < source.health.indexOf('smoke_login_and_money_read', restart), 'restart_and_smoke does not run the login smoke');
  must(source.main, /restart_and_smoke/, 'main never calls restart_and_smoke (and its login smoke)');
  must(source.smokeExample, /SMOKE_USERNAME/, 'smoke.env.example does not document the username key');
  must(source.smokeExample, /SMOKE_PASSWORD/, 'smoke.env.example does not document the password key');
  assert.equal(/test-token|production-password/.test(source.smokeExample), false, 'smoke example contains a real-looking secret');
});

check('first-deploy and migrations-before-swap order are preserved', () => {
  must(source.updateSh, /--allow-stopped-services/, 'first-deploy flag disappeared from update.sh');
  must(source.preflight, /--allow-inactive/, 'preflight no longer forwards --allow-inactive for first deploy');
  const migrations = indexOf(source.main, 'apply_migrations', 'main migrations call');
  const swap = indexOf(source.main, 'swap_binaries', 'main swap call');
  assert.ok(migrations < swap, 'migrations must be applied before the binary swap');
  must(source.main, /take_db_backup/, 'mandatory pre-deploy backup disappeared');
  const backup = indexOf(source.main, 'take_db_backup', 'main backup call');
  const pull = indexOf(source.main, 'git_update', 'main git call');
  assert.ok(backup < pull, 'the pre-deploy backup must happen before git pull/build');
});

// ---------------------------------------------------------------------------
// 2.9 database rollback: fresh DB + env repoint + explicit confirm gate
// ---------------------------------------------------------------------------
check('rollback-db restores into a fresh database, repoints env, requires --confirm', () => {
  const rollbackDbAll = `${source.rollbackDb}\n${source.rollbackDbHelpers}`;
  for (const needle of ['--confirm', '--revert', '--list', 'createdb', 'pg_restore', 'ConnectionStrings', 'PGDATABASE']) {
    assert.ok(rollbackDbAll.includes(needle), `rollback-db.sh is missing '${needle}'`);
  }
  must(rollbackDbAll, /dar_rollback_/, 'rollback-db target DB is not a fresh dar_rollback_* database');
  must(rollbackDbAll, /systemctl restart dar-legacy\.service dar-api\.service/, 'rollback-db does not restart the services');
  must(rollbackDbAll, /refusing|REFUSING/i, 'rollback-db has no refusal/confirm gate');
  must(rollbackDbAll, /CURRENT_DB/, 'rollback-db does not compare the target against the live database');
  must(rollbackDbAll, /never (touched|dropped|restored)/i, 'rollback-db does not state the live-DB safety guarantee');
  must(source.rollbackRunbook, /rollback-db\.sh/, 'rollback runbook does not reference rollback-db.sh');
  must(source.rollbackRunbook, /--confirm/, 'rollback runbook does not document the confirm gate');
  must(source.rollbackRunbook, /fresh/i, 'rollback runbook does not explain the fresh-database restore');
  must(source.deploymentDoc, /rollback-db\.sh/, 'docs/11-deployment.md does not point at the DB rollback path');
});

check('database rollback is never automatic', () => {
  const lines = source.main.split('\n').filter((line) => line.includes('rollback-db.sh'));
  assert.ok(lines.length > 0, 'update main does not even print the manual DB rollback command');
  for (const line of lines) {
    assert.ok(/echo /.test(line), `update main runs rollback-db.sh instead of only printing it: ${line.trim()}`);
  }
  assert.equal(/rollback_db|rollbackDb/.test(source.lock + source.build + source.swap + source.health), false, 'an update lib calls the DB rollback');
  must(source.rollbackBin, /rollback-db\.sh/, 'binary rollback does not point operators at the manual DB rollback');
});

// ---------------------------------------------------------------------------
// 2.10 healthcheck: telegram, meet bot, livekit, postgres, off-site, jq JSON
// ---------------------------------------------------------------------------
check('healthcheck has telegram, meet-bot, livekit, postgres, off-site checks', () => {
  must(source.hc, /HEALTHCHECK_TELEGRAM_BOT_TOKEN/, 'healthcheck has no opt-in Telegram token env');
  must(source.hc, /HEALTHCHECK_TELEGRAM_CHAT_ID/, 'healthcheck has no Telegram chat id env');
  must(source.hcReport, /api\.telegram\.org/, 'healthcheck does not call the Telegram API');
  must(source.hcReport, /--config "\$cfg"/, 'Telegram token would be visible in argv (no curl --config)');
  must(source.hcReport, /rm -f -- "\$cfg"/, 'Telegram curl config file is not deleted');
  must(source.hcChecksOps, /check_meet_bot\(\)/, 'healthcheck has no meet-bot check');
  must(source.hcChecksOps, /check_livekit\(\)/, 'healthcheck has no LiveKit check');
  must(source.hcChecks, /check_postgres\(\)/, 'healthcheck has no direct PostgreSQL check');
  must(source.hcChecks, /check_backup_offsite\(\)/, 'healthcheck has no off-site backup freshness check');
  for (const checkName of ['check_meet_bot', 'check_livekit', 'check_postgres', 'check_backup_offsite']) {
    assert.ok(source.hc.includes(`${checkName}\n`) || source.hc.includes(checkName), `entry point does not run ${checkName}`);
  }
  must(source.hc, /OFFSITE_MAX_AGE_HOURS/, 'healthcheck has no off-site freshness threshold');
  assert.equal(lineCount(source.hc) > 400, false, 'dar-healthcheck.sh exceeds the 400-line file limit (split the libs)');
});

check('healthcheck JSON is built with jq and still exits non-zero on failures', () => {
  must(source.hc, /jq is required for --json/, '--json does not fail clearly when jq is missing');
  must(source.hcReport, /jq -n/, 'JSON document is not built with jq -n');
  must(source.hcReport, /jq -R -s/, 'healthcheck checks are not serialised with jq');
  must(source.hc, /EXIT_CODE=1/, 'healthcheck no longer exits 1 on critical failures');
  must(source.hc, /exit "\$EXIT_CODE"/, 'healthcheck no longer exits with the computed code');
});

// ---------------------------------------------------------------------------
// 2.13 nginx rate limiting + gzip, postgres tuning, separate DB roles
// ---------------------------------------------------------------------------
check('nginx reference config and generator have limit_req + gzip', () => {
  must(source.nginxRef, /limit_req zone=/, 'reference vhost has no limit_req');
  must(source.nginxRef, /gzip on;/, 'reference vhost has no gzip');
  must(source.setupNginx, /limit_req zone=/, 'setup-nginx.sh renders no limit_req');
  must(source.setupNginx, /gzip on;/, 'setup-nginx.sh renders no gzip');
  must(source.setupNginx, /00-dar-ratelimit\.conf/, 'setup-nginx.sh does not install the rate-limit zones');
  must(source.nginxZones, /limit_req_zone/, 'rate-limit zone definitions are missing');
  must(source.nginxZones, /zone=dar_auth/, 'no dedicated auth/login rate-limit zone');
  must(source.nginxRef, /zone=dar_auth/, 'auth location is not rate limited in the reference vhost');
  must(source.nginxZones, /limit_req_status 429/, 'limited requests do not return 429');
});

check('postgres tuning fragment + separate migrator/app/read_only roles exist', () => {
  must(source.tuning, /shared_buffers/, 'tuning fragment has no shared_buffers');
  must(source.tuning, /work_mem/, 'tuning fragment has no work_mem');
  must(source.tuning, /effective_cache_size/, 'tuning fragment has no effective_cache_size');
  must(source.tuning, /max_connections/, 'tuning fragment has no max_connections');
  must(source.tuning, /stock/i, 'tuning fragment does not document the stock defaults it replaces');
  must(source.rolesSql, /CREATE ROLE dar_migrator/, 'roles SQL does not create dar_migrator');
  must(source.rolesSql, /CREATE ROLE dar_app/, 'roles SQL does not create dar_app');
  must(source.rolesSql, /CREATE ROLE dar_read_only/, 'roles SQL does not create dar_read_only');
  must(source.rolesSql, /GRANT CONNECT ON DATABASE/, 'roles SQL has no database connect grants');
  must(source.rolesSql, /GRANT SELECT ON ALL TABLES.*dar_read_only/, 'read_only role has no table SELECT grant');
  must(source.rolesSql, /default_transaction_read_only = on/, 'read_only role can write');
  must(source.rolesSql, /\\gexec/, 'roles SQL is not idempotent (no \\gexec)');
  must(source.rolesSetup, /db-roles\.sql/, 'role setup wrapper does not apply db-roles.sql');
  must(source.rolesSetup, /--confirm/, 'role setup wrapper has no confirm gate');
  must(source.rolesSetup, /--dry-run/, 'role setup wrapper has no dry run');
  must(source.rolesSetup, /--transfer-ownership/, 'role setup wrapper cannot transfer ownership to dar_migrator');
  assert.equal(/echo[^\n]*\$(APP_PASSWORD|MIGRATOR_PASSWORD|READ_ONLY_PASSWORD)/.test(source.rolesSetup), false, 'role setup wrapper echoes a password');
  must(source.envExample, /DB_MIGRATOR_PASSWORD/, 'deploy/.env.example does not document the separate role passwords');
});

// ---------------------------------------------------------------------------
// 2.14 LiveKit M0 spike: feature flag, checksum, gated page, owner port action
// ---------------------------------------------------------------------------
check('LiveKit installer is feature-flagged and checksum-verified', () => {
  must(source.lkInstaller, /--enable-livekit-test/, 'installer has no explicit feature flag');
  must(source.lkInstaller, /LIVEKIT_TEST_ENABLED/, 'installer does not honour LIVEKIT_TEST_ENABLED');
  must(source.lkInstaller, /REFUSED/, 'installer does not refuse without the flag');
  must(source.lkInstaller, /sha256sum -c/, 'installer does not verify the tarball checksum');
  must(source.lkInstaller, /LIVEKIT_SHA256/, 'installer has no checksum override for other versions');
  must(source.lkInstaller, /PINNED_SHA256/, 'installer has no pinned digest');
  assert.equal(/LIVEKIT_ALLOW_UNVERIFIED/.test(source.lkInstaller), false, 'installer has an unverified-download escape hatch');
  must(source.lkInstaller, /--with-test-page/, 'test page installation is not opt-in');
  must(source.lkInstaller, /--open-media-ports/, 'media-port opening is not opt-in');
  const guard = source.lkInstaller.indexOf('if [ "$OPEN_MEDIA_PORTS" -eq 1 ]');
  assert.notEqual(guard, -1, 'installer has no OPEN_MEDIA_PORTS guard');
  assert.ok(guard < source.lkInstaller.indexOf('ufw allow 7881'), 'ufw opens 7881 outside the explicit opt-in branch');
});

check('LiveKit public CDN test page is gated out of main', () => {
  assert.equal(/location [^\n]*\/live-test\//.test(source.lkNginx), false, 'nginx-livekit-locations.conf still serves the public test page');
  assert.equal(source.lkNginx.includes('alias /var/www/live-test'), false, 'nginx-livekit-locations.conf still aliases the test page');
  must(source.lkNginx, /\/livekit\//, 'nginx-livekit-locations.conf lost the WSS signaling location');
  must(source.lkPageDisabled, /\/live-test\//, 'gated test-page location is missing');
  must(source.lkInstaller, /live-test-index\.html/, 'installer cannot install the gated test page');
  must(source.lkReadme, /BLOCKED/, 'LiveKit README does not mark the live-host actions BLOCKED');
  must(source.lkReadme, /7881/, 'LiveKit README does not document media ports 7881/7882');
  must(source.lkReadme, /ufw delete allow 7881/, 'LiveKit README does not document the owner port-closing action');
  must(source.lkRunbook, /BLOCKED/, 'LiveKit runbook does not mark the live-host actions BLOCKED');
  must(source.lkRunbook, /owner action/i, 'LiveKit runbook does not call the port cleanup an owner action');
});

// ---------------------------------------------------------------------------
// Syntax gates: bash -n for every deploy shell script
// ---------------------------------------------------------------------------
function listShellFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listShellFiles(full));
    } else if (entry.name.endsWith('.sh')) {
      out.push(full);
    }
  }
  return out;
}
function findBash() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe');
  }
  candidates.push('bash');
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-n', '-c', 'true'], { encoding: 'utf8', timeout: 5000 });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }
  return null;
}
check('bash -n every deploy shell script', () => {
  const shellFiles = listShellFiles('deploy');
  assert.ok(shellFiles.length > 0, 'no deploy shell scripts found');
  const bash = findBash();
  assert.ok(bash, 'bash not found; the deploy shell syntax gate cannot run');
  const failed = [];
  for (const file of shellFiles) {
    const result = spawnSync(bash, ['-n', file], { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) {
      failed.push(`${file}: ${(result.stderr || result.error || 'bash -n failed').trim().split('\n').slice(-2).join(' | ')}`);
    }
  }
  assert.equal(failed.length, 0, `bash -n failed: ${failed.join(' ; ')}`);
});

if (failures.length > 0) {
  console.error(`tier2-deploy contract failures (${failures.length}):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}
console.log(JSON.stringify({ suite: 'tier2-deploy', ok: true, cases: cases.length }));
