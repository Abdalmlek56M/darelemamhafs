const { chromium } = require('playwright');
const BASE = process.env.P24_BASE_URL || 'http://127.0.0.1:5700';
const PASSWORD = process.env.P24_PASSWORD || 'P24-StrongPass!';
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];
try {
  const url = new URL(BASE);
  if (PROD_HOSTS.includes(url.hostname.toLowerCase()) || !['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname.toLowerCase())) {
    console.error('P24_FAIL refusing non-test URL'); process.exit(2);
  }
} catch { console.error('P24_FAIL invalid URL'); process.exit(2); }
const arabicDigits = /[٠-٩۰-۹]/;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  try {
    const login = await page.request.post(BASE + '/api/auth/login', { data: { username: 'p24_admin', password: PASSWORD } });
    if (!login.ok()) throw new Error('login failed ' + login.status());
    await page.goto(BASE + '/management', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    const labels = ['لوحة التحكم','الإشعارات','طلبات المعلمات','الطلاب','المعلمات','ملاحظات المعلمات','الحلقات','المواعيد وحضور المعلمات','الاشتراكات والتحصيل','الحسابات والصلاحيات','النظام والنسخ الاحتياطي'];
    const screens = [];
    for (const label of labels) {
      const nav = page.locator('.sidebar .nav-list .nav-item', { hasText: label }).first();
      if (await nav.count()) { await nav.click(); await page.waitForTimeout(650); }
      const text = await page.locator('body').innerText();
      if (arabicDigits.test(text)) {
        const match = text.match(arabicDigits);
        throw new Error('Arabic-Indic digits on screen ' + label + ': ' + JSON.stringify(text.slice(Math.max(0, (match?.index ?? 0) - 40), (match?.index ?? 0) + 40)));
      }
      const inputs = await page.evaluate(() => [...document.querySelectorAll('input')].filter((input) => ['date','number','month','tel'].includes(input.type) && input.value).map((input) => ({ type: input.type, value: input.value })));
      for (const input of inputs) {
        if (arabicDigits.test(input.value)) throw new Error('Arabic-Indic digits in ' + input.type + ' input on ' + label + ': ' + input.value);
        if (input.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(input.value)) throw new Error('date input is not ASCII ISO on ' + label + ': ' + input.value);
        if ((input.type === 'number' || input.type === 'month') && !/^[0-9.,-]+$/.test(input.value)) throw new Error(input.type + ' input is not ASCII on ' + label + ': ' + input.value);
      }
      screens.push({ label, inputs: inputs.length });
    }
    // Dialog-level input check: the student join date must remain an ASCII ISO value.
    await page.locator('.sidebar .nav-list .nav-item', { hasText: 'الطلاب' }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'إضافة طالب' }).click();
    await page.waitForTimeout(400);
    const dateValue = await page.locator('[role="dialog"] input[type="date"]').first().inputValue();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) throw new Error('student date input changed: ' + dateValue);
    if (arabicDigits.test(dateValue)) throw new Error('student date input has Arabic-Indic digits');
    await page.keyboard.press('Escape');
    if (screens.length !== labels.length) throw new Error('not all screens scanned: ' + screens.length);
    console.log(JSON.stringify({ ok: true, screens, checkedInputs: screens.reduce((n, s) => n + s.inputs, 0) }, null, 2));
    console.log('P24_PASS');
  } catch (error) {
    let body = '';
    try { body = (await page.locator('body').innerText()).slice(0, 500); } catch {}
    console.log(JSON.stringify({ ok: false, error: String(error && error.message || error), body }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
