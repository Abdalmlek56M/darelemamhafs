import { strict as assert } from 'node:assert';
import { setup, one, q, req, OLD, NEW } from '../request-workflow/common.mjs';

const c = await setup();
const PASS = process.env.Q6_PASSWORD || 'Q6-StrongPass!';

async function createUser(username, permissionCodes) {
  const created = await req(OLD, c.admin, 'POST', '/api/admin/users', {
    username, displayName: username, password: PASS, permissionCodes,
  });
  assert.ok([201, 409].includes(created.status), 'create user ' + username + ' ' + created.status + ' ' + created.text.slice(0, 160));
  return one('SELECT id FROM app_users WHERE username=' + q(username) + ';');
}

async function loginNew(username) {
  const response = await fetch(NEW + '/api/v1/auth/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASS }),
  });
  assert.equal(response.status, 200, 'login ' + username + ' ' + response.status);
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  return cookies.filter(Boolean).map((value) => value.split(';')[0]).join('; ');
}

// FINAL 1.13: ending a session must not overwrite a manually corrected attendance row.
const teacherUser = await createUser('t1_teacher_end', ['teacher.portal', 'teacher.attendance']);
one('UPDATE app_users SET teacher_id=' + q(c.teacherId) + ' WHERE id=' + q(teacherUser) + ';');
const teacherCookie = await loginNew('t1_teacher_end');
const date = '2027-01-05';
const sessionId = one(`INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,status,scheduled_duration_minutes)
  VALUES (gen_random_uuid(),${q(c.teacherId)},${q(c.circleId)},${q(c.slotId)},DATE '${date}',now()-INTERVAL '30 minutes','in_progress',60) RETURNING id;`);
const manualAttendance = one(`INSERT INTO teacher_attendance(id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,
  duration_minutes,status,hourly_rate_snapshot,payable_amount,marked_by,teacher_session_id,actual_duration_minutes,pay_basis)
  VALUES (gen_random_uuid(),${q(c.slotId)},${q(c.circleId)},${q(c.teacherId)},DATE '${date}','10:00',45,'present',60,45,${q(c.adminId)},NULL,45,'manual') RETURNING id;`);

const ended = await req(NEW, teacherCookie, 'POST', `/api/v1/teacher/sessions/${sessionId}/end`, { note: 'manual preserved' });
assert.equal(ended.status, 200, 'end session ' + ended.text.slice(0, 240));
assert.equal(one(`SELECT duration_minutes FROM teacher_attendance WHERE id=${q(manualAttendance)};`), '45', 'end-session overwrote manual attendance');
assert.equal(one(`SELECT teacher_session_id FROM teacher_attendance WHERE id=${q(manualAttendance)};`), '', 'end-session adopted the manual attendance row');
assert.equal(one(`SELECT status FROM teacher_sessions WHERE id=${q(sessionId)};`), 'awaiting_attendance', 'session did not end');

// FINAL 1.13: a teacher with an in-progress session is not absent for that day.
await createUser('t1_supervisor', ['supervisor.portal', 'supervisor.absences']);
const supervisorCookie = await loginNew('t1_supervisor');
const monday = '2026-11-23';
one(`INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,status,scheduled_duration_minutes)
  VALUES (gen_random_uuid(),${q(c.teacherId)},${q(c.circleId)},${q(c.slotId)},DATE '${monday}',now(),'in_progress',60);`);
const absences = await req(NEW, supervisorCookie, 'GET', `/api/v1/supervisor/absences?date=${monday}`);
assert.equal(absences.status, 200, 'absences endpoint ' + absences.text.slice(0, 240));
const body = JSON.parse(absences.text);
const teachers = body.teachers || [];
assert.equal(teachers.some((row) => row.teacherId === c.teacherId), false, 'in-progress session teacher was listed as absent');

console.log(JSON.stringify({ suite: 'tier1-teacher-state', ok: true, cases: 4 }));
