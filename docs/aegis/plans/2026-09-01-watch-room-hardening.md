# Goal

Harden the deployed staging watch-room flow against mixed-version presence
collisions, stale asynchronous presence writes, and duplicate create retries.

# Architecture

Firestore remains the source of truth for rooms, membership, roles, capacity,
and invite usage. RTDB remains the source of truth for ephemeral live transport
and presence. New clients use an isolated `presenceV2` path; the old
`presence` path remains read-only compatibility until migration evidence allows
retirement.

# Tech Stack

Chrome MV3 extension with vanilla JavaScript, Firebase Cloud Functions v2,
Firestore, and Realtime Database.

# Baseline/Authority Refs

- `docs/aegis/work/2026-08-31-watch-room-capacity/10-intent.md`
- `docs/aegis/work/2026-08-31-watch-room-capacity/20-checkpoint.md`
- `src/shared/services/WatchRoomStagingController.js`
- `functions/watchRoomService.js`
- `functions/watchRoomsStaging.js`
- `rules/database.rules.json`

# Compatibility Boundary

- Preserve the existing `presence` reader for old deployed extension builds.
- New presence writes and disconnect cleanup must use `presenceV2` only.
- Do not change unrelated room modes or global capacity defaults.
- Repeated create requests with the same authenticated user and request ID must
  return the original room and invite result.

# TDD Route

Mode: off. Decision: skipped. Strict authority: none recorded. Use focused
regressions and contract tests after each slice.

# Verification

- `node tests/watchRoomService.test.cjs`
- `node tests/watchRoomsStagingHandler.test.cjs`
- `node tests/watchRoomCleanup.test.cjs`
- `node tests/watchRoomRules.test.js`
- `node tests/watchRoomStagingController.test.cjs`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Scoped Firebase deploy and `firebase functions:list` verification.

# Change Necessity

The issues are runtime lifecycle and persistence-contract bugs; documentation
or configuration cannot isolate old clients, fence pending async writes, or
deduplicate a server-side create retry. The minimum code boundary is the
existing controller, staging service/handler, cleanup, RTDB rules, and focused
tests. Decision: code-change.

# Architecture Integrity Lens

- Invariant: one canonical durable membership owner and one canonical new
  presence owner must remain authoritative.
- Canonical owner/contract: Firestore transactions own capacity and create
  idempotency; RTDB `presenceV2` owns new per-connection presence.
- Responsibility overlap: legacy `presence` remains a read-only compatibility
  carrier, not a second writer or new-client source of truth.
- Higher-level simplification: fence controller async work by session identity
  instead of adding retry branches at UI call sites.
- Retirement/falsifier: retire legacy presence reads only after mixed-version
  acceptance shows no old clients remain; mixed-shape data or old-client
  deletes falsify immediate retirement.
- Verdict: proceed with isolated compatibility path and bounded lifecycle guard.

# Tasks

## 1. Isolate presence migration

Files: `WatchRoomStagingController.js`, `watchRoomsStaging.js`,
`database.rules.json`, and controller/rules tests.

Use `presenceV2/{uid}/{connectionId}` for all new writes and disconnect
cleanup. Subscribe to both `presenceV2` and legacy `presence`, preferring V2 in
the member projection. Add rules for the V2 path and preserve legacy reads.

## 2. Fence asynchronous presence work

Files: `WatchRoomStagingController.js` and controller tests.

Capture the current session generation, room ID, role, and presence ref before
awaiting display-name or RTDB operations. Abort stale work after every await and
increment the generation during disconnect.

## 3. Add create idempotency

Files: `watchRoomService.js`, `watchRoomsStaging.js`,
`watchRoomCleanup.js`, and service/handler/cleanup tests.

Add a server-only staging request ledger. Create room, member, invite, and the
idempotency result in one Firestore transaction. Retries with the same actor and
request ID reuse the stored room and join code. Cleanup deletes the bounded
request ledger entry with the expired room.

## 4. Verify and release

Run all focused tests, lint, build, diff checks, then deploy only
`watchRoomsStaging`, `cleanupExpiredWatchRoomsStaging`, and the staging RTDB
rules. Verify active functions and record live acceptance gaps.

# Risks

- Existing old clients can keep legacy presence records until they disconnect.
- Storing a retryable join code in a server-only ledger is required to replay a
  lost create response; clients cannot read the ledger.
- No authenticated ten-browser acceptance is available in this workspace.

# Retirement

Keep legacy `presence` rules and reads until mixed-version acceptance is passed.
The retirement trigger is confirmed absence of legacy writes in runtime logs
and successful old/new client interoperability testing.
