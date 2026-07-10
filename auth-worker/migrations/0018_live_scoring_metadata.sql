ALTER TABLE event_config ADD COLUMN live_scoring_config TEXT;
ALTER TABLE results ADD COLUMN scoring_group TEXT;
ALTER TABLE results ADD COLUMN match_result TEXT;
ALTER TABLE casual_rounds ADD COLUMN scoring_config TEXT;
ALTER TABLE casual_results ADD COLUMN scoring_group TEXT;
ALTER TABLE casual_results ADD COLUMN match_result TEXT;
