import { strict as assert } from 'node:assert';
import { assertSafeTargets, psql } from '../../lib/index.mjs';

// FINAL 1.8: the new migration removes the legacy global timetable lock; 031 must remain
// the live payment-void function. This suite inspects the applied database functions.
const conn = process.env.DAR_TEST_DATABASE || '';
assertSafeTargets({ db: conn, requireDb: true, label: 'TIER1-CLEANUP_FAIL' });
const query = (sql) => psql(conn, sql);

const slotGuard = query("SELECT pg_get_functiondef('public.dar_guard_schedule_slot_teacher_overlap()'::regprocedure);");
const circleGuard = query("SELECT pg_get_functiondef('public.dar_guard_circle_teacher_schedule_overlap()'::regprocedure);");
for (const [name, body] of [['slot', slotGuard], ['circle', circleGuard]]) {
  assert.equal(body.includes('867530912345'), false, name + ' guard still takes the legacy global advisory lock');
  assert.match(body, /pg_advisory_xact_lock/, name + ' guard lost its per-teacher locks');
}
const voidPayment = query("SELECT pg_get_functiondef('public.dar_void_payment(uuid,uuid,text)'::regprocedure);");
assert.match(voidPayment, /v_enrollment_status/, 'live dar_void_payment is not the subscription-aware 031 version');

console.log(JSON.stringify({ suite: 'tier1-migration-cleanup', ok: true, cases: 4 }));
