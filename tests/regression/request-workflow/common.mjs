import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CONN = process.env.DAR_TEST_DATABASE || '';
const OLD = process.env.Q6_LEGACY_URL || '';
const NEW = process.env.Q6_NEW_URL || '';
const SETUP = process.env.Q6_SETUP_TOKEN || '';
const PASS = process.env.Q6_PASSWORD || 'Q6-StrongPass!';
let ADMIN = '', TA = '', CIRCLE = '', SLOT = '';

function pgEnv() {
  const e = { ...process.env };
  for (const p of CONN.split(';')) {
    const i = p.indexOf('='); if (i < 0) continue;
    const k = p.slice(0, i).trim().toLowerCase(), v = p.slice(i + 1).trim();
    if (k === 'host') e.PGHOST = v; if (k === 'port') e.PGPORT = v;
    if (k === 'database') e.PGDATABASE = v; if (k === 'username') e.PGUSER = v; if (k === 'password') e.PGPASSWORD = v;
  }
  return e;
}
const PGE = pgEnv();
function psql(sql) {
  const r = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: PGE, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('psql: ' + (r.stderr || '').trim());
  return (r.stdout || '').trim();
}
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const one = sql => psql(sql);

async function login(base, path, user) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: PASS }) });
  if (!r.ok) throw new Error('login ' + user + ' ' + r.status);
  const c = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  return c.filter(Boolean).map(x => x.split(';')[0]).join('; ');
}
async function req(base, cookie, method, path, body) {
  const r = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, text: await r.text() };
}
async function createUser(adminCookie, username, perms) {
  const r = await req(OLD, adminCookie, 'POST', '/api/admin/users', { username, displayName: username, password: PASS, permissionCodes: perms });
  if (![201, 409].includes(r.status)) throw new Error('createUser ' + username + ' ' + r.status + ' ' + r.text.slice(0, 160));
  return one("SELECT id FROM app_users WHERE username=" + q(username) + ';');
}

export async function setup() {
  if (!CONN || !OLD || !NEW || !SETUP) throw new Error('Q6 env missing');
  if (/database\s*=\s*dareltahfeez/i.test(CONN)) throw new Error('production database rejected');
  for (const raw of [OLD, NEW]) { const h = new URL(raw).hostname.toLowerCase(); if (!['127.0.0.1', 'localhost'].includes(h)) throw new Error('non-loopback URL rejected'); }
  const setup = await fetch(OLD + '/api/setup/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Setup-Token': SETUP }, body: JSON.stringify({ username: 'q6_admin', displayName: 'Q6 Admin', password: PASS }) });
  if (![200, 409].includes(setup.status)) throw new Error('setup ' + setup.status);
  const admin = await login(OLD, '/api/auth/login', 'q6_admin');
  ADMIN = one("SELECT id FROM app_users WHERE username='q6_admin';");
  const perms = ['attendance.edit', 'users.manage', 'attendance.read', 'supervisor.portal', 'supervisor.attendance.requests', 'finance.read'];
  await createUser(admin, 'q6_reviewer', perms);
  const revOld = await login(OLD, '/api/auth/login', 'q6_reviewer');
  const revNew = await login(NEW, '/api/v1/auth/password', 'q6_reviewer');
  const teacherUser = await createUser(admin, 'q6_teacher', ['teacher.portal', 'teacher.requests']);
  TA = randomUUID(); CIRCLE = randomUUID(); SLOT = randomUUID();
  one("INSERT INTO teachers(id,teacher_code,full_name,status,hourly_rate) VALUES (" + q(TA) + ",'Q6-T','Q6 Teacher','active',60);");
  one("INSERT INTO circles(id,circle_code,name,teacher_id,monthly_fee,is_active,starts_on) VALUES (" + q(CIRCLE) + ",'Q6-C','Q6 Circle'," + q(TA) + ",0,TRUE,DATE '2026-01-01');");
  one("INSERT INTO circle_schedule_slots(id,circle_id,day_of_week,starts_at,duration_minutes,is_active) VALUES (" + q(SLOT) + "," + q(CIRCLE) + ",1,'10:00',60,TRUE);");
  one("UPDATE app_users SET teacher_id=" + q(TA) + " WHERE id=" + q(teacherUser) + ";");
  const teacher = await login(NEW, '/api/v1/auth/password', 'q6_teacher');
  return { admin, revOld, revNew, teacher, adminId: ADMIN, teacherId: TA, circleId: CIRCLE, slotId: SLOT };
}

export function insertRequest(type, date, attendanceId, payload, status = 'pending') {
  const id = randomUUID();
  const att = attendanceId ? q(attendanceId) : 'NULL';
  const pay = payload ? q(JSON.stringify(payload)) + '::jsonb' : 'NULL';
  one("INSERT INTO attendance_requests(id,request_type,teacher_id,circle_id,schedule_slot_id,attendance_id,request_date,requested_by,reason,requested_payload,status) VALUES ("
    + q(id) + "," + q(type) + "," + q(TA) + "," + q(CIRCLE) + "," + q(SLOT) + "," + att + "," + q(date) + "," + q(ADMIN) + ",'Q6 request'," + pay + "," + q(status) + ");");
  return id;
}
export function seedAttendance(date) {
  const s = randomUUID(), a = randomUUID();
  one("INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,ended_at,status,scheduled_duration_minutes,actual_duration_minutes) VALUES ("
    + q(s) + "," + q(TA) + "," + q(CIRCLE) + "," + q(SLOT) + "," + q(date) + ",now()-INTERVAL '1 hour',now(),'completed',60,60);");
  one("INSERT INTO teacher_attendance(id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount,marked_by,teacher_session_id,actual_duration_minutes,pay_basis) VALUES ("
    + q(a) + "," + q(SLOT) + "," + q(CIRCLE) + "," + q(TA) + "," + q(date) + ",'10:00',60,'present',60,60," + q(ADMIN) + "," + q(s) + ",60,'manual');");
  return a;
}
export function snapshot(requestId) {
  return one("SELECT jsonb_build_object('request',(SELECT to_jsonb(r) FROM attendance_requests r WHERE id=" + q(requestId)
    + "),'attendance',(SELECT to_jsonb(a) FROM teacher_attendance a WHERE schedule_slot_id=" + q(SLOT)
    + " AND session_date=(SELECT request_date FROM attendance_requests WHERE id=" + q(requestId)
    + ")),'session',(SELECT to_jsonb(s) FROM teacher_sessions s WHERE schedule_slot_id=" + q(SLOT)
    + " AND session_date=(SELECT request_date FROM attendance_requests WHERE id=" + q(requestId) + ")))::text;");
}
export function normalize(value) {
  try {
    const x = JSON.parse(value);
    delete x.request?.reviewed_at; delete x.request?.updated_at;
    delete x.attendance?.marked_at; delete x.attendance?.updated_at;
    delete x.session?.updated_at; delete x.session?.started_at; delete x.session?.created_at;
    if (x.request) { x.request.requested_payload = x.request.requested_payload ?? null; }
    return x;
  } catch { return value; }
}
export async function review(base, cookie, id, approve = true, note = 'ok') {
  const r = await req(base, cookie, 'POST', (base === OLD ? '/api/admin/requests/' : '/api/v1/supervisor/requests/') + id + '/review', { approve, note });
  return { status: r.status, body: r.text.slice(0, 240), db: normalize(snapshot(id)) };
}
export async function adminAction(base, cookie, method, id, action, body) {
  const suffix = action ? '/' + action : '';
  const r = await req(base, cookie, method, '/api/admin/requests/' + id + suffix, body);
  return { status: r.status, body: r.text.slice(0, 240) };
}
export { OLD, NEW, req, one, q };
export function sql() { return { q, one, ADMIN, TA, CIRCLE, SLOT }; }
