import { strict as assert } from 'node:assert';
import { setup, req, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.5: editing a trashed operating expense must be a 404, not a silent update.
const created = await req(OLD, c.admin, 'POST', '/api/operating-expenses', {
  expenseDate: '2026-11-10', category: 'tier1', description: 'trash-edit test', amount: 5, circleId: null,
});
assert.equal(created.status, 201, 'operating expense create ' + created.text.slice(0, 200));
const expenseId = JSON.parse(created.text).id;

const trashed = await req(OLD, c.admin, 'POST', '/api/admin/trash', { entityType: 'operating-expense', entityId: expenseId });
assert.equal(trashed.status, 200, 'move operating expense to trash ' + trashed.text.slice(0, 200));

const update = await req(OLD, c.admin, 'PUT', '/api/operating-expenses/' + expenseId, {
  expenseDate: '2026-11-11', category: 'tier1', description: 'edited trashed row', amount: 6, circleId: null,
});
assert.equal(update.status, 404, 'trashed expense update must be 404, got ' + update.status);

console.log(JSON.stringify({ suite: 'tier1-expense-trashed', ok: true, cases: 2 }));
