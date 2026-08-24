<div align="center">

# Movie Rating Extension

Chrome extension for discovering, rating, organizing, and watching movies,
series, cartoons, and anime.

<p>
  <img src="https://img.shields.io/badge/MANIFEST-V3-1687c9?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/VERSION-1.2.8-69b500?style=flat-square" alt="Version 1.2.8">
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
| Providers | Kinopoisk, TMDB, IMDb, YouTube, The Numbers, AniSkip, Spotify |
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

## Repository layout

```text
.
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

3. Configure Firebase for the target project and deploy the rules/functions that
   belong to that environment. Keep credentials and service-account files out of
   version control.

4. Build the extension:

   ```bash
   npm run build
   ```

5. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select the generated `dist/` directory.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Clean, copy, and minify the production bundle into `dist/` |
| `npm run dev` | Build once and rebuild when source files change |
| `npm run lint` | Run ESLint for source and content-script JavaScript |
| `npm test` | Run the complete regression suite |
| `npm run test-word-guess` | Run WordGuess data, controller, and persistence tests |
| `npm run test-games-modal` | Run mini-games launcher and Rubik's Cube tests |
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
  logic. Avoid adding unbounded background requests.
- The Numbers integration is an opt-in, low-volume HTML adapter and is not a
  substitute for a licensed data feed.
- Generated files in `dist/` should always be refreshed through the npm build
  scripts.

## Documentation map

- [`docs/PARSERS.md`](docs/PARSERS.md) — parser and provider integration notes.
- [`docs/dynamic-parser-architecture.md`](docs/dynamic-parser-architecture.md) —
  parser architecture plan and boundaries.
- [`docs/movie-details-performance-tracing.md`](docs/movie-details-performance-tracing.md)
  — MovieDetails performance tracing.
- [`docs/README.md`](docs/README.md) — extended user-facing feature guide.

## License

MIT

## Changelog

Release entries are intentionally collapsed to keep this page readable. The
manifest and package version remain the source of truth for the build version.

<details>
<summary><strong>1.2.9</strong> — TMDB proxy hardening</summary>

### Fixes

- Route TMDB requests through Firebase Functions when the local secret config is absent.
- Keep the TMDB token in Firebase Secret Manager instead of exposing it to the extension.

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
