import { describe, it, expect } from "vitest";
import { haversineFeet, parEstimateFeet, estimateDistance } from "../src/distance.js";

describe("haversineFeet", () => {
  it("measures ~365 ft for 0.001° of latitude", () => {
    const d = haversineFeet({ lat: 35.0, lng: -82.4 }, { lat: 35.001, lng: -82.4 });
    expect(d).toBeGreaterThan(360);
    expect(d).toBeLessThan(370);
  });
  it("is zero for identical points", () => {
    expect(haversineFeet({ lat: 34.85, lng: -82.4 }, { lat: 34.85, lng: -82.4 })).toBe(0);
  });
});

describe("parEstimateFeet", () => {
  it("maps common pars to typical disc-golf distances", () => {
    expect(parEstimateFeet(3)).toBe(250);
    expect(parEstimateFeet(4)).toBe(400);
    expect(parEstimateFeet(5)).toBe(600);
  });
});

describe("estimateDistance (precedence: tee_sign → manual → geo → par → none)", () => {
  const tee = { lat: 35.0, lng: -82.4 };
  const target = { lat: 35.001, lng: -82.4 };

  it("a verified tee-sign distance beats manual, geo, and par", () => {
    const r = estimateDistance({ verified: 420, manual: 312, tee, target, par: 3 });
    expect(r).toEqual({ distance_ft: 420, source: "tee_sign" });
  });
  it("ignores a non-positive verified value and falls through to manual", () => {
    const r = estimateDistance({ verified: 0, manual: 312, par: 3 });
    expect(r).toEqual({ distance_ft: 312, source: "manual" });
  });
  it("uses a manual override even when coords and par exist", () => {
    const r = estimateDistance({ manual: 312, tee, target, par: 3 });
    expect(r).toEqual({ distance_ft: 312, source: "manual" });
  });
  it("computes geo distance from tee+target coords when no manual value", () => {
    const r = estimateDistance({ tee, target, par: 3 });
    expect(r.source).toBe("geo");
    expect(r.distance_ft).toBeGreaterThan(360);
    expect(r.distance_ft).toBeLessThan(370);
  });
  it("falls back to a par-based estimate when coords are missing", () => {
    const r = estimateDistance({ tee: { lat: 35.0, lng: null }, target, par: 4 });
    expect(r).toEqual({ distance_ft: 400, source: "par_estimate" });
  });
  it("returns null when nothing is known", () => {
    expect(estimateDistance({})).toEqual({ distance_ft: null, source: null });
  });
  it("ignores a non-positive manual value and falls through", () => {
    const r = estimateDistance({ manual: 0, par: 5 });
    expect(r).toEqual({ distance_ft: 600, source: "par_estimate" });
  });
});
