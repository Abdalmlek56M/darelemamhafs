# ADR-0006 — جسر جلسة لوحة الإدارة إلى الـAPI الجديد

**Status:** Accepted — **منفّذ** (22 Nov 2026)
**Date:** 22 Nov 2026
**Decider:** مالك الدار (قرار رقم 7 في اعتماد خطة Phase 3.0)
**Related:** docs/18-meet-recording-plan.md §4.2؛ docs/03-security.md؛ docs/02-architecture.md §2؛ docs/checkpoints/3.0-3.1-meet-calendar-1.0.md

## Context

- لوحة الإدارة تُخدم من الـlegacy API على المنفذ 5080، وجلستها كوكي `DarEltahfeez.Admin` (نظام `Cookies`، SameSite=Strict، صلاحية 8 ساعات، `session_version` + `user_permissions` في الـclaims). **تحديث 2026-11-27 (ADR-0008):** الـticket صار نحيفًا ويحمل الهوية و`session_version` فقط؛ `user_permissions` تُقرأ من الداتابيز في كل طلب (نفس ما يفعله الجسر أدناه)، والكوكيز القديمة تظل صالحة.
- وحدة Meet تُبنى داخل الـmodular monolith الجديد (`src/Modules/Meet`) وتُخدم من `Dar.Api` على المنفذ 5081 تحت `/api/v1/meet/*`، بجلسة مختلفة (`dar_session`).
- Nginx يوجّه `/api/v1/*` إلى 5081 و`/api/*` إلى 5080 على **نفس الـorigin**. لوحة الإدارة تحتاج استدعاء `/api/v1/meet/*` بدون تسجيل دخول ثانٍ وبدون CORS.
- بدون حل: إما نقل الوحدة إلى الـlegacy API (يكسر اتجاه الـmodular monolith)، أو جسر توكن جديد (أجزاء متحركة إضافية)، أو تكرار تسجيل الدخول (غير مقبول تشغيليًا).

## Decision

**Option A — توحيد حلقة مفاتيح Data Protection + قراءة كوكي الأدمن في الـAPI الجديد.**

### 1) حلقة مفاتيح مشتركة (الاثنان)

    AddDataProtection()
        .SetApplicationName("DarEltahfeez")          // إلزامي: نفس اسم التطبيق في 5080 و5081
        .PersistKeysToFileSystem("/var/lib/dar/keys") // DataProtection:KeysPath، 0700 dar:dar

في التطوير المحلي يُترك المسار فارغًا فيستخدم الاثنان مخزن مفاتيح المستخدم نفسه، والمهم هو تطابق **اسم التطبيق** — لأن اسم التطبيق يدخل في purpose strings؛ بدونه لا يفك أحدهما تشفير الآخر حتى مع نفس المفاتيح.

### 2) قراءة كوكي الأدمن في `Dar.Api` (بدون كتابة)

- Scheme جديد `dar_admin_bridge` + كوكي بنفس الاسم `DarEltahfeez.Admin` (قراءة فقط).
- `TicketDataFormat` صريح بنفس purpose الذي يستخدمه الـlegacy:

      provider.CreateProtector(
          "Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationMiddleware",
          "Cookies",   // اسم الـscheme في الـlegacy = CookieAuthenticationDefaults.AuthenticationScheme
          "v2")

  بدون هذا السطر يفشل فك التشفير لأن purpose يتضمن **اسم الـscheme**، ولا يمكن تسمية الـscheme الجديد `Cookies` (محجوز لجلسة dar_session).
- `SlidingExpiration = false` ولا تجديد ولا `SignInAsync` من هذا الـscheme: الـlegacy يبقى المالك الوحيد لدورة حياة الكوكي.

### 3) التحقق من الـprincipal (نفس ثوابت الـlegacy)

`OnValidatePrincipal` في الجسر يعيد التحقق من قاعدة البيانات في كل طلب:

1. `NameIdentifier` موجود وصالح.
2. المستخدم موجود، `is_active=TRUE`، `is_locked=FALSE` — وإلا `RejectPrincipal` + 401.
3. `session_version` في الـclaims = قيمة `app_users.session_version` — وإلا رفض (تغيير كلمة المرور/التعطيل يلغي الجلسة فورًا).
4. الصلاحيات تُقرأ من `user_permissions` وتُستبدل في الـprincipal للطلب الحالي (بدون تجديد كوكي) — أي سحب `meet.media.view` يسري فورًا.

### 4) اختيار الـscheme الافتراضي

    AddPolicyScheme("Dar.Session", ...) // ForwardDefaultSelector:
      كوكي dar_session موجود      -> Cookies          (المعلمة/المشرفة)
      كوكي DarEltahfeez.Admin موجود -> dar_admin_bridge (لوحة الإدارة)
      غير ذلك                      -> Cookies          (401 عبر OnRedirectToLogin)

  ويُضبط `DefaultScheme/DefaultAuthenticateScheme/DefaultChallengeScheme` عليه. تسجيل الدخول والخروج في وحدة Identity يظلان صريحين على `Cookies` (`AuthSession.Scheme`).

## Alternatives rejected

| البديل | لماذا رُفض |
|---|---|
| B: تنفيذ Meet داخل الـlegacy API | يخالف اتجاه الـmodular monolith ويضخّم ملفات legacy، ويحرم الوحدة من اختبارات الـAPI الجديدة |
| C: توكن داخلي قصير العمر من legacy إلى new | أجزاء متحركة إضافية (توقيع/تخزين/إبطال) بلا مكسب أمني على A |
| JWT مشترك | يتطلب تغيير طريقتَي المصادقة في التطبيقين وترحيل الجلسات — تغيير أوسع من الحاجة |

## Security notes

1. **حلقة المفاتيح سرّية** مثل أي مفتاح: نسخ احتياطي مشفّر، صلاحيات 0700، ولا تُنسخ إلى محطة تطوير. تدوير المفاتيح يُخرج الجميع من الجلسة.
2. الجسر **لا يمنح** أي صلاحية إضافية: كل endpoint يظل محميًا بـpolicy + `RequireClaim("permission", code)` على الخادم؛ الجسر يوصل هوية موجودة فقط.
3. فشل فك التشفير = 401 (لا 500)؛ لا يُسجَّل أي محتوى من الكوكي في اللوجات.
4. الكوكي SameSite=Strict يبقى كما هو: الجسر لا يغيّر خصائص الكوكي، ولا يُستخدم لطلبات cross-site.
5. بوابة الـorigin الحالية (`SameOriginGuardMiddleware`) والـrate limiting يظلان ساريين على `/api/v1/*`.

## Consequences

- **تغيير تشغيلي لمرة واحدة:** تفعيل `SetApplicationName` يغيّر purpose strings، فتصبح كل جلسات الأدمن الحالية غير صالحة → الجميع يعيد تسجيل الدخول مرة واحدة بعد النشر. يُنفَّذ في نافذة قصيرة ويُوثّق في `docs/06-operations.md`.
- يلزم إنشاء `/var/lib/dar/keys` (0700 dar:dar) على السيرفر وتمرير `DataProtection__KeysPath` في `/etc/dar/api.env` و`/etc/dar/legacy.env`.
- اختبارات سلبية مطلوبة: بدون كوكي 401، كوكي legacy ملغاة (session_version مرتفع) 401، مستخدم معطّل 401، صلاحية مسحوبة 403، وطلب من أصل مختلف 403.
- أي وحدة جديدة تحتاج واجهة إدارة يمكنها الآن استخدام `/api/v1/*` مباشرة من لوحة الإدارة دون تكرار جلسة.

## Affected files

- `src/Modules/Identity/Dar.Modules.Identity/Infrastructure/AdminSessionBridge.cs` (جديد)
- `src/Modules/Identity/Dar.Modules.Identity/IdentityModule.cs` (ربط الجسر + policy scheme)
- `src/Host/Dar.Api/Program.cs` (DataProtection + اسم التطبيق)
- `backend/DarEltahfeez.Api/Program.cs` (DataProtection + اسم التطبيق)
- `deploy/setup-host-services.sh` (متغيرات البيئة — يُنفَّذ عند 3.7)
