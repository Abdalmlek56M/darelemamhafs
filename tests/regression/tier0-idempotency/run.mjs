import { strict as assert } from 'node:assert';
import { setup, one, q, OLD } from '../request-workflow/common.mjs';

const c = await setup();

function randomKey() { return 't0-idem-' + crypto.randomUUID(); }
async function post(path, body, key) {
  const response = await fetch(OLD + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: c.admin, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'T0-IDEM','Idempotent Student','active',DATE '2026-01-01');`);
const studentId = one("SELECT id FROM students WHERE student_code='T0-IDEM';");
const enrollmentId = one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (gen_random_uuid(),${q(studentId)},${q(c.circleId)},DATE '2026-01-01',100,'active') RETURNING id;`);

// Charges: replay returns the same row and never inserts twice.
const chargeKey = randomKey();
const firstCharge = await post('/api/charges', { enrollmentId, billingMonth: '2026-11', amountDue: 100, note: 'idem' }, chargeKey);
assert.equal(firstCharge.status, 201, 'first charge status ' + JSON.stringify(firstCharge.json));
const secondCharge = await post('/api/charges', { enrollmentId, billingMonth: '2026-11', amountDue: 100, note: 'idem' }, chargeKey);
assert.ok([200, 201].includes(secondCharge.status), 'replayed charge status ' + secondCharge.status);
assert.equal(secondCharge.json.id, firstCharge.json.id, 'charge replay must return the same id');
assert.equal(secondCharge.json.replayed, true, 'charge replay must be flagged');
assert.equal(one(`SELECT count(*) FROM monthly_charges WHERE enrollment_id=${q(enrollmentId)};`), '1', 'charge replay duplicated the row');
const differentCharge = await post('/api/charges', { enrollmentId, billingMonth: '2026-11', amountDue: 100 }, randomKey());
assert.equal(differentCharge.status, 409, 'same enrollment/month with another key must stay a conflict');

// Payments: replay returns the same row; two distinct keys create two rows.
const chargeId = firstCharge.json.id;
const paymentKey = randomKey();
const firstPayment = await post('/api/payments', { monthlyChargeId: chargeId, amount: 10, method: 'cash' }, paymentKey);
assert.equal(firstPayment.status, 201, 'first payment status ' + JSON.stringify(firstPayment.json));
const secondPayment = await post('/api/payments', { monthlyChargeId: chargeId, amount: 10, method: 'cash' }, paymentKey);
assert.ok([200, 201].includes(secondPayment.status), 'replayed payment status ' + secondPayment.status);
assert.equal(secondPayment.json.id, firstPayment.json.id, 'payment replay must return the same id');
assert.equal(secondPayment.json.replayed, true, 'payment replay must be flagged');
assert.equal(one(`SELECT count(*) FROM payments WHERE monthly_charge_id=${q(chargeId)};`), '1', 'payment replay duplicated the row');
const otherPayment = await post('/api/payments', { monthlyChargeId: chargeId, amount: 5 }, randomKey());
assert.equal(otherPayment.status, 201, 'a new key must create a new payment');
assert.equal(one(`SELECT count(*) FROM payments WHERE monthly_charge_id=${q(chargeId)};`), '2', 'new key payment was not inserted');

console.log(JSON.stringify({ suite: 'tier0-idempotency', ok: true, cases: 4 }));
