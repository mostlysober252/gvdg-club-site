// Member roster stored in Workers KV.
//
// Layout:
//   member:<memberId>      -> JSON Member record (the source of truth)
//   idx:pdga:<digits>      -> memberId  (login-by-PDGA# index)
//   idx:udisc:<lowercase>  -> memberId  (login-by-UDisc-username index)

import type { KVLike } from "./ratelimit.js";

export interface Member {
  memberId: string;
  name: string;
  pdgaNo?: string;
  udisc?: string;
  /** Profile photo: a pdga.com URL (auto) or a small data-URL (member upload). */
  photo?: string;
  /** Club admin — may manage events/courses/leagues/etc. Granted by an admin via provisioning. */
  isAdmin?: boolean;
  pinHash: string;
  mustChangePin: boolean;
  /** Monotonic PIN-version. Bumped on every PIN change/reset so tokens minted earlier are rejected
   *  server-side (see authz.requireAuth). Absent = 0 for legacy records. */
  pinVer?: number;
}

export type ProfilePatch = { pdgaNo?: string | null; udisc?: string | null; photo?: string | null };
export type UpdateResult = { ok: true; member: Member } | { ok: false; conflict: "pdga" | "udisc" };

const RECORD = (id: string) => `member:${id}`;
const IDX_PDGA = (n: string) => `idx:pdga:${normPdga(n)}`;
const IDX_UDISC = (u: string) => `idx:udisc:${normUdisc(u)}`;

function normPdga(s: string): string {
  return s.replace(/\D/g, "");
}
function normUdisc(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Canonical lockout / rate-limit key for a login identifier, using the SAME normalization
 * resolveMember applies. Every punctuation variant of one PDGA# ("1-2345", "1.2345", "12345x")
 * collapses to a single `pdga:<digits>` key, and any casing of a UDisc name to one `udisc:<lc>` key —
 * so an attacker can't reset the per-identifier lockout by mutating the raw identifier string.
 */
export function canonicalLoginKey(identifier: string): string {
  const digits = normPdga(identifier);
  return digits ? `pdga:${digits}` : `udisc:${normUdisc(identifier)}`;
}

/** Write a member record and its login indexes. Used by the admin seeding script. */
export async function putMember(kv: KVLike, m: Member): Promise<void> {
  await kv.put(RECORD(m.memberId), JSON.stringify(m));
  if (m.pdgaNo) await kv.put(IDX_PDGA(m.pdgaNo), m.memberId);
  if (m.udisc) await kv.put(IDX_UDISC(m.udisc), m.memberId);
}

export async function getMember(kv: KVLike, memberId: string): Promise<Member | null> {
  const raw = await kv.get(RECORD(memberId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Member;
  } catch {
    return null;
  }
}

/**
 * Resolve a member by either a PDGA # or a UDisc username.
 * Tries the PDGA index first, then the UDisc index, so a single login field accepts both.
 */
export async function resolveMember(kv: KVLike, identifier: string): Promise<Member | null> {
  const id = identifier.trim();
  if (!id) return null;

  const pdgaDigits = normPdga(id);
  if (pdgaDigits) {
    const memberId = await kv.get(IDX_PDGA(pdgaDigits));
    if (memberId) return getMember(kv, memberId);
  }
  const memberId = await kv.get(IDX_UDISC(id));
  if (memberId) return getMember(kv, memberId);

  return null;
}

/** Replace a member's PIN hash, clear the forced-change flag, and bump pinVer so every token issued
 *  before this change is revoked. Returns the new pinVer so the caller can mint a fresh, valid token. */
export async function setPin(kv: KVLike, memberId: string, pinHash: string): Promise<number> {
  const m = await getMember(kv, memberId);
  if (!m) throw new Error(`unknown member: ${memberId}`);
  m.pinHash = pinHash;
  m.mustChangePin = false;
  m.pinVer = (m.pinVer ?? 0) + 1;
  await kv.put(RECORD(memberId), JSON.stringify(m));
  return m.pinVer;
}

/** Grant or revoke a member's admin flag. Read-modify-write; all other fields untouched.
 *  Clears the key entirely when false to match the "absent = not admin" convention that
 *  createMember follows. Returns the updated member, or null if the member doesn't exist. */
export async function setMemberAdmin(kv: KVLike, memberId: string, isAdmin: boolean): Promise<Member | null> {
  const m = await getMember(kv, memberId);
  if (!m) return null;
  if (isAdmin) m.isAdmin = true;
  else delete m.isAdmin;
  await kv.put(RECORD(memberId), JSON.stringify(m));
  return m;
}

/** Replace ONLY a member's PIN hash (used for the transparent pepper re-hash on login). Unlike setPin,
 *  it leaves mustChangePin and pinVer untouched, so silently upgrading the hash never revokes the
 *  member's other sessions or re-triggers a forced change. No-op if the member vanished mid-request. */
export async function rehashPin(kv: KVLike, memberId: string, pinHash: string): Promise<void> {
  const m = await getMember(kv, memberId);
  if (!m) return;
  m.pinHash = pinHash;
  await kv.put(RECORD(memberId), JSON.stringify(m));
}

/**
 * Update a member's self-service profile fields (PDGA #, UDisc username, photo) and keep
 * the login indexes in sync. A field left `undefined` is unchanged; `null`/"" clears it.
 * Refuses to claim a PDGA #/UDisc already owned by a DIFFERENT member (identity-hijack guard);
 * conflicts are checked before any mutation so updates are all-or-nothing.
 */
export async function updateProfile(kv: KVLike, memberId: string, patch: ProfilePatch): Promise<UpdateResult> {
  const m = await getMember(kv, memberId);
  if (!m) throw new Error(`unknown member: ${memberId}`);

  const newPdga = patch.pdgaNo === undefined ? undefined : normPdga(String(patch.pdgaNo ?? "")) || null;
  // UDisc: keep the member's display casing on the record; index by lowercase (IDX_UDISC normalizes).
  const newUdisc = patch.udisc === undefined ? undefined : String(patch.udisc ?? "").trim() || null;

  if (newPdga) {
    const owner = await kv.get(IDX_PDGA(newPdga));
    if (owner && owner !== memberId) return { ok: false, conflict: "pdga" };
  }
  if (newUdisc) {
    const owner = await kv.get(IDX_UDISC(newUdisc));
    if (owner && owner !== memberId) return { ok: false, conflict: "udisc" };
  }

  if (newPdga !== undefined) {
    if (m.pdgaNo && normPdga(m.pdgaNo) !== newPdga) await kv.delete(IDX_PDGA(m.pdgaNo));
    if (newPdga) {
      m.pdgaNo = newPdga;
      await kv.put(IDX_PDGA(newPdga), memberId);
    } else {
      delete m.pdgaNo;
    }
  }
  if (newUdisc !== undefined) {
    if (m.udisc && normUdisc(m.udisc) !== normUdisc(newUdisc ?? "")) await kv.delete(IDX_UDISC(m.udisc));
    if (newUdisc) {
      m.udisc = newUdisc;
      await kv.put(IDX_UDISC(newUdisc), memberId);
    } else {
      delete m.udisc;
    }
  }
  if (patch.photo !== undefined) {
    if (patch.photo) m.photo = patch.photo;
    else delete m.photo;
  }

  await kv.put(RECORD(memberId), JSON.stringify(m));
  return { ok: true, member: m };
}

// ---------------- admin onboarding (issue temporary PINs) ----------------

/** KVLike plus `list` — for enumerating member records in the admin members view. */
export interface KVListLike extends KVLike {
  list(opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

/** Stable memberId from identity: prefers PDGA# (`m_<digits>`), else UDisc (`m_u_<lowercase>`). */
export function memberIdFor(input: { pdgaNo?: string | null; udisc?: string | null }): string | null {
  const pdga = input.pdgaNo ? normPdga(input.pdgaNo) : "";
  if (pdga) return `m_${pdga}`;
  const udisc = input.udisc ? normUdisc(input.udisc) : "";
  if (udisc) return `m_u_${udisc}`;
  return null;
}

export type CreateMemberInput = { name: string; pdgaNo?: string | null; udisc?: string | null; isAdmin?: boolean };
export type CreateResult = { ok: true; member: Member } | { ok: false; reason: "exists" | "conflict" | "invalid" };
export type AdminMember = Pick<Member, "memberId" | "name" | "pdgaNo" | "udisc" | "isAdmin" | "mustChangePin">;

/** Create a NEW member with an admin-issued temporary PIN (mustChangePin: true). Fails with `exists`
 *  if the member id is taken, or `conflict` if a PDGA#/UDisc index already points at someone else —
 *  use resetMemberPin to reissue a PIN for an existing member instead. */
export async function createMember(kv: KVLike, input: CreateMemberInput, pinHash: string): Promise<CreateResult> {
  const memberId = memberIdFor(input);
  if (!memberId || !input.name?.trim()) return { ok: false, reason: "invalid" };
  if (await kv.get(RECORD(memberId))) return { ok: false, reason: "exists" };
  const pdga = input.pdgaNo ? normPdga(input.pdgaNo) : "";
  const udisc = input.udisc ? normUdisc(input.udisc) : "";
  if (pdga) { const o = await kv.get(IDX_PDGA(pdga)); if (o && o !== memberId) return { ok: false, reason: "conflict" }; }
  if (udisc) { const o = await kv.get(IDX_UDISC(udisc)); if (o && o !== memberId) return { ok: false, reason: "conflict" }; }
  const m: Member = {
    memberId,
    name: input.name.trim(),
    ...(pdga ? { pdgaNo: pdga } : {}),
    ...(udisc ? { udisc: input.udisc!.trim() } : {}),
    ...(input.isAdmin ? { isAdmin: true } : {}),
    pinHash,
    mustChangePin: true,
  };
  await putMember(kv, m);
  return { ok: true, member: m };
}

/** Reissue a temporary PIN for an EXISTING member (resolved by PDGA#/UDisc): sets the new hash and
 *  forces a change on next login; other fields are untouched. Returns the member, or null if not found. */
export async function resetMemberPin(kv: KVLike, identifier: string, pinHash: string): Promise<Member | null> {
  const m = await resolveMember(kv, identifier);
  if (!m) return null;
  m.pinHash = pinHash;
  m.mustChangePin = true;
  m.pinVer = (m.pinVer ?? 0) + 1;
  await kv.put(RECORD(m.memberId), JSON.stringify(m));
  return m;
}

/** List all members for the admin view — public-safe fields only, NEVER the pinHash. */
export async function listMembers(kv: KVListLike): Promise<AdminMember[]> {
  const out: AdminMember[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: "member:", cursor });
    for (const k of page.keys) {
      const m = await getMember(kv, k.name.slice("member:".length));
      if (m) out.push({ memberId: m.memberId, name: m.name, pdgaNo: m.pdgaNo, udisc: m.udisc, isAdmin: m.isAdmin === true, mustChangePin: m.mustChangePin });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Count current admins — used for last-admin protection so the club can't lock itself out. */
export async function countAdmins(kv: KVListLike): Promise<number> {
  return (await listMembers(kv)).filter((m) => m.isAdmin).length;
}

/** Resolve a member for admin tools by ANY of: internal memberId (`m_…`), PDGA# (digits), UDisc
 *  username, or an exact (case-insensitive) display name. The name match must be unambiguous — two
 *  members with the same name return `ambiguous` so an admin can't credit the wrong wallet. */
export async function resolveMemberFlexible(
  kv: KVListLike,
  identifier: string,
): Promise<{ ok: true; member: Member } | { ok: false; reason: "not_found" | "ambiguous" }> {
  const id = identifier.trim();
  if (!id) return { ok: false, reason: "not_found" };
  const byId = await getMember(kv, id);
  if (byId) return { ok: true, member: byId };
  const resolved = await resolveMember(kv, id); // PDGA# or UDisc username
  if (resolved) return { ok: true, member: resolved };
  const lc = id.toLowerCase();
  const named = (await listMembers(kv)).filter((m) => m.name.trim().toLowerCase() === lc);
  if (named.length > 1) return { ok: false, reason: "ambiguous" };
  if (named.length === 1) {
    const full = await getMember(kv, named[0]!.memberId);
    if (full) return { ok: true, member: full };
  }
  return { ok: false, reason: "not_found" };
}
