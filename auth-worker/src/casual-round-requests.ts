import type { D1Like } from "./db.js";

export type CasualRoundStatus = "open" | "closed" | "cancelled";

export interface CasualRoundRequestInput {
  course_id: number;
  layout_id: number;
  created_by: string;
  created_by_name: string;
  starts_at: string;
  notes?: string | null;
}

export interface CasualRoundRequest {
  id: number;
  course_id: number;
  layout_id: number;
  created_by: string;
  created_by_name: string;
  starts_at: string;
  notes: string | null;
  status: CasualRoundStatus;
  round_code: string | null;
  created_at: string;
  updated_at: string;
  course_name: string;
  course_location: string | null;
  layout_name: string | null;
  player_count: number;
  players: string[];
  committed: boolean;
}

type RequestRow = {
  id: number;
  course_id: number;
  layout_id: number;
  created_by: string;
  created_by_name: string;
  starts_at: string;
  notes?: string | null;
  status: CasualRoundStatus;
  round_code?: string | null;
  created_at: string;
  updated_at: string;
  course_name: string;
  course_location?: string | null;
  layout_name?: string | null;
  player_count?: number | string | null;
  player_names?: string | null;
  committed?: number | string | null;
};

const PLAYER_SEP = "\u001f";

const SELECT_REQUESTS = `
  SELECT
    r.id, r.course_id, r.layout_id, r.created_by, r.created_by_name, r.starts_at,
    r.notes, r.status, r.round_code, r.created_at, r.updated_at,
    c.name AS course_name, c.location AS course_location, l.name AS layout_name,
    COUNT(j.id) AS player_count,
    GROUP_CONCAT(j.member_name, char(31)) AS player_names,
    MAX(CASE WHEN j.member_id = ? THEN 1 ELSE 0 END) AS committed
  FROM casual_round_requests r
  JOIN courses c ON c.id = r.course_id
  LEFT JOIN course_layouts l ON l.id = r.layout_id
  LEFT JOIN casual_round_commitments j ON j.request_id = r.id
`;

function recentCutoff(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
}

function asCount(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function hydrate(row: RequestRow): CasualRoundRequest {
  return {
    id: row.id,
    course_id: row.course_id,
    layout_id: row.layout_id,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    starts_at: row.starts_at,
    notes: row.notes ?? null,
    status: row.status,
    round_code: row.round_code ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    course_name: row.course_name,
    course_location: row.course_location ?? null,
    layout_name: row.layout_name ?? null,
    player_count: asCount(row.player_count),
    players: row.player_names ? row.player_names.split(PLAYER_SEP).filter(Boolean) : [],
    committed: row.committed === 1 || row.committed === "1",
  };
}

export async function listCasualRoundRequests(db: D1Like, viewerMemberId: string | null): Promise<CasualRoundRequest[]> {
  const rows = (
    await db
      .prepare(
        `${SELECT_REQUESTS}
         WHERE r.status = 'open' AND r.starts_at >= ?
         GROUP BY r.id
         ORDER BY r.starts_at ASC, r.id ASC`,
      )
      .bind(viewerMemberId ?? "", recentCutoff())
      .all<RequestRow>()
  ).results;
  return rows.map(hydrate);
}

export async function getCasualRoundRequest(db: D1Like, id: number, viewerMemberId: string | null): Promise<CasualRoundRequest | null> {
  const row = await db
    .prepare(
      `${SELECT_REQUESTS}
       WHERE r.id = ?
       GROUP BY r.id`,
    )
    .bind(viewerMemberId ?? "", id)
    .first<RequestRow>();
  return row ? hydrate(row) : null;
}

export async function createCasualRoundRequest(db: D1Like, input: CasualRoundRequestInput): Promise<number | null> {
  const row = await db
    .prepare(
      `INSERT INTO casual_round_requests (course_id, layout_id, created_by, created_by_name, starts_at, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(input.course_id, input.layout_id, input.created_by, input.created_by_name, input.starts_at, input.notes ?? null)
    .first<{ id: number }>();
  return row?.id ?? null;
}

export async function joinCasualRoundRequest(db: D1Like, requestId: number, memberId: string, memberName: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO casual_round_commitments (request_id, member_id, member_name)
       VALUES (?, ?, ?)
       ON CONFLICT(request_id, member_id) DO UPDATE SET member_name=excluded.member_name`,
    )
    .bind(requestId, memberId, memberName)
    .run();
}

export async function leaveCasualRoundRequest(db: D1Like, requestId: number, memberId: string): Promise<void> {
  await db.prepare("DELETE FROM casual_round_commitments WHERE request_id = ? AND member_id = ?").bind(requestId, memberId).run();
}

export async function closeCasualRoundRequest(db: D1Like, requestId: number): Promise<void> {
  await db
    .prepare("UPDATE casual_round_requests SET status = 'closed', updated_at = datetime('now') WHERE id = ?")
    .bind(requestId)
    .run();
}
