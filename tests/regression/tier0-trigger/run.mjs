import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { setup, one, q } from '../request-workflow/common.mjs';

const c = await setup();

// Apply the new migration to the disposable regression schema (never production).
const migration = readFileSync('database/032_paid_notification_ledger.sql', 'utf8');
one(migration);

one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'T0-TRIG','Trigger Student','active',DATE '2026-01-01');`);
const studentId = one("SELECT id FROM students WHERE student_code='T0-TRIG';");
const enrollmentId = one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (gen_random_uuid(),${q(studentId)},${q(c.circleId)},DATE '2026-01-01',100,'active') RETURNING id;`);
const chargeId = one(`INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due)
  VALUES (gen_random_uuid(),${q(enrollmentId)},date_trunc('month',current_date)::date,100) RETURNING id;`);
one(`INSERT INTO notifications(role_scope,category,status,severity,title,body,dedupe_key)
  VALUES ('admin','payment','open','info','اشتراك unpaid','قاعدة','unpaid:' || ${q(chargeId)});`);
const notificationStatus = () =>
  one(`SELECT status FROM notifications WHERE dedupe_key='unpaid:' || ${q(chargeId)};`);

// Paying the full amount resolves the notification.
const paymentId = one(`INSERT INTO payments(id,monthly_charge_id,amount,paid_at)
  VALUES (gen_random_uuid(),${q(chargeId)},100,now()) RETURNING id;`);
assert.equal(notificationStatus(), 'resolved', 'full payment must resolve the unpaid notification');

// A voided payment must return the notification to open (the old trigger ignored voided_at).
one(`UPDATE payments SET voided_at=now(), void_reason='tier0 void test', voided_by=${q(c.adminId)} WHERE id=${q(paymentId)};`);
assert.equal(notificationStatus(), 'open', 'voided payment must reopen the unpaid notification');

// Raising amount_due above the paid sum keeps it open, paying the difference resolves it.
one(`UPDATE monthly_charges SET amount_due=150 WHERE id=${q(chargeId)};`);
assert.equal(notificationStatus(), 'open', 'amount_due raise must reopen/keep the notification open');
one(`INSERT INTO payments(id,monthly_charge_id,amount,paid_at)
  VALUES (gen_random_uuid(),${q(chargeId)},150,now());`);
assert.equal(notificationStatus(), 'resolved', 'amount_due change + payment must resolve by ledger');

console.log(JSON.stringify({ suite: 'tier0-trigger', ok: true, cases: 4 }));
