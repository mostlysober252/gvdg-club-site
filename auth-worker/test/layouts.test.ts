import { describe, it, expect } from "vitest";
import { enrichHoles } from "../src/layouts.js";

describe("enrichHoles (compute per-hole distance + total par)", () => {
  it("uses geo distance when a hole has tee+target coords", () => {
    const { holes, total_par } = enrichHoles([
      { hole: 1, par: 3, tee: { label: "1T", lat: 35.0, lng: -82.4 }, target: { label: "1B", lat: 35.001, lng: -82.4 } },
    ]);
    expect(total_par).toBe(3);
    expect(holes[0]!.distance_source).toBe("geo");
    expect(holes[0]!.distance_ft).toBeGreaterThan(360);
    expect(holes[0]!.distance_ft).toBeLessThan(370);
  });

  it("falls back to par estimate without coords, manual override wins, sums total par", () => {
    const { holes, total_par } = enrichHoles([
      { hole: 1, par: 4 }, // no coords -> par estimate
      { hole: 2, par: 3, manual_distance: 280 }, // manual wins
    ]);
    expect(total_par).toBe(7);
    expect(holes[0]).toMatchObject({ distance_ft: 400, distance_source: "par_estimate" });
    expect(holes[1]).toMatchObject({ distance_ft: 280, distance_source: "manual" });
  });

  it("supports SAFARI holes (tee from one hole, target from another) via embedded coords", () => {
    // tee from hole 1 area, target from hole 7 area — a custom cross-course shot.
    const { holes } = enrichHoles([
      { hole: 1, par: 4, tee: { label: "H1 tee", lat: 35.0, lng: -82.4 }, target: { label: "H7 basket", lat: 35.0, lng: -82.398 } },
    ]);
    expect(holes[0]!.distance_source).toBe("geo");
    expect(holes[0]!.distance_ft).toBeGreaterThan(500); // ~0.002° lng at 35°N ≈ 600 ft
  });

  it("returns total_par 0 and empty holes for no input", () => {
    expect(enrichHoles([])).toEqual({ holes: [], total_par: 0 });
  });

  it("a verified (tee-sign) hole is STICKY: par+distance survive re-enrichment and beat a manual override", () => {
    const verified = { par: 4, distance_ft: 420, tee_sign_key: "tee-signs/1/7/x.jpg", tee_sign_id: 77 };
    // Even with a conflicting manual_distance and a different stored par, verified wins.
    const { holes, total_par } = enrichHoles([
      { hole: 7, par: 3, manual_distance: 250, verified },
    ]);
    expect(holes[0]).toMatchObject({ par: 4, distance_ft: 420, distance_source: "tee_sign" });
    expect(holes[0]!.verified).toEqual(verified);
    expect(total_par).toBe(4); // total uses the verified par, not the stored 3
  });

  it("treats a legacy tee_sign hole (no `verified` object) as verified", () => {
    const { holes } = enrichHoles([
      { hole: 5, par: 3, distance_ft: 285, distance_source: "tee_sign", tee_sign_key: "k", tee_sign_id: 12 } as never,
    ]);
    expect(holes[0]).toMatchObject({ par: 3, distance_ft: 285, distance_source: "tee_sign" });
    expect(holes[0]!.verified).toMatchObject({ par: 3, distance_ft: 285, tee_sign_id: 12 });
  });

  it("a verified hole with no distance keeps verified par but estimates distance from par", () => {
    const { holes } = enrichHoles([
      { hole: 2, par: 5, verified: { par: 5, distance_ft: null, tee_sign_key: "k" } },
    ]);
    expect(holes[0]!.par).toBe(5);
    expect(holes[0]!.distance_source).toBe("par_estimate"); // no verified distance → falls through
    expect(holes[0]!.distance_ft).toBe(600);
  });
});
