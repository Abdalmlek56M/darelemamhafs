# Dar Eltahfeez — نظام إدارة الدار

نظام إداري/مالي لدار تحفيظ قرآن، مبني على .NET وNext.js وPostgreSQL.
المشروع الحالي يحتوي على **التطبيق القديم (Desktop-first)** و**أساس جديد (Web-first)** أثناء الترحيل.

## الحالة

- **Legacy:** .NET 10 Minimal API + React 19/Vite + PostgreSQL 17 + WPF/WebView2.
- **New foundation:** `Dar.slnx` + `src/Host/Dar.Api` + `src/Common` + `src/Modules/Identity` + `src/Modules/Secretariat`.
- **Tests:** 12 unit + 3 integration passing.
- **Migrations:** 13 SQL files, checksum + advisory lock, `--migrate`.
- **No `.bat` files.**
- **Google login:** deferred; temporary password/session flow is the current path.
- **TypeScript backend:** decision pending. Do not build a second backend until confirmed.

## البنية

```
src/
  Host/Dar.Api              API host, health, OpenAPI, security headers
  Common/Dar.Common         shared domain primitives
  Modules/Identity          email OTP, password fallback, sessions
  Modules/Secretariat       students list/get/create
tests/
  Dar.UnitTests
  Dar.IntegrationTests
database/                   ordered SQL migrations
docs/                       project docs + checkpoints
deepseek.md                 AI operating manual
```

## التشغيل

```bash
dotnet build Dar.slnx
dotnet test Dar.slnx
dotnet run --project src/Host/Dar.Api -- --migrate
dotnet run --project src/Host/Dar.Api
```

Legacy desktop is still runnable through `tools/run-desktop.ps1` while migration continues.

## قواعد

- لا أسرار في المستودع.
- لا حذف لتاريخ مالي أو حضور.
- ملفات جديدة: 200–300 سطر كهدف، والحد الأقصى 400.
- الاختبارات في `tests/`، وليس تطبيقًا منفصلًا.
- راجع `deepseek.md` و`docs/` قبل أي تعديل.
