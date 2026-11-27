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
## Hardening (Tier 1, Nov 2026)

- **Meet link (1.18):** the link is validated before Xvfb/Chromium start; only `https://meet.google.com/...` is accepted.
- **Reliable final status (1.19):** terminal status reports retry with backoff; if Dar.Api is unreachable they are stored in `.runtime/outbox/` and flushed by the next poll.
- **Disk/wav/HLS (1.20):** space is checked during the lesson (`BOT_DISK_STOP_GB`), `audio.wav` is deleted after a successful finalize, and HLS folders older than `BOT_HLS_RETENTION_DAYS` (default 30) are removed; MP4 archives are kept.
- **Idle stop (1.21):** requires `BOT_IDLE_CONFIRM_TICKS` consecutive low readings and logs the reason; one scrape cannot cut a live lesson.
- **Auto-admit (1.22):** only complete admit labels on visible controls are clicked, and `BOT_AUTO_ADMIT=0` disables it entirely.
- **State machine + tests (1.23):** `src/jobs/stateMachine.ts` is wired into every status report; `npm run typecheck` + `npm test` (config, join/link, capture args, poller, outbox, retention, state machine) run in CI.
- **Recovery (1.24):** startup removes stale `.runtime/job-*` dirs older than `BOT_RUNTIME_RETENTION_HOURS`; the queue itself already skips jobs whose heartbeat is dead.
- **Automation flag risk:** `--disable-blink-features=AutomationControlled` was removed because it only hides automation from Google and can break the signed-in profile in unpredictable ways. The tradeoff: Google may show "browser not secure" or deny joining more often; the bot uses the owner's real profile, so do not add stealth patches without testing.
- **Nginx (1.25):** `/internal/*` must return 404 at the edge; the bot control plane is loopback only.

## New environment variables

`BOT_DISK_STOP_GB`, `BOT_HLS_RETENTION_DAYS`, `BOT_RUNTIME_RETENTION_HOURS`, `BOT_IDLE_CONFIRM_TICKS`, `BOT_AUTO_ADMIT`, `BOT_OUTBOX_MAX_ATTEMPTS`.