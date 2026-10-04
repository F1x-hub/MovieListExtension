# Checkpoint: canonical episode selection

## TodoCheckpointDraft

- [x] Read parent plan and current working-tree baseline.
- [x] Harden bridge acknowledgement and stale-response handling.
- [x] Remove the obsolete embedded episode-list button and its empty toggle path.
- [x] Run focused regressions, lint, and build.
- [x] Prevent empty parser source results from poisoning the source cache.
- [x] Stream parser search results into source preloading without changing priority order.
- [x] Release the first priority-safe cold-click source while slower parsers finish.
- [x] Add a regression for the progressive Watch path and final cache persistence.
- [x] Update evidence and drift records.

## Active slice

Bridge contract, bounded legacy UI retirement, and priority-safe progressive source
discovery in the scoped source owners.

## Evidence

- Parent plan: `docs/aegis/plans/2026-09-06-player-pipeline-and-canonical-episodes-audit.md`
- Baseline commit: `a5a01492e997ee94a0e93a94b0baa90b6183f8ec`
- Existing focused tests previously passed: picker unification, navigation bridge,
  provider-switch preservation, player source contract, Rutube parser, Seasonvar dedup.
- `tests/playerNativeBridgeContract.test.js` passes: APPLIED-only acknowledgement,
  origin/source filtering, provider/season/episode matching, and stale overlap handling.
- `npm run test-player-cleaner-selection` passes: missing provider season, missing
  provider DOM, and cancelled operations cannot report an applied selection.
- `npm run lint` passes. `npm run build` passes and regenerated `dist/` from sources.
- `npm run test-player-legacy-retirement` passes: the internal legacy button,
  emergency flag, and listener are absent while the host picker remains present.
- `npm run test-parser-source-cache` passes: empty discovery retries, successful
  discovery remains cached.
- `npm run test-parser-progressive` passes: callbacks stream in completion order,
  parser options remain provider-only, and `searchAll` still returns all results.
- `npm run test-player-progressive-watch` passes: an empty higher-priority parser is
  skipped without blocking a usable source behind an unrelated slow parser; final
  normalization and cache persistence still complete.
- `tests/playerSourceContract.test.js` passes: native quality labels use manifest
  heights and no provider-specific guessed ladder remains.
- Full `npm test` remains blocked by the pre-existing `movieDetailsCreditsUI.test.js`
  assertion at line 518 about hidden actors consuming zero layout space.

## Drift check

- Intent: aligned; this slice is canonical selection/legacy cleanup.
- Compatibility: preserve provider DOM bridge and PlaybackController ownership.
- Retirement: remove only the internal UI carrier after checking references.
- Risk: live iframe/fullscreen behavior remains unverified; provider-native DOM cleanup
  is still intentionally limited to the existing external-boundary visibility guard.
- Decision: source-level legacy retirement is complete; live migration acceptance is
  still needs-verification for authenticated providers and fullscreen.

## Next step

Run browser smoke checks for Ex-FS/KinoGo and fullscreen, then record first-frame and
selection-ack evidence before changing HLS settings or declaring the audit complete.
