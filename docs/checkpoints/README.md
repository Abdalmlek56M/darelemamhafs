# Checkpoints Index

> Every completed step gets a checkpoint. If a step is not checked, it is not done.

| Phase | Checkpoint | Status |
|---|---|---|
| 0.1 | [Foundation docs + skill](0.1-foundation.md) | ✅ |
| 0.2 | [Intake](0.2-intake.md) | ✅ |
| 0.3 | [Baseline](0.3-baseline.md) | ✅ (screenshots pending) |
| 0.4 | [Audit](0.4-audit.md) | ✅ |
| 0.6 | [Legacy docs consolidation](0.6-legacy-docs.md) | ✅ |
| 0.7 | [Git baseline](0.7-git-baseline.md) | ✅ pushed |
| 1.1 | [P0 guards](1.1-p0-fixes.md) | 🟡 partial |
| 1.2 | [Remove `.bat`](1.2-remove-bat.md) | ✅ |
| 2.1 | [Solution foundation](2.1-solution.md) | ✅ |
| 2.3 | [Identity](2.3-identity.md) | 🟡 first slice |
| 2.4 | [Database + migration runner](2.4-database.md) | ✅ |
| 2.5 | [API contract + generated TS client](2.5-contract.md) | ✅ |
| 3.1 | [Secretariat — students](3.1-secretariat.md) | 🟡 first slice |
| 1.5.1 | [Legacy backend split — first slice](legacy-split-0.1.md) | ✅ |
| 1.5.2 | [DomainEndpoints split](legacy-split-1.1.md) | ✅ |
| 1.5.3 | [SystemAdminEndpoints split](legacy-split-1.2.md) | 🟡 partial |
| 1.5.4 | [Frontend selectors](legacy-split-2.1.md) | ✅ |
| 1.5.5 | [Frontend hook split](legacy-split-2.2.md) | ✅ |
| 1.5.6 | [SystemAdminView split](legacy-split-2.3.md) | ✅ |
| 1.6.0 | [Full code review](code-review-1.0.md) | ✅ |
| 1.6.1 | [P0 hardening: purge, audit, restore](p0-hardening-1.0.md) | ✅ |
| 1.7.0 | [P1 auth hardening](p1-auth-hardening-1.0.md) | ✅ |
| 1.7.1 | [Trash permissions + OTP pepper](p1-trash-and-otp-1.0.md) | ✅ |
| 1.7.2 | [Remove dead DELETE endpoints](p1-dead-deletes-1.0.md) | ✅ |
| 1.8.0 | [Host + domain deployment stack](deployment-stack-1.0.md) | ✅ local smoke test |
| 1.8.1 | [CI + deployment validation](ci-deployment-validation-1.0.md) | 🟡 first CI run pending |
| 1.8.2 | [Final local hardening](final-local-hardening-1.0.md) | ✅ |
| 1.9.0 | [Frontend Vitest baseline](frontend-vitest-1.0.md) | ✅ |
| 1.10.0 | [Live deployment on Contabo](live-deployment-1.0.md) | ✅ temporary domain |
| 1.11.0 | [Host Nginx + systemd deployment](host-nginx-deployment-1.0.md) | ✅ final domain |
| 1.11.1 | [DNS-01, GitHub, fail2ban](host-deployment-1.1.md) | ✅ |
| 1.11.2 | [Host backup + Google Drive offsite](host-backup-offsite-1.0.md) | ✅ verified restore |
| 1.12.0 | [Teacher portal requirements](teacher-portal-requirements-1.0.md) | ✅ requirements + sample; owner approved with changes |
| 1.14.0 | [Teacher portal implementation](teacher-portal-implementation-1.0.md) | ✅ first slice |
| 1.14.1 | [Teacher portal live deploy](teacher-portal-deploy-1.0.md) | ✅ migration + apps live; accounts pending |
| 1.16.0 | [Supervision workspace plan](supervision-workspace-plan-1.0.md) | ✅ captured; implementation starts at A1 |
| 1.17.0 | [Supervision A1 live deploy](supervision-a1-deploy-1.0.md) | ✅ live; supervisor permissions granted, owner password/teacher-link pending |
| 1.18.0 | [Supervision A2 live deploy](supervision-a2-deploy-1.0.md) | ✅ live; scope read models + admin picker; owner scope review pending |
| 1.19.0 | [Supervisor workspace E1](supervisor-workspace-e1-1.0.md) | ✅ live; desktop/mobile shell + safe demo mode |
| 1.20.0 | [Financial privacy + notes F1](supervisor-financial-notes-f1-1.0.md) | ✅ live; amounts gated, notes feed + notification drawer |
| 1.21.0 | [Supervisor context navigation F2](supervisor-context-navigation-f2-1.0.md) | ✅ live; clickable teacher/circle context links |
| 1.22.0 | [A3.2 requests + scope hardening](supervision-a32-requests-1.0.md) | ✅ live; requests/UI, backend scope, secure communication, permanent tests |
| 1.23.0 | [Public homepage + /management](public-homepage-management-1.0.md) | ✅ live; public entry at `/`, admin at `/management` |
| 1.24.0 | [Permanent supervision integration tests](supervision-a32-requests-1.0.md) | ✅ 16 unit + 15 integration (Testcontainers PostgreSQL 17) |
| 1.25.0 | [Communication templates + notes banner](communication-templates-1.0.md) | ✅ live; settings-controlled WhatsApp templates and notes banner |

## Next in order

| Phase | Step | Checkpoint to create |
|---|---|---|
| 1.5.2 | Frontend `useDarApplication` / `SystemAdminView` split | `legacy-split-2.1.md` |
| 1.5.3 | Auth / Program / Audit / AdminService split | `legacy-split-2.2.md` |
| 1.5.3 | Test migration | `legacy-split-1.3.md` |
| 2.7 | Security gate | `2.7-security-gate.md` |
| 2.8 | DB hardening | `2.8-db-hardening.md` |
| 5.0 | UI sample gate | `5.0-ui-sample.md` |
| 5.1 | Next.js shell + design tokens | `5.1-nextjs-shell.md` |
| 5.2 | Login + session BFF | `5.2-auth-layout.md` |
| 5.3 | Students screen | `5.3-students-ui.md` |
| 3.1b | Students update/archive | `3.1b-students-update.md` |
| 3.2 | Guardians + teachers | `3.2-secretariat-people.md` |
| 3.3 | Academic groups/schedule | `3.3-academic.md` |
| 3.4 | Attendance | `3.4-attendance.md` |
| 4.1 | Payroll | `4.1-payroll.md` |
| 4.2 | Billing | `4.2-billing.md` |
| 4.3 | Treasury/ledger | `4.3-treasury.md` |
| 4.4 | Reports | `4.4-reports.md` |
| 5.4 | Remaining UI + motion | `5.4-ui.md` |
| 6.x | Hardening + launch | `6.1` → `6.6` |

## Rules

- One step at a time.
- Commit + push + checkpoint after each completed step.
- Do not start a new feature before the foundation gate is green.
- If a step reveals a missing business decision, stop and ask the owner.
