import { describe, it, expect } from "vitest";
import { normalizeLayoutLabel, defaultLayoutName } from "../src/db.js";

describe("normalizeLayoutLabel", () => {
  it("lowercases, strips 'tees'/'layout', collapses whitespace", () => {
    expect(normalizeLayoutLabel("  Long Tees ")).toBe("long");
    expect(normalizeLayoutLabel("BLUE layout")).toBe("blue");
    expect(normalizeLayoutLabel("Short")).toBe("short");
    expect(normalizeLayoutLabel(null)).toBe("");
  });
});

describe("defaultLayoutName", () => {
  it("maps an extracted label to Long/Short, else echoes a clean title", () => {
    expect(defaultLayoutName("long")).toBe("Long");
    expect(defaultLayoutName("LONG TEES")).toBe("Long");
    expect(defaultLayoutName("short")).toBe("Short");
    expect(defaultLayoutName("blue")).toBe("Blue");      // unknown -> title-cased echo
    expect(defaultLayoutName("")).toBe("Main");          // empty -> Main
  });
});
