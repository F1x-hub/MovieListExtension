# Remaining work

What is still open after the first-load fixes and the removal of the old list pages.
Last reviewed on 2026-11-06. Delete an entry once it is done; the README changelog
records what was finished.

## Do first

- **Make `home-guest-card.spec.cjs` pass in a visible window.** On 2026-11-07
  `npm run test:e2e:headed` passed 59 of 61 at 125% display scale. Both failures are this
  spec at 639px, where the card stays a row; nothing overflows or is clipped, and the spec
  passes 2 of 2 without a window. A window's width turns fractional at that scale, so
  `max-width: 639px` probably misses it; the width itself was not read.
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
- **The language list in very short windows.** Below about 400px high, the upper option
  can sit under the header when the page is scrolled to the end; scrolling up reveals
  it. This comes from the geometry, and no test covers it.

- **A Kinopoisk page answer is thrown away when Kinopoisk adds `?socialAlias=` after the
  hash.** `content-scripts/kinopoisk-search-scraper.js:599` cuts the request ID only at
  `&`, so the background ignores the result, the slot stays busy for 8 seconds and the
  card gets no rating. Seen twice in a real browser, on film 6469214.

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

- **The balancer's next move.** A new domain is followed without a release, but the frame
  scripts, the Referer rules and the host permission are lists in `manifest.json` and
  `src/background/provider-embed-rules.json`. Until the domain is added there, films play
  through the balancer's own player with its ads. `BalancerDomains` logs `The balancer
  moved` when it happens. Covering every `.ws` host would avoid this, at the price of
  running the frame scripts on sites that have nothing to do with films, so it needs a
  decision.
- **A series on KinoGo through the balancer's own frame.** `KinogoAdapter` counts only
  `stravers.live`, `allarknow.online` and `stloadi.live` as able to change episodes, and the
  series tried (Breaking Bad, The Simpsons) all came through `stravers.live`, where
  «Следующая» works. A series with only the balancer's frame has not been seen: it would
  say it cannot open the episode, though Ex-FS changes episodes on that same player.
- **«Следующая» on KinoGo stayed black once.** S1E2 of Breaking Bad showed `0:00 / 0:01` for the
  26 seconds the run waited. It did not return in 17 later presses, and nothing recorded whether
  that window was visible. Chrome loads no media for a hidden page that has played nothing yet,
  which explains the other stalls seen, but this frame had just played S1E1, and pressing
  «Следующая» in a minimized window worked. The cause is unknown.
- **VidSrc** did not answer from this network in any run. `vidsrc-embed.ru` and
  `vidsrc-embed.su` are silent; `vsembed.ru` answers with a page that showed only black in a
  frame, and `vidsrc.me` redirects to an unrelated host. It now runs last, so it costs
  nothing while another source works. Nobody has tried from another network.
- **A balancer move loses the positions kept in its frames.** They live in that site's storage,
  and the page's own position (`watching_progress_`) is never sent to a frame. Sending it at the
  start would keep a viewer's place across moves.
- **The picture at the start** differs a lot: Rutube 1280×720, KinoGo 854×480, Seasonvar
  722×406, HDRezka 640×360, the balancer 864×486. HDRezka starts at its 480p variant by
  design. Whether the others could start higher has not been checked.
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
