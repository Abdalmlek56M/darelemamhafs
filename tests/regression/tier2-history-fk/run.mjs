import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { setup, one, q, OLD, NEW, req } from '../request-workflow/common.mjs';
import { pgEnv } from '../../lib/index.mjs';

// FINAL batch-3 review (ADR-0009): enrollment_status_history has an FK to circle_enrollments.
// This suite proves the derived-history FK does not break the operational paths that can delete
// live rows (data reset / maintenance cleanup / test cleanup / student removal), that the
// append-only guarantee still blocks direct history writes, and that the retention job never
// touches audit_log (so the audit_log side of the FK is never exercised by retention).
const CONN = process.env.DAR_TEST_DATABASE || '';
const connEnv = pgEnv(CONN);
const c = await setup();

function psqlAttempt(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { env: connEnv, encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

function auditSnapshot() {
  return JSON.parse(one(`SELECT jsonb_build_object(
    'rows', (SELECT count(*) FROM public.audit_log),
    'maxId', (SELECT COALESCE(max(id),0) FROM public.audit_log),
    'sumIds', (SELECT COALESCE(sum(id),0) FROM public.audit_log))::text;`));
}

function createEnrollmentWithHistory(tag) {
  const studentId = one(`INSERT INTO public.students(student_code, full_name, status, joined_on)
    VALUES (${q('FK-S-' + tag)}, ${q('FK Student ' + tag)}, 'active', DATE '2026-01-01') RETURNING id;`);
  const enrollmentId = one(`INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, agreed_monthly_fee, status)
    VALUES (${q(studentId)}, ${q(c.circleId)}, DATE '2026-01-01', 100, 'active') RETURNING id;`);
  const auditId = one(`INSERT INTO public.audit_log(action_code, entity_type, entity_id, details, occurred_at, actor_display_name, request_path, http_method)
    VALUES ('enrollment.status.baseline', 'enrollment', ${q(enrollmentId)},
            jsonb_build_object('status','active','effectiveOn',DATE '2026-01-01'), now(), 'FK suite', '/fk-suite', 'POST')
    RETURNING id;`);
  const historyCount = Number(one(`SELECT count(*) FROM public.enrollment_status_history WHERE enrollment_id=${q(enrollmentId)};`));
  assert.equal(historyCount, 1, 'the audit sync trigger must materialise one history row for ' + tag);
  return { studentId, enrollmentId, auditId };
}

// 1) Retention job still runs, and it never touches audit_log or the derived history.
const retentionBefore = auditSnapshot();
one(`INSERT INTO public.auth_sessions(id, user_id, ticket, created_at, expires_at)
     VALUES (gen_random_uuid(), ${q(c.adminId)}, 'fk-retention-ticket', now() - INTERVAL '40 days', now() - INTERVAL '30 days');`);
const retention = await req(NEW, c.admin, 'POST', '/api/v1/system/retention/run');
assert.equal(retention.status, 200, 'retention run failed: ' + retention.status + ' ' + retention.text.slice(0, 240));
const retentionBody = JSON.parse(retention.text);
assert.ok(Number(retentionBody.sessions) >= 1, 'retention must delete the seeded expired session: ' + retention.text);
const retentionAfter = auditSnapshot();
assert.deepEqual(retentionAfter, retentionBefore, 'retention changed audit_log rows; audit_log must never be pruned');
assert.equal(Number(one('SELECT count(*) FROM public.auth_sessions WHERE ticket = \'fk-retention-ticket\';')), 0,
  'the seeded expired session was not deleted by the retention run');

// 2) audit_log stays append-only: no supported path may delete audit evidence.
const existingAuditId = one('SELECT id FROM public.audit_log ORDER BY id LIMIT 1;');
const auditDelete = psqlAttempt(`DELETE FROM public.audit_log WHERE id = ${q(existingAuditId)};`);
assert.notEqual(auditDelete.status, 0, 'deleting an audit_log row must be rejected by the append-only trigger');
assert.match(auditDelete.stderr, /append-only/i, 'unexpected audit_log delete error: ' + auditDelete.stderr.slice(0, 240));

// 3) Direct history writes are still rejected, but FK cascades are the deliberate exception.
const fixture = createEnrollmentWithHistory('A');
const historyId = one(`SELECT id FROM public.enrollment_status_history WHERE enrollment_id=${q(fixture.enrollmentId)} LIMIT 1;`);
const historyUpdate = psqlAttempt(`UPDATE public.enrollment_status_history SET status = 'ended' WHERE id = ${q(historyId)};`);
assert.notEqual(historyUpdate.status, 0, 'direct UPDATE of enrollment_status_history must be rejected');
assert.match(historyUpdate.stderr, /append-only/i, 'unexpected history update error: ' + historyUpdate.stderr.slice(0, 240));
const historyDelete = psqlAttempt(`DELETE FROM public.enrollment_status_history WHERE id = ${q(historyId)};`);
assert.notEqual(historyDelete.status, 0, 'direct DELETE of enrollment_status_history must be rejected');
assert.match(historyDelete.stderr, /append-only/i, 'unexpected history delete error: ' + historyDelete.stderr.slice(0, 240));

// 4) Data reset / maintenance cleanup: hard-deleting an enrollment must cascade its derived
//    history (the materialised rows are derived; the audit_log evidence stays untouched).
const beforeCascadeAudit = auditSnapshot();
const cascadeDelete = psqlAttempt(`DELETE FROM public.circle_enrollments WHERE id = ${q(fixture.enrollmentId)};`);
assert.equal(cascadeDelete.status, 0, 'hard delete of an enrollment was blocked by the derived-history FK: ' + cascadeDelete.stderr.slice(0, 300));
assert.equal(Number(one(`SELECT count(*) FROM public.enrollment_status_history WHERE enrollment_id=${q(fixture.enrollmentId)};`)), 0,
  'the derived history rows must disappear with their enrollment');
assert.deepEqual(auditSnapshot(), beforeCascadeAudit, 'deleting an enrollment must not touch audit_log');

// 5) Deleting a student through the same reset path works once the dependent enrollments are
//    removed (students -> enrollments stays RESTRICT by design, the history table must not add
//    another blocker after the enrollment is gone).
const studentFixture = createEnrollmentWithHistory('B');
const deleteEnrollmentForStudent = psqlAttempt(`DELETE FROM public.circle_enrollments WHERE id = ${q(studentFixture.enrollmentId)};`);
assert.equal(deleteEnrollmentForStudent.status, 0, 'enrollment delete for student fixture failed: ' + deleteEnrollmentForStudent.stderr.slice(0, 300));
const deleteStudent = psqlAttempt(`DELETE FROM public.students WHERE id = ${q(studentFixture.studentId)};`);
assert.equal(deleteStudent.status, 0, 'deleting the student after its enrollments failed: ' + deleteStudent.stderr.slice(0, 300));

// 6) The UI reset flow: move to trash and restore must keep history + eligibility consistent.
const resetFixture = createEnrollmentWithHistory('C');
const move = await req(OLD, c.admin, 'POST', '/api/admin/trash',
  { entityType: 'enrollment', entityId: resetFixture.enrollmentId });
assert.equal(move.status, 200, 'trash move failed: ' + move.status + ' ' + move.text.slice(0, 240));
const trashId = JSON.parse(move.text).id;
assert.equal(Number(one(`SELECT count(*) FROM public.enrollment_status_history WHERE enrollment_id=${q(resetFixture.enrollmentId)};`)), 1,
  'moving an enrollment to trash must not delete its derived history');
const restore = await req(OLD, c.admin, 'POST', '/api/admin/trash/' + trashId + '/restore');
assert.equal(restore.status, 200, 'trash restore failed: ' + restore.status + ' ' + restore.text.slice(0, 240));
const statusOnStart = one(`SELECT public.dar_enrollment_status_at_date(${q(resetFixture.enrollmentId)}, DATE '2026-01-01');`);
assert.equal(statusOnStart, 'active', 'the eligibility function changed after trash move + restore');

const finalAudit = auditSnapshot();
assert.ok(Number(finalAudit.rows) >= Number(retentionAfter.rows), 'audit_log lost rows during the FK paths');

console.log(JSON.stringify({
  suite: 'tier2-history-fk',
  ok: true,
  cases: 6,
  retentionSessions: Number(retentionBody.sessions),
  auditRows: Number(finalAudit.rows),
}));
