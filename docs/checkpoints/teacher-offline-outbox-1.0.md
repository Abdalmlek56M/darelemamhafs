# Checkpoint: Teacher Offline Attendance Outbox 1.0

Date: 18 Nov 2026

## Done

- Added an IndexedDB outbox for teacher attendance:
  - stores only `sessionId`, enrollment IDs and attendance statuses — no money, names, notes or other students’ data.
  - one record per session (latest submission wins).
  - `queueAttendance`, `listQueuedAttendance`, `removeQueuedAttendance`.
- Teacher submission flow:
  - offline or network failure → save to IndexedDB and show “تم حفظ الحضور على الجهاز” with “سيُحفظ الأجر بعد الإرسال”.
  - online → normal API submission.
  - automatic flush on app load, login and `online` event; 4xx items are discarded, 5xx/network failures stay queued.
  - a fixed banner shows “لا يوجد اتصال” or “N تسجيل حضور بانتظار الإرسال”.
- The queued payload is idempotent because the server upserts attendance by session/slot/date.

## Scope note

- Session end/notes are deliberately **not** queued offline: ending a session later would record the wrong server-side time and pay. The offline queue covers attendance only; a finish note requires connectivity.

## Verified

- Frontend `tsc -b && vite build` passed.
- Live `/`, `/management`, `/teacher`, `/supervisor` → 200.
- Deployed commit `bc6b907` (frontend only).

## Next

- reports.finance + PDF sample.
- Payroll lock.
- Admin console parity.
- File/OOP refactor.
