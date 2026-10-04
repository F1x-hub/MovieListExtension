# Ratings Enrichment Optimization — Task Intent

## Outcome

Make visible Home and Catalog cards progressive: apply Kinopoisk as soon as the
identity/search stage provides it, then enrich IMDb independently in the
background. Deduplicate physical browser-context work and preserve the no-visible-tab,
no-KP-API card-rating boundary.

## Scope

- `MovieRatingsEnrichmentService`, `MovieCard`, Home/Catalog observer lifecycle.
- `KinopoiskService` and `KinopoiskPersonHtmlService` request contracts.
- `background.js` offscreen scheduler and diagnostic metrics.
- Focused regression tests, lint, full tests, and build.

## Non-goals

- MovieDetails loading or provider metadata architecture.
- Visible UI redesign beyond rating badges and skeleton states.
- Live Firestore or user-data mutation.

## Baseline refs

- `docs/aegis/plans/2026-08-24-ratings-enrichment-optimization.md`
- `src/shared/services/MovieRatingsEnrichmentService.js`
- `src/pages/home/HomeMovieNavigationService.js`
- `src/shared/services/KinopoiskPersonHtmlService.js`
- `src/shared/services/KinopoiskService.js`
- `src/background/background.js`
- `src/shared/components/MovieCard.js`
- `tests/movieRatingsEnrichment.test.js`
- `tests/offscreenScraper.test.js`

## TaskStartSnapshot

- Root: `D:/Programing/JS/Projects/MovieListExstension`
- HEAD: `c23b994d163bf84e0abf4a283c29c936c59f0e9f`
- Branch: `master` (ahead of `origin/master` by 1)
- Pre-existing worktree: heavily dirty; preserve all unrelated changes.
- TDD route: off / skipped, as recorded by the parent plan.

## Change boundary

Code change is necessary: the current combined Promise and single global
offscreen queue prevent the requested progressive behavior. Keep one background
offscreen owner; move physical deduplication and scheduling there, while the
enrichment service owns provider-stage delivery.
