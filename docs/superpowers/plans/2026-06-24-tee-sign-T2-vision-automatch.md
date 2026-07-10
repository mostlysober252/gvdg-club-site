# Tee-Sign T2 — Crotts Vision + Auto-Match — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** When a tee-sign photo is uploaded, "Crotts" (a vision model) reads the sign and fills the candidate's `extracted_json` with a per-layout suggestion `[{label,color,par,distance_ft,tee,target}]`; the admin review queue shows those suggestions **auto-matched** to existing course layouts (defaulting to Long/Short). An admin can re-run extraction. **The admin still confirms** before anything writes to scoring (T1's approve path is unchanged) — vision only pre-fills.

**Architecture:** New pure-ish module `src/vision.ts` mirrors `assistant.ts`'s provider-chain pattern (`generateReply`): try **OpenRouter** (OpenAI-compatible `/chat/completions`, a free vision model, multimodal message) → **Workers AI** (`env.AI.run` vision model) → **dev-stub** (only when `env.VISION_DEV_STUB` is set, for local verify). The pure `parseVisionJson` (extract JSON from model text, clamp/coerce) is unit-tested; the provider I/O + real inference are live-verified (real inference needs an OpenRouter key / CF AI, same as Crotts — verified on deploy). Extraction runs in `ctx.waitUntil` after the upload responds, so the candidate row populates within seconds. The admin-queue route enriches each candidate with auto-matched layout suggestions via `db.matchLayout`/`defaultLayoutName` (T1).

**Tech Stack:** TypeScript Worker, OpenRouter/Workers-AI, vitest, wrangler. Builds on T1 (`tee_signs`, `photos.ts`, `db` ledger, admin routes).

**Coordination:** Same as T1 — independent of `feat/live-cards-scoring`, touches `index.ts`/`db.ts`. Accumulates on `feat/tee-sign-capture`.

**Setup:** Worktree `/home/kg/gvdg-wt-teesign`, worker at `auth-worker/` (deps installed, git identity set).

## File Structure
- Create: `auth-worker/src/vision.ts` — VISION_PROMPT, `parseVisionJson`, provider chain `extractTeeSign`.
- Create: `auth-worker/test/vision.test.ts` — pure `parseVisionJson` tests.
- Modify: `auth-worker/src/db.ts` — `setTeeSignExtraction`.
- Modify: `auth-worker/src/index.ts` — thread `ctx`; `waitUntil` extraction on upload; `POST /admin/tee-signs/:id/extract`; enrich admin list with auto-match; `Env` (OPENROUTER_VISION_MODEL, VISION_MODEL, VISION_DEV_STUB; extend `AI` type for image input).
- Modify: `auth-worker/src/cf.d.ts` — minimal `ExecutionContext` type (if not already present).
- Modify: `auth-worker/wrangler.toml` — `OPENROUTER_VISION_MODEL`, `VISION_MODEL` vars (commented guidance).

---

## Task 1: `src/vision.ts` — parse (pure, TDD) + provider chain

**Files:** Create `auth-worker/src/vision.ts`, `auth-worker/test/vision.test.ts`.

- [ ] **Step 1: Failing test** — `auth-worker/test/vision.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseVisionJson } from "../src/vision.js";

describe("parseVisionJson", () => {
  it("parses a clean multi-layout response", () => {
    const r = parseVisionJson('{"hole":7,"layouts":[{"label":"Long","color":"blue","par":4,"distance_ft":420},{"label":"Short","color":"white","par":3,"distance_ft":285}]}');
    expect(r.hole).toBe(7);
    expect(r.layouts.length).toBe(2);
    expect(r.layouts[0]).toEqual({ label: "Long", color: "blue", par: 4, distance_ft: 420, tee: null, target: null });
  });
  it("extracts JSON from a markdown code fence and prose", () => {
    const r = parseVisionJson('Sure!\n```json\n{"hole":3,"layouts":[{"label":"Main","par":3,"distance_ft":250}]}\n```');
    expect(r.hole).toBe(3);
    expect(r.layouts[0].par).toBe(3);
  });
  it("clamps out-of-range par/distance to null and coerces color to string", () => {
    const r = parseVisionJson('{"hole":99,"layouts":[{"label":"X","color":5,"par":40,"distance_ft":5}]}');
    expect(r.hole).toBe(99);                 // hole clamp is [1,99]
    expect(r.layouts[0].par).toBeNull();     // 40 out of [1,10]
    expect(r.layouts[0].distance_ft).toBeNull(); // 5 < 20
    expect(r.layouts[0].color).toBe("5");    // coerced
  });
  it("returns an empty result on garbage / no JSON", () => {
    expect(parseVisionJson("the sign is unreadable").layouts).toEqual([]);
    expect(parseVisionJson("").hole).toBeNull();
    expect(parseVisionJson('{"nope":true}').layouts).toEqual([]);
  });
  it("drops malformed layout rows but keeps good ones", () => {
    const r = parseVisionJson('{"hole":1,"layouts":[{"label":"A","par":3,"distance_ft":200},"junk",{"par":4}]}');
    expect(r.layouts.length).toBe(2);        // "A" + the {par:4} (label defaults to "")
    expect(r.layouts[0].label).toBe("A");
  });
});
```

- [ ] **Step 2: Run, verify fail** — `cd auth-worker && npm test -- vision.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/vision.ts`:**

```ts
// "Crotts" vision (T2): read a disc-golf tee sign photo into a per-layout suggestion. Mirrors
// assistant.ts's provider-chain pattern. parseVisionJson is PURE (unit-tested); the providers do I/O.
// Output is ONLY a suggestion — an admin confirms before anything reaches scoring.

export interface VisionRow {
  label: string;
  color: string | null;
  par: number | null;
  distance_ft: number | null;
  tee: string | null;
  target: string | null;
}
export interface VisionResult {
  hole: number | null;
  layouts: VisionRow[];
  source?: string | null; // 'openrouter:<model>' | 'workers-ai:<model>' | 'dev-stub' | null
}

export const VISION_PROMPT =
  "Read this disc golf tee sign. It may list several layouts/tee positions, often color-coded. " +
  'Return ONLY JSON: {"hole":int|null,"layouts":[{"label":string,"color":string|null,"par":int|null,' +
  '"distance_ft":int|null,"tee":string|null,"target":string|null}]}. One entry per layout/tee shown. ' +
  "color = the tee color word if shown (e.g. blue, red), else null. Null any field not clearly visible. " +
  "Do not include any text outside the JSON.";

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Pull the first JSON object out of model text (tolerates code fences / prose) and validate it. */
export function parseVisionJson(text: unknown): VisionResult {
  const empty: VisionResult = { hole: null, layouts: [] };
  if (typeof text !== "string" || !text.trim()) return empty;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return empty;
  let data: unknown;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return empty; }
  if (!data || typeof data !== "object") return empty;
  const o = data as Record<string, unknown>;
  const rawLayouts = Array.isArray(o.layouts) ? o.layouts : [];
  const layouts: VisionRow[] = [];
  for (const r of rawLayouts) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    layouts.push({
      label: row.label != null ? String(row.label) : "",
      color: row.color != null ? String(row.color) : null,
      par: clampInt(row.par, 1, 10),
      distance_ft: clampInt(row.distance_ft, 20, 2000),
      tee: row.tee != null ? String(row.tee) : null,
      target: row.target != null ? String(row.target) : null,
    });
  }
  return { hole: clampInt(o.hole, 1, 99), layouts };
}

// ---- providers (I/O; live-verified) ----
export interface VisionEnv {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_VISION_MODEL?: string;
  VISION_MODEL?: string;
  VISION_DEV_STUB?: string;
  AI?: { run(model: string, opts: Record<string, unknown>): Promise<{ response?: string }> };
}
const DEFAULT_OR_VISION = "nvidia/nemotron-nano-12b-v2-vl:free";
const DEFAULT_WAI_VISION = "@cf/meta/llama-3.2-11b-vision-instruct";

function dataUrlOf(bytes: Uint8Array, contentType: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return `data:${contentType};base64,${btoa(bin)}`;
}

async function openRouterVision(env: VisionEnv, bytes: Uint8Array, contentType: string): Promise<VisionResult> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.OPENROUTER_API_KEY, "Content-Type": "application/json", "X-Title": "GVDG Crotts Vision" },
    body: JSON.stringify({
      model: env.OPENROUTER_VISION_MODEL || DEFAULT_OR_VISION,
      messages: [{ role: "user", content: [
        { type: "text", text: VISION_PROMPT },
        { type: "image_url", image_url: { url: dataUrlOf(bytes, contentType) } },
      ] }],
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error("openrouter_" + res.status);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const out = parseVisionJson(data?.choices?.[0]?.message?.content ?? "");
  return { ...out, source: "openrouter:" + (env.OPENROUTER_VISION_MODEL || DEFAULT_OR_VISION) };
}

async function workersAiVision(env: VisionEnv, bytes: Uint8Array): Promise<VisionResult> {
  const model = env.VISION_MODEL || DEFAULT_WAI_VISION;
  const out = await env.AI!.run(model, { image: Array.from(bytes), prompt: VISION_PROMPT, max_tokens: 700 });
  return { ...parseVisionJson(out?.response ?? ""), source: "workers-ai:" + model };
}

// Local-only deterministic stub so the full pipeline is live-verifiable without AI creds.
function devStub(): VisionResult {
  return { hole: 7, source: "dev-stub", layouts: [
    { label: "Long", color: "blue", par: 4, distance_ft: 420, tee: null, target: null },
    { label: "Short", color: "white", par: 3, distance_ft: 285, tee: null, target: null },
  ] };
}

/** Provider chain: OpenRouter (if key) → Workers AI (if bound) → dev-stub (only if VISION_DEV_STUB) → empty.
 *  Never throws — returns an empty result if every path fails, so the candidate just awaits manual entry. */
export async function extractTeeSign(env: VisionEnv, bytes: Uint8Array, contentType: string): Promise<VisionResult> {
  if (env.OPENROUTER_API_KEY) {
    try { const r = await openRouterVision(env, bytes, contentType); if (r.layouts.length || r.hole != null) return r; } catch { /* fall through */ }
  }
  if (env.AI) {
    try { const r = await workersAiVision(env, bytes); if (r.layouts.length || r.hole != null) return r; } catch { /* fall through */ }
  }
  if (env.VISION_DEV_STUB) return devStub();
  return { hole: null, layouts: [], source: null };
}
```

- [ ] **Step 4: Run, verify pass** — `npm test -- vision.test.ts` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git -C /home/kg/gvdg-wt-teesign add auth-worker/src/vision.ts auth-worker/test/vision.test.ts
git -C /home/kg/gvdg-wt-teesign commit -m "feat(tee-sign): vision.ts — Crotts tee-sign extraction (parse + provider chain)"
```

---

## Task 2: ctx threading + extraction on upload + `setTeeSignExtraction`

**Files:** `auth-worker/src/db.ts`, `auth-worker/src/index.ts`, `auth-worker/src/cf.d.ts`, `auth-worker/wrangler.toml`.

- [ ] **Step 1: `db.ts`** — append:
```ts
export async function setTeeSignExtraction(db: D1Like, id: number, extractedJson: string, source: string | null) {
  await db.prepare("UPDATE tee_signs SET extracted_json = ?, extract_source = ? WHERE id = ?")
    .bind(extractedJson, source, id).run();
}
```

- [ ] **Step 2: `cf.d.ts`** — ensure an `ExecutionContext` type exists (add if missing):
```ts
export interface ExecutionContext { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void; }
```
(If `cf.d.ts` already declares it or imports workers-types, skip. Check first.)

- [ ] **Step 3: `index.ts`** —
  1. `Env`: add `OPENROUTER_VISION_MODEL?: string; VISION_MODEL?: string; VISION_DEV_STUB?: string;` and **extend the `AI` type** so image input typechecks:
     `AI?: { run(model: string, opts: { messages?: {...}[]; image?: number[]; prompt?: string; max_tokens?: number }): Promise<{ response?: string }> };`
     (Widen the existing `AI?` type — keep the existing `messages` shape and add `image?`/`prompt?`.)
  2. Import: `import { extractTeeSign, parseVisionJson } from "./vision.js";`
  3. Change the entrypoint to thread ctx:
     `async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {` (import `ExecutionContext` from `./cf.js`/`./cf.d` per existing convention).
  4. Pass `ctx` to the upload handler. In `handleTeeSignUpload(request, env, origin, ctx)`, after `const row = await db.insertTeeSign(...)`, before returning, kick off extraction:
     ```ts
     const signId = (row as { id: number }).id;
     ctx.waitUntil((async () => {
       try {
         const v = await extractTeeSign(env, img.bytes, img.contentType);
         await db.setTeeSignExtraction(env.DB, signId, JSON.stringify({ hole: v.hole, layouts: v.layouts }), v.source ?? null);
       } catch (e) { console.error("vision_extract_failed", signId, String(e)); }
     })());
     ```
     Thread `ctx` from the top-level dispatch call to `handleTeeSignUpload`.

- [ ] **Step 4: `wrangler.toml`** — under `[vars]` add commented guidance + defaults:
```toml
# Crotts vision (T2): tee-sign OCR. OpenRouter free VL model tried first (needs OPENROUTER_API_KEY),
# then Workers AI. Override the model ids here.
OPENROUTER_VISION_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free"
VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct"
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` clean; full `npm test` green (existing tee-signs-route tests must still pass — the upload handler now takes `ctx`; the route test's `worker.fetch(req, env)` call has no ctx, so **the worker must tolerate a missing ctx**: guard `ctx?.waitUntil?.(...)` OR update the route test to pass a stub `ctx = { waitUntil() {} }`. Prefer updating the test env to include a ctx stub — `worker.fetch(req, env, { waitUntil(){}, passThroughOnException(){} })` — and add a ctx param to the test `call()` helper).

- [ ] **Step 6: Commit**
```bash
git -C /home/kg/gvdg-wt-teesign add auth-worker/src/db.ts auth-worker/src/index.ts auth-worker/src/cf.d.ts auth-worker/wrangler.toml auth-worker/test/tee-signs-route.test.ts
git -C /home/kg/gvdg-wt-teesign commit -m "feat(tee-sign): run Crotts vision on upload (ctx.waitUntil) + store extraction"
```

---

## Task 3: admin queue auto-match enrichment + re-extract route

**Files:** `auth-worker/src/index.ts`, `auth-worker/test/tee-signs-route.test.ts`.

- [ ] **Step 1: Failing test** — add to `test/tee-signs-route.test.ts`: admin GET `/admin/tee-signs?status=candidate` returns each sign with a `suggestedRows` array derived from `extracted_json` (mock a row whose `extracted_json` is set), and `POST /admin/tee-signs/:id/extract` is 403 for non-admin / 200 for admin. (Use the mockDb to return a candidate row with `extracted_json` set for the list query.)

- [ ] **Step 2: Implement** — in the admin `sub === "tee-signs"` block:
  - On the GET list, after fetching the rows, enrich each: parse `extracted_json` (via `parseVisionJson` of the stored string is overkill — it's already our shape; `JSON.parse` it defensively), and for each layout build a suggested mapping:
    ```ts
    for (const row of teeSigns) {
      let layouts = [];
      try { layouts = JSON.parse(row.extracted_json || "{}").layouts || []; } catch {}
      row.suggestedRows = [];
      for (const l of layouts) {
        const matched = await db.matchLayout(env.DB, row.course_id, l.label);
        row.suggestedRows.push({
          label: l.label, color: l.color ?? null, par: l.par ?? null, distance_ft: l.distance_ft ?? null,
          tee: l.tee ?? null, target: l.target ?? null,
          layoutId: matched ? matched.id : null,
          suggestedLayoutName: matched ? matched.name : db.defaultLayoutName(l.label),
        });
      }
    }
    return json({ teeSigns }, 200, origin);
    ```
  - Add `POST /admin/tee-signs/:id/extract` (admin): get the sign; fetch its R2 object (`env.PHOTOS.get(sign.r2_key)`) → `await obj.arrayBuffer()` → `new Uint8Array(...)`; `const v = await extractTeeSign(env, bytes, sign.content_type)`; `await db.setTeeSignExtraction(env.DB, id, JSON.stringify({hole:v.hole,layouts:v.layouts}), v.source ?? null)`; return `{ ok: true, extracted: v }`. (R2BucketLike.get returns `{ body }`; to get bytes, extend the R2 type's get to also expose `arrayBuffer()` — add `arrayBuffer(): Promise<ArrayBuffer>` to the R2 object type in `photos.ts`.)

- [ ] **Step 3: Verify** — `npm test` green; `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**
```bash
git -C /home/kg/gvdg-wt-teesign add auth-worker/src/index.ts auth-worker/src/photos.ts auth-worker/test/tee-signs-route.test.ts
git -C /home/kg/gvdg-wt-teesign commit -m "feat(tee-sign): admin queue auto-match suggestions + re-extract route"
```

---

## Task 4: Live-verify (controller, `wrangler dev` on a FREE port)

**Not delegable.** Real vision inference needs an OpenRouter key / CF AI auth (like Crotts) — locally we verify the **pipeline** with the dev-stub; real OCR quality is verified on deploy or with a user-provided key (report honestly).

- [ ] **Step 1:** `cd auth-worker`; `.dev.vars` with `JWT_SECRET`, `ALLOWED_ORIGINS=http://localhost:8080`, and **`VISION_DEV_STUB=1`**. `wrangler d1 migrations apply DB --local`; reseed admin KV. `wrangler dev --local --port 8799` (8788 is the other session's — use a free port; confirm with `ss -ltnp`).
- [ ] **Step 2:** Drive: upload a PNG (member) → 201; poll `GET /my-tee-signs` until the row's `extracted_json` is populated (waitUntil ran) with the stub's Long/Short. Admin `GET /admin/tee-signs?status=candidate` → the sign has `suggestedRows` with `suggestedLayoutName` Long/Short and `layoutId` matched (after T1 created them) or null + default. `POST /admin/tee-signs/:id/extract` (admin) → 200 re-runs; non-admin → 403. Then approve using the suggested rows → confirm the T1 write path still works.
- [ ] **Step 3:** Stop wrangler by PID (not broad pkill; never `:8788`), scrub `.dev.vars`. Record results.

## Definition of done (T2)
- `npm test` green (incl. vision parse tests), `tsc` clean.
- Live-verified pipeline (dev-stub): upload → `waitUntil` extraction populates `extracted_json` → admin queue shows auto-matched `suggestedRows` → re-extract works → approve still writes layouts. Real inference noted as deploy/key-gated.
- Commits on `feat/tee-sign-capture`. Run `/simplify`→`/code-review`→`/security-review` at backend-PR prep. **Next:** T3 (member capture UI).
