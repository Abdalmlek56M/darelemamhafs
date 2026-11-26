import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

// FINAL Z0 (2.11): the single read-only integrity report must run on a disposable
// PostgreSQL schema and expose every ported check with zero findings on a clean DB.
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
assert.ok(env.PGDATABASE, 'DAR_TEST_DATABASE is required');
const run = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', 'deploy/sql/integrity-checks.sql'], { encoding: 'utf8', env });
assert.equal(run.status, 0, 'integrity SQL failed: ' + (run.stderr || '').slice(0, 600));
const raw = (run.stdout || '').trim();
assert.ok(raw.length > 10, 'integrity SQL returned no JSON');
const report = JSON.parse(raw);
assert.ok(report.schema && report.integrity && report.wal && report.autovacuum, 'report sections missing');
assert.equal(report.schema.missing_tables, '', 'required tables missing in the disposable schema');
assert.equal(report.schema.missing_indexes, '', 'required safety indexes missing in the disposable schema');
assert.ok(report.schema.invalid_indexes >= 0, 'invalid index count missing');
for (const [name, count] of Object.entries(report.integrity)) {
  assert.equal(count, 0, 'clean disposable database reports ' + name + '=' + count);
}
assert.ok(report.wal.file_count >= 0 && report.wal.size_bytes >= 0, 'WAL stats missing');
assert.ok(Array.isArray(report.dead_tables), 'dead-tuple report must be an array');
assert.equal(typeof report.autovacuum.enabled, 'boolean', 'autovacuum settings missing');
assert.equal(typeof report.autovacuum.max_dead_tuple_percent, 'number', 'autovacuum dead-tuple threshold missing');

console.log(JSON.stringify({ suite: 'integrity-sql', ok: true, cases: 3 }));
