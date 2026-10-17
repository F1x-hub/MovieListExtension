# T0: extension player browser harness

Date: 2026-10-16. Authorization: owner's message «го делай» after the audited plans;
no exact message timestamp is available. No commit/push/release is authorized.

Base: 83a82928c0c33a8cd2f7f9e5e77a10c73622f674. Branch: codex/pro-player.
Managed worktree: C:/Users/irakl/.codex/worktrees/pro-player-t0/MovieListExstension.
The original checkout and its uncommitted plan edits are preserved. The five
documentation files produced by the plan audit were copied into this worktree;
node_modules is a junction to the existing installation, with no install/lockfile change.

Scope: tests/helpers/extensionContext.cjs, fixtureServer.cjs, synthetic media,
playerExtensionBrowserSmoke.cjs, playerFixtureServer.test.cjs, package scripts,
README and execution evidence. No production JavaScript or manifest changes in T0.

Acceptance: persistent bundled Chromium, key-derived/runtime extension ID, running
service worker, decoded/presented HLS frames through HlsPlaybackFactory, local
positive control, failed external DNS/IP probes, and teardown. Unit checks cover
range/HEAD, path/method rejection, existing-port preservation and server cleanup.

The red check failed with AssertionError for the missing reusable extension helper
before helper implementation. Runtime/product policy A5 and provider/network-device
checks are separate. T0 may use PLAYER_FIXTURE_PORT=0 while :3000 is occupied;
the existing :3000 listener must not be stopped or used as a fixture.

Local Node v24.18.0, Playwright 1.62.1, bundled full Chromium revision 1234;
FFmpeg 9.0.2 generated local testsrc/sine VP9+Opus media. Node 22 CI parity is
not established by this local run. Reviewer risk: new browser/network helpers;
review correctness, security boundaries and test evidence independently.
