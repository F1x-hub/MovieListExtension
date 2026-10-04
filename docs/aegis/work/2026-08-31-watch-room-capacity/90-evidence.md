# Watch-room capacity and reconnect evidence

## Checks performed

- `node tests/watchRoomService.test.cjs` — passed capacity, invite, duplicate,
  and room membership contracts.
- `node tests/watchRoomsStagingHandler.test.cjs` — passed staging 10/9 wiring.
- `node tests/watchRoomCleanup.test.cjs` — passed 10-member cleanup and bounds.
- `node tests/watchRoomCleanupTrigger.test.cjs` — passed scheduled cleanup wiring.
- `node tests/watchRoomRules.test.js` — passed server-only and nested presence
  rule contract checks.
- `node tests/watchRoomStagingController.test.cjs` — passed RTDB reconnect,
  multi-connection presence, stale status, expiry, and API error checks.
- `node tests/movieDetailsWatchRoomUi.test.cjs` — passed room UI expiry reset.
- `npm run lint` — passed.
- `npm run build` — passed; generated `dist/` through the normal build script.
- `node --check` for changed JavaScript files — passed.
- `npm test` — passed; complete repository regression suite finished without failures.
- JSON parse of `rules/database.rules.json` — passed.
- `git diff --check` — passed; only line-ending warnings were reported.
- `firebase deploy --only functions:watchRoomsStaging,functions:cleanupExpiredWatchRoomsStaging,database:watchrooms-staging` — passed.
- `firebase deploy --only firestore:rules` — passed.
- `firebase functions:list --project movielistdb-13208` — both staging Functions active in `us-central1`.
- Unauthenticated POST smoke-check — `401 AUTH_REQUIRED`, as required by the endpoint boundary.

## Scope

The checks cover the changed service, handler, cleanup, Firestore/RTDB rules
contracts, client controller, and related MovieDetails UI contract. Firebase
deployment was performed; authenticated multi-browser capacity and a live
network interruption were not performed.

## Residual risk

- No authenticated 10-browser acceptance is available in this workspace, so the
  real concurrent browser and network-recovery behavior remains unverified.
- Legacy clients can keep writing flat `presence/{uid}` until they disconnect;
  the path is retained as a bounded compatibility reader/writer boundary.
- The create ledger stores the replayable join code in a server-only collection;
  Firestore Rules explicitly deny client reads and writes.
- A full browser test with 10 real clients and a forced network interruption is
  still the highest-value runtime verification.

## Confidence

Confidence: B — direct target, deployment, and regression evidence is fresh, with
the authenticated multi-browser runtime gap still bounded and explicit.
