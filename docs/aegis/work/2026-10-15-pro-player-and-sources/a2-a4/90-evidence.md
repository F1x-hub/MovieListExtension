# A2 / A4 security changes

Date: 2026-10-16. Same owner authorization and isolated worktree as T0.
A2/A4 accepted after correctness, security and test review; no commit/push/release is authorized.

## A2: retired source-change message

The source inventory found three occurrences: MovieDetails receiver, trusted-type
allowlist and Search receiver; no legitimate sender in src/content-scripts.
changeSourceRemovalContract.test.js failed with AssertionError on the two owning
files before removal and passes after all three paths were removed. Other player
message paths, canonical selection/progress and watch-room transport are unchanged.

## A4: settings text boundary

playerSettingsMenuEscaping.test.cjs executes the full cleaner in jsdom with a
hostile active HLS subtitle name. Before the fix it failed AssertionError (one
unexpected img); after the fix the exact string remains text, no img is created,
and the constant chevron icon is preserved. Submenu title interpolation was also
removed. Constant SVG markup remains; no provider text is interpolated into it.

playerSettingsMenuBrowserSmoke.cjs loads a fresh real extension context and the
unmodified cleaner with a synthetic subtitle catalog. Four screenshots in
artifacts/player-settings-escaping cover dark/light at actual 1366/400 px. Menu
bounds and literal hostile text pass. Media decoding is covered by T0 separately;
these screenshots use a metadata stub and do not establish provider playback.

The first visual-fixture run passed viewport options to context.newPage, which
does not set the viewport. It was stopped, corrected to page.setViewportSize and
the four-combination test rerun successfully. Its own failed-test profile was
moved into generated local task scratch after the safety hook rejected recursive
deletion; no user profile or process was targeted. Later successful runs remove
their own temporary profiles normally.

## Checks

| Command | Result |
| --- | --- |
| node tests/changeSourceRemovalContract.test.js | Red before, green after |
| node tests/playerSettingsMenuEscaping.test.cjs | Red before, green after |
| playerSourceContract / playerCleanerIsolation | Passed |
| playerVisualContract / playerSurfaceContract / playerMinorAuditFixes | Passed |
| npm run test:player-menu-smoke | Passed: real extension, both themes, desktop/narrow |
| npm test | Passed, exit 0, including pretest and the new regressions |
| npm run lint | Passed |
| npm run build | Passed |
| npm run test:media-player | Passed, including quality/preview browser checks |
| npm run test:watch-room | Passed |

Existing regressions ran under the scoped temporary offline preload described in
T0; after the security review it also subtracts implicit link-local proxy bypass.
No package/lockfile/manifest/library version, cloud/provider live state or CI was
changed. Browser checks load source in an isolated profile, not the owner's
installed daily extension. Existing MODULE_TYPELESS_PACKAGE_JSON warnings are
unchanged and are not test failures.

## Independent review

All three independent reviewers found no actionable issues. Correctness and
security independently reran both new unit checks. The test reviewer inspected
all four visual artifacts and confirmed the actual viewport dimensions and
unchanged existing test contracts. Baseline red was observed by the executor;
an attempted independent dynamic baseline replay was blocked by the safety hook,
so it is not claimed as independently rerun. Provider/live behavior remains unverified.
