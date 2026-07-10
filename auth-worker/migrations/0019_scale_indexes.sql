CREATE INDEX IF NOT EXISTS idx_events_status_type_date_id ON events(status, type, date, id);
CREATE INDEX IF NOT EXISTS idx_events_status_date_id ON events(status, date, id);
CREATE INDEX IF NOT EXISTS idx_event_config_open_event ON event_config(registration_open, event_id);
CREATE INDEX IF NOT EXISTS idx_reg_member_event ON registrations(member_id, event_id);
CREATE INDEX IF NOT EXISTS idx_results_member_created ON results(member_id, created_at);
CREATE INDEX IF NOT EXISTS idx_results_member_event ON results(member_id, event_id);
CREATE INDEX IF NOT EXISTS idx_results_event_member ON results(event_id, member_id);
CREATE INDEX IF NOT EXISTS idx_casual_results_member_round ON casual_results(member_id, casual_round_id);
CREATE INDEX IF NOT EXISTS idx_casual_rounds_finalized ON casual_rounds(finalized_at);
