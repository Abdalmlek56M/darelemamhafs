# RIGX Dar — UI Audit & Mobile-First Direction

**Status:** audit + direction (16 Nov 2026). No UI implementation before owner approval of a sample.
**Scope:** existing React/Vite admin UI, teacher portal, supervisor views, design system, mobile behavior.

---

## 1. What Exists Today

- **Framework:** React 19 + Vite + TypeScript.
- **Font:** Cairo (Google Fonts import).
- **Theme:** dark/light via `data-theme`; teal `#71d5c0` + periwinkle `#8c9dff` on deep navy.
- **Surfaces:** glass cards (`backdrop-filter`), 18–27px radii, soft shadows.
- **Layout:** fixed 250px sidebar + scrollable main content; max width 1600px.
- **Breakpoints:** 1100px and 760px.
- **Components:** cards, dense tables, modals, toasts, inline forms, icon buttons.
- **Pages:** dashboard, students, teachers, circles, schedule, payments, users, system.
- **CSS:** 11 files, ~94 KB; heavy use of `color-mix`, glass, gradients.
- **Bundle:** ~717 KB JS / 200 KB gzip; no route-level code splitting.

### Strengths to keep

- Clear Arabic RTL layout and Cairo typography.
- Consistent visual identity (navy/teal, glass, rounded cards).
- Good use of cards for dashboard metrics.
- Permission-aware navigation and actions.
- Light/dark themes and reduced-motion support.
- Focus-visible outlines and semantic labels in many forms.

### Real usability problems

1. **Mobile navigation is broken for daily use:** below 760px, `.nav-item` is hidden and only the active item is shown. A teacher/admin cannot switch sections from the phone.
2. **Dense tables are desktop-first:** many tables use 7–10 columns and small icon buttons; on a phone they require horizontal scrolling and precise taps.
3. **Touch targets:** icon buttons are often 24–34px; below the 44px mobile guideline.
4. **`window.confirm`** is used for destructive actions; it is ugly on mobile and cannot show rich context.
5. **Toasts disappear:** notifications are not persistent, not filterable, and not role-aware.
6. **Desktop clutter:** auto-start, connection check/settings, “local device” wording — removed in the current build; keep them out of the web UI.
7. **No PWA:** no manifest, install prompt, offline shell, safe-area handling, or splash experience.
8. **No teacher route:** teachers have no account or dedicated home.
9. **Mixed density:** some pages are roomy, others are extremely dense (schedule/collections); no shared spacing scale.
10. **No empty/loading skeletons** for several tables; refresh flashes.
11. **Google Fonts dependency** adds a third-party request; self-host Cairo for reliability/privacy.
12. **Large single bundle**; teacher portal should be a small, fast entry.

---

## 2. Design Direction

Keep the brand, rebuild the interaction model:

- **Teacher portal:** dedicated mobile-first PWA at `/teacher`.
- **Supervisor:** mobile-first board + desktop table view.
- **Admin/secretariat:** desktop-first but fully responsive; sidebar becomes a drawer/bottom nav on phones.
- **No separate visual language:** same Cairo, navy/teal palette, rounded cards, but a calmer, more practical density.

### 2.1 Tokens

| Token | Value |
|---|---|
| Spacing | 4, 8, 12, 16, 24, 32, 48 |
| Radius | 12 (controls), 16 (cards), 22 (sheets), full for pills |
| Touch target | min 44×44px |
| Type scale | 12 / 14 / 16 / 20 / 24 / 30 |
| Motion | 150–220ms, ease-out; respect `prefers-reduced-motion` |
| Focus | 2px accent outline, 2px offset |
| Safe area | `env(safe-area-inset-*)` on fixed bars |

### 2.2 Mobile navigation

- **Teacher:** bottom nav (5 items): اليوم / الحلقات / الحضور / التنبيهات / حسابي.
- **Admin/supervisor:** bottom nav or a “المزيد” sheet; sidebar opens as a drawer.
- Sticky top bar: page title + session/status + notification bell.
- Active tab: accent icon + label; badge for unread notifications.

### 2.3 Content patterns

- **Cards over tables** on phones; each row becomes a card with a clear primary action.
- **Bottom sheets** for filters, rosters, confirmation, and quick actions.
- **Segmented controls** for status filters (الكل / حاضر / غائب).
- **One primary action per screen**; secondary actions in an overflow menu.
- **Empty states** with a clear next action.
- **Skeleton loading** instead of blank tables.
- **Persistent inline errors** for forms; toast only for success/background events.

### 2.4 Teacher portal screens (sample scope)

1. **اليوم**
   - “الحلقة الآن” hero card with live timer and primary action.
   - “القادمة” card with countdown.
   - Timeline of the day.
2. **الحلقة جارية**
   - Circle name, start time, live elapsed timer.
   - Student count and quick roster preview.
   - Primary **إنهاء الحلقة**.
3. **حضور الطلاب**
   - Search + “الكل حاضر” / “الكل غائب”.
   - Student rows with large present/absent toggles and optional note.
   - Sticky submit bar showing counts.
4. **تم التسجيل**
   - Summary: duration, present/absent, session earnings, month-to-date.
5. **التنبيهات**
   - Grouped by day, filter chips, unread badge, mark-all-read.
6. **حسابي**
   - Name, circles, this month’s hours/earnings, logout, install app.

### 2.5 Supervisor screens

- Live board: “الآن” sessions, “لم تسجل”, “بدأت متأخرًا”.
- Absent today by circle; unpaid by month; drill-down.
- Correction sheet with mandatory reason.

### 2.6 Admin responsive behavior

- Keep the sidebar on ≥1100px.
- 760–1100px: collapsible sidebar, 2-column cards.
- <760px: drawer/bottom nav, card lists, sticky primary action, bottom sheets.
- Tables: card layout on phones; horizontal scroll only for audit/diff views.

---

## 3. What to Change in the Existing UI Now

| Item | Decision |
|---|---|
| Auto-start toggle | Remove from web UI (done). |
| Connection check / settings | Remove from web UI (done). |
| Desktop-only wording | Remove from web UI. |
| Mobile nav | Replace hidden nav with drawer/bottom nav. |
| `window.confirm` | Replace with a bottom sheet/dialog. |
| Dense tables | Add mobile card variants. |
| Notifications | Build the persistent center; remove ad-hoc toasts for important events. |
| Fonts | Self-host Cairo. |
| Bundle | Route-level code splitting, especially teacher portal. |
| PWA | Add manifest, icons, offline shell, install prompt. |

---

## 4. Standards for Future UI Work

1. **Mobile-first:** design the 360–430px view first, then scale up.
2. **One primary action** per screen; everything else is secondary.
3. **44px touch targets**; no hover-only affordances.
4. **RTL first:** logical properties, `dir="rtl"`, Arabic labels, numbers localized.
5. **No dead ends:** every empty state has a next action.
6. **No silent failures:** inline error + retry.
7. **Consistent feedback:** skeleton → content → toast/badge.
8. **Accessibility:** labels, focus order, contrast, reduced motion, screen-reader names.
9. **Performance:** teacher route < 200KB initial JS; lazy-load admin charts/tables.
10. **Sample gate:** static sample (teacher home, live session, roster) before implementation.

---

## 5. Recommended Product Choices

1. **Dedicated teacher PWA** rather than shrinking the admin console.
2. **Bottom nav** for teacher; **drawer + bottom nav** for admin on phones.
3. **Card-first** teacher screens; keep tables for admin desktop.
4. **Persistent notification center** with categories, read state, quiet hours, and dedupe.
5. **Supervisor live board** as the operational hub for absences/unpaid follow-up.
6. **Keep the current brand** (Cairo, navy/teal, rounded glass) but reduce glass/noise on mobile for readability and performance.

---

## 6. Next Design Step

Produce a **static visual sample** (no production wiring) covering:

1. Teacher home with “الحلقة الآن”.
2. Live session screen with timer.
3. Student attendance roster with sticky submit.
4. Notifications center.
5. Supervisor live/absent/unpaid board.

The owner approves or requests changes before any UI implementation.

---

## 7. Supervision + Admin UI Expansion (16 Nov 2026)

The owner approved a full supervision/secretary workspace and an admin UI overhaul. See `docs/16-supervision-workspace-plan.md` for the permission matrix, scope, phases and commands.

UI additions:

- Supervisor/secretary tabs: overview, students, circles, teachers, attendance, requests, notifications, WhatsApp, reports.
- Teacher detail: attendance rate, hours, overtime/undertime, notes, session history.
- Student profile: attendance, subscription status (permission-gated), notes, guardian/WhatsApp.
- Financial surfaces are **removed**, not zeroed, when the permission is off.
- Admin: responsive sidebar + mobile bottom nav; Users page shows teacher link, lock, scope and permission bundles; notifications page; reports; backup/system health.
- Teacher: weekly calendar, history, previous login sessions, requests, offline queue.
- Remove the `v0.8.25.0` label from the UI.
- Replace hidden-only-active mobile nav with a full, touch-friendly navigation.

Phase A1 starts with financial visibility gating, self-password permission, no-early-start, version removal, clearer notes and teacher login memory.
