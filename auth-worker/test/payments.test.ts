import { describe, it, expect } from "vitest";
import { computeOwed, paypalBase } from "../src/payments.js";

describe("computeOwed (entry + opted-in add-ons, in cents)", () => {
  const cfg = { entry_fee_cents: 1000, ctp_fee_cents: 500, ace_fee_cents: 300 };
  it("entry only when no add-ons", () => {
    expect(computeOwed(cfg, {})).toBe(1000);
  });
  it("adds CTP and ace only when opted in", () => {
    expect(computeOwed(cfg, { ctp: true })).toBe(1500);
    expect(computeOwed(cfg, { ctp: true, ace: true })).toBe(1800);
    expect(computeOwed(cfg, { ace: true })).toBe(1300);
  });
  it("is 0 for a free event (no fees)", () => {
    expect(computeOwed({ entry_fee_cents: null }, { ctp: true, ace: true })).toBe(0);
  });
  it("ignores add-ons the event doesn't offer", () => {
    expect(computeOwed({ entry_fee_cents: 1000 }, { ctp: true, ace: true })).toBe(1000);
  });
});

describe("paypalBase", () => {
  it("defaults to sandbox, switches to live, honors an override", () => {
    expect(paypalBase()).toBe("https://api-m.sandbox.paypal.com");
    expect(paypalBase("live")).toBe("https://api-m.paypal.com");
    expect(paypalBase("sandbox", "http://localhost:9999/")).toBe("http://localhost:9999");
  });
});
