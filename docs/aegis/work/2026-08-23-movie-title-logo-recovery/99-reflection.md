# Reflection — movie title logo recovery

The implementation stayed inside the existing provider and cache seams. The
main risk was stale negative mapping state, so reverse recovery now fingerprints
the KP metadata used for a retry and avoids repeated failed searches. Logo
selection remains deterministic and provider URLs remain constrained to TMDB's
CDN path. The only unresolved verification item is the unrelated full-suite
offscreen scraper fixture failure.

The follow-up reproductions exposed two canonical-owner defects rather than missing
provider artwork: KP normalization dropped `isSeries` for anime series, and metadata
recovery unioned candidates from localized and alternate title searches. The repair
preserves series fields and requires non-empty exact-title result sets to converge on
one candidate, while retaining rejection for disjoint or ambiguous evidence.

The user-facing screenshot then exposed a separate cache-layer gap: a speculative
localStorage DTO bypassed the provider repair because it carried the old selector
version and `logoChecked=true` with an empty URL. A schema bump to version 3 closes
that path without adding an ID-specific exception or causing repeated refreshes.

The remaining cache blocker was an old fresh negative reverse entry. Versioning
the metadata-recovery algorithm lets corrected logic retry that entry once, then
stores the new version so valid unresolved titles retain bounded negative caching.
