# Greenville Disc Golf Club — Website & Member Platform

The official website and member platform for the **Greenville Disc Golf Club** (Greenville, North Carolina).

It is two things in one repository, deployed together:

1. **A static frontend** — hand-written HTML shells at the repo root, with Vite/React bundles for the home, public/events, admin, members, live-scoring, and tee-sign preview surfaces.
2. **A Cloudflare Worker** (`auth-worker/`, TypeScript) — the only server-side code. It handles member authentication, the club-operations API, live scoring, the pro shop, ratings, and the "Crotts" AI assistant. Every dynamic thing the pages show comes from this Worker over HTTPS.

There is **no traditional backend or database server to boot** for the site itself — the pages are static files, and all data flows through the Worker.

> **New here and just want to _use_ the site?** Read **[USER-GUIDE.md](USER-GUIDE.md)** — it explains how to do every single thing on the site in plain, simple language.

---

## Table of contents

- [Live sites & environments](#live-sites--environments)
- [Feature overview](#feature-overview)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Configuration & secrets](#configuration--secrets)
- [API reference](#api-reference)
- [Security model](#security-model)
- [Further documentation](#further-documentation)

---

## Live sites & environments

There are **two separate environments**, and it is important not to confuse them:

| | Static site | Worker (API) | Notes |
|---|---|---|---|
| **Production** | `www.greenvillediscgolf.com` (GitHub Pages) | `auth.greenvillediscgolf.com` | The public club site. Hands-off; **not** touched by any dev-deploy command. Pinned by the `CNAME` file. |
| **Shared dev** | `gvdgclub.com` (Cloudflare Pages project `gvdg-club-site`, branch `main`) | `auth.gvdgclub.com` | The single shared live-test slot for active development. Deployed via `./scripts/gvdg-deploy.sh`. |

The Cloudflare Worker for the dev environment is named `gvdg-member-auth-staging` — despite the "staging" name, **it is the live dev Worker** attached to `auth.gvdgclub.com`. The `staging` and `gvdgclub` config environments are aliases to the same Worker and share one D1 database, KV, and R2 bucket.

The frontend picks its API base automatically through `src/shared/api-base.js`: an explicit `data-api-base` / `data-auth-base` attribute wins; otherwise it resolves by host (`greenvillediscgolf.com → auth.greenvillediscgolf.com`, everything else → `auth.gvdgclub.com`, `localhost → :8788`).

---

## Feature overview

### Public (no login required)
- **Home page** (`index.html`) — club identity, upcoming tournaments (auto-loaded from a published Google Sheet CSV and Disc Golf Scene), a course browser with a details modal (UDisc, directions, course-preview video), membership call-to-action, and contact info.
- **Events hub** (`events.html`) — live / upcoming / past events, event detail pages (roster, multi-course / multi-layout venue summaries, live-scoring banner, results, CTPs, ace pots), leagues & standings.
- **Ryder Cup** (`ryder-cup.html`) — Red vs. Blue team match-play standings and weekly results.
- **Blog** (`gvdg-blog.html`) and **Results archive** (`archive.html`).
- **Crotts** — a floating AI assistant (named after club officer Max Crotts) available on public pages, grounded in the club's live calendar and courses.
- **Live leaderboards** — anyone can watch a round's leaderboard update in real time over WebSocket.

### Members (PDGA # or UDisc username + PIN)
- **Login** with PDGA number **or** UDisc username + a 4-digit PIN; **forced PIN change** on first login; optional **passkeys / WebAuthn** for passwordless login afterward.
- **Member dashboard** (`gvdg-members.html`) with tabs: **Overview**, **Events** (register), **Board** (message board), **Tee Signs**, **Club**.
- **Player profile** — add/confirm PDGA #, UDisc handle, and a profile photo (auto-pulled from PDGA or uploaded).
- **Ratings & stats** — a personal rating estimate plus tournament history.
- **Event registration** — register/withdraw, choose a division, add CTP / ace-pot entries, check in.
- **Payments** — pay entry fees via **PayPal** (when enabled) or a manual "pay at the event" flow; spend **store credit** from the member wallet.
- **Message board** — members-only posts with threaded replies.
- **Tee signs** — submit a photo of a course tee sign; OCR suggests hole data for an admin to confirm.
- **Pro shop** (`pro-shop.html`) — browse products, buy with PayPal or store credit; a **member wallet** (append-only store-credit ledger).

### Live scoring (`score.html`)
- **UDisc-style live scoring** for **events** and **casual rounds**, on one or many scorecards.
- **Any cardmate keeps score**; members may only score **their own card**; admins can score anyone.
- **Consensus scoring** — a hole's official score is set only when the active scorers agree; disagreement blanks the hole and blocks finishing until resolved.
- **Singles, doubles, and match-play** formats; **Ryder-Cup-style match-play** coloring of holes/rounds by winning team.
- Real-time leaderboard, share links, add guests, manage the card, and finalize the round.

### Admin / club operations (`admin.html`, 16 tabs)
**Events**, **New Event** (including multiple course/layout assignments), **Import** (Disc Golf Scene / CSV / UDisc), **Registration** (fees, divisions, CTPs, ace pots, team & starting-hole assignment, roster & check-in), **Live Scoring**, **Courses**, **Layouts** (with a "SAFARI" hole builder + distance estimation), **Tee Signs** (review/approve OCR suggestions), **Leagues**, **Fundraisers**, **Meetings** (minutes), **Pro Shop** (products), **Orders**, **Wallets** (credit members), **Members** (create members, issue/reset PINs, **promote/demote admins**), and **Data archive** (export).

### Integrations
- **Crotts AI** — provider chain OpenRouter → Cloudflare Workers AI → dev stub.
- **Tee-sign OCR (vision)** — Gemini → OpenRouter → Workers AI.
- **Weather** — Open-Meteo (feeds both the app and the rating engine).
- **Email** — Resend (order/registration notifications), best-effort.
- **PayPal** — Orders v2 auto-capture + `paypal.me` fallback.
- **Ratings** — two distinct systems: a simple dashboard estimate and a full PDGA-SSA engine recomputed by a daily cron.

---

## Architecture

### Request flow

```
Browser (static page)
  │  resolves the API base through src/shared/api-base.js
  │  (data-*-base attribute, else by host)
  ▼
Cloudflare Worker  auth-worker/src/index.ts   (default export { fetch, scheduled })
  ├─ KV  ROSTER      members (source of truth incl. PIN hashes) + login indexes + passkey creds
  ├─ KV  RATELIMIT   login lockout + counters + one-time WebAuthn challenges
  ├─ D1  DB          club data: events, courses/layouts, registration, results, board,
  │                  pro-shop/wallet, ratings, casual rounds  (all queries parameterized)
  ├─ DO  LIVE        LiveEventDO — live scorecard state + WebSocket; writes to D1 only on finalize
  ├─ R2  PHOTOS      tee-sign images
  └─ AI  + OpenRouter/Gemini  Crotts assistant + tee-sign OCR
  scheduled()  cron "17 8 * * *"  → daily ratings recompute (never on the request path)
```

### The split router

Two-tier, no framework. `src/index.ts` `fetch()` runs a fixed pipeline: resolve `origin` → CORS/OPTIONS → a **fail-closed secret gate** (500 before any routing unless `JWT_SECRET` is ≥32 chars) → a top-level `if`-chain for member/auth/webauthn/tee-sign/pdga routes → `clubApi()` → 404, all wrapped in a `try/catch` that returns **CORS-bearing** error responses.

`clubApi()` (in `club-api.ts`) tries domain handlers in a **fixed order, first non-null response wins**: `handleClubPublic → handleClubLive → handleCasualRoundRequests → handleCasualRounds → handleClubShop → handleClubRegistration → handleClubAdmin`. Each self-guards on the request path shape and returns `null` to pass. Dispatch is order-sensitive.

Three authorization gates live in `authz.ts`, and **all authorization is re-checked server-side**:
- `requireAuth` — verifies the Bearer JWT (returns null if the member still must change their PIN).
- `requireMember` — `requireAuth` → member id, or 401.
- `adminGate` — `requireAuth` **plus** a fresh roster read requiring `member.isAdmin === true`. `isAdmin` is **never** trusted from the JWT; it is read from KV on every request.

### Live scoring & the consensus model

One Durable Object class, `LiveEventDO`, serves both event live-scoring and casual rounds. State lives in Durable Object storage (not D1) until finalize; a hibernatable WebSocket broadcasts a fresh snapshot on every change. Each hole score is a **map of votes keyed by scorer**; the official score is **derived** only when active scorers agree. On finalize, standings are written to D1 (and rolled back if any persist step throws). The Durable Object trusts only the Worker-injected `X-Auth-Member` / `X-Auth-Admin` headers — never the request body.

### Data layer

All D1 access is **parameterized** (`.bind()` with `?`). Migrations in `auth-worker/migrations/NNNN_*.sql` are **append-only and globally ordered** (`0001`–`0025`; the `0007` gap is intentional and must not be back-filled). `0025_event_courses.sql` is the structured multi-course / multi-layout event assignment table.

---

## Tech stack

- **Frontend:** hand-written HTML5 shells + CSS custom-property design tokens (`tokens.css`), Vite/React bundles for the public, admin, members, live-scoring, tee-sign preview, and home app surfaces, a service worker (`sw.js`, manually versioned) + PWA manifest.
- **Backend:** Cloudflare Workers (TypeScript), Workers KV, D1 (SQLite), Durable Objects, R2, Workers AI. Auth via PBKDF2-HMAC-SHA256 PIN hashing + HS256 JWT (`jose`) + passkeys (`@simplewebauthn/server`).
- **Tooling:** `wrangler`, `vitest` (Worker tests), `node --test` (frontend helper tests), `playwright` (browser QA), `tsc` (typecheck).

---

## Repository layout

```
/                         static frontend (served as-is)
  index.html              home page
  gvdg-members.html       member dashboard + directory + login
  admin.html              admin control panel (16 tabs)
  events.html             public events hub + detail
  score.html              live scoring HTML shell
  src/score-app/          React shell + live-scoring app entry
  vite.score.config.mjs   Vite build for the generated score-app/ bundle
  score-app/              generated score bundle (created by npm run build, git-ignored)
  pro-shop.html           pro shop + member wallet
  ryder-cup.html          Ryder Cup standings
  gvdg-blog.html          blog
  archive.html            results archive
  src/*-app/              React app entries for migrated page regions
  *-app/                  generated route bundles (created by npm run build; checked in where needed for static hosting)
  *.js                    small static helpers that remain page-owned (pwa.js, ryder-cup.js, ...)
  tokens.css              design tokens (single source of colour truth)
  sw.js                   service worker (manually versioned cache)
  site.webmanifest        PWA manifest

auth-worker/              the Cloudflare Worker (server-side)
  src/                    ~82 TypeScript modules (index.ts, authz.ts, live.ts, db*.ts, club-*.ts, …)
  migrations/             append-only D1 migrations (0001–0025; 0007 gap is intentional)
  test/                   vitest suites
  scripts/                provision.mjs, dev-seed.mjs, validate-wrangler-config.mjs
  wrangler.toml           bindings, environments, vars

scripts/                  gvdg-deploy.sh (the ONLY sanctioned deploy path) + watchdog
tests/                    frontend helper tests (node --test)
docs/                     design specs & implementation plans
```

Key docs: **[CLAUDE.md](CLAUDE.md)** (architecture map), **[AGENTS.md](AGENTS.md)** (deploy contract), **[DESIGN.md](DESIGN.md)** (design system), **[CROTTS.md](CROTTS.md)** (AI assistant setup), **[PAYMENTS.md](PAYMENTS.md)** (PayPal), **[STAGING.md](STAGING.md)**, `auth-worker/PROVISIONING.md` (member seeding).

---

## Local development

**Prerequisites:** Node.js 22+, and `wrangler` (`npm i -g wrangler`). Run the root build before serving the local frontend.

### 1. Install root frontend/tooling dependencies
```bash
npm install
```

### 2. Install Worker dependencies
```bash
cd auth-worker
npm install
```

### 3. Provide local secrets & vars
Create `auth-worker/.dev.vars` (git-ignored) with at least:
```
JWT_SECRET=<any string ≥ 32 characters>
ALLOWED_ORIGINS=http://127.0.0.1:8080,http://localhost:8080
SESSION_TTL_SEC=43200
```
CORS is an **exact-match allowlist**, so the origin you serve the site from must be listed.

### 4. Run the Worker (local)
```bash
cd auth-worker
npm run dev            # wrangler dev — local KV / D1 / R2 / DO on http://127.0.0.1:8788
```

### 5. Seed local data
Apply migrations and seed a member into local KV:
```bash
# D1 schema (from auth-worker/)
for f in migrations/*.sql; do wrangler d1 execute DB --local --file="$f"; done

# a member (PIN hashing matches the Worker) — generates KV bulk-put JSON
node scripts/dev-seed.mjs 12345 JaneD 4821 "Jane Doe" > seed.local.json
wrangler kv bulk put seed.local.json --binding=ROSTER --local
```
> Note: the roster is in **KV** (`member:<id>`), not D1. `dev-seed.mjs` creates a member with `mustChangePin: true`; edit the generated JSON to add `"isAdmin": true` / `"mustChangePin": false` if you need an admin who skips the forced PIN change.

### 6. Build and serve the static site
```bash
# from the repo root
npm run build
python3 -m http.server 8080 --bind 127.0.0.1
```
Open `http://127.0.0.1:8080/` — the pages auto-resolve the API to `http://127.0.0.1:8788`.

> **Stopping dev servers:** kill by port PID — `ss -ltnpH 'sport=:8788'` then `kill <pid>`. **Never** `pkill -f wrangler` (it can match your own shell).

---

## Testing

```bash
# Worker (from auth-worker/)
npm test                      # vitest — full unit/integration suite
npx vitest run test/live.test.ts   # a single file
npm run typecheck             # tsc --noEmit
npm run audit                 # npm audit --audit-level=moderate

# Frontend helpers (from repo root)
npm run build                 # builds all generated Vite route bundles
npm test                      # node --test tests/*.test.mjs
npm run qa:react              # react-doctor project scan; generated app bundles are ignored
npm run qa:site-smoke         # Playwright browser smoke for migrated route bundles
npm run qa:live-scoring       # Playwright live-scoring browser QA
npm run qa:members-dashboard  # Playwright member-dashboard browser QA
npm run qa:staging-live-scoring  # live gvdgclub.com scoring E2E; requires QA credentials
npm run qa:staging-member-dashboard # live gvdgclub.com member dashboard E2E; requires QA credentials
```

**Live verification is required for anything user-facing:** unit tests and static review are necessary but not sufficient. Stand up the Worker + served frontend and drive the actual flow before calling a change done.

---

## Deployment

> **Deploy safety is the one rule that overrides everything.** `gvdgclub.com` is a **single shared dev environment** that multiple contributors deploy to; every raw `wrangler deploy` is last-write-wins.

- **Deploy only through** `./scripts/gvdg-deploy.sh` — it takes a machine-wide lock, runs a **forward-only freshness gate** (aborts unless your committed `HEAD` contains the currently-live commit), runs the test/typecheck/config gates, deploys Pages + Worker, and stamps `version.json`.
- **`main` is the single integration branch** and the only line that should be live on `gvdgclub.com`.
- A **plain push to `main` does not auto-deploy.**

```bash
GVDG_AGENT=<your-name> ./scripts/gvdg-deploy.sh    # full deploy (also --pages-only / --worker-only)
./scripts/gvdg-deploy.sh --status                  # what's live vs your HEAD (read-only)
./scripts/gvdg-deploy.sh --dry-run                 # run every gate, deploy nothing
curl -s https://gvdgclub.com/version.json          # check what's live
```

The deploy wrapper runs the live scoring staging E2E after deploy when a private QA credential is configured:
set `GVDG_STAGING_QA_TOKEN`, or set `GVDG_STAGING_QA_IDENTIFIER` plus `GVDG_STAGING_QA_PIN`. The QA member must
be an admin so the test can cancel the temporary round it creates. Use `GVDG_SKIP_STAGING_QA=1` only when the
staging QA account is unavailable and the rest of the deploy gate still needs to run.

Production (`www.greenvillediscgolf.com`, GitHub Pages, pinned by `CNAME`) is **separate** and is not touched by any dev-deploy command.

---

## Configuration & secrets

Worker bindings (per environment in `auth-worker/wrangler.toml`): `ROSTER` + `RATELIMIT` (KV), `DB` (D1), `PHOTOS` (R2), `AI` (Workers AI), `LIVE` (Durable Object `LiveEventDO`), `ASSISTANT_RL` (unsafe rate-limit), and a daily cron trigger.

**Secrets** (never committed; set via `wrangler secret put` or synced by CI):
`JWT_SECRET`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET`, `RESEND_API_KEY`, `PIN_PEPPER`.

**Feature-gating is by credential presence and fails _soft_:** PayPal auto-checkout needs both PayPal secrets (else it falls back to the manual "paid" flag); Crotts and OCR degrade down their provider chains; email is a no-op without `RESEND_API_KEY`. A missing credential looks like "nothing happened," not an error.

`validate-wrangler-config.mjs` gates every deploy and aborts on any `REPLACE_WITH_*` placeholder in the targeted environment.

---

## API reference

All authorization is re-checked server-side. Base URL is the Worker (`auth.gvdgclub.com` / `auth.greenvillediscgolf.com` / `http://127.0.0.1:8788`).

### Public (no auth)
`POST /login` · `POST /assistant` · `POST /webauthn/auth/{options,verify}` · `GET /pdga-stats` · `GET /courses` · `GET /leagues[/:id]` · `GET /events[/:id]` · `GET /events/:id/{results,ctps,ace-pot}` · `GET /fundraisers[/:id]` · `GET /meetings[/:id]` · `GET /registration/open` · `GET /payments/config` · live snapshots + `/ws`.

### Member-authenticated (Bearer JWT)
`GET /me` · `POST /set-pin` · `POST /profile` · `GET /my-results` · `GET /my-ratings` · `GET /my-live-rounds` · `GET /my-registrations` · `GET|POST /board[/…]` · `POST /webauthn/register/{options,verify}` · `POST /tee-signs` · `GET /my-tee-signs` · live score/card writes (own card only).

### Registration & shop (member, some guest-optional)
`GET /events/:id/registration` · `POST /events/:id/{register,checkin}` · `POST /events/:id/pay/{create-order,capture}` · `GET /shop/products` · `POST /shop/pay/{create-order,capture}` · `GET /shop/wallet` · `GET /shop/orders`.

### Admin-gated and admin-only
`/admin/events`, `/admin/courses`, `/admin/layouts`, `/admin/leagues`, `/admin/fundraisers`, `/admin/meetings`, `/admin/import`, `/admin/tee-signs`, `/admin/shop`, `/admin/wallets`, `/admin/orders`, `/admin/export`, and **`/admin/members`** (list / create / `reset-pin` / **`set-role`** — promote/demote admins, with last-admin protection) + event live-scoring lifecycle (`start` / `finalize`) and admin-only casual round cancel (`POST /rounds/:code/cancel`).

---

## Security model

- **Fail-closed secret gate** — the Worker 500s before routing unless `JWT_SECRET` is ≥32 chars; `origin` is threaded into every early return so errors keep CORS headers.
- **CORS is an exact-match allowlist** (no wildcard/subdomain matching).
- **`adminGate` is the only admin authority** — server-side `isAdmin` from KV, never the JWT.
- **Anti-enumeration** — unknown login identifiers still run a real PBKDF2 against a dummy hash; lockout is keyed by a canonicalized identifier.
- **Closed enrollment** — no self-signup; members come only from `provision.mjs` bulk-seed or the admin-gated create endpoint, both forcing a PIN change.
- **WebAuthn challenges are single-use**; the stored credential counter advances each authentication.
- **Imports are SSRF-guarded** — an https-only, public-host allowlist with redirect re-validation and byte/time caps.
- **XSS-safe by construction** — live/API data is rendered with `createElement` / `textContent`, external hrefs pass a URL sanitizer.

---

## Further documentation

| Doc | What it covers |
|---|---|
| **[USER-GUIDE.md](USER-GUIDE.md)** | How to use **every feature** on the site, in plain simple language. |
| [CLAUDE.md](CLAUDE.md) | Full architecture map, request flow, worker domain map, runtime gotchas. |
| [AGENTS.md](AGENTS.md) | The deploy coordination contract for the shared environment. |
| [DESIGN.md](DESIGN.md) | The design system (colour, type, components). |
| [CROTTS.md](CROTTS.md) | Crotts AI assistant setup & providers. |
| [PAYMENTS.md](PAYMENTS.md) | PayPal enablement. |
| [STAGING.md](STAGING.md) | The dev/staging environment. |
| `auth-worker/PROVISIONING.md` | Seeding members and issuing PINs. |

---

*Built for the Greenville Disc Golf Club — Greenville, North Carolina. 🥏*
