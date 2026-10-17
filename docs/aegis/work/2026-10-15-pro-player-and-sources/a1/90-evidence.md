# A1: provider sandbox infrastructure

Date: 2026-10-16. Infrastructure accepted; same G0 authorization/worktree as T0.

MovieDetailsPlayerSurface owns the exact-host allowlist and four sandbox tokens.
The production list remains empty. The renderer accepts only the shared approved
policy, rejects same-origin/non-HTTP provider privileges and escapes attributes.
BaseParserService, VidSrcAdapter, MovieDetails legacy frame mounts and Search
request that policy. Search now loads PlayerSurface as a classic deferred script
before its module entry point and uses the shared renderer instead of interpolated
iframe HTML. Its existing player.css already supplies shared media geometry.
Trailer calls remain opt-in and do not request sandbox. No Spotify policy change.

providerSandboxContract.test.js failed before with AssertionError for the missing
shared policy method. It now verifies the empty default; test-only configured
exact hosts; same-origin/extension/lookalike exclusions; full tokens; rejected
top-navigation token; generic/trailer opt-in; and real BaseParser/VidSrc DOM mounts.
The test-only allowlist is compiled in an isolated jsdom window; production
SANDBOX_PROVIDERS is not changed or configurable by the provider.

Checks passed: sandbox contract, htmlScriptModuleContract (614 tags/20 pages),
playerSourceContract, movieDetailsRendering, searchStartupRecovery,
playerSwitchTransactions, updateServicePlayback, npm test, npm run lint and
npm run build. The added real-parser/adapter assertions also passed separately
after the full suite; no production code changed after that full-suite run.

Live provider checks were not run; no iframe provider has been declared sandbox
compatible. This closes infrastructure only. The local browser experiment in
../a5-0/20-decision.md also verifies allow-same-origin vs opaque message origins;
it is not a live-provider compatibility proof. Fresh installed Search flow is
unverified; unit/source contracts and offline fixtures are distinct evidence.

Independent correctness/security/test review: all three reported no actionable
findings. Sandbox contract independently passed in each direction; the test
reviewer also reran the Chromium network/sandbox-origin experiment successfully.
