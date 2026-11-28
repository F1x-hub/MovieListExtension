# «Сеанс» for Android TV: risk register

Pre-mortem written on 2026-11-27, before the worker sessions started. It assumes the
project failed or had to be redone and works backwards to the causes. Each entry gives
likelihood/impact (H/M/L), what goes wrong, how to see it early, the mitigation and the
owner module. The coordinator owns `:core:model`, the Gradle files and this register's
contract items; "extension" means the Chrome extension in the repository root.

Checked facts this register relies on (re-check if they matter and look stale):

- All versions pinned in `gradle/libs.versions.toml` exist in Google Maven / Maven Central
  (checked 2026-11-27). AGP 9.1.1 and the libraries are not in the local Gradle cache yet;
  the first build downloads them. Installed SDK platforms: `android-34`, `android-36`,
  `android-37.0`; build-tools 34-36; JDK 17 and 21.
- Firebase: only the web app `1:532518163829:web:36a6a62a14adc188f1af3c` is registered
  (`firebase apps:list`). The web API key answers Identity Toolkit and Firestore requests
  with no Referer and with an Android package header, so it carries no referrer or app
  restriction. Authorized auth domains: `localhost`, `movielistdb-13208.firebaseapp.com`,
  `movielistdb-13208.web.app`, `hosted-movie-list.vercel.app`. `gcloud` is not installed,
  so API-level key restrictions were not listed. No client or function uses App Check.
- TV (adb, read-only): `armeabi-v7a,armeabi`, `low_ram=true`, heap growth limit 128 MB
  (`heapsize` 224 MB), SDK 34, Mali GPU with GLES 3.2, `wm size` override 1280x720 on a
  1920x1080 panel, density 213, MemAvailable about 250 MB, WebView 157, GMS 26.45,
  private DNS off, 2.3 GB free on `/data`. A second adb device (`0O65825F33200F2B`) is
  attached: always pass `-s 192.168.1.9:5555`.

---

## 1. Build and toolchain

**B1. compileSdk 37 does not resolve** (M/M). The platform is installed as `android-37.0`
(new minor-version naming); `compileSdk = 37` may look for `android-37` or warn that AGP
9.1 does not support it. Detect: the first `gradlew :core:model:assembleDebug`.
Mitigation: the coordinator runs one clean build before any worker starts; if it fails,
use `compileSdk { version = release(37) }` or drop to 36. targetSdk 35 is fine for a
sideloaded TV app. Owner: coordinator.

**B2. AGP 9 built-in Kotlin misused** (M/H). Applying `org.jetbrains.kotlin.android`,
using the removed `kotlinOptions {}` block, or a plugin that still needs the old variant
API (the `google-services` and Crashlytics Gradle plugins among them) breaks
configuration of every module at once. Detect: configuration errors in all modules.
Mitigation: no worker adds plugins; compiler flags go in `kotlin { compilerOptions {} }`;
Firebase is configured in code with `FirebaseOptions` (no `google-services.json`, no
plugin). The KGP pin in the root `buildscript` stays equal to `kotlin` in the catalog.
Owner: coordinator.

**B3. Release-only crashes from R8** (H/H). Full-mode R8 (AGP 9 default) strips
reflection targets: Firestore `toObject()` POJO mapping, enum `valueOf` on names from the
network, Media3 extension loading by class name. Debug builds pass, release dies on the
TV. Detect: install a minified release build (debug-signed) on the TV at every module
acceptance, not just at the end. Mitigation: no `toObject()`/`@PropertyName` mapping:
read `DocumentSnapshot.data` maps into data classes by hand or decode with
kotlinx.serialization; each library module ships `consumer-rules.pro` for anything it
loads reflectively; `assembleRelease` is part of acceptance. Owner: every module; gate:
coordinator.

**B4. One broken module breaks everyone's build** (H/M). `:app` depends on all modules
and Gradle configures all of them; a worker mid-edit with a compile error in a shared
module (`:core:model`, `:core:network`, `:core:designsystem`) stops the other four.
Detect: unrelated compile errors in another session's build. Mitigation: workers build
and test only their own module (`gradlew :sources:testDebugUnitTest`), keep shared-module
edits small and compiling at every save, and only the coordinator builds `:app`
end to end. Owner: all sessions.

**B5. 32-bit device and APK** (L/M). No native libraries are planned, so `armeabi-v7a`
costs nothing; a later native dependency (an FFmpeg Media3 extension, a JNI DNS library)
without a v7a build would install but crash on load. Detect: `unzip -l app-release.apk |
grep lib/`. Mitigation: any dependency with `.so` files needs coordinator approval and a
v7a build; keep the abiFilters. Expected release APK 15-25 MB; above 40 MB investigate.
Owner: coordinator.

**B6. Concurrent Gradle runs in one folder** (H/L). Five sessions running Gradle in the
same root contend for `.gradle/` locks and the daemon, so builds wait or time out.
Mitigation: one Gradle invocation at a time per session, `--offline` after the first
successful sync, and no `clean` by workers (it deletes other modules' outputs mid-build).
Owner: all sessions.

## 2. Low-memory device

**M1. ExoPlayer buffer exceeds the heap** (H/H). `DefaultLoadControl` sizes its target
buffer from the selected tracks, up to about 128 MB for video, and `DefaultAllocator`
allocates it as Java `byte[]` on a 128 MB heap. High-bitrate 1080p/HEVC streams OOM after
a minute of playback. Porting the extension's 300 s back buffer would make it certain.
Detect: `adb shell dumpsys meminfo app.seans.tv` during 10 min of a 1080p stream; Java
heap must stay under about 80 MB. Mitigation: `DefaultLoadControl.Builder()
.setTargetBufferBytes(32-40 MB).setBufferDurationsMs(15_000, 30_000, 2_500, 5_000)
.setPrioritizeTimeOverSizeThresholds(false)`, back buffer 0-10 s; constants in one place
in `:player`. Owner: `:player`.

**M2. Two decoders at once** (H/H). Low-RAM TV SoCs often allow one video decoder
instance. A preloaded next-episode player, a trailer on the Home hero, a hover preview
or a second player created before the first is released fails with a codec
initialisation error, or the TV kills the app. Detect: logcat `MediaCodec` / `OMX`
errors when switching source or episode. Mitigation: exactly one `ExoPlayer` in the
process, owned by `:player`; switching source or episode reuses it with a new
`MediaItem`; release it in `onStop` (Android TV guidance); no video on Home or Details in
v1. Owner: `:player`, `:app` for Home/Details.

**M3. Image memory** (M/M). Backdrops decoded at full size (a 1920x1080 ARGB bitmap is
8 MB), several rows of posters, plus Coil's memory cache sized from a 128 MB memory
class. Detect: `dumpsys meminfo` Graphics and Native lines while scrolling Home; jank in
`dumpsys gfxinfo app.seans.tv`. Mitigation: every request sets an explicit size (posters
about 240x360 px, heroes at most 1280x720, stills about 320x180); request sized URLs
from the CDN (TMDB `w342`/`w780`/`w300`, Kinopoisk/Yandex size suffixes); one
`ImageLoader` in `:app` with memory cache at 15% of the memory class and a 100 MB disk
cache, built on the shared OkHttp client (see N1). Owner: `:app`, `:core:designsystem`.

**M4. Leaks between screens** (M/H). Firestore snapshot listeners, the player and
coroutine scopes outlive their screen; the back stack (Home → Details → Player) keeps
everything alive. Memory grows each film until the LMK kills the app. Detect: open and
leave ten titles and the player, then compare `dumpsys meminfo` with the start; LeakCanary
in debug builds is acceptable. Mitigation: flows are collected with
`collectAsStateWithLifecycle` and exposed with `stateIn(WhileSubscribed(5_000))`;
listeners are `callbackFlow` with `awaitClose { registration.remove() }`; no screen holds
the player. Owner: all UI modules; gate at acceptance.

**M5. Process death while in the background** (H/M). With `low_ram=true` the app is
killed shortly after the viewer presses Home. `onDestroy` never runs, so progress
flushed there is lost, and navigation restores into a screen whose in-memory state is
gone. Detect: `adb shell am kill app.seans.tv` while backgrounded, then reopen.
Mitigation: progress flushes on `ON_STOP` (`ProcessLifecycleOwner` is already a
dependency); navigation arguments are small and serializable (`PlaybackRequest` is), and
a restored player screen resolves its stream again. Owner: `:player`, `:app`.

**M6. Compose cost on 4x A55** (M/M). Blur (`Modifier.blur`), large alpha layers,
per-second recomposition of the whole Home (the «Эфир» card's progress bar) and unstable
list items drop frames at 720p. Detect: `dumpsys gfxinfo app.seans.tv framestats`; more
than 5% janky frames while scrolling rows is a fail. Mitigation: gradients instead of
blur; the ticking clock lives in a small leaf composable; list items take stable,
immutable models (the `@Serializable` data classes are stable if their lists are); use
`LazyRow`/`LazyColumn` from compose-foundation with `key`s, never the deprecated
`androidx.tv:tv-foundation` lazy lists. Owner: `:app`, `:core:designsystem`, `:live`.

**M7. Firestore SDK footprint** (M/M). The default persistent cache (100 MB) and many
listeners cost memory and serve stale data at startup. Mitigation: set
`PersistentCacheSettings` to about 20 MB once, before the first Firestore call (see F5);
at most three live listeners at a time (cinemaChannel, cinemaSchedule, bookmarks).
Owner: `:app` (init), `:data`, `:live`.

**M8. Slow cold start** (H/M). The debug skeleton (fake graph, one Text) took 10.6 s to
display. Debug Compose is slow on its own, but on four A55 cores and TV flash a release
build without a profile can still take 4-6 s, and a baseline profile in a sideloaded APK
is only applied after `ProfileInstaller` runs (it is not in the dependencies yet).
Detect: `am start -W` on a release build after `cmd package compile -m speed-profile -f
app.seans.tv` and without it. Mitigation: budget of 3 s for a release cold start to the
first frame of Home; add `androidx.profileinstaller` and a baseline profile before v1;
`SeansApp.onCreate` does no I/O beyond building objects (Firebase init is lazy, no disk
reads, no network); Home draws its frame before Firestore answers. Owner: coordinator
(dependencies, profile), `:app`.

## 3. D-pad focus and navigation

**D1. Focus lost after returning to a screen** (H/M). Coming back from Details or the
player puts focus on the first row or nowhere, instead of the card the viewer left.
Detect: Home → open the 5th card of row 3 → Back. Mitigation: `Modifier.focusRestorer()`
on each row and on the column of rows, a saved "last focused key" per screen in the
ViewModel, and a `FocusRequester` that requests focus only after the item is placed
(`LaunchedEffect` keyed on data, or `onPlaced`; requesting before attachment throws).
Owner: `:app`, `:core:designsystem`.

**D2. Initial focus on empty or loading screens** (H/M). With nothing focusable (rows
still loading, guest with empty lists, no sources), D-pad presses do nothing and the
viewer is stuck; Back may exit the app. Detect: launch with the network off and as a
guest. Mitigation: every screen has a focusable element in every state (a «Повторить»
button on errors and empty states); empty rows are not rendered rather than rendered
empty. Owner: `:app`, `:player`, `:live`.

**D3. Focus traps** (M/M). The side rail, the player's episode drawer and the source
panel take focus and never give it back, or let focus escape behind an overlay onto the
video. Mitigation: overlays use `focusGroup()` with explicit `focusProperties { exit }`;
a drawer closes on Back and returns focus to the button that opened it. Owner: `:app`,
`:player`.

**D4. Back semantics** (M/M). Back must close the topmost overlay, then leave the screen;
on Home it should not exit on the first press while the rail is closed. In the player
Back first hides controls. Detect: a scripted run of `adb shell input keyevent 4` on each
screen state. Mitigation: one `BackHandler` per overlay layer, documented order in the
`:app` brief. Owner: `:app`, `:player`.

**D5. Remote and CEC media keys bypass the broadcast lock** (H/H). The remote's
play/pause, HDMI-CEC from the TV remote and Google Assistant ("пауза") reach the
`MediaSession`, not the D-pad handlers, so a viewer can pause or seek a locked broadcast.
Detect: on Live press the remote's pause and say "перемотай вперёд". Mitigation: in
broadcast mode wrap the player in a `ForwardingPlayer` that removes
`COMMAND_PLAY_PAUSE`, `COMMAND_SEEK_*` and the seek-related commands, and ignore
`KEYCODE_MEDIA_*`; after any pause (audio focus loss, `onStop`) re-sync to the channel
clock instead of continuing. Owner: `:player` (mode), `:live` (clock).

## 4. Firebase on Android

**F1. Android SDK on the web app config** (L/H). Auth and Firestore work with
`FirebaseOptions.Builder().setApiKey(...).setProjectId("movielistdb-13208")
.setApplicationId("1:532518163829:web:36a6a62a14adc188f1af3c")`; the key is unrestricted
(checked). Analytics, Crashlytics, FCM and App Check need a registered Android app.
Detect: a spike on the TV reads `settings/cinemaChannel` and `signInWithCustomToken`s a
test token before `:data` is built on it. Mitigation: v1 uses manual options from
`:app`; registering an Android app later (owner action, console) only swaps the app ID
and allows a separate Android API key. Never put a Kinopoisk/TMDB key next to it.
Owner: `:app` (init), `:data`.

**F2. Someone restricts the web API key** (L/H). Restricting the shared key to HTTP
referrers or to Android apps breaks the extension or the TV. Mitigation: when an Android
app is registered, give it its own key; note in `AGENTS.md` that the web key is shared
by the extension and the TV. Owner: coordinator (doc), owner (console).

**F3. App Check** (L/H). Not enforced anywhere today. Enforcing it on Firestore or the
functions would break the extension (no App Check client) and the sideloaded TV (Play
Integrity rejects apps not installed from Play). Mitigation: record that App Check must
stay unenforced while the TV is sideloaded, or use the debug provider with a registered
token. Owner: owner; documented by coordinator.

**F4. Auth semantics differ from the extension** (H/H). The extension signs in with
Google only and signs out pending and rejected users at every entry point; the
contract's `signInWithEmail(email, password)` has no counterpart (Google users have no
password; whether the Email/Password provider is enabled is unknown), and `Guest` users
cannot call `kinopoiskProxy`, which requires an ID token, so Search and Details fail for
guests. Detect: the guest path and a pending account on the TV. Mitigation: drop
`signInWithEmail` from v1 (the mockup's «Войти по почте» becomes the QR/code flow only);
decide guest scope (Live and TMDB-backed browsing only, or Firebase Anonymous Auth, which
the owner would have to enable); after every sign-in and app start read `users/{uid}`
and sign out when `approvalStatus` is not `approved` (a missing field is legacy-approved,
as in the rules). Owner: coordinator (contract), `:data`.

**F5. Firestore initialised twice or too late** (M/H). `:data` and `:live` both use
Firestore; `setFirestoreSettings` after the first use throws `IllegalStateException`, and
`FirebaseApp.initializeApp` with manual options must run before either touches it.
Mitigation: `SeansApp.onCreate` (`:app`) initialises FirebaseApp and Firestore settings
once and passes `FirebaseFirestore`/`FirebaseAuth` instances through `AppGraph`; modules
never call `getInstance()` themselves. Owner: `:app`; contract: coordinator.

**F6. Stale cache shown as live** (M/M). With persistence, the first snapshot of
`settings/cinemaChannel` or `cinemaSchedule` comes from disk and can show yesterday's
broadcast as on air. Mitigation: `:live` treats `metadata.isFromCache` snapshots as
provisional (no player mount until a server snapshot or 3 s), and uses
`Source.SERVER` for one-off reads. Owner: `:live`.

## 5. Firestore rules and data (read from `rules/firestore.rules`)

What the v1 screens read, and whether the rules allow it:

| Data | Rule | TV verdict |
|---|---|---|
| `users/{uid}` | own read always; others only for approved users | OK (needed for the approval check) |
| `favorites` (`where userId ==`) | read: true; writes: approved owner | OK. This is the bookmarks source; `watchlist` and `watching` are deprecated |
| `ratings` (`where userId ==`, `{uid}_{kp}`) | read: true | OK for «Ваша 10» |
| `movies/{kp}` | read: true | OK; the TV must never write it (R3) |
| `settings/cinemaChannel`, `cinemaSchedule` | read: true | OK, guests included |
| `settings/cinemaScheduleState` | admins only | Do not read; not needed by viewers |
| `seriesEpisodeRatings/{uid}_{kp}` | own `get`, `list: false` | OK by ID only |
| `seriesEpisodeStats`, `tmdbKinopoiskMappings` | public / signed-in read | OK |
| `liveRelay` | signed-in read | Not used in v1 |
| progress, device sign-in | no collection exists | Needs new rules (R4, S1) |

**R1. Bookmarks modelled as a separate watchlist** (H/H). The briefs say
"watchlist/watching", but `FavoriteService` (`favorites`, doc ID `${uid}_${movieId}`, one
`status` per film: `watching`, `plan_to_watch`, `favorite`, `watched`) is the only
source. The contract's `setInWatchlist(ref, inList)` is lossy: adding «Буду смотреть» to
a film marked `favorite` overwrites its status, and removing deletes the document and
the favorite with it. Mitigation: replace with `bookmarkStatus(ref)` and
`setBookmarkStatus(ref, status?)`; «Буду смотреть» is `status == plan_to_watch`; writes
copy `FavoriteService.addToFavorites`' full field set (`movieTitle`, `posterPath`,
`releaseYear`, `kpRating`, ... `createdAt`/`favoritedAt` only on create,
`updatedAt` server time) so the extension's Bookmarks page still renders them. The row
reads posters and ratings from the bookmark documents themselves, which costs no
Kinopoisk quota. Owner: coordinator (contract), `:data`.

**R2. Writes need an approved user** (M/M). Every write to ratings, favorites,
collections and movies requires `isApprovedUser()`; a TV signed in as a pending user
gets `PERMISSION_DENIED`. Mitigation: F4's approval check; map `PERMISSION_DENIED` to
`UNAUTHORIZED` with a clear message. Owner: `:data`.

**R3. The TV corrupts shared extension data** (M/H). The rules let approved users write
`movies/{kp}` metadata, ratings and bookmarks; the extension's DTO cache relies on
schema markers and on never replacing a complete title with a partial one, and
`aggregateMovieRatings` reacts to every rating write. A TV writing its own shapes breaks
extension pages for everyone. Mitigation: v1 is read-only on `movies`, `ratings` and
everything except `favorites` (R1) and the new collections it owns (R4, S1); rating from
the TV, if added later, ports `RatingService`'s exact payload and canonical ID. The owner
is an admin, so the TV must also never run admin-only paths: no writes to
`settings/cinemaChannel`, no `setMovieDuration`, no schedule edits. Owner: `:data`,
`:live`.

**R4. Progress has nowhere to sync** (H/M). No collection or rule exists for progress;
`users/{uid}/settings/*` is owner-writable without validation or approval and would hit
the 1 MB document limit, so it is not a sync target. See P1 for the decision and shape.
Owner: coordinator; rules and deploy: `:data` with owner approval.

**R5. Missing composite indexes** (M/M). A new query shape (for example `favorites`
`where userId == X where status == Y orderBy updatedAt`) fails with
`FAILED_PRECONDITION` in production only. Existing indexes cover `favorites
(userId, favoritedAt desc)`, `ratings (userId, createdAt desc)` and a few more
(`rules/firestore.indexes.json`). Mitigation: reuse the extension's query shapes
(`favorites` by `userId` only, sorted on the client, as `FavoriteService.getFavorites`
does); any new index goes into `rules/firestore.indexes.json` and is deployed before the
TV build that needs it. Owner: `:data`.

## 6. QR / device-code sign-in

**S1. Flow and storage** (M/H). Mitigation, as the design to build: `tvLoginStart`
(unauthenticated) creates a 256-bit random `deviceCode` (returned only to the TV, stored
as its SHA-256) and a short `userCode` (6 characters from an alphabet without
0/O/1/I/L, shown as «K7Q·4MD»), expiring after 10 minutes, in a server-only collection
(`tvLogins`, rules `allow read, write: if false`, explicit like `watchRooms`).
`tvLoginApprove` requires a Firebase ID token of an approved user and binds that UID to
the user code. `tvLoginPoll` (TV, by `deviceCode`) returns `pending`, `slow_down`,
`expired` or, once, a custom token, and deletes the record in the same transaction.
The TV calls `signInWithCustomToken`. Cleanup: a scheduled function, or a Firestore TTL
policy on `expiresAt` (console setting, owner). Owner: `:data` (function and TV client).

**S2. Custom-token minting fails on first deploy** (H/H). No function in this project
mints custom tokens yet. On Gen 2 functions `createCustomToken` needs
`iam.serviceAccounts.signBlob` on the runtime service account (the role "Service Account
Token Creator" on itself) and the IAM Service Account Credentials API; without it the
first real sign-in fails with `auth/insufficient-permission`. Detect: a dry run against
the deployed function with a test account before the TV build depends on it. Mitigation:
the owner grants the role (console) before the deploy; the function logs a clear error
code. Owner: `:data`; IAM: owner.

**S3. Brute force, phishing and abuse** (M/M). A 6-character code is about 29 bits; the
approve endpoint is authenticated, so guessing a code only signs a stranger's TV into
the attacker's own account. The real threat is device-code phishing (a victim is talked
into approving an attacker's code). Mitigation: rate-limit approvals per UID (5 wrong
codes per 10 minutes) and polls per device code (honour `pollIntervalSec`, answer
`slow_down`); the approval screen names the device («Телевизор TCL», time of the
request) and needs an explicit «Это мой телевизор»; codes are single use; set
`maxInstances` low on the three functions to cap cost; never log codes or tokens.
Owner: `:data`.

**S4. Where «Войти на ТВ» lives and where the QR points** (M/M). The mockup's QR points
at `seans.app/tv`, which is not an authorized auth domain and may not be owned. A phone
cannot run the extension, so the QR needs a web page. Mitigation: the extension's entry
is the «Телевизор» section of Settings (`src/pages/settings/TvLoginPanel.js`, moved off the
profile so only someone who means to sign in a TV goes there), with the 6-character input (the popup
closes when it loses focus, so it is a poor place for typing a code); the QR opens a
small page on Firebase Hosting, `https://movielistdb-13208.web.app/tv?c=<userCode>`,
that signs in with Google (authorized domain) and calls `tvLoginApprove`. A Hosting deploy
publishes the whole `public/` folder of the default site (`player/`, `tv/`); the updater's
archives live on a separate site (`movielistdb-13208-updates`, `firebase.updates.json`) and
are not affected. These are extension
and server changes: lint, `npm run test:visual-design`, functions tests and a README
Unreleased entry apply. Owner: `:data` (agreed with the coordinator, since these files
are outside `android-tv/`).

**S5. Revoking one TV** (L/M). `revokeRefreshTokens(uid)` signs out every device of the
user, the extension included. Mitigation: v1 accepts this; tokens carry a
`device: 'tv'` claim so a later per-device denylist is possible. Owner: `:data`.

## 7. Provider sources from native code

**N1. DNS: the router cannot resolve provider hosts** (H/H). The router's DNS fails on
`seasonvar.ru` and `hdrezka.co`, and CDN hosts behind them are likely affected too;
private DNS is off. Anything that bypasses the DoH client (Media3's
`DefaultHttpDataSource`, `HttpURLConnection`, Coil's default fetcher, a WebView) uses the
system resolver and fails. If the router answers with a wrong address rather than an
error, a "system first, DoH on failure" order never falls back. Mitigation: one OkHttp
client in `:core:network` with `DnsOverHttps` first (Cloudflare with bootstrap
`1.1.1.1`/`1.0.0.1`, Google `8.8.8.8` as second), system DNS last, and a small TTL
cache; ExoPlayer uses `OkHttpDataSource.Factory(client)`, Coil uses
`OkHttpNetworkFetcherFactory { client }`. Acceptance greps the code for
`DefaultHttpDataSource`, `HttpURLConnection` and `openConnection`. Firebase keeps its own
stack (Google hosts resolve). Owner: `:core:network` (`tv-sources`), `:player`, `:app`.

**N2. HARD RULE: the linkpp aggregator network** (L/H, catastrophic if it happens). The
aggregator behind Alloha/Veoveo tokens (`linkpp`, `kinopoisk.cx`, `troutcdn`) blocks an
IP address for about 30 minutes after one request that does not look like a browser's;
the TV and the owner's PC share that address. Nobody may reach it from tests, scripts,
fixture capture or the app. Mitigation: the shared OkHttp client gets an interceptor that
throws for any host containing `linkpp`, `kinopoisk.cx` or `troutcdn`, with a unit test;
`KpBalancerAccess.ask()` and the Alloha/Veoveo sources are never ported without the
owner's review; the brief of every session repeats this rule. Owner: `:core:network`,
every session.

**N3. Cleartext HTTP for Seasonvar** (H/M). Seasonvar's base URL is
`http://seasonvar.ru`; Android blocks cleartext by default, and only `:app`'s manifest can
set `networkSecurityConfig`. Mitigation: `res/xml/network_security_config.xml` in `:app`
permits cleartext for `seasonvar.ru` only (plus any media host proven to need it, added
on request from `:sources`); try `https` first. Owner: `:app` on request from
`:sources`.

**N4. Required headers and anti-bot** (H/H). The extension's requests carry Chrome's
User-Agent, TLS fingerprint and declarative Referer rules: AnimeGo JSON needs
`X-Requested-With: XMLHttpRequest`; Kodik's embed page and `/ftor` must be sent with
**no** Referer (a foreign one makes `/ftor` fail) and its manifests are accepted only
from `solodcdn.com`; the Kodik frame itself is opened with Referer `https://animego.me/`.
OkHttp's default `okhttp/5.x` UA and its TLS fingerprint can be refused by DDoS-Guard or
Cloudflare even with a browser UA. Detect: before porting a parser, one manual smoke
request per provider from the TV (search page, one JSON call) and a check that the body
is not a challenge page. Mitigation: a fixed desktop Chrome UA for provider requests,
the same UA on media requests (some CDNs bind tokens to it), headers per provider as in
the JS, challenge pages mapped to `PROVIDER_BLOCKED`; a hidden-WebView fetch (Chrome TLS)
is the fallback only if a provider is shown to block OkHttp. Owner: `:sources`.

**N5. Signed URLs expire mid-playback** (H/M). Kodik streams are cached 10 minutes in
the extension; Seasonvar and Rutube links are signed too. After a long pause or a seek
far ahead the CDN answers 403/404/410. Mitigation: `:player` maps
`InvalidResponseCodeException` 401/403/404/410 to `STREAM_EXPIRED`, calls
`SourceResolver.resolve()` again and seeks back to the position, at most twice, then
offers the next source; `PlayableStream` is never persisted. Owner: `:player`, `:sources`.

**N6. Kodik qualities are separate manifests** (M/M). `/ftor` returns one HLS manifest
per quality, not a master playlist, so ExoPlayer cannot adapt; a stall on a weak link
never steps down. Mitigation: `:sources` returns the qualities; `:player` starts at the
highest that fits and steps down one level on repeated rebuffering, never overriding a
quality the viewer picked (as the extension's `watchStalls` does). Owner: `:sources`,
`:player`.

**N7. Rutube is user uploads** (M/M). A search hit can be a trailer, a different film
or a compilation; Rutube has no reliable season/episode model; some videos are
geo-blocked or DRM. The contract marks Rutube `RELIABLE`, so completion would mark
episodes watched on a wrong video. Mitigation: keep the extension's scorer and year gate;
treat Rutube as `RELIABLE` for position only, never for auto-next or automatic
"watched" marks; add a capability flag (see C5). Owner: `:sources`, coordinator.

**N8. Parser drift with no fixtures** (H/M). Providers change markup weekly; ports
written against live pages break silently, and tests that hit live providers are flaky
and risk blocks. Mitigation: unit tests run on saved fixtures in
`sources/src/test/resources` (captured once by hand or from the extension, cookies and
tokens stripped; never from the linkpp network), mirroring the JS tests
(`tests/seasonvar*.test.js`, `tests/animegoParser.test.js`,
`tests/kodikStreamResolver.test.js`, `tests/rutubeParser.test.js`); live smoke runs are
manual, on the TV, one request per provider. Owner: `:sources`.

**N9. v1 sources cannot play most films** (H/H). Seasonvar has series only, AnimeGo
anime only, Rutube random uploads. Most films (the mockup's «Интерстеллар» hero and
most «Буду смотреть» posters) and most «Эфир» broadcasts will show «нет источника».
The sources the extension uses for films (KinoGo, Ex-FS, Collaps, Alloha) are web players
outside v1. Detect: take the owner's 30 most recent bookmarks and the next week of
`cinemaSchedule` and check which have a v1 source, before UI work is judged. Mitigation:
an owner decision now: accept it for v1 and say so in the UI, or pull forward one
film source. Collaps by Kinopoisk ID (`/embed/kp/<id>`, Venom balancer, not the linkpp
network) is the best candidate for a native or WebView port. Owner: owner decision;
coordinator.

## 8. Kinopoisk and TMDB

**K1. Shared Kinopoisk quota** (H/H). `kinopoiskProxy` calls `api.poiskkino.dev` with
the same key pool the extension uses; daily quotas are small. A TV that fetches details
for every focused card, or searches on every keystroke, exhausts the pool and breaks the
extension for the day (`KP_QUOTA_EXHAUSTED`, six-hour breaker). Detect: count proxy
calls per screen in debug logs. Mitigation: never call Kinopoisk on focus; Details first
reads `movies/{kp}` (public) and a TV disk cache (7 days), then the proxy once; search
waits 600 ms after typing and needs at least 3 letters, with results cached; rows use
data already in Firestore documents (bookmarks carry poster and ratings); map
`KP_QUOTA_EXHAUSTED` to `QUOTA_EXHAUSTED` and stop retrying for six hours. Owner:
`:data`.

**K2. Proxy access from a native client** (L/M). `kinopoiskProxy` accepts a request with
no `Origin` header and requires a Firebase ID token (any signed-in user, approval not
checked). `tmdbProxy` accepts requests with no `Origin` and checks **no** token: the TV
can use it as a guest, and anyone can use it today (a pre-existing exposure, not a TV
blocker; report, do not fix in this project). No provider key may appear in the APK, in
`BuildConfig`, resources or logs. Detect: `rg -n "poiskkino|api.themoviedb.org/3.*api_key|Bearer ey"
android-tv`. Owner: `:data`; the TMDB proxy gap goes to the owner.

**K3. Wrong TMDB identity for episodes** (M/M). Kinopoisk's `externalId.tmdb` is not
unique and can be wrong (agent.md, "Identity, caches and aggregation"); taking it blindly
shows another series' seasons and stills. Mitigation: use `tmdbKinopoiskMappings`
(verified) when present, otherwise the extension's candidate rules, otherwise no TMDB
episodes (source episode lists still work). Owner: `:data`.

**K4. Series detection** (H/M). `MediaType.fromExtension` treats only `tv-series`/`tv`
as series. Kinopoisk also returns `animated-series`, `mini-series`, `tv-show`, and
`anime`/`cartoon` can be either; anime series become films, lose their episodes and save
progress with no episode. Mitigation: classify like `src/shared/utils/MediaClassifier.js`
and `KinopoiskService` (`isSeries` boolean first, then type); add a
`MediaType.fromKinopoisk(type, isSeries)` to the contract. Owner: coordinator, `:data`.

## 9. Player, progress and Live invariants

**P1. Progress: local now, sync-ready shape** (H/M). Today progress lives only in the
extension's `chrome.storage.local` (`watching_progress_{kpId}`: one record per title
with `season`, `episode`, `timestamp` and `duration` in seconds, `completed`,
`providerId` such as `seasonvar`, `updatedAt` in ms) plus a separate local episode
history. The mockup's sign-in text promises «место, где вы остановились, — то же, что в
расширении», which needs the extension to write a shared store too.
Recommendation: v1 keeps progress on the TV only (no rules, no extension change) and
changes the sign-in copy accordingly; the local store already uses the future shape so a
sync adds a transport, not a migration:
`watchProgress/{uid}_{kpId}` = `{ userId, movieId: int, mediaType: 'movie'|'tv-series',
latest: { season: int|null, episode: int|null, timestamp: int (s), duration: int (s)|null,
completed: bool, providerId: string|null, voiceId: string|null, updatedAt },
episodes: { "S:E": { t: int, d: int, c: bool, u } } (at most 300 entries, oldest
pruned), updatedAt, schemaVersion: 1 }`. Films use `latest` with null season/episode and
no `episodes`. Keys follow `seriesEpisodeRatings` (`season:episode`). Rules when sync
lands: owner-only get, `list` only with `userId == auth.uid`, writes by approved owner
with the shape validated, an index `(userId, updatedAt desc)` for «Продолжить».
Cloud writes every 60 s and on pause/stop/episode change (local stays at 15 s), which
keeps one viewer under about 300 writes per evening. Merge per episode by newest
server `updatedAt` (the TV clock can be wrong), `completed` monotonic for the same
episode, never a 0 over a real position. Owner: coordinator (decision, contract),
`:data` (store), `:player` (writer).

**P2. Progress semantics drift from the extension** (M/H). The rules to keep, from
"Selection and progress": films have null season/episode; Season 0 is valid and never
leads into Season 1; writes throttled to 15 s and flushed at once on pause, end, source
switch, episode change (old episode first), exit and destroy; a mount that has not
played never writes 0; a report without an episode is saved under the canonical one;
completion only from `RELIABLE` sources, 90% for content over 120 s and a real `ended`
below; auto-next needs a reliable source with direct episode support and a real
`ended`, and any lifecycle change cancels its countdown; a new episode starts at its
selection's position once the old one is flushed. Mitigation: `:player` is the only
writer of progress; unit tests port the extension's cases
(`tests/playbackProgressEpisodeIdentity.test.cjs`,
`tests/playbackSwitchPendingProgress.test.cjs`); `completed` stays true for the same
episode on later writes (as `ProgressService.saveProgress` does). Owner: `:player`.

**P3. Explicit selection loses to stored progress** (M/M). An episode picked in Details
or the drawer, a provider switch or a «Следующая серия» must override stored progress
and any preloaded state; a provider switch keeps the canonical season/episode; async
progress reads are revalidated against the current selection before seeking. Mitigation:
`SelectionReason` drives start position; a selection version is checked after every
`suspend` point before it touches the player. Owner: `:player`.

**P4. Progress keyed by the whole `TitleRef`** (M/M). `TitleRef` includes `mediaType`
and a nullable `tmdbId`; a store keyed by the data class misses or duplicates a title
when one caller knows the TMDB ID and another does not. Mitigation: the store keys only
by `kinopoiskId` (and `EpisodeKey`); state this on `ProgressRepository`. Owner:
coordinator, `:data`.

**L1. Port of the channel clock and resolution logic** (M/H). Live correctness depends
on porting `CinemaChannelService` exactly: server time from the HTTP `Date` header of a
`HEAD https://firestore.googleapis.com/` (three samples, lowest RTT, +500 ms for the
1-second resolution, ignore offsets under 1 s); `resolveChannel` (a held paused item
wins, the latest started item wins, a fixed slot holds until `endsAt`, the next upcoming
item shows its countdown); `computePosition` anchored on `playbackStartedAt` when set,
not on `startedAt` (`startedAt` is only the grid boundary); `lengthIsExact`. The TV
clock may be minutes off until NTP syncs. Mitigation: Kotlin tests reuse the vectors of
`tests/cinemaChannel.test.cjs`, `tests/liveProgramme.test.cjs`,
`tests/liveStandby.test.cjs` and `tests/liveSchedulePlanner.test.cjs`; never use
`System.currentTimeMillis()` directly for channel maths. Owner: `:live`.

**L2. Lock and drift** (M/H). Viewers cannot pause or seek; the extension corrects drift
by seeking only, with 3 s tolerance for viewers and 1 s while paused
(`player-cleaner.js`, `BROADCAST_DRIFT_SEC`). A broadcast is not personal viewing: it
writes no progress, and personal progress never picks the broadcast episode. A series
broadcast plays only the scheduled episode; a source that cannot confirm it shows an
error rather than another episode. Mitigation: a broadcast mode in the playback request
(C3) that disables progress writes, auto-next, the episode drawer and seeking (D5), and
re-seeks when drift exceeds 3 s. Owner: `:player` (mode), `:live`.

**L3. YouTube broadcasts have no TV player** (H/M). `cinemaChannel.mode == 'youtube'` is
a normal programme item; ExoPlayer cannot play YouTube. Mitigation: owner decision:
v1 shows a «Сейчас в эфире YouTube» card without playback, or plays it in a WebView
through the existing Hosting wrapper `public/player/embed.html` with controls and
keyboard disabled. Owner: owner decision; `:live`.

**L4. Data the mockup shows that does not exist** (H/L). «12 смотрят» has no source (no
live presence in Firestore); «Друзья: 9.2» and «Популярное у друзей» assume a friends
graph that does not exist (the closest data is the community average
`movies/{kp}.avgRating` and `getMoviesByAvgRating`); checkmarks on watched episodes
come from the extension's local episode history, which the TV cannot read. Mitigation:
`viewers` stays null and hidden; rename "friends" to "community" in the contract (C6);
watched marks come from TV-local data only. Owner: coordinator, `:app`.

**L5. Voice search hint** (M/L). Holding the remote's mic button opens Google
Assistant, not the app. Mitigation: drop the hint in v1, or add a mic button that
launches `RecognizerIntent.ACTION_RECOGNIZE_SPEECH` (no `RECORD_AUDIO` permission
needed for that intent). Owner: `:app`.

## 10. Process risks

**X1. Five writers in one folder** (H/H). No worktrees (owner rule). Sessions overwrite
each other's files, edit shared files (Gradle, `:core:model`, `README.md`,
`.agents/rules/agent.md`, `rules/firestore.rules`, `functions/index.js`), or run
`git add -A` and commit someone else's half-done work; the repository root already has a
large set of unrelated uncommitted extension changes. Mitigation: each session edits only
its module folder; shared files are coordinator-only, and workers ask for changes by
message; commits name explicit paths only; no `git stash`, `reset`, `checkout`, `clean`;
the TV is used by one session at a time through `android-tv/tv-lock.txt` (already
ignored). Owner: coordinator; every session.

**X2. Cross-module ownership that will collide** (H/M). `:core:network` belongs to
`tv-sources` but `:data`, `:player` and `:app` (Coil) need it; `:live` depends on
`:player`'s API, which does not exist yet; network security config and manifest
permissions are `:app`'s; the device sign-in work touches `functions/`, `rules/`,
`public/` and `src/pages/profile/`. Mitigation: freeze the `:core:network` API (one
`OkHttpClient` provider, the host denylist, UA constants) before workers start; put the
broadcast-mode player API in `:core:model` (C3) so `:live` does not wait for `:player`;
name the extension-side files the data session may touch. Owner: coordinator.

**X3. Markdown files invisible to git** (H/L). The root `.gitignore` ignores `*.md`
except a whitelist; `android-tv/AGENTS.md` and this file stay untracked until
`!android-tv/**/*.md` is added or they are added with `git add -f`. Owner: coordinator.

**X4. Secrets copied into the app** (L/H). `serviceAccountKey.json` and
`update-signing-private.pem` sit in the repository root; a session looking for "the
Firebase config" may copy one into `android-tv/`. A release keystore must not be
committed either. Mitigation: `android-tv/.gitignore` adds `*.jks`, `*.keystore`,
`*.pem`, `serviceAccountKey*.json`, `google-services.json`; acceptance runs
`rg -l "private_key|BEGIN [A-Z ]*PRIVATE KEY" android-tv`. The web API key in
`FirebaseOptions` is public (already shipped in the extension) and is allowed. Owner:
coordinator; checked at every acceptance.

**X5. README changelog and docs** (M/L). `AGENTS.md` requires an Unreleased entry for
every meaningful change; five sessions editing `README.md` at once conflict. Mitigation:
only the coordinator edits `README.md` and `.agents/rules/agent.md`, from the workers'
reports; extension-side changes (Settings «Телевизор», functions, rules) get their own
entries. Owner: coordinator.

## 11. Testing on the real TV

**T1. How each module proves itself** (M/M). Common: `adb -s 192.168.1.9:5555` always
(a second device is attached); install by the session holding `tv-lock.txt` only;
logcat with `--pid=$(adb shell pidof app.seans.tv)`; screenshots with
`adb exec-out screencap -p`; memory with `dumpsys meminfo app.seans.tv`; frames with
`dumpsys gfxinfo app.seans.tv framestats`. `adb reverse` works over adb-over-Wi-Fi and
serves a local HTTP server or the Functions emulator to the TV.
- `:core:network`: unit tests for DoH order, the linkpp denylist and UA; on the TV,
  `seasonvar.ru` resolves through DoH while system DNS fails.
- `:sources`: fixture tests per parser; one manual smoke per provider on the TV.
- `:player`: plays `tests/fixtures/hls-vp9` served through `adb reverse`, a Seasonvar mp4
  and a Kodik HLS; progress flush on pause/stop/kill; 10 minutes of 1080p under the
  memory budget (M1); release build.
- `:data`: unit tests with MockWebServer; on the TV, a public read of
  `settings/cinemaChannel`, the device sign-in against the Functions emulator, then once
  against the deployed function; approval check with a pending account if the owner
  provides one.
- `:live`: ported JS vectors; on the TV, a test slot scheduled by the owner from the
  extension (the TV cannot write), checked for position against the extension's live page
  within 3 s, and for the lock with remote, CEC and voice (D5).
- `:app`: focus walk-through (D1-D4) on each screen and state with screenshots; a guest
  and an offline launch; Home scroll jank budget (M6).
Owner: each module; acceptance by this reviewer.

---

## Contract and brief changes this register asks for

Numbered for reference from the review replies.

- **C1** `AuthRepository`: remove `signInWithEmail`; document `Unknown` vs `SignedOut`;
  the approval check (F4) lives in `:data`; decide `continueAsGuest` semantics.
- **C2** `LibraryRepository`: replace `watchlist()`/`setInWatchlist` with bookmark status
  (`BookmarkStatus { WATCHING, PLAN_TO_WATCH, FAVORITE, WATCHED }`, extension values as
  serial names), source `favorites` (R1).
- **C3** `PlaybackRequest`: add a broadcast mode (`broadcast: BroadcastLock?` with the
  channel anchor in server time and a clock offset source) that disables progress, seek,
  pause, auto-next and the drawer (L2, D5); add `SelectionReason.BROADCAST`.
- **C4** `ProviderId`: persisted and synced IDs use the extension's lowercase strings
  (`seasonvar`, `kodik`, `animego`, `rutube`, `collaps`, `kinogo`); store `providerId` as
  a `String` in `PlaybackPosition`, so an unknown ID from the extension or a later
  version never fails decoding.
- **C5** Source capabilities: add `supportsEpisodes`/`supportsAutoNext` (or keep
  Rutube's confidence for completion `OPAQUE`) so Rutube never auto-advances or marks
  episodes watched (N7).
- **C6** `Ratings.friends` and `CatalogRepository.popularAmongFriends()`: rename to
  `community` / `popularInCommunity()`, backed by `movies.avgRating` (L4).
- **C7** `TitleRef`/`EpisodeKey`: keep the `require` checks but add `ofOrNull(...)`
  factories and use them for all network and Firestore data; a bad document must drop a
  row item, not crash the app.
- **C8** `MediaType.fromKinopoisk(type, isSeries)` following `MediaClassifier` (K4).
- **C9** `ProgressRepository`: keyed by `kinopoiskId` only (P4); `completed` monotonic
  per episode; positions persisted in the P1 shape.
- **C10** `AppGraph`: carries the initialised `FirebaseAuth`, `FirebaseFirestore` and the
  shared `OkHttpClient`, so no module calls `getInstance()` or builds its own client
  (F5, N1).

## Skeleton review (2026-11-27)

`assembleDebug` passes (22 MB debug APK) and the skeleton starts on the TV. Findings:

- `SeansHttp`:
  - The "IP literal" shortcut (`host.firstOrNull()?.isDigit()`) sends every host name that
    starts with a digit (`1tv.ru`, `2embed...`) to the router's DNS. OkHttp never calls
    `Dns` for IP literals, so the check can go; keep only `localhost`/`.local`. (N1)
  - No linkpp denylist interceptor yet. (N2)
  - The client carries the 20 MB HTTP cache, so ExoPlayer segments and Coil images
    passing through it would evict DoH and API entries and write video to flash. Expose a
    `mediaClient = client.newBuilder().cache(null).build()` for `OkHttpDataSource` and
    Coil (Coil has its own disk cache). (M1, M3)
  - The Chrome UA is applied to every request, proxies included; harmless. Media requests
    keep the same UA, which some CDNs bind tokens to; good.
- Manifest: no `networkSecurityConfig` yet (N3, needed before Seasonvar works); no
  `android:banner` (320x180), so the Google TV launcher shows a plain icon tile (nit);
  `largeHeap="false"` is right while M1's buffer budget holds.
- `FakeGraph` is the pattern workers will copy, and it carries three issues: the device
  login URL is `seans.app/tv` (S4), progress is keyed by the whole `TitleRef` (P4), and
  Live shows `viewers = 12` with no real source (L4). It also sits in `main` of
  `:core:model` and is the release graph until modules are wired; keep it out of the
  release graph at v1.
- Contracts: unchanged since this register was written; C1-C10 still apply.

## Module reviews

- **`:sources` + `:core:network`, 2026-11-27.** Accepted with one blocking fix: Collaps
  voices are rendition indexes, and the index order differs between episodes (the
  module's own `collaps/series.html`), so the next episode can play another dub. A TV run
  of the four smokes is still owed (N4). Should fix: an AnimeGo episode-page failure
  caches a truncated list; a re-resolve after `STREAM_EXPIRED` returns the provider's
  cached URL (asks for `resolve(..., fresh)` in the contract); DoH has no short timeout;
  Seasonvar keeps `http://` episode links. Tests: 61 run, 4 smoke skipped, 0 failed.
  The full review is in the session notes (`tv-risks-review-sources.md`).
- **`:app` + `:core:designsystem`, 2026-11-28.** Accepted with one blocking fix: Details
  builds its `SourceQuery` without `isAnime`/`seasonEpisodeCounts`, so AnimeGo/Kodik is
  never offered; the correct builder is `internal` to `:player` and should move to
  `:core:model`. The release figures (3.3 MB, 0.8-2.0 s, PSS 79 MB) were measured on
  `FakeGraph`, where R8 drops Firestore, Media3 and the parsers, so M1/M3/M8 are re-measured
  after wiring. Should fix: Details judges sources by the latest-progress episode instead of
  the selected one; `DemoGraph`/`FakeData` are in the release dex (inert). Release manifest
  and NSC are clean. Notes: `tv-risks-review-app.md`.
- **`:sources` update, 2026-11-28.** The TV smoke ran (all four providers on Android's TLS
  stack; DDoS-Guard did not challenge OkHttp), which closes that item of N4. The Collaps
  voice fix and the should-fix items are still open.
- **`:player`, 2026-11-28.** Accepted; nothing blocking in its own code (35 tests pass).
  The Collaps voice bug and the Details query reach the player from other modules. Still
  owed on the real graph: `am kill`, real streams, 10 minutes of 1080p (Collaps VP9 DASH),
  a release build. Should fix: the personal player accepts a stream confirmed for another
  episode (the broadcast refuses it); re-resolve gets cached URLs until `resolve(fresh)`
  exists; the broadcast's per-second `play()` retakes audio focus. The wired `SeansApp`
  touches `FirebaseAuth.getInstance` on the main thread (a SharedPreferences read); measure
  the release cold start before changing anything. Notes: `tv-risks-review-player.md`.
- **Re-check, 2026-11-28.** `:sources` accepted: Collaps voice IDs are normalized names
  mapped to each episode's track (fixture test: LostFilm track 2 in S1, 1 in S2); an AnimeGo
  page failure fails the lookup; `resolve(..., fresh)` bypasses every provider cache and both
  players pass it on retry; DoH `callTimeout` 4 s; Seasonvar `http` links upgraded; one
  voice-fallback rule documented on `SourceResolver.resolve`. `:app` fixes landed: Details
  uses `SourceQuery.forTitle` and asks for the selected season's episode; `DemoGraph` moved to
  `src/debug` with a release stub; the release dex (4.0 MB APK, real graph) carries no demo or
  fake strings. The personal player now refuses a stream confirmed for another episode.
  Tests: network 13, sources 55 (4 skipped), app 10, player 38, 0 failed.
- **`:player` re-check, 2026-11-28.** Real-graph run on the TV (release): cold start median
  548 ms, Collaps VP9 1080p in hardware, `am kill` restores position and voice, 10 minutes of
  1080p at 39-40 MB live heap / ~104 MB PSS; fixes 4-6 verified. One new blocking issue: the
  3-second grace for a better provider can play a lower-ranked source over the viewer's
  explicit pick. Its trigger, the 16 s wait, comes from `:sources` emitting nothing for
  providers that skip a query; they should answer `Failed(UNSUPPORTED)` at once, and Details
  should pass `preferredProvider` only for an explicit pick. Not yet run on the TV: Seasonvar
  MP4, Kodik, a real DASH → HLS fallback, `BroadcastPlayer`.
- **`:player` re-check 2, 2026-11-28.** Accepted (player 46, sources 59 tests). The player
  waits for the viewer's preferred provider before any grace; `:sources` answers
  `Failed(UNSUPPORTED)` for skipped providers; Details sends only an explicit pick. Should fix:
  the new "no episode from an episode provider fails" guard makes Seasonvar single-page series
  (`guessedSeason`) unplayable; Collaps should not offer a film page for a series query;
  `seekTo` can throw for media under 1 s. Process (X1): a background lock loop survived
  `TaskStop` on Windows and installed over another session's build; no background lock loops.
- **`:data` + TV sign-in, 2026-11-28.** Accepted; nothing blocking (data 36 tests,
  functions tests and lint, profile test, visual-design pass). S1/S3 hold: a hashed 256-bit
  device code, a single-use 10-minute user code, approval only by approved non-TV accounts,
  rate limits, `maxInstances: 2`, nothing secret logged. The REST `runQuery` reads only
  public `movies`. Should fix: `progress.json` is written without fsync, so a power cut can
  wipe all progress silently; the start limiter trusts the client's `X-Forwarded-For`
  (deployed); the Profile dialog can approve an abandoned code on out-of-order responses.
  Not verified: production sign-in (IAM role pending), the real popup on `/tv`, the dialog
  in both themes. Notes: `tv-risks-review-data.md`.
  Re-check: all three fixed (durable `JsonFile` with `.bak`/`.corrupt`, caps 200 × 100; a
  request ID in the dialog; the last `X-Forwarded-For` entry plus a global cap of 30
  starts/min). `req.ip` would be worse (`trust proxy` makes it the client's leftmost entry).
  That the last entry is Google's on the `cloudfunctions.net` path is still unproven: 11
  starts with rotated fake `X-Forwarded-For` values must end in a 429. Both-theme
  screenshots of the dialog checked. Accepted.

## Gaps in `android-tv/AGENTS.md` (as read on 2026-11-27)

The file already covers ownership, the TV lock, the linkpp rule, secrets, deploys and
checks. Missing, and each would cause rework if left to the workers:

- The TV writes nothing shared except `favorites` and its own new collections: no
  `movies` metadata, no ratings in v1, no admin paths even though the owner is an admin
  (R3).
- Kinopoisk quota discipline: no calls on focus, debounced search, Firestore and disk
  cache first (K1). `tmdbProxy` needs no ID token; only `kinopoiskProxy` does (K2).
- One `ExoPlayer` in the process and the buffer budget (M1, M2); SurfaceView output.
- "All HTTP goes through `SeansHttp`" should name ExoPlayer (`OkHttpDataSource`) and Coil
  explicitly (N1); cleartext domains are added by `:app` on request (N3).
- Completion and auto-next need a `RELIABLE` source with direct episode support, and a
  broadcast writes no progress (P2, L2).
- Firebase is initialised once in `:app` with manual `FirebaseOptions`; modules receive
  the instances (F5).
- `*.md` under `android-tv/` is git-ignored until whitelisted (X3).
- The sign-in screen copy must not promise shared progress until P1's sync exists.
