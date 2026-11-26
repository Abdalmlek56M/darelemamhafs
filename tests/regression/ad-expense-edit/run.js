const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');

const BASE = process.env.P25_BASE_URL || 'http://127.0.0.1:5800';
const PASSWORD = process.env.P25_PASSWORD || 'P25-StrongPass!';
const CIRCLE = process.env.P25_CIRCLE_ID || '';
const CONN = process.env.DAR_TEST_DATABASE || '';
const PROD_HOSTS = (process.env.DAR_FORBIDDEN_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
if (!CIRCLE || !CONN) { console.error('P25_FAIL missing env'); process.exit(2); }
try {
  const url = new URL(BASE);
  if (PROD_HOSTS.includes(url.hostname.toLowerCase()) || !['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname.toLowerCase())) {
    console.error('P25_FAIL refusing non-test URL'); process.exit(2);
  }
} catch { console.error('P25_FAIL invalid URL'); process.exit(2); }

function pgEnv() {
  const env = { ...process.env };
  for (const part of CONN.split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase(); const v = part.slice(i + 1).trim();
    if (k === 'host') env.PGHOST = v;
    if (k === 'port') env.PGPORT = v;
    if (k === 'database') env.PGDATABASE = v;
    if (k === 'username') env.PGUSER = v;
    if (k === 'password') env.PGPASSWORD = v;
  }
  return env;
}
function psql(sqlText) {
  const result = spawnSync('psql', ['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',sqlText], { env: pgEnv(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error('psql failed: ' + (result.stderr || '').trim());
  return (result.stdout || '').trim();
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function assertEq(actual, expected, message) { if (actual !== expected) throw new Error(message + ': got ' + actual + ' expected ' + expected); }
async function login(base, username, password, requestContext) {
  const response = await requestContext.post(base + '/api/auth/login', { data: { username, password } });
  if (!response.ok()) throw new Error('login ' + username + ' failed ' + response.status() + ': ' + (await response.text()).slice(0, 160));
}
async function createUser(adminRequest, username, displayName, permissions) {
  const response = await adminRequest.post(BASE + '/api/admin/users', { data: { username, displayName, password: PASSWORD, permissionCodes: permissions } });
  if (![201,409].includes(response.status())) throw new Error('create user ' + username + ' failed ' + response.status() + ': ' + (await response.text()).slice(0, 200));
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const adminContext = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const adminPage = await adminContext.newPage();
  const errors = [];
  adminPage.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  try {
    await login(BASE, 'p25_admin', PASSWORD, adminPage.request);
    const created = await adminPage.request.post(BASE + '/api/advertising-expenses', { data: {
      circleId: CIRCLE, platform: 'P25 Original', startDate: '2026-11-20', daysCount: 10, dailyCost: 100, note: 'old note'
    }});
    assertEq(created.status(), 201, 'create ad');
    const adId = (await created.json()).id;
    const novBefore = await (await adminPage.request.get(BASE + '/api/advertising-expenses?month=2026-11')).json();
    const rowBefore = novBefore.find((row) => row.id === adId);
    assert(rowBefore, 'ad missing from November before edit');
    assertEq(rowBefore.overlapDays, 10, 'November overlap before');
    assertEq(rowBefore.monthAmount, 1000, 'November month amount before');

    const updated = await adminPage.request.put(BASE + '/api/advertising-expenses/' + adId, { data: {
      circleId: CIRCLE, platform: 'P25 Moved', startDate: '2026-12-20', daysCount: 10, dailyCost: 200, note: 'new note'
    }});
    assertEq(updated.status(), 200, 'edit ad');
    const novAfter = await (await adminPage.request.get(BASE + '/api/advertising-expenses?month=2026-11')).json();
    const decAfter = await (await adminPage.request.get(BASE + '/api/advertising-expenses?month=2026-12')).json();
    assert(!novAfter.some((row) => row.id === adId), 'ad did not leave November');
    const moved = decAfter.find((row) => row.id === adId);
    assert(moved, 'ad did not move to December');
    assertEq(moved.overlapDays, 10, 'December overlap');
    assertEq(moved.monthAmount, 2000, 'December month amount');
    assertEq(moved.totalAmount, 2000, 'new total amount');

    const audit = psql("SELECT details::text FROM audit_log WHERE action_code='advertising.update' AND entity_id='" + adId + "' ORDER BY occurred_at DESC, id DESC LIMIT 1;");
    assert(audit, 'explicit advertising.update audit row missing');
    const details = JSON.parse(audit);
    assertEq(details.old.startDate, '2026-11-20', 'audit old startDate');
    assertEq(details.new.startDate, '2026-12-20', 'audit new startDate');
    assertEq(details.old.dailyCost, 100, 'audit old dailyCost');
    assertEq(details.new.dailyCost, 200, 'audit new dailyCost');
    assertEq(details.old.totalAmount, 1000, 'audit old total');
    assertEq(details.new.totalAmount, 2000, 'audit new total');
    assertEq(details.old.platform, 'P25 Original', 'audit old platform');
    assertEq(details.new.platform, 'P25 Moved', 'audit new platform');

    const uiAd = await adminPage.request.post(BASE + '/api/advertising-expenses', { data: {
      circleId: CIRCLE, platform: 'P25 UI Ad', startDate: '2026-11-20', daysCount: 1, dailyCost: 50, note: 'ui'
    }});
    assertEq(uiAd.status(), 201, 'create UI ad');
    await createUser(adminPage.request, 'p25_editor', 'P25 Editor', ['finance.read','finance.edit','circles.read']);
    await createUser(adminPage.request, 'p25_reader', 'P25 Reader', ['finance.read','circles.read']);
    await createUser(adminPage.request, 'p25_edit_only', 'P25 Edit Only', ['finance.edit']);

    const editorContext = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const editorPage = await editorContext.newPage();
    await login(BASE, 'p25_editor', PASSWORD, editorPage.request);
    await editorPage.goto(BASE + '/management', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await editorPage.waitForTimeout(3000);
    await editorPage.getByRole('button', { name: /الاشتراكات والتحصيل/ }).first().click();
    await editorPage.waitForTimeout(1200);
    const editButtons = await editorPage.locator('button[title="تعديل الإعلان"]').count();
    if (editButtons === 0) {
      const body = (await editorPage.locator('body').innerText()).slice(0, 900);
      const me = await editorPage.request.get(BASE + '/api/auth/me');
      throw new Error('editor cannot see edit button: ' + JSON.stringify({ url: editorPage.url(), editButtons, tableRows: await editorPage.locator('.ad-expenses-list tbody tr').count(), body, me: me.ok() ? await me.json() : await me.text() }));
    }
    assert(await editorPage.locator('form.ad-expense-form').count() === 0, 'create form should be hidden for edit-only+read user');
    await editorPage.locator('button[title="تعديل الإعلان"]').first().click();
    await editorPage.waitForTimeout(300);
    assert(await editorPage.locator('form.ad-expense-form').count() === 1, 'edit form did not open');
    await editorPage.getByRole('button', { name: 'إلغاء التعديل' }).click();
    await editorContext.close();

    const readerContext = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const readerPage = await readerContext.newPage();
    await login(BASE, 'p25_reader', PASSWORD, readerPage.request);
    await readerPage.goto(BASE + '/management', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await readerPage.waitForTimeout(3000);
    await readerPage.getByRole('button', { name: /الاشتراكات والتحصيل/ }).first().click();
    await readerPage.waitForTimeout(1200);
    assertEq(await readerPage.locator('button[title="تعديل الإعلان"]').count(), 0, 'reader sees edit button');
    await readerContext.close();

    const editOnlyContext = await browser.newContext();
    const editOnlyPage = await editOnlyContext.newPage();
    await login(BASE, 'p25_edit_only', PASSWORD, editOnlyPage.request);
    const denied = await editOnlyPage.request.put(BASE + '/api/advertising-expenses/' + adId, { data: {
      circleId: CIRCLE, platform: 'Denied', startDate: '2026-12-20', daysCount: 10, dailyCost: 200, note: 'x'
    }});
    assertEq(denied.status(), 403, 'edit-only user should get 403 without finance.read');
    await editOnlyContext.close();

    if (errors.length) throw new Error('page errors: ' + errors.join(' | ').slice(0, 500));
    console.log(JSON.stringify({ ok: true, adId, checks: 15, errors }, null, 2));
    console.log('P25_PASS');
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error && error.message || error), errors }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
