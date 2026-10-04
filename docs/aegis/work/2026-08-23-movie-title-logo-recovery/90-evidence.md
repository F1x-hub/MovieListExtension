# Evidence — movie title logo recovery

## Acceptance coverage

- TMDB logo selection keeps `ru > en > null > other` ordering.
- A second TMDB images request is made only when preferred-language logos are empty.
- KP 48162 resolves through exact IMDb evidence to TMDB 411.
- KP 400 resolves through exact title/year/type evidence to TMDB 11645.
- KP 51326 resolves through exact title/year/type evidence to TMDB 8555.
- Ambiguous metadata candidates are rejected and negative-cached.
- Legacy negative reverse entries are re-evaluated once using a metadata fingerprint.
- Cached logo DTOs with an old selector version rehydrate once and then stay warm.
- MovieDetails rendering regressions continue to pass with title retention.
- KP 5456450 (`Дракула`, 2025) resolves via alternate-title consensus to TMDB 1246049
  and returns a TMDB logo URL.
- KP 13136552 (`Табакошка`, anime series, 2026) preserves series metadata, resolves
  through TMDB TV 312949, and returns a TMDB logo URL.

## Commands

- `node tests/mediaAggregatorService.test.js` — pass
- `node tests/idMappingService.test.js` — pass
- `node tests/idMappingReverseNegativePhase6B.test.js` — pass
- `node tests/movieDetailsRendering.test.js` — pass
- `npm run lint` — pass
- `npm run build` — pass
- `npm test` — blocked by unrelated `offscreenScraper.test.js` fixture
- Direct live-provider reproduction — pass for both new IDs through the aggregator

## Scope evidence

- Changed owners: TMDB service, reverse mapping service, media aggregator,
  focused tests, living agent rules, changelog, and Aegis work records.
- No `dist/` files were edited directly.
- No commit or destructive worktree operation was performed.
- No movie ID was hard-coded; the fix remains in the canonical KP normalizer and
  reverse-mapping service.
- Follow-up reproduction showed a stale speculative localStorage DTO; selector
  schema version 3 now forces one TMDB refresh for old empty-logo entries.
- Follow-up reproduction also found a fresh negative mapping from the old
  algorithm; `metadataRecoveryVersion` 2 permits one controlled retry and resolves
  KP 5456450 without manual storage clearing.
