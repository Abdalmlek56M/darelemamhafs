# Checkpoint: Final UI/QA review 1.0

Date: 18 Nov 2026

## Done

- Reviewed the admin console at 1440px and 390px: dashboard, notifications, teacher requests, students, teachers, notes, circles, schedule/teacher attendance, payments, users and system. No root horizontal overflow remained.
- Fixed the payments page stats grid: the four finance cards now use a dedicated four-column layout on desktop and two columns on mobile.
- Reviewed the teacher portal at 1440px and 390px: home, live session, roster, notifications, requests, account, weekly calendar and history.
- Fixed the false "no circles today" empty state. The home screen now promotes a live, awaiting-attendance, next or past unstarted slot before showing an empty state, and only reports "no circles" when the day truly has none.
- Fixed the "1 حلقات" label and made the remaining-sessions title depend on whether the featured slot is current/upcoming or already past.
- Fixed the live-session header to use 12-hour times and changed the early-finish chip from "قبل الموعد" to "المتبقي" while the session is still running.
- Reviewed the supervisor workspace at 1440px and 390px: overview, students, circles, teachers, notes, requests, attendance, absences, unpaid, the more sheet, the notification drawer, circle detail and the add-students modal.
- Removed the duplicated attendance date: the supervisor attendance page showed both an Arabic formatted date and the native date input.
- Verified the supervisor circle detail has no horizontal overflow and that per-student attendance details, roster and add-students picker render correctly.
- Completed a 12-hour time sweep. Remaining 24-hour values were removed from circle schedules, circle details, student attendance, student history, teacher history and the supervisor overview.
- Fixed report session matching for legacy rows without a schedule-slot ID. Keys now compare normalized 24-hour values instead of mixing 12-hour display strings with 24-hour source values.
- Audited receipts end to end on disposable QA data: multipart payment creation with image receipt, authenticated preview, download response, student financial history and the receipt modal all worked. The QA payment/container was removed afterwards.
- Installed 17 curated project skills under `.opencode/skills` after running the skill security auditor. `getsentry/security-review` was excluded because of two false-positive critical findings in explanatory attack text; the existing security skill is used instead.

## Deployment

- Commit `54d0fb2` pushed to `main` and deployed to `https://dar-elemam-hafs.rigxhardware.com`.
- Pre-deploy DB backup: `dar-20261118-215031.dump`. Post-deploy DB backup: `dar-20261118-215411.dump`.
- Previous `wwwroot` retained at `/var/lib/dar/backups/frontend-` as a rollback copy.
- Live routes returned 200: `/`, `/management`, `/teacher`, `/supervisor`; the served admin bundle was `index-DOW_95cH.js`.

## Verification

- `npm run build --prefix frontend` - passed.
- `dotnet build Dar.slnx -c Release` - passed, 0 warnings, 0 errors.
- `dotnet test Dar.slnx -c Release --no-build` - 16 unit + 20 integration passed.
- QA environment used disposable PostgreSQL 17 on port 5478, legacy API 5080, new API 5081 and Vite 5173. All processes, the QA container, generated `wwwroot`, the temporary Vite proxy and the QA settings file were removed/restored before commit.

## Remaining / owner actions

- Owner: re-test saving admin permissions on the live site (the previous 502 was fixed at the Nginx layer).
- Owner: link the `asmaa` teacher account to a teacher record and grant permissions.
- Owner: change the supervisor temporary password and delete `/etc/dar/supervisor-initial-password` after finishing.
- Production E2E and the first GitHub Actions run need GitHub/owner access.
- Structural debt remains in a few files above the 400-line guideline (`SystemAdminEndpoints.Requests.cs` 511, `AuthEndpoints.cs` 505, `TeacherApp.tsx` 511). No functional gap is attached to them; split them in a dedicated refactor phase rather than mixing them with UI fixes.
- Formal PDF report sign-off by the owner is still pending.

## Decisions

- Receipts are supported for collection entries; refunds are not a separate module. Corrections use the existing soft-delete/trash path with audit, so no money is silently destroyed.
- The supervisor temporary password remains untouched until the owner confirms they have finished.
- Display times are always 12-hour via `formatTime12`; 24-hour values remain internal for date construction and input controls.
