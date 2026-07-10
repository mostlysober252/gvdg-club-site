-- Optional per-event schedule + sign-up/check-in cutoffs. All nullable → existing events unaffected.
ALTER TABLE events ADD COLUMN starts_at TEXT;
ALTER TABLE events ADD COLUMN registration_deadline TEXT;
ALTER TABLE events ADD COLUMN checkin_deadline TEXT;

CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_registration_deadline ON events(registration_deadline);
CREATE INDEX IF NOT EXISTS idx_events_checkin_deadline ON events(checkin_deadline);
