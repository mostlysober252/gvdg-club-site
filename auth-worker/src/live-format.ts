export type LiveGroupFormat = "singles" | "doubles";
export type LiveScoringStyle = "stroke" | "matchplay";

export type LiveScoringConfig = {
  readonly groupFormat: LiveGroupFormat;
  readonly scoringStyle: LiveScoringStyle;
};

export type ScoreTarget =
  | {
      readonly type: "player";
      readonly id: string;
      readonly label: string;
      readonly playerIndexes: readonly [number];
      readonly memberIds: readonly [string | null];
    }
  | {
      readonly type: "pair";
      readonly id: string;
      readonly label: string;
      readonly playerIndexes: readonly [number, number];
      readonly memberIds: readonly [string | null, string | null];
    };

type ScoreTargetPlayer = {
  readonly memberId?: string | null;
  readonly name: string;
  readonly team?: string | null;
  readonly removed?: boolean;
};

type LiveFormatErrorCode = "invalid_group_format" | "invalid_scoring_style" | "missing_pair_label" | "invalid_pair_size" | "invalid_matchplay_targets";

export class LiveFormatError extends Error {
  readonly code: LiveFormatErrorCode;

  constructor(code: LiveFormatErrorCode, message: string) {
    super(message);
    this.name = "LiveFormatError";
    this.code = code;
  }
}

const DEFAULT_LIVE_SCORING_CONFIG = {
  groupFormat: "singles",
  scoringStyle: "stroke",
} satisfies LiveScoringConfig;

export function normalizePairLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim().replace(/\s+/g, " ");
  return label.length > 0 ? label : null;
}

export function normalizeLiveScoringConfig(value: unknown): LiveScoringConfig {
  if (value == null) return DEFAULT_LIVE_SCORING_CONFIG;
  if (!isRecord(value)) {
    throw new LiveFormatError("invalid_group_format", "live scoring config must be an object");
  }
  return {
    groupFormat: parseGroupFormat(value["groupFormat"]),
    scoringStyle: parseScoringStyle(value["scoringStyle"]),
  };
}

export function normalizeStoredLiveScoringConfig(value: unknown): LiveScoringConfig | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    try {
      return normalizeLiveScoringConfig(JSON.parse(value));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new LiveFormatError("invalid_group_format", "stored live scoring config must be valid JSON");
      }
      throw error;
    }
  }
  return normalizeLiveScoringConfig(value);
}

export function normalizeLiveScoringConfigFromLegacy(value: {
  readonly live_scoring_config?: unknown;
  readonly liveScoringConfig?: unknown;
  readonly play_format?: unknown;
  readonly event_format?: unknown;
  readonly format?: unknown;
}): LiveScoringConfig {
  const explicit = normalizeStoredLiveScoringConfig(value.liveScoringConfig ?? value.live_scoring_config);
  if (explicit) return explicit;
  return {
    groupFormat: value.play_format === "doubles" ? "doubles" : "singles",
    scoringStyle: value.event_format === "matchplay" || value.format === "matchplay" ? "matchplay" : "stroke",
  };
}

export function isLiveFormatError(error: unknown): error is LiveFormatError {
  return error instanceof LiveFormatError;
}

export type PairTargetError = {
  readonly playerIndexes: readonly number[];
  readonly code: LiveFormatErrorCode;
  readonly message: string;
};

export type SafeScoreTargets = {
  readonly targets: ScoreTarget[];
  readonly errors: PairTargetError[];
};

export function scoreTargetsForPlayers(players: readonly ScoreTargetPlayer[], configValue?: unknown): ScoreTarget[] {
  const config = normalizeLiveScoringConfig(configValue);
  switch (config.groupFormat) {
    case "singles":
      return singlesTargetsForPlayers(players);
    case "doubles":
      return pairTargetsForPlayers(players);
    default:
      return assertNever(config.groupFormat);
  }
}

/** Like scoreTargetsForPlayers, but NON-THROWING: a malformed doubles pair (no label, or ≠2 active
 *  players after a tombstone) becomes an error entry carrying the offending GLOBAL player indexes,
 *  instead of throwing and collapsing the whole field. This is what lets scoringState isolate a broken
 *  card. Singles never error. The grouping/keys/ids are IDENTICAL to the throwing path (they share
 *  pairTargetsForPlayersSafe), so `pair:${key}` stays globally unique across the field. */
export function scoreTargetsForPlayersSafe(players: readonly ScoreTargetPlayer[], configValue?: unknown): SafeScoreTargets {
  const config = normalizeLiveScoringConfig(configValue);
  switch (config.groupFormat) {
    case "singles":
      return { targets: singlesTargetsForPlayers(players), errors: [] };
    case "doubles":
      return pairTargetsForPlayersSafe(players);
    default:
      return assertNever(config.groupFormat);
  }
}

function singlesTargetsForPlayers(players: readonly ScoreTargetPlayer[]): ScoreTarget[] {
  return players.flatMap((player, index): ScoreTarget[] =>
    player.removed
      ? []
      : [
          {
            type: "player",
            id: `player:${index}`,
            label: player.name,
            playerIndexes: [index],
            memberIds: [player.memberId ?? null],
          },
        ],
  );
}

export function validateCardTargetsForScoring(targets: readonly ScoreTarget[], configValue?: unknown): void {
  const config = normalizeLiveScoringConfig(configValue);
  switch (config.scoringStyle) {
    case "stroke":
      return;
    case "matchplay":
      if (targets.length !== 2) {
        throw new LiveFormatError("invalid_matchplay_targets", "matchplay scoring requires exactly two score targets per card");
      }
      return;
    default:
      return assertNever(config.scoringStyle);
  }
}

function pairTargetsForPlayers(players: readonly ScoreTargetPlayer[]): ScoreTarget[] {
  const { targets, errors } = pairTargetsForPlayersSafe(players);
  const first = errors[0];
  if (first) throw new LiveFormatError(first.code, first.message); // preserve throw-on-first-bad-pair semantics
  return targets;
}

// The single source of truth for doubles pair grouping. Builds the field-wide lowercased-label Map with
// GLOBAL player indexes (so `pair:${key}` ids are globally unique and two cards labeled the same still
// collapse+error exactly as before), collecting per-pair errors instead of throwing. A labelless active
// player and a pair whose active count ≠ 2 each become an error carrying that pair's global indexes.
function pairTargetsForPlayersSafe(players: readonly ScoreTargetPlayer[]): SafeScoreTargets {
  const pairs = new Map<string, { readonly label: string; readonly playerIndexes: number[]; readonly memberIds: (string | null)[] }>();
  const errors: PairTargetError[] = [];
  players.forEach((player, index) => {
    if (player.removed) return;
    const label = normalizePairLabel(player.team);
    if (label == null) {
      errors.push({ playerIndexes: [index], code: "missing_pair_label", message: `doubles scoring requires a pair label for ${player.name}` });
      return;
    }
    const key = label.toLocaleLowerCase("en-US");
    const existing = pairs.get(key);
    if (existing) {
      existing.playerIndexes.push(index);
      existing.memberIds.push(player.memberId ?? null);
      return;
    }
    pairs.set(key, { label, playerIndexes: [index], memberIds: [player.memberId ?? null] });
  });

  const targets: ScoreTarget[] = [];
  for (const [key, pair] of pairs.entries()) {
    const [firstIndex, secondIndex] = pair.playerIndexes;
    const [firstMemberId, secondMemberId] = pair.memberIds;
    if (pair.playerIndexes.length !== 2 || firstIndex == null || secondIndex == null || firstMemberId === undefined || secondMemberId === undefined) {
      errors.push({ playerIndexes: [...pair.playerIndexes], code: "invalid_pair_size", message: `doubles scoring pair "${pair.label}" must have exactly two active players` });
      continue;
    }
    targets.push({
      type: "pair",
      id: `pair:${key}`,
      label: pair.label,
      playerIndexes: [firstIndex, secondIndex],
      memberIds: [firstMemberId, secondMemberId],
    });
  }
  return { targets, errors };
}

function parseGroupFormat(value: unknown): LiveGroupFormat {
  if (value == null) return DEFAULT_LIVE_SCORING_CONFIG.groupFormat;
  if (value === "singles" || value === "doubles") return value;
  throw new LiveFormatError("invalid_group_format", "unsupported live scoring groupFormat");
}

function parseScoringStyle(value: unknown): LiveScoringStyle {
  if (value == null) return DEFAULT_LIVE_SCORING_CONFIG.scoringStyle;
  if (value === "stroke" || value === "matchplay") return value;
  throw new LiveFormatError("invalid_scoring_style", "unsupported live scoring scoringStyle");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new LiveFormatError("invalid_group_format", `unhandled live scoring variant: ${String(value)}`);
}
