import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

// FINAL 2.6: one recording cap in meet_settings; migration 038 must be safe on a fresh
// schema (defaults 21600 seconds vs 240 minutes) and must preserve max_session_minutes.
const conn = process.env.DAR_TEST_DATABASE || '';
const env = { ...process.env };
for (const part of conn.split(';')) {
  const index = part.indexOf('=');
  if (index < 0) continue;
  const key = part.slice(0, index).trim().toLowerCase();
  const value = part.slice(index + 1).trim();
  if (key === 'host') env.PGHOST = value;
  if (key === 'port') env.PGPORT = value;
  if (key === 'database') env.PGDATABASE = value;
  if (key === 'username') env.PGUSER = value;
  if (key === 'password') env.PGPASSWORD = value;
}
const psql = (sql) => {
  const run = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', env });
  assert.equal(run.status, 0, 'psql failed: ' + (run.stderr || '').slice(0, 400));
  return (run.stdout || '').trim();
};
const runMigration = () => spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', 'database/038_meet_single_session_cap.sql'], { encoding: 'utf8', env });

// Post-migration invariants.
assert.equal(psql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='meet_settings' AND column_name='max_session_seconds';"), '0', 'unused seconds cap still exists');
assert.equal(psql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='meet_settings' AND column_name='max_session_minutes';"), '1', 'minute cap is missing');
psql('INSERT INTO meet_settings(id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;');
assert.equal(psql("SELECT max_session_minutes FROM meet_settings WHERE id=TRUE;"), '240', 'unexpected minute cap default');

// Case 1: fresh-schema defaults (21600 seconds, 240 minutes) must be accepted.
psql("ALTER TABLE meet_settings ADD COLUMN IF NOT EXISTS max_session_seconds INTEGER NOT NULL DEFAULT 21600 CHECK (max_session_seconds BETWEEN 300 AND 43200);");
psql('UPDATE meet_settings SET max_session_seconds=21600, max_session_minutes=240 WHERE id=TRUE;');
const freshDefaults = runMigration();
assert.equal(freshDefaults.status, 0, '038 rejected fresh-schema defaults: ' + (freshDefaults.stderr || '').slice(0, 500));
assert.equal(psql("SELECT count(*) FROM information_schema.columns WHERE table_name='meet_settings' AND column_name='max_session_seconds';"), '0');
assert.equal(psql('SELECT max_session_minutes FROM meet_settings WHERE id=TRUE;'), '240', 'fresh-default migration changed the canonical minutes');

// Case 2: disagreeing values must still pass and keep max_session_minutes untouched.
psql("ALTER TABLE meet_settings ADD COLUMN IF NOT EXISTS max_session_seconds INTEGER NOT NULL DEFAULT 21600 CHECK (max_session_seconds BETWEEN 300 AND 43200);");
psql('UPDATE meet_settings SET max_session_seconds=7200, max_session_minutes=180 WHERE id=TRUE;');
const mismatched = runMigration();
assert.equal(mismatched.status, 0, '038 rejected a disagreeing but valid row: ' + (mismatched.stderr || '').slice(0, 500));
assert.equal(psql("SELECT count(*) FROM information_schema.columns WHERE table_name='meet_settings' AND column_name='max_session_seconds';"), '0');
assert.equal(psql('SELECT max_session_minutes FROM meet_settings WHERE id=TRUE;'), '180', 'migration overwrote max_session_minutes instead of keeping it');

console.log(JSON.stringify({ suite: 'tier2-meet-cap', ok: true, cases: 7 }));
