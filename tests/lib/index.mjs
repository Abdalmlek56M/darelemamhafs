// tests/lib/index.mjs
// Shared regression-test library (FINAL 2.17).
//
// ONE production-safety guard for every regression suite:
//   * URLs must be loopback (or the exact hostname the suite explicitly expects).
//   * Database names are decided by the DAR_TEST_DB_ALLOWLIST allow-list when it is set
//     (glob patterns supported); otherwise the legacy DAR_FORBIDDEN_DB deny-list applies.
//   * Database hosts must be loopback too.
// A suite that needs the database must call assertSafeTargets({ requireDb: true }) so a
// missing DAR_TEST_DATABASE exits non-zero instead of silently passing.
//
// The module is ESM. CommonJS suites (`*.js`) import it with
//   const lib = await import('../../lib/index.mjs');
// inside their async entry point; ESM suites use a normal static import.

import { spawnSync } from 'node:child_process';

export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const DEFAULT_ALLOWLIST_ENV = 'DAR_TEST_DB_ALLOWLIST';
export const TEST_DATABASE_ENV = 'DAR_TEST_DATABASE';

// ---------------------------------------------------------------------------
// Targets, connections, allow-lists
// ---------------------------------------------------------------------------

/** Parse an Npgsql-style "Key=Value;Key=Value" connection string. Never throws. */
export function parseDbConnection(connectionString) {
  const result = { host: '', port: '', database: '', username: '', password: '', raw: connectionString || '' };
  for (const part of String(connectionString || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    const value = part.slice(index + 1).trim();
    if (key && Object.hasOwn(result, key)) result[key] = value;
  }
  return result;
}

/** Database name of a connection string ('' when absent). */
export function dbName(connectionString) {
  return parseDbConnection(connectionString).database;
}

export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host || '').trim().toLowerCase());
}

export function isLoopbackUrl(raw) {
  try {
    return isLoopbackHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

export function forbiddenHosts() {
  return (process.env.DAR_FORBIDDEN_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** Deny-listed DB names: DAR_FORBIDDEN_DB (single) and DAR_FORBIDDEN_DB_NAMES (comma list). */
export function forbiddenDbNames() {
  const names = [];
  for (const raw of [process.env.DAR_FORBIDDEN_DB, process.env.DAR_FORBIDDEN_DB_NAMES]) {
    for (const value of String(raw || '').split(',')) {
      const name = value.trim().toLowerCase();
      if (name) names.push(name);
    }
  }
  return names;
}

/** Allow-list patterns from DAR_TEST_DB_ALLOWLIST (comma list, `*` globs). */
export function allowedDbPatterns() {
  return (process.env[DEFAULT_ALLOWLIST_ENV] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function globMatch(name, pattern) {
  const target = String(name || '').toLowerCase();
  const source = String(pattern || '').toLowerCase();
  if (source === '*') return true;
  if (!source.includes('*')) return target === source;
  const escaped = source
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + escaped + '$').test(target);
}

function matchesAny(name, patterns) {
  return patterns.some((pattern) => globMatch(name, pattern));
}

// ---------------------------------------------------------------------------
// The single production guard
// ---------------------------------------------------------------------------

/**
 * Pure guard: returns a human-readable violation message, or null when the target is safe.
 *
 * @param {object} options
 * @param {string} [options.db]           Npgsql connection string to test.
 * @param {string[]} [options.urls]       HTTP base URLs to test.
 * @param {boolean} [options.requireDb]   Fail when db is empty (DB-backed suites).
 * @param {boolean} [options.requireUrls] Fail when urls is empty (HTTP-backed suites).
 * @param {string[]|null} [options.allowDbPatterns] Override the env allow-list (used by tests).
 * @param {string[]} [options.allowHosts] Extra allow-listed hostnames (production names only
 *                                       when they are explicitly listed by the caller).
 */
export function guardViolation({ db = '', urls = [], requireDb = false, requireUrls = false, allowDbPatterns = null } = {}) {
  const forbidden = forbiddenHosts();
  const info = parseDbConnection(db);
  const database = info.database;
  const databaseLower = database.toLowerCase();

  if (!db) {
    if (requireDb) {
      return TEST_DATABASE_ENV + ' is required for this suite; set it to a disposable test database';
    }
  } else {
    const allowlist = allowDbPatterns === null ? allowedDbPatterns() : allowDbPatterns;
    if (allowlist.length > 0) {
      if (!databaseLower) return 'database name is missing from ' + TEST_DATABASE_ENV + ' but ' + DEFAULT_ALLOWLIST_ENV + ' is set';
      if (!matchesAny(databaseLower, allowlist)) {
        return 'database "' + database + '" is not in the ' + DEFAULT_ALLOWLIST_ENV + ' allow-list (' + allowlist.join(', ') + ')';
      }
    } else {
      const denied = forbiddenDbNames();
      if (databaseLower && matchesAny(databaseLower, denied)) {
        return 'production/forbidden database name "' + database + '"';
      }
    }
    if (info.host) {
      const host = info.host.toLowerCase();
      if (forbidden.includes(host)) return 'production database host ' + info.host;
      if (!isLoopbackHost(host)) return 'non-loopback database host ' + info.host;
    }
  }

  if (!urls.length) {
    if (requireUrls) return 'test base URLs are required for this suite';
  }
  for (const raw of urls) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return 'invalid test URL ' + JSON.stringify(raw);
    }
    const host = url.hostname.toLowerCase();
    if (forbidden.includes(host)) return 'production hostname ' + host;
    if (!isLoopbackHost(host)) return 'non-loopback test URL ' + host;
  }
  return null;
}

/**
 * Enforce the guard. On violation the process exits non-zero (default 2) after printing
 * "<label> refusing: <reason>" on stderr — the contract safety-guard-test.sh checks.
 */
export function assertSafeTargets(options = {}) {
  const { label = 'TEST', exitCode = 2 } = options;
  const violation = guardViolation(options);
  if (violation) {
    console.error(label + ' refusing: ' + violation);
    process.exit(exitCode);
  }
}

/** Fail fast (exit 2) when mandatory environment variables are missing. */
export function requireEnv(names, label = 'TEST', message = '') {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(label + ' refusing: missing required env ' + missing.join(', ') + (message ? ' — ' + message : ''));
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL helpers (psql shell-out, same contract the suites already use)
// ---------------------------------------------------------------------------

/** Build PG* environment variables from an Npgsql connection string. */
export function pgEnv(connectionString, base = process.env) {
  const env = { ...base };
  const info = parseDbConnection(connectionString);
  if (info.host) env.PGHOST = info.host;
  if (info.port) env.PGPORT = info.port;
  if (info.database) env.PGDATABASE = info.database;
  if (info.username) env.PGUSER = info.username;
  if (info.password) env.PGPASSWORD = info.password;
  return env;
}

function runPsql(connectionString, args, stdin) {
  const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', ...args], {
    env: pgEnv(connectionString),
    encoding: 'utf8',
    input: stdin
  });
  if (result.error) throw new Error('psql could not run: ' + result.error.message);
  if (result.status !== 0) throw new Error('psql failed: ' + (result.stderr || '').trim().slice(0, 800));
  return (result.stdout || '').trim();
}

/** Run one SQL statement and return trimmed stdout (tuples-only). */
export function psql(connectionString, sqlText) {
  return runPsql(connectionString, ['-c', sqlText]);
}

/** Alias used by most suites: a single scalar/JSON query. */
export function one(connectionString, sqlText) {
  return psql(connectionString, sqlText);
}

/** Run a .sql file (or `-` for stdin) with ON_ERROR_STOP=1. */
export function psqlFile(connectionString, filePath) {
  return runPsql(connectionString, ['-f', filePath]);
}

/** Run SQL text through stdin (keeps very long statements clear). */
export function psqlStdin(connectionString, sqlText) {
  return runPsql(connectionString, ['-f', '-'], sqlText);
}

/** Quote a value as a PostgreSQL string literal. */
export function q(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Extract the cookie header value from a fetch Response (Node 18+ compatible). */
export function cookieHeaderFrom(response) {
  const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  return values.filter(Boolean).map((value) => value.split(';')[0]).join('; ');
}

/**
 * Log in and return a Cookie request-header value.
 * @param {string} base         Loopback base URL.
 * @param {string} username     Account username.
 * @param {string} password     Account password.
 * @param {string} [path]       Login endpoint; callers pick legacy or new API.
 */
export async function login(base, username, password, path = '/api/auth/login') {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const text = await response.text();
  if (!response.ok) throw new Error('login ' + username + ' failed ' + response.status + ': ' + text.slice(0, 160));
  const cookie = cookieHeaderFrom(response);
  if (!cookie) throw new Error('login ' + username + ' set no session cookie');
  return cookie;
}

/** Minimal authenticated fetch helper: returns { status, text, json }. */
export async function request(base, cookie, method, path, body, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  return { status: response.status, text, json };
}

/** Create an app user through the legacy admin API (201 created, 409 already exists). */
export async function createUser(legacyBase, adminCookie, username, permissions, options = {}) {
  const { password = 'RegressionStrong!', displayName = username, path = '/api/admin/users' } = options;
  const response = await request(legacyBase, adminCookie, 'POST', path, {
    username,
    displayName,
    password,
    permissionCodes: permissions
  });
  if (![201, 409].includes(response.status)) {
    throw new Error('createUser ' + username + ' failed ' + response.status + ': ' + response.text.slice(0, 200));
  }
  return response;
}

/** Bootstrap the very first admin through the legacy setup endpoint (200/409 tolerated). */
export async function setupAdmin(legacyBase, setupToken, { username = 'regression_admin', password = 'RegressionStrong!', displayName = 'Regression Admin' } = {}) {
  const response = await fetch(legacyBase + '/api/setup/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Setup-Token': setupToken },
    body: JSON.stringify({ username, displayName, password })
  });
  const text = await response.text();
  if (![200, 409].includes(response.status)) {
    throw new Error('setupAdmin failed ' + response.status + ': ' + text.slice(0, 200));
  }
  return { status: response.status, text };
}

export default {
  LOOPBACK_HOSTS,
  parseDbConnection,
  dbName,
  isLoopbackHost,
  isLoopbackUrl,
  forbiddenHosts,
  forbiddenDbNames,
  allowedDbPatterns,
  guardViolation,
  assertSafeTargets,
  requireEnv,
  pgEnv,
  psql,
  one,
  psqlFile,
  psqlStdin,
  q,
  cookieHeaderFrom,
  login,
  request,
  createUser,
  setupAdmin
};
