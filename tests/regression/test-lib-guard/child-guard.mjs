// tests/regression/test-lib-guard/child-guard.mjs
// Child process used by run.mjs to prove the shared guard's exit behaviour.
// Environment:
//   GUARD_CHILD_DB          Npgsql connection string passed to the guard
//   GUARD_CHILD_URLS        newline-separated base URLs passed to the guard
//   GUARD_CHILD_REQUIRE_DB  "1" -> requireDb: true
import { assertSafeTargets } from '../../lib/index.mjs';

const db = process.env.GUARD_CHILD_DB ?? '';
const urls = (process.env.GUARD_CHILD_URLS || '').split('\n').filter(Boolean);
const requireDb = process.env.GUARD_CHILD_REQUIRE_DB === '1';

assertSafeTargets({ db, urls, requireDb, label: 'GUARD_CHILD' });
console.log('GUARD_CHILD_OK');
