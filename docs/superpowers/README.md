# Superpowers Design Records

This directory stores dated specs and implementation plans from previous feature slices. They are useful for
understanding why a feature was built a certain way, but they are not current operational runbooks.

Before acting on one of these records:

1. Read the current root docs: [`README.md`](../../README.md), [`CLAUDE.md`](../../CLAUDE.md),
   [`AGENTS.md`](../../AGENTS.md), [`DESIGN.md`](../../DESIGN.md), and [`STAGING.md`](../../STAGING.md).
2. Check the current code paths named by the spec.
3. Treat old branch names, migration numbers, helper filenames, and "next slice" language as historical
   unless the current code/docs still confirm them.

Current source of truth examples:

- migrations are ordered through `auth-worker/migrations/0025_event_courses.sql`;
- multi-course and multi-layout event assignments live in `event_courses`;
- shared-dev deploys go through `./scripts/gvdg-deploy.sh`;
- React ownership is documented in [`DESIGN.md`](../../DESIGN.md).
