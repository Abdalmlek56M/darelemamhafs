import { strict as assert } from 'node:assert';
import { setup, one, q } from '../request-workflow/common.mjs';

const c = await setup();
one("INSERT INTO user_permissions(user_id,permission_code) SELECT id,'teacher.history.self' FROM app_users WHERE teacher_id=" + q(c.teacherId) + " ON CONFLICT DO NOTHING;");
const NEW = process.env.Q6_NEW_URL;
const LEGACY = process.env.Q6_LEGACY_URL;
const login = await fetch(NEW + '/api/v1/auth/password', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'q6_admin', password: process.env.Q6_PASSWORD })
});
assert.equal(login.status, 200, 'admin login');
const cookie = login.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
const teacherLogin = await fetch(NEW + '/api/v1/auth/password', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'q6_teacher', password: process.env.Q6_PASSWORD })
});
assert.equal(teacherLogin.status, 200, 'teacher login');
c.teacher = teacherLogin.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
const date = '2026-11-30';

one("INSERT INTO students(id,student_code,full_name,status,joined_on) SELECT gen_random_uuid(),"
  + "'STB-'||g,'ZZZ Stable Student','active',DATE '2026-01-01' FROM generate_series(1,7) g;");
one("INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status) "
  + "SELECT gen_random_uuid(),s.id," + q(c.circleId) + ",DATE '2026-01-01',0,'active' "
  + "FROM students s WHERE s.student_code LIKE 'STB-%';");
one("INSERT INTO student_attendance(id,enrollment_id,schedule_slot_id,session_date,status,marked_by) "
  + "SELECT gen_random_uuid(),ce.id," + q(c.slotId) + "," + q(date) + ",'absent'," + q(c.adminId) + " "
  + "FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id "
  + "WHERE s.student_code LIKE 'STB-%';");
one("INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due) "
  + "SELECT gen_random_uuid(),ce.id,date_trunc('month',current_date)::date,10 "
  + "FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id "
  + "WHERE s.student_code LIKE 'STB-%';");
one("INSERT INTO attendance_requests(id,request_type,teacher_id,circle_id,schedule_slot_id,request_date,"
  + "requested_by,reason,status,created_at) SELECT gen_random_uuid(),'absence'," + q(c.teacherId) + ","
  + q(c.circleId) + "," + q(c.slotId) + "," + q(date) + "," + q(c.adminId)
  + ",'Stability request','pending',TIMESTAMPTZ '2026-11-26 10:00:00+02' FROM generate_series(1,7);");
// S-1.9 fixtures: October keeps the November session-summary totals unchanged.
one("INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,ended_at,"
  + "status,scheduled_duration_minutes,actual_duration_minutes) SELECT gen_random_uuid()," + q(c.teacherId) + ","
  + q(c.circleId) + "," + q(c.slotId) + ", d::date, d::timestamptz, d::timestamptz + interval '60 minutes',"
  + " 'completed', 60, 60 FROM generate_series(DATE '2026-10-01', DATE '2026-10-07', interval '1 day') AS d;");
one("INSERT INTO teacher_attendance(id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,"
  + "duration_minutes,status,hourly_rate_snapshot,payable_amount,note,marked_by,teacher_session_id,"
  + "actual_duration_minutes,pay_basis) SELECT gen_random_uuid()," + q(c.slotId) + "," + q(c.circleId) + ","
  + q(c.teacherId) + ", ts.session_date, TIME '10:00', 60, 'present', 60, 60,"
  + " 'Stability session note '||to_char(ts.session_date,'DD'), " + q(c.adminId) + ", ts.id, 60, 'manual'"
  + " FROM teacher_sessions ts WHERE ts.teacher_id=" + q(c.teacherId) + ";");
one("INSERT INTO attendance_requests(id,request_type,teacher_id,circle_id,schedule_slot_id,request_date,"
  + "requested_by,reason,status,created_at) SELECT gen_random_uuid(),'absence'," + q(c.teacherId) + ","
  + q(c.circleId) + "," + q(c.slotId) + ", DATE '2026-10-05', " + q(c.adminId)
  + ",'Stability teacher request','cancelled',TIMESTAMPTZ '2026-10-05 10:00:00+02' FROM generate_series(1,7);");
const teacherUserId = one("SELECT id FROM app_users WHERE teacher_id=" + q(c.teacherId) + ";");
assert.ok(teacherUserId, 'teacher portal user is linked');
one("INSERT INTO notifications(id,user_id,category,status,severity,title,body,dedupe_key,created_at) "
  + "SELECT gen_random_uuid()," + q(teacherUserId) + ",'system','open','info','Stability notification',"
  + "'Body '||g,'stability-notification-'||g,TIMESTAMPTZ '2026-11-26 10:00:00+02' FROM generate_series(1,7) g;");

const ids = sqlText => sqlText.split('\n').map(x => x.trim()).filter(Boolean);
const studentIds = ids(one('SELECT id FROM students ORDER BY id;'));
const attendanceIds = ids(one('SELECT id FROM student_attendance ORDER BY id;'));
const chargeIds = ids(one('SELECT id FROM monthly_charges ORDER BY id;'));
const requestIds = ids(one('SELECT id FROM attendance_requests WHERE status = ' + q('pending') + ' ORDER BY id;'));
const noteIds = ids(one('SELECT id FROM teacher_attendance WHERE note IS NOT NULL '
  + 'ORDER BY session_date DESC, marked_at DESC, id;'));
const teacherRequestIds = ids(one('SELECT id FROM attendance_requests WHERE teacher_id = ' + q(c.teacherId) + ' ORDER BY created_at DESC, id;'));
const notificationIds = ids(one('SELECT id FROM notifications ORDER BY id;'));
assert.equal(studentIds.length, 7, 'seeded students');
assert.equal(attendanceIds.length, 7, 'seeded attendance');
assert.equal(chargeIds.length, 7, 'seeded charges');
assert.equal(requestIds.length, 7, 'seeded requests');
assert.equal(noteIds.length, 7, 'seeded teacher notes');
assert.equal(teacherRequestIds.length, 14, 'seeded teacher requests');
assert.equal(notificationIds.length, 7, 'seeded notifications');

const sessionDates = ['2026-11-30', '2026-11-23', '2026-11-16', '2026-11-09', '2026-11-02'];
const endpoints = [
  ['supervisor-students', NEW, '/api/v1/supervisor/students', 'students', 7,
    row => row.id, () => studentIds],
  ['supervisor-circles', NEW, '/api/v1/supervisor/circles', 'circles', 1, row => row.id, null],
  ['supervisor-teachers', NEW, '/api/v1/supervisor/teachers', 'teachers', 1, row => row.id, null],
  ['supervisor-absences', NEW, '/api/v1/supervisor/absences?date=' + date, 'absences', 7,
    row => row.studentId, () => studentIds],
  ['supervisor-attendance-teachers', NEW,
    '/api/v1/supervisor/attendance/teachers?date=' + date, 'sessions', 1, row => row.scheduleSlotId, null],
  ['supervisor-attendance-students', NEW,
    '/api/v1/supervisor/attendance/students?date=' + date, 'attendance', 7,
    row => row.attendanceId, () => attendanceIds],
  ['supervisor-unpaid', NEW, '/api/v1/supervisor/unpaid', 'unpaid', 7, row => row.chargeId, () => chargeIds],
  ['supervisor-requests', NEW, '/api/v1/supervisor/requests?status=pending', 'requests', 7,
    row => row.id, () => requestIds],
  ['supervisor-teacher-notes', NEW, '/api/v1/supervisor/teacher-notes', 'notes', 7,
    row => row.id, () => noteIds],
  ['teacher-requests', NEW, '/api/v1/teacher/requests', 'requests', 14,
    row => row.id, () => teacherRequestIds, true],
  ['notifications', NEW, '/api/v1/notifications?status=all', 'notifications', 7,
    row => row.id, () => notificationIds, true],
  ['legacy-students', LEGACY, '/api/students', null, 7, row => row.id, () => studentIds],
  ['legacy-teachers', LEGACY, '/api/teachers', null, 1, row => row.id, null],
  ['legacy-circles', LEGACY, '/api/circles', null, 1, row => row.id, null],
  ['legacy-schedule-slots', LEGACY, '/api/schedule-slots', null, 1, row => row.id, null],
  ['legacy-attendance', LEGACY, '/api/student-attendance?month=2026-11', null, 7,
    row => row.id, () => attendanceIds],
  ['legacy-roster', LEGACY,
    '/api/student-attendance/roster?scheduleSlotId=' + c.slotId + '&date=' + date, null, 7,
    row => row.studentId, () => studentIds],
  ['legacy-session-summary', LEGACY,
    '/api/student-attendance/session-summary?month=2026-11', null, 5,
    row => row.sessionDate, () => sessionDates]
];

const pageSize = 2;
for (const [name, base, path, key, total, rowId, expectedRef, asTeacher] of endpoints) {
  const fetchPage = async page => {
    const separator = path.includes('?') ? '&' : '?';
    const url = base + path + separator + 'page=' + page + '&pageSize=' + pageSize;
    const authCookie = name.startsWith('legacy-') ? c.admin : (asTeacher ? c.teacher : cookie);
    const response = await fetch(url, { headers: { cookie: authCookie } });
    assert.equal(response.status, 200, name + ' page ' + page + ' status');
    const body = await response.json();
    return { headers: response.headers, rows: key ? body[key] : body };
  };
  const first = await fetchPage(1);
  assert.equal(first.headers.get('X-Total-Count'), String(total), name + ' total header');
  assert.equal(first.rows.length, Math.min(total, pageSize), name + ' first page length');
  const repeated = await fetchPage(1);
  assert.deepEqual(repeated.rows.map(rowId), first.rows.map(rowId), name + ' repeated page stable');
  const pageCount = Math.ceil(total / pageSize);
  const unique = new Set();
  const collected = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const current = page === 1 ? first : await fetchPage(page);
    const expectedLength = page < pageCount ? pageSize : total - (pageCount - 1) * pageSize;
    assert.equal(current.rows.length, expectedLength, name + ' page ' + page + ' length');
    for (const row of current.rows) {
      const serialized = JSON.stringify(row);
      assert.equal(unique.has(serialized), false, name + ' duplicate row on page ' + page);
      unique.add(serialized);
      collected.push(row);
    }
  }
  assert.equal(unique.size, total, name + ' unique rows equal total');
  assert.equal(collected.length, total, name + ' sum of pages equals total');
  if (total > pageSize) {
    const second = await fetchPage(2);
    const firstIds = first.rows.map(rowId);
    assert.equal(second.rows.some(row => firstIds.includes(rowId(row))), false,
      name + ' consecutive pages disjoint');
  }
  if (expectedRef) {
    assert.deepEqual(collected.map(rowId), expectedRef(), name + ' id tiebreaker order');
  }
}

// Teacher history returns two independent paged lists under one response.
const historyFirstResponse = await fetch(NEW + '/api/v1/teacher/history?page=1&pageSize=2', { headers: { cookie: c.teacher } });
assert.equal(historyFirstResponse.status, 200, 'teacher history status');
const historyFirst = await historyFirstResponse.json();
assert.equal(historyFirstResponse.headers.get('X-Total-Count'), '7');
assert.equal(historyFirst.sessionTotal, 7);
assert.equal(historyFirst.attendanceTotal, 7);
assert.equal(historyFirst.sessions.length, 2);
assert.equal(historyFirst.attendance.length, 2);
const historySecond = await (await fetch(NEW + '/api/v1/teacher/history?page=2&pageSize=2', { headers: { cookie: c.teacher } })).json();
assert.equal(historySecond.sessions.length, 2);
assert.notEqual(historySecond.sessions[0].id, historyFirst.sessions[0].id);
const historyUnpaged = await (await fetch(NEW + '/api/v1/teacher/history', { headers: { cookie: c.teacher } })).json();
assert.equal(historyUnpaged.sessions.length, 7);
assert.equal(historyUnpaged.attendance.length, 7);

console.log(JSON.stringify({ suite: 'pagination-stability', ok: true, cases: endpoints.length }));
