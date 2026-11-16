# Anonymous Nominations Survey Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hide nomination authors until every eligible member completes or skips a post-draw guessing survey.
**Architecture:** Extend the existing round controller/service/repository and Mainflix component. Store each participant's answers and completion in one table; use existing group locks and polling.
**Tech Stack:** Existing TypeScript, PostgreSQL, Kysely, Express and React.
**Spec:** ../specs/2026-11-16-anonymous-nominations-survey-design.md

## Global Constraints

- Multiple names per question; Send shows results; Next explicitly advances.
- No new service, dependency or CLI command.
- Preserve weighted draws, review locks and existing local changes.
- Work in the current checkout so the already completed review change remains present.

## Review Focus

- Raw round mutations must not leak nomination authors.
- Frozen participants, observers and late joiners must yield the correct completion count.
- Completed answers are immutable; simultaneous completion reveals exactly once.
- Monday rollover must preserve access to pending surveys.
- Percentages exclude skipped answers and can exceed 100 in total for multiple names.

### Task 1: Anonymous round views and persisted survey

Files: db/007_anonymous_nominations_survey.sql; backend round models/schema/repository/service/controller; application JSON serialization; CLI and migration fixtures; backend/test/survey.test.ts.
Interfaces: RoundService.view(userId, week?) returns a private round view; RoundService.answerSurvey(userId, week, action) records one answer, finish or skip and returns the same view.

- [x] Add failing HTTP tests for anonymity, multiple guesses, percentages, skips, reveal, validation, cross-group access, rollover and concurrent completion.
- [x] Run tests and verify missing functionality fails.
- [x] Add migration, fixed survey roster, JSON answers, group-locked mutations and authenticated round projections. Keep raw snapshots internal to draw logic.
- [x] Verify focused tests and backend typecheck.

### Task 2: Survey wizard and anonymous participation

Files: frontend/src/app.tsx, style.css, locale dictionaries; frontend/test/interface.test.ts and frontend/e2e/mainflix.test.ts.
Interfaces: Consume round nominations, reveal flag and survey question/participant state. POST survey actions to /rounds/:week/survey; GET /rounds/:week for history resume.

- [x] Add failing rendered UI tests for Send, checkboxes, percentage results, explicit Next and final reveal.
- [x] Implement auto-open after draw animation, saved progress, Send/skip, Next/Finish and history access. Clear dialog state on account/group changes.
- [x] Update roulette and participation to use anonymous movie counts rather than author-linked entries.
- [x] Run frontend tests and typecheck.

### Task 3: Integration and verification

Files: existing affected backend/frontend tests and README.md.

- [x] Update old assertions to the anonymous API contract and register migration in all reset fixtures.
- [x] Run npm test, npm run typecheck, npm run build and formatting checks; inspect all failures.
- [x] Run browser coverage against disposable data if the existing local browser/test setup is available.
- [x] Review final diff and document migration requirements and any unverified checks.

## Progress

Plan and user-approved design recorded. Baseline: preceding change passed 89 tests, typecheck and build in this session. User authorized committing and pushing after the iPhone SE portrait check.

Task 1: complete; HTTP lifecycle/privacy tests watched failing before implementation, then passing. Final backend suite: 76 pass, including skipped nominators and frozen late-joiner eligibility.
Task 2: complete; Send/Next and About tests watched failing first, then passing. Final frontend suite: 24 pass. About tab explicitly selected by user during implementation. Finish now opens the results-only overview; the added regression was watched failing before the change.
Task 3: complete; final full suite passes with 100 unit/integration tests. All 8 browser flows passed before the results redesign. The final redesign was separately checked in English and Spanish with isolated Playwright API fixtures, including Send/Next/Finish, results-only completion, delayed reveal, long usernames, scrolling and reduced motion. Typecheck, production build, formatting and git diff checks pass.
Final iPhone SE portrait QA: the installed Playwright iPhone SE (3rd gen) profile at 375×667 with touch enabled passed in both languages. Inspected screenshots of selection, percentage results and the completed overview, including the second movie and bottom Close button. Tightened spacing for screens below 700 px tall; repeated the portrait check and frontend build successfully. This is device emulation, not a physical iPhone/Safari check.
Independent review: three P2 UI findings fixed with four failing-then-passing regressions: completed surveys open at the beginning (now an all-results overview); delayed responses do not restore closed dialogs; polling cannot overwrite a newer answer. No additional concrete backend findings or deferred findings.
No live database migration or deployment performed. Apply migration 007 with the existing db:migrate command before running the update.
Ruling: public movie submitter redaction uses Express's existing JSON serializer hook in Application, covering all catalogue, review, favorite and history responses consistently; stored attribution remains intact.
