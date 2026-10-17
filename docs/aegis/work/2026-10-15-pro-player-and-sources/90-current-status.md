# Current implementation and verification

Date: 2026-10-16. Worktree: `C:/Users/irakl/.codex/worktrees/pro-player-t0/MovieListExstension`.
Branch: `codex/pro-player`. No commit, push, publication or version change.

Transfer update: on the owner's explicit request, the complete implementation was
transferred to `D:/Programing/JS/Projects/MovieListExstension` on 2026-10-16. The
127 changed/copied files were verified against the worktree; pre-existing unrelated
local files were preserved and overwritten files were backed up. The worktree/branch
above identifies the original implementation environment, not Chrome's loaded path.
Chrome loads the primary checkout; reload the extension and open fresh page tabs
after updating. Enable the optional Watch interface using the browser-local admin
switch. No browser flag is automatically changed by copying or building files.

Primary-checkout verification passed: full `npm test` including `test:pro-player`
(`test-36936.log`), lint (`run-lint-14172.log`), build (`run-build-41612.log`),
media-player (`run-test_media-player-26504.log`), watch-room
(`run-test_watch-room-33076.log`) and the actual isolated Chromium Watch fixture
in both themes at 1366/400. Logs are in the existing local temporary verification
directory. `git diff --check` passed; the generated indexed ruleset changed by
fixture loading was restored. The daily Chrome profile was not reloaded or modified.

## Implemented and locally verified

| Plan area | Result | Evidence |
| --- | --- | --- |
| B / E1 | Default-off local admin flag; Watch alias and source popover; separate torrent; exact source values; room/explicit/preference/last/default priority; AnimeGo anime default; bounded fallback and stale guards | `test:pro-player`, actual Chromium `test:player-watch-smoke`, dark/light 1366/400 screenshots |
| A3 | Narrow host/resource/extension-initiator header rules in the new ruleset | Unit contracts plus actual compiled Chromium positive/negative matching |
| A6 / A7 | Bounded Kodik decode and checked URLs; closed diagnostic categories | Decoder regressions and hostile error/URL tests; historical logging remains a separate audit |
| C3 | Adapter-derived capability, readiness and canonical identity snapshot; unsupported track capabilities explicitly unknown | Capability tests; this is not proof of track compatibility |
| C4 | One expired-link refresh per logical source attempt; physical request single-flight; stale/movie/episode/room guards; repeated-403 cooldown | Coordinator and factory/page integration tests, including nonfatal key/fragment errors and refresh chains |
| C2 | Bounded seven-day local aggregates; cross-page Web Lock; exact/approximate/unknown TTFF; diagnostics copy/reset | Metrics concurrency/privacy tests, dialog tests and Chromium fixture |
| D1–D4 | Automatic quality label; scoped primary-media shortcuts/Media Session; seek/menu ARIA and focus; canonical RU/EN catalogue and lifecycle labels | Controls tests; isolated-world Chromium locale import and live relabel without remount |
| D5 / D6 | Extract settings DOM, volume/rate state, subtitle appearance model, full GhostPlayer preview owner, timeline calculations; volume classes/tokens | Existing assertions preserved, characterization tests and actual decoded hover-preview smoke |
| D7 | Per-title stable voiceover/quality preferences preserving legacy innerId; unavailable dub episode does not silently switch episode | WatchPreferences/title tests plus existing AnimeGo/Seasonvar suites |
| T-G | Offline aggregate analyzer and predeclared sample/identity/anchor protocol | `playerTrackStudy.test.cjs`, [protocol](track-study.md); no real sample yet |
| T-S | Bounded network/credential/approval/WAR findings report without secret values | [Network and security audit](remaining-network-audit.md); remediation is outside this player change |

The earlier accepted T0/A1/A2/A4 and controlled-HLS A5 increment remain recorded in
their individual evidence files. A1 enables no provider sandbox. A5 protects the
controlled HLS path; native MP4, tracks and provider frames retain the accepted
limited guarantee. The separate URL-assignment inventory documents these exceptions.

## Checks

- Full `npm test`, including its existing pretest, passed after runtime integration.
  The new `test:pro-player` group also passes and is now included in pretest.
- `npm run lint`, `npm run build`, `npm run test:media-player` and
  `npm run test:watch-room` passed. Existing recovery/selection assertions were retained;
  old cleaner harnesses now load its real extracted dependencies.
- Fresh isolated Chromium Watch, locale, settings-menu and controlled-HLS smokes
  passed. Controlled HLS observed actual frames and zero forbidden endpoint hits.
- Offline health uses the production Kodik resolver and actual fixture playlist/
  container bytes. Its `available` status covers only that declared fixture scope.

Node 24.18.0 and bundled Chromium were used locally. Node 22 workflow execution,
authenticated installed MovieDetails, real providers and hardware remain distinct.
The workflow added here is manual-only, offline and read-only; it was not published
or run on GitHub. Earlier targeted independent reviewers found issues that were
fixed; account usage limits prevented a fresh complete third final review. Do not
claim three clean final reviews for this combined increment.

## Remaining gates — not completed

User follow-up: the installed profile returned valid diagnostics JSON (three
KinoGo readiness responses and unknown first-frame measurements). This confirms
the report opens/collects data; unknown is not evidence of playback failure. The
panel now presents a readable localized summary with secondary JSON disclosure,
and consumes native-dialog Tab/Escape before the underlying page modal stack.
Focused tests cover the real stack class and the supplied unknown-measurement
case; Chromium fixtures cover the summary in both themes at 1366/400. The Watch
switch still defaults off. The browser tool refused access to the actual
chrome-extension page under its protocol policy, so no installed-profile change
or live verification is claimed, and no alternate browser surface was used.

1. **G2 live/provider/device:** actual provider sandbox compatibility, widget
   navigation, installed/authenticated Watch flow, embedded preferences, codec/PiP/
   hardware and real CDN playback/seek. The browser site-safety policy explicitly
   blocked the Seasonvar tab; do not work around that refusal.
2. **C1 operational monitoring:** offline and separate bounded live runner code and
   a manual fixture workflow exist. The live runner was tested only through injected
   fixture transport; it requires explicit flags and a private reference file. A safe
   live reference corpus, actual execution, schedule and issue deduplication are not
   configured. See [execution boundary](source-health.md). No credentials, external
   reports or scheduler were created.
3. **E1.5/G4:** real sample collection and synchronization evidence are absent.
   The empty sample reports null prevalence. E2/E1c remain deferred by the approved
   plan; no dual decoder or speculative cross-provider track controls were added.
4. **D5 scope:** volume styling is extracted; provider/runtime geometry and other
   inline styles remain. D6 extracts the listed owners/models, not every UI closure
   from the cleaner. Further movement requires the corresponding characterization
   and provider evidence; do not describe this as a complete monolith rewrite.
5. **A5h:** port 3579 has no literal consumer in the bounded search, but configurable
   MediaPlayerService origins exist. Keep permissions until actual client usage is
   established. No permission removal based solely on a negative text search.
6. **G7:** release, default-on rollout, external monitoring and deployment are
   separate actions. The flag remains off and version remains 1.3.7.

This is substantial implementation with local acceptance evidence, not completion
of all live, operational and release gates in the roadmap.
