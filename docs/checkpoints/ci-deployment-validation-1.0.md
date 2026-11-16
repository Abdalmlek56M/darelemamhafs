# Checkpoint: CI + Deployment Validation

Date: 16 Nov 2026

## Done
- CI backend job now builds **both**:
  - `backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj` (legacy)
  - `Dar.slnx` (new solution)
- CI still runs `dotnet test Dar.slnx`.
- Added a `deployment` job that validates `deploy/docker-compose.yml` with `docker compose config`.
- Roadmap updated:
  - test projects + CI test run checked;
  - Docker images + deploy script checked.
- Gap audit updated:
  - P1-14 backup: cross-platform path + Linux client implemented; offsite/restore drill pending.
  - P1-19 health: new API has live/ready; legacy still needs split health.
  - P1-20 CI: workflow extended; first GitHub run still pending.

## Verification
- Local build gate: legacy 0/0, `Dar.slnx` 0/0, 12 unit + 5 integration pass, frontend build pass.
- Docker images built locally; Compose stack started and both APIs reported healthy.
- `docker compose config` validated.
- Caddy `caddy validate` could not finish locally because the image pull timed out; retry in CI/staging.

## Remaining
- First GitHub Actions run verification.
- Contract diff step.
- Caddy staging validation + real DNS/TLS.
- Offsite backup + restore drill.
- Legacy `/health/live` + `/health/ready`.
- Stale PowerShell source guards tied to the archived Test Center.
