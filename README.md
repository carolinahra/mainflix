# Mainflix

Private weekly movie draws for four friends. Two independent TypeScript applications in one npm workspace:

- `backend/`: Express MVC API, class-based services, Kysely repositories, PostgreSQL.
- `frontend/`: React + Vite, class-based components/services, English and Spanish JSON dictionaries, Minecraft/Netflix styling.
- `db/`: versioned PostgreSQL schema.

No public signup, Redis, email delivery, or Google login. No production accounts or deployments are created by this repository.

## Local setup

Requires Node **22.12+** (or Node 24+) and Docker Compose, or an existing PostgreSQL 17 database.

```bash
npm ci
cp .env.example .env
docker compose up -d db
npm run db:migrate
npm run user:create -- --username you --name You --admin
npm run user:create -- --username friend2 --name Friend2
npm run user:create -- --username friend3 --name Friend3
npm run user:create -- --username friend4 --name Friend4
```

Usernames are required, unique, case-insensitive, and contain 3–32 letters, numbers, or underscores. Email is optional: add `--email you@example.com` when creating an account to enable email login as well. Supplied emails are validated and unique. Sign in with your username or email and password. Migrations preserve existing accounts, passwords, and sessions.

The provisioning command prompts for a hidden password (6–128 characters). For noninteractive provisioning, set `MAINFLIX_PASSWORD` in the process environment; do not put passwords in command arguments, commits, or shared logs. Exactly four accounts and at most one admin are allowed. Create your admin first.

Start the applications in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Open **http://localhost:5173**. Vite forwards `/api` to port 3000. `APP_ORIGIN` must match the browser origin exactly, with no trailing slash. All mutating HTTP requests require that `Origin` header; the browser sends it automatically. Local HTTP uses non-Secure cookies; production uses Secure, HttpOnly, SameSite=Lax cookies. Sessions expire after 30 days.

Set `TMDB_TOKEN` to a TMDB **API Read Access Token** to enable external search/import. Leave it empty to use the local catalogue and manual movie submissions. TMDB credentials never enter the frontend bundle. Search/import calls time out after five seconds. Movie metadata/poster paths are stored locally; posters load from TMDB's image CDN. Follow [TMDB attribution requirements](https://developer.themoviedb.org/docs/faq).

## Architecture

`Container` follows the lazy cached getter pattern in the user's knucklebones project. Constructors receive dependencies; optional setters allow injecting the test database, clock, lottery, or external API. The HTTP application resolves controllers on first use, so building the container/health endpoint does not connect to PostgreSQL.

```text
HTTP → controller → service → repository → PostgreSQL
                      ↓
                entity interfaces
```

- `backend/src/controllers/`: strict request validation and HTTP responses; each class owns an Express router.
- `backend/src/services/`: authentication, catalogue, weekly selection, reviews, clock, cryptography and TMDB.
- `backend/src/models/`: public entity/response interfaces, separate from persistence.
- `backend/src/repositories/`: all Kysely queries and transaction/migration infrastructure.
- `backend/src/shared/database-models/`: `TableDef` + `Selectable<...>` tuple + table-map interfaces, following knucklebones.
- `backend/src/shared/exceptions/`: typed `AppException` subclasses; `ExceptionService` maps known exceptions and hides unexpected internals.

Production functions are class methods. Database schema types are composed from table-map interfaces; there is no `any` in application source. SQL is limited to migrations and PostgreSQL expressions/locks that Kysely does not abstract. Repositories execute all queries. No empty base-repository layer or generic CRUD framework.

The frontend uses one dictionary per language: `frontend/src/locales/en.json` and `es.json`. The language choice persists in local storage. API errors contain `{code,message,statusCode}`; UI text uses the translated code rather than the server message. API DTO types are shared with the frontend as type-only imports; dates serialize to strings.

## Rules

- Weeks run Monday 00:00 through the next Monday 00:00 in **Europe/Madrid**, including daylight-saving changes.
- A user nominates one approved, eligible movie or explicitly skips. Responses can change until all four have responded, then lock.
- Four skips close the round without a winner. Incomplete/undrawn rounds expire at Monday midnight. There is no automatic draw.
- Every nomination is one entry. Repeated nominations weight that movie proportionally.
- Any member can draw. Short database transactions serialize group operations: concurrent clicks return the same saved winner. The roulette only presents that result.
- Winning excludes the movie from later draws immediately. Personal watched progress is independent. Only the admin can restore eligibility; saved winners never change.
- Losing nominations do not carry over, but their movies stay in the catalogue.
- New TMDB imports and manual entries need admin approval. Pending/rejected films cannot be nominated. Admins complete metadata or merge pending duplicates.
- Each user can mark any approved catalogue movie personally watched, including movies seen before Mainflix; doing so does not remove eligibility. One editable review per user/movie, integer 1–5 stars and optional text. Viewing progress is required to review, and survives reselection.
- Old rounds/reviews persist. No cron task is needed: the API determines the current round from server time on each request; the frontend refreshes every five seconds while visible.

## Password recovery

Users can change a known password in the UI. When a password is forgotten, the admin generates a private reset link in the Accounts panel and shares it directly. Links expire after 30 minutes and work once. Password changes/resets revoke all that user's sessions and outstanding reset links. Tokens are stored hashed in PostgreSQL; passwords use Node's scrypt.

If the admin is locked out:

```bash
npm run user:reset -- --username you
```

Run this locally with the target database credentials. It prints a private reset link using `APP_ORIGIN`; treat the output as a secret. No email or paid domain is required. Login, password-change, and reset attempts are rate-limited in PostgreSQL so limits also work across serverless instances.

## API

All routes except health, login, reset, and logout require a session cookie. `/api/admin/*` also requires an admin account. User identity comes only from the session.

| Method | Path | Body / result |
|---|---|---|
| GET | `/api/health` | Process health (does not check the DB) |
| POST | `/api/auth/login` | `{identifier,password}` (username or email; legacy `{email,password}` also accepted) → user + cookie |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Revoke cookie session |
| PUT | `/api/auth/password` | `{currentPassword,password}`; revokes sessions |
| POST | `/api/auth/reset` | `{token,password}`; revokes sessions |
| GET | `/api/rounds/current` | Current round, responses, members and winner |
| GET | `/api/rounds?limit=30&offset=0` | Round history |
| PUT | `/api/rounds/:week/response` | `{movieId:number}` or `{movieId:null}` to skip |
| POST | `/api/rounds/:week/draw` | Saved shared result; `week` is `YYYY-MM-DD` |
| GET | `/api/movies?q=title&language=es&limit=30&offset=0` | `{local,remote,remoteError}` |
| POST | `/api/movies?language=es` | `{tmdbId}` or `{title,releaseYear?}` → pending movie |
| GET | `/api/movies/:id` | Movie, personal watched records and reviews |
| PUT | `/api/movies/:id/watched` | `{}` → mark your viewing progress |
| PUT | `/api/movies/:id/review` | `{rating,text?}` → create/edit your review |
| GET | `/api/admin/movies/pending` | Pending movies; supports limit/offset |
| PATCH | `/api/admin/movies/:id` | Any of `{title,releaseYear,overview,tmdbId,approvalStatus,eligible}` |
| POST | `/api/admin/movies/:id/merge` | `{targetId}` → reuse existing movie |
| GET | `/api/admin/users` | Four account details |
| POST | `/api/admin/users/:id/reset` | Private recovery URL + expiry |

Pagination defaults to 30, maximum 100. Reviews are plain text, maximum 10000 characters. Unknown body properties are rejected. Local search continues to work when TMDB is unavailable.

## Verification

Use a **separate disposable PostgreSQL database whose name ends in `_test`**. Tests refuse other names and never read `DATABASE_URL`. They reset the test database between tests.

```bash
docker compose up -d --wait db-test
npm test
npm run typecheck
npm run build
npm audit
```

Tests exercise real PostgreSQL transactions for authentication, concurrent draws, weighting, approval/invalidation, review ownership, recovery, rate limiting and Madrid DST boundaries. TMDB tests replace only the external HTTP response; no real API credentials are required.

## Vercel + Neon

1. Create a free Neon PostgreSQL project in a region near your Vercel backend. Copy the **pooled** connection URL and keep its TLS parameters (`sslmode=require` or the provider's stronger verified settings). Never disable certificate verification.
2. Use that URL as `DATABASE_URL` locally to run migrations and provision the four accounts. Back up an existing database before applying migrations.
3. Create a Vercel project with **Root Directory `backend`** and the Express framework preset. Set `DATABASE_URL`, `APP_ORIGIN` (your frontend's final HTTPS origin), `NODE_ENV=production`, and optional `TMDB_TOKEN`.
4. Create a frontend Vercel project with **Root Directory `frontend`**, Vite preset, build `npm run build`, output `dist`. Enable inclusion of files outside the root directory for workspace/type-only imports.
5. Add the frontend rewrite below using your backend's deployment hostname, keeping it before SPA fallback. The browser calls the frontend's `/api`; cookies remain on the frontend origin. Do not call the separate backend hostname directly from browser code.

```json
{
  "rewrites": [
    {"source":"/api/:path*","destination":"https://YOUR-BACKEND.vercel.app/api/:path*"},
    {"source":"/:path*","destination":"/index.html"}
  ]
}
```

Use a stable frontend URL for `APP_ORIGIN`; preview URLs are not automatically trusted. Vercel handles HTTPS. Local Docker is for development/tests only; it is not a production dependency. Connection pools are bounded and group mutations never keep a transaction open while calling TMDB.

Deployment requires your Vercel/Neon/TMDB accounts. Hosted routing, TLS, cookies and database wake-up latency must be smoke-tested after configuration. Free quotas may change; this project does not enable paid services automatically. Keep database connection URLs and reset links out of Git.

## Backups

Export the database to a private location regularly and before schema changes:

```bash
pg_dump --dbname="$DATABASE_URL" --format=custom --file=mainflix-backup.dump
```

Restore into a **new empty database** first:

```bash
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl mainflix-backup.dump
```

Backups contain private account hashes and reviews. Store them outside the repository, restrict access, and verify restoration periodically. No scheduled backup service is provisioned.

## Browser and iPhone SE checks

`frontend/e2e/mainflix.test.ts` runs real Playwright flows against the local apps: four browser accounts nominate/draw, review a movie, change language, and verify that expired admin sessions cannot leak cached UI to another account. It also checks login, catalogue, nominations, and the review dialog with the **iPhone SE (3rd generation), 375×667** device profile and a **320×568** viewport. This is browser emulation, not a physical iPhone/Safari test.

The E2E fixture resets only `E2E_DATABASE_URL` (default `mainflix_smoke_test` on port 55433); it refuses database names without `_test`. Start a backend pointing to that same database, plus the frontend, before running:

```bash
# Create this once in the disposable test container:
docker compose exec db-test createdb -U mainflix mainflix_smoke_test

# Terminal 1:
DATABASE_URL=postgres://mainflix:mainflix@localhost:55433/mainflix_smoke_test npm run dev:backend
# Terminal 2:
npm run dev:frontend
# Terminal 3 (use CHROME_PATH if using an installed Chrome):
CHROME_PATH=/usr/bin/google-chrome npm run test:e2e --workspace frontend
```

Alternatively, install Playwright's Chromium with `npx playwright install chromium` and omit `CHROME_PATH`. Screenshots are written under `/tmp/mainflix-*.png`. E2E tests provision disposable `friend1@example.com` through `friend4@example.com` accounts, with the password `Browser test password!`; friend1 is the demo admin. Never use these credentials in production.

Local demo captures are in `docs/previews/desktop.png`, `iphone-se.png`, `iphone-se-viewport.png`, and `iphone-se-movie.png`. They contain disposable sample data, not real accounts or reviews.
