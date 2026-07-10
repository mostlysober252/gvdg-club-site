import { describe, it, expect } from "vitest";
import {
  getCredentials,
  addCredential,
  updateCredentialCounter,
  putChallenge,
  takeChallenge,
} from "../src/webauthn.js";
import type { KVLike } from "../src/ratelimit.js";

function makeKV(): KVLike {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
}

const cred = (id: string) => ({ id, publicKey: "pk_" + id, counter: 0, transports: ["internal"] });

describe("webauthn credential store", () => {
  it("returns [] for a member with no credentials", async () => {
    expect(await getCredentials(makeKV(), "m_1")).toEqual([]);
  });

  it("adds and lists credentials", async () => {
    const kv = makeKV();
    await addCredential(kv, "m_1", cred("a"));
    await addCredential(kv, "m_1", cred("b"));
    const list = await getCredentials(kv, "m_1");
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("does not store a duplicate credential id", async () => {
    const kv = makeKV();
    await addCredential(kv, "m_1", cred("a"));
    await addCredential(kv, "m_1", cred("a"));
    expect((await getCredentials(kv, "m_1")).length).toBe(1);
  });

  it("updates the signature counter for a credential", async () => {
    const kv = makeKV();
    await addCredential(kv, "m_1", cred("a"));
    await updateCredentialCounter(kv, "m_1", "a", 7);
    expect((await getCredentials(kv, "m_1"))[0]!.counter).toBe(7);
  });
});

describe("webauthn challenge store (one-time use)", () => {
  it("stores then consumes a challenge exactly once", async () => {
    const kv = makeKV();
    await putChallenge(kv, "flow1", "chal-abc");
    expect(await takeChallenge(kv, "flow1")).toBe("chal-abc");
    // second take must be null — challenges are single-use to prevent replay
    expect(await takeChallenge(kv, "flow1")).toBeNull();
  });

  it("returns null for an unknown challenge", async () => {
    expect(await takeChallenge(makeKV(), "nope")).toBeNull();
  });
});
