<div align="center">

# Movie Rating Extension

Chrome extension for discovering, rating, organizing, and watching movies,
series, cartoons, and anime.

<p>
  <img src="https://img.shields.io/badge/MANIFEST-V3-1687c9?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/VERSION-1.2.9-69b500?style=flat-square" alt="Version 1.2.9">
  <img src="https://img.shields.io/badge/JAVASCRIPT-ES6%2B-f0d000?style=flat-square&logo=javascript&logoColor=111827" alt="JavaScript ES6+">
  <img src="https://img.shields.io/badge/VANILLA-ES6%2B-e2c400?style=flat-square" alt="Vanilla ES6+">
  <img src="https://img.shields.io/badge/AUTHOR-FIX-f47721?style=flat-square" alt="Author Fix">
  <img src="https://img.shields.io/badge/LICENSE-MIT-9299a1?style=flat-square" alt="MIT License">
</p>

The extension combines Kinopoisk and TMDB metadata, community ratings, personal
lists, provider-aware playback, and Firebase synchronization in one interface.

</div>

## Highlights

- Discover films and series through search, catalogue pages, recommendations, and
  random picks.
- Rate titles from 1 to 10, write reviews, edit personal ratings, and browse the
  community feed.
- Manage Rated, Watching, Watchlist, Favorites, bookmarks, and custom collections.
- Open rich movie and person pages with credits, seasons, episodes, trailers,
  collections, ratings, and related titles.
- Resume series playback, track watched episodes, switch providers, and select a
  season or episode without losing the active playback context.
- Use the optional local MediaPlayer torrent source picker for films without exposing
  Jackett credentials or torrent locators to the extension.
- Use HLS and direct-video playback, AniSkip integration, and the built-in anime
  radio.
- Add watchlist and rating controls to supported external movie websites through
  content scripts.
- Use light/dark themes, Popup or Side Panel mode, localized UI, and accessible
  controls.
- Give administrators tools for user approval, moderation, mappings, and service
  diagnostics.

## Stack

| Layer | Technology |
| --- | --- |
| Extension | Chrome Manifest V3 |
| Client | Vanilla JavaScript, HTML, CSS |
| Backend | Firebase Authentication, Firestore, Storage, Cloud Functions |
| Providers | Kinopoisk, TMDB, IMDb, YouTube, The Numbers, AniSkip, Spotify, MediaPlayer |
| Playback | HLS.js, HTML5 video, provider-specific adapters |
| Build | npm, copyfiles, Terser, Rimraf, Nodemon |
| Quality | ESLint, Node.js regression tests, JSDOM, Playwright |

## Architecture

```text
Popup / pages / side panel
        │ typed runtime messages and shared services
        ▼
Background service worker ── Offscreen documents ── Content scripts
        │
        ├── Provider adapters: Kinopoisk, TMDB, IMDb, streaming providers
        ├── Local cache: chrome.storage.local
        └── Cloud data: Firebase Auth, Firestore, Storage
```

The extension keeps provider concerns behind shared services. Movie identity is
resolved before enrichment, with Kinopoisk IDs retained as the legacy-compatible
root identifier. Local caches reduce repeated provider requests, while Firestore
stores account data, ratings, aggregates, and synchronized collections.

Playback is isolated behind parser and provider capability contracts. The player
controller owns selection, lifecycle, progress, and episode state so provider
switches do not silently overwrite the user's explicit season or episode choice.
The optional MediaPlayer torrent flow is a separate local capability: Native
Messaging pairs the extension, while the extension handles only opaque source IDs
and short-lived playback sessions.

## Repository layout

```text
.
├── CONTEXT.md              # Canonical product and visual terminology
├── src/
│   ├── background/       # Service worker and declarative network rules
│   ├── offscreen/        # Browser-context scraping and audio documents
│   ├── pages/            # Home, search, catalogue, details, profile, admin, etc.
│   ├── popup/            # Popup and Side Panel entry point
│   └── shared/           # Services, components, config, errors, i18n, styles
├── content-scripts/      # Watchlist, rating, scraper, and player integrations
├── functions/            # Firebase Cloud Functions
├── rules/                # Firestore and Storage security rules
├── scripts/              # Build, minification, backfill, and puzzle generators
├── tests/                # Unit, contract, integration, and regression tests
├── libs/                 # Bundled third-party browser libraries
├── docs/                 # Focused architecture and operational notes
├── manifest.json         # Source Manifest V3 configuration
└── dist/                 # Generated extension bundle; never edit directly
```

## Requirements

- Node.js and npm.
- A Chromium browser with Manifest V3, Side Panel, and Offscreen Document support.
- Provider credentials configured for the services enabled in your environment.
- A Firebase project when authentication, ratings, profiles, or synchronization are
  used.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure provider credentials. Start from
   `src/shared/config/tmdb.config.example.js` and create the local
   `src/shared/config/tmdb.config.js` with your TMDB Read Access Token(s).

3. Configure the Kinopoisk proxy secret in Firebase Secret Manager. Store a JSON
   array of keys; the command prompts for the value and never writes it to the
   extension source:

   ```bash
   firebase functions:secrets:set KINOPOISK_API_KEYS --project movielistdb-13208
   ```

   Deploy the proxy before installing the updated extension. The proxy requires
   a Firebase ID token and returns `AUTH_REQUIRED`, `KP_QUOTA_EXHAUSTED`, or
   `KP_UPSTREAM_UNAVAILABLE` without exposing provider credentials. After the
   new flow is verified, revoke any previously exposed Kinopoisk keys.

4. Configure Firebase for the target project and deploy the rules/functions that
   belong to that environment. Keep credentials and service-account files out of
   version control.

5. Build the extension:

   ```bash
   npm run build
   ```

6. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select the generated `dist/` directory.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Clean, copy, and minify the production bundle into `dist/` |
| `npm run dev` | Build once and rebuild when source files change |
| `npm run lint` | Run ESLint for source and content-script JavaScript |
| `npm test` | Run the complete regression suite |
| `npm run test:rating-uniqueness` | Verify the one-rating-per-user-and-movie contract |
| `npm run test:rating-integrity` | Verify rating ingress and legacy-record deduplication |
| `npm run test-word-guess` | Run WordGuess data, controller, and persistence tests |
| `npm run test-games-modal` | Run mini-games launcher and Rubik's Cube tests |
| `npm run test:visual-design` | Verify the monochrome palette and shared UI token contract |
| `npm run test:media-player` | Verify the local MediaPlayer client and torrent picker contract |
| `npm run package` | Build and create `movie-rating-extension.zip` |
| `npm run backfill` | Run the administrative Firestore backfill utility |

After a rebuild, reload the unpacked extension from `chrome://extensions`. Source
files live under `src/`; `dist/` is generated output and must not be edited by hand.

## Data and security notes

- Authentication and account-scoped data are handled through Firebase.
- Ratings, watchlists, favorites, collections, and movie aggregates are protected
  by Firestore rules and the approved-user lifecycle.
- Provider responses and playback state may be cached in `chrome.storage.local`.
- Content scripts run only on the domains declared in `manifest.json` and exchange
  data with the extension through runtime messaging.
- Do not commit `tmdb.config.js`, service-account keys, API tokens, or other local
  credentials.

## Operational notes

- Provider availability and HTML layouts can change without notice; provider
  adapters include fallbacks, caching, and bounded retry behavior where possible.
- Kinopoisk and other provider quotas are guarded by rotation and circuit-breaker
  logic. Kinopoisk API keys belong only to Firebase Secret Manager; client API
  requests must use the authenticated `kinopoiskProxy` and avoid unbounded calls.
- The Numbers integration is an opt-in, low-volume HTML adapter and is not a
  substitute for a licensed data feed.
- Generated files in `dist/` should always be refreshed through the npm build
  scripts.

## Documentation map

- [`CONTEXT.md`](CONTEXT.md) — canonical project and visual terminology.
- [`docs/PARSERS.md`](docs/PARSERS.md) — parser and provider integration notes.
- [`docs/dynamic-parser-architecture.md`](docs/dynamic-parser-architecture.md) —
  parser architecture plan and boundaries.
- [`docs/movie-details-performance-tracing.md`](docs/movie-details-performance-tracing.md)
  — MovieDetails performance tracing.
- [`docs/design-system.md`](docs/design-system.md) — visual language, neutral palette,
  CSS ownership, allowed color exceptions, and UI review checklist.
- [`docs/UPDATER_RELEASE.md`](docs/UPDATER_RELEASE.md) — signed GitHub release and
  one-time Windows updater setup.
- [`docs/README.md`](docs/README.md) — extended user-facing feature guide.

## License

MIT

## Changelog

Release entries are intentionally collapsed to keep this page readable. The
manifest and package version remain the source of truth for the build version.

<details>
<summary><strong>1.3.3</strong> — исправлен запуск установщика</summary>

### Fixes

- Открывать setup-окно при двойном клике по `MovieListSetup.exe`.
- Сохранить отдельные режимы Native Messaging и фонового выполнения обновления.

</details>

<details>
<summary><strong>1.3.2</strong> — cross-platform release checks</summary>

### Fixes

- Stabilize source and contract-test line endings across Windows and Unix checkouts.
- Normalize visual regression-test input before evaluating CSS contracts.

</details>

<details>
<summary><strong>1.3.1</strong> — release-test portability</summary>

### Fixes

- Normalize regression-test line endings for Windows GitHub Actions checkouts.

</details>

<details>
<summary><strong>1.3.0</strong> — provider-key endpoint deployment</summary>

### Features

- Add optional 5000-character movie reviews with bounded previews and a full reader.
- Integrate review previews into rating cards without a nested card surface.
- Use the themed surface for the full review reader modal.
- Preserve rating aggregates and compact caches during review-only edits.
- Add review reports with Firestore-validated target metadata.

- Keep torrent playback above the release browser with accessible in-modal scrolling.
- Restore player focus after torrent selection and keep the modal above navigation.
- Show durable per-film torrent downloads after reopening Movie Details.
- Add pause, resume, retry, play, delete, progress, speed, peers, and ETA actions.
- Preserve downloaded torrent pieces when a user pauses an active movie download.
- Add panel-local torrent quality filters and sorting by seeds, quality, and size.
- Add an optional MediaPlayer torrent source picker for film playback.
- Add a MediaPlayer setup gate for enablement, install-folder selection, and verification.
- Support Native Host folder selection and installation verification.
- Hide MediaPlayer setup controls while the integration is disabled.
- Add MediaPlayer retention settings with a seven-day default and a Never option.
- Pair with MediaPlayer through Native Messaging and keep Jackett credentials local.
- Show bounded torrent metadata and monitor playback download progress.
- Negotiate browser codecs for remux-first torrent playback through MediaPlayer.
- Advertise browser AV1/fMP4 support so compatible 4K video is copied without downscaling.
- Keep AV1 disabled when browser capability detection is unavailable.
- Send codec capabilities when reopening saved downloads as well as starting new torrents.
- Show HLS-ready duration separately from torrent download percentage.
- Wait for a mode-aware playback buffer before starting torrent video autoplay.
- Show whether fallback preparation affects only audio or only video.
- Poll incremental torrent search results and append bounded batches while indexers continue.
- Fix torrent source visibility for films with empty season metadata.
- Bound Native Host pairing waits and surface bridge timeout errors.
- Allow cold Jackett searches to finish before the client timeout.
- Allow slow Jackett aggregate searches to finish before the client timeout.
- Clarify torrent download progress separately from the available playback time.
- Show growing HLS playback duration beside torrent speed, peers, and download ETA.
- Replace the Torrent status strip with a unified inline workspace for active and saved downloads.
- Add progressive 10-item release reveal with accessible disclosure and active-download actions.
- Reuse one native player for delayed torrent HLS sources and preserve its lifecycle.
- Expose available HLS audio and subtitle tracks in the shared player settings menu.
- Add an isolated, lazy timeline hover preview that never seeks the main video.
- Add persistent subtitle appearance controls for size, color, position, offset,
  background opacity, and text shadow.
- Apply saved subtitle appearance changes to supported native captions in an open player.
- Move subtitle appearance controls into the player's Subtitles menu for in-context changes.
- Release the first priority-safe parsed source before slower providers finish.
- Continue background source discovery and persist the final normalized provider set.

- Add an optional cursor-driven sphere view for exploring rated movies with local magnification.
- Add 24-hour poster caching and non-overlapping radial cursor-focus behavior.
- Add gradual focus-priority poster loading with a bounded per-frame budget.
- Restrict Canvas poster decoding and drawing to a maximum 32-item cursor focus group.
- Keep the focus field gently moving while preventing peripheral image loads during sweeps.
- Persist poster bytes across page reloads through the extension-origin cache and background fetch.
- Normalize poster cache keys and version cache metadata for reliable 24-hour reuse.
- Cancel poster requests that leave the focus group and pause the renderer in hidden tabs.
- Use a fixed radial falloff with a 4x center and base scale beyond 1.25 lens radii.
- Add live `k1`, `k2`, radius-scale, and strength controls for radial-lens calibration.
- Deform all 255 Canvas cells while keeping poster loading bounded to the focus group.
- Use LUT-backed inverse hit-testing with monotonicity, derivative, boundary, and round-trip guards.
- Transform the local dot field with the same radial map while keeping the outer CSS field static.
- Use a rectangular focus surface without a circular lens overlay or circular clip.
- Use a rectangular `Сетка / Фокус` mode switcher without pill-shaped corners.
- Keep the selected film as a subtle idle focal point after the pointer leaves the canvas.
- Restore the flat grid when the selected film is cleared and keep hover focus prioritized.
- Show selected movie previews, full details actions, and an accessible movie-list fallback.
- Preserve the grid as the default view with responsive touch and reduced-motion support.
- Fix poster loading so new exploration items do not stack in the upper-left corner.
- Document the Canvas exploration architecture and implementation sequence.
- Add Canvas layout, pointer, and selection contract coverage.

- Add an action-led admin ID workspace that opens the active queue and requires
  Kinopoisk candidate verification before a manual TMDB mapping can be confirmed.
- Share admin-verified TMDB→Kinopoisk mappings through Firestore for authenticated users,
  with conflict-safe publication of existing local mappings.
- Enforce one-to-one shared ID links with transactional Firestore reverse locks, strict cloud
  record validation, and stale-cache eviction after a shared mapping is removed.
- Add the server-only watch-room access foundation: RTDB ACL gates, room rules,
  public-index query limits, and an opt-in provider sync capability contract.
- Provision an isolated staging RTDB target and durable room/invite lifecycle outbox.
- Add private staging room controls with one-time invite codes and host-only
  KinoGo timeline synchronization.
- Add a server-verified controller role: the owner may grant or revoke shared timeline
  control for the invited participant while source, invite, and role authority stay owner-only.
- Show a persistent owner copy-code control and live room-member list backed only by
  RTDB membership and presence updates.
- Synchronize the creator's parser-provider choice before applying the room timeline,
  without storing or transmitting embed URLs.
- Support the same room bridge for iframe providers and Rutube's direct native-video
  mount, including a bounded wait while a player is attaching.
- Restore Rutube's native HLS player as the preferred mount; use the embed player only
  when no direct source is available.
- Surface Rutube HLS variants in the existing native-player quality menu, with
  user-facing labels and an automatic adaptive-bitrate mode.
- Add official Rutube iframe room synchronization with owner-published public video IDs,
  exact viewer source selection, and no shared balancer URL or private-access data.
- Let a reviewer mark a selected part of their review as a concealed spoiler.
- Avoid staging ACL-outbox writes because the room endpoint already mirrors RTDB access
  synchronously, and rebind room telemetry whenever KinoGo replaces its media element.
- Keep staging room persistence server-only in Firestore and mirror membership ACLs to
  the isolated RTDB target before a client subscribes.
- Raise staging rooms to 10 total participants with 9 invite redemptions.
- Add per-connection RTDB presence with stale detection and heartbeat.
- Restore room sessions after transient RTDB disconnects without a new join.
- Isolate V2 presence connections from legacy clients and make room creation retry-safe.
- Publish 10-person room capacity and reconnect presence changes to Firebase.
- Deploy a bounded daily cleanup for expired staging rooms with a 50-room cap and one retry.
- Publish the provider-key management function to us-central1.
- Migrate 3 Kinopoisk credentials into the per-key Secret Manager registry.
- Show aggregate remaining quota for active provider keys in the admin header.
- Add TMDB to the managed provider registry and migrate its legacy server token.
- Route TMDB requests through active registry keys with safe rotation on rejection.
- Separate Kinopoisk daily quota from TMDB's non-numeric rate-limit status.

### Fixes

- Repair missing rated-film projections and prevent client-side aggregate drift.
- Deploy Firestore guards that reserve rating aggregate fields for server-owned writes.
- Route restored torrent selections to the torrent workspace instead of an external-protocol iframe.
- Retry transient progressive HLS failures while a torrent is still downloading.
- Keep completed torrent percentage separate from actual HLS playback readiness.
- Collapse visually identical torrent releases across indexers before display.
- Hide empty playback status containers and use a compact active-download status card.
- Keep torrent quality filters visible when the selected quality has no releases.
- Surface probing, remux, and fallback-transcode states instead of a generic spinner.
- Use the shorter startup buffer for audio-only fallback preparation.
- Label torrent ETA as time to full download instead of confusing it with video duration.
- Link playback sessions to canonical download cards to prevent duplicate torrent entries.
- Keep playback failures separate from active torrent download failures.
- Mark torrent cards as stale and back off polling when the local MediaPlayer is unavailable.
- Recover torrent/download progress automatically after the local service returns.
- Cancel obsolete MediaPlayer polling requests during torrent monitor teardown.
- Cover MediaPlayer polling backoff and cancellation with regression tests.
- Prevent duplicate player wrappers after delayed torrent source mounting.
- Stop timeline preview fetching and clear stale frames on leave or source teardown.
- Restore previous and next episode actions through the trusted canonical player bridge.
- Keep the center Play action mathematically centered while isolating its optical glyph offset.
- Optically center the lower Play triangle with leftward and upward path corrections.

- Revoke MediaPlayer playback sessions when the player is destroyed.
- Handle missing MediaPlayer, missing TMDB identity, and unavailable indexers in the picker.
- Extend the Native Host folder-picker timeout while users browse for an installation.
- Fix the dirty Settings save button contrast against the primary gradient.

- Execute native HLS quality actions directly instead of clicking a missing provider control.
- Bind IMDb automatic lookup to the same pending queue shown in the admin workspace.
- Synchronize play, pause, and seek in both directions between the owner and controller.
- Keep audio, subtitles, quality, volume, and playback speed local to each room participant.
- Map Rutube ready, playback-state, current-time, and seek events into the existing
  room timeline while rejecting malformed or cross-origin player messages.
- Clear the role-change progress message after a successful room role update.
- Route create, join, copy-code, and members actions through one reload-safe room control handler.
- Prevent a controller timeline update from remounting the owner's already selected source.
- Distinguish empty, previewed, and selected movie ratings by star fill and clear status text.
- Surface a cancelled room-state subscription so viewers receive the exact RTDB error.
- Apply room state immediately when the viewer already has the creator's source ready.
- Complete a viewer source switch only after the replacement player confirms readiness.
- Retry early iframe readiness probes and serialize coalesced host room-state updates.
- Arm presence cleanup before recording the user as online.
- Preserve watch-room HTTP status and error codes for terminal 409 handling.
- Expand expired-room cleanup to 10 members while retaining one invite document.
- Clear the room-code copy confirmation automatically and preserve participant names.
- Reuse the local profile-display cache in room presence and remove the duplicate room count.
- Fall back to the visible profile name when Auth and cache metadata are empty in a room.
- Permit bounded presence display names in RTDB so generic viewers update live.
- Document a bounded daily cleanup plan for expired staging watch rooms.
- Harden the cleanup plan with bounded retry, failure isolation and anomaly handling.
- Require local room expiry detach and bounded logs before scheduled cleanup runs.
- Keep expiry detach write-free under expired RTDB rules and retain normal presence removal.
- Keep cleanup observability to bounded logs; defer custom metrics and alerts pending budget approval.
- Close expired or server-deleted room sessions locally without an RTDB write or room restore.
- Wait briefly for Firebase Auth restoration when a user creates or joins a room immediately after page load.
- Preserve the browser Window receiver when arming or clearing a room-expiry timer.
- Keep Search usable during Firebase delays and recover late collections or source-load failures.
- Allow the stable extension origin to call the private staging watch-room endpoint.
- Permit an approved room member to atomically write only their validated presence record.
- Hide inactive room controls so a connected room cannot be mistaken for a new session.
- Keep rooms session-scoped after a reload; entering again requires an active invite.
- Re-subscribe a remounted provider iframe to its active room so host play, pause, and seek events continue to synchronize.
- Trace room subscription, player telemetry, RTDB publication, and viewer application in the browser console without extra database writes.
- Restore the administrator menu on catalog pages by loading the profile service.
- Return unauthenticated provider-key requests as 401 instead of 500.
- Preserve a safe admin authorization error contract for the key-management UI.
- Normalize Secret Manager project-number references during provider-key access.
- Restore live Kinopoisk proxy and admin key test/quota operations after migration.
- Read exact Kinopoisk key quotas from the non-billing `/v1.5/token` response.
- Ignore stale pre-migration Kinopoisk cooldown state after proxy recovery.
- Keep loaded comments visible when a same-film detail view replaces its DOM.
- Reduce main-thread work while loading similar films.
- Bound the Kinopoisk similar-film parser queue and request to 3.5 seconds before fallback.
- Defer offscreen recommendation poster decoding.
- Keep deferred recommendation posters outside the initial decode burst on short carousels.
- Add granular scraper and recommendation render timing telemetry.
- Restore readable report URLs and resolved-state labels on dark admin surfaces.
- Keep disabled MovieDetails tabs and announcement controls readable in both themes.
- Stop recurring missing-icon requests by routing admin and search fallbacks through IconUtils.
- Prefer canonical numeric personal ratings when incomplete legacy records have the same movie ID.
- Configure the isolated watch-room RTDB in the versioned Firebase client config so Git installs can create rooms.
- Allow a signed-in user to bootstrap their missing canonical comment-reaction document inside a transaction.
- Require provider bridge acknowledgements to match the active frame, origin, provider, season, and episode.
- Reject stale overlapping episode bridge responses before they can change playback.
- Require cleaner-side provider DOM confirmation before returning `APPLIED`.
- Label native HLS quality choices from manifest heights instead of guessed provider ladders.
- Remove the legacy embedded episode-list button from the default player path.
- Retire the legacy episode-picker emergency flag and empty toggle listener.
- Avoid caching empty parser source results as successful video discovery.
- Stream parser results into source preloading while preserving provider priority order.

### Docs

- Document MediaPlayer service-health recovery and stale download-state handling.
- Document staged ratings recovery, server-owned aggregates, and integrity monitoring.

- Add a unified player parsing, performance, quality, and episode-picker audit plan.

- Document the approved unified Torrent workspace redesign and its state matrix.
- Document the plan to retire the ratings Focus mode and preserve the default grid.
- Add a durable migration plan for shared TMDB–Kinopoisk identity mappings.
- Define the Yin-Yang monochrome visual contract and CSS ownership rules.
- Document approved color exceptions and the dark/light visual review checklist.
- Define and harden the private watch-room plan: RTDB-confirmed activation, indexed
  repair queues, recoverable approval gates and low Firebase usage.
- Harden the comment/review plan with aggregate, cache, moderation, and rollout gates.

### Refactor

- Remove the experimental ratings Focus mode and keep the ordinary grid as the only view.
- Remove the retired Canvas renderer and sphere-only poster loading bridge.
- Delete the retired 24-hour sphere poster cache namespace without touching other caches.
- Start the canonical neutral token migration for shared, Home, and Catalog UI.
- Add an automated visual design contract for palette and focus-token regressions.
- Extend neutral interaction states across MovieDetails, Player, Profile, Search,
  Admin, Ratings, Watchlist, MovieCard, and PersonDetails affordances.
- Make canonical theme tokens take precedence over legacy page-local accent aliases.
- Normalize Random, Collection, Popup, and external watchlist state affordances.
- Expand the visual contract guard to cover all migrated page and shared scopes.
- Neutralize residual Admin, MovieDetails, MovieCard, and report-widget chrome.
- Raise dark/light muted-text contrast above 4.5:1 and retire generic popover tokens.
- Classify every source stylesheet in the visual contract test.

</details>

<details>
<summary><strong>1.2.10</strong> — compact reaction picker</summary>

### Features

- Hide unused reaction choices behind a compact add-reaction picker.
- Show active and already-used reaction counts in the comment row.
- Close the reaction picker on selection, outside click, or Escape.
- Center the add-reaction icon geometrically inside its circular button.
- Add a shared Firestore-backed emoji catalog with admin add/remove controls.
- Publish custom reaction labels and IDs to all compatible clients with bundled fallback defaults.
- Preserve custom reaction labels when a locale has no translation key.
- Add Firebase Storage images for custom shortcode reactions with text fallback.
- Support file selection, drag-and-drop, and Ctrl+V image paste in the admin panel.
- Reposition the reaction picker above the trigger when the viewport has no room below.
- Keep the reaction picker anchored inside movie detail cards and modals.
- Remove the distracting yellow border from active reactions.
- Increase reaction emoji visuals by 5%.
- Contain custom reaction images inside their visual bounds.
- Hide reaction counts inside the emoji picker.

</details>

<details open>
<summary><strong>1.3.0</strong> — content discovery, rating enrichment, and calendar integration</summary>

### Features

- Filter out promotional videos, trailers, and gameplay showcases from discovery carousels and categories.
- Exclude video game promos and behind-the-scenes titles across TMDB discovery and Home candidates.
- Add title-based IMDb search suggestion parser and fallback for unreleased or unlinked titles.
- Add schema.org JSON-LD structured data rating parser to ImdbParsingService for enhanced accuracy.

### Fixes

- Require a trusted Ex-FS save click and deduplicate legacy ratings in reads and aggregates.
- Enforce one canonical rating document per user and movie; reject duplicate and forged creates.
- Route Calendar TMDB requests through TMDBService proxy when client API keys are absent.
- Update CalendarService to retrieve tracked items via FavoriteService and local cache.
- Add TMDBService script tag to calendar.html for global service discovery.
- Support Kinopoisk and TMDB ID navigation in Calendar episode and premiere cards.
- Preserve chronological reaction order on comments by appending new reactions to the right.
- Retain existing active reactions in place and remove zero-count reactions cleanly.
- Fix visual busy-state loss and click dropping during optimistic reaction updates.
- Store chronological reaction order server-side in derived reaction summaries.
- Fix optimistic count mutation delta calculation on toggle on/off.
- Fix reaction picker cutoff by enforcing a compact 6-column grid and safe non-negative left offset.
- Center reaction picker alignment relative to the add-reaction trigger button.
- Replace text-based chevron in the box office chart with a clean vector SVG icon.
- Fix box office chart Y-axis layout, font size, contrast, and padding for optimal readability.
- Fix reaction interaction on own comments by ensuring comprehensive movie ID fallback resolution.
- Enable reactions on all ratings even when no text comment is provided.
- Add sign-in warning toast on unauthenticated reaction clicks in Search.
- Expose native TMDB IMDb IDs and unblock direct IMDb rating enrichment when KP ratings are missing.
- Fix admin comment reaction preview layout by constraining asset image overflow and sizing.

### Refactor

- Clean up unused legacy Firestore REST helpers from background service worker.

</details>

<details>
<summary><strong>1.2.9</strong> — TMDB proxy hardening</summary>

### Features

- Add admin Firestore usage cards for storage, reads, and writes.
- Add a protected Cloud Monitoring bridge for admin usage metrics.
- Deploy the Firestore usage endpoint to us-central1.
- Add an admin API-key registry with add, test, enable, disable, revoke, and quota controls.
- Store provider credentials as per-key Secret Manager versions with safe Firestore metadata.
- Rotate active Kinopoisk credentials through a bounded server-side key pool.

### Fixes

- Harden admin controls, keyboard navigation, mobile layout, and auth/report states.
- Hide protected admin navigation before authorization and stabilize the denied state.
- Add dialog semantics, focus management, and complete Russian labels to admin auth.
- Keep admin tables visible during refresh and add retryable section error states.
- Keep Firestore usage failures localized without exposing provider error details.
- Localize admin table counters, actions, fallbacks, and destructive dialogs.
- Distinguish invalid-email feedback and associate auth errors with their fields.
- Move the mobile report trigger into a bottom safe area below protected-state alerts.
- Route TMDB requests through Firebase Functions when the local secret config is absent.
- Keep the TMDB token in Firebase Secret Manager instead of exposing it to the extension.
- Remove runtime references to the ignored local TMDB config file from extension pages.
- Treat the Firebase TMDB proxy as a configured discovery provider without a local token.
- Normalize object-shaped genres in popup rating cards.
- Keep legacy rated movies visible when pagination fields are missing.
- Resolve popup rating titles when cached and rating movie IDs use different types.
- Repair visible legacy rating cards that lack cached movie metadata.
- Keep rated movies visible when their aggregate average is stale or missing.
- Normalize legacy string movie IDs in rating and aggregate queries.
- Recover popup movie metadata from legacy localStorage when the KP API is unavailable.
- Route Kinopoisk API requests through an authenticated Firebase proxy backed by Secret Manager.
- Provision the temporary Kinopoisk API secret version used by the proxy rollout.
- Keep the random-page error icon centered with its message.
- Restore three orphaned rated movie projections with metadata and aggregates.
- Promote cached movie metadata when a rating caller omits movieData.
- Preserve complete descriptions and posters during ratings cache hydration.
- Preserve movie metadata from the ratings cache during local hydration.
- Document the ratings projection integrity and prevention plan.
- Render ordered search cards before optional personal-state hydration.
- Batch personal ratings and bookmark lookups for search chunks.
- Ignore stale searches and abort superseded provider requests.
- Add end-to-end search timing traces across page, provider, queue, iframe, and DOM.
- Expose timeout, scraper, fallback API, and personal hydration durations.
- Preserve parser order while resolving complete Kinopoisk card entities.
- Keep the search loader visible until posters and metadata are ready.
- Reuse the active search loader to prevent duplicate loader flashes.
- Bound and parallelize recommendation ID mapping fallbacks to keep similar films responsive.
- Add parser-first Kinopoisk `/like/` recommendations with preserved order and API fallback.
- Upgrade Kinopoisk recommendation posters to bounded high-resolution variants and invalidate stale cache.
- Add emoji reactions to comments with optimistic, per-user toggles.
- Allow up to three different reactions per user on each comment.
- Aggregate reaction counts server-side without changing rating aggregates.
- Add shared accessible reaction controls and theme-aware comment styling.
- Make reaction updates transactional across tabs and mixed client versions.
- Validate each reaction's movie identity against its rating document.
- Keep legacy scalar reaction fields as a compatibility mirror during rollout.
- Localize reaction labels and improve keyboard/busy states.

### Docs

- Document the Secret Manager API-key registry, admin controls, and quota semantics.

### Refactor

- Align MovieDetails action button text with the page base type scale.
- Remove duplicate shared CSS imports that overrode canonical popover tokens.
- Add regression contracts for single shared CSS ownership across page surfaces.
- Keep generic `.btn-primary` styling under a single shared CSS owner.
- Migrate profile primary actions to the shared `.btn` base.
- Add a contract test that rejects duplicate generic button owners.
- Unify generic `.btn` and `.btn-secondary` ownership in shared components.
- Scope Search modal button styling and name the Random pool variant explicitly.
- Migrate Profile secondary actions to the shared button base.
- Move base button active and responsive rules into the canonical component owner.
- Strengthen the CSS owner guard to inspect selector lists and nested media rules.
- Remove duplicate base button interaction and responsive declarations.
- Unify accent, ghost, and danger button ownership in shared components.
- Remove page-level semantic button overrides from ratings, watchlist, settings, and modals.
- Add semantic danger button tokens and migrate Random pool cleanup to the shared button base.
- Name the MovieDetails dashed review control as an explicit local variant.
- Remove unused legacy `.movie-actions` and `.action-btn` style owners after MovieCard migration.
- Centralize Movie Details and Search action layout under the shared CSS owner.
- Add a contract guard for shared movie action group ownership.
- Route Home and PersonDetails cards through the canonical MovieCard renderer.
- Retire duplicate legacy movie-card CSS and runtime fallback owners.
- Restore Collection removal through the canonical MovieCard action menu.
- Harden MovieCard menu keyboard semantics and shared outside-click lifecycle.
- Retire stale class-based card action handlers and styles.
- Add Collection removal interaction regression coverage.
- Route Collection delete confirmation through the shared modal shell.
- Add a contract test for shared modal ownership and scoped variants.
- Route Ratings detail dialogs through the shared modal shell and scoped variants.
- Route Admin delete dialogs through the shared modal shell.
- Scope Profile edit and cropper dialogs on top of the shared modal shell.
- Scope Search detail modal sizing on top of the shared modal shell.
- Move Collection and Watchlist dropdown shell ownership to shared components.
- Migrate simple rating dialogs to the shared modal shell across Favorites and lists.
- Migrate Settings language dropdown markup to the shared dropdown contract.
- Add modal and dropdown contract coverage for the migrated page variants.
- Scope MovieDetails overlay backdrop styling to its explicit page variant.
- Remove duplicate modal overflow rules from the shared overflow-fixes layer.
- Scope page light-theme dropdown variants beneath their owning page roots.
- Centralize popup/Search menu-item interactions under the shared menu owner.
- Move popup average-score tooltip surface styling to the shared tooltip owner.
- Centralize Popup and Search popover surface geometry with scoped visual tokens.
- Scope Navigation and Profile dropdown items beneath their owning containers.
- Add popup surface contracts and standardize Search dialog accessibility attributes.
- Route player volume, settings, and episode-picker popovers through `.popover-surface`.
- Remove duplicate player-cleaner inline surface declarations.
- Add player surface contract coverage for host and iframe-safe popovers.

### Docs

- Document the admin-panel visual, functional, responsive, and accessibility audit.

### Features

- Add signed GitHub ZIP metadata and a Native Messaging updater for Windows.
- Add a one-time setup mode with automatic staging, rollback, and activation checks.
- Add automatic-update settings with deferred and failure states in the popup.
- Add a direct Setup download action when the Native Host is not connected.
- Retry waiting updates automatically after playback becomes safe to replace.
- Distinguish update retry errors from rollback-available failures.
- Guard the updater with exact origins, version gates, size limits, and operation locks.
- Serialize confirmation and rollback, and restore the active install after a failed rollback move.
- Add a settings test control to download and install the latest GitHub release.
- Run regression tests and publish release assets through a draft release pipeline.
- Fail release packaging when the archive contains local configuration or build errors.

</details>

<details>
<summary><strong>1.2.8</strong> — documentation cleanup</summary>

### Docs

- Reorganize README into concise product, setup, architecture, and security sections.
- Make each release entry independently collapsible with native HTML details blocks.
- Add a centered badge strip for the manifest, version, stack, author, and license.
- Set the extension and package metadata version to 1.2.8.

</details>

<details>
<summary><strong>1.6.0</strong> — maintenance hardening</summary>

- Fix crew accordion lifecycle and normalize structured genre values in rating UI.

</details>

<details>
<summary><strong>1.5.7–1.5.9</strong> — player and metadata hardening</summary>

- Harden playback selection, provider switching, metadata normalization, and cached
  identity recovery across MovieDetails and parser flows.

</details>

<details>
<summary><strong>1.5.0–1.5.6</strong> — player, seasons, and recommendations</summary>

- Add structured seasons and episodes, resume/history state, provider-aware episode
  selection, recommendations, and related MovieDetails improvements.

</details>

<details>
<summary><strong>1.4.0–1.4.9</strong> — identity, catalogue, and admin tooling</summary>

- Add TMDB/Kinopoisk identity recovery, catalogue pagination, franchise navigation,
  recommendation mapping, approval workflows, and parser regression coverage.

</details>

<details>
<summary><strong>1.3.0–1.3.9</strong> — playback UX and content discovery</summary>

- Add the host season/episode picker, native provider bridges, franchise and
  recommendation sections, card rating enrichment, and expanded discovery pages.

</details>

<details>
<summary><strong>1.2.7–1.2.9</strong> — ratings, profiles, and cache reliability</summary>

- Improve rating pagination and aggregates, profile dashboards, provider rating
  refresh, cache recovery, and movie-details rendering reliability.

</details>

<details>
<summary><strong>Earlier releases</strong> — core product foundation</summary>

- Add authentication, profiles, ratings, reviews, watchlists, favorites, custom
  collections, external-site controls, themes, playback, and the first admin tools.

</details>
