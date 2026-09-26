-- Accounts get a role and a list of modules they may open. Admins manage
-- users from the Administration page; modules is the per-user checklist of
-- pages (e.g. {radar,finance}) and is enforced server-side, not just hidden
-- in the UI. Existing accounts keep access to everything, and the earliest
-- one becomes the administrator.
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN modules TEXT[] NOT NULL DEFAULT '{}';
UPDATE users SET modules = '{radar,finance}';
UPDATE users SET is_admin = true WHERE id = (SELECT MIN(id) FROM users);
