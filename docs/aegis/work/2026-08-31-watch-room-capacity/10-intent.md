# Watch-room capacity and reconnect intent

## Objective

Raise the staging watch-room capacity to 10 total participants and keep an
already joined page in its room during transient network loss without making
Firestore heartbeat writes.

## Scope fence

- Change only the watch-room staging server, cleanup, RTDB presence/reconnect,
  and their focused tests.
- Preserve unrelated working-tree changes.
- Do not edit `dist/` directly or change global room modes unintentionally.

## Ownership invariants

- Firestore owns durable room membership, roles, capacity, and invite usage.
- Realtime Database owns ephemeral presence and live room transport.
- Server-side transactions remain authoritative for capacity.
- Reconnect must not call `join` for an already admitted member.
- Presence heartbeat must not be stored in Firestore.

## Required behavior

- Staging room capacity is 10 total members; one shared invite allows 9 guest
  redemptions.
- `ROOM_FULL`, `INVITE_EXHAUSTED`, and transient network failures remain
  distinguishable to the client.
- RTDB reconnect re-arms `onDisconnect`, restores presence, and preserves room
  state without a page reload.
- A stale presence record becomes offline after a bounded timeout.
- Cleanup accepts 10 member documents and still expects one shared invite
  document.

## Baseline evidence

- `functions/watchRoomsStaging.js` currently sends capacity 2 and invite uses 1.
- `functions/watchRoomCleanup.js` currently caps staging members at 2.
- `WatchRoomStagingController` listens to the whole presence node with a
  `value` listener and drops HTTP error codes in `callApi`.
- Existing unrelated changes are present in `README.md`,
  `src/shared/styles/admin.css`, and untracked generated/scratch paths.

## Verification obligations

- Focused service, handler, and controller tests.
- Concurrent join and duplicate-join coverage.
- Reconnect/presence lifecycle coverage.
- `npm run lint` and production build if the repository's normal scripts permit.

## Residual risks to surface

- Multi-tab presence requires a connection-id data shape; the first slice may
  explicitly support one active tab per user unless tests and rules cover more.
- The existing `requestId` is format validation, not full request idempotency;
  create/retry semantics must not be overstated.
