# Mainflix — first-version design

Status: approved; backend implementation in progress.

## Purpose and scope

A private app for four friends to nominate movies, draw one winner each week,
record their individual viewing progress, and share reviews. No server to manage;
use free hosted services within their quotas.

One group, four accounts, one administrator. No public registration, multiple
groups, microservices, Redis, notifications, streaming integration, or email delivery.

## Agreed technology

- React, TypeScript, and Vite frontend.
- Frontend Spanish/English i18n with one JSON file per language. Visual direction:
  Minecraft meets Netflix. Backend errors expose stable codes for translation.
- Express and TypeScript API using MVC: typed entity models, controllers, services, and separate Kysely repositories. All production functions are class methods, with lazy dependency injection via a cached Container class following the user's knucklebones project.
- PostgreSQL hosted on Neon's free plan.
- Vercel hosting for frontend and backend, preferably with same-origin `/api` routing.
- One repository with `frontend/`, `backend/`, and `db/` directories.
- TMDB for catalogue search and movie metadata; required attribution included.
- Email/password accounts with sessions persisted in PostgreSQL. No Google login
  or Supabase dependency.

Deployment details and database access library are builder choices. Keep dependencies
small, use migrations, and select compatible nearby API/database regions. Free quotas
and connection behavior must be checked at deployment; no paid resources by default.

## Weekly selection

- Weeks start Monday at 00:00:00 in `Europe/Madrid`, including daylight-saving
  changes. The interval ends exclusively at the next Monday's boundary.
- Use the API/database clock, never the browser's timezone, to determine the round.
- Each account can nominate one approved, eligible movie per week or explicitly skip.
- When all four have nominated or skipped, a draw is available if nominations exist.
- Each nomination is one equal-weight entry. Two nominations of the same movie give
  it twice the chance of a movie nominated once; the movie itself is not duplicated.
- All four users can initiate the draw. The first committed winner is authoritative;
  concurrent/repeated requests return that same winner.
- Select using a server-side uniform random index over the nominations. The roulette
  only animates the saved outcome; it does not determine it.
- Winning immediately excludes a movie from subsequent draws. Losing nominations
  remain historical records; their movies remain in the catalogue.
- Personal watched status does not determine eligibility. Movies watched before
  Mainflix can be selected. An admin can change a movie's future eligibility.
- A new week has new nominations. Old rounds, winners, personal progress, and reviews
  persist. No carryover of losing nominations is required.

Approved edge-case defaults:

- Users can edit their nomination or skip until the fourth response; then it locks.
- Four skips produces a closed round with no winner.
- An incomplete or undrawn round expires at the Monday boundary, with no late draw.
- No automatic draw: the button still requires a user click.
- Eligibility is rechecked inside the draw transaction. If a nomination became
  ineligible, invalidate that response and reopen the round for its replacement.
- Admin eligibility changes never rewrite a saved winner or past history.

Create/find rounds on demand using a unique local Monday date. This gives the correct
weekly behavior without a cron job. A page open across midnight refreshes its round;
the API rejects stale-week mutations regardless of frontend state.

## Catalogue and approval

- Search existing movies and TMDB; show title, release year, and poster to distinguish
  remakes and similarly named films.
- Use a unique nullable TMDB ID for imported movies. Title alone is not an identity.
- Users can submit missing movies. Only an admin can complete, approve, or reject
  submissions. Pending/rejected entries cannot be nominated.
- Assistant default: all newly submitted movies, including TMDB imports, need admin
  approval; existing approved entries can be nominated immediately.
- Admin can attach metadata or resolve a pending duplicate to an existing movie.
  Do not introduce deletion of referenced approved movies in the first version.
- Store metadata locally and poster URLs, rather than downloading image files.
  Existing catalogue operations, draws, history, and reviews do not depend on TMDB.
- Debounce search and cancel obsolete requests. Bound upstream requests with a timeout
  and display a recoverable error while preserving local search results.

## Personal progress and reviews

- Each account independently marks a selected movie watched, including past weeks.
- All four can see weekly history and each other's progress and reviews.
- One review per account per movie, a required integer 1–5 star rating and optional
  plain-text review. Only the author edits their review.
- Assistant default: users must mark the movie personally watched before reviewing.
  A review survives later admin eligibility changes and any future reselection.
- Personal progress is stored per movie, since it represents having seen the film.
  Assistant default: viewing progress and its timestamp persist if reselected.

## Accounts, sessions, and recovery

- Provision four accounts through a local administrative command; no public signup.
- Email is the login identifier; use consistent normalization and enforce uniqueness.
  It is not verified by outbound email in this version.
- Store password hashes using an established password-hashing library. Never log
  passwords, session secrets, or reset links.
- Use random opaque session tokens in Secure, HttpOnly, SameSite cookies. Store token
  hashes, expiry, and user references in PostgreSQL; do not use process memory.
- Rotate sessions on login, enforce expiry, and revoke sessions on logout/reset.
  Exact expiry durations are builder choices documented in implementation.
- Enforce authentication, membership, admin role, and ownership in the API; validate
  inputs, protect cookie-authenticated mutations from CSRF, rate-limit authentication,
  use generic login failures, and render user text safely.
- Users change passwords with their current password. Admins generate expiring,
  single-use reset links and share them privately. Redemption and session revocation
  are atomic. A local recovery command handles administrator lockout.
- Reset links use the configured trusted application URL, not arbitrary request hosts.
- Database credentials and TMDB tokens remain backend-only environment variables.

## Minimal persistent model

- `users`: normalized unique email, password hash, name, admin flag.
- `sessions`: hashed unique token, user, expiry.
- `password_resets`: hashed unique token, user, expiry, consumption state.
- `movies`: metadata, unique optional TMDB ID, approval state, submitter, future
  selection eligibility, admin eligibility change actor/time.
- `rounds`: unique local Monday date, saved winner, draw actor/time.
- `round_responses`: unique round/user pair, nominated movie or explicit skip.
- `user_watched_movies`: unique user/movie pair, watched timestamp.
- `reviews`: unique user/movie pair, integer rating constrained to 1–5, text,
  creation/update timestamps.

Use foreign keys and database constraints. Lock the round row when submitting the
final response or drawing, recheck the week and eligibility, and atomically save the
winner and exclude its movie from later draws. Admin eligibility updates must use
compatible locking so concurrent actions cannot violate these rules.

## Interface scope

Login/password recovery; current week with search, nomination/skip, participation,
draw button and roulette; winner and personal watched control; history and reviews;
catalogue and submissions; admin approval/eligibility and recovery-link controls.
Loading, empty, expired-round, and recoverable-error states are required. Responsive
layout, labelled forms, keyboard controls, and reduced-motion roulette are required.
Visual styling follows the requested Minecraft/Netflix mix. Polling/refetch is sufficient for four users;
no WebSocket infrastructure is required to share the persisted outcome.

## Verification and operations

Meaningful checks must cover duplicate submissions, nomination weighting, skip/empty
rounds, Monday and daylight-saving boundaries, concurrent draws, eligibility changes,
ownership/admin permissions, review constraints, and reset-token single use/expiry.
Exercise real PostgreSQL transactions for draw concurrency. Verify Vercel routing,
secure cookies, migrations, and database wake-up behavior in a deployed smoke check.

Keep a documented database export/restore procedure and take backups of valued data.
No promise of continuous availability or unchanging free-provider quotas. No service
accounts, hosting projects, dependencies, or product code have been created yet.

## Implementation architecture refinements

User instructions during implementation: do not commit; separate frontend and backend apps; explicitly typed class methods; models separate from repositories; queries executed by Kysely repositories; lazy ContainerProps/getter injection; TableDef, Selectable Tuple, table-map interfaces and AppException/ExceptionService conventions from Documents/Manu/knucklebones-backend.
