# Tee-Sign T4 — Render in Scoring — Implementation Plan

> **For agentic workers:** main-session implementation; live-verify during a real scored event per CLAUDE.md. Steps use `- [ ]`.

**Goal:** Surface confirmed tee-sign data where players look during play. On the **event detail (viewer)** show each hole's **official photo** (else a clean SVG tee sign from the selected layout's par/distance, else nothing); on the **admin Live Scoring scorekeeper** show a per-hole tee-sign strip including **candidate** photos with an **"⚠ unverified"** badge (authed members may preview unconfirmed signs; the public sees official only). This closes the loop: members capture (T3) → admin confirms (T1/T2) → the confirmed sign + selected-layout par/distance render in scoring (T4).

**Architecture:** Scoring's source of truth stays `course_layouts.holes` (par/distance/`tee_sign_key`, written on approval by `applyTeeSignRows`); the official photo is the `tee_signs` row whose `r2_key` matches. The only missing primitive is a **read route that lists a course's tee-signs per hole** so the frontend can map hole → image id. The SVG renderer is **T0's `tee-sign.js` reused as-is** (pure, XSS-safe `teeSignSvg`). `events.html` is already a `<script type="module">` → it imports `teeSignSvg` directly; `admin.html` is a classic script → a tiny module shim assigns `window.teeSignSvg`. No duplication of the escaping/color-sanitizing logic.

- **Public vs authed:** official photos are public (`<img src=.../tee-signs/:id/image>` works cross-origin, no CORS needed for display). Candidate photos are members-only → the **authed blob-fetch** pattern (Bearer→blob→objectURL) the admin page already has a token for; they render with an **⚠ unverified** badge. The viewer page (`events.html`, no login) requests official only.
- **"unverified" = candidate.** Scoring values (par/distance) always come from the confirmed layout; the badge marks a *photo* that hasn't been approved yet, shown only to authed scorekeepers.

**Tech Stack:** TS Worker (1 route + 1 db fn + a vitest), `events.js` (1 field + node test), `events.html` + `admin.html` (CSS + render wiring), reuse `tee-sign.js`. Builds on T0–T3.

**Coordination (IMPORTANT):** Per the spec, T4 consumes the live-scoring surface the parallel `feat/live-cards-scoring` (N1) track is reshaping. This worktree is stacked on the **events-branch** scoring surface (`admin.html` Live Scoring grid + `events.html` detail), NOT N1's `score.html`. T4 is built **additively** (new sections/functions appended to existing containers) to minimize collision, and **must be rebased onto the merged scoring surface** before its PR — re-attaching the tee-sign section/strip to whatever containers survive the N1 merge. Documented in the spec's Coordination section and project memory.

## File Structure
- Modify: `auth-worker/src/db.ts` — `listTeeSignsByCourse(db, courseId, statuses)`.
- Modify: `auth-worker/src/index.ts` — `GET /courses/:id/tee-signs` (official always; candidates when a valid member bearer is present).
- Create: `auth-worker/test/tee-sign-render.test.ts` — route returns official-only unauthed, official+candidate authed.
- Modify: `events.js` — `normalizeEvent` passes `layout_id`; add a node test.
- Modify: `events.html` — import `teeSignSvg`; `.tee-sign*` + tee-sign-card CSS; `renderTeeSigns(ev, card)` wired into `renderDetail`.
- Modify: `admin.html` — module shim for `teeSignSvg`; `.tee-sign*` CSS; per-hole tee-sign strip in the Live Scoring pane.

---

## Task 1: Backend — list a course's tee-signs per hole
- [ ] `db.listTeeSignsByCourse(db, courseId, statuses)` → `SELECT id, hole_number, status FROM tee_signs WHERE course_id=? AND status IN (...) ORDER BY hole_number, created_at`.
- [ ] Route `GET /courses/:id/tee-signs` in `handleClub`: always include `official`; if `bearer()` verifies to a member, also include `candidate`. Returns `{teeSigns:[{id,hole_number,status}]}`.
- [ ] `test/tee-sign-render.test.ts`: unauthed → official only; authed member → official + candidate. `tsc` clean.

## Task 2: Viewer — events.html per-hole tee-sign section
- [ ] `events.js` `normalizeEvent`: add `layout_id`; node test asserts passthrough.
- [ ] `events.html`: add `teeSignSvg` to the import; add theme-aware `.tee-sign*` + `.ts-hole-card` CSS.
- [ ] `renderTeeSigns(ev, card)`: resolve layout (ev.layout_id else course default from `/courses/:id/layouts`); fetch `/courses/:id/tee-signs` (official). Per hole of the layout: official photo `<img>` → else `teeSignSvg` fallback (DOMParser-inserted, inert) → with "Hole N · Par P · D ft". Skip the section if no layout holes and no photos. Wire into `renderDetail` like `renderEventExtras`.
- [ ] Live-verify (viewer): official photo + par/distance for the confirmed hole; SVG fallback for holes without a photo; light+dark; 0 console errors.

## Task 3: Scorekeeper — admin.html Live Scoring strip
- [ ] Module shim `window.teeSignSvg`; `.tee-sign*` CSS.
- [ ] When scoring, capture `scCourseId`/`scLayoutId`; fetch `/courses/:id/tee-signs` (authed → official+candidate) + the layout holes. Render `#scTeeSigns` strip: per hole, official photo (no badge) → else candidate authed-blob `<img>` + **⚠ unverified** → else `teeSignSvg`. par from snapshot, distance from layout.
- [ ] Live-verify (scorekeeper): start a live event on a layout; strip shows the official sign for the confirmed hole and a candidate hole flagged ⚠ unverified.

## Task 4: Verify-all + tests + commit
- [ ] One end-to-end drive: upload → admin approve (writes layout holes + official photo) → event → events.html viewer + admin scorekeeper. `tsc` + worker vitest + `events.js` node tests green. Commit T4 in the slice style. Note the N1 rebase follow-up.
