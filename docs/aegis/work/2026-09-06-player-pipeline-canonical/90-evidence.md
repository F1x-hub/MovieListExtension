# Evidence bundle

This record is populated after each verified slice. It intentionally excludes
provider tokens, cookies, signed URLs, and full runtime payloads.

## Slice: bridge and legacy default path

- `npm run test-player-native-bridge` — exit 0; APPLIED-only acknowledgement,
  origin/source filtering, provider/season/episode matching, and stale overlap handling.
- `npm run test-parser-source-cache` — exit 0; empty source discovery is not cached.
- `npm run test-parser-progressive` — exit 0; source preloading can begin per result
  while final parser ordering remains unchanged.
- `npm run test-player-progressive-watch` — exit 0; an empty higher-priority parser
  does not block the first usable source behind a slow parser, and final discovery
  persists the normalized source set once.
- `npm run test-player-legacy-retirement` — exit 0; the internal legacy episode
  button, emergency flag, and empty toggle listener are removed.
- `npm run test-player-cleaner-selection` — exit 0; cleaner provider selection
  requires confirmed season/episode state and returns false for cancellation or
  missing provider DOM.
- `node tests/playerEpisodePickerProviderUnification.test.js` — exit 0.
- `node tests/playerEpisodeNavigationBridge.test.js` — exit 0.
- `node tests/playerEpisodeProviderRuntimeAcceptanceAudit.test.js` — exit 0;
  22 provider acceptance parts passed.
- Cleaner class-based provider selection now reports `APPLIED` only after the
  requested episode is reflected by an active/selected provider item.
- `node tests/providerSwitchSelectionPreservation.test.js` — exit 0.
- `node tests/playerLifecycle.test.js` — exit 0.
- `node tests/playerCleanerIsolation.test.js` — exit 0.
- `node tests/playerPhase7CapabilityContract.test.js` — exit 0.
- `node tests/playerSurfaceContract.test.js` — exit 0.
- `node tests/playerVisualContract.test.js` — exit 0; player surface and retired
  legacy episode control contracts remain consistent.
- `npm run lint` — exit 0.
- `npm run build` — exit 0; dist regenerated from source.
- `git diff --check` — exit 0; only line-ending warnings from pre-existing files.
- The focused provider/player matrix (picker unification, navigation bridge, provider
  preservation, lifecycle, switch transactions, cleaner isolation, performance,
  Seasonvar dedup, capability, cache, and progressive Watch) completed with exit 0.
- Static browser smoke loaded the built MovieDetails HTML successfully. It did not
  mount an authenticated player, so live iframe/fullscreen evidence remains open.
- Static HLS inventory found three creation points: the native parser mount, main
  cleaner playback, and the cleaner ghost timeline preview; the bundled runtime
  identifies as hls.js 1.6.15.
  No buffer tuning was applied without first-frame/rebuffer measurements.

## Unrelated suite blocker

- `npm test` reached the pre-existing `tests/movieDetailsCreditsUI.test.js:518`
  assertion (`hidden actors consume zero layout space`) and exited 1. No player
  test failed in that run; the failing area is outside this slice.
