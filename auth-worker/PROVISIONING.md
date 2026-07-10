# Roster provisioning (slice B2)

`scripts/provision.mjs` turns a plain roster JSON file into the two artifacts an admin needs to
onboard GVDG members into the auth Worker's KV store:

1. **`kv-bulk.json`** — member records + login indexes, ready for `wrangler kv bulk put`.
   Values contain only the PBKDF2 **PIN hash**, never the cleartext PIN.
2. **`default-pins.csv`** — the cleartext one-time PIN for each member, for the admin to
   distribute. **This file is SENSITIVE** (see the security note below).

The script uses WebCrypto + Node stdlib only (no dependencies) and reproduces
`src/crypto.ts` legacy hash format exactly (PBKDF2-HMAC-SHA256, 100,000 iterations, 16-byte random
salt, `pbkdf2$sha256$<iters>$<saltB64url>$<hashB64url>`), so a provisioned member's default PIN
verifies against the live Worker's `verifyPin()`.

## Roster input format

A JSON array of members. Each entry needs `name` plus **at least one** of `pdgaNo` / `udisc`:

```json
[
  { "name": "Jane Doe",  "pdgaNo": "12345", "udisc": "JaneD" },
  { "name": "Marcus Lee", "pdgaNo": "67890" },
  { "name": "Priya Nair", "udisc": "PriyaThrows" }
]
```

See `roster.sample.json`. The `memberId` is derived deterministically:
`m_<pdga-digits>` when a PDGA# is present, otherwise `m_u_<udisc-lowercased>`. It is stable
across re-runs, so re-provisioning the same roster overwrites the same KV records.

## Run

```bash
node scripts/provision.mjs --roster roster.sample.json --out-dir ./out
```

Then load the records into KV (remote, or add `--local` for the dev KV):

```bash
wrangler kv bulk put ./out/kv-bulk.json --binding ROSTER
```

The script prints a summary: member count, the output paths, the KV entry count, and the
sensitivity warning.

## Reset one member's PIN

To regenerate a single member's default PIN (e.g. they lost it before first login), pass
`--reset` with their PDGA# or UDisc username. It re-emits only that member's KV record/indexes
and a one-row `default-pins.csv`:

```bash
node scripts/provision.mjs --reset 12345 --roster roster.sample.json --out-dir ./out
wrangler kv bulk put ./out/kv-bulk.json --binding ROSTER   # overwrites just that member
```

This sets `mustChangePin: true` again, so the member is forced to choose a new PIN at next login.

## How an admin distributes PINs + the forced-change flow

1. Run the provisioner and load `kv-bulk.json` into the `ROSTER` KV namespace.
2. From `default-pins.csv`, give each member their `defaultPIN` over a **secure, person-specific
   channel** (in person, or a 1:1 message — never a shared spreadsheet, email blast, or anything
   committed to git).
3. The member logs in at the portal with their PDGA# **or** UDisc username + that default PIN.
4. Because every provisioned record has `mustChangePin: true`, the Worker/site forces a PIN
   change on that first successful login before issuing a usable session. Setting the new PIN
   clears `mustChangePin` (handled by `setPin()` in `src/roster.ts`). The default PIN is now dead.
5. Once all PINs are handed out, **delete `default-pins.csv`**.

## Membership trust model — what actually proves a member

This portal uses **closed enrollment**: there is no self-signup. An account exists only if an admin
provisions it from the club roster, and first login requires the **admin-issued default PIN**. So
*"is this person a GVDG member?"* is answered by *the admin put them on the roster and handed them
their PIN*. The strength of that guarantee depends entirely on two things:

- **An accurate roster** — only provision real members.
- **Secure, 1:1 PIN delivery.** PDGA #s are **public** (pdga.com / the member directory), so the
  4-digit default PIN is the *only* secret protecting first login. Whoever logs in with it first
  "claims" the account by setting their own PIN (a pre-takeover risk). Therefore:
  - Hand each default PIN only to that specific member, over a channel only they control.
  - Never post PINs publicly, read them aloud, bulk-email them, or commit `default-pins.csv`.
  - Distribute close to when members will sign up, and `--reset` any PIN you suspect leaked.
  - Server-side lockout (5 tries / 15 min, `src/ratelimit.ts`) slows online guessing, but 4 digits
    is low entropy — **secure delivery is what carries the guarantee**.

Note: the profile step lets a member set their own PDGA #/UDisc; the Worker blocks claiming an
identifier already linked to another account, but does not independently prove they own that PDGA #
(a low-stakes vanity/data concern, not a membership one).

Stronger options that fit this model, if ever wanted: a one-time high-entropy setup code (+ expiry)
instead of the 4-digit default, a verified email/SMS setup link, or admin approval of each account.

## SECURITY — keep these out of git

The repo `.gitignore` already ignores `seed.local.json`. The provisioning outputs must be treated
**the same way** — do not commit them, and ignore them locally:

- `out/` (the default `--out-dir`)
- `default-pins.csv` — **cleartext one-time PINs**; the most sensitive artifact. Distribute over a
  secure channel and delete it once PINs are handed out.
- `kv-bulk.json` — contains only PIN **hashes** (not cleartext), but a 4-digit PIN hash is
  brute-forceable offline, so keep this private too. The real defenses are never leaking the KV
  roster and the Worker's server-side rate-limiting / lockout (`src/ratelimit.ts`).

> The repo's `auth-worker/.gitignore` already ignores `out/`, `default-pins.csv`, `kv-bulk.json`, and
> `seed-*.json`, so these provisioning outputs won't be committed by accident.

## PIN pepper (`PIN_PEPPER` secret) — do not lose it

PIN hashes are additionally protected by an HMAC **pepper** (a server-held secret, `PIN_PEPPER`), layered
under PBKDF2, so a leaked KV roster alone can't brute-force the 4-digit PINs offline (`src/crypto.ts`).

- **Shared dev:** a strong random value is set via `wrangler secret put PIN_PEPPER --env gvdgclub`.
  New/changed PINs are hashed as `pbkdf2h$…`; pre-pepper members' legacy `pbkdf2$…`
  hashes still verify (the pepper is ignored for them) and are transparently upgraded on their next login.
- **⚠️ Once set, `PIN_PEPPER` must never be lost or changed** — exactly like `JWT_SECRET`. Losing it locks
  out every member whose hash has been upgraded to `pbkdf2h`. Cloudflare stores it, but back the value up
  in the club's password manager for disaster recovery, and add it to the CI secret set if CI ever runs a
  secret-sync deploy.
- To activate a fresh env: `printf '%s' "<48+ random chars>" | wrangler secret put PIN_PEPPER --env <env>`.
  Rolling it (rare) requires re-hashing every member — avoid unless the secret is believed compromised.
