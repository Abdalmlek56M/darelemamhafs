import { writeFileSync } from 'node:fs'
import { psql, q } from './db.mjs'
import { reviewCases, adjustCase, notComparable } from './cases.mjs'
import { seedReviewFixture, readReviewState, seedAdjustFixture, readAdjustState } from './fixtures.mjs'
import { compareReview, compareAdjust, summarize } from './compare.mjs'
import { renderReport } from './report.mjs'

const CONN = process.env.DAR_TEST_DATABASE || ''
const LEGACY = process.env.Q3_LEGACY_URL || ''
const NEW_API = process.env.Q3_NEW_URL || ''
const SETUP_TOKEN = process.env.Q3_SETUP_TOKEN || ''
const PASSWORD = process.env.Q3_PASSWORD || 'Q3-StrongPass!'
const REPORT_PATH = process.env.Q3_REPORT_PATH || 'parity-report.md'
const COMMIT = process.env.Q3_COMMIT || 'unknown'
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171']
const dbHost = /host\s*=\s*([^;]+)/i.exec(CONN)?.[1]?.trim().toLowerCase() || ''
if (PROD_HOSTS.includes(dbHost)) { console.error('Q3_FAIL refusing production database host'); process.exit(2) }

if (!CONN || !LEGACY || !NEW_API || !SETUP_TOKEN) {
  console.error('Q3_FAIL missing DAR_TEST_DATABASE/Q3_LEGACY_URL/Q3_NEW_URL/Q3_SETUP_TOKEN')
  process.exit(2)
}
for (const [label, value] of [['database', CONN], ['legacy', LEGACY], ['new', NEW_API]]) {
  if (label === 'database' && /database\s*=\s*dareltahfeez/i.test(value)) {
    console.error('Q3_FAIL refusing production database'); process.exit(2)
  }
  if (label !== 'database') {
    let url
    try { url = new URL(value) } catch { console.error('Q3_FAIL invalid URL'); process.exit(2) }
    const host = url.hostname.toLowerCase()
    if (PROD_HOSTS.includes(host) || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
      console.error('Q3_FAIL refusing production/non-loopback URL'); process.exit(2)
    }
  }
}

async function login(base, path, username) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) })
  const text = await response.text()
  if (!response.ok) throw new Error('login ' + username + ' ' + response.status + ': ' + text.slice(0, 160))
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')]
  return cookies.filter(Boolean).map(value => value.split(';')[0]).join('; ')
}

async function request(base, cookie, method, path, body) {
  const response = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie }, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: response.status, text, json }
}

async function createUser(adminCookie, username, permissions) {
  const response = await request(LEGACY, adminCookie, 'POST', '/api/admin/users', { username, displayName: username, password: PASSWORD, permissionCodes: permissions })
  if (![201, 409].includes(response.status)) throw new Error('create ' + username + ' failed ' + response.status + ': ' + response.text.slice(0, 160))
  return psql(CONN, "SELECT id FROM app_users WHERE username=" + q(username) + ';')
}

try {
  const setup = await fetch(LEGACY + '/api/setup/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Setup-Token': SETUP_TOKEN }, body: JSON.stringify({ username: 'q3_admin', displayName: 'Q3 Admin', password: PASSWORD }) })
  if (![200, 409].includes(setup.status)) throw new Error('setup failed ' + setup.status)
  const adminCookie = await login(LEGACY, '/api/auth/login', 'q3_admin')
  const reviewerPerms = ['attendance.read', 'attendance.edit', 'supervisor.portal', 'supervisor.attendance.requests', 'supervisor.attendance.correct', 'finance.read']
  const allId = await createUser(adminCookie, 'q3_all', reviewerPerms)
  const scopedId = await createUser(adminCookie, 'q3_scoped', reviewerPerms)
  psql(CONN, "INSERT INTO teachers(id,teacher_code,full_name,status,hourly_rate) VALUES ('00000000-0000-4000-8000-000000000003','Q3-DUMMY','Q3 Dummy','active',60) ON CONFLICT DO NOTHING;")
  psql(CONN, "INSERT INTO circles(id,circle_code,name,teacher_id,monthly_fee,is_active,starts_on) VALUES ('00000000-0000-4000-8000-000000000004','Q3-DUMMY-C','Q3 Dummy Circle','00000000-0000-4000-8000-000000000003',0,TRUE,DATE '2026-01-01') ON CONFLICT DO NOTHING;")
  psql(CONN, "INSERT INTO app_user_scopes(user_id,scope_type,scope_id) VALUES (" + q(scopedId) + ",'circle','00000000-0000-4000-8000-000000000004') ON CONFLICT DO NOTHING;")
  const legacyAll = await login(LEGACY, '/api/auth/login', 'q3_all')
  const newAll = await login(NEW_API, '/api/v1/auth/password', 'q3_all')
  const legacyScoped = await login(LEGACY, '/api/auth/login', 'q3_scoped')
  const newScoped = await login(NEW_API, '/api/v1/auth/password', 'q3_scoped')

  const results = []
  for (const testCase of reviewCases) {
    const legacyIds = seedReviewFixture(CONN, testCase, 'legacy', allId)
    const newIds = seedReviewFixture(CONN, testCase, 'new', allId)
    const legacyCookie = testCase.scope === 'outside' ? legacyScoped : legacyAll
    const newCookie = testCase.scope === 'outside' ? newScoped : newAll
    const legacy = await request(LEGACY, legacyCookie, 'POST', '/api/admin/requests/' + legacyIds.request + '/review', { approve: testCase.approve, note: 'Q3 fixture' })
    const current = await request(NEW_API, newCookie, 'POST', '/api/v1/supervisor/requests/' + newIds.request + '/review', { approve: testCase.approve, note: 'Q3 fixture' })
    const legacyState = readReviewState(CONN, legacyIds, testCase.date)
    const newState = readReviewState(CONN, newIds, testCase.date)
    results.push(compareReview(testCase, { status: legacy.status, json: legacy.json, state: legacyState }, { status: current.status, json: current.json, state: newState }))
  }

  const legacyAdjustIds = seedAdjustFixture(CONN, adjustCase, 'legacy', allId)
  const newAdjustIds = seedAdjustFixture(CONN, adjustCase, 'new', allId)
  const legacyAdjust = await request(LEGACY, legacyAll, 'PUT', '/api/teacher-attendance/' + legacyAdjustIds.attendance + '/duration', { durationMinutes: 30 })
  const newAdjust = await request(NEW_API, newAll, 'POST', '/api/v1/supervisor/attendance/' + newAdjustIds.attendance + '/adjust', { payableDurationMinutes: 30, note: 'Q3 direct adjust' })
  results.push(compareAdjust(adjustCase, { status: legacyAdjust.status, state: readAdjustState(CONN, legacyAdjustIds.attendance) }, { status: newAdjust.status, state: readAdjustState(CONN, newAdjustIds.attendance) }))

  const summary = summarize(results)
  const report = renderReport({
    summary, gaps: notComparable,
    metadata: { commit: COMMIT, generatedAt: new Date().toISOString(), database: 'disposable' },
    untested: ['payments/void (new endpoint does not exist)', 'payroll lock/unlock (new endpoint does not exist)', 'concurrent/race scenarios', 'production data']
  })
  writeFileSync(REPORT_PATH, report)
  console.log(JSON.stringify({ scenarioCount: summary.scenarios, passed: summary.passed, mismatches: summary.mismatches, knownDifferences: summary.knownDifferences, results: summary.results, gaps: notComparable }, null, 2))
  console.log('Q3_DONE report=' + REPORT_PATH)
} catch (error) {
  console.error('Q3_FATAL ' + String(error && error.stack || error))
  process.exit(4)
}
