# Meet — Operations Runbook (Phase 3.0 / 3.1)

**Status:** يغطي المنفَّذ حاليًا (تقويم Google + نطاق التسجيل). أقسام البوت/البث/الرفع تُضاف في 3.2 → 3.4.
**Related:** `docs/adr/0006-meet-auth-bridge.md`، `docs/adr/0007-meet-recording-architecture.md`، `docs/18-meet-recording-plan.md`، `docs/11-deployment.md`.

---

## 1. متغيرات البيئة المطلوبة

تُوضع أسرار Meet في **`/etc/dar/meet.env`** بصلاحيات `640 root:dar`، ويقرأها `dar-api` عبر `EnvironmentFile=-/etc/dar/meet.env` (سطر أضافه `deploy/setup-host-services.sh` ويكتب الملف أول مرة بمفتاح تشفير عشوائي).

```env
# Google Cloud Console → OAuth 2.0 Client (Web application)
Meet__Google__ClientId=...apps.googleusercontent.com
Meet__Google__ClientSecret=...
Meet__Google__RedirectUri=https://dar-elemam-hafs.rigxhardware.com/api/v1/meet/calendar/callback

# 32 bytes base64 (AES-256-GCM) — يُولَّد تلقائيًا مع أول إنشاء للملف
#Meet__EncryptionKey=...

# اختياري
#Meet__SyncIntervalSeconds=60
#Meet__FullSyncHours=6
#Meet__AdminRedirectPath=/management
```

**مفتاح Data Protection مشترك (إلزامي للـAPIين):** يُكتب في **`/etc/dar/api.env` و`/etc/dar/legacy.env` معًا** (يفعلها `deploy/setup-host-services.sh` تلقائيًا):

```env
DataProtection__KeysPath=/var/lib/dar/keys
```

**قواعد:**
1. لا تُكتب هذه القيم في appsettings.json ولا في Git ولا في اللوجات.
2. تغيير `Meet__EncryptionKey` يُفقد كل refresh tokens المخزنة → يلزم إعادة ربط Google.
3. تغيير `DataProtection__KeysPath` أو حذف المفاتيح → كل جلسات الأدمن والمعلمات تُلغى.
4. `EnvironmentFile=-` بعلامة `-` تعني «اختياري»: لو الملف غير موجود فالخدمة تعمل والوحدة تبقى «غير مهيأة» (fail-closed) بدل أن تسقط.
5. ترتيب `EnvironmentFile` مهم: `meet.env` يأتي **بعد** `api.env` فقيمه هي التي تُطبَّق عند التعارض.

## 2. حلقة مفاتيح Data Protection (ADR-0006)

```bash
sudo install -d -o dar -g dar -m 0700 /var/lib/dar/keys
# بعد إضافة البيانات إلى /etc/dar/api.env و /etc/dar/legacy.env:
sudo systemctl restart dar-legacy dar-api
sudo ls -la /var/lib/dar/keys   # مفتاح واحد على الأقل: key-*.xml
```

- النسخة الاحتياطية الحالية لا تشمل `/var/lib/dar/keys` بعد؛ أضِفه قبل الاعتماد الكامل (بند 3.7).
- **بعد أول نشر يحتوي ADR-0006:** كل مستخدمي لوحة الإدارة يُعاد تسجيل خروجهم مرة واحدة (purpose strings تغيّر).

## 3. إعداد Google Cloud (مرة واحدة)

1. أنشئ Project جديدًا باسم الدار في Google Cloud Console.
2. فعّل **Google Calendar API**.
3. شاشة الموافقة (OAuth consent screen): External + حالتك، أضف بريد حساب الدار في Test users إن كانت الشاشة في وضع Testing.
   - ملاحظة: في وضع Testing ينتهي refresh token بعد 7 أيام → اضبط الحالة إلى **In production** قبل التشغيل الفعلي.
4. Credentials → OAuth client ID (Web application):
   - Authorized redirect URI = القيمة في `Meet__Google__RedirectUri` أعلاه (تطابق حرفي مطلوب).
5. انسخ Client ID/Secret إلى `/etc/dar/meet.env` وأعد تشغيل dar-api.

## 4. الربط وإعادة الربط

1. لوحة الإدارة → **التسجيل والمحاضرات** → «ربط Google».
2. سجّل الدخول بحساب Gmail المخصص للدار ووافق على قراءة التقويم فقط.
3. التحويل يعود إلى `/management?meet=connected`. اضغط «مزامنة الآن».
4. ظهور «يحتاج إعادة ربط» (`needs_reconnect`) يعني: التوكن مرفوض/منتهٍ → «إعادة الربط» من نفس البطاقة. الجدولة تتوقف تلقائيًا حتى الإصلاح (fail-closed).
5. «فصل التقويم» يُبطل التوكن النشط ويُبقي الأحداث والروابط التاريخية.

## 5. المزامنة

- الخلفية: `CalendarSyncWorker` كل 60 ثانية (incremental عبر `syncToken`)، ومزامنة كاملة كل 6 ساعات أو عند `410 Gone`.
- يدويًا: «مزامنة الآن» أو «مزامنة كاملة» من البطاقة (تحتاج `meet.calendar.manage`).
- نافذة المزامنة الافتراضية: 30 يومًا للخلف و60 يومًا للأمام (قابلة للضبط في MeetOptions).
- الأحداث بدون رابط Meet تُعرض بشارة «بلا رابط Meet» ولا تدخل نطاق التسجيل.

## 6. نطاق التسجيل

- «نطاق التسجيل» = الحلقات التي فعّل المالك لها **التسجيل التلقائي**.
- «الربط التلقائي» يربط الحدث بالحلقة عند ظهور اسمها في العنوان (تطابق 100%). الربط اليدوي لا يُستبدل تلقائيًا.
- كل حدث يمكن تجاوزه: «تسجيل دائمًا» أو «عدم التسجيل» (يحتاج `meet.manage`).

## 7. الصلاحيات

| الصلاحية | المالك/الأدمن | المشرفة (افتراضيًا) |
|---|---|---|
| `meet.view` | ✅ | ✅ |
| `meet.manage` | ✅ | ❌ |
| `meet.calendar.manage` | ✅ | ❌ |
| `meet.media.view` | ✅ | ✅ (قابلة للسحب) |
| `meet.media.delete` | ✅ | ❌ |

- تُمنح تلقائيًا في migration 026 لمن يملك `users.manage` (الخمسة) و`supervisor.portal` (view + media.view).
- السحب يسري فورًا لأن الجسر يُعيد قراءة `user_permissions` في كل طلب.

## 8. التحقق السريع (smoke)

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/v1/meet/calendar/status   # 401 بدون جلسة
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/management                    # 200
sudo journalctl -u dar-api -n 200 --no-pager | grep -i 'meet'
```

في الواجهة: «مزامنة الآن» يجب أن تُرجع أعدادًا، والأحداث تظهر في تبويب «أحداث التقويم».

## 9. أعطال شائعة

| العرض | السبب المحتمل | الإجراء |
|---|---|---|
| «وحدة التسجيل غير مهيأة» + قائمة مفاتيح | `meet.env` غير محمّل أو المفتاح ليس 32 بايت base64 | صحّح الملف ثم `systemctl restart dar-api` |
| `401` على كل `/api/v1/meet/*` مع أنك مسجّل في الإدارة | حلقة مفاتيح Data Protection مختلفة بين الـAPIين أو اسم تطبيق مختلف | تحقق من `DataProtection__KeysPath` + إعادة تشغيل الاثنين + لوج `dar-api` |
| `403` بعد منح الصلاحية | الجلسة تحمل الـclaims القديمة للمعلمات فقط؛ جسر الأدمن يحدّثها تلقائيًا لكن `/me` قد يُخزَّن مؤقتًا | أعد تحميل الصفحة |
| «يحتاج إعادة ربط» | توكن منتهٍ/ملغى/Testing mode 7 أيام | أعد الربط |
| `invalid_state` عند العودة من Google | انتهت مهلة 10 دقائق أو تغيّر مفتاح التشفير | أعد المحاولة من الزر |
| مزامنة تعيد `410` دائمًا | `syncToken` تالف | «مزامنة كاملة» أو انتظر المزامنة الكاملة المجدولة |

## 10. بوت التسجيل (3.2)

| الأمر | الاستخدام |
|---|---|
| `systemctl status dar-meet-bot` | حالة الخدمة |
| `sudo journalctl -u dar-meet-bot -f` | متابعة اللوج (JSON سطر لكل حدث) |
| `sudo systemctl restart dar-meet-bot` | إعادة تشغيل |
| `systemctl show dar-meet-bot -p NRestarts --value` | هل في إعادة تشغيل متكررة |
| `systemctl show dar-meet.slice -p MemoryMax -p CPUQuotaPerSecUSec` | حدود الموارد الفعلية |

**الملفات:**

| الملف | المحتوى |
|---|---|
| `/opt/dar-meet-bot` | كود الخدمة + `dist/` (المصدر: `services/meet-recorder` في الريبو) |
| `/etc/dar/meet-bot.env` | `DAR_SERVICE_TOKEN` (نفس `Meet__InternalToken`) وإعدادات الالتقاط — 0640 root:dar |
| `/var/lib/dar/media/meet/<session>/` | `recording.mp4` + `hls/` + `poster.jpg` |
| `/run/dar-meet` | XDG runtime لـPulseAudio (0700 dar) |

**اختبار الالتقاط (بدون Google Meet):**

```bash
sudo systemctl stop dar-meet-bot          # لا تشارك DISPLAY/الصوت مع الخدمة
sudo -u dar env HOME=/var/lib/dar XDG_RUNTIME_DIR=/run/dar-meet \
  BOT_MEDIA_ROOT=/var/lib/dar/media/meet BOT_SELFTEST_SECONDS=30 \
  node /opt/dar-meet-bot/dist/index.js --selftest
sudo systemctl start dar-meet-bot
```
النجاح = سطر JSON فيه `"ok":true` مع `durationSeconds` و`sizeBytes` و`hlsSegments` و`sha256`.

**التحقق من الـAPI الداخلي (بدون طباعة التوكن):**
```bash
TOKEN="$(sudo sed -n 's/^Meet__InternalToken=//p' /etc/dar/meet.env | head -1)"
curl -s -H "X-Dar-Service-Token: $TOKEN" http://127.0.0.1:5081/internal/meet/health
```

**التثبيت/التحديث:** `sudo bash deploy/setup-host-meet.sh` (يضيف `--skip-build` لإعادة استخدام `dist`).

**أعطال البوت:**

| العرض | السبب | الإجراء |
|---|---|---|
| `226/NAMESPACE` عند البدء | `ReadWritePaths` يشير لمجلد غير موجود | تأكد من `/var/lib/dar/media/meet` و`/var/lib/dar/meet` |
| `poller online` لا يظهر | التوكن مختلف بين `meet.env` و`meet-bot.env` | أعد تشغيل الاثنين بعد ضبط `Meet__InternalToken` |
| `health` = 401 من البوت | التوكن قديم بعد إعادة توليده | `systemctl restart dar-api dar-meet-bot` |
| فشل التقاط الصوت (ESRCH) | `XDG_RUNTIME_DIR` مختلف بين PulseAudio وFFmpeg | استخدم نفس البيئة كما في أمر الاختبار أعلاه |

## 11. ما لم يُبنَ بعد (لا تشغّله على الإنتاج)

- **دخول Google Meet فعليًا** (Playwright/Chromium + البروفايل)، البث الحي HLS/DVR عبر MediaMTX، مسارات `/media/meet/*` المحمية، SSE، رفع rclone إلى Drive، والحذف اليدوي المحمي — كلها 3.3 → 3.6.
- حتى ذلك الحين: الخدمة تعمل وتلتقط شاشة وهمية، لكنها **لا تنضم لأي اجتماع ولا تنتج تسجيلات حلقات**؛ المزامنة والربط فقط هما الجاهزان.
---

## وضع التسجيل الصوتي فقط (BOT_RECORD_MODE=audio) — 23 Nov 2026

- مفيد للحصص الصوتية (تلاوة/شرح) حيث الأولوية لنقاء الصوت وحمل السيرفر.
- لا ينتج HLS ولا poster ولا بث حي؛ الأرتيفاكت الوحيد `mp4` (AAC 128k stereo 48kHz) يظهر في لوحة التسجيلات ويعمل مشغل الفيديو/الصوت.
- يستهلك CPU أقل بكثير (لا libx264/x11grab أثناء الحصة)؛ Chromium يبقى مطلوبًا للانضمام واستقبال صوت Meet.
- التشغيل/الإيقاف:
```bash
sudo sed -i 's/^BOT_RECORD_MODE=.*/BOT_RECORD_MODE=audio/' /etc/dar/meet-bot.env   # أو video
sudo systemctl restart dar-meet-bot
sudo journalctl -u dar-meet-bot -n 20 --no-pager
```
- اختبار سريع: `sudo -u dar env HOME=/var/lib/dar bash -lc 'set -a; . /etc/dar/meet-bot.env; set +a; cd /opt/dar-meet-bot && BOT_RECORD_MODE=audio BOT_DISPLAY=97 BOT_SELFTEST_SECONDS=15 node dist/index.js --selftest'`.
- فحص جودة حصة مسجلة:
```bash
ffprobe -v error -show_entries format=duration,size -of default=nw=1 <recording.mp4>
ffmpeg -v error -i <recording.mp4> -af silencedetect=noise=-50dB:d=0.5 -f null - 2>&1 | tail -20
```