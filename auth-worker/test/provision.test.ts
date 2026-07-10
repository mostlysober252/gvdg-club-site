// @ts-nocheck — exercises provision.mjs, a standalone plain-JS operator script (not part
// of the Worker bundle). Runtime-verified by the assertions below; kept out of strict TS.
import { describe, it, expect } from "vitest";
import { hashPin as workerHashPin, verifyPin } from "../src/crypto.js";
// The provisioning tool is plain ESM JS with no deps; its pure helpers are importable
// because the CLI is guarded behind an import.meta.main check.
import {
  generatePin,
  hashPin,
  buildEntries,
  deriveMemberId,
} from "../scripts/provision.mjs";

describe("provision.generatePin", () => {
  it("always produces a 4-digit string 0000-9999", () => {
    for (let i = 0; i < 2000; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{4}$/);
    }
  });

  it("covers a broad range (rejection sampling stays uniform, not stuck on one bucket)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generatePin());
    // 1000 uniform draws over 10k values should yield many distinct PINs; a biased/broken
    // generator collapsing to a few buckets would fail this loose floor.
    expect(seen.size).toBeGreaterThan(500);
  });
});

describe("provision.hashPin <-> src/crypto.verifyPin (cross-module correctness)", () => {
  it("a generated PIN's hash verifies against that PIN via the Worker's verifyPin", async () => {
    const pin = generatePin();
    const stored = await hashPin(pin);
    expect(await verifyPin(pin, stored)).toBe(true);
  });

  it("hashes at the SAME PBKDF2 iteration count as the Worker (workerd caps at 100k and THROWS above it)", async () => {
    // A hash verifies in Node at any iteration count, but the DEPLOYED Worker (workerd) rejects PBKDF2
    // above 100_000 — so a provision-seeded member whose hash encodes a higher count can never log in.
    // provision.mjs must therefore match src/crypto.ts exactly.
    const provIters = Number((await hashPin("1234")).split("$")[2]);
    const workerIters = Number((await workerHashPin("1234")).split("$")[2]);
    expect(provIters).toBe(workerIters);
    expect(provIters).toBeLessThanOrEqual(100000);
  });

  it("the hash does NOT verify against a different PIN", async () => {
    const stored = await hashPin("4821");
    expect(await verifyPin("4821", stored)).toBe(true);
    expect(await verifyPin("1234", stored)).toBe(false);
  });

  it("emits the documented encoded format pbkdf2$sha256$100000$<salt>$<hash>", async () => {
    const parts = (await hashPin("0000")).split("$");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("pbkdf2");
    expect(parts[1]).toBe("sha256");
    expect(Number(parts[2])).toBe(100000); // workerd-safe (was 120000 — a hash the live Worker can't verify)
  });
});

describe("provision.deriveMemberId", () => {
  it("prefers PDGA# (digits only)", () => {
    expect(deriveMemberId({ pdgaNo: "12345", udisc: "JaneD" })).toBe("m_12345");
    expect(deriveMemberId({ pdgaNo: "#67890" })).toBe("m_67890");
  });
  it("falls back to lowercased UDisc when no PDGA#", () => {
    expect(deriveMemberId({ udisc: "PriyaThrows" })).toBe("m_u_priyathrows");
  });
  it("throws when neither identity field is present", () => {
    expect(() => deriveMemberId({ name: "Nobody" })).toThrow();
  });
});

describe("provision.buildEntries (KV layout + safety)", () => {
  it("builds the member record + both index keys with correct normalization (both ids)", async () => {
    const { memberId, entries } = await buildEntries({
      name: "Jane Doe",
      pdgaNo: "12345",
      udisc: "JaneD",
    });
    expect(memberId).toBe("m_12345");

    const byKey = new Map(entries.map((e) => [e.key, e.value]));
    expect(byKey.has("member:m_12345")).toBe(true);
    expect(byKey.get("idx:pdga:12345")).toBe("m_12345");
    // index key is lowercased; index value is the memberId
    expect(byKey.get("idx:udisc:janed")).toBe("m_12345");

    const record = JSON.parse(byKey.get("member:m_12345")!);
    expect(record.memberId).toBe("m_12345");
    expect(record.name).toBe("Jane Doe");
    expect(record.pdgaNo).toBe("12345");
    expect(record.udisc).toBe("JaneD");
    expect(record.mustChangePin).toBe(true);
    expect(typeof record.pinHash).toBe("string");
  });

  it("omits the pdga index for a udisc-only member", async () => {
    const { memberId, entries } = await buildEntries({ name: "Priya Nair", udisc: "PriyaThrows" });
    expect(memberId).toBe("m_u_priyathrows");
    const keys = entries.map((e) => e.key);
    expect(keys).toContain("member:m_u_priyathrows");
    expect(keys).toContain("idx:udisc:priyathrows");
    expect(keys.some((k) => k.startsWith("idx:pdga:"))).toBe(false);
  });

  it("omits the udisc index for a pdga-only member", async () => {
    const { entries } = await buildEntries({ name: "Marcus Lee", pdgaNo: "67890" });
    const keys = entries.map((e) => e.key);
    expect(keys).toContain("member:m_67890");
    expect(keys).toContain("idx:pdga:67890");
    expect(keys.some((k) => k.startsWith("idx:udisc:"))).toBe(false);
  });

  it("the produced record's pinHash verifies against the returned cleartext PIN", async () => {
    const { pin, entries } = await buildEntries({ name: "Jane Doe", pdgaNo: "12345" });
    const record = JSON.parse(entries[0].value);
    expect(await verifyPin(pin, record.pinHash)).toBe(true);
  });

  it("never leaks the plaintext PIN into any KV value", async () => {
    const { pin, entries } = await buildEntries({ name: "Jane Doe", pdgaNo: "12345", udisc: "JaneD" });
    for (const e of entries) {
      expect(e.value).not.toContain(pin);
    }
  });

  it("rejects a member with neither pdgaNo nor udisc", async () => {
    await expect(buildEntries({ name: "Nobody" } as never)).rejects.toThrow();
  });
});
