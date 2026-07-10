import type * as db from "./db.js";
import type { LiveScoringConfig, ScoreTarget } from "./live-format.js";
import type { WeatherLocation, WeatherState } from "./weather.js";

export interface LiveEnv {
  DB: db.D1Like;
}

export type LiveSocket = {
  send(message: string): void;
};

export interface LiveState {
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    getAlarm(): Promise<number | null>;
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
  acceptWebSocket(socket: LiveSocket): void;
  getWebSockets(): LiveSocket[];
}

export interface LiveMeta {
  eventId: number;
  casual?: boolean;
  roundCode?: string | null;
  courseId?: number | null;
  layoutId?: number | null;
  createdBy?: string | null;
  courseName?: string | null;
  layoutName?: string | null;
  udiscCourseId?: string | null;
  holes: { hole: number; par: number; distance_ft?: number | null; tee_sign_id?: number | null }[];
  status: "live" | "final";
  startedAt: string;
  weather?: WeatherState | null;
  roundConfig?: LiveScoringConfig;
  rev?: number;
  overrides?: Record<string, { par?: number; distance_ft?: number }>;
}

export interface StartBody {
  eventId?: number;
  casual?: boolean;
  roundCode?: string | null;
  courseId?: number | null;
  layoutId?: number | null;
  createdBy?: string | null;
  courseName?: string | null;
  layoutName?: string | null;
  udiscCourseId?: string | null;
  holes: { hole: number; par: number; distance_ft?: number | null; tee_sign_id?: number | null }[];
  liveScoringConfig?: LiveScoringConfig;
  players: { memberId?: string | null; name: string; division?: string | null; team?: string | null; pairLabel?: string | null; startingHole?: number | null; cardId?: string | null }[];
  startedAt?: string;
  cardSize?: number;
  weatherLocation?: WeatherLocation | null;
}

export interface ScoreBody {
  memberId?: string | null;
  index?: number;
  targetId?: string;
  name?: string;
  scorerIndex?: number | null;
  hole: number;
  strokes: number;
}

export interface OverrideBody {
  hole: number;
  par?: number | null;
  distance_ft?: number | null;
  clear?: boolean;
}

export interface RemoveBody {
  memberId?: string | null;
  index?: number;
  name?: string;
}

export interface WeatherBody {
  weatherLocation?: WeatherLocation | null;
}

export interface PairAssignmentBody {
  assignments?: { index?: number; pairLabel?: string | null; label?: string | null; team?: string | null }[];
  pairs?: { label?: string | null; pairLabel?: string | null; team?: string | null; playerIndexes?: number[] }[];
}

export type ResolvedHole = {
  readonly hole: number;
  readonly par: number;
  readonly distance_ft: number | null;
  readonly tee_sign_id: number | null;
  readonly overridden: boolean;
};

export type ScoreTargetError = { readonly code: string; readonly message: string };

/** A score-target failure and the GLOBAL player indexes it makes unscorable. For doubles-STROKE this is
 *  one broken pair (its orphaned player); for MATCHPLAY it is the whole card (a match needs both sides),
 *  so `playerIndexes` covers every active player on that card. `cardId` is the RAW cardId (?? null),
 *  never the "card:null" grouping sentinel. */
export type CardScoringError = { readonly cardId: string | null; readonly playerIndexes: readonly number[]; readonly code: string; readonly message: string };

/** Score-target state for a round. `targets` is the healthy union (valid targets). `globalError` is set
 *  ONLY when the whole round is unscorable (a corrupt round config). `brokenPlayers` are the GLOBAL player
 *  indexes that cannot currently be scored/ranked — pair-level for stroke (only the broken pair), card-level
 *  for matchplay — so a healthy pair keeps scoring even sharing a card with a broken one. `cardErrors` is
 *  the display detail; `error` is a retained back-compat SUMMARY (globalError ?? cardErrors[0] ?? null). */
export type ScoringState = {
  readonly config: LiveScoringConfig;
  readonly targets: readonly ScoreTarget[];
  readonly cardErrors: readonly CardScoringError[];
  readonly brokenPlayers: readonly number[];
  readonly globalError: ScoreTargetError | null;
  readonly error: ScoreTargetError | null;
};

export type PublicScoreTarget = {
  readonly id: string;
  readonly type: ScoreTarget["type"];
  readonly label: string;
  readonly playerIndexes: readonly number[];
  readonly members: readonly string[];
};

export const j = (o: unknown, status = 200): Response => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

export function metadataJson(value: unknown | undefined): string | null {
  return value == null ? null : JSON.stringify(value);
}
