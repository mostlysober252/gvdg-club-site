# Tee-Sign T5 — Verified data is sticky + single-use event override — Implementation Plan

> **For agentic workers:** main-session implementation; live-verify both behaviors per CLAUDE.md. Steps use `- [ ]`.

**Origin:** Follow-up from the T4 review finding — the admin layout PATCH (`enrichHoles`) silently recomputes an approved tee-sign distance back to a par-estimate, destroying verified data. User decisions (2026-06-24): verified scope = **par + distance**; temporary override = **per event/round, live-round-scoped (no table)**; editor UX = **show ✓ verified + allow override that reverts**; build **both parts in one commit**.

**Goal:**
1. **Part 1 — Verified is sticky.** A tee-sign-approved hole (par + distance) is the authoritative source of truth. It survives layout edits and re-enrichment; nothing downgrades it to a par-estimate. A layout-level manual edit is only the working value when *no* verified source exists, and reverts to verified once one is approved.
2. **Part 2 — Single-use event override.** For one live round an admin may temporarily change a hole's par/distance (e.g., short baskets today). It lives only in the live-scoring Durable Object — the layout is never mutated, so after the round the hole automatically reverts to its verified value. Overridden values render with a **"temporary"** marker, distinct from the **✓ verified** badge.

## Locked design

### Distance/par precedence (was: manual > geo > par_estimate)
**`tee_sign` (verified) > manual > geo > par_estimate.** `DistanceSource` gains `"tee_sign"`.

### Hole model (JSON in `course_layouts.holes` — no migration)
Add a persisted verified record:
```
verified?: { par: number, distance_ft: number | null, tee_sign_key: string } | null
```
- `enrichHoles`: if a hole has `verified` (or legacy `distance_source==='tee_sign'`), the effective **par = verified.par**, **distance = verified.distance_ft** (source `tee_sign`); else fall through to `estimateDistance(manual > geo > par_estimate)` with the hole's own par. So re-enrichment **preserves** verified.
- `applyTeeSignRows` (approve): set `verified`, derive effective par/distance from it, and **clear `manual_distance`** on that hole (revert any prior manual stopgap).
- **Server-enforced stickiness:** `updateLayout` (the PATCH path) reads the existing holes and **carries `verified` forward** per hole, so a layout edit (even one that omits it) can't erase verified. Verified is set/replaced only through the tee-sign approve flow.

### Live-round override (Part 2) — `auth-worker/src/live.ts`
- `meta.overrides: { [hole]: { par?: number, distance_ft?: number } }` in DO state.
- New DO action `override` (admin-gated by the Worker like score/start/finalize): `{hole, par?, distance_ft?, clear?}`.
- `snapshot().holes` resolves each hole to `{hole, par, distance_ft?, overridden: bool}` where `par`/`distance_ft` apply the override; `computeLeaderboard` uses the overridden par (to-par reflects it). `finalize` already reads `meta.holes` → results use the override; the layout is untouched → reverts after the round.
- Worker route `POST /events/:id/live/override` (adminGate → DO `/override`).

### Frontend
- **`admin.html` layout editor:** verified holes show a **✓ verified** badge + the verified par/distance; a typed value is accepted but reverts on save (server preserves verified). Round-trip the `verified` field.
- **`admin.html` Live Scoring:** a per-hole **temporary override** control (par + distance) → `POST .../live/override`; overridden holes show a **"temporary"** marker on the scorecard header + the tee-sign strip uses the override distance with that marker; a clear/revert action.
- Public `events.html` viewer keeps showing the canonical verified/layout data (the live leaderboard's to-par already reflects overridden par via DO standings — no extra work).

## File Structure
- `auth-worker/src/distance.ts` — `tee_sign` source + `verified` precedence.
- `auth-worker/src/layouts.ts` — `LayoutHole.verified`; `enrichHoles` preserves verified.
- `auth-worker/src/db.ts` — `applyTeeSignRows` writes verified + clears manual; `updateLayout` carries verified forward.
- `auth-worker/src/live.ts` — overrides in meta + `override` action + snapshot/leaderboard.
- `auth-worker/src/index.ts` — `POST /events/:id/live/override`.
- `auth-worker/test/*` — distance precedence, enrich-preserves-verified, applyTeeSignRows verified+clear-manual, live override.
- `admin.html` — ✓ verified badge in the layout editor; temporary override UI in Live Scoring + tee-sign strip.

## Tasks
1. [ ] **Part 1 backend** — distance.ts, layouts.ts, db.ts (applyTeeSignRows + updateLayout) + unit tests.
2. [ ] **Part 1 UI** — admin layout editor ✓ verified badge + round-trip; server-side stickiness verified.
3. [ ] **Part 2** — live.ts overrides + route + admin Live Scoring temporary override UI + tee-sign strip + tests.
4. [ ] **Live-verify both** — approve→sticky→PATCH-doesn't-clobber (✓ badge); start→temp override→scorecard/leaderboard/strip show "temporary"→finalize→layout still verified. tsc + full vitest + node tests. One commit.

## Verification (live)
- Part 1: approve a tee sign for a hole → verified par/distance; PATCH the layout → the verified hole is unchanged (reverts), other holes re-estimate; ✓ badge shows in the editor.
- Part 2: start a live round → set a temporary override on a hole (e.g. par 3 / 250 ft) → scorecard + leaderboard to-par + tee-sign strip show the temporary value with a "temporary" marker → finalize → re-open the layout: still the verified value (override gone).
