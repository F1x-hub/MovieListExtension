# Evidence bundle: ratings Canvas exploration

## Evidence status

Verified — source, focused checks, browser smoke, build, and the full regression
suite pass. The real extension runtime remains a bounded manual follow-up because
the isolated browser page cannot provide `chrome.*` APIs.

## Checks performed

- Read parent implementation plan and current source owners.
- Captured HEAD, branch, modified paths, untracked paths, and worktree list.
- Inspected existing renderer, manager wiring, HTML shell, and ratings CSS.
- `cmd /c npm run test:ratings-sphere` — passed, including monotonicity, sampled
  derivative, round-trip, center, and outside-table inverse tests.
- `cmd /c node --check src\pages\ratings\ratings-sphere.js` — passed.
- `cmd /c npm run test:visual-design` — passed.
- `cmd /c node tests\htmlScriptModuleContract.test.js` — passed.
- `cmd /c npm run lint` — passed.
- `cmd /c npm run build` — passed; generated `dist/` from source.
- `cmd /c npm test` — passed; full project regression suite.
- Browser smoke harness — passed: 255 items, 32 focus-group items, 32 unique
  requested poster IDs, 89 moved cells, max row/column curvature about 40px,
  rectangular focus surface, and correct center/outside-lens hit-tests.
- Rectangular focus contract — passed: focus Canvas has no circular overlay,
  `arc()` boundary, circular clip, or circular CSS overlay.
- Rectangular mode-switch contract — passed: the `Сетка / Фокус` group and both
  buttons use standard moderate/small radii rather than pill-shaped corners.
- Browser smoke artifact: `artifacts/ratings-canvas-radial-a-poster-final.png`.
- Boundary policy — passed: LUT covers normalized `0…1.25R`; `r2 = 0` returns the
  focal point; `r2 > 1.25R` uses identity; far outside-canvas values stay finite.
- Lens contract — passed: exact scale checkpoints are `4x` at `0R`, `3.3x` at
  `.25R`, `2.3x` at `.5R`, `1.1x` at `R`, and base `1x` at `1.25R`.
- Focus-loading probe — passed: 255 items requested exactly 32 local-group poster
  IDs; peripheral poster sources were not requested.
- Motion probe — passed: the visible RAF loop stayed active and an item moved
  between samples while poster requests remained bounded at 32.
- Cache contract — passed: normalized query/hash variants reuse fresh poster bytes,
  versioned entries older than 24 hours expire, warm reload causes zero poster
  network requests, and direct-image fallback remains available.
- Background poster path — passed in the extension-page contract: background fetch
  writes the same extension-origin cache, while renderer cancellation aborts loads
  that leave the 32-item focus group.
- Visual smoke uses the live dev panel with `k1=1.15`, `k2=0.15`, radius scale
  `0.4`, strength `1`, and shows the transformed dot field over the static outer
  field.

## Uncovered scope

- The authenticated `chrome-extension://` page was not automated in this pass;
  the profile-based browser session did not provide a reliable active target.
- The configured Aegis workspace helper was not available on PATH or in the
  installed skill bundle, so its optional bundle/check structural commands could
  not be run.
- Static file-page bootstrap reports expected `chrome.storage`/`chrome.runtime`
  errors, which are harness limitations rather than Canvas errors.
- The actual poster CDN host used by the user's installed data still needs a manual
  check against `manifest.json` host permissions; no broad wildcard permission was
  added.

## Residual risk

Remaining risk is limited to real extension bootstrap/auth data and any poster host
not covered by extension host permissions. Such hosts use the browser's normal
Image/cache path. Canvas geometry, pointer alignment, exact local lens behavior,
hit-test, and detail callbacks are covered by the isolated browser harness and
contract tests.
