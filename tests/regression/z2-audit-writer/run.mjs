import { strict as assert } from 'node:assert';
import { setup, one, q, req, OLD } from '../request-workflow/common.mjs';

const c = await setup();
const PASS = process.env.Q6_PASSWORD || 'Q6-StrongPass!';

// Z2 characterization: the 29 copy-pasted `INSERT INTO audit_log(...)` sites in the legacy
// backend are folded into one AuditLogWriter helper. These expectations were recorded against
// the legacy backend *before* the refactor so the unified writer must keep writing exactly the
// same row for each representative flow: same action code, entity, actor fields, details jsonb
// payload, request path/method, before/after snapshots and can_restore flag.
//
// The generic AuditMiddleware enriches most endpoint rows *after* the HTTP response is flushed,
// so statements about that enrichment poll the row instead of reading it once (a fixed sleep
// would be flaky under load). setup(), login(), one(), q() and req() come from the shared
// request-workflow helpers so the suite runs under the existing q6 regression harness.

const lower = (value) => String(value ?? '').toLowerCase();
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function auditRowOrNull(where) {
  const text = one(`SELECT jsonb_build_object(
      'actorUserId', actor_user_id,
      'actorDisplayName', actor_display_name,
      'actionCode', action_code,
      'entityType', entity_type,
      'entityId', entity_id,
      'requestPath', request_path,
      'httpMethod', http_method,
      'canRestore', can_restore,
      'detailsKind', jsonb_typeof(details),
      'details', details,
      'beforeData', before_data,
      'afterData', after_data)::text
    FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT 1;`);
  return text ? JSON.parse(text) : null;
}

function countRows(where) {
  return Number(one(`SELECT count(*) FROM audit_log WHERE ${where};`));
}

async function waitForAuditRow(where, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = auditRowOrNull(where);
    if (row) return row;
    if (Date.now() > deadline) throw new Error('timed out waiting for audit row: ' + label);
    await sleep(100);
  }
}

const adminId = lower(c.adminId);

// 1) setup.initial_admin — the row written inside the setup transaction (AuthEndpoints.SignIn).
{
  const row = await waitForAuditRow(`action_code='setup.initial_admin'`, 'setup.initial_admin');
  assert.equal(row.actionCode, 'setup.initial_admin', 'setup audit action code');
  assert.equal(row.entityType, 'app_user', 'setup audit entity type');
  assert.equal(lower(row.entityId), adminId, 'setup audit entity id is the new admin');
  assert.equal(lower(row.actorUserId), adminId, 'setup audit actor id is the new admin');
  // Legacy behaviour: this insert listed five columns only, so actor_display_name is NULL.
  // The shared writer must not start inventing an actor name for this row.
  assert.equal(row.actorDisplayName, null, 'setup audit actor display name');
  assert.equal(row.requestPath, null, 'setup audit request path');
  assert.equal(row.httpMethod, null, 'setup audit http method');
  assert.equal(row.canRestore, false, 'setup audit can_restore');
  assert.equal(row.beforeData, null, 'setup audit before_data');
  assert.equal(row.afterData, null, 'setup audit after_data');
  assert.equal(row.detailsKind, 'object', 'setup audit details must be a jsonb object');
  assert.deepEqual(row.details, { username: 'q6_admin' }, 'setup audit details payload');
}

// 2) auth.login — the login audit row (AuthEndpoints.Helpers.TryAuditLoginAsync).
{
  const response = await fetch(OLD + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'q6_admin', password: PASS }),
  });
  assert.equal(response.status, 200, 'q6_admin login status ' + response.status);
  const row = await waitForAuditRow(
    `action_code='auth.login' AND request_path='/api/auth/login' AND details->>'username'='q6_admin'`,
    'auth.login');
  assert.equal(row.actionCode, 'auth.login', 'login audit action code');
  assert.equal(row.entityType, 'app_user', 'login audit entity type');
  assert.equal(row.entityId, null, 'login audit entity id');
  assert.equal(lower(row.actorUserId), adminId, 'login audit actor id');
  assert.equal(row.actorDisplayName, 'Q6 Admin', 'login audit actor display name');
  assert.equal(row.requestPath, '/api/auth/login', 'login audit request path');
  assert.equal(row.httpMethod, 'POST', 'login audit http method');
  assert.equal(row.canRestore, false, 'login audit can_restore');
  assert.equal(row.beforeData, null, 'login audit before_data');
  assert.equal(row.afterData, null, 'login audit after_data');
  assert.equal(row.detailsKind, 'object', 'login audit details must be a jsonb object');
  assert.deepEqual(row.details, { username: 'q6_admin' }, 'login audit details payload');
}

// 3) Admin user creation has no explicit audit call: the generic middleware INSERT site writes
//    it after the response is flushed ("api.post"), so this characterizes that fallback insert.
{
  const created = await req(OLD, c.admin, 'POST', '/api/admin/users', {
    username: 'z2_audit_user', displayName: 'Z2 Audit User', password: PASS, permissionCodes: ['dashboard.read'],
  });
  assert.equal(created.status, 201, 'admin user create ' + created.status + ' ' + created.text.slice(0, 200));
  const createdId = lower(JSON.parse(created.text).id);
  const row = await waitForAuditRow(
    `action_code='api.post' AND entity_type='app_users' AND entity_id=${q(createdId)}`,
    'admin user create audit');
  assert.equal(row.actionCode, 'api.post', 'middleware insert action code');
  assert.equal(row.entityType, 'app_users', 'middleware insert entity type');
  assert.equal(lower(row.entityId), createdId, 'middleware insert entity id');
  assert.equal(lower(row.actorUserId), adminId, 'middleware insert actor id');
  assert.equal(row.actorDisplayName, 'Q6 Admin', 'middleware insert actor display name');
  assert.equal(row.requestPath, '/api/admin/users', 'middleware insert request path');
  assert.equal(row.httpMethod, 'POST', 'middleware insert http method');
  assert.equal(row.canRestore, false, 'middleware insert can_restore');
  assert.equal(row.beforeData, null, 'middleware insert before_data');
  assert.ok(object(row.afterData), 'middleware insert must capture the after snapshot');
  assert.equal(lower(row.afterData.id), createdId, 'middleware insert after snapshot id');
  assert.equal(row.detailsKind, 'object', 'middleware insert details must be a jsonb object');
  assert.equal(row.details.path, '/api/admin/users', 'middleware insert details.path');
  assert.equal(row.details.method, 'POST', 'middleware insert details.method');
  assert.equal(row.details.statusCode, 201, 'middleware insert details.statusCode');
  assert.equal(typeof row.details.request, 'string', 'middleware insert details.request stays a JSON string');
  assert.ok(!row.details.request.includes('"password"'), 'middleware insert must strip the password field');
  assert.equal(row.details.note, 'لا توجد لقطة سابقة لهذا النوع من العمليات.',
    'middleware insert details.note explains the missing before snapshot');
}

// Financial fixtures: a student enrollment in the setup circle so charges/payments can be written.
one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'Z2-AUDIT','Z2 Audit Student','active',DATE '2026-01-01');`);
const studentId = one("SELECT id FROM students WHERE student_code='Z2-AUDIT';");
const enrollmentId = one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (gen_random_uuid(),${q(studentId)},${q(c.circleId)},DATE '2026-01-01',100,'active') RETURNING id;`);

// 4) charge.create — written inside the money transaction (Financial/ChargeCreateEndpoint), then
//    enriched by the middleware; exactly one row must exist for the charge.
let chargeId = '';
{
  const created = await req(OLD, c.admin, 'POST', '/api/charges',
    { enrollmentId, billingMonth: '2026-12', amountDue: 100, note: 'z2 audit' }, { 'Idempotency-Key': 'z2-audit-charge' });
  assert.equal(created.status, 201, 'charge create ' + created.status + ' ' + created.text.slice(0, 200));
  chargeId = lower(JSON.parse(created.text).id);

  const row = await waitForAuditRow(`action_code='charge.create' AND entity_id=${q(chargeId)}`, 'charge.create');
  assert.equal(row.entityType, 'monthly_charge', 'charge audit entity type');
  assert.equal(lower(row.actorUserId), adminId, 'charge audit actor id');
  assert.equal(row.canRestore, false, 'charge audit can_restore');
  assert.equal(row.detailsKind, 'object', 'charge audit details must be a jsonb object');
  assert.equal(lower(row.details.enrollmentId), lower(enrollmentId), 'charge audit details.enrollmentId');
  assert.equal(row.details.billingMonth, '2026-12-01', 'charge audit details.billingMonth');
  assert.equal(Number(row.details.amountDue), 100, 'charge audit details.amountDue');
  assert.equal(row.details.idempotencyKey, 'z2-audit-charge', 'charge audit details.idempotencyKey');

  const enriched = await waitForAuditRow(
    `action_code='charge.create' AND entity_id=${q(chargeId)} AND request_path='/api/charges'`,
    'charge.create middleware enrichment');
  assert.equal(enriched.httpMethod, 'POST', 'charge audit http method');
  assert.equal(enriched.beforeData, null, 'charge audit before_data');
  assert.ok(object(enriched.afterData), 'charge audit after_data snapshot');
  assert.equal(Number(enriched.afterData.amount_due), 100, 'charge audit after snapshot amount');
  assert.equal(enriched.details.path, '/api/charges', 'charge audit details.path');
  assert.equal(countRows(`action_code='charge.create' AND entity_id=${q(chargeId)}`), 1,
    'charge creation must stay one audit row');
}

// 5) payment.create — same transaction rule, same middleware enrichment; exactly one row.
{
  const created = await req(OLD, c.admin, 'POST', '/api/payments',
    { monthlyChargeId: chargeId, amount: 40 }, { 'Idempotency-Key': 'z2-audit-payment' });
  assert.equal(created.status, 201, 'payment create ' + created.status + ' ' + created.text.slice(0, 200));
  const paymentId = lower(JSON.parse(created.text).id);

  const row = await waitForAuditRow(`action_code='payment.create' AND entity_id=${q(paymentId)}`, 'payment.create');
  assert.equal(row.entityType, 'payment', 'payment audit entity type');
  assert.equal(lower(row.actorUserId), adminId, 'payment audit actor id');
  assert.equal(row.canRestore, false, 'payment audit can_restore');
  assert.equal(row.detailsKind, 'object', 'payment audit details must be a jsonb object');
  assert.equal(lower(row.details.monthlyChargeId), chargeId, 'payment audit details.monthlyChargeId');
  assert.equal(Number(row.details.amount), 40, 'payment audit details.amount');
  assert.equal(row.details.idempotencyKey, 'z2-audit-payment', 'payment audit details.idempotencyKey');

  const enriched = await waitForAuditRow(
    `action_code='payment.create' AND entity_id=${q(paymentId)} AND request_path='/api/payments'`,
    'payment.create middleware enrichment');
  assert.equal(enriched.httpMethod, 'POST', 'payment audit http method');
  assert.equal(enriched.beforeData, null, 'payment audit before_data');
  assert.ok(object(enriched.afterData), 'payment audit after_data snapshot');
  assert.equal(enriched.details.path, '/api/payments', 'payment audit details.path');
  assert.equal(countRows(`action_code='payment.create' AND entity_id=${q(paymentId)}`), 1,
    'payment creation must stay one audit row');
}

// 6) schedule.create — the endpoint insert then the middleware enrichment; the slot is then moved
//    to trash to characterize the shared connection+transaction helper used by trash.move
//    (details is always the '{}'::jsonb literal there and both snapshots are captured).
{
  const created = await req(OLD, c.admin, 'POST', '/api/schedule-slots',
    { circleId: c.circleId, dayOfWeek: 2, startsAt: '11:00', durationMinutes: 60 });
  assert.equal(created.status, 201, 'schedule slot create ' + created.status + ' ' + created.text.slice(0, 200));
  const slotId = lower(JSON.parse(created.text).id);

  const row = await waitForAuditRow(
    `action_code='schedule.create' AND entity_type='circle_schedule_slot' AND entity_id=${q(slotId)}`,
    'schedule.create');
  assert.equal(lower(row.actorUserId), adminId, 'schedule.create actor id');
  assert.equal(row.canRestore, false, 'schedule.create can_restore');
  assert.equal(row.detailsKind, 'object', 'schedule.create details must be a jsonb object');
  assert.equal(row.details.dayOfWeek, 2, 'schedule.create details.dayOfWeek');
  assert.equal(row.details.startsAt, '11:00', 'schedule.create details.startsAt');
  assert.equal(row.details.durationMinutes, 60, 'schedule.create details.durationMinutes');

  const enriched = await waitForAuditRow(
    `action_code='schedule.create' AND entity_id=${q(slotId)} AND request_path='/api/schedule-slots'`,
    'schedule.create middleware enrichment');
  assert.equal(enriched.httpMethod, 'POST', 'schedule.create http method');
  assert.ok(object(enriched.afterData), 'schedule.create after_data snapshot');
  assert.equal(countRows(`action_code='schedule.create' AND entity_id=${q(slotId)}`), 1,
    'schedule creation must stay one audit row');

  const trashed = await req(OLD, c.admin, 'POST', '/api/admin/trash', { entityType: 'schedule-slot', entityId: slotId });
  assert.equal(trashed.status, 200, 'trash move ' + trashed.status + ' ' + trashed.text.slice(0, 200));
  const trashRow = await waitForAuditRow(`action_code='trash.move' AND entity_id=${q(slotId)}`, 'trash.move');
  assert.equal(trashRow.entityType, 'circle_schedule_slots', 'trash.move entity type is the physical table');
  assert.equal(lower(trashRow.actorUserId), adminId, 'trash.move actor id');
  assert.equal(trashRow.actorDisplayName, 'Q6 Admin', 'trash.move actor display name');
  assert.equal(trashRow.requestPath, '/api/admin/trash', 'trash.move request path');
  assert.equal(trashRow.httpMethod, 'POST', 'trash.move http method');
  assert.equal(trashRow.canRestore, false, 'trash.move can_restore');
  assert.equal(trashRow.detailsKind, 'object', 'trash.move details must be a jsonb object');
  assert.deepEqual(trashRow.details, {}, 'trash.move details is the empty object literal');
  assert.ok(object(trashRow.beforeData), 'trash.move before_data snapshot');
  assert.ok(object(trashRow.afterData), 'trash.move after_data snapshot');
  assert.equal(trashRow.beforeData.is_trashed, false, 'trash.move before snapshot is not trashed');
  assert.equal(trashRow.afterData.is_trashed, true, 'trash.move after snapshot is trashed');
}

// 7) schedule.update — the endpoint that fills the full column list itself (path, method,
//    before/after snapshots and can_restore=TRUE), with exactly one row for the update.
{
  const updated = await req(OLD, c.admin, 'PUT', '/api/schedule-slots/' + c.slotId,
    { dayOfWeek: 1, startsAt: '10:00', durationMinutes: 90, isActive: true });
  assert.equal(updated.status, 200, 'schedule update ' + updated.status + ' ' + updated.text.slice(0, 200));
  const row = await waitForAuditRow(
    `action_code='schedule.update' AND entity_id=${q(c.slotId)}`, 'schedule.update');
  assert.equal(row.entityType, 'circle_schedule_slot', 'schedule.update entity type');
  assert.equal(lower(row.actorUserId), adminId, 'schedule.update actor id');
  // Legacy behaviour: this site never wrote actor_display_name (it is enriched only when the
  // generic middleware finds an unowned row, which this explicit path/method row prevents).
  assert.equal(row.actorDisplayName, null, 'schedule.update actor display name');
  assert.equal(lower(row.requestPath), '/api/schedule-slots/' + lower(c.slotId), 'schedule.update request path');
  assert.equal(row.httpMethod, 'PUT', 'schedule.update http method');
  assert.equal(row.canRestore, true, 'schedule.update can_restore');
  assert.equal(row.detailsKind, 'object', 'schedule.update details must be a jsonb object');
  assert.equal(lower(row.details.circleId), lower(c.circleId), 'schedule.update details.circleId');
  assert.equal(row.details.dayOfWeek, 1, 'schedule.update details.dayOfWeek');
  assert.equal(row.details.startsAt, '10:00', 'schedule.update details.startsAt');
  assert.equal(row.details.durationMinutes, 90, 'schedule.update details.durationMinutes');
  assert.equal(row.details.isActive, true, 'schedule.update details.isActive');
  assert.ok(object(row.beforeData), 'schedule.update before_data snapshot');
  assert.ok(object(row.afterData), 'schedule.update after_data snapshot');
  assert.equal(row.beforeData.duration_minutes, 60, 'schedule.update before snapshot duration');
  assert.equal(row.afterData.duration_minutes, 90, 'schedule.update after snapshot duration');
  assert.equal(countRows(`action_code='schedule.update' AND entity_id=${q(c.slotId)}`), 1,
    'schedule update must stay one audit row');
}

console.log(JSON.stringify({ suite: 'z2-audit-writer', ok: true, cases: 7 }));
