# Remaining work

What is still open after the first-load fixes and the removal of the old list pages.
Last reviewed on 2026-11-06. Delete an entry once it is done; the README changelog
records what was finished.

## Do first

- **Run the browser rig in a visible window:** `npm run test:e2e:headed`. Without a
  window, `npm run test:e2e` passed 57 of 57 after the external-site controls were
  removed, and `npm test` and `npm run lint` passed on the same code. The last headed
  pass (43 of 43) came before the Settings language list spec, the dropdown CSS removal
  and the replacement of the old list pages.
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
- **The old `watchlist` collection.** Films saved by the removed buttons on external
  sites stay there and do not appear in Bookmarks; nobody has counted them. Moving or
  deleting them is a write to the production database. `WatchlistService` still has
  users: the navigation count, Profile, Search and `RatingService`.
- **`web_accessible_resources`** still exposes `libs/*.js`, `src/shared/firestore.js`,
  the shared services and several pages to every site through `<all_urls>`. The removed
  site scripts loaded those files into host pages. What is left may need far less, but
  `player-cleaner.js` and the provider frames must be checked before narrowing it.
