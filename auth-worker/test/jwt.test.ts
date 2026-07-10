import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/jwt.js";

const SECRET = "test-secret-at-least-32-bytes-long-aaaa";

describe("session JWT", () => {
  it("round-trips the claims for a valid token", async () => {
    const token = await signSession({ sub: "pdga:12345", mustChangePin: true }, SECRET, 900);
    const claims = await verifySession(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("pdga:12345");
    expect(claims!.mustChangePin).toBe(true);
  });

  it("returns null when verified with the wrong secret", async () => {
    const token = await signSession({ sub: "pdga:12345", mustChangePin: false }, SECRET, 900);
    expect(await verifySession(token, "a-totally-different-secret-32bytes-xx")).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const token = await signSession({ sub: "pdga:12345", mustChangePin: false }, SECRET, 900);
    const tampered = token.slice(0, -3) + (token.slice(-3) === "AAA" ? "BBB" : "AAA");
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const token = await signSession({ sub: "pdga:12345", mustChangePin: false }, SECRET, -10);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it("returns null for garbage", async () => {
    expect(await verifySession("not.a.jwt", SECRET)).toBeNull();
    expect(await verifySession("", SECRET)).toBeNull();
  });
});
