# Movie Rating Extension Context

The extension's visual language and product terminology are intentionally
coherent across pages, popup surfaces, and administrative tools.

## Language

**Yin-Yang / Obsidian-Zinc**:
The product's visual direction: black and white are the two poles, while
grayscale values provide hierarchy, depth, and readability.
_Avoid_: independent page palettes, colorful chrome, accent-first redesigns

**UI chrome**:
The interface frame surrounding content, including navigation, controls, cards,
forms, dialogs, menus, loaders, and player surfaces.
_Avoid_: treating provider badges, posters, or game pieces as UI chrome

**Content color**:
Color that belongs to a poster, photograph, avatar, title artwork, provider
brand, or game and remains inside that content boundary.
_Avoid_: promoting content color into a shared interface accent

**Semantic color exception**:
Limited color used for essential success, warning, danger, or provider identity;
it must be paired with a label, icon, shape, border, or pattern.
_Avoid_: color-only meaning, decorative status colors

**Theme parity**:
The rule that dark and light themes preserve the same hierarchy, states,
geometry, and interaction intent while inverting neutral contrast.
_Avoid_: separate dark-only and light-only visual languages

## Resolved Ambiguities

- “Monochrome interface” means neutral UI chrome with documented content and
  semantic exceptions, not forced grayscale for posters, photos, or game content.

## MediaPlayer storage and component updates

These flows are implemented locally. Publication and installed-system validation
are separate; see the [integration record](docs/aegis/plans/2026-10-23-torrent-playback.md).

- **Папка для фильмов и сериалов** belongs in Settings → MediaPlayer. It selects
  the download destination, independently of the Suite installation folder and
  cache. Show the current path and provide a native folder picker with explicit
  save/cancel feedback. MediaPlayer owns and persists the effective setting.
- A folder change applies to new torrent stores; existing downloads keep their
  recorded locations. Moving existing files is a separate explicit action.
- Restarts and updates must retain the user's folder. Report unavailable disks
  or missing write access without silently choosing another destination.
- The shared updater checks itself, the extension and an already installed
  MediaPlayer using independent signed component versions. An absent MediaPlayer
  is skipped. Updater and Suite auto-updates each require a separate opt-in.
- An older updater or Suite needs a one-time manual Setup to provision component
  capabilities and the protected maintenance service. Background updates never
  trigger UAC. The installer waits for playback to drain and restores the previous
  runtime, configuration and database if activation fails.
