# Tee-Sign T3 — Member Capture UI — Implementation Plan

> **For agentic workers:** main-session implementation (frontend-only, must be live-verified on a mobile viewport per CLAUDE.md). Steps use `- [ ]`.

**Goal:** Give logged-in members a mobile-first "📸 Capture a Tee Sign" flow on `gvdg-members.html`: pick a course + hole, take/choose a photo (camera on mobile), the client resizes it and strips EXIF, it uploads to the existing `POST /tee-signs`, and the member sees Crotts' multi-layout guess fill in within a few seconds plus a running list of their captured signs with status (⚠ pending review / ✅ official / ✕ rejected). This is the member-facing front door to the T1/T2 backend; the admin still confirms before anything reaches scoring.

**Architecture:** No backend change — T1 shipped `POST /tee-signs` (requireMember, 10/min RATELIMIT, magic-byte validation, R2 put, candidate row), authed `GET /tee-signs/:id/image` (official=public, candidate=members-only), `GET /my-tee-signs`; T2 runs `extractTeeSign` in `ctx.waitUntil` and fills `extracted_json` `{hole,layouts:[{label,color,par,distance_ft,tee,target}]}`. T3 is purely `gvdg-members.html`:

- **Reuse `resizeImageFile(file, maxPx)`** (already used by profile photos) at **1024px** — OCR needs more detail than the 256px avatar. It re-encodes through a canvas to JPEG, which **strips EXIF** (drops the member-GPS leak the spec calls out) and yields a `data:image/jpeg;base64,…` URL that the server's `decodeDataUrl` magic-byte check accepts.
- **Course picker** from `GET /courses`; **hole picker** a 1–24 `<select>` (server still validates 1–99). Courses carry no hole-count column, and `ensureDefaultLayouts` only runs on first capture, so a fixed range is the robust choice.
- After a 201, **poll `GET /my-tee-signs`** (a few times, ~1.5s apart) until the just-uploaded row gains `extract_source`/`extracted_json`, then render the guess. The list also renders each candidate's **thumbnail via the authed blob-fetch pattern** the spec mandates (`fetch` with Bearer → blob → object URL), proving the members-only serving path.
- **XSS-safe throughout:** all dynamic text via `elNode`/`textContent`; the layout guess (incl. the model's `color`/`label` strings) is rendered as **plain text only** (no swatch, no `innerHTML`) so tee-sign text can never become markup. Color swatches/sanitization belong to the T0 SVG render and T2 admin review, not the member's read-only guess.

**Tech Stack:** static HTML + inline vanilla JS (matches the rest of `gvdg-members.html`), the existing `api()`/`elNode()`/`resizeImageFile()` helpers. No new module → no new unit test; verification is the mandated live mobile-viewport drive.

**Coordination:** Same as T0–T2 — independent of `feat/live-cards-scoring`; T3 touches only `gvdg-members.html` (no shared `index.ts`/`db.ts` edit), so no extra merge surface. Accumulates on `feat/tee-sign-capture`.

**Setup:** Worktree `/home/kg/gvdg-wt-teesign`. Live-verify recipe: `wrangler d1 migrations apply DB --local`; seed roster + a course; `.dev.vars` with `JWT_SECRET` and `VISION_DEV_STUB=1` (deterministic Crotts guess without AI creds); `npm exec -- wrangler dev --local --port 8788 --var ALLOWED_ORIGINS:"http://localhost:8080"`; serve a copy of the site with `data-auth-base`→localhost:8788 on :8080; drive a **mobile-viewport** Chromium (cached playwright-core) through login → capture → guess.

## File Structure
- Modify: `gvdg-members.html` — new `#teeCapture` section markup, `.tee-capture` CSS, and JS (`loadTeeSigns`, course/hole population, `onTeeSignChosen`, `uploadTeeSign`, poll-for-guess, `renderMyTeeSign`, authed thumbnail, event wiring, hook into `loadDashboard`).

---

## Task 1: Capture section — markup + CSS

- [ ] Add `<div id="teeCapture" class="tee-capture" style="display:none;">` inside `#membersContent` near the other dashboard sections: title "📸 Capture a Tee Sign", an explainer note, a course `<select id="tsCourse">`, a hole `<select id="tsHole">`, a camera/file `<input type="file" accept="image/*" capture="environment">` behind a styled label, a `<img id="tsPreview">` preview, an Upload button `#tsUploadBtn`, a status line `#tsStatus`, and a "My captured signs" list `#tsMyList`.
- [ ] Add `.tee-capture` / control / `.ts-card` / `.ts-badge` CSS reusing the existing token palette (`var(--primary)`, `var(--border-color)`, light/dark aware), mirroring `.club-register`.

## Task 2: Capture JS

- [ ] `loadTeeSigns()` — if no token, hide the section; else `GET /courses` to populate `#tsCourse` (skip if empty), `GET /my-tee-signs` to render `#tsMyList`, show the section. Called from `loadDashboard()`.
- [ ] `onTeeSignChosen(e)` — `resizeImageFile(file, 1024)`; reject if missing or data URL too large (~> 3.9 MB ≈ 3 MB decoded cap); set `#tsPreview` + `pendingTeeSign`.
- [ ] `uploadTeeSign()` — validate course+hole+photo; `POST /tee-signs {courseId, hole, image}`; on 201 clear the picker, show "🔍 Crotts is reading the sign…", refresh the list, and poll `/my-tee-signs` for that row's extraction; map 429→friendly rate-limit, 400→friendly, network→friendly.
- [ ] `renderMyTeeSign(row)` — status badge, course name + hole, a parsed-guess summary (one text chip per layout: `Long — Par 4 · 420 ft · blue`), and a lazily authed candidate thumbnail (revoke prior object URLs on re-render).
- [ ] Wire the file input + Upload button listeners; hook `loadTeeSigns()` into `loadDashboard()`.

## Task 3: Live-verify on a mobile viewport (THE gate)
- [ ] Stand up the teesign worker (`VISION_DEV_STUB=1`) + served site; drive a 390×844 viewport: log in (PIN), pick course+hole, choose a real JPEG/PNG, upload, watch the candidate appear and the Crotts guess (Long/Short) fill in, confirm the authed thumbnail renders, 0 console errors, and an XSS-named layout renders as literal text.

## Task 4: Sanity + commit
- [ ] `npx tsc --noEmit` + `npx vitest run` (guard the contract; expect unchanged green), then commit on `feat/tee-sign-capture` in the slice style.
