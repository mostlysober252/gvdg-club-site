// Regression: a doubles/matchplay pair left with a single active player (partner removed mid-round)
// makes scoringState throw invalid_pair_size, which used to wedge the WHOLE round AND block finalize for
// everyone — even an admin with force=true — leaving cancel (total data loss) as the only recovery.
// finalizeLiveEvent now lets an admin force past it, finalizing on per-player STROKE standings.
import { describe, it, expect } from "vitest";
import { finalizeLiveEvent, type FinalizeLiveEventInput } from "../src/live-finalize.js";
import type { PlayerState } from "../src/scoring.js";
import type { LiveEnv, LiveMeta } from "../src/live-types.js";

function stubDB() {
  const stmt = { bind: () => stmt, all: async () => ({ results: [], success: true }), first: async () => null, run: async () => ({ results: [], success: true, meta: {} }) };
  return { prepare: () => stmt, batch: async () => [] };
}

// Blue pair (idx 0,1) vs Red pair (idx 2,3) — but Bo (idx 1) has been removed, so Blue has ONE active
// player, which pairTargetsForPlayers rejects with invalid_pair_size.
function wedgedDoubles(): PlayerState[] {
  return [
    { memberId: "a", name: "Ann", team: "Blue", scores: { 1: 3 } },
    { memberId: "b", name: "Bo", team: "Blue", scores: { 1: 3 }, removed: true },
    { memberId: "c", name: "Cy", team: "Red", scores: { 1: 5 } },
    { memberId: "d", name: "Dee", team: "Red", scores: { 1: 5 } },
  ] as unknown as PlayerState[];
}

const META = {
  eventId: 7,
  roundConfig: { groupFormat: "doubles", scoringStyle: "matchplay" },
  holes: [{ hole: 1, par: 3 }],
  status: "live",
  startedAt: "2026-07-04T00:00:00Z",
} as unknown as LiveMeta;

function input(over: Partial<FinalizeLiveEventInput>): FinalizeLiveEventInput {
  return {
    meta: { ...(META as object) } as LiveMeta,
    players: wedgedDoubles(),
    env: { DB: stubDB() } as unknown as LiveEnv,
    authMember: null,
    authAdmin: false,
    force: false,
    persist: async () => {},
    broadcast: () => {},
    ...over,
  };
}

describe("finalize a wedged doubles round", () => {
  it("blocks a non-admin (un-forced) finalize with invalid_score_targets — the round can be repaired first", async () => {
    const res = await finalizeLiveEvent(input({}));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_score_targets");
  });

  it("lets an admin FORCE-finalize past the wedge, on per-player stroke standings", async () => {
    const res = await finalizeLiveEvent(input({ authAdmin: true, force: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; forced: boolean; standings: unknown[] };
    expect(body.status).toBe("final");
    expect(body.forced).toBe(true);
    expect(Array.isArray(body.standings)).toBe(true);
    expect(body.standings.length).toBe(3); // the 3 ACTIVE players are ranked by strokes; removed Bo is excluded
  });

  it("still refuses an admin who did NOT pass force (must be a deliberate override)", async () => {
    const res = await finalizeLiveEvent(input({ authAdmin: true, force: false }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_score_targets");
  });
});
