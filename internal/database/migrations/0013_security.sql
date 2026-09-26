-- Security hardening before running on a public server.

-- 1. One permanent owner. The owner is always an administrator, always has
--    every page, and can't be edited, demoted or deleted from the app —
--    recovery goes through the server's command line instead. The earliest
--    administrator becomes the owner.
ALTER TABLE users ADD COLUMN is_owner BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT users_owner_is_admin CHECK (NOT is_owner OR is_admin);
CREATE UNIQUE INDEX users_single_owner ON users (is_owner) WHERE is_owner;
UPDATE users SET is_owner = true WHERE id = (SELECT MIN(id) FROM users WHERE is_admin);

-- 2. Usernames are unique regardless of case, so nobody can register
--    "Admin" next to "admin" to impersonate it.
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

-- 3. Session tokens are stored as SHA-256 hashes, never as-is: a leaked
--    database or backup can't be replayed as a live login.
UPDATE sessions SET token = encode(sha256(convert_to(token, 'UTF8')), 'hex');

-- 4. Failed sign-in tracking, kept in the database (not the browser), so a
--    cooldown survives closing the tab, incognito windows, other browsers
--    and server restarts. key is "ui:<user>|<ip>", "ip:<ip>" or "u:<user>".
CREATE TABLE login_throttle (
    key          TEXT PRIMARY KEY,
    failures     INTEGER NOT NULL DEFAULT 0,
    lock_count   INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Evidence links must be web links; anything else (javascript:, data:)
--    is dropped rather than rendered as a clickable link.
UPDATE radar_evidence SET url = '' WHERE url <> '' AND url !~* '^https?://';
