# Mainflix

Private weekly movie draws for named groups of family and friends. Two independent TypeScript applications in one npm workspace:

- `backend/`: Express MVC API, class-based services, Kysely repositories, PostgreSQL.
- `frontend/`: React + Vite, class-based components/services, English and Spanish JSON dictionaries, Minecraft/Netflix styling.
- `db/`: versioned PostgreSQL schema.

Signup requires a private invitation link. No Redis, email delivery, or Google login. No production accounts or deployments are created by this repository.

## Groups and invitations

After signing in, choose a group or use the circular **+** button to reveal the new-group form. Hovering the button shows **Create new group**. Names can include emoji, such as **🍿 Family** or **👨‍👩‍👧‍👦 Friends**. Use **Switch group** to return to the chooser. Each group has its own catalogue, eligibility, nominations, weekly draws, history, watched records and reviews. Profiles and private favorites belong to the account; My profile shows personal reviews and favorites across groups. Opening a saved movie from another group selects that movie's group.

**Invite to Mainflix** creates a single-use link for an account without access to the inviter's groups. The recipient can create and name their own first group. **Invite to this group** is available to the group's owner and joins recipients to that named group; the same link can be shared with multiple people. New recipients register with a unique username and password; existing accounts can sign in and accept the invitation. Both link types expire after seven days and are stored hashed. Share them privately using the copyable link; there is no email delivery.

Membership is flexible. If a person joins before the first response, they can vote that week. If voting has started, they can view the group immediately and vote from the next Madrid week. The response count determines readiness from that week's eligible members, with no fixed four-person requirement. The group owner manages its movies and invitations; ownership never grants access to another person's account password reset.

Apply `006_groups.sql` using the existing `npm run db:migrate` before running the updated applications. It preserves account IDs, passwords, sessions, favorites, movie IDs, reviews, nominations and saved winners, and places existing activity in an initial **Mainflix** group owned by the existing app administrator. Back up the existing database before applying the migration. No hosted database is migrated automatically.

Exceptions appear as accessible toast notifications and disappear after five seconds. A new exception restarts that timer; errors raised inside a movie dialog stay visible above the dialog.

## Local setup

Requires Node **22.12+** (or Node 24+) and Docker Compose, or an existing PostgreSQL 17 database.

```bash
npm ci
cp .env.example .env
docker compose up -d db
npm run db:migrate
npm run user:create -- --username you --name You --admin
npm run user:create -- --username friend1 --name Friend1
npm run user:create -- --username friend2 --name Friend2
npm run user:create -- --username friend3 --name Friend3
npm run user:create -- --username friend4 --name Friend4
```

Usernames are required, unique, case-insensitive, and contain 3–32 letters, numbers, or underscores. Email is optional: add `--email you@example.com` when creating an account to enable email login as well. Supplied emails are validated and unique. Sign in with your username or email and password. Migrations preserve existing accounts, passwords, and sessions.

The provisioning command prompts for a hidden password (6–128 characters). For noninteractive provisioning, set `MAINFLIX_PASSWORD` in the process environment; do not put passwords in command arguments, commits, or shared logs. CLI-provisioned users join the initial Mainflix group. There is no fixed voting-member limit. The original app administrator remains a non-voting observer in that group and retains account recovery access. Group creators own their new groups and also participate in voting.

Start the applications in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Open **http://localhost:5173**. Vite forwards `/api` to port 3000. `APP_ORIGIN` must match the browser origin exactly, with no trailing slash. All mutating HTTP requests require that `Origin` header; the browser sends it automatically. Local HTTP uses non-Secure cookies; production uses Secure, HttpOnly, SameSite=Lax cookies. Sessions expire after 30 days.

Set `TMDB_TOKEN` to a TMDB **API Read Access Token** to enable external search/import. Leave it empty to use the local catalogue and manual movie submissions. TMDB credentials never enter the frontend bundle. Search/import calls time out after five seconds. Movie metadata/poster paths are stored locally; posters load from TMDB's image CDN. Follow [TMDB attribution requirements](https://developer.themoviedb.org/docs/faq).

The home page has one **Popular in Spain** section with **La bola negra** and **Ruega por nosotras** pinned first, followed by Romantic comedy, Horror, and Comedy as the group's favorite browsing genres, plus dedicated Barbie and Animation rows. Recently added lists local catalogue submissions newest first. New releases covers theatrical/digital releases in Spain over the last 90 days; Popular lists Spain releases ordered by TMDB's global popularity, not a Spain-only audience ranking. Additional genres are available from the genre selector. Each row loads more independently. Browsing does not import movies automatically; existing rejected/excluded movies remain blocked.

**Random movie** lets a player choose a category and any year, one year, or an inclusive year range. Picks come from TMDB, sampling a random page of its accessible results (up to 500 pages), then a random eligible film on that page. **Accept and nominate** saves the movie and weekly nomination together; **Try again** retains filters and avoids the displayed movie; **Cancel** saves nothing. Random suggestions require TMDB, while local/manual nominations continue working without it.

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

- The **About Mainflix** tab explains groups, anonymous nominations, the draw, the guessing survey, reviews and personal features in English and Spanish.
- Weeks run Monday 00:00 through the next Monday 00:00 in **Europe/Madrid**, including daylight-saving changes.
- Each eligible group member nominates one approved, eligible movie or explicitly skips. Responses can change until every eligible member has responded, then lock. Group owners also vote; the original administrator remains an observer in the migrated group.
- Everyone skipping closes the round without a winner. Incomplete/undrawn rounds expire at Monday midnight. There is no automatic draw.
- Every nomination is one entry. Repeated nominations weight that movie proportionally. Nominations are anonymous: you can see your own pick and who has responded, but other members’ movie choices remain hidden until the guessing survey ends. Public movie payloads omit submitter identity to avoid identifying newly imported nominations.
- Any member can draw. Short database transactions serialize group operations: concurrent clicks return the same saved winner. The roulette only presents that result.
- After the draw animation, eligible members see a guessing survey with one question per nominated movie. Select one or more avatar cards and click **Send** to see percentages, then click **Next** to advance. You can skip a question or the entire survey. Percentages are the share of non-skipped answers selecting each name, so multiple names can total more than 100%. Each answer is final. **Finish** opens a results-only overview of every movie, with no question controls. When all members eligible at draw time finish or skip, actual nominators are highlighted beside the predictions. Observers and later joiners do not block the reveal. Pending surveys remain accessible through History after Monday; older rounds drawn before this feature do not require a survey.
- Winning excludes the movie from later draws immediately. Personal watched progress is independent. Only the group owner can restore eligibility; saved winners never change.
- Losing nominations do not carry over, but their movies stay in the catalogue.
- TMDB imports and manual additions are immediately eligible for nomination. Manual additions are the fallback for films missing from TMDB. Existing rejected/excluded films stay blocked; group owners can still manage metadata and eligibility or resolve older pending entries.
- Each user can mark any approved catalogue movie personally watched, including movies seen before Mainflix; doing so does not remove eligibility. One editable review per user/movie, 0.5–5 diamonds in half-point steps and optional text. Viewing progress is required to review, and survives reselection. The Reviews tab groups everyone’s diamond ratings and text by movie, with recently reviewed movies first.
- The home page’s **To be reviewed** section keeps past weekly selections visible until every voting member in that group has rated them. Observer ratings do not count toward completion; the current weekly movie keeps its existing card.
- Friends’ ratings and review text for weekly selections stay hidden in movie details and the Reviews tab until you submit your own rating for that movie. Marking it watched alone does not unlock reviews. This also applies to past selections and observers; non-selected catalogue movies keep shared reviews.
- Old rounds/reviews persist. No cron task is needed: the API determines the current round from server time on each request; the frontend refreshes every five seconds while visible.

## Personal profiles and favorites

The circular avatar menu opens **My profile**, which contains display name, unique login username, profile photo, personal reviews, private favorite movies, and password change. Renaming an account preserves its sessions, nominations and reviews; use the new username on the next login. Changing the password still signs out all sessions.

Photos accept PNG/JPEG/WebP up to 5 MB in the browser, are center-cropped to a 128×128 WebP thumbnail, and stored in PostgreSQL (maximum 16 KiB encoded image data). Removing a photo restores the default creeper picture. No file-storage service is needed for these small thumbnails.

Favorite movies can be added from local/TMDB cards or movie details and removed from details or My profile. A TMDB favorite imports metadata, but never nominates the film, marks it watched, or restores rejected/excluded eligibility. Favorites and personal reviews are scoped to the authenticated account.

Apply migration `005_profiles_favorites.sql` with the existing `npm run db:migrate` command before deploying this version. It preserves existing accounts, sessions and reviews.

## Password recovery

Users can change a known password in the UI. When a password is forgotten, the admin generates a private reset link in the Accounts panel and shares it directly. Links expire after 30 minutes and work once. Password changes/resets revoke all that user's sessions and outstanding reset links. Tokens are stored hashed in PostgreSQL; passwords use Node's scrypt.

If the admin is locked out:

```bash
npm run user:reset -- --username you
```

Run this locally with the target database credentials. It prints a private reset link using `APP_ORIGIN`; treat the output as a secret. No email or paid domain is required. Login, password-change, and reset attempts are rate-limited in PostgreSQL so limits also work across serverless instances.

## API

All routes except health, login, reset, logout, invitation preview and invitation registration require a session cookie. Movie and round requests carry `X-Mainflix-Group: <id>`; membership is verified on every request. Omitting the header supports the initial group only when the account belongs to it. `/api/admin/movies/*` requires group ownership; `/api/admin/users*` additionally requires the original app administrator. User identity comes only from the session. Account profile endpoints do not require a group.

| Method | Path | Body / result |
|---|---|---|
| GET | `/api/health` | Process health (does not check the DB) |
| GET / POST | `/api/groups` | List your groups / create `{name}` |
| POST | `/api/invitations` | `{}` for an app invitation, or `{groupId}` for an owner-issued group invitation → private URL + expiry |
| GET | `/api/invitations/:token` | Public preview: group name (or null) + expiry |
| POST | `/api/invitations/:token/accept` | Signed-in account accepts the link |
| POST | `/api/auth/register` | `{token,username,password,name?}` → new account + session cookie |
| GET | `/api/auth/favorites` | Your private favorites across groups; supports limit/offset |
| GET | `/api/auth/reviews` | Your own reviews across groups; supports limit/offset |
| POST | `/api/auth/login` | `{identifier,password}` (username or email; legacy `{email,password}` also accepted) → user + cookie |
| PATCH | `/api/auth/me` | Any nonempty subset of `{name,username,avatar}`; avatar is a bounded WebP data URL or `null` |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Revoke cookie session |
| PUT | `/api/auth/password` | `{currentPassword,password}`; revokes sessions |
| POST | `/api/auth/reset` | `{token,password}`; revokes sessions |
| GET | `/api/rounds/current` | Current round, responses, members and winner |
| GET | `/api/rounds/:week` | That week’s round and saved survey progress, including previous weeks |
| POST | `/api/rounds/:week/survey` | `{movieId,userIds:number[]\|null}` sends or skips one question; `{finish:true}` completes answered survey; `{skip:true}` skips remaining questions and completes |
| GET | `/api/rounds?limit=30&offset=0` | Round history |
| PUT | `/api/rounds/:week/response` | `{movieId:number}`, `{movieId:null}` to skip, or `{tmdbId:number}` to import and nominate atomically; optional `language=es` |
| POST | `/api/rounds/:week/draw` | Saved shared result; `week` is `YYYY-MM-DD` |
| GET | `/api/movies?q=title&language=es&limit=30&offset=0` | `{local,remote,remoteError}` |
| GET | `/api/movies/to-review` | Selected weekly movies still missing a voting member’s review, most recent selection first |
| GET | `/api/movies/reviews?limit=30&offset=0` | Reviewed movies, newest review first; weekly selections return `reviews: []` and `reviewsLocked: true` until you review them; `mine=true` returns only your reviews |
| GET | `/api/movies/favorites?limit=30&offset=0` | Your favorite local movies |
| POST | `/api/movies/favorites?language=es` | `{tmdbId}` imports and favorites atomically |
| PUT / DELETE | `/api/movies/:id/favorite` | Add/remove your favorite; empty body |
| GET | `/api/movies/browse?category=horror&language=es&page=1` | `{local,remote,remoteError,page,totalPages}`; categories: `featured`, `romanticComedy`, `horror`, `comedy`, `recentlyAdded`, `newReleases`, `popular`, `action`, `scienceFiction`, `drama`, `thriller`, `animation`, `adventure`, `fantasy`, `romance`, `barbie`; pages 1–500; optional inclusive `yearFrom`/`yearTo` filters for TMDB discovery |
| POST | `/api/movies?language=es` | `{tmdbId}` or `{title,releaseYear?}` → approved movie |
| GET | `/api/movies/:id` | Movie, personal watched records and reviews; weekly selections return `reviews: []` and `reviewsLocked: true` until you review them |
| PUT | `/api/movies/:id/watched` | `{}` → mark your viewing progress |
| PUT | `/api/movies/:id/review` | `{rating,text?}` → create/edit your review |
| GET | `/api/admin/movies/pending` | Pending movies; supports limit/offset |
| PATCH | `/api/admin/movies/:id` | Any of `{title,releaseYear,overview,tmdbId,approvalStatus,eligible}` |
| POST | `/api/admin/movies/:id/merge` | `{targetId}` → reuse existing movie |
| GET | `/api/admin/users` | Account recovery list; app administrator only |
| POST | `/api/admin/users/:id/reset` | Private recovery URL + expiry |

Pagination defaults to 30, maximum 100. Reviews are plain text, maximum 10000 characters. Unknown body properties are rejected. Local search continues to work when TMDB is unavailable.

Apply `007_anonymous_nominations_survey.sql` with the existing `npm run db:migrate` before running this version. It adds survey storage and preserves all accounts, nominations, winners and reviews. Already drawn rounds remain revealed without a retroactive survey. No hosted database is migrated automatically.

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
2. Use that URL as `DATABASE_URL` locally to run migrations and provision initial accounts as needed. Back up an existing database before applying migrations.
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

Alternatively, install Playwright's Chromium and WebKit with `npx playwright install chromium webkit` and omit `CHROME_PATH`. WebKit is also required when using installed Chrome: the mobile profile-menu regression runs in both engines. Linux needs Playwright's WebKit system libraries. Screenshots are written under `/tmp/mainflix-*.png`. E2E tests provision disposable `friend1@example.com` through `friend4@example.com` voting profiles and a separate `admin@example.com` account, with the password `Browser test password!`. Never use these credentials in production.

Local demo captures are in `docs/previews/desktop.png`, `iphone-se.png`, `iphone-se-viewport.png`, and `iphone-se-movie.png`. They contain disposable sample data, not real accounts or reviews.
