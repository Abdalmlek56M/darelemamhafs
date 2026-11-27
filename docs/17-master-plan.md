# RIGX Dar — Master Plan (Approved) — Plan Index

**Approved:** 22 Nov 2026 — المالك اعتمد القرارات وترتيب المراحل نهائيًا.
**Status:** Active — **هذا الملف هو فهرس الخطة الوحيد**: ترتيب المراحل المعتمد + القرارات المثبتة + روابط.
**Role:** لا يُدار هنا عدّاد تقدّم ولا عدّاد ملفات/اختبارات. الحالة لكل بند في `docs/00-current-state.md` وسجل التنفيذ `docs/OVERNIGHT-REPORT.md`، وتفاصيل التحصين في `docs/23-hardening-plan.md`.
**Rule:** لا تبدأ مرحلة قبل اعتماد التي قبلها (checkpoint مكتوب + build/tests + commit). أي تعديل على الترتيب أو القرارات يحتاج موافقة المالك + تحديث هذا الملف + ADR عند الحاجة.

> 🔧 **مسار التحصين (24–27 Nov 2026):** المالك طلب دفعة أمان/جودة/قابلية توسع قبل استئناف 2.x. خطة البنود وتفاصيلها في `docs/23-hardening-plan.md`، وسجل الحالة/الأدلة/NOT VERIFIED الوحيد في `docs/OVERNIGHT-REPORT.md`؛ ما اكتمل منها لا يُعيد فتح مراحل أدناه، والباقي مذكور في التقرير (REMAINING/BLOCKED).

---

## 0. Plan map — which document owns what

| Topic | Single source | This file's role |
|---|---|---|
| الحالة الآن + أرقام المستودع (migrations/مصادر) + آخر نشر | `docs/00-current-state.md` (+ `README.md` للعدّ) | يشير فقط — لا يكرر الأرقام |
| ترتيب المراحل المعتمد + القرارات D1–D9 | **هذا الملف** | ملكية كاملة |
| تفاصيل التحصين (Tier 0/1/2 + Z، وبنود P/Q/S) | `docs/23-hardening-plan.md` | يرسل إليه، لا يكرر بنوده |
| حالة كل بند تحصين + الأدلة + NOT VERIFIED | `docs/OVERNIGHT-REPORT.md` | يرسل إليه، لا يكرر الحالة |
| القرارات المعمارية الملزمة + القرارات بلا ADR | `docs/adr/` (الفهرس: `docs/adr/README.md`) | يرسل إليه |
| سجل كل خطوة منجزة | `docs/checkpoints/` | يرسل إليه |
| Naming (repo/deploy/database) | `docs/naming.md` | يرسل إليه |

**قاعدة العدّادات:** عدد الترحيلات الحقيقي = `database/*.sql`، ويُذكر فقط في `README.md` و`docs/00-current-state.md` (يفشل CI عند أي اختلاف: `tests/regression/docs-migration-count/run.mjs`). أعداد الاختبارات/الـsuites تُذكر في `docs/OVERNIGHT-REPORT.md` فقط. لا تُكرَّر هذه الأرقام في هذا الملف أو في `docs/23`.


> المرجع السريع للحالة: `docs/00-current-state.md`. التفاصيل التاريخية: `docs/07-gap-audit.md` و`docs/10-code-review.md` (سجلات، ليست مهامًا).
>
> ⏸️ **المسار 2.x موقوف مؤقتًا (22 Nov 2026):** بناءً على طلب المالك لإضافة مميزات جديدة. الحالة المحفوظة في `docs/00-current-state.md` §12 + checkpoint `docs/checkpoints/2.2fix-2.4b-2.5a-1.0.md`. الاستئناف من 2.4-c ثم 2.5-b ثم 2.6.
>
> ✅ **Phase 3.0 (Meet Recording) مُعتمدة:** المالك اعتمد القرارات السبعة (docs/18 §9) وطلب تنفيذ **3.0 + 3.1** فورًا. نُفّذتا (ADR-0006/0007 + migration 026 + تقويم Google + واجهة الأحداث ونطاق التسجيل) — checkpoint `docs/checkpoints/3.0-3.1-meet-calendar-1.0.md`. **التوقف قبل 3.2 (بوت التسجيل) لمراجعة المالك.**

---

## 1. القرارات المثبتة (Locked Decisions)

| # | القرار | المرجع |
|---|---|---|
| D1 | الواجهة نهائيًا **React 19 + Vite + TypeScript**. إلغاء Next.js نهائيًا. تحسينات التصميم لاحقًا على نفس الواجهة. | ADR-0001 |
| D2 | استحقاق الطالبة = **السعر المتفق والمسجّل** (`agreed_monthly_fee`). **لا pro-rata** ولا تقريب لأقرب 5 جنيه. | ADR-0002 |
| D3 | أجر المعلمة **بالدقيقة** وبدون تقريب 5 دقائق/5 جنيه؛ المبلغ منزلتان AwayFromZero. | ADR-0002 |
| D4 | **الإنجليزية مؤجلة** — العربية فقط الآن. | ADR-0004 |
| D5 | **الخزنة**: إيرادات + مصروفات + تقفيل الشهر. **القيد المزدوج مؤجل** لمرحلة متقدمة. | ADR-0003 |
| D6 | **Reverse/Void** بدل أي حذف مالي — سبب إلزامي + Audit + السجل يبقى ظاهرًا. | ADR-0005 |
| D7 | **تجاوب 100% للوحة الإدارة على الموبايل** أولوية واجهة معتمدة. | Phase 2.4 |
| D8 | الفريق يعمل بمرحلة واحدة في كل مرة، وكل مرحلة = build/tests + docs + checkpoint + commit. | deepseek.md |
| D9 | **كوكي الأدمن نحيف:** الصلاحيات تُقرأ من `user_permissions` في كل طلب، والـticket يحمل الهوية + `session_version` فقط؛ الـSecure يتبع scheme. | ADR-0008 |

---

## 2. المراحل بالترتيب

| # | المرحلة | الحالة | معيار الإنجاز |
|---|---|---|---|
| **2.0** | **Docs Reset + تثبيت القرارات** | ✅ مكتملة (22 Nov) | `docs/00` + `docs/17` + تحديث `deepseek` و`docs/01,02,03,04,05,06,07,08,10,11,14,16` + ADRs 0001–0005 + فهرس checkpoints + checkpoint 2.0 |
| **2.1** | **تأمين سكربتات النشر والنسخ الاحتياطي** | ✅ منفّذة — تحتاج rehearsal على host | سكربتات setup idempotent وآمنة + `update.sh` (backup→migrate→swap→smoke→rollback) + `rollback.sh` + `preflight.sh` + backup manifest/SHA-256/verify + healthcheck + systemd + `bash -n` + docs/11 |
| **2.2** | **التحقق 100% من منع تداخل مواعيد المعلمات** | ✅ مكتملة — 45/45 PASS + تحصين 025 (17/17) | تقرير audit + سيناريوهات Postgres (تعارض/تجاور/منتصف الليل/الأسبوع/غير نشط/exclude/race/preflight) + اختبارات SQL + إصلاح أي ثغرة |
| **2.3** | **Reverse/Void للسجلات المالية** | ✅ منفّذة (22 Nov) — migration 024 + finance.void + SQL verify 23/23 | Migration + endpoints (void charge/payment بسبب) + audit + منع purge/trash المالي + إظهار السجل ملغيًا في الواجهات/التقارير + tests |
| **2.4** | **لوحة الإدارة متجاوبة 100% على الموبايل** | 🟡 2.4-a ✅ (shell/تنقل/Modal/CSS leak) + 2.4-b ✅ (16 جدولًا→كروت، ConfirmSheet، MonthPicker، 44px/خطوط/تباين) + مراجعة UI نهائية (1.40) — 2.4-c (طباعة/RTL/SystemAdminView/QA نهائي) متبقية | تنفيذ خطة `docs/audits/admin-mobile-responsive-audit.md`: shell/تنقل، جداول→كروت، حوارات→sheets، فلاتر/نماذج، أزرار 44px، خطوط، RTL، لا overflow أفقي + QA 390/1440 لكل صفحة |
| **2.5** | **CI/CD + Contract + Test Baseline** | 🟡 2.5-a ✅ (typecheck/Vite proxy/CI asserts+SQL regression/schema drift/meet-recorder job) — 2.5-b (contract حقيقي/E2E/deploy/rollback) متبقية | أول GitHub Actions أخضر فعليًا + typecheck/lint scripts + contract test (spec == code) + اختبارات المال في CI + Playwright smoke + نشر آلي/موثّق يستخدم `update.sh` |
| **2.6** | **الخزنة والإيرادات وتقفيل الشهر** | ⬜ | حركات دخل/مصروف بالتصنيفات + تقفيل شهري مقفل (لا تعديل بعد التقفيل بدون فتح بسبب + audit) + تقارير الخزنة |
| **2.7** | **سبرنت الأمان والتشغيل** | 🟡 جزئي — per-account lockout ✅ (migration 029) + security headers/CSP/HSTS للـSPA ✅؛ متبقٍ: antiforgery token، تقييد origin بـCloudflare، rotation (rclone/Cloudflare)، monitoring/تنبيهات | lockout + antiforgery token + HSTS/CSP + تقييد origin بـCloudflare + إزالة بقايا desktop + إخفاء الإصدار + rotation (rclone/Cloudflare) + monitoring |
| **2.8** | **التنظيف وإعادة الهيكلة** | 🟡 جزئي — Z1 splits ✅ (الملفات >400 قُسّمت: Auth/SystemAdmin/Requests/TeacherApp/teacherTypes/useDarApplication/Meet repositories) + `desktop-host`/`tools`/`tests/runners`/`tests/catalog.json` أُزيلت + Vite dev proxy ✅؛ متبقٍ: `.opencode` خارج الريبو + SystemAdminView 401 | الملفات >400 تُقسّم + إزالة `desktop-host`/`tools`/`tests/runners`/`.vbs` + إخراج `.opencode` من الريبو + إصلاح Vite dev proxy + npm scripts |
| **2.9** | **جودة الإطلاق** | ⬜ | E2E Playwright + restore drill آلي + load/pen test + مراجعة PDF الرسمية + دليل التسليم والتدريب |
| **3.0** | **Meet — المتطلبات المسبقة + ADRs** | ✅ منفّذة (22 Nov) — ما عدا أعمال host (حزم السيرفر/بروفايل Playwright/rclone OAuth) | ADR-0006 (جسر الجلسة) + ADR-0007 (المعمارية) + توحيد حلقة مفاتيح Data Protection في الـAPIين + كتالوج الصلاحيات في المصادر الأربعة |
| **3.1** | **Meet — Calendar + Events UI** | ✅ منفّذة (22 Nov) — تحتاج تحقق OAuth حقيقي على السيرفر | migration 026 + OAuth offline + مزامنة incremental/full + قائمة أحداث + اقتراح وربط الحلقة + نطاق التسجيل + اختبارات وحدة |
| **3.2** | **Meet — بوت التسجيل + self-test** | ✅ منفّذة (22 Nov) — البوت يعمل كخدمة معزولة وينتج MP4+HLS | طابور claim/heartbeat + state machine + Xvfb/PulseAudio/FFmpeg + self-test 30s (513KB MP4، 7 مقاطع HLS) |
| **3.3** | **Meet — الانضمام والتسجيل الحقيقي** | ✅ منفّذة (23 Nov) — البوت يدخل كمضيف ويسجّل المكالمة كاملة | دخول Google مرة واحدة + join + live + capture + finalize + session/media في DB (176s، 7.79MB، 22 مقطع) |
| **3.3b** | **Meet — وضع تسجيل صوتي فقط (خفيف)** | ✅ منفّذ ومنشور (23 Nov 13:19 UTC) | `BOT_RECORD_MODE=audio`: parecord فقط + تحويل AAC/MP4 بعد الحصة؛ لا HLS/poster/بث حي؛ selftest 15.2s OK؛ الحصص القادمة audio-only |
| **3.4–3.7** | **Meet — الرفع والحذف المحمي والبث والمشغل والنشر** | ⏸️ مؤجلة مرحليًا | Drive + ضغطتان للحذف + MediaMTX/SSE + مشغل + أمان + QA + نشر — يُعاد تقييمها بعد قرار Phase 3.8 |
| **3.8** | **منصة اجتماعات داخلية (LiveKit) — Spike/Pilot** | 📝 **مقترحة — بانتظار موافقة المالك** | تحليل + مقارنة + خطة M0–M5 + قرارات مطلوبة في `docs/22-inhouse-meetings-design.md` (الجزء الثاني). البوت يبقى احتياطيًا أثناء التجربة |
| **3.9+** | **مؤجل بقرار المالك** | ⏸️ | الإنجليزية (i18n)، القيد المزدوج الكامل، مسير/قسائم الرواتب الكامل، خصومات/خطط رسوم، إيصالات مرقّمة، بوابة ولي الأمر — كل واحد يحتاج قرارًا مستقلًا قبل البدء |

---

## 3. تفاصيل المراحل الجارية (2.0 / 2.1 / 2.2)

### 2.0 Docs Reset
- `docs/00-current-state.md` = الحالة الواحدة.
- `docs/17-master-plan.md` = هذه الخطة.
- تحديث `deepseek.md` (القراءة الأولى، الحالة، القرارات، الأوامر).
- تحديث الوثائق المتعارضة: 01/02/03/04/05/06/07/08/10/11/14/16 + README + فهرس checkpoints.
- ADRs: 0001 واجهة React+Vite، 0002 السياسة المالية، 0003 نطاق الخزنة، 0004 الإنجليزية مؤجلة، 0005 Reverse/Void.
- Checkpoint: `docs/checkpoints/2.0-docs-reset-1.0.md`.

### 2.1 Deploy & Backup Safety
- `deploy/bootstrap-server.sh` — إنشاء مستخدم `dar` ومجلداته بشكل idempotent.
- `deploy/setup-host-db.sh` — ممنوع استرجاع فوق قاعدة حيّة بدون نسخة + `--confirm-restore` + قاعدة استرجاع مؤقتة ثم تبديل.
- `deploy/setup-host-services.sh` — نسخ احتياطي للـenv/systemd قبل الكتابة + صلاحيات 640 + فحص صحة.
- `deploy/setup-nginx.sh` — نسخة مطابقة لملف Nginx الحي (buffers/timeouts/12m) + security headers + Certbot block.
- `deploy/update.sh` — **backup إلزامي → pull → build/publish → migrate → swap → smoke → rollback تلقائي للـbinaries** + logs + retention.
- `deploy/rollback.sh` — إرجاع الـbinaries فقط، بدون لمس DB.
- `deploy/preflight.sh` — فحوصات قبل أي تحديث.
- `deploy/scripts/dar-backup.sh` — manifest JSON + SHA-256 + `pg_restore --list` + التحقق من النسخة البعيدة + lock.
- `deploy/scripts/dar-healthcheck.sh` + `dar-healthcheck.timer` — مراقبة: خدمات + health + disk + عمر النسخة + الشهادة.

### 2.2 Schedule Overlap
- مصدر المنع: `database/012_teacher_schedule_no_overlap.sql` (دالة `dar_teacher_has_schedule_overlap` + preflight).
- لازم إثبات: تعارض تام/جزئي مرفوض، تجاور تام مسموح، منتصف الليل وحدود الأسبوع بالدائرة، غير النشط/المحذوف لا يشارك، exclude عند التعديل، تغيير معلمة الحلقة، وعدم وجود race يسمح بتداخلين متوازيين.
- المخرجات: `docs/audits/schedule-overlap-audit.md` + `tests/regression/sql/schedule_overlap_verify.sql` (+ اختبار تكامل CI).

---

## 4. المرحلة 2.4 — Definition of Done للتجاوب (ملخص ملزم)

- لا يوجد **horizontal overflow** على 360px لأي صفحة في لوحة الإدارة.
- التنقل: sidebar → drawer على الموبايل + شريط سفلي واضح؛ كل الأقسام قابلة للوصول.
- الجداول: تتحول لكروت أو جدول قابل للتمرير مع رؤوس مثبتة وأعمدة أساسية فقط <768px.
- الحوارات/النماذج: bottom sheets على الموبايل، أزرار أساسية ثابتة في الأسفل، لوحة مفاتيح لا تحجب الحقل النشط.
- كل هدف لمس ≥ 44px؛ الخط الأساسي ≥ 14px والثانوي ≥ 12px.
- RTL/LTR: الهواتف والأكواد والأرقام LTR داخل RTL.
- حالات: loading / empty / error / long text / 0 و1 و1000 صف.
- QA: لقطات 390×844 و1440×1000 لكل صفحة + مراجعة يدوية + (لاحقًا) Playwright.
- المرجع التفصيلي: `docs/audits/admin-mobile-responsive-audit.md` (اكتمل التدقيق 22 Nov 2026 — 398 سطرًا بأدلة path:line).

### 2.4-a — الهيكل والتنقل والـviewport والحوارات (P0)
- إصلاح `foundation.css`: `100vh` → `100dvh`/svh، وbreakpoint موحّد بين لوحة الإدارة وبوابات teacher/supervisor (حاليًا 760 مقابل 1023).
- Mobile shell: Drawer لكل الأقسام الـ11 + Bottom Nav رئيسي + `aria-current`، بدل الشريط الأفقي المخفي.
- `Modal` → bottom sheet على الموبايل مع sticky actions وقفل الخلفية والكيبورد، وحل مشكلة الحوارات 690/1040px و90vh.
- إصلاح تسريب CSS: `t-error-card`/`t-secondary` مستخدمة في 3 صفحات إدارة لكنها معرّفة فقط في `teacher.css` (تُحمّل مع chunk المعلمة) — نقلها للتوكينز العامة.

### 2.4-b — الجداول واللمس والخطوط والنماذج (P1)
- `ResponsiveTable` عام: 19 جدولًا (800–1120px داخل 336px) → كروت على <768px مع أعمدة أساسية، وإظهار scrollbars، ورؤوس مثبتة.
- أهداف لمس ≥44px (حاليًا أزرار 28–31px)، خطوط ≥14 للنص و≥12 للثانوي (حاليًا 10–11px).
- `font-size ≥16px` للحقول لمنع زووم iOS، استبدال `type=month` في 7 مواضع، ودعم `safe-area`/`visualViewport`.
- استبدال 16 `window.confirm` بحوارات accessible؛ تباين ≥4.5:1 (حاليًا 3.84–4.20).

### 2.4-c — الصقل والطباعة
- RTL/LTR للأكواد والهواتف، حالات empty/loading/error/long-text، طباعة A4، حركة محترمة، وتوثيق QA بلقطات 390/1440 لكل صفحة.
- تحقق نهائي: صفر horizontal overflow عند 360px + مراجعة يدوية + Playwright في Phase 2.5.

---

## 5. ضوابط العمل

1. مرحلة واحدة في كل مرة؛ لا خلط ميزات.
2. كل مرحلة: build + tests + docs + checkpoint + commit (push بعد نجاح البوابة).
3. لا أسرار في الكود/الوثائق/اللوجات.
4. المال decimal؛ الحساب على الخادم.
5. لا حذف لتاريخ مالي/حضور — Reverse/Void.
6. الصلاحيات تُفحص على الخادم؛ الصلاحيات المالية تُخفى بالكامل بدون `finance.read`.
7. أي قرار عمل ناقص: توقف واسأل المالك — لا تخترع.
8. قبل أي UI: عيّنة/تقرير تخطيط واعتماد مالك (للواجهات الجديدة).
9. الحالة الموثقة = `docs/00`؛ الخطة = هذا الملف؛ لا تُعدّل أي وثيقة بما يخالفهما.

---

## 6. سجل تحديثات الخطة

| التاريخ | التغيير |
|---|---|
| 22 Nov 2026 | إصدار أول معتمد: قرارات D1–D8 + مراحل 2.0 → 2.9 + المؤجلات. |
| 22 Nov 2026 | إضافة **Phase 3.0** (Meet Recording & Live) كمقترح بانتظار موافقة المالك — docs/18. |
| 22 Nov 2026 | **اعتماد Phase 3.0** بقرارات المالك السبعة (docs/18 §9) وتنفيذ **3.0 + 3.1** (ADR-0006/0007، migration 026، وحدة Meet، واجهة التسجيل). التوقف قبل 3.2 لمراجعة المالك. |
| 27 Nov 2026 | **فصل الأدوار:** هذا الملف صار **فهرس الخطة** (ترتيب + قرارات + روابط)؛ تفاصيل التحصين في `docs/23`، وسجل الحالة/الأدلة في `docs/OVERNIGHT-REPORT.md`، والفهرس الموحّد للقرارات (بما فيها قرارات S-1 بلا ADR) في `docs/adr/README.md`. لا تُكرَّر عدّادات الترحيلات/الاختبارات هنا. |

