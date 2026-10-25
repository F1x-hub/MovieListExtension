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
4. essential success, warning, or danger feedback;
5. seasonal decoration owned by `SeasonalThemeService` (see below).

Exceptions must remain local, documented, and visually subordinate to the
neutral interface. Semantic states require a label, icon, shape, border style, or
pattern in addition to color. Color must never be the only carrier of meaning.

## Seasonal decoration

`SeasonalThemeService` owns holiday windows (inclusive local days), the
`seasonalDecorEnabled` opt-out in `chrome.storage.local` with a synchronous
`localStorage` mirror for first paint, the `season-*` class on `<html>`, and the
decorative `#seasonalDecor` layer. `ThemeService` still owns dark/light state;
seasonal decor is a layer on top of either theme, never a third theme.
`src/shared/styles/seasonal.css`, imported by `common.css`, is its only stylesheet.

The Halloween window is 17 October – 7 November. Its palette (pumpkin ember
`#ff8a2a`/`#d9620f`, a violet accent in the navigation edge, lit windows and a
night-sky gradient) exists only as tokens on the season root; every other
seasonal rule consumes those tokens or neutral values. The set is intentionally
small, so the season is obvious without crowding content:

- the navigation's faint orange-violet tint, glowing lower edge and the carved
  pumpkin logo (also in the popup);
- in `#seasonalDecor` (above content, below navigation and dialogs,
  `pointer-events: none`): seven pumpkin lanterns hanging from the navigation,
  hidden once the page scrolls (every other one on narrow screens), and three
  bats crossing on page load at most every three minutes;
- side art in the empty page margins at 1640px and wider: a shaded bark branch
  with dry leaves and a sleeping bat wrapped in its wings, a black-widow spider
  with an ember hourglass on a fading thread, and a graveyard on the left (shaded headstones, a crow on a
  cross, an iron fence, a candle, fog and a floating ghost), a dangling spider
  and a pumpkin patch on the right (two lit jack-o'-lanterns, a plain pumpkin,
  fallen leaves and a glow pool). Both corners use SVG gradients whose stop
  colors come from `.season-stop--*` CSS classes and fade toward the content
  with a mask instead of ending at a hard edge. It is sized from the widest
  page content (1440px) so it stays out of posters and text, and it sits in the
  decor layer because some pages paint an opaque root over the backdrop;
- Home's night-scene `HomeSeasonalBanner` (moon, graves, a dead tree and a house
  with lit windows, kept left of the call-to-action), dismissible per season and
  year, with an ember call-to-action scoped to that banner.

Every 20–35 seconds one rare side-art scene plays, in rotation: the spider climbs
its thread and glides back down (entry animations never replay), the ghost vanishes and peeks out by the headstones, and the jack-o'-lanterns gutter
out and flare. Scenes wait while the tab is hidden and never run under reduced
motion; they are classes on `#seasonalDecor`, so CSS owns every movement.

Shared buttons, menus, focus rings, form controls and navigation links never
take seasonal color. Reduced motion removes the flight and stops sway, ghost,
spider and flicker animations.
`npm run test:seasonal-theme` covers window boundaries, the countdown, opt-out,
Settings preview, banner copy and token-only scene markup; `test:visual-design`
requires every chromatic seasonal value to be a season-root token and blocks
seasonal restyling of shared buttons, menus and navigation links.

## Token ownership

Sorting uses `src/shared/components/SortControl.js` and the `.sort-control`
rules in `components.css`. Enhance a labelled native select; keep its option
values, persistence and ordering logic in the owning page. Selected labels and
options wrap without truncation. Use `setValue` for silent state restoration,
`setOptions` for category-dependent choices, and `setDisabled` with a visible
reason for range-filter locks. A committed selection emits one native change.
Menus stay within the viewport and the owning modal dialog; keyboard navigation
uses a select-only combobox with Escape cancellation and Tab commitment.

Filtering uses `src/shared/components/FilterControls.js` and
`src/shared/styles/filter-controls.css`. Use `FilterChoice` for page-owned
include/exclude cycles and single-choice groups; keep values, persistence and
filtering rules in the page. A tri-state choice is a real button with visible
check/cross states and a shared cycle legend. Use `RangeControl` to normalize
paired numeric bounds or multi-thumb ranges; provide a label for each bound,
preserve the native controls as the source of truth, and pass the page's existing
step and minimum-gap rules. One committed range change calls the page callback
once, while restore and localization updates remain silent.
Discovery panels use a 20px radius; their header/body own padding once. Choices
use 44px pill targets. Range inputs display one pair of integrated numeric bounds
before the slider rather than duplicate value rows. The inline range variant
fits beside sorting on wide Rated layouts and stacks on narrow screens.
Pass `compactLimit`, `moreLabel` and `lessLabel` to `FilterChoice.enhanceGroup`
for long discovery lists. Below 600px, neutral overflow choices collapse behind
one localized disclosure; included/excluded choices remain visible. Disclosure
preserves values, expanded state and keyboard focus across updates.
Search wraps genre/country choices in native `details` with project chevrons;
`FilterChoice.enhanceSummary` keeps the closed header's include/exclude summary
in sync with selection, restore, reset and localization. Groups start closed so
opening filters does not push results below a full reference list.
`common.css` removes OS numeric spin buttons and native select/details arrows.
Numeric keyboard editing stays native; select indicators use one neutral custom
chevron, while `disclosure-summary` provides the shared details indicator. Existing
specialized chart and game disclosures keep their own custom indicators.
`NumberStepper.js` enhances numeric inputs on every extension page, including
dynamic fields, with compact increase/decrease buttons inset inside the input.
Their two rows derive from the input height, rather than a fixed block that can
extend past a shorter field. The original input
still owns step, bounds and validation; custom steps emit native input/change
events, preserve input focus, and respect disabled/read-only state. Range editors
sync the buttons against their current paired constraints. Arrow keys remain
the numeric input's keyboard interaction.
`npm run test:filter-controls-browser` checks paired keyboard focus, contextual
numeric names, and pointer/touch access to both slider handles at their minimum
gap in Chromium.
`npm run test:filter-controls-layout` checks real Random, Search and Rated markup
and styles at 320, 390, 768 and 1440px in both themes, including mobile disclosure
and focus restoration, plus plain Admin/Settings selects under theme background
overrides. Set `FILTER_CAPTURE_DIR` to save screenshots from that run.

`src/shared/styles/tokens.css` is the canonical owner of semantic `--ui-*`
roles. Use roles such as page/surface/content/border/interactive/control and
button roles instead of raw colors. `src/shared/styles/theme.css` provides the
dark/light values for those roles and owns theme mode mapping.

The broadcast standby screen is fixed dark media content in either shell theme.
Its neutral `--ui-broadcast-*` roles live in `tokens.css`; the surrounding page,
programme card and admin editor follow the selected theme. The original
`src/shared/assets/live/standby-pattern.png` is the approved TV test-pattern art,
not a copy of the stock reference images. Standby is silent and static, with no
flashing noise. The admin programme uses one calendar day from 00:00 to 24:00,
inline zoom controls and labelled draggable blocks with fixed duration. New
blocks match source runtime; moving existing reservations preserves their exact
length. The end is calculated automatically and there are no resize handles.
`CustomDatePicker` supplies the calendar and `SortControl` supplies zoom; their
popups sit outside the clipped grid, fit the viewport and support keyboard use.
The calendar uses neutral page-scoped styling. Overlap feedback includes text
as well as a border.

The viewer's common next-show strip sits outside both the player and standby
containers. It expands into today's public programme with all-day/current-and-next
filters, labelled playback states and explicit dates across midnight. The strip
sticks below the actual navigation height while reading the programme. Expansion
preserves playback, keyboard focus, theme parity and the selected filter. Loading,
empty, unavailable and stale schedules have distinct text states.

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

## Motion

`tokens.css`, imported by `common.css`, owns separate motion durations (instant
0ms, press 80ms, fast 120ms, base 180ms, slow 240ms), easing (`out`, `in`,
`standard`, `spring`), entry distance (6px), entry scale (0.985), and press scale
(0.98). Their names use the `--motion-duration-*`, `--motion-ease-*`,
`--motion-distance-enter`, and `--motion-scale-*` prefixes. The spring curve is
only for small controls. Legacy `--ease-*` aliases resolve to these shared roles;
page transition lists remain compatibility layers, not duration tokens.

Menus use `--motion-duration-menu` (160ms), disclosures use
`--motion-duration-disclosure` (200ms), and panes use `--motion-distance-pane`
(4px). Dialog overlays and surfaces enter in 180ms; exits use 120ms/ease-in.
Confirm/Error use discrete display transitions with an instant-close fallback;
What's New enters once per opening and closes through an inert, aria-hidden
visual copy. History and locale rerenders do not replay entry. Resolve, callbacks,
acknowledgement and focus restoration never wait for decorative motion.

Settings, shared and Admin toasts share the `motion-toast` lifecycle: entry
opacity/translate in 180ms, exit in 120ms, with display dwell independent of motion.
Timers own a concrete node, so replacing a toast cannot remove its successor.
Notifications expose status/alert semantics and polite/assertive live regions.

`Utils.bindImageReveal` reveals MovieCard posters/avatars, Home featured posters
and PersonDetails portraits after load/decode without changing their reserved
geometry. Cached images, decode rejection and errors reach a visible terminal
state; source generations prevent old decode work from revealing reused images.
Existing poster-container surfaces remain the loading placeholders. Content
fades never hold ready content behind a loader; Home/Catalog keep their existing
stagger instead of adding a second container animation. Hover movement applies
only to devices supporting hover. Closed disclosures and exiting menus are inert.

List explicit transition properties; never insert a complete transition list
after another property name. Namespace keyframes and scope animation utilities
to their owner so stylesheet order does not change another component's effect.
Focus indicators appear immediately. Motion must not delay semantic close,
hidden/ARIA updates, focus restoration, persistence, or playback readiness.

With `prefers-reduced-motion: reduce`, shared CSS stops decorative animations,
shimmer, float, and spinners and disables transitions and smooth CSS scrolling.
Loading remains visible with its existing accessible label; decorative hover and
press transforms are suppressed without removing positioning transforms. JS
scroll commands select `auto`, and motion-only removal waits are skipped. Games
keep their own reduced-motion rules and simulation loops. Injected site UI owns
equivalent local rules because extension-page styles do not reach host documents.

Run `node tests/motionP0BrowserSmoke.cjs` for computed-style coverage of page
stylesheet graphs, both theme classes, reduced motion, drawer/toast timing,
keyframe isolation and injected adapters. This fixture check does not replace a
reloaded-extension visual pass.

Run `node tests/motionP1BrowserSmoke.cjs` for dialog entry/exit and immediate
semantics, rapid reopen, toast replacement timers, cached/slow/error image loads,
stale decode, and reduced motion in both themes. These are Chromium fixtures,
not proof of the installed extension or real provider behavior.

Home applies one 25ms stagger to at most six initially visible cards per grid,
capped at 120ms. Refreshes and below-viewport cards do not replay it. Random's
decorative glow, float, shimmer and poster motion have finite cycles; wheel,
audio and game simulation keep their own owners. GamesModal motion belongs to
its overlay, surface and game-content boundary, never the game loop.

Image reveal uses one document observer and capture-phase image load/error
handlers rather than one observer per card. Roots/images are registered weakly;
source generations still reject stale decode work and artwork fallbacks remain
owned by the component. A source that has loaded once is marked ready
immediately on later renders, with no fade, so re-created card markup matches
the previous markup and owners that diff card HTML (Ratings) do not blink.
Lightbox navigation and report preview reads likewise
invalidate old work on replacement or close. Release-note acknowledgement starts
before semantic dialog removal; automatic-open decisions share the storage
serialization boundary and never wait for decorative exit.

The P2 Chromium fixtures (`motionP2DecorationBrowserSmoke.cjs`, `motionP2SurfacesBrowserSmoke.cjs` and
`motionP2ImageAckSmoke.cjs`)
exercise surface lifecycles, image/ack behavior, reduced motion and bounded decoration.
Synthetic timings are regression evidence, not installed-extension frame-rate
or production-network measurements.

Cross-context acknowledgement serialization requires Web Locks. Its fallback
queues operations sharing the same storage object within one JavaScript context;
it does not provide a cross-tab lock in browsers without that API.

## CSS ownership

Each generic visual primitive has one owner:

| Primitive | Owner |
| --- | --- |
| Base tokens and theme roles | `src/shared/styles/tokens.css` and `theme.css` |
| Seasonal decoration and Home season banner | `src/shared/styles/seasonal.css` and `SeasonalThemeService.js` |
| Buttons, modals, dropdowns, menus, tooltips, popovers | `src/shared/styles/components.css` |
| Filter choices, ranges and discovery panels | `src/shared/components/FilterControls.js` and `src/shared/styles/filter-controls.css` |
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
