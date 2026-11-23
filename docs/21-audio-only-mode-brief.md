# Dar Meet Recorder — وضع التسجيل الصوتي فقط (Brief للتنفيذ)

> اقرأ هذا الملف مع `docs/20-meet-recorder-handoff.md` (المعمارية والأوامر). هنا: ماذا اكتشفنا في جلسة التشخيص، وما المطلوب تنفيذه.
> الهدف: إضافة `BOT_RECORD_MODE=video|audio` (الافتراضي `video`، لا تكسر شيئًا).

---

## 1) ملخص ما وصلنا إليه (قياسات حقيقية على السيرفر)

### المشاكل التي كانت موجودة وأسبابها
| العرض | السبب المقاس | الإصلاح (منشور على السيرفر) |
|---|---|---|
| تقطيع صوت (حوالي 105 انقطاع/دقيقة، حتى 1 ثانية) | **Chromium نفسه**: بافر إخراج الصوت الافتراضي صغير فيضيّع أجزاء تحت الحمل. (اختبار معزول: نغمة من ffmpeg مباشرة إلى Pulse = 0 انقطاع؛ نغمة من Chromium تحت حمل = 232 انقطاع/دقيقة؛ مع `--audio-buffer-size=16384` = 0) | `--audio-buffer-size=16384` (`BOT_CHROME_AUDIO_BUFFER`) |
| ضياع نهاية التسجيل (37 ثانية من 232) | ffmpeg يتأخر عن الزمن الحقيقي (speed < 1.0x) فيضيع ما في الطوابير عند SIGINT | `BOT_FRAMERATE=15` + سجل `ffmpeg progress` + رفع أولوية الـCPU |
| وقفات متقطعة في ffmpeg | تزاحم الـCPU مع مواقع أخرى على نفس السيرفر (next-server حتى 180%) | `systemctl set-property dar.slice CPUWeight=400` |

### أرقام قبل/بعد (نفس طريقة القياس)
| | الأول | الآن |
|---|---|---|
| ضياع نهاية التسجيل | 16% | **0.7%** (3 ثواني من 429) |
| انقطاعات الصوت/دقيقة (يشمل الوقفات الطبيعية) | 105 | **17** |
| ffmpeg speed | < 1.0x | **0.99–1.0x** |

### ما ثبت أنه **ليس** السبب
- الشبكة (فقد الحزم 0.02%، jitter منخفض، WebRTC concealed = 0).
- PulseAudio/null sink (سليم).
- ffmpeg لا يقطع الصوت (تسجيل `audio.wav` منفصل بـparecord يحمل نفس الانقطاعات بنفس الأماكن 95%).
- فحص ffprobe لفراغات الباكتات كان **أعمى** لهذا النوع (الملف متصل التوقيت لكن فيه سكتات).

### تكلفة الفيديو (قياس ffmpeg وحده تحت حمل)
720p15 = 54% core · 720p12 = 45% · 540p12 = 40% · 480p12 = 44% · 480p10 = 29%.
التوفير من تقليل الدقة صغير. المستهلك الأكبر هو **Chromium (فك فيديو Meet + رسم) وXvfb**، والبوت كله ≈ 3 cores من 4. السيرفر مشترك مع مواقع أخرى (RIGX وZawawi وPostgres ≈ 0.3 core متوسط، دفعات حتى 1.8).

### حالة الريبو / السيرفر
- الفرعان `fix/meet-audio-tap` و`fix/meet-ffmpeg-lag` مدموجان في main. الفرع `fix/chrome-audio-buffer` **منشور على السيرفر لكن غير مدموج** في main (ادمجه أولًا).
- النشر: ليس `update.sh`. انسخ الملفات المتغيرة من GitHub إلى `/opt/dar-meet-bot/src/` (مثال: `git -C /opt/dar show origin/main:services/meet-recorder/src/<file> | sudo -u dar tee /opt/dar-meet-bot/src/<file>`)، ثم `cd /opt/dar-meet-bot && sudo -u dar npx tsc -p tsconfig.json`، ثم `sudo systemctl restart dar-meet-bot`. خذ نسخة `dist.bak` قبل ذلك، ولا تعد التشغيل أثناء تسجيل.
- الإعدادات في `/etc/dar/meet-bot.env` (أُضيف `BOT_FRAMERATE=15`).

---

## 2) المطلوب: `BOT_RECORD_MODE=audio`

### التصميم المقترح (الأخف حملًا)
في وضع `audio` **لا نشغّل ffmpeg أثناء الجلسة أصلًا**:

1. أثناء الجلسة: عملية `parecord` فقط (هي موجودة بالفعل كـ"audio tap" في `capture.ts`: `nice -n -5 parecord --device=<sink>.monitor --rate=48000 --channels=2 --format=s16le --latency-msec=100 --file-format=wav audio.wav`). مفيش x11grab ولا libx264 ولا HLS.
2. عند الإيقاف: أوقف parecord بـSIGINT (يغلق ترويسة WAV)، ثم حوّل:
   `ffmpeg -y -v error -i audio.wav -c:a aac -b:a 96k -ar 48000 -ac 2 -movflags +faststart recording.mp4`
   وبعد نجاح التحويل احذف `audio.wav` (ساعة ≈ 660MB مؤقتًا).
3. لا poster ولا HLS. الـAPI يتعامل مع `mp4` فقط كنوع أساسي (`kind='mp4'`)، وملف mp4 صوتي فقط يُشغَّل في الواجهة بدون تغيير.
4. Pause/Resume: SIGSTOP/SIGCONT على parecord (الكود الحالي يفعل ذلك للـtap).

### نقاط يجب التحقق منها في الكود
- `jobs/recording.ts`: مصفوفة `artifacts` تضيف `hls` دائمًا و`poster` اختياريًا → اجعل `hls` اختياريًا أيضًا. افحص `MeetMediaRepository.cs` و`MediaEndpoints.cs` (يسمّي الملف `.mp4` للأنواع غير poster) ويقبل غياب `hls`/`poster`.
- `media/capture.ts`: `finalize()` يفترض وجود فيديو (`recording.raw.mp4`، poster، عدد مقاطع HLS). أضف مسارًا `AudioOnlyCapture` (أو وضعًا في `ScreenCapture`) بدل ترقيع الشروط.
- `probeDuration` يعمل مع الصوت. `durationSeconds` مطلوب للـAPI.
- Xvfb وChromium يبقيان كما هما (المتصفح يحتاج شاشة). **تجربة اختيارية بعد التنفيذ**: Xvfb أصغر (مثلًا 800x450) في وضع audio لأن Meet يطلب فيديو أقل دقة للمربعات الصغيرة، فينخفض فك الفيديو في Chromium. قِس قبل أن تعتمدها (قد تتغير واجهة Meet وselectors الدخول).
- أبقِ `BOT_AUDIO_TAP` للوضع `video` كما هو.

### إضافات مقترحة (أفكار)
1. **تقرير جودة تلقائي عند الإنهاء**: سجّل `wallSeconds` (من بدء التسجيل لإيقافه) مقابل `durationSeconds` للملف، وحذّر (`logger.warn`) لو الفرق > 2%. هذا كان سيكشف مشكلة ضياع النهاية فورًا.
2. **سجل webrtc audio**: أبقِ كما هو (كل 5 ثواني) — مفيد للتحقق من الشبكة.
3. **اختيار الوضع لكل حصة لاحقًا**: حقل `recordMode` في الـjob من الـAPI (مرحلة ثانية). الآن إعداد عام في env فقط.
4. **لا تعدّل** `CPUWeight`/Nice/قيود systemd. **لا تضف** `CPUQuota` (سبّب تقطيعًا سابقًا).

### معايير القبول
- تسجيل 4+ دقائق في وضع audio: مدة `recording.mp4` ≈ مدة الجلسة الفعلية (فرق < 1%)، لا HLS، يُشغَّل من اللوحة.
- استهلاك المعالج أثناء الجلسة أقل بوضوح من وضع video (`top` على Chrome/Xvfb/parecord، بدون ffmpeg).
- `tsc` و`vitest` ينجحان. الوضع الافتراضي `video` يسلك كما قبل تمامًا.
- لا أسرار في الريبو.
---

## ✅ التنفيذ والنشر — 23 Nov 2026 (Cairo)

- **التنفيذ:** `BOT_RECORD_MODE=audio|video` (الافتراضي video) في `services/meet-recorder/src/config.ts`.
  - في وضع audio: `ScreenCapture` يشغّل `parecord` فقط (48kHz stereo s16le) طوال الحصة، **بلا x11grab ولا libx264 ولا HLS**.
  - عند الإيقاف: تحويل WAV→AAC/MP4 (`-b:a 128k`، faststart) ثم حذف WAV، مع duration/SHA-256.
  - `selftest.ts` يدعم الوضع ويقيس المدة؛ `jobs/recording.ts` لا يرسل آرتيفاكت hls/poster في audio mode (mp4 فقط).
  - أضيفت تبعية `playwright ^1.65.1` إلى `package.json` (كانت موجودة على السيرفر فقط).
- **النشر الفعلي على السيرفر (14:19 Cairo):** نسخة احتياطية `src.bak.20261123-141839` + `meet-bot.env.bak.20261123-141839`، `npx tsc` OK، ثم audio selftest: **MP4 15.2s، 8,018 bytes (صمت رقمي)، 0 failures**، ثم `BOT_RECORD_MODE=audio` + `BOT_CHROME_AUDIO_BUFFER=16384` في `/etc/dar/meet-bot.env` و`systemctl restart dar-meet-bot` → **active**.
- **التأثير المتوقع:** إزالة ترميز الفيديو (~54% core في 720p15) وx11grab يفرغ CPU لـChromium، فتقل احتمالية underrun الصوت بشدة. لا ينتج HLS/poster وبالتالي **لا بث حي** لهذه الحصص — التسجيل للصوت فقط ويُشغَّل من لوحة التسجيلات.
- **التحقق بعد الحصة:** `ffprobe` للمدة + حجم الملف + `ffmpeg -af silencedetect` لكشف أي فراغات صوتية.

### الرجوع إلى وضع الفيديو (لو احتجت)
```bash
sudo sed -i 's/^BOT_RECORD_MODE=.*/BOT_RECORD_MODE=video/' /etc/dar/meet-bot.env
sudo systemctl restart dar-meet-bot
```
وللرجوع الكامل للكود: استعد `src.bak.20261123-141839` ثم `npx tsc` وأعد التشغيل.