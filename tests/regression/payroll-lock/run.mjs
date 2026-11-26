#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CONN = process.env.DAR_TEST_DATABASE || '';
const LEGACY = process.env.Q2_LEGACY_URL || '';
const NEW_API = process.env.Q2_NEW_URL || '';
const SETUP_TOKEN = process.env.Q2_SETUP_TOKEN || '';
const PASSWORD = process.env.Q2_PASSWORD || 'Q2-StrongPass!';
const REVIEWER = 'q2_reviewer';
const NOFIN = 'q2_nofin';
const ADMIN = 'q2_admin';
const EXPECTED_TESTS = 22;

if (!CONN || !LEGACY || !NEW_API || !SETUP_TOKEN) {
  console.error('Q2_FAIL missing DAR_TEST_DATABASE/Q2_LEGACY_URL/Q2_NEW_URL/Q2_SETUP_TOKEN');
  process.exit(2);
}

const PROD_DB = process.env.DAR_FORBIDDEN_DB || '';
const PROD_HOSTS = (process.env.DAR_FORBIDDEN_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}
function refuse(message, prefix) {
  console.error(prefix + ' refusing production/live target: ' + message);
  process.exit(2);
}
function guardTargets(db, urls, prefix) {
  if (db && new RegExp('database\\s*=\\s*' + (process.env.DAR_FORBIDDEN_DB || '__forbidden_db__') + '\\b', 'i').test(db)) refuse('production database name', prefix);
  const dbHost = /host\s*=\s*([^;]+)/i.exec(db || '');
  if (dbHost && PROD_HOSTS.includes(dbHost[1].trim().toLowerCase())) refuse('production database host', prefix);
  for (const raw of urls) {
    let url;
    try { url = new URL(raw); } catch { refuse('invalid URL', prefix); }
    const host = url.hostname.toLowerCase();
    if (PROD_HOSTS.includes(host)) refuse('production hostname ' + host, prefix);
    if (!isLoopbackHost(host)) refuse('non-loopback test URL ' + host, prefix);
  }
}
guardTargets(CONN, [LEGACY, NEW_API], 'Q2_FAIL');

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
  const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', text], { env: PGENV, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('psql failed: ' + (result.stderr || '').trim());
  return (result.stdout || '').trim();
}
function q(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
function one(statement) { return psql(statement); }
function sql(statement) { psql(statement); }

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
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json };
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function assertEq(actual, expected, message) { if (actual !== expected) throw new Error(message + ': got ' + actual + ' expected ' + expected); }

function seedAttendance(date, rate, initialDuration, initialStatus) {
  const id = { teacher: randomUUID(), circle: randomUUID(), slot: randomUUID(), session: randomUUID(), attendance: randomUUID() };
  const tag = id.teacher.slice(0, 8);
  const status = initialStatus || 'present';
  const duration = initialDuration || 60;
  const initialPay = status === 'present' ? Number(rate) * duration / 60 : 0;
  sql('BEGIN;' +
    "INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate) VALUES (" + q(id.teacher) + ',' + q('Q2-T-' + tag) + ",'Q2 Test Teacher','active'," + Number(rate) + ');' +
    "INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on) VALUES (" + q(id.circle) + ',' + q('Q2-C-' + tag) + ",'Q2 Test Circle'," + q(id.teacher) + ",0,TRUE,DATE '2026-01-01');" +
    "INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes, is_active) VALUES (" + q(id.slot) + ',' + q(id.circle) + ",1,'10:00',60,TRUE);" +
    "INSERT INTO teacher_sessions(id, teacher_id, circle_id, schedule_slot_id, session_date, started_at, ended_at, status, scheduled_duration_minutes, actual_duration_minutes, payable_duration_minutes, pay_basis) VALUES (" + q(id.session) + ',' + q(id.teacher) + ',' + q(id.circle) + ',' + q(id.slot) + ',' + q(date) + ",now() - INTERVAL '10 minutes',now() + INTERVAL '60 minutes','completed',60," + duration + ',' + duration + ",'actual');" +
    "INSERT INTO teacher_attendance(id, schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start, duration_minutes, status, hourly_rate_snapshot, payable_amount, marked_by, teacher_session_id, actual_duration_minutes, pay_basis) VALUES (" + q(id.attendance) + ',' + q(id.slot) + ',' + q(id.circle) + ',' + q(id.teacher) + ',' + q(date) + ",'10:00'," + duration + ',' + q(status) + ',' + Number(rate) + ',' + initialPay.toFixed(2) + ',' + q(reviewerId) + ',' + q(id.session) + ',' + duration + ",'actual');" +
    'COMMIT;');
  return id;
}
function readAttendance(attendanceId) {
  const raw = one("SELECT json_build_object('durationMinutes',duration_minutes,'payableAmount',payable_amount,'status',status)::text FROM teacher_attendance WHERE id=" + q(attendanceId) + ';');
  return JSON.parse(raw || '{}');
}
function auditCount(action, entityId) {
  return Number(one("SELECT count(*) FROM audit_log WHERE action_code=" + q(action) + " AND entity_id=" + q(entityId) + ';'));
}
function lockState(month) {
  const raw = one("SELECT json_build_object('isLocked',is_locked,'note',note,'unlockedAt',unlocked_at,'unlockNote',unlock_note)::text FROM payroll_locks WHERE billing_month=" + q(month + '-01') + ';');
  return raw ? JSON.parse(raw) : { isLocked: false };
}

let reviewerId = '';
let fullLegacyCookie = '';
let fullNewCookie = '';
let nofinNewCookie = '';
const results = [];
async function testCase(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: String(error && error.message || error) }); }
}

try {
  const setupResponse = await fetch(LEGACY + '/api/setup/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Setup-Token': SETUP_TOKEN },
    body: JSON.stringify({ username: ADMIN, displayName: 'Q2 Setup Admin', password: PASSWORD })
  });
  const setupText = await setupResponse.text();
  assert([200, 409].includes(setupResponse.status), 'setup failed ' + setupResponse.status + ': ' + setupText.slice(0, 120));
  const adminCookie = await login(LEGACY, '/api/auth/login', ADMIN, PASSWORD);
  async function createUser(username, displayName, permissionCodes) {
    const response = await request(LEGACY, adminCookie, 'POST', '/api/admin/users', { username, displayName, password: PASSWORD, permissionCodes });
    assert([201, 409].includes(response.status), 'create user ' + username + ' failed ' + response.status + ': ' + response.text.slice(0, 120));
    return one('SELECT id FROM app_users WHERE username=' + q(username) + ';');
  }
  reviewerId = await createUser(REVIEWER, 'Q2 Reviewer', ['attendance.read', 'attendance.edit', 'finance.read', 'finance.edit', 'users.manage']);
  await createUser(NOFIN, 'Q2 No Finance', ['attendance.read', 'attendance.edit', 'finance.edit', 'users.manage']);
  fullLegacyCookie = await login(LEGACY, '/api/auth/login', REVIEWER, PASSWORD);
  fullNewCookie = await login(NEW_API, '/api/v1/auth/password', REVIEWER, PASSWORD);
  nofinNewCookie = await login(NEW_API, '/api/v1/auth/password', NOFIN, PASSWORD);

  const legacyDuration = (attendanceId, minutes) => request(LEGACY, fullLegacyCookie, 'PUT', '/api/teacher-attendance/' + attendanceId + '/duration', { durationMinutes: minutes });
  const newAdjust = (cookie, attendanceId, minutes, amount) => request(NEW_API, cookie, 'POST', '/api/v1/supervisor/attendance/' + attendanceId + '/adjust', { payableDurationMinutes: minutes, payableAmount: amount === undefined ? null : amount, note: 'Q2 automated adjustment' });
  const lock = (month, note) => request(LEGACY, fullLegacyCookie, 'POST', '/api/admin/payroll/lock', { month, note });
  const unlock = (month, note) => request(LEGACY, fullLegacyCookie, 'POST', '/api/admin/payroll/unlock', { month, note });

  async function lockMonth(month, note) { const response = await lock(month, note || 'Q2 lock'); assertEq(response.status, 200, 'lock ' + month); }

  await testCase('legacy_salary_60', async () => {
    const f = seedAttendance('2026-12-01', 60, 60, 'present');
    const response = await legacyDuration(f.attendance, 60);
    assertEq(response.status, 200, 'duration 60');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 60, 'pay 60');
  });
  await testCase('legacy_salary_45', async () => {
    const f = seedAttendance('2026-12-02', 60, 60, 'present');
    const response = await legacyDuration(f.attendance, 45);
    assertEq(response.status, 200, 'duration 45');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 45, 'pay 45');
  });
  await testCase('legacy_rounding_away_from_zero', async () => {
    const f = seedAttendance('2026-12-03', 50.25, 60, 'present');
    const response = await legacyDuration(f.attendance, 37);
    assertEq(response.status, 200, 'duration 37');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 30.99, 'rounded pay');
  });
  await testCase('legacy_invalid_14_minutes', async () => {
    const f = seedAttendance('2026-12-04', 60, 60, 'present');
    const response = await legacyDuration(f.attendance, 14);
    assertEq(response.status, 400, 'duration 14');
    assertEq(Number(readAttendance(f.attendance).durationMinutes), 60, 'duration unchanged');
  });
  await testCase('legacy_invalid_361_minutes', async () => {
    const f = seedAttendance('2026-12-05', 60, 60, 'present');
    const response = await legacyDuration(f.attendance, 361);
    assertEq(response.status, 400, 'duration 361');
  });
  await testCase('legacy_lock_flow_and_post_lock_edit', async () => {
    const month = '2026-09';
    const f = seedAttendance('2026-09-05', 60, 60, 'present');
    assertEq(lockState(month).isLocked, false, 'initial unlocked');
    await lockMonth(month, 'Q2 lock flow');
    assertEq(lockState(month).isLocked, true, 'locked');
    const blocked = await legacyDuration(f.attendance, 30);
    assertEq(blocked.status, 409, 'post-lock edit blocked');
    assertEq(Number(readAttendance(f.attendance).durationMinutes), 60, 'duration remains 60 while locked');
    const unlocked = await unlock(month, 'Q2 unlock flow');
    assertEq(unlocked.status, 200, 'unlock');
    assertEq(lockState(month).isLocked, false, 'unlocked');
    const applied = await legacyDuration(f.attendance, 30);
    assertEq(applied.status, 200, 'edit after unlock');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 30, 'pay after unlock');
    const secondUnlock = await unlock(month, 'Q2 unlock again');
    assertEq(secondUnlock.status, 200, 'unlock existing row remains idempotent');
    assertEq(lockState(month).isLocked, false, 'still unlocked');
    const missingLock = await unlock('2026-04', 'Q2 unlock missing row');
    assertEq(missingLock.status, 404, 'unlock without any lock row');
  });
  await testCase('legacy_lock_requires_note', async () => {
    const response = await lock('2026-11', '');
    assertEq(response.status, 400, 'lock without note');
    assertEq(lockState('2026-11').isLocked, false, 'not locked without note');
  });
  await testCase('legacy_unlock_requires_note', async () => {
    const realMonth = '2026-08';
    await lockMonth(realMonth, 'Q2 note setup');
    const response = await unlock(realMonth, '');
    assertEq(response.status, 400, 'unlock without note');
    assertEq(lockState(realMonth).isLocked, true, 'still locked');
    await unlock(realMonth, 'Q2 cleanup unlock');
  });
  await testCase('legacy_audit_duration_update', async () => {
    const f = seedAttendance('2026-12-06', 60, 60, 'present');
    const response = await legacyDuration(f.attendance, 30);
    assertEq(response.status, 200, 'duration update');
    assertEq(auditCount('attendance.duration.update', f.attendance), 1, 'audit count');
    const detailsOk = one("SELECT ((details->>'durationMinutes')='30' AND (details->>'payableAmount')::numeric=30)::text FROM audit_log WHERE action_code='attendance.duration.update' AND entity_id=" + q(f.attendance) + ';');
    assertEq(detailsOk, 'true', 'audit details duration/pay');
  });
  await testCase('legacy_audit_lock_and_unlock', async () => {
    const month = '2026-07';
    await lockMonth(month, 'Q2 audit lock');
    await unlock(month, 'Q2 audit unlock');
    assertEq(Number(one("SELECT count(*) FROM audit_log WHERE action_code='payroll.lock' AND details->>'note'='Q2 audit lock';")), 1, 'lock audit');
    assertEq(Number(one("SELECT count(*) FROM audit_log WHERE action_code='payroll.unlock' AND details->>'note'='Q2 audit unlock';")), 1, 'unlock audit');
  });
  await testCase('legacy_concurrent_duration_adjust', async () => {
    const f = seedAttendance('2026-12-07', 60, 60, 'present');
    const responses = await Promise.all([legacyDuration(f.attendance, 30), legacyDuration(f.attendance, 45)]);
    assert(responses.every((r) => r.status !== 500), 'no server error');
    const successes = responses.filter((r) => r.status === 200).length;
    assert(successes >= 1, 'at least one concurrent edit succeeded');
    const final = Number(readAttendance(f.attendance).durationMinutes);
    assert([30, 45].includes(final), 'final duration one of concurrent values: ' + final);
    assertEq(auditCount('attendance.duration.update', f.attendance), successes, 'audit count equals successes');
  });

  await testCase('new_salary_60', async () => {
    const f = seedAttendance('2026-12-08', 60, 60, 'present');
    const response = await newAdjust(fullNewCookie, f.attendance, 60);
    assertEq(response.status, 200, 'adjust 60');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 60, 'pay 60');
  });
  await testCase('new_salary_45', async () => {
    const f = seedAttendance('2026-12-09', 60, 60, 'present');
    const response = await newAdjust(fullNewCookie, f.attendance, 45);
    assertEq(response.status, 200, 'adjust 45');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 45, 'pay 45');
  });
  await testCase('new_rounding_away_from_zero', async () => {
    const f = seedAttendance('2026-12-10', 50.25, 60, 'present');
    const response = await newAdjust(fullNewCookie, f.attendance, 37);
    assertEq(response.status, 200, 'adjust 37');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 30.99, 'rounded pay');
  });
  await testCase('new_invalid_0_minutes', async () => {
    const f = seedAttendance('2026-12-11', 60, 60, 'present');
    const response = await newAdjust(fullNewCookie, f.attendance, 0);
    assertEq(response.status, 400, 'adjust 0');
  });
  await testCase('new_invalid_361_minutes', async () => {
    const f = seedAttendance('2026-12-12', 60, 60, 'present');
    const response = await newAdjust(fullNewCookie, f.attendance, 361);
    assertEq(response.status, 400, 'adjust 361');
  });
  await testCase('new_manual_amount_with_finance', async () => {
    const f = seedAttendance('2026-12-13', 60, 60, 'present');
    const response = await newAdjust(fullNewCookie, f.attendance, 60, 123.45);
    assertEq(response.status, 200, 'manual amount');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 123.45, 'manual stored');
  });
  await testCase('new_manual_amount_without_finance', async () => {
    const f = seedAttendance('2026-12-14', 60, 60, 'present');
    const response = await newAdjust(nofinNewCookie, f.attendance, 60, 123.45);
    assertEq(response.status, 403, 'manual amount forbidden');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 60, 'pay unchanged');
  });
  await testCase('new_locked_adjust_blocked', async () => {
    const month = '2026-06';
    await lockMonth(month, 'Q2 new lock');
    const f = seedAttendance('2026-06-05', 60, 60, 'present');
    const response = await newAdjust(fullNewCookie, f.attendance, 30);
    assertEq(response.status, 409, 'adjust locked');
    assertEq(Number(readAttendance(f.attendance).durationMinutes), 60, 'duration unchanged');
    await unlock(month, 'Q2 new unlock cleanup');
  });
  await testCase('new_unlocked_adjust_applies', async () => {
    const month = '2026-05';
    await lockMonth(month, 'Q2 temporary lock');
    await unlock(month, 'Q2 unlock before adjust');
    const f = seedAttendance('2026-05-05', 60, 60, 'present');
    const response = await newAdjust(fullNewCookie, f.attendance, 30);
    assertEq(response.status, 200, 'adjust unlocked');
    assertEq(Number(readAttendance(f.attendance).payableAmount), 30, 'pay after unlock');
  });
  await testCase('new_audit_adjust', async () => {
    const f = seedAttendance('2026-12-15', 60, 60, 'present');
    const response = await newAdjust(fullNewCookie, f.attendance, 30);
    assertEq(response.status, 200, 'adjust for audit');
    assertEq(auditCount('supervisor.attendance.adjust', f.attendance), 1, 'adjust audit count');
    const details = one("SELECT details::text FROM audit_log WHERE action_code='supervisor.attendance.adjust' AND entity_id=" + q(f.attendance) + ';');
    assert(details.includes('30') && details.includes('60'), 'audit before/after details');
  });
  await testCase('new_concurrent_adjust', async () => {
    const f = seedAttendance('2026-12-16', 60, 60, 'present');
    const responses = await Promise.all([newAdjust(fullNewCookie, f.attendance, 30), newAdjust(fullNewCookie, f.attendance, 45)]);
    assert(responses.every((r) => r.status !== 500), 'no server error');
    const successes = responses.filter((r) => r.status === 200).length;
    assert(successes >= 1, 'at least one concurrent adjust succeeded');
    const final = Number(readAttendance(f.attendance).durationMinutes);
    assert([30, 45].includes(final), 'final duration one of concurrent values: ' + final);
    assertEq(auditCount('supervisor.attendance.adjust', f.attendance), successes, 'audit count equals successes');
  });

  const failures = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ expectedTests: EXPECTED_TESTS, executed: results.length, passed: results.length - failures.length, failed: failures.length, failures, results }, null, 2));
  if (results.length !== EXPECTED_TESTS) { console.error('Q2_FAIL executed ' + results.length + ' expected ' + EXPECTED_TESTS); process.exit(3); }
  if (failures.length > 0) process.exit(1);
  console.log('Q2_PASS ' + results.length + '/' + EXPECTED_TESTS);
} catch (error) {
  console.error('Q2_FATAL ' + String(error && error.stack || error));
  process.exit(4);
}