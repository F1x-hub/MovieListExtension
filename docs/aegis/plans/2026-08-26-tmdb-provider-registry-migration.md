# TMDB provider registry migration — implementation plan

## Goal

Add TMDB to the existing server-side provider-key registry, migrate the legacy
`TMDB_API_TOKEN` without revealing it, and make `tmdbProxy` use active registry
keys. Preserve the old deployment secret during the rollback window.

## Architecture

- Secret Manager remains the only raw-token owner.
- `systemApiKeys` continues to hold safe metadata; `systemApiKeyAuditLogs` holds
  immutable, non-secret migration events.
- `providerQuotaAdapters` owns TMDB validation and truthful quota semantics.
- `providerKeyPool` is reused with `provider: "tmdb"`; it owns active-key loading
  and temporary 401/429 rejection handling.
- `tmdbProxy` remains the only extension transport and retains its CORS and `/3/`
  allowlist boundary.
- The admin page shows quota by provider: Kinopoisk's daily total is separate from
  TMDB's rate-limit status, so `548 / 600` is never presented as a TMDB quota.

## Tech stack

Firebase Functions v2, Firebase Admin/Firestore, Google Secret Manager, vanilla
JavaScript admin UI, Node contract tests, ESLint, and the existing extension build.

## Baseline / authority refs

- Approved user decision in this conversation: full TMDB registry migration.
- `docs/aegis/specs/2026-08-26-api-key-management-design.md`
- `docs/aegis/plans/2026-08-26-api-key-management.md`
- `docs/aegis/baseline/2026-08-26-tmdb-provider-baseline.md`
- `functions/index.js`, `functions/providerKeyManagement.js`,
  `functions/providerKeyPool.js`, `functions/providerQuotaAdapters.js`
- `src/pages/admin/admin.html`, `src/pages/admin/admin.js`,
  `src/shared/styles/admin.css`
- [TMDB application authentication](https://developer.themoviedb.org/docs/authentication-application)
- [TMDB key validation](https://developer.themoviedb.org/reference/authentication-validate-key)
- [TMDB rate limiting](https://developer.themoviedb.org/docs/rate-limiting)

## Compatibility boundary

- Keep the public `tmdbProxy` function name, GET-only contract, CORS policy, URL
  validation, and upstream response relay unchanged.
- Never put a TMDB token in Firestore, the client, logs, responses, DOM, or tests.
- Keep the legacy `TMDB_API_TOKEN` intact until the imported key, deployed proxy,
  and an authenticated smoke request are verified.
- Do not alter Kinopoisk key records, quota calculations, or proxy behavior.

## TDD route

- Mode: off
- Decision: skipped
- Strict authority: none; the user did not request strict TDD.
- Test posture: focused mocked contract tests before regression/build checks.
- Reason: the project uses Node contract tests; security boundaries need direct
  no-secret-leak and fallback tests rather than a prescribed RED/GREEN cycle.
- Verification: targeted provider/migration/proxy/UI contracts, lint, build, and
  `git diff --check`.

## Requirement ready check

- Requirement source refs: user request and approved migration design.
- Scenario: admin manages TMDB tokens and the existing proxy consumes them.
- Acceptance: token validates, proxy reads active registry keys, legacy token is
  imported without disclosure, and the admin dashboard has truthful TMDB quota UI.
- Open questions: none.
- Decision: ready.

## Change necessity

- User-visible need: manage the actual TMDB credential from the existing admin
  workflow while keeping it server-only.
- No-change option: retaining the deployment secret would only display a detached
  record and would not let disable/revoke/add actions control `tmdbProxy`.
- Why code is necessary: TMDB is absent from provider validation, the registry
  allowlist, and the runtime proxy pool.
- Minimum boundary: the existing provider registry/pool/adapters, `tmdbProxy`,
  migration utility, and provider-key UI summary.
- Decision: code-change.

## Existence and architecture checks

- Reuse `providerKeyManagement`, `providerKeyPool`, and `providerQuotaAdapters`;
  do not add a second TMDB credential owner or a client fallback.
- Add only a small TMDB adapter and migration script because the provider's HTTP
  authentication contract is distinct from Kinopoisk and legacy deployment secrets
  cannot be listed/managed as registry rows.
- Canonical owner is unchanged: proxy owns relay, pool owns selection, adapter owns
  validation/quota normalization, and vault owns credential values.
- Retirement: the direct `TMDB_API_TOKEN` read becomes a migration-only fallback;
  delete it only with later explicit operator confirmation.

## File map

### Modify

- `functions/providerKeyManagement.js` — permit `tmdb` as a managed provider.
- `functions/providerQuotaAdapters.js` — validate TMDB Bearer tokens through
  `GET /3/authentication`; report rate-limit-only quota as unavailable.
- `functions/tmdbProxy.js` — own the unchanged TMDB HTTP transport while taking
  its active credentials from the injected provider pool.
- `functions/index.js` — create provider-scoped pools, use the TMDB pool in
  `tmdbProxy`, and expose a server-only migration action.
- `src/pages/admin/admin.js` — render provider-separated quota summaries.
- `src/pages/admin/admin.html` — offer TMDB in the add-key dialog.
- `src/shared/styles/admin.css` — support provider summary rows/chips.
- `tests/providerKeyManagement.test.cjs`, `tests/providerKeyPool.test.cjs`,
  `tests/tmdbProxy.test.cjs`, and `tests/adminProviderKeysUIContract.test.js` —
  cover TMDB and no-secret-leak behavior.
- `package.json`, `README.md`, `.agents/rules/agent.md` — test command and living
  project documentation.

### Create

- `scripts/migrate-tmdb-secret.js` — explicit dry-run/apply migration helper that
  never prints or returns the credential.

## Tasks

### 1. Extend the provider contract

Files: `functions/providerKeyManagement.js`, `functions/providerQuotaAdapters.js`,
`tests/providerKeyManagement.test.cjs`.

Add `tmdb` to the existing supported-provider set. Add an adapter which calls
`https://api.themoviedb.org/3/authentication` with `Authorization: Bearer` and
maps 401/403 to `INVALID_CREDENTIAL`. For a valid result return a safe quota DTO
with `mode: "unavailable"`, `unit: "requests_per_second"`, and no guessed
daily counts. Test the exact header, response mapping, and that no secret occurs
in results or error paths.

Verification: `node tests/providerKeyManagement.test.cjs` exits 0.

### 2. Switch the TMDB proxy to the registry pool

Files: `functions/index.js`, `functions/tmdbProxy.js`,
`functions/providerKeyPool.js`, proxy/pool tests.

Create one cached pool per provider. Keep existing URL validation and CORS in
`tmdbProxy`, but select active TMDB keys from the pool. Retry the next key only
on 401/403/429, report sanitized outcomes to the pool, and return the current
safe 503 configuration error when no usable key exists. Do not include a raw
token in logs or response bodies.

Verification: targeted pool/proxy tests and existing Kinopoisk proxy tests exit 0.

The handler is extracted from `functions/index.js` rather than expanded in
place: the entrypoint remains wiring-only, while the existing public route and
all transport constraints stay in the TMDB handler owner.

### 3. Add explicit legacy-token migration

Files: `scripts/migrate-tmdb-secret.js`, migration tests, `functions/index.js`
only if a server-side entrypoint is required.

Implement a server/operator-only dry run and `--apply` mode. It reads the legacy
Secret Manager token only inside the server runtime, validates it with the TMDB
adapter, deduplicates by credential fingerprint, creates the per-key Secret
Manager record, and writes an audit event. The old secret remains untouched.
Reject apply unless project identity and explicit confirmation are supplied.

Verification: migration tests prove dry-run, idempotency, safe output, and no
legacy-secret deletion.

### 4. Make the admin UI provider-aware

Files: `src/pages/admin/admin.html`, `src/pages/admin/admin.js`,
`src/shared/styles/admin.css`, UI contract test.

Add TMDB to the provider select. Replace one mixed quota number with separate
provider summaries: exact Kinopoisk daily total and TMDB `Квота не публикуется`
with rate-limit guidance. Keep all key lifecycle actions and masking behavior.

Verification: `node tests/adminProviderKeysUIContract.test.js` exits 0.

### 5. Verify and document

Files: `package.json`, `README.md`, `.agents/rules/agent.md`.

Run the focused provider suite, lint, full build, syntax checks, and diff check.
Update the changelog and living project rules only with implemented behavior.
Do not deploy, delete the legacy secret, or create/modify production credentials
without a separate execution step and explicit operator confirmation.

## Risks and rollback

- TMDB has no public remaining-daily quota: show unavailable rather than inventing
  `N / N` values.
- Migration validation failure: preserve legacy proxy operation; do not switch the
  runtime owner.
- Pool cache delay after disabling a key: use existing bounded TTL and invalidation.
- Deployment rollback: restore the direct legacy-secret proxy path; the old secret
  has not been changed.

## Execution readiness

- Intent lock: TMDB becomes a first-class managed provider without exposing or
  deleting its legacy token.
- Scope fence: no Spotify work, no client token, no Kinopoisk migration changes.
- Compatibility: preserve TMDB proxy public transport and all Kinopoisk behavior.
- Evidence: targeted tests, lint/build, safe source review, and an operator-run
  migration dry-run before any production apply.
- Route: inline; backend and UI share the provider contract and the worktree has
  unrelated changes that should not be handed to parallel writers.
