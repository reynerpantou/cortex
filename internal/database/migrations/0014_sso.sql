-- Sign-in moves to Google and Apple. Cortex stops storing passwords at all:
-- an account is identified by its email address, and the Google/Apple
-- account that proves that address is linked on first sign-in.

-- 1. Every account gets an email address — the invitation. Only someone who
--    can sign in to Google/Apple with this exact address gets in. Existing
--    accounts start without one; set it from Administration, or for the
--    owner with `cortex set-email`.
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

-- 2. Linked sign-in accounts. provider + subject is the provider's own
--    permanent id for the person (it survives them changing their email).
CREATE TABLE user_identities (
    provider   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject),
    UNIQUE (user_id, provider)
);

-- 3. Sign-ins in progress (the few minutes spent on Google's/Apple's page).
--    id is SHA-256 of the state parameter; browser is SHA-256 of a cookie set
--    in the same browser, so a sign-in started elsewhere can't be finished
--    here (login CSRF).
CREATE TABLE auth_flows (
    id         TEXT PRIMARY KEY,
    browser    TEXT NOT NULL,
    provider   TEXT NOT NULL,
    nonce      TEXT NOT NULL,
    verifier   TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 4. One-time sign-in links made on the server (`cortex sign-in-link`), for
--    recovery and first setup. Stored hashed; single use; short-lived.
CREATE TABLE sign_in_links (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 5. No passwords any more: drop the hashes and the failed-password counters.
ALTER TABLE users DROP COLUMN password_hash;
DROP TABLE login_throttle;
