# Checkpoint: Phase 2 — Meeting Room 7 Fixes (Staging)

Date: 28 Nov 2026

## Done
- Implemented all 7 room UI/UX fixes and committed on `main` (`20ea688`):
  1. **Whiteboard fit (`360×640`, `390×844`, `1280×720`):** Wrapped `<canvas>` in `.room-wb-canvas-wrap` (`flex: 1; min-height: 0`) so it fits inside `.room-whiteboard-card` above `.room-controls`; kept `.room-wb-close` in the same header row as color/clear tools (`RoomWhiteboard.tsx`, `room.css`).
  2. **Screen share + Whiteboard switcher:** Added `.room-view-switch` tabs (`الشاشة المشتركة` / `السبورة`) in `MeetingRoomView.tsx` when both are active.
  3. **Friendly Arabic screen-share errors & silent cancel:** Extracted `getScreenShareSupport` and `formatPublishError` in `roomHelpers.ts` + `useLocalMediaControls.ts` (`NotAllowedError`/`AbortError` on picker dismissed silently; insecure/unsupported/device failures in Arabic).
  4. **End-for-everyone separation & confirmation:** Separated `.room-end-btn` with `.room-top-divider` and added `RoomConfirmDialog.tsx` (`role="alertdialog"`).
  5. **Strip participant name truncation:** Added `.room-tile-label` (`text-overflow: ellipsis`) + dedicated `.room-tile-mic` in `RoomTile.tsx` so names never overlap the mic icon.
  6. **Themed More-menu access settings:** Styled `.room-select` and `.room-toggle-row` in `RoomControlsBar.tsx` / `room.css` for dark theme and mobile readability (`16px` font, `>= 44px` targets).
  7. **Audio autoplay unlock UI:** Added `RoomEvent.AudioPlaybackStatusChanged` + `startAudio()` (now in `useAudioUnlock.ts`) and `"اضغط لتفعيل الصوت"` banner in `MeetingRoomView.tsx`.
- **Tests passed:**
  - Local & staging Vitest: `63` files / `193` tests passed (including new tests in `roomHelpers.test.ts`, `RoomWhiteboard.test.tsx`, `MeetingRoomView.test.tsx`, `useLiveKitRoom.test.tsx`).
  - Staging `.NET`: `86/86` passed, `vite build` passed, `docs-migration-count` (`46`) passed.
- **Deployed to staging ONLY (`/srv/dar-staging` at `20ea6888`):** `dar-staging-legacy` and `dar-staging-api` active; `/api/v1/rooms/config` returns `{"enabled":true}`. Production (`/opt/dar`) remains untouched at `23a1cac`.
- **Two-browser Playwright verification on staging (`stg_pw_room_e2e_v2.mjs`):**
  - Issues 1–6 all passed with screenshots `01`–`15` saved outside the repo.

## Issue #7 follow-up (diagnosis + local fix)
- **Cause of the E2E timeout: the test, not the product.** Playwright sends `page.evaluate`, `locator.waitFor`, `waitForSelector` and `screenshot` with a user gesture, which unlocks audio before it can be blocked. A raw CDP `Runtime.evaluate` does not. The fake-media flags plus microphone permission do not unlock audio by themselves.
- Headless Chromium (full and headless shell) **does** block the real `livekit-client` audio when no such call runs first; `AudioPlaybackStatusChanged(false)` fires and a click resumes playback.
- Code: unlock logic moved to `frontend/src/room/useAudioUnlock.ts` (behaviour unchanged); tests in `useAudioUnlock.test.tsx` use the real SDK `Room`; one added hook test covers "blocked while connecting".
- Repeatable proof and how to write the staging test: `tests/diagnostics/room-audio-autoplay/`.
- Local checks: Vitest `64` files / `200` tests, typecheck, vite build, `dotnet build` (solution + legacy), `docs-migration-count` (46) passed. `dotnet test` could **not** run on the Windows dev machine (test host aborts with `Access is denied`); no .NET code changed.

## Staging verification (28 Nov 2026)
- `30301d2` deployed to **staging only** (frontend only; previous `wwwroot` kept under the staging `backups/` folder). Health, `/management`, rooms config `200`; `/internal/` `404`.
- Corrected two-browser run passed (all 7 fixes). #7 at `390x844`, `360x640`, `1280x720`: no prior user activation, banner shown with the `audio` element paused, click resumed playback and hid the banner. Screenshots `01`-`17` are on the staging server in `/tmp/room_ui_shots3`.
- Temporary test accounts/room removed by the script (0 leftover rows). Production unchanged at `23a1cac`.

## Stage tiles overlap (found in the staging screenshots)
- On phones, 3+ participants made tiles overlap (grid auto rows shrank inside the fixed-height stage). Fixed in `room.css` with `grid-auto-rows: max-content`.
- `tests/diagnostics/room-stage-layout/` failed before the fix (7 of 18 cases) and passes after.

## Remaining
1. Try #7 on a real phone (iOS Safari and Android Chrome not tested).
2. Clean up `/tmp/stg_pw_room_e2e_v2.mjs`, `/tmp/stg_audio_diag.mjs`, `/tmp/room_ui_shots2` (and `room_ui_shots3` once reviewed) on the staging server.

## Decisions
- Production stays untouched at `23a1cac`; the room overhaul is staging-only until verification finishes.
