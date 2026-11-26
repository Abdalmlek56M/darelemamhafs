const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = process.env.P26_BASE_URL || 'http://127.0.0.1:5601';
const PASSWORD = process.env.P26_PASSWORD || 'P26-StrongPass!';
const MODE = process.env.P26_MODE || 'capture';
const SHOTS = process.env.P26_SHOTS || '/tmp/p26-shots';
const PROD_HOSTS = (process.env.DAR_FORBIDDEN_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
try {
  const url = new URL(BASE);
  if (PROD_HOSTS.includes(url.hostname.toLowerCase()) || !['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname.toLowerCase())) {
    console.error('P26_FAIL refusing non-test URL'); process.exit(2);
  }
} catch { console.error('P26_FAIL invalid URL'); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];
  try {
    for (const viewport of [{ width: 390, height: 844, label: '390x844' }, { width: 768, height: 1024, label: '768x1024' }]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const login = await page.request.post(BASE + '/api/auth/login', { data: { username: 'p26_admin', password: PASSWORD } });
      if (!login.ok()) throw new Error('login failed ' + login.status());
      await page.goto(BASE + '/management', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      const metrics = await page.evaluate(() => {
        const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const sidebar = document.querySelector('.sidebar');
        const mobileNavs = [...document.querySelectorAll('.admin-mobile-nav')].filter(visible);
        const navLists = [...document.querySelectorAll('.nav-list')].filter(visible);
        return {
          sidebarVisible: visible(sidebar),
          mobileNavCount: mobileNavs.length,
          visibleNavListCount: navLists.length,
          navButtonsInSidebar: document.querySelectorAll('.sidebar .nav-list .nav-item').length,
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      });
      await page.screenshot({ path: SHOTS + '/mobile-' + viewport.label + '-' + MODE + '.png', fullPage: false });
      const drawerButton = page.getByRole('button', { name: 'فتح قائمة الأقسام' });
      const drawerVisible = await drawerButton.isVisible();
      let drawerItems = [];
      if (drawerVisible) {
        await drawerButton.click();
        await page.waitForTimeout(500);
        drawerItems = await page.locator('.admin-drawer-nav .nav-item').allTextContents();
        const drawer = page.locator('.admin-drawer');
        if (!(await drawer.isVisible())) throw new Error('drawer did not open');
        await page.screenshot({ path: SHOTS + '/mobile-' + viewport.label + '-' + MODE + '-drawer.png', fullPage: false });
        const disabledDrawerItems = await page.locator('.admin-drawer-nav .nav-item:disabled').count();
        if (disabledDrawerItems) throw new Error('drawer has disabled sections: ' + disabledDrawerItems);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
      const ok = metrics.mobileNavCount === 1 && !metrics.sidebarVisible && metrics.visibleNavListCount === 0 && !metrics.overflowX && drawerVisible && drawerItems.length === metrics.navButtonsInSidebar;
      results.push({ viewport: viewport.label, metrics, drawerVisible, drawerItems: drawerItems.length, errors, ok });
      await context.close();
    }
    console.log(JSON.stringify({ mode: MODE, base: BASE, results }, null, 2));
    if (MODE === 'after' && results.some((r) => !r.ok || r.errors.length)) process.exitCode = 1;
    else if (MODE === 'after') console.log('P26_PASS');
  } catch (error) {
    console.error('P26_FATAL ' + String(error && error.stack || error));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();