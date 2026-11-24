const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');

const BASE = process.env.P16_BASE_URL || 'http://127.0.0.1:5500';
const PASSWORD = process.env.P16_PASSWORD || 'P16-StrongPass!';
const CONN = process.env.DAR_TEST_DATABASE || '';
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];
if (!CONN) { console.error('P16_FAIL missing DAR_TEST_DATABASE'); process.exit(2); }
try {
  const url = new URL(BASE);
  if (PROD_HOSTS.includes(url.hostname.toLowerCase()) || !['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname.toLowerCase())) {
    console.error('P16_FAIL refusing non-test URL'); process.exit(2);
  }
} catch { console.error('P16_FAIL invalid URL'); process.exit(2); }

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

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  const failedResponses = [];
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push(response.status() + ' ' + response.url()); });
  page.on('pageerror', (error) => errors.push(String(error && error.message || error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  try {
    const loginResponse = await page.request.post(BASE + '/api/auth/login', {
      data: { username: 'p16_admin', password: PASSWORD },
    });
    if (!loginResponse.ok()) {
      throw new Error('API login failed ' + loginResponse.status() + ': ' + (await loginResponse.text()).slice(0, 200));
    }
    await page.goto(BASE + '/management', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: /الطلاب/ }).first().click();
    await page.waitForTimeout(2000);

    const rowCount = async () => page.locator('table tbody tr').count();
    const pageText = async () => page.locator('body').innerText();
    if (await rowCount() !== 25) throw new Error('page 1 rows expected 25 got ' + await rowCount());
    let text = await pageText();
    if (!text.includes('صفحة 1 من 12 · 300 سجل')) throw new Error('page 1 label missing');
    await page.getByRole('button', { name: 'الصفحة التالية' }).click();
    await page.waitForTimeout(300);
    if (await rowCount() !== 25) throw new Error('page 2 rows expected 25');
    if (!(await pageText()).includes('صفحة 2 من 12')) throw new Error('page 2 label missing');
    await page.getByRole('button', { name: 'الصفحة السابقة' }).click();
    await page.waitForTimeout(300);
    if (!(await pageText()).includes('صفحة 1 من 12')) throw new Error('previous page did not return to 1');

    const search = page.locator('input[placeholder*="ابحث"]').first();
    await search.fill('ZZ P16 Student 299');
    await page.waitForTimeout(500);
    if (await rowCount() !== 1 || !(await pageText()).includes('1 سجل')) throw new Error('search did not reset/limit to 1');
    await search.fill('');
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'متوقف' }).click();
    await page.waitForTimeout(500);
    text = await pageText();
    if (!text.includes('صفحة 1 من 4 · 100 سجل')) throw new Error('paused filter expected 100/4 pages');
    await page.getByRole('button', { name: 'الكل' }).click();
    await page.waitForTimeout(500);

    // Row action: open student history, then close.
    await page.locator('button.student-name-link').first().click();
    await page.waitForTimeout(1200);
    if (!(await pageText()).includes('ملف الطالب')) {
      throw new Error('student history did not open');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Go to last page.
    for (let i = 0; i < 11; i++) {
      const next = page.getByRole('button', { name: 'الصفحة التالية' });
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(180);
    }
    text = await pageText();
    if (!text.includes('صفحة 12 من 12')) throw new Error('last page expected 12');
    const deleteCount = 26;
    psql('DELETE FROM students WHERE id IN (SELECT id FROM students ORDER BY id LIMIT ' + deleteCount + ');');
    await page.getByRole('button', { name: 'تحديث كل القوائم' }).click();
    await page.waitForTimeout(3000);
    text = await pageText();
    if (!text.includes('صفحة 11 من 11 · 274 سجل')) throw new Error('page was not clamped after deletion: ' + text.includes('صفحة'));
    if (errors.length) throw new Error('console/page errors: ' + errors.join(' | ').slice(0, 500) + ' failed=' + failedResponses.join(','));

    console.log(JSON.stringify({ ok: true, checks: 9, errors }, null, 2));
    console.log('P16_PASS');
  } catch (error) {
    let body = '';
    try { body = (await page.locator('body').innerText()).slice(0, 500); } catch {}
    try { await page.screenshot({ path: '/tmp/p16-failure.png', fullPage: true }); } catch {}
    console.log(JSON.stringify({ ok: false, error: String(error && error.message || error), errors, url: page.url(), body }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();