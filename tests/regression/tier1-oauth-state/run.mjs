import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

// FINAL 1.15: OAuth state nonces are consumed exactly once in the database.
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
const psql = (sql) => spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', env });
const query = (sql) => {
  const run = psql(sql);
  assert.equal(run.status, 0, 'psql failed: ' + (run.stderr || '').slice(0, 400));
  return (run.stdout || '').trim();
};

assert.equal(query("SELECT to_regclass('public.meet_oauth_states') IS NOT NULL;"), 't', 'meet_oauth_states table is missing');
const nonce = crypto.randomUUID();
assert.equal(query(`INSERT INTO meet_oauth_states(nonce, consumed_at) VALUES('${nonce}', now()) ON CONFLICT (nonce) DO NOTHING RETURNING nonce;`).length, 36, 'first consume failed');
assert.equal(query(`INSERT INTO meet_oauth_states(nonce, consumed_at) VALUES('${nonce}', now()) ON CONFLICT (nonce) DO NOTHING RETURNING nonce;`), '', 'replayed nonce was consumed twice');
query(`DELETE FROM meet_oauth_states WHERE nonce='${nonce}';`);
assert.equal(query(`SELECT count(*) FROM meet_oauth_states WHERE nonce='${nonce}';`), '0', 'cleanup failed');

console.log(JSON.stringify({ suite: 'tier1-oauth-state', ok: true, cases: 2 }));
