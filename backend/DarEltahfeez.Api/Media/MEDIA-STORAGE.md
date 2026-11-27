# Tier 2.5 — file-backed media storage (receipts, branding logo, avatars)

Design + operations notes for moving `payments.receipt_data`, `school_settings.logo_data` and
`app_users.avatar_data` out of hot BYTEA columns. The SQL side lives in
`database/041_blob_file_storage.sql` (append-only, idempotent); this file documents the runtime
contract the deploy/runner must wire.

## Why

The three BYTEA columns above were read by every receipt download, branding fetch and avatar GET,
and were pulled into database pages/TOAST for rows that are also listed/aggregated elsewhere. New
uploads now write a file plus path/content-type/size and never write a new blob. Existing BYTEA
data is **not modified or dropped** by this phase — a later cleanup migration may remove it.

Inventory (including things that are *not* BYTEA):

| family | column | read endpoint | write endpoint |
|---|---|---|---|
| payment receipt | `payments.receipt_data` | `GET /api/payments/{id}/receipt` | `POST /api/payments/with-receipt` |
| branding logo | `school_settings.logo_data` | `GET /api/branding`, `GET /api/admin/settings` | `PUT /api/admin/settings` |
| user avatar | `app_users.avatar_data` | `GET /api/auth/profile/avatar` | `PUT /api/auth/profile/avatar` |

`students` has no photo column. `meet_media_assets` already stores recording metadata only
(`local_path`, `size_bytes`, `sha256`); the files never lived in PostgreSQL.

## Configuration (environment variables)

| env key | required | meaning |
|---|---|---|
| `Media__RootPath` | production: yes; tests: yes (see below) | Absolute persistent directory for `receipts/`, `avatars/`, `logos/`. Production value: `/var/lib/dar/media`, owned and writable by the API OS user. Unset → `<system temp>/dar-media` (development/desktop fallback; not suitable for production because temp dirs are wiped). |
| `Q6_MEDIA_ROOT` | tier2-blobs suite: optional, recommended | Test-only key consumed by `tests/regression/tier2-blobs/run.mjs`. When set it must be the **same directory** as the legacy app's `Media__RootPath` and is cross-checked against `GET /api/admin/media/status`; when unset the suite simply uses the root the app reports. The runner should still point both at one temp dir (e.g. `$APP/media`) so each run is self-contained. |

Optional tuning:

| env key | default | meaning |
|---|---|---|
| `Media__MaxReceiptBytes` | `8388608` (8 MiB) | defense-in-depth limit; the endpoint also enforces the user-facing 8 MiB rule |
| `Media__MaxAvatarBytes` | `2097152` (2 MiB) | avatar limit |
| `Media__MaxLogoBytes` | `2097152` (2 MiB) | logo limit |
| `Media__BackfillOnStartup` | `false` | run one deliberate batch backfill when the app starts |
| `Media__BackfillBatchSize` | `10` | rows per batch in backfill runs |

The media directory must be on a persistent volume and **included in the backup/restore
procedure together with the database**. The database only stores relative paths; a DB-only backup
restores rows whose files are missing (downloads then fall back to the legacy BYTEA when present,
otherwise return 404 for file-only rows).

## On-disk layout and write rules

```
<Media__RootPath>/
  receipts/<sha256[0..2]>/<sha256>.jpg|.png|.webp|.bin
  avatars/<sha256[0..2]>/<sha256>.<ext>
  logos/<sha256[0..2]>/<sha256>.<ext>
```

- Names are content-addressed (SHA-256 of the stored bytes), so writes are idempotent and a
  re-run of the migration never duplicates data.
- Writes are atomic: a same-directory `*.tmp` file is flushed and renamed onto the final name.
- On Linux files are chmod `0600` (best effort) because receipts are private financial evidence.
- The store rejects empty payloads, payloads above the per-family limit, unsafe content types,
  relative paths that are rooted/have `..`/`.` segments or escape the media root, and any root
  that is a file, a filesystem root (`/`), or not writable (fail-fast at startup).
- File uploads are written **before** the database row/update so a crash cannot leave a row that
  points at a non-existent file. The inverse (an orphaned content-addressed file if the DB write
  is rejected) is harmless and deduplicated; operators may prune unused files later.

## Read behaviour (dual read + lazy migration)

1. Path column set → read that file. If the file is unexpectedly missing **and** the legacy BYTEA
   is present, the row is re-migrated on the spot and the original bytes are served.
2. Path column NULL, legacy BYTEA present → write the file, set path/size/content type, then serve
   the original bytes (lazy migration; idempotent if two requests race).
3. Neither → the endpoint keeps its existing 404/empty response.

Receipts: content type stays exactly the stored value; a legacy NULL content type is sniffed from
the bytes (historically that request failed) and falls back to `application/octet-stream`.
Branding/avatar keep their historical `image/png` fallback for a NULL content type.
List/detail queries never select the BYTEA columns again; `hasReceipt`/`has_logo` are computed
from `(blob IS NOT NULL OR path IS NOT NULL)`.

## Deliberate backfill

- `POST /api/admin/media/backfill` (permission `settings.manage`) runs the batch migration and
  returns per-family counters. `?dryRun=true` reports how many rows would be migrated.
- `Media__BackfillOnStartup=true` runs the same batch once at startup, off the request path.
- `GET /api/admin/media/status` (permission `settings.manage`) returns the resolved root path and
  pending (BYTEA-only) row counts — use it before/after a backfill deploy.
- All paths are idempotent; re-running after a partial failure only picks up remaining rows.

## Migration and rollback

See the header of `database/041_blob_file_storage.sql` for the full deploy order and the exact
rollback statements. Summary: the migration only adds nullable columns, so rollback = redeploy the
previous app build (it reads the untouched BYTEA columns) and optionally drop the six columns and
two partial indexes. The media directory is a derived copy and can be deleted after the rollback
window; the BYTEA columns are intentionally left intact until a separate, later cleanup migration.

## BLOCKED: receipt image resizing

`IReceiptImageProcessor` is the hook called before a receipt is stored; the registered
implementation is `PassThroughReceiptImageProcessor` (returns the uploaded bytes unchanged,
`WasResized=false`). Real resizing is **BLOCKED** because the repository has no cross-platform
image codec dependency (no `Directory.Packages.props`, no ImageSharp/SkiaSharp/Magick.NET
reference) and the CI/harness restores NuGet packages offline, so a package cannot be added here.
To unblock: add an approved dependency (recommended `SixLabors.ImageSharp` 3.1.x; alternative
`SkiaSharp`), implement `IReceiptImageProcessor`, and swap the registration in `Program.cs`.
