import { strict as assert } from 'node:assert';
import { assertSafeTargets, psql } from '../../lib/index.mjs';

// FINAL 1.15: OAuth state nonces are consumed exactly once in the database.
const conn = process.env.DAR_TEST_DATABASE || '';
assertSafeTargets({ db: conn, requireDb: true, label: 'TIER1-OAUTH_FAIL' });
const query = (sql) => psql(conn, sql);

assert.equal(query("SELECT to_regclass('public.meet_oauth_states') IS NOT NULL;"), 't', 'meet_oauth_states table is missing');
const nonce = crypto.randomUUID();
assert.equal(query(`INSERT INTO meet_oauth_states(nonce, consumed_at) VALUES('${nonce}', now()) ON CONFLICT (nonce) DO NOTHING RETURNING nonce;`).length, 36, 'first consume failed');
assert.equal(query(`INSERT INTO meet_oauth_states(nonce, consumed_at) VALUES('${nonce}', now()) ON CONFLICT (nonce) DO NOTHING RETURNING nonce;`), '', 'replayed nonce was consumed twice');
query(`DELETE FROM meet_oauth_states WHERE nonce='${nonce}';`);
assert.equal(query(`SELECT count(*) FROM meet_oauth_states WHERE nonce='${nonce}';`), '0', 'cleanup failed');

console.log(JSON.stringify({ suite: 'tier1-oauth-state', ok: true, cases: 2 }));
