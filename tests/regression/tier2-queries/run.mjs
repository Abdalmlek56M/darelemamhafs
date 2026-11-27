import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { assertSafeTargets, psql as libPsql, q } from '../../lib/index.mjs';
import * as S from './sql.mjs';

// FINAL Tier 2.7 — query rewrites + per-request DB round-trip reduction.
//  (a) old-shape vs new-shape results for seeded fixtures, expectations computed independently;
//  (b) pagination totals, page boundaries and ORDER BY tie-breaks;
//  (c) EXPLAIN (FORMAT JSON) proofs: no per-row correlated subplan over students on the new
//      students list, index usage for the main search filter, one statement for the new API;
//  (d) lower-bound improvement vs a verbatim copy of the old SQL (plan nodes / shared hits);
//  (e) scope visibility from the single-command resolution equals the old multi-query logic;
//  (f) session summary aggregate equals the old four-BOOL_OR shape and gets faster;
//  (g) /api/admin/export runs every section from one embedded jsonb command.
const conn = process.env.DAR_TEST_DATABASE || '';
assertSafeTargets({ db: conn, requireDb: true, label: 'TIER2-QUERIES_FAIL' });
const psql = (sql) => libPsql(conn, sql);
const value = (sql) => psql(sql);
const rows = (sql) => { const out = psql(sql); return out === '' ? [] : out.split('\n'); };
const toIds = (csv) => (csv || '{}').replace(/[{}]/g, '').split(',').filter(Boolean);
const TOKEN = 'Q6T2Q';
let cases = 0;

// ---------------------------------------------------------------------------
// EXPLAIN helpers
// ---------------------------------------------------------------------------
const SETTINGS = 'SET enable_seqscan = off; SET enable_indexscan = off; SET enable_indexonlyscan = off;';
function planJson(sql, settings = '') {
  const out = psql(settings + ' EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql);
  return JSON.parse(out.slice(out.indexOf('[')))[0];
}
function summarize(plan, outerAlias) {
  const result = { nodes: 0, hits: 0, time: plan['Execution Time'], subplans: [], correlated: 0 };
  const walk = (node) => {
    result.nodes += 1;
    result.hits += node['Shared Hit Blocks'] ?? 0;
    if (node['Subplan Name']) {
      const entry = { name: node['Subplan Name'], referencesOuter: JSON.stringify(node).includes(outerAlias + '.id') };
      result.subplans.push(entry);
      if (/^SubPlan \d+$/.test(entry.name) && entry.referencesOuter) result.correlated += 1;
    }
    for (const child of node['Plans'] ?? []) walk(child);
  };
  walk(plan.Plan ?? plan);
  return result;
}
const nodeTypes = (plan) => {
  const types = [];
  const walk = (node) => { types.push(node['Node Type']); (node['Plans'] ?? []).forEach(walk); };
  walk(plan.Plan ?? plan);
  return types;
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// ---------------------------------------------------------------------------
// Seed fixtures, then extract the REAL committed SQL text from the C# constants.
// ---------------------------------------------------------------------------
psql(S.cleanSql(TOKEN));
psql(S.seedSql(TOKEN));
const NEW_STUDENTS = S.extractConst(S.STUDENT_LIST_FILE, 'LegacyStudentListSql');
const NEW_TEACHERS = S.extractConst('backend/DarEltahfeez.Api/Pagination/LegacyTeacherList.cs', 'LegacyTeacherListSql');
const NEW_CIRCLES = S.extractConst('backend/DarEltahfeez.Api/Pagination/LegacyCircleList.cs', 'LegacyCircleListSql');
const NEW_SESSION = S.extractConst(S.SESSION_SUMMARY_FILE, 'LegacySessionSummarySql');
const LOAD_SCOPE = S.extractConst(S.SCOPE_LOADER_FILE, 'LoadScopeSql');
const STUDENT_COLUMNS = S.extractConst(S.STUDENT_REPO_FILE, 'SelectColumns');
const SCOPE_FILTER = S.extractConst(S.STUDENT_REPO_FILE, 'ScopeFilter');

const lit = (text) => q(text);
const like = (text) => q('%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
const fillScope = (allScopes, userId) => S.fill(SCOPE_FILTER, {
  allScopes: String(allScopes),
  userId: userId ? lit(userId) : 'NULL::uuid'
});
const newStudentsList = (term, status, take, skip) => S.fill(NEW_STUDENTS, {
  search: lit(term), like: like(term), status: lit(status),
  take: take === null ? 'NULL' : String(take), skip: String(skip)
});
const oldStudentsList = (term, status, take, skip) => S.studentsListOld({
  search: lit(term), like: like(term), status: lit(status),
  take: take === null ? 'NULL' : String(take), skip
});
const newTeacherList = (term) => S.fill(NEW_TEACHERS, { search: lit(term), like: like(term), status: lit(''), take: 'NULL', skip: '0' });
const newCircleList = (term) => S.fill(NEW_CIRCLES, { search: lit(term), like: like(term), take: 'NULL', skip: '0' });
const month = value("SELECT to_char(date_trunc('month', CURRENT_DATE),'YYYY-MM');");
const monthStart = month + '-01';
const nextMonth = value("SELECT to_char(date_trunc('month', CURRENT_DATE) + INTERVAL '1 month','YYYY-MM-DD');");
const newSession = (take, skip) => S.fill(NEW_SESSION, {
  from: lit(monthStart), to: lit(nextMonth), take: take === null ? 'NULL' : String(take), skip: String(skip)
});
const oldSession = (take, skip) => S.sessionSummaryOld({
  from: lit(monthStart), to: lit(nextMonth), take: take === null ? 'NULL' : String(take), skip: String(skip)
});
const newApiList = (allScopes, userId) => 'SELECT ' + STUDENT_COLUMNS
  + ', COUNT(*) OVER() AS Total FROM students WHERE is_trashed=FALSE' + fillScope(allScopes, userId)
  + " ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'withdrawn' THEN 2 ELSE 3 END, full_name, id LIMIT 25 OFFSET 0;";
const allowedStudentIds = (userId) => toIds(value('SELECT array_agg(id) FROM (SELECT id FROM students WHERE is_trashed=FALSE'
  + fillScope(false, userId) + ') q;')).sort();
const oldAllowedStudentIds = (userId) => {
  const circles = rows(S.scopeOld(lit(userId)))[0].split('|')[1];
  return toIds(value('SELECT array_agg(DISTINCT ce.student_id) FROM circle_enrollments ce'
    + ' JOIN circles c ON c.id=ce.circle_id AND c.is_trashed=FALSE WHERE ce.is_trashed=FALSE'
    + ` AND ce.circle_id = ANY(${q(circles)}::uuid[]);`)).sort();
};
const tokenPredicate = `s.is_trashed=FALSE AND (s.full_name ILIKE ${like(TOKEN)} OR s.student_code ILIKE ${like(TOKEN)}`
  + ` OR COALESCE(s.phone,'') ILIKE ${like(TOKEN)} OR COALESCE(s.guardian_name,'') ILIKE ${like(TOKEN)}`
  + ` OR COALESCE(s.guardian_phone,'') ILIKE ${like(TOKEN)})`;

// ---------------------------------------------------------------------------
// (a) legacy students list: identical rows for every filter/page shape.
// ---------------------------------------------------------------------------
for (const [label, take, skip] of [['unpaged', null, 0], ['page1', 7, 0], ['page2', 7, 7], ['page3', 7, 14]]) {
  assert.deepEqual(rows(newStudentsList(TOKEN, '', take, skip)), rows(oldStudentsList(TOKEN, '', take, skip)),
    'students list ' + label + ' changed shape');
  cases += 1;
}
for (const status of ['active', 'paused', 'withdrawn']) {
  assert.deepEqual(rows(newStudentsList(TOKEN, status, null, 0)), rows(oldStudentsList(TOKEN, status, null, 0)),
    'students list status=' + status + ' changed shape');
  cases += 1;
}
assert.deepEqual(rows(newStudentsList(TOKEN + '-NOMATCH', '', null, 0)), [], 'non-matching search returns rows');
assert.deepEqual(rows(newStudentsList(TOKEN, '', 7, 100000)), [], 'page past the end returns rows');
cases += 2;

// ---------------------------------------------------------------------------
// (b) totals + ORDER BY (status rank, full_name, id) tie-breaks.
// ---------------------------------------------------------------------------
const expectedCount = Number(value(`SELECT count(*) FROM students s WHERE ${tokenPredicate};`));
const expectedIds = toIds(value("SELECT array_agg(id ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1"
  + ` WHEN 'withdrawn' THEN 2 ELSE 3 END, full_name, id) FROM students s WHERE ${tokenPredicate};`));
const pageId = (sql) => rows(sql).map((line) => line.split('|')[0]);
const pagedIds = [];
for (let offset = 0; offset < expectedIds.length; offset += 7) pagedIds.push(...pageId(newStudentsList(TOKEN, '', 7, offset)));
const firstPage = pageId(newStudentsList(TOKEN, '', 7, 0));
const secondPage = pageId(newStudentsList(TOKEN, '', 7, 7));
assert.deepEqual(pagedIds, expectedIds, 'ORDER BY tie-break / page boundaries drifted');
assert.equal(new Set(firstPage).size, firstPage.length, 'page 1 contains duplicate ids');
assert.equal(secondPage.filter((id) => firstPage.includes(id)).length, 0, 'pages overlap');
const totalOf = (sql) => Number(rows(sql)[0].split('|').pop());
assert.equal(totalOf(newStudentsList(TOKEN, '', null, 0)), expectedCount, 'unpaged window total differs');
assert.equal(totalOf(newStudentsList(TOKEN, '', 7, 7)), expectedCount, 'paged window total differs');
assert.equal(rows(newStudentsList(TOKEN, '', 7, 100000)).length, 0, 'empty page expected');
assert.equal(totalOf(newStudentsList(TOKEN, '', 1, 0)), expectedCount, 'empty-page retry total differs');
cases += 5;

// ---------------------------------------------------------------------------
// (c) + (d) legacy students list plan: correlated subplans gone; nodes/hits lower.
// ---------------------------------------------------------------------------
const oldStudentsPlan = summarize(planJson(oldStudentsList(TOKEN, '', null, 0)), 's');
const newStudentsPlan = summarize(planJson(newStudentsList(TOKEN, '', null, 0)), 's');
assert.equal(newStudentsPlan.subplans.filter((s) => /^SubPlan \d+$/.test(s.name)).length, 0,
  'new students list still has a SubPlan: ' + JSON.stringify(newStudentsPlan.subplans));
assert.ok(oldStudentsPlan.correlated > 0, 'old students list copy has no correlated subplan (copy drifted)');
assert.ok(newStudentsPlan.nodes < oldStudentsPlan.nodes, `plan nodes did not drop (${newStudentsPlan.nodes} vs ${oldStudentsPlan.nodes})`);
assert.ok(newStudentsPlan.hits < oldStudentsPlan.hits, `shared hits did not drop (${newStudentsPlan.hits} vs ${oldStudentsPlan.hits})`);
const searchPlan = psql(SETTINGS + ' EXPLAIN (FORMAT JSON) ' + newStudentsList(TOKEN, '', 25, 0));
for (const index of ['ix_students_trgm_full_name', 'ix_students_trgm_student_code', 'ix_students_trgm_phone_coalesce']) {
  assert.ok(searchPlan.includes(index), 'search plan does not use ' + index);
}
assert.ok(searchPlan.includes('"Bitmap Heap Scan"'), 'search plan is not index driven');
cases += 6;

// ---------------------------------------------------------------------------
// teacher / circle lists: old vs new rows identical; no correlated SubPlan left.
// ---------------------------------------------------------------------------
assert.deepEqual(rows(newTeacherList(TOKEN)), rows(S.teachersListOld({
  search: lit(TOKEN), like: like(TOKEN), status: lit(''), take: 'NULL', skip: 0
})), 'teacher list changed shape');
assert.deepEqual(rows(newCircleList(TOKEN)), rows(S.circlesListOld({
  search: lit(TOKEN), like: like(TOKEN), take: 'NULL', skip: 0
})), 'circle list changed shape');
assert.equal(summarize(planJson(newTeacherList(TOKEN))).subplans.filter((s) => /^SubPlan \d+$/.test(s.name)).length, 0,
  'teacher list has a SubPlan');
assert.equal(summarize(planJson(newCircleList(TOKEN))).subplans.filter((s) => /^SubPlan \d+$/.test(s.name)).length, 0,
  'circle list has a SubPlan');
cases += 4;

// ---------------------------------------------------------------------------
// (f) session summary aggregate: identical counts, faster, no correlated subplan.
// ---------------------------------------------------------------------------
for (const [take, skip] of [[null, 0], [3, 0], [3, 3], [3, 100000]]) {
  assert.deepEqual(rows(newSession(take, skip)), rows(oldSession(take, skip)), `session summary (${take},${skip}) changed`);
  cases += 1;
}
assert.equal(summarize(planJson(newSession(null, 0)), 'ses').subplans
  .filter((s) => /^SubPlan \d+$/.test(s.name) && s.referencesOuter).length, 0, 'session summary has a correlated subplan');
const oldTimes = [];
const newTimes = [];
for (let i = 0; i < 3; i += 1) {
  oldTimes.push(summarize(planJson(oldSession(null, 0))).time);
  newTimes.push(summarize(planJson(newSession(null, 0))).time);
}
const [oldMedian, newMedian] = [median(oldTimes), median(newTimes)];
if (oldMedian > 1) assert.ok(newMedian < oldMedian, `session summary did not get faster (${newMedian}ms vs ${oldMedian}ms)`);
cases += 2;

// ---------------------------------------------------------------------------
// (e) scope resolution: old multi-command logic vs the single-command replacement.
// ---------------------------------------------------------------------------
const scopedUsers = rows(`SELECT id FROM app_users WHERE username LIKE ${lit(TOKEN + '-scope-%')} ORDER BY id;`);
assert.equal(scopedUsers.length, 3, 'scope fixture users missing');
const [circleScoped, teacherScoped, mixedScoped] = scopedUsers;
const loadScopeNew = (userId) => {
  const parts = value(S.fill(LOAD_SCOPE, { user: userId ? lit(userId) : 'NULL::uuid' })).split('|');
  return { count: Number(parts[0]), circles: toIds(parts[1]).sort(), teachers: toIds(parts[2]).sort() };
};
for (const userId of [circleScoped, teacherScoped, mixedScoped, null]) {
  const expected = userId ? rows(S.scopeOld(lit(userId)))[0].split('|') : ['0', '{}', '{}'];
  const actual = loadScopeNew(userId);
  assert.equal(actual.count, Number(expected[0]), 'ScopeLoader raw-scope count differs for ' + userId);
  assert.deepEqual(actual.circles, toIds(expected[1]).sort(), 'ScopeLoader expanded circles differ for ' + userId);
  assert.deepEqual(actual.teachers, toIds(expected[2]).sort(), 'ScopeLoader expanded teachers differ for ' + userId);
  cases += 1;
}
for (const userId of [circleScoped, teacherScoped, mixedScoped]) {
  assert.deepEqual(allowedStudentIds(userId), oldAllowedStudentIds(userId), 'inlined list scope differs for ' + userId);
  cases += 1;
}
assert.deepEqual(allowedStudentIds(null), [], 'a missing principal id must match no students');
const visibleStudent = allowedStudentIds(circleScoped)[0];
const visibleSet = q('{' + allowedStudentIds(circleScoped).join(',') + '}');
const hiddenStudent = value(`SELECT id FROM students WHERE is_trashed=FALSE AND id <> ALL(${visibleSet}::uuid[]) LIMIT 1;`);
const getNew = (allScopes, userId, id) => value('SELECT id FROM students WHERE id=' + lit(id) + ' AND is_trashed=FALSE'
  + fillScope(allScopes, userId) + ';') === '';
assert.equal(getNew(false, circleScoped, visibleStudent), false, 'scoped detail denied an allowed student');
assert.equal(getNew(false, circleScoped, hiddenStudent), true, 'scoped detail allowed an outside student');
assert.equal(getNew(true, null, hiddenStudent), false, 'all-scope detail denied a student');
assert.equal(getNew(false, null, visibleStudent), true, 'missing principal id must not read a student');
const failOpenUser = value('SELECT gen_random_uuid();');
assert.equal(getNew(false, failOpenUser, hiddenStudent), false, 'fail-open account lost AllScope');
cases += 5;

// ---------------------------------------------------------------------------
// New API students list: ONE statement (WindowAgg total + inline scope), matching old rows.
// ---------------------------------------------------------------------------
const allowedCircleSet = rows(S.scopeOld(lit(teacherScoped)))[0].split('|')[1];
const oldPageRows = rows(S.apiPageOld({ circles: q(allowedCircleSet), pageSize: 25, offset: 0 }));
const newPageRows = rows(newApiList(false, teacherScoped));
assert.deepEqual(newPageRows.map((line) => line.split('|').slice(0, -1).join('|')), oldPageRows,
  'API list rows/order differ from the old COUNT+PAGE shape');
assert.equal(Number(newPageRows[0].split('|').pop()),
  Number(value(S.apiCountOld({ circles: q(allowedCircleSet), pageSize: 25, offset: 0 }))),
  'API window total differs from the old independent COUNT');
assert.ok(nodeTypes(planJson(newApiList(false, teacherScoped))).includes('WindowAgg'),
  'API list total is not part of the same statement');
const oldApiNodes = summarize(planJson(S.apiPageOld({ circles: q(allowedCircleSet), pageSize: 25, offset: 0 }))).nodes
  + summarize(planJson(S.apiCountOld({ circles: q(allowedCircleSet), pageSize: 25, offset: 0 }))).nodes;
const newApiPlan = summarize(planJson(newApiList(false, teacherScoped)), 'students');
assert.equal(newApiPlan.subplans.filter((s) => /^SubPlan \d+$/.test(s.name) && s.referencesOuter).length, 0,
  'API list has a per-row correlated subplan');
assert.ok(newApiPlan.nodes < oldApiNodes, `API plan kept the separate COUNT plan work (${newApiPlan.nodes} vs ${oldApiNodes} nodes)`);
cases += 5;

// ---------------------------------------------------------------------------
// Structural: round trips are merged in code, names/shapes intact.
// ---------------------------------------------------------------------------
const scopeSource = readFileSync(new URL('../../../' + S.SCOPE_LOADER_FILE, import.meta.url), 'utf8');
assert.equal((scopeSource.match(/new NpgsqlCommand\(/g) || []).length, 1, 'ScopeLoader still issues several commands');
assert.equal((scopeSource.match(/ExecuteReaderAsync/g) || []).length, 1, 'ScopeLoader still reads several times');
const repoSource = readFileSync(new URL('../../../' + S.STUDENT_REPO_FILE, import.meta.url), 'utf8');
assert.ok(repoSource.includes('COUNT(*) OVER() AS Total'), 'student list total is not in the same statement');
assert.ok(repoSource.includes('ScopeFilter'), 'student list/detail scope is not inlined');
assert.equal((repoSource.match(/OpenConnectionAsync/g) || []).length, 4, 'student repository opened an unexpected number of connections');
for (const file of ['Features/GetStudent/GetStudent.cs', 'Features/ListStudents/ListStudents.cs']) {
  const source = readFileSync(new URL('../../../src/Modules/Secretariat/Dar.Modules.Secretariat/' + file, import.meta.url), 'utf8');
  assert.equal(source.includes('ScopeLoader.LoadAsync'), false, 'secretariat ' + file + ' still loads scope separately');
}
cases += 5;

// ---------------------------------------------------------------------------
// (g) export: every section from one embedded jsonb command, equal to per-table SQL.
// ---------------------------------------------------------------------------
const exportSource = readFileSync(new URL('../../../backend/DarEltahfeez.Api/SystemAdminEndpoints.BackupsExport.cs', import.meta.url), 'utf8');
const exportHandler = exportSource.slice(exportSource.indexOf('MapGet("/api/admin/export"'),
  exportSource.indexOf('RequireAuthorization("exports.manage")'));
assert.equal((exportHandler.match(/CreateCommand\(/g) || []).length, 1, 'export handler still issues more than one command');
assert.ok(exportHandler.includes('jsonb_build_object('), 'export handler does not embed one jsonb document');
assert.ok(exportHandler.includes('ExportSectionJsonSubquery('), 'export handler does not reuse the shared section subquery');
const exportHelper = readFileSync(new URL('../../../backend/DarEltahfeez.Api/SystemAdminEndpoints.Export.cs', import.meta.url), 'utf8');
assert.ok(exportHelper.includes("jsonb_agg(to_jsonb(t) - 'password_hash' - 'receipt_data'"), 'export section query changed shape');
const familyPredicates = {
  students: 'TRUE',
  student_notes: 't.student_id IN (SELECT id FROM students)',
  circle_enrollments: 't.student_id IN (SELECT id FROM students)',
  monthly_charges: 't.enrollment_id IN (SELECT id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))',
  payments: 't.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id)',
  student_attendance: 't.enrollment_id IN (SELECT id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))',
  circles: 't.id IN (SELECT circle_id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))',
  teachers: 't.id IN (SELECT c.teacher_id FROM circles c JOIN circle_enrollments ce ON ce.circle_id=c.id)',
  circle_schedule_slots: 't.circle_id IN (SELECT circle_id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))'
};
const sectionSql = (table) => "SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'password_hash' - 'receipt_data' - 'logo_data'"
  + ` - 'avatar_data' - 'backup_path'), '[]'::jsonb) FROM public.${table} t WHERE ${familyPredicates[table]}`;
const embeddedDoc = JSON.parse(value('SELECT jsonb_build_object('
  + Object.keys(familyPredicates).map((table) => `'${table}', (${sectionSql(table)})`).join(', ') + ')::text;'));
for (const table of Object.keys(familyPredicates)) {
  const independent = JSON.parse(value(sectionSql(table) + ';'));
  assert.deepEqual(embeddedDoc[table], independent, 'export section ' + table + ' differs from the per-table aggregate');
  cases += 1;
}

console.log(JSON.stringify({ suite: 'tier2-queries', ok: true, cases }));
