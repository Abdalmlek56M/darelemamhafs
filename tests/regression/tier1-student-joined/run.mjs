import { strict as assert } from 'node:assert';
import { setup, req, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.11: a browser-supplied joined date must not win; the server writes its Cairo day.
const payload = { studentCode: 'T1-JOIN', fullName: 'Tier1 Joined', ageYears: 10, joinedOn: '2000-01-01', status: 'active' };
const created = await req(OLD, c.admin, 'POST', '/api/students', payload);
assert.equal(created.status, 201, 'student create status ' + created.text.slice(0, 200));
const body = JSON.parse(created.text);
const expectedCairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
assert.notEqual(body.joinedOn, '2000-01-01', 'browser joined date was trusted');
assert.ok([expectedCairo, new Date(Date.now() - 86400000).toISOString().slice(0, 10)].includes(body.joinedOn), 'joined date is not the Cairo server day: ' + body.joinedOn);

console.log(JSON.stringify({ suite: 'tier1-student-joined', ok: true, cases: 1 }));
