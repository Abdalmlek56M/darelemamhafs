import { strict as assert } from 'node:assert';
import { setup, insertRequest, req, one, q, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 0.14: public health answers are status-only; details stay behind auth.
const health = await req(OLD, '', 'GET', '/health');
assert.equal(health.status, 200, 'health status');
const healthBody = JSON.parse(health.text);
assert.deepEqual(Object.keys(healthBody), ['status'], 'health leaks extra fields');
assert.equal(healthBody.status, 'ok');
const live = await req(OLD, '', 'GET', '/health/live');
assert.deepEqual(Object.keys(JSON.parse(live.text)), ['status'], 'health/live leaks extra fields');
const detailsAnon = await req(OLD, '', 'GET', '/api/health/details');
assert.ok([401, 403].includes(detailsAnon.status), 'health details must require auth, got ' + detailsAnon.status);
const details = await req(OLD, c.admin, 'GET', '/api/health/details');
assert.equal(details.status, 200, 'health details auth status');
assert.equal(JSON.parse(details.text).database, 'connected');

// FINAL 0.2: the server owns payments.paid_at and ignores the browser clock.
one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'T0-1','Tier0 Student','active',DATE '2026-01-01');`);
const studentId = one("SELECT id FROM students WHERE student_code='T0-1';");
const enrollmentId = one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (gen_random_uuid(),${q(studentId)},${q(c.circleId)},DATE '2026-01-01',100,'active') RETURNING id;`);
const chargeId = one(`INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due)
  VALUES (gen_random_uuid(),${q(enrollmentId)},date_trunc('month',current_date)::date,100) RETURNING id;`);
const payment = await req(OLD, c.admin, 'POST', '/api/payments', {
  monthlyChargeId: chargeId,
  amount: 10,
  paidAt: '2020-01-01T00:00:00Z',
  method: 'cash',
});
assert.equal(payment.status, 201, 'payment create status ' + payment.text.slice(0, 160));
const paymentBody = JSON.parse(payment.text);
assert.ok(Math.abs(Date.now() - Date.parse(paymentBody.paidAt)) < 120000, 'response paidAt is the browser clock');
const drift = one(`SELECT (now() - paid_at) < interval '2 minutes' FROM payments WHERE id=${q(paymentBody.id)};`);
assert.equal(drift, 't', 'stored paid_at is not the server clock');

// FINAL 0.8: reopening an approved request must respect the payroll lock.
const requestId = insertRequest('absence', '2026-11-20', null, null, 'approved');
one(`INSERT INTO payroll_locks(billing_month,is_locked,locked_by,note)
  VALUES (DATE '2026-11-01',TRUE,${q(c.adminId)},'tier0 lock') ON CONFLICT (billing_month) DO UPDATE SET is_locked=TRUE;`);
const blocked = await req(OLD, c.admin, 'POST', `/api/admin/requests/${requestId}/reopen`);
assert.equal(blocked.status, 409, 'locked reopen must be rejected, got ' + blocked.status + ' ' + blocked.text.slice(0, 160));
one("UPDATE payroll_locks SET is_locked=FALSE, unlocked_at=now() WHERE billing_month=DATE '2026-11-01';");
const reopened = await req(OLD, c.admin, 'POST', `/api/admin/requests/${requestId}/reopen`);
assert.equal(reopened.status, 200, 'unlocked reopen must pass, got ' + reopened.status + ' ' + reopened.text.slice(0, 160));

console.log(JSON.stringify({ suite: 'tier0-money', ok: true, cases: 3 }));
