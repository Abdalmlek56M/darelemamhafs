import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// FINAL 0.9: source-level contract for the backup tooling. These checks fail when a
// required artifact class or the verified-retention policy is removed.
const script = readFileSync('deploy/scripts/dar-backup.sh', 'utf8');
const envExample = readFileSync('deploy/backup.env.example', 'utf8');

assert.match(script, /pg_dumpall --globals-only/, 'backup does not dump cluster globals');
assert.match(script, /BACKUP_CONFIG_FILES/, 'backup does not archive config files');
assert.match(script, /BACKUP_KEY_DIRS/, 'backup does not archive the encryption key material');
assert.match(script, /BACKUP_MEDIA_ENABLED/, 'backup has no media option');
assert.match(script, /rclone[^\n]*config show/, 'backup does not inspect the rclone remote type');
assert.match(script, /OFFSITE_ENCRYPTED/, 'backup manifest does not report off-site encryption');
assert.match(script, /BACKUP_KEEP_COUNT/, 'backup retention is not count-based');
assert.match(script, /BACKUP_REQUIRED_TABLES/, 'backup does not validate required TABLE DATA');
assert.match(script, /TABLE DATA public/, 'backup does not check per-table data entries');
assert.equal(/-mtime "\+\$RETENTION_DAYS" -delete/.test(script), false, 'retention still deletes by age alone');
assert.match(script, /prune_local_backups/, 'verified-retention pruner is missing');
assert.match(envExample, /BACKUP_KEEP_COUNT/, 'backup.env.example does not document keep count');
assert.match(envExample, /BACKUP_MEDIA_ENABLED/, 'backup.env.example does not document media backups');

const drill = readFileSync('deploy/scripts/restore-drill.sh', 'utf8');
assert.match(drill, /RESTORE_DRILL_PROD_DB/, 'restore drill has no configurable database name');
assert.equal(drill.includes('gdrive:dar-backups'), false, 'restore drill hardcodes the off-site remote');
assert.ok(existsSync('deploy/systemd/dar-restore-drill.timer'), 'restore drill timer is missing');
assert.match(readFileSync('deploy/setup-host-backup.sh', 'utf8'), /dar-restore-drill\.timer/, 'installer does not enable the restore drill timer');
assert.match(readFileSync('deploy/scripts/dar-healthcheck.sh', 'utf8'), /check_integrity/, 'healthcheck does not run the integrity SQL');
assert.ok(existsSync('deploy/sql/integrity-checks.sql'), 'shared integrity SQL is missing');
const syntax = spawnSync('bash', ['-n', 'deploy/scripts/dar-backup.sh'], { encoding: 'utf8' });
assert.equal(syntax.status, 0, 'dar-backup.sh has a bash syntax error: ' + syntax.stderr);

console.log(JSON.stringify({ suite: 'backup-source', ok: true, cases: 5 }));
