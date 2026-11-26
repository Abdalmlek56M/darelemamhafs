import { strict as assert } from 'node:assert';
import { setup, one, q, req, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.6: creation audit rows must be written by the same request transaction as the
// money row. A rejected request must not leave an audit claiming success.
one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'T1-AUDIT','Audit Student','active',DATE '2026-01-01');`);
const studentId = one("SELECT id FROM students WHERE student_code='T1-AUDIT';");
const enrollmentId = one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (gen_random_uuid(),${q(studentId)},${q(c.circleId)},DATE '2026-01-01',100,'active') RETURNING id;`);

const charge = await req(OLD, c.admin, 'POST', '/api/charges', { enrollmentId, billingMonth: '2026-12', amountDue: 100, note: 'audit' }, { 'Idempotency-Key': 't1-audit-charge' });
assert.equal(charge.status, 201, 'charge create ' + charge.text.slice(0, 200));
const chargeId = JSON.parse(charge.text).id;
assert.equal(one(`SELECT count(*) FROM audit_log WHERE action_code='charge.create' AND entity_id=${q(chargeId)};`), '1', 'charge audit missing');

const payment = await req(OLD, c.admin, 'POST', '/api/payments', { monthlyChargeId: chargeId, amount: 40 }, { 'Idempotency-Key': 't1-audit-payment' });
assert.equal(payment.status, 201, 'payment create ' + payment.text.slice(0, 200));
const paymentId = JSON.parse(payment.text).id;
assert.equal(one(`SELECT count(*) FROM audit_log WHERE action_code='payment.create' AND entity_id=${q(paymentId)};`), '1', 'payment audit missing');

const before = Number(one("SELECT count(*) FROM audit_log WHERE action_code='payment.create';"));
const rejected = await req(OLD, c.admin, 'POST', '/api/payments', { monthlyChargeId: chargeId, amount: 1000 }, { 'Idempotency-Key': 't1-audit-overpay' });
assert.equal(rejected.status, 409, 'overpayment must be rejected with 409, got ' + rejected.status);
assert.equal(Number(one("SELECT count(*) FROM audit_log WHERE action_code='payment.create';")), before, 'rejected payment wrote an audit row');

console.log(JSON.stringify({ suite: 'tier1-money-audit', ok: true, cases: 3 }));
