# تدقيق تجاوب لوحة الإدارة على الموبايل — خط الأساس وخطة التنفيذ

> **التاريخ:** 22 نوفمبر 2026
> **النطاق:** لوحة الإدارة (admin SPA على /management) فقط: App.tsx، SystemAdminView.tsx، pages/**، components/**، styles/**.
> **المرجع الملزم:** docs/17-master-plan.md §4 (المرحلة 2.4)، وdocs/14-ui-audit-and-mobile-direction.md §2.6/§3.
> **نوع الملف:** تدقيق قراءة فقط + خطة تنفيذ. لا يغيّر أي كود ولا قرارات عمل.

---

## 0. الملخص التنفيذي

**الحكم:** لوحة الإدارة الحالية **ليست متجاوبة 100%** على الموبايل. هي «desktop-first مع رقع موبايل»: الأجزاء العامة (البطاقات، الإحصاءات، الفلاتر، النماذج البسيطة) تعمل وتتدرّج جيدًا، لكن الجوهر التشغيلي اليومي (التنقل، الجداول، الحوارات الطويلة، أهداف اللمس، الخطوط) يحتاج إعادة تصميم لا مجرد tweaks.

**أهم عشر نتائج:**

1. **P0 — التنقل غير قابل للاستخدام عمليًا على الموبايل:** 11 قسمًا (frontend/src/domain/navigation.ts:4-16) مضغوطة في شريط أفقي واحد داخل الهيدر (frontend/src/styles/admin-insights.css:118-126)، الهيدر غير مثبّت فيختفي عند التمرير، شريط التمرير الأفقي مخفي (frontend/src/styles/foundation.css:50-57)، لا drawer ولا Bottom Nav ولا aria-current للإدارة (القواعد موجودة فقط في teacher/supervisor).
2. **P0 — 19 جدولًا (20 مع جدول ملاحظات المعلمات) بمقاسات دنيا 800–1120px** داخل حاوية عرضها المتاح على الهاتف 336px (عند 360)، مع إخفاء كل scrollbars صفحات الجداول، ولا يوجد «جدول → كروت» إلا في صفحة واحدة (ملاحظات المعلمات، admin-insights.css:105-114)، ولا رأس/عمود أول مثبّت.
3. **P0 — كل الحوارات centered modals** بعرض 690px (أو 1040px wide) وارتفاع 90vh، بلا bottom sheets، وأزرار الحفظ في آخر محتوى قابل للتمرير، وبلا قفل لتمرير الخلفية أو معالجة لوحة المفاتيح (frontend/src/components/common/Modal.tsx:5، students.css:76-77).
4. **P0 — الهيكل مبني على 100vh وbreakpoints عرضية فقط**؛ الهواتف الأفقية (عرض >760) تسقط في فرع الديسكتوب مع body overflow:hidden (foundation.css:6-7)، وشاشة الدخول/الحوارات قد تُقص أو تختنق (administration.css:2، students.css:77).
5. **P0 — تسريب CSS بين حِزم الواجهة:** فئات الأخطاء t-error-card/t-secondary مستخدمة في 3 صفحات إدارة (NotificationsPage.tsx:160، TeacherNotesPage.tsx:76، AdminRequestsPage.tsx:172) لكنها معرّفة فقط في teacher.css:42-43 و54-63 المحمّل مع chunk بوابة المعلمة فقط (TeacherApp.tsx:21-22) — فتظهر أخطاء الإدارة بلا تنسيق (مثبت من مخرجات build: التعريف في TeacherApp-*.css وليس في index-*.css).
6. **P0 — إخفاء الفائض بدل حله:** overflow-x:hidden على html/body (foundation.css:7) + scrollbars مخفية (foundation.css:50-57) يجعل ادعاءات «لا overflow» في تقارير QA السابقة صحيحة شكليًا فقط؛ المحتوى إما يُمرَّر داخل حاوية غير واضحة أو يُقص.
7. **P1 — أهداف اللمس:** 25 استخدامًا لزر أيقونة 31×31 (students.css:55)، وأزرار compact ~28px، وأزرار إغلاق 35px، وشرائح فلتر ~30px، وتبويبات نظام ~37px، وcheckboxes 15px. فقط أيقونات الهيدر تصل 44px (foundation.css:38). لا توجد أي قاعدة pointer:coarse في التطبيق.
8. **P1 — الخطوط أصغر من معيار DoD:** أكثر من 90 إعلانًا بحجم 10px و70+ بحجم 11px داخل CSS الإدارة؛ جدول الطلاب 11px ورؤوسه 10px (students.css:39-40)، والـbadges 9px. المطلوب أساسي 14 وثانوي 12.
9. **P1 — التباين في الثيم الفاتح تحت AA:** --muted #6e7d91 على خلفية #f2f5f9 = 3.84:1، وعلى الأبيض = 4.20:1؛ --accent #168f7b على الأبيض = 4.00:1 (كله دون 4.5:1 لنص صغير). الثيم الداكن سليم (6.8–9.8:1).
10. **P1 — فجوات منصّية:** inputات بخط 12px (تسبب zoom تلقائي في iOS)، وinput type=month في 7 مواضع (غير مدعوم في Safari/iOS فيتحول لنص يُكتب يدويًا)، ولا viewport-fit=cover ولا env(safe-area-inset) ولا dvh ولا visualViewport في الإدارة، و16 استخدامًا لـ window.confirm.

---

## 1. المنهجية والقيود

### 1.1 ما تم فحصه
- CSS: كل ملفات frontend/src/styles (12 ملفًا، منها foundation/administration/students/schedule-attendance/system-admin/admin-insights/desktop-preferences/finance/management-reports/refresh/reminders/index) + home.css للمقارنة.
- JSX: App.tsx، SystemAdminView.tsx، كل pages (13 ملفًا)، كل الحوارات (16 حوارًا + سجل ApplicationDialogs)، components/common، FinanceEntryCreateOnlyPanel، ChargeAuditPanel، PayrollLockPanel، ManagementReportBuilder (جزء الطباعة والتقرير).
- مداخل: main.tsx، index.html، domain/navigation.ts.
- للمقارنة والاتساق: teacher.css، supervisor.css، calendar-history.css، TeacherApp.tsx، SupervisorWorkspace.tsx، docs/14، docs/17 §4، آخر checkpoint للـUI (final-ui-qa-1.0 و uiux-pro-max-1.0).
- مخرجات build الموجودة في frontend/dist كمؤشر مساعد على تقسيم CSS/JS (وليست مصدرًا).

### 1.2 كيفية اشتقاق «مصفوفة صفحة × مقاس»
لا يوجد متصفح/Playwright في بيئة التنفيذ الحالية (build الأمامي محجوب بقيود sandbox — تم تسجيله في تقرير التحقق). لذلك المصفوفة **مبنية على تحليل ثابت مؤكد**: قواعد media queries الفعلية، ترتيب الـcascade، min-widths، وقياس عرض المحتوى المتاح حسابيًا. أي بند «يحتاج تحققًا بصريًا» مذكور في قائمة QA (§7).

**عرض المحتوى المتاح قبل الجداول (محسوب من foundation.css:10,27,28):**

| المقاس | الهيكل | Sidebar | عرض المحتوى الصافي |
|---|---|---|---|
| 1440 | Desktop grid | 250px | 1118px |
| 1280 | Desktop grid | 250px | 958px |
| 1024 | Desktop grid (≤1100) | 205px | 771px |
| 768 | Desktop grid (≤1100) | 205px | 515px |
| 414 | Block (≤760) | لا يوجد | 390px |
| 390 | Block (≤760) | لا يوجد | 366px |
| 360 | Block (≤760) | لا يوجد | 336px |

جدول الحضور schedule-session-table أدنى عرض له 1120px ثم 1040px تحت 1280 ثم 980px ثم 900px (schedule-attendance.css:156,169-171) — أي أنه **لا يتسع أفقيًا حتى على 1440** (1118 < 1120) ويظل يحتاج تمريرًا.

### 1.3 الرموز
- ✅ مقبول كما هو (قد يحتاج تحققًا بصريًا فقط).
- ⚠️ يعمل لكن به ألم موبايل واضح يجب تحسينه في 2.4.
- ❌ غير قابل للاستخدام التشغيلي على الهاتف؛ يحتاج إعادة تصميم (كروت/شيتات/تنقل).

---

## 2. البنية الحالية في سطور

| العنصر | الحالة الحالية | الدليل |
|---|---|---|
| الهيكل | grid: sidebar 250px + main؛ 205px تحت 1100؛ block تحت 760 | foundation.css:10,27,28 |
| Sidebar | sticky على الديسكتوب؛ على الموبايل block عادي (غير مثبت) | foundation.css:12,28؛ admin-insights.css:119 |
| التنقل | 11 عنصرًا؛ على الموبايل شريط أفقي واحد قابل للتمرير | navigation.ts:4-16؛ admin-insights.css:121-123 |
| الـTopbar | عنوان + 5 أزرار (تحديث/تذكيرات/باسورد/ثيم/خروج) + عداد | App.tsx:72 |
| الحوارات | centered modal: 690px (wide 1040px)، max-height 90vh | students.css:76-77؛ administration.css:77 |
| الجداول | 19 جدولًا؛ min-width 800–1120 | students.css:39؛ administration.css:26؛ schedule-attendance.css:156؛ finance.css:37 |
| الخطوط | 10px و11px هي الغالبة في الجداول والثانوي | students.css:39-41؛ admin-insights.css:60-62 |
| النماذج | form-grid عمودان → عمود واحد ≤760؛ input 12px | students.css:82,88,126 |
| الحالات | EmptyState نعم؛ Skeletons لا؛ Loading نصي | EmptyState.tsx؛ لا وجود لكلمة skeleton في src |

### 2.1 فوضى الـbreakpoints (18 قيمة في CSS الإدارة)
1280، 1250، 1100، 1050، 1000، 960، 900، 850، 760، 720، 700، 650، 640، 600، 580، 520، 500، 420 (+380 في بوابة المعلمة). أمثلة: administration.css:76,99,128,137؛ schedule-attendance.css:145-146,169-171,72,183؛ system-admin.css:54-55,82؛ management-reports.css:33,42,44,48؛ finance.css:28-30؛ desktop-preferences.css:30-31,37-38,55.

**الأثر:** سلوك الصفحة يتغير عند أعراض مختلفة بلا نظام موحد؛ مقاس 768 (تابلت) يعيش في فرع الديسكتوب الثقيل، بينما بوابة المعلمة/المشرفة تتحول إلى shell الموبايل عند 1023 — **عدم اتساق مباشر**.

---

## 3. مصفوفة صفحة × مقاس

> **ملاحظة:** الخلايا تصف «حالة الاستخدام التشغيلي» لا وجود الأخطاء فقط. التفاصيل والدلائل في §4.

### 3.1 صفحات لوحة الإدارة

| الصفحة | 360 | 390 | 414 | 768 | 1024 | 1440 |
|---|---|---|---|---|---|---|
| الدخول/التهيئة (AuthPage) | ⚠️ يعمل؛ تعليمات «Windows» قديمة (AuthPage.tsx:46)؛ inputات 12px تزوّم iOS | ⚠️ نفس | ⚠️ نفس | ⚠️ body overflow:hidden قد يقص نموذج التهيئة في شاشة قصيرة | ✅ | ✅ |
| لوحة التحكم | ⚠️ Hero+إحصاءات تنزل؛ جدولا «مساهمة الحلقات/أجور المعلمات» 800/1080 يحتاجان تمريرًا داخليًا | ⚠️ نفس | ⚠️ نفس | ❌ 515px محتوى مع جداول 1080 | ⚠️ 771px < جدول 1080 | ✅ |
| الإشعارات | ✅/⚠️ كروت تعمل؛ الإحصاءات عمود واحد؛ لكن بطاقة الخطأ بلا CSS | ✅/⚠️ نفس | ✅/⚠️ نفس | ✅ | ✅ | ✅ |
| طلبات المعلمات | ✅/⚠️ كروت وأكورديون داخل الكارت؛ بطاقة الخطأ بلا CSS؛ أزرار اعتماد صغيرة | ✅/⚠️ نفس | ✅/⚠️ نفس | ✅ | ✅ | ✅ |
| الطلاب | ❌ جدول 8 أعمدة (1080) + 3–4 أزرار 31px في صف واحد | ❌ نفس | ❌ نفس | ❌ | ❌ 771px | ✅ |
| المعلمات | ❌ جدول 6–7 أعمدة (1080) + أزرار صف | ❌ | ❌ | ❌ | ❌ | ✅ |
| ملاحظات المعلمات | ✅ الجدول يُخفى والكروت تعمل ≤760 | ✅ | ✅ | ✅ | ✅ | ✅ |
| الحلقات | ⚠️ كروت عمود واحد جيدة؛ أزرار تعديل/حذف 31px | ⚠️ | ⚠️ | ✅/⚠️ عمودان حتى 1250 | ✅ | ✅ |
| المواعيد والحضور | ❌ جدول الحصص 8–9 أعمدة + 900px min حتى على الهاتف + شريط أزرار لكل صف | ❌ | ❌ | ❌ | ❌ | ⚠️ 1118px محتوى مقابل 1120 جدول |
| الاشتراكات والتحصيل | ❌ 3 جداول 1080+ (تحصيل/إعلانات/مصروفات) + month input + فورمات طويلة | ❌ | ❌ | ❌ | ❌ | ✅ |
| الحسابات والصلاحيات | ❌ جدول + حوار صلاحيات ضخم + multi-select بـCtrl | ❌ | ❌ | ❌ | ❌ | ✅ |
| النظام (6 تبويبات) | ❌ تبويبات أفقية + جداول 1080 (audit/trash/backups) + حوار تصفير + scope select 130px | ❌ | ❌ | ⚠️ | ⚠️ | ✅ |

### 3.2 الحوارات الأساسية

| الحوار | 360-414 | 768 | 1024-1440 | المشكلة المحورية |
|---|---|---|---|---|
| Modal عام (كل النماذج) | ⚠️/❌ | ✅ | ✅ | centered + 90vh + بلا قفل خلفية/كيبورد |
| حضور الطلاب (roster) | ❌ | ⚠️ | ✅ | جدول 1080 داخل modal + زر الحفظ آخر المحتوى |
| ملف الطالب (StudentHistory) | ⚠️ | ✅ | ✅ | أقسام طويلة؛ أزرار 31px؛ modal wide 1040 |
| ملف المعلمة (TeacherHistory) | ⚠️/❌ | ⚠️ | ✅ | جدول حضور 1080 داخل modal |
| تفاصيل الحلقة | ❌ | ⚠️ | ✅ | roster 1080 + launcher حضور + أزرار متعددة |
| حوار المستخدم/الصلاحيات | ❌ | ❌ | ✅ | 60+ صلاحية + multi-select Ctrl + modal طويل جدًا |
| إلحاق مجموعة | ⚠️ | ✅ | ✅ | قائمة داخلية max-height 42vh تعمل؛ لكن modal ثابت |
| الدفع/الاستحقاق | ⚠️ | ✅ | ✅ | input 12px + ملف إيصال؛ جيد نسبيًا |
| التقرير المحفوظ | ⚠️/❌ | ⚠️ | ✅ | جدول 1080 داخل modal |
| التذكيرات الشخصية | ⚠️ | ✅ | ✅ | modal wide + form-grid |
| تأكيد التصفير/الحذف | ⚠️ | ✅ | ✅ | window.confirm أو modal ضيق بلا sheet |

### 3.3 قضايا عابرة لكل الصفحات
❌ التنقل غير مثبت ولا Bottom Nav — ❌ Scrollbars مخفية — ❌ لا Skeletons — ⚠️ أهداف لمس <44 — ⚠️ خطوط 9–11px — ⚠️ أخطاء بلا CSS — ⚠️ window.confirm.

---

## 4. المشاكل المحددة بالأدلة

### P0 — تمنع الاستخدام اليومي على الهاتف

#### P0-1. التنقل: شريط أفقي مخفي غير مثبت، بلا drawer أو bottom nav
- 11 قسمًا معرفة في frontend/src/domain/navigation.ts:4-16.
- على ≤760: foundation.css:28 يخفي كل nav-item ويُظهر النشط فقط، ثم students.css:106-115 وadministration.css:106-113 وadmin-insights.css:118-126 يعيدون تعريف القواعد ثلاث مرات؛ النتيجة النهائية: sidebar بلوك عادي (غير sticky) + nav-list صف أفقي overflow-x (admin-insights.css:121) + navbar items flex (122) + إخفاء sidebar-account (124) وإخفاء sidebar-bottom (125).
- الشريط الأفقي **غير مثبت** (لا position: sticky/fixed في القاعدة النهائية؛ foundation.css:28 تجعل sidebar static على الموبايل).
- تمرير أفقي بلا مؤشر: كل scrollbars العناصر مخفية بما فيها .sidebar .nav-list (foundation.css:50-57).
- لا aria-current في أي قسم إدارة؛ موجود فقط في TeacherNav.tsx:39 وSupervisorWorkspace.tsx:151/196/209.
- لا drawer إداري ولا Bottom Nav إداري (drawer/bottom nav موجودان فقط في supervisor.css:252-280 وTeacherNav).
- **الأثر:** المستخدم يرى أول 3–4 أقسام فقط؛ الوصول لبقية الأقسام يتطلب معرفة أن الشريط يُمرَّر أفقيًا + العودة لأعلى الصفحة؛ لا وصول دائم للتنقل أو تسجيل الخروج أثناء التمرير.

#### P0-2. الجداول desktop-first: 19 جدولًا بمقاسات 800–1120 وإخفاء كامل لscrollbars
- القواعد: students.css:39 (students-table 820px)، administration.css:26 (wide-table 1080px)، schedule-attendance.css:156/169-171 (1120/1040/980/900)، finance.css:37 (profit-circle-table 800)، schedule-attendance.css:99 (teacher-history 820)، SavedReportDialog:15 وCircleDetailsDialog:59 وStudentAttendanceDialog:83 وTeacherHistoryDialog:28.
- الصفحات: StudentsPage.tsx:16، TeachersPage.tsx:15، UsersPage.tsx:16، PaymentsPage.tsx:23/26/29، SchedulePage.tsx:42/43/45، DashboardPage.tsx:26-27، SystemAdminView.tsx:305/310/316، ChargeAuditPanel.tsx:52.
- الحاوية .table-scroll=overflow:auto (students.css:38) لكن شريطها مخفي (foundation.css:50-57) فلا دليل بصري على وجود محتوى إضافي.
- لا يوجد تحويل لكروت إلا في TeacherNotesPage (جدول مخفي + كروت عند admin-insights.css:105-114، والتنفيذ في TeacherNotesPage.tsx:80-114).
- لا رأس مثبت لأي جدول؛ الاستثناء الوحيد عمود الإجراءات الأخير في schedule-session-table (schedule-attendance.css:157) وهو desktop-hedge وليس حلاً للموبايل.
- تطبيقات الموبايل اليومية المتأثرة: تسجيل الحضور، تحصيل الدفعات، تعديل طالب، مراجعة الطلبات.
- **الأثر:** كل صف يتطلب تمريرًا أفقيًا دقيقًا داخل حاوية بلا مؤشر، والأزرار (31px) تحتاج دقة عالية.

#### P0-3. الحوارات: modals مركزية ثابتة بلا bottom sheet، بلا sticky actions، بلا قفل تمرير ولا معالجة كيبورد
- Modal: students.css:76-77 (backdrop fixed + student-modal width min(690px,100%)، max-height min(90vh,850px)، overflow:auto)؛ wide = min(1040px,100%) (administration.css:77)؛ زر إغلاق 35px (students.css:81).
- Modal.tsx:5 لا يضيف أي effect لقفل body أو Escape أو نقل focus؛ لا visualViewport في التطبيق كله (بحث).
- أزرار الحفظ آخر المحتوى: ModalActions.tsx:3 وUserDialog.tsx:145 وStudentAttendanceDialog.tsx:85 وStudentHistoryDialog.tsx:40 — بعد محتوى طويل.
- أمثلة محتوى طويل: UserDialog 149 سطرًا + 60+ صلاحية (UserDialog.tsx:113-143)، StudentAttendance roster جدول 1080 داخل modal (StudentAttendanceDialog.tsx:83)، CircleDetails roster + launcher حضور (CircleDetailsDialog.tsx:56-59).
- ملاحظة إيجابية: form-grid عمودان → عمود واحد ≤760 (students.css:126) وهذا جيد ونحافظ عليه.
- **الأثر:** على الهاتف يُفتح الحوار وسط الشاشة، جزء من الحقول تحت لوحة المفاتيح، وزر الحفظ قد يكون خارج الرؤية بعد تمرير طويل؛ ولا حماية من تمرير الخلفية.

#### P0-4. 100vh + breakpoints عرضية فقط: تابلت وهاتف أفقي يعيشان في فرع الديسكتوب
- foundation.css:10 (app-shell height:100vh) و19 (main-content height:calc(100vh - 48px)) و27 (sidebar 205px ≤1100) و28 (≤760 فقط يتحول).
- body overflow:hidden على الديسكتوب (foundation.css:6)؛ شاشة الدخول min-height:100vh بلا overflow (administration.css:2) — في landscape قصير (مثل 844×390) لا يوجد ضمان لرؤية نموذج التهيئة كاملًا.
- بين 761–1023: sidebar 205px + محتوى 515–771px فقط، مع جداول 1080 → أسوأ مقاس فعليًا.
- بوابة المعلمة/المشرفة تتحولان عند 1023 (teacher.css:214/355؛ supervisor.css:252) — الإدارة عند 760 فقط: **عدم اتساق**.
- **الأثر:** أجهزة iPad والهواتف الأفقية تحصل على تجربة أسوأ من الهاتف العمودي.

#### P0-5. تسريب CSS بين حِزم الواجهة: أخطاء صفحات الإدارة بلا تنسيق
- الاستخدام: NotificationsPage.tsx:160، TeacherNotesPage.tsx:76، AdminRequestsPage.tsx:172 تستخدم t-error-card/t-secondary.
- التعريف: teacher.css:42-43 و54-63 فقط.
- التحميل: main.tsx:5 يحمّل styles/index.css فقط؛ teacher.css يُحمَّل من TeacherApp.tsx:21-22، وTeacherApp محمّل lazy في main.tsx:7 — أي أن chunk الإدارة لا يحمل teacher.css.
- دليل build محلي: dist/assets/index-*.css (108KB) لا يحتوي t-error-card بينما dist/assets/TeacherApp-*.css (46KB) يحتويها.
- **الأثر:** عند أي خطأ API في 3 صفحات إدارة (سحب/صلاحيات/فشل تحميل) يظهر نص وزر بلا تنسيق — قطع في المظهر مع احتمال عدم وضوح إجراء «إعادة المحاولة».

#### P0-6. إخفاء الفائض بدل حله
- html,body,#root overflow-x:hidden (foundation.css:7) + scrollbars مخفية للحاويات المحددة في foundation.css:50-57 بما فيها .table-scroll و.sidebar .nav-list.
- **الأثر:** أي overflow داخلي إما يظهر كتمرير غير مكتشف أو يُقص؛ تقارير QA السابقة (final-ui-qa-1.0:7 وuiux-pro-max-1.0:22) تفحص «root overflow» فقط وهذا لا يلتقط المشكلة الحقيقية.

### P1 — ألم مؤكد يجب معالجته في نفس المرحلة

#### P1-1. أهداف اللمس أقل من 44px
- small-icon-button 31×31 (students.css:55) و25 استخدامًا في صفحات الإدارة.
- compact-button: padding 7/9 + font 10 ≈ 28px (administration.css:43).
- filter-chip ≈30px (students.css:29)؛ system-tab ≈37px (system-admin.css:25)؛ nav-item موبايل ≈35px (admin-insights.css:122)؛ close-modal 35px (students.css:81)؛ attendance trigger 38px (schedule-attendance.css:82)؛ checkboxes 15px (system-admin.css:80).
- فقط top-actions icon-button/avatar = 44px على ≤760 (foundation.css:28,38؛ desktop-preferences.css:55).
- لا توجد media pointer:coarse في التطبيق (بحث).
- **معيار DoD المطلوب:** كل هدف لمس ≥44×44 (docs/17 §4).

#### P1-2. الخطوط أصغر من المعيار
- students-table 11px، ث 10px (students.css:39-40).
- .sub-cell و.muted-text 10-11px (students.css:47؛ administration.css:31).
- admin-insights: time 9.5px (60)، badge 9px (62)، p 11.5px (68)، note card 9-11px (109-112).
- .admin-severity 9px (admin-insights.css:62)، .system-tab 11px، .permission-option 10px (administration.css:71).
- أكثر من 90 تصريح font-size:10px و70+ بحجم 11px في styles/.
- **المطلوب:** أساسي ≥14 وثانوي ≥12 على الموبايل (docs/17 §4)، مع جداول لا تنزل عن 12.

#### P1-3. تباين الثيم الفاتح أقل من AA
- القيم (WCAG): --muted #6e7d91 على --bg #f2f5f9 = **3.84:1**، وعلى الأبيض = **4.20:1**؛ --accent #168f7b على الأبيض = **4.00:1**. الثيم الداكن: muted 6.8–7.6 وaccent 9.8 ✅.
- المصدر: foundation.css:2-3 (tokens)؛ الاستخدام كثيف في نص 9–11px (روابط، شرائح فلتر، ثانوي).
- **الأثر:** صعوبة قراءة على الموبايل/الشمس في الوضع الفاتح.

#### P1-4. منصّة iOS: zoom تلقائي + month input غير مدعوم
- كل inputات النماذج 12px (students.css:88) — أقل من 16px يسبب zoom تلقائي عند التركيز في Safari/iOS.
- type=month في: PaymentsPage.tsx:19، DashboardPage.tsx:23، SchedulePage.tsx:39، SystemAdminView.tsx:304، ChargeDialog.tsx:18، FinanceEntryCreateOnlyPanel.tsx:71، ManagementReportBuilder.tsx:370 — Safari لا يدعم الشهر أصلاً فيتحول لحقل نصي حر (يحتاج كتابة 2026-11 يدويًا).
- **يحتاج تحققًا على جهاز iOS**، لكنه خطر معروف ومباشر لمالك يستخدم iPhone.

#### P1-5. RTL/LTR: الهواتف والأكواد والتواريخ غير معزولة اتجاهيًا في الإدارة
- في جدول الطلاب: الهاتف يُعرض بلا dir="ltr" (StudentsPage.tsx:17)، وباقي الجداول كذلك؛ بينما بوابة المشرفة تعزل الهاتف (SupervisorStudents.tsx:83,99,172؛ SupervisorAbsences.tsx:62,79).
- مدخلات الوقت معزولة LTR (students.css:92-93) — جيد؛ مدخلات الشهر ليست كذلك (type=month بلا direction/unicode-bidi).
- **المطلوب:** dir="ltr" + unicode-bidi:isolate للهاتف/الكود/المرجع/التاريخ الرقمي داخل RTL.

#### P1-6. viewport/safe-area/كيبورد
- index.html:5: viewport بلا viewport-fit=cover.
- لا env(safe-area-inset) في CSS الإدارة (موجود في teacher.css:200 وsupervisor.css:237/260/272) → toast (students.css:95 bottom/left ثابت) وشريط الأزرار قد يتداخل مع home indicator.
- لا 100dvh/svh (فقط 100vh في foundation.css:10,19 و90vh في students.css:77).
- لا visualViewport (بحث) → لوحة المفاتيح لا تُدار.
- Modal لا يقفل تمرير الخلفية (Modal.tsx لا يحوي أي effect).
- لا overscroll-behavior لمعظم الحاويات (فقط foundation.css:19 nav:41 وschedule-attendance.css:109).

#### P1-7. الحالات والأداء
- Skeletons: صفر (لا وجود في src)؛ التحميل نص «جارٍ…» (EmptyState/loading-inline).
- لا pagination: SystemAdminView.tsx:89 يطلب audit-log?limit=10000؛ الجداول ترسم كل الصفوف؛ لا virtualization.
- Empty states موجودة وتصلح للبناء عليها (EmptyState.tsx:3).
- **الأثر:** DOM ثقيل على الهاتف في التدقيق/التحصيل/الحضور + انتظار بلا هيكل تحميل.

#### P1-8. window.confirm (16 استخدامًا)
- useDarApplication.ts:173,215,236,246؛ useUserActions.ts:94؛ useStudentActions.ts:171-172؛ CircleDetailsDialog.tsx:38؛ AdminRequestsPage.tsx:122,136؛ SystemAdminView.tsx:132,137,150,176؛ StudentAttendanceDialog.tsx:54,82.
- مخالف لاتجاه docs/14:33 و167 (استبدالها بحوارات مناسبة للموبايل).

### P2 — تحسينات مهمة لكن ليست مانعة

- **P2-1. قص محتمل لأرقام المال في بطاقات لوحة التحكم:** .stats-grid يبقى عمودين على ≤760 (foundation.css:28؛ admin-insights.css:93-96) والبطاقات العادية .stat-value بحجم 24–28px بلا overflow-wrap (foundation.css:25؛ فقط .compact-stats لها wrap في administration.css:36) → مبالغ كبيرة قد تخرج من البطاقة/تُقص عند 336px.
- **P2-2. تبويبات وفلاتر أفقية بلا مؤشر:** system-tabs (system-admin.css:24-25)، status-filters (students.css:120)، admin-insight-segment (admin-insights.css:50-52,100-101)؛ تعمل بالسحب لكن بلا دليل بصري.
- **P2-3. تكرار/تعارض قواعد:** 4 كتل تعيد تعريف shell/nav (foundation:28؛ students:106-129؛ administration:100-113؛ admin-insights:118-126) + كتلة مكررة حرفيًا في schedule-attendance.css:34-50 — خطر صيانة وتعارض مستقبلي.
- **P2-4. reduced-motion:** CSS يوقف transitions (foundation.css:29,37) لكن framer-motion يستمر في AnimatePresence/initial/exit (App.tsx:3,62,73-94) بلا MotionConfig/useReducedMotion.
- **P2-5. طباعة:** لا print CSS لتطبيق الإدارة (فقط داخل مستند التقرير المستقل ManagementReportBuilder.tsx:279-281) → طباعة صفحة جدول من المتصفح تطبع الهيكل كله.
- **P2-6. الحجم:** dist الحالي: index JS 765KB + CSS 108KB؛ تحسين لاحق (docs/14:35) وليس ضمن 2.4 لكنه يؤثر على أول تحميل موبايل.

---

## 5. ما يجب الحفاظ عليه (لا نعيد بناءه)

| النمط | الدليل | لماذا نحافظ عليه |
|---|---|---|
| تحول page-toolbar لعمود + أزرار بعرض كامل ≤760 | students.css:116-118 | ممتاز لصفحات الإدارة |
| البحث والفلاتر: عمود ≤1100، شرائح أفقية ≤760 | students.css:105,119-121 | سليم بصريًا |
| كروت الحلقات 3→2→1 | administration.css:51,99,104 | تعمل |
| compact stats: 3→1 بأيقونة جانبية | administration.css:34,103 | تعمل |
| لوحة الأرباح: عمودان→عمود، تفاصيل 2→1 | finance.css:6,28-30 | تعمل |
| modal width min(690/1040,100%) + form-grid عمود واحد ≤760 + wide fields | students.css:77,82,84,126-128 | أساس سليم نبنى عليه |
| empty states + inline errors | EmptyState.tsx؛ students.css:59-69 | نبنى عليه للـSkeletons |
| topbar icons 44px على الموبايل + flex-wrap | foundation.css:38؛ system-admin.css:5؛ desktop-preferences.css:55 | يحقق جزءًا من 44px |
| focus-visible + reduced-motion + RTL منطقي | foundation.css:29,36-37؛ students.css:92-93 | مكاسب a11y قائمة |
| بوابة المعلمة/المشرفة كمرجع أنماط | teacher.css:2-16,200-208,214-232؛ supervisor.css:201-202,237,252-280 | Bottom nav + safe-area + sheets + كروت جاهزة لإعادة الاستخدام |
| AttendanceStatusPicker كقائمة portal تتكيف مع المكان | AttendanceStatusPicker.tsx:21-29 | سلوك صحيح على الموبايل |
| جدول ملاحظات المعلمات → كروت | admin-insights.css:105-115 | النموذج الذي نعممه |

---

## 6. خطة التنفيذ (P0/P1/P2)

> كل بند: المكوّن/الصفحة ← التغيير (CSS/JSX) ← معيار القبول. الحجم نسبي: S (نصف يوم أو أقل)، M (1–2)، L (3–5).
> القاعدة: لا تغيير في سلوك المال/الصلاحيات/البيانات — واجهة فقط.

### 6.1 P0 — أساس التجاوب

| # | المكوّن | التغيير المطلوب | معيار القبول | الحجم |
|---|---|---|---|---|
| **2.4-a1** | shell/تنقل | في App.tsx: على ≤1023 إخفاء sidebar واستبدالها بـ (Drawer يعرض كل visiblePages + الحساب/الخروج) + Bottom Nav ثابت من 5 عناصر (الرئيسية، الطلاب، الحلقات، المواعيد، المزيد) + شيت «المزيد» لبقية الأقسام. إضافة aria-current وaria-label وfocus trap وEscape وإغلاق عند التنقل. شريط علوي مبسط مثبت (عنوان + إشعارات). إزالة «نسخة سطح المكتب» (App.tsx:68) وبقايا desktop bridge/theme من نفس الملف. | 11 قسمًا كلها قابلة للوصول ≤2 لمسات؛ Bottom Nav وDrawer مثبتان أثناء التمرير؛ aria-current موجود؛ لا تمرير أفقي للتنقل؛ خروج متاح دائمًا. | L |
| **2.4-a2** | هيكل/viewport | استبدال 100vh بـ100dvh مع fallback؛ إضافة viewport-fit=cover (index.html:5)؛ env(safe-area-inset) للـBottom Nav/الشيت/التوست؛ فتح shell الموبايل عند 1023 بدل 760 لتطابق teacher/supervisor؛ معالجة الهواتف الأفقية (max-height للـdialogs وشاشة دخول قابلة للتمرير). | iPad 768 والهاتف الأفقي 844×390 يعملان بنفس سلاسة العمودي؛ لا عناصر ثابتة تحت home indicator؛ شاشة الدخول قابلة للتمرير دائمًا. | M |
| **2.4-a3** | الحوارات | تعديل Modal.tsx: على ≤768 يتحول Bottom Sheet (align-items:end، radius علوي، max-height: calc(100dvh - env(safe-area-inset-top) - 12px)) + رأس ثابت + فوتر إجراءات sticky (زر أساسي بعرض مناسب) + قفل body overflow + Escape + إعادة focus + visualViewport لتمرير الحقل النشط. ModalActions تصبح sticky تلقائيًا. | لكل الحوارات: الحفظ/الإلغاء مرئيان دائمًا؛ الحقل النشط ليس خلف الكيبورد؛ الخلفية لا تُمرَّر؛ ESC/Back يغلق؛ ارتفاع لا يتجاوز الشاشة الفعلية. | M |
| **2.4-a4** | الجداول | إضافة مكوّن مشترك ResponsiveTable (أو فئة/نمط موحد) يعرض: كروت ≤767 لكل جداول التشغيل (طلاب، معلمات، مستخدمون، تحصيل، حضور طلاب، حصص، سجلات تدقيق اليوم، سلة، نسخ) مع action primary واضح؛ وللجداول الاستثنائية (audit diff/تقارير) أفقية مع sticky أول عمود + header + مؤشر «اسحب أفقيًا». | لا يوجد جدول تشغيلي يتطلب تمريرًا أفقيًا على 360–414؛ Cards تحمل نفس معلومات الصف + الإجراء الرئيسي ≥44؛ audit لا يزال قابلًا للمقارنة. | L |
| **2.4-a5** | CSS مشترك | نقل فئات الأخطاء/الأزرار المشتركة (t-error-card/t-secondary أو بديل admin) إلى styles/index.css أو ملف feedback.css عام؛ منع اعتماد أي صفحة إدارة على CSS بوابة المعلمة؛ إزالة الكتل المكررة/المتعارضة لـshell/nav (توحيدها في ملف واحد). | لا توجد فئة مستخدمة في الإدارة إلا ومعرّفة في الحزمة العامة؛ فحص grep يثبت عدم وجود t-* في pages/**؛ بناء واحد بدون CSS chunk leakage. | S |
| **2.4-a6** | إصلاح إخفاء الفائض | إبقاء overflow-x:hidden كحارس، لكن إزالة القواعد التي تخفي scrollbars الجداول/الأشرطة ووضع مؤشرات بديلة (scroll-shadow/gradient + تلميح). | كل حاوية تمرير لها دليل بصري؛ لا محتوى مقصوص بدون بديل؛ لا تتغير الـscrollbars لأجهزة سطح المكتب سلبًا. | S |

### 6.2 P1 — الجودة اليومية

| # | المكوّن | التغيير | معيار القبول | الحجم |
|---|---|---|---|---|
| **2.4-b1** | كل الأزرار/التحكم | قاعدة على ≤1023: min 44px لكل button/زر أيقونة/chip/تبويب/إغلاق/attendance trigger؛ تكبير checkbox إلى 20px مع label padding. | جدول تدقيق يثبت ≥44 لكل عنصر تفاعلي في الصفحات الـ11 والحوارات. | M |
| **2.4-b2** | الخطوط/التباين | على ≤1023: أساسي 14px (body/نصوص الجداول) وثانوي 12px؛ رفع th إلى 11–12 وbadges إلى 11؛ تعديل tokens الفاتح --muted/--accent لتحقيق ≥4.5:1 (مع فحص كل الأماكن المتأثرة في teacher/supervisor). | فحص CSS يثبت عدم وجود <12px على الموبايل؛ تباين كل النصوص ≥4.5:1 في الثيمين (أداة فحص أو Playwright axe لاحقًا). | M |
| **2.4-b3** | النماذج والفلاتر | MonthPicker مخصص (شهر/سنة) بديل type=month في 7 مواضع؛ segmented-filter بدل شرائح قابلة للتمرير الأفقي للفلاتر الأساسية؛ شريط فلاتر sticky في صفحات القوائم؛ Scope multi-select → قائمة checkbox داخل sheet أو chips بدل Ctrl (UserDialog:108)؛ شريط بحث بعرض كامل/ثابت في صفحات القوائم (students.css:25-26 يضمن العرض بالفعل، يُثبّت مع الفلاتر)؛ تعليمات المستخدم محدثة. | اختيار الشهر يعمل على Safari/Android بلا كتابة يدوية؛ كل فلتر أساسي ظاهر/ثابت؛ scope يختار متعدد بلمسة واحدة. | M |
| **2.4-b4** | تأكيدات | ConfirmSheet مخصص (سبب/تفاصيل/إجراء خطر) واستبدال 16 window.confirm تدريجيًا، مع بديل موحد للحذف النهائي والتصفير. | لا window.confirm في مسارات الإدارة عند نهاية المرحلة؛ التأكيد واضح ويحمل سببًا حيث يلزم. | M |
| **2.4-b5** | RTL/LTR | dir="ltr"/unicode-bidi:isolate لكل هاتف/كود/مرجع/تاريخ رقمي/شهر داخل الجداول والحوارات (اقتداء بـSupervisorStudents). | لا انقلاب بصري لأرقام الهواتف أو التواريخ؛ اختبار RTL/LTR موثق. | S |
| **2.4-b6** | الحالات | Skeletons لحاويات الجداول/الكروت في التحميل الأول؛ توحيد Empty/Error/Retry؛ رسائل خطأ inline دائمة بدل toast للأخطاء الحرجة؛ حالات 0/1/1000 صف. | كل صفحة لها 4 حالات مصممة (loading/empty/error/data) بلقطات؛ لا وميض محتوى. | M |
| **2.4-b7** | الأداء | إدخال pagination/«عرض المزيد» أو حد أعلى مع فهرس للقوائم الطويلة (audit/trash/backups/collections) + إبقاء limit الحالي للـAPI دون تغيير سلوكي. | interaction سلسة على جهاز متوسط مع 1000 صف؛ لا تجميد أثناء التمرير. | M |

### 6.3 P2 — صقل ما بعد الأساس

| # | المكوّن | التغيير | معيار القبول | الحجم |
|---|---|---|---|---|
| **2.4-c1** | إحصاءات المال | overflow-wrap + تقليل حجم القيم الكبيرة تدريجيًا (clamp) على ≤420؛ بطاقة مالية كاملة العرض عند الحاجة. | أعلى مبلغ واقعي لا يُقص عند 360px. | S |
| **2.4-c2** | مؤشرات التمرير | Scroll-shadow/فاصل مرئي للجداول الأفقية والتبويبات والفلاتر. | المستخدم يكتشف وجود محتوى إضافي دون تخمين. | S |
| **2.4-c3** | الطباعة | print CSS للوحة الإدارة (إخفاء shell/nav وأزرار) + الحفاظ على مستند التقارير الخارجي؛ A4 لإيصالات/كشوف محددة إن لزم. | طباعة صفحة/كشف لا تطبع القشرة؛ تقرير PDF الرسمي غير متأثر. | S |
| **2.4-c4** | الحركة | MotionConfig reducedMotion="user" لـframer + فحص reduced-motion على كل الشاشات. | لا حركة عند تفضيل reduce. | S |
| **2.4-c5** | أداء الرسم | تقليل backdrop-filter/glass على ≤767 (أو تقليل blur) + tap-highlight + overscroll containment للحاويات. | تحسين إحساس اللمس/التمرير على أجهزة متوسطة؛ لا كسر للهوية. | S |

### 6.4 ترتيب العمل المقترح داخل المرحلة
1. **2.4-a (أسبوع 1):** shell/nav + viewport/safe-area + Modal sheet + إصلاح CSS leak + scrollbars indicators.
2. **2.4-b (أسبوع 2):** ResponsiveTable + تحويل الجداول صفحة صفحة مع أولوية: الطلاب → التحصيل → المواعيد/الحضور → الحسابات → النظام.
3. **2.4-c (أسبوع 3):** لمس/خطوط/ألوان/نماذج وفلاتر/RTL/حالات + window.confirm.
4. **2.4-d (أسبوع 4):** QA كامل + لقطات + checkpoint + مقارنة مع DoD.

**ملفات جديدة مقترحة (يُثبّتها المنفّذ في بداية المرحلة):**
- frontend/src/components/layout/AdminMobileNav.tsx — Drawer + Bottom Nav + شيت «المزيد» (يبني من visiblePages فقط).
- frontend/src/components/common/ResponsiveTable.tsx — طبقة جدول/كروت واحدة تُستخدم في كل القوائم.
- frontend/src/components/common/MonthPicker.tsx — بديل type=month.
- frontend/src/components/common/ConfirmSheet.tsx — بديل window.confirm.
- frontend/src/styles/responsive.css (أو توحيد القواعد داخل foundation/students) — Breakpoint واحد للهيكل (1023) وتفاصيل (600/560).
- تعديلات موجودة: App.tsx، Modal.tsx، index.html، والـ13 صفحة/الحوارات حسب جدول §6.

---

## 7. Definition of Done وخطوات QA

### 7.1 قائمة التحقق القابلة للاختبار (من docs/17 §4 مع تفصيل)
- [ ] لا يوجد horizontal overflow حقيقي: document.documentElement.scrollWidth == window.innerWidth عند 360/390/414 لكل صفحة (تُقاس بعد فتح كل حوار وبعد التحميل الكامل).
- [ ] التنقل: Drawer + Bottom Nav؛ 11 قسمًا قابلة للوصول؛ aria-current؛ يعمل بالكيبورد (Tab/Escape) وباللمس؛ مثبت أثناء التمرير؛ تسجيل الخروج متاح دائمًا.
- [ ] الجداول: كل جدول تشغيلي يتحول لكروت <768px بمعلومة الصف كاملة وإجراء رئيسي واضح؛ الاستثناءات (audit) أفقية مع sticky أول عمود + رأس + مؤشر.
- [ ] الحوارات: Bottom Sheet على ≤768؛ إجراءات sticky؛ الحقل النشط مرئي مع لوحة المفاتيح؛ Escape؛ قفل تمرير الخلفية؛ لا يتجاوز 100dvh.
- [ ] اللمس: كل عنصر تفاعلي ≥44×44 على ≤1023 (يُقاس getBoundingClientRect).
- [ ] الخطوط: body/جداول ≥14، ثانوي ≥12 على ≤1023؛ لا نص 9–11px في مسارات الموبايل.
- [ ] التباين: كل النصوص ≥4.5:1 في الثيمين (مع أخذ الحالات/disabled في الاعتبار).
- [ ] RTL/LTR: الهواتف/الأكواد/المراجع/التواريخ/الشهر لا تنقلب؛ dir وunicode-bidi موثقان.
- [ ] الحالات: loading skeleton / empty / error retry / long text / 0 و1 و1000 صف لكل صفحة.
- [ ] reduced-motion وfocus-visible يعملان في كل الشاشات.
- [ ] window.confirm = 0 في مسارات الإدارة (أو مبرر موثق لكل حالة).
- [ ] build: npm run build --prefix frontend يمر؛ npm test --prefix frontend يمر؛ لا أخطاء console جديدة.
- [ ] الوثائق: checkpoint 2.4 + تحديث docs/14 (تنفيذ) + تحديث docs/17 (حالة 2.4).

### 7.2 خطوات QA اليدوية
1. **الأجهزة/المتصفحات:** iPhone Safari (390×844)، Android Chrome (360×800 و412×915)، iPad 768×1024 عمودي/أفقي، لابتوب 1024×768، سطح مكتب 1440×1000.
2. **لكل صفحة:** افتح → انتظر التحميل → لقطة → تحقق من: التنقل، أول جدول، فتح حوار رئيسي، حفظ، حالة خطأ (قطع الشبكة أو حساب بلا صلاحية)، حالة فارغة.
3. **الحوارات القياسية:** roster حضور طلاب، ملف طالب، ملف معلمة، تفاصيل حلقة، مستخدم/صلاحيات، دفع، استحقاق، تقرير محفوظ، تذكيرات، تأكيد حذف/تصفير.
4. **اللوحة المفاتيح:** على iOS/أندرويد، ركّز آخر حقل في نموذج طويل وتأكد أن زر الحفظ مرئي وأن الصفحة لا تتحرك بشكل غريب.
5. **التمرير:** أثناء Bottom Nav/Drawer مفتوحين جرّب تمرير المحتوى خلفهما (يجب أن يكون مقفولًا).
6. **الوضع الفاتح/الداكن** لكل صفحة.
7. **RTL/LTR:** أدخل هاتفًا وكودًا وتاريخًا وتحقق من عدم انقلاب الأرقام.
8. **الشبكة البطيئة:** 4G/3G simulated — تحقق من Skeletons وعدم وميض.

### 7.3 اللقطات المطلوبة (إلزامية في الـcheckpoint)
- 390×844 و1440×1000 لكل صفحة من الـ11 (22 لقطة أساسية).
- إضافية: Drawer مفتوح، Bottom Nav، شيت «المزيد»، Bottom Sheet لحوار (roster/مستخدم)، حالة Error، حالة Empty، لوحة المفاتيح مفتوحة على نموذج.
- (لاحقًا في 2.5) Playwright visual regression + axe.

### 7.4 البوابة قبل الدفع
dotnet build Dar.slnx + dotnet test Dar.slnx + npm run build --prefix frontend + npm test --prefix frontend، ثم commit + checkpoint. لا خلط بين 2.4 وميزات أخرى.

---

## 8. حالة بوابة المعلمة والمشرفة (للاتساق فقط)

| البوابة | التجاوب الحالي | ما نأخذه منها | فجوات متبقية (خارج نطاق 2.4 لكن تُذكر) |
|---|---|---|---|
| المعلمة /teacher | shell مثبت (teacher.css:2-16) + أزرار 44 (45-51) + أزرار min-height 46 (54-63) + Bottom Nav 58px مع safe-area (200-208) + PC sidebar ≥1024 (214-232) + تدرج 380px (295-300) | Bottom Nav/الشريط العلوي/الأزرار الكبيرة | تسميات 8–9px في nav/footnotes؛ sheet 92vh بلا dvh؛ 6 عناصر في Bottom Nav (مقبول حسب checkpoint) |
| المشرفة /supervisor | mobile shell ≤1023: إخفاء sidebar + Bottom Nav مثبت 5 عناصر + safe-area (supervisor.css:252-280)، جداول→كروت (266-267)، drawers/sheets مع safe-area (201-202,237)، KPI متجاوبة (247-250,282-286)، مرور قراءة 289+ | Bottom Nav + «المزيد» sheet + Card lists + Drawers + Safe-area + segment buttons | badges 8–9.5px لا تزال صغيرة؛ بعض الجداول تُخفى كليًا ≤1023 (قد تحتاج نسخة كروت لكل جدول) |

**الخلاصة:** الإدارة هي البوابة الوحيدة التي لم تُنفَّذ لها أنماط الموبايل الحديثة؛ التوحيد مع teacher/supervisor يقلل الكود الجديد ويجعل التجربة متسقة.

---

## 9. مخاطر وقرارات مقترحة

### 9.1 قرارات تحتاج تثبيتًا قبل التنفيذ (بدون اختراع قواعد عمل)
1. **نقطة تحوّل الهيكل:** 1023 (مطابقة teacher/supervisor) بدل 760 الحالية — التوصية: 1023 للهيكل، و600/560 للتفاصيل.
2. **نمط التنقل:** Bottom Nav 5 + «المزيد» sheet + Drawer للحساب/الأقسام الإضافية (متوافق مع docs/14:109). بديل: Drawer فقط — أقل كفاءة في الاستخدام اليومي.
3. **حدود الجداول:** كروت لكل جداول التشغيل على ≤767، وتمرير أفقي فقط لـ audit/diff والتقارير (docs/14:155).
4. **الخطوط:** أساسي 14 وثانوي 12 على الموبايل، والجداول 12 (لا 11).
5. **ألوان الثيم الفاتح:** تعديل --muted/--accent قد يمس teacher/supervisor والتقارير — يحتاج فحصًا بصريًا موثقًا قبل الدمج.
6. **حدود النطاق:** هل نُدخل إزالة بقايا desktop (App.tsx:68 + services/desktop*Bridge) في 2.4 أم في 2.7؟ التوصية: مع 2.4-a1 لأنها تمس shell الموبايل.

### 9.2 مخاطر التنفيذ
- **تغيير tokens/الخطوط عالمي:** يؤثر على بوابة المعلمة/المشرفة/مستند التقارير؛ يجب فحص شامل + لقطات.
- **تحويل الجداول لكروت:** خطر فقدان أعمدة حساسة للصلاحيات المالية (الإخفاء يجب أن يبقى شرطيًا كما هو الآن في PaymentsPage/StudentsPage).
- **Bottom Nav + صلاحيات:** يجب بناء العناصر من visiblePages لا من قائمة ثابتة، وإلا يظهر قسم ممنوع للبعض.
- **الاختبار البصري غير متاح في هذه البيئة:** build الأمامي محجوب حاليًا في sandbox (esbuild EPERM)؛ يجب تنفيذ QA على جهاز/CI غير مقيّد.
- **تعارض مع 2.3 Reverse/Void:** أزرار «حذف الاستحقاق» ستتغير؛ يجب ترتيب المرحلتين أو الفصل في نفس الصفحة (تجنب merge متعارض في PaymentsPage/StudentHistoryDialog).
- **الأداء:** تحويل 1000 صف إلى كروت قد يزيد DOM؛ يُفضّل pagination/عرض المزيد قبل/مع التحويل.

### 9.3 ما لم يُفحص في هذا التقرير (حدود)
- الصفحة العامة / (خارج نطاق لوحة الإدارة) — يمكن تدقيقها لاحقًا.
- بوابة المعلمة/المشرفة بتفصيل كامل (مرجع اتساق فقط).
- التقرير PDF المولّد (مستند مستقل) وتجربة الطباعة الفعلية.
- أي سلوك Backend/API؛ التقرير واجهة بحتة.
- التحقق البصري الفعلي على أجهزة حقيقية.

---

## 10. ملحق: أرقام وأدلة سريعة

| المقياس | القيمة | المصدر |
|---|---|---|
| صفحات الإدارة | 11 قسمًا (13 ملف صفحة شاملة Auth/Connection) | navigation.ts:4-16؛ App.tsx:74-93 |
| حوارات | 16 حوارًا + سجل ApplicationDialogs + 3 حوارات داخلية (تصفير/audit/تذكيرات) | components/dialogs؛ SystemAdminView:334-342؛ PersonalReminderCenter:44 |
| جداول مشغّلة | 19 سطح جدول (20 مع جدول ملاحظات المعلمات) | §4-P0-2 |
| قيم breakpoints في CSS الإدارة | 18 قيمة + reduced-motion | §2.1 |
| min-widths | 800/820/900/980/1040/1080/1120 | students.css:39؛ administration.css:26؛ schedule-attendance.css:99,156,169-171؛ finance.css:37 |
| استخدامات small-icon-button | 25 | grep في frontend/src |
| usages window.confirm | 16 | §P1-8 |
| تصريحات font-size ≤11px في styles | 160+ | §P1-2 |
| تباين فاتح | muted 3.84/4.20، accent 4.00 | foundation.css:2-3 + حساب WCAG |
| حجم الحزم الحالي | JS 765KB / CSS 108KB (dist) | frontend/dist |

**قائمة الملفات الأساسية للمراجعة مع المطوّر:** App.tsx، Modal.tsx، ApplicationDialogs.tsx، StudentAttendanceDialog.tsx، UserDialog.tsx، CircleDetailsDialog.tsx، StudentsPage.tsx، PaymentsPage.tsx، SchedulePage.tsx، UsersPage.tsx، SystemAdminView.tsx، styles/foundation.css، styles/students.css، styles/administration.css، styles/schedule-attendance.css، styles/system-admin.css، styles/admin-insights.css، styles/desktop-preferences.css، styles/finance.css، styles/management-reports.css.
