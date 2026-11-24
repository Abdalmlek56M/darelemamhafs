const BASE = process.env.P17_BASE_URL || 'http://127.0.0.1:5099';
const PASSWORD = process.env.P17_TEST_PASSWORD || 'P17-StrongPass!';
const CHARGE = '55555555-5555-4555-8555-555555555555';
const PAYMENT = '66666666-6666-4666-8666-666666666666';
const REPORT = '99999999-9999-4999-8999-999999999999';
const ENROLLMENT = '44444444-4444-4444-8444-444444444444';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const TEACHER = '11111111-1111-4111-8111-111111111111';
const numericSentinel = /(?:987654\.32|987654|123456\.78|444222\.11|55555\.55|11111\.11)/;

async function login(username) {
  let response;
  let text = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    response = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD })
    });
    text = await response.text();
    if (response.status !== 429) break;
    await new Promise(r => setTimeout(r, 15000));
  }
  if (!response.ok) throw new Error('login ' + username + ' ' + response.status + ': ' + text);
  const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  const cookie = values.filter(Boolean).map(v => v.split(';')[0]).join('; ');
  return cookie;
}

async function req(cookie, method, path, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: response.status, text, json: parsed, sentinel: numericSentinel.test(text) };
}

function slim(result) { return { status: result.status, sentinel: result.sentinel }; }

(async () => {
  const users = {
    none: 'p17_none', create: 'p17_create', read: 'p17_read', reports: 'p17_reports', control: 'p17_control'
  };
  const sessions = {};
  const permissions = {};
  for (const [key, user] of Object.entries(users)) {
    await new Promise(r => setTimeout(r, 1500));
    sessions[key] = await login(user);
    const me = await req(sessions[key], 'GET', '/api/auth/me');
    permissions[key] = me.json && (me.json.permissionCodes || me.json.permissions || []);
  }

  const reads = {
    collections: '/api/collections?month=2026-11',
    ads: '/api/advertising-expenses?month=2026-11',
    operating: '/api/operating-expenses?month=2026-11',
    reportList: '/api/collection-reports?month=2026-11',
    reportOne: '/api/collection-reports/' + REPORT,
    payrollLock: '/api/payroll/lock?month=2026-11',
    financeOptions: '/api/finance-entry-options?month=2026-11',
    auditLog: '/api/admin/audit-log?month=2026-11&limit=20',
    student: '/api/students/' + STUDENT,
    teacher: '/api/teachers/' + TEACHER,
    receipt: '/api/payments/' + PAYMENT + '/receipt'
  };

  const matrix = {};
  for (const key of Object.keys(users)) {
    matrix[key] = { permissions: permissions[key], reads: {} };
    for (const [name, path] of Object.entries(reads)) {
      matrix[key].reads[name] = slim(await req(sessions[key], 'GET', path));
    }
  }

  const writes = {
    chargeCreate: () => ['POST', '/api/charges', { enrollmentId: ENROLLMENT, billingMonth: '2026-12', amountDue: 100, note: 'P17-WRITE-PROBE' }],
    paymentCreate: () => ['POST', '/api/payments', { monthlyChargeId: CHARGE, amount: 10, method: 'cash', note: 'P17-WRITE-PROBE' }],
    chargeUpdate: () => ['PUT', '/api/charges/' + CHARGE, { amountDue: 987654.32, note: 'P17-WRITE-PROBE' }],
    chargeVoid: () => ['POST', '/api/charges/' + CHARGE + '/void', { reason: 'P17 write-permission probe' }],
    paymentVoid: () => ['POST', '/api/payments/' + PAYMENT + '/void', { reason: 'P17 write-permission probe' }]
  };
  for (const key of ['none', 'read']) {
    matrix[key].writes = {};
    for (const [name, build] of Object.entries(writes)) {
      const [method, path, body] = build();
      matrix[key].writes[name] = slim(await req(sessions[key], method, path, body));
    }
  }
  // Create-only account: prove it can create a payment and the response masks the amount.
  const createPayment = await req(sessions.create, 'POST', '/api/payments', { monthlyChargeId: CHARGE, amount: 10, method: 'cash', note: 'P17-CREATE-PROBE' });
  matrix.create.paymentCreate = { status: createPayment.status, amountField: createPayment.json ? createPayment.json.amount : undefined, sentinel: createPayment.sentinel };

  const control = matrix.control;
  const checks = {
    controlCollectionsHasNumericAmount: control.reads.collections.status === 200 && control.reads.collections.sentinel,
    controlReportHasNumericAmount: control.reads.reportOne.status === 200 && control.reads.reportOne.sentinel,
    noneReadsDenied: ['collections','ads','operating','reportList','reportOne','financeOptions'].every(k => matrix.none.reads[k].status === 403),
    reportsUserFinanceDenied: ['collections','ads','operating','reportList','reportOne','financeOptions'].every(k => matrix.reports.reads[k].status === 403),
    noneAuditHasNoNumericAmount: !matrix.none.reads.auditLog.sentinel,
    noneWritesDenied: Object.values(matrix.none.writes).every(x => x.status === 403),
    readWritesDenied: Object.values(matrix.read.writes).every(x => x.status === 403),
    createFinanceOptionsNoNumericAmount: !matrix.create.reads.financeOptions.sentinel,
    createOnlyCreateStatus: matrix.create.paymentCreate.status,
    createOnlyMaskedAmount: matrix.create.paymentCreate.amountField === null
  };

  console.log(JSON.stringify({ permissions, matrix, checks }, null, 2));
})().catch(error => { console.error(JSON.stringify({ fatal: String(error && error.stack || error) })); process.exit(1); });