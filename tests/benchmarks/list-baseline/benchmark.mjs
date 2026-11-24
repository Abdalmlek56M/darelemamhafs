#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const CONN = process.env.DAR_TEST_DATABASE || '';
const LEGACY = process.env.S1_LEGACY_URL || '';
const NEW_API = process.env.S1_NEW_URL || '';
const SETUP_TOKEN = process.env.S1_SETUP_TOKEN || '';
const PASSWORD = process.env.S1_PASSWORD || 'S1-BenchPass!';
const LABEL = process.env.S1_LABEL || 'unknown';
const ITERATIONS = Number(process.env.S1_ITERATIONS || 3);
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];

function fail(message) { console.error('S1A_FAIL refusing/failed: ' + message); process.exit(2); }
function isLoopback(host) { return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'; }
function guard() {
  if (!CONN || !LEGACY || !NEW_API || !SETUP_TOKEN) fail('missing DAR_TEST_DATABASE/S1_LEGACY_URL/S1_NEW_URL/S1_SETUP_TOKEN');
  if (/database\s*=\s*dareltahfeez\b/i.test(CONN)) fail('production database name');
  for (const raw of [LEGACY, NEW_API]) {
    let url;
    try { url = new URL(raw); } catch { fail('invalid URL'); }
    if (PROD_HOSTS.includes(url.hostname.toLowerCase()) || !isLoopback(url.hostname.toLowerCase())) fail('non-test URL ' + url.hostname);
  }
}
guard();

async function login(base, path, username, password) {
  const response = await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const text = await response.text();
  if (!response.ok) throw new Error('login ' + username + ' ' + response.status + ': ' + text.slice(0, 160));
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  return cookies.filter(Boolean).map((v) => v.split(';')[0]).join('; ');
}

async function call(base, cookie, path) {
  const started = performance.now();
  let response;
  try {
    response = await fetch(base + path, { headers: { cookie }, signal: AbortSignal.timeout(180000) });
  } catch (error) {
    return { path, status: 0, durationMs: performance.now() - started, bytes: 0, error: String(error && error.message || error) };
  }
  const text = await response.text();
  return { path, status: response.status, durationMs: performance.now() - started, bytes: Buffer.byteLength(text, 'utf8') };
}

const endpoints = [
  { name: 'legacy_students', base: LEGACY, path: '/api/students', auth: 'legacy' },
  { name: 'legacy_teachers', base: LEGACY, path: '/api/teachers', auth: 'legacy' },
  { name: 'legacy_circles', base: LEGACY, path: '/api/circles', auth: 'legacy' },
  { name: 'legacy_schedule_slots', base: LEGACY, path: '/api/schedule-slots', auth: 'legacy' },
  { name: 'legacy_teacher_attendance', base: LEGACY, path: '/api/teacher-attendance?month=2026-11', auth: 'legacy' },
  { name: 'legacy_student_attendance', base: LEGACY, path: '/api/student-attendance?month=2026-11', auth: 'legacy' },
  { name: 'legacy_attendance_summary', base: LEGACY, path: '/api/student-attendance/session-summary?month=2026-11', auth: 'legacy' },
  { name: 'legacy_ads', base: LEGACY, path: '/api/advertising-expenses?month=2026-11', auth: 'legacy' },
  { name: 'legacy_operating', base: LEGACY, path: '/api/operating-expenses?month=2026-11', auth: 'legacy' },
  { name: 'legacy_collections', base: LEGACY, path: '/api/collections?month=2026-11', auth: 'legacy' },
  { name: 'legacy_reports', base: LEGACY, path: '/api/collection-reports?month=2026-11', auth: 'legacy' },
  { name: 'legacy_finance_options', base: LEGACY, path: '/api/finance-entry-options?month=2026-11', auth: 'legacy' },
  { name: 'legacy_admin_users', base: LEGACY, path: '/api/admin/users', auth: 'legacy' },
  { name: 'legacy_requests', base: LEGACY, path: '/api/admin/requests?status=pending', auth: 'legacy' },
  { name: 'legacy_audit', base: LEGACY, path: '/api/admin/audit-log?limit=10000&month=2026-11', auth: 'legacy' },
  { name: 'legacy_notifications', base: LEGACY, path: '/api/admin/notifications', auth: 'legacy' },
  { name: 'legacy_teacher_notes', base: LEGACY, path: '/api/admin/teacher-notes', auth: 'legacy' },
  { name: 'new_supervisor_students', base: NEW_API, path: '/api/v1/supervisor/students', auth: 'new' },
  { name: 'new_supervisor_teachers', base: NEW_API, path: '/api/v1/supervisor/teachers', auth: 'new' },
  { name: 'new_supervisor_circles', base: NEW_API, path: '/api/v1/supervisor/circles', auth: 'new' },
  { name: 'new_supervisor_requests', base: NEW_API, path: '/api/v1/supervisor/requests?status=pending', auth: 'new' },
  { name: 'new_supervisor_unpaid', base: NEW_API, path: '/api/v1/supervisor/unpaid?month=2026-11', auth: 'new' },
  { name: 'new_supervisor_absences', base: NEW_API, path: '/api/v1/supervisor/absences?date=2026-11-16', auth: 'new' },
  { name: 'new_supervisor_attendance_teachers', base: NEW_API, path: '/api/v1/supervisor/attendance/teachers?date=2026-11-16', auth: 'new' },
  { name: 'new_supervisor_attendance_students', base: NEW_API, path: '/api/v1/supervisor/attendance/students?date=2026-11-16', auth: 'new' },
  { name: 'new_notifications', base: NEW_API, path: '/api/v1/notifications?status=open', auth: 'new' }
];

const started = performance.now();
const setup = await fetch(LEGACY + '/api/setup/admin', {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-Setup-Token': SETUP_TOKEN },
  body: JSON.stringify({ username: 'bench_admin', displayName: 'Synthetic Bench Admin', password: PASSWORD })
});
const setupText = await setup.text();
if (![200, 409].includes(setup.status)) throw new Error('setup failed ' + setup.status + ': ' + setupText.slice(0, 160));
const adminCookie = await login(LEGACY, '/api/auth/login', 'bench_admin', PASSWORD);
const userResponse = await fetch(LEGACY + '/api/admin/users', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
  body: JSON.stringify({
    username: 'bench_reviewer', displayName: 'Synthetic Bench Reviewer', password: PASSWORD,
    permissionCodes: ['dashboard.read','students.read','teachers.read','circles.read','schedule.read','attendance.read','attendance.edit','finance.read','finance.create','audit.read','users.manage','supervisor.portal','supervisor.live','supervisor.unpaid','supervisor.students.read','supervisor.teachers.read','supervisor.circles.read','supervisor.absences','supervisor.attendance.requests']
  })
});
if (![201, 409].includes(userResponse.status)) throw new Error('reviewer create failed ' + userResponse.status + ': ' + (await userResponse.text()).slice(0, 160));
const legacyCookie = await login(LEGACY, '/api/auth/login', 'bench_reviewer', PASSWORD);
const newCookie = await login(NEW_API, '/api/v1/auth/password', 'bench_reviewer', PASSWORD);

const results = [];
for (const endpoint of endpoints) {
  const cookie = endpoint.auth === 'legacy' ? legacyCookie : newCookie;
  await call(endpoint.base, cookie, endpoint.path); // warmup
  const runs = [];
  for (let i = 0; i < ITERATIONS; i++) runs.push(await call(endpoint.base, cookie, endpoint.path));
  const ok = runs.filter((r) => r.status === 200);
  const times = runs.map((r) => r.durationMs).sort((a, b) => a - b);
  const bytes = runs.length ? Math.round(runs.reduce((sum, r) => sum + r.bytes, 0) / runs.length) : 0;
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;
  results.push({ name: endpoint.name, path: endpoint.path, statuses: runs.map((r) => r.status), ok: ok.length, medianMs: Math.round(median), maxMs: Math.round(times[times.length - 1] || 0), bytes });
}

const slowest = [...results].sort((a, b) => b.medianMs - a.medianMs).slice(0, 10);
console.log(JSON.stringify({ label: LABEL, iterations: ITERATIONS, durationMs: Math.round(performance.now() - started), results, slowest }, null, 2));
console.log('S1A_RESULT label=' + LABEL + ' endpoints=' + results.length);