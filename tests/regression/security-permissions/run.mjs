import { strict as assert } from 'node:assert';
import { setup, one, q, OLD, req } from '../request-workflow/common.mjs';

// FINAL batch-3 security review: three authorization fixes, each with a failing-first case.
//   A1/A8: reset-candidates now require students.read + finance.read and apply the circle scope.
//   A3:    permanent trash purge is owner-only (trash.manage AND users.manage).
//   A9:    a users.manage holder cannot grant permission codes it does not hold itself.
const c = await setup();
const PASSWORD = process.env.Q6_PASSWORD || 'RegressionStrong!';

async function loginAs(username) {
  const response = await fetch(OLD + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  assert.equal(response.status, 200, 'login failed for ' + username + ': ' + response.status);
  const cookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')];
  return cookies.filter(Boolean).map((value) => value.split(';')[0]).join('; ');
}

async function createUser(username, permissions) {
  const response = await req(OLD, c.admin, 'POST', '/api/admin/users', {
    username,
    displayName: username,
    password: PASSWORD,
    isActive: true,
    permissionCodes: permissions,
  });
  assert.equal(response.status, 201, 'could not create ' + username + ': ' + response.status + ' ' + response.text.slice(0, 240));
  return JSON.parse(response.text).id;
}

async function setScope(userId, circleIds) {
  const response = await req(OLD, c.admin, 'PUT', '/api/admin/users/' + userId + '/access', {
    teacherId: null,
    isLocked: false,
    lockReason: null,
    scopeCircleIds: circleIds,
  });
  assert.equal(response.status, 200, 'set scope failed: ' + response.status + ' ' + response.text.slice(0, 240));
}

// A second circle + teacher so the scope filter has something it must hide.
const circleOneName = one(`SELECT name FROM circles WHERE id=${q(c.circleId)};`);
const teacherTwoId = one(`INSERT INTO teachers(teacher_code, full_name, status, hourly_rate) VALUES ('SEC-T2','SEC Teacher 2','active',50) RETURNING id;`);
const circleTwoId = one(`INSERT INTO circles(circle_code, name, teacher_id, monthly_fee, is_active, starts_on) VALUES ('SEC-C2','SEC Circle 2',${q(teacherTwoId)},0,TRUE,DATE '2026-01-01') RETURNING id;`);
one(`INSERT INTO teacher_attendance(circle_id, teacher_id, session_date, scheduled_start, duration_minutes, status, hourly_rate_snapshot)
     VALUES (${q(c.circleId)}, ${q(c.teacherId)}, DATE '2026-11-24', '10:00', 60, 'present', 60);`);
one(`INSERT INTO teacher_attendance(circle_id, teacher_id, session_date, scheduled_start, duration_minutes, status, hourly_rate_snapshot)
     VALUES (${q(circleTwoId)}, ${q(teacherTwoId)}, DATE '2026-11-25', '10:00', 60, 'present', 50);`);

const limitedId = await createUser('sec_limited', ['users.manage', 'dashboard.read', 'trash.manage']);
const purgeUserId = await createUser('sec_purge', ['trash.manage', 'students.delete']);
const scopedId = await createUser('sec_scoped', ['trash.manage', 'finance.read', 'students.read', 'attendance.read', 'backup.manage']);
await setScope(scopedId, [c.circleId]);
const limited = await loginAs('sec_limited');
const purgeUser = await loginAs('sec_purge');
const scoped = await loginAs('sec_scoped');

// ---------------------------------------------------------------------------
// A1/A8 — reset candidates require read permissions and use the circle scope.
// ---------------------------------------------------------------------------
const adminAggregate = await req(OLD, c.admin, 'GET', '/api/admin/reset-candidates');
assert.equal(adminAggregate.status, 200, 'admin reset candidates failed: ' + adminAggregate.status);
const adminPayload = JSON.parse(adminAggregate.text);
assert.ok(adminPayload.teacherAttendance.length >= 2, 'admin fixture must see both attendance candidates');

const limitedAggregate = await req(OLD, limited, 'GET', '/api/admin/reset-candidates');
assert.equal(limitedAggregate.status, 403, 'a manager without students.read/finance.read must not read reset candidates');
assert.match(limitedAggregate.text, /صلاحية/, 'expected a permission error');

const scopedAggregate = await req(OLD, scoped, 'GET', '/api/admin/reset-candidates');
assert.equal(scopedAggregate.status, 200, 'scoped user with read permissions must be allowed');
const scopedPayload = JSON.parse(scopedAggregate.text);
assert.ok(scopedPayload.teacherAttendance.length >= 1, 'scoped user must still see its own circle candidates');
for (const row of scopedPayload.teacherAttendance) {
  assert.ok(!row.label.includes('SEC Circle 2'), 'scoped reset candidates leaked another circle: ' + row.label);
  assert.ok(row.label.includes(circleOneName), 'scoped reset candidates leaked a circle outside scope: ' + row.label);
}

const adminPaged = await req(OLD, c.admin, 'GET', '/api/admin/reset-candidates/teacher-attendance');
assert.equal(adminPaged.status, 200, 'admin paged reset candidates failed');
assert.equal(JSON.parse(adminPaged.text).length, 2, 'admin paged list must include both circles');

const limitedPaged = await req(OLD, limited, 'GET', '/api/admin/reset-candidates/teacher-attendance');
assert.equal(limitedPaged.status, 403, 'paged reset candidates must require attendance.read');

const scopedPaged = await req(OLD, scoped, 'GET', '/api/admin/reset-candidates/teacher-attendance');
assert.equal(scopedPaged.status, 200, 'scoped paged reset candidates failed');
const scopedPagedRows = JSON.parse(scopedPaged.text);
assert.equal(scopedPagedRows.length, 1, 'scoped paged list must contain only the in-scope circle');
assert.ok(scopedPagedRows[0].label.includes(circleOneName), 'scoped paged list leaked another circle: ' + scopedPagedRows[0].label);

const unknownEntity = await req(OLD, c.admin, 'GET', '/api/admin/reset-candidates/not-a-list');
assert.equal(unknownEntity.status, 404, 'unknown reset-candidate list must be 404');

// ---------------------------------------------------------------------------
// A3 — permanent purge is owner-only (trash.manage AND users.manage).
// ---------------------------------------------------------------------------
const studentId = one(`INSERT INTO students(student_code, full_name, status, joined_on)
  VALUES ('SEC-PURGE-1','SEC Purge Student','active',DATE '2026-01-01') RETURNING id;`);
const move = await req(OLD, purgeUser, 'POST', '/api/admin/trash', { entityType: 'student', entityId: studentId });
assert.equal(move.status, 200, 'moving a student to trash must keep working for trash managers: ' + move.text.slice(0, 240));
const trashId = JSON.parse(move.text).id;
const purgeDenied = await req(OLD, purgeUser, 'DELETE', '/api/admin/trash/' + trashId);
assert.equal(purgeDenied.status, 403, 'a trash manager without users.manage must not permanently delete rows');
const purgeAllowed = await req(OLD, c.admin, 'DELETE', '/api/admin/trash/' + trashId);
assert.equal(purgeAllowed.status, 200, 'the owner/admin purge failed: ' + purgeAllowed.status + ' ' + purgeAllowed.text.slice(0, 240));
assert.equal(Number(one(`SELECT count(*) FROM students WHERE id=${q(studentId)};`)), 0, 'purge did not delete the row');

// ---------------------------------------------------------------------------
// A9 — users.manage cannot grant permissions the caller does not hold.
// ---------------------------------------------------------------------------
const escalation = await req(OLD, limited, 'POST', '/api/admin/users', {
  username: 'sec_escalated', displayName: 'sec escalated', password: PASSWORD, isActive: true,
  permissionCodes: ['users.manage', 'dashboard.read', 'finance.read'],
});
assert.equal(escalation.status, 403, 'a limited user manager must not grant finance.read it does not hold');
assert.match(escalation.text, /لا يمكنك منح/, 'expected the escalation warning message');

const heldGrant = await req(OLD, limited, 'POST', '/api/admin/users', {
  username: 'sec_held', displayName: 'sec held', password: PASSWORD, isActive: true,
  permissionCodes: ['dashboard.read'],
});
assert.equal(heldGrant.status, 201, 'granting a permission the caller holds must stay allowed: ' + heldGrant.text.slice(0, 240));

const financeUserId = await createUser('sec_finance_holder', ['dashboard.read', 'finance.read']);
const keepExisting = await req(OLD, limited, 'PUT', '/api/admin/users/' + financeUserId, {
  username: 'sec_finance_holder', displayName: 'sec finance edited', password: null, isActive: true,
  permissionCodes: ['dashboard.read', 'finance.read'],
});
assert.equal(keepExisting.status, 200, 'editing a target without adding new permissions must be allowed: ' + keepExisting.text.slice(0, 240));

const addNew = await req(OLD, limited, 'PUT', '/api/admin/users/' + financeUserId, {
  username: 'sec_finance_holder', displayName: 'sec finance edited', password: null, isActive: true,
  permissionCodes: ['dashboard.read', 'finance.read', 'attendance.read'],
});
assert.equal(addNew.status, 403, 'adding a permission the caller does not hold must be rejected');

// Sanity: the limited manager still has full user management of the permissions it holds.
const limitedSelf = await loginAs('sec_held');
assert.ok(limitedSelf.length > 0, 'limited held user must be able to log in');

console.log(JSON.stringify({
  suite: 'security-permissions',
  ok: true,
  cases: 14,
  scopedCirclea: circleOneName,
  limitedUser: limitedId,
}));
