# Evidence bundle

- `npm run test:provider-keys` — exit 0; covers adapter, provider pool, TMDB
  relay, migration utility, admin UI, and Kinopoisk compatibility contracts.
- `npm run lint` — exit 0.
- `npm run build` — exit 0.
- `npm test` — exit 0.
- Firebase deploy — `providerKeysAdmin` and `tmdbProxy` updated successfully in
  `us-central1`.
- TMDB migration dry run and apply — one token imported with a safe fingerprint
  and mask; no raw token output and no legacy secret deletion.
- Live proxy smoke — HTTP 200, allowed Chrome-extension CORS origin, and safe
  `/3/authentication` response shape.

## Residual risk

The legacy `TMDB_API_TOKEN` remains as an intentional rollback bridge. It must
not be deleted until an explicit operator-approved retirement window.
