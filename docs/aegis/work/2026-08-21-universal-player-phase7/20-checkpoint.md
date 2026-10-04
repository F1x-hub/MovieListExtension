# Phase 7 Checkpoint

## Current todo

- [x] Capture baseline and audit provider implementations.
- [x] Implement capability-driven controls and canonical selection behavior.
- [x] Add regression tests.
- [x] Run lint, tests, build, diff review, and changelog update.

## Active slice

Adapter contract and MovieDetails capability gating completed. Seasonvar and
VidSrc remain direct-capable; Ex-FS and KinoGo use verified native bridges;
Rutube remains single-video/title-search.

## Evidence

- `npm run lint` — exit 0.
- `npm test` — exit 0; configured pretest and test suites passed.
- `npm run build` — exit 0; production bundle rebuilt.
- Focused Phase 7, provider-switch, and Seasonvar picker tests — passed.
- Static MovieDetails ownership assertions — zero Seasonvar/VidSrc provider-ID
  picker fallbacks.
- Unpacked extension runtime probe — movie and unsupported-provider controls
  hidden; VidSrc controls require IMDb identity; S3E6 URL verified.

## Drift check

Scope remained limited to player adapters, player UI orchestration, focused
tests, project rules, and the required README changelog. Unsupported providers
remain unsupported pending deterministic evidence. Authenticated live provider
playback was not exercised because the browser session had no signed-in user.

## Current universal-selection execution

- Approved universal provider-selection plan is in progress.
- KinoGo now rejects film URLs when a TV-series result is requested.
- Provider capabilities expose `selectionMode` and `canApplySelection`.
- Seasonvar and VidSrc explicitly report `DIRECT`; title-only providers remain
  non-host-controlled; KinoGo and Ex-FS now expose `NATIVE_BRIDGE` and Rutube
  remains `OPAQUE` until deterministic episode lookup is implemented.
- Added explicit `APPLY_PLAYBACK_SELECTION` / `PLAYBACK_SELECTION_RESULT`
  bridge messages with retry and acknowledgement logging in `player-cleaner`.
- Added `[ExFsBridgeTrace]` diagnostics at picker, controller, adapter, iframe,
  and provider-DOM click boundaries for the next live run.
- Fixed the shared navigation gate and enabled Ex-FS Prev/Next through the
  verified native bridge while keeping AutoNext disabled.
- Suppressed the stale Ex-FS source guidance when the canonical native bridge
  is active.
- Reapplied canonical picker visibility after delayed legacy controls mount,
  covering the bottom episode icon and provider-native arrows.
- Retried canonical bridge activation against newly inserted iframes and
  blocked stale legacy arrow clicks while canonical mode is enabled.
- Enabled KinoGo's canonical picker using its real season/episode selectors and
  added `kinogo.my` to the player bridge content-script matches.
- Enforced KinoGo media-type filtering before result ranking so series searches
  cannot select same-title films or interpret KP IDs as years.
- Verification after this slice: focused capability test, picker lifecycle,
  runtime audit, lint, and build all pass.

## Next step

Verify native bridge dispatch in a live embedded provider frame; if the frame
does not load the content script, keep the legacy provider remount as fallback.
