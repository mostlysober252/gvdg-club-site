import { describe, it, expect } from "vitest";
import { updatePosition } from "../src/db.js";

// Capture the SQL + binds the dynamic partial-update produces.
function recordingDb() {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, binds: [] as unknown[] };
      calls.push(call);
      return { bind(...b: unknown[]) { call.binds = b; return this; }, first: async () => ({ id: 7 }) };
    },
  };
  return { db: db as unknown as Parameters<typeof updatePosition>[0], calls };
}

describe("updatePosition — dynamic partial update", () => {
  it("only sets the provided fields, in column order, then id + course_id", async () => {
    const { db, calls } = recordingDb();
    await updatePosition(db, 10, 7, { color: "blue", lat: 34.85 });
    const c = calls[0]!;
    expect(c.sql).toBe("UPDATE course_positions SET lat = ?, color = ? WHERE id = ? AND course_id = ? RETURNING *");
    expect(c.binds).toEqual([34.85, "blue", 7, 10]);
  });

  it("an empty patch reads back the row instead of issuing an UPDATE", async () => {
    const { db, calls } = recordingDb();
    await updatePosition(db, 10, 7, {});
    expect(calls[0]!.sql).toContain("SELECT * FROM course_positions");
    expect(calls[0]!.binds).toEqual([7, 10]);
  });

  it("passes through null to clear a field (e.g. recolor to none / unset GPS)", async () => {
    const { db, calls } = recordingDb();
    await updatePosition(db, 3, 9, { color: null });
    expect(calls[0]!.sql).toBe("UPDATE course_positions SET color = ? WHERE id = ? AND course_id = ? RETURNING *");
    expect(calls[0]!.binds).toEqual([null, 9, 3]);
  });
});
