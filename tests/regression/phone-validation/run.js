const { chromium } = require('playwright');
const BASE = process.env.P23_LEGACY_URL || 'http://127.0.0.1:5500';
const NEW_API = process.env.P23_NEW_URL || 'http://127.0.0.1:5501';
const PASSWORD = process.env.P23_PASSWORD || 'P23-StrongPass!';
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];
for (const raw of [BASE, NEW_API]) {
  try {
    const url = new URL(raw);
    if (PROD_HOSTS.includes(url.hostname.toLowerCase()) || !['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname.toLowerCase())) {
      console.error('P23_FAIL refusing non-test URL'); process.exit(2);
    }
  } catch { console.error('P23_FAIL invalid URL'); process.exit(2); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error && error.message || error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  try {
    const login = await page.request.post(BASE + '/api/auth/login', { data: { username: 'p23_admin', password: PASSWORD } });
    if (!login.ok()) throw new Error('API login failed ' + login.status() + ': ' + (await login.text()).slice(0, 160));
    await page.goto(BASE + '/management', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    await page.getByRole('button', { name: /الطلاب/ }).first().click();
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: 'إضافة طالب' }).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    const phoneInputs = dialog.locator('input[type="tel"]');
    if (await phoneInputs.count() !== 2) throw new Error('expected 2 phone inputs, got ' + await phoneInputs.count());
    await phoneInputs.nth(0).fill('010ABC123');
    if (await phoneInputs.nth(0).inputValue() !== '010123') throw new Error('student phone letters were not blocked: ' + await phoneInputs.nth(0).inputValue());
    await phoneInputs.nth(0).fill('٠١٠١٢٣٤٥٦٧٨');
    if (await phoneInputs.nth(0).inputValue() !== '01012345678') throw new Error('Arabic-Indic digits were not normalized: ' + await phoneInputs.nth(0).inputValue());
    await phoneInputs.nth(1).fill('011XYZ456');
    if (await phoneInputs.nth(1).inputValue() !== '011456') throw new Error('guardian phone letters were not blocked: ' + await phoneInputs.nth(1).inputValue());
    await dialog.locator('input[required]').first().fill('P23 UI Student');
    await dialog.getByRole('button', { name: 'حفظ الطالب' }).click();
    await page.waitForTimeout(2500);
    const bodyAfterSave = await page.locator('body').innerText();
    if (!bodyAfterSave.includes('P23 UI Student') && !bodyAfterSave.includes('تمت إضافة الطالب')) throw new Error('student save did not complete');

    await page.getByRole('button', { name: 'المعلمات', exact: true }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'إضافة معلمة' }).click();
    const teacherDialog = page.locator('[role="dialog"]');
    await teacherDialog.waitFor({ state: 'visible' });
    const teacherPhone = teacherDialog.locator('input[type="tel"]').first();
    await teacherPhone.fill('010Teacher');
    if (await teacherPhone.inputValue() !== '010') throw new Error('teacher phone letters were not blocked: ' + await teacherPhone.inputValue());
    await page.keyboard.press('Escape');

    const legacyInvalid = await page.request.post(BASE + '/api/students', {
      data: { studentCode: null, fullName: 'P23 API Legacy', ageYears: 10, phone: '010ABC', guardianName: null, guardianPhone: null, joinedOn: '2026-01-01', status: 'active', notes: null },
    });
    if (legacyInvalid.status() !== 400) throw new Error('legacy invalid phone expected 400 got ' + legacyInvalid.status() + ': ' + (await legacyInvalid.text()).slice(0, 180));

    const newInvalid = await page.request.post(NEW_API + '/api/v1/students', {
      data: { studentCode: null, fullName: 'P23 API New', ageYears: 10, phone: '010ABC', guardianName: null, guardianPhone: null, joinedOn: '2026-01-01', status: 'active', notes: null },
    });
    if (newInvalid.status() !== 422) throw new Error('new API invalid phone expected 422 got ' + newInvalid.status() + ': ' + (await newInvalid.text()).slice(0, 180));

    if (errors.length) throw new Error('console/page errors: ' + errors.join(' | ').slice(0, 500));
    console.log(JSON.stringify({ ok: true, checks: 6, errors }, null, 2));
    console.log('P23_PASS');
  } catch (error) {
    let body = '';
    try { body = (await page.locator('body').innerText()).slice(0, 500); } catch {}
    console.log(JSON.stringify({ ok: false, error: String(error && error.message || error), errors, body }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();