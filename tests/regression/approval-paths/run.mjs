#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CONN = process.env.DAR_TEST_DATABASE || '';
const LEGACY = process.env.Q1_LEGACY_URL || '';
const NEW_API = process.env.Q1_NEW_URL || '';
const SETUP_TOKEN = process.env.Q1_SETUP_TOKEN || '';
const PASSWORD = process.env.Q1_PASSWORD || 'Q1-StrongPass!';
const USER = 'q1_reviewer';
const ADMIN = 'q1_admin';
const EXPECTED_TESTS = 20;

if (!CONN || !LEGACY || !NEW_API || !SETUP_TOKEN) {
  console.error('Q1_FAIL missing DAR_TEST_DATABASE/Q1_LEGACY_URL/Q1_NEW_URL/Q1_SETUP_TOKEN');
  process.exit(2);
}

function pgEnv() {
  const env = { ...process.env };
  for (const part of CONN.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
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
  const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', text], {
    env: PGENV, encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error('psql failed: ' + (result.stderr || '').trim());
  return (result.stdout || '').trim();
}
function sql(statement) { psql(statement); }
function one(statement) { return psql(statement); }

async function login(base, path, username, password) {
  const response = await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const text = await response.text();
  if (!response.ok) throw new Error('login ' + username + ' ' + response.status + ': ' + text.slice(0, 160));
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  return cookies.filter(Boolean).map((value) => value.split(';')[0]).join('; ');
}
async function request(base, cookie, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: response.status, text, json: parsed };
}

function q(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }

function seedFixture(testCase, reviewerId) {
  const ids = {
    teacher: randomUUID(), circle: randomUUID(), slot: randomUUID(),
    session: randomUUID(), attendance: randomUUID(), request: randomUUID()
  };
  const tag = ids.teacher.slice(0, 8);
  const date = testCase.date;
  const month = date.slice(0, 7) + '-01';
  const lines = [];
  lines.push("INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate) VALUES (" + q(ids.teacher) + "," + q('Q1-T-' + tag) + ",'Q1 Test Teacher','active',60);");
  lines.push("INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on) VALUES (" + q(ids.circle) + "," + q('Q1-C-' + tag) + ",'Q1 Test Circle'," + q(ids.teacher) + ",0,TRUE,DATE '2026-01-01');");
  if (testCase.slot !== false) {
    lines.push("INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes, is_active) VALUES (" + q(ids.slot) + "," + q(ids.circle) + ",1,'10:00',60,TRUE);");
  }
  if (testCase.session !== false) {
    const sessionStatus = testCase.initial === 'none' ? 'in_progress' : 'completed';
    const ended = sessionStatus === 'completed' ? "now() + INTERVAL '60 minutes'" : 'NULL';
    lines.push("INSERT INTO teacher_sessions(id, teacher_id, circle_id, schedule_slot_id, session_date, started_at, ended_at, status, scheduled_duration_minutes, actual_duration_minutes, payable_duration_minutes, pay_basis) VALUES (" + q(ids.session) + "," + q(ids.teacher) + "," + q(ids.circle) + "," + q(ids.slot) + "," + q(date) + ",now() - INTERVAL '10 minutes'," + ended + "," + q(sessionStatus) + ",60,60,60,'actual');");
  }
  if (testCase.initial === 'present' || testCase.initial === 'absent') {
    const amount = testCase.initial === 'present' ? '60' : '0';
    const actual = testCase.initial === 'present' ? '60' : '0';
    lines.push("INSERT INTO teacher_attendance(id, schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start, duration_minutes, status, hourly_rate_snapshot, payable_amount, marked_by, teacher_session_id, actual_duration_minutes, pay_basis) VALUES (" + q(ids.attendance) + "," + q(ids.slot) + "," + q(ids.circle) + "," + q(ids.teacher) + "," + q(date) + ",'10:00',60," + q(testCase.initial) + ",60," + amount + "," + q(reviewerId) + "," + q(ids.session) + "," + actual + ",'actual');");
  }
  const payload = testCase.payload || '{}';
  lines.push("INSERT INTO attendance_requests(id, request_type, teacher_id, circle_id, schedule_slot_id, attendance_id, request_date, requested_by, reason, requested_payload, status) VALUES (" + q(ids.request) + "," + q(testCase.type) + "," + q(ids.teacher) + "," + q(ids.circle) + "," + (testCase.slot === false ? 'NULL' : q(ids.slot)) + "," + (testCase.initial === 'present' || testCase.initial === 'absent' ? q(ids.attendance) : 'NULL') + "," + (testCase.date ? q(testCase.date) : 'NULL') + "," + q(reviewerId) + ",'Q1 fixture'," + q(payload) + "::jsonb," + q(testCase.requestStatus || 'pending') + ");");
  if (testCase.locked) {
    lines.push("INSERT INTO payroll_locks(billing_month, is_locked, locked_by, locked_at) VALUES (" + q(month) + ",TRUE," + q(reviewerId) + ",now()) ON CONFLICT (billing_month) DO UPDATE SET is_locked=TRUE,locked_at=now();");
  }
  sql('BEGIN;' + lines.join(' ') + 'COMMIT;');
  return ids;
}

function readState(testCase, ids) {
  const att = one("SELECT json_build_object('requestStatus',(SELECT status FROM attendance_requests WHERE id=" + q(ids.request) + "),'attendance',(SELECT json_build_object('status',status,'durationMinutes',duration_minutes,'payableAmount',payable_amount) FROM teacher_attendance WHERE schedule_slot_id=" + q(ids.slot) + " AND session_date=" + q(testCase.date) + "),'sessionStatus',(SELECT status FROM teacher_sessions WHERE id=" + q(ids.session) + "))::text;");
  return JSON.parse(att || '{}');
}

function checkCase(testCase, state) {
  const errors = [];
  if (state.requestStatus !== testCase.expectedRequest) errors.push('request=' + state.requestStatus + ' expected=' + testCase.expectedRequest);
  if (testCase.expectedHttp) {
    // status already checked outside
  }
  const a = state.attendance;
  if (testCase.expectedAttendanceStatus === null) {
    if (a !== null) errors.push('attendance should be absent but found ' + a.status);
  } else if (a === null) {
    errors.push('attendance missing');
  } else {
    if (a.status !== testCase.expectedAttendanceStatus) errors.push('attendance.status=' + a.status + ' expected=' + testCase.expectedAttendanceStatus);
    if (testCase.expectedPay !== undefined && Number(a.payableAmount) !== Number(testCase.expectedPay)) errors.push('pay=' + a.payableAmount + ' expected=' + testCase.expectedPay);
    if (testCase.expectedDuration !== undefined && Number(a.durationMinutes) !== Number(testCase.expectedDuration)) errors.push('duration=' + a.durationMinutes + ' expected=' + testCase.expectedDuration);
  }
  if (testCase.expectedSession !== undefined && state.sessionStatus !== testCase.expectedSession) errors.push('session=' + state.sessionStatus + ' expected=' + testCase.expectedSession);
  return errors;
}

const cases = [
  { name: 'absence_approve_unlocked', type: 'absence', date: '2026-12-07', initial: 'none', payload: '{}', approve: true, expectedHttp: 200, expectedRequest: 'approved', expectedAttendanceStatus: 'absent', expectedPay: 0, expectedSession: 'cancelled' },
  { name: 'cancellation_approve_unlocked', type: 'cancellation', date: '2026-12-08', initial: 'none', payload: '{}', approve: true, expectedHttp: 200, expectedRequest: 'approved', expectedAttendanceStatus: 'cancelled', expectedPay: 0, expectedSession: 'cancelled' },
  { name: 'correction_absent_to_present', type: 'correction', date: '2026-12-09', initial: 'absent', payload: '{"durationMinutes":30,"status":"present"}', approve: true, expectedHttp: 200, expectedRequest: 'approved', expectedAttendanceStatus: 'present', expectedPay: 30, expectedDuration: 30, expectedSession: 'completed' },
  { name: 'correction_present_to_absent', type: 'correction', date: '2026-12-10', initial: 'present', payload: '{"durationMinutes":45,"status":"absent"}', approve: true, expectedHttp: 200, expectedRequest: 'approved', expectedAttendanceStatus: 'absent', expectedPay: 0, expectedDuration: 45, expectedSession: 'completed' },
  { name: 'absence_approve_locked', type: 'absence', date: '2026-10-07', initial: 'none', payload: '{}', approve: true, locked: true, expectedHttp: 409, expectedRequest: 'pending', expectedAttendanceStatus: null, expectedSession: 'in_progress' },
  { name: 'cancellation_approve_locked', type: 'cancellation', date: '2026-10-08', initial: 'none', payload: '{}', approve: true, locked: true, expectedHttp: 409, expectedRequest: 'pending', expectedAttendanceStatus: null, expectedSession: 'in_progress' },
  { name: 'correction_approve_locked', type: 'correction', date: '2026-10-09', initial: 'present', payload: '{"durationMinutes":30,"status":"present"}', approve: true, locked: true, expectedHttp: 409, expectedRequest: 'pending', expectedAttendanceStatus: 'present', expectedPay: 60, expectedDuration: 60, expectedSession: 'completed' },
  { name: 'absence_reject', type: 'absence', date: '2026-12-13', initial: 'none', payload: '{}', approve: false, expectedHttp: 200, expectedRequest: 'rejected', expectedAttendanceStatus: null, expectedSession: 'in_progress' },
  { name: 'absence_already_reviewed', type: 'absence', date: '2026-12-14', initial: 'none', payload: '{}', requestStatus: 'approved', approve: true, expectedHttp: 409, expectedRequest: 'approved', expectedAttendanceStatus: null, expectedSession: 'in_progress' },
  { name: 'absence_missing_slot', type: 'absence', date: '2026-12-15', initial: 'none', slot: false, session: false, payload: '{}', approve: true, expectedHttp: 400, expectedRequest: 'pending', expectedAttendanceStatus: null }
];

let legacyCookie = '';
let newCookie = '';
let reviewerId = '';

try {
  const setupResponse = await fetch(LEGACY + '/api/setup/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Setup-Token': SETUP_TOKEN },
    body: JSON.stringify({ username: ADMIN, displayName: 'Q1 Setup Admin', password: PASSWORD })
  });
  const setupText = await setupResponse.text();
  if (setupResponse.status !== 200 && setupResponse.status !== 409) throw new Error('setup failed ' + setupResponse.status + ': ' + setupText.slice(0, 160));
  const adminCookie = await login(LEGACY, '/api/auth/login', ADMIN, PASSWORD);
  const create = await request(LEGACY, adminCookie, 'POST', '/api/admin/users', {
    username: USER, displayName: 'Q1 Reviewer', password: PASSWORD,
    permissionCodes: ['attendance.read', 'attendance.edit', 'users.manage']
  });
  if (![201, 409].includes(create.status)) throw new Error('create reviewer failed ' + create.status + ': ' + create.text.slice(0, 160));
  reviewerId = one("SELECT id FROM app_users WHERE username=" + q(USER) + ";");
  legacyCookie = await login(LEGACY, '/api/auth/login', USER, PASSWORD);
  newCookie = await login(NEW_API, '/api/v1/auth/password', USER, PASSWORD);

  const results = [];
  for (const testCase of cases) {
    for (const path of ['legacy', 'new']) {
      const ids = seedFixture(testCase, reviewerId);
      const base = path === 'legacy' ? LEGACY : NEW_API;
      const cookie = path === 'legacy' ? legacyCookie : newCookie;
      const endpoint = path === 'legacy' ? '/api/admin/requests/' + ids.request + '/review' : '/api/v1/supervisor/requests/' + ids.request + '/review';
      const response = await request(base, cookie, 'POST', endpoint, { approve: testCase.approve, note: 'Q1 automated test' });
      const state = readState(testCase, ids);
      const errors = [];
      if (response.status !== testCase.expectedHttp) errors.push('http=' + response.status + ' expected=' + testCase.expectedHttp);
      errors.push(...checkCase(testCase, state));
      results.push({ path, name: testCase.name, ok: errors.length === 0, errors, http: response.status, state });
    }
  }
  const failures = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ expectedTests: EXPECTED_TESTS, executed: results.length, passed: results.length - failures.length, failed: failures.length, failures, results }, null, 2));
  if (results.length !== EXPECTED_TESTS) { console.error('Q1_FAIL executed ' + results.length + ' expected ' + EXPECTED_TESTS); process.exit(3); }
  if (failures.length > 0) process.exit(1);
  console.log('Q1_PASS ' + results.length + '/' + EXPECTED_TESTS);
} catch (error) {
  console.error('Q1_FATAL ' + String(error && error.stack || error));
  process.exit(4);
}