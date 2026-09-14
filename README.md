# Cortex

A personal opportunity radar: capture problems the moment you hear them (from
yourself, from other people, or — later — from a daily AI scan), then judge which
are worth building for.

This repository is the **runnable foundation**: authentication, the home
"signal desk", and the Radar (full CRUD over problems), in English / 简体中文 /
Bahasa Indonesia, on a dark theme. The AI ingestion, dedup, and forecasting
layer is the next slice (see [What's next](#whats-next)).

## Stack

- **One Go binary** serves the JSON API *and* the embedded React SPA on a single
  port. Standard library only, plus one dependency: the pure-Go SQLite driver
  (`modernc.org/sqlite`) — so the binary is fully static, no CGO.
- **SQLite file** for storage. Back up by copying the file (or `make backup`,
  which uses SQLite's online `VACUUM INTO`).
- **React + Vite + TypeScript** frontend, `react-i18next` for the three
  languages, built into the Go binary at compile time.

## Run it

### With Docker (simplest)

```bash
docker compose up --build
```

Open http://localhost:8080. On first run a random admin password is generated
and printed to the logs **once** — grab it from `docker compose logs`. To set a
known password instead, uncomment `CORTEX_ADMIN_PASSWORD` in `docker-compose.yml`.

### Locally

```bash
make setup      # install frontend deps (once)
make build      # go mod tidy + build the SPA + compile ./cortex
make run        # start on :8080
```

First run prints the generated admin login. Set `CORTEX_ADMIN_PASSWORD` to
choose your own.

### Frontend dev loop

Run the API and Vite side by side; Vite proxies `/api` to the Go server and
hot-reloads the UI:

```bash
make dev-api    # terminal 1  -> :8080
make dev-web    # terminal 2  -> :5173 (open this one)
```

## Configuration

All via environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `CORTEX_ADDR` | `:8080` | listen address |
| `CORTEX_DB_PATH` | `cortex.db` | SQLite file path |
| `CORTEX_COOKIE_SECURE` | `false` | set `true` behind HTTPS |
| `CORTEX_SESSION_TTL_HOURS` | `168` | login lifetime |
| `CORTEX_ADMIN_USER` | `admin` | seeded username |
| `CORTEX_ADMIN_PASSWORD` | *(generated)* | seeded password on first run |
| `ANTHROPIC_API_KEY` | *(empty)* | reserved for the AI layer |

## Layout

```
cmd/cortex/            entrypoint: config, routing, graceful shutdown, admin seed
internal/config/       env-based configuration
internal/models/       Problem / User + the scope, source, status enums
internal/auth/         PBKDF2 password hashing + DB-backed sessions
internal/database/     SQLite open, embedded migrations, online backup
internal/handlers/     the HTTP API (auth + problems + stats + SPA serving)
internal/middleware/   auth, CSRF, security headers, login rate limiting
internal/assets/       embeds the built SPA
web/                   React + Vite + TypeScript source
```

Problems carry a `scope` (`id` = Indonesia, `row` = rest of world), a `source`
(`personal`, `other`, `ai` — AI is badged distinctly in the UI), a `status`, and
a `recurrence` counter plus a reserved `embedding` BLOB, both there so the dedup
layer can attach repeat sightings without a schema change.

## Notes

- **Security**: passwords are PBKDF2-HMAC-SHA256 (600k iterations); sessions are
  server-side and revocable; CSRF uses a double-submit token; the login endpoint
  is rate-limited. Swapping PBKDF2 for argon2id later is a two-function change in
  `internal/auth/password.go`.
- **Timestamps**: `created_at` / `updated_at` are scanned into `time.Time` via
  the driver's declared-type conversion. If your driver version returns them as
  strings, that's a one-line scan fix — flagged here so it isn't a surprise.
- This foundation was assembled with the Go backend syntax-checked and the
  frontend fully built; the full `go build` runs on your machine once
  `go mod tidy` fetches the SQLite driver (the build sandbox couldn't reach the
  Go module proxy).

## What's next

The AI layer, which needs your `ANTHROPIC_API_KEY` and runs as outbound calls
from the Go server (nothing reaches into your DB):

1. **Daily scan** — an in-process scheduler pulls candidate problems from your
   chosen sources, with a manual "run now" trigger.
2. **Dedup + recurrence** — embed each candidate (local model), compare by
   cosine similarity in Go against stored `embedding` BLOBs, and either attach a
   new sighting (bumping `recurrence`) or create a new problem.
3. **Judgment + forecast** — score solution quality and realistic odds against a
   rubric, producing a Pursue / Watch / Park / Drop verdict with a confidence and
   a "what to validate next".
4. **Business-template runner** — the digital / physical / service deep-dives,
   gated behind high conviction since each is an expensive call.
