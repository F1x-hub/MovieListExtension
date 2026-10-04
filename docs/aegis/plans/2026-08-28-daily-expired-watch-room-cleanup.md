# Ежедневная дешёвая очистка просроченных watch-room — план

## Goal

Раз в день удалять физически устаревшие staging-комнаты совместного просмотра
после их четырёхчасового `expiresAt`, не сканируя Firestore, не затрагивая живые
комнаты и не добавляя ни одного client-side Firebase-запроса. Доступ должен
оставаться закрытым правилами RTDB сразу после `expiresAt`. Контроллер комнаты
локально отписывается по полученному `expiresAtMs`, а ежедневная задача нужна
  только для освобождения Firestore/RTDB хранения. Первый релиз использует
  только ограниченные warning-логи: без Cloud Monitoring custom metric и alert,
  которые являются отдельной потенциально платной поверхностью.

## Architecture

- Новый server-only owner: `functions/watchRoomCleanup.js`.
- Один экспорт `cleanupExpiredWatchRoomsStaging` в `functions/index.js` через
  `onSchedule` из `firebase-functions/v2/scheduler`.
- Расписание: `15 4 * * *`, `Asia/Tbilisi`, `us-central1`, `256MiB`,
  `timeoutSeconds: 120`, `maxInstances: 1`, `retryCount: 1`,
  `maxRetrySeconds: 300`. Повтор нужен только после технического сбоя; cleanup
  идемпотентен и не открывает просроченную комнату.
- За один запуск обрабатывается максимум 50 комнат. Запрос только
  `watchRoomsStaging.where('expiresAt', '<=', cutoff).orderBy('expiresAt').limit(50)`.
  Это выборка по одному автоматически индексируемому полю, а не обход коллекции.
- Для каждой комнаты сначала удаляются RTDB live/ACL-ключи одной multi-location
  операцией, затем Firestore-документ комнаты, максимум два member-документа и
  один staging invite. Порядок важен: если Firestore-удаление не удалось,
  следующая задача повторит безопасное RTDB-удаление и комнату не потеряет.
- `approvedRoomAccess/{uid}` не удаляется: это общий approval-gate пользователя,
  а не доступ только к этой комнате.
- Firestore TTL не используется: TTL может удалить документ с задержкой до 24
  часов и не каскадирует удаление его subcollections или RTDB.
- При нормальном объёме физическая запись остаётся максимум почти сутки после
  expiry. При backlog она остаётся дольше, но никогда не возвращает доступ.

## Baseline / Authority

- `functions/watchRoomService.js`: staging-комната живёт 4 часа; endpoint создаёт
  private room максимум для двух участников и ровно одно одноразовое приглашение.
- `functions/watchRoomsStaging.js`: RTDB содержит `roomLive/{roomId}` и
  `roomAccess/{uid}/{roomId}`; сервер уже владеет их записью/удалением.
- `rules/database.rules.json`: доступ к комнате ограничен `expiresAtMs > now`,
  поэтому cleanup не является security boundary.
- [Firebase scheduler](https://firebase.google.com/docs/functions/schedule-functions)
  использует Cloud Scheduler. У него есть allowance трёх job; сверх него один
  job стоит $0.10/месяц.
- [Firestore](https://firebase.google.com/docs/firestore/manage-data/delete-data)
  не удаляет subcollection при обычном удалении родителя, поэтому members нужно
  удалить явно.

## Requirement Ready Check

- Источник: запрос пользователя «ежедневную дешёвую очистку просроченных комнат».
- Сценарий: пользователь часто создаёт test-комнаты; после истечения TTL они не
  должны накапливать storage и записи ACL.
- Критерии: ежедневный запуск, нет full scan, жёсткий лимит работы, чистятся
  Firestore и RTDB, живые комнаты не затрагиваются, retry безопасен.
- Решение: ready.

## Compatibility Boundary

1. Не менять `DEFAULT_ROOM_TTL_MS`, приглашения, UI, player sync или room restore.
2. Не удалять `approvedRoomAccess`, чужие RTDB ветки или любой room с
   `expiresAt > cutoff`.
3. Не читать `users`, `ratings`, Firestore live state или media/provider URLs.
4. Не создавать Firestore listener, курсор-документ, outbox или новую client API.
5. Сбой cleanup не открывает доступ: RTDB rules продолжают проверять expiry.
6. `WatchRoomStagingController` обязан поставить локальный таймер на
   `room.expiresAtMs`; по нему он отписывает state/members/presence listeners,
   очищает UI room-session и не пытается восстановить её. Expiry-detach не вызывает
   `onDisconnect().cancel()` или `presenceRef.remove()`: существующая server-side
   onDisconnect registration безвредно удалит уже истёкший presence при разрыве
   соединения. Тот же terminal cleanup запускается, если `state` удалён серверной
   очисткой.
7. Expiry-detach не отменяет зарегистрированный `onDisconnect`: после expiry
   существующие RTDB rules уже не гарантируют право клиента отменить либо удалить
   presence. Операция не создаёт новых данных, не сохраняется в приложении и
   становится неактуальной после разрыва Firebase-соединения; server cleanup
   физически удалит её ветку не позднее следующей успешной обработки комнаты.
8. Если найдено больше двух members либо больше одного invite для staging-комнаты,
   helper пропускает комнату, пишет код `unexpected_room_shape` без идентификаторов
   и не удаляет частично неизвестные данные. Оператор проверяет такую room вручную
   в staging-консоли и удаляет её только после подтверждения состава; автоматически
   расширять лимит или обходить неизвестные subcollections запрещено.

## TDD Route

- Mode: off; Decision: skipped.
- Test posture: post-change regression с injected Firestore/RTDB doubles.
- Verification: focused cleanup test, текущие room tests, lint, build, staging
  scheduler smoke.

## File Map

- Create `functions/watchRoomCleanup.js` — чистый injectable lifecycle owner.
- Modify `functions/index.js` — import `onSchedule`, export scheduled function.
- Modify `src/shared/services/WatchRoomStagingController.js` — local expiry and
  server-deletion detach only; no room restore and no new Firebase read/write.
- Create `tests/watchRoomCleanup.test.cjs` — правила выборки, порядок удаления,
  лимиты и failure semantics.
- Modify `tests/watchRoomStagingController.test.cjs` — room expiry and deleted
  state detach contracts with injected clock/timers.
- Create `tests/movieDetailsWatchRoomUi.test.cjs` — expired controller state hides
  participant controls and returns create/join controls without a room restore.
- Modify `README.md` и `.agents/rules/agent.md` после реализации и evidence.
- No changes: `rules/database.rules.json`, Firestore rules, Firestore indexes,
  `firebase.json`, `functions/package.json`.

## Change Necessity

- User-visible need: expired test rooms сейчас перестают быть доступными, но их
  durable Firestore и RTDB данные физически остаются.
- No-code option: ручное удаление или Firestore TTL.
- Why insufficient: ручное удаление не надёжно; TTL не гарантирует ежедневность,
  не удаляет subcollections и не умеет очищать RTDB ACL/live nodes.
- Minimum boundary: один server-only scheduled helper, local expiry detach в
  существующем controller и их tests.
- Decision: code-change.

## Existence / Integrity Check

- Proposed surface: `watchRoomCleanup.js`.
- Existing owner reuse: `watchRoomService` владеет create/redeem/leave и не должен
  получать schedule/pagination/physical-retention ответственность. Текущий
  `WatchRoomStagingController` уже владеет lifecycle listeners и является
  единственным корректным owner локального expiry detach.
- Creation proof: cleanup имеет отдельную идемпотентную политику, RTDB-first
  ordering и собственный cost cap; смешивание с request service усложнит API.
- Decision: add-with-proof для server cleanup, edit-in-place для уже существующего
  client lifecycle owner, без нового persistent owner.

## Data and Cost Contract

Для одной нормальной staging-комнаты: один room doc, не более двух members и один
invite. При лимите 50 комнат одна попытка запуска выполняет не более:

- 200 Firestore document reads: до 50 room-результатов, 100 members, 50 invites;
- 200 Firestore deletes: те же room/member/invite документы;
- 50 RTDB multi-location writes, каждая удаляет `roomLive/{roomId}` и до двух
  `roomAccess/{uid}/{roomId}`. Local expiry detach обычно исключает доставку
  terminal event; браузер в suspended/background состоянии может получить один
  компактный terminal snapshot после возобновления. Это не открывает доступ и не
  создаёт периодический listener traffic.

Если просроченных комнат нет, выполняется только один ограниченный Firestore query;
ни RTDB, ни Firestore delete не выполняются. Единственный retry может удвоить
потолок до 400 reads/deletes только после технического сбоя; успешно удалённые
комнаты уже не попадут во вторую выборку. По текущей [Firestore pricing]
(https://firebase.google.com/docs/firestore/pricing) дневной free tier содержит
50k reads и 20k deletes; этот task использует не более 0.4% reads и 1% deletes
в worst-case cap. RTDB deletions не создают listener-download для клиентов, так
как доступ уже истёк и они отключены правилами.

## Implementation Tasks

### 1. Create the cleanup owner and contracts

Files: create `functions/watchRoomCleanup.js`, create
`tests/watchRoomCleanup.test.cjs`.

Export constants:

```js
const STAGING_ROOM_COLLECTION = 'watchRoomsStaging';
const STAGING_INVITE_COLLECTION = 'watchRoomsStagingInvites';
const MAX_ROOMS_PER_RUN = 50;
const MAX_MEMBERS_PER_STAGING_ROOM = 2;
const MAX_INVITES_PER_STAGING_ROOM = 1;
```

Export `createExpiredWatchRoomCleanup({ db, getRealtimeDatabase, now = () => new Date(), logger = console })`.
Its `run()` captures one immutable `cutoff`, queries exactly the bounded expiry
range, then returns a sanitized summary:

```js
{ scanned, deleted, skippedUnexpectedShape, failed }
```

No room IDs, invite IDs, UIDs, titles, names or content go into logs or returned
summary.

Verification: test the constants and the query call chain. Assert that no test
path calls an unfiltered collection `.get()`.

### 2. Implement a safe per-room delete sequence

Files: modify `functions/watchRoomCleanup.js`, modify
`tests/watchRoomCleanup.test.cjs`.

For each result document, read only its `members` subcollection with
`limit(MAX_MEMBERS_PER_STAGING_ROOM + 1)` and only matching invites with
`where('roomId', '==', roomId).limit(MAX_INVITES_PER_STAGING_ROOM + 1)`.
Read these in parallel. If either cap is exceeded, increment
`skippedUnexpectedShape`, log `unexpected_room_shape` and continue without mutation.

For a normal shape, construct exactly one RTDB root update:

```js
{
  [`roomLive/${roomId}`]: null,
  [`roomAccess/${uidA}/${roomId}`]: null,
  [`roomAccess/${uidB}/${roomId}`]: null,
}
```

Call `rtdb.ref().update(updates)` before any Firestore delete. Only after it
succeeds, put member refs, invite refs and `roomRef` in one Firestore batch and
commit it. Deleting a missing RTDB path remains success, making a rerun
idempotent. Do not use a Firestore transaction, offset, persisted cursor or TTL.

Wrap one room's read/RTDB/batch sequence in `try/catch`, increment `failed` and
continue with the remaining candidates. After the page, throw a sanitized error
only if `failed > 0`; Cloud Scheduler then performs at most one retry. Successful
rooms no longer match the expiry query, so a retry revisits only failed records.
A shape anomaly remains a skip, not a retryable failure.

Verification:

- expired room deletes RTDB live node, each member ACL, members, invite and room;
- unexpired room is not read beyond the bounded expiry query and is not mutated;
- RTDB failure leaves every Firestore document intact for tomorrow's retry;
- Firestore batch failure leaves only already-safe RTDB deletions and the next run
  can complete without error;
- unexpected cardinality produces no deletes;
- summary/log assertions reject identifiers and media data;
- a failed first room does not prevent cleanup of a later room;
- a final nonzero `failed` rejects the cleanup handler; отдельный trigger-contract
  test pins `retryCount: 1`, без ложного утверждения, что unit test запускает
  Cloud Scheduler retry;
- a shape anomaly is skipped and emits only `unexpected_room_shape`.

### 3. Close the local room session at expiry or server deletion

Files: modify `src/shared/services/WatchRoomStagingController.js`, modify
`tests/watchRoomStagingController.test.cjs`.

Keep lifecycle ownership in the existing controller. Inject `now`, `setTimeout`,
`clearTimeout`, `document` and `window` through its constructor for deterministic
tests. Add `roomExpiryTimer`, `roomExpiryCheckDisposer` and a private
`endExpiredRoomSession(reason)` path that:

```js
clearTimeout(this.roomExpiryTimer);
this.onStatus(reason);
this.disconnect(false, { presenceMode: 'keep-on-disconnect' });
this.onRoomUpdate({ roomId: null, role: null, members: [] });
```

After `connect(room, role)` validates a finite numeric `room.expiresAtMs`, schedule
that path for `Math.max(0, room.expiresAtMs - now())`; an already expired room
therefore closes immediately. A missing or invalid expiry rejects room connect
instead of leaving an unbounded listener. The path is local only: it
does not call the HTTP endpoint, write RTDB, recreate presence or restore the
room. In the existing state listener, replace the current `!nextState` early
return with this terminal path when the listener belongs to the active room.

Split `disconnect()` into two explicit presence modes. `remove` remains the
default for normal leave/provider switch and performs the existing
`onDisconnect().cancel()` plus `presenceRef.remove()`. `keep-on-disconnect` is
used only by expiry/server-deletion terminal paths and performs neither call:
at that moment the existing RTDB rules may already deny a client-side presence
mutation. Both modes clear `roomExpiryTimer` and unregister
`roomExpiryCheckDisposer`, making a manual leave or provider change unable to
fire a stale callback later.

Install one local `visibilitychange` and `focus` recheck for the active room. On
returning from background it compares `now()` against `expiresAtMs` and runs the
same terminal path before any room UI refresh. It makes no Firebase request. The
timer/recheck is best-effort UX only because local clocks and browser suspension
are not security authorities; RTDB expiry rules remain authoritative.

Verification:

- a short injected expiry detaches state, members and presence listeners and
  retains the registered server `onDisconnect` operation without calling cancel;
- expiry calls neither `presenceRef.remove()` nor `onDisconnect().cancel()`,
  publishes no RTDB write and makes no HTTP request;
- a server-side `state: null` snapshot performs the same detach immediately;
- a stale timer from a previous room cannot disconnect a newly joined room;
- a delayed timer is corrected by the injected focus/visibility recheck;
- a normal manual `disconnect()` clears the timer without duplicate UI update
  **and still calls** `onDisconnect().cancel()` plus `presenceRef.remove()`;
  only expiry/server deletion keeps the registered disconnect operation.

### 4. Register one daily scheduled function

Files: modify `functions/index.js`.

Extract one private `getWatchRoomStagingDatabase()` in `functions/index.js` from
the current inline `watchRoomsStaging` factory. It validates
`WATCH_ROOM_STAGING_DATABASE_URL` with the existing strict Firebase URL pattern
and returns `getDatabaseWithUrl(url, app)`. Both the HTTP staging endpoint and
the scheduled job call this one helper.

Add:

```js
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { createExpiredWatchRoomCleanup } = require('./watchRoomCleanup');
```

Export only this job:

```js
exports.cleanupExpiredWatchRoomsStaging = onSchedule(
  {
    schedule: '15 4 * * *',
    timeZone: 'Asia/Tbilisi',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
    retryCount: 1,
    maxRetrySeconds: 300,
  },
  async () => createExpiredWatchRoomCleanup({
    db,
    getRealtimeDatabase: getWatchRoomStagingDatabase,
  }).run()
);
```

The job must throw only after a sanitized error summary is logged; it has no HTTP
endpoint and no user input.

Verification: load `functions/index.js` in the focused test or a require smoke,
assert schedule, timezone, retry cap and max instances from the exported trigger
definition where the Firebase test harness permits it. The cleanup unit test
proves that a nonzero `failed` rejects the handler; the trigger-contract test
proves only the deployed retry configuration. Do not claim that a unit or normal
staging smoke test proves a real Cloud Scheduler retry without an intentional
failure.

### 5. Add operational signals and prove bounded cost in staging

Files: modify `functions/watchRoomCleanup.js`, create
`tests/movieDetailsWatchRoomUi.test.cjs`, modify `README.md`, `.agents/rules/agent.md`
after tests succeed. No Cloud Logging metric, alert policy, notification channel
or Firestore status document is created in this release.

The helper emits one structured aggregate summary per run. If `scanned` reaches
50, it adds `cleanup_backlog_cap`; if a room has an unexpected shape, it adds
`unexpected_room_shape`; if any cleanup attempt fails, it adds `cleanup_failed`.
At most one warning per fixed code is emitted in one run. Every warning contains
only aggregate counters and fixed codes: no room ID, UID, invite ID, title,
display name, provider or media URL. Logs Explorer is the operator signal.

Use the fixed log prefix `[WatchRoomCleanup]` and code text in each `console.warn`
call. After the first named-function deploy, open one real cleanup log in Logs
Explorer and copy its generated Cloud Functions/Run resource predicate. Do not
guess the generated service label. Save the following query as a console bookmark
or runbook command only; do not turn it into a logs-based metric:

```text
textPayload:"[WatchRoomCleanup]"
(textPayload:"cleanup_backlog_cap" OR textPayload:"unexpected_room_shape" OR textPayload:"cleanup_failed")
```

After the first manual scheduler run, verify the normal aggregate log in Logs
Explorer. A future metric/alert may be proposed only after an explicit budget
decision; it must be created before its validating anomaly log because
logs-based metrics do not backfill historical logs. Do not manufacture a failed
cleanup merely to test observability.

Run:

```text
node tests/watchRoomCleanup.test.cjs
node tests/watchRoomStagingController.test.cjs
node tests/movieDetailsWatchRoomUi.test.cjs
node tests/watchRoomRules.test.js
npm run lint
npm run build
git diff --check
firebase deploy --only functions:cleanupExpiredWatchRoomsStaging --project movielistdb-13208 --non-interactive
```

In staging, create one temporary room. In the Firestore console, edit only that
test document's `expiresAt` to a past Timestamp; do not add an endpoint or a
user-facing expiry override. Manually run the generated Scheduler job once, then
verify:

1. Room query no longer returns the Firestore room.
2. `roomLive/{roomId}` and both `roomAccess/*/{roomId}` nodes are gone.
3. `approvedRoomAccess/{uid}` remains.
4. Scheduler log contains only aggregate summary counters.
5. A current, unexpired room remains present and playable.

The local expiry behavior is proved by the injected controller test, separately
from this cleanup smoke. It must prove no listener remains after short expiry;
the Firestore-console test proves only physical cleanup, not expiry enforcement.

The MovieDetails UI contract test must set the controller to an expired detached
state, call the existing room-update callback and assert that participant popover
content is cleared, the participant controls are hidden, and `Создать`/`Войти`
are enabled. It must not create, join or restore a room.

Deploy only the new named function; do not redeploy unrelated functions or rules.

## Risks and Rollback

- Scheduler job availability: Firebase schedule functions require Cloud Scheduler;
  confirm project billing/API permissions before deployment. If the account already
  exceeds the three-job allowance, expected scheduler cost is $0.10/month.
- Overlap/retry: `maxInstances: 1`, one bounded retry and idempotent null/deletes
  prevent duplicate resource creation. A failed record remains securely expired;
  after the retry it waits for the next daily run.
- Backlog: more than 50 expired rooms stays secure but is processed on later days.
  `cleanup_backlog_cap` is a bounded warning in Logs Explorer; only raise the cap
  after measured usage and an explicit review of Firestore quotas.
- Data shape corruption: unexpected member/invite cardinality is skipped rather
  than partially deleted. `unexpected_room_shape` is a bounded warning; investigate
  manually and do not raise the cap blindly.
- Retained disconnect registration: expiry intentionally makes no client RTDB
  mutation because the expired ACL can reject it. It is not a data or listener
  owner, is harmless after the room branch is removed, and must never be treated
  as an alternative physical-cleanup mechanism.
- Browser suspension: a delayed timer can receive one terminal RTDB snapshot after
  resume. Focus/visibility recheck detaches immediately; security is still held by
  RTDB rules and the cost contract does not claim zero terminal traffic.
- Rollback: delete only `cleanupExpiredWatchRoomsStaging` from deployment. No data
  migration or schema change exists, and pre-existing expiry rules remain intact.

## Execution Readiness

- Intent Lock: daily physical cleanup of expired staging rooms only.
- Scope Fence: no room UI, provider, pricing-dashboard or production room changes.
  The only client change is local expiry/server-deletion detach in the existing
  room controller; it adds no Firebase request or persistence.
- Compatibility: expiry remains the canonical security gate; global approvals persist.
- Test obligations: targeted cleanup failure matrix plus current room contracts.
- Evidence required: fresh focused tests, lint/build/diff checks, successful named
  function deployment and one isolated staging manual-run proof.
- Route: inline; persistence and RTDB cleanup share one safety boundary.
