#!/usr/bin/env bash
#
# gvdg-deploy-watchdog.sh — auto-heal gvdgclub.com if a rogue/stale deploy clobbers `main`.
#
# Multiple agent sessions deploy to the same Pages project (gvdg-club-site / main). A session that runs
# `wrangler pages deploy` from a branch origin/main does NOT fully contain silently reverts everyone's
# work (this is exactly what happened on 2026-07-03: a commit 19 behind main wiped the weather feature +
# a page rework). This watchdog polls gvdgclub.com/version.json and, when the live commit is one that
# origin/main is NOT an ancestor of (i.e. main has work the live deploy is missing), it re-asserts
# origin/main. The re-assert builds from an isolated `git archive` export — it NEVER touches your (or any
# session's) working tree or current branch.
#
# Runs as a systemd --user timer because `crontab` isn't installed on this box. Survives this agent
# session. See AGENTS.md.
#
# Usage:
#   scripts/gvdg-deploy-watchdog.sh              # run ONE check (what the timer invokes)
#   scripts/gvdg-deploy-watchdog.sh --install    # install + start the systemd --user timer (~every 3 min)
#   scripts/gvdg-deploy-watchdog.sh --uninstall  # stop + remove the timer
#   scripts/gvdg-deploy-watchdog.sh --status     # timer state + recent log
#   scripts/gvdg-deploy-watchdog.sh --dry-run    # check + report the verdict, re-assert NOTHING
#
# ASSUMPTION: deployers push `main` before deploying it (the guard implies a committed HEAD; push so the
# watchdog can see newer main and not mistake it for a clobber). A clobber from a known branch (behind or
# divergent) is always detected correctly; an *unknown* live commit is treated as a clobber (safe default).

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/usr/bin:/bin:$REPO/auth-worker/node_modules/.bin:${PATH:-}"
PROJECT="gvdg-club-site"
PAGES_URL="https://gvdgclub.com"
INTERVAL_SEC=180
LOG="${XDG_STATE_HOME:-$HOME/.local/state}/gvdg-watchdog.log"
LOCK="${TMPDIR:-/tmp}/gvdg-watchdog.lock"
UNIT_DIR="$HOME/.config/systemd/user"
SELF="$REPO/scripts/gvdg-deploy-watchdog.sh"

if [ -f "$REPO/.gvdg-deploy.env" ]; then
  . "$REPO/.gvdg-deploy.env"
fi
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  export CLOUDFLARE_ACCOUNT_ID
fi

discover_cloudflare_account_id() {
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && return 0
  command -v wrangler >/dev/null || return 0

  local out ids count
  out="$(wrangler whoami 2>/dev/null || true)"
  ids="$(printf '%s\n' "$out" | grep -Eo '[0-9a-f]{32}' | sort -u || true)"
  count="$(printf '%s\n' "$ids" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$count" = 1 ]; then
    CLOUDFLARE_ACCOUNT_ID="$(printf '%s\n' "$ids" | sed -n '1p')"
    export CLOUDFLARE_ACCOUNT_ID
  fi
}

mkdir -p "$(dirname "$LOG")"
log() { printf '%s  %s\n' "$(date -u +%FT%TZ 2>/dev/null || date)" "$*" >> "$LOG"; }
say() { printf '%s\n' "$*"; }

live_commit() {
  curl -fsS --max-time 15 "$PAGES_URL/version.json?x=$(date +%s)" 2>/dev/null \
    | grep -oE '"commit"[^,}]*' | grep -oE '[0-9a-f]{7,40}' | head -1
}
version_reachable() { # true unless the network/site is entirely unreachable
  [ "$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$PAGES_URL/version.json?x=$(date +%s)" 2>/dev/null)" != "000" ]
}

reassert() { # $1 = full origin/main sha, $2 = reason, $3 = dryrun(0/1)
  local sha="$1" reason="$2" dry="${3:-0}"
  if [ "$dry" = 1 ]; then say "WOULD RE-ASSERT origin/main ($sha) — $reason"; log "DRY-RUN would re-assert ($reason)"; return; fi
  discover_cloudflare_account_id
  if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    log "ERROR: CLOUDFLARE_ACCOUNT_ID is not set; cannot re-assert Pages. Set it in the environment, $REPO/.gvdg-deploy.env, or refresh Wrangler OAuth auth."
    return
  fi
  log "CLOBBER DETECTED: $reason — re-asserting origin/main ($sha)…"
  local build; build="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$build'" RETURN
  git -C "$REPO" archive origin/main | tar -x -C "$build"
  mkdir -p "$build/.pages-dist"
  if ! ( cd "$build" && npm ci >>"$LOG" 2>&1 && npm run build >>"$LOG" 2>&1 && cp -R ./*.html ./*.js ./*.css home-app public-app admin-app tee-sign-preview-app members-app score-app img _headers CNAME site.webmanifest .pages-dist/ >>"$LOG" 2>&1 && mkdir -p .pages-dist/src/shared && cp src/shared/tee-sign-model.js .pages-dist/src/shared/ >>"$LOG" 2>&1 ); then
    log "ERROR: static artifact build failed; cannot re-assert Pages."
    return
  fi
  printf '{"commit":"%s","branch":"main","deployedAt":"%s","deployer":"watchdog"}\n' \
    "$sha" "$(date -u +%FT%TZ)" > "$build/.pages-dist/version.json"
  if wrangler pages deploy "$build/.pages-dist" --project-name "$PROJECT" --branch main --commit-dirty=true >>"$LOG" 2>&1; then
    log "RE-ASSERTED origin/main ($sha) → $PAGES_URL ✔"
  else
    log "ERROR: re-assert deploy FAILED (wrangler auth expired? run 'wrangler login'). Retrying next cycle."
  fi
}

check() { # $1 = dryrun(0/1)
  local dry="${1:-0}"
  exec 9>"$LOCK"
  flock -n 9 || { [ "$dry" = 1 ] && say "another run holds the lock"; exit 0; }
  # cap the log so it can't grow unbounded
  [ -f "$LOG" ] && tail -n 500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null || true
  if ! git -C "$REPO" fetch --quiet origin main 2>/dev/null; then
    log "git fetch failed (network?); skipping."; [ "$dry" = 1 ] && say "fetch failed"; exit 0
  fi
  local main_full main_short live
  main_full="$(git -C "$REPO" rev-parse origin/main)"
  main_short="$(git -C "$REPO" rev-parse --short origin/main)"
  live="$(live_commit || true)"

  if [ -z "$live" ]; then
    if version_reachable; then reassert "$main_full" "live version.json missing (a pre-guard deploy overwrote it)" "$dry"
    else log "site unreachable; skipping."; [ "$dry" = 1 ] && say "site unreachable"; fi
    return
  fi
  # Fetch broadly if we don't recognize the live commit (it may be on another branch).
  git -C "$REPO" cat-file -e "$live" 2>/dev/null || git -C "$REPO" fetch --quiet --all 2>/dev/null || true

  if git -C "$REPO" cat-file -e "$live" 2>/dev/null && git -C "$REPO" merge-base --is-ancestor origin/main "$live" 2>/dev/null; then
    # origin/main ⊆ live  →  live is main, or newer main work someone deployed → HEALTHY, leave it.
    [ "$dry" = 1 ] && say "HEALTHY: live ($(git -C "$REPO" rev-parse --short "$live")) contains origin/main ($main_short) — no action."
    log "ok: live contains origin/main ($main_short)."
    return
  fi
  reassert "$main_full" "live=$live is NOT a descendant of origin/main ($main_short) — it's missing main's work" "$dry"
}

install_timer() {
  command -v systemctl >/dev/null || { say "systemctl not found — cannot install a systemd timer here."; exit 1; }
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/gvdg-watchdog.service" <<EOF
[Unit]
Description=GVDG gvdgclub.com deploy watchdog (re-asserts main on clobber)
After=network-online.target

[Service]
Type=oneshot
ExecStart=$SELF
EOF
  cat > "$UNIT_DIR/gvdg-watchdog.timer" <<EOF
[Unit]
Description=Run the GVDG deploy watchdog every ${INTERVAL_SEC}s

[Timer]
OnBootSec=90
OnUnitActiveSec=${INTERVAL_SEC}
AccuracySec=20

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now gvdg-watchdog.timer
  loginctl enable-linger "$USER" 2>/dev/null && say "linger enabled (runs even when logged out)" \
    || say "note: could not enable linger (needs privileges) — the timer runs while you have a session; run 'sudo loginctl enable-linger $USER' to make it survive logout."
  log "watchdog timer installed (every ${INTERVAL_SEC}s)."
  say "✅ watchdog installed. Runs every ${INTERVAL_SEC}s. Log: $LOG"
  systemctl --user list-timers gvdg-watchdog.timer --no-pager 2>/dev/null | sed -n '1,3p'
}

uninstall_timer() {
  systemctl --user disable --now gvdg-watchdog.timer 2>/dev/null || true
  rm -f "$UNIT_DIR/gvdg-watchdog.timer" "$UNIT_DIR/gvdg-watchdog.service"
  systemctl --user daemon-reload 2>/dev/null || true
  log "watchdog timer uninstalled."
  say "🛑 watchdog uninstalled."
}

status() {
  systemctl --user list-timers gvdg-watchdog.timer --no-pager 2>/dev/null || say "(timer not installed)"
  say ""; say "recent log ($LOG):"
  tail -n 15 "$LOG" 2>/dev/null | sed 's/^/  /' || say "  (no log yet)"
}

case "${1:-check}" in
  --install)   install_timer ;;
  --uninstall) uninstall_timer ;;
  --status)    status ;;
  --dry-run)   check 1 ;;
  check|"")    check 0 ;;
  *) say "usage: $0 [--install|--uninstall|--status|--dry-run]"; exit 2 ;;
esac
