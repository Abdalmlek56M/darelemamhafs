import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

// FINAL 2.6: one recording cap in meet_settings; the unused seconds column is gone.
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

assert.equal(psql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='meet_settings' AND column_name='max_session_seconds';"), '0', 'unused seconds cap still exists');
assert.equal(psql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='meet_settings' AND column_name='max_session_minutes';"), '1', 'minute cap is missing');
psql('INSERT INTO meet_settings(id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;');
assert.equal(psql("SELECT max_session_minutes FROM meet_settings WHERE id=TRUE;"), '240', 'unexpected minute cap default');

console.log(JSON.stringify({ suite: 'tier2-meet-cap', ok: true, cases: 3 }));
