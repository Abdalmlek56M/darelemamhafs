# Overnight hardening report

Updated after every commit. Rules: no deploy, no production data, full regression PASS before every push.

## Already on main (`main` was `4f65a76` when the overnight run started)

Tier 0 complete (0.1–0.12; commits `79e9749`, `9895d35`, `da4af74`, `9113943`, `bc1217e`, `dfd8405`, `e6dcf66`, `fb0eaa1`, `63e723b`, `966ac8d`, `e334c76`), Z6 `8c99718`, Z0 `7176bdb`/`eb078da`/`4f65a76`. Last verified full regression on `4f65a76`: UNIT 51/51, frontend 68, all 20 suites PASS.

## Overnight Tier 1

| Item | Status | Commit | Tests added | NOT VERIFIED |
|---|---|---|---|---|
| 1.1 trash auto-purge never runs | done | `a28756f` | `tier1-trash-purge` (worker registered, manual trigger purges expired non-financial row) | live timer not observed |
| 1.2 backup download broken on Linux | done | `2e3b8e4` | `tier1-backup-download` (create via API → download 200 + bytes) | browser download not observed |
| 1.3 permission catalog drift / meet.bot.control | done | `17f723a` | `tier1-permission-catalog` (legacy/modular/frontend/served sets equal) | SQL seed vs code catalog still separate |
| 1.4 attendance non-partial unique | done | `0463c12`, `6c62c77` | `tier1-attendance-unique` + upsert alignment for partial index | production migration pending |
| 1.5 trashed expense edit + circle schedule PUT replace | done (audit labels/unpaid trigger were already fixed by 032/031) | `cefedff` | `tier1-circle-schedule`, `tier1-expense-trashed` | old attendance/history preserved by soft delete only |
| 1.6 audit outside money transaction | done | `4063425` | `tier1-money-audit` (rejected create writes no audit) | not run against production data |
| 1.7 pooled connection held per request | BLOCKED | — | — | broad cross-endpoint lifetime refactor, no safe harness test |
| 1.8 duplicate triggers/global lock/024 void | done | `94b17b2` | `tier1-migration-cleanup` (035 removes global lock, 031 live void) | production migration pending |
| 1.9 circle auto-link substring | done | `4acb564` | `MeetMatcherAmbiguityTests` | live calendar sync not run |
| 1.10 Telegram HTML unescaped | done | `0bcbc40` | `MeetTelegramEscapingTests` | live Telegram delivery not observed |
| 1.11 student joined date browser clock | done | `63c15ae`, `9d9ae6a` | `tier1-student-joined` | existing students unchanged |
| 1.12 unique race 500 | done | `6bc649b` | `tier1-unique-race` (parallel creates no 500, one row) | no production load test |
| 1.13 teacher end-session state machine | PARTIAL | `022e28a` | `tier1-notification-sync` (resolved item stays resolved) | end-session overwrite/absent list/correction state machine blocked on recorder contracts |
| 1.14 recording partial status | BLOCKED | — | — | `partial` state exists; artifact-loss on failure needs external recorder/upload contract |
| 1.15 OAuth replay/revoke, OTP race, SMTP queue | PARTIAL | `1ba3a48` | none (identity API not HTTP-testable offline) | OTP consume is atomic now; OAuth revoke/state and SMTP queue blocked (Google creds + queue design) |
| 1.16 migration checksum CRLF | done | `08ef3c8` | `MigrationChecksumTests` | production ledger not re-checked |
| 1.17 pagination envelopes/tie-break | PARTIAL | `e2b47bc` | deterministic `id` tie-break in Secretariat students | unifying two envelopes blocked on contract decision |
| 1.18–1.25 meet recorder/bot | BLOCKED | — | — | recorder repo/runtime outside this repo; offline |

Batch commits also include suite wiring/report: `7d0d8eb`, `47a9674`, report commits.


## Recorder hardening (1.18-1.25)

| Item | Status | Commit | Tests | NOT VERIFIED |
|---|---|---|---|---|
| 1.18 meet link before launch/exact host | done | `a35a76e` | `link.test.ts` | live Meet not run |
| 1.19 status retry + local outbox | done | `9946cfa` | `outbox.test.ts` | live API outage not run |
| 1.20 wav delete/disk check/HLS retention | done | `4b6264f` | `retention.test.ts`, `captureArgs.test.ts` | real recording not run |
| 1.21 idle consecutive confirmations | done | `9f6efbe` | `idle.test.ts` | live participant UI not run |
| 1.22 restrict/configurable auto-admit | done | `a053e1b` | `admit.test.ts` | live admit UI not run |
| 1.23 wire state machine + tests + CI | done | `1aa10a7` | state tracker/config/poller/capture tests, CI job | CI run not observed |
| 1.24 startup recovery + automation flag | done | `ce59134` | retention tests, README risk note | server .runtime dirs not observed |
| 1.25 nginx /internal 404 | done | `0d8309c` | `bash -n setup-nginx.sh` | live nginx not reloaded |


## Tier 1 completion batch

| Item | Status | Commit | Tests | NOT VERIFIED |
|---|---|---|---|---|
| 1.13 end-session/absent state | done (correction edges blocked) | `810ce40` | `tier1-teacher-state` | correction-request edge cases remain blocked |
| 1.15 OAuth state replay + revoke + SMTP queue | done (offline) | `abad774` | `MeetOAuthRevokeTests`, `EmailQueueTests`, `tier1-oauth-state` | live Google/SMTP not run |
| 1.17 pagination envelope unify | done (client boundary) | `f6cb23e` | `pagination.test.ts` | backend response shapes not migrated |
| migration 034 safety | done | `cb394c7` | `tier1-migration-034` | production migration not run |


## Z2 (characterization first)

| Item | Status | Commit | Tests | NOT VERIFIED |
|---|---|---|---|---|
| Z2 server-only money (remove frontend profit formulas/fallback) | done | `0c13823` | `tier1-profit-server` + frontend build/tests | no browser E2E of the dashboard |
| Z2 one sleep helper in recorder | done | `9586de5` | recorder typecheck/tests | none |


## Z1 (characterization first)

| Item | Status | Commit | Tests | NOT VERIFIED |
|---|---|---|---|---|
| Z1 characterization: AuthEndpoints.cs | in progress | pending | `z1-auth-characterization` | browser E2E not run |
| Z1 characterization: MeetBotJobRepository.cs | in progress | pending | `z1-bot-repo-characterization` | real bot not run |
| Z1 characterization: teacherTypes.ts | done (split 152/97/198 + barrel) | pending | typecheck + ``teacherTypes.characterization.test.ts`` | type-only |
| Z1 characterization: useDarApplication.ts / TeacherApp.tsx | tests added | pending | ``useDarApplication.characterization.test.ts``, ``TeacherApp.characterization.test.tsx`` | split not started |


## Z1 splits / Tier2 continuation

| Item | Status | Commit | Tests | NOT VERIFIED |
|---|---|---|---|---|
| Z1 split teacherTypes.ts | done | `edcea0b` | typecheck + characterization | type-only |
| Z1 split MeetBotJobRepository.cs | done | `134b73f` | `z1-bot-repo-characterization` | real bot not run |
| Z1 split AuthEndpoints.cs | done | `cc8ff3d` | `z1-auth-characterization` | browser E2E not run |
| Z1 split useDarApplication.ts / TeacherApp.tsx | REMAINING | — | characterization render tests added | split not done (too risky without full hook/component tests) |
| Tier2 2.6 single meet session cap | done | pending | `tier2-meet-cap` | production migration pending |
| Tier2 2.15 remove dead Docker/Caddy files | done (shared helper pending) | pending | CI shell checks | helper library still TODO |
| Tier2 2.4 money-linked communication retention | done | `4d9df55` | `tier2-retention` | production retention not run |


## Docs (Z3/Z5) and Z4 partial

| Item | Status | Commit | Tests | NOT VERIFIED |
|---|---|---|---|---|
| Z3 current-state migration count + security section 26 | in progress | pending | docs review | full Z3 rewrite remaining |
| Z5 recorder README networking/deps | in progress | pending | docs review | final recorder env docs remaining |
| Z4 deepseek current hardening state + remove live IP/hostname | in progress | pending | `repo-secrets` still to run | full Z4 rewrite remaining; real-domain request conflicts with the 0.10 scrub decision |


## Staging deployment and Z1 completion

| Item | Status | Commit/deployed SHA | Evidence |
|---|---|---|---|
| Staging environment (separate DB/dirs/ports/vhost/basic auth, ZZ-TEST only) | done | deployed `eb2a0a4` | `/health` `/management` `/teacher` `/api/v1/ping` 200; `/internal/` 404; production untouched |
| Testing Library + jsdom | done | `63f7e83` | frontend 24 files / 72 tests PASS |
| Z1 split SystemAdminEndpoints.cs (401→38 + partials) | done | `627c620` | full regression PASS e4a9ec6 |
| Z1 split SystemAdminEndpoints.Requests.cs (408→116 + partials) | done | `0175787` | full regression PASS e4a9ec6 |
| Z1 split MeetCalendarRepository.cs (424→236+200) | done | `948678e` | full regression PASS e4a9ec6 |
| Z1 split TeacherApp.tsx (532→8+378+220) | done | `d788731` | RTL characterization PASS |
| Z1 split useDarApplication.ts (570→12+241+276+275) | done | `7520ced` | RTL characterization PASS |
| Z2 policy registration + CairoTime dedup | in progress | `8924e7a` | targeted regression pending/full regression pending |
| Z2 audit-insert SQL unification (29 copies) | REMAINING | — | not started |
| Z2 remaining helper duplication | REMAINING | — | — |

## NOT VERIFIED (all Tier-1 work)

- No deployment; production timers, systemd units, migration 034/035, real backups, real browser downloads and live Telegram/Google/recorder flows were not exercised.
- No production data was read or written by tests (harness uses disposable DB only).

## Remaining (not reached tonight)

- Tier 1 blocked items 1.7, 1.13 (remaining sub-items), 1.14, 1.15 (remaining), 1.17 (unification), 1.18–1.25.
- Z1 (split files >400 lines, de-duplicate application layer) and Z2 (characterization tests first, remove the frontend money-calculation fallback).
- Tier 2 (database/scale/deploy/CI), Tier 3 (frontend/CSS/UI), Z3 (docs/ADRs), Z4 (deepseek.md full rewrite), Z5 (meet README/env).

## BLOCKED summary

As listed in the table; no item was blocked without a reason. Overnight time/regression budget ended before Tier 2/3/Z1/Z2/Z3-5.

## FINAL continuation (27 Nov 2026, starting from `1d5255b`)

| Item | Status | Commit(s) | Evidence / tests | NOT VERIFIED |
|---|---|---|---|---|
| 0. staging: remove `X-Setup-Token` header | done (staging only, no repo commit) | — | vhost has 0 token header lines, `nginx -t` OK, reload rc=0; `POST /api/setup/admin` without token = **403** (token still required); `/health=200`, setup status `needsInitialAdmin=false`; `/srv/dar-staging/STAGING.md` updated | browser re-test by owner |
| B7 (cookie size) failing test | done | `c7bad78` | `tests/regression/b7-cookie-size` on test-only HEAD: `EXIT=1`, "admin session cookie is 10881 bytes across 4 Set-Cookie header(s) with 200 permissions (limit 1500)" | — |
| B7 slim admin cookie (permissions out of ticket) | done | `f750897` | after fix: `b7-cookie-size EXIT=0`, `RESULT=PASS`, `{"ok":true,"cases":6,"cookieBytes":614,"cookieHeaders":1,"permissions":200}`; ADR-0008; docs/03-security §27 | staging not redeployed; real browser not exercised |
| B10 (Secure cookie on http) failing test | done | `166f885` | `tests/regression/b10-cookie-secure` on test-only HEAD: `EXIT=1`, "over plain HTTP the session cookie must not be Secure" | — |
| B10 scheme-aware Secure flag | done | `73780bf` | after fix: `b10-cookie-secure EXIT=0`, `RESULT=PASS`, `{"ok":true,"cases":5}`; production nginx scheme/redirect verified read-only on the server; docs/03-security §28 | real production HTTPS browser not exercised |
| B1/B2/B4/B5/B9/B11 UI bugs | done | `32dbfa4` | frontend `npm test`: 31 files / 89 tests PASS (baseline 24/72); `tsc -b --force` exit 0; `npm run build` OK; the 11 new/updated behavior tests failed against the old code first | supervisor/teacher browser flows after a staging redeploy |
| B3 zero-minute pay minimum | NOT IMPLEMENTED (owner decision) | — | — | owner will decide |

### AllScope answer (item 2 question)

`ScopeLoader.LoadAsync` returns `AccessScope.AllScope` in two cases (src/Common/Dar.Common/Permissions/ScopeLoader.cs):

1. `principal.HasClaim("permission", "users.manage")` — effectively an administrator capability: a holder can create users, grant any permission and reset passwords, so it can already self-escalate; treating it as all-scope adds no new privilege, but it should be documented as an **admin-only** permission, not a normal supervisor one.
2. **Any account with no rows in `app_user_scopes`** (line 30) — this is a fail-open default: a supervisor/teacher account that was never assigned scopes sees the whole dataset. This contradicts the deny-by-default rule (FINAL 0.6 for the legacy filter) and should become deny/empty scope or an explicit `all` scope row; it needs a behavior decision + test, so it is recorded as **REMAINING** rather than changed silently.

### Full regression

FINAL batch-1 full regression is run on the commit that contains this section; the PASS line and SHA are attached to the final report and to the next report update.
