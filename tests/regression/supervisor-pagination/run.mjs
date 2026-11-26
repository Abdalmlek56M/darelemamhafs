import { strict as assert } from 'node:assert';
import { setup, one, q } from '../request-workflow/common.mjs';

const c = await setup();
const NEW = process.env.Q6_NEW_URL;
const login = await fetch(NEW + '/api/v1/auth/password', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'q6_admin', password: process.env.Q6_PASSWORD })
});
assert.equal(login.status, 200, 'admin login');
const cookie = login.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
const date = '2026-11-30';
one("INSERT INTO students(id,student_code,full_name,status,joined_on) SELECT gen_random_uuid(),'PAG-'||g,'Pagination Student '||g,'active',DATE '2026-01-01' FROM generate_series(1,120) g;");
one("INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status) SELECT gen_random_uuid(),s.id," + q(c.circleId) + ",DATE '2026-01-01',0,'active' FROM students s WHERE s.student_code LIKE 'PAG-%';");
one("INSERT INTO student_attendance(id,enrollment_id,schedule_slot_id,session_date,status,marked_by) SELECT gen_random_uuid(),ce.id," + q(c.slotId) + "," + q(date) + ",'absent'," + q(c.adminId) + " FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id WHERE s.student_code LIKE 'PAG-%';");
one("INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due) SELECT gen_random_uuid(),ce.id,date_trunc('month',current_date)::date,10 FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id WHERE s.student_code LIKE 'PAG-%';");
one("INSERT INTO students(id,student_code,full_name,status,joined_on) SELECT gen_random_uuid(),'PAGX-'||g,'Extra Student '||g,'active',DATE '2026-01-01' FROM generate_series(121,501) g;");
one("INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status) SELECT gen_random_uuid(),s.id," + q(c.circleId) + ",DATE '2026-01-01',0,'active' FROM students s WHERE s.student_code LIKE 'PAGX-%';");

async function get(path, page, size) {
  let url = NEW + path;
  const params = [];
  if (page != null) params.push('page=' + page);
  if (size != null) params.push('pageSize=' + size);
  if (params.length) url += (url.includes('?') ? '&' : '?') + params.join('&');
  const r = await fetch(url, { headers: { cookie } });
  return { status: r.status, headers: r.headers, body: await r.json() };
}
function header(h, name) { return h.get(name); }
const suites = [
  ['students', '/api/v1/supervisor/students', 'students', 501],
  ['circles', '/api/v1/supervisor/circles', 'circles', 1],
  ['teachers', '/api/v1/supervisor/teachers', 'teachers', 1],
  ['absences', '/api/v1/supervisor/absences?date=' + date, 'absences', 120],
  ['attendance-teachers', '/api/v1/supervisor/attendance/teachers?date=' + date, 'sessions', 1],
  ['attendance-students', '/api/v1/supervisor/attendance/students?date=' + date, 'attendance', 120],
  ['unpaid', '/api/v1/supervisor/unpaid', 'unpaid', 120]
];
for (const [name, path, key, total] of suites) {
  const plain = await get(path);
  assert.equal(plain.status, 200, name + ' no-page status');
  assert.ok(Array.isArray(plain.body[key]), name + ' old shape array');
  assert.equal(header(plain.headers, 'X-Total-Count'), String(total), name + ' total');
  assert.equal(header(plain.headers, 'X-Truncated'), String(total > (name === 'students' ? 500 : name === 'unpaid' ? 300 : name === 'attendance-students' ? 1000 : 500)), name + ' truncated');
  assert.equal(header(plain.headers, 'X-Page-Size'), '25', name + ' default size header');
  const paged = await get(path, 1, 10);
  assert.equal(paged.status, 200, name + ' paged status');
  assert.equal(paged.body[key].length, Math.min(total, 10), name + ' page length');
  assert.equal(header(paged.headers, 'X-Page'), '1');
  assert.equal(header(paged.headers, 'X-Page-Size'), '10');
  assert.equal(header(paged.headers, 'X-Total-Count'), String(total));
  assert.equal(header(paged.headers, 'X-Truncated'), String(10 < total), name + ' paged truncated');
  const huge = await get(path, 999, 25);
  assert.equal(huge.status, 200, name + ' huge status');
  assert.equal(huge.body[key].length, 0, name + ' huge empty');
  assert.equal(header(huge.headers, 'X-Total-Count'), String(total), name + ' huge total');
  assert.equal(header(huge.headers, 'X-Truncated'), 'false', name + ' huge truncated');
  const capped = await get(path, 1, 1000);
  assert.equal(capped.status, 200, name + ' cap status');
  assert.equal(capped.body[key].length, Math.min(total, 100), name + ' cap length');
  assert.equal(header(capped.headers, 'X-Page-Size'), '100', name + ' cap header');
  assert.equal(header(capped.headers, 'X-Truncated'), String(100 < total), name + ' capped truncated');
}

const LEGACY = process.env.Q6_LEGACY_URL;
async function legacyStudents(page, size) {
  let url = LEGACY + '/api/students';
  const params = [];
  if (page != null) params.push('page=' + page);
  if (size != null) params.push('pageSize=' + size);
  if (params.length) url += '?' + params.join('&');
  const r = await fetch(url, { headers: { cookie: c.admin } });
  return { status: r.status, headers: r.headers, body: await r.json() };
}
const plain = await legacyStudents();
assert.equal(plain.status, 200, 'legacy students no-page status');
assert.equal(plain.body.length, 501, 'legacy students old shape length');
assert.equal(header(plain.headers, 'X-Total-Count'), '501');
assert.equal(header(plain.headers, 'X-Truncated'), 'false');
const paged = await legacyStudents(1, 10);
assert.equal(paged.body.length, 10, 'legacy students page length');
assert.equal(header(paged.headers, 'X-Page'), '1');
assert.equal(header(paged.headers, 'X-Page-Size'), '10');
assert.equal(header(paged.headers, 'X-Total-Count'), '501');
assert.equal(header(paged.headers, 'X-Truncated'), 'true');
const huge = await legacyStudents(999, 25);
assert.equal(huge.body.length, 0, 'legacy students huge empty');
assert.equal(header(huge.headers, 'X-Total-Count'), '501');
assert.equal(header(huge.headers, 'X-Truncated'), 'false');
const capped = await legacyStudents(1, 1000);
assert.equal(capped.body.length, 100, 'legacy students cap length');
assert.equal(header(capped.headers, 'X-Page-Size'), '100');
assert.equal(header(capped.headers, 'X-Truncated'), 'true');


const legacyLists = [
  ['teachers', '/api/teachers', 1],
  ['circles', '/api/circles', 1],
  ['schedule-slots', '/api/schedule-slots', 1]
];
for (const [name, path, total] of legacyLists) {
  async function getLegacy(page, size) {
    let url = LEGACY + path;
    const params = [];
    if (page != null) params.push('page=' + page);
    if (size != null) params.push('pageSize=' + size);
    if (params.length) url += '?' + params.join('&');
    const r = await fetch(url, { headers: { cookie: c.admin } });
    return { status: r.status, headers: r.headers, body: await r.json() };
  }
  const plain = await getLegacy();
  assert.equal(plain.status, 200, name + ' plain');
  assert.equal(plain.body.length, total, name + ' old shape');
  assert.equal(header(plain.headers, 'X-Total-Count'), String(total));
  assert.equal(header(plain.headers, 'X-Truncated'), 'false');
  const paged = await getLegacy(1, 10);
  assert.equal(paged.body.length, total);
  assert.equal(header(paged.headers, 'X-Page'), '1');
  assert.equal(header(paged.headers, 'X-Page-Size'), '10');
  assert.equal(header(paged.headers, 'X-Truncated'), 'false');
  const huge = await getLegacy(999, 25);
  assert.equal(huge.body.length, 0);
  assert.equal(header(huge.headers, 'X-Total-Count'), String(total));
  assert.equal(header(huge.headers, 'X-Truncated'), 'false');
  const capped = await getLegacy(1, 1000);
  assert.equal(capped.body.length, total);
  assert.equal(header(capped.headers, 'X-Page-Size'), '100');
}

console.log(JSON.stringify({ suite: 'supervisor-pagination', ok: true, cases: suites.length }));
