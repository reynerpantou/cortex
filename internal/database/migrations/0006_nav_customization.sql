-- Per-user sidebar organization: custom named groups, and which group (if
-- any) each nav item (a fixed key like "home" or "radar", not a DB row)
-- currently sits in, plus its order. A nav item with no placement row just
-- renders at the top level in its default order — customizing is opt-in.
CREATE TABLE nav_groups (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_nav_groups_user ON nav_groups(user_id);

CREATE TABLE nav_placements (
    id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    group_id INTEGER REFERENCES nav_groups(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, item_key)
);
CREATE INDEX idx_nav_placements_user ON nav_placements(user_id);
