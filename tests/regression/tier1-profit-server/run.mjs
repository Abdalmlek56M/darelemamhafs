import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { setup, req, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL Z2: money is rendered from the server summary only; the frontend keeps no profit formula.
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const response = await req(new URL('../request-workflow/common.mjs', import.meta.url).protocol === 'file:' ? process.env.Q6_LEGACY_URL : '', c.admin, 'GET', `/api/summary/profit?month=${month}`);
assert.equal(response.status, 200, 'server profit summary ' + response.text.slice(0, 240));
const body = JSON.parse(response.text);
for (const field of ['billed', 'collected', 'balance', 'advertising', 'teacherPay', 'otherExpenses', 'net', 'withoutChargeCount', 'unmarkedPastSessions']) {
  assert.equal(typeof body.dashboard[field], 'number', 'dashboard.' + field + ' missing');
}
assert.ok(Array.isArray(body.teachers), 'teachers array missing');
assert.ok(Array.isArray(body.circles), 'circles array missing');

const selectors = readFileSync('frontend/src/application/selectors.ts', 'utf8');
for (const removed of ['getDashboardProfit', 'getTeacherPaySummary', 'getCircleProfitSummary']) {
  assert.equal(selectors.includes('export function ' + removed), false, removed + ' local money formula still exists');
}
const application = [readFileSync('frontend/src/application/useDarApplication.ts', 'utf8'), readFileSync('frontend/src/application/useDarApplicationState.ts', 'utf8'), readFileSync('frontend/src/application/useDarActionsA.ts', 'utf8'), readFileSync('frontend/src/application/useDarActionsB.ts', 'utf8')].join('\n');
assert.equal(application.includes('localDashboardProfit'), false, 'dashboard still merges a local formula');
assert.match(application, /serverProfit\?\.dashboard/, 'dashboard is not rendered from the server summary');
assert.match(readFileSync('frontend/src/application/useProfitSummary.ts', 'utf8'), /\/api\/summary\/profit/, 'frontend does not call the server summary endpoint');

console.log(JSON.stringify({ suite: 'tier1-profit-server', ok: true, cases: 3 }));
