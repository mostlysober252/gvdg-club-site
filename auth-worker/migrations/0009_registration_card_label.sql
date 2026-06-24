-- Track N4: admin card pre-assignment. An admin can group registered players into named cards ahead of
-- time; live-scoring "start" already seeds cards from registrations.card_label when present (added in N1),
-- falling back to starting-hole grouping, then a single auto-split. Members can still self-organize on top.
ALTER TABLE registrations ADD COLUMN card_label TEXT;
