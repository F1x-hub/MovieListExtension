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
3. game boards, pieces, and game-specific feedback (the Battleship board draws
   hulls in the content colour and hits in the semantic danger red, always as a
   cross, with misses as dots; its WebGL version is slate water in a graphite
   frame with steel-grey ships, sunk ships as darker wrecks, flame and smoke over
   the cross of a burning hit, and a white ghost for a placement that fits or a
   red hatched one for a placement that does not; its page chrome stays neutral; the chess board is porcelain
   and obsidian pieces on grey stone, with a steel tint for the last move and the
   danger red only for check and a clock under twenty seconds, each next to a
   text or an icon; the flat board and the piece glyphs reuse those greys, and
   the chess page chrome stays neutral; Salvo («Залп») draws its sky, islands,
   water or lava, fighters and up to eight team colours as game content, with each
   team colour next to the team's or the player's name, while its menus, room, HUD panels and buttons
   take only the neutral `--ui-*` tokens and `zalp.css` holds no colour literal);
4. essential success, warning, or danger feedback;
5. seasonal decoration owned by `SeasonalThemeService` (see below);
6. collection icons: the franchise tiles from
   `src/shared/data/collectionIcons.js`. They are artwork the user picks, drawn
   at the icon's size and always next to the collection's name. They use flat
   colours and opacity only (no gradients, masks or clip paths, which need ids),
   and none reproduces a logo or wordmark. Collections cannot use uploaded
   pictures: that feature was removed, and an old picture shows the folder icon;
7. franchise rating icons: in the rating dialog (Movie Details and Ratings), films of
   Spider-Man, Star Wars, Iron Man, Avengers, Superman and Dune are rated with
   their own pictures instead of stars (`src/shared/assets/icons/ratings/`,
   chosen by `src/shared/config/franchiseRatingThemes.js`). The selected look is
   coloured and the unselected one grey, and the status line above the row
   («Ваша оценка: 7») and each button's `aria-pressed` say the score as well.
   The pictures added for Iron Man, Avengers, Superman and Dune share one size,
   read at 16–20px in both themes, and reproduce no logo or wordmark.
8. the announce stamp: in the film page's announce scene
   (`src/pages/movie-details/announce-stamp/`) the stamp is an object, not
   chrome. It is drawn in WebGL as the extension's two poles made physical: an
   obsidian lacquered body and handle, a zinc collar and a zinc cap engraved with
   the clapperboard mark, on a graphite desk. The ink of its impression (red by
   default, set in the scene's settings; dark blue, black or white where red
   would not read on the poster, or as the owner switches it) is content drawn
   over the poster, on a soft halo of its own shape (white under dark ink,
   near-black under white ink) so it reads on busy posters: a
   cinema ticket with the clapperboard mark, the label, the date and, on the
   stub, «НАЧАЛО» and the time, always as text. While the owner aims, the place
   is a dashed outline of that ticket in the ink, on a halo that contrasts with it. The stage behind it
   is a dark scrim in both themes; its status panel, buttons and close control
   use only the neutral `--ui-*` tokens, and a sent or failed result has an icon
   next to its text.
9. the cat trail: inside `.cat-scene` (the den opened from the achievements tab and
   its silhouette in the frame picker) a cinema storeroom at night with a cat, a
   cardboard box and the pink of the cat's frame, the same in both themes; on the
   secret card only the cat's eyes. The dialog around it, its texts, paw prints and
   buttons stay neutral, and every state is also told in text. The dialog keeps its
   size while the text changes. The cat lives only while the scene is open, a press
   plays any story to its end, and under reduced motion poses change at once.

Exceptions must remain local, documented, and visually subordinate to the
neutral interface. Semantic states require a label, icon, shape, border style, or
pattern in addition to color. Color must never be the only carrier of meaning.

IMDb's yellow `#f5c518` and Kinopoisk's orange `#ff5500` fall to about 1.6:1 and
2.9:1 on a light surface. Provider text that sits on a light surface in the light
theme uses a deep shade of its own family, `#7e5400` for IMDb and `#a03b02` for
Kinopoisk, so it reads at 4.5:1 or more and looks the same on every page: the film
page's tiles, cards and Random. Badges with a yellow or
orange fill keep the brand fill in both themes and carry near-black text: white
on Kinopoisk's orange is only about 3.4:1.

## Seasonal decoration

`SeasonalThemeService` owns holiday windows (inclusive local days), the
`seasonalDecorEnabled` opt-out in `chrome.storage.local` with a synchronous
`localStorage` mirror for first paint, the `season-*` class on `<html>`, and the
decorative `#seasonalDecor` layer. `ThemeService` still owns dark/light state;
seasonal decor is a layer on top of either theme, never a third theme.
`src/shared/styles/seasonal.css` and `seasonal-newyear.css`, imported by `common.css`, are its only stylesheets.

The Halloween window is 17 October – 7 November. Its palette (pumpkin ember
`#ff8a2a`/`#d9620f`, a violet accent in the navigation edge, lit windows and a
night-sky gradient) exists only as tokens on the season root; every other
seasonal rule consumes those tokens or neutral values. The set is intentionally
small, so the season is obvious without crowding content:

- the navigation's faint orange-violet tint, glowing lower edge and the carved
  pumpkin logo wearing a left-tilted witch hat (also in the popup);
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

The New Year window is 15 December – 14 January with its peak on 1 January. It
crosses the turn of the year, so the season's `year` is the year it starts in and
a collapsed sign stays collapsed for the whole window. The look is «Новогодний сеанс», a
cinema under the snow at night, and it belongs to this season alone:

- a snowed-in clapperboard logo with a warm Play window that claps now and then, in
  the navigation and in place of the big app icon on Random (`data-seasonal-logo`);
- behind the content, on `z-index: -1`: stars, a northern-lights canvas and, on
  Home only, Santa's sleigh and six reindeer crossing the free band of sky between
  the slider and the sign, passing behind posters and the tree's star. A pass waits
  while that band has scrolled away, and the next one comes 45 seconds after the last;
- a snowy forest in the page margins at 1640px and wider, with pointer parallax;
- in `#seasonalDecor`: falling snow in three depths that the cursor pushes aside;
- snow piles on the top edges of slider cards, movie cards and the sign. They live
  on `.ny-piles`, a layer inside the page's scroll, so they cannot lag behind a poster.
  Calm scrolling and the page sliding when the sign collapses leave them alone; a
  card's own hover lift or a fast fling knocks some off, a fling never more than half.
  Below a pixel of height nothing is drawn;
- Home's `.ny-marquee`: an Art Deco sign, night in both themes, with a neon title in
  the bundled Poiret One, running lamps, a film-leader dial and flip digits counting
  to midnight on 1 January, a decorated tree breaking through its top edge and twelve
  gifts. The ornaments (`src/shared/seasonal/newyear/ornaments.js`) are glass balls, angels,
  a snowman, bells, a candy cane, a mitten, a snowflake, a star, a frosted cone, an icicle,
  and from the cinema a popcorn tub, a clapperboard and a film reel. None is yellow: the
  needles already glow warm, so a yellow ornament disappears there. The lamps' glow is
  drawn behind the ornaments for the same reason, because over them it would turn every
  color toward yellow. Slots are in `tree.js`, and the art generator paints their sprigs
  and shadows; who hangs in which slot is the arrangement in `ornaments.js`. Any gift opens onto a New Year film from TMDB (keyword 207317, requested on
  the first opening only and again after an answer without films; `«Случайный»` is
  the fallback). All gifts share one card, which says so while the film is on its way
  and belongs to the gift opened last, even while an earlier one still closes. It
  takes clicks only once it has arrived, so a click meant for a gift cannot land on
  its link. On 1 January the title
  becomes «С Новым годом!», the countdown goes away and fireworks fly. The sign has
  `wide`, `compact` and `stacked` layouts chosen from the content column's width;
- `.ny-strip`: the sign collapsed. «Свернуть» never removes the sign: one line of the
  same cinema front stays in its place, with two of the gifts, the title, the time left
  and «Развернуть». The choice is kept per season in `movieExtensionSeasonBannerDismissed`,
  so the next page view opens as it was left, and a collapsed one loads neither the tree
  nor the other gifts. `NewYearScene` owns the move between the two forms: the box eases
  between their heights while the sign rolls up or down, at once under reduced motion.
  The plain Halloween banner keeps its close button.

Everything specific to the season loads on demand: `SeasonalThemeService.loadRuntime()`
adds `src/shared/seasonal/newyear/*.js` only while the season is active, and pages
off-season fetch none of it. The forest, tree and gift pictures in
`src/shared/assets/seasonal/newyear/` are pre-rendered needle by needle, because every
page is a full load and painting them costs about a second of main thread. Regenerate
them with `node scripts/generate-newyear-art.cjs` after changing
`scripts/newyear-art/painters.js`, the arrangement or the `--ny-*` painter tokens; moving
art (ornaments, lamps, the film garland, Santa) keeps its colors in code as part of the
illustration. One animation loop owns all of it. It stops while the tab is hidden, while
the player is open and in fullscreen, sheds snow on a machine that cannot keep up, and
draws a single still frame under reduced motion. The live broadcast page keeps the
forest and a still sky, but no falling snow or moving aurora, because the video is
part of that page. A page root that paints the theme background hides the sky, so such
a root goes on the transparent list in `seasonal-newyear.css`. Text never lies on the
bright aurora: surfaces with a translucent tint go on the solid list there, the profile
lies on one sheet, and in the dark theme the aurora dims to a quarter over the first
320px of scrolling, because the sky stays in place while the page moves over it. Side art
is sized from the page content: 1440px, and 1552px on Bookmarks and Downloads, where it is
hidden below 1752px.
`npm run test:new-year-browser` runs the built extension with a pinned clock. To look
at a season out of its dates, run `localStorage.setItem('movieExtensionSeasonPreviewDate', '2026-12-20')`
on any extension page and reload; `removeItem` returns to the real date.

## Token ownership

### Corner radius

The corner of an element follows its role, not its page. The scale lives in
`common.css`; write the token, never a pixel value.

| Token | Value | Role |
| --- | --- | --- |
| `--radius-xs` | 2px | Tiny marks: status dots, page dots, the player's progress knob |
| `--radius-sm` | 4px | Text labels: status, studio, genre, "new" and live badges; number badges (a place in a list, a count); slider and switch knobs; calendar cells |
| `--radius-md` | 8px | Anything clickable: buttons, inputs, selects, tabs, filter choices, menu items (`--ui-control-radius`) |
| `--radius-lg` | 12px | Cards, posters, photos of people, panels, banners, popovers |
| `--radius-xl` | 16px | Page surfaces, modals, large sections |
| `--radius-pill` | 999px | Thin bars and progress tracks only |
| `--radius-circle` | 50% | The avatar of a user. Besides it, only spinners, which turn, and objects drawn inside games and seasonal art |

**The shape of the product is a rounded square. The only circle is a user's avatar.**
A photo of an actor, a number, an icon, a plus sign, a status dot, a counter, a slider
or switch knob is a rounded square, like the cards and controls around it: a circle
inside a rounded square looks foreign. Before shipping, check new number badges, people
photos, icon wells, dots and empty states for this. The visual-design test lists the
avatars, spinners and game objects and fails on any other circle.

Buttons, tabs and choices are never pill-shaped, and icon-only buttons (close,
remove, clear, play, small actions) are never circles: like every control they
are rounded squares with `--radius-md`, or `--radius-sm` below about 16px.
`npm run test:visual-design` fails on a control selector with a circular radius. `50%` on a wide element draws
an ellipse, so wide bars use `--radius-pill`; `--radius-full` is a
legacy alias of it. A child inset in a rounded frame takes the frame's radius
minus the inset (`calc(var(--radius-xl) - 1px)` inside a 1px border).
Files that load without `common.css` keep fallbacks; see "Files loaded without
`common.css`" below.

### Icons

The product has its own icon set, drawn for it on a 20px grid and shown at 20px, so one
unit is one pixel: a whole outline (2px, round caps and joins) with one solid part. A
simple shape has its right half solid; a compound one has a part of its own solid (a
calendar's header, a person's head, the download arrow).

- The drawings live in `scripts/icon-set/icons.cjs`; `node scripts/icon-set/build.cjs`
  writes them into the `<icon-set>` block of `src/shared/utils/Icons.js` and into every
  `<svg data-icon="NAME" viewBox="0 0 20 20" fill="none">` in `src` and `content-scripts`,
  HTML and script strings alike. Never edit either by hand; change the drawing and run the script. `kit.cjs` cuts
  the right half of any outline.
- A toggled icon has a second, fully solid drawing, `NAME_FILLED`. Switch the drawing, not
  the svg's `fill`.
- An icon alone in a wrapper sits in a `span` whose class names an icon (`btn-icon`,
  `sidebar-icon`): `common.css` centres it there. In a bare `span` it stands above the
  text's centre.
- Sizes are 20px, or 16px next to small text and 40px in empty states and poster
  placeholders. Utility marks may be 14px; smaller ones blur.
- Readability at the real size comes first. Judge a drawing at 20px and 100% display
  scaling (device pixel ratio 1), then at 125% and 150%, never only enlarged. Put the edges
  of straight lines on whole pixels. Keep the silhouette whole: a wave inside the shape and
  a gap between its halves were tried and fell apart at this size.
- Icons are plain paths in `currentColor`: no masks, clips, gradients or ids.
- Small utility marks (close, check, plus, chevrons, arrows, menus, refresh) are plain
  lines of the same weight. REFRESH (two arrows) loads again, RESET (one arrow back) undoes
  or turns; do not swap them. Brands, franchise tiles, achievement badges and game pieces
  are not part of the set.

The whole interface uses the set, the buttons inside the player included
(`content-scripts/player-cleaner.js`: 20px in the dock, 30px on the centre button). The rating
star stays an outline: half filled, it would read as half a point. The collection picker
offers the set's icons, but a collection keeps the icon saved in its data as markup, so
collections made earlier show the older drawings.
`npm run test:visual-design` checks that everything generated is up to date.

### Scrollbars

The extension has one scrollbar, in `src/shared/styles/scrollbars.css`. Pages get it
through `common.css`; a page without `common.css` links the file. Do not style
scrollbars anywhere else. `scrollbar-width: thin` and `scrollbar-color` are forbidden:
in Chrome they switch the `::-webkit-scrollbar` rules off, and the system bar with
arrows comes back. `scrollbar-width: none` (a row that shows no bar, such as tabs) and
`scrollbar-gutter` are fine. Player controls inside provider frames carry a copy of the
declarations in `content-scripts/player-cleaner.js`, because our stylesheets do not
load there; `npm run test:visual-design` keeps the copy identical.

### Type scale

Font sizes come from one scale in `common.css`; write the token, not a size.

| Token | Size | Typical use |
| --- | --- | --- |
| `--font-size-3xs` | 10px | Micro labels on badges and counters |
| `--font-size-2xs` | 11px | Captions, meta, uppercase eyebrows |
| `--font-size-xs` | 12px | Small text, chips |
| `--font-size-sm` | 13px | Secondary text, compact controls |
| `--font-size-md` | 14px | Body text and controls (`--ui-control-font-size`) |
| `--font-size-base` | 16px | Lead text |
| `--font-size-lg` | 18px | Card and dialog titles |
| `--font-size-xl` | 20px | Section titles |
| `--font-size-2xl` | 24px | Large headings |
| `--font-size-3xl` | 32px | Page titles |
| `--font-size-4xl` | 48px | Display numbers |

`--font-size-sm` was 14px before this scale; it is 13px now and 14px is `md`.
Fluid hero titles may use `clamp()`, and `em` sizes stay relative. Weights are
400, 500, 600, 700 and 800 only.

### Elevation

Drop shadows use `--elevation-1` (resting surfaces), `--elevation-2` (raised
cards, menus, popovers) or `--elevation-3` (dialogs, floating panels). They adapt
to the theme: a hairline ring plus a deep shadow in dark, soft shadows in light.
`--shadow-sm/md/lg/xl` are legacy aliases of them. Focus rings, inset shadows
and coloured glows are separate effects and are written where they are used.

### Stacking

`theme.css` owns the only global layers: `--z-floating` 900 (back-to-top, live
pill), `--z-dropdown` 1000 (navigation bar and menus), `--z-fixed` 1030 (report
button), `--z-popover` 1050 (pickers, notices, selection popup), `--z-modal`
10000 (modal overlays, dialogs, toasts) and `--z-top` 100000 (lightbox). A modal
always covers the navigation bar. Numbers 1–10 stay local to one component.

### Breakpoints

Media queries use 360, 480, 640, 768, 900, 1024 and 1280px (`max-width`), with
the matching `min-width` one pixel above or `max-width` one pixel below (639,
1023…) for a split at the same step. The popup, the player and seasonal decor
keep their own widths. A new split where content stops fitting is written as a
range, `(width < 640px)`: with display scaling a window can be 639.2px wide, which
`max-width: 639px` does not match (Home's guest invitation kept its row there).

### Files loaded without `common.css`

`theme.css` and `player.css` also load on the YouTube player page, and
`back-to-top.css` loads alone on the update instructions page. Tokens in them
carry fallbacks (`var(--radius-md, 8px)`), and their transitions are written as
literal values because `tokens.css` is not there.

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
Discovery panels use `--radius-xl`; their header/body own padding once. Choices
use 44px targets with `--radius-md` corners. Range inputs display one pair of integrated numeric bounds
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
`src/shared/assets/live/standby-pattern.webp` is the approved TV test-pattern art,
not a copy of the stock reference images. Standby is silent and static, with no
flashing noise. The admin programme uses one calendar day from 00:00 to 24:00,
inline zoom controls and labelled draggable blocks with fixed duration. New
blocks match source runtime; moving existing reservations preserves their exact
length. The end is calculated automatically and there are no resize handles.
`CustomDatePicker` supplies the calendar and `SortControl` supplies zoom; their
popups sit outside the clipped grid, fit the viewport and support keyboard use.
The calendar uses neutral page-scoped styling. Overlap feedback includes text
as well as a border.

A full-day overview above the detailed track shows scheduled slots and its
visible window. Drag the window, click the overview or use its slider keyboard
controls to pan without changing the programme. Its window and time labels
follow scrolling and 24/12/6/3-hour zoom, including narrow panes. The overview
always keeps the entire day visible.

Series use season buttons and episode cards within the existing source library.
One action adds one episode, with its runtime fixed; an unknown runtime requires
an explicit value. The next episode is prepared at the saved end, then added only
by an explicit button. Conflicts show the occupied screening and offer a free
start without moving neighbours. Added and unreleased episodes have text labels,
and saved slots keep their season and episode when moved. Catalogue loading,
retry and missing-runtime feedback remain inside the editor in either theme.

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

`ThemeService` remains the only owner of theme persistence, DOM theme classes,
cross-tab synchronization and the toolbar icon. There are three choices: dark (the
default), light, and «Как в системе», which follows `prefers-color-scheme`, that is
Chrome's own mode. There are no user-made themes; one from the removed editor
becomes its base. The choice is made in place, without a dialog: three radios in the
account menu (`.nav-theme`) and three cards with previews in Settings. It applies at
once, so Save and Reset do not cover it. A guest reaches it through the Settings
button beside «Войти».

A theme change reaches the whole page in one frame: `.theme-switching` switches
transitions off while the classes change. Do not add transitions that exist only to
fade a theme change.

`theme.css` sets `color-scheme` with the theme, so native parts (select lists,
autofill) match it. Frames of other sites stay `color-scheme: light`: under a dark
one the browser paints white behind a transparent document.

## Motion

`tokens.css`, imported by `common.css`, owns separate motion durations (instant
0ms, press 80ms, fast 120ms, base 180ms, slow 240ms), easing (`out`, `in`,
`standard`, `spring`), entry distance (6px), entry scale (0.985), and press scale
(0.98). Their names use the `--motion-duration-*`, `--motion-ease-*`,
`--motion-distance-enter`, and `--motion-scale-*` prefixes. The spring curve is
only for small controls. Legacy `--ease-*` aliases resolve to these shared roles,
and `--transition-fast/base/slow` are duration-plus-easing aliases of the fast,
base and slow steps. Transitions name their duration and easing through these
tokens; only deliberately long motion (over 350ms) and delays are written as
literal times.

Menus use `--motion-duration-menu` (160ms), disclosures use
`--motion-duration-disclosure` (200ms), and panes use `--motion-distance-pane`
(4px). Dialog overlays and surfaces enter in 180ms; exits use 120ms/ease-in.
Confirm/Error use discrete display transitions with an instant-close fallback;
What's New enters once per opening and closes through an inert, aria-hidden
visual copy. History and locale rerenders do not replay entry. Resolve, callbacks,
acknowledgement and focus restoration never wait for decorative motion.

Pages report results through the shared `Utils.showToast(message, type)` (success,
error, warning or info; Settings and Admin included, no page-owned toasts). It uses
the `motion-toast` lifecycle: entry
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
| Rating dialog (Movie Details and Ratings) | `src/shared/styles/rating-dialog.css` and `RatingDialog.js` |
| Cat trail scene | `src/shared/styles/cat-den.css`, `CatDen.js`, `CatDenArt.js`, `CatPuppet.js` and `CatPeek.js` |
| Awards and nominations (film tab, person page) | `src/shared/styles/awards.css` and `AwardsList.js` |
| Navigation | `src/shared/styles/navigation.css` and `Navigation.js` |
| Icons | `scripts/icon-set/` (drawings) and `src/shared/utils/Icons.js` (generated block) |
| Player geometry and overlays | `src/shared/styles/player.css` |
| Page layout and content variants | The owning page CSS, scoped below its page root |

`components.css` owns the popover surface contract. Variants may set the scoped
`--popover-surface-*` values on the same rendered component, but legacy generic
`--popover-bg`, `--popover-border`, `--popover-radius`, `--popover-shadow`, and
`--popover-backdrop` must not be introduced or reused.

Search styles must not become a shared catch-all. `search.css` is a temporary
compatibility dependency for the Ratings filters and results and for the other
list pages that still link it; do not add new consumers or selectors to it.
Removing a link requires a verified runtime pass on that page.

## Component behavior

- Use neutral solid or grayscale surfaces; avoid hue-based gradients and glows.
- Keep borders, shadows, radius, spacing, and motion consistent across pages.
- Use `:focus-visible` with a visible neutral focus treatment; never remove focus
  outlines globally without a replacement.
- A button whose action is running stays the same size and swaps its label for a
  spinner with `.btn--pending`, alongside `disabled` and `aria-busy`. The spinner
  waits 150ms, so a quick action does not flash it.
- Keep provider badges and game visuals small and bounded by their content area.
- Awards are neutral too: every ceremony has an outline emblem in the text colour
  (a statuette for the Oscar, a globe, a mask for BAFTA, a laurel for festivals, a
  trophy for the rest), and a win differs from a nomination by its word, a filled
  rather than outlined trophy and a heavier weight, not by gold.
- Use explicit modifier classes for intentional variants instead of overriding a
  generic class from a page stylesheet.
- Page states have one look everywhere, owned by `components.css`. Empty results
  use `.empty-state` with `.empty-state-icon`, `-title`, `-text`; a failed load
  uses `.error-state` with the same parts (`.error-state-*`, or the older
  `.error-icon` / `.error-title` / `.error-text` / `.error-message` names). Its
  icon is the only red part, and a page-level error is a centred 560px card. A
  single action is `.btn.btn-primary` plus `.empty-state-btn` / `.error-state-btn`;
  several go in `.error-actions`. Loading uses `.app-loader` (`common.css`) with a
  size modifier (`--page`, `--section`, `--compact`, `--inline`). Page stylesheets
  do not restyle these classes; only the popup has a compact variant under
  `.popup-page`.
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
