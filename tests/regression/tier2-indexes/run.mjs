import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

// FINAL 2.1: each hot-path index exists and is actually chosen by the planner when
// sequential scans are disabled; the redundant media-asset index is gone.
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
  assert.equal(run.status, 0, 'psql failed: ' + (run.stderr || '').slice(0, 500));
  return (run.stdout || '').trim();
};

const cases = [
  ['ix_circle_enrollments_circle_status_live', "SELECT 1 FROM circle_enrollments WHERE circle_id=gen_random_uuid() AND status='active' AND is_trashed = FALSE;"],
  ['ix_monthly_charges_billing_month', "SELECT 1 FROM monthly_charges WHERE billing_month=DATE '2026-01-01';"],
  ['ix_audit_log_occurred_at', 'SELECT 1 FROM audit_log WHERE occurred_at > now() - interval \'1 day\';'],
  ['ix_audit_log_actor', 'SELECT 1 FROM audit_log WHERE actor_user_id = gen_random_uuid();'],
  ['ix_meet_sessions_circle', 'SELECT 1 FROM meet_sessions WHERE circle_id = gen_random_uuid();'],
  ['ix_attendance_requests_circle', 'SELECT 1 FROM attendance_requests WHERE circle_id = gen_random_uuid();'],
  ['ix_notifications_teacher', 'SELECT 1 FROM notifications WHERE scope_teacher_id = gen_random_uuid();'],
  ['ix_notifications_expires', 'SELECT 1 FROM notifications WHERE expires_at IS NOT NULL AND expires_at < now();'],
];
for (const [indexName, query] of cases) {
  assert.equal(psql(`SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='${indexName}';`), '1', indexName + ' is missing');
  const plan = psql(`SET enable_seqscan = off; EXPLAIN ${query}`);
  assert.match(plan, new RegExp(indexName), 'planner did not use ' + indexName + ':\n' + plan.slice(0, 500));
}
assert.equal(psql("SELECT to_regclass('public.idx_meet_media_assets_session') IS NULL;"), 't', 'redundant media-asset index still exists');

console.log(JSON.stringify({ suite: 'tier2-indexes', ok: true, cases: cases.length + 1 }));
