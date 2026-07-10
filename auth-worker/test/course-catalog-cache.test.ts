import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index.js";

const SECRET = "x".repeat(40);

function kv() {
  return { get: async () => null, put: async () => undefined, delete: async () => undefined };
}

function installCache() {
  const store = new Map<string, Response>();
  const defaultCache = {
    match: async (request: Request) => store.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => {
      store.set(request.url, response.clone());
    },
  };
  vi.stubGlobal("caches", { open: async () => defaultCache });
}

function courseDb() {
  let calls = 0;
  const statement = {
    bind() {
      return statement;
    },
    all: async () => {
      calls += 1;
      if (calls > 1) throw new Error("D1_ERROR: Network connection lost.");
      return { results: [{ id: 1, name: "ECU North Rec Complex", is_default: 1 }], success: true };
    },
    first: async () => null,
    run: async () => ({ results: [], success: true }),
  };
  return {
    calls: () => calls,
    db: { prepare: () => statement },
  };
}

function env(db: unknown) {
  return {
    ROSTER: kv(),
    RATELIMIT: kv(),
    DB: db,
    JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: "https://gvdgclub.com",
    LIVE: undefined,
  } as unknown as Parameters<typeof worker.fetch>[1];
}

function request() {
  return new Request("https://w/courses", { headers: { Origin: "https://gvdgclub.com" } });
}

describe("public course catalog cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves repeated course-list requests from Worker cache", async () => {
    installCache();
    const courses = courseDb();

    const first = await worker.fetch(request(), env(courses.db));
    const second = await worker.fetch(request(), env(courses.db));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(courses.calls()).toBe(1);
    expect(await second.json()).toMatchObject({ courses: [{ id: 1, name: "ECU North Rec Complex" }] });
  });
});
