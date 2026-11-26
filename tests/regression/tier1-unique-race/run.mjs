import { strict as assert } from 'node:assert';
import { setup, one, q, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.12: a unique race must surface as 409, never a 500.
one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'T1-RACE','Race Student','active',DATE '2026-01-01');`);
const studentId = one("SELECT id FROM students WHERE student_code='T1-RACE';");
const enrollmentId = one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (gen_random_uuid(),${q(studentId)},${q(c.circleId)},DATE '2026-01-01',10,'active') RETURNING id;`);

async function createCharge(key) {
  const response = await fetch(OLD + '/api/charges', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: c.admin, 'Idempotency-Key': key },
    body: JSON.stringify({ enrollmentId, billingMonth: '2026-12', amountDue: 10 }),
  });
  return response.status;
}
const keys = ['t1-race-a', 't1-race-b', 't1-race-c', 't1-race-d'];
const statuses = await Promise.all(keys.map(createCharge));
assert.ok(statuses.includes(201), 'no concurrent create succeeded: ' + statuses.join(','));
assert.ok(statuses.includes(409), 'duplicate race did not return 409: ' + statuses.join(','));
assert.equal(statuses.includes(500), false, 'unique race returned 500: ' + statuses.join(','));
assert.equal(one(`SELECT count(*) FROM monthly_charges WHERE enrollment_id=${q(enrollmentId)};`), '1', 'duplicate charge rows were created');

console.log(JSON.stringify({ suite: 'tier1-unique-race', ok: true, cases: 3 }));
