# Remaining work

What is still open after the first-load fixes and the removal of the old list pages.
Last reviewed on 2026-11-26. Delete an entry once it is done; the README changelog
records what was finished.

## Do first

- **Find out why `tests/hdrezkaProviderBrowser.cjs` still fails now and then.** `pretest`
  starts with it, so one failure stops the whole of `npm test`. Of the three failures seen
  before 2026-11-18, all in the manual «Повторить поиск HDRezka» step, one is explained and
  fixed: under load the first video data came after the 5 s readiness timeout, and the test
  counted the 12 s grace wait that starts then as an automatic fallback (in the product the
  late video stayed «unavailable» and was replaced; that is fixed too). The other two, the
  click timing out and the wait for the video to play, are not explained. One thing to
  check for the click: `populateSourceSelector()` builds the «Повторить поиск HDRezka»
  button anew on every call, and `refreshHdrezkaAccessActions()` calls it on every error
  state of the HDRezka lifecycle, so a late state can detach the button the test is about
  to press.

  | Load | Failures before the fix | After it |
  | --- | --- | --- |
  | none | 0 of 10 | 0 of 2 |
  | 3 parallel copies | 1 of 12 | 1 of 12 |
  | 5 parallel copies | 1 of 10 | not measured |

  The failure after the fix was new: the browser closed while the test took a screenshot of an
  error scenario (`page.screenshot: Target page, context or browser has been closed`,
  line 551). Parallel copies also write the same screenshot files under `artifacts/`.

## Bugs users can see

- **«Смотреть» opened no player once.** In `npm run test:live:player` on 2026-11-07,
  Breaking Bad (404900) stayed on its details page after the press, with the button back
  to normal 40 seconds later, and the source steps failed because the player was closed.
  The next 5 presses on it and Interstellar opened the player. The test records no console
  and does not press twice, so the cause and whether a second press helps are unknown. It
  may be a press during a re-render, a watch run ending silently, or a regression from the
  film page's loading changes in 1.5.0.
- **Collections can be missing from the card menu on Ratings.** For a user with a
  collection, the section appeared in 1 load of 10. The list may be read before the
  session is known; this has not been confirmed.
- **A rating deleted in another tab can still show in the film page's dialog.** A read
  returns `null` both for a missing rating and for a failed read, and the dialog keeps
  the rating it knows.
- **Settings sections grow after the first paint, and a name only Firestore knows moves
  the navigation bar once.** Both are described under "Known open defects" in
  [`tests/e2e/README.md`](../tests/e2e/README.md).
- **The film page is wider than a 390px window.** Its tab row («О фильме», «Актёры»,
  «Награды»…) is 477px wide and does not wrap or scroll, so the whole column, and the
  content of every tab with it, is pushed 46px to the left and cut at both sides. Seen in
  the owner's Chrome with an emulated 390px viewport; the narrowest width where it starts
  was not measured.
- **A prolific Kinopoisk person's later films get their year over several visits.**
  `/v1.4/person/{id}` lists the films without year or type. The person's own Kinopoisk
  page fills them in for its first 50 films at once; the rest come from the film pages
  read for posters, two at a time within the 10-second enrichment window, so a person
  with 250 credits (Matthew McConaughey, `kp:797`) shows some of them without a year,
  sorted last, until later visits have read their pages.
- **The language list in very short windows.** Below about 400px high, the upper option
  can sit under the header when the page is scrolled to the end; scrolling up reveals
  it. This comes from the geometry, and no test covers it.

## Planned features

In the owner's order (2026-11-26). Each needs a mock-up and the owner's go-ahead before
it is built.

1. **Year in review.** A full-screen story the user pages through: hours watched,
   favourite genre, actor and director, the film of the year, the most unexpected score,
   the friend with the closest taste, marathon winners. It ends with a card the user can
   save as a picture. Most numbers are already counted for the profile: `ProfileInsights`
   (genres, decades, people, hours), the activity calendar and `marathonHistory`. When it
   opens, and for which period, is still the owner's call.
2. **Picking a film by swiping, for the company.** Everyone in a room sees the same posters
   and swipes yes or no; a film everyone liked shows as a match. Candidates can come from
   the Random pool or the members' watchlists. Watch rooms already keep shared room state.
3. **Reactions on the timeline.** In a watch room or on Live, reactions are tied to the
   moment of the film; a later viewing shows above the seek bar where the company laughed
   or jumped. Needs a decision on where reactions are stored and how long.

## Film page speed

A real browser's first open from Home took 1289 and 1532 ms before the cache and
Firestore fixes: about 355 ms to start the page, 340 ms for the session, 220–270 ms for
Firestore and 370–545 ms for TMDB. `MovieDetailsPerf` prints this: see
[`movie-details-performance-tracing.md`](movie-details-performance-tracing.md). The fixes
have been measured only in the rig so far.

- **Waiting for the session.** The page asks for nothing until the session is confirmed.
  `tmdbProxy` takes no token and `movies` is publicly readable, so loading could start
  sooner, but the rule that no provider work starts before auth is deliberate and a test
  enforces it. A guest would spend a TMDB request. This needs a decision.
- **123 separate scripts.** Home is bundled by `scripts/bundle-pages.js` and the film page
  is not. Adding it breaks the page: `typeof EpisodeHistoryService` at
  `PlaybackController.js:40` throws inside a bundle, because the class is declared later
  in the same script. There may be more such places, and the gain has not been measured.
- **Loading on hover.** Now possible, since it can use the same cache, but it spends a
  `tmdbProxy` request per hover. Worth deciding after a real-browser measurement.

## Sources worth a look

- **A series on KinoGo through the balancer's own frame.** `KinogoAdapter` counts only
  `stravers.live`, `allarknow.online` and `stloadi.live` as able to change episodes, and the
  series tried (Breaking Bad, The Simpsons) all came through `stravers.live`, where
  «Следующая» works. A series with only the balancer's frame has not been seen: it would
  say it cannot open the episode, though Ex-FS changes episodes on that same player.
- **VidSrc** did not answer from this network in any run. `vidsrc-embed.ru` and
  `vidsrc-embed.su` are silent; `vsembed.ru` answers with a page that showed only black in a
  frame, and `vidsrc.me` redirects to an unrelated host. It now runs last, so it costs
  nothing while another source works. Nobody has tried from another network. On 2026-11-18
  `vidsrc-embed.ru` failed with a TLS error in the owner's Chrome and in Node while `vidsrc.to`
  answered; the player now reports a frame whose site does not open as unavailable and moves on
  instead of showing a blank frame.
- **Rutube plays one video per series.** Its search takes the title only, so on Breaking Bad
  S1E2 it played the 58-minute S1E1; the hint now says the video was found by title. A search
  that names the season and episode was not built.
- **A balancer move loses the positions kept in its frames.** They live in that site's storage,
  and the page's own position (`watching_progress_`) is never sent to a frame. Sending it at the
  start would keep a viewer's place across moves.
- **The start picture of Seasonvar** is 722×406: the one stream it serves.
- **`movieExtension_videoVolume` is 0 in the owner's browser**, so players on the extension's
  own pages (Rutube, Seasonvar, HDRezka, AnimeGo) start muted while provider frames, with
  their own storage, do not. Only the mute button and the volume slider write that value,
  so this is probably a choice made once and forgotten. Worth asking before changing it.

## Rig reliability

- **`npm run test:live:player` waits three minutes on a closed port.** It could test the port
  first and report at once that the switch is off, instead of saying Chrome did not allow the
  connection. Until then, `tests/e2e/README.md` gives the check to run by hand.
- **`tests/sourceRefreshCoordinator.test.cjs` failed once in `npm test`** at line 45, with
  `cooldown` instead of `refreshed`, and stopped the rest of the chain. It then passed 6 of
  6 runs alone and every later full run. The cause has not been looked into.
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
