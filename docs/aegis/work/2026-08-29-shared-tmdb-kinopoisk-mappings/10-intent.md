# Task intent — shared TMDB–Kinopoisk mappings

Requested outcome: verified manual TMDB→Kinopoisk links made by an admin are reusable by
every authenticated extension user.

Scope: Firestore contract, `IdMappingService` canonical write/read path, admin migration,
and tests. Non-goals: guest access, changes to the Kinopoisk→IMDb collections, provider
heuristics, or deletion of live Firestore data.

Baseline refs: `CONTEXT.md`, `docs/aegis/baseline/2026-08-29-id-mapping-baseline.md`,
`IdMappingService.js`, Firestore rules/indexes, and the active plan.

Impact: persistence and permission boundary. Firestore is the manual-mapping source of truth;
`chrome.storage.local` is derived cache only. Existing local records will be published only by
an explicit admin action and never deleted automatically.
