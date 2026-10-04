# Evidence

- `node tests\\watchRoomService.test.cjs` — role mutation accepts only owner,
  viewer/controller target roles, rejects invalid/self/non-owner/expired cases.
- `node tests\\watchRoomsStagingHandler.test.cjs` — RTDB mirror writes only the
  two role paths.
- `node tests\\watchRoomRules.test.js` — controller is allowed only for the five
  timeline fields; `providerHint` remains owner-only.
- `node tests\\watchRoomStagingController.test.cjs` — promotion and demotion
  alter timeline publishing while provider publication remains blocked; a
  owner and controller apply each other's published state but not their own RTDB echo.
  The owner regression also proves a controller timeline update does not invoke
  the provider-switch callback.
- `node tests\\movieDetailsWatchRoomUi.test.cjs` — expired-room controls and
  owner-only role-action markup remain locally owned.
- `npm run lint` and `npm run build` — passed.
- `firebase deploy --only functions:watchRoomsStaging,database:watchrooms-staging`
  — staging RTDB rules released; function list reports `watchRoomsStaging` as
  `ACTIVE` with source generation `1787953681381721`.

## Remaining manual evidence

Reload the unpacked extension in two browser profiles, create a room, promote
the guest, verify shared play/pause/seek, then demote and verify the guest no
longer changes the shared timeline. This requires an authenticated live player
and has not been automated.
