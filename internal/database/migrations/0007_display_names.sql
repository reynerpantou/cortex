-- The sign-in username stays a single identifier; a separate, per-language
-- display name is what's actually shown in the UI (sidebar, greeting),
-- picked by the active locale. Default to the existing username so nothing
-- breaks for accounts that never set one.
ALTER TABLE users ADD COLUMN display_name_en TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN display_name_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN display_name_zh TEXT NOT NULL DEFAULT '';
UPDATE users SET display_name_en = username, display_name_id = username, display_name_zh = username;
