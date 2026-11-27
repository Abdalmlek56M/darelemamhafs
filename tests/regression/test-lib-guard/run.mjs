#!/usr/bin/env node
// FINAL 2.17 — regression suite for the shared test library (tests/lib/).
//
// Proves the single production guard:
//   1. allows loopback URLs + a test database,
//   2. refuses a non-loopback URL,
//   3. refuses a database NAME that is not on the DAR_TEST_DB_ALLOWLIST allow-list
//      (allow-list decision, not a name blacklist),
//   4. keeps the legacy DAR_FORBIDDEN_DB deny-list as a fallback,
//   5. makes an unset DAR_TEST_DATABASE fail non-zero (lib child AND a real wired suite).
//
// The suite is DB-free and needs no running apps, so CI can always execute it.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedDbPatterns, dbName, guardViolation, parseDbConnection, pgEnv } from '../../lib/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS_ROOT = resolve(HERE, '..', '..');
const CHILD = join(HERE, 'child-guard.mjs');
const LOOPBACK_DB = 'Host=127.0.0.1;Port=5432;Database=dar_reg_test;Username=reg;Password=reg';
const LOOPBACK_URL = 'http://127.0.0.1:6171';

const failures = [];
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (error) {
    failures.push({ name, error: String((error && error.message) || error) });
    results.push({ name, ok: false, error: String((error && error.message) || error) });
    console.log('FAIL ' + name + ': ' + String((error && error.message) || error));
  }
}

// Environment for child processes: strip every guard-related variable so each case is exact.
const GUARD_ENV_KEYS = [
  'DAR_TEST_DB_ALLOWLIST',
  'DAR_FORBIDDEN_DB',
  'DAR_FORBIDDEN_DB_NAMES',
  'DAR_FORBIDDEN_HOSTS',
  'DAR_TEST_DATABASE',
  'GUARD_CHILD_DB',
  'GUARD_CHILD_URLS',
  'GUARD_CHILD_REQUIRE_DB'
];
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of GUARD_ENV_KEYS) delete env[key];
  return { ...env, ...extra };
}
function runChild(extraEnv) {
  const result = spawnSync(process.execPath, [CHILD], { env: cleanEnv(extraEnv), encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// --- pure guard unit checks -------------------------------------------------
check('parseDbConnection reads Npgsql keys case-insensitively', () => {
  const info = parseDbConnection('host=127.0.0.1; Port=5432; DATABASE=dar_reg_x; Username=u; Password=p');
  assert.equal(info.host, '127.0.0.1');
  assert.equal(info.port, '5432');
  assert.equal(info.database, 'dar_reg_x');
  assert.equal(info.username, 'u');
  assert.equal(info.password, 'p');
  assert.equal(dbName('Host=db;Database=only_name'), 'only_name');
});
check('pgEnv maps the connection string to PG* variables', () => {
  const env = pgEnv('Host=127.0.0.1;Port=5544;Database=dar_reg_y;Username=reg;Password=secret');
  assert.equal(env.PGHOST, '127.0.0.1');
  assert.equal(env.PGPORT, '5544');
  assert.equal(env.PGDATABASE, 'dar_reg_y');
  assert.equal(env.PGUSER, 'reg');
  assert.equal(env.PGPASSWORD, 'secret');
});
check('guard allows a loopback URL and a disposable test DB', () => {
  assert.equal(guardViolation({ db: LOOPBACK_DB, urls: [LOOPBACK_URL], requireDb: true }), null);
  assert.equal(guardViolation({ db: LOOPBACK_DB, urls: ['http://localhost:6170', 'http://[::1]:6170'] }), null);
});
check('guard allows localhost/no-DB suites to omit the database', () => {
  assert.equal(guardViolation({ urls: [LOOPBACK_URL] }), null);
});
check('guard rejects a non-loopback URL', () => {
  const violation = guardViolation({ db: LOOPBACK_DB, urls: [LOOPBACK_URL, 'https://staging.example.com'] });
  assert.ok(violation && /non-loopback test URL/.test(violation), 'expected non-loopback violation, got ' + violation);
});
check('guard rejects a non-loopback database host', () => {
  const violation = guardViolation({ db: 'Host=10.0.0.5;Database=dar_reg_test' });
  assert.ok(violation && /non-loopback database host/.test(violation), 'expected db host violation, got ' + violation);
});
check('guard rejects a non-allow-listed DB name via the allow-list', () => {
  const violation = guardViolation({
    db: 'Host=127.0.0.1;Database=dar_live_prod',
    allowDbPatterns: ['dar_reg_*', 'dar_ci_*']
  });
  assert.ok(violation && /allow-list/.test(violation), 'expected allow-list violation, got ' + violation);
  assert.equal(/production\/forbidden database name/.test(violation), false, 'allow-list refusal must not be a deny-list name match');
  assert.equal(guardViolation({ db: 'Host=127.0.0.1;Database=dar_reg_42', allowDbPatterns: ['dar_reg_*'] }), null);
});
check('guard falls back to the deny-list when no allow-list is set', () => {
  const previous = process.env.DAR_FORBIDDEN_DB;
  process.env.DAR_FORBIDDEN_DB = 'dar_prod_live';
  try {
    const violation = guardViolation({ db: 'Host=127.0.0.1;Database=dar_prod_live' });
    assert.ok(violation && /production\/forbidden database name/.test(violation), 'expected deny-list violation, got ' + violation);
  } finally {
    if (previous === undefined) delete process.env.DAR_FORBIDDEN_DB;
    else process.env.DAR_FORBIDDEN_DB = previous;
  }
  assert.deepEqual(allowedDbPatterns(), []);
});
check('guard requires a DB name when the allow-list is set', () => {
  const violation = guardViolation({ db: 'Host=127.0.0.1', allowDbPatterns: ['dar_reg_*'] });
  assert.ok(violation && /database name is missing/.test(violation), 'expected missing-name violation, got ' + violation);
});

// --- child-process exit-code checks ----------------------------------------
function expectChildExit(name, extraEnv, expectedStatus, pattern) {
  check(name, () => {
    const result = runChild(extraEnv);
    assert.equal(result.status, expectedStatus, 'exit status ' + result.status + ' (stderr: ' + result.stderr.trim().slice(0, 300) + ')');
    if (pattern) {
      assert.ok(pattern.test(result.stderr), 'stderr did not match ' + pattern + ': ' + result.stderr.trim().slice(0, 300));
    }
  });
}

expectChildExit('child: loopback targets pass (exit 0)', {
  GUARD_CHILD_DB: LOOPBACK_DB,
  GUARD_CHILD_URLS: LOOPBACK_URL + '\nhttp://localhost:6170',
  GUARD_CHILD_REQUIRE_DB: '1'
}, 0);

expectChildExit('child: non-loopback URL refused (exit 2)', {
  GUARD_CHILD_DB: LOOPBACK_DB,
  GUARD_CHILD_URLS: LOOPBACK_URL + '\nhttps://prod.example.invalid',
  GUARD_CHILD_REQUIRE_DB: '1'
}, 2, /refusing: non-loopback test URL/);

expectChildExit('child: DB name outside allow-list refused (exit 2)', {
  DAR_TEST_DB_ALLOWLIST: 'dar_reg_*,dar_ci_*',
  GUARD_CHILD_DB: 'Host=127.0.0.1;Database=dar_live_prod',
  GUARD_CHILD_URLS: LOOPBACK_URL,
  GUARD_CHILD_REQUIRE_DB: '1'
}, 2, /not in the DAR_TEST_DB_ALLOWLIST allow-list/);

expectChildExit('child: allow-listed DB name passes (exit 0)', {
  DAR_TEST_DB_ALLOWLIST: 'dar_reg_*,dar_ci_*',
  GUARD_CHILD_DB: 'Host=127.0.0.1;Database=dar_reg_1799',
  GUARD_CHILD_URLS: LOOPBACK_URL,
  GUARD_CHILD_REQUIRE_DB: '1'
}, 0);

expectChildExit('child: missing DAR_TEST_DATABASE refused (exit 2)', {
  GUARD_CHILD_REQUIRE_DB: '1',
  GUARD_CHILD_URLS: LOOPBACK_URL
}, 2, /DAR_TEST_DATABASE is required/);

// --- the same failure contract in a real wired suite ------------------------
check('real suite exits non-zero when DAR_TEST_DATABASE is unset', () => {
  const suite = join(TESTS_ROOT, 'regression', 'integrity-sql', 'run.mjs');
  assert.ok(existsSync(suite), 'integrity-sql suite is missing');
  const env = cleanEnv();
  delete env.DAR_TEST_DATABASE;
  const result = spawnSync(process.execPath, [suite], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'integrity-sql must fail without DAR_TEST_DATABASE');
  assert.match((result.stderr || '') + (result.stdout || ''), /DAR_TEST_DATABASE|PGDATABASE|required/i, 'the failure message must name the missing database env');
});

check('shell wrapper exits non-zero when DAR_TEST_DATABASE is unset', () => {
  const candidates = ['bash', '/usr/bin/bash', '/bin/bash'];
  const shell = candidates.find((candidate) => spawnSync(candidate, ['-lc', 'true'], { encoding: 'utf8' }).status === 0);
  if (!shell) {
    console.log('NOTE bash not available; shell-guard child check skipped (bash -n still runs in CI)');
    return;
  }
  const wrapper = join(TESTS_ROOT, 'regression', 'approval-paths', 'run.sh');
  const result = spawnSync(shell, [wrapper], { env: cleanEnv(), encoding: 'utf8' });
  assert.equal(result.status, 2, 'shell wrapper must exit 2 without DAR_TEST_DATABASE');
  assert.match(result.stderr || '', /refusing: DAR_TEST_DATABASE is required/);
});

// --- de-duplication invariant (FINAL 2.17) ---------------------------------
check('no regression suite re-implements a private copy of the target guard', () => {
  const regressionRoot = join(TESTS_ROOT, 'regression');
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(mjs|js)$/.test(entry)) files.push(full);
    }
  })(regressionRoot);
  // This suite intentionally mentions the marker strings; the shared library owns them.
  const localGuardMarkers = [/PROD_HOSTS/, /guardTargets/, /refuseTarget/, /refusing production\/live target/];
  const offenders = [];
  for (const file of files) {
    if (file === fileURLToPath(import.meta.url)) continue;
    const text = readFileSync(file, 'utf8');
    for (const marker of localGuardMarkers) {
      if (marker.test(text)) offenders.push(relative(TESTS_ROOT, file) + ' matches ' + marker);
    }
  }
  assert.deepEqual(offenders, [], 'copy-pasted guard found (import tests/lib/index.mjs instead):\n' + offenders.join('\n'));
});

// --- summary ----------------------------------------------------------------
const summary = { suite: 'test-lib-guard', ok: failures.length === 0, cases: results.length, failures, results };
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) {
  console.error('TEST_LIB_GUARD_FAIL ' + failures.map((failure) => failure.name).join(', '));
  process.exit(1);
}
console.log('TEST_LIB_GUARD_PASS');
