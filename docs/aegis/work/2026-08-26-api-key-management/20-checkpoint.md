# Task Checkpoint

## Current todo

- [completed] Task 1 — Extract shared admin authentication.
- [completed] Task 2 — Add Secret Manager vault operations and safe registry DTOs.
- [completed] Task 3 — Add Kinopoisk quota adapter and runtime key pool.
- [completed] Task 4 — Add Firestore rules and migration utility.
- [completed] Task 5 — Add AdminService transport and API-key pane.
- [completed] Task 6 — Run regression, build, browser smoke, and documentation.

## Active slice

All implementation slices and final verification are complete. The user
authorized and the agent completed the `providerKeysAdmin` deployment, IAM
grant, 3-key Kinopoisk migration, and registry-backed `kinopoiskProxy` deploy.
The project-number resource-name normalization fix is deployed; the aggregate
secret remains active as the rollback bridge.

## Completed

- Approved design and implementation plan were written and self-reviewed.
- TaskStartSnapshot captured before source implementation.
- Extracted `functions/adminAuth.js` and reused it from `functions/index.js`.
- Added `tests/adminAuth.test.cjs` for 401/403/auth extraction behavior.
- Added Secret Manager vault helpers, safe provider-key registry DTOs, lifecycle
  audit writes, and the `providerKeysAdmin` function.
- Added a cached Kinopoisk runtime key pool and preserved aggregate-secret
  fallback as an explicit migration bridge.
- Added admin-only Firestore rules and a dry-run/apply migration utility that
  reports fingerprints and masks without printing raw values.
- Added AdminService methods, API-key inventory/actions, quota states, and
  accessible add/revoke dialogs to the admin page.
- Deployed `providerKeysAdmin` to `us-central1` after fixing auth failures that
  were incorrectly normalized from 401 to 500.
- Granted Secret Manager lifecycle access to the migration and Functions
  service accounts after a read-only IAM preflight.
- Imported 3 unique Kinopoisk credentials and verified all 3 Secret Manager
  versions are readable by the runtime account.
- Health-checked all 3 imported credentials through the server-side KP adapter;
  all were accepted and quota fields were unavailable.
- Deployed the registry-backed `kinopoiskProxy` to `us-central1`.
- Fixed Secret Manager references canonicalized to the numeric project number;
  provider-key reads now normalize them to the configured project ID.
- Re-checked all 3 admin `test` and `quota` operations live; each returned 200.
- Re-checked the registry-backed Kinopoisk proxy live; a real `/v1.4/movie/random`
  request returned 200 instead of the false quota-exhausted response.
- Versioned the client quota-breaker storage key so stale pre-fix cooldown state
  cannot suppress requests after the proxy recovery.

## Evidence refs

- `docs/aegis/specs/2026-08-26-api-key-management-design.md`
- `docs/aegis/plans/2026-08-26-api-key-management.md`
- Existing `firestoreUsage` admin function and contract tests.
- `node tests/adminAuth.test.cjs` — exit 0.
- `node tests/adminFirestoreUsageContract.test.js` — exit 0.
- `node --check functions/adminAuth.js` and `functions/index.js` — exit 0.
- `npm run test:provider-keys` — exit 0.
- `npm test` — exit 0; full existing regression suite passed.
- `npm run lint` — exit 0.
- `npm run build` — exit 0.
- `node tests/adminBrowserSmoke.cjs` — exit 0 against a local static server;
  responsive provider-key markup rendered in a 390px viewport.
- Live endpoint smoke — unauthenticated GET returns `401 AUTH_REQUIRED`,
  preflight returns `204`, and the deployed function appears in Firebase.
- Migration dry-run — 3 inputs, 3 unique fingerprints, 0 duplicates.
- Migration apply — imported 3 credentials, skipped 0 existing records.
- Runtime credential check — 3 registry records and 3 readable Secret Manager
  versions; 3 KP health-checks succeeded.
- Live admin key smoke — all 3 `test` and `quota` actions returned 200 after
  project-number normalization; the three keys were active again.
- Live proxy smoke — authenticated `/v1.4/movie/random` returned 200 with a
  non-empty response body.
- Client recovery guard — the quota-breaker storage key is now versioned to
  ignore stale pre-migration cooldown state.

## Blockers

- No implementation blocker.
- TMDB registry migration remains outside the Kinopoisk-first scope.
- Aggregate-secret retirement remains a separate explicit cutover operation.

## Drift check

- Intent: aligned; the new endpoint will reuse the extracted auth owner.
- Scope: aligned; Tasks 1–5 complete, final verification active.
- Compatibility: usage endpoint contract tests remain green.
- Retirement: inline auth owner retired; no provider fallback retired.
- Decision: `complete`; the authorized IAM, migration, and function deployments
  are complete, while aggregate-secret retirement remains deferred.

## Next step

No further implementation step remains; next operational step is authenticated
admin smoke, followed by a separately approved aggregate-secret cutover.
