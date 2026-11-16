# Anonymous nominations and post-draw guessing survey

Status: approved. Multiple names and an explicit Send button confirmed by the user.

## Requested behavior

- Weekly movie nominations are anonymous.
- The guessing survey opens just after the weekly movie has been drawn.
- Every nominated movie is a survey question: who do you think nominated it?
- Show the percentage of answers for each person offered as an option.
- Questions advance only when the user clicks Next.
- Reveal who nominated what once everybody has answered or skipped the survey.
- User-requested refinement: Finish shows only a modern overview of all results,
  without question controls. Questions use selectable avatar cards, progress and
  smooth percentage results; confirmed nominators appear only after the reveal.

## Approach

Extend the existing RoundController, RoundService, RoundRepository and React
Mainflix component. Add one PostgreSQL migration and a table for each member's
survey answers and completion/skip status, scoped by group and week. Existing
group transaction locks protect submissions and the final reveal.

A separate survey service or polling dependency would add another flow to
maintain. Browser-only answers would lose submissions on refresh and could not
reliably coordinate the reveal across accounts. Reuse the existing five-second
round refresh and server-controlled round state.

## Proposed interaction

1. During nominations, show who has responded, but keep their movie choices
   hidden from other members. Each person can still see and change their own
   choice while nominations are open.
2. Keep the existing weighted movie draw. The roulette uses anonymous movie
   entries; it must not disclose nomination authors through its entry ordering.
3. Immediately after the roulette finishes, open the survey for eligible members
   who have not completed or skipped it. Refreshing must resume saved progress;
   replaying the roulette must not clear or restart a completed survey.
4. Show one question per distinct nominated movie, in a stable movie-based order.
   Proposed handling of duplicate nominations: allow selecting multiple friends.
   Options are all that week's eligible members, including the respondent.
5. Click Send or skip the current question to see its aggregate results. Percentages
   mean the share of non-skipped answers to that movie that selected each name;
   multiple selections mean percentages can sum to more than 100. Never expose
   another member's individual survey answers.
6. Stay on the results until Next is clicked. On the last question, Finish ends
   the survey. A Skip survey action records completion without further guesses.
7. When all that week's eligible members have finished or skipped, reveal the
   original movie choices and nomination skips to the group. Observers can view
   results but do not hold up completion. The reveal is separate from the movie
   draw and does not change the winner or its weighting.
8. If everybody skipped nominations there is no draw or survey. Old rounds that
   predate this change remain accessible without requiring a retroactive survey.

## Privacy and validation

- Keep unrevealed author/movie associations out of every round API response,
  including nomination and draw responses, rather than only hiding the UI.
- Anonymous movie entries must not retain an order that can be paired with the
  member list. Public catalogue provenance such as submitted_by must not disclose
  the author of a newly imported nomination.
- Derive the respondent from the authenticated session. Validate group membership,
  eligibility, round, nominated movie IDs, selected member IDs and lifecycle state.
- Reject survey answers before the draw and changes after completion/reveal.
- Use the nomination roster for completion, including members who skipped their
  nomination. A newcomer who cannot nominate that week must not block the reveal.
- Preserve pending surveys through a week rollover, with access from round history,
  so an unfinished survey does not lose its completion/reveal path on Monday.

## Files affected

- New db/007_anonymous_nominations_survey.sql.
- backend/src/shared/database-models/round.database-model.ts and
  backend/src/repositories/schema.ts for survey persistence types.
- backend/src/models/entities.ts for anonymous round and survey response types.
- backend/src/repositories/round.repository.ts,
  backend/src/services/round.service.ts and
  backend/src/controllers/round.controller.ts for persistence, privacy, percentages,
  survey answers and completion/reveal.
- Movie response paths that currently expose submitted_by, including
  backend/src/repositories/movie.repository.ts and review/movie response types,
  as needed to remove that nomination clue.
- backend/src/cli.ts and test migration fixtures to register the migration using
  the existing migrate command.
- frontend/src/app.tsx, frontend/src/style.css and both locale dictionaries for
  anonymous participation, the survey dialog, Next navigation and the reveal.
- Existing backend round/HTTP/group/race tests, frontend interface tests and
  frontend/e2e/mainflix.test.ts; README.md for rules and migration instructions.

## Verification

Test the full transition from anonymous nominations through drawing, answering,
skipping, percentage calculation and the final reveal. Include duplicate movie
nominations, author metadata leaks, observers, late joiners, cross-group access,
refresh/resume, week rollover and simultaneous final submissions. Run the existing
test, typecheck and build commands. No new dependency, service or CLI command is
needed.
