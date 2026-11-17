# Checkpoint: Public Homepage + /management 1.0

Date: 17 Nov 2026

## Done

- Added a public homepage at `/`:
  - Branding fetched from `/api/branding`.
  - Clear entry cards for **لوحة الإدارة** (`/management`), **بوابة المعلمة** (`/teacher`) and **مساحة الإشراف** (`/supervisor`).
  - Privacy/scope summary strip and responsive mobile layout.
- Moved the admin SPA entry to `/management`; teacher/supervisor routes unchanged.
- Verified live:
  - `/` → 200 and renders the homepage with “دخول الإدارة”.
  - `/management` → 200 and renders the admin login.
  - `/teacher` → 200; `/supervisor` → 200.
- No backend/schema change; frontend-only deploy.

## Pending

- Admin console visual parity with the supervisor workspace.
- Settings-controlled WhatsApp templates and control of messages above teacher notes.
- Teacher UI parity on all devices.
- Full file/folder/OOP refactor and admin 250/125 audit.
- Permanent integration tests and admin permissions 502 re-test after the Nginx buffer fix.
