import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { setup, one, q, req, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.3: the legacy catalog (served to the frontend), the modular catalog and the
// frontend keys must be one identical permission set, and meet.bot.control must be grantable.
function parseCodes(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = endMarker ? text.indexOf(endMarker, start) : -1;
  const section = start >= 0 ? text.slice(start, end >= 0 ? end : undefined) : text;
  return [...section.matchAll(/\("([a-z][a-z0-9._]+)"/g)].map((match) => match[1]);
}
const legacySource = readFileSync('backend/DarEltahfeez.Api/Security.cs', 'utf8');
const modularSource = readFileSync('src/Common/Dar.Common/Domain/PermissionCodes.cs', 'utf8');
const legacyCodes = new Set(parseCodes(legacySource, 'public static readonly (string Code, string NameAr)[] All ='));
const modularCodes = new Set(parseCodes(modularSource, 'public static readonly (string Code, string NameAr)[] All ='));
assert.deepEqual([...legacyCodes].sort(), [...modularCodes].sort(), 'legacy and modular permission catalogs drifted');
assert.ok(legacyCodes.has('meet.bot.control'), 'legacy catalog cannot grant meet.bot.control');

const frontendSource = readFileSync('frontend/src/domain/permissions.ts', 'utf8');
const namesSection = frontendSource.slice(frontendSource.indexOf('export const knownPermissionNames'));
const frontendNameCodes = new Set([...namesSection.matchAll(/'([a-z][a-z0-9._]+)':/g)].map((match) => match[1]));
assert.deepEqual([...frontendNameCodes].sort(), [...legacyCodes].sort(), 'frontend permission names drifted from the server catalog');
const groupSection = frontendSource.slice(frontendSource.indexOf('permissionGroups'), frontendSource.indexOf('knownPermissionNames'));
const groupCodes = new Set([...groupSection.matchAll(/'([a-z][a-z0-9._]+)'/g)].map((match) => match[1]));
for (const code of groupCodes) assert.ok(legacyCodes.has(code), 'frontend permission group has an unknown code: ' + code);
for (const code of legacyCodes) assert.ok(frontendNameCodes.has(code), 'frontend has no label for ' + code);

// The endpoint used by the Users screen must serve exactly the same codes.
const served = await req(OLD, c.admin, 'GET', '/api/admin/permissions');
assert.equal(served.status, 200, 'permissions endpoint status');
const servedCodes = new Set(JSON.parse(served.text).map((item) => item.code));
assert.deepEqual([...servedCodes].sort(), [...legacyCodes].sort(), 'served permissions differ from the catalog');

console.log(JSON.stringify({ suite: 'tier1-permission-catalog', ok: true, cases: 3 }));
