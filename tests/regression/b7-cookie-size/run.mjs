import { strict as assert } from 'node:assert';
import { setup, one, q, OLD, req } from '../request-workflow/common.mjs';

// FINAL B7: the legacy admin cookie must not carry one claim per permission. It used to hold
// every permission code, so the session cookie was ~4 KB with the 65-code catalog and grows
// linearly (with 200 codes it is split into several 4 KB chunk cookies by the cookie manager,
// ~11 KB total). Permissions are reloaded from the database on every request
// (AuthEndpoints.ValidatePrincipalAsync), so the ticket only needs identity, display name and
// session version.
const c = await setup();
const adminId = c.adminId;

one("INSERT INTO user_permissions(user_id, permission_code) " +
  "SELECT " + q(adminId) + ", 'probe.cookie.' || g FROM generate_series(1, 135) AS g " +
  "ON CONFLICT DO NOTHING;");
const total = Number(one("SELECT count(*) FROM user_permissions WHERE user_id=" + q(adminId) + ";"));
assert.equal(total, 200, 'test fixture must grant exactly 200 permissions, got ' + total);

const password = process.env.Q6_PASSWORD || 'RegressionStrong!';
const login = await fetch(OLD + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'q6_admin', password }),
});
assert.equal(login.status, 200, 'login status');
const setCookies = (login.headers.getSetCookie
  ? login.headers.getSetCookie()
  : [login.headers.get('set-cookie')]).filter(Boolean);
const adminCookies = setCookies.filter((value) => value.startsWith('DarEltahfeez.Admin'));
assert.ok(adminCookies.length > 0, 'login must set the admin cookie');
const cookieBytes = adminCookies.reduce((sum, value) => sum + value.length, 0);
assert.ok(
  cookieBytes < 1500,
  'admin session cookie is ' + cookieBytes + ' bytes across ' + adminCookies.length +
  ' Set-Cookie header(s) with 200 permissions (limit 1500); ' +
  'permissions must be read from the database instead of being embedded in the ticket');
const cookieHeader = adminCookies.map((value) => value.split(';')[0]).join('; ');

const me = await req(OLD, cookieHeader, 'GET', '/api/auth/me');
assert.equal(me.status, 200, 'the slim cookie must still authenticate');
const meBody = JSON.parse(me.text);
assert.equal(
  (meBody.permissionCodes || []).length,
  200,
  'permissions must be served from the database on every request');

const protectedCall = await req(OLD, cookieHeader, 'GET', '/api/admin/permissions');
assert.equal(protectedCall.status, 200, 'claim-based authorization must use fresh database permissions');

const second = await req(OLD, cookieHeader, 'GET', '/api/auth/me');
assert.equal(second.status, 200, 'the session must survive repeated requests with the slim ticket');

console.log(JSON.stringify({
  suite: 'b7-cookie-size',
  ok: true,
  cases: 6,
  cookieBytes,
  cookieHeaders: adminCookies.length,
  permissions: 200,
}));
