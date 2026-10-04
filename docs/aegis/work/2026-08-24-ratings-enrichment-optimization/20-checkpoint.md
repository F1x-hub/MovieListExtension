# Ratings Enrichment Optimization — Checkpoint

## Current todo

1. [completed] Define stage/cache/scheduler contracts.
2. [completed] Implement progressive KP→IMDb enrichment and partial cache/UI state.
3. [completed] Implement background priority scheduler, typed failures, and metrics.
4. [completed] Add focused regression tests.
5. [completed] Run lint, tests, build, diff review, and changelog update.

## Completed

- Read the approved parent plan and project agent rules.
- Confirmed current root cause in code: one `_currentSearchRequest`, combined
  `flushPendingCards()` completion, and fallback after a collapsed `null` result.
- Ran baseline focused tests: `movieRatingsEnrichment.test.js` and
  `offscreenScraper.test.js` passed.
- Added delayed-IMDb, same-title identity dedup, and runtime offscreen scheduler
  tests; all focused checks pass after the slice fixes.

## Evidence refs

- `src/background/background.js:1009-1129`
- `src/shared/services/MovieRatingsEnrichmentService.js:211-477`
- `src/pages/home/HomeMovieNavigationService.js:30-216`
- `src/shared/services/KinopoiskPersonHtmlService.js:75-210`

## Drift check

- Intent: aligned.
- Compatibility boundary: preserve public observer methods, cache key reads,
  click-time mapping, and hidden-browser-only enrichment.
- Retirement: caller fake-concurrency settings and transient-timeout HTML
  fallback will be removed only after scheduler/failure-reason coverage exists.
- Decision: continue to verification.

## Next

Verification complete: lint, the full npm test matrix, focused scheduler tests,
syntax checks, and production build passed. README and living agent context were
updated; no task-owned stale caller-concurrency or transient-fallback references
remain.
