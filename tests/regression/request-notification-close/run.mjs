#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CONN = process.env.DAR_TEST_DATABASE || '';
const LEGACY = process.env.P15_LEGACY_URL || '';
const NEW_API = process.env.P15_NEW_URL || '';
const SETUP_TOKEN = process.env.P15_SETUP_TOKEN || '';
const PASSWORD = process.env.P15_PASSWORD || 'P15-StrongPass!';
const EXPECTED_TESTS = 10;
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];

function fail(message) { console.error('P15_FAIL refusing/failed: ' + message); process.exit(2); }
function isLoopback(host) { return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'; }
if (!CONN || !LEGACY || !NEW_API || !SETUP_TOKEN) fail('missing env');
if (/database\s*=\s*dareltahfeez\b/i.test(CONN)) fail('production database');
for (const raw of [LEGACY, NEW_API]) {
  let url; try { url = new URL(raw); } catch { fail('invalid URL'); }
  if (PROD_HOSTS.includes(url.hostname.toLowerCase()) || !isLoopback(url.hostname.toLowerCase())) fail('non-test URL');
}

function pgEnv() {
  const env = { ...process.env };
  for (const part of CONN.split(';')) {
    const idx = part.indexOf('='); if (idx < 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase(); const value = part.slice(idx + 1).trim();
    if (key === 'host') env.PGHOST = value;
    if (key === 'port') env.PGPORT = value;
    if (key === 'database') env.PGDATABASE = value;
    if (key === 'username') env.PGUSER = value;
    if (key === 'password') env.PGPASSWORD = value;
  }
  return env;
}
const PGENV = pgEnv();
function psql(text) {
  const result = spawnSync('psql', ['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',text], { env: PGENV, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('psql failed: ' + (result.stderr || '').trim());
  return (result.stdout || '').trim();
}
function q(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
function one(statement) { return psql(statement); }

async function login(base, path, username, password) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const text = await response.text();
  if (!response.ok) throw new Error('login ' + username + ' ' + response.status + ': ' + text.slice(0, 120));
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  return cookies.filter(Boolean).map((v) => v.split(';')[0]).join('; ');
}
async function request(base, cookie, method, path, body) {
  const response = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json };
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function assertEq(actual, expected, message) { if (actual !== expected) throw new Error(message + ': got ' + actual + ' expected ' + expected); }

const results = [];
async function testCase(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: String(error && error.message || error) }); }
}

function seedBase() {
  const teacher = randomUUID(), circle = randomUUID(), slot = randomUUID();
  const tag = teacher.slice(0, 8);
  psql('INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate) VALUES (' + q(teacher) + ',' + q('P15-T-' + tag) + ",'P15 Teacher','active',60);" +
    'INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on) VALUES (' + q(circle) + ',' + q('P15-C-' + tag) + ",'P15 Circle'," + q(teacher) + ',0,TRUE,DATE \'2026-01-01\');' +
    "INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes, is_active) VALUES (" + q(slot) + ',' + q(circle) + ",1,'10:00',60,TRUE);");
  return { teacher, circle, slot };
}

try {
  const setup = await fetch(LEGACY + '/api/setup/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Setup-Token': SETUP_TOKEN }, body: JSON.stringify({ username: 'p15_admin', displayName: 'P15 Admin', password: PASSWORD }) });
  if (![200,409].includes(setup.status)) throw new Error('setup failed ' + setup.status);
  const adminCookie = await login(LEGACY, '/api/auth/login', 'p15_admin', PASSWORD);
  const adminId = one("SELECT id FROM app_users WHERE username='p15_admin';");
  const base = seedBase();
  async function createUser(username, displayName, permissions, teacherId) {
    const response = await request(LEGACY, adminCookie, 'POST', '/api/admin/users', { username, displayName, password: PASSWORD, permissionCodes: permissions, teacherId });
    if (![201,409].includes(response.status)) throw new Error('create ' + username + ' failed ' + response.status + ': ' + response.text.slice(0, 120));
    return one('SELECT id FROM app_users WHERE username=' + q(username) + ';');
  }
  const teacherUserId = await createUser('p15_teacher', 'P15 Teacher User', ['teacher.portal','teacher.requests','teacher.calendar','teacher.attendance'], base.teacher);
  const supervisorId = await createUser('p15_supervisor', 'P15 Supervisor', ['supervisor.portal','supervisor.attendance.requests','supervisor.students.read'], null);
  const teacherCookie = await login(NEW_API, '/api/v1/auth/password', 'p15_teacher', PASSWORD);
  const supervisorCookie = await login(NEW_API, '/api/v1/auth/password', 'p15_supervisor', PASSWORD);

  async function createRequest(date, reason) {
    const response = await request(NEW_API, teacherCookie, 'POST', '/api/v1/teacher/requests', {
      type: 'absence', scheduleSlotId: base.slot, date, reason
    });
    assertEq(response.status, 201, 'create request');
    const id = response.json.id;
    assertEq(notificationStatus(id), 'open', 'request notification open after create');
    return id;
  }
  function notificationStatus(requestId) {
    return one("SELECT COALESCE(status,'missing') FROM notifications WHERE dedupe_key='request:'||" + q(requestId) + ';');
  }
  function notificationResolvedBy(requestId) {
    return one("SELECT COALESCE(resolved_by::text,'') FROM notifications WHERE dedupe_key='request:'||" + q(requestId) + ';');
  }
  function requestStatus(requestId) { return one('SELECT status FROM attendance_requests WHERE id=' + q(requestId) + ';'); }

  async function supervisorReview(id, approve) {
    return request(NEW_API, supervisorCookie, 'POST', '/api/v1/supervisor/requests/' + id + '/review', { approve, note: 'P1-5 test' });
  }
  async function legacyReview(id, approve) {
    return request(LEGACY, adminCookie, 'POST', '/api/admin/requests/' + id + '/review', { approve, note: 'P1-5 legacy test' });
  }

  await testCase('new_approve_resolves_notification', async () => {
    const id = await createRequest('2026-12-01', 'P1-5 approve');
    const response = await supervisorReview(id, true);
    assertEq(response.status, 200, 'review approve');
    assertEq(requestStatus(id), 'approved', 'request approved');
    assertEq(notificationStatus(id), 'resolved', 'notification resolved');
    assertEq(notificationResolvedBy(id), supervisorId, 'resolved by supervisor');
    const teacherNotif = one("SELECT status FROM notifications WHERE dedupe_key='request-review:'||" + q(id) + ';');
    assertEq(teacherNotif, 'open', 'teacher notification open');
  });
  await testCase('new_reject_resolves_notification', async () => {
    const id = await createRequest('2026-12-02', 'P1-5 reject');
    const response = await supervisorReview(id, false);
    assertEq(response.status, 200, 'review reject');
    assertEq(requestStatus(id), 'rejected', 'request rejected');
    assertEq(notificationStatus(id), 'resolved', 'notification resolved');
  });
  await testCase('teacher_cancel_resolves_notification', async () => {
    const id = await createRequest('2026-12-03', 'P1-5 cancel');
    const response = await request(NEW_API, teacherCookie, 'POST', '/api/v1/teacher/requests/' + id + '/cancel');
    assertEq(response.status, 200, 'teacher cancel');
    assertEq(requestStatus(id), 'cancelled', 'request cancelled');
    assertEq(notificationStatus(id), 'resolved', 'notification resolved');
  });
  await testCase('locked_review_keeps_notification_open', async () => {
    const id = await createRequest('2027-01-05', 'P1-5 locked');
    psql("INSERT INTO payroll_locks(billing_month,is_locked,locked_by,locked_at) VALUES ('2027-01-01',TRUE," + q(supervisorId) + ',now()) ON CONFLICT (billing_month) DO UPDATE SET is_locked=TRUE;');
    const response = await supervisorReview(id, true);
    assertEq(response.status, 409, 'locked review blocked');
    assertEq(requestStatus(id), 'pending', 'request remains pending');
    assertEq(notificationStatus(id), 'open', 'notification remains open');
  });
  await testCase('legacy_approve_resolves_notification', async () => {
    const id = await createRequest('2026-12-04', 'P1-5 legacy approve');
    const response = await legacyReview(id, true);
    assertEq(response.status, 200, 'legacy approve');
    assertEq(requestStatus(id), 'approved', 'legacy request approved');
    assertEq(notificationStatus(id), 'resolved', 'legacy notification resolved');
    assertEq(notificationResolvedBy(id), adminId, 'legacy resolved by admin');
  });
  await testCase('legacy_reject_resolves_notification', async () => {
    const id = await createRequest('2026-12-05', 'P1-5 legacy reject');
    const response = await legacyReview(id, false);
    assertEq(response.status, 200, 'legacy reject');
    assertEq(requestStatus(id), 'rejected', 'legacy request rejected');
    assertEq(notificationStatus(id), 'resolved', 'legacy notification resolved');
  });
  await testCase('legacy_reopen_reopens_notification', async () => {
    const id = await createRequest('2026-12-06', 'P1-5 reopen');
    assertEq((await supervisorReview(id, true)).status, 200, 'approve before reopen');
    assertEq(notificationStatus(id), 'resolved', 'resolved before reopen');
    const response = await request(LEGACY, adminCookie, 'POST', '/api/admin/requests/' + id + '/reopen');
    assertEq(response.status, 200, 'reopen');
    assertEq(requestStatus(id), 'pending', 'request pending after reopen');
    assertEq(notificationStatus(id), 'open', 'notification reopened');
  });
  await testCase('legacy_delete_resolves_notification', async () => {
    const id = await createRequest('2026-12-07', 'P1-5 delete');
    const response = await request(LEGACY, adminCookie, 'POST', '/api/admin/requests/' + id + '/delete');
    assertEq(response.status, 200, 'delete');
    assertEq(notificationStatus(id), 'resolved', 'notification resolved after delete');
  });
  await testCase('unrelated_notification_remains_open', async () => {
    const id = await createRequest('2026-12-08', 'P1-5 unrelated');
    const other = randomUUID();
    psql("INSERT INTO notifications(id,user_id,role_scope,category,status,severity,title,body,entity_type,dedupe_key) VALUES (" + q(other) + ",NULL,'supervisor','attendance','open','info','Other','Other','other'," + q('other:' + other) + ');');
    assertEq((await supervisorReview(id, true)).status, 200, 'review unrelated');
    assertEq(one('SELECT status FROM notifications WHERE id=' + q(other) + ';'), 'open', 'unrelated stays open');
  });
  await testCase('already_reviewed_does_not_reopen', async () => {
    const id = await createRequest('2026-12-09', 'P1-5 already');
    assertEq((await supervisorReview(id, true)).status, 200, 'first review');
    const second = await supervisorReview(id, true);
    assertEq(second.status, 409, 'second review conflict');
    assertEq(notificationStatus(id), 'resolved', 'notification stays resolved');
  });

  const failures = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ expectedTests: EXPECTED_TESTS, executed: results.length, passed: results.length - failures.length, failed: failures.length, failures, results }, null, 2));
  if (results.length !== EXPECTED_TESTS) { console.error('P15_FAIL executed ' + results.length); process.exit(3); }
  if (failures.length) process.exit(1);
  console.log('P15_PASS ' + results.length + '/' + EXPECTED_TESTS);
} catch (error) {
  console.error('P15_FATAL ' + String(error && error.stack || error));
  process.exit(4);
}
