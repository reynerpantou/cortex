CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE problems (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scope      TEXT NOT NULL CHECK (scope IN ('id','row')),
    source     TEXT NOT NULL CHECK (source IN ('personal','other','ai')),
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','validated','parked','dropped')),
    source_url TEXT NOT NULL DEFAULT '',
    recurrence INTEGER NOT NULL DEFAULT 1,
    embedding  BLOB,               -- reserved for the AI dedup layer (cosine done in Go)
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_problems_scope  ON problems(scope);
CREATE INDEX idx_problems_source ON problems(source);
CREATE INDEX idx_problems_status ON problems(status);
