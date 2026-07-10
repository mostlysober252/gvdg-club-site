export interface D1ResultLike<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: {
    changes?: number;
    rows_written?: number;
  };
}

export interface D1StatementLike {
  bind(...vals: unknown[]): D1StatementLike;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1ResultLike>;
}

export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch?(statements: D1StatementLike[]): Promise<D1ResultLike[]>;
}

export const EVENT_TYPES = ["tournament", "league_round", "fundraiser", "meeting"] as const;
export const EVENT_STATUSES = ["scheduled", "live", "final", "cancelled"] as const;
export const EVENT_FORMATS = ["stroke", "matchplay", "doubles"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
