-- Finance data becomes per-user, so several people can each keep their own
-- ledger. Rows that already exist belong to the earliest account (the one
-- that created them). On a fresh install no user exists yet when migrations
-- run, so 0009's starter rows have nobody to belong to and are dropped;
-- every account gets its own starter set on first use instead (in Go).

ALTER TABLE finance_settings        ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE finance_categories      ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE finance_payment_methods ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE finance_transactions    ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE finance_budgets         ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

UPDATE finance_settings        SET user_id = (SELECT MIN(id) FROM users);
UPDATE finance_categories      SET user_id = (SELECT MIN(id) FROM users);
UPDATE finance_payment_methods SET user_id = (SELECT MIN(id) FROM users);
UPDATE finance_transactions    SET user_id = (SELECT MIN(id) FROM users);
UPDATE finance_budgets         SET user_id = (SELECT MIN(id) FROM users);

DELETE FROM finance_budgets         WHERE user_id IS NULL;
DELETE FROM finance_transactions    WHERE user_id IS NULL;
DELETE FROM finance_categories      WHERE user_id IS NULL;
DELETE FROM finance_payment_methods WHERE user_id IS NULL;
DELETE FROM finance_settings        WHERE user_id IS NULL;

ALTER TABLE finance_settings        ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE finance_categories      ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE finance_payment_methods ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE finance_transactions    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE finance_budgets         ALTER COLUMN user_id SET NOT NULL;

-- One settings row per user instead of the single global row.
ALTER TABLE finance_settings DROP COLUMN id;
ALTER TABLE finance_settings ADD PRIMARY KEY (user_id);

CREATE INDEX idx_finance_categories_user ON finance_categories(user_id);
CREATE INDEX idx_finance_payment_methods_user ON finance_payment_methods(user_id);
CREATE INDEX idx_finance_budgets_user ON finance_budgets(user_id);
DROP INDEX idx_finance_transactions_occurred;
CREATE INDEX idx_finance_transactions_user_occurred ON finance_transactions(user_id, occurred_on);
DROP INDEX idx_finance_transactions_external;
CREATE UNIQUE INDEX idx_finance_transactions_external
    ON finance_transactions(user_id, source, external_id) WHERE external_id IS NOT NULL;

-- ---- note suggestions ----
-- note_key is the note compared loosely (case and spacing ignored), so
-- "Mie  Gomak" and "mie gomak" count as the same thing.
ALTER TABLE finance_transactions
    ADD COLUMN note_key TEXT GENERATED ALWAYS AS (lower(regexp_replace(btrim(note), '\s+', ' ', 'g'))) STORED;
CREATE INDEX idx_finance_transactions_note ON finance_transactions(user_id, note_key);

-- One row per distinct note per user: the suggestion list. It stays small
-- however large the ledger grows, and is kept in sync on every write.
-- kind/category/payment method come from the note's most recent use, so
-- picking a suggestion can fill them in.
CREATE TABLE finance_notes (
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_key          TEXT NOT NULL,
    note              TEXT NOT NULL,
    kind              TEXT NOT NULL,
    category_id       INTEGER REFERENCES finance_categories(id) ON DELETE SET NULL,
    payment_method_id INTEGER REFERENCES finance_payment_methods(id) ON DELETE SET NULL,
    use_count         INTEGER NOT NULL,
    last_used         DATE NOT NULL,
    PRIMARY KEY (user_id, note_key)
);

-- Trigram index for typo-tolerant search once a user's note list is too big
-- to send to the browser whole.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_finance_notes_trgm ON finance_notes USING gin (note_key gin_trgm_ops);

INSERT INTO finance_notes (user_id, note_key, note, kind, category_id, payment_method_id, use_count, last_used)
SELECT g.user_id, g.note_key,
       (SELECT t.note FROM finance_transactions t
         WHERE t.user_id = g.user_id AND t.note_key = g.note_key
         GROUP BY t.note ORDER BY COUNT(*) DESC, MAX(t.id) DESC LIMIT 1),
       last.kind, last.category_id, last.payment_method_id, g.n, g.last_used
FROM (SELECT user_id, note_key, COUNT(*) AS n, MAX(occurred_on) AS last_used
        FROM finance_transactions WHERE note_key <> '' GROUP BY user_id, note_key) g
CROSS JOIN LATERAL (
    SELECT t.kind, t.category_id, t.payment_method_id FROM finance_transactions t
     WHERE t.user_id = g.user_id AND t.note_key = g.note_key
     ORDER BY t.occurred_on DESC, t.id DESC LIMIT 1
) last;
