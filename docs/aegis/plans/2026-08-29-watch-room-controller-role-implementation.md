# Реализация роли «Управляющий» для staging watch-room

## Goal

Реализовать утверждённую спецификацию `2026-08-29-watch-room-controller-role.md`:
owner назначает единственному приглашённому участнику `controller` либо
возвращает ему `viewer`. Controller синхронизирует только play/pause/seek;
источник, приглашения и роли остаются у owner.

## Architecture

- Firestore member role остаётся server-only durable источником роли.
- `watchRoomsStaging` получает owner-authorized action `setMemberRole`.
- Handler одной RTDB root update зеркалирует роль в существующие
  `roomAccess/{uid}/{roomId}/role` и `roomLive/{roomId}/members/{uid}/role`.
- Presence не меняется и не читается: он показывает online status, а не права.
- RTDB rules расширяют только timeline write до owner/controller; providerHint
  остаётся owner-only.
- Existing members listener обновляет runtime role контроллера; новых listener,
  коллекций, scheduled job, polling или client role cache не создаётся.

## Tech Stack

Vanilla JavaScript, Firebase Functions v2 HTTP handler, Firestore, isolated
Realtime Database, JSON RTDB rules, Node.js `assert` contract tests.

## Baseline / Authority Refs

- `docs/aegis/plans/2026-08-29-watch-room-controller-role.md` — approved scope.
- `functions/watchRoomService.js` — canonical durable role authorization.
- `functions/watchRoomsStaging.js` — private endpoint and RTDB mirror.
- `rules/database.rules.json` — timeline authorization contract.
- `src/shared/services/WatchRoomStagingController.js` — telemetry owner.
- `src/pages/movie-details/movie-details.js` — participant popover owner.

## Compatibility Boundary

1. Owner/viewer rooms and viewer-by-default join remain compatible.
2. `providerHint`, content, invite and membership writes do not become controller-writable.
3. Capacity stays two, invite stays single use, room is still session scoped.
4. Role action writes neither media URLs, history, TTL, cleanup state nor a new log record.

## TDD Route

- Mode: off.
- Decision: skipped.
- Strict authority: not applicable.
- Test posture: focused post-change regression.
- Verification: room contracts, lint, build, diff check and two-browser smoke.

## Requirement Ready Check

- Source: approved role specification and user confirmation.
- Scenario: owner grants then revokes a guest's shared timeline control.
- Acceptance: viewer cannot write timeline; controller can; controller cannot change source/roles.
- Open blockers: none.
- Decision: ready.

## Change Necessity

- User-visible need: a trusted guest controls common playback without owner powers.
- No-change option: retain the current owner-only implementation.
- Why insufficient: labels alone neither authorize RTDB nor prevent forged client state.
- Minimum boundary: current service, handler, rules, controller and members popover.
- Decision: code-change.

## File Map

- `functions/watchRoomService.js` and `tests/watchRoomService.test.cjs`.
- `functions/watchRoomsStaging.js` and `tests/watchRoomsStagingHandler.test.cjs`.
- `rules/database.rules.json` and `tests/watchRoomRules.test.js`.
- `src/shared/services/WatchRoomStagingController.js` and
  `tests/watchRoomStagingController.test.cjs`.
- `src/pages/movie-details/movie-details.html`, `movie-details.js`, and
  `tests/movieDetailsWatchRoomUi.test.cjs`.

## Tasks

### 1. Server role mutation

Files: `functions/watchRoomService.js`, `tests/watchRoomService.test.cjs`.

Add `normalizeMemberRole` for exactly `viewer` and `controller`, then add
`setMemberRole({ actorUid, requestId, roomId, targetUid, role })`. In one
Firestore transaction it loads room/actor/target members; requires actor to be
owner, forbids self and owner target, rejects expired room and invalid role,
updates only target role plus `lastActivityAt`, and returns sanitized
`{ roomId, userId, role, expiresAtMs }`. Test success, self/owner target,
non-owner, invalid role and expired room. Staging ACL outbox stays disabled.

Verification: `node tests\\watchRoomService.test.cjs`.

### 2. Handler and RTDB mirror

Files: `functions/watchRoomsStaging.js`, `tests/watchRoomsStagingHandler.test.cjs`.

Add `syncRoomMemberRole(rtdb, result)` using one root `.update()` containing
only the two role paths. Add `setMemberRole` to the current action allow-list:
call service, mirror result, return status 200. Preserve CORS and create/join/
leave paths. Test exact update keys and assert rejected service requests do not
call the mirror.

Verification: `node tests\\watchRoomsStagingHandler.test.cjs`.

### 3. Timeline-only RTDB permission

Files: `rules/database.rules.json`, `tests/watchRoomRules.test.js`.

Change `revision`, `phase`, `basePositionMs`, `effectiveAtMs` and `updatedBy`
write predicates from owner-only to `(owner || controller)` with existing
approval/expiry conditions. Do not change `providerHint`, content, members or
validation rules. Test the controller allow-list appears in exactly those five
timeline predicates and is absent from providerHint.

Verification: `node tests\\watchRoomRules.test.js`.

### 4. Runtime timeline authority

Files: `src/shared/services/WatchRoomStagingController.js`,
`tests/watchRoomStagingController.test.cjs`.

Add `canControlTimeline()` for owner/controller. Derive current user role from
the existing `membersRef` snapshot before emitting the member UI update. Use
that helper in telemetry publication and state patch enqueue/flush; leave
`publishHostProvider()` owner-only. Test viewer promotion enables play/pause/
seek publication, demotion stops it, and controller provider writes remain
blocked.

Verification: `node tests\\watchRoomStagingController.test.cjs`.

### 5. Owner-only participant control

Files: `src/pages/movie-details/movie-details.html`,
`src/pages/movie-details/movie-details.js`, `tests/movieDetailsWatchRoomUi.test.cjs`.

Render labels `создатель`, `управляющий`, `зритель`. In the current owner’s
members popover, add one neutral toggle for the other participant:
`Разрешить управление` or `Сделать зрителем`. It disables only while the
existing controller API wrapper is in flight, has no optimistic mutation, and
waits for the authoritative member snapshot. Non-owner and self rows never
render the action. Test labels/visibility plus current expiry/count contracts.

Verification: `node tests\\movieDetailsWatchRoomUi.test.cjs`.

### 6. Evidence and release

Run `node tests\\watchRoomService.test.cjs`, `node tests\\watchRoomsStagingHandler.test.cjs`,
`node tests\\watchRoomRules.test.js`, `node tests\\watchRoomStagingController.test.cjs`,
`node tests\\movieDetailsWatchRoomUi.test.cjs`, `npm run lint`, `npm run build`,
`git diff --check`, then `firebase deploy --only functions:watchRoomsStaging,database --project movielistdb-13208 --non-interactive`.

Reload the unpacked extension, then in two browsers perform: promote guest →
guest play/pause/seek → demote guest → verify no common timeline update. Update
README and `.agents/rules/agent.md` only after this evidence.

## Risks / Rollback

- If Firestore mutation succeeds and RTDB mirror fails, rules still retain the
  old ACL so control is not granted; owner repeats the idempotent desired role.
- A demoted browser can race a delivered snapshot, but RTDB immediately rejects
  its next write after ACL mirror.
- Rollback restores the five predicates to owner-only and removes the action/UI;
  stored `controller` values are inert under owner-only rules.

## Execution Readiness View

- Intent Lock: delegated timeline control only.
- Scope Fence: no delegated source control, third participant, chat, transfer,
  public rooms, persistence after reload or cleanup edits.
- Baseline Lock: service owns durable mutation; handler owns RTDB mirror;
  controller owns telemetry; UI never authorizes itself.
- Task Batches: service/handler → rules/controller → UI → evidence/deploy.
- Drift Rule: stop if a new role, listener or source-control permission is proposed.
