# Meet — Operations Runbook (Phase 3.0 / 3.1)

**Status:** يغطي المنفَّذ حاليًا (تقويم Google + نطاق التسجيل). أقسام البوت/البث/الرفع تُضاف في 3.2 → 3.4.
**Related:** `docs/adr/0006-meet-auth-bridge.md`، `docs/adr/0007-meet-recording-architecture.md`، `docs/18-meet-recording-plan.md`، `docs/11-deployment.md`.

---

## 1. متغيرات البيئة المطلوبة

تُوضع في `/etc/dar/meet.env` بصلاحيات `640 root:dar`، وتُقرأ عبر `EnvironmentFile` في خدمتَي dar-api وdar-legacy (خدمة الـlegacy تحتاج مفاتيح Data Protection فقط).

```env
# Google Cloud Console → OAuth 2.0 Client (Web application)
Meet__Google__ClientId=...apps.googleusercontent.com
Meet__Google__ClientSecret=...
Meet__Google__RedirectUri=https://dar-elemam-hafs.rigxhardware.com/api/v1/meet/calendar/callback

# 32 bytes base64 (AES-256-GCM) — لتشفير refresh token وتوقيع state
Meet__EncryptionKey=<openssl rand -base64 32>

# اختياري
Meet__SyncIntervalSeconds=60
Meet__FullSyncHours=6
Meet__AdminRedirectPath=/management
```

**مفتاح Data Protection مشترك (إلزامي للـAPIين):** أضِف السطر التالي إلى **`/etc/dar/api.env` و`/etc/dar/legacy.env` معًا** (أو أضف `EnvironmentFile=/etc/dar/meet.env` إلى وحدتَي systemd):

```env
DataProtection__KeysPath=/var/lib/dar/keys
```

**قواعد:**
1. لا تُكتب هذه القيم في appsettings.json ولا في Git ولا في اللوجات.
2. تغيير `Meet__EncryptionKey` يُفقد كل refresh tokens المخزنة → يلزم إعادة ربط Google.
3. تغيير `DataProtection__KeysPath` أو حذف المفاتيح → كل جلسات الأدمن والمعلمات تُلغى.

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

## 10. ما لم يُبنَ بعد (لا تشغّله على الإنتاج)

- بوت التسجيل (`dar-meet-bot`)، HLS/DVR، مسارات `/media/meet/*` المحمية، رفع rclone إلى Drive، SSE، وإشعارات التسجيل التشغيلية — كلها في 3.2 → 3.6.
- حتى ذلك الحين: أزرار التشغيل/الإيقاف غير موجودة، والوحدة **لا تسجّل أي شيء** — تُدير التقويم والربط فقط.
