# Documentation Index

The current operational docs live at the repo root:

- [`README.md`](../README.md) — feature overview, architecture, setup, testing, deployment, API reference, security model.
- [`CLAUDE.md`](../CLAUDE.md) — detailed architecture map and agent-facing implementation notes.
- [`AGENTS.md`](../AGENTS.md) — deploy coordination contract for the shared `gvdgclub.com` environment.
- [`STAGING.md`](../STAGING.md) — current shared-dev environment guide.
- [`HANDOFF.md`](../HANDOFF.md) — maintainer handoff and PR context.
- [`USER-GUIDE.md`](../USER-GUIDE.md) — end-user walkthrough.
- [`DESIGN.md`](../DESIGN.md) — current design system and React ownership map.
- [`CROTTS.md`](../CROTTS.md) — Crotts AI setup and operations.
- [`PAYMENTS.md`](../PAYMENTS.md) — PayPal enablement.
- [`auth-worker/README.md`](../auth-worker/README.md) — Worker overview.
- [`auth-worker/PROVISIONING.md`](../auth-worker/PROVISIONING.md) — member roster/PIN provisioning.

`docs/superpowers/` contains dated implementation specs and plans. Those files are preserved as design
history and reasoning records; they may mention branch names, staged slices, or compatibility shims from the
time they were written. Use the root docs above as the current source of truth before changing code or
deploying.
