-- Which Stats widgets are shown, and in what order: a JSON array of
-- {"key": "...", "visible": true}. NULL means the default layout.
ALTER TABLE finance_settings ADD COLUMN stats_layout JSONB;
