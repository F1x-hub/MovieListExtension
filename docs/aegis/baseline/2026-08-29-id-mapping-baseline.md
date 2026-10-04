# Baseline — shared identity mappings

Date: 2026-08-29

- `IdMappingService` owns TMDB→Kinopoisk identity resolution. Its mapping cache and
  manual mappings currently persist only in `chrome.storage.local`.
- `TmdbFallbackQueueService` already uses Firestore for the distinct Kinopoisk→IMDb
  queue (`tmdbFallbackQueue`) and confirmed IMDb mappings (`tmdbMovieMappings`).
- Firestore rules make confirmed IMDb mappings readable to authenticated users and
  admin-writable. The identity-mapping equivalent does not yet exist.
- The canonical forward key is `${mediaType}:${tmdbId}`; the existing in-memory
  reverse index is derived from a forward mapping and must not become a second cloud owner.
