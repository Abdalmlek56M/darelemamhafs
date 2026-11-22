# ADR-0007 — معمارية تسجيل Google Meet والبث الحي

**Status:** Accepted — **منفّذ جزئيًا** (3.0 + 3.1؛ البوت في 3.2+)
**Date:** 22 Nov 2026
**Decider:** مالك الدار (اعتماد خطة Phase 3.0 وقراراتها السبعة)
**Related:** docs/18-meet-recording-plan.md؛ docs/02-architecture.md؛ docs/03-security.md؛ docs/06-operations.md؛ docs/11-deployment.md؛ ADR-0006

## Context

الدار تحتاج تسجيل حلقات Google Meet وبثها/أرشفتها، مع روابط مشاهدة للأدمن/المشرفة فقط، ورابط Google Drive احتياطي.
الواقع: Backend .NET 10 (legacy 5080 + Dar.Api 5081)، React 19 SPA، PostgreSQL 17، سيرفر Contabo 4 vCPU / 8 GB RAM / 100 GB SSD، systemd بدون Docker، وrclone مُعد للنسخ الاحتياطي.

قيود حاكمة:

1. Google Meet **لا يوفّر Recording API** لحسابات Gmail الشخصية (Workspace فقط) — الحل الوحيد بوت متصفح ينضم للاجتماع.
2. لا Docker على الإنتاج ولا Redis/Broker؛ القائمة يجب أن تعيش في PostgreSQL.
3. الموارد محدودة: تسجيل متزامن واحد فقط دون التأثير على الموقع.
4. لا حذف تلقائي لملفات التسجيل النهائية؛ الحذف قرار بشري موثّق.
5. كل ملف كود ≤ 400 سطر.

## Decision

### 1) فصل الخدمات (Control plane / Media plane)

| الطبقة | المسؤولية | التقنية |
|---|---|---|
| Control plane | أحداث التقويم، الربط بالحلقات، الجدولة، الحالة، الصلاحيات، بث الحالة | `src/Modules/Meet` داخل `Dar.Api` (5081) |
| Media plane | الانضمام للاجتماع، التقاط الشاشة/الصوت، HLS/MP4، الرفع | خدمة `dar-meet-bot` على 127.0.0.1:5090 (Node 24 + Playwright/Chromium + Xvfb + PulseAudio + FFmpeg + MediaMTX) |
| Storage | HLS مؤقت + MP4 نهائي محليًا، ثم أرشيف Drive | `/var/lib/dar/media/meet/<session>` + `gdrive:dar-meet/<circle>/` |

**المبدأ:** الواجهة لا تتكلم مع البوت أبدًا. كل التحكم عبر REST مُصادق في Control plane، والبوت يسحب المهام من internal API (loopback + service token). فشل البوت لا يُسقط الموقع.

### 2) مصدر الحقيقة: PostgreSQL

- `database/026_meet_recording.sql`: `meet_calendar_accounts`، `meet_events`، `meet_event_links`، `meet_circle_settings`، `meet_bot_jobs`، `meet_sessions`، `meet_media_assets`، `meet_settings`.
- الطابور: `meet_bot_jobs` بحالة + `FOR UPDATE SKIP LOCKED` عند claim (لا broker).
- التزامن: `UNIQUE(occurrence_key)` يمنع تسجيل نسختين لنفس الحدث، و`meet_settings.max_concurrent_sessions = 1`.
- الحالات: `scheduled → waiting → joining → live → finalizing → uploading → ready` + `failed/cancelled/stalled/partial`؛ الانتقالات تُفحص على الخادم فقط.

### 3) التقويم والمزامنة

- Google Calendar API v3 عبر **OAuth 2.0 offline** + `syncToken` (incremental) و`singleEvents=true` لتوسيع المتكرر.
- `refresh_token` مشفّر AES-256-GCM في `meet_calendar_accounts`، المفتاح في `/etc/dar/meet.env` (640 root:dar) — لا أسرار في DB/الكود/اللوجات.
- Worker كل 60 ثانية، full resync كل 6 ساعات، backoff أُسّي عند 401/429، وفشل التوكن = `needs_reconnect` + تعطيل الجدولة (fail-closed) + إشعار.
- نطاق التسجيل: المالك يحدد **حلقات مختارة** (`meet_circle_settings.auto_record`)، وكل حدث يمكن تجاوزه (`meet_events.recording_mode` = inherit/force/exclude). الربط الذكي: مطابقة اسم الحلقة داخل عنوان الحدث تقترح ربطًا بضغطة.

### 4) دورة حياة الوسائط (قرار المالك)

1. أثناء التسجيل: HLS/DVR للمشاهدة الحية + segments على القرص.
2. بعد `finalize`: يُبنى MP4 (faststart + poster + SHA-256 + مدة).
3. يُرفع MP4 إلى Drive عبر rclone (`--checksum --bwlimit 8M --transfers 1`) ويُخزَّن `drive_file_id/drive_link/sha256/verified_on_drive`.
4. **تُحذف ملفات HLS المؤقتة آليًا** بعد نجاح `finalize`؛ **يبقى MP4** للمشاهدة على الموقع.
5. **لا يُحذف MP4 إلا بضغطتين يدويتين** من الواجهة، وبعد تحقق: MP4 موجود + `verified_on_drive=true` + checksum مطابق. الحذف يُسجَّل في `meet_media_assets` (deleted_at/by) و`audit_log`.
6. رايتبوكس Drive: **Restricted** لحساب الدار فقط (قرار المالك) — لا anyone-with-link.

### 5) الحماية والعزل

- الحماية: `location /media/meet/ { internal; }` في Nginx + `X-Accel-Redirect` بعد تحقق الجلسة والصلاحية؛ لا مسار ثابت مكشوف.
- صلاحيات: `meet.view`، `meet.manage`، `meet.calendar.manage`، `meet.media.view`، `meet.media.delete`.
  المالك/الأدمن (من يملك `users.manage`) يأخذ الخمسة؛ المشرفة تأخذ `meet.view` + `meet.media.view` قابلة للسحب من نظام الصلاحيات.
- العزل: `dar-meet.slice` (`MemoryMax=3G`، `CPUQuota=180%`، `Nice=10`، `IOWeight` منخفض)، `NoNewPrivileges`، `ProtectSystem=strict`، `PrivateTmp`، `ReadWritePaths` محددة، والبوت على loopback فقط.
- بوابات القرص: **منع التسجيل < 25GB** و**تنبيه < 40GB** (قرار المالك)، مع إشعار حرج < 15GB.
- إخطار المعلمات/الطالبات بسياسة التسجيل مسؤولية المالك ومُسجَّلة في سياسة مكتوبة قبل التفعيل.

### 6) حدود النطاق الحالي (3.0 + 3.1)

**منفّذ الآن:** ADR-0006 + ADR-0007، migration 026، كتالوج الصلاحيات (3 مصادر + الواجهة)، OAuth ربط التقويم، مزامنة incremental/full، قائمة الأحداث مع الاقتراح الذكي، ربط الحدث بحلقة، تحديد الحلقات المسجّلة، وواجهة `/management` → «التسجيل والمحاضرات».

**غير منفّذ بعد:** خدمة البوت، الالتقاط الحي، HLS/DVR، المشغل، رفع rclone، مسارات الوسائط المحمية، SSE، الإشعارات التشغيلية، ونشر systemd (المراحل 3.2 → 3.7).

## Alternatives rejected

| البديل | لماذا رُفض |
|---|---|
| Google Meet REST recordings API | متاح لحسابات Workspace فقط مع تسجيل مفعّل — ليس لحساب Gmail عادي |
| بناء HLS يدويًا من FFmpeg فقط | MediaMTX يعطي HLS/DVR + إعادة تدفق بأخطاء أقل وصيانة أبسط |
| Redis/Celery/Broker للطابور | حجم الدار لا يبرر خدمة إضافية؛ `SKIP LOCKED` كافٍ وآمن |
| Docker للبوت | الـDocker stack متقاعد على الإنتاج؛ systemd + slice يعطي عزلاً كافيًا |
| حذف MP4 تلقائيًا لتوفير المساحة | يخالف قرار المالك (حذف يدوي فقط) — يُدار بالتنبيهات وبوابات المنع |

## Consequences

- **متطلبات مسبقة على السيرفر (3.0):** حساب Gmail مخصص للدار + أول تسجيل دخول يدوي لإنشاء بروفايل Playwright دائم، حزم `node/chromium/xvfb/pulseaudio/ffmpeg/mediamtx`، `rclone` بـOAuth client مخصص (الـshared client سيتقاعد 2026)، ومفتاح تشفير + service token في `/etc/dar/meet.env`.
- **مخاطر مقبولة (موثقة):** احتمال تحدي دخول Google للبوت (R4) → بروفايل دائم + مراقبة، وتغيّر واجهة Meet يكسر المُحدِّدات (R14) → self-test يومي.
- **النسخ الاحتياطي:** قاعدة Meet مشمولة في النسخة اليومية؛ ملفات الوسائط غير مشمولة (ضخمة) — Drive هو الأرشيف + يُحدَّث docs/11.
- **قابلية التراجع:** `systemctl stop dar-meet-bot` يعطّل التسجيل كليًا دون أي أثر على الموقع؛ جداول `meet_*` مستقلة ويمكن إهمالها.

## Affected files (المنفّذ في 3.0/3.1)

- `docs/adr/0006-meet-auth-bridge.md`، `docs/adr/0007-meet-recording-architecture.md`
- `database/026_meet_recording.sql`
- `src/Modules/Meet/Dar.Modules.Meet/**`
- `src/Modules/Identity/.../AdminSessionBridge.cs`، `src/Host/Dar.Api/Program.cs`، `backend/DarEltahfeez.Api/Program.cs`
- `src/Common/Dar.Common/Domain/PermissionCodes.cs`، `backend/DarEltahfeez.Api/Security.cs`
- `frontend/src/meet/**`، `frontend/src/pages/MeetPage.tsx` (أو ما يعادلها)، `frontend/src/{App.tsx,domain/navigation.ts,domain/types.ts,application/useDarApplication.ts,domain/permissions.ts}`
