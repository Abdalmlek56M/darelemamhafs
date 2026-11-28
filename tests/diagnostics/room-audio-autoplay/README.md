# تشخيص: منع تشغيل الصوت التلقائي في غرفة الاجتماع

```bash
npm --prefix frontend ci
npm --prefix services/meet-recorder ci
node tests/diagnostics/room-audio-autoplay/run.mjs
```

يحتاج Chromium الخاص بـPlaywright (`npx playwright-core install chromium` من `services/meet-recorder`).
لا يحتاج LiveKit server ولا تشغيل التطبيق ولا أي أسرار.

## ما الذي يثبته

| الحالة | قبل الضغط | بعد الضغط |
|---|---|---|
| بدون أي أمر أتمتة قبل وصول الصوت | محجوب | يعمل |
| `page.evaluate` قبل وصول الصوت | يعمل (لا حجب) | يعمل |

الأداة تستخدم `livekit-client` الحقيقي لكنها **لا** تشغّل `useLiveKitRoom` ولا البانر؛
هذان تغطيهما اختبارات Vitest في `frontend/src/room/`.

## كتابة اختبار staging بمتصفحين

Playwright يرسل `page.evaluate` و`locator.*` و`waitForSelector` و`screenshot` على أنها
**ضغطة مستخدم**، فيُفك حجب الصوت قبل أن يحدث، ولا يظهر البانر أبدًا. لذلك في المتصفح المستمع:

1. بعد `page.goto` لرابط الغرفة لا تستدعِ أيًّا من الأوامر السابقة حتى يدخل الطرف الآخر ويفتح المايك.
2. انتظر بمهلة زمنية في Node (`setTimeout`)، أو افحص الصفحة عبر CDP بدون user gesture:

```js
const cdp = await page.context().newCDPSession(page)
const { result } = await cdp.send('Runtime.evaluate', {
  expression: "Boolean(document.querySelector('.room-audio-banner'))",
  returnByValue: true,
})
```

3. بعد التأكد من ظهور البانر: التقط الصورة واضغط «اضغط لتفعيل الصوت»، ثم تأكد أنه اختفى وأن
   عنصر `audio` ليس `paused`.
4. لا تعتمد على `chrome-headless-shell` أو العلم `--autoplay-policy` وحده؛ المهم ترتيب الأوامر.
