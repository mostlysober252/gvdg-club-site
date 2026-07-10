# Agent coordination — gvdg-club-site

Multiple agents/sessions (Claude Code, Codex, humans) work in this repo **at the same time**. This file
is the shared contract that keeps them from stepping on each other. Read it before you deploy, branch, or
run anything that touches the shared dev environment.

---

## The shared resource

**gvdgclub.com is a single, shared dev environment**, made of two pieces that are deployed together:

| Piece | Cloudflare target | Deploy command (do NOT run by hand) |
|-------|-------------------|--------------------------------------|
| Static site | Pages project `gvdg-club-site`, branch `main` → **gvdgclub.com** | `wrangler pages deploy … --project-name gvdg-club-site --branch main` |
| API worker | `gvdg-member-auth-staging`, `--env gvdgclub` → **auth.gvdgclub.com** | `wrangler deploy --env gvdgclub` |

The Cloudflare account owner and account ID are intentionally not committed. Set `CLOUDFLARE_ACCOUNT_ID`
locally or as a GitHub secret before any Pages deploy/list command. D1 `gvdg-staging` is shared too.
Production (greenvillediscgolf.com) is separate (GitHub Pages) and is **not** touched by these commands.

## Why this file exists (the failure it prevents)

Every `wrangler … deploy` to gvdgclub is **last-write-wins with no safety check**. On 2026-07-03 two
sessions were deploying divergent branches to gvdgclub; one deployed a commit **19 commits behind `main`**
over the other's deploy, silently reverting the site to a state that predated the weather feature. Both
sessions thought their work was live; neither was. Nothing warned them.

## The rules

1. **Never `wrangler pages deploy` or `wrangler deploy` by hand.** Deploy **only** through
   **`./scripts/gvdg-deploy.sh`**. It takes a machine-wide lock, runs a freshness gate, stamps a version
   marker, and deploys Pages + worker together.
   ```bash
   CLOUDFLARE_ACCOUNT_ID=<private-account-id> GVDG_AGENT=<your-name> ./scripts/gvdg-deploy.sh
   ./scripts/gvdg-deploy.sh --status                          # what's live vs your HEAD (read-only)
   ./scripts/gvdg-deploy.sh --dry-run                         # run all gates, deploy nothing
   ```

2. **Deploy only a clean, committed HEAD.** The guard refuses a dirty tree, so "what's live" is always a
   real commit that everyone can name and reason about.

3. **You may only move the dev env FORWARD.** The guard reads the currently-live commit (from
   `gvdgclub.com/version.json`) and **aborts unless your HEAD contains it** (`git merge-base --is-ancestor`).
   If it aborts, you were about to overwrite work that isn't in your branch — **stop and reconcile**, do
   not `GVDG_FORCE=1` past it without confirming with the human.

4. **`main` is the single integration branch, and the only line that should be live on gvdgclub.**
   Feature branches are fine, but before you deploy, merge/rebase `origin/main` into your branch so your
   HEAD is a strict superset of what's live. **Do not deploy a long-lived fork that has diverged from
   `main`** — reconcile the fork into `main` first. (As of 2026-07-03, `main` and `GVDG-udisc-export` had
   BOTH forked with unique commits; that divergence is exactly what caused the clobber.)

5. **Announce yourself.** Export `GVDG_AGENT=<short-name>` so the lock, `version.json`, and `.deploy-log`
   record who deployed. If you start long shared-repo work, say so (commit message, PR, or a note the
   human can relay to other sessions).

## How to check what's live (anyone, anytime)

```bash
curl -s https://gvdgclub.com/version.json           # {commit, branch, deployedAt, deployer}
./scripts/gvdg-deploy.sh --status                   # compares that to your HEAD
CLOUDFLARE_ACCOUNT_ID=<private-account-id> wrangler pages deployment list --project-name gvdg-club-site
```

## Branch hygiene

- One integration branch: **`main`**. Rebase feature branches onto it; open PRs; merge back promptly.
- Don't let a branch live long enough to diverge in both directions from `main`. If two branches have each
  gained unique commits, **merge them into `main` and reconcile there** before anything is deployed — never
  resolve the divergence by deploying one over the other.
- Migrations (`auth-worker/migrations/NNNN_*.sql`) are append-only and globally ordered. Coordinate the
  next number; two branches must not both claim the same `NNNN`.

## The lock

Machine-wide at `${TMPDIR:-/tmp}/gvdg-deploy.lock`, auto-reclaimed after 15 min if stale. One deploy at a
time. If the guard says a deploy is in progress, wait — don't work around it.

## The watchdog (backstop)

A systemd `--user` timer (`scripts/gvdg-deploy-watchdog.sh`) polls `gvdgclub.com/version.json` every ~3
min. If it ever sees a live commit that **`origin/main` is not an ancestor of** (a clobber — a deploy
missing main's work), it **re-asserts `origin/main`** from an isolated `git archive` export (never touches
any working tree). This is a safety net, not a license to deploy raw — a clobbered deploy still flaps the
site until the next poll. **Push `main` before deploying it** so the watchdog sees newer main and doesn't
mistake it for a clobber. Manage: `scripts/gvdg-deploy-watchdog.sh --status | --install | --uninstall`;
log at `~/.local/state/gvdg-watchdog.log`.
