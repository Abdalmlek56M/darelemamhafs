import { strict as assert } from 'node:assert';
import { setup, req, NEW } from '../request-workflow/common.mjs';

const c = await setup();

async function session(cookie, portal = false) {
  const response = await fetch(NEW + '/api/v1/auth/me', {
    headers: { cookie, ...(portal ? { 'X-Dar-Portal': 'teacher' } : {}) },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const both = c.admin + '; ' + c.teacher;

// FINAL 0.12: two cookies may coexist in one browser; the portal marker decides identity.
const adminSession = await session(both);
assert.equal(adminSession.status, 200, 'admin bridge session');
assert.equal(adminSession.body.username, 'q6_admin', 'admin cookie must answer without the portal header');
const teacherSession = await session(both, true);
assert.equal(teacherSession.status, 200, 'teacher session with both cookies');
assert.equal(teacherSession.body.username, 'q6_teacher', 'portal header must never return the admin identity');

// Portal logout clears the portal session; the separate admin session stays alive by design.
const logout = await req(NEW, both, 'POST', '/api/v1/auth/logout');
assert.equal(logout.status, 200, 'portal logout status ' + logout.text.slice(0, 160));
const afterLogoutPortal = await session(both, true);
assert.equal(afterLogoutPortal.status, 401, 'portal request after logout must not fall back to admin, got ' + JSON.stringify(afterLogoutPortal.body));
const afterLogoutAdmin = await session(both);
assert.equal(afterLogoutAdmin.status, 200, 'admin session must remain independent');
assert.equal(afterLogoutAdmin.body.username, 'q6_admin', 'admin identity after portal logout');

// The marker alone without a portal session never authenticates through the admin bridge.
const markerWithoutSession = await session(c.admin, true);
assert.equal(markerWithoutSession.status, 401, 'portal header without a portal cookie must be 401');

console.log(JSON.stringify({ suite: 'tier0-sessions', ok: true, cases: 4 }));
