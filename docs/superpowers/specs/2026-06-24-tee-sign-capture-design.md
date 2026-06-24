# Tee-Sign Capture — crowdsourced multi-layout course data via member photos + Crotts vision

- **Date:** 2026-06-24
- **Status:** Approved design → ready for implementation plan
- **Repo:** `gvdg-club-site` (Cloudflare Worker `auth-worker/` + static frontend)
- **Branch:** `feat/tee-sign-capture`, stacked on `feat/events-d1-schema` (the club-ops/D1/live-scoring backend it builds on)

## Problem & context

The club needs accurate per-hole **par + distance for every layout** of its ~22 home courses to drive live
UDisc-style scoring, and wants a **tee-sign graphic** shown for each hole during play. Importing this from
UDisc by URL does not work, and we confirmed empirically why:

- **UDisc** course pages (HTTP 200, ~395 KB) contain **zero `"par"` fields** in the served HTML. Per-hole
  data is held in a reference-serialized client blob and hydrated **client-side** from a closed internal
  API. A server-side Worker `fetch` can never see pars/distances. `parseUdiscLayout` therefore always
  degrades to "name only."
- **discgolfscene** course pages expose only course-level metadata (name, location, hole count, rating);
  there is **no per-hole par/distance table** in fetchable HTML, and per-hole pages 404 on plain fetch.

Conclusion: **no external source reliably yields per-hole pars via server fetch.** The reliable source is
the club's own knowledge — which is literally printed on the **tee signs**. A physical tee sign typically
lists **multiple layouts at once** (e.g. Long Par 4 / 420 ft, Short Par 3 / 280 ft). So instead of scraping,
members **photograph tee signs while playing**; an AI vision model (Crotts) reads the **whole multi-layout
table** from one photo; the system auto-matches those rows to the course's stored layouts (creating missing
ones); an admin confirms; the confirmed data drives scoring per layout and the photo becomes the hole's
graphic. This documents **all** layouts with minimal manual entry and stays entirely on free tiers.

## Goals

- Capture and store **all layouts** of each course (par + distance per hole per layout).
- **One photo → many layouts:** vision extracts a per-layout set `{label, par, distance_ft, tee, target}`
  from a single tee-sign photo, so a member documents every layout of a hole in one shot.
- **Automate as much as possible:** auto-match extracted layout labels to existing `course_layouts`,
  auto-create missing layouts, auto-fill distances via `distance.ts` when a sign omits them — with
  **admin override available at every step**.
- Two-tier trust: a candidate photo shows immediately as "unverified," but scoring reads **only**
  admin-confirmed data.
- The official photo + a clean multi-layout tee-sign graphic render for the current hole during live scoring.
- Everything runs on Cloudflare free tiers (D1 + new R2 + existing AI rails).

## Non-goals

- Fully-automated, no-human-in-the-loop approval (OCR is imperfect — confirmation is mandatory; automation
  pre-fills, the admin confirms).
- Live UDisc/discgolfscene scraping as a source of truth (abandoned; unreliable as shown above).
- Per-throw GPS / shot tracking. Distance comes from the sign, or `distance.ts` (haversine/par-estimate).

## Locked decisions

1. **Trust model = two-tier (C).** Candidate visible immediately as "⚠ unverified"; scoring reads only
   admin-confirmed (official) data. Confirmation writes par/distance into the affected layouts.
2. **Candidate visibility = logged-in members only** until approved. Official photos are public.
3. **Storage = Cloudflare R2** (new binding). Images never go in KV/D1; D1 holds only metadata.
4. **Multi-layout is first-class.** Each course has several layouts; all are documented and stored. One
   photo extracts a per-layout table; the system auto-matches/auto-creates layouts; admin overrides.
5. **One official photo per (course, hole)**, shared by all layouts of that hole; par/distance are stored
   per layout.
6. **Default layouts = Long / Short** (auto-created per course); admin can add more. **Tees and targets
   carry an admin-assignable color** (`course_positions.color`, e.g. Blue tee / Red basket) — rendered as
   swatches on the tee-sign graphic and editable in the SAFARI layout editor. Color lives on the position,
   not the layout name.
7. **Ship T0 first** — the (multi-layout, color-aware) SVG tee-sign render is dependency-free and works today.
8. **Scope = one program, slices T0–T4.**

## Architecture

```
member (phone) ── POST /tee-signs ──▶ Worker ──▶ R2 PHOTOS (image) + D1 tee_signs (row, status=candidate)
                                          └─ ctx.waitUntil ─▶ vision.ts (OpenRouter VL → Workers AI → none)
                                               fills tee_signs.extracted_json = [{label,par,distance_ft,...}]
                                          └─ auto-match each label → course_layouts (propose new where unmatched)
admin ── GET /admin/tee-signs?status=candidate ──▶ review queue: photo + editable layout-mapping table
      └─ POST /admin/tee-signs/:id/approve ──▶ for each mapped layout: write par/distance into that
                                                layout's holes[hole]; record official photo for (course,hole);
                                                status=official; demote prior official
live scoring (event has a chosen layout) ──▶ render official photo + the SELECTED layout's par/distance
                                              (no photo → SVG tee sign from layout data → placeholder + CTA)
```

Identity stays in KV (existing auth). Club data stays in D1. The Worker is the trust boundary; member writes
go through `requireAuth`, all approval/layout writes through `adminGate`.

### Data model

New migration `auth-worker/migrations/0007_tee_signs.sql`:

```sql
CREATE TABLE tee_signs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  hole_number INTEGER NOT NULL,
  r2_key TEXT NOT NULL,              -- server-generated UUID key in R2
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,         -- memberId
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',  -- candidate | official | rejected
  extracted_json TEXT,               -- JSON array [{label,par,distance_ft,tee,target}] from vision (per layout)
  extract_source TEXT,               -- 'openrouter:<model>' | 'workers-ai:<model>' | 'manual' | NULL
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX idx_tee_signs_hole ON tee_signs(course_id, hole_number, status);
CREATE INDEX idx_tee_signs_status ON tee_signs(status);

-- Tees & targets gain an admin-assignable color (course_positions shipped in migration 0003).
ALTER TABLE course_positions ADD COLUMN color TEXT;
```

`tee_signs` is the **capture/moderation ledger** — one row per uploaded photo. `extracted_json` holds the
**multi-layout** extraction (and serves as the raw audit record). The *scoring* source of truth remains the
existing `course_layouts.holes` JSON (one `course_layouts` row per layout). On approval we:

- write each mapped layout's `holes[hole]` with `{par, distance_ft, distance_source, tee, target, tee_sign_key}`;
- mark this photo official for `(course, hole)` and demote any prior official photo for that hole (the photo
  is shared across all layouts of the hole; each layout's hole references the same `tee_sign_key`).

Scoring never reads a candidate row directly — that is what keeps two-tier clean.

**Layouts & colors:** `course_layouts` already exists (name + holes JSON + pars). Courses **default to two
layouts, "Long" and "Short"** (auto-created on first capture via `ensureDefaultLayouts`); admins can add
more. `matchLayout(courseId, label)` normalizes an extracted label and maps it to a layout — **defaulting to
Long/Short** (an explicit Long/Short label matches directly; otherwise the longest-distance row → Long and
the shortest → Short), with `createLayout(courseId, name)` for anything the admin adds. Tees and targets
(`course_positions`) gain an admin-assignable **`color`** (e.g. Blue tee, Red basket); a layout's hole
references a tee/target position, so each rendered layout row inherits its tee's color as a swatch.
Auto-match pre-fills the admin mapping; the admin can remap, rename, recolor, merge, or create.

### Storage — R2

`auth-worker/wrangler.toml` gains:

```toml
[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "gvdg-photos"
```

Free tier: 10 GB storage, 0 egress; the full catalog (~22 courses × 18 holes ≈ 80 MB even at one photo per
hole) is trivial. Object keys are server-generated: `tee-signs/<courseId>/<hole>/<uuid>.<ext>` (no user
input in the path → no traversal).

**Serving images (matches the auth model):**
- **Official** photos are public → plain `<img src="/tee-signs/:id/image">`, long cache.
- **Candidate** photos are members-only → the members/admin JS fetches them with the Bearer token
  (`fetch` → blob → object URL), the same authed-fetch pattern the SPA already uses. No public candidate URL.

### Vision extraction — `auth-worker/src/vision.ts`

Mirrors `assistant.ts`'s provider chain, multimodal, **multi-layout output**:

```
extractTeeSign(env, dataUrl) -> {
  hole: int | null,
  layouts: [ { label, color: string|null, par: int|null, distance_ft: int|null, tee: string|null, target: string|null } ]
}
  try OpenRouter VL model (env.OPENROUTER_VISION_MODEL, default a current free VL id,
      runtime-query openrouter /models for a :free image-input model if the default 404s/429s)
  → fallback Workers AI vision (env.VISION_MODEL default '@cf/meta/llama-3.2-11b-vision-instruct')
  → else {hole:null, layouts:[]}  (manual entry)
```

- Strict prompt: "Read this disc golf tee sign. It may list several layouts/tee positions, often color-coded.
  Return ONLY JSON `{hole:int|null, layouts:[{label, color, par:int|null, distance_ft:int|null, tee,
  target}]}`. One entry per layout/tee shown; `color` = the tee's color word if shown (e.g. blue/red), else
  null; null any field not clearly visible." Parse defensively; **clamp** each `par`∈[1,10],
  `distance_ft`∈[20,2000]; drop malformed rows; **default the layout mapping to Long/Short** (explicit labels
  win; else longest→Long, shortest→Short). An extracted `color` pre-fills the tee's `course_positions.color`
  for admin confirm. Model text is never rendered as HTML and never auto-applied (human confirms), so
  tee-sign text cannot become a prompt-injection/scoring attack.
- Image to model: the Worker holds the bytes → base64 data URL. Client pre-resizes to ≤ ~1024 px (bigger
  than the 256 px profile thumb — OCR needs detail).
- Runs in `ctx.waitUntil(...)` after the upload response so the row + auto-matched mapping populate within
  seconds. Requires threading `ExecutionContext` into `export default { fetch(request, env, ctx) }`
  (currently `(request, env)`).

### Worker endpoints (new)

Member-authed (`requireAuth`):
- `POST /tee-signs` — body `{courseId, hole, image (base64 data URL)}`. Validate, R2 put, insert candidate
  row, `ctx.waitUntil(extract + auto-match)`, return the row. RATELIMIT (e.g. 10/min/member).
- `GET /my-tee-signs` — caller's uploads + statuses.
- `GET /tee-signs/:id/image` — official → public; candidate → requires auth (blob-fetch from members/admin).
- `GET /courses/:id/tee-signs` — official signs per hole (+ candidates for authed members), for render.

Admin (`adminGate`):
- `GET /admin/tee-signs?status=candidate` — review queue, each with its auto-matched layout mapping.
- `POST /admin/tee-signs/:id/approve` — body `{ rows: [{ layoutId?, newLayoutName?, par, distance_ft,
  tee?, target?, color? }] }`. Each row targets an existing layout (`layoutId`, default Long/Short) or
  creates one (`newLayoutName`); `color` sets the tee/target position color. Auto-filled from extraction +
  auto-match and **fully editable**. Writes every row's hole; records the official photo for `(course,
  hole)`; demotes prior official.
- `POST /admin/tee-signs/:id/reject`, `DELETE /admin/tee-signs/:id`.
- `POST /admin/tee-signs/:id/extract` — re-run vision (when a free model was unavailable at upload time).

### Worker modules

- **`src/photos.ts`** (new) — R2 put/get + image validation: **magic-byte sniff** (jpeg/png/webp only,
  **reject SVG**), size cap, UUID key generation. Keeps `index.ts` (already ~1080 lines) from growing.
- **`src/vision.ts`** (new) — the multi-layout extraction provider chain above.
- **`src/db.ts`** — `tee_signs` CRUD; `ensureDefaultLayouts(courseId)` (Long/Short), `matchLayout(courseId,
  label)`, `createLayout(courseId,name)`; extend the `course_positions` helpers (from L2) to read/write
  `color`; `applyTeeSignRows(courseId, hole, rows, teeSignKey)` (per-layout hole writes + position color +
  official-photo bookkeeping).
- **`src/index.ts`** — route wiring + thin handlers (logic in the modules above); thread `ctx`.

### Frontend

- **`tee-sign.js`** (new, T0) — pure `teeSignSvg({hole, courseName, layouts:[{label,color,par,distance_ft,
  distance_source,tee,target}]})` → themed (light/dark), XSS-safe SVG showing the hole number and a row per
  layout with the tee's **color swatch** (like a real color-coded sign). Colors pass a sanitizer — a CSS
  named-color allowlist + `#RGB`/`#RRGGBB` hex regex — never raw into markup. Reused everywhere a hole is
  shown. Works **today** from existing `course_layouts` rows.
- **`gvdg-members.html`** — "📸 Capture a tee sign" flow: pick course + hole (camera capture on mobile),
  client resize/EXIF-strip (canvas re-encode), upload, show Crotts' multi-layout guess, list my candidates.
- **`admin.html`** — "Tee Signs" review tab: candidate queue grouped by course/hole; photo + the
  **auto-matched layout-mapping table** (label → layout (default Long/Short), color, par, distance) —
  editable, with inline "create layout" + a tee/target **color picker**; Approve / Edit+Approve / Reject /
  Delete. The SAFARI layout editor (Layouts tab) also gains a color field per tee/target position.
- **`events.html` + `admin.html` live scoring** — render the official tee-sign photo + the **selected
  layout's** par/distance overlay for the current hole; SVG fallback from layout data; placeholder + capture
  CTA when neither.

## Security

- Upload: `requireAuth` + RATELIMIT; magic-byte content-type allowlist (jpeg/png/webp), **SVG rejected**;
  size cap after client resize; **EXIF stripped** (client canvas re-encode drops it — removes the member-GPS
  leak); UUID R2 keys.
- Vision: output strictly parsed + clamped per row; raw stored for audit; never rendered as HTML; never
  auto-applied — admin confirms every layout write.
- Moderation: candidates are members-only and admin-rejectable/removable; only `adminGate` can make a sign
  official, create/edit layouts, or edit scoring values.
- Serving: official images public with `nosniff` + correct content-type; candidate images only via authed
  blob fetch. No public bucket listing.

## Slicing (each slice = one PR through `/simplify` → `/code-review` → `/security-review` + live-verify)

- **T0 — Multi-layout, color-aware SVG tee-sign render.** `tee-sign.js` pure component (hole + a row per
  layout with the tee's color swatch from a sanitized palette) + render it in event detail and a layout/hole
  preview from existing data. No backend.
  *Live-verify:* light+dark, XSS-safe (incl. color sanitization), correct for seeded multi-layout courses.
- **T1 — Storage + upload backbone.** R2 binding, `0007` migration (tee_signs + `course_positions.color`),
  `ensureDefaultLayouts` (Long/Short), `src/photos.ts`, `POST /tee-signs`, image serve, `GET /my-tee-signs`,
  admin list/approve(manual rows incl. color)/reject/delete + `applyTeeSignRows` writing multiple layouts +
  position colors. **No AI yet.** *Live-verify:* upload → R2 → D1 → serve (official public / candidate
  authed) → approve writes 2+ layouts' holes + tee colors.
- **T2 — Crotts vision + auto-match.** `src/vision.ts` multi-layout + color extraction + `matchLayout`
  defaulting to Long/Short + auto-create + `ctx.waitUntil` + re-extract; admin queue shows the auto-filled,
  editable mapping (layout, color, par, distance). *Live-verify with real color-coded multi-layout signs:*
  rows populate, labels default-map to Long/Short, tee colors pre-fill, fallbacks fire.
- **T3 — Member capture UI.** Mobile course+hole pick, camera capture, client resize/EXIF-strip, show the
  multi-layout guess, my-candidates. Optional guided "capture each hole" walk for a course.
  *Live-verify on a mobile viewport* (real camera/file input → upload → appears as candidate).
- **T4 — Render in scoring.** Official photo + selected-layout overlay + SVG fallback + "unverified" badge on
  the live scorecard, event detail, and public leaderboard. *Live-verify during a real scored event* on a
  specific layout (scorekeeper sees the right sign/row per hole; viewer sees official only).

## Free-tier / provisioning (mostlysober252)

- `wrangler r2 bucket create gvdg-photos`; paste the `[[r2_buckets]]` binding (already in `wrangler.toml`).
- Vision works on the existing `AI` binding (Workers AI) with no new secret; optionally set
  `OPENROUTER_VISION_MODEL` to a free VL id (the existing `OPENROUTER_API_KEY` secret covers OpenRouter).
- D1: `0007` migration applied with the others. No new DB or paid plan needed.

## Verification (per CLAUDE.md — live, not just unit tests)

Each slice: vitest units (validation, mocked-provider multi-layout vision parse/clamp, layout match, db,
SVG pure fn) **and** a real local drive via `wrangler dev --local` (R2/D1/AI), exercised in a browser —
including a mobile viewport for capture and a real scored event (on a chosen layout) for render. Nothing is
"done" until driven in the running app.

## Open follow-ups (not in this program)

- Auto-suggest course/hole from EXIF GPS or live-round context (MVP: member selects explicitly).
- Heavier batch tooling (a "course documentation drive" assembling a full multi-layout course from a set of
  hole photos in one pass) beyond T3's optional guided walk.
- Cross-member dedup/quality scoring when several members photograph the same hole.
