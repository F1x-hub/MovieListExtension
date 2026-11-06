# Remaining work

What is still open after the first-load fixes and the removal of the old list pages.
Last reviewed on 2026-11-06. Delete an entry once it is done; the README changelog
records what was finished.

## Do first

- **Run the whole browser rig on the final code:** `npm run test:e2e`, then
  `npm run test:e2e:headed`. The last full pass (43 of 43 in both modes) came before
  the Settings language list spec, the dropdown CSS removal and the replacement of the
  old list pages. Since then only the Settings specs and `list-pages.spec.cjs` have
  run. `npm test` and `npm run lint` passed after the last code change.
- **Find out why `tests/hdrezkaProviderBrowser.cjs` fails now and then.** `pretest`
  starts with it, so one failure stops the whole of `npm test`. So far it has failed
  only under load:

  | Load | Failures |
  | --- | --- |
  | none | 0 of 10 |
  | 3 parallel copies | 1 of 12 |
  | 5 parallel copies | 1 of 10 |

  All three failures seen so far are in the manual «Повторить поиск HDRezka» step: the
  click timing out (line 448), the wait for the video to play (line 449), and an
  automatic fallback firing where none should (line 455). The last one may be a real
  race in the product rather than in the test. The cause has not been found.

## Bugs users can see

- **Films added from external sites do not reach Bookmarks.** The watchlist buttons on
  HDRezka, Kinopoisk, IMDb, Kinogo, ZFilms and Ex-FS write the old `watchlist`
  collection (`addToWatchlistViaAPI` in `src/background/background.js`), and Bookmarks
  reads only `favorites`. Fix the write first. Moving films already saved there is a
  write to the production database and needs its own decision; nobody has counted them.
- **Collections can be missing from the card menu on Ratings.** For a user with a
  collection, the section appeared in 1 load of 10. The list may be read before the
  session is known; this has not been confirmed.
- **A rating deleted in another tab can still show in the film page's dialog.** A read
  returns `null` both for a missing rating and for a failed read, and the dialog keeps
  the rating it knows.
- **Settings sections grow after the first paint, and a name only Firestore knows moves
  the navigation bar once.** Both are described under "Known open defects" in
  [`tests/e2e/README.md`](../tests/e2e/README.md).
- **The language list in very short windows.** Below about 400px high, the upper option
  can sit under the header when the page is scrolled to the end; scrolling up reveals
  it. This comes from the geometry, and no test covers it.

## Rig reliability

- **A 23px snap when the rating dialog opens** was seen once and not reproduced. It
  matches the arithmetic of the `scale(0.9)` entry, but that is unproven, and it could
  rarely fail `home-to-rating.spec.cjs` under load.
- **Emulators left running.** After a headed run a Firestore emulator stayed alive and
  held port 8180, which can stop the next run from starting. The cause is unknown.
- **`spawn UNKNOWN` when launching Chrome** happened once in a Settings test and not in
  the three runs after it. The cause is unknown.
- **The signed-in Home has no strict check on Films.** The 1px limit in
  `nav-first-load.spec.cjs` applies to guests only.
- **`tests/` is not linted.** `npm run lint` covers `src` and `content-scripts`. ESLint
  run directly reports one old `no-empty-pattern` on `({}, use)` in
  `tests/e2e/lib/fixtures.cjs`.

## Not checked outside the rig

The rig runs Chromium against Firebase emulators, so these have not been seen working:

- Signing in through the real toolbar popup (the rig opens `popup.html` in a tab),
  Google sign-in, and real Firebase network delays.
- The rating dialog opening at once in a visible window and on a real network. The hint
  for a slow read has been asserted by a test but not looked at on screen.
- Button widths on Settings when the real font loads: the rig blocks Google Fonts.
- The first Settings load after an extension update, when the saved language differs
  from the browser's.
- Whether an old Favorites, Watchlist or Watching link flashes an empty page before it
  reaches Bookmarks.

## Possible cleanup

Each of these needs a decision first.

- **Collection** could redirect like the other old pages. Bookmarks has collections
  built in, and the only direct link found is the redirect from old Ratings addresses.
- **Search's `?sourceUrl=` view and `movieModal`.** No link to that view was found in
  `src`, `content-scripts` or the manifest.
- **`search.css`** is still loaded by Collection and Ratings for rating-modal
  compatibility. See the search compatibility boundary in
  [`.agents/rules/agent.md`](../.agents/rules/agent.md).
