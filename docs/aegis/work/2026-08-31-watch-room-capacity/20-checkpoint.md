# Watch-room capacity and reconnect checkpoint

## Current checkpoint

- Baseline snapshot captured at `a5a01492e997ee94a0e93a94b0baa90b6183f8ec` on
  branch `master`.
- Pre-existing working-tree changes are preserved and outside the task scope.
- Active slice: completed hardening, release verification, and live endpoint smoke-check.

## Completed

- Audited the plan against current staging service, handler, cleanup, RTDB rules,
  and controller.
- Confirmed current staging defaults are 2 participants and one invite use.
- Changed staging capacity to 10 total participants and one shared invite with
  9 guest redemptions.
- Added structured API errors, per-connection RTDB presence, stale detection,
  heartbeat, `.info/connected` recovery, and cleanup support for 10 members.
- Added service, handler, cleanup, rules, and controller regression coverage.
- Isolated new writes in `presenceV2/{uid}/{connectionId}` while retaining legacy
  `presence/{uid}` reads for mixed-version clients.
- Fenced pending presence writes by session generation and made create retries
  idempotent through a server-only Firestore request ledger.
- Deployed staging Functions, RTDB Rules, and Firestore Rules successfully.

## Next

- Run authenticated 10-browser acceptance with a forced network interruption before
  production rollout.

## Drift check

- Intent lock: durable membership remains Firestore; live presence remains RTDB.
- Compatibility boundary: no changes to unrelated room modes or generated
  distribution files.
- Retirement boundary: legacy presence rules/readers remain until mixed-version
  acceptance and runtime evidence prove the old writer path is unused.
