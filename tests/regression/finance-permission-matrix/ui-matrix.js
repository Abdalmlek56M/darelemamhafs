const BASE = process.env.P17_BASE_URL || 'http://127.0.0.1:5099';
const PROD_DB = 'dareltahfeez';
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];
function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}
function refuseTarget(message) {
  console.error('P17_FAIL refusing production/live target: ' + message);
  process.exit(2);
}
function guardTargets(base) {
  let url;
  try { url = new URL(base); } catch { refuseTarget('invalid URL'); }
  const host = url.hostname.toLowerCase();
  if (PROD_HOSTS.includes(host)) refuseTarget('production hostname ' + host);
  if (!isLoopbackHost(host)) refuseTarget('non-loopback test URL ' + host);
  const db = process.env.P17_DAR_TEST_DATABASE || process.env.DAR_TEST_DATABASE || '';
  if (db && /database\s*=\s*dareltahfeez\b/i.test(db)) refuseTarget('production database name');
  const dbHost = /host\s*=\s*([^;]+)/i.exec(db);
  if (dbHost && PROD_HOSTS.includes(dbHost[1].trim().toLowerCase())) refuseTarget('production database host');
}
guardTargets(BASE);
const { chromium } = require('playwright');
const PASSWORD = 'P17-StrongPass!';
const sentinel = /987654|987,654|987\D{0,3}654|123456|444222|55555|P17-SENTINEL/;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const users = { none: 'p17_none', create: 'p17_create', read: 'p17_read', reports: 'p17_reports', control: 'p17_control' };
  const results = {};
  try {
    for (const [key, username] of Object.entries(users)) {
      const ip = '198.51.101.' + (10 + [...username].reduce((a, c) => a + c.charCodeAt(0), 0) % 200);
      const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, extraHTTPHeaders: { 'X-Forwarded-For': ip, 'X-Real-IP': ip } });
      const page = await context.newPage();
      const csp = [];
      page.on('console', msg => {
        const text = msg.text();
        if (/Content Security Policy|Refused to|violates the following/i.test(text)) csp.push(text);
      });
      await page.goto(BASE + '/management', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1500);
      await page.fill('input[autocomplete="username"]', username);
      await page.fill('input[autocomplete="current-password"]', PASSWORD);
      await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
      await page.waitForTimeout(4500);
      const dashboardText = await page.locator('body').innerText();
      const loginOk = /لوحة التحكم|تسجيل الخروج/.test(dashboardText);
      if (!loginOk) throw new Error('login did not reach dashboard for ' + username + ': ' + dashboardText.slice(0, 160));
      const paymentsNav = await page.getByText('الاشتراكات والتحصيل', { exact: true }).count();
      let paymentsText = '';
      if (paymentsNav) {
        await page.getByText('الاشتراكات والتحصيل', { exact: true }).first().click();
        await page.waitForTimeout(1800);
        paymentsText = await page.locator('body').innerText();
      }

      // Reproduce the report gate: system -> export -> generate school report.
      let reportHasSentinel = false;
      let reportError = null;
      try {
        await page.getByRole('button', { name: 'النظام والنسخ الاحتياطي' }).first().click();
        await page.waitForTimeout(1200);
        await page.getByRole('button', { name: 'تصدير البيانات' }).click();
        await page.waitForTimeout(1200);
        const popupPromise = page.waitForEvent('popup', { timeout: 20000 });
        await page.getByRole('button', { name: /عرض التقرير/ }).click();
        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await popup.waitForTimeout(1200);
        const reportText = await popup.locator('body').innerText();
        reportHasSentinel = sentinel.test(reportText);
        await popup.close();
      } catch (error) {
        reportError = String(error && error.message || error);
      }

      results[key] = {
        dashboardSentinel: sentinel.test(dashboardText),
        paymentsNav,
        paymentsSentinel: sentinel.test(paymentsText),
        reportHasSentinel,
        reportError,
        cspViolations: csp
      };
      await context.close();
    }
    console.log(JSON.stringify({ n: users, results, checks: {
      controlSeesAmountsInUi: results.control.dashboardSentinel || results.control.paymentsSentinel,
      controlSeesAmountsInReport: results.control.reportHasSentinel,
      noneSeesNoAmounts: !results.none.dashboardSentinel && !results.none.paymentsSentinel && !results.none.reportHasSentinel,
      createSeesNoAmounts: !results.create.dashboardSentinel && !results.create.paymentsSentinel && !results.create.reportHasSentinel,
      readHasPaymentsButReportHidesFinance: results.read.paymentsNav > 0 && results.read.paymentsSentinel && !results.read.reportHasSentinel,
      reportsHidesFinance: !results.reports.dashboardSentinel && !results.reports.paymentsSentinel && !results.reports.reportHasSentinel
    } }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ fatal: String(error && error.stack || error), results }, null, 2));
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
})();