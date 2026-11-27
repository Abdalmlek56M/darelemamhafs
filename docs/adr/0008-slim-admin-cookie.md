# ADR-0008 — كوكي الأدمن النحيف: الصلاحيات من الداتابيز لا من الـticket

**Status:** Accepted — منفّذ (FINAL B7)
**Date:** 27 Nov 2026
**Decider:** قواعد FINAL_PROMPT (B7) + مالك الدار (اختبار حي على staging)
**Related:** ADR-0006؛ docs/02-architecture.md §6.4؛ docs/03-security.md §27؛ backend/DarEltahfeez.Api/SlimAdminCookieTicketDataFormat.cs

## Context

كوكي جلست الإدارة `DarEltahfeez.Admin` (legacy) كانت تحمل claim لكل صلاحية (`permission`).
مع كتالوج من 65 صلاحية وصل حجم `Set-Cookie` إلى ~4049 بايت، أي قريبًا من حد 4 KB لعدد
بايتات الكوكي الواحدة الذي تفرضه المتصفحات وحدود nginx الافتراضية لـheader الـupstream.
النتيجة الحقيقية على staging: nginx رجّع `upstream sent too big header` (502 للعميل)
على `POST /api/setup/admin` و`POST /api/auth/login` رغم أن التطبيق سجّل 200 وأنشأ الصف.
ومع نمو الكتالوج (200 صلاحية في اختبار التحمل) انقسمت الكوكي إلى 4 قطع `AdminC1..C3`
بحجم إجمالي ~10.9 KB.

في الوقت نفسه، الـlegacy `AuthEndpoints.ValidatePrincipalAsync` يقرأ `user_permissions`
من الداتابيز في **كل طلب** أصلًا، و`AdminSessionBridge` في الـAPI الجديد يفعل ذلك للكوكي
المقروءة (ADR-0006). أي أن صلاحيات الـticket كانت نسخة مكررة ومتقادمة ومكلفة بلا فائدة.

## Decision

1. صلاحيات المستخدم **لا تُكتب في ticket الكوكي**. الـticket يحمل فقط:
   `NameIdentifier`، `Name`، `display_name`، `session_version` (بيانات الهوية والإبطال).
2. `SlimAdminCookieTicketDataFormat` يلفّ `ISecureDataFormat<AuthenticationTicket>` المسؤول
   عن الكوكي ويحذف claims النوع `permission` عند **الكتابة** فقط (`Protect`)، مع تمرير
   `Unprotect` كما هو للحفاظ على توافق الكوكيز القديمة.
3. `ValidatePrincipalAsync` يبني الـprincipal للطلب الحالي من الداتابيز في كل طلب
   (صلاحيات طازجة فورًا، بدون `ShouldRenew`) — نفس سلوك الجسر في الـAPI الجديد.
4. الـendpoint/السياسات التي تعتمد على `HasClaim("permission", …)` تظل كما هي: الـclaims
   موجودة في `HttpContext.User` وقت الطلب، لكنها غير محفوظة في الكوكي.
5. الكوكيز القديمة (التي فيها claims) تُقرأ وتُستبدل في الذاكرة؛ عند أول تجديد (sliding)
   تُكتب نحيفة تلقائيًا، ثم عند أول تسجيل دخول جديد تصبح نحيفة فورًا.

## Consequences

- **الإيجابي:** `Set-Cookie` للإدارة ~700–900 بايت بدلًا من ~4 KB، مهما كبر الكتالوج.
  لا chunking، ولا حساسية لحدود nginx الافتراضية، وسحب الصلاحية يسري من الطلب التالي
  (وهو ما كان يحدث بالفعل لأن التحقق يقرأ الداتابيز).
- **التكلفة:** استعلام `user_permissions` لكل طلب مصادَق (كان موجودًا بالفعل في
  `ValidatePrincipalAsync`، فلا زيادة صافية).
- **الإنتاج:** لا كسر للجلسات الحالية: الكوكي القديمة تُفك بنفس مفتاح Data Protection
  وتُستبدل صلاحياتها من الداتابيز. لا حاجة لإجبار المستخدمين على إعادة الدخول. الصلاحيات
  المسحوبة تُطبَّق فورًا كما كانت. تجديد الكوكي يحدث طبيعيًا (8 ساعات + sliding) فيصغر حجمها
  بعد التجديد، وأي تسجيل دخول جديد يبدأ نحيفًا.
- **الاختبار:** `tests/regression/b7-cookie-size` يسجّل الدخول بمستخدم عنده 200 صلاحية
  ويفشل إذا تجاوز مجموع headers الكوكي 1500 بايت، ويتحقق من أن `/api/auth/me` و
  مسارًا محميًا بالـpolicy يعملان بالصلاحيات المقروءة من الداتابيز وأن الجلسة تستمر.
- **NOT VERIFIED:** سلوك متصفح حقيقي على staging بعد إعادة النشر (لم يُعد نشر staging في
  هذه الجولة)، وكوكيز إنتاج حقيقية قديمة (تم التحقق منها منطقيًا من مسار الكود فقط).
