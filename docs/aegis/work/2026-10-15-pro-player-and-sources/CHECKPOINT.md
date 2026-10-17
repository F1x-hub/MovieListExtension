# Implementation checkpoint

Date: 2026-10-16. Worktree: C:/Users/irakl/.codex/worktrees/pro-player-t0/MovieListExstension.
Branch codex/pro-player, HEAD 83a82928c0c33a8cd2f7f9e5e77a10c73622f674; no commits/push.
Original D:/ checkout and unrelated .firebase/.vs/artifacts/audit-output/scratch preserved.
The approved plan files remain the fixed 2026-10-15 input; this checkpoint records
subsequent implementation and owner decisions without rewriting that history.

On 2026-10-16 the owner explicitly requested transfer into the primary checkout.
All changed source, tests, documentation and fixture evidence were copied to
`D:/Programing/JS/Projects/MovieListExstension`, with byte-level verification and
a pre-transfer backup under the local temporary directory. No Git metadata,
dependencies or unrelated local directories were copied or removed. Earlier
worktree paths below describe the implementation environment. The primary checkout
is now the copy to build and reload in Chrome. The local feature flag still defaults
off and is enabled through the admin page; transferring files does not alter the
browser profile's saved flag or reload its open pages.

Subsequent diagnostics usability fixes are made directly in the primary checkout:
readable localized summary, secondary JSON details and native-dialog keyboard
ownership above the page modal stack. The supplied installed-profile JSON was
valid; first-frame unknown is not playback failure. The worktree no longer contains
these later primary-checkout changes: do not blindly copy it over the primary tree.
Direct browser inspection of chrome-extension pages was refused by the tool's
protocol policy; no browser profile flag/reload or installed verification is claimed.

## Accepted

- T0: reusable persistent Chromium context with own deny proxy, exact fixture-port
  bypass, Node server/range/port checks, synthetic HLS VP9+Opus and actual frames.
  Three reviewers, two rounds; fixes for implicit bypass and probe attribution accepted.
- A2: remove three dead CHANGE_SOURCE paths; red→green static inventory.
- A4: menu labels/values/title textContent; real-cleaner jsdom red→green and fresh
  extension menu fixture dark/light ×1366/400 screenshots. Three clean reviewers.
- A1: empty default sandbox infrastructure, exact-host policy, all target mounts,
  escaped Search renderer and dependency; three clean reviewers. No provider enabled.
- A5-0 partial: actual local-server redirect/DNR/iframe/HLS browser-model evidence.
  It is not production UrlPolicy or proof of the untested full matrix. Three clean reviewers.
- A5 controlled-HLS increment implemented and fixture-verified: shared URL policy,
  checked Fetch loader, separate remote/local profiles, captured local session
  directory, terminal policy failures, consumer/Ghost integration and stale
  AnimeGo restore fix. Full A5 remains incomplete. See a5-hls/90-evidence.md.

## Owner decisions

- «го делай» authorizes implementation within the plan; commit/push/release remain separate.
- E1 name «Смотреть»; prefer AnimeGo for anime default, below room/explicit/saved choice.
- G-A5: proceed incrementally with controlled HLS; direct MP4/provider iframe retain
  explicitly limited guarantees. See a5-0/20-decision.md for exact answer/limits.
- Owner subsequently approved chrome.storage.local and the admin-page toggle, then
  requested the whole remaining plan without stopping between implementation cards.
  Continue all applicable cards in this worktree. No commit/push/publication or
  third-party messaging is inferred. Real checks require actual accessible setup;
  never substitute fixture results for live evidence.

## Evidence and environment

Local Node24.18.0, Playwright1.62.1 bundled Chromium1234; FFmpeg9.0.2 generated fixture.
Node22 CI parity not exercised. Final A5 npm test/lint/build and test:media-player
passed after all runtime changes. test:watch-room passed; its subsequent change
was confined to AnimeGo metadata restoration and separately covered. Existing
recovery/parser assertions were preserved; only real policy dependencies were
added to their harnesses. HTML module/order and release-notes checks passed.
Fresh source-extension policy/T0/browser-model/menu smokes passed; menu covers
dark/light ×1366/400 after reload. Actual local HLS frames and zero forbidden
HTTP hits are distinct from tests of real providers/backends.

Final logs under generated scratch mle-baseline-Zre9hf: test-15040.log,
run-lint-35624.log, run-build-36824.log, run-test_media-player-29112.log,
run-test_watch-room-23316.log. Logs are local execution evidence, not a repository
deliverable. Full tests ran with the documented scoped offline preload; the new
extension smokes use their own deny-proxy harness without that preload.

Review: correctness/security and test/coverage reviewers reported clean after
fixes; they independently reran focused units and browser boundary tests. A third
fresh final reviewer could not start due account usage limit. Its failed start is
not a clean review; no three-clean-final-review claim. Earlier targeted reviews
found/fixed hash normalization, session selection/scope, preview missing-policy
fallback and AnimeGo stale metadata. No known unresolved actionable finding.
No G2 live providers, installed daily profile, credentials, CI/deploy or package install.
:3000 belongs to an existing process; tests use only own random loopback ports.
Temporary existing-suite network preload/logs are outside repo in generated scratch.
One failed visual-test profile was quarantined under that scratch after delete was
rejected by safety review; successful profiles assert normal cleanup. No user profile touched.

## Current continuation

The combined B/E1/A3/A6/A7/C2/C3/C4 and D increments are implemented with focused
tests, full regression, lint/build and isolated Chromium evidence. See
[current status](90-current-status.md) for the exact implementation matrix and
remaining gates; the older logs/review statements above describe the earlier A5
increment only. New modules include WatchEntryController/Page, WatchSourcePolicy,
ProPlayerPreferences, ProviderCapabilities, SourceRefreshCoordinator, PlayerMetrics,
PlayerDiagnostics/Panel, PlayerLocale, WatchPreferences, PlayerSettingsMenu,
PlayerMediaControls and PlayerGhostPreview. New characterization harnesses load
the same dependencies as production; original assertions remain in place.

C1 has offline fixtures and a bounded live runner tested with fixture transport;
live execution remains disabled without explicit references. Its manual workflow
has not been published. T-G has an
offline analyzer/protocol and no real sample. Volume styling and the named D6
models/owners are extracted; other inline geometry/UI closures remain. E2/E1c,
live/provider/device/installed checks and rollout are not completed. Seasonvar live
access was explicitly blocked by the browser site-safety policy. No workaround.
No provider sandbox entry or live compatibility claim without actual G2 evidence.
