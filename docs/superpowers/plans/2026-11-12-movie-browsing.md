# Movie browsing implementation plan

Goal: add Spain-oriented movie discovery with featured La bola negra (1422041) and Ruega por nosotras (1522071), favorite genres first, recently added, new releases and popular movies.

Approved design: extend existing controllers/services/TMDB and React class component. No dependency, migration, new service or CLI. Preserve approval and nomination rules. Use existing workspace so the running preview includes previous search fixes.

- [x] Backend: add shared category/result types, authenticated /api/movies/browse route with validated category/page/language; existing repository supplies recently added and locally imported matches. TMDB discover uses region ES, popularity ordering, combined comedy+romance genre, and recent Spanish release dates. Featured uses exact verified IDs. Errors preserve local browsing. Tests cover filters, pagination, featured identity, malformed metadata, auth and validation.
- [x] Frontend: featured row plus favorite genres, recently added, new releases and popular rows; other genres selectable. Reuse card/import behavior, show local approval instead of duplicate submit, load more independently, cancel stale requests on language/session change; localized titles and accessible horizontal poster rows. Tests cover ordering and cards.
- [x] Verify: unit/integration suite, typecheck/build/format, Playwright live browse, language switching, pagination and narrow viewport; review final diff. No import/approval of the two featured films without a user click.

Review focus: stale requests after sign-out/language switch; local movies duplicated as remote submissions; one upstream outage hiding other sections; invalid API parameters; dates and popularity label accurately describing Spain filtering.

Review: independent reviewer found pagination retry resetting loaded pages and stale inactive genre caches. Both fixed; reviewer confirmed. Playwright: all 3 tests passed; live TMDB Spain lists, featured posters, pagination and 320/375px layout verified. Final checks: 56 unit/integration tests, all 3 Playwright tests, typecheck, build and diff whitespace checks passed.
