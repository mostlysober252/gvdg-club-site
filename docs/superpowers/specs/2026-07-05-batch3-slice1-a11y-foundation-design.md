# Batch 3 · Slice 1 — Accessibility Foundation: Accessible Modal + Live Announcer

- **Date:** 2026-07-05
- **Status:** Approved design, hardened by adversarial review (24 gaps folded in) → pending user re-review → implementation plan
- **Part of:** Batch 3 (accessibility UI kit), shipped foundation-first in 3 slices.

## 1. Context & Goal

GVDG is a vanilla HTML + plain-JS static site (no framework, no front-end build).
There is **no shared UI-component layer** — every page inlines its own modal/toast
markup and JS, so a11y patterns are duplicated and inconsistent. `tokens.css` is the
shared design-token layer; Batch 2 planned a shared `api.js` (`window.GVDGApi`).
Slice 1 adds the analogous shared **accessibility** layer.

**Slice 1 delivers:**
1. `a11y.js` (`window.GVDGa11y`): an accessible-modal **decorator** + a **live-region announcer**.
2. Migration of the site's **3 real modal/overlay surfaces** onto it.
3. Routing `score.html`'s toasts/alerts through the announcer.

**Non-goals (Slice 2/3):** full cards→buttons sweep, `role="tablist"` semantics,
skip links + landmarks, form-label audit. Slice 1 makes keyboard-operable **only the
triggers of the 3 modals it migrates**.

## 2. Current state (verified)

| Page | Surface | Overlay / Panel | Rebuild model | Gaps |
|------|---------|-----------------|---------------|------|
| `index.html` | Course modal | `.course-modal-overlay#courseModal` / `.course-modal` | injected once via `insertAdjacentHTML`; `opacity/visibility` hidden until `.active` | click-only `<div>` triggers; no role/aria-modal/trap/focus-return |
| `gvdg-members.html` | Player modal | `.player-modal-overlay#playerModalOverlay` / `.player-modal` | created lazily **once**, then reused (`display:none`→`.active`) | `<tr>` trigger (L2913); glyph-only `×` close; no Escape/trap/focus-return |
| `score.html` | Leaderboard **bottom-sheet** + **Manage** | `.overlay` / `.sheet` | **rebuilt WHILE OPEN** on every WS snapshot (`if(lbOpen) renderLeaderboard()` L557/936/939) | no role/aria-modal/Escape/trap/focus-return |
| `score.html` | Toasts + `conflictAlert` | `.toast` / `.toast.conflict` | appended to body | **no `aria-live`** → silent to SR (live-scoring flow) |

Good patterns to preserve: `pro-shop #shopStatus` and `gvdg-members #boardStatus`
already use `role="status" aria-live="polite"`. **No `.sr-only` class exists** anywhere.
`crotts.js` (deferred, injects fixed `#crotts-fab` z-9998 bottom-left + `#crotts-panel`
z-9999) currently loads on **7 pages**: `index, gvdg-blog, events, ryder-cup, pro-shop,
gvdg-members, admin` (not score.html). See §4a for the placement change.

## 3. Architecture

### 3.1 Module `a11y.js` → `window.GVDGa11y` — loading

Plain IIFE, no build step, freezes a namespace on `window`. **Loaded synchronously in
`<head>` after `tokens.css` and before any inline page script** —
`<script src="a11y.js"></script>` **with NO `defer`** (page modal IIFEs run during
parse and reference `GVDGa11y` synchronously; a deferred script would be undefined).
Precached by the service worker. a11y.js injects its own visually-hidden CSS and a
z-index contract; it must be CSP-safe (external file, no inline handlers) and contain
**no raw hex** (tokens only; hex-lint applies).

Public API:
```js
GVDGa11y.makeDialog(overlayEl, {
  panel,               // inner titled box; default overlayEl.querySelector('[data-dialog-panel]') || first element child
  labelledBy,          // id naming the dialog → aria-labelledby (on the PANEL)
  label,               // REQUIRED static fallback accessible name (e.g. 'Live leaderboard')
  onOpen, onClose,     // lifecycle; onClose is where the caller may remove/hide its overlay
  closeOnBackdrop = true,
  initialFocus,        // default: the panel heading (given tabindex=-1), else the panel — never "first focusable"
  returnFocus,         // explicit fallback opener if the captured opener is detached at close time
}) // → { open(), close(), isOpen(), destroy(), setContent(fn) }

GVDGa11y.announce(message, { assertive = false })
```

### 3.2 `makeDialog` — decorate + isolate (the contracts)

Semantics go on the **inner panel**, isolation/backdrop on the **overlay**.

**Accessible naming (both, always).** On the panel: `role="dialog"`,
`aria-modal` (see isolation gate), `tabindex="-1"`, `aria-labelledby=labelledBy` **and**
`aria-label=label` as fallback. If the `labelledBy` target is empty/absent at open time,
drop `aria-labelledby` and keep `aria-label` (never emit an empty `aria-labelledby`).

**Visibility-before-focus ordering contract.** The **caller** makes the panel visible
(add `.active` / set `display`) **before** calling `open()`. `open()` verifies
`panel.offsetParent !== null`; if not visible it warns and defers the focus move to the
next frame rather than focusing an invisible element.

**Isolation with feature-detect + fallback.** At load: `HAS_INERT = 'inert' in HTMLElement.prototype`.
On `open()`, isolate every **direct child of `<body>`** except the overlay, the announcer
container, and (future) the skip-link, recording the exact node set applied:
- `HAS_INERT` → set the `inert` attribute on each.
- else (iOS Safari < 15.5 and other old engines — the aging on-course field devices) →
  **fallback:** snapshot each node's prior `aria-hidden`/`tabindex`, then set
  `aria-hidden="true"` + `tabindex="-1"`; restore the snapshot on close.

`aria-modal="true"` is set **only if an isolation mechanism actually took effect** (never
advertise "modal" without isolation). While open, a `MutationObserver` on `<body>` applies
the same isolation to **newly-added** direct children (except the announcer) — covers the
deferred `#crotts-fab` on index/members and any late toast/offline bar; behavior must not
depend on script load order.

**Focus in.** After visibility: move focus to `initialFocus` → the panel heading
(`labelledBy` target, given `tabindex="-1"`) → the panel. **Also call
`announce(accessibleName, {assertive:true})`** so iOS VoiceOver (which does not follow
programmatic `focus()` or reliably honor `aria-modal`) hears the dialog open.

**Close wiring.** `Escape` (keydown on the panel) → `close()`; backdrop click (target === overlay,
when `closeOnBackdrop`) → `close()`. makeDialog **owns** these; callers must not add their own.

**Atomic teardown.** `close()` order, isolation-clear FIRST and in `try/finally`:
1. remove Escape/backdrop listeners + the MutationObserver;
2. **clear isolation** (remove `inert` / restore the aria-hidden+tabindex snapshot from the
   stored set) and **restore scroll** — wrapped so a later throw cannot leave the page bricked;
3. `onClose()` (own `try/catch`);
4. **return focus**: to the captured opener iff `opener.isConnected` and focusable; else
   `returnFocus` (verified natively focusable or `tabindex`); each in its own `try/catch`.

**Single-instance & re-render-while-open contract.**
- A module-level `activeDialog` is tracked. `open()` is a **no-op** if this dialog is already
  open, and **refuses** (warn, no-op) if a *different* dialog is open — no concurrent modals
  (resolves the nested-modal policy).
- A dialog that re-renders **while open** MUST swap only the panel's inner children
  (`setContent(fn)` → `panel.replaceChildren(...)`) — it must **not** tear down the overlay
  or call `open()` again. This preserves the captured opener, the saved scroll position, and
  the applied-isolation set.

**Idempotency & guards.** `makeDialog(null)` → warn + return a no-op controller (never throw
inside a render path). Decoration is marked with `data-a11y-dialog`; re-invoking on an
already-decorated overlay returns the existing controller (no duplicate listeners). Snapshot
excludes the announcer/skip-link **by object reference** with null-guards (they may not exist yet).

**bfcache / navigation cleanup.** a11y.js registers global `pagehide` and
`pageshow` (`event.persisted`) and `visibilitychange` handlers that force-clear any active
dialog's isolation + restore scroll, so a back/forward-cached page never returns frozen.
(The index course-modal action links are `target="_blank"` → new tab, so they do not freeze
the current tab, but same-tab back/forward is covered defensively.)

### 3.3 `announce` — singleton dual live region

a11y.js injects **one** visually-hidden container styled by its **own** injected CSS
(clip technique: `position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0`)
— **explicitly not** `display:none`/`visibility:hidden` (which suppress announcements).
It holds two regions: `aria-live="polite"` and `aria-live="assertive"`, both
`aria-atomic="true"`; excluded from isolation. `announce(msg,{assertive})`:
- writes to the matching region using **clear-then-set with a real delay** (`setTimeout`
  ~120–150 ms, not rAF-only — iOS VO coalesces same-runloop mutations and drops the re-announce);
- maintains a small **FIFO queue per region** so multiple distinct messages in one frame
  serialize instead of overwriting (e.g. a "Synced" and a conflict emitted together);
- re-announces identical consecutive strings (score "saved" repeats).
- Must use no `Date.now()`/`Math.random()`.

## 4. Per-page migration

**Global (all 3 pages):** add the sync `<script src="a11y.js">` in `<head>` after `tokens.css`.
Add a shared `:focus-visible` ring (token-colored, no raw hex) to every trigger made
keyboard-operable; where `overflow:hidden` clips an outline (`.course-card`, L164) use an
inset `box-shadow` ring instead.

**`index.html` (course modal).** `makeDialog('.course-modal-overlay', { panel:'.course-modal', labelledBy:'modalCourseName', label:'Course details' })`. Populate content **before** `open()`. Triggers: `.course-card[data-course]` `<div>`s → `role="button"`, `tabindex="0"`, Enter (keydown) + Space (keydown `preventDefault`, ignore `e.repeat`, activate on keyup). Delete the inline `classList.remove('active')` + backdrop close handlers (makeDialog owns them). Disabled option links (`.course-modal-btn.disabled`, `href="#"`) → `aria-disabled="true"` + `tabindex="-1"`.

**`gvdg-members.html` (player modal).** Build the controller **once** when `#playerModalOverlay` is first created: `makeDialog('.player-modal-overlay', { panel:'.player-modal', labelledBy:'playerModalName', label:'Player stats' })`; `showPlayerModal()` fills content then calls `controller.open()`. Add `id="playerModalName"` to `.player-modal-name`. `#modalCloseBtn` (`&times;`): add `aria-label="Close"` and wrap the `×` glyph in `aria-hidden="true"`. Trigger is a `<tr>` (L2913): add `tabindex="0"` + Enter/Space keydown handler **without** `role="button"` (preserve row/cell table semantics). Delete the inline `.active` removal handlers.

**`score.html` (leaderboard sheet + Manage).** Refactor so `openLeaderboard()` builds the `.overlay/.sheet`, adds `id="lbSheetHeading"` to the sheet `<h2>`, and calls `makeDialog(overlay,{ panel:'.sheet', labelledBy:'lbSheetHeading', label:'Live leaderboard', onClose:()=>{overlay.remove(); lbSheet=null; lbOpen=false;} }).open()` **once**; `renderLeaderboard()` becomes `controller.setContent()` and only replaces the panel's inner children while open (never `lbSheet.remove()`+rebuild, never re-`open()`). Same pattern for `openManagePlayers` (its own heading id + `label:'Manage players'`). Route `closeLeaderboard`, both Close buttons, and every Manage close/save/remove path exclusively through `controller.close()` (no direct `.remove()`). `initialFocus` = the sheet heading (`tabindex=-1`), so focus never lands on "🏁 Finish round". Openers `#lbBtn`/`Manage`: `#lbBtn` is stable; for Manage (opener detached by `app.replaceChildren` on snapshot) add `tabindex="-1"` to `<main id="app">` and pass `returnFocus:'#lbBtn'`.

## 4a. Crotts assistant placement (new requirement)

Crotts should appear **only on non-member/public surfaces** and must **never impede
controls or obscure scoring**.

- **Remove** `<script src="crotts.js" defer></script>` from the member/admin surfaces:
  **`gvdg-members.html`** and **`admin.html`** (score.html already has none). This also
  eliminates the deferred-FAB-over-modal escape-hatch on those pages entirely.
- **Keep** on the public pages: `index.html`, `gvdg-blog.html`, `events.html`,
  `ryder-cup.html`, `pro-shop.html`. (pro-shop/events carry member controls but the FAB is
  bottom-left and content controls are in-flow; the yield rule below covers any overlap —
  flag for user if either should also drop Crotts.)
- **Yield to overlays** (on the pages that keep it): while any `GVDGa11y` dialog is open,
  hide `#crotts-fab`/`#crotts-panel` (a `body.dialog-open` class toggled by makeDialog, or a
  direct hide in `onOpen`/`onClose`) so the FAB never paints over or blocks a modal; and the
  z-index token scale (§6) keeps overlays above the FAB as a backstop. On the public pages
  that keep Crotts, makeDialog's MutationObserver still isolates the late-injected FAB for the
  duration a modal is open (index course modal).

## 5. Live-region toasts/alerts in `score.html`

Rule: **every visible toast/alert string gets a matching `announce()`** — not just
`toast()` call sites. In particular `conflictAlert()` and the offline-rejection block build
`.toast.conflict` divs **directly** and must `announce(…, {assertive:true})`.

- **assertive:** scoring conflict alert, offline-rejected score, `403` own-card, `401`
  session-expired, `409` round-not-live, "Card changed — open Manage again", "Couldn't finish the round".
- **polite:** synced, score added/removed, pairs saved, link copied, round finished,
  "Choose a scorecard", `429`, "Enter a valid code", doubles pair-label, add/remove/pairs errors, generic save failure.

Keep the visual `.toast`. `pro-shop`/`gvdg-members` status regions already announce — untouched.

## 6. Cross-cutting fixes (confirmed)

- **iOS scroll-lock (score sheet):** on open save `scrollY`, set body `{position:fixed; top:-scrollY; left:0; right:0; width:100%}`; on close remove and `window.scrollTo(0, scrollY)`. Add `overscroll-behavior:contain` to the **`.sheet`** scroll container; change `.sheet max-height:82vh → 82dvh` with a `vh` fallback. (Drop the earlier spurious `--safe-*` coupling.)
- **`prefers-reduced-motion`:** gate score.html's JS-set toast/transition (`t.style.transition`, `.toast.conflict`, course-modal scale) behind `matchMedia('(prefers-reduced-motion: reduce)')`; add the global reduced-motion reset (present in index.html L321/347) to **score.html** and **gvdg-members.html**.
- **z-index contract:** add a z-index token scale to `tokens.css` (FAB < overlay < panel < toast/announcer) and reference it from the overlay + toast + Crotts CSS so overlays always sit above the `#crotts-fab`/`#crotts-panel` (z-9998/9999) and alerts layer predictably over modals.

## 7. Service worker & deploy

- Add `a11y.js` to `sw.js` `ASSETS`; bump `CACHE` `v17` → `v18`.
- Add the sync `<head>` `<script>` to `index.html`, `gvdg-members.html`, `score.html`.
- Remove the `crotts.js` script tag from `gvdg-members.html` and `admin.html` (§4a); `admin.html` gets no a11y.js (no migrated modal there in Slice 1) but is touched by the Crotts removal — bump `sw.js` accordingly and re-verify admin still loads.
- Document `window.GVDGa11y` (makeDialog + announce, the isolate-body-children model, the sync load-order rule) in `DESIGN.md`.
- Frontend-only → **full** deploy via `./scripts/gvdg-deploy.sh` (self-gates static tests + hex-lint + worker typecheck). Push `origin/main` **before** deploy (shared-main freshness gate).

## 8. Testing & live-verification

**Reality:** the only devDep is `playwright`; `tests/*.mjs` are `readFileSync`+regex over
HTML source under `node --test`. Runtime behavior (inert/focus/Escape) **cannot** be asserted there.

- **Static (deploy-gated) — `tests/a11y.test.mjs` + extend `tests/score-page.test.mjs`:** source-structure checks only — a11y.js defines `makeDialog`+`announce`; each page loads the **sync** (non-defer) `a11y.js` in `<head>`; legacy `.active`/`.remove()` close handlers are gone from the 3 pages; migrations pass **both** `labelledBy` and `label`; `conflictAlert`/offline paths call `announce`; `sw.js` CACHE bumped and `a11y.js` in ASSETS; no raw hex; **Crotts placement** — `crotts.js` absent from `gvdg-members.html` + `admin.html`, present on the 5 public pages; makeDialog toggles the FAB-hide.
- **Behavioral (Playwright, part of the required live-verify gate):** an automated Playwright script (playwright is available) drives each of the 3 modals **keyboard-only**: Tab→trigger→Enter/Space opens → focus lands on the heading → Tab stays trapped (background isolated) → Escape closes → **focus returns to the opener**; `×`/backdrop close leaves **zero** isolated body nodes; `pageshow(persisted)` leaves zero isolated nodes; `announce` fires (polite + assertive regions populate) on a real save and a forced conflict; score sheet stays put (no scroll-jump, no focus loss) across a simulated WS snapshot while open. Verify **light + dark**, **0 console errors**, and (manually) with iOS VoiceOver if a device is available.

## 9. Follow-ups (Slice 2/3)

- Slice 2: `role="tablist"` semantics (admin 16-tab + members dash/doubles), skip links + `<main id>` landmarks, remaining click-only cards→buttons.
- Slice 3: form-label audit (130 controls).
