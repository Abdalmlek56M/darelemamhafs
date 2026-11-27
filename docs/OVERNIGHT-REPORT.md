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

Batch-1 full regression PASS is recorded in the batch-1 section above (41 suites, UNIT 67/67, pushed as 4166fd0).

## FINAL continuation batch 1 — pushed and verified

Batch-1 full regression on `4166fd0` (the exact commit pushed): **UNIT 67/67, 41/41 suites EXIT=0, RESULT=PASS** (including `b7-cookie-size` and `b10-cookie-secure`). Push: `1d5255b..4166fd0  main -> main`; `git ls-remote origin main` = `4166fd06cd1a027524dc1cadf49d3deeabacba99`.

## FINAL continuation batch 2 (27 Nov, pushed)

| Item | Status | Evidence / tests | NOT VERIFIED |
|---|---|---|---|
| 3. Z2 audit-insert dedup (29 sites → one writer) | done (pending full regression) | new `backend/DarEltahfeez.Api/AuditLogWriter.cs`; grep `INSERT INTO audit_log` in backend = 1 (the writer); 2 private helpers delegate; characterization suite `z2-audit-writer` (7 cases) written green pre-refactor and re-run post-refactor + 10 existing audit suites, all exit 0 on a disposable PG17; both Release builds exit 0 | full host regression + staging |
| 5. Tier 2.3 `enrollment_status_history` (migration 039) | done (pending full regression) | `database/039_enrollment_status_history.sql` (table, append-only guard, audit_log sync trigger, backfill + invariant assertions, synthetic snapshot rows, eligibility functions switched to history); comparison test `tier2-history` vs a verbatim copy of the old audit_log logic: 1,467 day cases + 72 month cases, **0 mismatches**; real migration CLI applied 001→040 on PG17 and 039 re-run is a no-op; audit_log content hash unchanged | full host regression; production migration |
| 5. Tier 2.2 pg_trgm search (migration 040) | done (pending full regression) | `database/040_search_trgm.sql` (extension + 8 GIN trigram indexes on the exact expressions); `SqlSearchPattern` escapes `\ % _`; legacy + modular student search use it; suite `tier2-search` (8 cases) proves escaped wildcard behavior + `EXPLAIN` bitmap index scans on PG17 | full host regression; production extension/index creation |
| 5. Tier 2.16/2.17 CI false-greens + shared tests/lib | done (pending full regression) | new `.github/workflows/regression.yml` with Postgres 17 service + negative "missing DB fails" checks; `ci.yml` now provides Postgres for `dotnet test` and every `tests/regression/sql/*.sql`; fixed the print-only permissions matrices, `review.mjs`, `financial_void_verify.sql`, `parity-q3`, `teacher_attendance_rate_snapshot`; 19 silent returns in .NET integration tests replaced by `IntegrationDatabase.Require()`; `tests/lib` single allow-list guard + helpers imported by 34 files; 48 node suites + 6 SQL suites wired; UI suites explicitly opt-in (`DAR_UI_SUITES=1`) and reported NOT_RUN when skipped | CI execution; Playwright UI suites (no playwright/SPA locally) |
| 8a. `deploy/update.sh` split (625 → 49-line entry + 13 libs) | done (pending full regression) | `deploy/lib/update-*.sh` ≤97 lines each; all 26 original function bodies byte-identical; CLI parity 6/6; `bash -n` 15/15 and shellcheck 0 issues; fast `shell_check` gate added to the harness | not executed on a real deploy |
| 8b + 9. deploy security fixes from self-review | done (pending full regression) | `setup-nginx.sh` certbot email from untracked `deploy/.env` (no committed real email); `setup-host-services.sh` DB name/user from `deploy/.env`; `deploy/.env.example` placeholders only; verified with stubbed runtime harness + bash -n | live host first deploy |
| 7. Z3/Z4/Z5 docs sync | done (pending full regression) | 21 files: docs rewritten/de-staled against the code (00-current-state, 02-architecture, 03-security, 04, 06, 08, 11, 17, 23, README/docs index, README.md, deepseek.md, staging-environment, recorder README/.env.example, 3 historical checkpoints); migration count 40; ADR 0001–0008 listed; real domain/IP/DB/password values scrubbed to placeholders | docs are source-level verified only |
| 9. Security self-review | done (report only) | 954 tracked files scanned: no live secrets/keys; doc-value leaks scrubbed; 187 endpoints / 100 mutating — every mutating endpoint has authorization or is a documented public/token-guarded one; findings recorded for owner: reset-candidates missing read/finance perms + scope (A1/A8), authenticated-only audit-events (A2), purge not owner-only (A3), users.manage can grant any permission (A9/C20), OpenAPI public on the app (A4), new API not issuing owner-only-role split; docs §19/§2 stale claims corrected | production host state, git history, CI scanner |
| .gitignore `.tmp*` | done | stray git bundle removed; `.tmp*/` pattern widened to `.tmp*` so files cannot be committed | — |

### Security review notes not fixed (owner decisions)

- A1/A8: `GET /api/admin/reset-candidates*` only requires `trash.manage`, exposes names/billing across all circles; needs read/finance perms + scoping.
- A2: `POST /api/admin/audit-events` is authenticated-only (audit pollution risk).
- A3: permanent trash purge is `trash.manage` + entity delete, not owner-only (docs claim owner-only).
- A9/C20: any `users.manage` holder can grant any permission including `users.manage`; no owner-only permission class.
- A4: `/api/openapi/v1.json` is public on the app (only unproxied by nginx today).
- C8/C9/C12/C13: no DB `statement_timeout`, no concurrency token, one `dar_app` role (no migrator/app/read-only split), Data Protection keys not certificate-protected — docs now marked as targets/gaps.

### Full regression (batch 2)

**Batch-2 verification (pushed):** full regression on `2cd9dcf` (the exact pushed commit) — **UNIT 67/67, NODE_SUITES=50, SQL_SUITES=6, RESULT=PASS**; the 14 browser/UI suites are opt-in and reported `UI_SUITES_NOT_RUN` (never green). Push: `4166fd0..2cd9dcf  main -> main`; `git ls-remote origin main` = `2cd9dcf29f681cff1a3fd84093b077c54131dbd6` (PASS).

The first batch-2 regression run (on `76efd79`) failed on 5 suites and was fixed in `2cd9dcf`: `q6-review` (new cancellation assertions needed an in-progress teacher_session), `tier2-history` (simulated pre-migration insert missed RETURNING id), `sql-financial-void` S17 (schema-only disposable DB needed the finance.edit/finance.void catalog rows seeded), and `sql-schedule-overlap` S32 + `sql-schedule-overlap-hardening` H01/H02 (assertions were written against the legacy global lock that migration 035 intentionally removed; they now assert the per-teacher lock and the removed global key). After the fix a targeted run of those 5 suites was PASS, then the full run above was PASS.



## FINAL continuation batch 3 (27 Nov 2026, owner review of 2cd9dcf)

Owner review items, all implemented failing-test-first where a behavior changed:

| Item | Status | Commit(s) | Evidence / tests | NOT VERIFIED |
|---|---|---|---|---|
| 1. 039 FKs vs retention/reset/delete | done | `2e5eb9d` | `enrollment_id` FK is now `ON DELETE CASCADE`; append-only guard allows only FK-cascade deletes (`pg_trigger_depth() > 1`); `source_audit_id` stays `RESTRICT` because audit_log is never pruned (RetentionService excludes it; reset only moves rows to trash; 015 trigger blocks audit deletes). Old single-file 039 reproduced `23503` FK violation when hard-deleting an enrollment (disposable PG17); new `tier2-history-fk` proves retention leaves audit_log untouched, audit/history remain append-only, enrollment/student hard deletes cascade, and trash move/restore keeps history + eligibility. ADR-0009 records the decisions. | production run |
| 1b. migration runtime / audit_log lock | done (measured) | `2e5eb9d` | disposable PG17 with 103k audit rows incl. 3k lifecycle: 039a 0.22s, 039b 0.31s (re-run 0.28s no-op). `039b` holds SHARE ROW EXCLUSIVE on audit_log only inside its own transaction (trigger installed in 039a first, so concurrent inserts are captured; ON CONFLICT fills old rows); readers unaffected. Production catalog estimate (metadata only, no row reads): audit_log ~514 rows / 584 kB, so expected deploy impact is sub-second. | real production deploy window |
| 2. split 039 (407 lines) | done | `2e5eb9d` | `039a` (schema/indexes/guards/sync trigger) 149 lines + `039b` (backfill/assertions/synthetic/functions) 287 lines, both idempotent and applied in order; harness migration glob letter-suffix aware; `tier2-history` re-applies both halves and proves no-op. | — |
| 3. B3 zero actual minutes = zero pay | done | `8239eee` | `Money.TryCalculateTeacherSessionPay` returns 0 payable minutes/amount for 0 actual minutes (no minimum) while 1 minute still pays 1; unit test renamed to `TeacherSessionPay_ZeroActual_PaysZero` + boundary test; frontend live preview via tested `teacherLivePayableMinutes`; end-session message updated. Stored `payable_amount` rows are not recalculated (reports/profit sum stored amounts) → historical production numbers unchanged; future zero-minute ends pay zero. Docs/ADR-0002 amendment updated. | live staging behavior |
| 4. security: reset-candidates perms/scope | done | `ce94471` | aggregate requires `students.read` + `finance.read`, paged requires the list's read permission, both apply `app_user_scopes` filter, school-wide lists fail closed for scoped users. `security-permissions` covers 403 without perms + scope filtering on seeded candidates. | live roles |
| 4. security: purge owner-only | done | `ce94471` | `DELETE /api/admin/trash/{id}` now requires `trash.manage` **and** `users.manage`; move/restore unchanged; suite: trash manager move 200 → purge 403, admin purge 200 + row gone. | live roles |
| 4. security: no permission escalation | done | `ce94471` | a users.manage holder cannot grant codes it does not hold; on update codes already present on the target are allowed so unrelated edits work. Suite: 403 for new unheld `finance.read`, 201 for held code, 200 for unchanged list, 403 for adding unheld code. | live roles |
| Tier 2.5 blobs → file storage (migration 041) | done (resize BLOCKED) | `a2a8eb2` | receipts/logo/avatars moved to content-addressed files with lazy BYTEA migration + repair + batch backfill endpoints/status; old BYTEA untouched for rollback; no list query selects blobs; `tier2-blobs` (14 cases) passed E2E on disposable PG17 + both apps. Receipt image resizing **BLOCKED**: no cross-platform image package available and NuGet cannot be added offline (documented pass-through hook, recommended SixLabors.ImageSharp). | staging/deploy media root; real resize |
| Tier 2.7 query/round-trip optimization | done | `00537e3` | legacy students/teachers/circles lists → CTE + LATERAL; session summary 159ms → 25ms; export 10 statements → 1; ScopeLoader 3 → 1 command; new-API list/detail 2 → 1. EXPLAIN proof 0 correlated SubPlans for new lists. No new migration needed. `tier2-queries` (61 cases) compares old/new shapes + plans. | real production data volumes |
| Tier 2.8–2.14 deploy hardening | done (files only) | `7fff2e2` | deploy flock, default CI/quality gate, meet-bot deploy path, real login+money smoke (0600 credentials), DB rollback script + runbook (fresh DB, never live restore, auto env revert), healthcheck Telegram/bot/LiveKit/PG/off-site/jq, nginx rate-limit+gzip, PG tuning + dar_migrator/dar_app/dar_read_only roles SQL/wrapper/runbook (not executed), LiveKit M0 gated + pinned SHA-256 + media-port opt-in + test page disabled; `tier2-deploy` contract suite + 34/34 bash -n + shellcheck. | no host execution; DB roles SQL/tuning not run; login+money smoke not E2E; LiveKit ports owner action BLOCKED |
| Tier 3.1/3.7/3.8 frontend logic | done | `f541307` | one Africa/Cairo date helper (DST/midnight boundary tests), CSV formula-injection guard, demo mode disabled in prod builds + cleared on logout, circle names scoped by teacher, PaymentDialog remaining-amount cap, StudentDialog withdrawn/archived guard, typed status/severity unions. 45 frontend test files / 152 tests, tsc + vite build pass. | browser E2E |
| Z3/Z4/Z5 docs + AGENTS/naming/runbooks/ADR index | done | docs commit | `AGENTS.md` 147 lines, docs/17-vs-23 de-duplicated, `docs/naming.md`, runbooks (deploy/rollback/rollback-db/backup-restore/incident-response/db-roles/livekit), ADR index 0001–0009, migration count enforced at **42 files / 001→041** by `docs-migration-count`, staging-environment and recorder docs synced, pay-rule + cookie + security decisions documented. | docs are source-verified only |
| harness/CI wiring | done | `031bd79` | new suites wired into `tests/run-regression.sh` (plus media env for tier2-blobs); CI regression workflow lists docs-count gate and tier2-queries. | CI execution not observed |

### Batch-3 verification

Full regression runs on the batch-3 HEAD before push; the PASS line, suite counts and SHA are in the final report. Targeted evidence: both .NET Release builds + integration/unit builds exit 0; frontend tsc + 152 tests + vite build pass; all new suites pass `node --check`; `docs-migration-count` PASS (42 files, 001→041); `bash -n` passes on the harness and every deploy script.

### Batch-3 BLOCKED / NOT VERIFIED

- BLOCKED: receipt image resizing (no cross-platform image dependency offline; hook+docs ready).
- BLOCKED (owner action): closing LiveKit ports 7881/7882 if the spike is unused; DB role split/tuning application; production deploy of migrations 039a/039b/040/041.
- Staging was **not redeployed** (still `1d5255b`); batch-1/2/3 code is on `main` only after review/push. Production untouched.
- CI workflows not executed; Playwright UI suites remain opt-in NOT_RUN; real browser E2E and live host behavior not exercised.
