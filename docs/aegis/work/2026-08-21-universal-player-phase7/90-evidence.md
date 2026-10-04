# Phase 7 Evidence

## Checks

| Check | Result | Scope | Residual risk |
|---|---|---|---|
| Focused provider tests | PASS | Adapter matrix, exact VidSrc URLs, Seasonvar switching | No live provider exercise |
| Provider switch regression | PASS | Canonical S3E6 through provider round-trip | Browser iframe behavior not exercised |
| `npm run lint` | PASS | Source JS and content scripts | None observed |
| `npm test` | PASS | Configured pretest and test suites | Existing warnings/noisy mocked API logs |
| `npm run build` | PASS | Clean production bundle generation | Build output is generated/ignored |
| Extension runtime probe | PASS | Loaded unpacked `dist/`; verified movie, missing-IMDb,
  direct-provider, and opaque-provider control visibility plus VidSrc S3E6 URL | Auth-gated live playback not exercised |

## Confidence

Grade B: direct source, automated regression, and unpacked-extension runtime
evidence is fresh and broad; authenticated third-party playback remains outside
this run.
# Universal selection execution evidence

- `node tests/playerPhase7CapabilityContract.test.js` — passed, including
  selection modes and native bridge message assertions.
- `node tests/seasonvarRestoreAndPickerLifecycle.test.js` — passed.
- `node tests/playerEpisodeProviderRuntimeAcceptanceAudit.test.js` — all 22
  acceptance parts passed.
- `npm test` — passed; Node emitted only existing module-type warnings.
- `npm run lint` — passed.
- `npm run build` — passed.
- Ex-FS iframe inspection confirmed stable semantic structure: the first two
  provider dropdowns contain `сезон` and `серия` items; bridge now clicks those
  items and waits for the episode menu to rebuild after a season change.
- `git diff --check` reports pre-existing whitespace in the already-dirty
  worktree; no cleanup was performed to avoid touching unrelated user edits.
- Live Chrome verification was not completed because the local browser skill
  runtime file was unavailable; the bridge retains a timeout and legacy
  fallback instead of assuming dispatch succeeded.
- Added `[ExFsBridgeTrace]` diagnostics at picker, controller, adapter, iframe,
  and provider-DOM click boundaries for the next live run.
- Fixed host navigation gating so picker-only providers keep the canonical
  episode button visible while unsupported Prev/Next controls stay hidden.
- Normalized Seasonvar snake_case season metadata and stopped title-only
  providers from reusing a one-item active-source episode list.
- Enabled Ex-FS adjacent navigation through the verified bridge and hid its
  duplicate provider-native arrow controls when canonical navigation is active.
- Hid the stale Ex-FS "Выберите S/E в плеере источника" guidance when the
  canonical native bridge is active.
- Added delayed visibility reapplication so late-created legacy episode
  controls remain hidden under canonical picker mode.
- Added late-iframe bridge retries and a click/update guard against stale
  legacy episode navigation state.
- Verified KinoGo's real `[data-select="seasonType1"]` and
  `[data-select="episodeType1"]` controls from the supplied source HTML.
- Added regression coverage for mixed same-title film/series search results and
  KP-ID-as-year input from the adapter boundary.
