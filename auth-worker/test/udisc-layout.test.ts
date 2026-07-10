import { describe, it, expect } from "vitest";
import { parseUdiscLayout, parseUdiscLayouts, courseIdFromHtml } from "../src/imports.js";

// UDisc (React Router v7) ships course data as a turbo-stream pool inside
// `window.__reactRouterContext.streamController.enqueue("…")`. The pool is a flat array where objects
// are `{ "_<keyIndex>": <valueIndex> }` and strings are interned. This fixture mirrors that real shape
// (verified against a live course page): two layouts, holes carrying par + tee/target latitude/longitude.
const POOL = [
  /* 0*/ [34, 35], // root: [layoutA, layoutB]
  /* 1*/ "name",
  /* 2*/ "layoutId",
  /* 3*/ "holes",
  /* 4*/ "par",
  /* 5*/ "latitude",
  /* 6*/ "longitude",
  /* 7*/ "teePosition",
  /* 8*/ "targetPosition",
  /* 9*/ 35.0,
  /*10*/ -82.4,
  /*11*/ 35.001,
  /*12*/ 35.002,
  /*13*/ 35.004,
  /*14*/ 35.01,
  /*15*/ "1",
  /*16*/ "2",
  /*17*/ 3,
  /*18*/ 4,
  /*19*/ 5,
  /*20*/ "Front 9 White",
  /*21*/ "Back Blue",
  /*22*/ 100,
  /*23*/ 200,
  /*24*/ { _5: 9, _6: 10 }, // {latitude:35.0, longitude:-82.4}
  /*25*/ { _5: 11, _6: 10 },
  /*26*/ { _5: 12, _6: 10 },
  /*27*/ { _5: 13, _6: 10 },
  /*28*/ { _5: 14, _6: 10 },
  /*29*/ { _1: 15, _4: 17, _7: 24, _8: 25 }, // hole {name:"1", par:3, teePosition, targetPosition}
  /*30*/ { _1: 16, _4: 18, _7: 26, _8: 27 },
  /*31*/ { _1: 15, _4: 19, _7: 24, _8: 28 },
  /*32*/ [29, 30], // layoutA holes
  /*33*/ [31], // layoutB holes
  /*34*/ { _1: 20, _2: 22, _3: 32 }, // layoutA {name, layoutId, holes}
  /*35*/ { _1: 21, _2: 23, _3: 33 },
];

function turboStreamHtml(pool: unknown[], title = "Test Course | UDisc"): string {
  const arg = JSON.stringify(JSON.stringify(pool)); // double-encoded: enqueue takes a JSON string
  return `<!doctype html><html><head><title>${title}</title></head><body>
<script>window.__reactRouterContext.streamController.enqueue(${arg})</script>
</body></html>`;
}

describe("parseUdiscLayouts — turbo-stream decode", () => {
  const html = turboStreamHtml(POOL);

  it("extracts every layout with per-hole pars", () => {
    const { layouts } = parseUdiscLayouts(html, "https://udisc.com/courses/x");
    expect(layouts.map((l) => l.name)).toEqual(["Front 9 White", "Back Blue"]);
    expect(layouts[0]!.holes.map((h) => h.par)).toEqual([3, 4]);
    expect(layouts[1]!.holes.map((h) => h.par)).toEqual([5]);
  });

  it("resolves hole numbers and tee/target coordinates", () => {
    const { layouts } = parseUdiscLayouts(html, "https://udisc.com/courses/x");
    const h1 = layouts[0]!.holes[0]!;
    expect(h1.hole).toBe(1);
    expect(h1.tee).toMatchObject({ lat: 35.0, lng: -82.4 });
    expect(h1.target).toMatchObject({ lat: 35.001, lng: -82.4 });
    expect(layouts[0]!.holes[1]!.hole).toBe(2);
  });

  it("builds a tee+target position pool per layout", () => {
    const { layouts } = parseUdiscLayouts(html, "https://udisc.com/courses/x");
    expect(layouts[0]!.positions.filter((p) => p.kind === "tee")).toHaveLength(2);
    expect(layouts[0]!.positions.filter((p) => p.kind === "target")).toHaveLength(2);
    expect(layouts[1]!.positions).toHaveLength(2); // 1 hole → 1 tee + 1 target
  });

  it("does not double-count a single layout referenced twice (object identity)", () => {
    // Same pool object referenced twice from the root must not yield duplicate layouts.
    const dupPool = POOL.slice();
    dupPool[0] = [34, 35, 34];
    const { layouts } = parseUdiscLayouts(turboStreamHtml(dupPool), "https://udisc.com/courses/x");
    expect(layouts).toHaveLength(2);
  });

  it("dedupes two DISTINCT layout objects that share the same UDisc layoutId", () => {
    // Different layout objects (different names/holes) but an identical layoutId → keep only the first.
    const pool = [
      /* 0*/ [5, 6], // root: [layoutA, layoutB]
      /* 1*/ "name",
      /* 2*/ "layoutId",
      /* 3*/ "holes",
      /* 4*/ "par",
      /* 5*/ { _1: 8, _2: 7, _3: 12 }, // layoutA {name:"Alpha", layoutId:"LID-1", holes:[hole]}
      /* 6*/ { _1: 9, _2: 7, _3: 13 }, // layoutB {name:"Beta",  layoutId:"LID-1" (same), holes:[hole]}
      /* 7*/ "LID-1", // shared layoutId value
      /* 8*/ "Alpha",
      /* 9*/ "Beta",
      /*10*/ 3, // par
      /*11*/ { _4: 10 }, // a hole {par:3}
      /*12*/ [11], // layoutA holes
      /*13*/ [11], // layoutB holes
    ];
    const { layouts } = parseUdiscLayouts(turboStreamHtml(pool), "https://udisc.com/courses/x");
    expect(layouts).toHaveLength(1);
    expect(layouts[0]!.name).toBe("Alpha");
  });

  it("parseUdiscLayout returns the first layout", () => {
    const r = parseUdiscLayout(html, "https://udisc.com/courses/x");
    expect(r.name).toBe("Front 9 White");
    expect(r.holes).toHaveLength(2);
  });
});

describe("parseUdiscLayouts — graceful degrade", () => {
  it("returns name-only when there is no turbo-stream payload", () => {
    const html = "<html><head><title>Some Course | UDisc</title></head><body>just a shell</body></html>";
    const { name, layouts } = parseUdiscLayouts(html, "https://udisc.com/courses/x");
    expect(name).toBe("Some Course");
    expect(layouts).toEqual([]);

    const single = parseUdiscLayout(html, "https://udisc.com/courses/x");
    expect(single.name).toBe("Some Course");
    expect(single.holes).toEqual([]);
    expect(single.note).toMatch(/manual/i);
  });

  it("ignores a non-hole array named holes", () => {
    // holes whose elements have no numeric par must not register as a layout.
    const pool = [[1], { _2: 3 }, "holes", [4, 5], "review one", "review two"];
    const { layouts } = parseUdiscLayouts(turboStreamHtml(pool), "https://udisc.com/courses/x");
    expect(layouts).toEqual([]);
  });
});

describe("courseIdFromHtml — UDisc numeric course id for the Add-to-UDisc applink", () => {
  it("extracts the id from a create-scorecard deep link", () => {
    expect(courseIdFromHtml(`<a href="https://app.udisc.com/applink/create-scorecard/98765">Start a round</a>`)).toBe("98765");
  });

  it("returns null when the page exposes no create-scorecard link", () => {
    expect(courseIdFromHtml("<html><body>no link here</body></html>")).toBeNull();
  });

  it("parseUdiscLayouts surfaces the course id and stamps it on every layout", () => {
    const html = turboStreamHtml(POOL).replace("</body>", `<a href="https://app.udisc.com/applink/create-scorecard/98765">Start</a></body>`);
    const { udisc_course_id, layouts } = parseUdiscLayouts(html, "https://udisc.com/courses/x");
    expect(udisc_course_id).toBe("98765");
    expect(layouts.map((l) => l.udisc_course_id)).toEqual(["98765", "98765"]);
  });

  it("parseUdiscLayouts course id is null when absent (degrade path keeps it null)", () => {
    const { udisc_course_id, layouts } = parseUdiscLayouts(turboStreamHtml(POOL), "https://udisc.com/courses/x");
    expect(udisc_course_id).toBeNull();
    expect(layouts[0]!.udisc_course_id).toBeNull();
  });
});
