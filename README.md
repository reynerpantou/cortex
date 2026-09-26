# Cortex

A personal command center. Home is a module hub — each module is a self-contained
personal tool; Radar (capture business problems the moment you hear them, then
judge which are worth building for) is the first one.

This repository is the **runnable foundation**: authentication, the Home module
hub, and the Radar module (full CRUD over problems), in English / 简体中文 /
Bahasa Indonesia, on a dark theme. The AI ingestion, dedup, and forecasting
layer is Radar's next slice (see [What's next](#whats-next)); further modules
beyond Radar are added later by registering them in `web/src/lib/modules.ts`.

## Stack

- **One Go binary** serves the JSON API *and* the embedded React SPA on a single
  port. Standard library only, plus one dependency: the pure-Go Postgres driver
  (`github.com/jackc/pgx/v5`) — so the binary is fully static, no CGO.
- **Postgres** for storage — not committed to the repo. Locally it runs as a
  Docker container (`make db` or `docker compose up`, data in a named volume);
  point `CORTEX_DATABASE_URL` at any other Postgres instance (a managed host,
  etc.) to use that instead. Back up with `make backup` (`pg_dump`).
- **React + Vite + TypeScript** frontend, `react-i18next` for the three
  languages, built into the Go binary at compile time.

## Run it

### With Docker (simplest)

```bash
docker compose up --build
```

Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD` first — compose
refuses to start without one. This starts Postgres and the app together.
Open http://localhost:8080. On first run a random owner password is generated
and printed to the logs **once** — grab it from `docker compose logs`. To set
a known password instead, set `CORTEX_ADMIN_PASSWORD` in `.env`.

### Locally

```bash
make setup      # install frontend deps (once)
make build      # go mod tidy + build the SPA + compile ./cortex
make db         # start just Postgres in Docker
make run        # start on :8080
```

First run prints the generated admin login. Set `CORTEX_ADMIN_PASSWORD` to
choose your own.

### Frontend dev loop

Run the API and Vite side by side; `dev-api` also starts Postgres. Vite
proxies `/api` to the Go server and hot-reloads the UI:

```bash
make dev-api    # terminal 1  -> starts Postgres + go run ./cmd/cortex on :8080
make dev-web    # terminal 2  -> :5173 (open this one)
```

## Configuration

All via environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `CORTEX_ADDR` | `:8080` | listen address |
| `CORTEX_DATABASE_URL` | `postgres://cortex:cortex@localhost:5432/cortex?sslmode=disable` | Postgres connection string |
| `CORTEX_COOKIE_SECURE` | `true` | HTTPS-only cookies (browsers allow them on `http://localhost`) |
| `CORTEX_SESSION_TTL_HOURS` | `168` | login lifetime |
| `CORTEX_TRUSTED_PROXIES` | *(empty)* | reverse-proxy IPs/CIDRs whose `X-Forwarded-For` is believed |
| `CORTEX_LOGIN_MAX_ATTEMPTS` | `5` | wrong passwords per username + IP before a cooldown |
| `CORTEX_LOGIN_LOCKOUT_MINUTES` | `15` | first cooldown; repeats double, up to 24h |
| `CORTEX_ADMIN_USER` | `admin` | owner account created on first run |
| `CORTEX_ADMIN_PASSWORD` | *(generated)* | its password on first run |
| `ANTHROPIC_API_KEY` | *(empty)* | reserved for the AI layer |

## Layout

```
cmd/cortex/            entrypoint: config, routing, graceful shutdown, admin seed
internal/config/       env-based configuration
internal/models/       Problem / User + the scope, source, status enums
internal/auth/         PBKDF2 password hashing + DB-backed sessions
internal/database/     Postgres open + embedded migrations
internal/handlers/     the HTTP API (auth + problems + stats + SPA serving)
internal/middleware/   auth, CSRF, security headers, login rate limiting
internal/assets/       embeds the built SPA
web/                   React + Vite + TypeScript source
```

Problems carry a `scope` (`id` = Indonesia, `row` = rest of world), a `source`
(`personal`, `other`, `ai` — AI is badged distinctly in the UI), a `status`, and
a `recurrence` counter plus a reserved `embedding` BYTEA column, both there so
the dedup layer can attach repeat sightings without a schema change.

## Querying the database from Claude Code (dev only)

A project-scoped MCP server is checked in at `.mcp.json`, wired to the same
Postgres this app uses (via [DBHub](https://github.com/bytebase/dbhub), the
example Claude Code's own docs use for Postgres). Run `make db` (or
`docker compose up`) first so something is listening on `localhost:5432`,
then open this repo in Claude Code locally — it'll prompt you to approve the
`postgres` MCP server once, after which you can ask it to inspect schema or
run queries directly. This is a dev convenience only; the running app never
goes through MCP, it talks to Postgres directly via `internal/database`.

## Deploying to a VPS

1. Point a domain at the server and open only ports 22, 80 and 443 in the
   firewall (`ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`).
   Docker publishes Cortex and Postgres on 127.0.0.1 only, so neither is
   reachable from outside.
2. `cp .env.example .env`, set `POSTGRES_PASSWORD` (and `CORTEX_DATABASE_URL`
   if you ever run the binary outside Docker) to a long random value, then
   `docker compose up -d --build` and note the owner password from the logs.
3. Put HTTPS in front with [Caddy](https://caddyserver.com), which fetches and
   renews the certificate by itself. `/etc/caddy/Caddyfile`:

   ```
   cortex.example.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```

   Caddy replaces any `X-Forwarded-For` the visitor sent with their real
   address, and compose already trusts Docker's network as the proxy, so
   sign-in limits apply per real visitor.
4. Back up with `make backup` (on a schedule, and off the server).

**Account recovery** happens on the server, never through the web app:

```bash
docker compose exec cortex /cortex reset-password <username>   # prompts for the password
docker compose exec cortex /cortex unlock <username>           # clear sign-in cooldowns
docker compose exec cortex /cortex make-owner <username>       # move ownership
```

## Notes

- **Security**
  - Passwords are PBKDF2-HMAC-SHA256 (600k iterations). Sessions live on the
    server, only their SHA-256 hash is stored, and they're revocable; changing
    or resetting a password signs out every other device.
  - Sign-in limits are stored in the database, keyed by username + IP, IP
    alone, and username alone. Closing the tab, incognito windows, another
    browser or a restart don't reset them.
  - CSRF uses a double-submit token, and every write must be sent as JSON.
    Strict CSP, no framing, and API responses are never cached.
  - All SQL is parameterized. React escapes all rendered text, and stored links
    must be `http(s)`.
  - **Roles**: one *owner* (the first account) holds every power and can't be
    edited, demoted or deleted from the app. Only the owner can grant or
    remove the administrator role or change other administrators.
    Administrators manage members.
  - Swapping PBKDF2 for argon2id later is a two-function change in
    `internal/auth/password.go`.
- This foundation was verified end-to-end (build, vet, and a live run through
  login/CRUD/logout) against a local Postgres container.

## What's next

The AI layer, which needs your `ANTHROPIC_API_KEY`:

1. **Daily scan** — fetch candidate problems from chosen sources.
2. **Dedup + recurrence** — embed each candidate (local model), compare by
   cosine similarity against stored `embedding` values, and either attach a
   new sighting (bumping `recurrence`) or create a new problem.
3. **Judgment + forecast** — score solution quality and realistic odds against a
   rubric, producing a Pursue / Watch / Park / Drop verdict with a confidence and
   a "what to validate next".
4. **Business-template runner** — the digital / physical / service deep-dives,
   gated behind high conviction since each is an expensive call.

**Trigger mechanism (decided, not yet built):** instead of an in-process Go
scheduler calling the Anthropic API directly, the daily job will run as a
local, headless Claude Code CLI invocation (`claude -p "..." --permission-mode
acceptEdits` on a cron/launchd schedule on your machine), doing the fetch →
dedup → judge → forecast pipeline itself against Postgres — so it only runs
while your machine is on, same constraint as the original in-process-cron
plan. Note: a Claude Code Web (cloud) session and your local Claude Code CLI
do **not** share live context or session state — they're separate
environments with separate history. The only continuity between them is
whatever is committed to this repo (code, migrations, this README/CLAUDE.md).
This is set up once your local Claude Code CLI is installed; nothing in the
codebase depends on it yet.
