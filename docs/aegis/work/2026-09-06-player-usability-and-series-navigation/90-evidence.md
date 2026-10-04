# Completion Evidence

## Delivered behavior

- Settings persists `movieExtensionSubtitleAppearanceV1` with normalized size,
  color, top/bottom position, safe-area offset, background opacity, and shadow.
- The player `Субтитры` submenu exposes those appearance controls beside track
  selection, with a live preview, immediate application, and reset action.
- The active native player applies the preference to supported captions and
  recalculates the safe area when controls or player geometry changes.
- The center action remains anchored at 50%/50%; only the Play glyph keeps its
  optical one-pixel nudge, while Pause stays geometrically neutral.
- Host and embedded series arrows route through the trusted active-frame bridge
  to `MovieDetailsManager.handlePlayerNavigate()` with duplicate-click gating.

## Verification

- Focused subtitle, navigation bridge, visual contract, Phase 3D, Phase 6A,
  provider-runtime, and MediaPlayer tests passed.
- `npm run lint` and `npm run build` passed.
- `git diff --check` passed; only normal line-ending warnings were emitted.
- Full `npm test` was attempted and stopped at the existing hidden-actors layout
  assertion in `tests/movieDetailsCreditsUI.test.js`, outside this task's files.

## Residual risk

Provider-specific native cue rendering and the cross-origin browser message
path still need a manual smoke check in an unpacked extension with a real
series and a visible subtitle track. Unsupported opaque provider captions are
left unchanged by design.
