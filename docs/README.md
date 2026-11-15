# RIGX Dar — Documentation Index

> ابدأ من `deepseek.md` في جذر المشروع، ثم هذه المستندات بالترتيب.

---

## Reading Order

1. [`../deepseek.md`](../deepseek.md) — تعليمات التشغيل والقراءة الأولى.
2. [`01-business.md`](01-business.md) — المجال، الأدوار، القواعد.
3. [`02-architecture.md`](02-architecture.md) — الحالة الحالية والمستهدفة.
4. [`03-security.md`](03-security.md) — الأمان والصلاحيات.
5. [`04-engineering-standards.md`](04-engineering-standards.md) — معايير الكود.
6. [`05-roadmap.md`](05-roadmap.md) — الخطوات الحالية والقادمة.
7. [`06-operations.md`](06-operations.md) — التشغيل والنشر والنسخ.
8. [`07-gap-audit.md`](07-gap-audit.md) — فحص المشروع القديم.
9. [`08-testing.md`](08-testing.md) — الاختبارات وعزلها.
10. آخر ملف في [`checkpoints/`](checkpoints/).

---

## Documents

| File | Purpose | Status |
|---|---|---|
| `01-business.md` | ما الذي يفعله النظام ولمن | Draft — after audit |
| `02-architecture.md` | .NET + Next.js + PostgreSQL | Target |
| `03-security.md` | Auth, RBAC, hardening, audit | Baseline |
| `04-engineering-standards.md` | C#/TS standards, review, DoD | Baseline |
| `05-roadmap.md` | Phases 0–6 | Current: 0.2 |
| `06-operations.md` | Setup, migrations, backups, deploy | Target |
| `07-gap-audit.md` | Findings ledger | Pending intake |
| `08-testing.md` | Test strategy, isolation, CI | Baseline |
| `checkpoints/*.md` | Done/Remaining/Decisions per step | Living |

---

## Current Status

- **Phase 0.1:** Foundation docs + skill — ✅ Done.
- **Phase 0.2–0.4:** Intake, baseline, audit — ✅ Done (visual screenshots pending).
- **Phase 0.6:** Legacy docs consolidation — ✅ Done.
- **Phase 1.1:** P0 guards — 🟡 Partial (rate limit, login audit, headers, purge guard).
- **Phase 1.2:** `.bat` removal — ✅ Done (12 files).
- **Phase 2.1:** New .NET solution — ✅ Done.
- **Phase 2.3:** Identity — 🟡 First slice (Email OTP, Google path, password fallback, sessions).
- **Next:** migration CLI + first business module + Next.js shell.
- **Backend:** .NET 10 + Npgsql/Dapper — **final** (TypeScript rejected).
- **Frontend:** Next.js 16 (target).
- **Database:** PostgreSQL 17+ on the same server, `public` schema initially.
- **Domain:** `darelemamhaf.rigxhardware.com`.
- **Auth:** Email OTP + Google; temporary password fallback during migration.
- **Language:** Arabic + English.
- **No `.bat` files.**
- **Tests:** 12 unit + 3 integration passing; isolated DB/environment; no test panel.

---

## Rules

- The newest doc + checkpoint wins.
- No code without a roadmap step.
- No step without a checkpoint.
- No secrets in docs.
- No destructive DB commands without backup.
- Missing business decision → ask, don't invent.
- Arabic RTL first.
