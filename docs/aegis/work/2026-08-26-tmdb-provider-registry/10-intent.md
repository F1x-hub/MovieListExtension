# Task intent — TMDB provider registry

## Outcome

Move TMDB into the existing managed provider registry so admins manage the
credential that `tmdbProxy` actually uses, without exposing or deleting the
legacy deployment secret.

## Scope and non-goals

- In scope: TMDB adapter, provider-scoped runtime pool, proxy cutover, safe
  migration utility, and provider-aware admin quota presentation.
- Out of scope: Spotify, direct client authentication, Kinopoisk behavior,
  automatic production migration, and legacy-secret deletion.

## Baseline usage

- Required and acknowledged: TMDB proxy in `functions/index.js`, registry/pool/
  adapter owners, the approved provider-key design/plan, and official TMDB
  authentication/rate-limit documentation.
- Missing refs: none.
- Decision: continue.

## Impact and execution readiness

- Intent lock: one server-side TMDB credential boundary.
- Scope fence: preserve TMDB public proxy API and separate TMDB rate limiting
  from Kinopoisk's daily total.
- Retirement: direct `TMDB_API_TOKEN` read is migration-only after cutover;
  deletion needs later explicit operator approval.
- Evidence required: focused contract tests, lint/build, source inspection, and
  a future operator-run migration dry run before production apply.
