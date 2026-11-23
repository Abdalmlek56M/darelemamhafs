# Dar Meet Recorder — Handoff Brief

> ملف تسليم تقني كامل. اِلصقه كما هو لأي مهندس/مساعد (Claude وغيره) ليفهم النظام ويصلح أي مشكلة بدون تخمين.
> آخر تحديث: 23 نوفمبر 2026 · الكوميت على GitHub: `e88503a` (وما بعده)

---

## 1) ما يفعله النظام

بوت يدخل حصص **Google Meet** بحساب الدار نفسه (فيصبح **المضيف**)، ويعزّف صوت الاجتماع إلى
**PulseAudio null sink** غير مسموع، ويسجّل **شاشة X الافتراضية + الصوت** بـFFmpeg إلى:

- `recording.mp4` (H.264 + AAC، faststart)
- `hls/index.m3u8` + مقاطع 2 ثانية (للبث المباشر لاحقًا)
- `poster.jpg` + `sha256`

ثم يبلّغ واجهة الـAPI بالحالة والملفات، فتظهر في لوحة الإدارة (مشاهدة/تحميل).

**القيد:** حساب Gmail شخصي → لا Recording API رسمي. الحل هو الأتمتة عبر Playwright.

---

## 2) المكوّنات

| المكوّن | التقنية | المسار على السيرفر |
|---|---|---|
| API + الواجهة | .NET 10 minimal API + React 19 | `/opt/dar/app/api`, `/opt/dar/app/legacy` |
| قاعدة البيانات | PostgreSQL 17 | `dareltahfeez` (28 migration) |
| البوت | Node 24 + TypeScript + Playwright + FFmpeg | `/opt/dar-meet-bot` |
| الشاشة الافتراضية | `Xvfb :99` 1280x720x24 | يبدأها البوت |
| الصوت | PulseAudio خاص بالبوت + `module-null-sink` | `$XDG_RUNTIME_DIR/pulse/native` |
| البروفايل | Chromium persistent profile (دخول Google مرة واحدة) | `/var/lib/dar/meet/profile` (0700) |
| الوسائط | ملفات الحصص | `/var/lib/dar/media/meet/jobs/<jobId>/` |

### مسار الطلب

```
Calendar Sync → meet_events (+meet_event_links)
      ↓ (كل 15s) MeetSchedulerWorker
meet_bot_jobs (scheduled, join_at = start − join_lead)
      ↓ claim (واحد متزامن فقط)
Bot: Xvfb → PulseAudio+sink → Chromium(profile) → Join → Open access → FFmpeg
      ↓ heartbeat كل 5s (participants, audioOk) + أوامر (stop/pause)
meet_sessions (live) → finalize → meet_media_assets (mp4/poster/hls) → ready
      ↓
API: /api/v1/meet/sessions + /api/v1/meet/media/{id} (Range) → اللوحة
```

### ملفات البوت المهمة

```
services/meet-recorder/src/
  index.ts            # الأوضاع: poller | login | join | selftest + إغلاق آمن
  lifecycle.ts        # علم الإيقاف التعاوني (SIGTERM)
  config.ts           # كل المعاملات من env
  media/display.ts    # Xvfb
  media/audio.ts      # PulseAudio + null sink + sinkInputs()
  media/capture.ts    # بناء أمر FFmpeg + finalize (faststart/poster/hash)
  media/process.ts    # spawn + SIGINT/SIGKILL + SIGSTOP/SIGCONT
  meet/browser.ts     # Chromium persistent + fullscreen عبر CDP
  meet/join.ts        # دخول، كتم، Switch here، كشف الحضور
  meet/access.ts      # Open/Trusted + قبول الضيوف + عدّاد المشاركين
  jobs/recording.ts   # الدورة الكاملة + heartbeat + pause/resume
  jobs/poller.ts      # claim loop
  api/darClient.ts    # عميل الـAPI الداخلي
```

---

## 3) الأوامر الفعلية (كما تعمل الآن على الإنتاج)

### Xvfb
```
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp -ac -dpi 96
```

### PulseAudio (طفل مُدار)
```
pulseaudio --daemonize=no --exit-idle-time=-1 --log-target=stderr --log-level=warn
pactl load-module module-null-sink sink_name=darmeet_job sink_properties=device.description=DarMeet
pactl set-default-sink darmeet_job ; pactl set-default-source darmeet_job.monitor
# env للبوت والمتصفح: XDG_RUNTIME_DIR, PULSE_RUNTIME_PATH, PULSE_SERVER=unix:<rt>/pulse/native
```

### Chromium (Playwright persistent)
```
--no-sandbox --disable-dev-shm-usage --kiosk --start-fullscreen --disable-gpu
--disable-blink-features=AutomationControlled
--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
--autoplay-policy=no-user-gesture-required --hide-crash-restore-bubble
--disable-session-crashed-bubble --lang=en-US --window-size=1280,720 --start-maximized
# بعد الإطلاق: CDP Browser.setWindowBounds(windowState=fullscreen)
```
> مهم: `--kiosk` يُتجاهل من مُشغّل Playwright؛ لذلك نستخدم CDP. النتيجة: التسجيل بلا شريط تبويبات/عنوان.

### FFmpeg (الأمر الحالي بالحرف)
```
ffmpeg -hide_banner -nostdin -loglevel warning -y \
  -thread_queue_size 1024 -f x11grab -draw_mouse 0 -framerate 30 -video_size 1280x720 -i :99 \
  -thread_queue_size 1024 -f pulse -fragment_size 8192 -i darmeet_job.monitor \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset ultrafast -tune zerolatency -threads 3 \
  -pix_fmt yuv420p -b:v 2500k -g 60 \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -af "aresample=async=1:min_hard_comp=0.01:first_pts=0" \
  -f mp4 <dir>/recording.raw.mp4 \
  -f hls -hls_time 2 -hls_list_size 0 -hls_flags independent_segments \
       -hls_segment_filename <dir>/hls/seg%04d.ts <dir>/hls/index.m3u8
# ثم finalize: remux -c copy -movflags +faststart → recording.mp4
# ثم poster: -ss 1 -frames:v 1 -q:v 3 poster.jpg
# ثم sha256 على recording.mp4
```

### systemd
```
# /etc/systemd/system/dar-meet.slice
[Slice]
MemoryMax=3G
CPUWeight=50
IOWeight=100

# /etc/systemd/system/dar-meet-bot.service
[Service]
User=dar ; Slice=dar-meet.slice ; WorkingDirectory=/opt/dar-meet-bot
Restart=always ; RestartSec=10 ; KillSignal=SIGTERM ; TimeoutStopSec=300
RuntimeDirectory=dar-meet ; RuntimeDirectoryMode=0700
NoNewPrivileges=true ; PrivateTmp=true ; ProtectSystem=strict ; ProtectHome=true
ReadWritePaths=/var/lib/dar /run/dar-meet
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
Nice=10 ; LimitRTPRIO=95 ; LimitNICE=-11
```

**ممنوع** `CPUQuota=` — سبق أن سبّب تقطيعًا (انظر §5).

---

## 4) كيف نقيس (الأوامر التي نستخدمها للحكم)

```bash
# مدة ومسارات
ffprobe -v error -show_entries format=duration -of csv=p=0 file.mp4
ffprobe -v error -show_entries stream=codec_type,duration,nb_frames -of compact file.mp4

# عدد الفريمات لكل ثانية (يكشف «الفريم في الثانية»)
ffprobe -v error -select_streams v:0 -show_entries frame=pts_time -of csv=p=0 file.mp4 \
 | awk '{b=int($1); c[b]++} END{for(i=0;i<=200;i++) if(c[i]) printf "%ds:%d ", i, c[i]}'

# فراغات الصوت (باكتات)
ffprobe -v error -select_streams a:0 -show_entries packet=pts_time -of csv=p=0 file.mp4 \
 | awk 'NR>1{d=$1-p; if(d>0.06) c++; if(d>m)m=d} {p=$1} END{printf "gaps>60ms=%d worst=%.3fs\n", c+0, m+0}'

# سجل ffmpeg المباشر (fps/speed/dup/drop)
ffmpeg ... -loglevel info -stats 2> /tmp/ffmpeg.log   # ثم: grep -E "frame=.*fps=.*speed=" /tmp/ffmpeg.log
```

### نتائج القياس الحالية (مرجع)

| الاختبار | النتيجة |
|---|---|
| 90 ثانية، شاشة شبه ثابتة + نغمة مستمرة | **30 فريم/ثانية في كل ثانية 0→89** · `speed=1.01x` · `dup=91 drop=89` · مدة 90.000s |
| 40 ثانية (مختبر) | مدة 40.000s · صوت 40.000s · **0 فراغات > 60ms** |
| اختبار إنتاج 27s | فيديو 26.97s · صوت 26.90s · **0 فراغات** (أسوأ 0.021s = تباعد AAC طبيعي) |
| إصلاح الصوت (خطوة سابقة) | من 50 فراغًا/أسوأ 405ms → 0 فراغًا |

---

## 5) أعطال تم تشخيصها وإصلاحها (لا تُعاد)

| العرض | السبب المقاس | الإصلاح |
|---|---|---|
| الملف قصير جدًا (376s تسجيل → 124s ملف) + تقطيع صوت | `CPUQuota` على الـslice: `nr_throttled=43049 / nr_periods=73889` → تجميد ffmpeg كل 100ms | إزالة السقف، الاعتماد على `Nice=10` + `CPUWeight=50` |
| تقطيع صوت إضافي 60–300ms | `-use_wallclock_as_timestamps` على pulse يجعل كل تأخير «فراغًا» | إزالته + `aresample=async=1:min_hard_comp=0.01:first_pts=0` |
| المكالمة تسقط بعد ~50s («Couldn't start the video call») | `RestrictAddressFamilies` يحجب `AF_NETLINK` → WebRTC بلا candidates | إضافة `AF_NETLINK` |
| PulseAudio يفشل بالبداية | `/var/lib/dar` read-only داخل sandbox | `ReadWritePaths=/var/lib/dar` |
| إعادة تشغيل الخدمة تُفقد التسجيل | SIGKILL بدون finalize | `lifecycle.ts` + `TimeoutStopSec=300` |
| «Switch here» (الحساب داخل مكالمة أخرى) | تشغيل سابق لم يخرج | نقر takeover + `leaveCall` عند النهاية |
| كشف حضور كاذب | كان يعتبر اختفاء زر Join نجاحًا | الكشف يشترط وجود عناصر المكالمة (`Leave call`) عبر `document.querySelectorAll` |

---

## 6) الشكوى الأخيرة: «30fps أول 7 ثوانٍ ثم 1fps»

**لم تتكرر على النسخة الحالية.** القياس أعلاه (90s → 30fps في كل ثانية) يثبت ذلك.

افتراضات مُرجّحة إن ظهرت عندك:

1. **ملف قديم** (قبل إصلاح السقف/الصوت) — قارن تاريخ الملف بالكوميت `e88503a`.
2. **عدّاد «فريمات فريدة»** في بعض أدوات الفحص: شاشة ثابتة = فريمات مكررة، فيظهر «1fps» رغم أن الملف 30fps.
   — تحقق من عدد الفريمات الفعلي بالأمر في §4.
3. **Chromium يوقف الرسم** لو النافذة غير مرئية/مصغّرة (kiosk+fullscreen عبر CDP يمنع ذلك الآن).
4. جهاز/شبكة العميل تعرض الفيديو ببطء (المشكلة في المشاهدة لا في الملف).

**لو تكرر:** خُد `ffmpeg.log` من الخدمة (`journalctl -u dar-meet-bot`)، وقِس بندول الثواني، وشارك الناتج.

---

## 7) تقييم الاقتراحات الواردة

| الاقتراح | الحكم | الملاحظة |
|---|---|---|
| `--kiosk` / `--start-fullscreen` | ✅ **مُطبّق** | لكن Playwright يتجاهلها → نُفِّذ عبر CDP |
| `--disable-gpu` | ✅ مُطبّق | مع `--enable-unsafe-swiftshader` الموجود |
| `-framerate 15` | 🟡 اختياري | يقلل الحمل ~20%؛ 30 يعمل الآن. يُفعّل بـ`BOT_FRAMERATE=15` |
| `-thread_queue_size 4096` | 🟡 مقبول | عندنا 1024 ولا يمتلئ (`drop` طبيعي) |
| `-preset veryfast -tune stillimage` | ❌ غير مناسب | `stillimage` يفترض محتوى ثابتًا ويضر الحركة؛ والأثقل `veryfast` يزيد الحمل بلا داعٍ |
| `-af aresample=async=1` | ✅ **مُطبّق** | بالصيغة الأقوى `async=1:min_hard_comp=0.01:first_pts=0` |
| `-crf 23` بدل bitrate | 🟡 | يسهّل الجودة لكن يجعّل الحجم غير متوقع؛ الأفضل لساعات طويلة: `-crf 26 -maxrate 3M -bufsize 6M` |
| `-i default` | ❌ | يجب `darmeet_job.monitor` (default = المايك الوهمي) |
| Xvfb 1280x720x24 | ✅ | هو المستخدم |

---

## 8) قيود يجب احترامها

- **تزامن واحد** فقط (claim في قاعدة البيانات). لا تُشغّل جلستين.
- **Google Meet فقط**؛ أي رابط آخر يُرفض في الـAPI.
- الحساب هو **مالك الاجتماع** → لا غرفة انتظار للبوت. للآخرين: البوت يحوّل الوصول إلى Open ويقبل الطلبات آليًا.
- **لا أسرار في الريبو**: Google Client Secret و Internal Token في `/etc/dar/meet.env` (0640).
- **التجارب معزولة**: `/var/lib/dar/meet-lab` وشاشة `:98` — لا تلمس الإنتاج أثناء وجود تسجيل.
- **النشر**: `sudo bash /opt/dar/deploy/update.sh` (backup → pull → build → migrate → swap → smoke → rollback).
  البوت يُعاد بناؤه منفصلًا: `tsc -p tsconfig.json` داخل `/opt/dar-meet-bot`.

---

## 9) أوامر تشخيص سريعة

```bash
systemctl status dar-meet-bot --no-pager
journalctl -u dar-meet-bot -n 80 --no-pager
sudo -u postgres psql -d dareltahfeez -c \
  "SELECT id,status,round(extract(epoch from now()-heartbeat_at)) AS hb_age,participants,pause_requested,stop_requested_at IS NOT NULL AS stop FROM meet_bot_jobs ORDER BY created_at DESC LIMIT 5;"
sudo -u postgres psql -d dareltahfeez -c \
  "SELECT status, duration_seconds, participants FROM meet_sessions ORDER BY started_at DESC LIMIT 5;"
cat /sys/fs/cgroup/dar.slice/dar-meet.slice/cpu.stat   # nr_throttled يجب ألا يزيد
sudo -u dar env HOME=/var/lib/dar XDG_RUNTIME_DIR=<rt> PULSE_SERVER=unix:<rt>/pulse/native pactl list sink-inputs short
```

---

## 10) ما لم يُنفَّذ بعد

- رفع MP4 إلى Google Drive (rclone) + حذف محمي بضغطتين (3.4).
- بث مباشر MediaMTX + SSE + مشغل متقدم (3.6).
- إعادة انضمام تلقائية + فحص جلسة Google قبل كل حصة + تنبيهات بريد (3.5).
- نشر تطبيق Google (الخروج من وضع Testing → التوكن لا ينتهي كل 7 أيام).
