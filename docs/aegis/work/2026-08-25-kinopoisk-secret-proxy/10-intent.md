# Task Intent — Kinopoisk Secret Proxy

## Requested outcome

Move Kinopoisk API credentials out of the Chrome extension and build artifacts;
serve API requests through an authenticated Firebase Function backed by Secret
Manager.

## Scope

- Existing Firebase Functions backend and Kinopoisk client transports.
- Background search transport, client configuration, manifest permissions.
- Regression tests, README changelog, and agent context.

## Non-goals

- No Firebase deployment.
- No secret creation/update command.
- No revocation of previously exposed keys.
- No changes to Kinopoisk website scraping.

## Baseline refs

- `docs/aegis/plans/2026-08-25-kinopoisk-secret-proxy.md`
- `.agents/rules/agent.md`
- `functions/index.js`
- `src/shared/config/kinopoisk.config.js`
- `src/shared/services/KinopoiskService.js`
- `src/background/background.js`
- `manifest.json`
- `tests/kinopoiskQuotaCircuitBreaker.test.cjs`

## Impact statement

The public network boundary changes from direct Kinopoisk API calls with client
keys to an authenticated Firebase proxy. Existing service method contracts and
website scraping remain compatible; unauthenticated API use becomes an explicit
`AUTH_REQUIRED` failure.

## Execution readiness view

- Intent lock: no Kinopoisk API key in client source or build output.
- Scope fence: modify existing proxy/function and existing transport owners;
  do not change scraping or unrelated ratings/cache behavior.
- Compatibility boundary: preserve KinopoiskService public methods and response
  normalization; proxy only the `/v1.4` API surface.
- Retirement boundary: direct API keys/host permissions are removed only after
  proxy transport is in place; old external keys remain an operator follow-up.
- Test obligations: auth, allowlist, secret parsing, key rotation, bounded
  retry, client transport, build secret scan.
- Review gates: lint, unit tests, build, diff check, source/dist scans.
- Drift rule: pause if implementation adds a second credential owner or a
  direct API fallback.

## Baseline usage

- Required refs acknowledged: all listed baseline refs were inspected in the
  current worktree before editing.
- Missing refs: none known.
- Decision: continue with approved plan.
