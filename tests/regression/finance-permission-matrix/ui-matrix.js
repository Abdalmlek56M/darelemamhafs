const BASE = process.env.P17_BASE_URL || 'http://127.0.0.1:5099';
const DB = process.env.P17_DAR_TEST_DATABASE || process.env.DAR_TEST_DATABASE || '';
const PASSWORD = 'P17-StrongPass!';
const sentinel = /987654|987,654|987\D{0,3}654|123456|444222|55555|P17-SENTINEL/;

(async () => {
  // Shared test library guard (FINAL 2.17): runs before playwright is required so a
  // production target is refused even when the browser dependency is unavailable.
  const { assertSafeTargets } = await import('../../lib/index.mjs');
  assertSafeTargets({ db: DB, urls: [BASE], label: 'P17_FAIL' });
  const { chromium } = require('playwright');
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
    const checks = {
      controlSeesAmountsInUi: results.control.dashboardSentinel || results.control.paymentsSentinel,
      controlSeesAmountsInReport: results.control.reportHasSentinel,
      noneSeesNoAmounts: !results.none.dashboardSentinel && !results.none.paymentsSentinel && !results.none.reportHasSentinel,
      createSeesNoAmounts: !results.create.dashboardSentinel && !results.create.paymentsSentinel && !results.create.reportHasSentinel,
      readHasPaymentsButReportHidesFinance: results.read.paymentsNav > 0 && results.read.paymentsSentinel && !results.read.reportHasSentinel,
      reportsHidesFinance: !results.reports.dashboardSentinel && !results.reports.paymentsSentinel && !results.reports.reportHasSentinel
    };
    const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name, actual]) => ({ name, actual }));
    console.log(JSON.stringify({ suite: 'p17-ui-matrix', ok: failed.length === 0, n: users, results, checks, failed }, null, 2));
    if (failed.length > 0) {
      console.error('P17_UI_MATRIX_FAIL ' + JSON.stringify(failed));
      process.exitCode = 1;
    } else {
      console.log('P17_UI_MATRIX_PASS');
    }
  } catch (error) {
    console.error(JSON.stringify({ fatal: String(error && error.stack || error), results }, null, 2));
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
})();