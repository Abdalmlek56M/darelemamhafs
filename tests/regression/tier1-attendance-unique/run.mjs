import { strict as assert } from 'node:assert';
import { setup, one, q } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.4: the old non-partial UNIQUE(schedule_slot_id, session_date) made an undone
// (trashed) attendance row block re-marking the same session. The partial unique index
// only governs live rows.
const date = '2026-11-15';
const insert = (id, trashed) => one(`INSERT INTO teacher_attendance(
  id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,
  hourly_rate_snapshot,payable_amount,marked_by,actual_duration_minutes,pay_basis,is_trashed)
  VALUES (${q(id)},${q(c.slotId)},${q(c.circleId)},${q(c.teacherId)},DATE '${date}','10:00',60,'present',
  60,60,${q(c.adminId)},60,'manual',${trashed});`);

insert(crypto.randomUUID(), true);
insert(crypto.randomUUID(), false);
assert.equal(one(`SELECT count(*) FROM teacher_attendance WHERE schedule_slot_id=${q(c.slotId)} AND session_date=DATE '${date}';`), '2', 'trashed + live row should coexist');

let duplicateRejected = false;
try {
  insert(crypto.randomUUID(), false);
} catch (error) {
  duplicateRejected = /23505|duplicate key|unique/i.test(String(error));
}
assert.equal(duplicateRejected, true, 'a second live attendance row for the same session must be rejected');
assert.equal(one("SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='ux_teacher_attendance_slot_date_live';"), '1', 'partial unique index is missing');

console.log(JSON.stringify({ suite: 'tier1-attendance-unique', ok: true, cases: 3 }));
