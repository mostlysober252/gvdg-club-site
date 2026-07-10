# Tee-Sign T1 — Storage + Upload Backbone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Members can upload a tee-sign photo for a course+hole; it's stored in R2 with a D1 ledger row (`status='candidate'`); members see their own uploads; an admin reviews and **approves** a photo, writing par/distance into one or more course layouts and marking the photo official. **No AI yet** (par/distance entered manually on approve — T2 adds Crotts vision).

**Architecture:** Extend the existing `auth-worker/` Worker. New R2 binding `PHOTOS` holds images; D1 table `tee_signs` is the capture/moderation ledger; the scoring source of truth stays `course_layouts.holes`. New pure module `src/photos.ts` validates images (magic-byte sniff) and generates keys; `src/db.ts` gains the ledger CRUD + `ensureDefaultLayouts`/`matchLayout`/`applyTeeSignRows`; `src/index.ts` adds member + admin routes. All authz reuses `requireAuth`/`adminGate`. Tests use the repo's SQL-aware mock-DB + mock-KV pattern driving `worker.fetch`; real R2/D1 behavior is **live-verified with `wrangler dev --local`**.

**Tech Stack:** TypeScript Cloudflare Worker, D1 (SQLite), R2, vitest (`npm test`), wrangler.

**Coordination:** Independent of the parallel `feat/live-cards-scoring` track but touches the same files (`index.ts`, `db.ts`, `wrangler.toml`). Migration is **`0008`** (0007 is their `0007_casual_rounds.sql`). Whoever merges second rebases.

**Setup:** All work in worktree `/home/kg/gvdg-wt-teesign` (branch `feat/tee-sign-capture`, git identity configured). Worker commands run from `/home/kg/gvdg-wt-teesign/auth-worker`.

## File Structure

- Modify: `auth-worker/wrangler.toml` — add `[[r2_buckets]] PHOTOS`.
- Create: `auth-worker/migrations/0008_tee_signs.sql` — `tee_signs` table + `course_positions.color` ALTER.
- Create: `auth-worker/src/photos.ts` — image validation (magic-byte) + R2 key generation. Pure + thin R2 wrappers.
- Modify: `auth-worker/src/index.ts` — `Env` (add `PHOTOS`), member + admin tee-sign routes.
- Modify: `auth-worker/src/db.ts` — `tee_signs` CRUD, `ensureDefaultLayouts`, `matchLayout`, `applyTeeSignRows`, position `color`.
- Create: `auth-worker/test/photos.test.ts`, `auth-worker/test/tee-signs-route.test.ts`, `auth-worker/test/layout-match.test.ts`.

---

## Task 1: Migration 0008 + R2 binding + Env

**Files:**
- Create: `auth-worker/migrations/0008_tee_signs.sql`
- Modify: `auth-worker/wrangler.toml`
- Modify: `auth-worker/src/index.ts` (Env interface)

- [ ] **Step 1: Write the migration**

Create `auth-worker/migrations/0008_tee_signs.sql`:

```sql
-- Tee-sign capture (T1): crowdsourced per-hole photos + the par/distance an admin confirms from them.
-- The image bytes live in R2 (binding PHOTOS); this table is the capture/moderation ledger.
-- One row per uploaded photo; extracted_json holds the (later, AI-filled) per-layout suggestions.
CREATE TABLE tee_signs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id     INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  hole_number   INTEGER NOT NULL,
  r2_key        TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  status        TEXT NOT NULL DEFAULT 'candidate',   -- candidate | official | rejected
  extracted_json TEXT,                                -- JSON [{label,color,par,distance_ft,tee,target}] (T2)
  extract_source TEXT,                                -- 'openrouter:..' | 'workers-ai:..' | 'manual' | NULL
  reviewed_by   TEXT,
  reviewed_at   TEXT
);
CREATE INDEX idx_tee_signs_hole ON tee_signs(course_id, hole_number, status);
CREATE INDEX idx_tee_signs_status ON tee_signs(status);

-- Admin-assignable color on tees/targets (course_positions shipped in 0003). Rendered as swatches.
ALTER TABLE course_positions ADD COLUMN color TEXT;
```

- [ ] **Step 2: Add the R2 binding to `wrangler.toml`**

After the `[[d1_databases]]` block in `auth-worker/wrangler.toml`, add:

```toml
# Tee-sign photos (T1). mostlysober252: `wrangler r2 bucket create gvdg-photos` then deploy.
[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "gvdg-photos"
```

- [ ] **Step 3: Add `PHOTOS` to the `Env` interface in `src/index.ts`**

In the `export interface Env { ... }` block, after the `DB: D1Like;` line, add:

```ts
  /** Cloudflare R2 — tee-sign photo storage (T1). */
  PHOTOS: R2BucketLike;
```

And add this minimal R2 type near the other `*Like` types (top of `src/index.ts`, or in `src/photos.ts` and import it — put it in `src/photos.ts`, see Task 2, and `import type { R2BucketLike } from "./photos.js";`).

- [ ] **Step 4: Verify the migration applies against local D1**

Run:
```bash
cd /home/kg/gvdg-wt-teesign/auth-worker
npx wrangler d1 migrations apply DB --local
npx wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE name='tee_signs'"
npx wrangler d1 execute DB --local --command "SELECT name FROM pragma_table_info('course_positions') WHERE name='color'"
```
Expected: `tee_signs` listed; `color` column present. (This is live-verify of the schema; the controller runs it.)

- [ ] **Step 5: Commit**

```bash
git -C /home/kg/gvdg-wt-teesign add auth-worker/migrations/0008_tee_signs.sql auth-worker/wrangler.toml auth-worker/src/index.ts
git -C /home/kg/gvdg-wt-teesign commit -m "feat(tee-sign): D1 0008 (tee_signs + position color) + R2 PHOTOS binding"
```

---

## Task 2: `src/photos.ts` — image validation + R2 helpers

**Files:**
- Create: `auth-worker/src/photos.ts`
- Test: `auth-worker/test/photos.test.ts`

- [ ] **Step 1: Write the failing test**

Create `auth-worker/test/photos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decodeDataUrl, teeSignKey, MAX_PHOTO_BYTES } from "../src/photos.js";

// minimal valid byte headers
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new Uint8Array([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("decodeDataUrl", () => {
  it("accepts jpeg/png/webp by magic bytes and returns bytes + content type", () => {
    const j = decodeDataUrl(`data:image/jpeg;base64,${b64(JPEG)}`);
    expect(j && j.contentType).toBe("image/jpeg");
    expect(j && j.ext).toBe("jpg");
    expect(decodeDataUrl(`data:image/png;base64,${b64(PNG)}`)?.contentType).toBe("image/png");
    expect(decodeDataUrl(`data:image/webp;base64,${b64(WEBP)}`)?.contentType).toBe("image/webp");
  });

  it("rejects SVG and mismatched/garbage content", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64");
    expect(decodeDataUrl(`data:image/svg+xml;base64,${svg}`)).toBeNull();
    expect(decodeDataUrl(`data:image/jpeg;base64,${b64(PNG)}`)).toBeNull(); // header != claimed type
    expect(decodeDataUrl("not a data url")).toBeNull();
    expect(decodeDataUrl(`data:image/jpeg;base64,$$$notbase64$$$`)).toBeNull();
  });

  it("rejects oversize payloads", () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 4);
    big.set(JPEG);
    expect(decodeDataUrl(`data:image/jpeg;base64,${b64(big)}`)).toBeNull();
  });
});

describe("teeSignKey", () => {
  it("builds a sanitized, namespaced key with the given extension", () => {
    const k = teeSignKey(12, 7, "jpg", "abc-123");
    expect(k).toBe("tee-signs/12/7/abc-123.jpg");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/kg/gvdg-wt-teesign/auth-worker && npm test -- photos.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/photos.ts`**

Create `auth-worker/src/photos.ts`:

```ts
// Tee-sign photo handling (T1): validate an uploaded image (data URL) by MAGIC BYTES — never trust the
// declared MIME — and generate a safe, server-controlled R2 object key. SVG is rejected (script vector).
// Pure decode/validation here; the thin R2 wrappers take any object matching R2BucketLike.

export const MAX_PHOTO_BYTES = 3_000_000; // ~3 MB after client-side resize

export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
}

export interface DecodedImage {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
}

function sniff(bytes: Uint8Array): DecodedImage["contentType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

const EXT: Record<DecodedImage["contentType"], DecodedImage["ext"]> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

/** Decode a `data:image/...;base64,...` URL to validated bytes, or null if invalid/oversize/wrong-type.
 *  Content type is determined by MAGIC BYTES and must match the declared type. */
export function decodeDataUrl(dataUrl: unknown): DecodedImage | null {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  const declared = m[1];
  let bytes: Uint8Array;
  try {
    const bin = atob(m[2]!);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return null;
  const sniffed = sniff(bytes);
  if (!sniffed || sniffed !== declared) return null; // reject SVG (no magic) + declared/actual mismatch
  return { bytes, contentType: sniffed, ext: EXT[sniffed] };
}

/** Server-controlled R2 key. courseId/hole are integers; uuid is server-generated — no user input. */
export function teeSignKey(courseId: number, hole: number, ext: string, uuid: string): string {
  return `tee-signs/${courseId}/${hole}/${uuid}.${ext}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- photos.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kg/gvdg-wt-teesign add auth-worker/src/photos.ts auth-worker/test/photos.test.ts
git -C /home/kg/gvdg-wt-teesign commit -m "feat(tee-sign): photos.ts — magic-byte image validation + R2 key"
```

---

## Task 3: `db.ts` — ledger CRUD, layout match, applyTeeSignRows

**Files:**
- Modify: `auth-worker/src/db.ts`
- Test: `auth-worker/test/layout-match.test.ts`

`matchLayout` is pure and unit-tested here. The DB functions are exercised by the route tests (Task 4) and live-verified (Task 5).

- [ ] **Step 1: Write the failing test for `normalizeLayoutLabel`/`matchLayout` defaulting**

Create `auth-worker/test/layout-match.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeLayoutLabel, defaultLayoutName } from "../src/db.js";

describe("normalizeLayoutLabel", () => {
  it("lowercases, strips 'tees'/'layout', collapses whitespace", () => {
    expect(normalizeLayoutLabel("  Long Tees ")).toBe("long");
    expect(normalizeLayoutLabel("BLUE layout")).toBe("blue");
    expect(normalizeLayoutLabel("Short")).toBe("short");
    expect(normalizeLayoutLabel(null)).toBe("");
  });
});

describe("defaultLayoutName", () => {
  it("maps an extracted label to Long/Short, else echoes a clean title", () => {
    expect(defaultLayoutName("long")).toBe("Long");
    expect(defaultLayoutName("LONG TEES")).toBe("Long");
    expect(defaultLayoutName("short")).toBe("Short");
    expect(defaultLayoutName("blue")).toBe("Blue");      // unknown -> title-cased echo
    expect(defaultLayoutName("")).toBe("Main");          // empty -> Main
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- layout-match.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the db additions**

Append to `auth-worker/src/db.ts`:

```ts
// ---- Tee signs (T1) ----
export interface TeeSignRow {
  id: number; course_id: number; hole_number: number; r2_key: string;
  content_type: string; bytes: number; uploaded_by: string; created_at: string;
  status: string; extracted_json: string | null; extract_source: string | null;
  reviewed_by: string | null; reviewed_at: string | null;
}

export async function insertTeeSign(db: D1Like, t: {
  course_id: number; hole_number: number; r2_key: string; content_type: string; bytes: number; uploaded_by: string;
}) {
  return db.prepare(
    "INSERT INTO tee_signs (course_id, hole_number, r2_key, content_type, bytes, uploaded_by, status) " +
    "VALUES (?, ?, ?, ?, ?, ?, 'candidate') RETURNING *",
  ).bind(t.course_id, t.hole_number, t.r2_key, t.content_type, t.bytes, t.uploaded_by).first();
}

export async function getTeeSign(db: D1Like, id: number) {
  return db.prepare("SELECT * FROM tee_signs WHERE id = ?").bind(id).first() as Promise<TeeSignRow | null>;
}

export async function listMyTeeSigns(db: D1Like, memberId: string) {
  return (await db.prepare(
    "SELECT * FROM tee_signs WHERE uploaded_by = ? ORDER BY created_at DESC",
  ).bind(memberId).all()).results;
}

export async function listTeeSignsByStatus(db: D1Like, status: string) {
  return (await db.prepare(
    "SELECT * FROM tee_signs WHERE status = ? ORDER BY course_id, hole_number, created_at",
  ).bind(status).all()).results;
}

export async function setTeeSignStatus(db: D1Like, id: number, status: string, reviewedBy: string) {
  return db.prepare(
    "UPDATE tee_signs SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? RETURNING *",
  ).bind(status, reviewedBy, id).first();
}

export async function deleteTeeSign(db: D1Like, id: number) {
  await db.prepare("DELETE FROM tee_signs WHERE id = ?").bind(id).run();
}

// ---- Layout matching / defaults ----
export function normalizeLayoutLabel(label: unknown): string {
  return String(label ?? "").toLowerCase().replace(/\b(tees?|layout|pads?)\b/g, "").replace(/\s+/g, " ").trim();
}

export function defaultLayoutName(label: unknown): string {
  const n = normalizeLayoutLabel(label);
  if (n === "long") return "Long";
  if (n === "short") return "Short";
  if (!n) return "Main";
  return n.charAt(0).toUpperCase() + n.slice(1); // title-cased echo of an unknown label (e.g. "Blue")
}

/** Find an existing layout for the course whose name matches the label (normalized), else null. */
export async function matchLayout(db: D1Like, courseId: number, label: unknown): Promise<{ id: number; name: string } | null> {
  const want = normalizeLayoutLabel(label) || normalizeLayoutLabel(defaultLayoutName(label));
  const rows = (await db.prepare("SELECT id, name FROM course_layouts WHERE course_id = ?").bind(courseId).all()).results as { id: number; name: string }[];
  for (const r of rows) if (normalizeLayoutLabel(r.name) === want) return { id: r.id, name: r.name };
  return null;
}

/** Ensure the course has Long + Short layouts; returns nothing (idempotent). */
export async function ensureDefaultLayouts(db: D1Like, courseId: number) {
  for (const name of ["Long", "Short"]) {
    if (!(await matchLayout(db, courseId, name))) {
      await createLayout(db, { course_id: courseId, name, holes: [], total_par: null });
    }
  }
}

export interface ApproveRow {
  layoutId?: number | null;
  newLayoutName?: string | null;
  par: number;
  distance_ft?: number | null;
  tee?: string | null;
  target?: string | null;
  color?: string | null;
}

/** Apply confirmed tee-sign rows: for each row resolve/create a layout and write hole `hole` with
 *  {par, distance_ft, tee_sign_key, (tee/target labels)}, then stamp the official photo key on it.
 *  Returns the list of affected layout ids. The official-photo bookkeeping (status flip / demote prior)
 *  is done by the caller via setTeeSignStatus + demoteOtherOfficial. */
export async function applyTeeSignRows(
  db: D1Like, courseId: number, hole: number, rows: ApproveRow[], teeSignKey: string,
): Promise<number[]> {
  const affected: number[] = [];
  for (const row of rows) {
    let layoutId = row.layoutId ?? null;
    if (layoutId == null) {
      const name = (row.newLayoutName && String(row.newLayoutName).slice(0, 80)) || "Main";
      const created = (await createLayout(db, { course_id: courseId, name, holes: [], total_par: null })) as { id: number };
      layoutId = created.id;
    }
    const layout = (await getLayout(db, layoutId)) as { holes?: string } | null;
    const holes: Record<string, unknown>[] = JSON.parse(layout?.holes ?? "[]");
    const idx = holes.findIndex((h) => Number(h.hole) === hole);
    const entry: Record<string, unknown> = {
      hole, par: row.par,
      distance_ft: row.distance_ft ?? null,
      distance_source: row.distance_ft != null ? "tee_sign" : null,
      tee: row.tee ? { label: String(row.tee).slice(0, 80) } : null,
      target: row.target ? { label: String(row.target).slice(0, 80) } : null,
      tee_sign_key: teeSignKey,
    };
    if (idx >= 0) holes[idx] = { ...holes[idx], ...entry }; else holes.push(entry);
    holes.sort((a, b) => Number(a.hole) - Number(b.hole));
    await updateLayout(db, layoutId, { holes });
    affected.push(layoutId);
  }
  return affected;
}

/** Demote any OTHER official tee sign for the same (course, hole) to 'rejected' so there is one official. */
export async function demoteOtherOfficial(db: D1Like, courseId: number, hole: number, keepId: number) {
  await db.prepare(
    "UPDATE tee_signs SET status = 'rejected' WHERE course_id = ? AND hole_number = ? AND status = 'official' AND id != ?",
  ).bind(courseId, hole, keepId).run();
}
```

Also update `createPosition` and `PositionInput` to carry `color` (so admins can set it). Change the `PositionInput` interface to add `color?: string | null;` and update the `createPosition` INSERT to include `color`:

```ts
// PositionInput: add `color?: string | null;`
// createPosition INSERT:
return db
  .prepare("INSERT INTO course_positions (course_id, kind, label, lat, lng, color) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
  .bind(p.course_id, p.kind, p.label, p.lat ?? null, p.lng ?? null, p.color ?? null)
  .first();
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- layout-match.test.ts` → PASS. Also `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git -C /home/kg/gvdg-wt-teesign add auth-worker/src/db.ts auth-worker/test/layout-match.test.ts
git -C /home/kg/gvdg-wt-teesign commit -m "feat(tee-sign): db ledger CRUD + matchLayout/ensureDefaultLayouts/applyTeeSignRows"
```

---

## Task 4: `index.ts` — member + admin routes

**Files:**
- Modify: `auth-worker/src/index.ts`
- Test: `auth-worker/test/tee-signs-route.test.ts`

Add a helper `requireMember` if not present (member-authed gate returning claims or a Response) — check `src/index.ts`; the parallel track may have added one. If absent, add:

```ts
async function requireMember(request: Request, env: Env, origin: string | null): Promise<{ sub: string } | Response> {
  const claims = await requireAuth(request, env);
  if (!claims) return json({ error: "unauthorized" }, 401, origin);
  return { sub: claims.sub };
}
```

- [ ] **Step 1: Write the failing route tests**

Create `auth-worker/test/tee-signs-route.test.ts` (mirrors `registration.test.ts`'s mock-fetch pattern; mock `PHOTOS` too):

```ts
import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";

const SECRET = "x".repeat(40);
const members = {
  "member:m_jane": JSON.stringify({ memberId: "m_jane", name: "Jane", isAdmin: false, pinHash: "x", mustChangePin: false }),
  "member:m_admin": JSON.stringify({ memberId: "m_admin", name: "Admin", isAdmin: true, pinHash: "x", mustChangePin: false }),
};
const kv = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
};
const r2 = () => {
  const store = new Map<string, Uint8Array>();
  return {
    put: async (k: string, v: Uint8Array) => void store.set(k, v),
    get: async (k: string) => store.has(k) ? { body: null, httpMetadata: { contentType: "image/jpeg" } } : null,
    delete: async (k: string) => void store.delete(k),
    _store: store,
  };
};
const PNG_DATAURL = "data:image/png;base64," + Buffer.from(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])).toString("base64");
function mockDb() {
  return { prepare: (sql: string) => ({
    bind() { return this; },
    all: async () => ({ results: [], success: true }),
    first: async () => {
      if (/INSERT INTO tee_signs/i.test(sql)) return { id: 1, status: "candidate", r2_key: "tee-signs/3/5/u.png" };
      if (/SELECT \* FROM tee_signs WHERE id/i.test(sql)) return { id: 1, course_id: 3, hole_number: 5, status: "candidate", r2_key: "tee-signs/3/5/u.png", content_type: "image/png", uploaded_by: "m_jane" };
      return null;
    },
    run: async () => ({ success: true }),
  }) };
}
const env = () => ({ ROSTER: kv(members), RATELIMIT: kv(), DB: mockDb(), PHOTOS: r2(), JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080" } as unknown as Parameters<typeof worker.fetch>[1]);
const tok = (sub: string) => signSession({ sub, mustChangePin: false }, SECRET, 900);
const call = (path: string, method: string, token: string | undefined, body?: unknown) => {
  const h: Record<string, string> = { Origin: "http://localhost:8080" };
  if (token) h.authorization = "Bearer " + token;
  if (body) h["content-type"] = "application/json";
  return worker.fetch(new Request("https://w" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env());
};

describe("POST /tee-signs", () => {
  it("401 without auth", async () => {
    expect((await call("/tee-signs", "POST", undefined, { courseId: 3, hole: 5, image: PNG_DATAURL })).status).toBe(401);
  });
  it("400 on a bad image", async () => {
    const res = await call("/tee-signs", "POST", tok("m_jane"), { courseId: 3, hole: 5, image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" });
    expect(res.status).toBe(400);
  });
  it("201 stores a candidate for a valid png", async () => {
    const res = await call("/tee-signs", "POST", tok("m_jane"), { courseId: 3, hole: 5, image: PNG_DATAURL });
    expect(res.status).toBe(201);
    expect((await res.json()).teeSign.status).toBe("candidate");
  });
});

describe("admin approve/reject", () => {
  it("403 for a non-admin approving", async () => {
    expect((await call("/admin/tee-signs/1/approve", "POST", tok("m_jane"), { rows: [{ par: 3 }] })).status).toBe(403);
  });
  it("approves with manual rows (admin)", async () => {
    const res = await call("/admin/tee-signs/1/approve", "POST", tok("m_admin"), { rows: [{ newLayoutName: "Long", par: 4, distance_ft: 420 }] });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tee-signs-route.test.ts`
Expected: FAIL (routes 404 / not implemented).

- [ ] **Step 3: Implement the routes**

In `src/index.ts`, in the top-level `fetch` dispatch (next to `/my-results`, `/board`, etc.), add member routes:

```ts
    if (pathname === "/tee-signs" && method === "POST") return handleTeeSignUpload(request, env, origin);
    if (pathname === "/my-tee-signs" && method === "GET") return handleMyTeeSigns(request, env, origin);
    if (seg0(pathname) === "tee-signs" && segLen(pathname) === 3 && pathSeg(pathname, 2) === "image" && method === "GET")
      return handleTeeSignImage(request, env, origin, asInt(pathSeg(pathname, 1)));
```

(Use the existing path-splitting approach already used in `clubApi`; if there's no `seg0`/`pathSeg` helper, compute `const seg = pathname.split('/').filter(Boolean)` at the top of `fetch` as `clubApi` does, and match `seg[0]==='tee-signs'`.) Then implement the handlers:

```ts
async function handleTeeSignUpload(request: Request, env: Env, origin: string | null): Promise<Response> {
  const who = await requireMember(request, env, origin);
  if (who instanceof Response) return who;
  // simple per-member rate limit reusing the existing KV limiter (10/min)
  const limited = await kvRateLimited(env.RATELIMIT, `teesign:${who.sub}`, 10, 60);
  if (limited) return json({ error: "rate_limited" }, 429, origin);
  const body = await readJson(request);
  const courseId = asInt(body?.courseId);
  const hole = asInt(body?.hole);
  if (courseId == null || hole == null || hole < 1 || hole > 99) return json({ error: "invalid_request" }, 400, origin);
  const img = decodeDataUrl(body?.image);
  if (!img) return json({ error: "invalid_image" }, 400, origin);
  const key = teeSignKey(courseId, hole, img.ext, crypto.randomUUID());
  await env.PHOTOS.put(key, img.bytes, { httpMetadata: { contentType: img.contentType } });
  const row = await db.insertTeeSign(env.DB, {
    course_id: courseId, hole_number: hole, r2_key: key, content_type: img.contentType, bytes: img.bytes.length, uploaded_by: who.sub,
  });
  return json({ teeSign: row }, 201, origin);
}

async function handleMyTeeSigns(request: Request, env: Env, origin: string | null): Promise<Response> {
  const who = await requireMember(request, env, origin);
  if (who instanceof Response) return who;
  return json({ teeSigns: await db.listMyTeeSigns(env.DB, who.sub) }, 200, origin);
}

async function handleTeeSignImage(request: Request, env: Env, origin: string | null, id: number | null): Promise<Response> {
  if (id == null) return json({ error: "not_found" }, 404, origin);
  const sign = await db.getTeeSign(env.DB, id);
  if (!sign) return json({ error: "not_found" }, 404, origin);
  // Official photos are public; candidates require a logged-in member (served as an authed blob fetch).
  if (sign.status !== "official") {
    const who = await requireMember(request, env, origin);
    if (who instanceof Response) return who;
  }
  const obj = await env.PHOTOS.get(sign.r2_key);
  if (!obj) return json({ error: "not_found" }, 404, origin);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": sign.content_type,
      "Cache-Control": sign.status === "official" ? "public, max-age=86400" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(origin),
    },
  });
}
```

In `clubApi`, under the admin section (after `adminGate` passes), add the tee-sign admin routes:

```ts
  if (sub === "tee-signs") {
    if (method === "GET" && id == null) {
      const status = new URL(request.url).searchParams.get("status") || "candidate";
      return json({ teeSigns: await db.listTeeSignsByStatus(env.DB, status) }, 200, origin);
    }
    if (id != null && seg[3] === "approve" && method === "POST") {
      const b = (await readJson(request)) ?? {};
      const rawRows = Array.isArray(b.rows) ? b.rows : [];
      const rows: db.ApproveRow[] = [];
      for (const r of rawRows) {
        const o = r as Record<string, unknown>;
        const par = asInt(o.par);
        if (par == null || par < 1 || par > 10) continue;
        rows.push({
          layoutId: o.layoutId == null ? null : asInt(o.layoutId),
          newLayoutName: o.newLayoutName == null ? null : asStr(o.newLayoutName, 80),
          par,
          distance_ft: o.distance_ft == null ? null : asInt(o.distance_ft),
          tee: o.tee == null ? null : asStr(o.tee, 80),
          target: o.target == null ? null : asStr(o.target, 80),
          color: o.color == null ? null : asStr(o.color, 24),
        });
      }
      if (!rows.length) return json({ error: "no_valid_rows" }, 400, origin);
      const sign = await db.getTeeSign(env.DB, id);
      if (!sign) return json({ error: "not_found" }, 404, origin);
      const affected = await db.applyTeeSignRows(env.DB, sign.course_id, sign.hole_number, rows, sign.r2_key);
      await db.setTeeSignStatus(env.DB, id, "official", gate.adminId);
      await db.demoteOtherOfficial(env.DB, sign.course_id, sign.hole_number, id);
      return json({ ok: true, affectedLayouts: affected }, 200, origin);
    }
    if (id != null && seg[3] === "reject" && method === "POST") {
      await db.setTeeSignStatus(env.DB, id, "rejected", gate.adminId);
      return json({ ok: true }, 200, origin);
    }
    if (id != null && method === "DELETE") { await db.deleteTeeSign(env.DB, id); return json({ ok: true }, 200, origin); }
  }
```

(Confirm `gate` is the `adminGate` result variable in scope in `clubApi` — it is, used by the other admin routes. Reuse `kvRateLimited` if it exists from the `/simplify` pass; if not, inline a simple counter using `RATELIMIT` get/put. Import `decodeDataUrl`, `teeSignKey` from `./photos.js`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tee-signs-route.test.ts` → PASS. Then `npm test` (full suite) → all green. Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git -C /home/kg/gvdg-wt-teesign add auth-worker/src/index.ts auth-worker/test/tee-signs-route.test.ts
git -C /home/kg/gvdg-wt-teesign commit -m "feat(tee-sign): member upload + image serve + admin review/approve routes"
```

---

## Task 5: Live-verify end-to-end (controller, `wrangler dev --local`)

**Not delegable** — the controller runs this in the main session (subagents can't run the app).

- [ ] **Step 1: Bring up the local stack**

```bash
cd /home/kg/gvdg-wt-teesign/auth-worker
npx wrangler d1 migrations apply DB --local
printf 'JWT_SECRET=local-dev-secret-at-least-32-bytes-long\nALLOWED_ORIGINS=http://localhost:8080\n' > .dev.vars
# seed an admin + a member into ROSTER (reuse scripts/dev-seed.mjs or provision.mjs), then:
npx wrangler dev --local --port 8788
```

- [ ] **Step 2: Drive the flow with curl (and confirm R2 + D1)**

- `POST /tee-signs` as a member with a real small PNG data URL → 201, `status:candidate`; confirm the object exists: `npx wrangler r2 object get gvdg-photos/<key> --local` and the row: `npx wrangler d1 execute DB --local --command "SELECT id,status,r2_key FROM tee_signs"`.
- `GET /tee-signs/1/image` without auth → 401 (candidate is members-only); with a member token → 200 image bytes.
- `POST /admin/tee-signs/1/approve` as a non-admin → 403; as admin with `{rows:[{newLayoutName:"Long",par:4,distance_ft:420},{newLayoutName:"Short",par:3,distance_ft:285}]}` → 200, `affectedLayouts` has 2 ids.
- Confirm both layouts now carry hole 5 with par/distance/tee_sign_key: `npx wrangler d1 execute DB --local --command "SELECT name,holes FROM course_layouts WHERE course_id=<cid>"`.
- `GET /tee-signs/1/image` now (official) without auth → 200 (public). Upload a 2nd sign for the same hole, approve it, confirm the first flips to `rejected` (one official per hole).
- Negative: SVG upload → 400; oversize → 400.

- [ ] **Step 3: Record results + stop the stack**

Note pass/fail per check. Stop wrangler by exact PID (`pgrep -x workerd`) — NOT broad `pkill` (it matches the controller's own shell). Scrub `.dev.vars`.

---

## Definition of done (T1)

- `npm test` all green (incl. photos, layout-match, tee-signs-route); `npx tsc --noEmit` clean.
- Live-verified: upload → R2 + D1 candidate → members-only serve → admin approve writes 2 layouts + flips official → public serve → one-official-per-hole; SVG/oversize rejected.
- Commits on `feat/tee-sign-capture`.
- Run `/simplify` → `/code-review` → `/security-review` on the diff before the T1 PR. **Next:** T2 (Crotts vision + auto-match) — its own plan.
