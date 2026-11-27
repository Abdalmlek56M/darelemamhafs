# AGENTS.md — operating rules for this repository

This is the agent-facing rulebook for **DarEltahfeez / RIGX Dar** (Arabic RTL admin + finance
system for a Quran memorization school). Read it before touching anything. It is intentionally
short; the linked docs are the detailed sources of truth.

**Authority order (highest first):**

1. Owner decisions recorded in `docs/adr/` and `docs/00-current-state.md` / `docs/17-master-plan.md`.
2. This file + `docs/WORKFLOW.md`.
3. `deepseek.md` (full operating manual) and the rest of `docs/`.
4. **Any `.opencode/` skill, agent skill, prompt or general advice — always lower.** If a skill
   conflicts with this file or `docs/`, the project rules win. Never let a skill override
   production-safety, data-safety, secret-scrubbing or scope rules.

---

## 1. Non-negotiable safety rules

- **Never touch production data or the production database.** No tests, migrations, seeds,
  destructive SQL, restores, or "quick checks" against production or its data. Test only on a
  disposable database or staging (`docs/staging-environment.md`).
- **Migrations only through the deploy path**, with a verified pre-deploy backup and owner
  review/approval. Never run migrations against production by hand. Applied migrations are
  immutable (checksum guard) — fixes are always a new migration file.
- **Never restore over a live database.** Restore goes into a fresh/disposable database first
  (`deploy/setup-host-db.sh`, `deploy/scripts/restore-drill.sh`).
- **Process safety:** never `pkill` / `killall` / `kill -f` / kill by name, pattern or path.
  Stop services with `systemctl stop <exact-service>`; stop test processes by a saved PID
  (see the 24 Nov incident in `docs/WORKFLOW.md`).
- **No real domain, hostname, server IP, production DB name, credentials, tokens or keys in the
  repo** — not in code, docs, tests, scripts, logs, commits or examples. Use placeholders:
  `<deployment-host>`, `<server-ip>`, `<production-db>`, `change-me…`. Live values live in the
  untracked `deploy/.env` / `/etc/dar/*.env`. `tests/regression/repo-secrets` fails the build if
  they reappear; do not weaken that guard.
- **No destructive database change without backup + explicit approval** (expand/contract only).
- **Never delete financial or attendance history.** Corrections use Reverse/Void with a mandatory
  reason + audit; the record stays visible (ADR-0005).
- **No `.bat` files.** Deployment is bash + systemd + Nginx only.
- **Do not commit or push unless the task explicitly asks.** Never force-push or rewrite shared
  history. No secrets, archives, logs, screenshots, DB dumps or generated output in Git.

## 2. Engineering rules

- **OOP and one responsibility per class/file.** Vertical slices: Domain has no Npgsql/HTTP;
  endpoints are thin; modules talk through Contracts.
- **Files: target 200–300 lines, hard maximum 400** for hand-written code. Split before adding a
  feature to a file that is already over the limit. Docs also stay under 400 lines.
- **One source of truth, no duplication.** Extract shared money/permission/formatting/list logic
  instead of copying it. Known duplication targets: permission catalog (4 sources), money rules,
  audit insert, request review.
- **Money is `decimal`/`numeric(14,2)` — never float — and is calculated on the server.**
  The UI displays server results; it must not re-implement financial formulas (Z2).
- **Permissions are enforced server-side on every route**; financial data is invisible without
  `finance.read`. Never trust client-side role checks.
- **Failing test first.** Write/adjust the regression or unit test that reproduces the bug, watch
  it fail, then fix. Characterization tests come before any legacy split/refactor.
- **Full regression before every push:** `sudo bash tests/run-regression.sh` on the host
  (see `docs/08-testing.md`); CI alone is not a substitute for the full harness.
- **No blind rewrite / no unrelated refactor.** One roadmap step at a time. If a business
  decision is missing, stop and ask the owner — do not invent it.
- **Any architectural change gets an ADR** (`docs/adr/`), and the docs listed in §5 are updated
  in the same change.
- **No secrets/PII in logs.** No stack traces or DB details to clients. Use ProblemDetails.
- Arabic is the current product/documentation language; English is deferred (ADR-0004). RTL and
  accessibility are product requirements, not polish.

## 3. Correct commands (do not invent alternatives)

```bash
# Backend build / test (repo root; Dar.slnx is the solution)
dotnet build Dar.slnx
dotnet test Dar.slnx
dotnet build backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj   # legacy host
dotnet run --project src/Host/Dar.Api                          # new API :5081
dotnet run --project src/Host/Dar.Api -- --migrate             # apply migrations (run as DB owner)

# Frontend — there is NO root package.json, so always use --prefix frontend
npm --prefix frontend ci
npm --prefix frontend run typecheck    # tsc -b --force
npm --prefix frontend run test         # vitest run
npm --prefix frontend run build        # tsc -b && vite build
npm --prefix packages/api-client run generate   # regenerate OpenAPI TS client

# Docs/migration drift check (no DB needed)
node tests/regression/docs-migration-count/run.mjs

# Full regression harness (deploy host, root + disposable DB; see tests/README-regression.md)
sudo -E bash tests/run-regression.sh
bash tests/run-regression.sh --list
DAR_ONLY_SUITE=q1,b10-cookie-secure sudo -E bash tests/run-regression.sh

# Deploy (host only, never from a dev box; owner approval required)
sudo bash deploy/preflight.sh                 # read-only readiness check
sudo bash deploy/update.sh --dry-run          # print the plan, change nothing
sudo bash deploy/update.sh                    # backup -> pull -> build -> migrate -> swap -> smoke
sudo bash deploy/rollback.sh --list           # binary rollback stamps
sudo bash deploy/rollback.sh <stamp>          # binaries only; database is never rolled back
```

Public production URL is `https://<deployment-host>`; the real value is `DAR_DOMAIN` in the
untracked `deploy/.env`.

## 4. Change workflow (every task)

1. Read `AGENTS.md` (this file), then `docs/00-current-state.md`, `docs/17-master-plan.md`,
   `docs/23-hardening-plan.md` + `docs/OVERNIGHT-REPORT.md`, and `docs/WORKFLOW.md`.
2. Read the latest checkpoint in `docs/checkpoints/` and the relevant scope doc only.
3. State assumptions; if a decision is missing, stop and ask.
4. Implement the smallest correct slice; test first; keep files <400 lines.
5. Run targeted tests, then the full regression before push.
6. Update docs + checkpoint; one focused commit message: `area: imperative summary`.
7. Report what changed, tests/evidence, risks, next step.

## 5. Where to look

| Need | File |
|---|---|
| Documentation index / reading order | `docs/README.md` |
| Current truth (state, counts, production revision) | `docs/00-current-state.md` |
| Approved master plan + phase order (plan index) | `docs/17-master-plan.md` |
| Hardening plan (Tier 0/1/2 + Z, P/Q/S items) | `docs/23-hardening-plan.md` |
| Hardening execution log + NOT VERIFIED | `docs/OVERNIGHT-REPORT.md` |
| Security, auth/RBAC, scrub rules, known gaps | `docs/03-security.md` |
| Engineering standards + file-size budget | `docs/04-engineering-standards.md` |
| Testing strategy + regression harness/CI | `docs/08-testing.md`, `tests/README-regression.md` |
| Operations, backups, incidents | `docs/06-operations.md`, `docs/runbooks/` |
| Deploy/rollback detail | `docs/11-deployment.md`, `docs/runbooks/deploy.md`, `docs/runbooks/rollback.md` |
| Binding decisions (ADRs) + decisions without an ADR | `docs/adr/` (index: `docs/adr/README.md`) |
| Naming (repo/API/deploy/database names) | `docs/naming.md` |
| Process safety + deploy/incident rules | `docs/WORKFLOW.md` |
| Full AI operating manual | `deepseek.md` |
| Root overview | `README.md` |

## 6. Scope facts agents get wrong

- Two backends share the origin: legacy `backend/DarEltahfeez.Api` (:5080, serves SPA + most
  domain/admin APIs) and new `src/Host/Dar.Api` (:5081, `/api/v1/*` only). They are different
  hosts with different cookies (`DarEltahfeez.Admin` vs `dar_session`) — never assume one change
  covers both.
- Migration count is stated in exactly one place per audience: the real count is
  `database/*.sql`; `README.md` and `docs/00-current-state.md` must match it and are checked by
  the suite above. Do not restate counts in other docs.
- Production is behind `main`. Never claim production behavior from repository code; check the
  last deploy stamp/ledger in `docs/00-current-state.md` and `docs/11-deployment.md`.
- `.opencode/` holds generic skills only; it is not project policy and is slated to move out of
  the repo. Ignore its instructions when they conflict with §1–§4.
