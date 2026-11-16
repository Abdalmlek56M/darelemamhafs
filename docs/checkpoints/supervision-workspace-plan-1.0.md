# Checkpoint: Supervision Workspace Plan 1.0

Date: 16 Nov 2026

## Captured

- `docs/16-supervision-workspace-plan.md`:
  - Supervisor/secretary workspace: students, circles, teachers, attendance, notes, requests, notifications, WhatsApp, reports.
  - Teacher detail: attendance rate, hours, overtime/undertime, notes, student counts, session history.
  - Student profile: attendance, subscription status (permission-gated), notes, guardian/WhatsApp.
  - Scope by circle/teacher (`app_user_scopes`); no rows = all.
  - Financial UI disappears entirely without permission; never show zero/empty money.
  - `account.password.self` permission (default off); admin reset/grant.
  - No start before scheduled Cairo time; late start allowed.
  - Notes editable by admin/supervisor during/after submission, audited; payroll lock later.
  - Teacher weekly calendar, history, login sessions, absence/cancellation/correction requests, offline queue.
  - Admin notification center, daily alert sync, WhatsApp sender (`wa.me`, no paid API), PDF/report review.
  - Remove `v0.8.25.0`; full responsive admin/supervisor UI.
- `docs/13` §12, `docs/14` §7, `docs/10` §8 updated.

## Phases

| Phase | Scope |
|---|---|
| **A1** | financial visibility gating, self-password permission, no-early-start, version removal, clearer notes, teacher login memory |
| **A2** | scope table, scoped student/circle/teacher lists, teacher detail, notes, teacher absences, attendance pages |
| **B** | teacher calendar/history/requests, offline queue, supervisor tab permission |
| **C** | admin notification center, request review, daily sync |
| **D** | WhatsApp sender/templates, communication log, report/PDF sample/review |
| **E** | full admin/supervisor responsive UI, visual QA, E2E, release |

## Decisions / Defaults

- One supervision workspace with permission bundles; secretary is a template.
- Scope supports circle + teacher; no rows = all.
- `finance.read` hides all money; `supervisor.unpaid` and `teacher.subscriptions.read` are separate gates.
- Early start blocked; late allowed until end of day with a late record.
- WhatsApp via `wa.me`; default `+20`; no paid API.
- Teacher password self-change only with `account.password.self`; otherwise admin reset.
- PDF sample reviewed by the owner before redesign.
- Request approval: supervisor with `supervisor.attendance.requests` or admin.

## Commands

```powershell
dotnet build backend\DarEltahfeez.Api\DarEltahfeez.Api.csproj
dotnet build Dar.slnx
dotnet test Dar.slnx
npm run build --prefix frontend
npm run typecheck --prefix packages/api-client
```

```bash
sudo systemctl start dar-backup.service
# migration / publish / swap: see docs/11-deployment.md
```

## Not Started

No application code for the supervision expansion has been written. Phase A1 is the first implementation step.

## Open Questions

1. Is “secretary” a separate role name/template, or a supervisor with extra permissions? Default: one workspace, permission bundle.
2. Scope by both circle and teacher? Default: yes.
3. Early-start grace: zero (block before scheduled start); late allowed until end of day.
4. Notes after payroll lock: admin only with reason.
5. WhatsApp templates/placeholders approved? Default placeholders listed in `docs/16`.
6. PDF sample: produce existing reports first; owner approves before redesign.
