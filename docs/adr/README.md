# ADRs — index and decisions recorded without an ADR

An **ADR** (Architecture Decision Record) captures a decision that is hard to reverse or that
changes a binding rule (architecture, data, money, security, deploy/runtime). One file per
decision, immutable once accepted: to change one, add a new ADR that supersedes it (and update the
status of the old one to `Superseded by ADR-XXXX`).

**Rules:** no secrets/real hostnames/DB names in ADRs (placeholders only); any new architectural
decision gets an ADR **in the same change** as the code; update `../02-architecture.md` §9/§11 and
`../00-current-state.md` when the decision changes them. Full operating rules: `../../AGENTS.md`.

**Status vocabulary:** `Accepted` (agreed, may or may not be implemented), `Accepted — implemented`
(shipped and verified), `Accepted — partially implemented`, `Superseded by ADR-XXXX`,
`needs owner confirmation` (used only in the tables below for behavior that exists in the tree but
whose owner decision is not recorded — do not invent it).

---

## 1. Accepted ADRs (all files in this directory)

| ADR | Title | Status | Date | Implementation evidence |
|---|---|---|---|---|
| [0001](0001-frontend-react-vite.md) | Frontend: React 19 + Vite final; Next.js cancelled | Accepted | 22 Nov 2026 | `frontend/` is the live SPA; no Next.js/apps-web exists |
| [0002](0002-financial-policy.md) | Financial policy: agreed fee, no pro-rata; wage per minute, no 5-minute/5-EGP rounding | Accepted | 22 Nov 2026 | `Money`/payroll code + `tests/regression/tier0-money`, `financial-rounding`, money unit tests |
| [0003](0003-treasury-scope.md) | Treasury scope now; double-entry ledger deferred | Accepted | 22 Nov 2026 | treasury module limited to expenses; no `journal_entries` tables |
| [0004](0004-english-deferred.md) | English deferred — Arabic RTL only | Accepted | 22 Nov 2026 | no i18n infrastructure; UI Arabic-only |
| [0005](0005-reverse-void.md) | Reverse/Void instead of deleting money records | Accepted — implemented | 22 Nov 2026 | migrations 024/031, `finance.void`, `tests/regression/sql/financial_void_verify.sql` |
| [0006](0006-meet-auth-bridge.md) | Admin session bridge to the new API | Accepted — implemented | 22 Nov 2026 | `dar_admin_bridge` + shared Data Protection, Meet endpoints |
| [0007](0007-meet-recording-architecture.md) | Google Meet recording/live architecture | Accepted — partially implemented (3.0/3.1; bot 3.2+) | 22 Nov 2026 | migrations 026/036/038, `src/Modules/Meet`, recorder bot |
| [0008](0008-slim-admin-cookie.md) | Slim admin cookie: permissions read from DB per request | Accepted — implemented (B7) | 27 Nov 2026 | `SlimAdminCookieTicketDataFormat.cs`, `tests/regression/b7-cookie-size` |
| [0009](0009-enrollment-status-history-fk.md) | Enrollment status history: derived FK is `ON DELETE CASCADE` + cascade-aware append-only guard, `source_audit_id` stays `RESTRICT` (audit never pruned), migration split into 039a/039b and measured lock/runtime | Accepted — implemented (batch 3) | 27 Nov 2026 | `database/039a_*.sql`, `database/039b_*.sql`, `tests/regression/tier2-history`, `tests/regression/tier2-history-fk` |

> `../02-architecture.md` §9 keeps a broader decision log (items #1–#33, including rejected
> options). Only decisions with architecture-level trade-offs become ADR files.

---

## 2. S-1 decisions (list/pagination at scale) — made without an ADR

The S-1 scale task ("all lists paginated/searched/filtered on the server", `../23-hardening-plan.md`
§7) was implemented on `main` in the `S-1.x` commits without ADR files. The decisions below are
derived from the shipped code and regression suites — nothing is invented. If the owner wants them
locked, promote the important ones to a new ADR numbered after the highest existing ADR file
(never reuse a number) instead of leaving them here.

| # | Decision | Evidence in the tree | Status |
|---|---|---|---|
| S-1-a | One shared page contract for every list: `PageRequest` (default page size **25**, hard max **100**) and a page result with total/total-pages/has-next | `src/Common/Dar.Common/Pagination/Pagination.cs`, `src/Common/Dar.Common/Domain/PagedResult.cs`, `tests/Dar.UnitTests/Pagination/PaginationTests.cs` | Accepted (code-locked; no owner sign-off recorded) |
| S-1-b | Page metadata is returned as HTTP headers `X-Total-Count`, `X-Page`, `X-Page-Size`, `X-Truncated` (both backends); the new API also keeps its body envelope, and the frontend parses both | `src/Common/Dar.Common/Pagination/PaginationHeaderWriter.cs`, `backend/DarEltahfeez.Api/Pagination/LegacyListPagination.cs`, `frontend/src/lib/pagination.ts`, `frontend/src/services/apiClient.test.ts` | Accepted (code-locked) |
| S-1-c | Legacy endpoints stay backward compatible: they return the full list unless `page`/`pageSize` is supplied (`paged` flag) | `backend/DarEltahfeez.Api/Pagination/LegacyListPagination.cs`; `../02-architecture.md` §4 ("legacy lists remaining") | Accepted (code); remaining un-paginated legacy lists are tracked as open work, not a new decision |
| S-1-d | Every paged list ordering ends with `id` as a deterministic tie-break, so pages are stable across requests | commit `0fab175`; `tests/regression/pagination-stability/run.mjs` | Accepted (code-locked) |
| S-1-e | Totals are computed in SQL (`COUNT(*) OVER()` read by name), recomputed with a 1-row probe when a page is empty, and `X-Truncated` is computed from the page position | `PaginationRules.EnsureTotalAsync`, `PaginationRules.IsTruncated`; suites `pagination-admin`, `pagination-stability`, `supervisor-pagination` | Accepted (code-locked) |
| S-1-f | Server-side search/status filters change the **total**, not just the current page; the client resets to page 1 on filter change | `tests/regression/pagination-admin/run.mjs` (S-1.18), `pagination-stability`, `frontend/src/lib/listQuery.ts` | Accepted (code-locked) |
| S-1-g | Specialized lists may reuse the same meta parser but their own endpoint paths/queries; no endpoint may return an unbounded list once S-1 is complete | `../23-hardening-plan.md` §7 S-1; remaining legacy list endpoints noted in `../02-architecture.md` §4 | **needs owner confirmation** — the goal ("remove any endpoint that returns everything") is not fully verified yet |

---

## 3. Other decisions recorded without an ADR

Derived from `../17-master-plan.md` §1/§2, `../23-hardening-plan.md`, `../OVERNIGHT-REPORT.md`,
`../03-security.md`, `../checkpoints/` and the code. `needs owner confirmation` means the behavior
exists or is proposed but no owner decision is recorded in the repo — do not invent one.

| Decision | Recorded in | ADR | Status |
|---|---|---|---|
| Money is calculated on the server; the UI only displays server results (Z2) | `../03-security.md` §15 (FINAL 0.3); commit `0c13823` | — (could be folded into ADR-0002) | Accepted — implemented |
| Legacy session cookie `Secure` flag follows the request scheme (B10); new API stays `Secure` outside Development | `../03-security.md` §28 (FINAL B10) | — (ADR-0008 family) | Accepted — implemented |
| Staging runs on the same host with separate DB/dirs/ports/vhost, IP allow-list, no DNS/TLS, staging-only `nosecure` shim | `../02-architecture.md` §9 #33; `../staging-environment.md` | — | Accepted — implemented |
| Scheduled restore drill into disposable `dar_restore_s9_*` databases (S-9) | `../06-operations.md` §7; `deploy/scripts/restore-drill.sh`; checkpoint `s9-restore-drill-1.0.md` | — | Accepted — implemented (live drill result not verified) |
| Retire the Docker/Caddy stack; production is host Nginx + systemd + PostgreSQL only (2.15) | `../11-deployment.md` §10; `../02-architecture.md` §8.3 | — | Accepted — implemented |
| Admin vs portal identity: portal requests send `X-Dar-Portal`; portal logout clears only `dar_session` (FINAL 0.12) | `../03-security.md` §21; `frontend/src/lib/portalHeaders.ts` | — (related ADR-0006) | Accepted — implemented |
| `pg_trgm` GIN indexes for name search (migration 040) | `database/040_search_trgm.sql`; `../03-security.md` §26; suite `tier2-search` | — | Accepted — implemented; production extension/index rollout pending owner deploy approval |
| `enrollment_status_history` is the eligibility source instead of reading `audit_log` (migrations 039a/039b) | `database/039a_*.sql`, `database/039b_*.sql`; suites `tier2-history`, `tier2-history-fk` | **0009** | Accepted — implemented; production rollout pending owner deploy approval |
| One `AuditLogWriter` writer behind all audit inserts (Z2) | commit `b182eed`; `../OVERNIGHT-REPORT.md` batch 2 | — | Accepted — implemented (no ADR needed; code hygiene) |
| A user with no `app_user_scopes` rows gets **all-scope** access (documented backward-compatible behavior) | `../03-security.md` §16; `database/019_app_user_scopes.sql`; `../OVERNIGHT-REPORT.md` "AllScope answer" | — | **needs owner confirmation** — fail-open default contradicts deny-by-default; owner must choose |
| Zero actual minutes = zero pay (no 1-minute minimum), B3 | `src/Common/Dar.Common/Domain/Money.TeacherPay.cs`; `tests/Dar.UnitTests/Domain/MoneyTests.cs`; `frontend/src/teacher/teacherLivePay.ts`; docs/13 §3.6; ADR-0002 amendment | — (owner decision recorded in ADR-0002 amendment) | Accepted — implemented (batch 3) |
| DB role split: `dar_migrator` (migrations/DDL) / `dar_app` (runtime) / `dar_read_only` (reporting) | `../runbooks/db-roles-and-tuning.md`; `../deploy/sql/db-roles.sql`; `../deploy/setup-host-db-roles.sh` | — | Scripts ready, **NOT applied** to any host — applying the split is an owner action (`needs owner confirmation`); the live host still uses one `dar_app` role |
| Turnstile activation/keys, SMTP provider for OTP, step-up scope, `__Host-` cookie prefix, antiforgery token | `../03-security.md` §10; `../06-operations.md` §13 Open | — | Open — no decision yet (not "made without ADR") |

---

## 4. Adding an ADR

1. Use the next free number after the highest existing ADR file and a short kebab-case filename
   (`NNNN-<topic>.md`; check `docs/adr/` first — never reuse or renumber an accepted ADR).
2. Structure: title, `**Status:**`, `**Date:**`, `**Decider:**`, `**Related:**`, then
   `## Context`, `## Decision`, `## Consequences` (positive/negative), `## Alternatives considered`,
   `## References` (docs/checkpoints/commits), `## Implementation & verification` (tests/SQL).
3. Add a row to §1 and remove the matching row from §3 if it was tracked there.
4. Update the docs that state the decision (`../02-architecture.md` §9/§11, and `../00-current-state.md`
   if state changes) in the same change; never write live secrets/domains/DB names.
5. A superseded ADR is never edited — add the new ADR and mark the old one
   `Superseded by ADR-XXXX`.
