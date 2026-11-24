const BASE = process.env.P17_NEW_BASE_URL || 'http://127.0.0.1:5100';
const PASSWORD = process.env.P17_TEST_PASSWORD || 'P17-StrongPass!';
const STUDENT = '22222222-2222-4222-8222-222222222222';
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

const numeric = /(?:987654\\.32|123456\\.78|444222\\.11|55555\\.55|11111\\.11|37\\.5)/;

async function login(username) {
  let response, text = '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    response = await fetch(BASE + '/api/v1/auth/password', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD })
    });
    text = await response.text();
    if (response.status !== 429) break;
    await new Promise(r => setTimeout(r, 15000));
  }
  if (!response.ok) throw new Error('login ' + username + ' ' + response.status + ': ' + text);
  const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  return values.filter(Boolean).map(v => v.split(';')[0]).join('; ');
}

async function get(cookie, path) {
  const response = await fetch(BASE + path, { headers: { cookie } });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text, numeric: numeric.test(text) };
}

(async () => {
  const result = {};
  for (const [key, username] of Object.entries({ nofin: 'p17_supervisor_nofin', fin: 'p17_supervisor_fin' })) {
    const cookie = await login(username);
    const me = await get(cookie, '/api/v1/auth/me');
    const unpaid = await get(cookie, '/api/v1/supervisor/unpaid?month=2026-11');
    const student = await get(cookie, '/api/v1/supervisor/students/' + STUDENT);
    const live = await get(cookie, '/api/v1/supervisor/live');
    const unpaidRows = unpaid.json && Array.isArray(unpaid.json.unpaid) ? unpaid.json.unpaid : [];
    const subscription = student.json && student.json.subscription;
    const subscriptionRows = Array.isArray(subscription) ? subscription : [];
    const sessions = live.json && Array.isArray(live.json.sessions) ? live.json.sessions : [];
    result[key] = {
      permissions: me.json && (me.json.permissionCodes || me.json.permissions || null),
      unpaid: {
        status: unpaid.status,
        canViewAmounts: unpaid.json && unpaid.json.canViewAmounts,
        count: unpaidRows.length,
        rows: unpaidRows.map(r => ({ amountDue: r.amountDue, paidAmount: r.paidAmount, balance: r.balance, status: r.status })),
        numericInBody: unpaid.numeric
      },
      student: {
        status: student.status,
        subscriptionRows: subscriptionRows.map(s => ({ status: s.status, amountDue: s.amountDue, paidAmount: s.paidAmount, balance: s.balance })),
        numericInBody: student.numeric
      },
      live: {
        status: live.status,
        count: sessions.length,
        payableAmounts: sessions.map(s => s.payableAmount),
        numericInBody: live.numeric
      }
    };
  }
  const nofin = result.nofin, fin = result.fin;
  const checks = {
    nofinUnpaidCanViewAmountsFalse: nofin.unpaid.status === 200 && nofin.unpaid.canViewAmounts === false,
    nofinUnpaidAmountsNull: nofin.unpaid.rows.length > 0 && nofin.unpaid.rows.every(r => r.amountDue === null && r.paidAmount === null && r.balance === null),
    nofinStudentAmountsNull: nofin.student.status === 200 && nofin.student.subscriptionRows.length > 0 && nofin.student.subscriptionRows.every(s => s.amountDue === null && s.paidAmount === null && s.balance === null),
    nofinLivePayableAmountNull: nofin.live.status === 200 && nofin.live.count > 0 && nofin.live.payableAmounts.every(v => v === null),
    finUnpaidCanViewAmountsTrue: fin.unpaid.status === 200 && fin.unpaid.canViewAmounts === true,
    finUnpaidAmountsNumeric: fin.unpaid.rows.length > 0 && fin.unpaid.rows.some(r => typeof r.amountDue === 'number' && typeof r.balance === 'number'),
    finStudentAmountsNumeric: fin.student.status === 200 && fin.student.subscriptionRows.length > 0 && fin.student.subscriptionRows.some(s => typeof s.amountDue === 'number'),
    finLivePayableAmountNumeric: fin.live.status === 200 && fin.live.count > 0 && fin.live.payableAmounts.some(v => typeof v === 'number')
  };
  console.log(JSON.stringify({ result, checks }, null, 2));
})().catch(error => { console.log(JSON.stringify({ fatal: String(error && error.stack || error) })); process.exit(1); });