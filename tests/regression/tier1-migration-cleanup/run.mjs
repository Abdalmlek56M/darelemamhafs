import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

// FINAL 1.8: the new migration removes the legacy global timetable lock; 031 must remain
// the live payment-void function. This suite inspects the applied database functions.
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
const query = (sql) => {
  const run = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', env });
  assert.equal(run.status, 0, 'psql failed: ' + (run.stderr || '').slice(0, 400));
  return (run.stdout || '').trim();
};

const slotGuard = query("SELECT pg_get_functiondef('public.dar_guard_schedule_slot_teacher_overlap()'::regprocedure);");
const circleGuard = query("SELECT pg_get_functiondef('public.dar_guard_circle_teacher_schedule_overlap()'::regprocedure);");
for (const [name, body] of [['slot', slotGuard], ['circle', circleGuard]]) {
  assert.equal(body.includes('867530912345'), false, name + ' guard still takes the legacy global advisory lock');
  assert.match(body, /pg_advisory_xact_lock/, name + ' guard lost its per-teacher locks');
}
const voidPayment = query("SELECT pg_get_functiondef('public.dar_void_payment(uuid,uuid,text)'::regprocedure);");
assert.match(voidPayment, /v_enrollment_status/, 'live dar_void_payment is not the subscription-aware 031 version');

console.log(JSON.stringify({ suite: 'tier1-migration-cleanup', ok: true, cases: 4 }));
