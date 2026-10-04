# Task Intent — API Key Management

## Requested outcome

Implement the approved API-key management design for the admin panel, with
Kinopoisk as the first enabled provider. Store raw values only in Secret
Manager, keep Firestore metadata non-secret, and show provider quota only when
it has a truthful source.

## Scope

- Existing Firebase Functions admin/auth/proxy owners.
- Secret Manager lifecycle and per-key runtime selection.
- Firestore metadata/audit rules.
- AdminService and admin page UI.
- Migration utility, regression tests, build, and documentation.

## Non-goals

- No Firebase deployment or production Secret Manager mutation.
- No automatic rotation/revocation of live credentials.
- No Spotify enablement before its client secret is migrated and rotated.
- No TMDB/Spotify numeric quota claims without provider adapters.
- No changes to Kinopoisk website scraping or existing client method contracts.

## Baseline refs

- `docs/aegis/specs/2026-08-26-api-key-management-design.md`
- `docs/aegis/plans/2026-08-26-api-key-management.md`
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

## Impact statement

The server gains a credential lifecycle contract and the Kinopoisk proxy gains
identified key selection. The extension gains an admin-only management pane.
The public Kinopoisk transport, existing error codes, Firestore usage metrics,
and scraping paths remain compatible.

## Execution readiness

- Intent lock: safe key lifecycle and truthful quota visibility.
- Scope fence: Kinopoisk first; no deployment or production secret mutation.
- Baseline lock: preserve the approved Secret Proxy and current admin auth.
- Compatibility boundary: existing client methods, proxy allowlist/retries,
  circuit breaker, and Firestore usage semantics.
- Retirement boundary: aggregate key secret is migration input only until
  verified cutover.
- Test obligations: backend security, vault, pool, quota, rules, UI, lint,
  regression, build, scans, and browser smoke.
- Review gates: inspect safe DTOs, rules, migration dry-run, and final evidence.
- Drift rule: stop on client fallback, raw Firestore secret, guessed quota, or
  duplicate provider transport.

## TaskStartSnapshot

- Root: `D:/Programing/JS/Projects/MovieListExstension`
- Branch: `master`
- HEAD: `bccc5a466646a16cd5ed3c90d506e739f2f8dc12`
- Worktree: single checkout at project root.
- Pre-existing state: many tracked source, UI, function, test, and docs files
  were already modified; all are preserved and only plan-owned paths are edited.
- Active Git operations: none observed.
