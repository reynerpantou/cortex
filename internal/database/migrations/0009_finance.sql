-- Finance module: a manual income/expense ledger. No bank accounts or
-- balances — just what came in, what went out, what it was for, and what it
-- was paid with. Every table is finance_-prefixed so it can't collide with
-- another module's tables.

-- Single-row settings. base_currency is what every total and chart is
-- reported in; it can only change while the ledger is empty, since each
-- transaction stores its base-currency value at the rate used when entered.
CREATE TABLE finance_settings (
    id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    base_currency TEXT NOT NULL DEFAULT 'IDR' CHECK (base_currency ~ '^[A-Z]{3}$')
);
INSERT INTO finance_settings (id) VALUES (1);

-- Two levels only: a top-level category (parent_id NULL) and its
-- subcategories. A transaction may point at either level.
CREATE TABLE finance_categories (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    parent_id  INTEGER REFERENCES finance_categories(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '',
    position   INTEGER NOT NULL DEFAULT 0,
    -- Removing a category that past transactions still use hides it from
    -- pickers instead of deleting it, so history keeps its label.
    archived   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_finance_categories_parent ON finance_categories(parent_id);

CREATE TABLE finance_payment_methods (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '',
    position   INTEGER NOT NULL DEFAULT 0,
    archived   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- amount/currency is what was actually paid; rate converts one unit of that
-- currency into the base currency and is frozen at entry time, so past totals
-- never drift as exchange rates move.
CREATE TABLE finance_transactions (
    id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind              TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    occurred_on       DATE NOT NULL,
    amount            NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency          TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    rate              NUMERIC(24, 10) NOT NULL CHECK (rate > 0),
    base_amount       NUMERIC(18, 2) NOT NULL,
    category_id       INTEGER REFERENCES finance_categories(id) ON DELETE SET NULL,
    payment_method_id INTEGER REFERENCES finance_payment_methods(id) ON DELETE SET NULL,
    note              TEXT NOT NULL DEFAULT '',
    -- How the row got here. external_id is the upstream identifier (e.g. an
    -- email Message-ID once email sync exists) so re-syncing never duplicates.
    source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'voice', 'email')),
    external_id       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_finance_transactions_occurred ON finance_transactions(occurred_on);
CREATE INDEX idx_finance_transactions_category ON finance_transactions(category_id);
CREATE UNIQUE INDEX idx_finance_transactions_external ON finance_transactions(source, external_id) WHERE external_id IS NOT NULL;

-- A monthly spending cap per top-level expense category, in base currency.
CREATE TABLE finance_budgets (
    category_id INTEGER PRIMARY KEY REFERENCES finance_categories(id) ON DELETE CASCADE,
    amount      NUMERIC(18, 2) NOT NULL CHECK (amount > 0)
);

-- Daily reference-rate cache: one row per currency pair per day, so the
-- entry form's live conversion doesn't hit the upstream API on every keystroke.
CREATE TABLE finance_fx_rates (
    base       TEXT NOT NULL,
    quote      TEXT NOT NULL,
    rate_date  DATE NOT NULL,
    rate       NUMERIC(24, 10) NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (base, quote, rate_date)
);

-- Starter categories. Plain data, fully editable afterwards.
WITH parents (kind, name, icon, position, children) AS (
    VALUES
    ('expense', 'Food',          '🍜', 0,  ARRAY['Breakfast', 'Lunch', 'Dinner', 'Eating out', 'Groceries', 'Coffee & snacks']),
    ('expense', 'Transport',     '🛵', 1,  ARRAY['Fuel', 'Ride-hailing', 'Parking & tolls', 'Public transport']),
    ('expense', 'Housing',       '🏠', 2,  ARRAY['Rent', 'Electricity', 'Water', 'Internet']),
    ('expense', 'Bills',         '🧾', 3,  ARRAY['Phone', 'Streaming', 'Software', 'Insurance']),
    ('expense', 'Shopping',      '🛍️', 4,  ARRAY['Clothing', 'Electronics', 'Household']),
    ('expense', 'Health',        '💊', 5,  ARRAY['Medicine', 'Doctor', 'Fitness']),
    ('expense', 'Entertainment', '🎬', 6,  ARRAY['Movies', 'Games', 'Hobbies']),
    ('expense', 'Travel',        '✈️', 7,  ARRAY['Flights', 'Hotels', 'Activities']),
    ('expense', 'Education',     '📚', 8,  ARRAY['Courses', 'Books']),
    ('expense', 'Personal care', '💈', 9,  ARRAY[]::TEXT[]),
    ('expense', 'Gifts & giving','🎁', 10, ARRAY['Gifts', 'Donations']),
    ('expense', 'Other',         '📦', 11, ARRAY[]::TEXT[]),
    ('income',  'Salary',        '💼', 0,  ARRAY[]::TEXT[]),
    ('income',  'Bonus',         '🎉', 1,  ARRAY[]::TEXT[]),
    ('income',  'Freelance',     '🧑‍💻', 2,  ARRAY[]::TEXT[]),
    ('income',  'Investment',    '📈', 3,  ARRAY['Dividends', 'Interest', 'Capital gains']),
    ('income',  'Gift',          '🎁', 4,  ARRAY[]::TEXT[]),
    ('income',  'Refund',        '↩️', 5,  ARRAY[]::TEXT[]),
    ('income',  'Other',         '📦', 6,  ARRAY[]::TEXT[])
),
inserted AS (
    INSERT INTO finance_categories (kind, name, icon, position)
    SELECT kind, name, icon, position FROM parents
    RETURNING id, kind, name
)
INSERT INTO finance_categories (kind, parent_id, name, position)
SELECT p.kind, i.id, c.name, c.ord - 1
FROM parents p
JOIN inserted i ON i.kind = p.kind AND i.name = p.name
CROSS JOIN LATERAL unnest(p.children) WITH ORDINALITY AS c(name, ord);

INSERT INTO finance_payment_methods (name, icon, position) VALUES
    ('Cash',          '💵', 0),
    ('Bank transfer', '🏦', 1),
    ('Debit card',    '💳', 2),
    ('Credit card',   '💳', 3),
    ('GoPay',         '📱', 4),
    ('OVO',           '📱', 5),
    ('ShopeePay',     '📱', 6);
