# AGENT.md — Movie Rating Extension
> Subsystem reference: who owns what, what must stay true and the traps the code does not make
> obvious. The working procedure, the commands and the README changelog policy live in the root
> `AGENTS.md`. Keep each entry to a few lines; when a change makes one wrong, correct it in
> place. History belongs in the README changelog, and walkthroughs of the code belong nowhere:
> the code is the reference for how things work. Deployment claims can be stale; verify them.

## Project

Chrome extension (Manifest V3, vanilla JS, no framework or transpiler) for rating, tracking and
watching films and series. It uses Firebase (Auth, Firestore, Storage, Cloud Functions, Secret
Manager, an isolated staging RTDB for watch rooms; project `movielistdb-13208`), Kinopoisk, TMDB,
IMDb and provider players, plus a Windows updater and Hub (.NET 10) and an optional local
MediaPlayer service.

- `src/background/` service worker and DNR rule files; `src/offscreen/` offscreen documents;
  `src/pages/<page>/` full-tab pages; `src/popup/`; `src/shared/` components, services, styles,
  games, i18n and bundled data. `content-scripts/` run inside provider and site frames
  (`player-cleaner.js`, the bridges, `kinopoisk-search-scraper.js`, `hdrezka-session-bridge.js`);
  the extension adds no controls to external movie sites' own pages.
- `functions/` Cloud Functions; `rules/` Firestore, RTDB and Storage rules; `native-host/` updater
  and Hub; `libs/` vendored libraries (nothing loads from a CDN); `scripts/` build and content
  generators; `telegram-bot/`; `dist/` is generated.
- Messages: provider and site frames talk to the page that embeds them with `window.postMessage`;
  content scripts, pages and the popup talk to the service worker with `chrome.runtime` messages
  and `chrome.storage`.
- Paths in `manifest.json` are relative to the extension root. Keep the `copyfiles` paths in
  `package.json` in step when files move. Minification keeps `console` output.

## Cross-cutting rules

- **Server changes deploy separately**: Firestore, RTDB and Storage rules and Cloud Functions are
  not part of an extension build. A change there is not live until it is deployed on its own.
- **Credentials**: Kinopoisk and TMDB keys live only in Secret Manager behind `kinopoiskProxy`,
  `tmdbProxy` and `providerKeysAdmin`; Firestore keeps only safe key metadata and audit records.
  Never put a provider credential in `src`, `manifest.json`, `dist`, storage, DOM attributes, logs
  or API responses. Client Kinopoisk API calls need a Firebase ID token and go through
  `kinopoiskProxy`; Kinopoisk HTML scraping is a separate browser-context path. Secret Manager
  may answer with project numbers: normalize provider-key resource names before access, disable,
  destroy or delete. Aggregate and legacy secrets stay as rollback bridges until an explicit
  retirement, and keys are revoked only through the server-side revoke path.
- **Logging**: never log credentials or tokens. Parser tracing goes through
  `BaseParserService.debugLog()` (`localStorage['movieExtension.debugParsers'] = '1'`); the trace
  families (`[SearchTrace]`, `[KPCardTrace]`, `[MovieRatingsTrace]`, `[RecommendationTrace]`, ...)
  log only behind their debug flags. Keep their stage timings when changing a flow, and add no
  unconditional `console.log` tracing.
- **Markup safety**: `Utils.escapeHtml` and `MovieCard.escapeHtml` escape quotes (the
  `textContent` trick does not). Untrusted image URLs go through `MovieCard.safeImageUrl()`;
  image fallbacks use `MovieCard.bindImageFallbacks()` because the extension CSP blocks inline
  `onerror`. Helpers such as `formatCrewCategory` already escape their output: do not escape it
  again.
- **Kinopoisk IDs**: resolve them with `Utils.extractKinopoiskId(item)`. Firestore documents often
  have composite IDs such as `${userId}_${movieId}`, and a raw `item.id` in a link or API call
  breaks Movie Details with HTTP 400.
- **Shared helpers**: pages that load `Utils.js` use `Utils.selectRussianPlural`,
  `Utils.formatCompactNumber` (never a hand-built "k"/"M"), `Utils.readTtlCache` /
  `Utils.writeTtlCache` and `Utils.escapeHtml` rather than local copies. Modules that run without
  `Utils.js` (`MovieCard`, `HomeRenderer`, `CalendarView`, games) keep their own quote-safe escaper
  and plural rule. `chrome.storage` readers return `result[key] ?? null` so a stored `0`, `''` or
  `false` survives.
- **Async UI**: anything that writes page state or DOM after an `await` first checks the
  generation, request ID or selection version it started with; stale results are dropped, never
  merged.
- **Auth**: wait for `FirebaseManager.waitForAuthReady(timeout)` before rendering personal or guest
  states; an unresolved auth state is not a guest session.
- **One entry per page**: a page painted from a cache is filled from the server a moment later, and
  that must not look like a second load. `createPageStateManager().showContent()` animates only after
  a loader or an error; blocks that usually come back equal go through `setMarkup()`
  (`shared/utils/setMarkup.js`); Movie Details restores the tab and scroll and ends entry animations
  on a same-film render. Test: `tests/pageEntryOnce.test.cjs`.
- **Errors**: pages pass structured errors to `errorDialog` through
  `Utils.createPageStateManager`; codes and localized presentation live in `src/shared/errors/`,
  with technical causes behind an explicit details disclosure.
- **Storage**: `manifest.json` already has `unlimitedStorage`; on a storage failure inspect the
  real API error before touching permissions. Keep caches bounded; no large base64 records.
- **Naming**: camelCase JS files (`FavoriteService.js`), kebab-case HTML, CSS and folders
  (`movie-details`). Domain logic lives in `src/shared/services/`.

## Visual design

`CONTEXT.md` defines the vocabulary and `docs/design-system.md` is the contract and the review
checklist; `npm run test:visual-design` enforces much of it.

- UI chrome is neutral grayscale (Yin-Yang / Obsidian-Zinc) in both themes. Colour belongs only to
  content (posters, photos, games), provider and brand marks and essential status, and status
  colour always comes with a non-colour cue: text, icon, shape, border style or pattern.
- `src/shared/styles/tokens.css` owns the semantic `--ui-*` roles and `theme.css` maps them per
  theme; legacy variables in `common.css` and page-local tokens are aliases only. New colour
  literals go only into the token layer or a documented exception, never into fallbacks, inline
  styles, SVG attributes or JS templates. New accent variables are normally rejected, and the
  existing cyan, indigo and purple declarations (catalogue, admin) are migration debt not to
  extend.
- Dark and light keep the same hierarchy, states and geometry. `--theme-text-muted` is `#85858e`
  in dark and `#66666e` in light to stay at 4.5:1; low opacity is never the only disabled cue.
- One owner per shared component, all in `src/shared/styles/components.css`: `.btn` and its
  variants, the modal shells, `.custom-dropdown` (only the Settings language list; list pages
  sort and filter with native selects enhanced by `SortControl`), `.menu-item`,
  `.tooltip-surface`, `.popover-surface` (owns `--popover-surface-*`; do not restore
  `--popover-bg`/`--popover-border`) and `.movie-actions-container`. Page styles add only scoped
  layout, placement, density or content variants. Loaders use the `app-loader` namespace from
  `common.css`. Every movie card is `src/shared/components/MovieCard.js`, which also owns its menu.
- Card menu quick actions (the four status items and the collection items) on Search, Ratings
  and Bookmarks run through `src/shared/components/MovieCardActions.js`, loaded after
  `MovieCard.js` and before the page script. One status per film: the shown one removes the
  bookmark, another switches it; the card repaints at once (`MovieCard.setStatusButtons`) and
  rolls back on a failed write. Pages pass only callbacks (film data, their own status record,
  Bookmarks' remove confirmation and fade-out); keep no per-page copies. Movie Details has its
  own status buttons. Person Details draws the status items but nothing handles them yet.
- HTML entry points link `common.css` and `components.css` once, and no stylesheet re-imports
  them. Adding or moving a stylesheet means updating its classification in `test:visual-design`.
- **Search compatibility boundary**: `search.css` is still loaded by Ratings for its filters,
  search input and results. Add no consumers or selectors; remove the dependency only after
  runtime checks cover the page.
- **One rating dialog**: rating a film, on Movie Details and on Ratings, is
  `src/shared/components/RatingDialog.js` with `src/shared/styles/rating-dialog.css`. It builds
  its own markup (`#ratingModal`), keeps Escape, Tab and focus return, locks the choice until
  its fresh read answers and stays undismissable during a write; `RatingDialog.write()` is the
  one way a save becomes `updateRatingText` or `addOrUpdateRating`, and an untouched review is
  never sent. Pages give it the film, the franchise theme and icons, the read and the save; add
  no second rating dialog.
- Buttons centre icon and text with an explicit `inline-flex` or `grid` layout and line-height.
  The `M8 5v14l11-7z` Play path needs a 1.5px left and 0.5px up optical correction, only in the
  Play state and only in the control's owner. Controls use the rounded-square radius; circles are
  for avatars, dots and spinners. Fixed report controls keep a narrow-screen safe area and never
  cover alerts.
- Player geometry lives in `player.css`, not inline markup; `player-cleaner.js` adds only
  iframe-safe boundary styles and placement variants.
- Page-level app-icon fallbacks use `IconUtils.getCurrentThemeIconPath(size)`; the icons live in
  `src/shared/assets/icons/app/` (the old root `icons/` folder is gone).

## Firestore data

### Ratings and the `movies` projection

- New ratings are `ratings/{uid}_{positiveKinopoiskId}`; the rules bind `userId` to the caller and
  reject other new IDs. Random-ID legacy ratings stay update-only until an approved migration,
  and readers and `aggregateMovieRatings` pick one record per user and film: the canonical ID,
  else the latest legacy timestamp. Kinopoisk IDs are normalized to positive numbers; legacy
  string IDs stay readable.
- Only `RatingService` on extension pages writes ratings: the service worker has no rating write
  path, and content scripts and host pages must not get one. Comments are capped at 500
  characters and reviews at 5000; `RatingConfig` loads before `RatingService`; compact caches keep
  only `hasReview` and `reviewLength`, and Movie Details owns full review reads and editing.
- Cloud Functions are the only writers of the aggregate fields on `movies/{kinopoiskId}`
  (`hasCommunityRating`, `hasRatings`, `ratingsCount`, `ratingsSum`, `avgRating`,
  `lastRatingUpdatedAt`). The rules reject client changes to them, and metadata writes
  (`cacheMovie`, `updateMovieCache`) strip them before `set(..., { merge: true })`.
- A `movies` document with `hasCommunityRating: true` is never deleted, because the Ratings page
  queries it; cache expiry only refetches its metadata. Only Cloud Functions delete unrated legacy
  documents: `cleanupUnratedMovies?dryRun=true` first, `?confirm=true` only after the owner
  confirms.
- Backfills of `lastRatingUpdatedAt` use the real latest rating time, never `serverTimestamp()`,
  which gives every film the same time and scrambles the order. A comment-only edit does not move
  it.
- Rating writes and Ratings-page hydration promote the metadata they know into the projection
  without replacing a complete title, poster or description with an empty or partial one, so a
  rated film never becomes an aggregate-only document. `cacheMovie(movie, true)` writes metadata
  even before the first rating's trigger has set `hasCommunityRating`.
- `getMoviesByAvgRating` keeps `orderBy(documentId())` as its tie-breaker. Legacy documents
  without `lastRatingUpdatedAt` are merged into the first page from the cached
  `getMissingSortFieldMovies()` scan.

### Ratings page

- `ratings.js` enriches each page with one `RatingService.getMovieRatingsBatch()` call, never a
  per-film loop. Only the `date` and `avg` sorts are ordered by Firestore (`avg-rating-desc` is
  forced while the average-range filter is on); my rating, title and year load every page and
  sort on the client, where ties compare movie IDs as strings to match `orderBy(documentId())`.
  Sort keys split at their last `-`.
- Rating writes must not delete `ratings_cache_{uid}`: `invalidateRatingsCache()` removes only
  `recent_ratings_cache`. Live updates insert new films directly only on the default newest-first
  view near the top of a visible tab; otherwise they wait behind `#ratingsLivePill`, so the grid
  never shifts under the user.
- Controls use `click` and keyboard handlers, never `mousedown` alone. "Edit rating" opens the
  shared rating dialog; the page's save updates the card at once and writes in the background,
  and a failed write rolls back only its card. `myRating`/`myComment` belong to the signed-in user, `rating`/`comment`
  to the featured rater.
- The old exploration ("sphere") view is gone: `tests/ratingsPageContract.test.js` keeps it out,
  and the service worker deletes its retired poster cache. Do not bring it back from old notes.

### Other collections

- Unrated films are never written to Firestore: their metadata and parsed KP/IMDb ratings live in
  `local_movie_cache_{kinopoiskId}` and are promoted on the first rating. Such a record may hold
  ratings without a film, so `getCachedMovie` ignores one without a title.
- Bookmarks: `FavoriteService` (`favorites`, statuses `watching`, `plan_to_watch`, `favorite`,
  `watched`) is the only source; `WatchlistService` and `WatchingService` are deprecated and their
  pages only redirect. Views with many cards read bookmark states once with
  `getBookmarksBatch(userId, movieIds)` and fall back to `false` when signed out or on failure.
- Custom collections open only inside Bookmarks (`bookmarks.html?filter=collection:<id>`), which
  owns their rename and delete (through `ConfirmDialog`). `collection/collection.html?id=` and
  `ratings.html?collection=` only redirect there with `location.replace`; build no second view.
- Episode ratings: private `seriesEpisodeRatings/{uid}_{kpId}`, keyed `season:episode`, are
  independent of the title rating both ways, and an episode write never touches public rating
  caches, genres, metadata or the watchlist. The server-only `aggregateSeriesEpisodeRatings` builds
  the public `seriesEpisodeStats/{kpId}`.
- Comment reactions: up to three types per user and rating in
  `commentReactions/{ratingId}_{userId}`, written in a transaction (`types` is canonical, the
  scalar `type` a legacy mirror). The rules allow `get` of a missing canonical ID that ends in the
  caller's UID so the first transaction can start. The catalog is `settings/commentReactions`
  (admins, up to 24 entries, image assets in Storage). Summaries are derived by
  `aggregateCommentReactions`, eventually consistent, and reaction writes never touch `ratings`.
- Users: a new `users/{uid}` document must carry `approvalStatus: 'pending'` and `isAdmin: false`
  (a missing field would count as legacy-approved), and users cannot change either. Pending and
  rejected users are signed out at every auth entry point. Writes to ratings, lists, collections
  and movies require `isApprovedUser()`. Other users' profiles include `email` and are readable
  only by approved users and admins.

## Identity, caches and aggregation

- `IdMappingService` keeps TMDB `movie:` and `tv:` namespaces apart; title heuristics never produce
  IDs, and quota or API errors never write negatives. Reverse lookups (`kp:{mediaType}:{id}`)
  trust only `VERIFIED` mappings: exact TMDB external IDs, admin verification, verified provider
  exceptions or verified context. Their negatives carry `{ attemptedAt, retryAfter }` (legacy ones
  without it are stale) and `metadataRecoveryVersion` (currently 4); `forceRefresh` bypasses them.
  Canonical Movie Details URLs never require a TMDB ID.
- Admin-verified mappings live in Firestore `tmdbKinopoiskMappings`, with
  `tmdbKinopoiskReverseIndex` as the transactional uniqueness lock; local storage is a derived
  cache. A curated override needs a completed provider lookup and a check of the canonical KP
  document, never a title match. Known exceptions: KP `1309570` → `movie:634649`, used only after
  the real external-ID lookup comes back empty; the Raimi trilogy (TMDB 557/558/559 → KP
  838/2898/82441), which wins over conflicting shared mappings.
- Kinopoisk's `externalId.tmdb` is not unique and can be wrong: an obscure record may carry a
  famous film's ID. Among candidates `_pickExternalIdCandidate` takes the most voted, a record with
  few KP votes is accepted only after TMDB's IMDb ID, and automatic `exact_external_*` mappings are
  rechecked in the background 30 days after `checkedAt` (a failed or empty answer changes nothing;
  manual and shared ones are never rechecked). A cache that stores its own KP IDs reads
  `getKnownKinopoiskIds()` so that corrections reach it. Movie Details leaves a record that borrowed
  a famous title through `findSupersedingKinopoiskId()`, before anything else loads for it.
- `MediaAggregatorService` builds the `UnifiedMovieDTO` with `kinopoiskId > 0` as the root
  identity. Identity status (`VERIFIED`/`UNVERIFIED`), metadata quality and field provenance
  (`_meta.fieldSources`) stay separate, and so do provider ratings (`rating.kp`, `rating.imdb`,
  `rating.tmdb`): a badge never shows TMDB as KP.
- Cached DTOs heal through schema markers (`logoSelectionVersion`, `relationsSchemaVersion`,
  `castSchemaVersion` and the like): an older DTO is aggregated again once, a newer one is left
  alone so clients sharing the Firestore cache do not rewrite each other. Raise the marker when
  the shape changes. A KP-only DTO is not a warm cache while TMDB is configured. Relation arrays
  and their flags never go into shared writes. A TMDB-only DTO stays `UNVERIFIED` and
  `localOnly`, carries `provenance: 'synthetic-tmdb-only'` and never replaces another record.
- `clearMovieCache=1` on a Movie Details route clears only that film's local metadata and reverse
  mapping, never community documents or the whole mapping cache.

## Providers and quotas

- **Kinopoisk API**: the breaker in `kinopoisk.config.js` keeps a six-hour exhausted marker;
  `kinopoiskProxy` answers `KP_QUOTA_EXHAUSTED`, `KinopoiskService` maps it to
  `QuotaExhaustedError`, and `IdMappingService` leaves the remaining candidates unresolved without
  new attempts.
- **Kinopoisk search**: `KinopoiskService` keeps Kinopoisk's own result order. GraphQL
  (`KinopoiskGraphqlService`) answers first; its query texts are byte-exact copies of the site's,
  since the server rejects others, and `tests/kinopoiskGraphqlService.test.cjs` pins them by
  checksum. Hidden offscreen frames are the fallback: `SEARCH_FRAME_SLOTS` (2) run in parallel
  and results are routed by `requestId`. The scraper acts only in frames carrying
  `#agy_req_<id>`, and the ID ends at the first character that cannot belong to it because
  Kinopoisk appends `?socialAlias=...` for signed-in users. Among same-named results only the one
  whose localized and original titles both match counts; a nearer year alone decides nothing. A
  «ничего не найдено» page answers at once, and rating-required searches wait for the result
  cards' ratings to hydrate.
- **TMDB**: all requests go through `TMDBService`, and through `tmdbProxy` unless the ignored local
  config supplies a token. Requests abort after 12 s, and a page sends at most
  `TMDB_PROXY_MAX_CONCURRENT` (6) proxy requests at once because the proxy cold-starts instances
  under bursts. TMDB publishes no daily remaining-requests figure: never show an `N / N` quota for
  it.
- **IMDb**: ratings come from the `imdbRatings` function (`functions/imdbRatingsProxy.js`). Direct
  title pages (HTTP 202 bot challenge) and the suggestion API (no CORS) are not used for cards.
  The proxy's back-off is shared through
  `localStorage['movielist:imdb-ratings-proxy-unavailable-until']`.
- **The Numbers** (`TheNumbersService`, opt-in, personal use): verified source URLs first;
  generated slugs are validated against title, year tolerance and `#movie_finances`; an exact year
  wins over a one-year verified mapping; no cookies; a 24-hour cache; a failure never blocks
  Movie Details.
- **Usage**: `QuotaTrackerService` (Home, PersonDetails) only records and never changes fetch or
  fallback behaviour. Firestore usage comes only from the admin-only `firestoreUsage` function
  (Cloud Monitoring; it can lag by minutes and needs `monitoring.timeSeries.list`); usage
  snapshots are never stored.

## Card ratings

- `movie_card_ratings_v4` (cap 1000) is the shared card-rating cache. `kp:<id>` is the canonical
  record for Home, Catalog, Movie Details and Ratings, and the newer of it and a `tmdb:` alias
  wins. A pending record carries no `imdbCheckVersion`, so `ProviderRatingsBackfill` does not take
  it for a real "no IMDb" answer. Parallel writes share a Web Lock.
- Sources run cheapest first: Kinopoisk GraphQL, then one `imdbRatings` call for every pending
  card, then the hidden KP movie page only for what is still missing. Cached ratings paint as
  soon as a card is observed, fetching starts near the viewport, and each card takes its answer
  without waiting for the others. `MovieRatingsEnrichmentService` cancels work for cards that
  leave the viewport, and its scheduler stays the only place that deduplicates physical
  requests. Leaving a page sends one `KINOPOISK_OFFSCREEN_CANCEL_SESSION`.
- Provider ratings print one decimal (`MovieCard.formatProviderRating`) and keep their badge place
  in every state; a person's score is never shown as one. Only Movie Details calls
  `RatingsRefreshService`.

## Player and sources

### Selection and progress

- `PlaybackController` (with `PlaybackSelection`, `PlaybackRuntime` and `AutoNextCoordinator`)
  owns host playback state and is the only writer of progress. Movies have `null` season and
  episode; Season 0 is valid and never leads into Season 1.
- Explicit selections (`SEASONS_TAB`, `RESUME`, `NEXT_EPISODE_HERO`, `PLAYER_PROVIDER_PICKER`)
  override stored progress and preloaded state in `handleWatchClick`, `mountPlayer` and
  `SeasonvarParser`; a preload of another season is refetched for the requested one. A provider
  switch keeps the canonical season and episode (`source: 'PROVIDER_SWITCH'`), and the
  `PLAYER_READY` and `EPISODE_CHANGED` listeners check `isExplicitSelection`.
- After an async `ProgressService.getProgress()`, revalidate film, frame, source request and
  `PlaybackController.selectionVersion` before sending `RESTORE_PROGRESS`. Progress writes are
  throttled to 15 s and flush at once on pause, end, provider switch, episode navigation (old
  episode first), close and destroy. Opaque mounts never overwrite progress with 0, and a report
  without an episode is saved under the canonical one, never with a null season or episode. A
  new episode starts at its selection's `initialTimestamp` (0 when it has none) once the old
  position is flushed.
- Adapters declare `progressConfidence`: Seasonvar, HDRezka, AnimeGo and torrents are `RELIABLE`,
  KinoGo and Ex-FS `PARTIAL`, Rutube `OPAQUE`. Completion needs `RELIABLE`: 90% for
  content over 120 s, a real `ended` below that. Auto-next also needs direct season/episode
  support, `supportsEnded` and a real `ended`, and any lifecycle change cancels its countdown.
  Only reliable completion writes `EpisodeHistoryService` by itself; the others need the manual
  toggle.
- The episode picker («Серии», `#playerEpisodesListBtn`) and dialog toggles react to `click` only:
  with `mousedown` the press opens and the following `click` closes. Picker clicks go through
  `playSelection()` with error handling. Capability methods (`supportsEpisodePicker()`,
  `supportsDirectSeasonEpisode()`, `getSelectionMode()`, `applySelection()`) decide whether it
  shows; Seasonvar is `DIRECT`, while KinoGo and Ex-FS use the host picker through
  the versioned `APPLY_PLAYBACK_SELECTION` bridge. In-place switches trust only the typed result
  of `PlaybackController.applySelection()` and never assume an opaque provider switched.

### Native provider frames (KinoGo, Ex-FS, Allplay balancers)

- `PLAYBACK_SELECTION_RESULT` counts only from the active frame's window and expected origin,
  with matching provider, season and episode and status `APPLIED` (`DISPATCHED` is not success).
  A newer request or `RESET_PERMANENT_VIDEO` invalidates older ones, and cleaner-side success is
  a strict `true` after the provider DOM confirms it.
- From the moment a source is chosen (`holdNativeProviderReports`) until
  `syncNativeProviderEpisode` has moved the frame to the selected episode, its reports of another
  episode are ignored. A frame that cannot reach the episode ends `unavailable`, never playing
  another episode under this one's name.
- Allplay balancers attach the episode stream only from their own play control, so
  `player-cleaner` redirects `play()` to it, and `startProviderVideo` never resumes an element
  whose `mreLoadedMenuKey` differs from the menu. Their episode is known only from the
  `data-select` menus read when the media's metadata loads; the host sets aside reports of
  another episode. Auto-advance is reported (`noticeLoadedMenuEpisode`) only after the frame was
  confirmed on the host's episode and with no host request in flight.
- KinoGo: `KinogoParser.search(title, year, { mediaType })` gets a real year or `null`, never a KP
  ID. `mediaType`, and `seasonNumber` for season searches, are part of every search cache key;
  candidates are filtered by `isSearchResultCompatible()` before ranking, and Movie Details
  ignores source caches without a matching media type. Series prefer the `kinogo.my` mirror and
  the matching season page. Episode changes never reuse another season's preloaded sources, and
  explicit season remounts bypass cached embed tokens. Its pages can return an HTML 404 with a
  successful load event, which the cleaner reports as `PLAYER_SOURCE_STATE`; raw fallback URLs
  must not replace the canonical parser mount.
- The header arrows publish `PLAYER_EPISODE_NAVIGATION_STATE`, and late frames ask with
  `PLAYER_EPISODE_NAVIGATION_REQUEST`; the answer also resends `SET_CANONICAL_PICKER_MODE`, which
  is otherwise sent only for 3 s after an update and missed by a slow KinoGo mount. Dock controls
  are `display: grid !important`, so an arrow is hidden only by an inline `!important`
  (`setEpisodeArrowVisible`).
- `player-cleaner` keys local resume positions by the embed path in provider frames, by
  `token_movie` in Allplay frames (they all sit at `/`) and by `<html data-player-progress-scope>`
  on extension pages, never by the shared extension page path. The key includes season and
  episode and is fixed when the media's metadata loads. Videos marked
  `data-progress-owner="canonical"` (Seasonvar) are restored only by `ProgressService`.

### Sources and lifecycle

- `getPlayerType()` is a preference, not a filter. Sources stay in registry priority, deduplicated
  by URL, with shared in-flight discovery. `getVideoSources()` accepts absolute HTTP(S) URLs only;
  title resolution happens earlier, in `parser.search()`.
- Selection requests carry monotonic IDs and only the latest may commit. Movie Details keeps one
  parser-player registry per film and disposes it when the film changes; one player is active in
  the DOM, and orphan `player-preload-*` containers are purged.
- `PlayerSourceLifecycle` owns the loading, ready, error and unavailable UI for every flow. After
  its timeout (5 s) a late load still reports `ready`, so the 12 s grace fallback never replaces
  a source that plays. Chrome loads no media for a hidden page that has played nothing, so the
  lifecycle timeouts do not run while the page is hidden.
- Watch start: `resolveWatchSource` starts as soon as no pending source could outrank the best one
  found (at most 10 s). No source ends in `showNoWatchSource`, never in a spinner. VidSrc was
  removed on 2026-11-27; a `vidsrc:` source saved before that starts nothing. A cold
  `handleWatchClick` (`startProgressiveSourceDiscovery()`) releases the first source that is safe
  by parser priority and lets slower providers finish in the background; a
  lower-priority result never overrides an explicit choice. Provider frames fetch nothing until
  the host sends `PLAYER_START` (on `PLAYER_READY`, outside broadcasts and watch rooms).
- A loaded frame is not a working source. For `PARTIAL` adapters (KinoGo, Ex-FS, Collaps,
  Alloha) `PlayerMetrics` counts `resolveOk` only on the frame's `PLAYER_PLAYBACK_STARTED`
  (the content video advanced 1 s, duration not under 90 s), and `armPlaybackConfirmation`
  gives up a source with `no-playback` 30 s after the frame's load or, restarting the clock,
  `PLAYER_START`: a frame showing only a notice builds no video and never sends
  `PLAYER_READY`, so the start alone would leave it unwatched (paused while hidden, at least
  25 s after a click in the frame); a later start puts it back to `ready`. The cleaner also
  reports a region or country notice as `region-blocked`. `OPAQUE` frames keep their load
  event as the signal. `WatchSourcePolicy.select()` lets a remembered source (`preference`,
  `last`) win only while its health is not below 0.3; room and explicit choices always win.
- Parser caches never store an empty source, episode or season list as a success. Do not add an
  HTTP preflight before mounting cached embeds: stale ones recover through the lifecycle and
  `forceResearchSources()`. `ParserRegistry.searchAll()` callback options (`onResult`) never
  reach a provider's `search()`. Seasonvar preloads go through `cachedSearch()` and its bounded
  caches, so overlapping work makes one physical request; it resolves the page of the selected
  season (`effectiveSeasonUrl`) and publishes `SEASONVAR_PLAYBACK_STATE` instead of the cleaner
  reading its DOM. KinoGo must not substitute a trailer for a missing film.
- Balancer domains: the Venom balancer behind KinoGo and Ex-FS moves between domains, and a domain
  it left answers 422. `BalancerDomains` rewrites addresses, follows its `actualize.js` and
  registers the manifest's frame scripts for a domain the manifest does not name
  (`attachFrameScripts`, before the address is used). Host permissions and the static Referer rules
  cover the `.ws` zone; outside it the rules are dynamic (IDs 5200-5299) and access is asked by a
  click. A domain named in the manifest must not be registered as well: the cleaner would run twice.
  The domain is also learned from where a site loads the script (`noteScript`) and from a printed
  address (`adopt`, only when that page names its own host and VenomPlayer). Every balancer frame
  greets the page (`PLAYER_FRAME_HELLO`); silence remounts it once, then the next source takes over.
- Sources asked by Kinopoisk ID: `KpBalancerParser` registers `collaps` (the same Venom balancer,
  `/embed/kp/<id>`, no token), `alloha` and `veoveo`; `KpBalancerAdapter` serves all three. The ID
  reaches a parser as `options.kinopoiskId` from every Movie Details search, their search cache is
  keyed by it (`getSearchCacheKey`), and a name never stands in for it. Collaps and Alloha open
  the frames Ex-FS and KinoGo open (native bridge, `PARTIAL`); Veoveo's frame has no extension
  scripts and plays its own adverts (`OPAQUE`, ranked after the other sources). Alloha answers
  only a request that names a site, so its Referer rule (109) also covers the page's own
  `xmlhttprequest`, and its frame address is rebuilt around the film's `token_movie`, which the
  cleaner keys resume positions by. Alloha's series frame opens on the last episode, and its menu
  drops to the first one after a season change and reports that as the viewer's move, so the
  episode goes into the address (`getFrameUrl`: `season`, `episode`) and the adapter declines any
  other episode in place: the page opens the frame again. Alloha's and Veoveo's partner tokens
  are built in and kept in storage (`kpBalancerAccessV1`); `KpBalancerAccess.ask()` renews them
  from the aggregator's list (`p.linkpp.ink/api/players`) only after a balancer's 404, at most
  once a day, and takes only hosts the manifest already covers. That aggregator's network
  (kinopoisk.cx, troutcdn, linkpp) blocks an address for about half an hour after one request
  that does not look like a browser's: never reach it from a test, a script or a server.
- Provider players never adapt: `provider-ad-guard.js` makes Venom start at its highest quality,
  seeds Allplay's saved one, disables WebRTC, and lowers a step on stalls. A quality the viewer
  pressed (Venom's own key, `movieExtension_qualityChosen`, `qualityChosen` in WatchPreferences) is
  never changed, and an automatic choice is never saved as one.
- Venom names audio tracks from `source.audio.names` by position only, and some balancer lists
  belong to another release («Мстители», KP 263531). `alignAudioNamesWithTracks` reads the track
  languages from `source.hls` (`LANGUAGE`, else the `NAME` prefix) and, only on two or more
  conflicts with at least two tagged languages, rewrites that same array in place (Venom and its
  renewals keep the reference); a list built before the manifest arrived is rebuilt. Lengths must
  match. DASH `lang` values are positional (`ru0`…) and say nothing. Allplay (Alloha) serves one
  stream per dub, so a mislabelled dub there cannot be corrected.
- Provider embedding: the iframe itself is `no-referrer`, so the DOM never sees the extension
  URL, and `provider-embed-rules.json` restores the source site's Referer only for
  extension-initiated subframes marked `movieExtensionSite`. Without it providers substitute
  media and decoding fails while the timeline still moves, so verify real frames before and after
  seeking. `provider-ad-guard.js` (MAIN world) isolates ads without touching formats, playlists or
  time. `player-cleaner` adopts Venom's original video element and never copies another video's
  URL into it.
- `player-cleaner` observes only the active player subtree, owns only the nodes it marks and
  disposes its global listeners on reset. Its messages must match the active frame, origin and
  source request token.

### HLS and native video

- Extension-owned `<video>` elements create hls.js only through `HlsPlaybackFactory`, whose
  `DEFAULT_HLS_CONFIG` holds the quality and buffer defaults; do not set them per call site. Quality
  is not capped to the player's size; `watchStalls` steps down where qualities are separate streams.
  Redirects are refused except for pieces inside a host in `UrlPolicy.REDIRECTING_HOSTS`.
  Provider streams use the `bounded` policy (expired 401/403/404/410 manifests fail at once and
  `BaseParserService` swaps in the next compatible source); torrents use `persistent`. A handled
  failure never dispatches `extension-hls-fatal`.
- `UrlPolicy` and `HlsPolicyLoader` load before the factory, and no unmanaged HLS runs on extension
  pages. `networkProfile: 'local'` needs the current torrent session and its `localManifestUrl`.
  HDRezka has its own `hdrezka` profile (CDN hosts under `stream.voidboost.one`); its signed URLs
  stay in memory, cached descriptors hold only the public film page, and access challenges need
  the user's open-site or retry action. Only the HDRezka homepage loses its X-Frame-Options, and
  only for extension-initiated subframes; a temporary background tab is shared and closed after
  1.5 idle seconds, while tabs the user opened or focused are left alone.
- There is one quality selector, in the `player-cleaner` settings menu: labels come from
  `level.height`, «Автоматически» restores adaptive bitrate, and quality never syncs through a
  watch room. Rutube prefers its direct HLS; `RutubeWatchRoomBridge` is used only when the parser
  falls back to the iframe, and rooms store only the public `videoId`.
- Movie Details marks the torrent `<video>` with `data-player-provider="torrent"` and exposes its
  hls.js as `_movieExtensionHls`; `player-cleaner` mounts one wrapper around that same element and
  keeps autoplay behind Movie Details' buffer gate.
- Buffer kept across seeks: the extension's own hls.js keeps 300 s behind
  (`DEFAULT_HLS_CONFIG.backBufferLength`). Venom (`player-venom`: Collaps, KinoGo, Ex-FS) plays
  through dash.js 3, which on every seek removes all but the fragment being played, within a
  millisecond and before `seeking` fires. In provider frames `provider-buffer-keeper.js` (MAIN,
  `document_start`, only frames the extension embeds) wraps `SourceBuffer.prototype.remove`: it
  keeps 300 s behind and, for 2.5 s after a seek or while `media.seeking`, what is loaded
  ahead. A kept removal still runs natively on a moment that holds no data, so `updating` and
  the update events stay real. A removal across the playing moment always passes (quality
  change; holding it back restarted Venom's frame), and after a `QuotaExceededError` every
  removal passes for 30 s. The player still believes the data gone and loads it again over
  what is there. `player-cleaner`'s loader waits 800 ms when a jump lands inside
  `video.buffered` (`Timeline.isBuffered`). Checks: `node tests/providerBufferKeeper.test.cjs`,
  `node tests/playerSeekLoader.test.cjs`, live `node tests/live/player-seek.cjs`.
- Venom's engine follows the viewer (`switchEngineBySeeking` in `provider-ad-guard.js`): DASH
  (1080p on the Collaps/KinoGo/Ex-FS balancer) while watching; three seeks within 5 s switch to
  HLS (720p there, but hls.js keeps what it loaded); two minutes without a seek, or the viewer's
  pause at least 20 s after the last seek, switch back. The switch is Venom's own internal
  `renew` (`_fallFrom` drops DASH; `ignoreUrlTime` so the asked time wins), reached through the
  internal player that `make()`'s facade hands to listeners as `this`. Venom's HLS loads nothing
  until `play()`, and its module load undoes an early one, so play is retried for 20 s. Seeks
  count only from 3 s after the film plays (Venom's resume and the move to the asked time are
  not the viewer's). A new episode resets to DASH. `<html data-movie-extension-engine>` shows
  the engine. Check: `node tests/venomEngineSwitch.test.cjs`.
- Hover previews (`GhostPlayer`) never show a frame of another moment in place of the one asked
  for; keyed frames persist in IndexedDB `movieExtensionPreviewFrames` on extension pages and stay
  in memory in provider frames. Check with `node tests/playerHoverPreview.test.cjs`.
- Subtitle appearance (`movieExtensionSubtitleAppearanceV1`) is local only and never changes track
  selection or room state. YouTube trailers play through the HTTPS wrapper
  `public/player/embed.html` on Firebase Hosting, which avoids embed errors 150/153.

### Ambient light

- `src/pages/movie-details/PlayerAmbientLight.js` owns the light behind the player dialog and
  its setting (`movieExtension_ambientLight` in `chrome.storage.local`, on by default, never in
  a watch room). It takes the picture from the first path that works: a `<video>` in
  `#videoContainer` is drawn directly (drawing never reads pixels, so another site's file
  without CORS is fine); a provider frame's `player-cleaner` sends 48x27 pixels
  (`PLAYER_AMBIENT_FRAME`) while the page keeps asking (`PLAYER_AMBIENT_START`, a 6 s lease,
  so a frame stops by itself); otherwise `chrome.tabs.captureVisibleTab`, cropped to the
  video, which Chrome allows only with the literal `<all_urls>` (optional; asked when «Вкл» is
  chosen while the menu says «Нужен доступ», never for a frame that sends its own pixels).
  Host permissions such as `*://*/*` and `tabCapture` do not satisfy it.
- Frame messages count only from the current iframe's window and origin with its
  `requestId`. «Подсветка» in a frame's menu posts `PLAYER_AMBIENT_SET`; the click activates
  the page as well, so `chrome.permissions.request` works from that message. Frames whose
  video is protected or nested out of the cleaner's reach answer `PLAYER_AMBIENT_UNAVAILABLE`
  or nothing, and the light falls back to capture or says «Нужен доступ».
- It stops when the dialog is hidden or minimized, the tab is hidden, in full screen and in
  picture-in-picture; a new source starts dark. Capture is off inside another page (Live's
  frame), where a tab capture would be cropped wrongly. Checks:
  `node tests/playerAmbientLightBrowser.test.cjs`, `tests/e2e/specs/player-ambient.spec.cjs`,
  and on real providers `tests/e2e/player/ambient.spec.cjs`.

### Torrents and the local MediaPlayer

- `MediaPlayerService.js` is the only client of the optional local MediaPlayer. Pair through
  `com.movielist.mediaplayer` and keep only the device token; pass opaque short-lived `sourceId`
  values; revoke sessions when the player is destroyed; never delete a durable download on page
  close or on a setup change; never expose Jackett credentials, torrent locators or remote
  provider URLs to the extension. Retention belongs to the service (`/api/settings`), not to
  Chrome storage.
- Setup gate: enabling needs the Native Host's installation check (`detect_installation`, or
  `select_install_folder` and `verify_installation`) and `/api/capabilities` ready for torrent
  movies; failed readiness never enables torrent playback. The torrent picker also needs a TMDB
  identity. `mediaplayer:torrent` goes through `changeVideoSource` to the picker, never as a URL,
  and play/pause reuses the mounted video.
- A torrent that is still downloading is a growing EVENT playlist, which hls.js treats as live, so
  the player passes `startPosition: 0` and a retry before the first frame restarts at that
  position (`tests/torrentHlsStartBrowser.test.cjs`). Download progress and HLS-ready duration are
  separate, and 100% downloaded does not mean playable. Never claim AV1 without MediaSource
  detection. File and TV playback need `playback.fileSelection` and `torrents.television`; file IDs
  are stored per download, and an ambiguous episode is never guessed.
- Transport health is separate from download state: an outage never resets a download, shows the
  last progress as stale and hides rate, peer and ETA figures; each poller has one token-guarded
  back-off owner.
- `TorrentSourcePanel.syncTorrentVideoTimeline` publishes `video._mediaTimeline`, and
  `PlayerMediaControls.Timeline.describe` is its only reader
  (`node tests/torrentTimelineBrowser.test.cjs`). Panel layout:
  `node tests/torrentModalLayout.test.cjs`.
- The Downloads page (`src/pages/downloads/`) keeps its DOM-free rules in
  `DownloadsLibraryModel.js`. «Смотреть» never plays there: it opens Movie Details with the
  `torrentDownload` parameters, and a torrent request is stale only for another `kinopoiskId` or
  a newer request.

## Pages

### Movie Details

- `movie-details.js` keeps the controller, the player and the seasons. The companions
  (`TorrentSourcePanel.js`, `WatchRoomPanel.js`, `MetaRenderer.js`, `UserRatingsPanel.js`) install
  methods onto `MovieDetailsManager.prototype`, throw on a name clash, and load before it, both in
  the HTML and in VM test harnesses.
- The page generation advances only for another film or an unload, and every async write proves
  it first. Base metadata renders with neutral personal controls; personal reads start early and
  each patches its own region (`Promise.allSettled`).
- Before auth resolves, only browser-local metadata may render
  (`getCachedMovie(id, { localOnly: true })`); KP/TMDB aggregation, player preload, personal reads
  and admin controls wait for auth. Auth gets up to 15 s, and an unresolved auth is a retryable
  connection error, not a guest session. Metadata loads have a 25 s deadline.
- Dialogs use `role="dialog"`, `aria-modal="true"` and an accessible name, share one focus
  lifecycle and close topmost first on Escape; the episode picker stays a non-modal popover.
  The shared rating dialog handles its own Escape and Tab and is the 'rating' layer of the page
  stack (`isRatingDialogOpen()`), so the player underneath never takes them.
- The cast is one `#actorsGrid` (three full rows collapsed) of up to 150 actors (`MAX_CAST`);
  series take TMDB's `aggregate_credits`. Raise `MediaAggregatorService.CAST_SCHEMA_VERSION` when
  the cast's shape changes. The poster rail shows KP and IMDb tiles, which hold their place from
  the first paint; TMDB sits in the metadata grid. Actor ages (`ActorAgeService`) load in batches
  only when the tab opens, never as per-actor requests or person pages.
- Seasons: resume lives in `ProgressService` (`watching_progress_{movieId}`) and completed history
  in `EpisodeHistoryService` (`episode_history_v1_{movieId}`). Unreleased episodes are left out of
  completion counts, earlier episodes are never inferred as watched, and later hydration keeps an
  explicit user selection.
- Trailers: TMDB structured videos first, then Kinopoisk's, and the scraper only as an async
  fallback. Recommendations: one Kinopoisk `/like/` parse first and TMDB recommendations when it
  yields fewer than four; at least four cards. Franchise parts are batch-mapped once and never
  enter the unmapped queue. Comment links open the trailer dialog only for verified YouTube URLs
  (`Utils.extractYouTubeVideoInfo()`).
- Announce stamp (`src/pages/movie-details/announce-stamp/`): three.js is imported only when an
  announcement plays, and `scripts/vendor-three.mjs` must collect the stage's imports. The poster
  is fetched as a credentialless CORS blob so the canvas stays untainted. Every tunable is in
  `DEFAULT_ANNOUNCE_STAMP_SETTINGS`, and the exported JPEG (at most 3 MB) is exactly what
  `SCHEDULE_ANNOUNCE` sends as `stampImage`. Tests: `npm run test:announce-stamp` and
  `tests/e2e/specs/announce-stamp.spec.cjs`.

### Home and Catalogue

- Home runs the TMDB-only path (`HomeDataController` passes `tmdbOnly: true`; the cache is
  `home_discovery_cache_v14`, per language): no Kinopoisk API mapping during load. A card click
  opens the internal `resolveTmdbId` route, which finds the KP ID through the browser-context HTML
  search (`HomeMovieNavigationService`) and replaces itself with the canonical route. The older
  KP-mapped path (`CACHE_KEY`, v10) is still in `HomeCacheService`, but Home does not use it.
- Negative Home mappings and card ratings are provisional (retried after 15 minutes; legacy ones
  without `retryAfter` are stale), and a technical search failure writes no negative. The route
  shows `KINOPOISK_NOT_FOUND` only for a search that finished without a card; one that did not
  finish keeps «Повторить».
- Non-Russian payloads carry the Russian `searchTitle` for Kinopoisk searches and never wait for
  Russian data. The personal tier waits for auth and never shows the guest CTA while a session is
  being restored.
- The catalogue (`src/pages/catalog/`) is TMDB-only until a click and never resolves KP IDs for a
  whole page; old `search.html?type=...` links redirect to `catalog.html?category=...`.

### Search

- The order is parser, then order, then filter, then chunk, and cards are appended only when
  complete. No per-card Firestore read or personal hydration happens before
  `resultsGrid.appendChild(fragment)`, and every later patch checks the search generation. The
  accessible loader holds the grid until cards, an empty state or an error take over. `traceId`
  stays separate from `requestKey`, the cache identity.
- Kinopoisk search accepts only a title and years: genres, countries and exclusions filter the
  titles already loaded, so the counter under filters counts those. Year bounds start empty.
- Viewer-facing searches pass results through `KinopoiskService.withoutEmptyRecords`; ID mapping and
  Admin use `searchMovies` as it is, because they must see every record.

### Person Details

- IDs are provider-namespaced (`tmdb:{id}`, `kp:{id}`); bare numeric IDs are rejected, and the
  route's provider is authoritative. The one cross-provider step is Kinopoisk enrichment of a TMDB
  person: found by a Cyrillic alias and accepted only with the same birthday
  (`PersonDetailsService.matchKinopoiskPerson`); awards are requested only after that match.
- Without that match, TMDB→KP title mapping needs title and year (±1); a title alone decides only
  when one side has no year, and a film never matches a series. Filmography mapping never enters
  the unmapped queue.
- Kinopoisk's person API lists films without poster, year, type and votes. `PersonDetailsService`
  reads them with `KinopoiskService.getFilmCardsByIds` (one request per 250) before the first
  render, waiting 2.5 s at most; `_meta.filmDetailsVersion` marks a healed DTO. Titles past 250 are
  read only when the user opens their role. Film pages are the fallback when the batch fails.
- A film without a poster has `gallery.posters.vertical: null` in its page state while
  `img.film-poster` shows a shared picture: the state decides.
- Sort key `personFilmographySortV1`; every person has the same five orders. `syncCards` updates
  cards in place: `replaceChildren` would insert every card again.
- The first role tab: TMDB's department, else the role with the votes of the Known For titles
  (`getRoleByKnownForVotes`: 70 % counts as equal, uncredited parts are excluded), else profession.
- Facts are decoded once in the data (`_meta.factsVersion`) and escaped on output; the page never
  decodes them again.
- `CharacterNameTranslator` uses Chrome's Translator API in the Russian interface only. A
  `downloadable` model starts on a later `click` or `keyup`, because starting the download needs
  and consumes user activation.
- Awards (`AwardsParsingService`, `AwardsList`): a category link counts only inside its own
  ceremony, and the ceremony page (about 2 MB) loads only when its card scrolls into view.

### Studio

- `src/pages/studio/` opens one TMDB company (`studio.html?id=<company>`, `&media=tv` for the
  series tab). The «Студии» row of Movie Details links there only for studios with a
  `tmdbId` (`MetaRenderer.renderProductionCompanies`); «+N» is a button that shows the hidden
  ones in place (`toggleProductionCompanies`, `data-action="toggle-production-companies"`).
- Data: `TMDBService.getCompanyDetails` and `getCompanyTitlesPage` (`/discover` with
  `with_companies`, 20 a page, no storage cache). The rating order needs
  `COMPANY_RATING_MIN_VOTES` votes; the oldest-first order drops undated titles; the title
  order is TMDB's, by original title (checked live on 2026-11-27: Russian titles come out of
  order), so it is labelled «По оригинальному названию». The first
  popular pages of both media give the counts, so the requested tab gives way to one with
  titles, and the switch shows only when both have some. Sort key `studioTitlesSortV1`.
- Cards stay TMDB-only like the catalogue (`HomeRenderer`, `MovieRatingsEnrichmentService`).
  The user's scores follow the `data-movie-id` the enrichment writes: one batched
  `getUserRatingsForMovies` per new set of IDs, drawn with `MovieCard.setUserRating`, which
  keeps the score in `data-user-rating` so redrawn provider badges keep it. A rated title the
  enrichment has not identified yet shows no score.
- Country names come from `src/shared/data/countries.js` by a dynamic `import()` («США»);
  Intl's names are only the fallback. Test: `tests/studioPage.test.mjs`, rig
  `tests/e2e/specs/studio.spec.cjs` (the fake TMDB has studio 777).

### Popup, Profile, Admin, Settings and the rest

- Popup: a 400×520 action frame plus a side-panel variant. The feed's observer root is
  `#feedContent`; cache reads use `throwOnError` so an outage is not an empty feed, and
  `RatingsCacheService` results marked `isSuperseded` are ignored. At most two automatic page
  loads happen in a row until the user scrolls, and failed pagination waits for a retry.
- Profile: viewer-only data such as continue watching never shows on another user's profile.
  `ProfileInsightsView` renders the overview calendar (`ProfileActivityCalendar`) and taste match
  from the ratings snapshot and one movie batch; reactions and marathons are read only when
  «Статистика» first opens. Hours watched are kept in the cached statistics. Counted texts use
  `tn()` with `_one/_few/_many/_other` keys. A favourite person's number is the titles rated 8+
  with them (`liked`); lower ones (`other`) show in the panel but never count. Genres are counted on the page; `users.topGenres`
  is a legacy field that nothing reads. `ProfileTastePanel` owns the genre and decade charts and their
  panel: `selectFilms` must select exactly what `computeGenres`/`computeDecades` count, and averages
  are compared only over titles that have both scores. «Страны» (`ProfileCountriesPanel`, a
  subclass) opens a country in the same panel; `computeCountries` and `selectFilms({ country })`
  count every scored rating, series included, one film once per country. Country names go through
  `src/shared/data/countries.js` (Kinopoisk and TMDB spellings to ISO alpha-2 via
  `Intl.DisplayNames` plus aliases; retired codes such as DD are skipped, so «Германия» is DE);
  historical countries (СССР, Югославия) stay apart under their own name, never on a present
  country. The map is `src/shared/data/worldMap.js`, generated by `scripts/build-world-map.mjs`
  from world-atlas (Natural Earth 1:110m, rotated 11° so Russia and Fiji are whole): never edit it
  by hand. Its shapes answer the mouse only (`aria-hidden`); the list is the keyboard path. Countries
  without a shape at that scale are rounded squares, never circles. Its rows reuse
  `.insight-genres__row`, so selectors that mean genres must be scoped to `.insight-taste`. The title search filters `getRecentRatings` by
  `onlyMovieIds` from `findRatings`; the page passes `knownMovies`, so searching reads nothing.
  Local profile caches hold rendered fields only (no e-mail or admin flags), are bounded and are
  cleared on sign-out (every `profile_cache_*` key is removed). `ProfileService.loadUserRatings` keeps a
  user's ratings in `profile_cache_ratings_<uid>` and later reads only `updatedAt` or `contentUpdatedAt`
  (a review edit) at or after the newest seen, both indexed with `userId`, plus a server-side count;
  any mismatch means the full read. Every write to a rating must set one of those two fields.
  Profile and Achievements pass `localMaxAgeMs` to `getBatchCachedMovies`, which then serves compact
  `slim_movie_<id>` copies (no credits, facts, frames; only actors and directors in `persons`) for 12 h;
  a page that needs a dropped field must not use that option. Uploads use versioned names, and the old object is deleted only after the
  document points to the new one. A GIF becomes an animated WebP in the browser
  (`src/shared/utils/animatedWebp.js`, no encoder library) only when that is smaller.
- Admin: hidden until the Firestore admin check passes; user-facing copy is Russian; TMDB→KP
  mapping is inspect first, then confirm («Подобрать» only fills the ID to inspect). `AdminWorkspace.js`
  extends `AdminPanelManager` and owns routing (`#section` in the URL), first-show loading
  (`ensureSectionLoaded`) and «Обзор»; `init()` must not await section data. The overview also
  loads approvals, the ID queue, keys, Firestore usage and `getCommunityCounts`, because they feed
  the menu counters. User counters come from `getUserActivityCounts` (aggregate `count()` only,
  after the rows render); never count by downloading documents. The bundled compat SDK has no `count()`: `AdminService.countDocuments` falls back to the REST `runAggregationQuery` with the admin's ID token. Overview redraws are queued as a microtask, not `requestAnimationFrame`, which stalls in a background tab. `firestoreUsage` returns `reads.hourly` (Pacific day, by hour) and `reads.byLabel`; use them before guessing who spent the read quota. The «Эфир» card mirrors
  `#liveNowCard` from `admin-live.js` and reads nothing itself. `body.admin-page-body` uses
  `overflow-x: clip` so the sticky sidebar works.
- Settings: `settings.js` loads render-blocking from `<head>` and applies the saved language from
  `localStorage['movieExtensionLanguage']` before the first paint. Without a saved language the UI
  follows the browser's locale when it exists, otherwise English. Theme and «Курсор» apply at
  once on every open page and are outside Save/Reset: `ThemeService` and `CursorService`
  (`localStorage['movieExtensionCursor']`, absent for the defaults) own them.
- Random: the personal pool is device-local (`RandomPoolService`). The marathon round is Firestore
  `randomMarathons/current`, with admin actions in transactions; the function's `normalizePoster`
  matches the page's `PosterUrl` (`tests/randomMarathonFunction.test.cjs`).
- Marathon history (`shared/utils/marathonHistory.js`) is counted on the client: items of every round
  stay in `randomMarathons/current/items`, while the round document is overwritten. Finished rounds are
  immutable (the function refuses older rounds), so `loadMarathonItems` keeps them in
  `profile_cache_marathon_items` and reads `roundId >=` the latest seen, in full once a day. «watched» on an
  item is the admin's mark for the company; that a person watched a film is their own rating from
  `selectedAt` to a week after `resolvedAt`. A film's score averages that round's bringers and those
  raters; one rated only by its own bringer says nothing about the company (`ratedByOthers`). Never show `userName` stored with a rating there: it can be the account's real name.
- Random filters: included genres and countries combine with OR. The API answers 400 to a type it
  does not know (`tv-show` among them). `_toRequestFilters` drops the upper vote bound at the last
  stop. The votes slider is `RangeControl` with `stops`; the hidden native pair keeps real values.
  The panel's action bar is sticky: an ancestor with `overflow: hidden` (`body` included) unsticks it.
- Random modes: Pick, Pool and Marathon are tab panels on one page, not dialogs; only the wheel is a
  modal (`_activeModalId` is the wheel or nothing). The hash (`#pick|#pool|#marathon`) wins over
  `localStorage['random_page_mode']`. `R` rolls only in Pick. The Marathon render mirrors the server:
  each movie is its own spin among `queued` items, so the list groups states and never numbers an
  order; action buttons live in the panel (`#randomPanelMarathon [data-marathon-action]`).
- What's new: draft entries never open by themselves, and release packaging checks that the
  catalog covers the manifest version.
- Themes: `ThemeService` owns theme state, and `theme-init.js`, Navigation, the popup and Settings
  delegate to it. `movieExtensionTheme` always holds `dark` or `light`, what an older version reads;
  `movieExtensionThemeAuto` marks following the browser. Opening a page never stores the default.
  A page in a frame takes the stored theme: its own media query describes the page around it. The
  toolbar icon follows the browser's mode (`toolbarScheme`), because the worker has no media queries. `SeasonalThemeService` owns the holiday windows, the opt-out, the `season-*`
  class and `#seasonalDecor`, loads `src/shared/seasonal/<id>/` only in season and never changes
  the theme. Seasonal achievements count only ratings inside their window and stay out of
  `maxPoints()`; `tests/seasonalTheme.test.cjs` keeps their dates in step. «Путешественник»
  counts `countryKey` (an ISO code, or the folded name of a historical or unknown country), so
  one country spelled two ways counts once; earned tiers never go down (`mergeUnlocks`).
- Avatar frames: `rankFrameLevel` is 1-7 for a reached rank, `CAT_FRAME` (-1) for the cat's frame,
  absent to follow the rank; 0 means no frame and is never stored. `rules/firestore.rules` lists the
  same values; whether the cat's frame is shown depends on the viewed user's stored trail.
- Cat trail (`catTrail.js`, `CatDen.js`): `steps` are stored in `achievements.cat_trail`
  beside the tier and never go down. The recompute finds steps 1-2; step 3 is written only by
  `completeTrail` and cannot be recomputed, so `sync` writes changed entries by field path, never the
  whole `achievements` map.
- The cat's scene: `CatDenArt` only draws, `CatPuppet` owns every movement as springs (a pose is a set of
  targets, see `CatPoses`), `cat-den.css` owns light and colors through registered `--night`, `--moon`,
  `--beam`, `--face` and `--warm`. Stories are chains of `wait`/`tween`, so a press can skip them and
  closing drops them. The room is a layer of its own and the drawing has no SVG filters; `lights()`
  rehearses every pose behind a dark stage, because a first drawing stalls the GPU. `CatFrameParts`
  pictures are cut from the same artwork as `kitty-label.webp`: replace them together.

## Live channel and watch rooms

- **Live channel** (`CinemaChannelService`, `LiveSchedulePlanner`, `LiveStandby`,
  `LiveProgramme`): scheduled entries reserve `[startedAt, endsAt)`, and `playbackStartedAt` is a
  separate seek clock, never a grid boundary. Occupancy edits use a fresh bounded query and the
  `settings/cinemaScheduleState.revision` guard, so a stale edit is rejected. Admin pause, resume
  and seek are published only after a typed press on the player's own controls, and every other
  media move is pulled back; viewers have no playback control. A catalogue length never ends a
  fixed slot early (`lengthIsExact`); the first admin player on air stores the real file length
  once (`movie.durationMeasured`) and extends the slot only when the file is longer. Personal
  progress never picks a broadcast episode, and the player locks the broadcast selection. Run
  `npm run test:live-planner`.
- **Watch rooms** (staging): the `watchRoomsStaging` function uses server-only
  `watchRoomsStaging*` collections and the isolated `watchrooms-staging` RTDB, whose public URL
  `FirebaseManager` owns; RTDB rules, not URL secrecy, guard access. Roles are server-owned. The
  owner and controllers publish play, pause, seek and the series selection, while tracks,
  subtitles, quality, volume and speed stay local. `effectiveAtMs` is estimated server time, and
  drift is corrected by seeking only. Presence is per tab (`presenceV2/{uid}/{connectionId}` with
  `onDisconnect`); a transient disconnect never calls `join`, and terminal `409`s are not retried.
  The client checks the invite's film and sends only the server part of the code.
  `WatchRoomStagingController` waits up to 10 s for auth and calls `globalThis.setTimeout` and
  `clearTimeout` as window methods, never as unbound callbacks.

## Games

- `GamesModal` owns the menu, lifecycle, stats, overlays and keyboard routing. Each game is a
  module under `src/shared/games/`, created only when selected, with strings from `gamesI18n.js`.
  Bundled data (WordGuess, the quiz pool) lives under `src/shared/data/` and is never copied into
  `chrome.storage.local`. WordGuess puzzles are generated at build time
  (`scripts/generate_word_guess_puzzle.py`, `scripts/generate_word_guess_schedule.py`); the
  embedding model never ships in the extension.
- `libs/three.games.min.js` is the one tree-shaken three.js subset: a new import from it needs
  `npm run vendor:three` (`tests/rubiksCubeGame.test.js` checks the exports).
- Rubik's Cube: CSS `rotateZ` turns clockwise on screen, so a model turn with direction `-1`
  animates with a positive CSS angle.
- Battleship, chess and Salvo («Залп») are full pages. Online play has one writer each, the
  server-owned `battleship`, `chess` and `zalp` functions (Bearer ID token, extension-origin
  CORS, approved profile), and clients never write their collections. Each pure UMD rules file is
  copied byte for byte into `functions/` (`battleshipRules.js`, `chessRules.js`, `zalpRules.js`),
  and a test enforces the copy. Games against the computer never reach the server.
- Battleship keeps idle timers on the server clock (`serverTimeMs`). Its WebGL boards keep an
  invisible ARIA grid that owns focus, keys and what screen readers hear, and fall back to the
  flat board without WebGL or after a lost context; chess has the same flat fallback.
- Salvo is deterministic: every rule runs in `Game.tick()` at 120 Hz on per-tick controls,
  randomness comes from a per-turn seeded generator, and camera, particles and toasts never feed
  back. The server never runs the physics but checks every turn result
  (`ZalpRules.checkSnapshot`), and a turn stream must continue exactly where the stored one ends
  (`STREAM_POSITION`). Terrain fades subtract from the density and never multiply it, so no
  island is sliced flat at the map edge. `zalp.css` is token-only.
- Unit suites: `test:battleship`, `test:chess`, `test:zalp`; two-browser specs:
  `npm run test:e2e -- battleship` (or `chess`, `zalp`).

## Windows updater and Hub

- `com.movielist.updater` (`native-host/Updater`) validates signed metadata, stages ZIPs, replaces
  the unpacked directory through one recovery directory and confirms activation before cleanup.
  It never accepts shell commands or arbitrary paths from the extension; setup and apply take
  named locks, and older Setup binaries cannot downgrade it. `MovieListUpdater.csproj` `<Version>`
  is the only updater version source, and signed feeds keep the 1.1.4 `minUpdaterVersion` floor.
- `UpdateService` owns update state in the extension. Manual updates ask for confirmation when
  playback is detected, and automatic ones wait for a safe moment. Only extension-owned playback
  counts (extension pages via `UPDATE_QUERY_PLAYBACK`, the offscreen radio); never scan ordinary
  tabs. Keep `checkUpdates` alive across worker restarts (create it only when missing), treat
  only an unexpired `deferredUntil` as a deferral, and let the six-hour `nextCheckAt` throttle the
  metadata download, not the install of a release already found. Diagnostics exclude metadata
  bodies, signatures and signed URL query parameters. Component checks use the separately signed
  `components.json`; a component's `recovery_required` never blocks extension updates, and an
  absent Suite is installed only on an explicit request.
- `MovieListSetup.exe` is the single download. The Hub (WebView2 on a private origin) reuses the
  extension's `theme.css` and `tokens.css`, and `HubPrompt` loads from Navigation, never in the
  popup. Release steps are in `docs/UPDATER_RELEASE.md`.

## Open issues

- `docs/TASKS.md` tracks open work; remove an entry when it is done.
- The updater is Windows-only, and the first install still needs Developer Mode and one Load
  unpacked. Native Host end-to-end acceptance, multi-profile path mapping and the signing secret
  setup remain deployment work.
- Watch rooms are staging-only: multi-profile acceptance with native providers (owner
  play/pause/seek, viewer correction) is still needed before production.
- The Numbers relies on manually verified mappings and a small local HTML cache; it is not a
  licensed OpusData feed.
- Adding a Jackett tracker still needs Jackett's own administration; Settings only configures or
  deletes existing ones. Arbitrary unprepared seeking in a downloading torrent is unsupported.
- Legacy scalar reaction fields stay readable until a separately reviewed minimum-client-version
  migration.
