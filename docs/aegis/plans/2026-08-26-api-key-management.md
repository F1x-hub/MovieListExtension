# API key management and quota dashboard — implementation plan

## Goal

Implement the approved design in
`docs/aegis/specs/2026-08-26-api-key-management-design.md` so an admin can
manage provider credentials without exposing raw values, while the existing
Kinopoisk proxy remains the only client API transport.

The first enabled provider is Kinopoisk. TMDB and Spotify remain outside the
managed UI until their credential boundaries are verified and migrated.

## Architecture

- `functions/index.js` remains the Cloud Function entrypoint and admin auth
  boundary.
- Secret Manager owns raw credential values, one secret per managed key.
- Firestore owns non-secret registry metadata and low-volume audit events.
- `providerKeyManagement` owns admin CRUD, safe DTOs, and quota orchestration.
- `providerKeyPool` owns runtime selection and sanitized key outcomes for
  `kinopoiskProxy`.
- `AdminService` and `src/pages/admin` own client transport and presentation.
- Firestore project usage remains owned by `firestoreUsage`; it is not merged
  into provider-key quota data.

## Tech Stack

- Firebase Functions v2 / Node.js 22
- Firebase Admin SDK and Firestore
- Google Cloud Secret Manager client
- Chrome MV3 extension with vanilla JavaScript and CSS
- Existing Node regression tests, ESLint, and npm build

## Baseline / Authority Refs

- `docs/aegis/specs/2026-08-26-api-key-management-design.md`
- `docs/aegis/plans/2026-08-25-kinopoisk-secret-proxy.md`
- `.agents/rules/agent.md`
- `functions/index.js`
- `functions/kinopoiskProxy.js`
- `functions/firestoreUsage.js`
- `src/shared/services/AdminService.js`
- `src/pages/admin/admin.js`
- `src/pages/admin/admin.html`
- `src/shared/styles/admin.css`
- `rules/firestore.rules`

## Compatibility Boundary

- Preserve all existing `KinopoiskService` public methods and proxy response
  normalization.
- Preserve proxy authentication, `/v1.4/` allowlist, bounded retries, safe
  error codes, and the local quota circuit breaker.
- Do not add a direct Kinopoisk, TMDB, or Spotify client fallback.
- Do not change website Kinopoisk scraping.
- Do not alter Firestore usage metric names or free-tier dashboard semantics.
- Do not deploy functions, create/revoke production secrets, or expose raw
  credentials during implementation.

## TDD Route

- Mode: `off`
- Decision: `skipped`
- Strict authority: none; the user did not request strict test-first TDD.
- Test posture: post-change regression plus isolated mocked contract tests.
- Reason: the existing repository uses contract tests without a strict RED /
  GREEN workflow, and the implementation has several security boundaries that
  need focused tests after each slice.
- Verification: targeted tests after each backend/UI slice, then full lint,
  regression, build, and browser smoke.

## Requirement Ready Check

- Requirement source refs: approved design spec and user approval (`го`).
- Goals and scope refs: design sections 1, 2, and 8.
- User/scenario refs: admin list, add, test, disable, enable, revoke, quota.
- Acceptance refs: design section 10.
- Open blocker questions: none for the Kinopoisk-first implementation.
- Decision: `ready`.

## BaselineUsageDraft

- Required refs: all baseline refs above.
- Delivered context refs: completed Kinopoisk Secret Proxy implementation and
  existing Firestore usage dashboard.
- Acknowledged before plan refs: the approved design and Secret Proxy plan.
- Cited in plan refs: Architecture, Compatibility Boundary, File Map, and
  Retirement sections.
- Missing refs: provider-specific TMDB and Spotify numeric quota contracts.
- Decision: `continue`; unsupported provider quota is represented as
  `unavailable` and is not part of the first enabled provider.

## Change Necessity

- User-visible need: admins need safe key inventory, key lifecycle controls,
  purpose labels, and truthful per-key quota/status.
- No-change option: documentation alone cannot add authenticated CRUD,
  Secret Manager writes, runtime selection, or UI states.
- Why code change is necessary: the current proxy accepts an anonymous array of
  secret values and has no key identity, metadata, admin management endpoint,
  or per-key quota adapter.
- Minimum change boundary: existing Functions admin/auth/proxy owners,
  Secret Manager dependency, Firestore rules, `AdminService`, and the admin
  page plus targeted tests.
- Decision: `code-change`.

## Existence Check

- Proposed `providerKeyManagement` endpoint: reuse `functions/index.js` and
  `verifyAdminRequest`; add one management owner because Secret Manager CRUD
  cannot live in the extension or in `firestoreUsage`.
- Proposed `providerKeyPool`: extract the current inline key loop because
  per-key identity and disabled-key selection cannot be implemented safely in
  `kinopoiskProxy` without a reusable owner.
- Proposed quota adapter contract: add one small provider-facing seam because
  exact quota is provider-specific and must not be guessed by the UI.
- Proposed `systemApiKeys` metadata: add with proof because labels/status,
  fingerprints, and actor audit data must be queryable without reading secret
  values.
- Entropy/retirement impact: the old aggregate secret is migration input only;
  after cutover it is disabled and removed after the rollback window.
- Decision: `add-with-proof` for these four bounded surfaces; reject any
  client-side credential store or duplicate direct provider transport.

## Architecture Integrity Lens

- Invariant: one server-side credential boundary and one Kinopoisk transport.
- Canonical owners: Secret Manager for values, Firestore for metadata/audit,
  Functions for lifecycle and runtime selection, extension for presentation.
- Responsibility overlap: current `kinopoiskProxy` owns selection inline;
  move only selection/credential loading to `providerKeyPool`, retaining
  request validation and relay in the proxy.
- Higher-level simplification: share `verifyAdminRequest` between
  `firestoreUsage` and the new management endpoint instead of duplicating auth.
- Retirement/falsifier: if the pool requires client-side keys or per-request
  Firestore writes, stop and revise the design; both violate the approved
  boundary.
- Verdict: proceed with the existing proxy owner plus the bounded server seams.

## Plan-Time Complexity Check

- Artifact class: cross-module security/contract/persistence feature.
- Target files: existing Functions entrypoint/proxy, new backend helpers,
  Firestore rules, admin service/page/style, tests, and dependency lockfile.
- Existing pressure: `functions/index.js` already owns multiple HTTP handlers;
  `AdminService` and `admin.js` are large legacy owners.
- Projected pressure: high if management, vault access, runtime selection, and
  quota rendering are added inline.
- Better boundary: extract server helpers and keep UI rendering in existing
  admin owners; do not add a second admin page or a generic client key store.
- Recommendation: add bounded owner files and split execution into verified
  backend, runtime, UI, and migration slices.

## File Map

### Create

- `functions/adminAuth.js` — shared Firebase ID-token/admin-profile check.
- `functions/providerKeyVault.js` — Secret Manager access and secret lifecycle.
- `functions/providerKeyPool.js` — active-key loading, selection, cache, and
  sanitized runtime outcomes.
- `functions/providerKeyManagement.js` — admin endpoint, registry DTOs,
  lifecycle operations, audit writes, and quota adapter dispatch.
- `functions/providerQuotaAdapters.js` — Kinopoisk quota normalization and
  explicit unsupported-provider results.
- `tests/providerKeyManagement.test.cjs` — mocked security, lifecycle, DTO,
  quota, and no-secret-leak contracts.
- `tests/adminAuth.test.cjs` — shared admin authorization and safe status
  contracts.
- `tests/providerKeyPool.test.cjs` — selection, disabled-key, cache, and
  sanitized outcome contracts.
- `scripts/migrate-kinopoisk-secret.js` — server/operator-only migration from
  the aggregate secret to per-key secrets with dry-run support; it never prints
  raw values.

### Modify

- `functions/index.js` — reuse `adminAuth`, export the new admin endpoint, and
  wire dependencies without changing existing public function names.
- `functions/kinopoiskProxy.js` — use `providerKeyPool` while preserving target
  validation, retry limits, relay behavior, and error codes.
- `functions/package.json` and `functions/package-lock.json` — add the Google
  Cloud Secret Manager client required for dynamic per-key lifecycle control.
- `rules/firestore.rules` — allow registry/audit reads and writes only through
  the admin authority used by the function; clients cannot write secret fields.
- `src/shared/services/AdminService.js` — add authenticated list/add/test/
  enable/disable/revoke/quota methods and safe response validation.
- `src/pages/admin/admin.html` — add the API-key pane, table/cards, add dialog,
  quota states, and confirmation dialog hooks.
- `src/pages/admin/admin.js` — load/render key rows, form validation, actions,
  focus/confirmation lifecycle, and localized failure states.
- `src/shared/styles/admin.css` — responsive key table/cards, quota bars,
  status badges, dialog layout, and reduced-motion behavior.
- `package.json` — add the targeted key-management test command.
- `README.md` — record the implemented feature only after code verification.
- `.agents/rules/agent.md` — update structure/architecture/rules only for
  modules and conventions that actually exist after implementation.

## Implementation Tasks

### Task 1 — Extract shared admin authentication

Files: create `functions/adminAuth.js`; modify `functions/index.js` and the
existing Firestore usage tests.

Why: the new key endpoint and `firestoreUsage` must share one server-side admin
check, so an authorization fix cannot drift between endpoints.

Change necessity: duplicate auth code would create two security owners; moving
the existing `verifyAdminRequest` into one small module is the minimum repair.

Steps:

1. Move bearer-token parsing, Firebase ID-token verification, profile lookup,
   and 401/403 status assignment into `verifyAdminRequest({ req, db, auth })`.
2. Keep the current `isAdmin === true` profile rule and do not trust client
   claims alone.
3. Update `firestoreUsage` to call the extracted helper.
4. Export the helper for mocked function tests without exposing it to the
   extension.
5. Run `node tests/adminFirestoreUsageContract.test.js` and the new backend
   auth tests; expect exit code 0.

Impact/compatibility: no client-visible response change; existing usage auth,
CORS, and error behavior must remain identical.

### Task 2 — Add Secret Manager vault operations and safe registry DTOs

Files: create `functions/providerKeyVault.js` and
`functions/providerKeyManagement.js`; modify Functions dependencies.

Why: add/list/disable/revoke require a server-side credential lifecycle owner.

Change necessity: `defineSecret()` supports fixed deployment secrets but not
admin-created per-key secret names; the management endpoint needs the official
Secret Manager client.

Steps:

1. Add the Secret Manager dependency with `npm install` from `functions/` and
   preserve the lockfile.
2. Implement strict provider/key ID validation, bounded secret length, and
   fingerprint/mask helpers. Never log the input value.
3. Implement vault methods for create secret, add version, access current
   version, disable version, and destroy only after explicit revoke.
4. Implement registry safe DTO creation that omits `secret`, secret payload,
   authorization headers, and upstream response bodies.
5. Implement admin operations: list, add, test, enable, disable, revoke.
6. Write one audit event per lifecycle action with actor UID, key ID, provider,
   action, result, and timestamp only.
7. Return stable error codes for unauthorized, invalid input, duplicate key,
   provider rejection, unavailable provider, and revoke failure.
8. Run `node tests/providerKeyManagement.test.cjs`; expect all mock security
   and no-secret-leak assertions to pass.

Impact/compatibility: new server endpoint only; no existing client transport
changes yet. Production IAM and Secret Manager provisioning remain operator
steps and are not executed by tests.

### Task 3 — Add Kinopoisk quota adapter and runtime key pool

Files: create `functions/providerQuotaAdapters.js` and
`functions/providerKeyPool.js`; modify `functions/kinopoiskProxy.js`.

Why: current rotation loses key identity and cannot skip disabled keys or show
per-key status.

Change necessity: the inline anonymous array loop cannot produce the approved
key ID, lifecycle, and quota contracts.

Steps:

1. Define the internal key entry shape `{ keyId, value, provider }` and keep it
   server-only.
2. Load active Kinopoisk registry entries and corresponding Secret Manager
   values with a bounded in-memory TTL and in-flight deduplication.
3. Select active keys using deterministic round-robin/least-recently-used
   ordering and return the selected key ID only to internal telemetry.
4. Mark rejected keys as temporarily unavailable in the local pool without
   changing the existing client `KP_QUOTA_EXHAUSTED` contract.
5. Move the current retry loop into the pool/proxy seam while preserving one
   retry for network/429/5xx and rotation for 401/402/403.
6. Normalize Kinopoisk token quota into `provider_exact` only when the
   provider response contains usable fields; otherwise return
   `unavailable`.
7. Keep the provider token check behind the server and extend only the
   provider adapter allowlist needed for `/v1.5/token`; do not broaden the
   general client proxy path.
8. Run `node tests/providerKeyPool.test.cjs`,
   `node tests/kinopoiskProxy.test.cjs`, and
   `node tests/kinopoiskQuotaCircuitBreaker.test.cjs`.

Impact/compatibility: preserve all existing proxy tests and client error
mapping. No per-request Firestore writes are permitted.

### Task 4 — Add Firestore rules and migration utility

Files: modify `rules/firestore.rules`; create
`scripts/migrate-kinopoisk-secret.js`; add migration tests.

Why: current aggregate keys need a controlled path into the new registry, and
the registry/audit collections need an explicit admin boundary.

Change necessity: without a migration path, existing keys disappear from the
admin inventory; without rules, a future client path could write metadata or
secret references directly.

Steps:

1. Add admin-only rules for `systemApiKeys` and `systemApiKeyAuditLogs`.
2. Reject any client write that attempts to add a raw secret field or alter
   `secretName` outside the server authority.
3. Implement migration dry-run that reads `KINOPOISK_API_KEYS` only on the
   server, reports count/fingerprints/duplicate count, and never prints values.
4. Implement migration apply mode that creates one Secret Manager secret and
   metadata record per normalized key with an imported label.
5. Require an explicit `--apply` flag and refuse to run without the configured
   project and Secret Manager credentials.
6. Add tests for dry-run default, duplicate normalization, no-secret output,
   and rule contract text.
7. Do not execute the migration against production during this task.

Impact/compatibility: existing user/admin collections remain unchanged. The
old aggregate secret is migration input only and remains active until an
operator completes verification and cutover.

### Task 5 — Add AdminService transport and API-key pane

Files: modify `src/shared/services/AdminService.js`,
`src/pages/admin/admin.html`, `src/pages/admin/admin.js`, and
`src/shared/styles/admin.css`.

Why: expose a safe operational workflow to the administrator.

Change necessity: the current admin shell has no key inventory, form, actions,
or quota states; direct Firestore writes would bypass the Secret Manager
transaction.

Steps:

1. Add one `AdminService` request helper that gets the current Firebase ID
   token, calls the management function, parses JSON, and validates the safe
   response shape.
2. Add methods for `listProviderKeys`, `addProviderKey`, `testProviderKey`,
   `setProviderKeyStatus`, `revokeProviderKey`, and `getProviderKeyQuota`.
3. Add the `API-ключи` navigation item beside the existing usage pane.
4. Render a responsive table on desktop and stacked cards below the existing
   admin breakpoint with provider, label, purpose, mask, status, last check,
   and quota source.
5. Add an accessible add dialog with labels, field errors, provider scope,
   secret input, and the one-time visibility warning.
6. Add test/enable/disable/revoke actions with a confirmation dialog for
   destructive revoke and focus restoration after close.
7. Render loading, empty, partial quota, unauthorized, duplicate, validation,
   provider failure, and retry states without clearing a previously loaded
   safe list during refresh.
8. Ensure the secret input is cleared after success or failure and is never
   copied into local storage or a persistent service field.
9. Add Russian labels and live status updates, then run the admin accessibility
   contract tests in a DOM fixture.

Impact/compatibility: existing admin panes, mobile navigation, Firestore usage,
approvals, reports, and auth gate remain unchanged.

### Task 6 — Regression coverage, build, and documentation

Files: modify `package.json`, `README.md`, and `.agents/rules/agent.md`; add or
extend targeted tests and browser smoke fixtures.

Why: this feature changes a credential boundary and must prove no secret
regression before it can be considered complete.

Steps:

1. Add `test:provider-keys` to run the isolated backend, pool, rules, and admin
   accessibility contracts.
2. Add source/dist scans that fail if managed raw credential fields or direct
   Kinopoisk `X-API-KEY` usage appear in the extension bundle.
3. Run `npm run test:provider-keys`, `npm run test:admin`, and `npm run lint`.
4. Run `npm test` and `npm run build`.
5. Start a clean local/test browser session and verify list/add validation,
   masked rows, no horizontal overflow, dialog focus, and safe error states.
6. Run `git diff --check` and inspect the exact task paths; preserve unrelated
   dirty worktree changes.
7. Update README changelog and living agent context with only implemented
   modules and verified constraints.

Impact/compatibility: build output is regenerated, never edited directly. No
production Firebase deployment, secret creation, or key revocation is included.

## Risks and Mitigations

- Secret Manager IAM is missing: fail closed with an operator-readable setup
  error; do not fall back to Firestore or client configuration.
- Two admins update simultaneously: use a registry transaction/idempotency key
  and reject a stale mutation rather than silently overwriting a credential.
- Function instances cache a disabled key: cap cache TTL and mark disabled keys
  in the local pool before selection; document the bounded propagation window.
- Provider quota is unavailable or stale: show the source and timestamp and use
  `unavailable`, never a guessed remaining number.
- Existing aggregate-secret cutover fails: keep the old secret untouched until
  migration verification; switch only after imported keys pass health checks.
- Spotify secret remains exposed: keep Spotify out of the new provider list and
  require credential rotation/backend migration before enabling it.
- Admin UI accidentally retains input value: clear the input on every terminal
  path and assert absence in DOM tests.

## Repair Track

- Root cause: credential values, key identity, runtime selection, and admin
  presentation currently have no shared server-side management contract.
- Canonical repair: Secret Manager per-key vault plus Firestore metadata/audit,
  managed by one authenticated Functions endpoint and consumed by the existing
  Kinopoisk proxy.
- Verification: no-secret-leak tests, admin auth tests, pool selection tests,
  provider quota normalization, full build/lint/regression, and browser smoke.

## Retirement Track

- Old owner: aggregate `KINOPOISK_API_KEYS` array consumed directly by
  `kinopoiskProxy`.
- Keep reason: required only as a migration source and rollback window.
- Retirement trigger: imported keys pass health checks, proxy uses the new pool,
  and authenticated production smoke succeeds.
- Retirement action: disable aggregate secret, then destroy it only after
  operator confirmation; remove compatibility parsing after the window.
- No retirement of website scraping or existing client method contracts.

## Execution Readiness View

- Intent Lock: safe admin key lifecycle and truthful per-key quota visibility.
- Scope Fence: Kinopoisk enabled first; TMDB/Spotify adapters remain disabled;
  no deployment or production secret mutation.
- Baseline Lock: preserve the approved Secret Proxy plan and current admin auth,
  Firestore usage, retry, and circuit-breaker contracts.
- Approved Behavior: list, add, test, enable, disable, revoke, purpose labels,
  masked values, quota source, and explicit failure states.
- Owner/Contract Constraints: one server credential boundary, one proxy
  transport, no client secrets, no per-request Firestore telemetry writes.
- Compatibility Boundary: all existing client methods and proxy error codes.
- Retirement Boundary: aggregate secret is migration-only until verified cutover.
- Task Batches: shared auth/vault; runtime pool/quota; migration/rules; admin
  UI; regression/build/browser verification.
- Test Obligations: targeted security/pool/quota/UI tests plus lint, full test,
  build, scans, and browser smoke.
- Review Gates: inspect backend DTOs for secret leakage, verify rule ownership,
  review migration dry-run, then run full verification.
- Drift/Rewind Rules: stop if a client fallback, raw Firestore credential,
  guessed quota, or duplicate proxy appears; rewind the affected slice.
- Evidence Required Before Completion: fresh command output, safe response
  fixtures, browser evidence, and explicit note that production deployment was
  not performed.
- Advisory Boundary: this readiness view guides execution and is not runtime
  authority.

## Plan Pressure Test

- Owner/contract/retirement: explicit and aligned with the existing proxy plan.
- Architecture integrity: shared auth and runtime pool prevent duplicate
  credential owners.
- Verification scope: covers security, provider behavior, persistence, UI, and
  compatibility.
- Task executability: each task names files, commands, and expected evidence.
- Pressure result: `proceed`.

## Execution Route

- Decision: `inline`.
- Evidence: tasks share the same backend contracts and the worktree already
  contains unrelated dirty changes that require a single coordinator to avoid
  overlap.
- Fallback: split into verified inline slices with checkpoints if one slice
  exceeds the safe review boundary.
- User confirmation required: `no`; the user approved the design and asked to
  proceed. Production deployment and secret mutations remain outside scope.
