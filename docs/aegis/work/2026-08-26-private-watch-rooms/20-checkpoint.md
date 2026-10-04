# Checkpoint

## Active slice

Create the safe capability and persistence/access foundation before any room endpoint
or UI is exposed.

## Completed

- Added default-deny `getRoomSyncCapabilities()` to `BasePlaybackAdapter` and exposed
  the value through `PlaybackController` provider metadata.
- Added isolated native-video telemetry test; no production provider is enabled.
- Added RTDB rules, Firebase deployment mapping, Firestore server-only room rules, and
  static access-contract tests.
- Provisioned `movielistdb-13208-watchrooms-staging` in `us-central1`, targeted its
  rules deployment, and confirmed anonymous RTDB reads are denied.
- Added the unexposed durable `createRoom`, `createInvite`, `redeemInvite`, and
  `leaveRoom` service paths with ACL outbox events and monotonic `aclRevision`.

## Evidence

- `node tests/roomSyncCapabilityPrototype.test.js` passed.
- `node tests/watchRoomRules.test.js` passed.
- `git diff --check` completed without errors; only pre-existing LF/CRLF warnings.
- RTDB staging rules deployed successfully; unauthenticated root read returned
  `Permission denied`.
- `node tests/watchRoomService.test.cjs` and
  `node tests/firebaseRealtimeDatabaseConfig.test.js` passed.

## Blockers / next step

- Next: run the required two-extension provider proof before exporting lifecycle
  endpoints or building room UI.
