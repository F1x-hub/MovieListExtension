# Сеанс for Android TV — working rules

Native Android TV app for the owner's TCL Google TV. These rules add to the repository root
`AGENTS.md`. Where the two disagree inside `android-tv/`, this file wins. Several sessions work
in this folder at once; the rules below keep them out of each other's way.

## Target device (measured over adb, 2026-11-27)

- TCL G13, Android 14 (API 34), MediaTek MT5867, **32-bit only (`armeabi-v7a`)**.
- About 954 MB RAM, 220–320 MB free, `ro.config.low_ram=true`, **heap limit 128 MB**.
- 1920x1080 panel, but the UI renders at 1280x720 at density 213, so **design in 960x540 dp**.
  The safe area is 48 dp left and right, 27 dp top and bottom.
- Hardware decoders: AVC, HEVC, VP9 and AV1. HDR10 and HLG. WebView 157.
- The router's DNS cannot resolve `seasonvar.ru` or `hdrezka.co`. All HTTP goes through
  `SeansHttp` (`:core:network`), which resolves over DNS-over-HTTPS.
- A cold start of the debug skeleton took 10.6 s. Judge speed on a release build with R8 and a
  baseline profile, never on debug.
- adb: `C:/Users/irakl/AppData/Local/Android/Sdk/platform-tools/adb.exe -s 192.168.1.9:5555`.

## Modules and owners

| Module | Owner session | Contents |
| --- | --- | --- |
| `:core:model` | coordinator | Shared data classes, repository interfaces, `FakeGraph` |
| Gradle files (`settings.gradle.kts`, `build.gradle.kts`, `gradle/libs.versions.toml`, every module's `build.gradle.kts`) | coordinator | Ask for a dependency; do not edit |
| `:app` + `:core:designsystem` | `tv-app` | Activity, navigation, Login/Home/Details/Search screens, design-system components |
| `:data` | `tv-data` | Firebase init, auth incl. QR sign-in, Firestore repositories, Kinopoisk/TMDB through the proxies, local progress |
| `:sources` + `:core:network` | `tv-sources` | Kotlin ports of the Seasonvar, AnimeGo/Kodik and Rutube parsers; the HTTP client |
| `:player` | `tv-player` | Media3 player screen, episodes drawer, source and voice switching, progress writes, `BroadcastPlayer` for Live |
| `:live` | `tv-live` | «Эфир»: channel subscription, server-time clock, programme, locked playback, `LiveSummaryProvider` |
| `android-tv/docs/risks.md` | `tv-risks` | Risk register; reviews each module |

- Edit only your own module. If you need a change in another module or in `:core:model`, message
  the coordinator and describe the change exactly. Never patch someone else's files "just to
  compile".
- Keep your module compiling at the end of every batch of edits. Others build the whole app.
- Wiring real implementations into `SeansApp.graph` (replacing `FakeGraph`) is done by the
  coordinator when a module is accepted.

## Contracts

- `:core:model` is the contract: `AppGraph`, `AuthRepository`, `CatalogRepository`,
  `LibraryRepository`, `ProgressRepository`, `SourceResolver`, `LiveSummaryProvider`, plus their
  data classes. Program against these interfaces, not against another module's classes.
- Module entry points already exist as stubs with their final signatures; owners replace the
  bodies, not the signatures:
  - `:player` (`player/.../PlayerApi.kt`): `PlayerScreen(request, graph, onExit)`,
    `BroadcastPlayer(request, lock, clock, graph, onState, modifier, controller)`,
    `BroadcastPlaybackState`, `BroadcastController`.
  - `:live` (`live/.../LiveApi.kt`): `LiveFeature : LiveSummaryProvider` and
    `LiveScreen(feature, graph, onOpenDetails, onExit)`.
- Firebase is initialised once in `SeansApp` (`:app`) with manual `FirebaseOptions` from the
  web app config (`src/shared/firestore.js`; the key is public and shared with the extension).
  `:data` and `:live` receive `FirebaseAuth`/`FirebaseFirestore` through their constructors and
  never call `getInstance()`. App Check stays unenforced while the TV is sideloaded.
- Data from the network or Firestore builds identities with `TitleRef.ofOrNull` and
  `EpisodeKey.ofOrNull`: a bad document drops one item, never crashes the app.
- Navigation arguments are small serializable values (`TitleRef`, `PlaybackRequest`), never
  repositories or lambdas.
- Identity is the Kinopoisk ID (`TitleRef.kinopoiskId > 0`). Films have `episode == null`;
  Season 0 is valid.
- Progress rules (`ProgressRules`) follow the extension: 15 s throttle, an immediate flush on
  pause, end, switch, episode change and exit, never overwrite with 0, 90% completion over 120 s.
  Explicit selections (`SelectionReason` other than `RESUME`) override stored progress.

## Decisions for v1 (2026-11-27)

- **Sources:** Seasonvar (series), Collaps by Kinopoisk ID (films and series; `/embed/kp/<id>`,
  the Venom balancer, not the linkpp network), AnimeGo/Kodik (anime), Rutube (position only).
  Collaps is ported natively first; if it cannot be played without a WebView, `tv-sources`
  reports before building one. KinoGo, Ex-FS, Alloha, Veoveo and HDRezka are out.
- **Sign-in:** QR or a 6-character code approved by a signed-in user of the extension
  (Settings → «Телевизор», or the page `https://movielistdb-13208.web.app/tv?c=<code>` that
  the QR opens). No email/password. «Продолжить без входа» is a local guest mode: Live and public
  data only.
- **Progress:** stored on the TV in the shape of the later `watchProgress` sync (P1 in
  `docs/risks.md`). Nothing in the UI promises that progress is shared with the extension yet.
- **Bookmarks:** the extension's `favorites` collection with its status (`BookmarkStatus`).
  «Буду смотреть» is `plan_to_watch`.
- **Ratings:** KP, IMDb, the user's own score and the community average (`movies.avgRating`).
  There is no friends graph and no viewer count; the UI shows neither.
- **Live YouTube items:** a WebView on the Hosting wrapper `public/player/embed.html`, with the
  wrapper's controls and the remote's play/seek keys disabled.

## Data and quotas

- The TV writes only `favorites` (full field set of `FavoriteService.addToFavorites`) and the
  collections it owns (`tvLogins` through Cloud Functions, later `watchProgress`). It never
  writes `movies`, `ratings`, `settings/*`, schedules or any admin path, although the owner is an
  admin.
- Kinopoisk quota is shared with the extension: no calls on focus; Details reads `movies/{kp}`
  and a local cache (7 days) first, then `kinopoiskProxy` once; search waits 600 ms and needs 3+
  letters; `KP_QUOTA_EXHAUSTED` stops retries for six hours. `kinopoiskProxy` needs an ID token,
  `tmdbProxy` does not.
- Reuse the extension's Firestore query shapes (`favorites` by `userId`, sorted on the client).
  A new composite index goes into `rules/firestore.indexes.json` and is deployed first.
- Firestore: persistent cache about 20 MB, set once in `SeansApp` before first use; at most
  three live listeners at a time; listeners are `callbackFlow` with `awaitClose { remove() }`;
  a first snapshot `isFromCache` is provisional for Live.

## Hard rules

- **Never contact the linkpp aggregator network** (`p.linkpp.ink`, `kinopoisk.cx`, `troutcdn`)
  from code, tests or scripts. One non-browser request blocks the owner's IP for about 30 minutes.
  Alloha and Veoveo are out of scope.
- No provider credentials in the APK. Kinopoisk and TMDB go through the existing `kinopoiskProxy`
  and `tmdbProxy` Cloud Functions with a Firebase ID token.
- Never copy `serviceAccountKey.json`, `update-signing-private.pem` or any other secret from the
  repository root into `android-tv/`.
- Never log tokens, cookies or signed stream URLs (log the host only).
- Respect the 1 GB device:
  - All HTTP through `AppGraph.http` (`SeansHttp`): `client` for API and pages, `mediaClient` for
    ExoPlayer (`OkHttpDataSource.Factory`) and Coil (`OkHttpNetworkFetcherFactory`). Never
    `DefaultHttpDataSource`, `HttpURLConnection` or `openConnection`: they skip DoH.
  - Exactly one `ExoPlayer` in the process, owned by `:player`, reused for a new source or
    episode, released on `ON_STOP`. No video on Home or Details. Buffer budget: target about
    32-40 MB, 15-30 s ahead, back buffer at most 10 s, constants in one place in `:player`.
    SurfaceView output.
  - Images decoded at display size (posters about 240x360 px, heroes at most 1280x720, stills
    about 320x180); one Coil `ImageLoader` in `:app`, memory cache about 15% of the memory class.
  - Flows collected with `collectAsStateWithLifecycle`, exposed with `stateIn(WhileSubscribed(5_000))`.
  - Progress flushes on `ON_STOP`: the low-RAM TV kills the app soon after Home is pressed.
  - `SeansApp.onCreate` builds objects only: no disk or network I/O. Home draws before Firestore
    answers. Budget: 3 s release cold start to Home's first frame.
- Rutube never auto-advances or marks an episode watched (`ProviderId.marksCompletion`).
- No cleartext HTTP in release (`:app`'s `network_security_config.xml`; Seasonvar is HTTPS).
  Debug builds also allow `127.0.0.1`/`localhost` for the Firebase emulators over `adb reverse`.
- `FakeGraph` is only reachable in debug builds through the marker
  `adb shell run-as app.seans.tv touch files/fake-graph`; the real graph is the default.
- UI follows the approved mockup (`temp/tv-mockup/`, screenshots in `temp/tv-mockup/screens/`)
  and `:core:designsystem` tokens. The only circle is a user's avatar. Only the focused control is
  white. No colour in chrome except the KP and IMDb badges and the red «В эфире» dot next to its
  label.

## Shared resources

- **The TV.** Only one session may install or drive it at a time. Take the lock atomically:
  `( set -o noclobber; echo "<session> $(date -u +%FT%TZ) <purpose>" > android-tv/tv-lock.txt )`.
  The write fails if the file exists; then read it and wait. Never overwrite or delete another
  session's lock, never `echo >` without `noclobber`. Only a lock older than 15 minutes may be
  removed, and only after reading it, then taken with the same atomic command. During a long run,
  refresh your own lock every 10 minutes (delete it and take it again) so it never looks stale
  while you are still on the TV. Delete your own
  lock as soon as you are done. Take the lock only when you are about to use the TV, not while
  waiting for a build. Read-only commands (logcat, dumpsys, getprop) need no lock.
  Put every TV action in one script that starts with `set -e` and the atomic lock command, so
  nothing reaches the TV when the lock is not yours; chain with `&&`, never `;`.
  Installing means building the whole app from the current tree; if it fails in another module,
  tell the coordinator instead of fixing it.
- **Leave the TV as the owner uses it.** The owner watches on this TV between checks. Before
  releasing the lock: remove any temporary debug entry, install the release build
  (`./gradlew :app:assembleRelease`, then `adb install -r` of `app/build/outputs/apk/release/app-release.apk`),
  compile it ahead of time (`adb shell cmd package compile -m speed-profile -f app.seans.tv`: a
  fresh install runs on the JIT, which doubled the janky frames on Home), and press Home. A debug build is several times slower (100% janky frames on Home) and is what
  the owner sees as "lag".
- **Gradle.** Prefer module tasks, e.g. `./gradlew :sources:testDebugUnitTest` or
  `./gradlew :player:compileDebugKotlin`. Never run `clean` on the whole project. A full
  `assembleDebug` is for installing.
- **Repository files outside `android-tv/`.** The README changelog, `.gitignore` and
  `.agents/rules/agent.md` are edited only by the coordinator. Report what should go in the
  changelog. `tv-data` may edit the Cloud Function and extension files its brief names.
- **No commits, no branches, no worktrees.** Everyone works in this checkout; the owner commits.
- **Deploys.** The owner allows Firebase deploys. Deploy only what changed (for example
  `firebase deploy --only functions:<name>`), after its tests pass, and tell the coordinator.

## Checks

- Build: `./gradlew :<module>:compileDebugKotlin`. Unit tests: `./gradlew :<module>:testDebugUnitTest`.
- Parsers are tested against saved fixtures under `sources/src/test/resources/`. Tests never call
  live provider sites; live checks are a separate manual command.
- On the TV, prove a screen with a screenshot (`adb exec-out screencap -p`) and logcat. Report
  memory with `dumpsys meminfo app.seans.tv` when a screen holds images or a player.
- When a module is ready, message the coordinator with: what was done, what was checked and how,
  what is unverified, any changelog line, and any contract change needed.
