# Home Catalog Intent

## Task intent

Build one full-page catalog that serves Films, Series, Cartoons, and Anime from
Home category links, while preserving the existing card-click flow:
TMDB candidate -> Kinopoisk HTML identity resolution -> canonical MovieDetails
page by Kinopoisk ID.

## Scope

- Add a reusable category contract and paginated catalog data owner.
- Add `src/pages/catalog/catalog.html`, `catalog.css`, and `catalog.js`.
- Route Home category links to the catalog.
- Preserve legacy `search.html?type=...` links through a redirect.
- Reuse `MovieCard`, `Utils.bindMovieCardNavigation`, and
  `HomeMovieNavigationService`.

## Non-goals

- Do not rewrite MovieDetails, MediaAggregatorService, or the KP mapping rules.
- Do not resolve Kinopoisk IDs for every card during list loading.
- Do not write unrated metadata into Firestore.
- Do not modify or clean pre-existing unrelated worktree changes.

## Baseline refs

- `src/pages/home/home.html`
- `src/pages/home/HomeDataController.js`
- `src/pages/home/HomeRenderer.js`
- `src/pages/home/HomeMovieNavigationService.js`
- `src/shared/services/HomeCacheService.js`
- `src/shared/services/TMDBService.js`
- `src/shared/components/MovieCard.js`
- `src/shared/utils/Utils.js`
- `src/pages/search/search.js`
- `.agents/rules/agent.md`

## Compatibility boundary

MovieDetails URLs remain `movie-details.html?movieId=<Kinopoisk ID>`. Cards with
an existing KP ID open directly; TMDB-only cards use the existing lazy KP HTML
resolver. Personal bookmarks, ratings, and Firestore aggregate documents are
outside this change.

## TDD route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: focused post-change regression tests

## Execution readiness

- Intent lock: universal category page with lazy KP identity resolution.
- Scope fence: catalog/config/navigation/tests only.
- Baseline lock: existing Home, MovieCard, Utils, and MovieDetails contracts.
- Evidence required: focused catalog tests, lint, build, and manual route smoke.
