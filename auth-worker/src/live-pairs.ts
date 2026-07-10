import { isLiveFormatError, normalizeLiveScoringConfig, normalizePairLabel, scoreTargetsForPlayers, validateCardTargetsForScoring } from "./live-format.js";
import type { LiveMeta, PairAssignmentBody } from "./live-types.js";
import type { PlayerState } from "./scoring.js";

type PairUpdate = {
  readonly index: number;
  readonly label: string;
};

type PairUpdateRequest = {
  readonly meta: LiveMeta | null;
  readonly players: readonly PlayerState[];
  readonly body: PairAssignmentBody;
  readonly authMember: string | null;
  readonly authAdmin: boolean;
};

type PairUpdateResult =
  | { readonly ok: true; readonly changed: boolean; readonly players: PlayerState[] }
  | { readonly ok: false; readonly status: number; readonly body: unknown };

export function updateLivePairs(request: PairUpdateRequest): PairUpdateResult {
  const { meta, players, body, authMember, authAdmin } = request;
  if (!meta || meta.status !== "live") return { ok: false, status: 409, body: { error: "not_live" } };
  if (!meta.casual) return { ok: false, status: 409, body: { error: "casual_only" } };
  const config = normalizeLiveScoringConfig(meta.roundConfig);
  if (config.groupFormat !== "doubles") return { ok: false, status: 409, body: { error: "not_doubles" } };
  const meIndex = authMember ? players.findIndex((player) => player.memberId === authMember && !player.removed) : -1;
  const me = meIndex >= 0 ? players[meIndex] : undefined;
  if (!authAdmin && !me) return { ok: false, status: 403, body: { error: "not_on_card" } };

  const updates = pairUpdatesFromBody(body);
  if (!updates.length) return { ok: false, status: 400, body: { error: "invalid_pairs" } };
  const nextPlayers = players.map((player) => ({ ...player }));
  let changed = false;
  for (const update of updates) {
    const player = nextPlayers[update.index];
    if (!player || player.removed) return { ok: false, status: 404, body: { error: "no_player" } };
    if (!authAdmin && (player.cardId ?? null) !== (me?.cardId ?? null)) return { ok: false, status: 403, body: { error: "wrong_card" } };
    const current = normalizePairLabel(player.team);
    if (current !== update.label) {
      if (hasScores(player)) {
        return { ok: false, status: 409, body: { error: "scores_exist", message: "Pair changes are blocked after scoring starts." } };
      }
      changed = true;
      player.team = update.label;
    }
  }
  if (!changed) return { ok: true, changed: false, players: [...players] };
  try {
    const targets = scoreTargetsForPlayers(nextPlayers, config);
    validateCardTargetsForScoring(targets, config);
  } catch (error) {
    if (isLiveFormatError(error)) return { ok: false, status: 400, body: { error: "invalid_pairs", code: error.code, message: error.message } };
    throw error;
  }
  return { ok: true, changed: true, players: nextPlayers };
}

function pairUpdatesFromBody(body: PairAssignmentBody): PairUpdate[] {
  const updates: PairUpdate[] = [];
  if (Array.isArray(body.assignments)) {
    for (const assignment of body.assignments) {
      const index = assignment.index;
      const label = normalizePairLabel(assignment.pairLabel ?? assignment.label ?? assignment.team);
      if (!Number.isInteger(index) || index == null || label == null) continue;
      updates.push({ index, label });
    }
  }
  if (Array.isArray(body.pairs)) {
    for (const pair of body.pairs) {
      const label = normalizePairLabel(pair.label ?? pair.pairLabel ?? pair.team);
      if (label == null || !Array.isArray(pair.playerIndexes)) continue;
      for (const index of pair.playerIndexes) {
        if (Number.isInteger(index)) updates.push({ index, label });
      }
    }
  }
  return updates;
}

function hasScores(player: PlayerState): boolean {
  if (Object.keys(player.scores ?? {}).length > 0) return true;
  return Object.values(player.scorecards ?? {}).some((votes) => Object.keys(votes ?? {}).length > 0);
}
