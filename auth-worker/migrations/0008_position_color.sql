-- Track O: tees & targets gain an admin-assignable COLOR (e.g. Blue tee / Red basket), edited in the
-- map/SAFARI course editor and rendered as swatches.
--
-- COORDINATION NOTE (cross-track): the parallel `feat/tee-sign-capture` track's spec also adds this exact
-- column (`ALTER TABLE course_positions ADD COLUMN color`). The two branches both stack on
-- feat/events-d1-schema, so EXACTLY ONE of them must add the column on merge — this migration is that one.
-- When integrating the tee-sign track, drop its duplicate ADD COLUMN and let it read this column instead.
-- (The tee-sign spec wanted 0007_tee_signs.sql, but 0007 here is casual_rounds; tee-signs renumbers to 0009+.)
ALTER TABLE course_positions ADD COLUMN color TEXT;
