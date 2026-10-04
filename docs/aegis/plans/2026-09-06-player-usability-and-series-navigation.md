# Plan: Player Subtitle Appearance and Series Navigation

## Goal

Fix the player controls reported by the user: keep subtitles clear of the lower
edge and controls, provide persistent subtitle appearance settings, center the
primary play action, and restore previous/next episode actions for series.

## Architecture

`MovieDetailsManager` and `PlaybackController` remain the only owners of
canonical series navigation. `player-cleaner.js` may request a direction from
its embedded controls, but never selects an episode itself. Subtitle formatting
is a local user preference shared through `chrome.storage.local`; the player
applies it to supported native/HLS text tracks without synchronizing it to watch
rooms or altering subtitle track selection.

## Baseline / Authority Refs

- User request and the three supplied player screenshots.
- `CONTEXT.md` — Obsidian-Zinc visual language and theme parity.
- `.agents/rules/agent.md` — explicit PlaybackSelection and episode-picker
  ownership constraints.
- `docs/aegis/plans/2026-08-21-universal-series-selection-all-providers.md` —
  canonical provider selection plan.
- `docs/aegis/work/2026-08-21-universal-player-phase7/20-checkpoint.md` —
  current canonical-picker bridge behavior.

## Compatibility Boundary

- Keep `PlaybackController` as the sole owner of selected season/episode and
  progress persistence.
- Do not revive the legacy embedded picker as a second navigation owner.
- Preserve individual subtitle track selection and all existing HLS behavior.
- Subtitle appearance is local only and does not change watch-room state.
- Keep the existing monochrome player chrome; subtitle text remains content,
  with color limited to the user-selected caption itself.

## TDD Route

- Mode: off.
- Decision: skipped.
- Strict authority: not applicable; the user did not request test-first work.
- Test posture: focused post-change regression plus visual/manual player checks.
- Verification: player contracts, MovieDetails navigation tests, lint, build,
  and an unpacked-extension player smoke test.

## Change Necessity

- User-visible need: captions overlap the unsafe lower visual area, their
  appearance cannot be adjusted, and series navigation buttons do not reliably
  change the active episode.
- No-change option: configuration or documentation cannot repair the broken
  message path or reposition native caption rendering.
- Minimum boundary: player cleaner, the host navigation bridge, settings UI,
  focused tests, and release notes.
- Decision: code-change.

## Tasks

### 1. Restore one navigation path

Files: `content-scripts/player-cleaner.js`,
`src/pages/movie-details/movie-details.js`, focused navigation tests.

Route both host and embedded previous/next actions through
`MovieDetailsManager.handlePlayerNavigate()`. Validate direction and active
player origin, serialize repeated clicks, preserve progress flushing, and never
mark a new episode active until the canonical selection succeeds.

### 2. Add subtitle appearance preferences

Files: `src/pages/settings/settings.html`, `settings.css`, `settings.js`,
`content-scripts/player-cleaner.js`, focused player/settings tests.

Persist `movieExtensionSubtitleAppearanceV1` as a normalized local preference:
font size, text color, top/bottom placement, safe-area offset, background
opacity, and shadow. Apply defaults immediately to active supported captions,
including a minimum bottom safe area when controls are visible. Expose these
controls directly inside the player `Субтитры` submenu next to track selection,
with a live preview and an explicit reset action; the general settings page may
remain as a fallback editor for the same local preference.

### 3. Correct central action geometry

Files: `content-scripts/player-cleaner.js`, `src/shared/styles/player.css`,
focused visual contract test.

Keep the button box mathematically centered in the video surface, isolate any
optical correction to the play glyph, and ensure pause/hover states retain the
same center.

### 4. Verify and document

Run focused contracts, related player regressions, lint and build. Verify on a
series with first/middle/last episode boundaries, a subtitle track with controls
shown and hidden, and normal/fullscreen player layouts. Update project context
only for durable conventions and add the actual change to the README changelog.

## Repair and Retirement

- Repair: eliminate the local cleaner episode selection path when canonical
  host navigation is available; retain only its direction-request bridge.
- Retirement trigger: remove the legacy local `episodeDropdown.navigate()`
  route after focused and runtime checks prove all embedded player arrows use
  the host controller.
- Risks: browser-native subtitle pseudo-elements vary by context; unsupported
  opaque provider captions must remain unchanged rather than receive a fragile
  overlay.

## Verification

```text
node tests/playerVisualContract.test.js
node tests/subtitleAppearanceSettings.test.js
node tests/playerEpisodeNavigationBridge.test.js
node tests/playerEpisodePickerProviderUnification.test.js
node tests/movieDetailsPhase3C.test.js
npm run lint
npm run build
```
