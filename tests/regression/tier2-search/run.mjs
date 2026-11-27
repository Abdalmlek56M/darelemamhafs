import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { setup, one, q, req, OLD } from '../request-workflow/common.mjs';

// FINAL 2.2: server-side student search (legacy GET /api/students).
//  (a) only matching rows come back, with the pagination total computed from the same filter;
//  (b) a search containing %, _ or \ matches those characters literally (no match-all);
//  (c) the list query's predicate is served by the pg_trgm GIN indexes from migration 040,
//      proved with EXPLAIN (FORMAT JSON) with sequential/plain-index scans disabled so that
//      on this tiny disposable database the planner must reveal the GIN bitmap path;
//  (d) a non-matching search returns an empty result.
// Seeding uses the same one()/SQL style as the other Tier 2 suites.
const c = await setup();

const TOKEN = 'ZZT2SRCH';
const TOKEN_MATCHES = 4;
const WILDCARD_MATCHES = 1;
const allLive = `SELECT count(*) FROM students WHERE is_trashed=FALSE;`;

// Same expressions as backend/DarEltahfeez.Api/Pagination/LegacyStudentList.cs (legacy API)
// and src/Modules/Secretariat/.../Persistence/StudentRepository.cs (modular API).
const legacyContains = pattern => `(s.full_name ILIKE ${pattern}
    OR s.student_code ILIKE ${pattern}
    OR COALESCE(s.phone,'') ILIKE ${pattern}
    OR COALESCE(s.guardian_name,'') ILIKE ${pattern}
    OR COALESCE(s.guardian_phone,'') ILIKE ${pattern})`;
const modularContains = pattern => `(full_name ILIKE ${pattern}
    OR student_code ILIKE ${pattern}
    OR phone ILIKE ${pattern}
    OR guardian_name ILIKE ${pattern}
    OR guardian_phone ILIKE ${pattern})`;
const countMatching = (fields, pattern) =>
  Number(one(`SELECT count(*) FROM students s WHERE s.is_trashed=FALSE AND ${fields(pattern)};`));

// Seeds: four rows match the token through different columns, one control row does not,
// and one row per LIKE wildcard character holds that character literally.
one(`INSERT INTO students(id,student_code,full_name,phone,guardian_name,guardian_phone,status,joined_on) VALUES
  (gen_random_uuid(),'ZZT2SRCH-A','ZZT2SRCH Alpha',NULL,NULL,NULL,'active',DATE '2026-01-01'),
  (gen_random_uuid(),'ZZT2SRCH-B','Bravo Student','0100ZZT2SRCH2','Guardian Bravo',NULL,'active',DATE '2026-01-01'),
  (gen_random_uuid(),'ZZT2SRCH-C','Charlie Student',NULL,'ZZT2SRCH Guardian',NULL,'active',DATE '2026-01-01'),
  (gen_random_uuid(),'ZZT2SRCH-D','Delta Student',NULL,NULL,'0110ZZT2SRCH4','active',DATE '2026-01-01'),
  (gen_random_uuid(),'ZZT2-PLAIN','Plain Control Student',NULL,NULL,NULL,'active',DATE '2026-01-01');`);
one(`INSERT INTO students(id,student_code,full_name,phone,guardian_name,guardian_phone,status,joined_on) VALUES
  (gen_random_uuid(),'ZZT2-PCT','ZZT2 Percent%Literal',NULL,NULL,NULL,'active',DATE '2026-01-01'),
  (gen_random_uuid(),'ZZT2-UND','ZZT2 Under_score',NULL,NULL,NULL,'active',DATE '2026-01-01'),
  (gen_random_uuid(),'ZZT2-BSL','ZZT2 Back' || chr(92) || 'slash',NULL,NULL,NULL,'active',DATE '2026-01-01');`);
one('ANALYZE students;');

const studentFields = ['fullName', 'studentCode', 'phone', 'guardianName', 'guardianPhone'];
const matches = (row, term) => studentFields.some(field =>
  String(row[field] ?? '').toLowerCase().includes(term.toLowerCase()));
async function listStudents(query) {
  const response = await fetch(OLD + '/api/students' + query, { headers: { cookie: c.admin } });
  const text = await response.text();
  let rows = [];
  try { rows = JSON.parse(text); } catch { /* assert below reports the body */ }
  assert.equal(response.status, 200, 'GET /api/students' + query + ' -> ' + response.status + ' ' + text.slice(0, 200));
  assert.ok(Array.isArray(rows), 'legacy student list is not an array: ' + text.slice(0, 200));
  return {
    total: Number(response.headers.get('X-Total-Count')),
    page: response.headers.get('X-Page'),
    pageSize: response.headers.get('X-Page-Size'),
    rows
  };
}

// (a) Confirmation with token: only matching rows, paginated, and the total is the filtered total.
const liveStudents = Number(one(allLive));
const tokenTotal = countMatching(legacyContains, q(`%${TOKEN}%`));
assert.equal(tokenTotal, TOKEN_MATCHES, 'seeded token rows');
assert.ok(tokenTotal < liveStudents, 'token search must not return every student');
const first = await listStudents(`?search=${encodeURIComponent(TOKEN)}&page=1&pageSize=2`);
assert.equal(first.total, tokenTotal, 'X-Total-Count must be the filtered total');
assert.equal(first.page, '1');
assert.equal(first.pageSize, '2');
assert.equal(first.rows.length, 2, 'page 1 length');
for (const row of first.rows) assert.ok(matches(row, TOKEN), 'non-matching row on page 1: ' + JSON.stringify(row));
const second = await listStudents(`?search=${encodeURIComponent(TOKEN)}&page=2&pageSize=2`);
assert.equal(second.total, tokenTotal, 'page 2 total must stay the filtered total');
assert.equal(second.rows.length, 2, 'page 2 length');
for (const row of second.rows) assert.ok(matches(row, TOKEN), 'non-matching row on page 2: ' + JSON.stringify(row));
assert.deepEqual(second.rows.map(row => row.id).filter(id => first.rows.some(row => row.id === id)), [],
  'pages must not overlap');
// Page past the end still reports the filtered total (LegacyTotalAsync re-runs the same filter).
const third = await listStudents(`?search=${encodeURIComponent(TOKEN)}&page=3&pageSize=2`);
assert.equal(third.rows.length, 0, 'page 3 must be empty');
assert.equal(third.total, tokenTotal, 'empty page total must still be the filtered total');
// Case-insensitive contains.
const lower = await listStudents(`?search=${encodeURIComponent(TOKEN.toLowerCase())}&page=1&pageSize=25`);
assert.equal(lower.total, tokenTotal, 'search must be case-insensitive');
assert.equal(lower.rows.length, tokenTotal, 'case-insensitive search row count');

// (b) LIKE wildcards are escaped: they match literally instead of matching everything.
const escapeLike = term => term.replace(/[\\%_]/g, character => '\\' + character);
for (const [label, term] of [['percent', '%'], ['underscore', '_'], ['backslash', '\\']]) {
  const pattern = '%' + escapeLike(term) + '%';
  const expected = countMatching(legacyContains, q(pattern));
  assert.equal(expected, WILDCARD_MATCHES, label + ' literal match count');
  assert.ok(expected < liveStudents, label + ' search must not be a match-all');
  const result = await listStudents(`?search=${encodeURIComponent(term)}&page=1&pageSize=100`);
  assert.equal(result.total, expected, label + ' search total');
  assert.equal(result.rows.length, expected, label + ' search rows');
  for (const row of result.rows) {
    assert.ok(matches(row, term), label + ' search returned a row without the literal character: ' + JSON.stringify(row));
  }
}

// (d) A non-matching search returns no rows (and does not fall back to the full list).
const empty = await req(OLD, c.admin, 'GET', `/api/students?search=${encodeURIComponent(TOKEN + 'NOMATCH')}`);
assert.equal(empty.status, 200, 'non-matching search status ' + empty.text.slice(0, 200));
assert.deepEqual(JSON.parse(empty.text), [], 'non-matching search must return an empty array');

// (c) EXPLAIN proof: the list predicate is served by the migration-040 pg_trgm GIN indexes.
assert.equal(one("SELECT count(*) FROM pg_extension WHERE extname='pg_trgm';"), '1',
  'pg_trgm extension is not installed (migration 040 missing)');
const trigramIndexes = [
  'ix_students_trgm_full_name',
  'ix_students_trgm_student_code',
  'ix_students_trgm_phone_coalesce',
  'ix_students_trgm_guardian_name_coalesce',
  'ix_students_trgm_guardian_phone_coalesce',
  'ix_students_trgm_phone',
  'ix_students_trgm_guardian_name',
  'ix_students_trgm_guardian_phone'
];
const trigramIndexList = trigramIndexes.map(q).join(',');
assert.equal(one(`SELECT count(*) FROM pg_indexes WHERE schemaname='public'
  AND indexname IN (${trigramIndexList}) AND indexdef ILIKE '%USING gin%' AND indexdef LIKE '%gin_trgm_ops%';`),
  String(trigramIndexes.length),
  'missing trigram indexes (is database/040_search_trgm.sql applied to the disposable DB?): ' + trigramIndexes.join(', '));

// Re-running the migration on the migrated schema must be a harmless no-op.
const migrationPath = new URL('../../../database/040_search_trgm.sql', import.meta.url);
one(readFileSync(migrationPath, 'utf8'));
assert.equal(one(`SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN (${trigramIndexList});`),
  String(trigramIndexes.length), 'migration 040 is not idempotent');

// The predicate/order/window-total text mirrors LegacyStudentList.cs; only the per-row
// finance subqueries are omitted because they are projection-only and cannot change the
// scan chosen for the WHERE clause.
const explainPrefix = 'SET enable_seqscan = off; SET enable_indexscan = off; SET enable_indexonlyscan = off; EXPLAIN (FORMAT JSON) ';
const tokenPattern = q(`%${TOKEN}%`);
const legacyListQuery = `
  SELECT s.id, s.student_code, s.full_name, s.phone, s.guardian_name, s.guardian_phone, s.status,
         COUNT(*) OVER() AS total
  FROM students s
  WHERE s.is_trashed=FALSE AND ${legacyContains(tokenPattern)}
  ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'withdrawn' THEN 2 ELSE 3 END,
           s.full_name, s.id;`;
const legacyPlan = one(explainPrefix + legacyListQuery);
assert.match(legacyPlan, /"Node Type": "Bitmap(Or| Index Scan)"/, 'legacy plan is not a bitmap index plan:\n' + legacyPlan);
for (const index of trigramIndexes.slice(0, 5)) {
  assert.ok(legacyPlan.includes(index), 'legacy list plan does not use ' + index + ':\n' + legacyPlan);
}
// Modular Secretariat list uses the bare nullable columns, so migration 040 indexes those too.
const modularListQuery = `
  SELECT id, full_name, COUNT(*) OVER() AS total
  FROM students
  WHERE is_trashed=FALSE AND ${modularContains(tokenPattern)}
  ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'withdrawn' THEN 2 ELSE 3 END,
           full_name, id;`;
const modularPlan = one(explainPrefix + modularListQuery);
assert.match(modularPlan, /"Node Type": "Bitmap(Or| Index Scan)"/, 'modular plan is not a bitmap index plan:\n' + modularPlan);
for (const index of trigramIndexes.slice(5)) {
  assert.ok(modularPlan.includes(index), 'modular list plan does not use ' + index + ':\n' + modularPlan);
}

console.log(JSON.stringify({ suite: 'tier2-search', ok: true, cases: 8, indexes: trigramIndexes.length }));
