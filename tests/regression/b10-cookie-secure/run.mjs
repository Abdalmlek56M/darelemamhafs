import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from '../request-workflow/common.mjs';

// FINAL B10: the session cookie used to be marked Secure whenever the app ran outside the
// Development environment. Staging is Production code served over plain HTTP, so the browser
// dropped the cookie and every request after "remember me" login returned 401. The cookie must
// follow the request scheme: plain HTTP -> not Secure, and production nginx (which always sends
// X-Forwarded-Proto: https and redirects :80 -> :443) -> Secure.
const appDir = process.env.DAR_LEGACY_APP_DIR;
const conn = process.env.DAR_TEST_DATABASE;
assert.ok(appDir, 'DAR_LEGACY_APP_DIR is required');
assert.ok(conn, 'DAR_TEST_DATABASE is required');
const password = process.env.Q6_PASSWORD || 'RegressionStrong!';
const c = await setup();

const port = 6197;
const base = `http://127.0.0.1:${port}`;
const keys = mkdtempSync(join(tmpdir(), 'b10-keys-'));
const child = spawn(process.env.DOTNET_HOST_PATH || 'dotnet', ['DarEltahfeez.Api.dll'], {
  cwd: appDir,
  env: {
    ...process.env,
    ASPNETCORE_ENVIRONMENT: 'Production',
    ASPNETCORE_URLS: base,
    ConnectionStrings__DarDatabase: conn,
    Auth__SetupToken: 'b10-setup-token',
    Auth__RateLimit__PermitLimit: '10000',
    Database__ApplyMigrationsOnStartup: 'false',
    DataProtection__KeysPath: keys,
    TZ: 'UTC',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

async function login(extraHeaders) {
  return fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ username: 'q6_admin', password }),
  });
}
function setCookieOf(response) {
  const values = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')];
  return values.filter(Boolean)[0];
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(base + '/health/ready');
      if (response.status === 200) { ready = true; break; }
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'production-env legacy app did not become ready: ' + output.slice(-800));

  const plain = await login({});
  assert.equal(plain.status, 200, 'plain-http login status');
  const plainCookie = setCookieOf(plain);
  assert.ok(plainCookie, 'plain-http login must set the session cookie');
  assert.ok(
    !/;\s*secure/i.test(plainCookie),
    'over plain HTTP the session cookie must not be Secure; the browser drops Secure cookies on http');

  // Production nginx always forwards the original scheme as https.
  const proxied = await login({ 'X-Forwarded-Proto': 'https' });
  assert.equal(proxied.status, 200, 'proxied-https login status');
  const proxiedCookie = setCookieOf(proxied);
  assert.ok(proxiedCookie, 'proxied-https login must set the session cookie');
  assert.ok(
    /;\s*secure/i.test(proxiedCookie),
    'behind the HTTPS proxy (X-Forwarded-Proto: https) the session cookie must remain Secure');

  const me = await fetch(base + '/api/auth/me', { headers: { cookie: plainCookie.split(';')[0] } });
  assert.equal(me.status, 200, 'plain-http session must authenticate on the next request');

  console.log(JSON.stringify({ suite: 'b10-cookie-secure', ok: true, cases: 5, seededAdmin: Boolean(c.admin) }));
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 2000));
  if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(keys, { recursive: true, force: true });
}
