# Checkpoint: Communication Templates + Notes Banner 1.0

Date: 18 Nov 2026

## Done

- Commit `fcbf864`; migration **021** applied live (ledger 21).
- Admin settings now control the four supervisor WhatsApp templates:
  - Absence, unpaid reminder, teacher follow-up, guardian follow-up.
  - Supported placeholders: `{name}`, `{circle}`, `{brand}`.
  - Empty template falls back to the built-in default.
  - The secure `POST /api/v1/supervisor/communications/whatsapp` endpoint reads the saved template, renders the placeholders, returns the `message`, and logs the send in `communication_log` as before.
- Admin can publish a message above the supervisor “ملاحظات المعلمات” page:
  - `teacher_notes_banner` text plus `teacher_notes_banner_active`.
  - `GET /api/v1/supervisor/teacher-notes` now returns `banner` (null when disabled or empty).
  - The supervisor workspace renders it as a gold information bar on PC and mobile; demo mode shows a sample.
- Settings changes are included in the existing settings audit snapshot.
- Validation: templates ≤ 1000 characters, banner ≤ 600 characters.

## Verified

- Local: `dotnet build Dar.slnx` and legacy API build 0 warnings/0 errors; frontend `tsc -b && vite build` passed.
- Tests: `dotnet test Dar.slnx` → **16 unit + 15 integration passing**, including:
  - configured absence template renders `{name}`, `{circle}`, `{brand}` inside the returned `message`/`wa.me` href;
  - active notes banner is returned and disappears when disabled.
- Live:
  - `/health/ready`, `/`, `/management`, `/teacher`, `/supervisor` → 200.
  - Supervisor login → 200; teacher-notes responds with `banner: null` (no banner configured yet).
  - WhatsApp endpoint returned the default rendered message: `مرحبًا Asmaa Omran، نود متابعة خطة الحلقة.`
  - Supervisor PC + mobile screenshots of the notes banner (demo data) verified.
- Backups: pre-deploy `dar-20261118-001645.dump`; post-deploy `dar-20261118-002144.dump`.
- Previous artifacts retained: `api.old.20261118-001934`, `legacy.old.20261118-001934`.

## Pending

1. Owner/admin visual check of the new settings fields in `/management` → النظام والصيانة → هوية الدار (login required).
2. Admin console parity/refactor; admin teacher-notes/notification pages.
3. Teacher UI parity, file/folder/OOP refactor.
4. Admin 250/125 charge-payment UI audit and admin-wide audit.
5. Owner changes the supervisor password and deletes `/etc/dar/supervisor-initial-password`.
