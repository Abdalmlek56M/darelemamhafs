# ADR-0001 — الواجهة: React 19 + Vite نهائيًا وإلغاء Next.js

**Status:** Accepted
**Date:** 22 Nov 2026
**Deciders:** Owner + Lead
**Related:** `docs/00-current-state.md`, `docs/02-architecture.md`, `docs/04-engineering-standards.md`, `docs/14-ui-audit-and-mobile-direction.md`, `docs/17-master-plan.md`

## Context

- المشروع بدأ بقرار **Next.js 16 (App Router + BFF)** كهدف مستقبلي، بينما الواجهة الحقيقية القائمة هي **React 19 + Vite SPA**.
- النظام حيّ على host إنتاجي، وكل المسارات (admin, teacher, supervisor, homepage) مبنية داخل نفس الـSPA وتُخدَم من legacy API كملفات ثابتة.
- إعادة الكتابة على Next.js تعني: بنية routes جديدة، BFF/proxy، نقل ~135 ملفًا، إعادة كل اختبارات الواجهة والـPWA والـvisual QA — بتكلفة عالية ومخاطرة على نظام مستخدم يوميًا.
- النظام إداري داخلي لا يحتاج SEO/SSR/RSC؛ نفس الـorigin عبر Nginx يوفّر نفس الفوائد الأمنية (cookies + لا CORS).
- التصميم سيتطور على نفس الواجهة (design tokens/CSS موجودة)، وتجربة الموبايل هي الأولوية القادمة.

## Decision

1. الواجهة النهائية: **React 19 + Vite 6 + TypeScript strict** — SPA واحدة تُبنى إلى `frontend/dist`.
2. **إلغاء Next.js 16 نهائيًا**: لا `apps/web`، لا Server Components، لا BFF، لا nonce-based CSP.
3. التطوير القادم (تجاوب لوحة الإدارة، تحسين التصميم، إضافة صفحات) يتم على `frontend/src/` الحالي.
4. توثيق القرار في `docs/02` §7 + Decisions #27، `docs/04` §3، `docs/06`، و`README.md`.
5. أي اقتراح مستقبلي بواجهة بديلة (Next.js أو غيرها) يحتاج **ADR جديدًا بموافقة المالك** ولا يُنفَّذ ضمن مرحلة عادية.

## Consequences

**إيجابيات:**

- لا إعادة كتابة ولا ازدواج بنية؛ كل التستات والـPWA وطريقة النشر الحالية تبقى صالحة.
- بناء واحد `vite build` يُنشر كملفات ثابتة داخل legacy API — لا خدمة Node إضافية.
- CSP يمكن أن يكون strict (`script-src 'self'`) بدون nonce/SSR.
- فصل `TeacherApp` بـ`lazy()` يبقى أفضل مسار لتخفيف bundle الـadmin.

**سلبيات/مخاطر:**

- لا SSR/SEO (غير مطلوب لنظام إداري).
- التوجيه يدوي في `main.tsx` حسب `location.pathname` — يحتاج انضباطًا عند إضافة مسار جديد.
- `SystemAdminView`/bundle الـadmin كبير (~717KB JS) — يُعالج بتقسيم/lazy loading في Phase 2.5.
- الأنواع مكتوبة يدويًا حتى يُنجَز contract test (Phase 2.5) — مخاطر drift مؤقتة.

## Alternatives

1. **Next.js 16 App Router + BFF** — مرفوض: تكلفة إعادة كتابة كاملة بلا فائدة تشغيلية، ومخاطرة على نظام حيّ.
2. **SPA جديدة من الصفر (Vite/React) ثم ترحيل** — مرفوض: نفس المخاطرة بلا قيمة إضافية.
3. **الاستمرار على SPA الحالية (المختار).**

## References

- `docs/00-current-state.md` §2 — الـStack الحقيقي.
- `docs/02-architecture.md` §7 (Frontend Shape) + Decisions Log #27.
- `docs/04-engineering-standards.md` §3 — React 19 + Vite standards.
- `docs/14-ui-audit-and-mobile-direction.md` — اتجاه التصميم والأولوية المعتمدة.
