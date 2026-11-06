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

Not covered: the toolbar popup and side panel, third-party sites and their
content scripts, live video players, Cloud Functions.

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

- The first Home load after signing in moves the nav items sideways (by 105px and
  then 39px on the search control), with or without a window. Later loads are
  stable. The journey measures a later load, so this does not fail it.

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
