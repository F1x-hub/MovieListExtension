# Phase 7 — Universal Season / Episode Selection

## Requested outcome

Make host season/episode controls capability-driven across registered playback
providers, with exact selection only for providers proven to translate canonical
S/E into playable targets.

## Scope

- Audit current adapter/parser behavior for Seasonvar, VidSrc, KinoGo, Ex-FS,
  and Rutube.
- Remove provider-ID decisions from MovieDetails player UI behavior.
- Add granular adapter capability methods for navigation and AutoNext.
- Preserve canonical PlaybackSelection across provider changes and stale preload.
- Add regression coverage and run test, lint, and build verification.

## Non-goals

- No cross-origin iframe DOM scraping.
- No heuristic Rutube episode matching.
- No upgrade of KinoGo, Ex-FS, or Rutube without deterministic runtime evidence.
- No edits to `dist/` or unrelated pre-existing worktree changes.

## Baseline read set

- `.agents/rules/agent.md`
- User Phase 7 brief
- `BasePlaybackAdapter` and all registered playback adapters
- Seasonvar, KinoGo, Ex-FS, and Rutube parsers
- `PlaybackSelection`, `PlaybackRuntime`, `AutoNextCoordinator`
- MovieDetails player controls and existing player regression tests
- `package.json` scripts and version 1.2.7

## Change necessity

User-visible host controls currently contain provider-ID fallback logic and
navigation is shown for providers that cannot execute it. A code change is
necessary to make capabilities authoritative; the minimum boundary is the
adapter contract plus MovieDetails control gating and focused tests.

## Initial capability evidence

| Provider | Classification | Evidence |
|---|---|---|
| Seasonvar | DIRECT_HOST_CONTROL | Structured season/episode playlists and native video switching |
| VidSrc | DIRECT_HOST_CONTROL | Deterministic `/embed/tv?imdb=...&season=...&episode=...` URL |
| KinoGo | PROVIDER_NATIVE_ONLY | Parser returns balancer iframe sources; no host S/E target translation |
| Ex-FS | PROVIDER_NATIVE_ONLY | Parser extracts Full HD iframe/video sources; no host S/E catalog |
| Rutube | SINGLE_VIDEO_ONLY | Title search plus one HLS/iframe result; no deterministic series S/E resolution |

## Verification boundary

Fresh evidence must cover adapter capabilities, UI gating, canonical selection
preservation, stale preload protection, test suite, lint, and build. Browser
runtime claims remain bounded to source-level and automated evidence unless a
provider is exercised in a live browser.
