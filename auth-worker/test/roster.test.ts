import { describe, it, expect } from "vitest";
import { putMember, resolveMember, getMember, setPin, setMemberAdmin, countAdmins, updateProfile, resolveMemberFlexible, type KVListLike, type Member } from "../src/roster.js";
import type { KVLike } from "../src/ratelimit.js";

function makeKV(): KVLike {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
}

const SAMPLE: Member = {
  memberId: "m_abc123",
  name: "Jane Doe",
  pdgaNo: "12345",
  udisc: "JaneD",
  pinHash: "pbkdf2$sha256$120000$x$y",
  mustChangePin: true,
};

describe("roster KV", () => {
  it("resolves a member by PDGA number", async () => {
    const kv = makeKV();
    await putMember(kv, SAMPLE);
    const m = await resolveMember(kv, "12345");
    expect(m?.memberId).toBe("m_abc123");
    expect(m?.name).toBe("Jane Doe");
  });

  it("resolves a member by UDisc username, case-insensitively", async () => {
    const kv = makeKV();
    await putMember(kv, SAMPLE);
    expect((await resolveMember(kv, "janed"))?.memberId).toBe("m_abc123");
    expect((await resolveMember(kv, "  JANED "))?.memberId).toBe("m_abc123");
  });

  it("returns null for an unknown identifier", async () => {
    const kv = makeKV();
    await putMember(kv, SAMPLE);
    expect(await resolveMember(kv, "99999")).toBeNull();
    expect(await resolveMember(kv, "nobody")).toBeNull();
  });

  it("setPin updates the hash and clears mustChangePin", async () => {
    const kv = makeKV();
    await putMember(kv, SAMPLE);
    await setPin(kv, "m_abc123", "pbkdf2$sha256$120000$new$hash");
    const m = await getMember(kv, "m_abc123");
    expect(m?.pinHash).toBe("pbkdf2$sha256$120000$new$hash");
    expect(m?.mustChangePin).toBe(false);
  });
});

describe("updateProfile", () => {
  const base: Member = { memberId: "m_a", name: "Ann", pinHash: "x", mustChangePin: false };

  it("adds a PDGA # and makes the member resolvable by it", async () => {
    const kv = makeKV();
    await putMember(kv, base);
    const r = await updateProfile(kv, "m_a", { pdgaNo: "55555" });
    expect(r.ok).toBe(true);
    expect((await resolveMember(kv, "55555"))?.memberId).toBe("m_a");
  });

  it("adds a UDisc username and a profile photo", async () => {
    const kv = makeKV();
    await putMember(kv, base);
    await updateProfile(kv, "m_a", { udisc: "AnnThrows", photo: "data:image/png;base64,AAA" });
    const m = await getMember(kv, "m_a");
    expect(m?.udisc).toBe("AnnThrows");
    expect(m?.photo).toBe("data:image/png;base64,AAA");
    expect((await resolveMember(kv, "annthrows"))?.memberId).toBe("m_a");
  });

  it("refuses to claim a PDGA # already owned by another member", async () => {
    const kv = makeKV();
    await putMember(kv, base);
    await putMember(kv, { memberId: "m_b", name: "Bo", pdgaNo: "222", pinHash: "y", mustChangePin: false });
    const r = await updateProfile(kv, "m_a", { pdgaNo: "222" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toBe("pdga");
    // m_a must be unchanged, and 222 must still resolve to m_b
    expect((await getMember(kv, "m_a"))?.pdgaNo).toBeUndefined();
    expect((await resolveMember(kv, "222"))?.memberId).toBe("m_b");
  });

  it("removes the old index when a PDGA # changes", async () => {
    const kv = makeKV();
    await putMember(kv, { ...base, pdgaNo: "111" });
    await updateProfile(kv, "m_a", { pdgaNo: "333" });
    expect(await resolveMember(kv, "111")).toBeNull();
    expect((await resolveMember(kv, "333"))?.memberId).toBe("m_a");
  });
});

describe("resolveMemberFlexible (admin member lookup by any identifier)", () => {
  function makeListKV(): KVListLike {
    const m = new Map<string, string>();
    return {
      get: async (k) => (m.has(k) ? m.get(k)! : null),
      put: async (k, v) => void m.set(k, v),
      delete: async (k) => void m.delete(k),
      list: async ({ prefix = "" }: { prefix?: string; cursor?: string } = {}) => ({
        keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      }),
    };
  }

  it("resolves by internal id, PDGA#, UDisc, and exact (case-insensitive) name", async () => {
    const kv = makeListKV();
    await putMember(kv, SAMPLE);
    for (const idf of ["m_abc123", "12345", "JaneD", "jane doe"]) {
      const r = await resolveMemberFlexible(kv, idf);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.member.memberId).toBe("m_abc123");
    }
  });

  it("distinguishes not_found from an ambiguous name", async () => {
    const kv = makeListKV();
    await putMember(kv, SAMPLE);
    await putMember(kv, { ...SAMPLE, memberId: "m_dup", pdgaNo: "67890", udisc: "JaneD2" }); // same display name
    const nf = await resolveMemberFlexible(kv, "nobody");
    expect(nf.ok).toBe(false);
    if (!nf.ok) expect(nf.reason).toBe("not_found");
    const amb = await resolveMemberFlexible(kv, "Jane Doe");
    expect(amb.ok).toBe(false);
    if (!amb.ok) expect(amb.reason).toBe("ambiguous");
  });
});

describe("member admin flag", () => {
  function makeListKV(): KVListLike {
    const m = new Map<string, string>();
    return {
      get: async (k) => (m.has(k) ? m.get(k)! : null),
      put: async (k, v) => void m.set(k, v),
      delete: async (k) => void m.delete(k),
      list: async ({ prefix = "" }: { prefix?: string; cursor?: string } = {}) => ({
        keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      }),
    };
  }

  it("promotes then demotes, clearing the key on demote", async () => {
    const kv = makeKV();
    await putMember(kv, SAMPLE);
    const up = await setMemberAdmin(kv, "m_abc123", true);
    expect(up?.isAdmin).toBe(true);
    expect((await getMember(kv, "m_abc123"))?.isAdmin).toBe(true);

    const down = await setMemberAdmin(kv, "m_abc123", false);
    expect(down?.isAdmin).toBeUndefined();
    expect("isAdmin" in ((await getMember(kv, "m_abc123")) as Member)).toBe(false);
  });

  it("returns null for an unknown member", async () => {
    const kv = makeKV();
    expect(await setMemberAdmin(kv, "m_nope", true)).toBeNull();
  });

  it("countAdmins counts only admins", async () => {
    const kv = makeListKV();
    await putMember(kv, { memberId: "m_1", name: "A", pinHash: "h", mustChangePin: false, isAdmin: true });
    await putMember(kv, { memberId: "m_2", name: "B", pinHash: "h", mustChangePin: false });
    expect(await countAdmins(kv)).toBe(1);
    await setMemberAdmin(kv, "m_2", true);
    expect(await countAdmins(kv)).toBe(2);
  });
});
