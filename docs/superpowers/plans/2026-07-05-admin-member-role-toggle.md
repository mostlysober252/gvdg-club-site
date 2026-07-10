# Admin Member Role-Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin promote/demote another member to/from admin after account creation, with last-admin protection.

**Architecture:** Add two read-modify-write helpers to the KV roster (`setMemberAdmin`, `countAdmins`), one admin-gated endpoint (`POST /admin/members/set-role`) that enforces last-admin protection and logs the actor, and a Members-tab toggle button in `admin.html`. `isAdmin` already exists on the `Member` record and `adminGate` already re-reads it per request, so no schema/migration and no token-revocation logic is needed — a demotion takes effect on the demoted user's next admin request.

**Tech Stack:** Cloudflare Worker (TypeScript, `auth-worker/`), Workers KV (`ROSTER`), Vitest, vanilla-JS admin page (`admin.html`).

**Spec:** `docs/superpowers/specs/2026-07-05-admin-member-role-toggle-design.md`

---

## File Structure

- **Modify** `auth-worker/src/roster.ts` — add `setMemberAdmin()` + `countAdmins()` next to `setPin`/`listMembers`.
- **Modify** `auth-worker/src/club-admin-members.ts` — add the `set-role` route branch; accept an `adminId` param for the audit log.
- **Modify** `auth-worker/src/club-admin-routes.ts:38` — pass `adminId` into `handleAdminMembers`.
- **Modify** `auth-worker/test/roster.test.ts` — unit tests for `setMemberAdmin`.
- **Modify** `auth-worker/test/admin-members.test.ts` — route + `countAdmins`/last-admin tests.
- **Modify** `admin.html` — capture `ME_ID` from `/me`; add the promote/demote button in `adminLoadMembers`.

No migration. No new file.

---

## Task 1: Roster helpers `setMemberAdmin` + `countAdmins`

**Files:**
- Modify: `auth-worker/src/roster.ts` (add after `setPin`, ~line 97; `countAdmins` after `listMembers`, ~line 229)
- Test: `auth-worker/test/roster.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `auth-worker/test/roster.test.ts` (update the import on line 2 to add `setMemberAdmin, countAdmins`):

```ts
import { putMember, resolveMember, getMember, setPin, setMemberAdmin, countAdmins, updateProfile, resolveMemberFlexible, type KVListLike, type Member } from "../src/roster.js";
```

Add a listable KV helper and a describe block at the end of the file:

```ts
function makeListKV(): KVListLike {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? m.get(k)! : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async ({ prefix = "" }: { prefix?: string } = {}) => ({
      keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
}

describe("member admin flag", () => {
  it("promotes then demotes, clearing the key on demote", async () => {
    const kv = makeKV();
    await putMember(kv, SAMPLE);
    const up = await setMemberAdmin(kv, "m_abc123", true);
    expect(up?.isAdmin).toBe(true);
    expect((await getMember(kv, "m_abc123"))?.isAdmin).toBe(true);

    const down = await setMemberAdmin(kv, "m_abc123", false);
    expect(down?.isAdmin).toBeUndefined();
    expect("isAdmin" in ((await getMember(kv, "m_abc123")) as Member)).toBe(false);
  });

  it("returns null for an unknown member", async () => {
    const kv = makeKV();
    expect(await setMemberAdmin(kv, "m_nope", true)).toBeNull();
  });

  it("countAdmins counts only admins", async () => {
    const kv = makeListKV();
    await putMember(kv, { memberId: "m_1", name: "A", pinHash: "h", mustChangePin: false, isAdmin: true });
    await putMember(kv, { memberId: "m_2", name: "B", pinHash: "h", mustChangePin: false });
    expect(await countAdmins(kv)).toBe(1);
    await setMemberAdmin(kv, "m_2", true);
    expect(await countAdmins(kv)).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd auth-worker && npx vitest run test/roster.test.ts`
Expected: FAIL — `setMemberAdmin`/`countAdmins` are not exported.

- [ ] **Step 3: Implement the helpers**

In `auth-worker/src/roster.ts`, add after `setPin` (after line 97):

```ts
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
```

And after `listMembers` (after line 229):

```ts
/** Count current admins — used for last-admin protection so the club can't lock itself out. */
export async function countAdmins(kv: KVListLike): Promise<number> {
  return (await listMembers(kv)).filter((m) => m.isAdmin).length;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd auth-worker && npx vitest run test/roster.test.ts`
Expected: PASS (all roster tests, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add auth-worker/src/roster.ts auth-worker/test/roster.test.ts
git commit -m "feat(roster): setMemberAdmin + countAdmins helpers"
```

---

## Task 2: `POST /admin/members/set-role` endpoint (+ thread the actor)

**Files:**
- Modify: `auth-worker/src/club-admin-members.ts`
- Modify: `auth-worker/src/club-admin-routes.ts:38`
- Test: `auth-worker/test/admin-members.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `auth-worker/test/admin-members.test.ts` a new `describe` block at the end (the existing `login`, `req`, `json`, `env` seed with admin `m_1` + member `m_999` are reused):

```ts
describe("admin member role toggle", () => {
  it("promotes a member and it shows in the list", async () => {
    const t = await login("1", "4821");
    const r = await worker.fetch(req("/admin/members/set-role", "POST", t, { memberId: "m_999", isAdmin: true }), env);
    expect(r.status).toBe(200);
    expect((await json(r)).member).toMatchObject({ memberId: "m_999", isAdmin: true });
    const list = await json(await worker.fetch(req("/admin/members", "GET", t), env));
    expect(list.members.find((m: any) => m.memberId === "m_999").isAdmin).toBe(true);
  });

  it("demotes a member once another admin exists", async () => {
    const t = await login("1", "4821");
    await worker.fetch(req("/admin/members/set-role", "POST", t, { memberId: "m_999", isAdmin: true }), env);
    const r = await worker.fetch(req("/admin/members/set-role", "POST", t, { memberId: "m_1", isAdmin: false }), env);
    expect(r.status).toBe(200);
    expect((await json(r)).member.isAdmin).toBe(false);
  });

  it("refuses to demote the last admin (409)", async () => {
    const t = await login("1", "4821");
    const r = await worker.fetch(req("/admin/members/set-role", "POST", t, { memberId: "m_1", isAdmin: false }), env);
    expect(r.status).toBe(409);
    expect((await json(r)).error).toBe("last_admin");
  });

  it("404 unknown member, 400 bad body, 403 for a non-admin", async () => {
    const t = await login("1", "4821");
    expect((await worker.fetch(req("/admin/members/set-role", "POST", t, { memberId: "m_nope", isAdmin: true }), env)).status).toBe(404);
    expect((await worker.fetch(req("/admin/members/set-role", "POST", t, { isAdmin: true }), env)).status).toBe(400);
    expect((await worker.fetch(req("/admin/members/set-role", "POST", t, { memberId: "m_999" }), env)).status).toBe(400);
    const nt = await login("999", "4821");
    expect((await worker.fetch(req("/admin/members/set-role", "POST", nt, { memberId: "m_1", isAdmin: false }), env)).status).toBe(403);
  });

  it("is idempotent (setting the current value is a 200 no-op)", async () => {
    const t = await login("1", "4821");
    const r = await worker.fetch(req("/admin/members/set-role", "POST", t, { memberId: "m_1", isAdmin: true }), env);
    expect(r.status).toBe(200);
    expect((await json(r)).member.isAdmin).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd auth-worker && npx vitest run test/admin-members.test.ts`
Expected: FAIL — `set-role` returns 404 (route not implemented) so the 200/409 expectations fail.

- [ ] **Step 3: Implement the route + thread the actor**

In `auth-worker/src/club-admin-members.ts`, extend the roster import (line 5):

```ts
import { createMember, listMembers, resetMemberPin, getMember, setMemberAdmin, countAdmins, type AdminMember, type KVListLike, type Member } from "./roster.js";
```

Change the function signature (line 19-25) to accept `adminId`:

```ts
export async function handleAdminMembers(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
  adminId: string,
): Promise<Response | null> {
```

Add this branch **before** the final `return null;` (after the reset-pin branch, ~line 59):

```ts
  // POST /admin/members/set-role — promote/demote an existing member (last-admin protected)
  if (method === "POST" && seg.length === 3 && seg[2] === "set-role") {
    const b = (await readJson(request)) ?? {};
    const memberId = asStr(b.memberId, 80);
    if (!memberId) return json({ error: "member_required" }, 400, origin);
    if (typeof b.isAdmin !== "boolean") return json({ error: "isAdmin_required" }, 400, origin);
    const isAdmin = b.isAdmin;

    const target = await getMember(env.ROSTER, memberId);
    if (!target) return json({ error: "not_found" }, 404, origin);

    // Never remove the final admin — also blocks the sole admin from self-demoting.
    if (!isAdmin && target.isAdmin === true) {
      const admins = await countAdmins(env.ROSTER as unknown as KVListLike);
      if (admins <= 1) return json({ error: "last_admin" }, 409, origin);
    }

    const updated = await setMemberAdmin(env.ROSTER, memberId, isAdmin);
    if (!updated) return json({ error: "not_found" }, 404, origin);
    console.log(JSON.stringify({ evt: "role_change", actor: adminId, target: memberId, isAdmin }));
    return json({ member: pub(updated) }, 200, origin);
  }
```

In `auth-worker/src/club-admin-routes.ts` line 38, pass `adminId`:

```ts
  else if (sub === "members") response = await handleAdminMembers(request, env, origin, method, seg, adminId);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd auth-worker && npx vitest run test/admin-members.test.ts`
Expected: PASS (all existing + 5 new role-toggle tests).

- [ ] **Step 5: Typecheck + full worker suite**

Run: `cd auth-worker && npm run typecheck && npm test`
Expected: `tsc --noEmit` clean; all vitest suites green.

- [ ] **Step 6: Commit**

```bash
git add auth-worker/src/club-admin-members.ts auth-worker/src/club-admin-routes.ts auth-worker/test/admin-members.test.ts
git commit -m "feat(admin): POST /admin/members/set-role — promote/demote with last-admin guard"
```

---

## Task 3: Admin UI — Members-tab promote/demote button

**Files:**
- Modify: `admin.html` (`checkAdminSession` ~line 913; `adminLoadMembers` ~line 2325-2345)

No JS unit harness exists for `admin.html` (repo-root `tests/*.mjs` are pure-helper tests). This task is verified by the live-verify gate in Task 4.

- [ ] **Step 1: Capture the current admin's id from `/me`**

Near the other module-scoped constants in the `admin.html` inline script (e.g. just after the `AUTH_BASE` block ~line 862), add:

```js
        let ME_ID = null;   // the signed-in admin's memberId (from /me .sub), for the self-demote warning
```

In `checkAdminSession` (line 914), set it right after `const data = await res.json();`:

```js
                    const data = await res.json();
                    ME_ID = data && data.sub ? data.sub : null;
```

- [ ] **Step 2: Add the role button in `adminLoadMembers`**

In `adminLoadMembers` (line 2325), after `list.textContent = '';` and before the `members.forEach`, compute the admin count:

```js
            const adminCount = members.filter((x) => x.isAdmin).length;
```

Inside the `members.forEach((m) => { ... })` block, after `row.appendChild(re);` (line 2342) and before `list.appendChild(row);`, add:

```js
                const roleBtn = elx('button', 'admin-btn', m.isAdmin ? 'Remove admin' : 'Make admin');
                roleBtn.type = 'button';
                if (m.isAdmin && adminCount <= 1) { roleBtn.disabled = true; roleBtn.title = "Can't remove the last admin"; }
                roleBtn.addEventListener('click', async () => {
                    const promoting = !m.isAdmin;
                    const self = ME_ID && ME_ID === m.memberId;
                    const ask = promoting
                        ? 'Grant admin rights to ' + m.name + '?'
                        : (self ? "Remove your OWN admin access? You'll lose this panel." : 'Remove admin rights from ' + m.name + '?');
                    if (!confirm(ask)) return;
                    roleBtn.disabled = true;
                    const r = await adminApi('/admin/members/set-role', { method: 'POST', body: { memberId: m.memberId, isAdmin: promoting } });
                    if (r.ok) { adminMsg((promoting ? 'Promoted ' : 'Demoted ') + m.name, true); adminLoadMembers(); }
                    else {
                        let err = {}; try { err = await r.json(); } catch (e) {}
                        adminMsg(err.error === 'last_admin' ? "Can't remove the last admin" : ('Role change failed (' + r.status + ')'), false);
                        roleBtn.disabled = false;
                    }
                });
                row.appendChild(roleBtn);
```

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat(admin-ui): promote/demote button on the Members tab"
```

---

## Task 4: Live-verification (the required gate) + deploy

- [ ] **Step 1: Boot the worker locally with a seeded admin**

Run: `cd auth-worker && npm run dev` (wrangler dev, local KV). Seed admin Jane per the project recipe (`scripts/dev-seed.mjs`: PDGA 12345 / PIN 4821, `isAdmin:true`).

- [ ] **Step 2: Serve the site + drive the admin app**

Serve the repo root (`python3 -m http.server 8080 --bind 127.0.0.1`), open `admin.html` (pointed at the local worker via `data-auth-base`), log in as Jane, open the **Members** tab.

- [ ] **Step 3: Exercise every branch in the running app**

1. Create a second member (existing "Add member" form). Confirm the new row shows **Make admin**.
2. Click **Make admin** → confirm → row shows `· admin` and a **Remove admin** button; the new member can now reach `admin.html`.
3. Click **Remove admin** on that member → back to non-admin; their admin calls now 403.
4. With Jane the only admin, her **Remove admin** button is **disabled** ("Can't remove the last admin"); force the request via devtools and confirm the server returns **409** with the friendly message.
5. Verify light + dark, **0 console errors**.

- [ ] **Step 4: Deploy (only via the sanctioned path)**

```bash
git fetch origin main && git status         # confirm clean + not behind origin/main
git push origin main                        # shared-main: push BEFORE deploy
GVDG_AGENT=role-toggle ./scripts/gvdg-deploy.sh   # full deploy (worker + pages); self-gates tests/typecheck/hex
./scripts/gvdg-deploy.sh --status           # confirm HEAD is live
```

- [ ] **Step 5: Smoke-verify on `gvdgclub.com`**

Log into the live admin panel, confirm the Members tab shows the role buttons and a promote→demote round-trip works. Report the result honestly (live-verified or not).

---

## Self-Review notes

- **Spec coverage:** §3.1 → Task 1; §3.2 (endpoint + last-admin + audit) → Task 2; §3.3 (UI) → Task 3; §5 testing → Tasks 1/2 (unit) + Task 4 (live). All covered.
- **Type consistency:** `setMemberAdmin(kv, memberId, isAdmin)` and `countAdmins(kv)` names/signatures match across roster.ts, the route, and tests. `/me` id is `sub` (used as `ME_ID`). Route body key is `memberId` everywhere (roster helper, route, UI, tests).
- **Last-admin edge:** demote-success test first promotes `m_999` so `countAdmins()===2`, then demotes `m_1` — otherwise the guard would (correctly) 409.
