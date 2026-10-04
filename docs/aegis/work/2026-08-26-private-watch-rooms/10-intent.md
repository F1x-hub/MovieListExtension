# Watch rooms — execution intent

## Outcome

Implement host-controlled watch rooms without using Firestore for realtime playback.

## Scope and non-goals

- Scope: RTDB access boundaries, durable room lifecycle, one verified provider path,
  bounded client transport and room UI.
- Non-goals: video relay, source URL sharing, chat, voice, playlists, or host transfer.

## Baseline

- Parent plan: `docs/aegis/plans/2026-08-26-private-watch-rooms.md`
- Existing owners: `PlaybackController`, `BasePlaybackAdapter`, `rules/firestore.rules`,
  `functions/index.js`, and `src/shared/firestore.js`.

## Execution-readiness view

- Intent lock: private, host-controlled, low-Firestore synchronization.
- Scope fence: no provider is enabled until two-client staging proof succeeds.
- Compatibility: retain `PlaybackSelection`, local `ProgressService`, and current
  player message protocols.
- Evidence: contract tests, RTDB rules deployment validation, lifecycle tests, then
  staging proof and cost measurement.
- Current external prerequisite: exact staging RTDB `databaseURL`.
