# Shared TMDB–Kinopoisk mappings

## Goal

Make every verified TMDB→Kinopoisk mapping available to all authenticated extension
users. Firestore becomes authoritative; `chrome.storage.local` remains a device cache,
not an independent mapping database.

## Architecture

`IdMappingService` remains the sole identity-mapping owner. Add one Firestore collection,
`tmdbKinopoiskMappings`, with one forward document per canonical key (`movie:123` or
`tv:123`). Each document stores `tmdbId`, `mediaType`, `kpId`, `kpType`, `title`, `year`,
verification metadata, `reverseKey`, `confirmedBy`, `createdAt`, and `updatedAt`.

The document key is the authoritative forward lookup. `reverseKey` is
`${mediaType}:${kpId}` and supports a single-field reverse query; the local reverse cache
is rebuilt from the fetched forward record. Do not write reverse documents to Firestore.

## Tech stack

Chrome MV3, vanilla JavaScript, Firebase Firestore compat API, Firestore security rules,
Node assertion tests, ESLint, and the existing npm build pipeline.

## Baseline / authority refs

- `docs/aegis/baseline/2026-08-29-id-mapping-baseline.md`
- `CONTEXT.md`
- `src/shared/services/IdMappingService.js`
- `src/shared/services/TmdbFallbackQueueService.js`
- `rules/firestore.rules` and `rules/firestore.indexes.json`

## Compatibility boundary

- “All users” means authenticated extension users, matching the existing shared IMDb
  mapping contract; guest access is intentionally out of scope.
- Keep public `IdMappingService` method signatures and canonical key format unchanged.
- Keep `tmdbFallbackQueue` and `tmdbMovieMappings` unchanged; they serve the separate
  Kinopoisk→IMDb workflow.
- Existing locally stored mappings stay usable as cache data during the migration, but an
  admin-confirmed local mapping must not overwrite a conflicting cloud mapping.
- Offline reads may use a last-known local cache; offline manual writes must fail visibly
  rather than creating a private, divergent mapping.
- Only admin-verified manual mappings are shared. Automatic provider-resolution entries
  remain local, derived cache data and are never bulk-published.

## TDD route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression plus Firestore emulator/manual acceptance check
- Reason: the project and request do not require strict TDD.
- Verification: focused Node contracts, lint, build, and two-user Firestore acceptance.

## Planning checks

**Aegis visibility.** Planning is needed because this changes persistence, access control,
source-of-truth ownership, and migration behavior.

**Plan basis.** Fact: manual TMDB→Kinopoisk mappings use `chrome.storage.local`.
Fact: the IMDb workflow already has shared Firestore collections. Assumption: global
mappings contain no user-private data. Unknown: the production Firebase project must have
the new rules and index deployed before the client release.

**Requirement ready check.** Goal, users, scope, and acceptance are clear: an admin's
verified mapping must be usable by another authenticated user. Decision: ready.

**Change necessity.** Configuration alone cannot turn browser-local data into a shared,
access-controlled source. Minimum boundary: `IdMappingService`, Firestore rules/indexes,
the admin migration UI, and their tests. Decision: code-change.

**Existence check.** Reuse `IdMappingService`; it already owns forward/reverse identity
logic. A new Firestore collection is necessary because `tmdbMovieMappings` is keyed by
Kinopoisk ID and owns IMDb data. Decision: add `tmdbKinopoiskMappings` with proof.

**Architecture integrity.** Firestore owns verified forward records. The local cache is
derived data, and reverse entries remain derived from the fetched forward record. No
parallel cloud owner or title-based fallback is introduced. Verdict: proceed.

**Complexity check.** `IdMappingService` is large, but the added Firestore adapter methods
belong beside its existing cache methods. Add no second service; extract private helpers only
if the new persistence block cannot remain cohesive. Recommendation: edit in place.

## Tasks

### 1. Define the shared record and access contract

Files: modify `rules/firestore.rules`, `rules/firestore.indexes.json`; create
`tests/sharedIdMappingFirestoreContract.test.js`.

Why: prevent a client from writing global identity data and enable reliable reverse lookup.

Steps:

1. Add `match /tmdbKinopoiskMappings/{mappingId}`. Allow `read` for `isAuthenticated()`;
   allow `create`, `update`, and `delete` only for `isAdmin()`.
   Require the document ID to equal `mediaType + ':' + tmdbId`, validate positive numeric
   IDs and the allowed field set, and require `confirmedBy`/`updatedBy` to match the admin UID.
2. Add a collection index for `tmdbKinopoiskMappings.reverseKey` ascending only if the
   deployed Firestore query plan requires it; a single equality field normally has an
   automatic single-field index. Do not add a speculative composite index.
3. In the new test, assert the collection name, authenticated read rule, admin-only write
   rule, and that no rule weakens `tmdbFallbackQueue` or `tmdbMovieMappings`.
4. Run `node tests/sharedIdMappingFirestoreContract.test.js` and expect a passing contract.

Repair track: the repair is an explicit shared access contract. Retirement track: no legacy
Firestore collection is retired; `tmdbMovieMappings` remains IMDb-only.

### 2. Make Firestore the authoritative mapping source

Files: modify `src/shared/services/IdMappingService.js`; extend
`tests/idMappingService.test.js`; extend `tests/sharedIdMappingFirestoreContract.test.js`.

Why: all normal forward and reverse lookups must observe the same verified mapping.

Steps:

1. Add constants for `tmdbKinopoiskMappings`, a document-id helper returning
   `buildKey(mediaType, tmdbId)`, and a `reverseKey` helper returning
   `${normalizeMediaType(mediaType)}:${Number(kpId)}`.
2. Add a read helper that fetches requested forward document IDs from Firestore in chunks of
   at most 30 IDs, validates the stored media type and positive IDs, and converts accepted
   records with the existing trusted-mapping normalization.
3. Add a reverse helper that queries one `reverseKey`, accepts exactly one verified record,
   and refuses ambiguous data with a logged error rather than guessing by title.
4. In `resolveBatch` and `resolveTmdbIdByKinopoiskId`, consult these shared helpers before
   accepting a local cache hit; merge verified cloud records into the local forward and
   derived reverse cache.
5. In `setManualMapping`, write the verified forward document first with server timestamps
   and the current admin UID; update the local cache only after the write succeeds. Inside a
   Firestore transaction, query `reverseKey`; on a different existing `kpId`, throw a conflict
   error and leave the cloud record unchanged.
6. In `removeManualMapping`, delete the authoritative document first, then invalidate the
   local forward and reverse cache entries. Do not delete on a failed cloud request.
7. Test cloud hit, reverse lookup, rejection of malformed/ambiguous cloud data, write-first
   behavior, conflict preservation, and offline local-cache read versus offline write failure.
8. Run `node tests/idMappingService.test.js` and
   `node tests/sharedIdMappingFirestoreContract.test.js`; expect both to pass.

Repair track: remove the current private-write path as an authority. Retirement track: retain
`chrome.storage.local` only as a derived, refreshable cache; delete no cache keys in this task.

### 3. Migrate existing administrator-local manual mappings safely

Files: modify `src/pages/admin/admin.html`, `src/pages/admin/admin.js`,
`src/shared/services/IdMappingService.js`, `src/shared/styles/admin.css`; extend
`tests/adminIdentityWorkspace.test.js` and `tests/idMappingService.test.js`.

Why: existing useful local mappings must be publishable without silently replacing cloud data.

Steps:

1. Add an admin-only action labelled “Опубликовать локальные связи в общую базу” near the
   manual-mapping list. Before confirmation, show the count of local `isManual` forward
   entries and state that existing cloud records win conflicts.
2. Add `publishLocalManualMappings()` in `IdMappingService`. Iterate only forward,
   `isManual` records; validate type and IDs; create missing cloud documents; skip identical
   cloud documents; report conflicts where the existing cloud `kpId` differs.
3. Persist a local migration marker with the completed timestamp and summary. Allow a manual
   rerun only when local manual entries changed after that timestamp.
4. Render results as `published`, `alreadyShared`, `conflicts`, and `invalid`; never claim
   success if a Firestore batch or individual document write failed.
5. Add focused tests for preview visibility, confirmation requirement, idempotent rerun, and
   cloud-wins conflict reporting.
6. Run `node tests/adminIdentityWorkspace.test.js`, `node tests/idMappingService.test.js`,
   and `npm run test:admin`; expect passes.

Repair track: publish prior local authority records once. Retirement track: after successful
migration, remove the UI wording that implies a mapping is device-only; retain export/import
only as an explicit admin recovery tool until the next audited release.

### 4. Verify real shared behavior and deploy in the safe order

Files: modify `README.md`, `.agents/rules/agent.md`; deployment configuration only where the
repository already defines Firebase rule/index deployment.

Why: a passing client build cannot prove that production Firestore permissions and indexes are
active.

Steps:

1. Deploy Firestore rules and any required index before publishing the extension build. Verify
   the Firebase deployment reports success and wait for an index to become ready if one was
   created.
2. Use two different authenticated accounts: Account A (admin) saves a verified TMDB mapping;
   Account B opens the same title on a clean extension profile and resolves the identical
   Kinopoisk ID without a manual entry or provider-title heuristic.
3. Confirm Account B cannot edit/delete the mapping; confirm a non-admin write is denied;
   confirm the admin sees the migration result after reload.
4. Update README and `.agents/rules/agent.md` with the collection, source-of-truth rule,
   access model, cache-only fallback, and migration outcome.
5. Run `npm run lint`, `npm run test:admin`, `npm test`, and `npm run build`; expect all
   commands to exit successfully.

Repair track: production verification proves the shared contract. Retirement track: once two
release cycles pass with successful cloud reads and no migration conflicts, remove legacy
local-only import as a supported migration path; keep only the bounded cache.

## Risks and rollback

- A rules deployment failure would make clients unable to read mappings: deploy rules before
  client code and keep the previous extension version available.
- A cloud/local conflict can represent a valid correction: cloud wins automatically, while the
  admin receives both IDs for review; no record is overwritten automatically.
- Firestore outage must never create a local-only “shared” mapping: writes fail, reads may use
  an explicitly labelled last-known cache.
- Added document reads can affect quota: batch forward lookups by requested IDs and do not
  subscribe to the entire collection.

## Acceptance evidence

1. A mapping saved by one admin is read by a second authenticated account on a clean profile.
2. Non-admin users can read but cannot write or delete a shared mapping.
3. A failed Firestore write leaves no new local manual authority record.
4. Existing local admin mappings can be published, rerun safely, and surface conflicts.
5. The IMDb Firestore workflow remains unchanged.

## Execution readiness view

- Intent lock: global, verified TMDB→Kinopoisk mappings for authenticated users.
- Scope fence: do not change rating, IMDb, TMDB provider, or title-heuristic behavior.
- Baseline lock: preserve `movie|tv:tmdbId` keys and derive reverse cache entries.
- Owner / contract: `IdMappingService` owns all identity mapping; Firestore is canonical.
- Compatibility: public methods keep their signatures; local cache supports only offline reads.
- Retirement: local manual writes end at release; legacy local records are migrated explicitly.
- Task batches: rules → service → admin migration → deployment verification.
- Test obligations: focused service/rule/admin tests, lint, full suite, build, two-account check.
- Drift rule: stop if production rules cannot guarantee admin-only writes or if a required
  Firestore index changes the query design; revise the plan before release.
- Evidence required: CI commands pass, rules/index deployment succeeds, and two-account proof
  is recorded.

## Execution route

- Decision: inline
- Evidence: all tasks share the central `IdMappingService` owner and must preserve one
  persistence contract.
- Fallback: split rules/deployment verification from the client migration only if the owner
  boundary remains unchanged.
- User confirmation required: no
