import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setup, one, q, req, OLD, NEW } from '../request-workflow/common.mjs';
import { assertSafeTargets, pgEnv, psqlFile } from '../../lib/index.mjs';

// FINAL Tier 2.3 — enrollment_status_history (database/039).
//
// Proves the materialised history is a drop-in replacement for the JSON audit_log scans:
//   (a) comparison: the migrated functions return exactly the same status/eligibility as a verbatim
//       copy of the migration-011 audit_log logic (reference.sql) for every seeded lifecycle shape,
//       on every day/month in range;
//   (b) a real API lifecycle (create -> pause -> resume -> end) appends history rows and the functions
//       answer from enrollment_status_history (their bodies no longer contain 'audit_log'), including
//       the inclusive-end-date and "ending a paused enrollment" rules;
//   (c) re-applying database/039 is a no-op (stable counts, no duplicates, no audit_log writes) while
//       still backfilling pre-existing audit evidence written with the sync trigger absent — the
//       production backfill path — and the synthetic initial/present rows appear once;
//   (d) audit_log is never modified or deleted by the migration (count / max id / content hash equal)
//       and enrollment_status_history rejects UPDATE/DELETE.
//
// q6 mode: run-regression.sh starts the legacy + new apps and provides DAR_TEST_DATABASE plus the
// Q6_* URLs through ../request-workflow/common.mjs; the disposable database already has
// database/*.sql applied by the harness. Expected runtime: a few seconds.

const CONN = process.env.DAR_TEST_DATABASE || '';
const ROOT = process.cwd();
const MIGRATION = 'database/039_enrollment_status_history.sql';
const fixture = (name) => fileURLToPath(new URL('./' + name, import.meta.url));
assertSafeTargets({ db: CONN, urls: [OLD, NEW], label: 'TIER2_HISTORY_FAIL', requireDb: true, requireUrls: true });

const json = (sql) => JSON.parse(one(sql));
const sqlDate = (expr) => one('SELECT (' + expr + ')::date;');
const day = (date, offset) => {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

function applyMigration() {
  const run = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-1', '-f', MIGRATION],
    { cwd: ROOT, env: pgEnv(CONN), encoding: 'utf8' });
  assert.equal(run.status, 0, 're-applying ' + MIGRATION + ' failed: ' + (run.stderr || '').slice(0, 900));
  assert.match(run.stderr || '', /enrollment_status_history ready/,
    'migration did not reach its invariant/backfill summary');
  return run.stderr || '';
}

const progress = await setup();
assert.equal(psqlFile(CONN, fixture('reference.sql')), 'reference-ready', 'reference oracle fixture failed');
assert.equal(psqlFile(CONN, fixture('seed.sql')), 'seeded', 'lifecycle scenario seed failed');

// ---------------------------------------------------------------------------------------------
// (a) Compatibility comparison against the legacy audit_log logic, before any re-migration.
// The 12 scenarios cover every branch: resume/end, whole-month pause, paused-then-ended, one-day
// inclusive end date, legacy rows without audit evidence, same-day ordering, NULL status/date.
// ---------------------------------------------------------------------------------------------
const comparisonSql = `
WITH suite_ids AS (SELECT kind, id FROM public.t23_suite_ids),
cases AS (
    SELECT s.kind, s.id AS enrollment_id, d.day
    FROM suite_ids s
    CROSS JOIN LATERAL (
        SELECT generate_series(
            (LEAST(ce.starts_on, COALESCE(ce.ends_on, ce.starts_on)) - 5)::timestamp,
            (GREATEST(COALESCE(ce.ends_on, ce.starts_on), CURRENT_DATE) + 5)::timestamp,
            INTERVAL '1 day')::date AS day
        FROM public.circle_enrollments ce WHERE ce.id=s.id
    ) d
),
day_compare AS (
    SELECT c.kind, c.enrollment_id, c.day,
           public.t23_ref_status_at_date(c.enrollment_id,c.day) AS ref_status,
           public.dar_enrollment_status_at_date(c.enrollment_id,c.day) AS new_status,
           public.t23_ref_eligible_on_date(c.enrollment_id,c.day) AS ref_eligible,
           public.dar_enrollment_is_attendance_eligible_on_date(c.enrollment_id,c.day) AS new_eligible
    FROM cases c
),
month_compare AS (
    SELECT s.kind, m.month::date AS month,
           public.t23_ref_has_active_day_in_month(s.id,m.month::date) AS ref_eligible,
           public.dar_enrollment_has_active_day_in_month(s.id,m.month::date) AS new_eligible
    FROM suite_ids s
    CROSS JOIN generate_series(
        (date_trunc('month', CURRENT_DATE) - INTERVAL '4 months')::timestamp,
        (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::timestamp,
        INTERVAL '1 month') AS m(month)
)
SELECT jsonb_build_object(
    'dayCases', (SELECT count(*) FROM day_compare),
    'statusMismatches', (SELECT count(*) FROM day_compare WHERE new_status IS DISTINCT FROM ref_status),
    'eligibleMismatches', (SELECT count(*) FROM day_compare WHERE new_eligible IS DISTINCT FROM ref_eligible),
    'monthCases', (SELECT count(*) FROM month_compare),
    'monthMismatches', (SELECT count(*) FROM month_compare WHERE new_eligible IS DISTINCT FROM ref_eligible),
    'sample', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT kind, enrollment_id, day, ref_status, new_status, ref_eligible, new_eligible
        FROM day_compare
        WHERE new_status IS DISTINCT FROM ref_status OR new_eligible IS DISTINCT FROM ref_eligible
        LIMIT 3) x), '[]'::jsonb))::text;`;

const assertComparison = (label) => {
  const result = json(comparisonSql);
  assert.deepEqual(result.sample, [], label + ': compatibility mismatches: ' + JSON.stringify(result));
  assert.equal(result.statusMismatches, 0, label + ': status_at_date changed: ' + JSON.stringify(result));
  assert.equal(result.eligibleMismatches, 0, label + ': is_attendance_eligible changed: ' + JSON.stringify(result));
  assert.equal(result.monthMismatches, 0, label + ': has_active_day_in_month changed: ' + JSON.stringify(result));
  assert.ok(result.dayCases >= 1400, label + ': day comparison unexpectedly small: ' + result.dayCases);
  assert.ok(result.monthCases >= 70, label + ': month comparison unexpectedly small: ' + result.monthCases);
  return result;
};
const firstComparison = assertComparison('pre-migration comparison');

// ---------------------------------------------------------------------------------------------
// (b) Real lifecycle through the legacy API: history rows must appear on every event.
// ---------------------------------------------------------------------------------------------
const m0 = sqlDate("date_trunc('month', CURRENT_DATE) - INTERVAL '3 months'");
const m2 = sqlDate("date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'");
const resumeOn = day(m2, 14);
const endedOn = day(m2, 20);

const studentRes = await req(OLD, progress.admin, 'POST', '/api/students', {
  studentCode: '', fullName: 'T23 API lifecycle student', ageYears: null, phone: null,
  guardianName: null, guardianPhone: null, joinedOn: m0, status: 'active', notes: null,
});
assert.equal(studentRes.status, 201, 'create student: ' + studentRes.text.slice(0, 300));
const apiStudent = JSON.parse(studentRes.text).id;

const enrollmentRes = await req(OLD, progress.admin, 'POST', '/api/enrollments', {
  studentId: apiStudent, circleId: progress.circleId, startsOn: m0, agreedMonthlyFee: 100,
});
assert.equal(enrollmentRes.status, 201, 'create enrollment: ' + enrollmentRes.text.slice(0, 300));
const apiEnrollment = JSON.parse(enrollmentRes.text).id;

const pauseRes = await req(OLD, progress.admin, 'PATCH', '/api/enrollments/' + apiEnrollment + '/pause',
  { effectiveOn: m2, reason: 't23 pause' });
assert.equal(pauseRes.status, 200, 'pause: ' + pauseRes.text.slice(0, 300));
const resumeRes = await req(OLD, progress.admin, 'PATCH', '/api/enrollments/' + apiEnrollment + '/resume',
  { effectiveOn: resumeOn, reason: 't23 resume' });
assert.equal(resumeRes.status, 200, 'resume: ' + resumeRes.text.slice(0, 300));
const endRes = await req(OLD, progress.admin, 'PATCH', '/api/enrollments/' + apiEnrollment + '/end',
  { endsOn: endedOn });
assert.equal(endRes.status, 200, 'end: ' + endRes.text.slice(0, 300));

const lifecycle = json(`SELECT jsonb_build_object(
  'history', (SELECT jsonb_agg(jsonb_build_object('action', action_code, 'status', status,
                    'effectiveOn', effective_at, 'sourceAuditId', source_audit_id) ORDER BY id)
              FROM public.enrollment_status_history
              WHERE enrollment_id=${q(apiEnrollment)} AND source_audit_id IS NOT NULL),
  'auditRows', (SELECT count(*) FROM public.audit_log WHERE entity_type='enrollment' AND entity_id=${q(apiEnrollment)}
                AND action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')),
  'statusBeforePause', public.dar_enrollment_status_at_date(${q(apiEnrollment)},DATE ${q(day(m2, -1))}),
  'statusPauseDay', public.dar_enrollment_status_at_date(${q(apiEnrollment)},DATE ${q(m2)}),
  'statusAfterResume', public.dar_enrollment_status_at_date(${q(apiEnrollment)},DATE ${q(resumeOn)}),
  'statusEndDay', public.dar_enrollment_status_at_date(${q(apiEnrollment)},DATE ${q(endedOn)}),
  'eligibleEndDay', public.dar_enrollment_is_attendance_eligible_on_date(${q(apiEnrollment)},DATE ${q(endedOn)}),
  'eligibleDayAfterEnd', public.dar_enrollment_is_attendance_eligible_on_date(${q(apiEnrollment)},DATE ${q(day(endedOn, 1))})
)::text;`);
assert.equal(lifecycle.history.length, 4, 'expected one history row per API lifecycle event: ' + JSON.stringify(lifecycle.history));
assert.deepEqual(lifecycle.history.map((row) => row.action),
  ['enrollment.status.baseline', 'enrollment.pause', 'enrollment.resume', 'enrollment.end'],
  'history row actions: ' + JSON.stringify(lifecycle.history));
assert.deepEqual(lifecycle.history.map((row) => row.effectiveOn), [m0, m2, resumeOn, endedOn], 'history effective dates');
assert.ok(lifecycle.history.every((row) => row.sourceAuditId), 'every API history row must keep the audit back-reference');
assert.equal(lifecycle.auditRows, 4, 'expected 4 lifecycle audit rows, found ' + lifecycle.auditRows);
assert.equal(lifecycle.statusBeforePause, 'active', 'status the day before pause');
assert.equal(lifecycle.statusPauseDay, 'paused', 'status on the pause date');
assert.equal(lifecycle.statusAfterResume, 'active', 'status on the resume date');
assert.equal(lifecycle.statusEndDay, 'ended', 'status on the end date');
assert.equal(lifecycle.eligibleEndDay, true, 'active enrollment must stay eligible on its inclusive end date');
assert.equal(lifecycle.eligibleDayAfterEnd, false, 'ended enrollment must not be eligible after its end date');

const functionSources = json(`SELECT jsonb_object_agg(proname, (prosrc ILIKE '%audit_log%'))::text
  FROM pg_proc WHERE proname IN ('dar_enrollment_status_at_date','dar_enrollment_is_attendance_eligible_on_date','dar_enrollment_has_active_day_in_month');`);
for (const [name, readsAuditLog] of Object.entries(functionSources)) {
  assert.equal(readsAuditLog, false, name + ' still reads audit_log JSON');
}

// AuditMiddleware enriches the explicit audit rows after the HTTP response; wait for that before
// hashing audit_log so the later comparisons cannot race a legitimate enrichment UPDATE.
const enrichedSql = `SELECT count(*) FROM public.audit_log
  WHERE entity_type='enrollment' AND entity_id=${q(apiEnrollment)} AND request_path IS NOT NULL;`;
for (let attempt = 0; attempt < 100 && Number(one(enrichedSql)) < 4; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(Number(one(enrichedSql)), 4, 'the legacy audit middleware did not enrich the four lifecycle audit rows');

// ---------------------------------------------------------------------------------------------
// (c)/(d) Backfill + idempotency: pre-existing audit evidence (sync trigger absent) is backfilled by
// re-applying 039; the re-apply keeps counts stable, never writes audit_log and is re-runnable.
// ---------------------------------------------------------------------------------------------
const auditHash = "(SELECT md5(COALESCE(string_agg(id::text || '|' || action_code || '|' || entity_type || '|' || COALESCE(entity_id::text,'') || '|' || details::text || '|' || occurred_at::text, ',' ORDER BY id), '')) FROM public.audit_log)";
const pendingBackfill = `(SELECT count(*) FROM public.audit_log al
      WHERE al.entity_type='enrollment' AND al.entity_id IS NOT NULL
        AND al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')
        AND NULLIF(al.details->>'effectiveOn','')::date IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.circle_enrollments ce WHERE ce.id=al.entity_id)
        AND NOT EXISTS (SELECT 1 FROM public.enrollment_status_history h WHERE h.source_audit_id=al.id))`;
const snapshotSql = `SELECT jsonb_build_object(
  'historyRows', (SELECT count(*) FROM public.enrollment_status_history),
  'realRows', (SELECT count(*) FROM public.enrollment_status_history WHERE source_audit_id IS NOT NULL),
  'syntheticRows', (SELECT count(*) FROM public.enrollment_status_history WHERE source_audit_id IS NULL),
  'auditRows', (SELECT count(*) FROM public.audit_log),
  'auditMaxId', (SELECT max(id) FROM public.audit_log),
  'auditHash', ${auditHash},
  'expectedBackfill', ${pendingBackfill},
  'expectedInitial', (SELECT count(*) FROM public.circle_enrollments ce
      WHERE NOT EXISTS (SELECT 1 FROM public.enrollment_status_history h
                        WHERE h.enrollment_id=ce.id
                          AND (h.source_audit_id IS NOT NULL OR h.action_code='enrollment.status.initial'))
        AND NOT EXISTS (SELECT 1 FROM public.audit_log al
                        WHERE al.entity_type='enrollment' AND al.entity_id=ce.id
                          AND al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')
                          AND NULLIF(al.details->>'effectiveOn','')::date IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM public.enrollment_status_history h WHERE h.source_audit_id=al.id))),
  'expectedSnapshot', (SELECT count(*) FROM public.circle_enrollments ce
      WHERE ce.status IN ('paused','ended')
        AND NOT EXISTS (SELECT 1 FROM public.enrollment_status_history h
                        WHERE h.enrollment_id=ce.id AND h.source_audit_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM public.enrollment_status_history h
                        WHERE h.enrollment_id=ce.id AND h.action_code='enrollment.status.snapshot')
        AND NOT EXISTS (SELECT 1 FROM public.audit_log al
                        WHERE al.entity_type='enrollment' AND al.entity_id=ce.id
                          AND al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')
                          AND NULLIF(al.details->>'effectiveOn','')::date IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM public.enrollment_status_history h WHERE h.source_audit_id=al.id)))
)::text;`;

// A pre-existing enrollment whose audit evidence predates the sync trigger (the production backfill case).
const backfillCircle = one(`INSERT INTO public.circles(circle_code,name,monthly_fee,is_active,starts_on)
  VALUES ('T23-BF','T23 backfill',100,TRUE,DATE ${q(m0)}) RETURNING id;`);
const backfillEnrollment = one(`INSERT INTO public.circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status)
  SELECT id, ${q(backfillCircle)}, DATE ${q(m0)}, 100, 'active' FROM public.students WHERE student_code='T23-S1';`);
one('ALTER TABLE public.audit_log DISABLE TRIGGER trg_audit_log_enrollment_status_history;');
const backfillAudit = one(`INSERT INTO public.audit_log(action_code,entity_type,entity_id,details,occurred_at)
  VALUES ('enrollment.status.baseline','enrollment',${q(backfillEnrollment)},
          jsonb_build_object('status','active','effectiveOn',DATE ${q(m0)}), now()-INTERVAL '20 days') RETURNING id;`);
assert.equal(one(`SELECT count(*) FROM public.enrollment_status_history WHERE source_audit_id=${q(backfillAudit)};`), '0',
  'history row appeared although the sync trigger was disabled');

const before = json(snapshotSql);
assert.ok(before.expectedBackfill >= 1, 'the simulated pre-migration audit row must be pending backfill');
assert.ok(before.expectedInitial >= 3, 'legacy audit-less enrollments must be pending initial rows');
assert.ok(before.expectedSnapshot >= 2, 'legacy paused/ended enrollments must be pending snapshot rows');

const migrationLog = applyMigration();

const after = json(snapshotSql);
assert.equal(after.historyRows - before.historyRows,
  before.expectedBackfill + before.expectedInitial + before.expectedSnapshot,
  'migration added an unexpected number of history rows: ' + JSON.stringify({ before, after }));
assert.equal(after.realRows - before.realRows, before.expectedBackfill, 'real backfilled row count');
assert.equal(after.syntheticRows - before.syntheticRows, before.expectedInitial + before.expectedSnapshot, 'synthetic row count');
assert.equal(after.expectedBackfill, 0, 'backfill left mappable audit rows un-materialised');
assert.equal(after.expectedInitial, 0, 'legacy enrollments without an initial row remain');
assert.equal(after.expectedSnapshot, 0, 'legacy paused/ended enrollments without a snapshot row remain');
assert.equal(after.auditRows, before.auditRows, 'migration changed the audit_log row count');
assert.equal(after.auditMaxId, before.auditMaxId, 'migration inserted/deleted the newest audit_log row');
assert.equal(after.auditHash, before.auditHash, 'migration modified audit_log contents');
assert.match(migrationLog, /backfilled 1/, 'backfill summary did not report the simulated pre-migration row');

const backfilled = json(`SELECT jsonb_build_object(
  'rows', (SELECT count(*) FROM public.enrollment_status_history WHERE source_audit_id=${q(backfillAudit)}),
  'status', (SELECT status FROM public.enrollment_status_history WHERE source_audit_id=${q(backfillAudit)}),
  'effectiveOn', (SELECT effective_at FROM public.enrollment_status_history WHERE source_audit_id=${q(backfillAudit)}),
  'triggerEnabled', (SELECT tgenabled FROM pg_trigger WHERE tgname='trg_audit_log_enrollment_status_history'),
  'legacySynthetic', (SELECT jsonb_agg(jsonb_build_object('action', action_code, 'status', status, 'effectiveOn', effective_at))
                    FROM public.enrollment_status_history
                    WHERE enrollment_id=(SELECT id FROM public.t23_suite_ids WHERE kind='D_legacy_paused')
                      AND source_audit_id IS NULL),
  'legacyActiveInitial', (SELECT count(*) FROM public.enrollment_status_history
                    WHERE enrollment_id=(SELECT id FROM public.t23_suite_ids WHERE kind='H_legacy_active')
                      AND action_code='enrollment.status.initial'),
  'duplicateSources', (SELECT count(*) FROM (SELECT source_audit_id FROM public.enrollment_status_history
                        WHERE source_audit_id IS NOT NULL GROUP BY 1 HAVING count(*)>1) d),
  'duplicateInitial', (SELECT count(*) FROM (SELECT enrollment_id FROM public.enrollment_status_history
                        WHERE action_code='enrollment.status.initial' GROUP BY 1 HAVING count(*)>1) d),
  'enrollmentsWithoutHistory', (SELECT count(*) FROM public.circle_enrollments ce
                        WHERE NOT EXISTS (SELECT 1 FROM public.enrollment_status_history h WHERE h.enrollment_id=ce.id))
)::text;`);
assert.equal(backfilled.rows, 1, 'backfill did not create the pre-migration history row');
assert.equal(backfilled.status, 'active', 'backfilled status');
assert.equal(backfilled.effectiveOn, m0, 'backfilled effective date');
assert.equal(backfilled.triggerEnabled, 'O', 'sync trigger must be enabled after the migration re-run');
assert.equal(backfilled.duplicateSources, 0, 'duplicate source_audit_id rows after backfill');
assert.equal(backfilled.duplicateInitial, 0, 'duplicate synthetic initial rows after backfill');
assert.equal(backfilled.enrollmentsWithoutHistory, 0, 'an enrollment has no history row at all');
assert.deepEqual(backfilled.legacySynthetic.map((row) => row.action).sort(),
  ['enrollment.status.initial', 'enrollment.status.snapshot'],
  'legacy paused enrollment must keep exactly one initial and one present-snapshot row: ' + JSON.stringify(backfilled.legacySynthetic));
assert.equal(backfilled.legacyActiveInitial, 1, 'legacy active enrollment must get exactly one initial row');

// A second, unconditional re-run must be a pure no-op (idempotent file).
const beforeSecond = json(snapshotSql);
applyMigration();
const afterSecond = json(snapshotSql);
assert.deepEqual(afterSecond, beforeSecond, 're-applying migration 039 twice was not a no-op');
assert.equal(afterSecond.auditHash, before.auditHash, 'audit_log changed across the two migration re-runs');

// (a again) Synthetic/backfilled rows must not perturb any function result.
const secondComparison = assertComparison('post-migration comparison');

// The materialised history itself is append-only.
one(`DO $t23$
DECLARE
    v_id bigint := (SELECT min(id) FROM public.enrollment_status_history);
    v_delete_blocked boolean := false;
    v_update_blocked boolean := false;
BEGIN
    BEGIN
        DELETE FROM public.enrollment_status_history WHERE id=v_id;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'enrollment_status_history is append-only%' THEN v_delete_blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT v_delete_blocked THEN RAISE EXCEPTION 'append-only guard allowed DELETE'; END IF;
    BEGIN
        UPDATE public.enrollment_status_history SET status='active' WHERE id=v_id;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'enrollment_status_history is append-only%' THEN v_update_blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT v_update_blocked THEN RAISE EXCEPTION 'append-only guard allowed UPDATE'; END IF;
END $t23$;`);

console.log(JSON.stringify({
  suite: 'tier2-history',
  ok: true,
  cases: 13,
  dayComparisons: firstComparison.dayCases + secondComparison.dayCases,
  monthComparisons: firstComparison.monthCases + secondComparison.monthCases,
  apiLifecycleRows: lifecycle.history.length,
  backfilledRows: before.expectedBackfill,
  syntheticRows: before.expectedInitial + before.expectedSnapshot,
}));
