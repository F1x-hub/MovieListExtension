# Visual Design System

This document is the visual contract for the Movie Rating Extension. It exists
to keep all pages, shared components, popup surfaces, and admin tools inside one
coherent visual language.

## Product principle

The interface follows a Yin-Yang / Obsidian-Zinc direction. Black and white are
the two poles; the intermediate grayscale values provide hierarchy, depth, and
readability. Dark and light themes are two contrast modes of the same system,
not independent color themes.

The interface frame should be calm and monochrome. Posters, photographs, logos,
provider content, and games may supply color inside their own content boundary.

## Palette rules

### UI chrome: neutral only

These surfaces must use semantic grayscale tokens:

- page, surface, elevated surface, cards, navigation, and player shell;
- buttons, links, tabs, filters, dropdowns, menus, popovers, and modals;
- forms, loaders, skeletons, focus rings, admin controls, and page headers;
- hover, active, selected, disabled, and pressed states.

Do not add decorative amber, cyan, indigo, blue, purple, pink, orange, or green
to these surfaces. Do not create a page-specific `--accent-*` variable to bypass
this rule.

### Explicit exceptions

Color is allowed only when it carries content or an unavoidable semantic:

1. posters, photos, thumbnails, avatars, and title artwork;
2. external provider or brand marks such as IMDb, Kinopoisk, Telegram, or Google;
3. game boards, pieces, and game-specific feedback;
4. essential success, warning, or danger feedback.

Exceptions must remain local, documented, and visually subordinate to the
neutral interface. Semantic states require a label, icon, shape, border style, or
pattern in addition to color. Color must never be the only carrier of meaning.

## Token ownership

`src/shared/styles/tokens.css` is the canonical owner of semantic `--ui-*`
roles. Use roles such as page/surface/content/border/interactive/control and
button roles instead of raw colors. `src/shared/styles/theme.css` provides the
dark/light values for those roles and owns theme mode mapping.

`common.css`, old `--theme-*` variables, `--accent-*` variables, Bootstrap
status variables, and page-local palettes are migration compatibility layers.
Do not add new consumers. A migration may temporarily preserve an alias, but
the alias must point to a canonical semantic role and have a removal path.

`--theme-text-muted` is theme-specific rather than a shared literal: dark mode
uses `#85858e` and light mode uses `#66666e`. Both maintain at least 4.5:1
contrast against their page backgrounds for ordinary text.

`ThemeService` remains the only owner of theme persistence, custom-theme
migration, DOM theme classes, and cross-tab synchronization. Theme editor values
must remain within the approved neutral system; arbitrary chromatic accents are
not part of the product contract.

## CSS ownership

Each generic visual primitive has one owner:

| Primitive | Owner |
| --- | --- |
| Base tokens and theme roles | `src/shared/styles/tokens.css` and `theme.css` |
| Buttons, modals, dropdowns, menus, tooltips, popovers | `src/shared/styles/components.css` |
| Movie cards | `src/shared/styles/movie-card.css` and `MovieCard.js` |
| Navigation | `src/shared/styles/navigation.css` and `Navigation.js` |
| Player geometry and overlays | `src/shared/styles/player.css` |
| Page layout and content variants | The owning page CSS, scoped below its page root |

`components.css` owns the popover surface contract. Variants may set the scoped
`--popover-surface-*` values on the same rendered component, but legacy generic
`--popover-bg`, `--popover-border`, `--popover-radius`, `--popover-shadow`, and
`--popover-backdrop` must not be introduced or reused.

Search styles must not become a shared catch-all. `search.css` is a temporary
compatibility dependency for list-page rating modals; do not add new consumers
or selectors to it. Extracting that modal surface requires a verified runtime
pass across Favorites, Collection, Ratings, Watching, and Watchlist before any
existing link is removed.

## Component behavior

- Use neutral solid or grayscale surfaces; avoid hue-based gradients and glows.
- Keep borders, shadows, radius, spacing, and motion consistent across pages.
- Use `:focus-visible` with a visible neutral focus treatment; never remove focus
  outlines globally without a replacement.
- Keep provider badges and game visuals small and bounded by their content area.
- Use explicit modifier classes for intentional variants instead of overriding a
  generic class from a page stylesheet.
- Keep dark/light hierarchy equivalent: the same element must remain primary,
  secondary, muted, interactive, or disabled in both modes.
- Text must not inherit a decorative or legacy accent token. Ordinary secondary
  and muted text must meet at least 4.5:1 contrast; disabled controls retain
  readable text and communicate their state through interaction and structure,
  not a low-opacity label alone.

## Review checklist

Before completing UI work, verify:

- [ ] The change uses an existing semantic `--ui-*` token or adds a reviewed role
      to the canonical token owner.
- [ ] No unapproved color literal was added to HTML, JavaScript, inline styles,
      SVG, or page CSS.
- [ ] Any exception is listed above and is limited to content, brand, game, or
      essential semantic feedback.
- [ ] The component has one CSS owner and no duplicate generic token definitions.
- [ ] Dark and light themes preserve the same hierarchy and interaction states.
- [ ] Success/warning/danger/active states include a non-color cue.
- [ ] Desktop and narrow layouts were checked for contrast, focus, overflow, and
      visual alignment.
- [ ] Relevant build, lint, contract tests, and visual checks were run.

The automated guard is `npm run test:visual-design`. It classifies every source
stylesheet, checks canonical theme contrast, blocks the retired blue/cyan/purple
palette in migrated UI chrome, and rejects legacy generic popover tokens. Add a
new stylesheet to that classification before it can ship; do not create a
page-specific palette exception to bypass the test.

## Current migration note

The first migration slice neutralized the canonical theme/shared foundations and
the primary Home and Catalog chrome. The next slice extended that contract to
MovieDetails, Player, Profile, Search, Admin, Ratings, Watchlist, MovieCard,
PersonDetails, Random, Collection, Popup, and external watchlist affordances.
Remaining chromatic styles are limited to documented semantic, provider-brand,
and game/content exceptions, plus a few legacy surfaces still queued for review.
New work must follow this contract and must not expand those palettes. Existing
exceptions should be reduced during the visual migration rather than copied into
new components.
