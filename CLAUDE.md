# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Multi-agent repo. Read [AGENTS.md](AGENTS.md) before you deploy, branch, or run anything that
> touches the shared dev environment — it is the mandatory coordination protocol.** This file is the
> architecture map; AGENTS.md is the deploy contract.

## Deploy safety (the one rule that overrides everything)

`gvdgclub.com` is a **single shared dev environment** that many agent sessions deploy to. Every
`wrangler … deploy` is last-write-wins with no safety check — on 2026-07-03 one session clobbered
another by deploying a commit 19 behind `main`, silently reverting the site.

- **Never `wrangler pages deploy` / `wrangler deploy` by hand.** Deploy **only** through
  `./scripts/gvdg-deploy.sh` (machine-wide lock + freshness gate + `version.json` marker).
- **Forward-only:** the gate aborts unless your clean, committed `HEAD` *contains* the currently-live
  commit (`gvdgclub.com/version.json`). If it aborts, **reconcile with `origin/main`** — don't
  `GVDG_FORCE=1` past it without human sign-off.
- **`main` is the single integration branch** and the only line that should be live on gvdgclub. Merge
  diverged forks *into* main; never resolve divergence by deploying one branch over another.
- Check what's live: `./scripts/gvdg-deploy.sh --status` or `curl -s https://gvdgclub.com/version.json`.

Production `www.greenvillediscgolf.com` (GitHub Pages, pinned by the `CNAME` file) is **separate** and is
**not** touched by any dev-deploy command.

## What this is

The website for the **Greenville Disc Golf Club**. Two halves in one repo, deployed together:

1. **A static frontend** — root HTML shells plus page-owned helper files, with generated Vite/React route
   bundles for the home, public/events, admin, members, live-scoring, and tee-sign preview surfaces.
2. **A Cloudflare Worker** in `auth-worker/` (TypeScript, ~82 modules). The **only** server-side code:
   member auth, the club-operations API, live scoring, pro-shop, ratings, and the "Crotts" AI assistant.
   The static pages reach all dynamic data through it over HTTPS.

There is **no traditional backend or database server to boot** for the site itself — pages are static.

### Two environments (and the naming trap)

| | Static site | Worker (API) | Line |
|---|---|---|---|
| **Production** | `www.greenvillediscgolf.com` (GitHub Pages) | `auth.greenvillediscgolf.com` | separate, hands-off |
| **Shared dev** | `gvdgclub.com` — CF Pages project `gvdg-club-site`, branch `main` | `auth.gvdgclub.com` | what we deploy |

- ⚠️ The Worker named **`gvdg-member-auth-staging` IS the live dev Worker** — `auth.gvdgclub.com` is
  attached to it. `[env.staging]` and `[env.gvdgclub]` in `wrangler.toml` are **identical aliases to the
  same Worker**, sharing one D1 (`gvdg-staging`), KV, and R2. "Staging" and "gvdgclub" read the **same
  data**; there is no separate staging DB.
- The base `[name] = gvdg-member-auth` block is a **dead placeholder** (its Worker owned no domain and was
  deleted). A bare `wrangler deploy` (no `--env`) ships **nothing live** — always use `--env gvdgclub`.
- Cloudflare account owner/id are private operational details. Set `CLOUDFLARE_ACCOUNT_ID` locally or as a
  GitHub secret before Pages deploy/list commands.

## Commands

### Worker (`auth-worker/` — run from inside that directory)

```bash
cd auth-worker
npm test                              # vitest run — full unit/integration suite (static only)
npx vitest run test/live.test.ts      # one test file
npx vitest run -t "lockout"           # tests matching a name
npm run typecheck                     # tsc --noEmit
npm run typegen:check                 # wrangler types --check (CI gate; regen with `npm run typegen`)
npm run audit                         # npm audit --audit-level=moderate
npm run dev                           # wrangler dev (local Worker)
npm run migrate:staging               # wrangler d1 migrations apply DB --env staging --remote
npm run deploy:staging:dry-run        # validate config + wrangler deploy --dry-run
node scripts/provision.mjs --roster roster.json --out-dir ./out   # seed members (see PBKDF2 gotcha!)
```

### Static frontend tests (repo root — pure-helper tests, no DOM)

```bash
npm run build            # builds all generated Vite route bundles
npm test                 # node --test tests/*.test.mjs (events/ryder-cup/feed/safe-url/pwa/… parsers)
npm run qa:react         # react-doctor project scan; generated app bundles are ignored
npm run qa:site-smoke    # Playwright browser smoke for migrated route bundles
npm run qa:live-scoring  # Playwright live-scoring browser QA
npm run qa:staging-live-scoring  # live gvdgclub.com scoring E2E; needs private QA credentials
```

### Deploy (the ONLY sanctioned path — see AGENTS.md)

```bash
GVDG_AGENT=<name> ./scripts/gvdg-deploy.sh          # Pages + worker (also --pages-only / --worker-only)
./scripts/gvdg-deploy.sh --status                   # what's live vs your HEAD (read-only)
./scripts/gvdg-deploy.sh --dry-run                  # run every gate, deploy nothing
scripts/gvdg-deploy-watchdog.sh --status|--install  # systemd --user backstop that re-asserts origin/main
```

`gvdg-deploy.sh` runs `npm run qa:staging-live-scoring` after deploy when `GVDG_STAGING_QA_TOKEN` is set, or
when `GVDG_STAGING_QA_IDENTIFIER` + `GVDG_STAGING_QA_PIN` are set. The QA member must be an admin so the test
can cancel its temporary casual round. `GVDG_SKIP_STAGING_QA=1` skips only that post-deploy smoke.

`.github/workflows/deploy-worker.yml` (push to `main` touching `auth-worker/**`) only **tests** — its
deploy step is skipped while the top-level config holds `REPLACE_WITH_*` placeholders. The actual gvdgclub
deploy is `deploy-staging.yml` (manual `workflow_dispatch`) or `gvdg-deploy.sh`. **A push to main does not
auto-deploy.**

## Architecture

### Request flow

```
Browser (static page)
  │  resolves the API base through src/shared/api-base.js:
  │  explicit data-api-base/data-auth-base attr wins; else by host —
  │  localhost→:8788,  greenvillediscgolf.com→auth.greenvillediscgolf.com,  ELSE→auth.gvdgclub.com
  │  (deployed HTML ships data-*-base="" so the host fallback is what actually selects the Worker)
  ▼
Cloudflare Worker  auth-worker/src/index.ts   (default export { fetch, scheduled })
  ├─ KV  ROSTER      members (member:<id> = source of truth incl. pinHash) + idx:pdga/idx:udisc + wa:creds
  ├─ KV  RATELIMIT   login lockout + generic counters + one-time WebAuthn challenges (wa:chal:*)
  ├─ D1  DB          club data: events, courses/layouts, registration, results, board, pro-shop/wallet,
  │                  ratings, casual rounds  (gvdg-staging; all queries parameterized)
  ├─ DO  LIVE        LiveEventDO — live scorecard state + WebSocket; writes to D1 only on finalize
  ├─ R2  PHOTOS      tee-sign images (gvdg-photos-staging)
  └─ AI  + OpenRouter/Gemini  Crotts assistant + tee-sign OCR vision
  scheduled()  cron "17 8 * * *"  → daily ratings recompute (never on the fetch path)
```

### The split router (`src/index.ts` + `club-api.ts`)

Two-tier, no framework. `index.ts` `fetch()` runs a fixed pipeline — `withKvFallback` → resolve `origin`
→ CORS/OPTIONS → **fail-closed secret gate** → top-level `if`-chain (member/auth/webauthn/tee-sign/pdga)
→ `clubApi()` → 404, all wrapped in a `try/catch` that returns a **CORS-bearing** 413/500 (so the browser
sees the real error, not a CORS failure). `clubApi()` tries domain handlers in **fixed order, first
non-null Response wins**: `handleClubPublic → handleClubLive → handleCasualRoundRequests →
handleCasualRounds → handleClubShop → handleClubRegistration → handleClubAdmin`. Each self-guards on the
path `seg[]` shape and returns `null` to pass. **Dispatch is order-sensitive** — a new `/events/:id/…`
route can be shadowed by an earlier handler.

Three gate helpers in **`authz.ts`** (all authz is re-checked server-side):
- `requireAuth` — verify the Bearer JWT; **returns null if `mustChangePin`** (forced-change users are
  locked out of every gated route *except* `/me` and `/set-pin`, which call `verifySession` directly).
- `requireMember` — `requireAuth` → `{sub}` or 401.
- `adminGate` — `requireAuth` **plus** re-read the roster and require `member.isAdmin===true` (403).
  `isAdmin` is **never** trusted from the JWT; it comes from ROSTER KV on every request.

Route groups: **Public** (no auth): `POST /login`, `POST /assistant`, `POST /webauthn/auth/*`, `GET
/pdga-stats`, and public reads (`/events`, `/courses`, `/leagues`, results, live/round snapshots + `/ws`).
Several routes are **optional-auth** (guests via a `g_<token>`, members via JWT) — registration, shop,
`/courses/:id/tee-signs`. **Member-authed**: `/me`, `/set-pin`, `/profile`, `/my-*`, `/board*`, passkey
register, live score/card writes. **Admin-gated**: all `/admin/*` + event live-scoring lifecycle
(`start`/`finalize`).

### Worker domain map (`auth-worker/src/`)

| Domain | Key modules | Notes |
|---|---|---|
| Auth / authz | `index.ts`, `authz.ts`, `crypto.ts`, `jwt.ts`, `roster.ts`, `webauthn*.ts`, `ratelimit.ts`, `kv-rate-limit.ts` | PIN = PBKDF2-HMAC-SHA256 **100k** iters; JWT = HS256 via `jose`; passwordless passkeys via `@simplewebauthn/server` |
| HTTP core | `http.ts`, `input.ts`, `env.ts` | exact-match CORS, capped `readJson`, all request validation in `input.ts` |
| Club data (D1) | `db.ts` (barrel) → `db-events/-courses/-leagues/-registration/-results/-content/-export/-tee-signs/-event-awards`, `db-types.ts`, `d1kv.ts` | all SQL parameterized; `d1kv.ts` = D1-backed KV fallback |
| Admin surface | `club-admin-routes.ts` → `club-admin-{events,courses,layouts,members,imports,content,shop,tee-signs,export}.ts` | every handler behind `adminGate` |
| Registration | `club-registration-routes.ts`, `event-deadlines.ts`, `payments.ts` | guest + member; PayPal reserve-before-charge |
| Live scoring | `live.ts` (the DO) + `live-{state,scoring,snapshot,finalize,format,pairs,consensus,target-consensus,types}.ts`, `scoring.ts`, `matchplay-scoring.ts`, `score-breakdown.ts` | consensus model — see below |
| Courses / imports | `layouts.ts`, `distance.ts`, `assign.ts`, `imports.ts` + `imports/{fetch,csv,events,udisc}.ts`, `tee-sign-routes.ts` | SSRF-guarded imports; tee-signs → R2 |
| Pro-shop / wallet | `shop-db.ts`, `club-shop-routes.ts`, `club-admin-shop.ts`, `order-notify.ts`, `wallet-idempotency.ts` | wallet = append-only ledger |
| Ratings | `ratings.ts` (display), `rating-engine.ts` + `rating-store.ts` + `ratings-recompute*.ts` (PDGA SSA), `pdga.ts` | **two** distinct systems |
| Integrations | `assistant.ts`+`assistant-route.ts`, `vision.ts`, `photos.ts`, `weather.ts`, `feeds.ts`, `register-notify.ts` | AI, OCR, weather, email, Google-Sheet feeds |

### Live scoring & the consensus model (`live.ts`)

One Durable Object class `LiveEventDO` serves both **event** live-scoring (`idFromName("event:"+id)`) and
**casual rounds** (`idFromName("round:"+CODE)`). State (`meta` + `players`) lives **in DO storage, not
D1**, until finalize; `meta.rev` bumps once per mutation and drives client re-render; `/ws` is a
hibernatable WebSocket that broadcasts a snapshot on every change. On finalize (`live-finalize.ts`),
standings are written to D1 (`results` for events, `casual_rounds`/`casual_results` for casual) and
`meta.status` rolls back to `live` if any persist throws.

- **Consensus:** every hole score is a *map of votes* keyed by scorer. The official `scores[hole]` is
  **derived** — set only when active scorers agree; disagreement blanks the hole and blocks finalize.
  Departed scorers' stale votes self-heal (only currently-carded scorers count). **Never write
  `scores[hole]` directly** — go through `recordScoreTargetVote`. Doubles share one vote across the pair.
- **DO auth:** the DO trusts **only** the Worker-injected `X-Auth-Member` / `X-Auth-Admin` headers, never
  the request body. A member may only score their **own card** (`cardId` is the authz boundary); admins
  score anyone. Event `start`/`finalize` are admin-gated at the Worker; casual finalize is any cardmate,
  force-past-conflict is admin-only.
- **Removal tombstones, never splices** — the array index *is* the scorer/target key, so splicing would
  silently re-point later scores.
- **Casual-round *requests*** (`casual-round-requests.ts`, tables from `0014`) are a separate RSVP/planning
  board and are **not** wired to start a live round — don't assume joining one creates a round.

### Data layer & migrations

All D1 access is **parameterized** (`.bind()` with `?`); the only dynamic SQL is IN-clause placeholder
lists and SET/table fragments built from **hardcoded** column literals — never request data. Raw
`.prepare()` also lives outside `db*.ts` (e.g. `shop-db.ts`, `ratings*.ts`, `wallet-idempotency.ts`) —
keep any new one parameterized.

`auth-worker/migrations/NNNN_*.sql` are **append-only and globally ordered**. Highest is **`0025`; next is
`0026`**. The **`0007` gap is intentional** — never back-fill it. Two branches must not claim the same
number. Domains: core courses/events/results (`0001-0003`), board (`0004`), registration/ctps/ace-pots
(`0005-0006`), tee-signs (`0008`), pro-shop + wallet (`0009`, `0012`, `0017`, `0023`), KV fallback
(`0010`), PDGA cache (`0011`), guest reg (`0013`), casual-round requests/rounds (`0014`, `0016`), UDisc
export (`0015`), live-scoring metadata (`0018`), scale indexes (`0019-0020`), export endpoints (`0021`),
ratings (`0022`), event schedule/deadlines (`0024`), event course/layout assignments (`0025`).

`events.course_id` / `events.layout_id` remain the primary legacy/scoring fields, but multi-course events
must also be represented in `event_courses` (migration `0025`). Admin create/edit payloads may include
`event_courses: [{ course_id, layout_id?, label?, sort_order? }]`; public event models attach those rows
and summarize each course/layout from the structured table. Do not encode multi-course tournaments only in
freeform notes.

### Feature domains

- **Pro-shop / wallet** — the member wallet is an **append-only ledger** (`wallet_transactions`; balance
  is `SUM(amount_cents)`, no balance column). The debit is **atomic + idempotent** in one
  `INSERT…SELECT…WHERE SUM+amount>=0` (`wallet-idempotency.ts`) so concurrent debits can't overdraw.
  Three checkout paths: `paypal.me` redirect (manual reconcile, no stock decrement), PayPal Orders v2
  auto-capture, and store-credit debit; only the latter two decrement stock and email.
- **PayPal** (`payments.ts`) — server-trust: amount always priced server-side, capture trusted only when
  `order.status==COMPLETED && capture.status==COMPLETED && USD && amount>=owed`; registration reserves the
  slot *before* charging and releases on failure.
- **Ratings — two systems that can disagree:** `ratings.ts` is a simple display estimate (base 900) for
  the member dashboard; the leaderboard/`round_ratings` use the real **PDGA SSA engine** (`rating-engine.ts`,
  base 1000, iterative propagator drop) written at finalize and re-solved by the daily cron. Don't conflate.
- **Crotts assistant** (`/assistant`) — provider chain **OpenRouter → Workers AI → dev stub**, prompt built
  with club calendar + courses. **Tee-sign OCR vision** (`vision.ts`) — chain **Gemini → OpenRouter →
  Workers AI → empty**; output is a *suggestion* an admin confirms.
- **Weather** — Open-Meteo (no key), polled by the DO alarm; also feeds the rating engine (wind gust adds
  SSA strokes). **Email** — Resend, best-effort (`waitUntil`), senders on the verified `gvdgclub.com` domain.
- **Feature-gating is by credential presence, at runtime, and fails *soft*:** PayPal auto-checkout needs
  both `PAYPAL_CLIENT_ID`+`PAYPAL_SECRET` (else 503 → manual flag); Crotts/vision degrade down their chains;
  email is a no-op without `RESEND_API_KEY`. A missing credential looks like "nothing happened," not an error.

### Ryder Cup / matchplay leagues

Matchplay league scoring is **team-based Ryder Cup style**, not stroke place-points:

- **Points (`scoring.ts`):** a match is worth **2 to the winner / 1 to each side on a tie / 0 to the loser**,
  by `match_result.outcome`. `computeLeagueStandings` is the per-player view; `computeTeamStandings` is the
  Red-vs-Blue team view, counting each match **once per `(event_id, team)`** so a doubles match's several
  result rows don't double-count; `computeRoundWinners` gives each round's winning side. `GET /leagues/:id`
  returns `standings` + `teamStandings` + `roundWinners`; `GET /leagues/active` (member dashboards) returns
  active leagues (a live or last-60-day round) + live events.
- **Winner coloring (`src/shared/matchplay-colors.js` — pure, node-tested `tests/matchplay-colors.test.mjs`):**
  `holeWinners()` decides each hole by comparing the two teams' scores (doubles alt-shot = the pair's shared
  score; equal = tie; unscored = `null` → uncolored). Colors: Red `#dc3545`, Blue `#2f6fd0`, tie `#e6b400`.
  Applied to the scoring app (current hole's tee sign; halves left **as-is**), the event scoreboard + round-
  results tee signs (halves = **yellow**), and the league rounds list (round winner). App bundles import the
  shared module directly; there is no root `matchplay-colors.js` compatibility shim.
- **Ryder Cup data (league_id 4):** Red = *Juan Team*, Blue = *Jesus Team*. The season was **backfilled from
  the `ryder-cup.html` Google Sheet** — winners are read from the **rendered green-highlighted page** (the CSV
  drops the highlight), imported as one event per match with `source='ryder-import'` (idempotent: re-import
  DELETEs by that source, event 6 is `source='manual'`). ⚠️ **Event 6 (the app-scored alt-shot round) IS the
  sheet's Week 3 #5** — skip it in any re-import to avoid a duplicate. Non-member sheet players are recorded
  name-only (`member_id` null); linking them to member accounts is a manual admin step.

### Frontend & PWA

Pages find the API via the shared `src/shared/api-base.js` host-fallback helper. Data
rendering is **XSS-safe by construction**: live/API data is built with `createElement`/`textContent`,
**never `innerHTML`**; external hrefs pass the pure `src/shared/safe-url.js` helper; tee-sign SVG is parsed inert via `DOMParser`.
(The one `innerHTML`-with-data is `gvdg-members.html`'s doubles league, whose source is build-time-trusted
`DOUBLES_DATA_EMBEDDED` JSON, still run through `escHtml()`.) **Legacy Google-Sheet published-CSV rails**
still power the homepage feeds and Ryder Cup (gviz has no CORS → the sheet must be publish-to-web;
overridable via `data-grid-csv`/`data-scoreboard-csv`). `score.html` is a thin shell mounted by
`src/score-app/main.js`; run `npm run build` before serving or deploying it. The **service worker**
(`sw.js`) is **manually versioned** — bump it on any precached-asset change or
users get stale route bundles such as `admin-app/admin-app.js`, `score.html`, or `score-app/score-app.js`; offline navigation falls back
to `gvdg-members.html`.

## Security & correctness invariants (uphold in any change)

- **Fail-closed secret gate:** the Worker 500s before any routing unless `JWT_SECRET` is a string ≥32
  chars. Thread `origin` into every early return so error responses keep CORS headers.
- **CORS is an exact-match allowlist** over `ALLOWED_ORIGINS` — no wildcard/subdomain matching.
- **`adminGate` is the only admin authority** (server-side `isAdmin` from ROSTER, not the JWT).
- **Anti-enumeration:** unknown login identifiers still run a real PBKDF2 against `DUMMY_HASH`; lockout is
  keyed by `canonicalLoginKey()` (normalizes PDGA/UDisc) so mutating the raw identifier can't reset it.
- **Closed enrollment:** no self-signup route. Members come only from `provision.mjs` bulk-seed or
  admin-gated `POST /admin/members`; both set `mustChangePin:true`.
- **WebAuthn challenges are single-use** (read-and-delete); advance the stored credential counter each auth.
- **Imports go through `safeFetch`** with a per-kind host allowlist (https-only, reject userinfo /
  IP-literal / IPv6, `redirect:manual` re-validating every hop, byte/time caps). ⚠️ There is **no
  private-CIDR filter** — SSRF safety rests entirely on the fixed public-host allowlist; never add an
  attacker-controllable host.
- **Verified (tee-sign) par/distance is server-authoritative and sticky** — clients can't forge it.
- **Tee-sign R2 blobs** are reclaimed on reject/delete/demote; rejected images 404 (no IDOR enumeration).

## Runtime gotchas (fail live, invisible to unit tests)

Per the parent `CLAUDE.md`, **nothing is "done" until it runs in the real app.** These bite at runtime only:

- **PBKDF2 is capped at 100k by workerd — it *throws* above it.** `crypto.ts` and
  `scripts/provision.mjs` both use `ITERATIONS=100_000`. Do not raise this in either place; bulk-seeded
  members would fail `verifyPin` on the deployed Worker.
- **Session TTL is 12h, not 900s** — `SESSION_TTL_SEC=43200` in `wrangler.toml`; the 900 in `authz.ts` is
  only the unset fallback.
- **`-staging` is production:** deploy the Worker with `--env gvdgclub`; a bare `wrangler deploy` ships to
  the deleted base Worker. `env.staging`/`env.gvdgclub` share one DB/KV/R2 — there is no isolated staging.
- **`kvRateLimited` is a non-atomic GET-then-PUT** (backs login/board/setpin/webauthn) — a concurrent burst
  can slip past. Only `/assistant` uses the atomic `ASSISTANT_RL` binding, and only on the deployed Worker.
- `asIsoTimestamp` **rejects zone-less `YYYY-MM-DDTHH:MM`** (Worker runs UTC) → deadline PATCHes silently 400.
- **UDisc/PDGA importers are brittle scrapers** — a markup change degrades to name-only / blank rather than
  erroring; `safeFetch` sends a real-browser UA on purpose (removing it breaks imports).
- **CF Pages caches JS/CSS ~4h**; `_headers` (`must-revalidate`) is required or code changes look "not
  deployed" until the browser cache expires.

## Config & secrets (`auth-worker/wrangler.toml`)

Bindings (per env — Wrangler does **not** inherit top-level into named envs, so each block redeclares):
`ROSTER`+`RATELIMIT` (KV), `DB` (D1 `gvdg-staging`), `PHOTOS` (R2), `AI` (Workers AI), `LIVE` (Durable
Object `LiveEventDO`), `ASSISTANT_RL` (unsafe ratelimit, 20/60s), `[triggers] crons=["17 8 * * *"]`.
`[vars]` per env: `ALLOWED_ORIGINS`, `SESSION_TTL_SEC`, model ids, `PAYPAL_ENV`, WebAuthn `RP_ID`/
`EXPECTED_ORIGIN` (dev `gvdgclub.com` vs prod `greenvillediscgolf.com`), Resend senders. **Secrets** (never
committed, set via `wrangler secret put` / synced by CI): `JWT_SECRET`, `OPENROUTER_API_KEY`,
`GEMINI_API_KEY`, `PAYPAL_CLIENT_ID`/`PAYPAL_SECRET`, `RESEND_API_KEY`, `PIN_PEPPER`.
`validate-wrangler-config.mjs`
gates every deploy, aborting on any `REPLACE_WITH_*` in the targeted env.
