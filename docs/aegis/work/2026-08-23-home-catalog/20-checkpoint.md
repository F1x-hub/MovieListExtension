# Home Catalog Checkpoint

## Current todo

1. Add category contract and CatalogService. (completed)
2. Build catalog page and UI states. (completed)
3. Wire Home and legacy search links. (completed)
4. Add tests and run lint/build. (completed)

## Active slice

Catalog page, navigation wiring, regression tests, lint, and production build
are complete. Manual browser smoke testing remains for the user after reload.

## Completed

- Read existing Home, search, MovieCard, Utils, HomeCacheService, and
  HomeMovieNavigationService boundaries.
- Captured pre-existing dirty worktree state.

## Evidence refs

- Home links currently target `search.html?type=...`.
- Search initialization does not consume the category type as a catalog mode.
- `HomeMovieNavigationService` already resolves TMDB-only cards to KP IDs.
- `MovieCard` and `Utils.extractKinopoiskId` provide the canonical card ID path.
- `CatalogService` owns page-level TMDB data and bounded localStorage cache.
- `TMDBService.getCatalogPage()` keeps mixed animation pagination stable by
  caching provider pages and slicing the merged ordered result.
- `Utils.bindMovieCardNavigation()` now permits TMDB-only catalog cards to use
  the existing `resolveTmdbId` MovieDetails route.
- `catalog.html` is included in the production build and all focused tests pass.

## Drift check

- Scope: unchanged.
- Compatibility: canonical MovieDetails URL remains unchanged.
- New owner: CatalogService is justified as the page-level paginated catalog
  owner; identity resolution remains owned by the existing MovieDetails
  `resolveTmdbId` route and `Utils` navigation contract.
- Decision: implementation complete; hand off for extension reload and smoke test.

## Next

Reload the unpacked extension and smoke-test each catalog category plus one
TMDB-only card click through canonical MovieDetails resolution.
