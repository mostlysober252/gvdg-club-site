import type { Env } from "./env.js";
import * as db from "./db.js";
import * as shopDb from "./shop-db.js";
import { EVENT_FORMATS, EVENT_STATUSES, EVENT_TYPES } from "./db.js";
import { assignShotgun, assignTeams } from "./assign.js";
import { getMember } from "./roster.js";
import { json, readJson } from "./http.js";
import { asInt, asIsoTimestamp, asStr, inSet, jsonStringArray, validEventCoursesInput, validEventInput } from "./input.js";
import { AdminLiveConfigError, adminLiveScoringConfigJson } from "./admin-live-config.js";
import { inlineLayout } from "./admin-event-layout.js";
import { defaultCtpPayoutNote } from "./admin-payout-notes.js";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const hasField = (body: Record<string, unknown>, field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);

function withPrimaryLayout(input: db.EventInput, layoutId: number): db.EventInput {
  if (!input.event_courses?.length) return { ...input, layout_id: layoutId };
  return {
    ...input,
    layout_id: layoutId,
    event_courses: input.event_courses.map((course, index) => (index === 0 ? { ...course, layout_id: layoutId } : course)),
  };
}

export async function handleAdminEvents(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
  adminId: string,
  id: number | null,
): Promise<Response | null> {
  if (seg[3] === "players" && id != null) {
    if (method === "POST") {
      const b = await readJson(request);
      const name = b && asStr(b.name, 100);
      if (!b || !name) return json({ error: "invalid_player" }, 400, origin);
      const row = await db.addEventPlayer(env.DB, { event_id: id, member_id: asStr(b.member_id, 64), name, pdga_no: asStr(b.pdga_no, 20), division: asStr(b.division, 40), team: asStr(b.team, 40) });
      return json({ player: row }, 201, origin);
    }
    if (method === "DELETE" && seg[4] != null) {
      const pid = asInt(seg[4]);
      if (pid == null) return json({ error: "not_found" }, 404, origin);
      await db.removeEventPlayer(env.DB, id, pid);
      return json({ ok: true }, 200, origin);
    }
  }
  if (seg[3] === "config" && id != null && method === "PUT") {
    const b = (await readJson(request)) ?? {};
    const divs = jsonStringArray(b.divisions, 40);
    const fmt = b.play_format == null ? null : (inSet(["singles", "doubles"], b.play_format) ? (b.play_format as string) : undefined);
    if (fmt === undefined) return json({ error: "invalid_config" }, 400, origin);
    let liveScoringConfig: string;
    try {
      liveScoringConfig = await adminLiveScoringConfigJson({ env, eventId: id, body: b, playFormat: fmt });
    } catch (error) {
      if (error instanceof AdminLiveConfigError) return json({ error: "invalid_config" }, 400, origin);
      throw error;
    }
    const row = await db.upsertEventConfig(env.DB, id, {
      registration_open: b.registration_open ? 1 : 0, entry_fee_cents: asInt(b.entry_fee_cents), ctp_fee_cents: asInt(b.ctp_fee_cents),
      ace_fee_cents: asInt(b.ace_fee_cents), divisions: divs, play_format: fmt, live_scoring_config: liveScoringConfig, notes: asStr(b.notes, 2000),
    });
    return json({ config: row }, 200, origin);
  }
  if (seg[3] === "registrations" && id != null) {
    if (method === "GET" && seg[4] == null) return json({ registrations: await db.listRegistrations(env.DB, id) }, 200, origin);
    if (method === "PATCH" && seg[4] != null) {
      const rid = asInt(seg[4]);
      if (rid == null) return json({ error: "not_found" }, 404, origin);
      const b = (await readJson(request)) ?? {};
      const row = await db.adminUpdateRegistration(env.DB, rid, {
        division: asStr(b.division, 60), team: asStr(b.team, 40), starting_hole: asInt(b.starting_hole),
        checked_in: b.checked_in == null ? null : (b.checked_in ? 1 : 0), paid_entry: b.paid_entry == null ? null : (b.paid_entry ? 1 : 0),
      });
      return row ? json({ registration: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
    }
  }
  if (seg[3] === "store-credit" && id != null) {
    if (method === "GET") return json({ payouts: await shopDb.listEventStoreCreditPayouts(env.DB, id) }, 200, origin);
    if (method === "POST") {
      const body = (await readJson(request)) ?? {};
      const memberId = asStr(body.member_id, 80);
      const amount = asInt(body.amount_cents);
      if (!memberId || amount == null || amount <= 0) return json({ error: "invalid_store_credit" }, 400, origin);
      const event = await db.getEvent(env.DB, id);
      if (!event) return json({ error: "not_found" }, 404, origin);
      const member = await getMember(env.ROSTER, memberId);
      if (!member) return json({ error: "member_not_found" }, 404, origin);
      const tx = await shopDb.createWalletTransaction(env.DB, {
        member_id: memberId,
        member_name: member.name,
        amount_cents: amount,
        transaction_type: "credit",
        source: "event_payout",
        event_id: id,
        note: asStr(body.note, 300) ?? "Store credit payout",
        created_by: adminId,
      });
      return json({ transaction: tx, balance_cents: await shopDb.walletBalance(env.DB, memberId), payouts: await shopDb.listEventStoreCreditPayouts(env.DB, id) }, 201, origin);
    }
  }
  if (seg[3] === "ctps" && id != null) {
    if (method === "POST" && seg[4] == null) {
      const b = await readJson(request);
      const hole = b && asInt(b.hole);
      if (!b || hole == null) return json({ error: "invalid_ctp" }, 400, origin);
      const row = await db.createCtp(env.DB, { event_id: id, hole, division: asStr(b.division, 60), prize: asStr(b.prize, 200) });
      return json({ ctp: row }, 201, origin);
    }
    const cid = seg[4] != null ? asInt(seg[4]) : null;
    if (method === "POST" && cid != null && seg[5] === "store-credit") {
      const body = (await readJson(request)) ?? {};
      const memberId = asStr(body.member_id, 80);
      const amount = asInt(body.amount_cents);
      if (!memberId || amount == null || amount <= 0) return json({ error: "invalid_store_credit" }, 400, origin);
      const event = await db.getEvent(env.DB, id);
      if (!event) return json({ error: "not_found" }, 404, origin);
      const member = await getMember(env.ROSTER, memberId);
      if (!member) return json({ error: "member_not_found" }, 404, origin);
      const winnerName = asStr(body.winner_name, 100) ?? member.name;
      const ctp = await db.setCtpWinner(env.DB, cid, id, memberId, winnerName);
      if (!ctp) return json({ error: "not_found" }, 404, origin);
      const tx = await shopDb.createWalletTransaction(env.DB, {
        member_id: memberId,
        member_name: member.name,
        amount_cents: amount,
        transaction_type: "credit",
        source: "event_payout",
        event_id: id,
        note: asStr(body.note, 300) ?? defaultCtpPayoutNote(event, ctp),
        created_by: adminId,
      });
      return json({ ctp, transaction: tx, balance_cents: await shopDb.walletBalance(env.DB, memberId), payouts: await shopDb.listEventStoreCreditPayouts(env.DB, id) }, 201, origin);
    }
    if (method === "PATCH" && cid != null && seg[5] == null) {
      const b = (await readJson(request)) ?? {};
      const row = await db.setCtpWinner(env.DB, cid, id, asStr(b.winner_member_id, 64), asStr(b.winner_name, 100));
      return row ? json({ ctp: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
    }
    if (method === "DELETE" && cid != null && seg[5] == null) {
      await db.deleteCtp(env.DB, id, cid);
      return json({ ok: true }, 200, origin);
    }
  }
  if (seg[3] === "ace-pot" && id != null && method === "PUT") {
    const b = (await readJson(request)) ?? {};
    const status = b.status == null ? "active" : (inSet(["active", "paid_out", "carried"], b.status) ? (b.status as string) : undefined);
    if (status === undefined) return json({ error: "invalid_ace_pot" }, 400, origin);
    const row = await db.upsertAcePot(env.DB, id, {
      carryover_in_cents: asInt(b.carryover_in_cents), status, winner_member_id: asStr(b.winner_member_id, 64),
      winner_name: asStr(b.winner_name, 100), payout_cents: asInt(b.payout_cents), resolved_at: status === "active" ? null : new Date().toISOString(),
    });
    return json({ ace_pot: row }, 200, origin);
  }
  if ((seg[3] === "assign-starting-holes" || seg[3] === "assign-teams") && id != null && method === "POST") {
    const b = (await readJson(request)) ?? {};
    const regs = (await db.listRegistrations(env.DB, id)) as { id: number }[];
    let order = regs.map((r) => r.id);
    if (b.shuffle !== false) order = shuffle(order);
    if (seg[3] === "assign-starting-holes") {
      const ev = (await db.getEvent(env.DB, id)) as { layout_id?: number | null } | null;
      let holes = (await db.getLayoutHoles(env.DB, ev?.layout_id)).map((h) => h.hole);
      if (!holes.length) holes = Array.from({ length: asInt(b.holeCount) || 18 }, (_, i) => i + 1);
      const assigned = assignShotgun(order.map(String), holes, asInt(b.groupSize) || 4);
      await Promise.all(order.map((rid, i) => db.adminUpdateRegistration(env.DB, rid, { starting_hole: assigned[i]!.hole })));
    } else {
      const opts = asInt(b.size) ? { size: asInt(b.size)! } : { count: asInt(b.count) || 2 };
      const assigned = assignTeams(order.map(String), opts);
      await Promise.all(order.map((rid, i) => db.adminUpdateRegistration(env.DB, rid, { team: assigned[i]!.team })));
    }
    return json({ registrations: await db.listRegistrations(env.DB, id) }, 200, origin);
  }
  if (method === "POST" && seg.length === 2) {
    const b = await readJson(request);
    const v = b && validEventInput(b);
    if (!v) return json({ error: "invalid_event" }, 400, origin);
    let layout: unknown = null;
    let eventInput = v;
    const layoutBody = b && typeof b === "object" ? (b as Record<string, unknown>).layout : null;
    if (layoutBody != null && v.layout_id == null) {
      if (v.course_id == null) return json({ error: "invalid_layout" }, 400, origin);
      const cleanLayout = inlineLayout(layoutBody);
      if (!cleanLayout) return json({ error: "invalid_layout" }, 400, origin);
      layout = await db.createLayout(env.DB, { course_id: v.course_id, ...cleanLayout });
      const layoutId = asInt((layout as { id?: unknown } | null)?.id);
      if (layoutId == null) return json({ error: "invalid_layout" }, 500, origin);
      eventInput = withPrimaryLayout(v, layoutId);
    }
    const row = await db.createEvent(env.DB, { ...eventInput, created_by: adminId });
    return json(layout ? { event: row, layout } : { event: row }, 201, origin);
  }
  if (method === "PATCH" && id != null) {
    const b = (await readJson(request)) ?? {};
    const patch: db.EventPatch = {};
    if (hasField(b, "type")) {
      if (!inSet(EVENT_TYPES, b.type)) return json({ error: "invalid_event" }, 400, origin);
      patch.type = b.type;
    }
    if (hasField(b, "name")) {
      const name = asStr(b.name, 200);
      if (!name) return json({ error: "invalid_event" }, 400, origin);
      patch.name = name;
    }
    if (hasField(b, "status")) {
      if (!inSet(EVENT_STATUSES, b.status)) return json({ error: "invalid_event" }, 400, origin);
      patch.status = b.status;
    }
    if (hasField(b, "format")) {
      if (b.format == null || b.format === "") patch.format = null;
      else if (inSet(EVENT_FORMATS, b.format)) patch.format = b.format;
      else return json({ error: "invalid_event" }, 400, origin);
    }
    if (hasField(b, "date")) {
      const date = b.date == null || b.date === "" ? null : asStr(b.date, 40);
      if (date == null && b.date != null && b.date !== "") return json({ error: "invalid_event" }, 400, origin);
      patch.date = date;
    }
    if (hasField(b, "course_id")) {
      const courseId = b.course_id == null || b.course_id === "" ? null : asInt(b.course_id);
      if (courseId == null && b.course_id != null && b.course_id !== "") return json({ error: "invalid_event" }, 400, origin);
      patch.course_id = courseId;
    }
    if (hasField(b, "layout_id")) {
      const layoutId = b.layout_id == null || b.layout_id === "" ? null : asInt(b.layout_id);
      if (layoutId == null && b.layout_id != null && b.layout_id !== "") return json({ error: "invalid_event" }, 400, origin);
      patch.layout_id = layoutId;
    }
    if (hasField(b, "event_courses")) {
      const eventCourses = validEventCoursesInput(b.event_courses);
      if (!eventCourses) return json({ error: "invalid_event" }, 400, origin);
      patch.event_courses = eventCourses;
    }
    if (hasField(b, "league_id")) {
      const leagueId = b.league_id == null || b.league_id === "" ? null : asInt(b.league_id);
      if (leagueId == null && b.league_id != null && b.league_id !== "") return json({ error: "invalid_event" }, 400, origin);
      patch.league_id = leagueId;
    }
    if (hasField(b, "notes")) {
      const notes = b.notes == null || b.notes === "" ? null : asStr(b.notes, 5000);
      if (notes == null && b.notes != null && b.notes !== "") return json({ error: "invalid_event" }, 400, origin);
      patch.notes = notes;
    }
    if (hasField(b, "starts_at") || hasField(b, "start_time")) {
      const startsAt = asIsoTimestamp(hasField(b, "starts_at") ? b.starts_at : b.start_time);
      if (startsAt === undefined) return json({ error: "invalid_event" }, 400, origin);
      patch.starts_at = startsAt;
    }
    if (hasField(b, "registration_deadline")) {
      const rd = asIsoTimestamp(b.registration_deadline);
      if (rd === undefined) return json({ error: "invalid_event" }, 400, origin);
      patch.registration_deadline = rd;
    }
    if (hasField(b, "checkin_deadline")) {
      const cd = asIsoTimestamp(b.checkin_deadline);
      if (cd === undefined) return json({ error: "invalid_event" }, 400, origin);
      patch.checkin_deadline = cd;
    }
    const row = await db.updateEvent(env.DB, id, patch);
    return row ? json({ event: row }, 200, origin) : json({ error: "not_found" }, 404, origin);
  }
  if (method === "DELETE" && id != null) {
    await db.deleteEvent(env.DB, id);
    return json({ ok: true }, 200, origin);
  }
  return null;
}
