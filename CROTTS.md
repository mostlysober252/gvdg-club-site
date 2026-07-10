# Crotts — the GVDG AI assistant: setup & operations

**Crotts** is the club's persistent AI assistant: a floating avatar button (named after club officer
**Max Crotts**, using his photo) on the main public, member, and admin surfaces. Click it to chat. Crotts answers
questions about the club's **events and courses** (pulled live from the club API), general disc-golf
questions, and how to use the site (sign-in, ratings, donating).

This doc tells you (mostlysober252 + agents) **exactly** what to do to turn it on. If you do nothing,
Crotts still loads but every message returns a friendly "no AI provider configured" stub — so wiring a
brain (below) is what makes it actually answer.

---

## How it works (1-minute architecture)

```
Browser widget (shared React CrottsWidget, lower-left)
        │  POST /assistant  { message, history }
        ▼
Club Worker (auth-worker/)  ── builds a Crotts prompt + injects live events/courses from D1
        │  tries providers in order:
        ├─ 1) OpenRouter (free model)        ← primary brain  (env.OPENROUTER_API_KEY)
        ├─ 2) Cloudflare Workers AI          ← fallback if OpenRouter fails/unavailable  (AI binding)
        └─ 3) dev stub                       ← only if NEITHER is configured
        ▼
   reply  → rendered in the chat panel
```

- The API key is **only ever** a server-side secret. It is **never** in the repo and **never** sent to
  the browser — the Worker makes all AI calls. Public endpoint, but **rate-limited to 20 requests/min per IP**.
- If OpenRouter is rate-limited or down, Crotts **automatically falls back** to Cloudflare Workers AI.
  If you set no OpenRouter key, Crotts just uses Workers AI.

---

## ✅ Setup checklist (TL;DR)

1. [ ] Make sure **Workers AI** is enabled on the Cloudflare account (it is by default; the `[ai]` binding
       is already declared in `auth-worker/wrangler.toml`).
2. [ ] (Recommended) Get a **free OpenRouter API key** → set it as the Worker secret `OPENROUTER_API_KEY`.
3. [ ] Confirm/optionally change `OPENROUTER_MODEL` in `wrangler.toml` (default: `openai/gpt-oss-120b:free`).
4. [ ] Deploy the Worker through the correct path for your environment.
5. [ ] Verify (curl + click the avatar on the live site).

That's it. Steps in detail below.

---

## Step 1 — Pick & wire a brain

### Option A — OpenRouter primary (recommended; free models)

1. Create a free account at **https://openrouter.ai** → **Keys** → create a key (starts with `sk-or-...`).
2. Set it as a **Worker secret** (encrypted by Cloudflare, not in the repo):
   ```bash
   cd auth-worker
   npx wrangler secret put OPENROUTER_API_KEY
   # paste the sk-or-... key when prompted
   ```
3. (Optional) Choose the model in `auth-worker/wrangler.toml`:
   ```toml
   OPENROUTER_MODEL = "openai/gpt-oss-120b:free"
   ```
   - Browse free models at **https://openrouter.ai/models** (filter **Free**), or
     `GET https://openrouter.ai/api/v1/models` and pick any id ending in `:free`.
   - **Heads-up:** free models rotate and are **rate-limited upstream**; if your chosen one returns 429,
     Crotts falls back to Workers AI automatically. `openai/gpt-oss-120b:free` tested well; if it gets
     flaky, try another `:free` model. Adding a few credits to OpenRouter raises free-tier limits.

### Option B — Workers AI only (no third-party key)

Do nothing extra. The `[ai]` binding is already in `wrangler.toml`; Crotts uses
`@cf/meta/llama-3.1-8b-instruct` (change via `ASSISTANT_MODEL`). Usage bills to your Workers AI quota.

> With **both** configured (recommended), OpenRouter is tried first and Workers AI is the safety net.

---

## Step 2 — Deploy

You need the other Worker secret/bindings that the whole portal already requires:
- `JWT_SECRET` (member auth signing key, ≥32 chars): `npx wrangler secret put JWT_SECRET`
- Real **KV** + **D1** ids filled into `auth-worker/wrangler.toml` (replace the `REPLACE_WITH_*` placeholders;
  `wrangler kv namespace create ROSTER` / `... RATELIMIT`, `wrangler d1 create gvdg`, then
  `wrangler d1 migrations apply DB`).

Then deploy through the matching path:

### Shared dev — `gvdgclub.com`
From the repo root:
```bash
GVDG_AGENT=<your-name> ./scripts/gvdg-deploy.sh
```

This is the only sanctioned deploy path for the shared dev slot. It runs the repo gates and deploys Pages
plus the Worker together.

### Maintainer-owned production Worker
From `auth-worker/`, after filling the top-level placeholders and setting secrets:
```bash
npm run deploy
```

### Automated (GitHub Actions) — included
`.github/workflows/deploy-worker.yml` runs on push to `main` (paths `auth-worker/**`) or manual dispatch.
It runs typegen, audit, typecheck, tests, and config validation. If the production config is filled in and
`CLOUDFLARE_API_TOKEN` exists, `cloudflare/wrangler-action` deploys and syncs the secrets listed in the
workflow into Cloudflare. Add these **repo secrets** (Settings → Secrets and variables → Actions):

| GitHub Secret | What it is | How to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Token CI uses to deploy | Cloudflare dash → My Profile → API Tokens → Create → **Edit Cloudflare Workers** template |
| `JWT_SECRET` | Member-auth signing key (≥32 chars) | Generate any high-entropy string |
| `OPENROUTER_API_KEY` | Crotts' OpenRouter key | openrouter.ai → Keys (optional; omit to use Workers AI only) |
| `GEMINI_API_KEY` | Preferred tee-sign OCR provider | Google AI Studio / Gemini API key |
| `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` | Optional PayPal Checkout | PayPal developer app credentials |

**Why GitHub Secrets are safe here:** they're readable only inside a CI run. The workflow uses them at
**deploy time** to run `wrangler secret put`, which stores them in **Cloudflare's** encrypted secret store.
At runtime the Worker reads the key from Cloudflare (`env.OPENROUTER_API_KEY`) — never from GitHub, never
from the repo, never from the browser. (Note: secrets do **not** transfer across forks/PRs — set them on
this repo, not a fork.)

---

## Step 3 — Verify

**API:**
```bash
curl -s -X POST https://<your-worker-host>/assistant \
  -H "Origin: https://www.greenvillediscgolf.com" -H "content-type: application/json" \
  -d '{"message":"What courses does the club play?"}'
# → {"reply":"...","provider":"openrouter"}   (or "workers-ai")
```
- `provider` tells you which brain answered.
- `{"error":"assistant_unavailable"}` (HTTP 502) = **both** providers failed → check the OpenRouter key/model
  and that Workers AI is enabled.
- `{"stub":true}` = no provider configured → set `OPENROUTER_API_KEY` or confirm the `[ai]` binding deployed.

**UI:** open the live site → click the **Crotts avatar in the lower-left** → ask a question. It should answer
using real club data, in both light and dark themes.

---

## Customizing Crotts

| What | Where |
|---|---|
| Personality / instructions / site facts | `auth-worker/src/assistant.ts` → `PERSONA` (and the club-context builder) |
| Avatar image | `img/crotts.jpg` (replace the file; keep the name) |
| Position / colors / sizing | `src/shared/crotts-widget.js` (`#crotts-fab` / `#crotts-panel`; pages may override placement for mobile/detail views) |
| Which pages show it | each page's `crottsReactApp` mount plus its route bundle (`home-app`, `public-app`, `admin-app`, or `members-app`) |
| Rate limit | `auth-worker/src/index.ts` → `ASSISTANT_LIMIT` / `ASSISTANT_WINDOW` (default 20/min/IP) |
| OpenRouter / Workers AI model | `OPENROUTER_MODEL` / `ASSISTANT_MODEL` vars in `wrangler.toml` |

---

## Security & cost notes

- **Key safety:** server-side secret only; never committed, never in client JS, never returned to the browser.
- **Abuse control:** the endpoint is public (no login, so members and visitors can use it) but rate-limited
  per IP. Input is length-capped; history is capped/sanitized.
- **XSS:** replies are rendered with `textContent` only (no `innerHTML`).
- **Data exposure:** only **public** club data (event names/dates, course names) is put in the prompt — no
  member PII, no secrets.
- **Cost:** OpenRouter `:free` models are $0 (just rate-limited). Workers AI bills to your account quota; the
  per-IP rate limit bounds it. No cost if Crotts is left on the stub (but it won't really answer).

---

## CORS reminder

The Worker only accepts browser calls from origins in `ALLOWED_ORIGINS` (wrangler.toml var). It already lists
`https://www.greenvillediscgolf.com` and `https://greenvillediscgolf.com`. If the site is served from another
origin, add it there or the widget's requests will be blocked.
