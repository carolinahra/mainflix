# Mainflix interface implementation plan

**Goal:** Implement the approved modern Netflix-style design with Minecraft artwork, prioritizing iPhone SE portrait and responsive behavior throughout.

**Architecture:** Keep the existing React class, API calls, authorization and workflows. Replace the stylesheet, add a reusable hero and localized copy, and use generated local artwork. No new dependencies or backend changes.

**Scope:** `frontend/src/app.tsx`, `frontend/src/style.css`, both locale JSON files, `frontend/public/art`, and focused frontend/browser checks. Preserve existing card, winner and dialog selectors for regression tests.

**Review focus:** 320px and 375px portrait; Spanish/long text; all round states including skipped responses; missing posters; all auth/admin/dialog forms.

- [x] Add a rendering test covering actual round response counts (including skips), loading, and translated hero copy; observe the new behavior fail.
- [x] Generate production hero and logo assets from the approved references. Keep meaningful content and controls as real HTML.
- [x] Implement cinematic hero, party strip, navigation and responsive movie cards in the existing component; translate new strings.
- [x] Replace the pixel/stone visual styles with a cohesive responsive dark interface, including auth, history, admin, review dialogs and account forms.
- [x] Run frontend tests, type checks, build and repository tests. Run browser checks at 320, 375, 768 and 1440px, inspect screenshots and check interactions.

Ruling: work in place because this repository has no initial commit and all application files are untracked; a worktree cannot carry the current application. The user has approved the visual design and instructed implementation; no further design approval is needed.

Validation: 29 backend tests and 4 frontend tests passed; production build and type checks passed. Browser flows cover nominations, draw, session isolation, reviews, Spanish, live search, portrait and landscape. Additional final layout checks cover 320, 375, 568, 667, 768 and 1440px. A fresh review identified the desktop artwork overlap; fixed with separate artwork/form columns and removed the old tablet fixed width.
