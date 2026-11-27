# tests/lib — shared regression test library (FINAL 2.17)

One place for the production-safety guard and the pieces every suite used to copy/paste.

## Files

| File | Purpose |
|---|---|
| `index.mjs` | ESM library: target guard, PG env/psql helpers, HTTP login/request/createUser/setupAdmin helpers. |
| `guard.sh` | Same guard contract for shell wrappers (`tests/regression/**/run.sh`). |

## The guard (single source of truth)

`guardViolation(options)` is pure and returns `null` or a message; `assertSafeTargets(options)`
exits non-zero after printing `<LABEL> refusing: <reason>`.

Rules:

1. **DB name — allow-list first.** When `DAR_TEST_DB_ALLOWLIST` is set (comma list, `*` globs),
   any database whose name is not in the list is refused. Only when it is unset does the legacy
   deny-list apply (`DAR_FORBIDDEN_DB` / `DAR_FORBIDDEN_DB_NAMES`).
2. **DB host — loopback only** (plus the `DAR_FORBIDDEN_HOSTS` deny-list).
3. **URLs — loopback only** (127.0.0.1 / localhost / ::1) and never a `DAR_FORBIDDEN_HOSTS` entry.
4. **Missing DB env fails.** DB-backed suites call `assertSafeTargets({ requireDb: true })` so an
   unset `DAR_TEST_DATABASE` exits 2 with a clear message instead of silently returning green.

## Usage

ESM suite:

```js
import { assertSafeTargets, one, q, login } from '../../lib/index.mjs';
assertSafeTargets({ db: process.env.DAR_TEST_DATABASE, urls: [base], label: 'Q1_FAIL', requireDb: true });
```

CommonJS suite (`*.js`, e.g. Playwright):

```js
(async () => {
  const { assertSafeTargets } = await import('../../lib/index.mjs');
  assertSafeTargets({ db: process.env.DAR_TEST_DATABASE, urls: [BASE], label: 'P25_FAIL' });
  const { chromium } = require('playwright');
  // ...
})();
```

Shell wrapper:

```bash
. "$(cd "$(dirname "$0")/../../lib" && pwd)/guard.sh"
dar_guard_require_env Q1_FAIL DAR_TEST_DATABASE Q1_LEGACY_URL Q1_NEW_URL Q1_SETUP_TOKEN
dar_guard_targets Q1_FAIL "$DAR_TEST_DATABASE" "$Q1_LEGACY_URL" "$Q1_NEW_URL"
```

The behavioural contract is exercised by `tests/regression/test-lib-guard/run.mjs` and by
`tests/regression/safety-guard-test.sh`.
