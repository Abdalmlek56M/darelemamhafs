# تدقيق وإثبات تجريبي: منع تداخل مواعيد المعلمات

**التاريخ:** 22 نوفمبر 2026
**المهمة:** task-7 — التحقق 100% من منع تداخل المواعيد (قاعدة البيانات + API + الواجهة + أدوات الإصلاح والـpreflight)
**الحالة:** ✅ التحقق التجريبي نُفّذ بنجاح — **45/45 سيناريو PASS** على قاعدة مؤقتة مطبَّق عليها كل الترحيلات (23 ترحيلًا)، مع توثيق القيود البيئية أدناه.

---

## 1. الملخص التنفيذي

منع تداخل مواعيد المعلمات **مُنفَّذ على مستوى قاعدة البيانات نفسها** وليس في الـAPI فقط:

- دالة **public.dar_teacher_has_schedule_overlap** في **database/012_teacher_schedule_no_overlap.sql** تحسب التقاطع على **أسبوع دائري** (7 أيام، مع عبور منتصف الليل وحدود السبت/الأحد عبر إزاحات ±604800 ثانية)، وتستخدم مقارنات **نصف مفتوحة** (< فقط) فيُسمح بالتجاور التام.
- تريجر **trg_circle_schedule_slots_teacher_overlap** على **circle_schedule_slots** (INSERT/UPDATE) يفحص كل موعد جديد أو معدَّل.
- تريجر **trg_circles_teacher_schedule_overlap** على **circles** (UPDATE لـ teacher_id / is_active / is_trashed) يفحص إعادة الإسناد والتفعيل والاستعادة من المهملات.
- كلا التريجرين يأخذان قفلًا استشاريًا واحدًا **pg_advisory_xact_lock(867530912345)** قبل الفحص، والدالة **VOLATILE** حتى تأخذ Snapshot جديدًا بعد القفل في **READ COMMITTED** (تعليق الترحيل 012 يشرح ذلك صراحة).
- التريجر يرفع **SQLSTATE 23514** مع اسم القيد **ck_teacher_schedule_no_overlap**، والـAPI يحوّله إلى **409** برسالة عربية في مسارات: إنشاء موعد، حفظ/تعديل الحلقة، واستعادة من المهملات. (DomainEndpoints.ScheduleAttendance.cs، DomainEndpoints.Circles.cs، SystemAdminEndpoints.Trash.cs)

**الحكم:** لا توجد ثغرة مباشرة تسمح بتداخل مواعيد معلمة عبر أي مسار حالي (API، SQL مباشر، تفعيل/استعادة، إعادة إسناد). توجد **مخاطر متبقية** ومشكلات UX/تشغيلية موثقة في القسم 8، وأهمها اعتماد صحة السباق (race) على مستوى العزل READ COMMITTED + ضرورة وجود اختبار سباق في CI (تعذّر تنفيذه محليًا بسبب قيود الساندبوكس).

---

## 2. النطاق والمصادر المقروءة

| المصدر | ما تم فحصه |
|---|---|
| **database/012_teacher_schedule_no_overlap.sql** | الدالة + preflight + التريجران + الفهرس الجزئي (188 سطرًا، قُرئ بالكامل) |
| **database/001، 003، 008، 010** | تعريف **circle_schedule_slots** وقوده، قيد التفرد الجزئي، عمود **is_trashed**، **circles.starts_on** |
| **backend/DarEltahfeez.Api/DomainEndpoints.ScheduleAttendance.cs** | **GET/POST /api/schedule-slots**، معالجة 23505/23514 |
| **backend/DarEltahfeez.Api/DomainEndpoints.Circles.cs** | **POST/PUT /api/circles** ومعالجة قيد التداخل |
| **backend/.../SystemAdminEndpoints.Trash.cs** | مسار الاستعادة من المهملات ومعالجة 23514 |
| **frontend/src/application/useDarApplication.ts**، **useCircleActions.ts**، **pages/SchedulePage.tsx**، **components/dialogs/CircleDialog.tsx** | تسلسل الحفظ، عرض رسائل الخطأ، حفظ الحلقة مع مسودات المواعيد |
| **tools/Repair-KnownTeacherScheduleOverlap.ps1** + **maintenance/repair_known_teacher_schedule_overlap.sql** | إصلاح المواعيد الثلاثة المعروفة (00:07/00:10/00:11 → 07:00/10:00/11:00) |
| **tests/runners/*Overlap***، **tests/regression/sql/teacher_schedule_overlap.test.sql**، **tests/diagnostics/teacher_schedule_overlap_preflight.sql** | الاختبارات والفحص الموجود مسبقًا |
| **docs/01-business.md §6.5**، **docs/17-master-plan.md** | الادعاء القديم بوجود 3 مواعيد متداخلة، ومرجع الحماية |

---

## 3. كيف تعمل الحماية (خلاصة تنفيذية)

1. **المصدر الوحيد للحقيقة = قاعدة البيانات.** لا يوجد فحص تداخل مسبق في كود الـAPI (لا C# check-then-insert)؛ الـAPI يعتمد كليًا على التريجر ويترجم خطأه إلى 409. هذا يمنع أي مسار ينسى الفحص.
2. **الأسبوع دائري.** التقاطع يُحسب كنقاط ثوانٍ: day_of_week × 86400 + epoch(time)، مع إزاحات -604800 / 0 / +604800 لالتقاط الالتفاف حول حدود الأسبوع. لذلك:
   - السبت 23:30 لمدة 60 دقيقة (ينتهي الأحد 00:30) يتعارض مع الأحد 00:00. (مثبت: S09b)
   - الأحد 00:15-00:45 يتعارض مع السبت 23:50 (تداخل 5 دقائق). (مثبت: S10b)
3. **التجاور التام مسموح.** 09:00-10:00 ثم 10:00-… مسموح (مثبت: S03/S04/S11b).
4. **الحالات غير النشطة لا تشارك في الفحص:** حلقة متوقفة/في المهملات أو موعد غير نشط/محذوف لا يمنع مواعيد جديدة — لكن **لحظة التفعيل/الاستعادة** يُعاد الفحص ويُرفض التعارض (مثبت: S13/S14/S15/S16).
5. **إعادة إسناد المعلمة** لحلقة أخرى تُفحص ضد كل مواعيد المعلمة في الحلقات الأخرى (مثبت: S20/S21).
6. **الـAPI يقيّد الإضافة:** POST /api/schedule-slots يُدخل فقط لحلقة نشطة وغير محذوفة ولها معلمة (INSERT..SELECT بشرط)، فلا يمكن إنشاء موعد لحلقة بلا معلمة.
7. **الـfrontend لا يفحص التداخل بنفسه**؛ يعرض رسالة الخادم في toast. حفظ الحلقة مع مسودات مواعيد يسجّل الحلقة أولًا ثم يحاول المواعيد واحدًا واحدًا ويجمع الأخطاء (قسم 8-ب4).

---

## 4. البيئة والمنهجية (مهم للتكرار)

### 4.1 القيود البيئية التي واجهناها في هذه الجلسة (ساندبوكس Windows)

| المحاولة | النتيجة |
|---|---|
| **initdb --auth=trust** ثم **pg_ctl start** على منفذ 55499 | ❌ فشل: initdb: could not create restricted token: error code 87 ثم could not re-execute with restricted token: error code 3 — ساندبوكس يمنع إنشاء Restricted Token الذي يستخدمه PostgreSQL على Windows لخفض الصلاحيات. (خطأ بيئي وليس خطأ في المستودع.) |
| تشغيل **postgres.exe** مباشرة على نسخة من cluster التطوير | 🟡 postmaster بدأ وأعلن ready to accept connections، لكن **TCP loopback محجوب** في الساندبوكس: **pg_isready** لا يصل، ومحاولة **psql** عبر 127.0.0.1 تعلّق. كما فشل إنهاء crash recovery أول مرة: could not signal for checkpoint: Operation not permitted. |
| Docker/Testcontainers | ❌ غير متاح (سبق إثباته في تدقيق سابق: Docker daemon خلف named pipe غير متصل). |
| **الحل البديل الذي نجح** | نسخة بايت-بايت من مجلد بيانات التطوير المحلي (‎%LOCALAPPDATA%\DarEltahfeez\Database\data حسب بيئة المستخدم — 105MB، بعد التأكد أن الخدمة متوقفة) إلى **.tmp-pg\data** داخل المشروع، ثم تشغيلها بـ **single-user mode**: postgres.exe --single -D .tmp-pg\data <db> مع توجيه ملف SQL إلى stdin. وضع single-user لا يحتاج شبكة ولا postmaster ولا signals، ويعمل بالكامل داخل العملية. |

### 4.2 خطوات التنفيذ الفعلية

1. نسخ cluster التطوير إلى **.tmp-pg\data** (البيانات الأصلية لم تُمس؛ لم نشغّل cluster التطوير الأصلي إطلاقًا، ولم نكتب فيه).
2. إنشاء قاعدة **جديدة نظيفة** **dar_audit_2** من template0 داخل النسخة المعزولة.
3. تطبيق كل الترحيلات **database/001..023** بالترتيب على القاعدة الجديدة → **0 أخطاء**، وأصبحت القاعدة تحوي 33 جدولًا و58 صلاحية و4 تريجرات و8 دوال.
4. تنفيذ ملف التحقق **tests/regression/sql/schedule_overlap_verify.sql** (45 سيناريو في transaction واحدة ثم ROLLBACK).
5. فحص **قراءة فقط** لقاعدة التطوير (§6)، ثم اختبار إعادة تشغيل سكربت الإصلاح لضمان أنه يرفض بأمان.
6. حذف **.tmp-pg** بالكامل (لم يتبقَّ أي cluster أو ملفات مؤقتة).

### 4.3 قيود بيئية إضافية أثرت على طريقة التنفيذ (وليست عيوبًا في الحماية)

- وضع single-user ينفّذ **سطرًا واحدًا كاستعلام واحد**، لذا اضطُررنا لتحويل ملفات SQL إلى سطر واحد لكل statement عند التشغيل المحلي فقط (أداة flattening داخلية). **الملف النهائي في المستودع مكتوب بصيغة psql عادية متعددة الأسطر وسيعمل على أي PostgreSQL عادي (CI) دون تحويل.**
- وضع single-user يكتم رسائل NOTICE؛ لذلك سجّل ملف التحقق نتائجه بـ **RAISE WARNING 'OVL_RESULT …'** كي تُقرأ في السجل (تظهر أيضًا في psql العادي على stderr، وهذا مقصود).
- **اختبار Race بجلستين متوازيتين لم يُنفَّذ محليًا** لأن أي اتصال TCP بـPostgres محجوب في الساندبوكس؛ لذلك لم نزعم نتيجة سباق غير مُنفَّذة. التفاصيل والتحليل ووصفة الاختبار في §8-P1-1.

---

## 5. النتائج التجريبية

### 5.1 تطبيق الترحيلات على قاعدة فارغة

- **database/** = **23 ملفًا** (001→023) بلا فجوات أو تكرار.
- التطبيق على **dar_audit_2** (template0) المتسلسل: **PASS — 0 ERROR / 0 FATAL**.
- نتيجة الفحص البنيوي على القاعدة الناتجة:

| الفحص | النتيجة |
|---|---|
| عدد الجداول في public | 33 |
| التريجرات (غير داخلية) | 4: trg_audit_log_append_only، trg_circle_schedule_slots_teacher_overlap، trg_circles_teacher_schedule_overlap، trg_payments_resolve_notification |
| دوال public | 8، منها dar_teacher_has_schedule_overlap وdar_guard_schedule_slot_teacher_overlap وdar_guard_circle_teacher_schedule_overlap |
| الصلاحيات المسجلة | 58 |
| الأدوار | 2 |
| فهارس المواعيد | ix_schedule_slots_active_day_lookup + uq_circle_schedule_slots_not_trashed_day_time (جزئي WHERE is_trashed=false) |
| قيود CHECK على المواعيد | 2 (day_of_week 0..6، duration 15..360) |
| جدولا teacher_sessions وpayroll_locks | موجودان (ترحيلا 017 و022) |

### 5.2 جدول السيناريوهات — 45/45 PASS

> التشغيل: transaction واحدة تنتهي بـROLLBACK على **dar_audit_2** (قاعدة مطبَّق عليها 23 ترحيلًا). النتائج مطبوعة بـ **OVL_RESULT … = PASS**. لا FAIL ولا خطأ غير ملتقط.

| # | السيناريو | النتيجة | ما يثبته |
|---|---|---|---|
| S00 | إدخال موعد أساسي (الأحد 09:00-10:00) | PASS | الأساس سليم |
| S01 | تداخل تام بين حلقتين لنفس المعلمة | PASS | رفض بقيد ck_teacher_schedule_no_overlap (تحقق الاسم عبر GET STACKED DIAGNOSTICS) |
| S02 | تداخل جزئي بدقيقة واحدة (09:59 مقابل 09:00-10:00) | PASS | رفض أقصى تداخل جزئي |
| S03 | تجاور تام بعد النهاية (10:00 = 10:00) | PASS | التجاور مسموح |
| S04 | تجاور تام قبل البداية (08:00-09:00 قبل 09:00) | PASS | التجاور مسموح |
| S05 | تداخل داخل نفس الحلقة | PASS | يُرفض أيضًا |
| S06 | نفس الحلقة/اليوم/الوقت (تكرار) | PASS | رُفض؛ التريجر BEFORE يرفضه بقيد التداخل قبل قيد التفرد (ملاحظة UX في §8-P1-3) |
| S07 | معلمة أخرى في نفس التوقيت | PASS | لا يمنع معلمات أخريات |
| S08a/S08b | 23:30+60 ثم 00:15 من اليوم التالي | PASS/PASS | عبور منتصف الليل يُفحص صحيحًا |
| S09a/S09b | السبت 23:30+60 ثم الأحد 00:00 | PASS/PASS | حدود الأسبوع الدائري |
| S10a/S10b | الأحد 00:15-00:45 ثم السبت 23:50 (اتجاه عكسي) | PASS/PASS | الالتفاف يعمل في الاتجاهين (تداخل 5 دقائق) |
| S11a/S11b | 23:00+60 ينتهي 00:00 ثم 00:00 بالضبط | PASS/PASS | تجاور تام عبر منتصف الليل |
| S12 | موعد غير نشط لا يمنع موعدًا جديدًا | PASS | الحالات غير النشطة مستبعدة |
| S13a/S13b | حلقة متوقفة: مسودة تعارض مسموحة ثم تفعيل مرفوض | PASS/PASS | التفعيل يعيد الفحص |
| S14a/S14b | حلقة محذوفة: مسودة مسموحة ثم استعادة مرفوضة | PASS/PASS | الاستعادة تعيد الفحص |
| S15 | إعادة تفعيل موعد متعارض | PASS | UPDATE is_active يُفحص |
| S16 | استعادة موعد محذوف متعارض | PASS | UPDATE is_trashed يُفحص |
| S17 | تعديل وقت/يوم موعد إلى داخل موعد قائم | PASS | UPDATE يتم اعتراضه |
| S18 | تعديل يوم موعد لإحداث تداخل أسبوعي | PASS | الالتفاف يُطبق على التعديل |
| S19 | تعديل مدة موعد إلى مدة متعارضة | PASS | UPDATE duration يُفحص |
| S20 | إعادة إسناد حلقة لمعلمة عندها تعارض | PASS | تريجر الحلقات يرفض |
| S21 | إعادة إسناد غير متعارضة | PASS | لا إيجابيات كاذبة |
| S22a/S22b | exclude_slot_id | PASS/PASS | الدالة تكشف التعارض، وتستبعد الموعد نفسه عند التعديل |
| S23a/S23b | exclude_circle_id | PASS/PASS | تستبعد الحلقة نفسها ولا تخفي تعارضًا حقيقيًا |
| S24 | الإدخال المباشر عبر SQL | PASS | لا يوجد Trigger bypass (كل السيناريوهات إدخال مباشر) |
| S25 | المواعيد المحذوفة خارج الفحص | PASS | تماشي مع S16 |
| S26 | حلقة بدون معلمة: مواعيد متقاطعة | PASS | لا فحص بلا معلمة (سلوك مقصود) |
| S27a/S27b/S27c | حدود المدة 15 و360 و14 و361 | PASS/PASS/PASS | قيود CHECK تعمل |
| S28/S28b | preflight الترحيل 012 على قاعدة بها تداخل مسبق (تعطيل تريجر داخل subtransaction) | PASS/PASS | المنطق يرفض القاعدة القديمة المتعارضة، والتريجر عاد مفعّلًا بعد التراجع |
| S29 | إدخال متعارض بعد إعادة التفعيل | PASS | الحماية نشطة دائمًا |
| S30 | فحص استقصائي: 7 أيام × 96 ربع ساعة × 5 مدد = 3360 نقطة | PASS (0 اختلاف) | مطابقة كاملة بين الدالة ومرجع Brute-force يحسب نفس الأسبوع الدائري |
| S31 | provolatile = 'v' للدالة | PASS | Snapshot جديد بعد القفل في READ COMMITTED |
| S32 | احتواء دالة الحارس على pg_advisory_xact_lock(867530912345) | PASS | القفل موجود في المسار الفعلي |
| S33 | tgenabled='O' وtgtype يغطي INSERT+UPDATE | PASS | التريجر مفعّل ويغطي العمليتين |

### 5.3 السيناريوهات القديمة في المستودع

- **tests/regression/sql/teacher_schedule_overlap.test.sql** (161 سطرًا، 13 حالة) يغطي أغلب الأساسيات، لكنه **لا يغطي**: الدقيقة الواحدة، exclude_slot_id/exclude_circle_id، سباق التزامن، فحص preflight نفسه، ولا الفحص الاستقصائي. الملف الجديد يغطيها كلها.
- **تنبيه:** المشغّل **tests/runners/Verify-TeacherScheduleOverlapRegression.ps1:68** يشترط $migrationFiles.Count -ne 14 — أي أنه سيفشل الآن على المستودع الحالي (23 ترحيلًا). يحتاج تحديثًا إلى عدد ديناميكي (خارج نطاق هذه المهمة، مذكور كإصلاح مقترح).

---

## 6. حالة قاعدة التطوير المحلية (فحص قراءة فقط)

أُجري على **نسخة بايت-بايت** من مجلد بيانات التطوير (الخدمة كانت متوقفة، والبيانات الأصلية لم تُعدَّل) باستخدام **SET default_transaction_read_only = on** ثم استعلامات SELECT فقط:

| الفحص | النتيجة |
|---|---|
| سجل الترحيلات | schema_migrations القديم فقط: **12 سجلًا**، أعلاها 012_teacher_schedule_no_overlap. **web_schema_migrations غير موجود** (التطوير المحلي لم يُطبَّق عليه الترحيلات 013→023 التي يطبقها الـMigrationRunner الجديد) |
| الجداول | 25 جدولًا (schema أقدم من الإنتاج) |
| التريجرات | **موجودان**: trg_circle_schedule_slots_teacher_overlap وtrg_circles_teacher_schedule_overlap |
| الدوال | الثلاث موجودة (الدالة + الحارسان) |
| الفهارس | ix_schedule_slots_active_day_lookup وuq_circle_schedule_slots_not_trashed_day_time موجودان |
| المواعيد النشطة | 16 موعدًا لمعلمات مسندة، **0 حالة تداخل** |
| المعلمات/الحلقات | 3 معلمات، 2 حلقات |
| المواعيد الثلاثة المعروفة | 5e3581db… = **07:00**، 78189952… = **10:00**، 4e0823c4… = **11:00** (60 دقيقة، يوم 0، حلقة «جزء تبارك») — أي أن **الإصلاح مُطبَّق محليًا** |
| إعادة تشغيل سكربت الإصلاح | رفض آمن: Repair stopped safely: expected exactly 3 unchanged active target slots, found 0. وبعدها القيم والتعارضات unchanged (0) — السكربت idempotent-safe ولا يفسد بيانات مُصلحة |

**استنتاج مهم لتوثيق docs/01 §6.5:** النسخة التي قُرئت أثناء التدقيق كانت تقول بوجود 3 مواعيد متداخلة (00:07/00:10/00:11)؛ بينما قاعدتنا التجريبية تُثبت أن **القيم مُصلَحة محليًا (07:00/10:00/11:00) والتداخلات صفر وترحيل 012 مُطبَّق**. لاحظ أن نسخة docs/01 في شجرة العمل عُدِّلت أثناء التدقيق (بمعرفة عمل توثيقي متوازٍ) لتصبح: «المواعيد الثلاثة تحتاج تأكيدًا من الإنتاج» — وهو يتفق مع توصيتنا: يلزم التحقق من الإنتاج بالخطوات في §7.

---

## 7. التحقق Read-only على الإنتاج (خطوات جاهزة — لم تُنفَّذ من هنا)

> ممنوع تشغيل أي كتابة على الإنتاج. كل ما يلي SELECT داخل **BEGIN TRANSACTION READ ONLY** عبر: sudo -u postgres psql -d <database>

### 7.1 هل ترحيل 012 مُطبَّق فعلًا على الإنتاج؟

~~~sql
BEGIN TRANSACTION READ ONLY;
SELECT count(*) AS web_migrations FROM public.web_schema_migrations;                 -- المتوقع 23
SELECT version FROM public.web_schema_migrations
 WHERE version LIKE '012%' OR version LIKE '013%' ORDER BY version;
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgname IN ('trg_circle_schedule_slots_teacher_overlap','trg_circles_teacher_schedule_overlap');
SELECT proname, provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname IN
   ('dar_teacher_has_schedule_overlap','dar_guard_schedule_slot_teacher_overlap','dar_guard_circle_teacher_schedule_overlap');
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND indexname='ix_schedule_slots_active_day_lookup';
COMMIT;
~~~

المتوقع: 23 ترحيلًا، التريجران tgenabled='O'، الثلاث دوال موجودة، الفهرس موجود. إن كان أي منها ناقصًا فالحماية **غير مُطبَّقة على الإنتاج** ويجب تطبيق 012 بعد نسخة احتياطية.

### 7.2 هل توجد تعارضات حالية؟ (الـpreflight الجاهز)

شغّل الملف الموجود مسبقًا (قراءة فقط، يطبع Base64 لسجلات JSON):
**tests/diagnostics/teacher_schedule_overlap_preflight.sql**

أو مباشرة استعلام ملخص:

~~~sql
BEGIN TRANSACTION READ ONLY;
SELECT count(*) AS overlap_pairs
FROM public.circle_schedule_slots sa
JOIN public.circles ca ON ca.id = sa.circle_id
JOIN public.circle_schedule_slots sb ON sb.id <> sa.id
JOIN public.circles cb ON cb.id = sb.circle_id AND cb.teacher_id = ca.teacher_id
CROSS JOIN LATERAL (VALUES (-604800::numeric),(0::numeric),(604800::numeric)) AS w(offset_seconds)
WHERE ca.teacher_id IS NOT NULL AND ca.is_active AND NOT ca.is_trashed
  AND sa.is_active AND NOT sa.is_trashed AND cb.is_active AND NOT cb.is_trashed AND sb.is_active AND NOT sb.is_trashed
  AND (sa.day_of_week::numeric*86400 + EXTRACT(EPOCH FROM sa.starts_at))
      < (sb.day_of_week::numeric*86400 + EXTRACT(EPOCH FROM sb.starts_at) + sb.duration_minutes*60 + w.offset_seconds)
  AND (sb.day_of_week::numeric*86400 + EXTRACT(EPOCH FROM sb.starts_at) + w.offset_seconds)
      < (sa.day_of_week::numeric*86400 + EXTRACT(EPOCH FROM sa.starts_at) + sa.duration_minutes*60);
COMMIT;
~~~

المتوقع 0.

### 7.3 المواعيد الثلاثة المعروفة

~~~sql
BEGIN TRANSACTION READ ONLY;
SELECT ss.id, to_char(ss.starts_at,'HH24:MI') AS starts_at, ss.duration_minutes, ss.day_of_week, c.name
FROM public.circle_schedule_slots ss JOIN public.circles c ON c.id = ss.circle_id
WHERE ss.id IN ('5e3581db-6aef-48fa-9abb-e1d9b0f8f474',
                '78189952-a897-4a6d-b838-42e0037e5ccb',
                '4e0823c4-5667-4526-9038-47fdf8602e83');
COMMIT;
~~~

المتوقع: 07:00 و10:00 و11:00. إن ظهرت 00:07/00:10/00:11 فالإصلاح لم يُطبَّق على الإنتاج — **لا تعِد تشغيل سكربت الإصلاح قبل نسخة احتياطية** (السكربت يطلب تأكيد APPLY ويأخذ نسخة بنفسه، لكن اتبعه حرفيًا).

### 7.4 لماذا نرجّح أن 012 مُطبَّق على الإنتاج؟

أعلى سجل ترحيلات موثق للإنتاج في المستودع هو **23**، و012 سبق أن طُبِّق محليًا. وبما أن preflight داخل 012 **يرفض التطبيق** إن وجد أي تداخل قائم، فإن نجاح الترحيل على الإنتاج يعني ضمنًا أن الجدول كان خاليًا من التعارضات لحظة التطبيق. هذا استنتاج قوي لكنه **ليس تحققًا مباشرًا** — لذلك خطوات §7.1–7.3 ضرورية.

---

## 8. الثغرات والمخاطر المتبقية (P0/P1/P2)

### P1-1 — السباق (Race) يعتمد على مستوى العزل READ COMMITTED

- **الوضع:** التريجر يأخذ **pg_advisory_xact_lock** ثم يفحص بالدالة **VOLATILE**. هذا صحيح **فقط** في READ COMMITTED (كل استعلام داخل الدالة يأخذ Snapshot جديد بعد انتظار القفل). كل كود الـbackend الحالي يستخدم الافتراضي READ COMMITTED (لا يوجد أي IsolationLevel صريح في المستودع — تم فحص backend/ كاملًا)، لذا المسارات الحالية آمنة.
- **الخطر المتبقي:** أي كود مستقبلي يفتح transaction بـREPEATABLE READ/SERIALIZABLE ويُدخل موعدًا سيجد Snapshot قديمًا بعد انتظار القفل، فيمكن أن يمرّ طلبان متوازيان متعارضان ويُنفَّذا معًا. كذلك أي أداة تستخدم session_replication_role=replica (superuser فقط) ستتجاوز التريجر.
- **التغطية:** لم يُنفَّذ اختبار سباق تجريبي محليًا (الساندبوكس يمنع أي اتصال TCP بـPostgres). مطلوب اختبار متزامن في CI (وصفة في §9.1-ب).
- **الخطورة:** متوسطة (لا مسار حالي يفتح REPEATABLE READ، لكن الحماية تعتمد على افتراض غير مثبت في CI).

### P1-2 — قاعدة التطوير المحلية متأخرة عن الإنتاج (ledger مزدوج)

- محليًا: schema_migrations القديم = 12 فقط، وweb_schema_migrations غير موجود؛ الإنتاج 23. أي اختبار محلي لسلوك الحماية على schema التطوير **لا يختبر 013→023** (وهي لا تؤثر على 012، لكنها مشكلة عامة موثقة سابقًا). التوصية: توحيد الـledger أو تثبيت قاعدة اختبار مطابقة للإنتاج.

### P1-3 — رسالة التكرار الحرفي مضللة قليلًا

- نفس الحلقة/اليوم/الوقت بالضبط يُرفض بـ**رسالة التداخل** (23514) لأن التريجر BEFORE INSERT يعمل قبل قيد التفرد 23505 (مثبت تجريبيًا في S06). آمن لكن رسالة «هذا الموعد مسجل بالفعل» في DomainEndpoints.ScheduleAttendance.cs:56 لا تظهر عمليًا في هذه الحالة.

### P1-4 — حفظ الحلقة + المواعيد ليس ذريًّا (UX/سلامة بيانات)

- useCircleActions.saveCircle ينشئ/يحدّث الحلقة أولًا ثم يحاول إدخال كل موعد على حدة ويجمع الأخطاء. إذا فشل موعد واحد (تعارض) تبقى الحلقة محفوظة (وربما بلا مواعيد أو بمواعيد جزئية) مع رسالة «تعذّر حفظ بعض المواعيد». لا خطر تداخل (القاعدة تمنعه) لكن قد تبقى حلقة نشطة بجدول ناقص.

### P2-1 — لا يوجد Endpoint لتعديل موعد

- التعديل الحالي = نقل الموعد للمهملات + إضافة جديد. التريجر يدعم UPDATE (مثبت: S17/S18/S19) لكن لا يوجد PUT /api/schedule-slots/{id}؛ خلال نافذة الحذف/الإضافة يمكن لمدير آخر حجز الوقت. (الاستعادة مفحوصة ومحمية.)
- إضافة: POST /api/schedule-slots يمنع إضافة مواعيد لحلقة متوقفة/بلا معلمة — هذا جيد للسلامة لكنه يمنع التخطيط المسبق لحلقة لم تُفعَّل بعد؛ المسودات في الواجهة تتطلب حلقة نشطة ومعلمة (useCircleActions:137).

### P2-2 — قفل استشاري عالمي واحد

- كل تعديلات الجداول الزمنية تتسلسل عبر مفتاح واحد 867530912345 — صحيح لكنه قد يسبب تنافسًا عند تعدد الحلقات/الكتابة المتزامنة الكبيرة. غير مؤثر حاليًا بحجم الدار.

### P2-3 — أدوات الاختبار القديمة تحتاج تحديثًا

- Verify-TeacherScheduleOverlapRegression.ps1:68 يشترط 14 ترحيلًا → سيفشل على المستودع الحالي (23). Verify-TeacherScheduleOverlapSource.ps1:66,69 يتحقق من نفس النص القديم.
- لا يوجد تشغيل لملف الحماية داخل CI حاليًا.

### P2-4 — docs/01-business.md §6.5 تحتاج ربطًا بنتيجة التدقيق

- الجملة التاريخية عن المواعيد الثلاثة (00:07/00:10/00:11) عُدِّلت أثناء التدقيق بواسطة عمل توثيقي متوازٍ لتصبح «تحتاج تأكيدًا من الإنتاج». نوصي بربطها بهذا التقرير وبنتيجة الفحص القرائي: محليًا القيم 07:00/10:00/11:00 وصفر تعارضات؛ إنتاجيًا ما زال يحتاج خطوات §7.

---

## 9. إصلاحات مقترحة (نصوص مقترحة — لم تُطبَّق احترامًا لنطاق المهمة)

### 9.1 حماية السباق: أضف حارس عزل + اختبار سباق في CI

**أ. حارس عزل داخل دالتي الحماية (patch proposal عبر ترحيل جديد 024):**

~~~sql
-- بعد PERFORM pg_advisory_xact_lock(...) في كل دالة حارس:
IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '0A000',
      MESSAGE = 'تعديل جدول المواعيد يتطلب READ COMMITTED لضمان فحص التداخل بعد القفل.';
END IF;
~~~

*ملاحظة:* هذا يقفل الباب على أي عزل أعلى ويعطي خطأً واضحًا بدل تداخل صامت. لا يؤثر على أي كود حالي.

**ب. اختبار سباق (يُدار من CI أو جهاز غير مقيّد) — جلستان متوازيتان:**

~~~text
الجلسة A: BEGIN; INSERT موعد (C1، الأحد 09:00، 60)؛ SELECT pg_sleep(2); COMMIT;
الجلسة B: (تبدأ بعد ~300ms) BEGIN; INSERT موعد متعارض (C2، الأحد 09:30، 60)؛ COMMIT;
النتيجة المتوقعة: B تنتظر على pg_advisory_xact_lock ثم تفشل بـ23514 (check_violation) ولا يُسجَّل إلا موعد واحد.
~~~

يمكن أتمتته كاختبار xUnit/Testcontainers في **tests/Dar.IntegrationTests/Schedule/ScheduleOverlapTests.cs** (اتصالان Npgsql متوازيان). *لم نُضِف الملف لأن VSTest محجوب بيئيًا هنا ولا يمكن التحقق من الترجمة/التشغيل؛ أنصح بإضافته في CI أو جهاز عادي مع الـfixture الموجود في tests/Dar.IntegrationTests/Supervision/SupervisionFixture.cs.*

**ج. بديل قوي بعيد المدى (اختياري):** قيد EXCLUDE USING gist (teacher_id WITH =, int4range(start_sec,end_sec) WITH &&) مع btree_gist وteacher_id منسوخ على circle_schedule_slots — يمنع السباق بنيويًا دون قفل، لكنه يتطلب إعادة تصميم التقريب الأسبوعي (توسيع كل موعد على 3 إزاحات أو دالة canonicalization) وترحيلًا كبيرًا. لا يُنصح به الآن.

### 9.2 ترتيب الإصلاحات المقترح

| الأولوية | الإصلاح | الملف/الجهة |
|---|---|---|
| 1 | إضافة schedule_overlap_verify.sql إلى CI في job migrations (يعمل على قاعدة نظيفة مباشرة بعد الترحيلات) | .github/workflows/ci.yml |
| 2 | اختبار سباق Testcontainers في CI (§9.1-ب) | tests/Dar.IntegrationTests/Schedule/ |
| 3 | حارس العزل (§9.1-أ) عبر ترحيل 024 مع اختبار | database/024_*.sql |
| 4 | تحديث المشغّلات: عدد الترحيلات ديناميكي بدل 14 | tests/runners/Verify-TeacherScheduleOverlapRegression.ps1 |
| 5 | توضيح رسالة التكرار (فحص وجود الموعد قبل الإدخال) | DomainEndpoints.ScheduleAttendance.cs |
| 6 | Endpoint PUT /api/schedule-slots/{id} + استخدامه في الواجهة بدل الحذف/الإضافة | backend + useDarApplication |
| 7 | حفظ ذري للحلقة+المواعيد (endpoint واحد أو rollback للحلقة عند فشل كل المواعيد) | backend + useCircleActions.saveCircle |
| 8 | تحديث docs/01-business.md §6.5 بحالة الإصلاح الحقيقية | docs |

### 9.3 مقطع CI جاهز (job migrations الحالي)

بعد خطوة «Verify migrations and portal tables» أضف:

~~~yaml
      - name: Teacher timetable overlap guard (migration 012)
        run: |
          docker exec -i -e PGPASSWORD=dar ${{ job.services.postgres.id }} \
            psql -U dar -d dar_ci -v ON_ERROR_STOP=1 \
            < tests/regression/sql/schedule_overlap_verify.sql
~~~

> الملف **مستقل**: ينشئ بياناته التجريبية داخل transaction ويلغيها في النهاية؛ لذلك يعمل على قاعدة نظيفة بعد الترحيلات مباشرة. أي FAIL يرفع استثناءً برسالة عربية ويفشل الـjob بسبب ON_ERROR_STOP=1.
> ⚠️ **لا تشغّله على الإنتاج**: صحيح أنه يتراجع في النهاية، لكنه يُدخل صفوفًا مؤقتة ويأخذ أقفالًا.

---

## 10. الحكم النهائي

- **منع التداخل على مستوى القاعدة: PASS** — 45/45 سيناريو + فحص استقصائي 3360 نقطة، على schema مطابق للإنتاج (23 ترحيلًا).
- **API:** كل مسارات الكتابة المرتبطة بالمواعيد (إنشاء موعد، حفظ حلقة، إعادة إسناد، تفعيل، استعادة من مهملات) تترجم القيد إلى 409 برسالة عربية واضحة — لا مسار معروف يتجاوز الحماية.
- **الإصلاح التاريخي للمواعيد الثلاثة:** مُطبَّق محليًا (07:00/10:00/11:00، صفر تعارضات)، والسكربت idempotent-safe. يلزم تأكيده على الإنتاج بالاستعلامات في §7.
- **غير مُتحقق تجريبيًا هنا:** السباق متعدد الجلسات (يحتاج Postgres بمنفذ شبكي) — يجب تغطيته في CI؛ والترحيلات على قاعدة الإنتاج (خارج نطاق هذه المهمة).
- **لم أعدّل** أي ملف في database/ أو backend/ أو frontend/ — فقط المخرجات المذكورة أدناه، ثم حُذف cluster الاختبار و.tmp-pg بالكامل.

---

## 11. المخرجات وطريقة إعادة التشغيل

| الملف | الوصف |
|---|---|
| **tests/regression/sql/schedule_overlap_verify.sql** | 45 سيناريو، transaction واحدة + ROLLBACK، بوابة فشل حقيقية (ON_ERROR_STOP)، جاهز للـCI |
| **docs/audits/schedule-overlap-audit.md** | هذا التقرير |

**تشغيل محلي عادي (جهاز غير مقيّد / CI):**

~~~bash
dotnet run --project src/Host/Dar.Api -- --migrate   # قاعدة اختبار نظيفة
psql -X -v ON_ERROR_STOP=1 -d <test-db> -f tests/regression/sql/schedule_overlap_verify.sql
# المتوقع في النهاية: PASS: teacher timetable overlap verification completed.
~~~

**تشغيل في هذه البيئة (ساندبوكس) — للتوثيق فقط:** نسخة cluster + postgres --single + تحويل SQL إلى سطر لكل statement (checkpoint واحد لكل تشغيل)، ثم حذف .tmp-pg.
