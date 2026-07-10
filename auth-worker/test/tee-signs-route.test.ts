import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { signSession } from "../src/jwt.js";
import { jsonObject, objectField } from "./json.js";

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
    get: async (k: string) => store.has(k) ? {
      body: null,
      httpMetadata: { contentType: "image/jpeg" },
      arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
    } : null,
    delete: async (k: string) => void store.delete(k),
    _store: store,
  };
};
const PNG_DATAURL = "data:image/png;base64," + btoa(String.fromCharCode(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a));
let lastLayoutHolesJson = "";
function mockDb() {
  return { prepare: (sql: string) => {
    let bound: unknown[] = [];
    return {
      bind(...vals: unknown[]) { bound = vals; return this; },
      all: async () => {
        if (/SELECT \* FROM tee_signs WHERE status/i.test(sql)) {
          return { results: [{ id: 1, course_id: 3, hole_number: 5, status: "candidate", r2_key: "tee-signs/3/5/u.png", content_type: "image/png", uploaded_by: "m_jane", extracted_json: '{"hole":7,"layouts":[{"label":"Long","par":4,"distance_ft":420}]}', extract_source: "dev-stub" }], success: true };
        }
        if (/SELECT id, name FROM course_layouts WHERE course_id/i.test(sql)) {
          return { results: [], success: true };
        }
        // T4 render route: official-only uses IN (?), authed (official+candidate) uses IN (?,?).
        if (/SELECT id, hole_number, status FROM tee_signs WHERE course_id/i.test(sql)) {
          const official = { id: 1, hole_number: 7, status: "official" };
          const candidate = { id: 2, hole_number: 8, status: "candidate" };
          return { results: /IN \(\?,\?\)/.test(sql) ? [official, candidate] : [official], success: true };
        }
        return { results: [], success: true };
      },
      first: async () => {
        if (/SELECT \* FROM courses WHERE id/i.test(sql)) return { id: 3, name: "Test Course" };
        if (/INSERT INTO tee_signs/i.test(sql)) return { id: 1, status: "candidate", r2_key: "tee-signs/3/5/u.png" };
        if (/SELECT \* FROM tee_signs WHERE id/i.test(sql)) return { id: 1, course_id: 3, hole_number: 5, status: "candidate", r2_key: "tee-signs/3/5/u.png", content_type: "image/png", uploaded_by: "m_jane", extracted_json: null, extract_source: null };
        if (/INSERT INTO course_layouts/i.test(sql)) return { id: 99, course_id: 3, name: "Long", holes: "[]", total_par: null };
        if (/SELECT \* FROM course_layouts WHERE id/i.test(sql)) return { id: 99, course_id: 3, name: "Long", holes: "[]", total_par: null };
        if (/UPDATE course_layouts/i.test(sql)) { lastLayoutHolesJson = String(bound[1] ?? ""); return { id: 99 }; }
        if (/DELETE FROM tee_signs/i.test(sql)) return { r2_key: "tee-signs/3/5/u.png" };
        if (/UPDATE tee_signs/i.test(sql)) return { id: 1, status: "official" };
        return null;
      },
      run: async () => ({ success: true }),
    };
  } };
}
const env = (photos?: ReturnType<typeof r2>) => ({ ROSTER: kv(members), RATELIMIT: kv(), DB: mockDb(), PHOTOS: photos ?? r2(), JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080" } as unknown as Parameters<typeof worker.fetch>[1]);
const tok = (sub: string) => signSession({ sub, mustChangePin: false }, SECRET, 900);
async function call(path: string, method: string, token: string | Promise<string> | undefined, body?: unknown, photos?: ReturnType<typeof r2>) {
  const h: Record<string, string> = { Origin: "http://localhost:8080" };
  const resolved = token ? await token : undefined;
  if (resolved) h.authorization = "Bearer " + resolved;
  if (body) h["content-type"] = "application/json";
  return worker.fetch(new Request("https://w" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env(photos));
}

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
    expect(objectField(await jsonObject(res), "teeSign").status).toBe("candidate");
  });
});

describe("admin approve/reject", () => {
  it("403 for a non-admin approving", async () => {
    expect((await call("/admin/tee-signs/1/approve", "POST", tok("m_jane"), { rows: [{ par: 3 }] })).status).toBe(403);
  });
  it("approves with manual rows (admin)", async () => {
    lastLayoutHolesJson = "";
    const res = await call("/admin/tee-signs/1/approve", "POST", tok("m_admin"), { rows: [{ newLayoutName: "Long", par: 4, distance_ft: 420 }] });
    expect(res.status).toBe(200);
    const holes = JSON.parse(lastLayoutHolesJson) as { verified?: { tee_sign_id?: number | null }; tee_sign_id?: number | null }[];
    expect(holes[0]!.verified?.tee_sign_id).toBe(1);
    expect(holes[0]!.tee_sign_id).toBe(1);
  });
});

describe("admin reject/delete reclaim the R2 blob", () => {
  it("reject deletes the stored object (admin)", async () => {
    const photos = r2();
    photos._store.set("tee-signs/3/5/u.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const res = await call("/admin/tee-signs/1/reject", "POST", tok("m_admin"), {}, photos);
    expect(res.status).toBe(200);
    expect(photos._store.has("tee-signs/3/5/u.png")).toBe(false);
  });
  it("delete reclaims the stored object (admin)", async () => {
    const photos = r2();
    photos._store.set("tee-signs/3/5/u.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const res = await call("/admin/tee-signs/1", "DELETE", tok("m_admin"), undefined, photos);
    expect(res.status).toBe(200);
    expect(photos._store.has("tee-signs/3/5/u.png")).toBe(false);
  });
});

describe("GET /tee-signs/:id/image — rejected blobs are never served (IDOR)", () => {
  it("404s a rejected sign even for a logged-in member", async () => {
    const rejectedDb = { prepare: (sql: string) => ({
      bind() { return this; },
      all: async () => ({ results: [], success: true }),
      first: async () => (/FROM tee_signs WHERE id/i.test(sql)
        ? { id: 9, course_id: 3, hole_number: 5, status: "rejected", r2_key: "tee-signs/3/5/r.png", content_type: "image/png" }
        : null),
      run: async () => ({ success: true }),
    }) };
    const photos = r2();
    photos._store.set("tee-signs/3/5/r.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const e = { ROSTER: kv(members), RATELIMIT: kv(), DB: rejectedDb, PHOTOS: photos, JWT_SECRET: SECRET, ALLOWED_ORIGINS: "http://localhost:8080" } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(
      new Request("https://w/tee-signs/9/image", { headers: { Origin: "http://localhost:8080", authorization: "Bearer " + (await tok("m_jane")) } }),
      e,
    );
    expect(res.status).toBe(404);
  });
});

describe("admin tee-signs list with suggestedRows", () => {
  it("GET /admin/tee-signs?status=candidate returns suggestedRows from extracted_json", async () => {
    const res = await call("/admin/tee-signs?status=candidate", "GET", tok("m_admin"));
    expect(res.status).toBe(200);
    const body = await res.json() as { teeSigns: { suggestedRows: { label: string; layoutId: null; suggestedLayoutName: string }[] }[] };
    expect(Array.isArray(body.teeSigns)).toBe(true);
    expect(body.teeSigns.length).toBeGreaterThan(0);
    const sign = body.teeSigns[0]!;
    expect(Array.isArray(sign.suggestedRows)).toBe(true);
    expect(sign.suggestedRows.length).toBe(1);
    expect(sign.suggestedRows[0]!.label).toBe("Long");
    expect(sign.suggestedRows[0]!.layoutId).toBeNull(); // no layout in mock DB
    expect(sign.suggestedRows[0]!.suggestedLayoutName).toBe("Long"); // defaultLayoutName("Long")
  });
});

describe("GET /courses/:id/tee-signs (T4 render)", () => {
  it("unauthed sees official tee signs only", async () => {
    const res = await call("/courses/3/tee-signs", "GET", undefined);
    expect(res.status).toBe(200);
    const body = await res.json() as { teeSigns: { id: number; hole_number: number; status: string }[] };
    expect(body.teeSigns.map((t) => t.status)).toEqual(["official"]);
  });
  it("a logged-in member also sees candidates", async () => {
    const res = await call("/courses/3/tee-signs", "GET", tok("m_jane"));
    expect(res.status).toBe(200);
    const body = await res.json() as { teeSigns: { status: string }[] };
    expect(body.teeSigns.map((t) => t.status).sort()).toEqual(["candidate", "official"]);
  });
});

describe("POST /admin/tee-signs/:id/extract", () => {
  it("403 for non-admin", async () => {
    const photos = r2();
    photos._store.set("tee-signs/3/5/u.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect((await call("/admin/tee-signs/1/extract", "POST", tok("m_jane"), undefined, photos)).status).toBe(403);
  });
  it("200 for admin re-extracts and returns extracted vision result", async () => {
    const photos = r2();
    photos._store.set("tee-signs/3/5/u.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const res = await call("/admin/tee-signs/1/extract", "POST", tok("m_admin"), undefined, photos);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; extracted: { hole: unknown; layouts: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.extracted).toBeDefined();
    expect(Array.isArray(body.extracted.layouts)).toBe(true);
  });
});
