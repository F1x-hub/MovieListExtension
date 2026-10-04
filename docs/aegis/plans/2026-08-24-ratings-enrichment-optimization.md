# Rating Enrichment Optimization Plan

## Goal

Make Home and Catalog feel immediate by showing the Kinopoisk rating as soon as
identity/search data is available, while loading IMDb independently in the
background. Remove duplicate requests, queue waiting, and unnecessary HTML
fallbacks without opening a visible tab or spending Kinopoisk API quota.

## Architecture

The current flow is:

```text
Card observer
  -> MovieRatingsEnrichmentService
     -> KP identity search
     -> KP movie-page request for missing IMDb
        -> one global background offscreen queue
  -> one final card update after both providers finish
```

The target flow is:

```text
Card observer
  -> fast identity stage
     -> cache/in-flight deduplication
     -> KP badge update immediately
  -> low-priority IMDb stage
     -> independent IMDb badge update
```

The background offscreen coordinator remains the only owner of browser-context
requests. It schedules one iframe operation at a time with priority and
cancellation; callers do not create competing queues or visible tabs.

## Tech Stack

Chrome MV3 extension, vanilla JavaScript, service-worker background coordinator,
offscreen iframe scraper, `chrome.storage.local`, and Node-based regression tests.

## Baseline / Authority Refs

- `src/shared/services/MovieRatingsEnrichmentService.js` — card observer,
  batching, identity stage, rating stage, and cache.
- `src/shared/services/KinopoiskPersonHtmlService.js` — KP title/ID search and
  HTML fallback.
- `src/shared/services/KinopoiskService.js` — offscreen KP search and detail
  requests.
- `src/background/background.js` — the global serial `_searchQueue` and iframe
  lifecycle.
- `content-scripts/kinopoisk-search-scraper.js` — DOM extraction and hydration
  timeout behavior.
- `src/pages/home/home.js` and `src/pages/catalog/catalog.js` — consumers.
- User trace baseline: six cards took about 70 seconds to finish; identity
  resolution took about 38 seconds; several offscreen operations took 15–17
  seconds and timed-out searches then performed large HTML fallbacks.

## Requirement Ready Check

- User-visible need: ratings appear too late and too much work runs for a small
  visible set of cards.
- Required behavior: no visible tabs/windows, no KP API quota for card ratings,
  KP and IMDb remain clearly separated, click-time mapping remains unchanged.
- Non-goals: redesign card visuals, change MovieDetails data loading, or remove
  the existing hidden browser-context capability.
- Acceptance direction: first visible KP badges must not wait for IMDb; IMDb may
  arrive later with a skeleton; offscreen queue work must be bounded to relevant
  cards and deduplicated.
- Decision: ready.

## Root-Cause Summary

1. `maxResolveConcurrency = 3` and `maxParserConcurrency = 2` create apparent
   concurrency, but `background.js` has one global `_currentSearchRequest`, so
   all offscreen work is actually serialized and callers wait in line.
2. Identity and IMDb detail parsing are coupled into one `buildRatingRecord`
   completion. A known KP rating is not rendered until the slower IMDb detail
   request finishes.
3. KP identity search can time out in the offscreen queue and then fall back to
   a large HTML response, increasing latency and network traffic for an item
   that can be retried later.
4. The current observer intentionally reaches 200px beyond the viewport, and
   the service can enqueue multiple cards before the first visible results are
   painted.
5. A repository search found no `prompt_cache_retention` option in the extension
   source. That error is therefore an external model/client configuration issue,
   not a rating-parser failure. The extension must not add or forward that
   unsupported field.

## Compatibility Boundary

- Preserve `MovieRatingsEnrichmentService` public `observe`, `enqueueCards`, and
  card dataset contracts.
- Preserve `movie_card_ratings_v4` reads; use a versioned migration only if the
  new partial-provider state cannot be represented compatibly.
- Preserve `HomeMovieNavigationService` click-time KP ID resolution.
- Preserve the offscreen message types as compatibility carriers while moving
  scheduling ownership into the background coordinator.
- Preserve explicit provider labels and never map TMDB into KP or IMDb fields.

## TDD Route

- Mode: off.
- Decision: skipped.
- Test posture: diagnostic reproduction followed by focused regression tests and
  the full suite.
- Reason: the user requested an optimization plan, not strict test-first
  implementation. Timing baselines and post-change invariants are required.

## Implementation Tasks

### 1. Add queue and stage timing evidence

Files: `src/background/background.js`,
`src/shared/services/KinopoiskService.js`,
`src/shared/services/MovieRatingsEnrichmentService.js`,
`src/shared/services/KinopoiskPersonHtmlService.js`.

Record `requestId`, provider, queue wait, active service duration, total caller
duration, cache hit, in-flight hit, timeout reason, and card priority. Keep title
logging opt-in so normal logs stay compact. Add one summary per flush rather than
one verbose object for every internal transition.

Verification:

```text
Open Home with a cold cache and confirm every offscreen operation has exactly
one enqueue/start/finish record and queueWaitMs is distinguishable from serviceMs.
```

### 2. Deduplicate identity and detail work at the canonical owners

Files: `src/shared/services/KinopoiskPersonHtmlService.js`,
`src/shared/services/KinopoiskService.js`,
`src/shared/services/MovieRatingsEnrichmentService.js`.

Add in-flight maps keyed by normalized search title/year/media type and by
`kp:{id}:{mediaType}:ratings`. Return the same Promise to duplicate callers.
Reuse completed detail results by KP ID across Home sections and Catalog. Keep
the existing persisted cache as the durable layer; the new maps only cover the
current page/session and must be cleared after settlement.

Verification:

```text
Add tests proving two cards with the same KP ID produce one detail request and
two cards with the same normalized title/year produce one identity request.
```

### 3. Split KP readiness from IMDb enrichment

Files: `src/shared/services/MovieRatingsEnrichmentService.js`,
`src/shared/components/MovieCard.js`, relevant Home/Catalog tests.

Refactor the current combined rating record into two provider states:

- Stage A resolves identity and applies KP rating immediately, preserving the
  IMDb skeleton when IMDb is still unknown.
- Stage B requests the KP movie page only when IMDb is missing and fills IMDb
  independently; it must not delay or overwrite a valid KP value.

Persist partial provider results safely. A KP-only record is usable for the KP
  badge but is not treated as a permanent IMDb negative. Keep the existing
  explicit `—` state only after the provider has actually been attempted.

Verification:

```text
Test that a slow IMDb request still causes an immediate KP card update.
Test that a failed IMDb request preserves the KP rating and renders an IMDb
placeholder instead of clearing both badges.
```

### 4. Replace the implicit serial queue with a bounded priority scheduler

Files: `src/background/background.js`,
`src/shared/services/KinopoiskService.js`.

Keep one offscreen iframe owner, but schedule work explicitly:

1. identity requests needed to enrich visible cards;
2. rating-detail requests for already-resolved visible cards;
3. below-viewport enrichment;
4. retry/HTML fallback work.

Add aging so low-priority work cannot starve. Cancel queued work when the card
is no longer relevant or the page session changes. Do not raise concurrency
above the iframe's safe capacity; the current `3/2` caller settings must not
pretend to provide parallelism. Prefer one bounded scheduler over multiple
duplicate offscreen queues.

Verification:

```text
Test queue ordering, cancellation, timeout cleanup, and exactly one active
iframe request. Assert that no chrome.tabs.create or chrome.windows.create path
exists for ratings.
```

### 5. Remove unnecessary work and expensive fallback cascades

Files: `src/shared/services/KinopoiskPersonHtmlService.js`,
`src/shared/services/KinopoiskService.js`,
`src/shared/services/MovieRatingsEnrichmentService.js`.

- Reduce the observer margin from 200px to a measured near-viewport budget.
- Make visible-card priority explicit; defer second-row and below-fold IMDb work
  until the browser is idle.
- Do not run the large HTML fallback after a transient offscreen timeout. Retry
  later using the existing negative/provisional cache policy. Reserve HTML
  fallback for a confirmed browser-context block or an unavailable offscreen
  capability.
- Do not start a detail-page request when the search payload already contains a
  valid IMDb rating.
- Keep direct KP-ID cards on the fast path and never perform title mapping for
  them.
- Coalesce Home and Catalog enrichment calls when they share the same KP ID.

Verification:

```text
Cold-cache trace must show no HTML fallback after BACKGROUND_TIMEOUT, no
duplicate title search, and no detail request for a card with a valid IMDb
rating already in the search result.
```

### 6. Make the loading contract visibly progressive

Files: `src/shared/components/MovieCard.js`, card styles, Home/Catalog tests.

Keep the initial card render non-blocking. Render KP as soon as Stage A completes,
keep an IMDb skeleton while Stage B is pending, and transition the IMDb badge to
ready or explicit unavailable without changing card height. Do not show a global
spinner for background enrichment.

Verification:

```text
Use a delayed detail fixture and assert stable card dimensions, immediate KP
rendering, and a later IMDb-only DOM update.
```

### 7. Handle `prompt_cache_retention` outside the rating pipeline

Files: only the external API/client wrapper if one is later identified; no
rating-service file should gain this option.

The current extension source contains no such field. If the error is emitted by
the development runner or an AI API wrapper, remove `prompt_cache_retention`
from that request's options for unsupported models, or gate it by an explicit
model-capability check. Do not catch and hide the error inside the extension;
that would obscure the wrong owner.

Verification:

```text
Search the extension source and build output for prompt_cache_retention; expect
zero matches. Re-run the external client request without the unsupported field.
```

### 8. Regression and performance acceptance

Files: `tests/movieRatingsEnrichment.test.js`, new queue/detail timing tests,
`tests/kinopoiskMoviePageRatings.test.js`, and the project changelog.

Cover cold cache, warm cache, duplicate cards, missing KP ID, KP-only success,
IMDb success, IMDb failure, offscreen timeout, queue cancellation, and series.
Capture before/after metrics for six visible cards:

- time to first KP badge;
- time to first IMDb badge;
- total flush duration;
- offscreen queue wait vs active request time;
- count of identity requests, detail requests, HTML fallbacks, and retries;
- zero KP API calls for card enrichment.

Run:

```text
npm run lint
node tests/kinopoiskMoviePageRatings.test.js
node tests/movieRatingsEnrichment.test.js
node tests/<new-rating-queue-regression>.test.js
npm test
npm run build
```

## Architecture Integrity Lens

- Invariant: card enrichment is non-blocking, quota-free, invisible, and
  provider-isolated.
- Canonical owner: the background offscreen coordinator owns request scheduling;
  the enrichment service owns stage priority, not iframe concurrency.
- Responsibility overlap to remove: caller-level concurrency settings that feed
  one serial queue, plus identity/detail callers without in-flight coalescing.
- Higher-level simplification: progressive provider updates remove the need for
  every card to wait for a combined KP+IMDb Promise.
- Falsifier: if KP itself only returns ratings after full detail hydration and
  the first badge cannot be produced earlier, retain the two-stage contract but
  tune the detail timeout and priority rather than adding another scraper.

## Risks and Rollback

- A lower queue budget can delay below-fold ratings; cancellation and idle retry
  must preserve eventual enrichment.
- Partial cache semantics can expose stale IMDb data; store provider timestamps
  and revalidate only the missing/stale provider.
- KP anti-bot behavior can vary by session; retain the current blocked-state
  diagnostics and do not increase request volume to compensate.
- Rollback boundary: revert the stage scheduler and partial-state adapter while
  keeping parser selectors and existing cache readers intact.

## Retirement Track

- Retire the single combined card-update dependency on IMDb completion.
- Retire caller-side fake concurrency values once the scheduler exposes its own
  bounded capacity.
- Retain the HTML fallback only for confirmed blocked/offscreen-unavailable
  cases, with its removal trigger defined by stable browser-context coverage.
- Do not introduce or retain `prompt_cache_retention` in this extension.

## Execution Readiness View

- Intent lock: optimize latency and remove redundant work; preserve behavior.
- Scope fence: rating enrichment, offscreen scheduling, cache, tests, and docs.
- Compatibility lock: existing card dataset fields, click-time mapping, and
  no-visible-tab behavior remain unchanged.
- Evidence required before completion: before/after cold-cache trace, focused
  tests, full regression suite, build, and zero unsupported prompt option in
  source/build artifacts.
- Execution route: inline, after user approval of this plan.
