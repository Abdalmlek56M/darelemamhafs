import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
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
assert.equal(/-mtime "\+\$RETENTION_DAYS" -delete/.test(script), false, 'retention still deletes by age alone');
assert.match(script, /prune_local_backups/, 'verified-retention pruner is missing');
assert.match(envExample, /BACKUP_KEEP_COUNT/, 'backup.env.example does not document keep count');
assert.match(envExample, /BACKUP_MEDIA_ENABLED/, 'backup.env.example does not document media backups');

const syntax = spawnSync('bash', ['-n', 'deploy/scripts/dar-backup.sh'], { encoding: 'utf8' });
assert.equal(syntax.status, 0, 'dar-backup.sh has a bash syntax error: ' + syntax.stderr);

console.log(JSON.stringify({ suite: 'backup-source', ok: true, cases: 4 }));
