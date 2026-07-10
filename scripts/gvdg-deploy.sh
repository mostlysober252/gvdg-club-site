#!/usr/bin/env bash
#
# gvdg-deploy.sh — the ONE sanctioned way to deploy the gvdg-club-site dev env (gvdgclub.com).
#
# WHY THIS EXISTS: gvdgclub.com (Cloudflare Pages project `gvdg-club-site`, branch `main`) and its worker
# (`gvdg-member-auth-staging`, `--env gvdgclub`) are a SINGLE shared dev environment. Multiple agents/
# sessions work this repo at once, each on its own branch. Running `wrangler ... deploy` by hand from
# different branches has clobbered work — an agent once deployed a commit 19 behind `main` over another
# agent's deploy, wiping the weather feature + a page rework. Last-write-wins, silently.
#
# This wrapper prevents that with three gates:
#   1. LOCK       — a machine-wide lock so only one deploy runs at a time.
#   2. FRESHNESS  — refuses to deploy unless your HEAD *contains* the commit that is currently live
#                   (i.e. you can only move the dev env FORWARD, never regress/sidestep it).
#   3. MARKER     — stamps version.json (commit/branch/deployer/time) into the deploy so "what's live"
#                   is always knowable by the next agent (and by this gate).
#
# USAGE:
#   GVDG_AGENT=<your-name> ./scripts/gvdg-deploy.sh              # deploy Pages + worker
#   GVDG_AGENT=<your-name> ./scripts/gvdg-deploy.sh --pages-only
#   GVDG_AGENT=<your-name> ./scripts/gvdg-deploy.sh --worker-only
#   ./scripts/gvdg-deploy.sh --dry-run                          # run every gate, deploy NOTHING
#   ./scripts/gvdg-deploy.sh --status                           # just print what's live vs your HEAD
#
# See AGENTS.md ("Deploy coordination") for the full protocol.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT="gvdg-club-site"
PAGES_URL="https://gvdgclub.com"
WORKER_ENV="gvdgclub"
LOCK_DIR="${TMPDIR:-/tmp}/gvdg-deploy.lock"   # machine-wide, shared across sessions
LOCK_STALE_SEC=900                            # reclaim a lock older than 15 min
LEDGER="$REPO_ROOT/.deploy-log"               # local (gitignored) record of deploys from this machine
LOCK_HELD=0

c() { printf '\033[%sm' "$1"; }
log()  { printf '%s[deploy]%s %s\n' "$(c '1;36')" "$(c 0)" "$*"; }
warn() { printf '%s[deploy] WARN:%s %s\n' "$(c '1;33')" "$(c 0)" "$*" >&2; }
die()  { printf '%s[deploy] ABORT:%s %s\n' "$(c '1;31')" "$(c 0)" "$*" >&2; release_lock; exit 1; }

if [ -f "$REPO_ROOT/.gvdg-deploy.env" ]; then
  . "$REPO_ROOT/.gvdg-deploy.env"
fi
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  export CLOUDFLARE_ACCOUNT_ID
fi
if [ -n "${GVDG_STAGING_QA_TOKEN:-}" ]; then
  export GVDG_STAGING_QA_TOKEN
fi
if [ -n "${GVDG_STAGING_QA_IDENTIFIER:-}" ]; then
  export GVDG_STAGING_QA_IDENTIFIER
fi
if [ -n "${GVDG_STAGING_QA_PIN:-}" ]; then
  export GVDG_STAGING_QA_PIN
fi
if [ -n "${GVDG_STAGING_SITE_URL:-}" ]; then
  export GVDG_STAGING_SITE_URL
fi
if [ -n "${GVDG_STAGING_API_URL:-}" ]; then
  export GVDG_STAGING_API_URL
fi

discover_cloudflare_account_id() {
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && return 0
  command -v npx >/dev/null || return 0

  local out ids count
  out="$(npx wrangler whoami 2>/dev/null || true)"
  ids="$(printf '%s\n' "$out" | grep -Eo '[0-9a-f]{32}' | sort -u || true)"
  count="$(printf '%s\n' "$ids" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$count" = 1 ]; then
    CLOUDFLARE_ACCOUNT_ID="$(printf '%s\n' "$ids" | sed -n '1p')"
    export CLOUDFLARE_ACCOUNT_ID
  fi
}

require_cloudflare_account_id() {
  discover_cloudflare_account_id
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || die "CLOUDFLARE_ACCOUNT_ID is not set. Keep the account ID private and provide it via your shell, .gvdg-deploy.env, CI secrets, or a Wrangler OAuth login with exactly one account."
}

has_staging_live_scoring_qa_creds() {
  [ -n "${GVDG_STAGING_QA_TOKEN:-}" ] || { [ -n "${GVDG_STAGING_QA_IDENTIFIER:-}" ] && [ -n "${GVDG_STAGING_QA_PIN:-}" ]; }
}

run_staging_live_scoring_qa() {
  if [ "${GVDG_SKIP_STAGING_QA:-0}" = 1 ]; then
    log "post-deploy smoke: staging live-scoring E2E skipped (GVDG_SKIP_STAGING_QA=1)."
    return
  fi
  if ! has_staging_live_scoring_qa_creds; then
    warn "post-deploy smoke: staging live-scoring E2E skipped. Set GVDG_STAGING_QA_TOKEN, or GVDG_STAGING_QA_IDENTIFIER plus GVDG_STAGING_QA_PIN, to enable it."
    return
  fi
  log "post-deploy smoke: staging live-scoring E2E…"
  ( cd "$REPO_ROOT" && npm run qa:staging-live-scoring ) || die "POST-DEPLOY SMOKE FAILED: staging live-scoring E2E. Check the deployed site/API and rerun after fixing."
}

run_staging_member_dashboard_qa() {
  if [ "${GVDG_SKIP_STAGING_QA:-0}" = 1 ]; then
    log "post-deploy smoke: staging member dashboard E2E skipped (GVDG_SKIP_STAGING_QA=1)."
    return
  fi
  if ! has_staging_live_scoring_qa_creds; then
    warn "post-deploy smoke: staging member dashboard E2E skipped. Set GVDG_STAGING_QA_TOKEN, or GVDG_STAGING_QA_IDENTIFIER plus GVDG_STAGING_QA_PIN, to enable it."
    return
  fi
  log "post-deploy smoke: staging member dashboard E2E…"
  ( cd "$REPO_ROOT" && npm run qa:staging-member-dashboard ) || die "POST-DEPLOY SMOKE FAILED: staging member dashboard E2E. Run npm run qa:ensure-staging-dashboard-data if the QA member has no dashboard stats."
}

MODE_PAGES=1; MODE_WORKER=1; DRY_RUN=0; STATUS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --pages-only)  MODE_WORKER=0 ;;
    --worker-only) MODE_PAGES=0 ;;
    --dry-run)     DRY_RUN=1 ;;
    --status)      STATUS_ONLY=1 ;;
    *) die "unknown arg: $arg (see the header for usage)" ;;
  esac
done

# ---------- lock (atomic mkdir; portable, no flock dependency) ----------
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf 'owner=%s pid=%s at=%s agent=%s\n' "$(whoami)" "$$" "$(date -u +%FT%TZ)" "${GVDG_AGENT:-unknown}" > "$LOCK_DIR/owner"
    LOCK_HELD=1; return
  fi
  local owner age
  owner="$(cat "$LOCK_DIR/owner" 2>/dev/null || echo '?')"
  age=$(( $(date +%s) - $(stat -c %Y "$LOCK_DIR" 2>/dev/null || echo "$(date +%s)") ))
  if [ "$age" -gt "$LOCK_STALE_SEC" ]; then
    warn "reclaiming stale lock (${age}s old, $owner)"; rm -rf "$LOCK_DIR"; acquire_lock; return
  fi
  die "another deploy is in progress — $owner (${age}s ago). Wait for it, or coordinate before deploying."
}
release_lock() { if [ "$LOCK_HELD" = 1 ]; then rm -rf "$LOCK_DIR" 2>/dev/null || true; LOCK_HELD=0; fi; }
trap release_lock EXIT INT TERM

# ---------- discover what is currently live ----------
live_commit() {
  # Primary: the version.json the guard stamps into every deploy.
  local j sha
  j="$(curl -fsS "$PAGES_URL/version.json?x=$(date +%s)" 2>/dev/null || true)"
  sha="$(printf '%s' "$j" | grep -oE '"commit"[^,]*' | grep -oE '[0-9a-f]{7,40}' | head -1 || true)"
  if [ -n "$sha" ]; then printf '%s' "$sha"; return; fi
  # Fallback (bootstrap, pre-marker): the Source column of the newest Production Pages deployment.
  discover_cloudflare_account_id
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || return 0
  npx wrangler pages deployment list --project-name "$PROJECT" 2>/dev/null \
    | awk -F'│' '/Production/ { gsub(/ /,"",$5); print $5; exit }'
}

HEAD_SHA="$(git rev-parse HEAD)"
HEAD_SHORT="$(git rev-parse --short HEAD)"
BRANCH="$(git branch --show-current || echo DETACHED)"

# ---------- --status: report and exit ----------
if [ "$STATUS_ONLY" = 1 ]; then
  LIVE="$(live_commit || true)"
  log "your HEAD:   $HEAD_SHORT ($BRANCH)"
  log "live commit: ${LIVE:-<unknown>}"
  if [ -n "${LIVE:-}" ] && git cat-file -e "$LIVE" 2>/dev/null; then
    if git merge-base --is-ancestor "$LIVE" HEAD 2>/dev/null; then
      log "=> deploying from your HEAD would be a FORWARD move (safe)."
    else
      warn "=> your HEAD does NOT contain the live commit — deploying would REGRESS it. Reconcile first."
    fi
  fi
  exit 0
fi

# ---------- gate 1: clean, committed tree (so the live commit is always a real commit) ----------
[ -z "$(git status --porcelain)" ] || die "working tree is dirty. Commit or stash first — deploys must be from a committed HEAD so 'what's live' is a knowable commit."

acquire_lock

# ---------- gate 2: freshness — HEAD must contain what's live ----------
LIVE="$(live_commit || true)"
if [ -z "${LIVE:-}" ]; then
  warn "could not determine the live commit (first deploy, or API unavailable) — proceeding without the freshness gate."
elif ! git cat-file -e "$LIVE" 2>/dev/null; then
  git fetch --all --quiet 2>/dev/null || true
  git cat-file -e "$LIVE" 2>/dev/null || die "the live commit ($LIVE) is not in your local git even after fetch. Someone deployed a commit you don't have. Fetch/coordinate before deploying."
fi
if [ -n "${LIVE:-}" ] && git cat-file -e "$LIVE" 2>/dev/null; then
  if git merge-base --is-ancestor "$LIVE" HEAD 2>/dev/null; then
    log "live is $(git rev-parse --short "$LIVE") — your HEAD ($HEAD_SHORT) contains it. Forward move, OK."
  elif [ "${GVDG_FORCE:-0}" = 1 ]; then
    warn "freshness gate OVERRIDDEN (GVDG_FORCE=1): live is $(git rev-parse --short "$LIVE"), current HEAD is $HEAD_SHORT. Use only after confirming this is not a regression."
  else
    die "REGRESSION BLOCKED. Live is $(git rev-parse --short "$LIVE") on gvdgclub.com, but your branch ($BRANCH @ $HEAD_SHORT) does NOT contain it. Deploying would wipe that work. Merge/rebase origin's live commit into your branch first, or coordinate. (Override only if you are CERTAIN: GVDG_FORCE=1.)"
  fi
fi

# ---------- correctness gate (never ship red code to the shared env) ----------
# The freshness gate above only proves you deploy FORWARD; it says nothing about whether the code works.
# Mirror the CI gate (deploy-staging.yml) here so the local deploy path can't ship type-broken,
# test-failing, or mis-bound auth/payments/scoring code. Emergency override: GVDG_SKIP_GATE=1.
if [ "${GVDG_SKIP_GATE:-0}" = 1 ]; then
  log "⚠ correctness gate SKIPPED (GVDG_SKIP_GATE=1) — shipping UNVERIFIED code."
else
  log "correctness gate: static tests + build + React QA + browser smoke + hex-lint…"
  ( cd "$REPO_ROOT" && npm test && npm run build && npm run qa:react && npm run qa:site-smoke:run && node scripts/lint-hex.mjs ) || die "GATE FAILED: static frontend tests / build / React QA / browser smoke / hex-lint (raw hex outside tokens.css increased). Fix before deploying (or GVDG_SKIP_GATE=1 if you are CERTAIN)."
  if [ "$MODE_WORKER" = 1 ]; then
    log "correctness gate: worker typegen + typecheck + tests + config validation…"
    ( cd "$REPO_ROOT/auth-worker" \
        && npm run typegen:check \
        && npm run typecheck \
        && npm test \
        && node scripts/validate-wrangler-config.mjs --env "$WORKER_ENV" ) \
      || die "GATE FAILED: worker typecheck/tests/config. Fix before deploying (or GVDG_SKIP_GATE=1 if you are CERTAIN)."
  fi
  log "correctness gate passed ✔"
fi

# ---------- build artifact with a version marker ----------
DEPLOYER="${GVDG_AGENT:-$(whoami)}"
NOW="$(date -u +%FT%TZ)"
DIST="$REPO_ROOT/.pages-dist"
rm -rf "$DIST"; mkdir "$DIST"
cp -R ./*.html ./*.js ./*.css home-app public-app admin-app tee-sign-preview-app members-app score-app img _headers CNAME site.webmanifest "$DIST/"
mkdir -p "$DIST/src/shared"
cp src/shared/tee-sign-model.js "$DIST/src/shared/"
printf '{"commit":"%s","branch":"%s","deployedAt":"%s","deployer":"%s"}\n' "$HEAD_SHA" "$BRANCH" "$NOW" "$DEPLOYER" > "$DIST/version.json"
log "artifact built @ $HEAD_SHORT ($BRANCH) by $DEPLOYER; version.json stamped."

if [ "$DRY_RUN" = 1 ]; then
  log "DRY RUN — all gates passed; nothing deployed."
  rm -rf "$DIST"; release_lock; exit 0
fi

# ---------- deploy ----------
if [ "$MODE_PAGES" = 1 ]; then
  require_cloudflare_account_id
  log "deploying Pages ($PROJECT / main)…"
  npx wrangler pages deploy "$DIST" --project-name "$PROJECT" --branch main --commit-dirty=true
fi
if [ "$MODE_WORKER" = 1 ]; then
  log "deploying worker (--env $WORKER_ENV)…"
  ( cd "$REPO_ROOT/auth-worker" && npx wrangler deploy --env "$WORKER_ENV" )
fi

# ---------- ledger + verify ----------
printf '%s\t%s\t%s\t%s\n' "$NOW" "$BRANCH" "$HEAD_SHORT" "$DEPLOYER" >> "$LEDGER"
release_lock
log "verifying version.json is live…"
sleep 3
SEEN="$(curl -fsS "$PAGES_URL/version.json?x=$(date +%s)" 2>/dev/null | grep -oE '[0-9a-f]{7,40}' | head -1 || true)"
if [ -n "$SEEN" ] && git merge-base --is-ancestor "$SEEN" HEAD 2>/dev/null && git merge-base --is-ancestor HEAD "$SEEN" 2>/dev/null; then
  log "live version.json = $HEAD_SHORT ✔"
else
  warn "version.json shows ${SEEN:-<none>} (custom-domain propagation can lag ~15s; re-check with --status)."
fi
run_staging_live_scoring_qa
run_staging_member_dashboard_qa
log "done — $HEAD_SHORT ($BRANCH) deployed to $PAGES_URL by $DEPLOYER."
