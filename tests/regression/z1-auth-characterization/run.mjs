import { strict as assert } from 'node:assert';
import { setup, req, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// Z1 characterization: legacy auth/admin-user behaviour must not change while AuthEndpoints.cs
// is split into partial files.
const setupStatus = await req(OLD, '', 'GET', '/api/setup/status');
assert.equal(setupStatus.status, 200, 'setup status ' + setupStatus.text.slice(0, 200));
const setupBody = JSON.parse(setupStatus.text);
assert.equal(typeof setupBody, 'object', 'setup status shape');

const me = await req(OLD, c.admin, 'GET', '/api/auth/me');
assert.equal(me.status, 200, 'auth me ' + me.text.slice(0, 200));
const session = JSON.parse(me.text);
for (const field of ['id', 'username', 'displayName', 'permissionCodes']) {
  assert.ok(field in session, 'auth/me missing ' + field + ': ' + me.text.slice(0, 300));
}
assert.ok(Array.isArray(session.permissionCodes) && session.permissionCodes.includes('users.manage'), 'admin session lost users.manage');

const badLogin = await req(OLD, '', 'POST', '/api/auth/login', { username: 'q6_admin', password: 'definitely-wrong' });
assert.ok([400, 401, 423, 429].includes(badLogin.status), 'wrong password status changed: ' + badLogin.status);

const users = await req(OLD, c.admin, 'GET', '/api/admin/users?page=1&pageSize=10');
assert.equal(users.status, 200, 'admin users ' + users.text.slice(0, 200));
const userRows = JSON.parse(users.text);
assert.ok(Array.isArray(userRows), 'admin users is not an array');

const duplicate = await req(OLD, c.admin, 'POST', '/api/admin/users', {
  username: 'q6_admin', displayName: 'duplicate', password: 'Q6-StrongPass!', permissionCodes: ['dashboard.read'],
});
assert.equal(duplicate.status, 409, 'duplicate username status changed: ' + duplicate.status + ' ' + duplicate.text.slice(0, 160));

const permissions = await req(OLD, c.admin, 'GET', '/api/admin/permissions');
assert.equal(permissions.status, 200, 'permissions endpoint ' + permissions.text.slice(0, 200));
assert.ok(Array.isArray(JSON.parse(permissions.text)), 'permissions shape changed');

const logout = await req(OLD, c.admin, 'POST', '/api/auth/logout');
assert.equal(logout.status, 200, 'logout status ' + logout.status);
const afterLogout = await req(OLD, c.admin, 'GET', '/api/auth/me');
assert.ok([401, 403].includes(afterLogout.status), 'logged-out cookie still works: ' + afterLogout.status);

console.log(JSON.stringify({ suite: 'z1-auth-characterization', ok: true, cases: 7 }));
