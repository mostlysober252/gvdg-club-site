CREATE INDEX IF NOT EXISTS idx_events_date_id ON events(date, id);
CREATE INDEX IF NOT EXISTS idx_events_league_date_id ON events(league_id, date, id);
CREATE INDEX IF NOT EXISTS idx_results_member_created_id ON results(member_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_results_member_event_created ON results(member_id, event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_casual_results_member_created_id ON casual_results(member_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_casual_rounds_finalized_id ON casual_rounds(finalized_at, id);
CREATE INDEX IF NOT EXISTS idx_event_players_member_event ON event_players(member_id, event_id);
