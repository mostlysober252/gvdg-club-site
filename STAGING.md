# Shared Dev Environment — `gvdgclub.com`

`gvdgclub.com` is the shared live-test environment for this repo. It is not production, and it is not an
isolated sandbox per branch. Treat it as one shared integration slot that multiple humans and agents can
deploy to.

Production (`www.greenvillediscgolf.com` on GitHub Pages, with `auth.greenvillediscgolf.com`) is separate
and is not touched by the shared-dev deploy commands.

```
gvdgclub.com  (Cloudflare Pages project gvdg-club-site, branch main)
        │
        ▼
auth.gvdgclub.com  ──►  Worker env gvdgclub
                       Worker name gvdg-member-auth-staging
                       shared dev KV / D1 / R2 / Durable Object bindings
```

The Worker name still contains `staging` for historical reasons. In current operation, `[env.staging]` and
`[env.gvdgclub]` in `auth-worker/wrangler.toml` are aliases for the same Worker and shared dev data. There
is no separate staging database behind the `staging` env.

Cloudflare account IDs, zone IDs, resource IDs, API tokens, account emails, and QA credentials are private
operational details. Keep them in shell env, `.gvdg-deploy.env`, GitHub secrets, or Cloudflare secrets.
Do not put them in public docs.

---

## Current Deployment Path

Use the wrapper from the repo root:

```bash
GVDG_AGENT=<your-name> ./scripts/gvdg-deploy.sh
./scripts/gvdg-deploy.sh --status
./scripts/gvdg-deploy.sh --dry-run
```

The wrapper is the only sanctioned local deploy path for `gvdgclub.com`. It:

- requires a clean committed `HEAD`;
- reads `https://gvdgclub.com/version.json`;
- refuses to deploy unless your `HEAD` contains the live commit;
- takes a machine-wide deploy lock;
- runs frontend tests, build, React QA, browser smoke, and hex lint;
- runs Worker typegen, typecheck, tests, and config validation;
- deploys Pages and the Worker together;
- stamps `version.json`;
- runs live staging QA when private QA credentials are configured.

Do not run raw `wrangler pages deploy` or raw `wrangler deploy` against the shared dev slot. Raw deploys
are last-write-wins and can silently overwrite another agent's work.

---

## GitHub Actions

`.github/workflows/deploy-staging.yml` is the manual GitHub Actions path for `gvdgclub.com`.

It runs the same broad gate as the local wrapper:

- root tests, build, React QA, and hex lint;
- Worker typegen, audit, typecheck, tests, and config validation;
- Pages artifact build with `version.json`;
- Pages deploy to the `gvdg-club-site` project;
- Worker deploy to `--env gvdgclub`;
- optional live scoring and member-dashboard E2E when QA credentials exist.

Required repo secrets for an actual deploy:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Optional QA secrets:

- `GVDG_STAGING_QA_TOKEN`
- or `GVDG_STAGING_QA_IDENTIFIER` plus `GVDG_STAGING_QA_PIN`

Optional integration secrets, depending on features being exercised:

- `GEMINI_API_KEY`
- PayPal / Resend / AI provider secrets configured in Cloudflare for the Worker

If the Cloudflare deploy secrets are missing, the workflow still runs checks and then skips the deploy.

---

## Frontend Host Resolution

The page shells and React app bundles resolve the Worker base by hostname through `src/shared/api-base.js`.

Resolution order:

1. explicit `data-api-base` / `data-auth-base` attributes;
2. `greenvillediscgolf.com` / `www.greenvillediscgolf.com` → `auth.greenvillediscgolf.com`;
3. `localhost` / `127.0.0.1` → local Worker on `:8788`;
4. everything else, including `gvdgclub.com` and Pages previews → `auth.gvdgclub.com`.

No per-deploy HTML edit should be needed for normal shared-dev deploys.

---

## Local Dev Against The Shared Shape

For local work, run the Worker locally and serve the static site from the repo root:

```bash
cd auth-worker
npm install
npm run dev
```

In another shell:

```bash
npm install
npm run build
python3 -m http.server 8080 --bind 127.0.0.1
```

Create `auth-worker/.dev.vars` with local-only values:

```text
JWT_SECRET=<any string at least 32 chars>
ALLOWED_ORIGINS=http://127.0.0.1:8080,http://localhost:8080
SESSION_TTL_SEC=43200
```

Apply local D1 migrations and seed local KV as described in `README.md` and
`auth-worker/PROVISIONING.md`.

---

## Live QA

The shared-dev deploy wrapper and GitHub workflow can run these live checks when credentials are present:

```bash
npm run qa:staging-live-scoring
npm run qa:staging-member-dashboard
```

The QA member must be an admin because the tests create temporary casual-round state and clean it up.

For manual UI verification, always check the specific route that changed and confirm `version.json` matches
the commit you intended to deploy:

```bash
curl -s https://gvdgclub.com/version.json
```

---

## Notes

- Passkeys are per-domain. A passkey enrolled on `gvdgclub.com` is separate from one enrolled on
  `greenvillediscgolf.com`.
- WebAuthn origin must exactly match the page origin. The shared dev Worker expects `https://gvdgclub.com`.
- PayPal Checkout remains feature-gated by credentials. Without both PayPal secrets, event/shop payments
  stay in manual mode.
- Crotts and tee-sign OCR degrade through their provider chains when optional AI credentials are absent.
- Browser and service-worker caches can make a changed page look stale. If cached app assets change, bump
  `sw.js` and the matching test expectation.
