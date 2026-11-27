// FINAL Tier 2.7 — SQL used by tests/regression/tier2-queries/run.mjs.
//
// NEW SQL is extracted verbatim from the committed C# constants (no copy drift): the suite runs
// the real text that the API executes, after substituting the @param placeholders with literals.
// OLD SQL is kept here as a frozen verbatim copy of the pre-2.7 query it replaced, so every
// rewrite is checked old-shape vs new-shape against independently computed SQL expectations.
import { readFileSync } from 'node:fs';

/** Extract a C# `const string NAME = """ ... """;` raw string literal from a repo file. */
export function extractConst(relativePath, name) {
  const text = readFileSync(new URL('../../../' + relativePath, import.meta.url), 'utf8');
  const match = text.match(new RegExp('const string ' + name + ' = """\\r?\\n([\\s\\S]*?)\\r?\\n\\s*""";'));
  if (!match) throw new Error('cannot extract const ' + name + ' from ' + relativePath);
  return match[1];
}

/** Replace @name placeholders with SQL literals. */
export function fill(sql, params) {
  let result = sql;
  for (const [name, value] of Object.entries(params)) result = result.split('@' + name).join(value);
  return result;
}

export const STUDENT_LIST_FILE = 'backend/DarEltahfeez.Api/Pagination/LegacyStudentList.cs';
export const SESSION_SUMMARY_FILE = 'backend/DarEltahfeez.Api/Pagination/LegacySessionSummary.cs';
export const SCOPE_LOADER_FILE = 'src/Common/Dar.Common/Permissions/ScopeLoader.cs';
export const STUDENT_REPO_FILE = 'src/Modules/Secretariat/Dar.Modules.Secretariat/Persistence/StudentRepository.cs';

// ---------------------------------------------------------------------------
// OLD legacy students list (domain projection + list predicate from before 2.7)
// ---------------------------------------------------------------------------
export const studentsListOld = ({ search, like, status, take, skip }) => `
SELECT s.id, s.student_code, s.full_name, s.age_years, s.phone, s.guardian_name, s.guardian_phone,
       s.joined_on, s.status, s.notes, s.created_at, s.updated_at,
       COALESCE((SELECT string_agg(c.name, '، ' ORDER BY c.name)
                 FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id
                 WHERE ce.student_id=s.id AND ce.status='active' AND ce.is_trashed=FALSE AND c.is_active=TRUE AND c.is_trashed=FALSE), ''),
       COALESCE((SELECT SUM(mc.amount_due) FROM circle_enrollments ce
                 JOIN monthly_charges mc ON mc.enrollment_id=ce.id AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date AND mc.is_trashed=FALSE AND mc.voided_at IS NULL
                 WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL), 0),
       COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                 JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                 WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND p.is_trashed=FALSE AND p.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0),
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM circle_enrollments ce JOIN monthly_charges mc ON mc.enrollment_id=ce.id
                          WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date) THEN 'not-set'
         WHEN COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                        JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                        WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND p.is_trashed=FALSE AND p.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0)
             >= COALESCE((SELECT SUM(mc.amount_due) FROM circle_enrollments ce JOIN monthly_charges mc ON mc.enrollment_id=ce.id
                          WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0) THEN 'paid'
         WHEN COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                        JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                        WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND p.is_trashed=FALSE AND p.voided_at IS NULL AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0) > 0 THEN 'partial'
         ELSE 'unpaid'
       END AS current_month_payment_status,
       COUNT(*) OVER() AS total
FROM students s
WHERE s.is_trashed=FALSE
  AND (${search} = '' OR s.full_name ILIKE ${like} OR s.student_code ILIKE ${like} OR COALESCE(s.phone,'') ILIKE ${like}
       OR COALESCE(s.guardian_name,'') ILIKE ${like} OR COALESCE(s.guardian_phone,'') ILIKE ${like})
  AND (${status} = '' OR s.status = ${status})
ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1
         WHEN 'withdrawn' THEN 2 ELSE 3 END, s.full_name, s.id
${take === 'NULL' ? '' : `LIMIT ${take} OFFSET ${skip}`};`;

// ---------------------------------------------------------------------------
// OLD legacy teacher / circle lists (correlated subqueries before 2.7)
// ---------------------------------------------------------------------------
export const teachersListOld = ({ search, like, status, take, skip }) => `
SELECT t.id,t.teacher_code,t.full_name,t.phone,t.hourly_rate,t.status,t.notes,t.created_at,t.updated_at,
       COALESCE((SELECT string_agg(c.name,'، ' ORDER BY c.name) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE), '') AS circle_names,
       (SELECT COUNT(*) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE) AS circle_count,
       COUNT(*) OVER() AS total
FROM teachers t WHERE t.is_trashed=FALSE
  AND (${search} = '' OR t.full_name ILIKE ${like} OR t.teacher_code ILIKE ${like} OR COALESCE(t.phone,'') ILIKE ${like})
  AND (${status} = '' OR t.status = ${status})
ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,t.full_name,t.id
${take === 'NULL' ? '' : `LIMIT ${take} OFFSET ${skip}`};`;

export const circlesListOld = ({ search, like, take, skip }) => `
SELECT c.id,c.circle_code,c.name,c.teacher_id,COALESCE(t.full_name,''),c.monthly_fee,c.schedule_text,c.is_active,c.created_at,c.updated_at,
       (SELECT COUNT(*) FROM circle_enrollments ce WHERE ce.circle_id=c.id AND ce.status='active' AND ce.is_trashed=FALSE),c.starts_on,
       COUNT(*) OVER() AS total
FROM circles c LEFT JOIN teachers t ON t.id=c.teacher_id WHERE c.is_trashed=FALSE
  AND (${search} = '' OR c.name ILIKE ${like} OR COALESCE(c.circle_code,'') ILIKE ${like} OR COALESCE(t.full_name,'') ILIKE ${like})
ORDER BY c.is_active DESC,c.starts_on,c.name,c.id
${take === 'NULL' ? '' : `LIMIT ${take} OFFSET ${skip}`};`;

// ---------------------------------------------------------------------------
// OLD legacy session summary (four BOOL_OR aggregates per session x enrolment)
// ---------------------------------------------------------------------------
export const sessionSummaryOld = ({ from, to, take, skip }) => `
WITH month_days AS (
    SELECT day_value::date AS session_date
    FROM generate_series(${from}::date::timestamp, (${to}::date - 1)::timestamp, interval '1 day') AS day_value
),
sessions AS (
    SELECT ss.id AS slot_id, ss.circle_id, d.session_date
    FROM month_days d
    JOIN circle_schedule_slots ss ON ss.day_of_week=EXTRACT(DOW FROM d.session_date)::smallint
    JOIN circles c ON c.id=ss.circle_id AND c.is_trashed=FALSE
    WHERE ss.is_active=TRUE AND ss.is_trashed=FALSE
    UNION
    SELECT ta.schedule_slot_id, ta.circle_id, ta.session_date
    FROM teacher_attendance ta
    JOIN circle_schedule_slots ss ON ss.id=ta.schedule_slot_id AND ss.is_trashed=FALSE
    WHERE ta.is_trashed=FALSE AND ta.schedule_slot_id IS NOT NULL
      AND ta.session_date>=${from} AND ta.session_date<${to}
    UNION
    SELECT sa.schedule_slot_id, ce.circle_id, sa.session_date
    FROM student_attendance sa
    JOIN circle_schedule_slots ss ON ss.id=sa.schedule_slot_id AND ss.is_trashed=FALSE
    JOIN circle_enrollments ce ON ce.id=sa.enrollment_id AND ce.is_trashed=FALSE
    WHERE sa.is_trashed=FALSE AND sa.session_date>=${from} AND sa.session_date<${to}
),
per_student AS (
    SELECT ses.slot_id,ses.session_date,s.id AS student_id,
           BOOL_OR(ce.starts_on<=ses.session_date
             AND (ce.ends_on IS NULL OR ce.ends_on>=ses.session_date)
             AND session_circle.starts_on<=ses.session_date
             AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,ses.session_date))
             AS eligible_for_date,
           BOOL_OR(sa.id IS NOT NULL) AS has_saved_attendance,
           BOOL_OR(sa.status='present') AS is_present,
           BOOL_OR(ce.status='active' AND (ce.ends_on IS NULL OR ce.ends_on>=CURRENT_DATE)
             AND session_circle.starts_on<=CURRENT_DATE) AS is_current_roster
    FROM sessions ses
    JOIN circle_enrollments ce ON ce.circle_id=ses.circle_id AND ce.is_trashed=FALSE
    JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
    JOIN circles session_circle ON session_circle.id=ses.circle_id
      AND session_circle.is_trashed=FALSE
    LEFT JOIN student_attendance sa ON sa.enrollment_id=ce.id
      AND sa.schedule_slot_id=ses.slot_id AND sa.session_date=ses.session_date
      AND sa.is_trashed=FALSE
    GROUP BY ses.slot_id,ses.session_date,s.id
),
counts AS (
    SELECT slot_id,session_date,
           COUNT(DISTINCT student_id)
             FILTER (WHERE is_current_roster OR eligible_for_date OR has_saved_attendance)
             AS total_students,
           COUNT(DISTINCT student_id) FILTER (WHERE is_present) AS present_students
    FROM per_student GROUP BY slot_id,session_date
)
SELECT ses.slot_id,ses.session_date,COALESCE(counts.total_students,0),
       COALESCE(counts.present_students,0),COUNT(*) OVER() AS total
FROM sessions ses LEFT JOIN counts ON counts.slot_id=ses.slot_id
  AND counts.session_date=ses.session_date
ORDER BY ses.session_date DESC,ses.slot_id
${take === 'NULL' ? '' : `LIMIT ${take} OFFSET ${skip}`};`;

// ---------------------------------------------------------------------------
// OLD modular-API students list: separate COUNT command + page command
// ---------------------------------------------------------------------------
export const apiCountOld = ({ circles, pageSize, offset }) => `
SELECT count(*) FROM students
WHERE is_trashed=FALSE
  AND (${circles} = '{}'::uuid[] OR EXISTS (SELECT 1 FROM circle_enrollments ce
       JOIN circles scope_circle ON scope_circle.id = ce.circle_id AND scope_circle.is_trashed = FALSE
       WHERE ce.student_id = students.id AND ce.is_trashed = FALSE AND ce.circle_id = ANY(${circles}::uuid[])));`;

export const apiPageOld = ({ circles, pageSize, offset }) => `
SELECT id AS Id, student_code AS StudentCode, full_name AS FullName, age_years AS AgeYears,
       phone AS Phone, guardian_name AS GuardianName, guardian_phone AS GuardianPhone,
       joined_on AS JoinedOn, status AS Status, notes AS Notes, created_at AS CreatedAt, updated_at AS UpdatedAt
FROM students
WHERE is_trashed=FALSE
  AND (${circles} = '{}'::uuid[] OR EXISTS (SELECT 1 FROM circle_enrollments ce
       JOIN circles scope_circle ON scope_circle.id = ce.circle_id AND scope_circle.is_trashed = FALSE
       WHERE ce.student_id = students.id AND ce.is_trashed = FALSE AND ce.circle_id = ANY(${circles}::uuid[])))
ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'withdrawn' THEN 2 ELSE 3 END, full_name, id
LIMIT ${pageSize} OFFSET ${offset};`;

// ---------------------------------------------------------------------------
// OLD ScopeLoader algorithm (direct lists -> teacher->circle -> circle->teacher)
// ---------------------------------------------------------------------------
export const scopeOld = (userId) => `
WITH raw AS (SELECT scope_type, scope_id FROM app_user_scopes WHERE user_id=${userId}),
dc AS (SELECT scope_id FROM raw WHERE scope_type='circle'),
dt AS (SELECT scope_id FROM raw WHERE scope_type<>'circle'),
dcircles AS (
    SELECT scope_id FROM dc
    UNION SELECT c.id FROM circles c WHERE c.is_trashed=FALSE AND c.teacher_id IN (SELECT scope_id FROM dt)
),
dteachers AS (
    SELECT scope_id FROM dt
    UNION SELECT DISTINCT c.teacher_id FROM circles c
    WHERE c.is_trashed=FALSE AND c.teacher_id IS NOT NULL AND c.id IN (SELECT scope_id FROM dcircles)
)
SELECT (SELECT count(*) FROM raw),
       COALESCE((SELECT array_agg(scope_id ORDER BY scope_id) FROM dcircles), '{}'::uuid[]),
       COALESCE((SELECT array_agg(scope_id ORDER BY scope_id) FROM dteachers), '{}'::uuid[]);`;

// ---------------------------------------------------------------------------
// Fixtures: 120 token students, 4 teachers, 6 circles, enrolments, charges,
// payments, scopes and a current-month session-summary fixture with edge cases.
// ---------------------------------------------------------------------------
export function seedSql(token) {
  const sid = (group, n) => `('00000000-0000-4000-97${group}-'||lpad((${n})::text,12,'0'))::uuid`;
  return `
INSERT INTO teachers(id,teacher_code,full_name,status,hourly_rate)
SELECT ${sid('00', 'g')}, '${token}-T'||lpad(g::text,2,'0'), '${token} Teacher '||g, 'active', 60
FROM generate_series(1,4) g;

INSERT INTO circles(id,circle_code,name,teacher_id,monthly_fee,is_active,starts_on,is_trashed)
SELECT ${sid('01', 'g')}, '${token}-C'||lpad(g::text,2,'0'), '${token} Circle '||g,
       (SELECT id FROM teachers WHERE teacher_code='${token}-T'||lpad(((g-1)%4+1)::text,2,'0')),
       100, (g<=4), DATE '2025-01-01', (g=6)
FROM generate_series(1,6) g;

INSERT INTO students(id,student_code,full_name,age_years,phone,guardian_name,guardian_phone,joined_on,status)
SELECT ${sid('02', 'g')}, '${token}-S'||lpad(g::text,4,'0'),
       CASE WHEN g<=3 THEN '${token} Tie Student' ELSE '${token} Student '||lpad(g::text,4,'0') END,
       10+(g%12), CASE WHEN g%4=0 THEN NULL ELSE '0100'||lpad(g::text,7,'0') END,
       CASE WHEN g%3=0 THEN NULL ELSE '${token} Guardian '||g END,
       CASE WHEN g%5=0 THEN NULL ELSE '0111'||lpad(g::text,7,'0') END,
       DATE '2025-01-01' + (g%300) * INTERVAL '1 day',
       CASE WHEN g%10=0 THEN 'paused' WHEN g%20=0 THEN 'withdrawn' ELSE 'active' END
FROM generate_series(1,120) g;

INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,ends_on,agreed_monthly_fee,status,is_trashed)
SELECT ${sid('03', 'g')}, ${sid('02', 'g')}, ${sid('01', 'g%4+1')},
       DATE '2025-01-01', NULL, 100,
       CASE WHEN g%10=0 THEN 'paused' ELSE 'active' END, (g%23=0)
FROM generate_series(1,120) g;

INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,ends_on,agreed_monthly_fee,status,is_trashed)
SELECT ${sid('03', '600+g')}, ${sid('02', 'g')}, ${sid('01', '5')},
       DATE '2025-02-01', NULL, 80, 'active', FALSE
FROM generate_series(1,40) g;

INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due,is_trashed,voided_at,void_reason)
SELECT ${sid('04', 'g')}, ${sid('03', 'g')}, date_trunc('month', CURRENT_DATE)::date,
       CASE WHEN g%11=0 THEN 0 ELSE 100 END, (g%17=0),
       CASE WHEN g%19=0 THEN now() ELSE NULL END, CASE WHEN g%19=0 THEN '${token} void' ELSE NULL END
FROM generate_series(1,120) g WHERE g%3<>0;

INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due,is_trashed,voided_at,void_reason)
SELECT ${sid('04', '400+g')}, ${sid('03', 'g')},
       (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date, 90, FALSE, NULL, NULL
FROM generate_series(1,120) g WHERE g%3=0;

INSERT INTO payments(id,monthly_charge_id,amount,paid_at,is_trashed)
SELECT ${sid('05', 'g')}, ${sid('04', 'g')}, 100, now()-INTERVAL '5 days', FALSE
FROM generate_series(1,120) g WHERE g%3<>0 AND g%5=0;

INSERT INTO payments(id,monthly_charge_id,amount,paid_at,is_trashed)
SELECT ${sid('05', '400+g')}, ${sid('04', 'g')}, 40, now()-INTERVAL '3 days', FALSE
FROM generate_series(1,120) g WHERE g%3<>0 AND g%7=0 AND g%5<>0;

-- Scoped users: circle-scoped, teacher-scoped, mixed, and fail-open (no rows).
INSERT INTO app_users(id,username,display_name,password_hash,is_active)
SELECT ${sid('07', 'g')}, '${token}-scope-'||g, '${token} Scope '||g, 'x', TRUE
FROM generate_series(1,3) g;

INSERT INTO app_user_scopes(user_id,scope_type,scope_id) VALUES
 (${sid('07', '1')}, 'circle', ${sid('01', '2')}),
 (${sid('07', '1')}, 'circle', ${sid('01', '3')}),
 (${sid('07', '2')}, 'teacher', (SELECT id FROM teachers WHERE teacher_code='${token}-T01')),
 (${sid('07', '3')}, 'circle', ${sid('01', '4')}),
 (${sid('07', '3')}, 'teacher', (SELECT id FROM teachers WHERE teacher_code='${token}-T02'));

-- Session-summary fixture: six slots in the current month, one attendance per weekday,
-- plus mid-month enrolment start/end edge cases and a trashed live-eligibility enrolment.
INSERT INTO circle_schedule_slots(id,circle_id,day_of_week,starts_at,duration_minutes,is_active)
SELECT ${sid('06', 'g')}, ${sid('01', 'g')}, (g-1)::smallint, TIME '10:00', 60, TRUE
FROM generate_series(1,6) g;

INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,ends_on,agreed_monthly_fee,status,is_trashed)
SELECT ${sid('08', 'g')}, ${sid('02', 'g')},
       ${sid('01', "(CASE g WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 1 WHEN 4 THEN 2 WHEN 5 THEN 6 ELSE 4 END)")},
       (date_trunc('month', CURRENT_DATE) + (g*2) * INTERVAL '1 day')::date,
       CASE WHEN g%7=0 THEN (date_trunc('month', CURRENT_DATE) + INTERVAL '12 days')::date ELSE NULL END,
       50, CASE WHEN g=6 THEN 'paused' ELSE 'active' END, FALSE
FROM generate_series(1,6) g;

INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,ended_at,status,scheduled_duration_minutes,actual_duration_minutes)
SELECT gen_random_uuid(), c.teacher_id, ss.circle_id, ss.id, d.session_date,
       d.session_date::timestamptz + TIME '10:00', d.session_date::timestamptz + TIME '11:00',
       'completed', 60, 60
FROM circle_schedule_slots ss
JOIN circles c ON c.id=ss.circle_id
CROSS JOIN (SELECT (date_trunc('month', CURRENT_DATE)::date + g) AS session_date FROM generate_series(1,27) g) d
WHERE ss.id::text LIKE '00000000-0000-4000-9706-%'
  AND extract(dow FROM d.session_date)::int = ss.day_of_week;

INSERT INTO teacher_attendance(id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount,marked_by,teacher_session_id,actual_duration_minutes,pay_basis)
SELECT gen_random_uuid(), ts.schedule_slot_id, ts.circle_id, ts.teacher_id, ts.session_date, TIME '10:00', 60, 'present', 60, 60,
       ${sid('07', '1')}, ts.id, 60, 'manual'
FROM teacher_sessions ts WHERE ts.schedule_slot_id::text LIKE '00000000-0000-4000-9706-%';

INSERT INTO student_attendance(id,enrollment_id,schedule_slot_id,session_date,status,marked_by)
SELECT gen_random_uuid(), ce.id, ts.schedule_slot_id, ts.session_date,
       CASE WHEN ce.status='active' THEN 'present' ELSE 'absent' END, ${sid('07', '1')}
FROM teacher_sessions ts
JOIN circle_enrollments ce ON ce.circle_id=ts.circle_id AND ce.is_trashed=FALSE
WHERE ts.schedule_slot_id::text LIKE '00000000-0000-4000-9706-%'
  AND ce.id::text LIKE '00000000-0000-4000-9708-%';

INSERT INTO student_attendance(id,enrollment_id,schedule_slot_id,session_date,status,marked_by)
SELECT gen_random_uuid(), ce.id, ts.schedule_slot_id, ts.session_date,
       CASE WHEN ce.status='active' THEN 'present' ELSE 'absent' END, ${sid('07', '1')}
FROM teacher_sessions ts
JOIN circle_enrollments ce ON ce.circle_id=ts.circle_id AND ce.is_trashed=FALSE
WHERE ts.schedule_slot_id::text LIKE '00000000-0000-4000-9706-%'
  AND ts.session_date=(date_trunc('month', CURRENT_DATE)::date + 9)
  AND ce.id::text LIKE '00000000-0000-4000-9703-%';

ANALYZE;`;
}

export function cleanSql(token) {
  // Only this run's rows are removed (safe on a disposable DB; re-runs stay idempotent).
  return `
DELETE FROM student_attendance WHERE enrollment_id IN (SELECT id FROM circle_enrollments WHERE id::text LIKE '00000000-0000-4000-97%');
DELETE FROM teacher_attendance WHERE schedule_slot_id::text LIKE '00000000-0000-4000-9706-%';
DELETE FROM teacher_sessions WHERE schedule_slot_id::text LIKE '00000000-0000-4000-9706-%';
DELETE FROM payments WHERE id::text LIKE '00000000-0000-4000-9705-%';
DELETE FROM monthly_charges WHERE id::text LIKE '00000000-0000-4000-9704-%';
DELETE FROM circle_enrollments WHERE id::text LIKE '00000000-0000-4000-9703-%' OR id::text LIKE '00000000-0000-4000-9708-%';
DELETE FROM circle_schedule_slots WHERE id::text LIKE '00000000-0000-4000-9706-%';
DELETE FROM circles WHERE id::text LIKE '00000000-0000-4000-9701-%';
DELETE FROM teachers WHERE id::text LIKE '00000000-0000-4000-9700-%';
DELETE FROM students WHERE id::text LIKE '00000000-0000-4000-9702-%';
DELETE FROM app_users WHERE id::text LIKE '00000000-0000-4000-9707-%';`;
}
