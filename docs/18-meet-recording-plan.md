# Phase 3.0 — Google Meet Recording & Live Streaming (Plan)

**Status:** 📝 تخطيط — **بانتظار موافقة المالك قبل أي كود** (22 Nov 2026)
**Requested by:** owner — تسجيل وبث حلقات Google Meet تلقائيًا + ربط Google Calendar + HLS/DVR + رفع Google Drive + مشغل داخل لوحة الإدارة.
**Rules:** كل ملف كود 300–400 سطر كحد أقصى؛ Modular Monolith؛ راجع deepseek.md و docs/00 و docs/17.

---

## 0. تصحيح حقائق قبل التصميم

- الـBackend في المشروع هو **.NET 10** (وليس .NET 8 كما ورد في الطلب) — نفس الـruntime المستخدم في Dar.Api.
- السيرفر الفعلي (docs/11): **Contabo 4 vCPU / 8 GB RAM / 100 GB SSD / 200 Mbit/s / Ubuntu 24.04.5 + swap 2GB**، وعليه: Nginx + PostgreSQL 17 + dar-legacy (5080) + dar-api (5081) + backup/healthcheck timers + rclone.
- المشروع الحالي: React 19 + Vite SPA واحدة (admin + teacher + supervisor) + جلسة أدمن legacy على /api/* + جلسة جديدة على /api/v1/*. أي وحدة جديدة يجب أن تحل مسألة **عبور الجلسة بين الـAPIين** (انظر §4.2 وADR-0006 المقترح).
- Google Drive: rclone مُعد بالفعل (gdrive:dar-backups للنسخ) — سنعيد استخدام نفس الـremote لمسار gdrive:dar-meet مع **تنبيه retirement لـshared client ID** (docs/11 §11).

---

## 1. المعمارية المقترحة (High Level)

    [Admin SPA /management]
        |  HTTPS (cookie أدمن)
        v
    [Nginx] -- /api/v1/meet/* , /media/meet/* (internal) , SSE
        |
        +--> [dar-api 5081]  Meet module: Calendar sync, sessions, scheduling,
        |                    SSE status stream, media auth (X-Accel-Redirect),
        |                    internal bot API (loopback + service token)
        |
        +--> [dar-legacy 5080]  باقي النظام (بدون تغيير جوهري)

    [dar-meet-bot.service  127.0.0.1:5090]  (systemd, User=dar, cgroup limits)
        Node 24 + TypeScript + Playwright/Chromium + Xvfb + PulseAudio + FFmpeg + MediaMTX
        polls jobs from dar-api internal API -> joins Meet -> captures -> HLS+MP4
        -> rclone upload to Drive -> reports status

    [PostgreSQL 17]  meet_* tables (calendar events, links, jobs, sessions, media, settings)
    [/var/lib/dar/media/meet/<session>]  HLS live segments + final MP4 + poster
    [Google Calendar API v3]  pull events (OAuth offline + syncToken)
    [Google Drive]  final MP4 via rclone

**المبدأ:** الواجهة لا تتخاطب مع البوت مباشرة أبدًا؛ كل التحكم عبر API مُصادَق (REST) + حالة لحظية عبر SSE. البوت خدمة معزولة تفشل بأمان ولا تُسقط الموقع.

---

## 2. تحليل السعة (Capacity) — نقطة حرجة

### 2.1 استهلاك البوت الواحد (تقديري)

| المورد | الاستهلاك | ملاحظة |
|---|---|---|
| Chromium (Playwright) + Meet WebRTC | 0.8–1.5 GB RAM، 0.8–1.2 vCPU | 720p، عرض اجتماع كامل |
| Xvfb 1280×720×24 | ~50–100 MB RAM، CPU بسيط | framebuffer فقط |
| FFmpeg (x264 veryfast + AAC) | 0.3–0.6 vCPU، ~200–400 MB RAM | 720p30 + HLS + MP4 |
| MediaMTX (HLS remux) | ~50–150 MB RAM | ملف واحد صغير |
| rclone (رفع) | شبكة ~3 ميجابت/ثانية | يُحدد بـbwlimit لحماية الموقع |
| **الإجمالي للبوت** | **~1.5–2.3 GB RAM، ~1.5–2 vCPU** | |

### 2.2 الميزانية على السيرفر

- متاح فعليًا بعد النظام والموقع وPostgreSQL: **~5–5.5 GB RAM و~2.5–3 vCPU** (مع swap 2GB كاحتياط لا كأساس).
- **القرار المقترح: تسجيل متزامن واحد (MAX_CONCURRENT_BOTS=1)** على هذا السيرفر. التسجيل الثاني مسموح به فقط لو خفّضنا 720p إلى 540p أو أضفنا VPS منفصل للبوت (يُفضّل لاحقًا).
- عزل عبر **systemd slice**: dar-meet.slice بـMemoryMax=3G وCPUQuota=180% وIOWeight منخفض + Nice=10، حتى لا يتأثر الموقع أثناء التسجيل.
- **القرص**: 720p ≈ **1.1–1.5 GB/ساعة** لـMP4 (H.264 ~2.5–3.5 Mbps + صوت)؛ HLS الحي يستهلك نفس الحجم تقريبًا ثم يُعتمد MP4 النهائي للعب. 3 حلقات/يوم × ساعة = ~4–5 GB/يوم. على 100GB (بعد DB + backups) القدرة العملية ~35–45 يومًا للملفات دون حذف. لذلك:
  - بوابات أمان: لا يبدأ التسجيل إذا المساحة الحرة أقل من 25GB؛ تحذير إداري عند أقل من 40GB؛ إشعار حرج عند أقل من 15GB.
  - الحذف **يدوي فقط** بزر في الواجهة بعد تحقق: MP4 موجود + على Drive + checksum مطابق.
  - HLS الحي يُنظّف آليًا بعد نجاح finalize (يبقى MP4 للمشاهدة) — الحذف اليدوي يخص MP4 و/أو الجلسة كاملة.

### 2.3 الشبكة/الرفع

- الرفع عبر rclone مع --bwlimit 8M (قابل للضبط) و--transfers 1 و--checksum، حتى لا يتأثر TLS/API للموقع. الرفع يبدأ بعد finalize وليس أثناء البث.

---

## 3. تدفق العمل (Workflows)

### 3.1 المزامنة مع Google Calendar
1. المالك يضغط «ربط Google» → OAuth offline (scope calendar.events.readonly، وcalendar.settings.readonly اختياري) → يُخزَّن refresh token **مشفّرًا** (AES-GCM، المفتاح في /etc/dar/meet.env بصلاحيات 640 root:dar).
2. CalendarSyncWorker (hosted) كل 60 ثانية: incremental sync بـsyncToken؛ كل 6 ساعات full resync (إصلاح أي انحراف/إلغاء)؛ إعادة محاولة أُسّية عند 401/429.
3. الأحداث تُخزَّن في meet_events (google_event_id فريد، start/end UTC، timezone، summary، meet_link، html_link، status cancelled/confirmed، raw JSONB).
4. الأحداث المتكررة تُوسّع بـsingleEvents=true؛ الأحداث التي بدون Meet link تُعرض «لا رابط» ولا تدخل البوت.
5. **تحديث فوري (اختياري متقدم):** Calendar push notifications (watch channel) عبر endpoint عام + renewal كل 6 أيام — يُضاف في تحسين لاحق؛ الافتراضي polling 60s (يكفي لأن البوت يدخل T-60s).

### 3.2 ربط الحدث بحلقة
- اقتراح تلقائي: تطابق اسم الحلقة داخل summary (عربي/إنجليزي) → «اقترح ربط» بضغطة واحدة.
- يدوي: قائمة حلقات + حفظ علاقة meet_event_links(event_id, circle_id)؛ تكرار أسبوعي يرث الربط للسلسلة مع إمكانية استثناء نسخة واحدة.
- هذا الربط يُستخدم للتسمية على Drive، للتقارير، ولربط الحضور لاحقًا.

### 3.3 جدولة البوت وتشغيله
1. MeetSchedulerWorker كل 15 ثانية: يجد الأحداث المؤهلة (مُفعّلة + مرتبطة/مسموحة + ليست مستثناة) القريبة، وينشئ/يحدّث meet_bot_jobs بحالة scheduled (idempotent بمفتاح event+occurrence).
2. البوت (Node) polling داخلي كل 5s: POST /internal/meet/jobs/claim → يأخذ مهمة due (DB FOR UPDATE SKIP LOCKED) ويحوّلها waiting.
3. قبل الموعد بـ60 ثانية (قابل للضبط): تشغيل Xvfb + PulseAudio null sink + Chromium persistent profile بحساب الدار (مايك/كاميرا مقفولين) + الانضمام (مع التعامل مع waiting room).
4. عند بدء الاستقبال: FFmpeg يلتقط الشاشة (x11grab 1280×720) + الصوت (Pulse monitor) ويرسل إلى MediaMTX (RTMP) الذي:
   - ينشر **HLS/DVR** (نافذة DVR قابلة للضبط، مثلاً 2–4 ساعات) للعرض الحي.
   - يسجّل **MP4** على القرص (segments ثم finalize).
5. **الإيقاف التلقائي:** عند end time من الكالندر (مع هامش دقيقتين) أو زر إيقاف يدوي → خروج من Meet → إغلاق FFmpeg بلطف → finalize MP4 + poster + metadata + hashes.
6. **الحالات:** scheduled → waiting → joining → live → finalizing → uploading → ready (+ failed، cancelled، partial). كل انتقال: DB + SSE + audit.
7. **إعادة المحاولة:** فشل انضمام (رفض/انتظار/شبكة) → backoff حتى 3 محاولات داخل نافذة الحدث؛ انقطاع أثناء البث → detect → rejoin تلقائي ثم استئناف التسجيل في ملف جديد part-2 ثم دمج/إبقاء الأجزاء مع إشارة «تسجيل متعدد الأجزاء».
8. **نبض (heartbeat):** البوت يرسل كل 15s؛ عدم النبض 90s → الحالة stalled + إشعار + إمكانية استرجاع من الواجهة.

### 3.4 الرفع إلى Drive
- بعد finalize: rclone copy --checksum إلى gdrive:dar-meet/<circle>/<YYYY-MM-DD>-<slug>.mp4 مع --bwlimit.
- التحقق: مقارنة SHA-256/الحجم؛ ثم rclone link لإنشاء رابط مشاركة (قرار المالك: anyone-with-link أم restricted + إضافة البريد؟).
- يُخزَّن drive_file_id/drive_link/uploaded_at/size/sha256 في meet_media_assets.
- فشل الرفع: retries أُسّية (3–5) ثم upload_failed + زر «إعادة الرفع» يدوي؛ الملف يبقى محليًا.
- لا يُحذف المحلي تلقائيًا — الحذف من الواجهة فقط بعد verified_on_drive=true.

### 3.5 المشاهدة والتشغيل
- أثناء LIVE: مشغل HLS/DVR عبر Vidstack + HLS.js، شارة LIVE، عداد، رجوع للخلف (DVR)، زر «العودة للحي».
- بعد finalize: نفس المشغل على MP4 (range requests) + تحميل/مشاركة إدارية + رابط Drive.
- **كل مسارات الوسائط محمية:** Nginx location /media/meet/ { internal; } + API يتحقق من الجلسة/الصلاحية ثم يعيد X-Accel-Redirect (كفاءة Nginx + أمان كامل، بدون كشف مسار ثابت). صلاحية جديدة meet.media.view.

---

## 4. الأمان والخصوصية (إلزامي)

### 4.1 الأسرار
- بيانات دخول حساب البوت (بريد/كلمة مرور/2FA) لا تُكتب في الكود أو DB نصًا صريحًا: تُشفّر AES-256-GCM بمفتاح في /etc/dar/meet.env (640 root:dar) — أو الأفضل: يُدار البروفايل يدويًا مرة واحدة على السيرفر في /var/lib/dar/meet/profile (0700 dar:dar) بحيث لا تُخزَّن كلمة المرور في DB إطلاقًا (قرار مالك).
- refresh token لـCalendar مشفّر بنفس الأسلوب، ومفتاح مستقل.
- meet.env يتضمن: internal service token (عشوائي 32 bytes)، مفتاح تشفير، إعدادات، حدود المساحة، bandwidth.

### 4.2 عبور الجلسة بين الـAPIين (قرار معماري مطلوب — ADR-0006)
- المشكلة: لوحة الإدارة مسجّلة على legacy (5080)، ووحدة Meet ستكون في Dar.Api (5081). مسار /api/v1/ فقط هو الذي يوصل للـAPI الجديد.
- **الحل المقترح (Option A):** توحيد **Data Protection key ring** بين الـAPIين (نفس PersistKeysToFileSystem /var/lib/dar/keys + SetApplicationName) → الـAPI الجديد يفكّ نفس الـcookie ويقرأ الـclaims، مع إبقاء فحص session_version/الصلاحيات. تغيير محدود + مراجعة أمنية + ADR.
- **بديل (Option B):** إبقاء وحدة Meet داخل legacy API (نفس الجلسة) — أسرع لكن يخالف اتجاه الـmodular monolith ويزيد ملفات legacy.
- **بديل (Option C):** جسر تسجيل دخول قصير العمر (legacy يوقّع توكن داخلي ويسجّل جلسة جديدة) — أكثر أجزاء متحركة.
- **التوصية:** Option A مع اختبار أمني، والرجوع إلى B إذا ظهرت أي مشكلة في مفاتيح الحماية.

### 4.3 حماية البث
- لا يُخدم أي ملف HLS/MP4 مباشرة من Nginx؛ internal فقط + X-Accel-Redirect بعد تحقق الصلاحية.
- صلاحيات جديدة: meet.view، meet.manage (تشغيل/إيقاف/تعديل)، meet.calendar.manage (ربط/مزامنة/استثناءات)، meet.media.view، meet.media.delete. تُضاف في مواضع الكتالوج الحالية + seed + backfill للمالك/المدير فقط.
- rate limit على تشغيل/إيقاف/إعادة رفع، CSRF/Origin guard (موجود)، Audit لكل عملية إدارية (meet.session.start/stop/retry/delete_media/calendar.link/sync).
- خصوصية: زر/تنبيه «التسجيل جارٍ» للطرف الآخر غير متاح تقنيًا خارج Meet UI — **القرار القانوني/الأخلاقي**: يجب إخطار المعلمة/الطالبات بسياسة التسجيل قبل الاستخدام (مسؤولية المالك؛ يُسجَّل في docs/01 أو سياسة منفصلة).

### 4.4 البوت وحماية السيرفر
- NoNewPrivileges=true، ProtectSystem=strict، ProtectHome=true، PrivateTmp=true، ReadWritePaths=/var/lib/dar/media/meet /var/lib/dar/meet، RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6.
- البوت يستمع على **127.0.0.1:5090 فقط**؛ Nginx لا يمرر إليه شيئًا؛ الـAPI هو اللي يتكلم معه (loopback + service token).
- Cleanup صارم: ExecStopPost يقتل Chromium/Xvfb/FFmpeg/MediaMTX المتبقية؛ reaper دوري للملفات/العمليات اليتيمة.
- Google قد يرفض تسجيل دخول آلي (2FA/«browser not secure»): خطة: تسجيل يدوي أول مرة على السيرفر لإنشاء بروفايل دائم + استخدام نفس بروفايل Playwright؛ مراقبة جلسة الصلاحية وإشعار عند الحاجة لإعادة تسجيل دخول يدوي. خطر مذكور في §5.

---

## 5. الثغرات المحتملة والمعالجات (Risk Register)

| # | الخطر | المعالجة |
|---|---|---|
| R1 | تسريب روابط HLS لأي شخص | Nginx internal + X-Accel + صلاحية meet.media.view + جلسة أدمن + ربط origin |
| R2 | امتلاء القرص وتوقف الموقع/DB | فحص مساحة قبل البدء (25GB)، تحذيرات SSE، إشعار critical، عدم حذف تلقائي (بقرار المالك) بل زر حذف يدوي |
| R3 | انقطاع Meet/الشبكة أثناء البث | heartbeat + detect + auto-rejoin + backoff + تسجيل أجزاء + حالة partial + إشعار |
| R4 | فشل دخول البوت (2FA/حظر Google) | بروفايل دائم + مراقبة + إشعار واضح للمالك + إجراء يدوي موثق (بديل مؤقت: تشغيل يدوي/رفع يدوي) |
| R5 | Waiting room / رفض المضيف | كشف الحالة + انتظار حتى T+10 دقائق + إشعار «البوت في غرفة الانتظار» + retry |
| R6 | OAuth token منتهي/ملغي | إشعار + صفحة إعادة ربط + تعطيل الجدولة حتى الإصلاح (fail-closed) |
| R7 | تعارض بيانات التقويم (تعديل/إلغاء حدث) | syncToken incremental + full resync كل 6h + إلغاء job مجدول آليًا + إشعار للمالك |
| R8 | تسجيلات مكررة لنفس الحدث | unique constraint (event_id+occurrence) + claim ذري + منع start من الواجهة لو جلسة نشطة |
| R9 | سباق stop/upload/finalize | state machine صارمة بانتقالات DB (compares) + قفل صف + idempotency keys |
| R10 | تحميل زائد على الموقع أثناء التسجيل | cgroup limits + Nice/IOWeight + MAX_CONCURRENT=1 + منع الرفع أثناء البث + bwlimit |
| R11 | اقتراب rclone shared client ID من التقاعد (2026) | مطلوب OAuth client مخصص (مُدرج أصلاً في docs/11) — شرط قبل تشغيل الرفع طويل الأمد |
| R12 | ثغرة auth bridge بين الـAPIين | ADR + اختبارات سلبية (بدون cookie، cookie legacy ملغي، session_version مرتفع، صلاحيات) + مراجعة أمنية |
| R13 | Nginx buffering يقطع SSE/HLS | SSE: proxy_buffering off; proxy_read_timeout 1h; add_header X-Accel-Buffering no; HLS عبر X-Accel مع aio threads; sendfile on |
| R14 | نسخة Google Meet/HTML تتغير وتكسر Playwright | selectors معزولة في ملف واحد + self-test مجدول (مرة يوميًا) ينبّه قبل الحصة |
| R15 | نسخ احتياطي غير شامل للـDB الجديدة | migrations تلقائية في backup اليومي؛ media غير مشمولة في backup (ضخمة) — يُعتمد Drive كأرشيف؛ docs/11 تُحدَّث |
| R16 | الخصوصية/الموافقة على التسجيل | سياسة مكتوبة + إخطار المعلمات/الطالبات + مراجعة المالك قبل التفعيل |

---

## 6. التقنيات المختارة ولماذا

| الجزء | الاختيار | لماذا |
|---|---|---|
| Control plane API | .NET 10 module Dar.Modules.Meet (نفس نمط Identity/Teaching) | اتساق معماري، نفس الصلاحيات/الAudit/Npgsql/Dapper، اختبارات Testcontainers |
| Calendar | Google Calendar API v3 عبر Google.Apis.Calendar.v3 (official .NET) + OAuth offline + syncToken incremental | مكتبة رسمية مُصانة، incremental sync مدمج، ويب هوك اختياري لاحقًا |
| State real-time | **SSE** (text/event-stream) من /api/v1/meet/stream، مع Last-Event-ID + heartbeat | حالة اتجاه واحد فقط؛ أبسط من SignalR (لا hub client/protocol)، ويعمل خلف Nginx بإعداد بسيط، auto-reconnect مدمج في EventSource |
| Recorder | **Node 24 + TypeScript strict + Playwright (Chromium)** | Google Meet لا يوفّر Recording API لحسابات Gmail الشخصية؛ Playwright الأكثر متانة لأتمتة الويب + trace/انتظار ذكي |
| Virtual display | **Xvfb** 1280×720×24 | قياسي وخفي؛ يستهلك أقل من desktop كامل |
| Audio | **PulseAudio null sink + monitor** | أعلى موثوقية لالتقاط صوت Chromium كنظام صوت افتراضي |
| Capture | **FFmpeg** (x11grab + pulse + libx264 veryfast + AAC) | معياري، منخفض الحمل، يدعم tee/HLS/MP4 |
| HLS/DVR | **MediaMTX** (single binary) + FFmpeg RTMP push | يوفّر HLS/DVR + تسجيل MP4 بنيويًا بدل بناء HLS يدويًا، أقل أخطاء، systemd-friendly |
| Player | **Vidstack Player (React)** + hls.js | حديث، accessible، واجهة جاهزة RTL، دعم HLS/DVR/thumbnail، خفيف |
| Upload | **rclone** (موجود) + --checksum --bwlimit | موجود ومُختبر على السيرفر، لا SDK/مفاتيح إضافية |
| Scheduling/queue | **DB queue + FOR UPDATE SKIP LOCKED** | بدون Redis/Broker إضافي؛ آمن للتعدد ويتماشى مع النمط الحالي |
| Service mgmt | **systemd** (unit + slice + Restart=always + timers) | لا Docker على الإنتاج (متقاعد)؛ cgroup limits مدمجة |
| Config/secrets | /etc/dar/meet.env (640) + AES-GCM للـtokens | لا أسرار في DB/الكود/اللوجات |
| Frontend | React 19 + Vite الحالي + Vidstack + hooks; حالة SSE في hook واحد | لا تقنية جديدة على الواجهة؛ تكامل نظيف مع responsive الحالي |
| Tests | xUnit + Testcontainers للـAPI، Vitest لحالات البوت، Playwright E2E للوحة | نفس معايير docs/08 |
| Observability | structured logs + journalctl + /healthz للبوت + heartbeat في DB + إشعارات النظام الحالية | بلا أدوات جديدة |

**رفضنا:** WebRTC custom stack (تعقيد كبير)، Screen-capture داخل المتصفح كبديل (لا يعتمد)، بناء HLS يدويًا بدون MediaMTX، Redis/Broker (غير مبرر لحجم الدار)، Google Meet REST recordings (متاح فقط لـWorkspace مع تسجيل مفعّل وليس لحسابات Gmail العادية).

---

## 7. تقسيم الملفات (كل ملف ≤ 400 سطر) — Draft

### 7.1 Backend .NET — src/Modules/Meet/Dar.Modules.Meet/ (~28 ملف)

| الملف | المسؤولية | ~سطر |
|---|---|---|
| Domain/MeetEvent.cs، MeetSession.cs، MeetBotJob.cs، MeetMediaAsset.cs، MeetEnums.cs | كيانات/حالات | 80–180 |
| Domain/MeetPermissions.cs | أكواد صلاحيات الوحدة | <60 |
| Contracts/MeetContracts.cs + Dtos | DTOs الطلب/الرد | 150–250 |
| Features/Calendar/ConnectCalendar.cs + Callback.cs + Endpoint.cs | OAuth | 120–260 |
| Features/Calendar/SyncCalendar.cs + Handler | incremental/full sync | 180–300 |
| Features/Calendar/ListEvents.cs + Endpoint | قائمة/فلاتر أحداث | 120–220 |
| Features/Links/LinkEventToCircle.cs + Endpoint | ربط/فك | 120–200 |
| Features/Sessions/ListSessions.cs | قائمة/تفاصيل | 150–260 |
| Features/Sessions/ScheduleSession.cs + CancelScheduled.cs | إنشاء/تعديل/إلغاء job | 150–260 |
| Features/Sessions/StartNow.cs + StopSession.cs + RetryUpload.cs | تحكم يدوي | 120–240 |
| Features/Media/AuthPlayback.cs + DeleteMedia.cs + ListMedia.cs | X-Accel/حذف/قوائم | 120–260 |
| Features/Internal/BotJobEndpoints.cs + BotHeartbeat.cs + BotStatus.cs | internal API للبوت (token) | 200–320 |
| Features/Stream/StatusStreamEndpoint.cs (SSE) | بث الحالة | 120–220 |
| Workers/CalendarSyncWorker.cs، MeetSchedulerWorker.cs، StaleJobReaper.cs | hosted services | 150–300 |
| Persistence/MeetRepository.cs + MeetCalendarRepository.cs + MeetMediaRepository.cs | SQL/Dapper | 250–380 |
| Infrastructure/MeetCrypto.cs (AES-GCM)، MeetGoogleClient.cs، MeetOptions.cs، MeetModule.cs | DI/options/crypto | 120–260 |
| Features/MeetEndpoints.cs | تجميع مسارات الوحدة | <120 |

### 7.2 Migration + DB
database/026_meet_recording.sql (~250–350 سطر): جداول meet_calendar_accounts، meet_events، meet_event_links، meet_bot_jobs، meet_sessions، meet_media_assets، meet_settings + فهارس + constraints + seed صلاحيات.

### 7.3 Bot Service — services/meet-recorder/ (~22 ملف)

| الملف | المسؤولية | ~سطر |
|---|---|---|
| package.json، tsconfig.json، .env.example، README.md | إعداد | — |
| src/index.ts | bootstrap + signal handling | 100–160 |
| src/config.ts | env/validation/zod | 100–180 |
| src/logger.ts | JSON logger | <80 |
| src/http/server.ts + routes/health.ts + routes/internalControl.ts | 127.0.0.1 API (health/stop) | 150–260 |
| src/api/darClient.ts | عميل الـinternal API + retry | 150–250 |
| src/jobs/poller.ts | claim/poll/heartbeat | 150–250 |
| src/jobs/stateMachine.ts | انتقالات الحالة + guards | 150–250 |
| src/meet/browser.ts | Playwright launch/persistent context | 120–200 |
| src/meet/auth.ts | فتح بروفايل/تسجيل دخول يدوي/فحص الجلسة | 120–220 |
| src/meet/join.ts | الانضمام/waiting room/إيقاف الكاميرا والمايك | 150–260 |
| src/meet/session.ts | دورة حياة الجلسة + rejoin | 200–320 |
| src/media/display.ts | Xvfb lifecycle | 80–140 |
| src/media/audio.ts | PulseAudio null sink/monitor | 80–140 |
| src/media/capture.ts | FFmpeg args + start/stop/finalize | 180–300 |
| src/media/mediamtx.ts | config/paths/HLS readiness | 100–160 |
| src/media/finalize.ts | MP4 faststart/poster/hash/duration | 120–200 |
| src/storage/disk.ts | فحص المساحة/التقدير/تنظيف أجزاء | 100–160 |
| src/upload/rclone.ts | copy/checksum/link/retry/bwlimit | 150–250 |
| src/recovery/reaper.ts | تنظيف عمليات/ملفات يتيمة | 100–160 |
| src/selftest.ts | وضع self-test (تسجيل شاشة اختبار) | 120–200 |
| tests/*.test.ts | Vitest للحالات/الوقت | — |

### 7.4 Frontend — frontend/src/meet/ + page (~16 ملف)

| الملف | المسؤولية | ~سطر |
|---|---|---|
| pages/MeetPage.tsx | الصفحة + tabs (القادم/مباشر/الأرشيف/الإعدادات) | 200–320 |
| meet/MeetAppShell.tsx | shell/tabs/responsive | 120–200 |
| meet/components/CalendarEventsPanel.tsx | أحداث قادمة + فلاتر + ربط حلقة | 200–300 |
| meet/components/SessionCard.tsx | بطاقة جلسة + حالات + أزرار تحكم | 180–280 |
| meet/components/LivePlayer.tsx | Vidstack/hls.js + LIVE/DVR/عودة للحي | 180–280 |
| meet/components/UploadPanel.tsx | حالة الرفع + رابط Drive + إعادة رفع | 120–200 |
| meet/components/StorageGuard.tsx | مساحة/تحذيرات/حذف يدوي مؤكد | 120–200 |
| meet/components/MeetSettingsPanel.tsx | قواعد التسجيل/الاستثناءات | 150–240 |
| meet/hooks/useMeetStatusStream.ts | SSE + reconnect + last-event | 120–200 |
| meet/hooks/useMeetData.ts | تحميل/فعل API | 150–250 |
| meet/api/meetApi.ts | عميل REST موحد + أخطاء | 180–280 |
| meet/types.ts + permissions.ts | أنواع/صلاحيات | 120–200 |
| meet/meet.css | تنسيقات responsive | 150–250 |
| App.tsx wiring + navigation/tab جديد + domain/permissions.ts | ربط الصفحة/الصلاحيات | تعديلات صغيرة |

### 7.5 Deploy — deploy/ + services/meet-recorder/deploy/
- deploy/systemd/dar-meet-bot.service، deploy/systemd/dar-meet.slice، deploy/systemd/dar-meet-selftest.timer.
- deploy/nginx/meet-locations.conf (SSE + internal media).
- deploy/setup-host-meet.sh (تثبيت Node/Chromium/Pulse/Xvfb/FFmpeg/MediaMTX + مستخدم/مجلدات/بروفايل) + deploy/meet.env.example.
- تحديث deploy/update.sh (build/bot deps + restart + smoke) وdeploy/preflight.sh (مساحة/بروفايل/جلسة Google) وdeploy/scripts/dar-healthcheck.sh (heartbeat/مساحة/بوت/آخر تسجيل).

### 7.6 Tests/Docs
- tests/Dar.IntegrationTests/Meet/ (Calendar/sync contract، scheduling، state transitions، media auth 401/403/200، SSE، صلاحيات).
- services/meet-recorder/tests/ (state machine، حساب أوقات Cairo/UTC، تنظيف، self-test assertions).
- frontend Vitest لمنطق SSE/الفلاتر + Playwright E2E (قراءة فقط في CI).
- ADRs: docs/adr/0006-meet-auth-bridge.md، 0007-meet-recording-architecture.md.
- docs/19-meet-operations.md (runbook: ربط جوجل، إعادة تسجيل دخول البوت، أعطال، مساحة، حذف ملفات) + checkpoint لكل مرحلة.

---

## 8. خطة التنفيذ (Sub-phases) — تُضاف إلى docs/17 كـPhase 3.0

| # | المرحلة | المحتوى | معيار القبول | التقدير |
|---|---|---|---|---|
| **3.0** | Prerequisites + ADRs | ADR-0006 (auth bridge) + 0007 (architecture)؛ تأكيد حساب البوت/2FA؛ rclone client ID مخصص؛ حزم السيرفر؛ بروفايل Playwright يدوي أول مرة | قرارات موقعة + السيرفر جاهز + self-test بسيط (Xvfb+ffmpeg) | 1 يوم |
| **3.1** | Calendar + Events UI | migration 026 + OAuth + sync worker + قائمة أحداث + ربط حلقة + استثناء/تفعيل | مزامنة فعلية لحساب حقيقي؛ incremental sync أقل من 60s؛ اختبارات API | 1.5–2 يوم |
| **3.2** | Bot skeleton + self-test | خدمة Node/systemd + state machine + DB queue + claim/heartbeat + تسجيل شاشة اختبارية إلى MP4/HLS (بدون Meet) | self-test ينتج MP4+HLS بحالة ready؛ لا تسريب أداء | 2 يوم |
| **3.3** | Meet join + live capture | Playwright join (mute/camera off) + Xvfb/Pulse/FFmpeg/MediaMTX + HLS حي + SSE + مشغل Vidstack | تسجيل حصة حقيقية تجريبية؛ LIVE/DVR/stop تلقائي | 3 يوم |
| **3.4** | Drive upload + media lifecycle | rclone copy/checksum/link + حالات الرفع + إعادة رفع + حذف يدوي محمي + استبعاد الحذف التلقائي | رفع فعلي لـDrive + رابط يعمل + حذف محلي بعد تحقق | 1.5 يوم |
| **3.5** | Manual controls + reliability | start now/stop/reschedule/retry/reset + reconnect + waiting-room + reaper + disk guards + notifications | سيناريوهات فشل مختبرة + لا عملية يتيمة | 1.5 يوم |
| **3.6** | Security + hardening | الصلاحيات/الAudit/X-Accel/headers/rate limits/cgroup + اختبارات سلبية + مراجعة أمنية | اختبارات سلبية (401/403/IDOR) + pen-checklist | 1 يوم |
| **3.7** | QA + deploy | Playwright E2E، QA بصري 390/1440، rehearsal على staging/نافذة صيانة، update.sh، docs/11+19، checkpoint | تشغيل حصة حقيقية على الإنتاج + rollback مضمون | 1–2 يوم |

**الإجمالي التقديري: ~13–15 يوم عمل مركّز** (بعد الموافقة والقرارات). كل مرحلة = build + checkpoint + commit، وبتقسيم ملفات ≤ 400 سطر.

---

## 9. القرارات المطلوبة من المالك قبل البدء

1. **نوع حساب Google:** Gmail شخصي أم Google Workspace؟ (Workspace يفتح خيار Recording API رسمي — لكن بتكلفة/إعداد؛ الشخصي = بوت متصفح فقط). هل 2FA مفعّل ومَن يملك الوصول للسيرفر لإدخاله يدويًا أول مرة؟
2. **رابط Drive:** anyone-with-link (يفتح لكل من لديه الرابط) أم restricted + مشاركة ببريد محدد؟ (يؤثر على خصوصية الحلقات).
3. **سياسة التسجيل والموافقة:** إخطار المعلمة/الطالبات، وهل كل الحلقات تُسجَّل أم حلقات مختارة فقط؟
4. **الحد الأقصى للجلسات المتزامنة:** توافق على 1 على هذا السيرفر؟ (بديل: VPS منفصل للبوت ~8–12 دولار/شهر).
5. **حدود القرص:** عتبات التحذير/المنع (مقترح: منع أقل من 25GB، تحذير أقل من 40GB).
6. **HLS بعد الانتهاء:** نحذف segments الحية بعد finalize ونبقي MP4 للمشاهدة (مقترح) أم إبقاء الاثنين؟
7. **صلاحيات المشاهدة:** مَن يرى التسجيلات في النظام (المالك فقط؟ المدير؟ المشرفة؟).
8. **اعتماد ADR-0006** (جسر جلسة الـAPIين) أو تفضيل تنفيذ الوحدة داخل legacy API مؤقتًا.
9. **قبول مخاطر Google** (احتمال حظر/تحدي دخول البوت) وخطة الطوارئ اليدوية.
10. **rclone OAuth client مخصص** قبل تفعيل الرفع طويل الأمد (حالياً shared client ID سيتقاعد 2026).

---

## 10. ملاحظات تنفيذية إضافية

- **التوقيت:** كل حسابات الزمن على Africa/Cairo للجدولة والعرض، وتخزين UTC في DB؛ البوت يدخل T-60s ويقف عند end+هامش دقيقتين؛ DST يُعالج عبر تسجيل end UTC من Google.
- **القيود الحالية:** لا Docker إنتاج (systemd مباشر)؛ لا نضيف Redis/Kafka؛ كل الملفات الجديدة ≤ 400 سطر وفق docs/04.
- **لا يكسر الخطة الحالية:** يضاف كـPhase 3.0 بعد 2.9؛ لو المالك عايز تقديمه، ننفذ 3.0/3.1 فقط أولًا (Calendar + قائمة الأحداث) لتسليم سريع ثم بقية التسجيل.
- **تراجع آمن:** البوت وحدة مستقلة يمكن تعطيلها (systemctl stop dar-meet-bot) دون أي تأثير على الموقع؛ كل endpoints الجديدة مستقلة.
