import { strict as assert } from 'node:assert';
import { setup, req, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.5: PUT /circles/{id}/with-schedule must replace the weekly plan, not append slots.
const createBody = {
  name: 'T1 Schedule Circle', circleCode: 'T1-SCH', isActive: true, startsOn: '2026-01-01', monthlyFee: 0,
  teacherId: c.teacherId,
  slots: [{ dayOfWeek: 4, startsAt: '12:00', durationMinutes: 60 }],
};
const created = await req(OLD, c.admin, 'POST', '/api/circles/with-schedule', createBody);
assert.equal(created.status, 201, 'circle create with schedule ' + created.text.slice(0, 200));
const circleId = JSON.parse(created.text).circle.id;

const update = await req(OLD, c.admin, 'PUT', `/api/circles/${circleId}/with-schedule`, {
  ...createBody,
  slots: [{ dayOfWeek: 5, startsAt: '13:00', durationMinutes: 90 }],
});
assert.equal(update.status, 200, 'circle update with schedule ' + update.text.slice(0, 200));
const updated = JSON.parse(update.text);
assert.equal(updated.slots.length, 1, 'PUT must return exactly the new schedule');
assert.equal(updated.slots[0].dayOfWeek, 2, 'PUT returned a stale slot');

console.log(JSON.stringify({ suite: 'tier1-circle-schedule', ok: true, cases: 1 }));
