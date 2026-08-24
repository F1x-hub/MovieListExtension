# Ratings Orphan Repair and Prevention Plan

## Goal

Restore the three rated movies that exist in `ratings` but are absent from
`movies`, then make the rating write path and repair tooling preserve the
`ratings`/`movies` invariant permanently.

## Status

- Complete: audit the three orphan IDs and restore their movie projections.
- Complete: promote cached metadata when a rating caller omits `movieData`.
- Complete: verify zero rated IDs are missing from `movies`.
- Planned: add an authenticated recurring integrity check for future drift.

## Architecture

`ratings` is the source of user rating events. `movies` is the queryable movie
catalog and aggregate projection used by the Ratings page. Every rated
Kinopoisk ID must have one `movies/{movieId}` document with movie metadata and
the community aggregate fields.

## Tech Stack

- Chrome MV3 extension with vanilla JavaScript.
- Firebase Authentication and Firestore.
- Firebase Cloud Functions v2 and Firebase Admin SDK.
- Kinopoisk metadata through the authenticated server proxy.

## Baseline/Authority Refs

- `src/pages/ratings/ratings.js` loads the page from `movies` in batches.
- `src/shared/services/MovieCacheService.js` queries
  `hasCommunityRating == true` from `movies`.
- `src/shared/services/RatingService.js` owns rating writes and aggregate
  promotion from local movie cache.
- `functions/index.js` owns aggregate triggers and backfill operations.
- Read-only Firestore audit: 609 ratings, 248 unique rated IDs, and three IDs
  missing from `movies`: 5287148, 22819, and 13707.

## Compatibility Boundary

- Preserve every existing document in `ratings` unchanged.
- Preserve existing aggregate fields unless recomputed from the rating set.
- Keep popup behavior unchanged.
- Do not expose Kinopoisk keys to the extension or scripts.
- Keep the Ratings page query contract based on `movies`.

## TDD Route

Light route: add focused invariant/repair tests, implement the smallest owner
changes, then run the repair verification and the existing regression suite.

## Verification

- Confirm all rating movie IDs have a corresponding `movies` document.
- Confirm every rated movie has `hasCommunityRating`, `hasRatings`, positive
  `ratingsCount`, numeric `avgRating`, and `lastRatingUpdatedAt`.
- Confirm the three target documents contain a usable name and poster.
- Confirm the Ratings page query returns all three target IDs.
- Run lint, focused tests, full tests, and production build.

## Task 1 — Read-only metadata and aggregate audit

Files: temporary audit script only; no product files.

Why: identify exact fields available in the three orphan rating records before
writing persistent data.

Change Necessity: a read-only audit is sufficient for discovery; no product
source change is required in this task.

Verification: inspect only the three target IDs and confirm their rating count,
rating values, title/poster fields, and latest timestamp.

## Task 2 — Backfill the three orphan movie projections

Files: `functions/index.js` or an existing deployed backfill endpoint; focused
repair test.

Why: make the existing ratings visible on the Ratings page without changing
user ratings.

Change Necessity: persistent projection documents are absent, so a code-only UI
fallback would create a second source of truth and would not repair sorting or
future consumers.

Repair Track: upsert only `movies/5287148`, `movies/22819`, and `movies/13707`.
Merge verified movie metadata, recompute aggregate fields from `ratings`, and
set `hasCommunityRating`, `hasRatings`, and `lastRatingUpdatedAt`.

Rollback: the repair is a merge-only projection update; capture the three
pre-write snapshots and restore only those exact documents if verification
fails. Do not delete ratings.

Verification: read back all three documents and query the same path used by
`MovieCacheService.getMoviesByAvgRating`.

## Task 3 — Prevent recurrence at the canonical rating owner

Files: `src/shared/services/RatingService.js`, `functions/index.js`, focused
tests.

Why: old records prove that a rating can survive while its movie projection is
missing.

Repair Track: ensure every create/update rating operation promotes a complete
movie projection before/with the rating write, and ensure the Cloud Function
aggregate trigger creates the projection when it receives a legacy rating.

Retirement Track: do not add a Ratings-page-only fallback. Retain the existing
`movies` query as the canonical read path; retire any one-off orphan fallback
after the invariant audit passes.

Verification: simulate a rating for a missing movie document, assert the movie
projection is created with metadata and aggregates, then test update and delete
paths.

## Task 4 — Add recurring integrity repair and observability

Files: `functions/index.js`, `firebase.json` if scheduling is configured, and
tests/docs.

Why: a trigger repairs new writes, while a bounded audit repairs historical or
manually-created data and makes future drift visible.

Change Necessity: the defect crossed the Firestore persistence boundary; a
one-time backfill alone cannot prevent future drift.

Implementation: add an authenticated/admin-only integrity endpoint or scheduled
job that compares distinct `ratings.movieId` values with `movies` documents,
repairs missing projections idempotently, and logs the missing/repaired counts.

Verification: dry-run reports zero missing projections after repair; repeated
runs make no additional changes; unauthenticated access is rejected.

## Execution Route

- Decision: inline.
- Evidence: the repair has sequential Firestore read/write dependencies and
  must preserve the user's existing dirty workspace.
- Fallback: if the deployed function is not available, use a one-shot Admin SDK
  repair script with the same exact-ID scope and read-back checks.
- User confirmation required: already granted by the user's request to proceed;
  scope remains limited to the three orphan movie projection documents.
