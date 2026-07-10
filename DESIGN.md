# Greenville Disc Golf Club Design System

## 1. Atmosphere & Identity

Greenville Disc Golf Club should feel local, energetic, outdoors-focused, and easy to scan on a phone before or after a round. The signature is a high-contrast orange and blue sport palette over light/dark surfaces with forest imagery, condensed display headings, and compact event cards.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Accent/primary | `--primary` | `#FF6B35` | `#FF6B35` | CTAs, links, active states, date badges |
| Accent/secondary | `--secondary` | `#004E89` | `#004E89` | Gradients, supporting actions |
| Accent/warm | `--accent` | `#F7B801` | `#F7B801` | Price and highlight details |
| Accent/green | `--green` | `#2D5016` | `#2D5016` | Club/nature gradient accents |
| Score/conflict | `--over` | `#C8472E` | `#FF7A5C` | Over-par labels, scoring conflicts, blocking error states |
| Score/conflict soft | `--over-soft` | `rgba(200, 71, 46, 0.10)` | `rgba(255, 122, 92, 0.16)` | Conflict row and cell backgrounds |
| Surface/primary | `--bg-primary` | `#F4F4F9` | `#0F0F1E` | Page background, nested card surfaces |
| Surface/secondary | `--bg-secondary` | `#FFFFFF` | `#1A1A2E` | Main section panels and modals |
| Surface/tertiary | `--bg-tertiary` | `#F4F4F9` | `#252538` | Metadata strips and inset panels |
| Text/primary | `--text-primary` | `#1A1A2E` | `#F4F4F9` | Headings and primary labels |
| Text/secondary | `--text-secondary` | `#333333` | `#E0E0E0` | Body copy |
| Text/tertiary | `--text-tertiary` | `#555555` | `#C0C0C0` | Supporting metadata |
| Text/muted | `--text-muted` | `#666666` | `#A0A0A0` | Captions, empty states |
| Border/default | `--border-color` | `#E2E2EA` | `#2A2A3E` | Cards, dividers, outlines |
| Shadow/default | `--card-shadow` | `rgba(0, 0, 0, 0.1)` | `rgba(0, 0, 0, 0.3)` | Section and card elevation |
| Shadow/hover | `--card-shadow-hover` | `rgba(0, 0, 0, 0.15)` | `rgba(0, 0, 0, 0.5)` | Hover elevation |

### Rules

- Prefer existing CSS variables over raw colors.
- New semantic colors must be added here before use.
- Gradients combine `--primary`, `--secondary`, and `--green` only when the element is a major CTA, badge, or sport-themed feature.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Hero display | `clamp(2.5rem, 8vw, 5rem)` | 400 | 1.1 | `0.05em` | Hero title |
| Section display | `clamp(2rem, 6vw, 3.5rem)` | 400 | 1.1-1.2 | `0.05em` | Section titles |
| Slide title | `clamp(1.8rem, 4vw, 2.8rem)` | 400 | 1.2 | `0.03em` | Carousel and panel headings |
| Card title | `1.2rem-1.6rem` | 400 | 1.2-1.3 | `0.02em-0.03em` | Event, course, and contact cards |
| Body | `1rem` | 400 | 1.6 | `0` | Default copy |
| Body/sm | `0.85rem-0.95rem` | 400-600 | 1.4-1.5 | `0` | Metadata and subtitles |
| Caption | `0.65rem-0.8rem` | 600-700 | 1.2-1.4 | `0.03em-0.05em` | Badges and date labels |

### Font Stack

- Display: `Bebas Neue, sans-serif`
- Body: `Archivo, system-ui, -apple-system, sans-serif`

### Rules

- Use `Bebas Neue` for headlines, date numbers, and compact card labels.
- Body text stays in `Archivo`.
- Avoid negative letter spacing; the current system uses neutral or positive tracking.

## 4. Spacing & Layout

### Base Unit

Spacing follows a 4px base through rem values.

| Token | Value | Usage |
|-------|-------|-------|
| Tight | `0.25rem-0.5rem` | Inline metadata, icon-to-text gaps |
| Compact | `0.75rem-1rem` | Small controls and card internals |
| Standard | `1.25rem-1.5rem` | Event/card padding |
| Comfortable | `2rem` | Section internals and modals |
| Section | `clamp(2rem, 6vw, 4rem)` | Major content sections |
| Page max | `1200px` | Main content width |

### Grid

- Mobile: single-column stacks.
- Tablet/Desktop: responsive grids with `minmax(250px, 1fr)` or `minmax(300px, 1fr)`.
- Main sections are constrained to about `1200px` and centered.

### Rules

- Keep cards and controls stable across hover states; transforms must not alter layout flow.
- On mobile, preserve single-column event and tournament lists with no horizontal scrolling.

## 5. Components

### Event Item

- Structure: date badge, text content, optional link wrapper.
- Variants: linked, TBD, hidden-extra.
- Spacing: `1.5rem` gap and padding on desktop, tighter on mobile.
- States: hover translates slightly and changes surface/elevation; linked cards use `has-link`.
- Accessibility: linked events are real anchors with safe external URLs.
- Motion: transform and opacity only.

### Home Feed Panels

- Structure: homepage events and Area Tournaments render from the `home-app` React bundle into `homeReactEventsApp` and `homeReactTournamentsApp`; feed parsing lives in `src/shared/home-feed-parse.js`.
- Variants: loading, ready, empty, error, collapsed mobile list, expanded mobile list, local Ryder Cup links, safe external links, and no-link rows.
- Spacing: reuses `.event-list`, `.event-item`, `.tournament-list`, `.tournament-item`, `.event-toggle`, and `.tournament-toggle` primitives so the public homepage rhythm remains unchanged.
- States: React owns fetch status, loading/empty/error rendering, sorting/filtering display state, show-all toggles, hidden-mobile row classes, and footer link rendering; static loading fallback nodes must be absent from `index.html`, and no DOM renderer may mutate `eventList`, `tournament-list`, or toggle button text.
- Accessibility: loading states expose status text; linked rows are anchors, unlinked rows are non-interactive blocks, toggle controls are real buttons, and location/chevron iconography uses Lucide SVGs.
- Motion: rows preserve the existing hover and fade-in classes; toggles rotate the existing chevron only.

### Home Hero And About

- Structure: homepage hero markup and the About story/board carousel render from the `home-app` React bundle into `homeReactHeroApp` and `homeReactAboutApp`; the static `#about` anchor wrapper remains in `index.html`.
- Variants: image-backed hero carousel, hero dots, previous/next hero controls, membership CTA, scroll indicator, About story slide, animated stat cards, board-member slide, and About carousel indicators.
- Spacing: reuses `.hero`, `.carousel-*`, `.hero-content`, `#about`, `.about-carousel-*`, `.stat-card`, and `.board-member-*` primitives so the homepage keeps the established full-bleed hero and compact About carousel rhythm.
- States: React owns hero/about markup, board-member markup, Lucide icons, active slide state, touch swipes, hero autoplay/pause, carousel transforms, active indicator state, reveal visibility, and stat counter animation; `index.html` must not keep `homeReactInteractionsApp`, and no selector-driven homepage controller may mutate carousel or counter DOM.
- Accessibility: carousel controls are labelled buttons, hero slides expose image labels, the CTA is a real anchor, board icons are decorative SVGs, and stat values keep visible labels.
- Motion: preserves the existing hero fade carousel, About carousel transform, scroll reveal, stat counter, and button hover states only.

### Home Courses App

- Structure: homepage course carousel slides, slide headers, course cards, image/placeholder media, and carousel navigation render from the `home-app` React bundle into `homeReactCoursesApp`.
- Variants: local Greenville courses, nearby courses, worth-the-drive courses, image-backed card, no-image Lucide disc placeholder, beginner/intermediate/advanced difficulty badges, keyboard-openable card, slide arrows, and indicator buttons.
- Spacing: reuses `.courses-carousel-container`, `.courses-carousel`, `.carousel-slide-courses`, `.slide-header-nav`, `.courses-grid`, `.course-card`, `.course-image`, `.course-content`, `.course-info`, and `.courses-carousel-nav` so the homepage course section keeps the existing carousel rhythm.
- States: React owns course card markup, course data attributes, image fallbacks, visible location text, keyboard activation, active slide state, touch swipes, slide header actions, carousel transform, active indicator state, disabled arrow state, and active-slide height sync; `index.html` must not keep static `.course-card` markup or inline pin/disc/rating emoji inside course cards.
- Accessibility: cards expose button semantics and keyboard activation while preserving the `.course-card[data-course]` contract used by the React course modal; carousel controls are real buttons with labels, and location/placeholder iconography uses Lucide SVGs.
- Motion: preserves existing carousel transform, card hover lift, image scale, and focus-ring states only.

### Home Community Sections

- Structure: homepage Membership, Contact, and Footer content render from the `home-app` React bundle into `homeReactMembershipApp`, `homeReactContactApp`, and `homeReactFooterApp`; the `#membership` and `#contact` anchors remain static in `index.html`.
- Variants: membership perk grid, external PayPal membership CTA, email contact link, external Facebook link with Instagram text, location card, and copyright footer.
- Spacing: reuses `.membership-content`, `.membership-perks`, `.perk`, `.price`, `.contact-info`, `.contact-box`, `.contact-icon`, `.contact-label`, `.contact-detail`, and `footer` primitives so the lower homepage retains the established section rhythm; mobile footer padding leaves room for the fixed back-to-top and Crotts controls.
- States: React owns perk/contact/footer markup, safe external links, mailto link rendering, and Lucide iconography; `index.html` must not keep static `.membership-perks`, `.contact-box`, or `footer` markup and must not render emoji icons in these sections.
- Accessibility: email and social actions are real links, external links use safe new-tab attributes, contact cards keep visible labels, and SVG icons are decorative.
- Motion: preserves the existing fade-in reveal, perk/contact hover lift, price pulse, and footer static state only.

### Home Course Modal

- Structure: course cards render from the Home Courses App, while the UDisc/directions/preview overlay renders from the `home-app` React bundle into `homeReactCourseModalApp`.
- Variants: closed, open, UDisc link enabled/disabled, directions enabled/disabled, preview enabled/disabled, backdrop dismissal, close button, and Escape dismissal.
- Spacing: reuses `.course-modal-*` primitives so the modal keeps the established compact phone-first rhythm.
- States: React owns selected course data, body scroll lock, active overlay class, disabled action classes, and action subtitles; inline scripts must not inject course modal HTML or mutate `modalCourse*` / `modalUdisc` / `modalDirections` / `modalYoutube` nodes.
- Accessibility: the overlay exposes a labelled modal dialog, actions are real links when available, unavailable actions are removed from tab order with `aria-disabled`, and iconography uses Lucide SVGs.
- Motion: overlay and modal retain the existing opacity/transform transitions only.

### Home Page Controls

- Structure: homepage theme toggle renders inside the React-owned homepage chrome, and the back-to-top control renders from the `home-app` React bundle into `homeReactBackToTopApp`; the head pre-paint theme script remains only to prevent dark-mode flash.
- Variants: light theme, dark theme, hidden back-to-top, visible back-to-top, click-to-top, and storage-unavailable fallback.
- Spacing: reuses `.theme-toggle` and `.back-to-top` primitives so header and floating-control dimensions remain stable.
- States: React owns `data-theme` persistence, toggle pressed state, scroll threshold visibility, and smooth-scroll action; inline homepage scripts must not mutate `.theme-icon` or `#backToTop`.
- Accessibility: controls are real buttons with explicit labels, pressed state for the theme toggle, and Lucide SVG iconography.
- Motion: preserves existing transform/opacity button transitions only.

### Home Page Chrome

- Structure: homepage header, logo, public nav links, donate link, theme toggle, and mobile menu control render from the `home-app` React bundle into `homeReactPageChromeApp`; `nav.js` does not run on the homepage.
- Variants: desktop inline nav, mobile collapsed nav, mobile open nav, current-page link, donate link, light theme, dark theme, and scrolled header.
- Spacing: reuses `header`, `nav`, `.nav-links`, `.nav-right`, `.theme-toggle`, `.menu-toggle`, and `.logo-image` primitives so the public homepage rhythm remains unchanged.
- States: React owns menu expanded state, current-page nav state, donate link rendering, theme toggle placement, and the `header.scrolled` class; inline homepage scripts must not mutate `.menu-toggle`, `.nav-links`, or `header`.
- Accessibility: menu and theme controls are real buttons with labels, `aria-expanded`, `aria-controls`, and Lucide icons; current page uses `aria-current="page"`.
- Motion: mobile menu reveal and header scroll shadow preserve the existing transform/opacity/box-shadow transitions only.

### Public Page Chrome

- Structure: Events, Ryder Cup, Pro Shop, and Blog mount a shared React-owned header, logo, public nav links, donate link, theme toggle, and mobile menu into `publicReactPageChrome`; `nav.js` does not run on these public content pages.
- Variants: desktop inline nav, mobile collapsed nav, mobile open nav, current-page link, donate link, light theme, dark theme, and scrolled header.
- Spacing: reuses each page's existing `header`, `nav`, `.nav-links`, `.nav-right`, `.theme-toggle`, `.menu-toggle`, and `.logo-image` primitives so the surrounding page layout stays unchanged during migration.
- States: React owns menu expanded state, current-page nav state, donate link rendering, `data-theme` persistence, and the `header.scrolled` class; page scripts must not mutate `.menu-toggle`, `.nav-links`, `.theme-icon`, or `header`.
- Accessibility: menu and theme controls are real buttons with labels, `aria-expanded`, `aria-controls`, `aria-pressed`, and Lucide icons; current page uses `aria-current="page"`.
- Motion: mobile menu reveal and header scroll shadow preserve the existing transform/opacity/box-shadow transitions only.

### Crotts Assistant Widget

- Structure: the shared Crotts assistant widget renders from `home-app`, `public-app`, `admin-app`, and `members-app` into `crottsReactApp`; no page loads the root `crotts.js` helper.
- Variants: closed floating avatar, open dialog, empty greeting, user message, assistant reply, typing state, API-rate-limit error, network/error response, and mobile safe-area placement.
- Spacing: preserves the existing `#crotts-fab`, `#crotts-panel`, `#crotts-head`, `#crotts-msgs`, and `#crotts-form` hooks so page-specific placement overrides continue to work during migration; Events hides the launcher on mobile detail views, Blog hides it on mobile coming-soon cards, and Admin hides it on mobile forms so fixed assistant chrome cannot cover event facts, tee-sign cards, or input labels.
- States: React owns open/closed state, message history, busy/disabled send state, text input value, focus return to the composer, and assistant fetch lifecycle; HTML pages must not load `crotts.js` or append assistant DOM nodes.
- Accessibility: the panel exposes dialog semantics, the avatar, close, and send controls are real buttons with labels, the composer is labelled, and iconography uses Lucide SVGs.
- Motion: preserves the existing FAB scale and panel reveal only; no decorative motion is added.

### Admin Page Chrome

- Structure: the Admin page header, logo, public nav links, account links, theme toggle, and mobile menu render from the `admin-app` React bundle into `adminReactPageChromeApp`; the page keeps only the head pre-paint theme script inline.
- Variants: desktop inline nav, mobile collapsed nav, mobile open nav, current Admin link, Back to Members account link, Log out account link, light theme, dark theme, and scrolled header.
- Spacing: reuses the existing `header`, `nav`, `.nav-links`, `.nav-right`, `.nav-account`, `.nav-mobile-account`, `.theme-toggle`, `.menu-toggle`, and `.logo-image` primitives so the admin surface keeps its established rhythm during migration.
- States: React owns menu expanded state, current-page nav state, `data-theme` persistence, logout session-key clearing, and the `header.scrolled` class; `admin.html` must not mutate `.menu-toggle`, `.nav-links`, `.theme-icon`, `.logout-link`, or `header`.
- Accessibility: menu and theme controls are real buttons with labels, `aria-expanded`, `aria-controls`, `aria-pressed`, and Lucide icons; current page uses `aria-current="page"` plus the existing active-link class.
- Motion: mobile menu reveal and header scroll shadow preserve the existing transform/opacity/box-shadow transitions only.

### Admin Controller Bridge

- Structure: `admin.html` is the admin shell: styles, static React mount roots, and the `admin-app/admin-app.js` module script. The auth/API/event bridge lives in `src/admin-app/admin-controller.js` and starts from `src/admin-app/main.js`.
- Variants: signed-out auth gate, authenticated panel startup, API loader events, admin tab requests, registration events, scoring events, data-archive events, and shop/wallet/order events.
- States: the controller owns API calls, session token checks, module-local admin shell state for auth gate, active tab, shared message, and order badge count, private controller snapshots for current control filters or selected workflow state, and `gvdg:admin-*` custom-event dispatch; `admin.html` must not keep inline `api`, `checkAdminSession`, `initAdmin`, or legacy global admin state-snapshot code.
- Startup: `src/admin-app/main.js` mounts admin React roots synchronously before starting the controller; React components that depend on initial direct loader events subscribe in layout effects so fast API responses cannot outrun their event listeners.
- Accessibility: visible status, alert, form, table, and button semantics stay in the React-owned components; the bridge only publishes state and action results.
- Motion: no controller-owned motion.

### Admin Orders Badge

- Structure: the new-order count in the React-owned Admin Orders tab renders inside `AdminNavigation`; legacy order loaders publish `gvdg:admin-orders-badge` events only.
- Variants: hidden zero-count state and visible unfulfilled-order count.
- Spacing: reuses `.orders-badge` so the tab label keeps the existing compact badge dimensions.
- States: React owns count visibility and text rendering from module-local admin shell state; `admin.html` must not write badge `textContent`, toggle a badge `hidden` attribute, or publish global badge state.
- Accessibility: the badge remains inline text inside the Orders tab button.
- Motion: static count; no decorative motion.

### Admin Navigation

- Structure: the Admin desktop sidebar groups and mobile grouped selects render from `admin-app` into `adminNavigationReactApp`; `adminSwitch(tab)` remains a loader/event bridge only.
- Variants: desktop sidebar, mobile grouped select grid, active tab, Events/Courses/Club/Shop/Members/Data groups, Orders badge count, and programmatic tab switches from edit/save/cancel flows.
- Spacing: reuses `.admin-main`, `.admin-sidebar`, `.admin-mobile-nav`, `.admin-mnav`, `.admin-tab`, `.admin-navgroup`, and `.orders-badge` primitives so the existing admin panel layout does not shift during migration.
- States: React owns active tab button/select rendering and mobile select synchronization from module-local admin shell state; `admin.html` must not attach click/change handlers to `.admin-tab` or `.admin-mnav`, mutate their active classes/values, or toggle `.admin-pane.active`. Legacy code requests tab switches through `gvdg:admin-tab-request` and publishes the canonical active tab through `gvdg:admin-active-tab`.
- Accessibility: sidebar actions are real buttons with `aria-current`, mobile groups are labelled native selects, and group headings remain visible text.
- Motion: no decorative motion; only inherited button hover/focus states apply.

### Admin Auth Gate

- Structure: the Admin loading state and signed-out/not-admin/session-expired gate render from `admin-app` into `adminAuthGateReactApp`; the legacy auth checker publishes `gvdg:admin-auth-gate` state events only.
- Variants: loading session check, signed-out with Members link, expired session with Members link, not-admin message without link, and authenticated panel-hidden state.
- Spacing: reuses `.status-box`, `.spinner`, `.admin-gate`, `.gate-icon`, `.gate-title`, `.gate-msg`, and `.gate-btn` so the auth gate keeps the same centered compact admin layout.
- States: React owns loading/gate/panel visibility and gate card content from module-local admin shell state; `admin.html` must not keep `adminStatus`/`adminGate` nodes, build gate children, or mutate gate text/hidden state.
- Accessibility: the loading state uses status semantics, the gate uses visible text and a real Members link, and lock iconography uses Lucide SVGs.
- Motion: loading keeps the existing spinner animation and gate links keep inherited hover transitions only.

### Admin Pane Visibility

- Structure: a React null-controller renders from `admin-app` into `adminPaneVisibilityReactApp` and mirrors module-local Admin auth/tab state into `body[data-admin-panel]` and `body[data-admin-tab]`; CSS selectors choose the visible `#adminPanel` and active `.admin-pane`.
- Variants: hidden signed-out panel, visible authenticated panel, default Events pane, and every admin tab pane listed in `ADMIN_NAV_GROUPS`.
- Spacing: reuses `.admin-panel`, `.admin-main`, `.admin-content`, and `.admin-pane` primitives so pane switching does not shift the panel layout.
- States: React owns panel and pane visibility attributes from `gvdg:admin-auth-gate` and `gvdg:admin-active-tab`; `admin.html` must not mutate `adminPanel.style.display`, query `.admin-pane`, or toggle `.admin-pane.active`.
- Accessibility: hidden panes are removed visually through CSS while each mounted pane keeps its own labelled controls and status regions.
- Motion: pane switching is immediate operational navigation with no decorative transition.

### Admin Message

- Structure: the shared Admin success/error message renders from `admin-app` into `adminMessageReactApp`; legacy admin workflows keep calling `adminMsg(text, ok)` and publish `gvdg:admin-message` events only.
- Variants: empty reserved row, success message, and error message.
- Spacing: reuses `.admin-msg`, `.admin-msg.ok`, and `.admin-msg.err` so the message keeps its compact position above the pane content.
- States: React owns message text, success/error classes, and status/alert semantics from module-local admin shell state; `admin.html` must not keep `adminMsg` as a direct `textContent`/`className` DOM mutator, keep an `adminMsg` element id, or publish global message state.
- Accessibility: success messages use status semantics and error messages use alert semantics while preserving visible text.
- Motion: static message text; no decorative motion.

### Admin Dialogs

- Structure: React-owned document-level confirmation renderer mounts from `admin-app` into `adminDialogsReactApp`; admin components and the live-scoring controller call the shared `adminConfirm` service instead of native browser confirms.
- Variants: neutral confirmation, destructive confirmation, cancel action, confirm action, Escape dismissal, and backdrop dismissal.
- Spacing: centered modal uses `--bg-secondary`, `--border-color`, the modal shadow recipe, compact action buttons, and full-width stacked actions on narrow phones.
- States: one dialog is shown at a time; queued confirmation requests resolve in order without changing the underlying admin event dispatch payloads.
- Accessibility: dialogs expose `role="dialog"`, `aria-modal`, labelled title/body text, and real action buttons.
- Motion: static modal; no layout animation.

### Admin Events List

- Structure: the Admin events table/list renders from `admin-app` into `adminEventsListReactApp`; the admin controller only fetches `/events`, emits direct `gvdg:admin-events-list` loader events, and handles edit/status/delete request events.
- Variants: loading row, empty row, event row, scheduled/live/final/cancelled status badges, status select, edit action, and delete action.
- Spacing: reuses `.admin-evrow`, `.ev-name`, `.admin-badge`, `.dash-event-date`, `.admin-btn`, and `.dash-note` so the existing compact admin rhythm does not shift.
- States: React owns row markup, status select value, empty/loading copy, and request dispatch from direct loader events; the controller must not publish an `eventsList` snapshot. `admin.html` must not mutate `adminEventsList`, construct `.admin-evrow` rows, or attach row button/select listeners directly.
- Accessibility: loading and empty states use status semantics, status controls are labelled native selects, and row actions are real buttons.
- Motion: static list rows; only inherited control hover/focus states apply.

### Admin Event Form

- Structure: the Admin New Event add/edit form renders from `admin-app` into `adminEventFormReactApp`; legacy admin code fetches course/league/layout options, handles save/cancel/edit request events, calls the create/update APIs, and publishes save/layout result state only.
- Variants: blank create form, edit form, type/status/format selectors, course selector, layout selector, inline basic-layout creation, league selector, notes, busy submit, cancel edit, validation failure, successful create, and successful update.
- Spacing: reuses `.admin-form`, `.admin-form-note`, `.admin-form-actions`, `.al-section`, `.al-row`, and `.admin-btn` so New Event keeps the existing compact admin form rhythm.
- States: React owns all `ae*` form field values, course/league/layout option rendering from direct loader events, quick-layout visibility, edit-mode note/button labels, focus on edit, busy submit labels, and reset after success; the controller must dispatch `gvdg:admin-event-form-layouts` directly and must not publish an `eventFormLayouts` snapshot. `admin.html` must not keep static `adminCreateForm` markup, populate `aeCourse`/`aeLeague`/`aeLayout`, read `ae*` field values, or attach form/course/layout/cancel listeners directly.
- Accessibility: labels target stable `ae*` control ids, required name validation remains native, loading layout options use the native select text, and create/update/cancel controls are real buttons.
- Motion: static operational UI; edit focus uses the existing smooth scroll behavior only.

### Admin Import Controls and Candidates

- Structure: the Admin Import DiscGolfScene and CSV controls render from `admin-app` into `adminImportControlsReactApp`, and the candidate preview list renders into `adminImportCandidatesReactApp`; legacy DiscGolfScene and CSV import handlers only handle request events, call admin APIs, emit direct candidate-state events, publish control-result events, and handle create-request events.
- Variants: hidden idle state, loading candidates, no candidates found, candidate row, creating event, created event, and failed event.
- Spacing: reuses `.admin-import-csv`, `.admin-cand`, `.dash-note`, and `.admin-btn.secondary` so the CSV controls and import previews keep the compact divider rhythm already used by Courses.
- States: React owns import button busy labels, CSV textarea value, candidate state from direct `gvdg:admin-import-candidates` events, candidate row markup, create button disabled state, and create/created/failed text; the controller must not publish an `importCandidates` snapshot. `admin.html` must not keep static `dgsImportBtn`/`csvImportBtn`/`csvImportText` markup, read `csvImportText`, keep `importCandidates`, clear candidate `textContent`, construct `.admin-cand` rows, or attach import-control/create-row click listeners directly.
- Accessibility: CSV labels target stable control ids, loading and empty states use status semantics, and row create actions are real buttons.
- Motion: static candidate rows; only inherited control hover/focus states apply.

### Admin Courses Form and List

- Structure: the Admin courses add form renders from `admin-app` into `adminCourseFormReactApp`, and the courses summary list renders into `adminCoursesListReactApp`; legacy admin code fetches `/courses`, continues populating the event/layout course selects, handles create-request events, and publishes list/result state events only.
- Variants: empty list and course row with optional location.
- Spacing: reuses `.admin-form`, `.admin-btn`, `.admin-cand`, and the existing courses-pane top margin so the form and course rows keep the same compact divider rhythm.
- States: React owns add-form field values, busy submit labels, successful resets, course-row markup, and empty rendering from direct `gvdg:admin-courses-list` loader events; the controller must not publish a `coursesList` snapshot. `admin.html` must not keep static `adminCourseForm` markup, read `ac*` fields, reset that form, mutate `adminCoursesList`, clear its text, or append `.admin-cand` rows directly.
- Accessibility: form labels target stable control ids, required fields remain native inputs, and course rows are static text because no row action exists in the current admin workflow.
- Motion: static list rows; no decorative motion.

### Admin Course Layouts

- Structure: the Admin Layouts course selector, UDisc import controls, tee/target pool, SAFARI layout builder, and existing-layout list render from `admin-app` into `adminLayoutsReactApp`; legacy admin code only fetches `/courses`, `/courses/:id/positions`, `/courses/:id/layouts`, handles create/update/delete/import request events, and publishes layout state/result events.
- Variants: no course selected, loading selected course, ready selected course, error selected course, no positions, position chips, UDisc fetch results, imported layout candidates, blank builder, edit existing layout, verified tee-sign rows, save pending, and empty existing-layout list.
- Spacing: reuses `.al-section`, `.al-row`, `.al-h`, `.al-note`, `.admin-layout-field`, `.al-holes`, `.al-poolitem`, `.admin-evrow`, `.ev-name`, and `.admin-btn` so the Layouts pane keeps the same compact admin rhythm as Courses and Tee Signs.
- States: React owns the selected course, UDisc URL field, import result rows, position form fields, builder row values, edit/reset state, save pending labels, layout list markup, and request dispatch from direct `gvdg:admin-courses-list` and `gvdg:admin-course-layouts-state` loader events; the controller must not publish a `courseLayouts` snapshot. `admin.html` must not keep static `alCourse`, `alBody`, `alUdisc*`, `alPoolList`, `alPos*`, `alName`, `alHoles`, `alAddHole`, `alSaveLayout`, `alResetLayout`, or `alLayoutsList` markup or direct DOM listeners.
- Accessibility: labels target stable control ids, course/layout/position selectors remain native selects, loading and empty states use status semantics, list actions are real buttons, and verified rows preserve visible text for sticky tee-sign-derived hole data.
- Motion: static operational UI; only inherited control hover/focus states apply.

### Admin Live Scoring

- Structure: the Admin live scoring event selector, start controls, scorecard grid, temporary override controls, tee-sign strip, leaderboard, finalize/cancel actions render from `admin-app` into `adminScoringReactApp`; legacy admin code only fetches `/events`, layouts, live snapshots, tee-sign references, handles score/start/override/finalize/cancel request events, and publishes scoring state/result events.
- Variants: no event selected, loading events, scheduled event start form, layout options, singles/doubles format toggles, stroke/matchplay toggles, live snapshot, finalized snapshot, conflict cells, invalid pair/card notice, no scores yet, temporary hole override, official tee-sign photo, unverified candidate photo, generated tee-sign fallback, live cancel hidden after final, and force-finalize conflict prompt.
- Spacing: reuses `.sc-start-grid`, `.sc-start-field`, `.fmt-btns`, `.fmt-btn`, `.al-holes`, `.al-row`, `.al-note`, `.ts-strip`, `.ts-strip-card`, `.ts-strip-photo`, `.ts-strip-svg`, `.admin-btn`, and `.admin-badge` so scorekeeping stays dense and mobile-scrollable.
- States: React owns event/layout select values, format toggle pressed state, start validation text, score input drafts, conflict markers, override fields, tee-sign image object URLs, leaderboard markup, and request dispatch from direct `gvdg:admin-scoring-events-state` and `gvdg:admin-scoring-state` events; the controller keeps selected scoring workflow state in private closure variables and must not publish `scoringEvents` or `scoring` snapshots. `admin.html` must not keep static `scEvent`, `scStart`, `scLive`, `scGrid`, `scOverride`, `scTeeSigns`, `scBoard`, `scStartBtn`, `scFinalizeBtn`, or `scCancelBtn` markup or direct DOM listeners.
- Accessibility: event/layout/hole controls are labelled native selects, format toggles expose pressed state, loading/empty/error regions use status/alert semantics, conflict markers have accessible labels, tee-sign images have hole-specific alt text, and all workflow actions are real buttons.
- Motion: static operational UI; only inherited control hover/focus states apply.

### Admin Tee Signs Review Queue

- Structure: the Admin Tee Signs status toolbar renders from `admin-app` into `adminTeeSignReviewControlsReactApp`, and the review queue renders into `adminTeeSignReviewReactApp`; legacy admin code fetches `/admin/tee-signs`, layout options, and handles approve/extract/reject/delete request events while dispatching direct `gvdg:admin-tee-sign-review` queue events and action-result events only.
- Variants: awaiting-review, official, and rejected filters; loading queue, error queue, empty queue, candidate card, official card with apply-rows action, rejected card with delete-only action, authorized candidate image preview, official public image preview, editable layout rows, new-layout row, remove-row action, add-row action, pending action state, and failed validation state.
- Spacing: reuses `.ts-review-toolbar`, `.ts-review-list`, `.ts-review-card`, `.ts-review-media`, `.ts-review-body`, `.ts-review-row`, `.ts-review-actions`, `.admin-btn`, and `.admin-badge` so tee-sign review keeps the existing dense proofing workflow.
- States: React owns filter select value, module-local control state, refresh action, review-card markup, preview image object URL lifecycle, editable row values, add/remove row behavior, reject/delete confirmations, pending action labels, and request dispatch from direct loader events; the controller keeps the current review filter in a private closure snapshot for reloads and must not publish a `teeSignReview` snapshot; `admin.html` must not keep static `tsStatusFilter`/`tsRefresh`/`tsReviewList` markup, read those DOM fields, mutate `tsReviewList`, construct tee-sign cards or `.ts-review-row` rows, load thumbnail images into DOM nodes, query card rows, or attach toolbar/card listeners directly.
- Accessibility: loading and empty states use status semantics, load failures use alert semantics, preview images have hole-specific alt text, row labels target stable inputs, and every queue action is a real button.
- Motion: static review cards; only inherited control hover/focus states apply.

### Admin Club Content Forms and Lists

- Structure: the Admin Leagues, Fundraisers, and Meetings add forms render from `admin-app` into `adminLeagueFormReactApp`, `adminFundraiserFormReactApp`, and `adminMeetingFormReactApp`; the matching lists render into `adminLeaguesListReactApp`, `adminFundraisersListReactApp`, and `adminMeetingsListReactApp`; the admin controller fetches `/leagues`, `/fundraisers`, and `/meetings`, emits direct list events, keeps New Event league select population, handles create-request events, and publishes create-result events only.
- Variants: league empty/row/delete, fundraiser empty/row/close/reopen/delete, and meeting empty/row/delete.
- Spacing: reuses `.admin-form`, `.admin-club-form-wide`, `.admin-evrow`, `.ev-name`, `.admin-btn`, and `.al-note` so the Club management panes preserve the same compact admin rhythm as Events.
- States: React owns add-form field values, busy submit labels, successful resets, row markup, empty copy, confirm prompts, and request dispatch from direct list events; the controller must not publish `leaguesList`, `fundraisersList`, or `meetingsList` snapshots. `admin.html` must not keep static `adminLeagueForm`, `adminFundraiserForm`, or `adminMeetingForm` markup, read `lg*`/`fr*`/`mt*` fields, reset those forms, mutate `adminLeaguesList`, `adminFundraisersList`, or `adminMeetingsList`, construct `.admin-evrow` rows for those panes, or attach form/list listeners directly.
- Accessibility: form labels target stable control ids, required fields remain native inputs, empty states use status semantics, list actions are real buttons, and visible text preserves the existing row summaries.
- Motion: static list rows; only inherited control hover/focus states apply.

### Admin Member Creation Form

- Structure: the Admin Members creation form renders from `admin-app` into `adminMemberFormReactApp`; legacy admin code only handles create-request events, the API POST, temp-PIN publication, members reload, and global messages.
- Variants: blank form, name-required validation, PDGA-or-UDisc-required validation, optional admin checkbox, busy submit, successful reset, issued temporary PIN, and failed-create recovery.
- Spacing: reuses `.admin-form`, `.admin-member-form-admin-toggle`, `.admin-btn`, and existing input/label primitives so the form keeps the compact Members pane rhythm.
- States: React owns all field values, admin checkbox state, busy button text, and reset after success; `admin.html` must not keep a static `adminMemberForm`, read `am*` field values, listen to the member form submit event, or call `reset()` on the member form.
- Accessibility: labels target stable form control ids, required fields remain native inputs, the admin checkbox is labelled, and the create action is a real submit button.
- Motion: static form; inherited controls only.

### Admin Members List

- Structure: the Admin Members list renders from `admin-app` into `adminMembersListReactApp`; the admin controller fetches `/admin/members` and emits direct `gvdg:admin-members-list` loader events only.
- Variants: loading, empty, member row, admin badge text, PIN-not-set badge text, reissue-PIN action, make-admin action, remove-admin action, and disabled last-admin removal.
- Spacing: reuses `.admin-evrow`, `.ev-name`, `.admin-btn`, and `.al-note` so the Members pane keeps the same compact operational rhythm as the Events and Club lists.
- States: React owns row markup, loading/empty copy, confirm prompts, last-admin disabled state, and request dispatch from direct loader events; the controller must not publish a `membersList` snapshot. `admin.html` must not mutate `adminMembersList`, construct member `.admin-evrow` rows, or attach member row button listeners directly.
- Accessibility: loading and empty states use status semantics, member actions are real buttons, and disabled role controls expose the existing last-admin title plus the shared disabled admin button treatment.
- Motion: static list rows; only inherited control hover/focus states apply.

### Admin Member Temporary PIN

- Structure: the one-shot temporary PIN result renders from `admin-app` into `adminMemberTempPinReactApp`; legacy create/reset flows publish `gvdg:admin-member-temp-pin` events only.
- Variants: hidden idle state, issued PIN card, copied button state, PDGA login label, UDisc login label, and member-id fallback label.
- Spacing: reuses the admin form rhythm with `.admin-temp-pin`, `.admin-temp-pin-row`, `.admin-temp-pin-code`, `.admin-temp-pin-note`, and `.admin-btn`; border radius stays at 8px.
- States: React owns PIN text, member label text, copy-button text, and clipboard timeout reset from direct `gvdg:admin-member-temp-pin` events; the controller must not publish a `memberTempPin` snapshot. `admin.html` must not keep `amTempPin`, construct PIN child nodes, mutate temp-PIN `textContent`, or apply inline temp-PIN styles.
- Accessibility: the issued PIN card uses polite status semantics, visible copy text, and a real button; the PIN remains visible when clipboard access is unavailable.
- Motion: static card; only inherited button hover/focus states apply.

### Admin Wallet Recent List

- Structure: the Admin Wallets recent ledger renders from `admin-app` into `adminWalletRecentReactApp`; `AdminWalletRecentList` fetches `/admin/wallets/recent` through `src/admin-app/admin-api.js` after the admin session is verified and the Wallets tab is active, then refreshes after successful wallet-adjustment result events.
- Variants: idle before Wallets tab activation, loading, error, empty, credit transaction, debit transaction, member fallback text, source fallback text, note metadata, and created-at metadata.
- Spacing: reuses `.wallet-ledger`, `.wallet-row`, `.shop-admin-meta`, `.credit`, `.debit`, and `.al-note` so the Wallets pane keeps the same compact ledger rhythm as the Pro Shop admin surfaces.
- States: React owns recent-ledger fetch lifecycle, loading/error/empty copy, and row markup; `admin-controller.js` must not keep `adminLoadWalletRecent`, publish `gvdg:admin-wallet-recent`, or reload the ledger after posting adjustments.
- Accessibility: loading and empty states use status semantics, failures use alert semantics, and ledger rows remain static text because recent transactions have no row action in the current admin workflow.
- Motion: static ledger rows; no decorative motion.

### Admin Wallet Adjustment Form

- Structure: the Admin Wallets adjustment form renders from `admin-app` into `adminWalletFormReactApp`; legacy admin code only handles adjustment-request events, the API POST, adjustment-result publication, and global messages.
- Variants: blank form, required member/amount validation, positive credit, negative debit, busy submit, successful reset, member-not-found error, ambiguous-member error, and failed-request recovery.
- Spacing: reuses `.admin-form`, `.admin-wallet-form-wide`, `.admin-btn`, and existing input/label primitives so the form keeps the compact wallet pane rhythm.
- States: React owns all field values, busy button text, and reset after success; `admin.html` must not keep a static `adminWalletForm`, read `wa*` field values, listen to the wallet form submit event, call `reset()` on the wallet form, or keep the old `walletRow` helper.
- Accessibility: labels target stable form control ids, required fields remain native inputs, and the adjustment action is a real submit button.
- Motion: static form; inherited controls only.

### Admin Registration Panel

- Structure: the Admin Registration event selector, registration settings, roster, card assignment controls, walk-on form, CTP add/list controls, store-credit ledger, ace-pot summary, and ace-pot actions render from `admin-app` into `adminRegistrationReactApp`; the controller fetches events/config/roster/CTPs/credits/ace-pot data, handles request events, and dispatches direct `gvdg:admin-registration-*` loader events only.
- Variants: loading events, event-load error, no selected event, selected event, config loading/error, settings save pending, empty roster table, registered-player row, manually-added walk-on row, assign-cards pending, add-walk-on pending, empty CTP list, CTP row with winner/member/credit controls, add-CTP pending, empty payout ledger, credit/debit payout rows, empty ace-pot summary, ready ace-pot summary, carryover save, payout, and carry-to-next actions.
- Spacing: reuses `.al-section`, `.al-row`, `.al-h`, `.al-note`, `.al-holes`, `.lb-name`, `.credit-award`, `.admin-evrow`, `.ev-name`, `.wallet-ledger`, `.wallet-row`, `.shop-admin-meta`, `.register-addon`, and `.admin-btn` so the panel keeps the dense operational rhythm already used by live scoring, Events, Wallets, and Orders.
- States: React owns `rgEvent`, `rgOpen`, `rgEntry`, `rgCtp`, `rgAce`, `rgFormat`, `rgDivisions`, `rgCardSize`, `rgMemberOptions`, `rgCtpHole`, `rgCtpDivision`, `rgCtpPrize`, `rgAceCarry`, `rgAceWinner`, module-local registration control state, all walk-on form fields, roster count/table markup, CTP row input values, payout ledger rows, ace-pot control values, pending labels, confirmations, successful resets, and request dispatch from direct loader events; the controller keeps current registration event/config controls in a private closure snapshot for labels and reloads and must not publish `registrationMemberOptions`, `registrationRoster`, `registrationCtps`, `registrationCredits`, or `registrationAcePot` snapshots. `admin.html` must not keep static registration controls, mutate the member-option datalist, write ace-pot carryover values, read registration form DOM fields, or attach direct `rg*` event listeners.
- Accessibility: the event selector, settings fields, assignment size, CTP add fields, walk-on controls, CTP row controls, and ace-pot actions are native labelled controls; loading states use status semantics, load failures use alert semantics, and row actions are real buttons.
- Motion: static operational UI; only inherited control hover/focus states apply.

### Admin Product Inventory Controls and List

- Structure: the Admin Pro Shop inventory sort/status controls render from `admin-app` into `adminProductInventoryControlsReactApp`, and the inventory list renders into `adminProductsListReactApp`; legacy admin code fetches `/admin/shop/products`, handles controls-request events, and dispatches direct `gvdg:admin-products-list` events only.
- Variants: loading, empty active list, empty archived list, active product row, archived product row, image thumbnail, text thumbnail fallback, editable price, editable stock, active/archive toggle, save action, and delete action.
- Spacing: reuses `.shop-admin-list`, `.shop-admin-row`, `.shop-admin-thumb`, `.shop-admin-controls`, `.register-addon`, `.admin-btn`, and `.al-note` so inventory keeps the existing dense admin shop rhythm.
- States: React owns sort/status select values, module-local control state, product row markup, thumbnail fallback, editable row control values, empty/loading copy, delete confirm prompt, and save/delete request dispatch from direct loader events; the controller keeps current inventory sort/status in a private closure snapshot for reloads and must not publish a `productsList` snapshot; `admin.html` must not keep static `psInvSort`/`psInvStatus` markup, read those DOM fields, mutate `adminProductsList`, construct `.shop-admin-row` rows, or attach product row/filter button/input listeners directly.
- Accessibility: loading and empty states use status semantics, thumbnails have text alternatives, editable controls have product-specific labels, and row actions are real buttons.
- Motion: static inventory rows; only inherited control hover/focus states apply.

### Admin Product Creation Form

- Structure: the Admin Pro Shop product creation form renders from `admin-app` into `adminProductFormReactApp`; legacy admin code only handles create-request events, the API POST, inventory reload, and global messages.
- Variants: blank form, required name/price validation, pasted image URL, selected upload preview, busy submit, successful reset, and failed create.
- Spacing: reuses `.admin-form`, `.admin-product-form-wide`, `.admin-product-image-input`, `.admin-product-image-preview`, `.shop-admin-thumb`, `.admin-btn`, and `.al-note`.
- States: React owns all field values, upload resize handoff, preview image, busy button text, and reset after success; `admin.html` must not keep `adminProductForm`, read `ps*` field values, listen to `psImageFile`/`psImage`, mutate `psImagePreview`, or call `reset()` on the product form.
- Accessibility: labels target stable form control ids, upload preview has alt text, and create action is a real submit button.
- Motion: static form; inherited controls only.

### Admin Orders Controls and List

- Structure: the Admin Pro Shop order status filter and refresh button render from `admin-app` into `adminOrderControlsReactApp`, and the orders list renders into `adminOrdersListReactApp`; legacy admin code fetches `/admin/orders`, handles controls-request events, keeps order badge update plus PATCH/DELETE API helpers, and dispatches direct `gvdg:admin-orders-list` events only.
- Variants: loading, error, empty all-orders list, empty filtered list, unfulfilled order card, cancelled order card, line items, editable fulfillment status, editable carrier, editable tracking number, save action, cancel action, delete action, and disabled cancelled cancel action.
- Spacing: reuses `.orders-list`, `.order-card`, `.order-head`, `.order-items`, `.order-controls`, `.order-actions`, `.shop-admin-meta`, `.admin-btn`, and `.al-note` so fulfillment cards keep the existing compact shop-admin rhythm.
- States: React owns filter select value, module-local control state, refresh action, order-card markup, row form values, loading/error/empty copy, cancel/delete confirm prompts, pending button disablement, and save/cancel/delete request dispatch from direct loader events; the controller keeps current order filter in a private closure snapshot for reloads and must not publish an `ordersList` snapshot; `admin.html` must not keep static `ordStatusFilter`/`ordRefresh` markup, read those DOM fields, mutate `adminOrdersList`, construct `.order-card` rows, or attach order row/filter button/input listeners directly.
- Accessibility: loading and empty states use status semantics, load failures use alert semantics, fulfillment fields have order-specific labels, and row actions are real buttons.
- Motion: static order cards; only inherited control hover/focus states apply.

### Admin Data Archive Destination Form

- Structure: the Admin Data Archive destination add/edit form renders from `admin-app` into `adminDataArchiveDestinationFormReactApp`; legacy admin code only handles save-request events, the API POST/PATCH, destination reload, and global messages.
- Variants: blank add form, edit form, required label/url validation, optional auth header/prefix/token fields, clear-token checkbox, active-destination checkbox, inline save error, busy submit, cancel edit, successful reset, and failed-save recovery.
- Spacing: reuses `.admin-form`, `.admin-data-archive-destination-form`, `.register-addon`, `.admin-data-archive-destination-toggle`, `.admin-form-actions`, `.admin-btn`, and existing input/label primitives so archive endpoint setup keeps the same compact admin rhythm as the adjacent destination list.
- States: React owns all field values, token placeholder, edit/cancel mode, edit scroll-into-view, checkbox state, busy button text, and reset after success; `admin.html` must not keep a static `dxEndpointForm`, read `dxEndpoint*` or `dxAuth*` fields, listen to the endpoint form submit/cancel events, or directly mutate destination form controls.
- Accessibility: labels target stable form control ids, checkboxes are labelled, native URL validation remains available, and save/cancel actions are real buttons.
- Motion: static form; inherited controls only.

### Admin Data Archive Destinations List

- Structure: the Admin Data archive destination list renders from `admin-app` into `adminDataArchiveDestinationsReactApp`; `src/admin-app/data-archive-destinations-store.js` fetches `/admin/export/endpoints` directly after the Admin auth gate reaches the panel state and the Data Archive tab is active.
- Variants: loading, error, empty destination list, active destination row, inactive destination row, token-set metadata, token-missing metadata, edit action, make-active action, and delete action.
- Spacing: reuses `.admin-evrow`, `.ev-name`, `.al-note`, `.admin-msg.ok`, `.shop-admin-controls`, and `.admin-btn` so archive destinations match the compact admin list rhythm.
- States: React owns endpoint fetch status, destination row markup, loading/error/empty copy, active-default badge, delete confirm prompt, and edit/activate/delete request dispatch; the controller handles mutation requests and emits save/activate/delete result events, but must not publish `dataArchiveDestinations` snapshots or `gvdg:admin-data-archive-destinations-list`.
- Accessibility: loading and empty states use status semantics, load failures use alert semantics, and row actions are real buttons.
- Motion: static destination rows; only inherited control hover/focus states apply.

### Admin Data Archive Export Controls

- Structure: the Admin Data archive export controls render from `admin-app` into `adminDataArchiveExportControlsReactApp`; destination options come from the shared React-side Data Archive destinations store, while legacy export code only handles run-request events, the API POST, structured result/download publication, and run-result events.
- Variants: blank date range, active default destination, download-only destination, include-data checkboxes, dry-run checkbox, test-destination checkbox, idle run button, and busy run button.
- Spacing: reuses `.admin-form`, `.al-row`, `.register-addon`, `.admin-form-actions`, and `.admin-btn` so the export runner keeps the same compact control rhythm as destination setup.
- States: React owns date fields, destination select options/value, include/test checkbox state, active-destination defaulting, and busy button text; `admin.html` must not keep static `dxExport*`/`dxInclude*`/`dxDryRun`/`dxTest`/`dxRunExport` markup, populate `dxExportDestination`, read export control fields, or attach the run button listener directly.
- Accessibility: labels target stable form control ids, checkboxes are labelled, and the run action is a real button.
- Motion: static controls; inherited hover/focus states only.

### Admin Data Archive Export Result

- Structure: the Admin Data archive export result renders from `admin-app` into `adminDataArchiveExportResultReactApp`; legacy export code keeps API request handling and emits direct `gvdg:admin-data-archive-export-result` result events only.
- Variants: idle copy, successful download/test/sent result, completed fallback result, failed result, rendered JSON download link, and automatic download trigger.
- Spacing: reuses `.al-note` and `.al-note.err` so the result sits in the same compact note position below the Run export button.
- States: React owns message text, success/idle/error tone, status/alert role, Blob URL creation/revocation, and the rendered download anchor from direct result events; the controller must not publish a `dataArchiveExportResult` snapshot. `admin.html` must not keep `dxExportResult`, mutate export result `textContent`, toggle result classes directly, create/click temporary download anchors, or own Blob URL lifecycle.
- Accessibility: idle and success messages use status semantics; failures use alert semantics; archive downloads are real links with a `download` filename.
- Motion: static result text; no decorative motion.

### Events Hub App

- Structure: the Events page hub schedule renders from the shared `public-app` React bundle into `liveNowSection`, `calendarEvents`, `hub`, and `clubEventsSection`; the React data module fetches `/club-feed`, `/events`, and `/courses`, then derives the hub groups.
- Variants: no-current-events empty state, live-now section, external schedule feed card, internal league results card, upcoming club-scored card, status/type badges, and club feed card.
- Spacing: reuses `.events-group-head`, `.events-section`, `.events-section-head`, `.events-grid`, `.event-card`, `.event-meta`, `.event-cta`, and badge primitives so the hub keeps the existing Events page rhythm.
- States: React owns route-triggered hub fetch lifecycle, quiet refresh timing, course-name lookup through `src/shared/events-model.js`, hub headings, live/upcoming/feed card markup, link attributes, empty-state rendering, Lucide date/location/external-link iconography, and event counts; `events.html` must not fetch or publish hub data, dispatch `gvdg:events-hub`, or contain hub card/list/section DOM renderers. There is no root `events.js` compatibility export.
- Accessibility: schedule feed cards are real links when they navigate, upcoming/live event cards use hash links, external links keep safe new-tab attributes, and iconography uses Lucide SVGs.
- Motion: preserves the inherited card hover/focus transforms only; no decorative motion is added.

### Events Status App

- Structure: the Events page status surface renders from the shared `public-app` React bundle into `status`; the Events data store publishes `gvdg:events-status` from module-local state for loading, empty, and retryable error states.
- Variants: loading spinner, empty state, retryable error, and retry callback handoff.
- Spacing: reuses `.status-box`, `.spinner`, `.empty-icon`, `.status-message`, and `.retry-btn` so status states preserve the current Events page rhythm.
- States: React owns status markup, role, retry button, module-local status state, and Lucide status iconography; `events.html` must not append status DOM nodes or use emoji icons for empty/error states.
- Accessibility: loading/empty use status semantics, errors use alert semantics, and retry remains a real button.
- Motion: preserves only the existing spinner animation.

### Events Last Updated App

- Structure: the Events page last-updated line renders from the shared `public-app` React bundle into `eventsLastUpdatedReactApp`; React data modules publish `gvdg:events-last-updated` from module-local state when the hub refreshes or clears the timestamp for detail/status routes.
- Variants: hidden no-timestamp state and visible hub refresh timestamp.
- Spacing: reuses `.last-updated` so the timestamp keeps the established centered Events page placement above the home link.
- States: React owns timestamp text, module-local timestamp state, formatting, status semantics, and hidden/visible rendering; `events.html` must not keep a `lastUpdated` node or mutate timestamp text/hidden state directly.
- Accessibility: the visible timestamp uses status semantics so refresh completion is announced without turning into an alert.
- Motion: static informational text; no decorative motion.

### Events Route Visibility

- Structure: a React null-controller renders from the shared `public-app` bundle into `eventsViewControllerReactApp`; the public bundle parses Events hash routes, publishes `gvdg:events-route-request`, mirrors Events route changes into `body[data-events-view]`, and CSS selectors choose the visible Events island group.
- Variants: status/loading route, hub route, league-detail route, and event-detail route.
- Spacing: reuses `.events-route`, the existing hub/detail section roots, and the current Events page vertical rhythm so route changes do not move surrounding header/footer chrome.
- States: React owns route visibility attributes from `gvdg:events-view`, module-local route/view state, `hashchange` listening, and current-route refresh requests; `events.html` must not parse `location.hash`, attach `hashchange`, set section `hidden` flags, mutate `style.display`, or inspect route section DOM nodes to decide the current route.
- Accessibility: route sections remain stable React roots; each visible island keeps its own status, table, link, and article semantics.
- Motion: route changes are immediate hash navigation with no decorative transition.

### Events Leagues App

- Structure: the Events page leagues list renders from the shared `public-app` React bundle into `leaguesSection`; the React island fetches `/leagues` through the shared public API helper.
- Variants: hidden empty state, league card with name, league card with season/format metadata, and hash navigation into the existing league detail route.
- Spacing: reuses `.events-section-title`, `.leagues-grid`, `.league-card`, `.league-name`, and `.league-meta` so league standings keep the current compact Events rhythm.
- States: React owns fetch lifecycle, leagues heading, card list, metadata text, disabled no-id guard, and hash navigation; `events.html` must not fetch or publish the leagues list, contain a leagues-list DOM renderer, or dispatch `gvdg:events-leagues`.
- Accessibility: each league card is a real button with visible text and native disabled behavior when a league id is missing.
- Motion: preserves the existing league-card hover transform only.

### Events League Detail App

- Structure: the Events page league detail view renders from the shared `public-app` React bundle into `leagueDetailSection`; the React island consumes Events route requests and fetches `/leagues/:id` through the shared public API helper.
- Variants: matchplay team standings, standard player standings, empty standings, round list, red winner, blue winner, tie winner, and round hash navigation into event detail.
- Spacing: reuses `.detail-card`, `.detail-head`, `.detail-title`, `.detail-notes`, `.roster-title`, `.lb-wrap`, `.lb-table`, `.player-list`, and `.player-row` so league detail keeps the current detail-page rhythm and scroll-contained standings tables on mobile.
- States: React owns route-request handling, fetch lifecycle, loading/error status publication, last-updated clearing, back action, league metadata, table markup, team dots, round winner stripe classes, disabled missing-id guards, and event hash navigation; `events.html` must not fetch `/leagues/:id`, publish `gvdg:events-league-detail`, or contain a league-detail DOM renderer.
- Accessibility: table headers remain semantic, the back and round actions are real buttons, team dots are hidden from assistive tech, and winner color is reinforced by row placement and text context rather than color alone.
- Motion: preserves inherited card/button hover states only; the winner stripe is static and token-driven.

### Events Event Detail App

- Structure: the Events page event detail view renders from the shared `public-app` React bundle into `detail`; the React data hook handles event route requests and fetches `/events/:id`, final results, event extras, tee-sign data, and live snapshots.
- Variants: scheduled event facts, final results, matchplay final results, live leaderboard, live weather, UDisc assisted-entry cards, CTP list, ace-pot summary, player roster, official tee-sign photos, SVG tee-sign fallback, and red/blue/tie tee-sign winner states.
- Mobile tables: live matchplay standings use the `live-matchplay` compact table variant so team/member names wrap inside the detail card instead of depending on first-view horizontal scroll.
- Spacing: reuses `.detail-card`, `.detail-head`, `.detail-facts`, `.live-banner`, `.btn-keep-score`, `.lb-wrap`, `.lb-table`, `.player-list`, `.extras-list`, `.tee-signs-grid`, and `.ts-hole-card` so event detail keeps the established Events rhythm.
- States: React owns route-request handling, fetch lifecycle, loading/error status publication, last-updated clearing, live WebSocket/poll cleanup, the detail card, back action, badges, facts, live/final tables, extras, roster, UDisc disclosures through `src/shared/udisc-export.js`, tee-sign grid, weather strip placement, and score link text; `events.html` must not fetch event details, publish `gvdg:events-event-detail`, append detail DOM nodes, or load a root UDisc global helper.
- Accessibility: live and final standings remain semantic tables, links retain safe external attributes, player score links are anchors, weather wind controls come from the shared React strip, tee-sign photos have alt text, and SVG fallbacks expose image labels.
- Motion: preserves existing live-dot pulse, inherited button/card states, and compass arrow rotation only; no decorative motion is added.

### Events Previous Results App

- Structure: the Events page previous-results panel renders from the shared `public-app` React bundle into `previousResultsSection`; the React hub data module derives previous results from archived schedule-feed rows and archived club-scored events.
- Variants: empty state, collapsed summary, expanded grid, linked internal event result, linked external schedule result, status badge, load more, and show less.
- Spacing: reuses `.previous-results-*`, `.events-grid`, `.event-card`, `.event-meta`, and badge primitives so the panel keeps the existing compact Events rhythm.
- States: React owns previous-results derivation, expanded/collapsed state, visible result count, load-more/show-less controls, link attributes, and Lucide date/info/expand iconography; `events.html` must not publish `gvdg:events-previous-results`, write `window.__gvdgEventsPreviousResults`, or contain a previous-results DOM renderer.
- Accessibility: the summary control is a real button with `aria-expanded` and `aria-controls`; result cards remain anchors only when they navigate, and external links keep safe `rel` attributes.
- Motion: preserves the existing hover/focus transforms and no decorative animation.

### Events Club Content App

- Structure: the Events page fundraisers and meetings/minutes sections render from the shared `public-app` React bundle into `fundraisersSection` and `meetingsSection`; the React islands fetch `/fundraisers` and `/meetings` through the shared public API helper.
- Variants: no-content hidden state, active fundraiser cards, goal progress, safe markdown paragraphs/headings/lists/links, donation CTA, share actions, copy-link status, and meeting minutes cards.
- Spacing: reuses `.fundraiser-card`, `.fundraiser-title`, `.fundraiser-body`, `.fr-*`, `.donate-btn`, and `.events-section-title` primitives so club content keeps the same Events-page rhythm.
- States: React owns fetch lifecycle, active-fundraiser filtering, no-content hidden state, markdown rendering, progress bar width, donation/share links, copy-link status, and Lucide donation/share iconography; `events.html` must not fetch fundraisers/meetings, publish `gvdg:events-fundraisers`/`gvdg:events-meetings`, contain fundraiser/meeting DOM renderers, or contain markdown DOM helpers.
- Accessibility: fundraisers and meetings render as articles, donation/share actions are real links/buttons, copied status is visible text, and external links keep safe new-tab attributes.
- Motion: static content; only inherited hover/focus states apply.

### Events Registration App

- Structure: the Events page registration panel renders from the shared `public-app` React bundle into `registerSection`; the legacy Events script only requests refresh through `gvdg:events-registration-refresh` and keeps guest-token helpers for manage links and score links.
- Variants: no-open-registration hidden state, guest registration form, member registration form, division select, doubles pair label input, CTP/ace add-ons, registered member state, registered guest state, amount-due note, inline submit errors, and two-step withdraw confirmation.
- Spacing: reuses `.event-card`, `.register-card`, `.register-form`, `.reg-input`, `.register-addon`, `.reg-btn`, and `.events-grid` primitives so the panel keeps the existing compact Events rhythm.
- States: React owns loading open registrations, member registration lookup, guest registration storage updates, form values, busy states, inline errors, registration POST, withdraw DELETE, and session-expired guest fallback; `events.html` must not contain a registration card/form DOM renderer, and the static `registerSection` mount root must stay visually neutral so the no-open-registration state occupies no blank panel space.
- Accessibility: registration cards render as articles, inputs are native form controls, status/error copy is visible, errors use alert semantics, and date/registered iconography uses Lucide SVGs.
- Motion: no decorative motion; only inherited card/button hover and focus states apply.

### Ryder Cup Results App

- Structure: the Ryder Cup page body renders from the shared `public-app` React bundle into `ryderCupReactApp`, including title, league link, loading/error state, scoreboard, scoring note, weekly match cards, last-updated text, and home link.
- Variants: loading, retryable error, empty schedule, ready scoreboard, singles weeks, doubles weeks, unplayed matches, explicit winner, and tied matches.
- Spacing: reuses `.scoreboard`, `.team-panel`, `.week-section`, `.match-grid`, `.match-card`, `.status-box`, `.retry-btn`, `.last-updated`, and `.back-link` primitives so the published page keeps its established rhythm.
- States: React owns data fetch status, workbook-to-CSV fallback, quiet refresh, scoreboard visibility, week list rendering, retry behavior, and last-updated text; the page must not contain an inline Ryder Cup DOM renderer.
- Accessibility: loading uses status semantics, errors use alert semantics with a real retry button, the league and home actions are real links, and weekly results remain text content.
- Motion: only the existing spinner animation and inherited hover/focus states apply; no new decorative motion.

### Pro Shop App

- Structure: the Pro Shop page body renders from the shared `public-app` React bundle into `proShopReactApp`, including title, wallet summary, member order history, filters, product grid, cart, PayPal guest fields, checkout actions, and status messaging.
- Variants: signed-out wallet, loading wallet, ready wallet, wallet error, loading products, product-load error, empty filters, filtered product grid, empty cart, cart with quantity steppers, guest PayPal checkout, member store-credit checkout, SDK PayPal checkout, order history, and checkout success/error messages.
- Spacing: reuses `.shop-head`, `.wallet-panel`, `.my-orders-panel`, `.shop-shell`, `.filters`, `.product-grid`, `.product-card`, `.cart`, `.cart-row`, `.paypal-fields`, `.payment-divider`, and `.shop-status` primitives so the page keeps its established compact storefront rhythm.
- States: React owns API fetch status, filters, product sorting, cart quantities, stock pruning, wallet and order rendering, PayPal SDK mounting, keyed PayPal host replacement, store-credit checkout, PayPal redirect checkout, PayPal capture, and status tone; the page must not contain an inline Pro Shop DOM renderer or manually clear payment-host children.
- Accessibility: filters use real form controls, product and cart actions are real buttons with quantity labels, status messages use polite status semantics, order tracking uses real links, and product fallbacks expose an image label without emoji.
- Motion: only existing product hover and inherited button states apply; third-party PayPal rendering is isolated to its host.

### Blog App

- Structure: the Blog page body renders from the shared `public-app` React bundle into `blogReactApp`, including the page hero, coming-soon card, progress indicator, and home link.
- Variants: default coming-soon state, animated progress fill, animated Lucide disc mark, and home navigation.
- Spacing: reuses `.page-hero`, `.construction-section`, `.construction-card`, `.progress-*`, and `.back-btn` so the page keeps the current centered public-page rhythm.
- States: React owns all Blog body markup and Lucide iconography; `gvdg-blog.html` must not keep static hero/construction body sections or emoji disc decoration.
- Accessibility: the home action is a real link, the disc mark is decorative SVG hidden from assistive tech, and the page keeps visible heading hierarchy.
- Motion: preserves the existing card entrance, progress-fill, shimmer, and disc rotation animations only.

### Tee-Sign Preview App

- Structure: the tee-sign preview page renders from the route-specific `tee-sign-preview-app` React bundle into `teeSignPreviewReactApp`, including title, theme toggle, and sample SVG preview grid.
- Variants: light theme, dark theme, two-layout sample, three-layout sample, missing-distance sample, and narrow mobile scaling.
- Spacing: uses the project page max width, `1rem-1.5rem` control/grid gaps, 8px control radius, and existing tee-sign SVG classes so the utility stays compact and scannable.
- States: React owns the theme toggle, persisted theme value, sample list rendering, and SVG element rendering through the shared `TeeSignSvg` component; the pure tee-sign model lives in `src/shared/tee-sign-model.js`, and admin scoring imports the shared React `TeeSignSvg` component directly for generated tee-sign fallbacks. There is no root `tee-sign.js`; the HTML preview and admin pages must not contain inline tee-sign DOM renderers, `window.teeSignNode`, or browser DOMParser mount paths.
- Accessibility: the theme control is a real button with pressed state and Lucide iconography; React-rendered SVGs retain their role and label from the shared tee-sign renderer.
- Motion: no decorative motion; only inherited button hover/focus states apply.

### Home Interaction Hooks

- Structure: homepage carousel, swipe, reveal, and counter behavior lives inside the React components that render those surfaces, with shared helpers in `src/home-app/interaction-hooks.js`; the homepage keeps only the head pre-paint theme script inline.
- Variants: hero previous/next/dot controls, hero swipe, hero auto-advance/pause, about carousel, courses carousel/header arrows, component-scoped reveal-on-scroll, stat counter animation, and CSS smooth in-page anchors.
- Spacing: reuses the existing `.carousel-*`, `.about-carousel-*`, `.courses-carousel-*`, `.fade-in`, `.visible`, and `.stat-*` primitives so the public homepage layout is unchanged during the behavior migration.
- States: the rendering component owns its active slide, active indicator, disabled arrow, height sync, reveal, and counter state through React state/effects/refs; `index.html` must not keep `homeReactInteractionsApp`, and `src/home-app/page-interactions.js` must not exist as a selector-driven null controller.
- Accessibility: carousel state keeps active indicators marked with `aria-current`; controls remain real buttons and links.
- Motion: preserves existing opacity, transform, count-up, and smooth-scroll behavior only.

### Tournament Item

- Structure: date badge, event metadata, arrow icon.
- Variants: hidden-mobile, expanded.
- Spacing: `0.75rem-1.25rem` padding depending on viewport.
- States: hover translates on desktop; toggle expands hidden mobile rows.
- Accessibility: external links include `rel="noopener"`.
- Motion: transform and opacity only.

### Toggle Button

- Structure: text span plus chevron icon.
- Variants: collapsed, expanded.
- Spacing: `0.75rem 1.5rem`.
- States: hover fills with `--primary`; expanded rotates icon.

### Member Page Chrome

- Structure: React-owned fixed header with logo link, shared public nav links, donate link, mobile menu control, and theme toggle mounted into `membersReactPageChrome`.
- Variants: desktop inline nav, mobile collapsed nav, open mobile nav, light theme, and dark theme.
- Spacing: preserves the existing member page `header`, `nav`, `nav-right`, `nav-links`, `theme-toggle`, and `menu-toggle` primitives so the chrome keeps the same fixed-header rhythm.
- States: React owns menu expanded state, current-page nav state, external donate link, and `data-theme` persistence; the member page does not load `nav.js` or mutate header nodes with query selectors.
- Accessibility: menu and theme controls are real buttons with labels, `aria-expanded`, and Lucide icons; current page uses `aria-current="page"`.
- Motion: mobile menu reveal uses the existing transform/opacity transition; icon changes do not resize controls.

### Member Dashboard Shell

- Structure: React-owned auth gate, bundled auth/session controller, title, tablist, welcome/logout banner, admin portal link, overview, account tools, event registration, board, tee-sign capture, and club panels mounted into stable HTML wrappers.
- Variants: login, forced-PIN, profile setup, overview, events, board, tee signs, and club tabs; auth/account tools dispatch credential, passkey, profile, and logout events while bundled member auth modules perform the secure flows.
- Spacing: dashboard wrappers keep the existing `my-dashboard`, `club-register`, `club-board`, and `tee-capture` surfaces so migrated panels retain the same mobile rhythm; the welcome banner uses the established green banner primitive and stays compact on phones.
- States: migrated legacy fallback nodes must be absent, not hidden; the static page keeps only class-based shell wrappers plus `membersReactAuthGate`, `membersReactDashboardApp`, and document-level roots, with no `loginGate` or `membersContent` ids; auth API configuration lives on `body[data-auth-base]`; auth mode is driven by `gvdg:member-auth-mode`; the React auth gate owns page-level `data-member-shell` visibility through `gvdg:member-shell-view`; the bundled auth controller owns `gvdg:member-auth-ready`, `gvdg:member-profile-updated`, and login/session events; member dashboard context is module-local inside the members bundle instead of stored on `window.GVDG_MEMBER_DASHBOARD_CONTEXT`; auth form values, errors, and submit/passkey/profile busy labels render from React-owned `gvdg:member-auth-form-state` events and submit payloads rather than DOM input/text/class/button writes; the dashboard shell and all dashboard panel wrappers render from one `membersReactDashboardApp` root, with panel presence revealed through rendered-content CSS (`:not(:empty)`) instead of readiness class mutations or separate panel roots; add-passkey progress/status and profile-photo preview visibility render from React-owned `gvdg:member-passkey-state` and `gvdg:member-profile-preview` events rather than DOM text/button/image writes; event-registration PayPal buttons use a keyed React host for SDK rendering instead of clearing children manually; the dashboard router only publishes tab events from a module-local install guard, while the React dashboard shell owns `data-member-dashboard-tab`, wrapper visibility, selected-tab UI, and smooth scroll through a component ref; individual panels do not imperatively reveal their parent wrappers; the admin portal link renders only on the overview tab for admin members.
- Accessibility: React tabs expose `role="tab"` and `aria-selected`; auth, profile, logout, and account actions are real buttons/forms with preserved labels.
- Motion: tab changes are immediate and should not resize fixed controls or introduce horizontal overflow.

### Member Dashboard Dialogs

- Structure: React-owned document-level modal renderer for member dashboard alerts and confirmations mounts into the static `membersReactDialogsApp` root; separate dashboard roots call a shared dialog service instead of native browser dialogs.
- Variants: neutral alerts, destructive confirmations, cancel action, confirm action, Escape dismissal, and backdrop dismissal.
- Spacing: centered modal uses `--bg-secondary`, `--border-color`, `--shadow`, compact actions, and full-width stacked actions on narrow phones.
- States: one dialog is shown at a time; queued requests resolve in order; destructive confirmations use the primary-strong CTA treatment.
- Accessibility: dialogs expose `role="dialog"`, `aria-modal`, labelled title/body, and real action buttons.
- Motion: static modal; no layout animation.

### Dashboard Rating Panel

- Structure: panel header with category label/count and a prominent live rating, followed by compact per-round rows; PDGA Recent Tournaments cards use a one-column grid with a title/date block, then a labeled full-width rating row so long tournament names cannot force ratings into a side column. Escaped PDGA event-name entities are decoded to safe React text before rendering.
- Variants: competitive and casual; both use the same primitive so histories stay visually separate but comparable.
- Spacing: `0.75rem-1rem` panel padding, `0.6rem` row gaps, single column on mobile and two columns on tablet/desktop.
- States: empty state text inside each panel; rows remain stable with or without UDisc export actions.
- Accessibility: each panel is labelled by its category heading.
- Motion: static display; no layout-shifting animation.

### Member Directory Panel

- Structure: stat cards, membership growth chart, search/filter controls, paginated member card grid, and count status.
- Variants: all members, founding members, PDGA members, empty search results, and load-more state.
- Spacing: reuses dashboard card spacing with a single-column mobile grid and responsive multi-column desktop cards.
- States: filter buttons expose pressed state; count text updates through a polite status region.
- Accessibility: member search has an explicit label, external PDGA links use safe new-tab behavior, and chart bars expose per-year labels.
- Motion: static except existing card hover transforms.

### Meeting Minutes Accordion

- Structure: dated minutes list with badge, expandable section groups, action-item callout, and download link.
- Variants: expanded, collapsed, empty, and new-badge minutes.
- Spacing: compact `meeting-minutes-*` primitives keep long minutes readable inside the dashboard surface.
- States: accordion headers use real buttons with `aria-expanded`.
- Accessibility: section titles remain text, the download action is a real link, and iconography is decorative.
- Motion: only the chevron rotation communicates expand/collapse state.

### Doubles League Panel

- Structure: quick stats, tabbed records views, champions grid, searchable/sortable all-time leaderboard, season-results table, and player-detail modal.
- Variants: champions, all-time leaders, season results, filtered player search, paged leaderboard, and selected-player modal.
- Spacing: reuses `doubles-*` dashboard primitives with dense tables, scroll-safe wrappers, and responsive champion cards.
- States: tab buttons expose selected state, sortable headers use button controls, load-more updates the visible row count, and player rows open modal details.
- Accessibility: tabs use tab roles, table sort state is exposed through `aria-sort`, modal close has an explicit label, and search has an accessible label.
- Motion: static data display; the modal and existing hover treatments must not shift surrounding layout.

### Score App Shell

- Structure: sticky topbar with fixed square logo, truncating title/subtitle, members shortcut, leaderboard control, and theme toggle.
- Variants: home/setup state hides leaderboard; live card state shows leaderboard and replaces the subtitle with course/layout context. Live casual rounds also use a compact `Share / Add / Manage` tools row below the topbar.
- Spacing: compact mobile-first controls at `38px-40px`, with gaps from the tight/compact spacing scale.
- States: React owns title, subtitle, leaderboard visibility/click handling, active body view rendering, and theme toggling; the score controller only publishes body-view props through the shell body renderer and must not create separate roots or replace `#app` children. Icon buttons use stable dimensions and active transform only; hidden controls must not reserve layout space.
- Accessibility: action controls expose text labels through `aria-label`, `title`, or visually hidden text; icons are decorative.
- Motion: static except for the existing active press scale.

### Score Setup Flow

- Structure: stacked cards for home, course pick, layout pick, and casual round setup, rendered as React components inside the existing score app shell; the score controller only dispatches setup view state and callbacks.
- Variants: empty course/layout states, selected setup options, and back navigation.
- Spacing: reuses `.card`, `.stack`, `.tap-row`, `.setup-grid`, and `.setup-option` primitives from the score app.
- States: setup options use `aria-pressed` and tokenized borders/backgrounds for selected state; legacy setup fallback nodes must be absent, not hidden.
- Accessibility: course/layout rows and setup options are real buttons; join-code entry submits on Enter.
- Motion: no decorative animation; navigation is immediate and preserves the existing active press feedback.

### Score Auth Flow

- Structure: React-owned login and forced-PIN cards mounted in the score app shell; the score controller supplies auth, passkey, guest, and set-PIN callbacks only.
- Variants: member login, passkey-supported login, guest-token continuation, forced PIN change, pending submit states, and inline errors.
- Spacing: reuses `.card`, `.stack`, `.field`, `.lbl`, `.btn`, `.muted`, and `.return-members`; auth errors use the score conflict color token.
- States: submit buttons disable while pending; validation errors render in a polite inline error row; successful auth leaves the auth renderer through the normal boot path.
- Accessibility: login and PIN inputs are labelled, forms submit on Enter, errors use alert semantics, and passkey support uses a Lucide icon with text.
- Motion: static card flow; only existing button active states apply.

### Score Leaderboard Sheet

- Structure: React-owned bottom sheet overlay with grab handle, leaderboard table, optional UDisc export disclosure, finalize status panel, and close action mounted into static `scoreReactLeaderboardSheetApp`; the score controller supplies standings, blockers, export data, and callbacks only.
- Variants: empty leaderboard, singles/player rows, doubles/pair rows, stroke to-par result, matchplay status result, final round, ready-to-finalize, blocked finalize, and casual round finish action.
- Spacing: reuses `.overlay`, `.sheet`, `.lb`, `.btn`, and finalize sheet primitives from the score app; finalization details use compact rows and stay within the sheet scroll area.
- States: overlay backdrop click and close button dismiss the sheet by clearing the static React root; live snapshots re-render the React sheet when open; finish button is disabled until the card has no conflicts or missing confirmations. Finalize blockers and UDisc export payloads are derived in `src/score-app/score-view-model.js`, leaving the controller responsible for side effects and callbacks only.
- Accessibility: close and finish actions are real buttons; table headers label rank/player/thru/result columns; the shared UDisc export disclosure is React-owned and uses a real outbound link.
- Motion: bottom sheet remains static; only existing button active states apply.

### Score Manage Players Sheet

- Structure: React-owned bottom sheet overlay with grab handle, player rows, optional doubles pair editor, and close action mounted into static `scoreReactManagePlayersSheetApp`; the score controller supplies players, scoring mode, and save/remove callbacks only.
- Variants: singles remove list, doubles pair labels, current-player leave action, other-player remove action, and live re-render when cardmates change while the sheet is open.
- Spacing: reuses `.overlay`, `.sheet`, `.card`, `.stack`, `.prow`, `.btn`, and `.field` primitives; pair inputs are compact grid labels inside an inset card.
- States: overlay backdrop click and close button dismiss the sheet by clearing the static React root; saving pairs closes only after the server accepts; remove/leave prompts confirm before closing and posting.
- Accessibility: pair fields use real labels, remove/leave/close/save are real buttons, and no icon-only actions appear in this management sheet.
- Motion: static bottom sheet; button active states use the existing score app press feedback.

### Score Dialogs

- Structure: React-owned document-level modal renderer for score prompts and confirmations mounts into the static `scoreReactDialogsApp` root; the score controller supplies dialog copy and awaits resolved values only.
- Variants: add-player prompt, doubles pair-label prompt, finish-round confirmation, and remove/leave danger confirmation.
- Spacing: reuses `.overlay`, `.sheet`, `.field`, `.lbl`, `.btn`, `.muted`, and compact modal actions; dialogs center in the viewport and stay within safe-area padding.
- States: overlay click, Escape, and cancel resolve without side effects; required prompt fields show inline errors; danger confirmations use the score conflict token.
- Accessibility: dialogs expose `role="dialog"`, `aria-modal`, labelled title/body, autofocus prompt inputs, and real submit/cancel buttons.
- Motion: static modal; only existing button active states apply.

### Scorecard View

- Structure: React-owned live hole screen with Round Weather, casual-round tools, hole navigation, optional tee-sign card, scorecard selector, player/pair steppers, totals bar, and hole jump grid; the score controller supplies derived rows and callbacks only.
- Variants: event card, casual round with share/add/manage tools, singles rows, doubles pair rows, matchplay status, dormie badge, tee-sign highlight, score conflicts, score-target warning, completed holes, and current-hole states.
- Spacing: reuses `.weather-strip`, `.round-tools`, `.hole-head`, `.tee-sign-card`, `.scorecard-owner`, `.prow`, `.stepper`, `.totbar`, and `.holegrid` primitives so the migrated view keeps the existing mobile rhythm.
- States: scorer changes, hole navigation, jump-grid taps, plus/minus steppers, and weather refreshes rerender through React; compass updates use the shared weather subscription helpers. `src/score-app/score-view-model.js` derives scorecard choices, player/pair rows, current scores, relative labels, conflicts, totals, hole-grid state, match status, finalize blockers, and UDisc export data so React-facing state is pure and testable.
- Accessibility: navigation and score steppers expose action labels, scorer selection has a label, tool buttons pair Lucide icons with text, and hole jump buttons expose hole labels.
- Motion: static layout; only existing active press feedback and weather wind-arrow rotation apply.

### Matchplay Winner Colors

- Structure: score and public event detail bundles import pure winner helpers from `src/shared/matchplay-colors.js`; public HTML shells must not load `matchplay-colors.js` or depend on `window.GVDGMatchplay`.
- Variants: red winner, blue winner, tie winner, undecided hole, scoring-app tie suppression, and direct shared-module imports for tests/manual imports.
- Spacing: no layout effect; the helpers only supply existing tee-sign and result color values.
- States: live scorecard tee-sign highlights and event-detail tee-sign/result highlights derive colors through bundled imports so cache and load order stay tied to the owning app bundle.
- Accessibility: color remains supplemental to text/tables; winner labels and score rows stay visible text.
- Motion: no motion.

### Score Status View

- Structure: React-owned loading state and blocking message card mounted in the score app shell; the score controller supplies retry and leaderboard callbacks only.
- Variants: spinner, retryable error, informational blocker, and leaderboard shortcut.
- Spacing: reuses `.center`, `.spin`, `.card`, `.stack`, `.section`, `.muted`, and `.btn` primitives.
- States: retry buttons call the normal boot path; leaderboard shortcut opens the React-owned leaderboard sheet.
- Accessibility: loading uses a status role, message actions are real buttons, and Lucide icons are decorative.
- Motion: spinner uses the existing rotation animation; no other motion is added.

### Score Notifications

- Structure: React-owned document-level notification mount in static `scoreReactNotificationsApp` for transient toasts, scoring-conflict alerts, offline-sync rejection alerts, and the offline bar; the score controller supplies notification messages and online state only.
- Variants: default bottom toast, top conflict alert, rejected offline-score alert, and persistent offline bar.
- Spacing: reuses `.toast`, `.toast.conflict`, and `.offline-bar`; icon-to-text gaps use the tight spacing scale.
- States: toasts fade out on timers and dismiss on tap; conflict alerts stay longer, stack below the offline bar when needed, and use the score conflict token; offline state persists until connectivity returns.
- Accessibility: transient notices use status or alert roles according to severity, and icons are decorative Lucide symbols rather than emoji.
- Motion: opacity fade only; no layout animation.

### Round Weather

- Structure: compact header, primary temperature/condition group, condition graphic, wind action, secondary meta pills, and course-location note.
- Variants: pending/unavailable states use a single empty message; live weather promotes condition, feels-like temperature, a graphic condition cue, and wind while keeping humidity, precipitation, and changes secondary.
- Spacing: condition and graphic share the first row on narrow phones with wind below; condition, graphic, and wind form a compact three-part row above `420px`.
- States: the score app and Events live detail render Round Weather through React using direct imports from `src/shared/weather-model.js`; public HTML shells must not load a standalone weather script or depend on a `GVDGWeather` global. Wind starts `North-up`, moves through `Listening...`, and changes to `Phone-relative` when device orientation produces a heading.
- Accessibility: wind is a real button with an arrow title/label that explains whether the arrow is north-up or phone-relative; the condition graphic is a labeled image cue and does not replace the text condition.
- Motion: only the wind arrow rotates, using a short transform transition.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | `0.2s` | ease | Toggle hover and small state changes |
| Standard | `0.3s` | ease | Card hover, menu, carousel controls |
| Reveal | `0.6s` | ease | Section and fade-in entrances |

### Rules

- Animate `transform`, `opacity`, and color changes.
- Existing carousel, reveal, and hover behavior should be preserved.
- Do not remove loading, empty, or error feed states to simplify scripts.

## 7. Depth & Surface

### Strategy

Depth is mixed: soft shadows for elevated cards/sections, borders for cards and controls, and tonal shifts for dark mode.

| Level | Value | Usage |
|-------|-------|-------|
| Border | `1px-2px solid var(--border-color)` | Cards, controls, modals |
| Section shadow | `0 10px 40px var(--card-shadow)` | Main section panels |
| Hover shadow | `0 10px 30px var(--card-shadow-hover)` | Interactive cards |
| Modal shadow | `0 20px 60px rgba(0, 0, 0, 0.3)` | Modal overlays |

### Rules

- Use borders and shadows together only where the existing pattern already does.
- Dark mode relies more on tonal surfaces and lower-contrast borders.
