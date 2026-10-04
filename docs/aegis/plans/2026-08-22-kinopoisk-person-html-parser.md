# Goal

Replace the 40-item Kinopoisk API matching burst on TMDB person pages with
Kinopoisk HTML person-page parsing.

Status: Implemented and verified on the supplied Tom Hanks HTML (`/name/9144/`).

# Architecture

`PersonDetailsService` remains the canonical DTO owner. A new
`KinopoiskPersonHtmlService` owns Kinopoisk search/page fetching and parsing.
For a TMDB person cache miss, the flow is TMDB person data -> Kinopoisk HTML
person lookup -> in-memory title/year merge -> DTO cache. Existing API mapping
remains the fallback when HTML parsing cannot produce usable filmography data.

# Tech Stack

Vanilla JavaScript classic services, browser `fetch`, `DOMParser`, Chrome
extension storage, and the existing CommonJS-compatible test harness.

# Baseline / Authority Refs

- `src/shared/services/AwardsParsingService.js` — existing HTML fetch/parser pattern
- `src/shared/services/PersonDetailsService.js` — canonical person DTO and fallback owner
- `src/shared/services/IdMappingService.js` — current 40-candidate API path to bypass
- User-provided Kinopoisk HTML — `window.Ya.__ssr_initial_data.apolloState`

# Compatibility Boundary

- Keep the current person DTO shape and rendering contract.
- Do not remove the existing API mapping fallback.
- Do not change Home fetching, key rotation, or circuit-breaker semantics.
- HTML parsing must run only on person-detail cache misses.

# TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not requested
- Test posture: post-change regression plus parser fixture tests
- Reason: the user requested implementation, not strict test-first development.
- Verification: focused parser tests, person-detail tests, lint, and full test suite.

# Files

- Create `src/shared/services/KinopoiskPersonHtmlService.js`.
- Modify `src/pages/person-details/person-details.html` to load the service.
- Modify `src/shared/services/PersonDetailsService.js` to use HTML mapping first.
- Create `tests/kinopoiskPersonHtmlParser.test.js`.
- Update `README.md` changelog after verification.

# Tasks

1. Implement SSR-state extraction, person search, person-page fetching, role
   normalization, and filmography extraction with request diagnostics.
2. Merge parsed KP records with TMDB credits by normalized title and year;
   bypass `IdMappingService.resolveBatch` only when the HTML result is usable.
3. Add the script dependency and fixture tests for person `9144`-shaped data.
4. Run focused and full verification and record the runtime reload instructions.

# Risks and Retirement

- Kinopoisk may return an anti-bot or changed page; the existing API path stays
  active as fallback.
- The initial SSR payload may contain the default role slice rather than every
  role; TMDB remains the role/category source during the in-memory merge.
- The old 40-item mapping path is retained until runtime confirms HTML parsing
  produces sufficient matches, then can be considered for later retirement.

# Verification

- `node tests/kinopoiskPersonHtmlParser.test.js`
- `node tests/personDetailsData.test.js`
- `node tests/personDetailsUI.test.js`
- `npm run lint`
- `npm test`
