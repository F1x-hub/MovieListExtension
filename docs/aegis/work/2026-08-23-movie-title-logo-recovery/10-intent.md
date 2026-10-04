# Task intent — movie title logo recovery

## Requested outcome

Ensure KP-rooted movie details recover TMDB identities and title logos reliably,
including films whose KP document omits `externalId.tmdb` and films whose only
TMDB logo is not Russian/English. Keep the ordinary title visible when no valid
logo exists.

## Scope

- `src/shared/services/TMDBService.js`
- `src/shared/services/IdMappingService.js`
- `src/shared/services/MediaAggregatorService.js`
- focused regression tests

## Non-goals

- Do not hard-code the three reported IDs as special cases.
- Do not change primary KP identity ownership.
- Do not edit `dist/` directly or reset unrelated worktree changes.

## Baseline usage

- Required refs: `TMDBService`, `IdMappingService`, `MediaAggregatorService`,
  existing logo/mapping tests, `.agents/rules/agent.md`.
- Acknowledged: yes.
- Missing refs: none.

## Impact statement

The change extends the existing reverse identity owner with verified metadata
recovery and versions the existing logo cache marker. It preserves the current
priority order (KP external ID, reverse cache, IMDb, then exact metadata) and
rejects ambiguous title/year candidates.

## Execution readiness view

- Intent lock: recover valid logo data for KP-rooted details.
- Scope fence: provider services, aggregator cache seam, focused tests.
- Compatibility boundary: UnifiedMovieDTO shape remains compatible; new fields
  are additive metadata markers.
- Retirement boundary: no legacy fallback is removed.
- Verification gates: focused tests, lint, full test suite, production build.
