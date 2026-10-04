# TMDB provider baseline

- `tmdbProxy` currently reads the deployment secret `TMDB_API_TOKEN` directly.
- Provider-key management supports only `kinopoisk`; the registry and runtime pool
  already support provider-scoped records.
- TMDB documents a Bearer API Read Access Token and `GET /3/authentication` for
  token validation. It does not publish a daily remaining-request value.
- Existing Kinopoisk registry rows and quota data are production state and are out
  of scope for this migration.
