import { strict as assert } from 'node:assert';
import { setup, one, q, OLD } from '../request-workflow/common.mjs';

const c = await setup();

async function get(path, cookie = c.admin) {
  const response = await fetch(OLD + path, { headers: { cookie } });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

assert.equal((await get('/api/summary/profit?month=2026-10', '')).status, 401, 'profit summary must require auth');

one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'T0-PROFIT','Profit Student','active',DATE '2026-01-01');`);
const studentId = one("SELECT id FROM students WHERE student_code='T0-PROFIT';");
const enrollmentId = one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (gen_random_uuid(),${q(studentId)},${q(c.circleId)},DATE '2026-01-01',100,'active') RETURNING id;`);
const chargeId = one(`INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due)
  VALUES (gen_random_uuid(),${q(enrollmentId)},DATE '2026-10-01',100) RETURNING id;`);
one(`INSERT INTO payments(id,monthly_charge_id,amount,paid_at)
  VALUES (gen_random_uuid(),${q(chargeId)},40,TIMESTAMPTZ '2026-10-05 10:00:00+02');`);
one(`INSERT INTO advertising_expenses(id,circle_id,platform,start_date,days_count,daily_cost)
  VALUES (gen_random_uuid(),${q(c.circleId)},'prof','2026-10-01',2,5);`);
one(`INSERT INTO operating_expenses(id,expense_date,category,description,amount,circle_id)
  VALUES (gen_random_uuid(),DATE '2026-10-03','tools','profit test',5,${q(c.circleId)});`);
const sessionId = one(`INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,ended_at,status,scheduled_duration_minutes,actual_duration_minutes)
  VALUES (gen_random_uuid(),${q(c.teacherId)},${q(c.circleId)},${q(c.slotId)},DATE '2026-10-01',TIMESTAMPTZ '2026-10-01 10:00:00+02',TIMESTAMPTZ '2026-10-01 11:00:00+02','completed',60,60) RETURNING id;`);
one(`INSERT INTO teacher_attendance(id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount,marked_by,teacher_session_id,actual_duration_minutes,pay_basis)
  VALUES (gen_random_uuid(),${q(c.slotId)},${q(c.circleId)},${q(c.teacherId)},DATE '2026-10-01','10:00',60,'present',60,60,${q(c.adminId)},${q(sessionId)},60,'actual');`);
const sessionId2 = one(`INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,ended_at,status,scheduled_duration_minutes,actual_duration_minutes)
  VALUES (gen_random_uuid(),${q(c.teacherId)},${q(c.circleId)},${q(c.slotId)},DATE '2026-10-02',TIMESTAMPTZ '2026-10-02 10:00:00+02',TIMESTAMPTZ '2026-10-02 11:00:00+02','completed',60,60) RETURNING id;`);
one(`INSERT INTO teacher_attendance(id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount,marked_by,teacher_session_id,actual_duration_minutes,pay_basis)
  VALUES (gen_random_uuid(),${q(c.slotId)},${q(c.circleId)},${q(c.teacherId)},DATE '2026-10-02','10:00',60,'present',60,60,${q(c.adminId)},${q(sessionId2)},60,'actual');`);

const summary = await get('/api/summary/profit?month=2026-10');
assert.equal(summary.status, 200, 'profit summary status ' + JSON.stringify(summary.json));
const body = summary.json;
assert.equal(body.dashboard.billed, 100, 'billed');
assert.equal(body.dashboard.collected, 40, 'collected');
assert.equal(body.dashboard.balance, 60, 'balance');
assert.equal(body.dashboard.advertising, 10, 'advertising');
assert.equal(body.dashboard.otherExpenses, 5, 'operating expenses');
assert.equal(body.dashboard.teacherPay, 120, 'teacher pay');
assert.equal(body.dashboard.net, -35, 'net must be billed - ads - teacherPay - expenses');
assert.equal(body.dashboard.withoutChargeCount, 0, 'without charge count');
const teacher = body.teachers.find((row) => row.teacherId === c.teacherId);
assert.ok(teacher, 'teacher row missing');
assert.equal(teacher.payable, 120, 'teacher payable');
assert.equal(teacher.sessions, 2, 'teacher sessions');
const circle = body.circles.find((row) => row.circleId === c.circleId);
assert.ok(circle, 'circle row missing');
assert.equal(circle.billed, 100, 'circle billed');
assert.equal(circle.teacherPay, 120, 'circle teacher pay');
assert.equal(circle.linkedExpenses, 5, 'circle linked expenses');
assert.equal(circle.net, -35, 'circle net');

console.log(JSON.stringify({ suite: 'tier0-profit', ok: true, cases: 3 }));
