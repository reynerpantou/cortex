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
Open http://localhost:8080. Cortex has no passwords: people sign in with
Google or Apple (see [Sign-in](#sign-in-with-google-and-apple)). Until a
provider is set up, sign in with a one-time link:
`docker compose exec cortex /cortex sign-in-link admin`.

### Locally

```bash
make setup      # install frontend deps (once)
make build      # go mod tidy + build the SPA + compile ./cortex
make db         # start just Postgres in Docker
make run        # start on :8080
```

Sign in with Google/Apple once they're configured, or with a one-time link:

```bash
make users              # list accounts (usernames, emails, roles)
make link user=admin    # prints http://localhost:8080/login/link#… (15 minutes, once)
```

Using the Vite dev server? Open the link with `:5173` instead of `:8080`,
or set `CORTEX_PUBLIC_URL=http://localhost:5173`. These commands read the
same `CORTEX_DATABASE_URL` as the server, so export it if yours isn't the default.

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
| `CORTEX_PUBLIC_URL` | `http://localhost:8080` | where people open Cortex; sign-in callbacks go here |
| `CORTEX_ADMIN_USER` | `admin` | owner account created on first run |
| `CORTEX_ADMIN_EMAIL` | *(empty)* | the owner's Google/Apple email (set once if missing) |
| `CORTEX_GOOGLE_CLIENT_ID` / `_SECRET` | *(empty)* | enables Sign in with Google |
| `CORTEX_APPLE_CLIENT_ID` / `_TEAM_ID` / `_KEY_ID` / `_PRIVATE_KEY` | *(empty)* | enables Sign in with Apple (`_PRIVATE_KEY_FILE` also works) |
| `ANTHROPIC_API_KEY` | *(empty)* | reserved for the AI layer |

## Layout

```
cmd/cortex/            entrypoint: config, routing, graceful shutdown, admin seed
internal/config/       env-based configuration
internal/models/       Problem / User + the scope, source, status enums
internal/auth/         DB-backed sessions (tokens stored hashed)
internal/sso/          Sign in with Google / Apple (OpenID Connect)
internal/database/     Postgres open + embedded migrations
internal/handlers/     the HTTP API (auth + problems + stats + SPA serving)
internal/middleware/   auth, CSRF, security headers, sign-in rate limiting
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
   if you ever run the binary outside Docker) to a long random value, set
   `CORTEX_PUBLIC_URL=https://cortex.example.com`, `CORTEX_ADMIN_EMAIL` to
   your own Google/Apple email, and the provider keys (see
   [Sign-in](#sign-in-with-google-and-apple)). Then `docker compose up -d --build`.
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
docker compose exec cortex /cortex list-users                      # who's there
docker compose exec cortex /cortex sign-in-link <username>        # one-time link, 15 minutes
docker compose exec cortex /cortex set-email <username> <email>   # change who signs in as it
docker compose exec cortex /cortex make-owner <username>          # move ownership
```

## Sign-in with Google and Apple

Cortex stores no passwords. It's invite-only: an administrator adds a person
with their email address, and whoever proves that address through Google or
Apple gets in. On first sign-in that Google/Apple account is linked, and
later sign-ins go by the provider's permanent id. Changing someone's email
in Administration unlinks it and signs them out everywhere. A button only
appears once its provider is configured; you can use either or both.

In each provider, the redirect/return URL is
`<CORTEX_PUBLIC_URL>/api/auth/<google|apple>/callback`. For example,
`https://cortex.example.com/api/auth/google/callback`.

**Google** (free):
1. [Google Cloud console](https://console.cloud.google.com) → create a project →
   *APIs & Services → OAuth consent screen*: External, app name, your email.
   Scopes: `openid`, `email`, `profile`. Publish the app (while it's in
   "Testing", only listed test users can sign in).
2. *Credentials → Create credentials → OAuth client ID*, type **Web
   application**. Authorized redirect URI: the Google URL above. For local
   testing, also add `http://localhost:8080/api/auth/google/callback`.
3. Put the client ID and secret in `CORTEX_GOOGLE_CLIENT_ID` and
   `CORTEX_GOOGLE_CLIENT_SECRET`.

**Apple** (needs a paid Apple Developer Program membership, and HTTPS on a
real domain; it can't be tested on localhost):
1. [developer.apple.com](https://developer.apple.com/account) → *Certificates,
   Identifiers & Profiles → Identifiers*: create an **App ID** with *Sign in
   with Apple* enabled.
2. Create a **Services ID** (e.g. `com.example.cortex.web`), enable *Sign in
   with Apple*, *Configure*: primary App ID from step 1, domain
   `cortex.example.com`, return URL the Apple URL above.
3. *Keys* → create a key with *Sign in with Apple*, download the `.p8` (only
   once) and note its Key ID. Your Team ID is at the top right.
4. Set `CORTEX_APPLE_CLIENT_ID` (the Services ID), `CORTEX_APPLE_TEAM_ID`,
   `CORTEX_APPLE_KEY_ID` and `CORTEX_APPLE_PRIVATE_KEY` (the `.p8` contents).

Apple lets people hide their address behind a `@privaterelay.appleid.com`
relay. That relay address won't match an invitation, so ask Apple users to
choose **Share My Email** the first time. If they don't, the sign-in page
shows the relay address, and you can put that in Administration instead.

## Notes

- **Security**
  - No passwords: sign-in is OpenID Connect with Google or Apple
    (authorization code flow with PKCE where supported, a one-time state and
    nonce tied to the browser that started it, and ID tokens checked against
    the provider's signing keys, issuer, audience and expiry). Accounts are
    invite-only by verified email. Sign-in requests are rate-limited per IP.
  - Sessions live on the server, only their SHA-256 hash is stored, and
    they're revocable; changing someone's email signs them out everywhere.
  - CSRF uses a double-submit token, and every write must be sent as JSON.
    Strict CSP, no framing, and API responses are never cached.
  - All SQL is parameterized. React escapes all rendered text, and stored links
    must be `http(s)`.
  - **Roles**: one *owner* (the first account) holds every power and can't be
    edited, demoted or deleted from the app. Only the owner can grant or
    remove the administrator role or change other administrators.
    Administrators manage members.
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
