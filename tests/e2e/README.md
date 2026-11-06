# Browser test rig

The rest of `tests/` checks data and contracts. This rig checks what a person
sees: it loads the built extension into real Chromium, clicks through it, and
measures how the page moves.

## Running it

```bash
npm run test:e2e
```

```bash
npm run test:e2e:headed
```

```bash
npm run test:e2e -- --no-build home-to-rating
```

`test:e2e` builds `dist/` first; `--no-build` reuses the current one. Other
arguments go to Playwright. After an intended visual change, look at the diff in
the report and then rewrite the baselines:

```bash
npm run test:e2e:update
```

Requirements: the Firebase CLI on `PATH` and Java 21 or newer. The runner finds a
suitable JDK by itself (`E2E_JAVA_HOME`, `JAVA_HOME`, Android Studio's bundled
one, Gradle's) and uses it for its own process only, so the system Java is not
changed. The first run downloads the Firestore emulator.

Results go to `.e2e-output/`: open `report/index.html` for screenshot diffs, and
`results/<test>/` holds a `filmstrip-*.png` and `motion-report.json` for each run.

## What is real and what is not

| Real | Replaced |
| --- | --- |
| The `dist/` build, unmodified | TMDB answers and posters: invented titles in `lib/catalog.cjs` |
| Pages at `chrome-extension://`, the service worker, mouse and keyboard input | Firebase Auth and Firestore: local emulators, with the real `rules/firestore.rules` |
| Firebase SDK and all application code | The clock pages see: pinned, so seasonal decor and release badges stay stable |

Everything else is unreachable: the browser's proxy and host rules from
`tests/helpers/extensionContext.cjs` block all other hosts. The emulators run
under a `demo-` project, and a test refuses to start if the page reports any
other project, so a run cannot touch production data.

Not covered here: the toolbar popup and side panel, Cloud Functions. Live video
players have their own specs: see [The player on real sources](#the-player-on-real-sources).

## What it checks

- **Behaviour**: the journey uses real clicks, which fail if something covers the
  target. A saved rating is read back from the emulator. Uncaught page exceptions
  fail the test.
- **Motion** (`lib/motionAnalysis.cjs`): per-frame position and opacity of tracked
  elements, for snaps, trembling, blinks and animations that re-run layout.
- **Jumps while loading**: any element moving 8px or more, or entering the view,
  fails unless a spec explains it. The list and its reasons are at the top of
  `specs/home-to-rating.spec.cjs`.
- **Flashes**: a painted frame far too bright or dark for the theme.
- **Appearance**: viewport screenshots in both themes compared with
  `__screenshots__/`, to 10 pixels. Baselines depend on font rendering, so they
  are per platform.

`specs/motion-detectors.spec.cjs` is the control group: it feeds each detector
broken and clean motion, so a green journey means something.

## Known open defects

- A name only Firestore knows, on a page opened before anything has saved it. The
  page paints the session's copy of the name, so the bar moves once when Firestore
  answers: 43px on the search control from `E2E Viewer` to `Константин Иванов`. No
  spec fails on this, because nobody opens a page that soon after signing in, and
  later loads are stable.
- On Settings, the Updates and Media Player sections grow after the first paint, by
  103px and 55px, and push the footer down with them. At 1440×900 it is already below
  the fold by then. The cause has not been looked into.

## The player on real sources

```bash
npm run test:e2e:player
```

```bash
npm run test:e2e:player:headed
```

```bash
npm run test:e2e:player -- --no-build series
```

These specs in `player/` need the internet and take 10 to 30 minutes. They are not part
of `test:e2e`, because their result depends on what providers do today. With a window,
do not touch the browser while they run: a click there lands in the test.

They watch with uBlock Origin Lite, as the extension's owner does, because ads and what a
provider does when its ads are blocked change what a viewer gets. The rig copies only
the extension's folder from Chrome's default profile, or from `E2E_UBLOCK_PATH`, so the
browser's profile and settings stay out of it and the filter settings are the defaults.
Without an installed copy a run prints a warning and goes on without it. Add
`--no-ublock` to see what a viewer without a blocker gets:

```bash
npm run test:e2e:player -- --no-ublock
```

| Real | Replaced |
| --- | --- |
| The `dist/` build, its service worker and its network rules, uBlock Origin Lite | Firebase Auth and Firestore: the same local emulators |
| Finding a film on each provider, embeds, players, streams, ads | The film's card: a fixed record in `player/films.cjs`, because the Kinopoisk proxy accepts only a production sign-in |
| Real clicks and keys, the real clock, provider frames left untouched | TMDB answers for Home, used only while signing in |

Production cannot be reached: `PRODUCTION_HOSTS` in `lib/config.cjs` are removed at the
browser's name resolver, and `safety.spec.cjs` checks that on every run.

| Spec | What it checks |
| --- | --- |
| `sources.spec.cjs` | «Смотреть», then every offered source, on a film, a series and an anime |
| `controls.spec.cjs` | Pause, the timeline, keys, volume, settings, full screen, minimise and close, on KinoGo (provider frame) and Rutube (extension page) |
| `look.spec.cjs` | Layout around a real picture in both themes at three window sizes, and Esc on the source list |
| `series.spec.cjs` | Next, previous, the episode list, a source change, and «Попробовать другой источник» |
| `safety.spec.cjs` | The control group: unreachable production, uBlock really blocking, and each guard shown catching what it should |

A source counts as playing only when frames are being decoded, time is moving, the
length matches the film and the picture is neither black nor frozen. A `ready` state
proves nothing: it is what a source reports while its player shows nothing. An episode
is checked by the real length of its stream, because the header can say anything.
A source that says it is unavailable passes, since a provider may be down; one that
claims to play and shows nothing fails, and `provider-refused` in the table names the
HTTP error its frame got.

Results go to `.e2e-output/`: `player-summary.md` holds one row per source, with times,
ads, resolution and stalls, and `player-report/index.html` holds each run's screenshots
and filmstrips. A failed source also leaves `<source>-frames.json` in `player-results/`,
with what each frame really held. A person should look at those: the specs measure geometry and motion,
and cannot say that a player looks right.

Timings include the 3 seconds the spec waits before pressing play, as a viewer would
pause. They come from one network on one day, and without a window Chromium decodes in
software; compare with `test:e2e:player:headed` before relying on one.

Providers answer differently by browser and by blocker, so read a result with its mode,
named at the top of `player-summary.md`. On 2026-11-06 KinoGo served a series through
`stravers.live` with a window and through `nextembed.ws` without one. Its next-episode
controls worked on the first and not on the second, and with a window but no uBlock the
same series never started, apparently waiting on its ad loader. AnimeGo showed about a minute of ads
over the start of an episode without uBlock, and none with it.

While a balancer refuses a source, specs that need it skip or use another source, and
`player-summary.md` shows why. [`docs/TASKS.md`](../../docs/TASKS.md) lists the sources
in that state.

## Rating dialogs outside the film page

`rating-open.spec.cjs` and `rating-save.spec.cjs` cover the film page. The other two places that save a rating
have their own unit tests, and this rig does not exercise them:

- Ratings closes its dialog at once and writes in the background, rolling back on
  failure, so it has nothing to wait for. `ratingsPageState` covers its double-press
  guard.
- The popup's edit dialog has its own guard and shows failures. `popupAuditFixes`
  covers both.

## Reading the numbers

- Without a window, Chromium paints in software. Layout and appearance are
  reliable, but timings run about two to three times slower than in a visible
  browser. Confirm a timing with `test:e2e:headed`. That mode opens a window and
  skips the screenshot comparison, because a GPU paints text differently.
- A window also changes layout, by fractions of a pixel. It follows the system's
  display scale, which `deviceScaleFactor: 1` does not override, and it has
  scrollbars. At 125% a 1px border takes 0.8px and a 1100px page is 1094px wide.
  Compare sizes unrounded: 454.4 and 454.65 round to 1px apart.
- Page state changes results as much as rendering does: the first load after
  signing in behaves differently from later ones. When comparing two runs, make
  sure they measure the same load.
- Times such as "dialog appears after 130 ms" come from a local emulator. They
  show that a wait exists and compare runs; they do not predict real network time.
- A detector reports what moved, not whether it matters. The film page's 30px
  move is a harmless empty box, which only the filmstrip revealed. Look before
  concluding.
- A quiet layout-shift report does not prove nothing moved. While a page fades in,
  the browser rarely reports a move: Films moved 146px on every guest load and was
  reported once in 60 loads, yet in all 15 with the fade off. To check that something
  holds its place, read the place on every frame with `__e2eMotion.startTrack`, as
  the guest tests in `specs/nav-first-load.spec.cjs` do.

## Adding a journey

Use `test` from `lib/fixtures.cjs`: it provides `extension`, `motion` and a signed-in
`page` that has already saved what a returning user has: auth token, Home cache,
personal preview and name. `test.use({ startSignedIn: false })` starts from a blank
page as a guest instead, as `specs/nav-first-load.spec.cjs` does. Wrap each
interaction in `motion.record` or a navigation in `motion.pageLoad`, assert on the
returned report, and add `toHaveScreenshot` at moments of rest. Invented data goes in
`lib/catalog.cjs`. Screenshot only settled states, and check a new assertion by
breaking the page once and seeing it fail.

To wait for something in storage, poll `stored` with `expect.poll`.
`page.waitForFunction` takes a returned promise as a truthy answer, whatever it
resolves to, so it returns at once.
