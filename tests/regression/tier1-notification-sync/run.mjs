import { strict as assert } from 'node:assert';
import { setup, one, q, req, OLD, NEW } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.13: the unpaid-notification sync used to reopen a resolved notification every run.
one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'T1-SYNC','Sync Student','active',DATE '2026-01-01');`);
const studentId = one("SELECT id FROM students WHERE student_code='T1-SYNC';");
const enrollmentId = one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (gen_random_uuid(),${q(studentId)},${q(c.circleId)},DATE '2026-01-01',50,'active') RETURNING id;`);
const chargeId = one(`INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due)
  VALUES (gen_random_uuid(),${q(enrollmentId)},DATE '2026-10-01',50) RETURNING id;`);

const sync = (cookie) => req(NEW, cookie, 'POST', '/api/v1/system/notifications/sync');
const first = await sync(c.admin);
assert.equal(first.status, 200, 'sync endpoint ' + first.text.slice(0, 200));
const notificationId = one("SELECT id FROM notifications WHERE dedupe_key=" + q('unpaid:' + chargeId) + ";");
assert.ok(notificationId, 'sync did not create the unpaid notification');

const resolved = await req(OLD, c.admin, 'POST', `/api/admin/notifications/${notificationId}/resolve`, { note: 'handled' });
assert.equal(resolved.status, 200, 'resolve notification ' + resolved.text.slice(0, 200));

const second = await sync(c.admin);
assert.equal(second.status, 200, 'second sync ' + second.text.slice(0, 200));
const after = one(`SELECT status || '|' || COALESCE(resolution_note,'') || '|' || COALESCE(resolved_at::text,'') FROM notifications WHERE id=${q(notificationId)};`);
assert.equal(after.split('|')[0], 'resolved', 'sync reopened a resolved notification: ' + after);
assert.equal(after.split('|')[1], 'handled', 'sync cleared the resolution note');

console.log(JSON.stringify({ suite: 'tier1-notification-sync', ok: true, cases: 3 }));
