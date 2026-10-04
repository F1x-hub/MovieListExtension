# Plan: Universal Season/Episode Selection Across Provider Players

## Goal

Сделать единый выбор сезона и серии для Seasonvar, KinoGo, Ex-FS и Rutube.
Пользователь выбирает `SxEy` в одном extension picker, а каждый провайдер
получает тот же canonical selection своим способом: direct URL, provider API,
внутренние DOM-контролы или контролируемый legacy bridge.

## Architecture

`MovieDetailsManager` остаётся владельцем пользовательского намерения и picker.
`PlaybackController` хранит canonical `PlaybackSelection` и активный provider.
Каждый provider adapter реализует capability и provider-specific selection
contract. Парсер владеет только discovery/extraction, а legacy content script
владеет только DOM-интеграцией внутри конкретного внешнего плеера.

Целевой поток:

```text
picker S/E
  -> PlaybackSelection { seasonNumber, episodeNumber, providerId }
  -> adapter.applySelection(selection)
  -> provider bridge/API/direct URL
  -> normalized PLAYER_SELECTION_APPLIED
  -> header, progress, navigation and picker state
```

## Tech Stack

- Chrome MV3 extension, vanilla JavaScript, classic global scripts plus shared modules.
- `MovieDetailsManager` — host UI and source lifecycle.
- `PlaybackController` — canonical selection, provider lifecycle and runtime state.
- `BasePlaybackAdapter` — provider capability contract.
- `SeasonvarParser`, `KinogoParser`, `ExFsParser`, `RutubeParser` — discovery/rendering.
- `content-scripts/player-cleaner.js` — legacy external-player DOM bridge.
- Node test scripts, ESLint, extension build via `npm run build`.

## Baseline / Authority Refs

- `.agents/rules/agent.md` — canonical project rules and MovieDetails invariants.
- `src/pages/movie-details/movie-details.js` — current picker and source lifecycle owner.
- `src/shared/services/player/PlaybackController.js` — current canonical selection owner.
- `src/shared/services/player/adapters/BasePlaybackAdapter.js` — capability boundary.
- `SeasonvarAdapter.js` — working direct/in-place Seasonvar reference implementation.
- `KinogoAdapter.js`, `ExFsAdapter.js`, `RutubeAdapter.js` — current title-only adapters.
- `content-scripts/player-cleaner.js` — legacy player selectors and postMessage bridge.
- `tests/playerEpisodeProviderRuntimeAcceptanceAudit.test.js` — current provider matrix.
- `tests/seasonvarRestoreAndPickerLifecycle.test.js` — picker lifecycle contract.
- `tests/providerSwitchSelectionPreservation.test.js` — canonical S/E preservation.

## Requirement Ready Check

- Requirement source: user request — one season/episode picker must work for all
  providers that can play the series.
- Scenario: same series, switch among Seasonvar/KinoGo/Ex-FS/Rutube, select any
  available season and episode, preserve exact `SxEy`.
- Acceptance: no provider receives a stale season/episode; provider-native
  selection is used where direct URLs are unavailable; unsupported/unavailable
  states are explicit and do not show a false success.
- Open provider detail: exact DOM/API controls differ by live mirror and must be
  discovered from provider parser/bridge evidence before implementation.
- Decision: ready for architecture and diagnostic implementation; provider
  bridge selectors remain a task-level discovery input, not a hidden assumption.

## TDD Route

- Mode: off.
- Decision: light post-change regression; strict RED/GREEN is not required by the user.
- Test posture: diagnostic fixtures first, then provider contract and runtime regression.
- Reason: providers have different external controls; tests must encode observed
  contracts rather than invent a strict unit-only implementation.
- Verification: focused Node tests, full `npm test`, `npm run lint`, `npm run build`,
  and authenticated browser smoke checks.

## Compatibility Boundary

- Preserve the existing `PlaybackSelection` shape and source values.
- Preserve Seasonvar direct selection behavior and current native video player.
- Preserve title-only movie playback for all providers.
- Never make KinoGo/Ex-FS/Rutube claim direct S/E support without a verified
  provider-specific capability and successful post-action acknowledgement.
- Legacy providers may use a bridge, but the bridge cannot become a second
  canonical selection owner.
- If a provider cannot expose a requested episode, show unavailable/error state;
  do not silently fall back to S1E1, another provider, or another media type.

## Change Necessity

- User-visible need: all three legacy providers can play series, but the shared
  picker currently only controls Seasonvar/VidSrc; other providers show stale,
  wrong, or non-functional episode behavior.
- No-change option: documentation alone cannot synchronize external provider
  controls or prevent wrong title/episode mounts.
- Minimum code boundary: adapter contract, provider adapters, one legacy bridge
  protocol, MovieDetails source/picker integration, parser result validation,
  and provider contract tests.
- Decision: code-change, split into diagnostic, contract, provider, and retirement
  slices.

## Architecture Integrity Lens

- Invariant: one canonical `PlaybackSelection`; one active provider; one provider
  action path; one acknowledgement path.
- Canonical owner: `PlaybackController` owns intent; provider adapter owns how
  intent is applied; `MovieDetailsManager` owns presentation only.
- Current overlap: `MovieDetailsManager`, parser custom renderers, adapters and
  `player-cleaner.js` can each infer S/E independently.
- Higher-level simplification: replace provider-ID branches and generic
  `PLAYER_PROVIDER_PICKER` assumptions with `applySelection()` plus an explicit
  result contract.
- Retirement trigger: remove legacy direct-provider fallbacks only after all
  provider contract tests and browser smoke cases pass for two consecutive builds.
- Verdict: proceed with adapter/bridge contract; do not add another picker or
  another global S/E state object.

## Existence Check

- Proposed new surface: provider selection acknowledgement and legacy bridge
  message contract.
- Existing candidate: `PlaybackController` lifecycle callbacks and
  `player-cleaner.js` postMessage path.
- Why insufficient: current messages report progress/player state but do not
  carry provider-scoped requested/applied S/E identity or acknowledgement.
- Creation proof: add the smallest provider-scoped message contract to the
  existing bridge; do not create a new global service or new picker.
- Decision: add-with-proof, with retirement of ad-hoc provider message handling
  after migration.

## Plan-Time Complexity Check

- High-pressure file: `src/pages/movie-details/movie-details.js` is already a
  large lifecycle/UI owner; avoid adding more provider-specific branches there.
- Safer boundary: put provider behavior in adapters and bridge helpers; keep the
  manager limited to selection dispatch, UI state and acknowledgement handling.
- `player-cleaner.js` is also high-risk legacy code; add one versioned bridge
  contract and provider-specific handlers, not scattered selector checks.
- Recommendation: edit existing owners in separate slices; defer unrelated
  refactoring until universal selection is verified.

## Implementation Tasks

### Task 1 — Capture provider capability and runtime baseline

Files:

- `src/shared/services/player/adapters/BasePlaybackAdapter.js`
- `src/shared/services/player/adapters/KinogoAdapter.js`
- `src/shared/services/player/adapters/ExFsAdapter.js`
- `src/shared/services/player/adapters/RutubeAdapter.js`
- `tests/playerEpisodeProviderRuntimeAcceptanceAudit.test.js`
- `tests/playerPhase7CapabilityContract.test.js`

Actions:

1. Record current capabilities for each provider: direct S/E, internal picker,
   bridge requirement, progress confidence and source type.
2. Add a neutral capability field such as `selectionMode` with values
   `DIRECT`, `NATIVE_BRIDGE`, `OPAQUE`, or `UNAVAILABLE`; keep existing boolean
   methods as compatibility aliases during migration.
3. Define `canApplySelection(selection)` separately from `canHandle(selection)`.
4. Add matrix tests proving the current baseline and preventing false direct
   support declarations.

Verification:

```text
node tests/playerPhase7CapabilityContract.test.js
node tests/playerEpisodeProviderRuntimeAcceptanceAudit.test.js
```

### Task 2 — Normalize provider discovery and media identity

Files:

- `src/shared/services/parsers/BaseParserService.js`
- `src/shared/services/parsers/KinogoParser.js`
- `src/shared/services/parsers/ExFsParser.js`
- `src/shared/services/parsers/RutubeParser.js`
- `src/pages/movie-details/movie-details.js`
- provider parser tests under `tests/`

Actions:

1. Pass media type/context into cached search without breaking existing callers.
2. Require search results to declare or prove `movie` vs `series`.
3. Reject KinoGo film URLs for series requests, as already observed with
   `/films/134-dzhek-richer.html`.
4. Normalize provider result metadata to `{ providerId, mediaType, title, url,
   seasonNumber, episodeNumber, sourceKind }`.
5. Never use a title-only result for direct S/E selection unless its result
   metadata explicitly identifies the requested series.

Verification:

```text
node tests/playerPhase7CapabilityContract.test.js
node tests/playerEpisodePickerProviderUnification.test.js
npm run lint
```

### Task 3 — Define the universal provider selection contract

Files:

- `src/shared/services/player/adapters/BasePlaybackAdapter.js`
- `src/shared/services/player/PlaybackController.js`
- `src/shared/services/player/PlaybackSelection.js`
- new focused test file: `tests/providerSelectionContract.test.js`

Actions:

1. Add `applySelection(selection, context)` to the base contract with a typed
   result: `{ status, providerId, selection, appliedSelection, reason }`.
2. Define statuses `APPLIED`, `PENDING_NATIVE_UI`, `UNAVAILABLE`, `FAILED`.
3. Require providers to return the applied S/E, not merely `true`.
4. Make `PlaybackController` preserve canonical intent until an acknowledgement
   arrives; do not silently rewrite to provider defaults.
5. Add request/generation guards so a late provider response cannot overwrite a
   newer S/E or provider.

Verification:

```text
node tests/providerSelectionContract.test.js
node tests/providerSwitchSelectionPreservation.test.js
```

### Task 4 — Implement provider-specific selection strategies

Files:

- `src/shared/services/player/adapters/SeasonvarAdapter.js`
- `src/shared/services/player/adapters/KinogoAdapter.js`
- `src/shared/services/player/adapters/ExFsAdapter.js`
- `src/shared/services/player/adapters/RutubeAdapter.js`
- `src/shared/services/parsers/KinogoParser.js`
- `src/shared/services/parsers/ExFsParser.js`
- `src/shared/services/parsers/RutubeParser.js`

Actions:

1. Keep Seasonvar direct URL/in-place selection as the reference implementation.
2. Determine for each provider whether the page exposes:
   - season/episode DOM controls;
   - a stable iframe/player postMessage API;
   - a playlist/video URL containing S/E;
   - a provider endpoint that can return the requested episode.
3. Implement only the verified strategy:
   - direct source replacement when URL/playlist is reliable;
   - native bridge action when DOM/API controls are stable;
   - `PENDING_NATIVE_UI` when the external player must be used manually;
   - `UNAVAILABLE` when the requested S/E cannot be proven.
4. Do not reuse Seasonvar source URLs or TMDB episode counts for other providers.
5. For KinoGo, ensure series search resolves a series page before attempting
   provider episode selection.

Verification:

```text
node tests/providerSelectionContract.test.js
node tests/playerEpisodeProviderRuntimeAcceptanceAudit.test.js
```

### Task 5 — Build one versioned legacy bridge

Files:

- `content-scripts/player-cleaner.js`
- `src/pages/movie-details/movie-details.js`
- new shared contract test under `tests/legacyProviderBridgeContract.test.js`

Actions:

1. Add a versioned message envelope with `requestId`, `providerId`,
   `selection`, `action`, and `origin`.
2. Support `REQUEST_SELECTION`, `SELECTION_APPLIED`, `SELECTION_UNAVAILABLE`,
   and `PLAYER_READY` only through the existing message path.
3. Require the bridge to acknowledge the actual detected S/E when possible.
4. Validate source window, active iframe, request ID and provider ID before
   accepting a response.
5. Keep provider-specific selectors isolated behind adapter/bridge handlers;
   no selector logic in the picker or canonical controller.

Verification:

```text
node tests/legacyProviderBridgeContract.test.js
node tests/playerCleanerDecoupling.test.js
```

### Task 6 — Integrate the picker with the universal contract

Files:

- `src/pages/movie-details/movie-details.js`
- `src/shared/services/player/PlaybackController.js`
- `tests/seasonvarRestoreAndPickerLifecycle.test.js`
- `tests/providerSelectionContract.test.js`

Actions:

1. Picker emits one canonical selection only.
2. Picker reads available seasons/episodes from the active provider contract;
   Seasonvar URLs remain authoritative when present.
3. On `PENDING_NATIVE_UI`, show provider-specific guidance and keep canonical
   S/E visible without pretending the host applied it.
4. On `APPLIED`, update header, picker active state, progress identity and
   Prev/Next from the acknowledged selection.
5. On failure, preserve the previous player and show retry/unavailable state.
6. Remove remaining provider-ID branches that duplicate adapter behavior after
   the contract path is proven.

Verification:

```text
node tests/seasonvarRestoreAndPickerLifecycle.test.js
node tests/providerSwitchSelectionPreservation.test.js
node tests/playerEpisodeProviderRuntimeAcceptanceAudit.test.js
```

### Task 7 — Browser verification and retirement of legacy fallbacks

Files:

- `tests/` provider smoke fixtures and audit scripts
- `README.md`
- `.agents/rules/agent.md` only if a new stable convention is established

Actions:

1. Run authenticated browser scenarios for the same series:
   - Seasonvar: S3E3 → S4E2;
   - KinoGo: series page, not `/films/...`;
   - Ex-FS: S4 dropdown then E2;
   - Rutube: provider season/episode control or explicit unavailable result.
2. Capture `[SeasonPickerTrace]` and provider bridge acknowledgements.
3. Verify no source changes to another provider, no S1E1 fallback, no stale
   episode count, and no foreign movie result.
4. Run the full suite, lint and build.
5. Remove old provider-specific fallback branches only after the matrix passes;
   document any provider that remains `PENDING_NATIVE_UI` with its exact reason.

Verification:

```text
npm test
npm run lint
npm run build
```

## Repair Track

- Root cause: multiple owners infer S/E independently; title-only providers lack
  an acknowledged selection contract; TMDB and provider lists can be mixed.
- Minimal stable repair: canonical selection in `PlaybackController`, provider
  strategy in adapters, one legacy bridge acknowledgement, provider-owned
  episode metadata.
- Compatibility: retain current Seasonvar path and old messages during migration;
  gate removal on runtime matrix evidence.

## Retirement Track

- Retire generic `supportsProviderInternalSelection` guidance once a provider has
  a verified bridge acknowledgement, replacing it with explicit `selectionMode`.
- Retire direct provider-ID branches in `MovieDetailsManager` after adapter
  contract coverage passes.
- Retire TMDB episode-count fallback for an active provider that exposes season
  URLs; retain it only for provider discovery with no provider metadata.
- Keep legacy bridge compatibility while external content scripts are deployed;
  remove old message forms only after versioned bridge adoption is verified.

## Risks and Mitigations

- Provider markup/API changes: detect and return `UNAVAILABLE`, never guess S/E.
- Cross-origin iframe limits: use postMessage only with verified origin/source;
  otherwise use `PENDING_NATIVE_UI`.
- Duplicate async mounts: keep request IDs and active-provider guards.
- Wrong media identity: validate URL path/result type before source mounting.
- Scope growth: do not redesign progress storage, source search UI, or all parser
  rendering until the selection contract is stable.

## Acceptance Criteria

1. One picker can request the same canonical S/E for every provider.
2. Seasonvar applies direct selection and remains regression-free.
3. KinoGo never launches the 2012 film for the TV-series request.
4. Ex-FS and Rutube either apply the requested S/E through verified native
   controls or clearly report `PENDING_NATIVE_UI`/`UNAVAILABLE`; they never claim
   success while showing S1E1 or stale content.
5. Header, picker, progress and navigation use the acknowledged provider S/E.
6. No provider switch, stale async response, or TMDB fallback overwrites explicit
   user intent.
7. `npm test`, `npm run lint`, and `npm run build` pass.

## Execution Readiness View

- Intent Lock: universal picker request with one canonical S/E.
- Scope Fence: provider selection only; no redesign of provider sites or progress schema.
- Baseline Lock: current Phase 7 controller/adapter/picker contracts and tests.
- Approved Behavior: direct, native-bridge, pending-native, or unavailable per provider.
- Owner Constraints: controller owns intent; adapters own provider behavior; bridge owns external DOM.
- Compatibility Boundary: Seasonvar and existing legacy messages remain functional during migration.
- Retirement Boundary: remove fallbacks only after authenticated provider matrix passes.
- Task Batches: baseline → contract → provider strategies → bridge → picker → browser retirement.
- Test Obligations: focused contracts, existing picker/provider audits, full suite, lint, build, browser smoke.
- Review Gates: after contract, after provider matrix, before fallback retirement.
- Drift Rules: if provider markup changes, stop at that provider and mark unavailable;
  do not broaden generic fallbacks.
- Evidence Required: logs with requested/applied S/E, provider ID, source URL kind,
  and final runtime identity for each provider.
- Advisory Boundary: this plan is an implementation handoff, not completion authority.

## Execution Route

- Decision: inline.
- Evidence: changes share the existing MovieDetails/player owners; provider work is
  sequential because the universal contract must be defined before bridges.
- Fallback: split Task 4 by provider only after the contract is stable.
- User confirmation required: no for plan creation; implementation should begin
  only when the user requests execution of this plan.
