import { strict as assert } from 'node:assert';
import { setup, one, q } from '../request-workflow/common.mjs';

const c = await setup();
const LEGACY = process.env.Q6_LEGACY_URL;
async function readJson(response, path) {
  const text = await response.text();
  if (!text) throw new Error('EMPTY BODY ' + path + ' status ' + response.status);
  try { return JSON.parse(text) } catch { throw new Error('BAD JSON ' + path + ' status ' + response.status + ' body ' + text.slice(0, 100)) }
}
const admin = { cookie: c.admin };

async function getJson(path, headers = admin) {
  const response = await fetch(LEGACY + path, { headers });
  return { status: response.status, headers: response.headers, body: await readJson(response, path) };
}

async function walk(path, expectedTotal, rowId) {
  const pageSize = 2;
  const seen = new Set();
  const rows = [];
  for (let page = 1; rows.length < expectedTotal; page += 1) {
    const response = await getJson(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=${pageSize}`);
    assert.equal(response.status, 200, path + ' page ' + page + ' status');
    assert.equal(response.headers.get('X-Total-Count'), String(expectedTotal), path + ' total ' + page);
    const items = keyOf(path) ? response.body[keyOf(path)] : response.body;
    for (const row of items) {
      const id = String(rowId(row));
      assert.equal(seen.has(id), false, path + ' duplicate ' + id);
      seen.add(id);
      rows.push(row);
    }
    assert.ok(items.length > 0, path + ' empty page');
  }
  assert.equal(rows.length, expectedTotal, path + ' sum of pages');
  return rows;
}

const keys = {
  '/api/admin/requests?status=all': 'requests',
  '/api/admin/teacher-notes': 'notes',
  '/api/admin/notifications?status=all': 'notifications',
};
function keyOf(path) {
  for (const [prefix, key] of Object.entries(keys)) if (path.startsWith(prefix)) return key;
  return null;
}

one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'ADM-1','Admin Paging Student','active',DATE '2026-01-01');`);
const seededStudent = one(`SELECT id FROM students WHERE student_code='ADM-1';`);
const seededEnrollment = one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (gen_random_uuid(),${q(seededStudent)},${q(c.circleId)},DATE '2026-01-01',0,'active') RETURNING id;`);
one(`INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due)
  VALUES (gen_random_uuid(),${q(seededEnrollment)},date_trunc('month',current_date)::date,10);`);

one(`INSERT INTO teacher_attendance(id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,
  status,hourly_rate_snapshot,payable_amount,note,marked_by,actual_duration_minutes,pay_basis)
  SELECT gen_random_uuid(),${q(c.slotId)},${q(c.circleId)},${q(c.teacherId)}, d::date, TIME '10:00', 60,
  'present', 60, 60, 'Admin stability note '||to_char(d,'DD'), ${q(c.adminId)}, 60, 'manual'
  FROM generate_series(DATE '2026-10-01', DATE '2026-10-07', interval '1 day') AS d;`);
one(`INSERT INTO student_attendance(id,enrollment_id,schedule_slot_id,session_date,status,note,marked_by)
  SELECT gen_random_uuid(),${q(seededEnrollment)},${q(c.slotId)}, d::date, 'present', NULL, ${q(c.adminId)}
  FROM generate_series(DATE '2026-10-01', DATE '2026-10-07', interval '1 day') AS d;`);
one(`INSERT INTO attendance_requests(id,request_type,teacher_id,circle_id,schedule_slot_id,request_date,requested_by,reason,status,created_at)
  SELECT gen_random_uuid(),'absence',${q(c.teacherId)},${q(c.circleId)},${q(c.slotId)},DATE '2026-10-05',
  ${q(c.adminId)},'Admin stability request','pending',TIMESTAMPTZ '2026-10-05 10:00:00+02' FROM generate_series(1,7);`);
one(`INSERT INTO notifications(id,role_scope,category,status,severity,title,body,dedupe_key,created_at)
  SELECT gen_random_uuid(),'admin','system','open','info','Admin notification','Body '||g,'admin-notif-'||g,
  TIMESTAMPTZ '2026-10-05 10:00:00+02' FROM generate_series(1,7) g;`);
one(`INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,details)
  SELECT ${q(c.adminId)},'Q6 Admin','admin.test','test','{}'::jsonb FROM generate_series(1,7);`);
one(`INSERT INTO trash_items(id,entity_type,entity_id,display_name,record_snapshot,deleted_at,expires_at)
  SELECT gen_random_uuid(),'test',gen_random_uuid(),'Trash '||g,'{}'::jsonb,
  TIMESTAMPTZ '2026-10-05 10:00:00+02',TIMESTAMPTZ '2026-11-05 10:00:00+02' FROM generate_series(1,7) g;`);
one(`INSERT INTO system_backups(id,backup_file_name,backup_path,status,started_at)
  SELECT gen_random_uuid(),'admin-'||g||'.dump','/tmp/admin-'||g||'.dump','completed',
  TIMESTAMPTZ '2026-10-05 10:00:00+02' FROM generate_series(1,7) g;`);
one(`INSERT INTO collection_reports(id,title,billing_month,snapshot,saved_by,created_at)
  SELECT gen_random_uuid(),'Admin report '||g,DATE '2026-11-01','{}'::jsonb,${q(c.adminId)},
  TIMESTAMPTZ '2026-10-05 10:00:00+02' FROM generate_series(1,7) g;`);

assert.equal(one('SELECT count(*) FROM attendance_requests;'), '7', 'seeded admin requests');
assert.equal(one('SELECT count(*) FROM notifications;'), '7', 'seeded admin notifications');
const auditTotal = Number(one('SELECT count(*) FROM audit_log;'));

await walk('/api/admin/requests?status=all', 7, row => row.id);
await walk('/api/admin/teacher-notes', 7, row => row.id);
await walk('/api/admin/notifications?status=all', 7, row => row.id);
const audit = await getJson('/api/admin/audit-log?page=1&pageSize=2');
assert.equal(audit.status, 200);
assert.equal(audit.headers.get('X-Total-Count'), String(auditTotal));
assert.equal(audit.body.length, Math.min(2, auditTotal));
const auditUnpaged = await getJson('/api/admin/audit-log');
assert.equal(auditUnpaged.body.length, auditTotal);
await walk('/api/admin/trash', 7, row => row.id);
await walk('/api/admin/backups', 7, row => row.id);
await walk('/api/collection-reports', 7, row => row.id);

const teacherHistory = await getJson(`/api/teachers/${c.teacherId}/history?page=1&pageSize=2`);
assert.equal(teacherHistory.status, 200);
assert.equal(teacherHistory.headers.get('X-Total-Count'), '7');
assert.equal(teacherHistory.body.attendance.length, 2);
assert.equal(teacherHistory.body.attendanceTotal, 7);

const collectionsSummary = await getJson('/api/summary/collections?month=2026-11');
assert.equal(collectionsSummary.status, 200);
const collectionPages = [];
for (let page = 1; page <= 2; page += 1) collectionPages.push(await getJson(`/api/collections?month=2026-11&page=${page}&pageSize=2`));
const collectionRows = collectionPages.flatMap(item => item.body);
assert.equal(collectionPages[0].headers.get('X-Total-Count'), String(collectionRows.length));
const cents = value => Math.round(Number(value) * 100);
assert.equal(collectionsSummary.body.rowCount, collectionRows.length, 'collections summary rows');
assert.equal(cents(collectionsSummary.body.totalDue), collectionRows.reduce((sum, row) => sum + cents(row.amountDue), 0), 'collections due exact');
assert.equal(cents(collectionsSummary.body.totalBalance), collectionRows.reduce((sum, row) => sum + cents(row.balance), 0), 'collections balance exact');

const attendancePages = [];
for (let page = 1; page <= 4; page += 1) attendancePages.push(await getJson(`/api/teacher-attendance?month=2026-10&page=${page}&pageSize=2`));
const attendanceRows = attendancePages.flatMap(item => item.body);
assert.equal(attendanceRows.length, 7);
const attendanceSummary = await getJson('/api/summary/teacher-attendance?month=2026-10');
assert.equal(attendanceSummary.status, 200);
assert.equal(attendanceSummary.body.sessionCount, 7, 'attendance summary sessions');
assert.equal(attendanceSummary.body.presentCount, 7, 'attendance summary present');
assert.equal(cents(attendanceSummary.body.payableAmount), 42000, 'attendance summary payable exact');

const options = await getJson('/api/finance-entry-options?month=2026-10&page=1&pageSize=2');
assert.equal(options.status, 200);
assert.equal(options.headers.get('X-Total-Count'), '1');
assert.equal(options.body.enrollments.length, 1);
assert.equal(options.body.enrollmentsTotal, 1);
const optionsSummary = await getJson('/api/summary/finance-entry-options?month=2026-10');
assert.equal(optionsSummary.body.enrollments, 1, 'options summary enrollments exact');
assert.equal(optionsSummary.body.charges, 0, 'options summary charges exact');

const roster = await walk(`/api/circles/${c.circleId}/students`, 1, row => row.enrollmentId);
assert.equal(roster[0].studentCode, 'ADM-1');

const userTotal = Number(one('SELECT count(*) FROM app_users;'));
const users = await getJson('/api/admin/users?page=1&pageSize=2');
assert.equal(users.status, 200);
assert.equal(users.headers.get('X-Total-Count'), String(userTotal));
assert.equal(users.body.length, Math.min(2, userTotal));
const usersUnpaged = await getJson('/api/admin/users');
assert.equal(usersUnpaged.body.length, userTotal);

const resetCandidates = await walk('/api/admin/reset-candidates/teacher-attendance', 7, row => row.id);
assert.equal(resetCandidates.length, 7);
const emptyExpenses = await getJson('/api/advertising-expenses?month=2026-11&page=1&pageSize=2');
assert.equal(emptyExpenses.headers.get('X-Total-Count'), '0');
assert.equal(emptyExpenses.body.length, 0);

const studentHistory = await getJson(`/api/students/${seededStudent}/history?page=1&pageSize=2`);
assert.equal(studentHistory.status, 200);
assert.equal(studentHistory.headers.get('X-Total-Count'), '7');
assert.equal(studentHistory.body.attendance.length, 2);
assert.equal(studentHistory.body.attendanceTotal, 7);

// S-1.15-S-1.17: teacher roster, earnings/subscriptions, charge-audit and scopes.
const teacherSessionId = one(`INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,ended_at,status,scheduled_duration_minutes,actual_duration_minutes)
  VALUES (gen_random_uuid(),${q(c.teacherId)},${q(c.circleId)},${q(c.slotId)},DATE '2026-10-01',
  TIMESTAMPTZ '2026-10-01 10:00:00+02',TIMESTAMPTZ '2026-10-01 11:00:00+02','completed',60,60) RETURNING id;`);
one("INSERT INTO user_permissions(user_id,permission_code) SELECT id,'teacher.students.read' FROM app_users WHERE teacher_id=" + q(c.teacherId) + " ON CONFLICT DO NOTHING;");
one("INSERT INTO user_permissions(user_id,permission_code) SELECT id,'teacher.attendance' FROM app_users WHERE teacher_id=" + q(c.teacherId) + " ON CONFLICT DO NOTHING;");
one("INSERT INTO user_permissions(user_id,permission_code) SELECT id,'teacher.earnings.self' FROM app_users WHERE teacher_id=" + q(c.teacherId) + " ON CONFLICT DO NOTHING;");
one("INSERT INTO user_permissions(user_id,permission_code) SELECT id,'teacher.subscriptions.read' FROM app_users WHERE teacher_id=" + q(c.teacherId) + " ON CONFLICT DO NOTHING;");
async function newLogin(username) {
  const response = await fetch(process.env.Q6_NEW_URL + '/api/v1/auth/password', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: process.env.Q6_PASSWORD }),
  });
  assert.equal(response.status, 200, username + ' login');
  return { cookie: response.headers.getSetCookie().map(x => x.split(';')[0]).join('; ') };
}
const teacherAuth = await newLogin('q6_teacher');
const adminAuth = await newLogin('q6_admin');
async function getNew(path, auth) {
  const response = await fetch(process.env.Q6_NEW_URL + path, { headers: auth });
  return { status: response.status, headers: response.headers, body: await readJson(response, path) };
}
const teacherRoster = await getNew(`/api/v1/teacher/sessions/${teacherSessionId}/roster?page=1&pageSize=20`, teacherAuth);
assert.equal(teacherRoster.status, 200, 'teacher roster status');
assert.equal(teacherRoster.headers.get('X-Total-Count'), '1');
assert.equal(teacherRoster.body.students.length, 1);
assert.equal(teacherRoster.body.total, 1);
const earnings = await getNew('/api/v1/teacher/earnings?month=2026-10&page=1&pageSize=2', teacherAuth);
assert.equal(earnings.status, 200, 'teacher earnings status');
assert.equal(earnings.headers.get('X-Total-Count'), '7');
assert.equal(earnings.body.sessions.length, 2);
const subscriptions = await getNew('/api/v1/teacher/subscriptions?month=2026-10&page=1&pageSize=2', teacherAuth);
assert.equal(subscriptions.status, 200);
assert.equal(subscriptions.headers.get('X-Total-Count'), '1');
assert.equal(subscriptions.body.students.length, 1);
const chargeAudit = await getJson('/api/admin/charge-audit?month=2026-11&page=1&pageSize=2');
assert.equal(chargeAudit.headers.get('X-Total-Count'), '1');
assert.equal(chargeAudit.body.rows.length, 1);
const scopeTotal = Number(one(`SELECT count(*) FROM app_users u WHERE u.is_active=TRUE
  AND EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id=u.id AND up.permission_code LIKE 'supervisor.%')`));
const scopes = await getNew('/api/v1/supervisor/scopes?page=1&pageSize=2', adminAuth);
assert.equal(scopes.status, 200, 'scopes status');
assert.equal(scopes.headers.get('X-Total-Count'), String(scopeTotal));
const optionsPage = await getNew('/api/v1/supervisor/scopes/options?page=1&pageSize=2', adminAuth);
assert.equal(optionsPage.status, 200, 'scope options status');
assert.equal(optionsPage.headers.get('X-Total-Count'), '1');
assert.equal(optionsPage.body.circles.length, 1);
assert.equal(optionsPage.body.circlesTotal, 1);

// S-1.15 C1-C3: supervisor detail sub-lists must expose their own totals.
const detailStudent = await getNew(`/api/v1/supervisor/students/${seededStudent}?page=1&pageSize=2`, adminAuth);
assert.equal(detailStudent.status, 200, 'supervisor student detail status');
assert.equal(detailStudent.body.historyTotal, 7);
assert.equal(detailStudent.body.history.length, 2);
const detailTeacher = await getNew(`/api/v1/supervisor/teachers/${c.teacherId}?from=2026-10-01&to=2026-10-31&page=1&pageSize=2`, adminAuth);
assert.equal(detailTeacher.status, 200, 'supervisor teacher detail status');
assert.equal(detailTeacher.body.historyTotal, 7);
assert.equal(detailTeacher.body.history.length, 2);
const detailCircle = await getNew(`/api/v1/supervisor/circles/${c.circleId}?page=1&pageSize=2`, adminAuth);
assert.equal(detailCircle.status, 200, 'supervisor circle detail status');
assert.ok('sessionsTotal' in detailCircle.body, 'circle detail exposes sessions total');

// S-1.18: server search/status filters must change the total, not just the page.
const filteredStudents = await getJson('/api/students?search=ADM-1&page=1&pageSize=50');
assert.equal(filteredStudents.headers.get('X-Total-Count'), '1');
assert.equal(filteredStudents.body.length, 1);
assert.equal(filteredStudents.body[0].studentCode, 'ADM-1');
const filteredTeachers = await getJson('/api/teachers?status=active&page=1&pageSize=50');
assert.equal(filteredTeachers.headers.get('X-Total-Count'), '1');
assert.equal(filteredTeachers.body[0].status, 'active');
const filteredCircles = await getJson(`/api/circles?search=${encodeURIComponent('Q6')}&page=1&pageSize=50`);
assert.equal(filteredCircles.headers.get('X-Total-Count'), '1');

console.log(JSON.stringify({ suite: 'pagination-admin', ok: true, cases: 34 }));
