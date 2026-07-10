-- UDisc export bridge (Option B). UDisc has no import API, so the lowest-friction safe path is to
-- deep-link a player into a NEW scorecard for the exact course, then show their hole-by-hole scores
-- to tap in. That deep link (app.udisc.com/applink/create-scorecard/{id}) needs UDisc's internal
-- NUMERIC course id, which the slug-based udisc_url can't supply — so we store it explicitly.
ALTER TABLE courses ADD COLUMN udisc_course_id TEXT;

-- Per-hole strokes for a finalized ADMIN-EVENT result, so "Add to UDisc" works from the post-round
-- results AND a member's history later. JSON: [{"hole":1,"par":3,"strokes":4}, ...] — only holes the
-- player actually played. (Casual rounds skip D1; their export reads the live round snapshot instead.)
ALTER TABLE results ADD COLUMN scorecard TEXT;
