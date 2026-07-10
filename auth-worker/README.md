# GVDG Cloudflare Worker

`auth-worker/` is the server-side application for the Greenville Disc Golf Club platform. The root site is
static; all dynamic behavior flows through this Worker.

The Worker handles:

- member login with PDGA number or UDisc username + PIN;
- forced first-login PIN changes and optional WebAuthn/passkeys;
- member profile, dashboard, ratings, event history, registrations, and board routes;
- public club data for events, courses, layouts, leagues, fundraisers, meetings, and results;
- admin operations for events, registration, live scoring, courses/layouts, members, shop, wallets, orders,
  tee signs, imports, and data archive exports;
- Durable Object live scoring for events and casual rounds;
- PayPal-backed event/shop payments when credentials are present;
- Crotts AI, tee-sign OCR, weather, email, and ratings recompute integrations.

## Runtime Shape

Bindings are declared in `wrangler.toml`:

- `ROSTER` and `RATELIMIT` Workers KV namespaces;
- `DB` D1 database;
- `PHOTOS` R2 bucket;
- `AI` Workers AI binding;
- `LIVE` Durable Object binding for `LiveEventDO`;
- `ASSISTANT_RL` Cloudflare rate-limit binding;
- daily cron `17 8 * * *` for ratings recompute.

Named envs `staging` and `gvdgclub` currently point at the same shared-dev Worker for `auth.gvdgclub.com`.
The top-level config is the owner-operated production template and still contains `REPLACE_WITH_*`
placeholders until a maintainer provisions their own resources.

## Commands

From `auth-worker/`:

```bash
npm install
npm run dev                       # local Worker on http://127.0.0.1:8788
npm run typegen:check             # wrangler types drift check
npm run typecheck                 # tsc --noEmit
npm test                          # vitest Worker test suite
npm run audit                     # npm audit --audit-level=moderate
npm run migrate:staging           # apply D1 migrations to the shared-dev DB
npm run deploy:staging:dry-run    # validate and dry-run the shared-dev Worker env
```

For the shared `gvdgclub.com` environment, deploy through the repo wrapper from the repo root:

```bash
GVDG_AGENT=<your-name> ./scripts/gvdg-deploy.sh
```

Do not run raw `wrangler deploy --env gvdgclub` against the shared dev slot. The wrapper adds the clean-tree
gate, forward-only freshness check, tests, build, config validation, version marker, and post-deploy QA.

For a maintainer-owned production Worker, fill the top-level placeholders in `wrangler.toml`, set secrets,
apply migrations, then use `npm run deploy` or the GitHub Actions workflow intentionally.

## Local Development

Create `auth-worker/.dev.vars`:

```text
JWT_SECRET=<any string at least 32 chars>
ALLOWED_ORIGINS=http://127.0.0.1:8080,http://localhost:8080
SESSION_TTL_SEC=43200
```

Apply local D1 migrations:

```bash
for f in migrations/*.sql; do wrangler d1 execute DB --local --file="$f"; done
```

Seed a local member:

```bash
node scripts/dev-seed.mjs 12345 JaneD 4821 "Jane Doe" > seed.local.json
wrangler kv bulk put seed.local.json --binding=ROSTER --local
```

Then run:

```bash
npm run dev
```

Serve the static frontend from the repo root after `npm run build`; localhost pages automatically target
the local Worker on `:8788`.

## Security Model

- `JWT_SECRET` is required and must be at least 32 characters; the Worker fails closed before routing if it
  is missing or too short.
- CORS is an exact-origin allowlist from `ALLOWED_ORIGINS`.
- `adminGate` re-reads `ROSTER` KV and requires `member.isAdmin === true`; admin status is never trusted
  from the JWT.
- PIN hashing uses PBKDF2-HMAC-SHA256 with 100,000 iterations, plus optional `PIN_PEPPER` for new hashes.
- Unknown login identifiers still run a dummy PBKDF2 hash to reduce enumeration timing differences.
- Lockout and rate-limit state lives in KV, with the public assistant endpoint using the atomic
  `ASSISTANT_RL` binding when available.
- All D1 queries must remain parameterized.
- Imports use the fixed-host `safeFetch` allowlist.
- Member enrollment is closed: provisioned/admin-created accounts only, no public self-signup.

## Public API Overview

Public:

- `POST /login`
- `POST /assistant`
- `POST /webauthn/auth/options`
- `POST /webauthn/auth/verify`
- `GET /courses`
- `GET /events`
- `GET /events/:id`
- `GET /leagues`
- `GET /leagues/:id`
- `GET /fundraisers`
- `GET /meetings`
- public live snapshots and WebSocket joins

Member-authenticated:

- `GET /me`
- `POST /set-pin`
- `POST /profile`
- `GET /my-results`
- `GET /my-ratings`
- `GET /my-live-rounds`
- `GET /my-registrations`
- board routes
- passkey registration routes
- tee-sign submission routes
- live scoring writes for the member's own card

Admin-gated:

- `/admin/events`
- `/admin/courses`
- `/admin/layouts`
- `/admin/leagues`
- `/admin/fundraisers`
- `/admin/meetings`
- `/admin/import`
- `/admin/tee-signs`
- `/admin/shop`
- `/admin/wallets`
- `/admin/orders`
- `/admin/export`
- `/admin/members`
- event live-scoring lifecycle routes

See the root `README.md` and `CLAUDE.md` for the complete architecture map and operational contract.
