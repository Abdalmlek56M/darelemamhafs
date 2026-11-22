# Dar meet recorder bot

خدمة التقاط الشاشة والصوت لحلقات Google Meet (Phase 3.2). تعمل على نفس السيرفر،
معزولة في `dar-meet.slice`، وتتواصل مع `Dar.Api` عبر loopback فقط.

## المكوّنات

| المكوّن | الاستخدام |
|---|---|
| **Node 24 + TypeScript** | الخدمة نفسها (بلا اعتماديات وقت التشغيل في 3.2) |
| **Xvfb** | شاشة وهمية 1280×720 يرسم فيها Chrome |
| **PulseAudio (null sink)** | التقاط صوت الاجتماع عبر monitor source |
| **FFmpeg** | تسجيل MP4 (أرشيف) + HLS (عرض حي) |

## التشغيل

```bash
npm install                 # مرة واحدة (devDependencies فقط)
npm run build               # tsc → dist/
node dist/index.js --selftest   # اختبار الالتقاط (30 ثانية) بلا Google Meet
node dist/index.js              # poller: يسحب المهام من Dar.Api
```

## Self test (معيار قبول 3.2)

يشغّل Xvfb + PulseAudio، يعرض لافتة على الشاشة الوهمية، يسجّل 30 ثانية، ثم يتحقق من:

- وجود `recording.mp4` بحجم منطقي (≥ 50KB)
- مدة ≥ المطلوب − 2 ثانية
- وجود مقاطع HLS (`seg*.ts`) ولافتة `poster.jpg`
- عدم تجاوز حد المساحة (`BOT_DISK_BLOCK_GB`)

ويطبع ملخصًا JSON وينتهي بـ exit code 0 عند النجاح.

## المسارات

```
/var/lib/dar/media/meet/<sessionKey>/recording.mp4   # الأرشيف
/var/lib/dar/media/meet/<sessionKey>/hls/index.m3u8  # البث (مؤقت)
/var/lib/dar/media/meet/<sessionKey>/poster.jpg
```

## الأمان

- الخدمة تستمع على loopback فقط، والـAPI الداخلي محمي بـ`X-Dar-Service-Token`.
- لا تُخزَّن بيانات Google في أي ملف: بروفايل Chrome يُدار يدويًا على السيرفر (3.3).
- لا حذف تلقائي لأي ملف تسجيل نهائي.
