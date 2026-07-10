import type { Env } from "./env.js";
import * as db from "./db.js";
import { isLiveFormatError, normalizeLiveScoringConfig, normalizeLiveScoringConfigFromLegacy } from "./live-format.js";

export class AdminLiveConfigError extends Error {
  constructor() {
    super("invalid live scoring config");
    this.name = "AdminLiveConfigError";
  }
}

export async function adminLiveScoringConfigJson(input: {
  readonly env: Env;
  readonly eventId: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly playFormat: string | null;
}): Promise<string> {
  const liveConfigInput = liveScoringConfigInput(input.body);
  try {
    if (liveConfigInput.hasInput) return JSON.stringify(normalizeLiveScoringConfig(liveConfigInput.value));
    const [existingConfig, event] = await Promise.all([db.getEventConfig(input.env.DB, input.eventId), db.getEvent(input.env.DB, input.eventId)]);
    return JSON.stringify(normalizeLiveScoringConfigFromLegacy({
      live_scoring_config: existingConfig?.live_scoring_config,
      play_format: input.playFormat ?? existingConfig?.play_format,
      event_format: fieldValue(event, "format"),
    }));
  } catch (error) {
    if (isLiveFormatError(error)) throw new AdminLiveConfigError();
    throw error;
  }
}

function liveScoringConfigInput(body: Readonly<Record<string, unknown>>): { readonly hasInput: boolean; readonly value: unknown } {
  if (hasField(body, "liveScoringConfig")) return { hasInput: true, value: body.liveScoringConfig };
  if (hasField(body, "live_scoring_config")) return { hasInput: true, value: body.live_scoring_config };
  return { hasInput: false, value: undefined };
}

function hasField(body: Readonly<Record<string, unknown>>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function fieldValue(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (key === field) return item;
  }
  return undefined;
}
