# Handoff — GVDG Club Site (full member platform)

**For: the `mostlysober252/gvdg-club-site` maintainer and any AI coding agents working in this repo.**

This document gets you from "I just received a big PR" to "it's running on my own infrastructure and I can build on top of it." Read it top to bottom once; then use the linked docs as reference.

---

## 1. What this PR delivers

The original repo was a **static marketing site**. The current handoff adds, on top of it, a complete
**member platform** — a Cloudflare Worker backend plus new/updated frontend pages and React route bundles.

Current handoff context:

- Upstream-compatible PR: `mostlysober252/gvdg-club-site#9`
- PR branch: `handoff/react-migration-upstream-compatible-2026-07-09`
- PR handoff commit: `7fa3580 chore: handoff current GVDG platform state`
- Source/deployed fork commit represented by that tree: `9655725`
- Upstream diff: 438 files changed, 97,768 insertions, 2,569 deletions
- New work since the previous full-platform handoff branch: 67 source commits, 234 files changed

The PR is a squash-style handoff because the fork history was scrubbed and no longer shares a common
ancestor with upstream. The PR branch is based on upstream `main`, then applies the current platform tree
as a normal comparable commit.

It supersedes the 7 earlier slice PRs (#1–#7) — everything in those, plus a great deal more (payments, pro shop, ratings, matchplay/Ryder Cup, tee-sign OCR, data archive, admin role management, an executable design system, and multiple security-audit passes) is included here in one coherent branch.

**Feature summary** (full detail in [`README.md`](README.md) → *Feature overview*, and [`USER-GUIDE.md`](USER-GUIDE.md) for end-user how-tos):

- **Member auth** — PDGA#/UDisc + PIN, forced first-login PIN change, passkeys/WebAuthn, JWT sessions, lockout, closed enrollment.
- **Club operations** — events with multiple course/layout assignments, courses, layouts (with a hole builder + distance estimation), leagues & standings, fundraisers, meeting minutes.
- **Registration & payments** — divisions, CTPs, ace pots, team/starting-hole assignment, check-in; PayPal (Orders v2 + `paypal.me` fallback) and a member store-credit **wallet**.
- **Live scoring** — a Durable Object + WebSocket engine with a consensus model; singles/doubles/match-play; casual rounds and event rounds; Ryder-Cup team coloring; offline/PWA support.
- **Pro shop** — products, PayPal/store-credit checkout, orders, wallet ledger.
- **Ratings** — a dashboard estimate + a full PDGA-SSA engine recomputed by a daily cron.
- **Integrations** — "Crotts" AI assistant (OpenRouter → Workers AI), tee-sign OCR (Gemini → OpenRouter → Workers AI), Open-Meteo weather, Resend email.
- **Admin panel** — 16 tabs including member management with **promote/demote admin** (last-admin-protected).

---

## 2. Read these first (doc map)

| Doc | Purpose | Who |
|---|---|---|
| **[README.md](README.md)** | Features, architecture, setup, testing, deploy, API reference, security model | everyone |
| **[USER-GUIDE.md](USER-GUIDE.md)** | How to use every feature, in plain language | end users / QA |
| **[CLAUDE.md](CLAUDE.md)** | **The architecture map** — request flow, split router, worker domain map, live-scoring consensus, data layer, security invariants, runtime gotchas | **AI agents: read FIRST** |
| **[AGENTS.md](AGENTS.md)** | The deploy coordination contract | anyone deploying |
| [DESIGN.md](DESIGN.md) | Design system (colour/type/components + `tokens.css`) | frontend |
| [CROTTS.md](CROTTS.md) | AI assistant setup & providers | integrations |
| [PAYMENTS.md](PAYMENTS.md) | PayPal enablement | payments |
| [auth-worker/PROVISIONING.md](auth-worker/PROVISIONING.md) | Seeding members, issuing PINs, the membership trust model | operators |
| `docs/superpowers/specs/` & `plans/` | Design specs + step-by-step implementation plans (incl. work not yet built — see §6) | AI agents |

---

## 3. How it's deployed today (and what that means for you)

There are **two environments** (see README → *Live sites & environments*):

- **Production:** `www.greenvillediscgolf.com` (GitHub Pages, pinned by `CNAME`) + `auth.greenvillediscgolf.com`. The production Worker is yours to stand up.
- **Shared dev:** `gvdgclub.com` + `auth.gvdgclub.com`. This is the shared live-test slot where the current code was developed and verified. Access, Cloudflare resource IDs, account details, and QA credentials are private operational details and are not documented in this repo.

**To take ownership, stand the platform up on your own Cloudflare account** (§4). Use the top-level
placeholder bindings in `auth-worker/wrangler.toml` as the production template. The checked-in
`[env.staging]` / `[env.gvdgclub]` blocks are for the shared dev slot and can be repointed or replaced for
your own environment.

---

## 4. Stand it up on your own Cloudflare account (from scratch)

All commands run from `auth-worker/` unless noted. Prereqs: Node.js, `npm i -g wrangler`, `wrangler login`.

**Step 1 — Create the Cloudflare resources.**
```bash
wrangler kv namespace create ROSTER          # members + PIN hashes + passkey creds + login indexes
wrangler kv namespace create RATELIMIT       # login lockout + one-time WebAuthn challenges
wrangler d1 create gvdg                       # club data (events, results, shop, wallet, ratings, …)
wrangler r2 bucket create gvdg-photos         # tee-sign images
```
Durable Objects (`LiveEventDO`), Workers AI (`AI`), and the `ASSISTANT_RL` unsafe rate-limit need no pre-creation — they're declared in `wrangler.toml`.

**Step 2 — Fill in `wrangler.toml`.** Replace the three placeholders with the IDs printed above:
```
id = "REPLACE_WITH_ROSTER_KV_ID"        # kv_namespaces binding = "ROSTER"
id = "REPLACE_WITH_RATELIMIT_KV_ID"     # kv_namespaces binding = "RATELIMIT"
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```
`validate-wrangler-config.mjs` runs before every deploy and **aborts on any remaining `REPLACE_WITH_*`**
in the targeted environment. The base top-level config is the owner-operated production template; the
named `staging` / `gvdgclub` envs are shared-dev targets.

**Step 3 — Set secrets** (never committed):
```bash
wrangler secret put JWT_SECRET            # REQUIRED — any string ≥ 32 chars; the Worker 500s without it
# optional (features fail soft if absent):
wrangler secret put OPENROUTER_API_KEY    # Crotts AI + OCR
wrangler secret put GEMINI_API_KEY        # tee-sign OCR (preferred provider)
wrangler secret put PAYPAL_CLIENT_ID      # PayPal checkout (both needed to enable)
wrangler secret put PAYPAL_SECRET
wrangler secret put RESEND_API_KEY        # order/registration emails
wrangler secret put PIN_PEPPER            # extra PIN-hash secret; if set, NEVER lose it
```

**Step 4 — Create the database schema.**
```bash
wrangler d1 migrations apply DB --remote   # applies migrations 0001–0025 (the 0007 gap is intentional)
```

**Step 5 — Seed members and hand out PINs.** See [auth-worker/PROVISIONING.md](auth-worker/PROVISIONING.md).
```bash
node scripts/provision.mjs --roster roster.json --out-dir ./out
# → out/kv-bulk.json (hashes only) + out/default-pins.csv (SENSITIVE — distribute 1:1, never commit)
wrangler kv bulk put out/kv-bulk.json --binding=ROSTER --remote
```
> The membership model is **closed enrollment**: there is no self-signup. Members exist only via `provision.mjs` or the admin "create member" endpoint; both force a PIN change on first login. Grant the first admin by setting `"isAdmin": true` on their roster record (or via the create-member form), then use the **Members → Make admin** UI for the rest.

**Step 6 — Deploy the Worker.**
```bash
npm run deploy            # validates config, then wrangler deploy
```

**Step 7 — Deploy the frontend + point it at your Worker.** The static pages are served as-is (GitHub Pages or Cloudflare Pages). Each page resolves its API base from a `data-auth-base` attribute (else by host). Set `data-auth-base` to your Worker URL, or rely on the host fallback, and make sure the Worker's `ALLOWED_ORIGINS` (a `[vars]` entry / `.dev.vars`) lists your site's exact origin — **CORS is an exact-match allowlist.**

**CI shortcut:** `.github/workflows/deploy-worker.yml` runs Worker typegen, audit, typecheck, tests, and
config validation on pushes to `main` touching `auth-worker/**`. If `CLOUDFLARE_API_TOKEN` is present and
the targeted config has no placeholders, it deploys and syncs the secrets listed in the workflow
(`JWT_SECRET`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`). Other optional
secrets such as Resend or `PIN_PEPPER` should be set directly in Cloudflare or added intentionally to the
workflow before relying on CI to sync them.

---

## 5. Local development, testing & the deploy contract

- **Local dev + testing:** see [README.md](README.md) → *Local development* and *Testing* (run `wrangler dev`, seed local KV/D1, serve the site, drive it). The Worker suite is `vitest` (from `auth-worker/`); frontend helpers are `node --test` (repo root).
- **Deploy safety:** shared-dev deploys use `scripts/gvdg-deploy.sh` with a forward-only freshness gate
  (see [AGENTS.md](AGENTS.md)). On your own infrastructure you can use `npm run deploy` / the CI workflow.
  If multiple agents will deploy to one shared environment, keep the AGENTS.md discipline: clean committed
  HEAD, one integration branch, forward-only deploys.
- **The one non-negotiable:** *nothing is "done" until it runs in the real app.* Unit tests and static review are necessary but not sufficient — stand up the Worker + served frontend and drive the changed flow. CLAUDE.md documents the exact live-verify recipes (they were used for every feature here).

---

## 6. For AI agents building on top of this

1. **Read [CLAUDE.md](CLAUDE.md) first** — it is the architecture map and encodes the security invariants and runtime gotchas. It also documents a CodeGraph index for structural code queries.
2. **Uphold the security invariants** (README → *Security model*): the fail-closed secret gate; CORS exact-match allowlist; `adminGate` as the only admin authority (server-side `isAdmin` from KV, never the JWT); anti-enumeration + lockout; closed enrollment; SSRF-guarded imports; parameterized SQL only; XSS-safe rendering (`createElement`/`textContent`, URL sanitizer).
3. **Live-verify** every user-facing change in the running app (§5). Subagents are static-only — they design/review but can't be the source of "does it work."
4. **Migrations are append-only and globally ordered** — next number is `0026`; never renumber or back-fill the intentional `0007` gap.
5. **The `docs/superpowers/specs/` and `plans/`** capture the design reasoning for each slice (including a full 6-lens design-hardening pass on the a11y foundation and a 3-lens security review of the admin role-toggle) — read the relevant spec before extending a feature.

---

## 7. Roadmap — what's designed but not yet built

These have written specs/plans ready to execute:

- **Accessibility kit — Batch 3.** Slice 1 is fully specced and hardened (spec: `docs/superpowers/specs/2026-07-05-batch3-slice1-a11y-foundation-design.md`): a shared `a11y.js` (`window.GVDGa11y`) providing an accessible-modal decorator (`inert`-based isolation) + a live-region announcer, migrating the 3 real modal surfaces + routing `score.html` toasts through the announcer + Crotts placement rules. **Slices 2 (tablist semantics, skip links, click-only cards → buttons) and 3 (form-label audit) are outlined but not specced in full.**
- **Admin-flag atomicity (hardening).** `setMemberAdmin` (and `setPin`/`updateProfile`) do a whole-record read-modify-write over non-atomic KV; a concurrent race can lost-update `pinVer`/`pinHash`. This is a **pre-existing systemic pattern**, not a regression — the fix is to decouple the admin flag to a separate `admin:<id>` KV key **or** serialize member-record mutations through a per-member Durable Object / CAS. Details in `docs/superpowers/specs/2026-07-05-admin-member-role-toggle-design.md` (*Known limitation*).
- **Payments reconciliation cron** — flag captures without an order, orders without a debit, cancelled-but-paid without a reversal.

---

## 8. Notes

- Much of this platform was built with AI coding agents (Claude Code) under human review; the `docs/superpowers/` specs and plans document the design decisions and adversarial reviews so the reasoning is auditable, not just the code.
- Secrets and sensitive artifacts (`.dev.vars`, `out/default-pins.csv`, `kv-bulk.json`) are git-ignored and were never committed. Verify your own secrets stay out of the tree.
- Questions about a specific subsystem: start at the CLAUDE.md *worker domain map* table, which maps each domain to its modules.
