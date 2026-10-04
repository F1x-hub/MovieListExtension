# Приватные комнаты совместного просмотра — план реализации

## Goal

Добавить private/public комнаты до 20 участников. `public` означает видимую
одобренным пользователям в каталоге комнат и доступную через `joinPublic` endpoint;
`private` доступна только после redeem действующего приглашения. Создатель комнаты — единственный
ведущий: он выбирает фильм, сезон и серию, запускает, ставит на паузу и перематывает.
Гости автоматически монтируют тот же подтверждённый контент у себя, но сохраняют
личные звук, субтитры, качество и fullscreen. Firebase не передаёт видео, URL
источников, cookies или токены: в сеть идут только identity контента и команды.

## Architecture

- Firestore хранит только durable room, member и invite данные. В нём нет live
  listener, presence, таймкода, команд или чата.
- Realtime Database хранит один компактный live state, presence и readiness
  для конкретной комнаты. Это единственный realtime transport.
- Cloud Functions создают/закрывают комнаты, выдают и погашают приглашения,
  меняют content и зеркалируют access ACL из Firestore в RTDB.
- `WatchRoomService` владеет durable API; `RoomRealtimeSync` — RTDB;
  `RoomSourceResolver` — local fallback источника; `RoomPlaybackBridge` —
  единственная связка RTDB и существующего `PlaybackController`.
- V1 поддерживает только один доказанно управляемый provider path. Непроверенные
  адаптеры остаются `supportsRoomSync: false`.

## Baseline / Constraints

- Сохранить `PlaybackSelection`, локальный `ProgressService`, личную историю и
  существующие standalone MovieDetails flows.
- Следовать `.agents/rules/agent.md`: approved users only, `dist/` не править,
  monochrome token contract и текущая provider credential boundary.
- Использовать `src/shared/firestore.js`, `PlaybackController`, Base adapter,
  `content-scripts/player-cleaner.js`, `functions/index.js`, `firebase.json`,
  `rules/firestore.rules` как текущие owners.
- RTDB URL/region не выдумывать: оператор создаёт staging instance и передаёт
  точный `databaseURL` до начала реализации.

## Compatibility Boundary

1. Гость не пишет общие state/content/provider policy и не шлёт source URL.
2. Firestore не используется для live-синхронизации ни прямо, ни через fallback.
3. Принять fallback источник можно только при exact movie/series identity,
   exact season/episode, remote-control capability и compatible duration.
4. Несовместимый источник показывает `Нет совместимого источника`; нельзя
   запускать недостоверный «почти синхронный» просмотр.
5. Room UI использует safe display snapshots; не читает чужой `users` document
   ради e-mail или других чувствительных полей.
6. Вне scope: видеоретрансляция, voice/chat, screen share, playlists и смена
   ведущего.

## TDD Route

- Mode: `off`; Decision: `skipped`; strict authority отсутствует.
- Posture: контрактные tests после каждого среза, затем staging smoke.
- Final verification: targeted tests, `npm run lint`, `npm run test:visual-design`,
  `npm test`, `npm run build`, `git diff --check`.

## Data Contracts

### Firestore: `watchRooms/{roomId}`

```js
{ ownerId, visibility: 'private'|'public', status: 'lobby'|'active'|'ending'|'ended',
  maxParticipants: 20, memberCount: number, aclRevision: number, publicIndexRevision: number,
  lastActivityAt: Timestamp,
  content: { kinopoiskId, tmdbId, mediaType, seasonNumber, episodeNumber,
             title, posterPath, contentRevision } | null,
  pendingContent: { kinopoiskId, tmdbId, mediaType, seasonNumber, episodeNumber,
                    title, posterPath, contentRevision } | null,
  contentSyncState: 'idle'|'pending'|'failed'|'cancelled',
  createdAt, expiresAt, endedAt }
```

### Firestore: members and invites

`watchRooms/{roomId}/members/{uid}` contains `{ role: 'owner'|'viewer',
joinedAt, displayName, photoURL }`; display fields are bounded safe snapshots.
They are frozen when the member joins in V1: later profile changes do not fan out
to room members, and a new snapshot appears only after a subsequent join.
`watchRoomInvites/{inviteId}` contains `{ roomId, inviteHash, expiresAt,
maxUses, uses, revokedAt }`. Links contain a 32-byte random secret; Firestore
stores only its SHA-256 hash.

### RTDB: ACL and live state

```js
roomAccess/{uid}/{roomId}: { role: 'owner'|'viewer', aclVersion, expiresAtMs }
roomLive/{roomId}/state: {
  revision, contentRevision, phase: 'loading'|'playing'|'paused'|'ended',
  basePositionMs, effectiveAtMs, updatedBy, providerHint,
  contentSnapshot: {
    kinopoiskId, tmdbId, mediaType, seasonNumber, episodeNumber,
    contentRevision,
    timelineProfile: {
      providerId, mediaIdentity, timelineGroupId, durationMs,
      durationToleranceMs, profileVersion, verifiedAtMs
    }
  } | null
}
roomLive/{roomId}/presence/{uid}: { connectedAtMs, role }
roomLive/{roomId}/readiness/{uid}: { status: 'resolving'|'ready'|'unavailable', code }
roomLive/{roomId}/members/{uid}: { role, displayName, photoURL, joinedAtMs }
approvedRoomAccess/{uid}: { approved: true|false, approvalVersion, revokedAtMs? }
publicRoomIndex/{roomId}: {
  roomId, title, posterPath, mediaType, memberCount, maxParticipants,
  ownerDisplayName, status: 'lobby'|'active', expiresAtMs,
  publicIndexRevision, visible: true, sortKey: expiresAtMs
}
publicIndexRepairQueue/{roomId}: {
  expectedRevision, state: 'pending'|'failed', attempts, nextAttemptAt,
  lastErrorCode, createdAt
}
```

RTDB ACL is server-owned. A viewer calculates playing position locally as
`basePositionMs + (estimatedServerNow - effectiveAtMs)`; paused position is
`basePositionMs`. Personal player settings are local-only.

`roomLive/members` is a server-owned safe roster, mirrored alongside RTDB access
ACL and combined with `presence` in the UI. `approvedRoomAccess` is a server-owned,
versioned mirror of the existing approval decision. Every RTDB room subtree read and
public-index query requires its current approved record. `publicRoomIndex` contains no
provider data, member documents, e-mail, invites or source details. When a row becomes
ineligible the server retains a tombstone at the same key with `visible: false`,
`sortKey: 0` and a higher `publicIndexRevision` until cleanup; eligible client queries
start at server-now and therefore never return tombstones.

Visibility is immutable after room creation in V1. A public room can end or expire but
cannot become private; a private room never gains a public-index row. This preserves
privacy while the two databases converge.

`approvedRoomAccess` has no passive expiry: it remains an approval tombstone with
`approved: false` after revoke and is replaced only by a strictly newer explicit grant.
Rules require `approved === true`; an old grant worker can therefore never restore a
revoked gate. Public-index tombstones retain their revision for at least seven days
after expiry and are removed only after all bounded source retries are terminal.
`publicIndexRepairQueue` is server-only and receives an entry only after a failed
index write; its worker reads the one current Firestore room then retries RTDB. Each
failure advances `nextAttemptAt` with bounded backoff; success deletes the entry, and
the fifth failure retains it as `failed` for alerting without further automatic reads.

`contentSnapshot` не содержит URL, cookie, токен, заголовки или provider response.
Это единственный runtime-источник выбора контента: гость применяет только snapshot
с большим `contentRevision`, а Firestore `content` использует лишь для durable
истории, lobby и каталога. Поэтому он не ждёт Firestore после RTDB события и не
может смонтировать старый эпизод при рассинхронизации двух баз.

`timelineProfile` сравнивается между host и guest только по `timelineGroupId`,
`profileVersion` и `durationMs ± durationToleranceMs`; `providerId` и
`mediaIdentity` — диагностические поля конкретного адаптера и не обязаны совпадать
у fallback-провайдера.

### Firestore: state delivery outbox

`watchRoomStateOutbox/{eventId}` is server-only and contains `{ roomId,
kind: 'content'|'end', contentRevision|null, contentSnapshot|null,
idempotencyKey, state: 'pending'|'applied'|'failed'|'cancelled', attempts, nextAttemptAt,
lastErrorCode, createdAt, appliedAt }`. Its idempotency key is exactly
`${roomId}:content:${contentRevision}` or `${roomId}:end`. It delivers only a new
content snapshot or terminal `ended` transition to RTDB; it never carries playback
heartbeats or commands. Each failure advances `nextAttemptAt` with bounded
exponential backoff; after five attempts it becomes `failed`. An authorized manual
re-arm resets `attempts` to zero and sets a fresh `nextAttemptAt`, but preserves the
same event ID and idempotency key.

A content synchronizer first checks that Firestore room status is neither `ending`
nor `ended`, then its RTDB transaction aborts if live phase is already `ended`. If
either condition fails, it marks the content event and `contentSyncState` `cancelled`;
it never writes `loading` after termination has started. A content write that won a
race immediately before `end` is harmless because the terminal transaction always
writes the next revision.

`roomRequestGate/{uid}/{action}/{window}` contains only a bounded counter and expiry.
`roomRequestResults/{uid}/{requestId}` contains `{ state: 'processing'|'complete',
safeResultCode, expiresAtMs }` and never contains an invite secret, source URL or
provider data. Both paths are server-owned and short-lived.

### Firestore: approval gate recovery

The approval-version allocator reads both canonical Firestore version and current RTDB
gate version. A new explicit grant chooses `max(firestoreVersion, rtdbGateVersion) + 1`,
commits that version plus `watchRoomApprovalOutbox/{uid}:{approvalVersion}` in one
Firestore transaction, then its synchronizer writes the matching RTDB gate. A revoke
is fail-closed: the handler reads canonical version `v`, writes RTDB approval tombstone
`{ approved: false, approvalVersion: v + 1 }` in a transaction that rejects an equal
or newer gate, then runs a Firestore transaction conditional on version `v` to commit
the same-version revoke and outbox. A retry of that incomplete revoke reuses its
reserved `v + 1`; it is not a new grant. If that Firestore precondition fails or the
step errors, the gate stays denied and the admin must retry the explicit approval
action; the allocator then chooses a strictly newer version. The reconciler never
reopens a false gate from an older version. The outbox is
`{ uid, approved, approvalVersion, state: 'pending'|'applied'|'failed', attempts,
nextAttemptAt, createdAt, appliedAt }`. RTDB room rules consequently cancel every
active room listener immediately. A bounded background job subsequently removes that
user from room memberships/ACLs using the membership collection group; this rare
administrative cleanup does not delay immediate denial.

### Cross-store ACL recovery contract

Firestore and RTDB are not transactionally atomic. Every create/join/leave/end
transaction therefore writes a server-only `watchRoomAclOutbox/{eventId}` record
in the same Firestore transaction as the durable membership mutation:
`{ roomId, userId, desiredRole|null, aclVersion, operation, idempotencyKey,
state: 'pending'|'applied'|'failed', attempts, nextAttemptAt, lastErrorCode,
createdAt, appliedAt }`.
`idempotencyKey` is exactly `${roomId}:${userId}:${aclVersion}`. The immediate
synchronizer and recovery handler apply only a `pending` event, verify the exact
RTDB ACL version, then conditionally mark that same event `applied`; this status
update never creates a new outbox event and the trigger ignores non-pending records.
Every failed attempt records a bounded exponential `nextAttemptAt`; after five attempts
the event becomes `failed` and is visible to the reconciler.
`watchRooms.aclRevision` is the canonical monotonic allocator for each grant or
revoke event. It advances inside the same Firestore transaction as the membership
change, so a leave followed by a later rejoin cannot reuse an older RTDB ACL version.
ACL application uses one RTDB multi-location update to write both `roomAccess` and the
matching safe `roomLive/members` roster entry. Revocation deletes both before it is
acknowledged. Room entry returns `ROOM_ACCESS_PENDING` instead of granting playback
until the ACL exists.

An owner cannot use `leave`: it returns `OWNER_MUST_END_ROOM`. `end` uses one
Firestore transaction to change the room to `ending` and create a terminal
state-outbox event. Its synchronizer performs an RTDB transaction that writes
`phase: ended` at the latest `revision + 1`; a recovery run first verifies that exact
terminal state, then uses one Firestore transaction to mark the room `ended` and
enqueue revocation events for every member (maximum 20). It synchronizes revocations
after a short fixed grace window; a client pauses and detaches immediately when either
`ended` or lost ACL arrives. This ordering prevents a public room from remaining
joinable after a partially completed end request.

The client first observes only its own `roomAccess/{uid}/{roomId}`. Once role,
version and expiry are valid it attaches room state/presence/readiness listeners and
starts a server-offset expiry timer. When that narrow access listener or timer reports
deletion, expiry or a version change it pauses, detaches all room listeners and returns
to access-denied. This is RTDB-only and makes both `ROOM_ACCESS_PENDING` recovery and
revocation observable even for an already-open listener.

## User Flow

1. Пользователь ищет фильм существующим способом, открывает MovieDetails и
   нажимает `Создать комнату` — V1 не создаёт второй поиск.
2. HTTPS Function проверяет ID token и `approvalStatus`, создаёт room + owner
   membership Firestore transaction и initial RTDB ACL/state batch.
3. Owner создаёт одноразовое invite; raw secret возвращается только для копирования.
4. Guest redeem вызывает Function: expiry, hash, capacity и approved account
   проверяются transaction-ом; после успеха создаются membership и RTDB ACL.
5. Owner выбирает content. `setContent` server-side validates canonical IDs and a
   certified `timelineProfile`. A Firestore transaction records pending durable
   content and one state-outbox event with a new `contentRevision`; current RTDB state
   is not changed yet. The idempotent state synchronizer uses an RTDB
   transaction to read the latest state and writes the full `contentSnapshot`,
   `phase: loading`, exactly `revision + 1` and position 0;
   only then it marks content active and the outbox applied in Firestore. If durable
   status was `lobby`, this final transaction changes it to `active` and advances
   `publicIndexRevision`. If RTDB
   fails, the old эфир stays canonical and the pending event retries the same
   revision; a second selection returns `CONTENT_SYNC_PENDING` rather than creating
   another event. After a terminal failure the owner can invoke `retryContentSync`,
   which re-arms that same event and revision after its retry time. If room closing
   starts first, the content event is `cancelled` and never writes over `ended`.
6. Guest subscribes только на свою room subtree, accepts only increasing RTDB
   `contentRevision`, resolves that snapshot's host provider hint,
   затем локальный fallback. Он не читает/пишет Firestore для resolution.
7. Host bridge публикует state на discrete `play`, `pause`, `seeked`, episode
   change и heartbeat раз в 20 секунд только во время play.
8. Guest bridge применяет remote command, suppresses its resulting local events
   и корректирует drift только при отклонении >1.5s. Гость не публикует state.
9. Для public room approved пользователь вызывает `joinPublic`; endpoint проверяет
   visibility, status, expiry и atomically увеличивает `memberCount` до лимита.
10. `onDisconnect()` удаляет own presence. При host absence гости ставят локальный
   player на паузу; при возврате host публикует новый canonical state.
11. Owner завершает комнату только действием `Завершить комнату`; гость может
    покинуть её. `end` first makes the Firestore room `ending` and enqueues one
    state-outbox event; its RTDB transaction writes final `ended` with exactly the
    latest `revision + 1`. The same retryable synchronizer then marks Firestore
    `ended` and enqueues ACL revocation for all members. После final `ended` state
    все локальные players останавливаются, а ACL отзывается для всех участников.
12. Если content или end outbox исчерпал попытки, owner видит соответствующую
    кнопку повторной синхронизации. Она перевзводит только исходное event ID и
    revision; контент не дублируется, а статус `ending` не отменяется.

## File Map

### Create

- `src/pages/watch-room/watch-room.html`, `.js`, `.css` — lobby/player shell,
  owner/viewer/error/access states; CSS только scoped neutral tokens.
- `src/shared/services/WatchRoomService.js` — authenticated durable API.
- `src/shared/services/RoomRealtimeSync.js` — narrow RTDB listeners, presence,
  safe roster/public-index queries, server-time estimate, own-ACL gate, revision and
  heartbeat policy.
- `src/shared/services/RoomSourceResolver.js` — provider fallback, safe TTL cache,
  exact identity/capability/duration validation.
- `src/shared/services/RoomPlaybackBridge.js` — host publish, viewer apply,
  echo suppression and drift correction.
- `functions/watchRoomService.js`, `functions/watchRoomController.js`,
  `functions/watchRoomAclSync.js`, `functions/watchRoomStateSync.js`,
  `functions/watchRoomApprovalSync.js` — Functions transaction, durable-to-RTDB
  delivery and safe HTTP request/response owner.
- `rules/database.rules.json` — RTDB ACL/validation rules.
- `tests/watchRoomService.test.cjs`, `tests/watchRoomRules.test.js`,
  `tests/roomRealtimeSync.test.js`, `tests/roomSourceResolver.test.js`,
  `tests/roomPlaybackBridge.test.js`, `tests/watchRoomPage.test.js`.

### Modify

- `functions/index.js` — export `watchRooms` handler with Auth, Firestore, RTDB.
- `src/shared/firestore.js` — lazy `getRealtimeDatabase()` requiring configured URL.
- `src/shared/services/player/PlaybackController.js` — small local runtime subscribe
  and `applyRoomCommand` seam; leave `ProgressService` ownership unchanged.
- `src/shared/services/player/adapters/BasePlaybackAdapter.js` — default-false
  `getRoomSyncCapabilities()` contract.
- one selected adapter + `content-scripts/player-cleaner.js` — only after native
  proof; strict extension-parent origin/message validation for room commands.
- MovieDetails HTML/JS/CSS — host-only `Создать комнату` action.
- `Navigation.js`, `locales.js`, `manifest.json`, `firebase.json`,
  `rules/firestore.rules`, `rules/firestore.indexes.json`, `package.json`,
  `README.md`, `.agents/rules/agent.md`.
- `libs/firebase-database-compat.js` — pinned to the existing compat SDK version.

## Implementation Tasks

### 0. Provision staging RTDB

Create staging RTDB instance, record exact URL outside source, configure budget
alerts and connection/download dashboards. Add database deployment owner to
`firebase.json`; do not deploy to production. Verify `firebase.database` loads
on a staging page and produces zero Firestore operations.

### 1. Prove one room-capable provider before feature work

Before creating room UI or exposing any room endpoint, build an isolated prototype
with one existing native-video path and two local extension sessions. It must prove
current-time observation, host play/pause/seek, guest timeline lock, exact season
selection and stable drift below 1.5 seconds at 0%, 20%, 60% and 90% of playback.
If this proof fails, stop the plan before adding RTDB UI, invitations or fallback.

### 2. Lock persistence and access first

Create RTDB rules and add Firestore room rules. Direct client writes to rooms,
members, invites, both outboxes and room ACL are denied. A signed-in user may read
only their own `roomAccess` node; room subtree reads require a non-expired derived
ACL and a current own `approvedRoomAccess` record. Safe roster reads use those same
two gates. Public-index reads require a current own approved record and query only the
server-maintained eligible index by `sortKey`, `startAt(serverNow)` and a 20-item limit;
all index, approval mirror and outbox writes are server-only. The server writes a
higher-revision tombstone when status leaves `lobby|active` or it expires. Users write only
their own bounded `presence`/`readiness`. An owner may update
only playback fields in `state`: `contentSnapshot` and `contentRevision` must be
unchanged, `updatedBy` must equal `auth.uid`, and revision must increase exactly once.
Only Admin SDK Functions may set content or `phase: ended`; `ended` is terminal and
no client can transition it back. Validate phase transition allowlist, IDs, strings,
position, revision, participant cap, max payload sizes and reject unknown URL-shaped
fields. Declare RTDB `.indexOn: ['sortKey']` for `publicRoomIndex` and enforce the
query order/start/limit in rules; declare `.indexOn: ['nextAttemptAt']` for
`publicIndexRepairQueue`. Run `node tests/watchRoomRules.test.js` for viewer denial, owner field denial,
terminal end, own-ACL gating/expiry, roster denial to outsiders and approved-only
public-index query limits, plus immediate live-room denial after approval-gate removal.

### 3. Implement server lifecycle

Implement Function actions `create`, `createInvite`, `revokeInvite`,
`redeemInvite`, `joinPublic`, `getRoomSnapshot`, `leave`, `end`,
`setContent`, `retryContentSync`, `retryEnd`. Reuse/extract approved-user
verification from current Auth pattern. Create/redeem use Firestore transactions;
increment/decrement `memberCount` in the same transaction. `leave` rejects the owner;
only `end` changes an owner room to `ending`, creates one terminal state-outbox event,
and, only after its RTDB transaction commits `revision + 1`/`ended`, finalizes Firestore
and enqueues at most 20 member revocations. `setContent` creates a pending content
record plus a complete state-outbox snapshot with a monotonic revision. State
synchronization writes that snapshot through an RTDB transaction before making it
active in Firestore; its final Firestore transaction performs the one allowed
`lobby → active` transition and public-index revision increase. No client has to fetch
Firestore to act on it. `retryContentSync`
and `retryEnd` re-arm only the same failed event/revision after ownership and room-state
checks; `retryEnd` never returns a room from `ending` to active. `getRoomSnapshot`
uses the RTDB ACL as a cheap first gate, then reads the Firestore room and caller's own
member record, asserting canonical membership before it returns a safe room DTO. The
safe roster comes only from RTDB and is never returned by this endpoint. It is fetched
once on room entry and never subscribed. On create/content/status/expiry changes,
Functions increment `publicIndexRevision` in the same durable room transaction.
Create, content/status/expiry, redeem, `joinPublic` and viewer `leave` all advance it
when their safe public fields or `memberCount` change, then perform an idempotent RTDB
transaction that accepts only a newer revision. End/expiry writes the retained tombstone
rather than deleting the key; the client queries that RTDB index directly, with no
`listPublicRooms` Function or Firestore catalogue query.
The Firestore room-change trigger retries the same index revision; only after its
bounded retries fail does it enqueue one RTDB `publicIndexRepairQueue` item. The repair
worker reads only that current room, preserves revision ordering and alerts on exhaustion.
The existing approval mutation writes its approval outbox in the same transaction;
approval grant/revoke is mirrored by its own synchronizer. ACL and state synchronizers handle only their own
pending idempotency keys and can transition each event only to `applied`, `failed` or
`cancelled`; a status update must not emit another event.
Safe responses omit e-mail, invite hash, raw secret after issuance, provider URL and
upstream bodies. Run
`node tests/watchRoomService.test.cjs` covering races, expiry, capacity,
ownership, owner end-only behavior, content ordering, ACL/state outbox retry loops
and rate-gate duplicate rejection; include stale-ACL roster denial and content/end
outbox race coverage plus roster/public-index revision/tombstone and approval-outbox
revoke fail-closed coverage, `revoke → Firestore failure → grant v+2` recovery,
RTDB index-query coverage, member-count index updates and repair-queue bounded-query
coverage, plus RTDB-failure keeps a lobby room out of active public index.

Before any Function touches Firestore, it consumes a bounded RTDB rate-gate keyed by
`uid/action/time-window` and accepts a client request ID. The gate limits create to
3/hour, invite to 10/hour, redeem/join to 10/10 minutes, and setContent/end to
20/hour per user and room (including their retry actions), and `getRoomSnapshot` to
6/minute per user and room. Duplicate request IDs return the stored safe result or an in-progress code without another
Firestore transaction. RTDB TTL cleanup removes these short-lived keys. This protects
Firestore quota from retries and approved-user abuse; it does not store raw invite
secrets or provider data.

### 4. Implement RTDB client transport

Add compat SDK and `FirebaseManager.getRealtimeDatabase()`. `RoomRealtimeSync`
attaches an own-ACL listener first, then only `state`, presence, safe roster and own
readiness; it queries the eligible public index with local 60-second TTL cache and a
10-second request cooldown;
it provides one cleanup function; reads RTDB `/.info/serverTimeOffset` for server
time; issues one owner heartbeat/20s when playing; rejects stale revisions; never
calls Firestore. `host_offline` is a local UI state derived from missing owner
presence, never a write by a guest; a returned owner publishes normal canonical state.
Test no `timeupdate` write, ACL-pending recovery/revocation, expiry-timer detach,
cleanup, revision order, `onDisconnect`, heartbeat cap and 1.5s drift threshold with
`node tests/roomRealtimeSync.test.js`.

### 5. Make one player path room-capable

Add adapter capability object `{ observeTime, play, pause, seek, duration,
lockGuestTimeline }`, default false. Expose minimal `PlaybackController`
runtime/control methods. First prove one native-video path end-to-end; only then
enable its capabilities. Preserve the current `PAUSE` and episode bridge protocol
unchanged: room message validation is an opt-in, capability-gated branch that requires
the expected extension parent source, origin and schema, never generic
`postMessage('*')`.
Guest controls lock timeline but retain volume/subtitles/quality/fullscreen.
Run existing player/episode bridge regressions, focused room contracts and a browser
proof.

### 6. Resolve local fallback safely

Build resolver with key `movieId:mediaType:season:episode`; dedupe in-flight work
and cache safe outcomes locally with TTL. Try provider hint, then registered
compatible providers. A profile has exact `{ providerId, mediaIdentity,
timelineGroupId, durationMs, durationToleranceMs, profileVersion, verifiedAtMs }`; a guest accepts a fallback
only when canonical identity/episode and `timelineGroupId` match and the certified
profile version matches the host contract. Duration can differ only within explicit
`durationToleranceMs`; equal duration alone is insufficient. Profile certification is a
maintainer test at 0%, 20%, 60% and 90%, never a network probe during a room join.
Providers without a certified profile remain unavailable for rooms. Return `ready` only
on verified identity, exact episode, capabilities and compatible profile; otherwise return bounded safe codes
`NO_SOURCE`, `REGION_UNAVAILABLE`, `EPISODE_UNAVAILABLE`,
`UNSUPPORTED_CONTROL`, `TIMELINE_MISMATCH`. Run
`node tests/roomSourceResolver.test.js`.

Rank the host hint and at most two fallback candidates, then attempt at most the first
two candidates in that ranking in total. There are never three network probes for one
join. Do not automatically retry before a 15-minute local `retryAfter`; keep one
in-flight promise per local identity key.
The unavailable state is the terminal result when this budget is exhausted.

### 7. Bridge player and room state

Owner bridge publishes only discrete events plus heartbeat. Viewer bridge resolves
only an increasing RTDB `contentSnapshot` revision, applies remote state, ignores
self/remote echoes, seeks only above 1.5s drift and publishes merely readiness.
On end, offline, leave or lost ACL it pauses, detaches and destroys. Run
`node tests/roomPlaybackBridge.test.js` for snapshot ordering, stale state rejection,
end/ACL race and drift correction.

### 8. Build accessible room UX

Create room page states: public catalogue, auth, access denied, ACL pending, lobby,
resolving, ready, unavailable,
host offline, ended. Add MovieDetails host action and Navigation route without
global room subscriptions. Invite is copy/revoke only for host. Participant list
combines server-owned RTDB safe roster with presence, never arbitrary user docs or a
Firestore members listener. Public catalogue queries only the eligible RTDB index in
20-row cursor pages and caches the first page locally for 60 seconds. Show a
`Повторить синхронизацию` action only to
the owner for a failed content or terminal outbox; a failed terminal room remains
visibly `Завершается` until `retryEnd` succeeds. Verify dark/light, narrow
layout, focus, keyboard and lock labels with `node tests/watchRoomPage.test.js`
and `npm run test:visual-design`.

### 9. Add cost guardrails and cleanup

Keep max 20, max 20 debug traces behind explicit local flag, and record only
sanitized counts: state writes, listeners, heartbeat, resolver outcome, drift.
Add bounded scheduled cleanup that queries indexed `expiresAt` or
`state == pending && nextAttemptAt <= now` in pages of at most 100; it must retain a
cursor and never scan a collection. Add the needed outbox state/next-attempt indexes.
Process `publicIndexRepairQueue` through an RTDB `nextAttemptAt` index in batches of at
most 100; each item may perform one Firestore room read only while pending, is deleted
on success, and becomes alert-only after its fifth failure.
Ending/expiry queues deletion of the matching RTDB live/ACL paths after the fixed
grace window and writes a higher-revision public-index tombstone. Public catalogue
reads only the approved RTDB `publicRoomIndex`, ordered by `sortKey`, started at
server-now and paged by 20-row cursors; it uses a 60-second local first-page cache,
a 10-second request cooldown and no Function/Firestore catalogue query.
Safe index DTOs omit all member documents, e-mail and provider data. Add static tests
that reject any Firestore live-state or public-catalogue call. In a 2-hour four-person simulation
prove <=40 Firestore writes, <=50 reads and <=2MB RTDB download. The Firestore
budget includes durable membership, invite, member-count and ACL-outbox recovery
writes; it still excludes every periodic playback update.

### 10. Verify and stage rollout

Run all room tests plus current approval/auth/player source tests, `npm run lint`,
`npm run test:visual-design`, `npm test`, `npm run build`, `git diff --check`.
On staging test private invite, outsider denial, host play/pause/seek, local guest
volume, source fallback, unavailable path, disconnect, cleanup and measured RTDB
downloads. Update README and living agent rules only after evidence. Production
deploy, public rooms and further providers require separate approval.

## Cost Guardrail

For a 2-hour private room of 4 people at 20-second heartbeat: 360 compact state
updates, roughly 1–2 MB RTDB download with protocol overhead, and a normal, scripted
success-path target of at most 40 Firestore writes plus 50 reads — not an unconditional
promise under transaction conflicts or abuse. The write budget is: room/owner creation
and initial ACL ≤5, three invitations ≤3, three redeems with membership/count/invite/
outbox/ack ≤15, one content selection/state-outbox delivery ≤4, and ending plus
terminal-state/four revokes/outbox acknowledgements ≤12.

The read budget for that private scenario is ≤9 for three invite redeems, ≤12 for
lifecycle and membership authorization, ≤8 for four one-shot room snapshots
(each reads one room plus the caller's own member document), and ≤9 for recovery
verification. Participant roster and public catalogue are RTDB-only, so neither adds
Firestore reads. The RTDB rate gate and request-id handling keep duplicate requests
outside this Firestore budget. Any retry must consume the explicit remaining reserve,
never introduce periodic Firestore work.
Video traffic is outside Firebase.
The plan fails review if Firestore receives periodic playback updates.

## Risks / Stop Conditions

- Stop provider rollout if its timestamp/control/duration/timeline-profile proof fails.
- Stop public-room rollout if `joinPublic`, paginated catalogue and member-count
  transaction tests are not passing.
- Stop release if any ACL, state or approval outbox event remains pending or failed beyond its repair threshold.
- Stop public rollout if the public-index repair queue or a seven-day tombstone cannot converge.
- Stop and revise if any source URL, cookie, token, e-mail or invite secret leaks.
- Stop and revise if guest can write state or if RTDB does not enforce ACL.
- Stop and revise if a test shows Firestore listener/write on live playback.
- Preserve unrelated dirty worktree changes; never reset/checkout cleanup.

## Execution Readiness

- Intent: host-controlled, private, low-Firestore synchronized rooms; no relay.
- Scope: durable room lifecycle, one proven provider, strict fallback, cost proof.
- Required evidence: rules tests, lifecycle tests, player proof, two-hour staging
  measurement, visual/accessibility checks and fresh build/lint/regression output.
- Route: inline; backend rules, RTDB and player bridge share a security boundary.
- User prerequisite: authorize/use a staging RTDB instance and its configuration.
