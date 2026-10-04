# План: удалить режим «Фокус» со страницы оценённых фильмов

**Дата:** 2026-09-02  
**Статус:** реализация выполнена; целевые проверки зелёные, полный suite имеет отдельный pre-existing сбой, browser smoke не выполнен в текущем окружении  
**Область:** ratings page, Canvas/sphere renderer, poster-loading bridge

## Goal

Полностью убрать пользовательский режим «Фокус» и связанную с ним линзу,
сферическую деформацию, Canvas-рендерер и специальную загрузку постеров. На
странице должна остаться одна обычная DOM-сетка фильмов.

Сохраняются фильтры, сортировка, счётчик результатов, карточки фильмов,
действия карточек, обычное открытие деталей, редактирование оценки, empty/error
состояния, тема, responsive layout и accessibility.

## Architecture

После удаления `RatingsSphere` единственным владельцем отображения ratings
становится `RatingsPageManager` вместе с существующим `MovieCard`. `ratings.js`
управляет snapshot фильтров и обычной `moviesGrid`; Canvas state, lens state,
focus-group state и sphere-specific selection больше не существуют.

Специальный Cache Storage `ratings-sphere-posters-v2` и сообщения background
нужны только Canvas-режиму. Runtime больше не открывает этот cache и удаляет
его namespace при запуске service worker. Общие сервисы изображений и обычный
браузерный HTTP-кэш не затрагиваются.

## Execution Decisions

- Retire the sphere-only 24-hour poster cache with the Focus runtime; do not
  migrate it into the ordinary grid in this slice.
- Delete existing `ratings-sphere-posters-v2` Cache Storage entries on background
  service-worker startup/update; do not touch any other Cache Storage namespace.
- Preserve ordinary `MovieCard` image URLs and browser HTTP caching only.
- Back up untracked Focus files before deletion because Git cannot restore them.
- Run the new retirement contract through `pretest`, not only as a manual command.

## Tech Stack

- Chrome MV3 extension.
- Vanilla JavaScript, HTML, CSS and DOM event delegation.
- Node.js contract tests, ESLint and generated `dist/` build.

## Baseline / Authority Refs

- [Canvas exploration plan](2026-09-01-ratings-canvas-exploration.md) —
  исторический baseline, который этим планом superseded в части focus mode.
- `src/pages/ratings/ratings.html:186-235` — toggle, Canvas surface и details
  panel режима «Фокус».
- `src/pages/ratings/ratings.js:4,38-39,162-230,346-602,1826,2041` — import,
  state, event wiring, view switching, sphere details и sync calls.
- `src/pages/ratings/ratings-sphere.js` — весь Canvas/lens/warping/hit-test,
  image cache и focus-priority loading owner.
- `src/shared/styles/ratings.css:1269-1528` — sphere surface, Canvas, debug
  panel, details panel и responsive rules.
- `src/background/background.js:397-455,724-739` — sphere poster cache,
  background fetch и cancellation messages.
- `tests/ratingsSphere.test.js` — tests, привязанные к retiring renderer.

## Compatibility Boundary

- Оставить `moviesGrid`, `MovieCard`, фильтры, сортировку и текущие data-loading
  paths без изменения поведения.
- Оставить `showMovieDetails`, rating modal и `selectedMovie`, потому что это
  общие функции страницы, а не sphere selection.
- Удалить только `sphereSelectedMovie`, `sphereSelectionLocked` и методы
  `handleSpherePreview`, `handleSphereSelection`, `clearSphereSelection` и
  `renderSphereDetails`.
- Не удалять `ImageCacheService`: он обслуживает profile images и не является
  частью sphere-пути.
- Не менять Firebase schema, ratings data, manifest permissions или package
  version.
- Удалить только существующие entries namespace `ratings-sphere-posters-v2`:
  это производный неиспользуемый кэш, а не source-of-truth данные; другие Cache
  Storage namespaces не затрагивать.

## TDD Route

- **Mode:** off.
- **Decision:** skipped; пользователь запросил план, а не strict test-first
  реализацию.
- **Test posture:** post-change retirement contract и regression checks.
- **Reason:** задача — безопасно удалить внутренний owner без изменения внешнего
  ratings data contract.
- **Verification:** static no-reference contract, full tests, lint, build и
  manual grid smoke.

## Aegis Visibility

Планирование необходимо, потому что focus mode имеет несколько внутренних
владельцев — page wiring, Canvas renderer, CSS и background poster protocol — и
частичное удаление оставит мёртвый UI или orphaned message handlers.

## Plan Basis

Решение основано на текущем коде и согласованном пользовательском решении:
режим «Фокус» визуально не подходит, поэтому сохранять его как второй view или
дальше исправлять линзу не нужно.

## BaselineUsageDraft

- **Required baseline refs:** текущая ratings wiring, renderer, styles,
  background handlers и Canvas plan.
- **Delivered context refs:** предыдущие visual/debug проверки Canvas и idle
  selection.
- **Acknowledged before plan refs:** `2026-09-01-ratings-canvas-exploration.md`.
- **Cited in plan refs:** перечислены в `Baseline / Authority Refs`.
- **Missing refs:** нет.
- **Decision:** continue.

## Requirement Ready Check

- **Requirement source:** текущий запрос пользователя.
- **Goal:** оставить только обычную сетку и удалить Focus/lens/sphere path.
- **Preserved scenario:** открыть ratings, применить фильтр, увидеть карточки,
  открыть детали и изменить оценку.
- **Retired scenario:** переключить «Фокус», двигать курсор по Canvas,
  выбирать фильм в sphere details и загружать focus poster group.
- **Acceptance:** нет Focus UI, Canvas import/markup/CSS/background protocol,
  обычная сетка работает.
- **Open blockers:** нет блокеров для удаления Focus; остаются отдельный pre-existing
  сбой полного suite и ручной browser smoke в установленном Chrome.
- **Decision:** implementation executed after scoped confirmation.

## Change Necessity

- **User-visible need:** убрать неподходящий режим и исключить случайный возврат
  к нему через старые обработчики.
- **No-change option:** скрыть кнопку CSS-ом или оставить renderer отключённым.
- **Why insufficient:** это оставит dead code, Canvas dependencies, background
  protocol и лишние poster cache paths.
- **Minimum boundary:** ratings HTML/JS/CSS, sphere renderer, background bridge,
  dedicated tests, package script and active documentation.
- **Decision:** code-change.

## Existence Check

- **Proposed new surface:** `tests/ratingsPageContract.test.js`.
- **Existing reuse candidate:** `tests/ratingsSphere.test.js`.
- **Why insufficient:** sphere test name and assertions describe retired
  behavior; keeping it would make the test suite encode the wrong product.
- **Creation proof:** a small static contract is needed to prevent reintroducing
  the removed button, import, markup or background message names.
- **Decision:** add-with-proof, then remove `ratingsSphere.test.js`.

## Architecture Integrity Lens

- **Invariant:** one ratings page, one visible grid owner, one movie-to-card
  identity mapping.
- **Canonical owner:** `RatingsPageManager` + `MovieCard`.
- **Overlap removed:** `RatingsSphere`, sphere details state, Canvas CSS and
  background poster protocol.
- **Higher-level simplification:** eliminate view-mode branching instead of
  maintaining a permanently forced `grid` mode.
- **Retirement falsifier:** if a non-sphere page still imports the renderer or
  sends its messages, stop deletion and migrate that consumer first.
- **Verdict:** delete-first is structurally correct after read-only reference
  scan.

## Plan-Time Complexity Check

- **Target files:** `ratings.js`, `ratings.html`, `ratings.css`,
  `background.js`, one renderer file, tests and package scripts.
- **Existing pressure:** `ratings.js` already contains sphere branching and
  `ratings.css` contains a large isolated sphere block.
- **Owner fit:** remove sphere branches from their current owners; do not move
  them to a new compatibility layer.
- **Add-in-place risk:** leaving `setViewMode('grid')` or a no-op sphere object
  would preserve unnecessary complexity.
- **Recommendation:** delete renderer and simplify existing page owner in one
  coherent retirement slice.

## Anti-Entropy Declaration

- **Deletion class:** code-retirement and derived-state access retirement.
- **Old path/object:** `RatingsSphere`, sphere markup/styles and poster bridge.
- **Invalid responsibility:** alternative visual mode, lens geometry, Canvas
  hit-test and focus-only poster loading.
- **Legitimate capability remaining:** ordinary grid rendering, movie details,
  rating actions and profile-image caching.
- **New canonical owner:** `RatingsPageManager` + `MovieCard`.
- **Preserved behavior:** ratings data, filters, cards, details and actions.
- **Retired behavior:** Focus button, Canvas lens, sphere details panel and
  sphere poster requests.
- **External boundary touched:** no.
- **Source-of-truth data risk:** none; no ratings or user records are deleted.
- **User confirmation required:** yes before destructive implementation edits.

## Retirement Decision

- **Path:** delete-first.
- **Why:** all identified consumers are internal to the extension and the user
  explicitly decided that Focus is not wanted.
- **Non-edits:** no Firebase data, no ratings records, no profile cache, no
  unrelated image cache, no manifest permissions and no package version bump.

## Implementation Tasks

### Task 1 — Capture retirement baseline and references

**Files:** read-only scan of the files listed in `Baseline / Authority Refs`.

**Why:** prove that every sphere consumer is known before deleting its owner.

**Steps:**

1. Run `cmd /c rg -n -i "ratings-sphere" src tests README.md docs` and the
   equivalent scans for `sphereViewBtn`, `sphereView`, `RatingsSphere`,
   `RATINGS_FETCH_POSTER` and `RATINGS_CANCEL_POSTER`.
2. Confirm that `ImageCacheService` and ordinary `MovieCard` paths are not sphere
   dependencies.
3. Save the pre-edit `git status --short` and do not stage or reset unrelated
   user changes.

**Verification:** all references are mapped to the files named in Tasks 2–4;
unmapped external consumers cause an implementation stop.

### Task 2 — Remove the Focus surface and page wiring

**Files:** modify `src/pages/ratings/ratings.html`, `src/pages/ratings/ratings.js`
and the sphere block in `src/shared/styles/ratings.css`.

**Why:** the user should see one rectangular ordinary grid with no Focus entry
   point or hidden Canvas surface.

**Changes:**

1. In HTML remove the `Сетка / Фокус` toggle container and the complete
   `sphereView` section, including Canvas, hint, details panel and accessible
   sphere list. Keep `resultsInfo`, `moviesGrid`, loading, empty and error
   containers.
2. In `ratings.js` remove the `RatingsSphere` import, sphere DOM references,
   sphere state, constructor initialization, sphere event listeners,
   `setViewMode`, `syncSphereView` and sphere details methods.
3. Remove both `syncSphereView()` calls from the ordinary render paths; do not
   replace them with a no-op or a new view-mode abstraction.
4. Remove only selectors owned by `.ratings-sphere-*` and the view-toggle rules
   that have no remaining HTML owner. Preserve generic `:focus-visible` rules,
   ordinary ratings layout, theme rules and responsive card-grid CSS.
5. Keep `renderMovies`, `attachGridEventListeners`, `showMovieDetails`, rating
   modal state and all filter/data methods intact.

**Verification:** `rg` finds no sphere-specific page identifiers; the remaining
   HTML has one movie grid and no Focus label/button.

### Task 3 — Retire the Canvas renderer and poster protocol

**Files:** delete `src/pages/ratings/ratings-sphere.js`; modify
`src/background/background.js`.

**Why:** no runtime consumer remains, so retaining the renderer or its message
   protocol would create dead internal authority.

**Changes:**

1. Delete the renderer file after Task 2 has removed its import.
2. Remove the sphere-only cache constants, request map, key normalization,
   background fetch helper and cancellation handling from `background.js`.
3. Remove only `RATINGS_FETCH_POSTER` and `RATINGS_CANCEL_POSTER` branches from
   the message listener; keep all unrelated background messages unchanged.
4. Do not add a fallback implementation or migrate the old sphere cache into a
   second owner. Delete only the existing derived `ratings-sphere-posters-v2`
   namespace through `caches.delete`; do not open or enumerate other caches.

**Verification:** `rg` finds no sphere poster protocol names in `src`; the
   background contains one exact cleanup call and no `caches.open`; Node syntax
   checks pass for the changed background and ratings files.

### Task 4 — Replace retired tests with a no-reintroduction contract

**Files:** delete `tests/ratingsSphere.test.js`; add
`tests/ratingsPageContract.test.js`; modify `package.json`.

**Why:** tests must assert the current product, not preserve the removed lens.

**Contract assertions for `ratingsPageContract.test.js`:**

1. `ratings.html` contains `moviesGrid`, `resultsInfo`, loading, empty and error
   states, and contains none of `sphereViewBtn`, `sphereView`, `sphereCanvas`,
   `ratings-sphere` or the text `Фокус`.
2. `ratings.js` contains no `RatingsSphere`, `sphereView`, `sphereSelectedMovie`,
   `sphereSelectionLocked`, `syncSphereView` or `RATINGS_FETCH_POSTER`.
3. `ratings.css` contains no `.ratings-sphere-` or stale view-toggle selectors.
4. `background.js` contains no `RATINGS_FETCH_POSTER` or
   `RATINGS_CANCEL_POSTER`, explicitly deletes the retired cache namespace and
   does not recreate it with `caches.open`.
5. The ordinary grid still calls the existing `createMovieCard` path and keeps
   the existing detail/rating modal IDs.

Remove the dedicated `test:ratings-sphere` script from `package.json`, add a
`test:ratings-page` script, and include it in `pretest`; do not change the
package version.

**Verification:** `cmd /c node tests\ratingsPageContract.test.js` exits 0 and
reports all retirement assertions passed.

### Task 5 — Update active documentation and generated output

**Files:** modify `README.md` and the status line of the previous Canvas plan;
generate `dist/` through the existing build only.

**Why:** active documentation must not promise a Focus mode that no longer
   exists, while historical release notes remain factual.

**Changes:**

1. Mark `2026-09-01-ratings-canvas-exploration.md` as superseded by this
   retirement plan; do not rewrite its historical implementation record.
2. Remove active architecture claims about the sphere from README text while
   retaining historical changelog entries as history.
3. Add a concise retirement entry to the existing changelog section according
   to the repository version policy.
4. Never edit `dist/` manually; rebuild it after source changes.

**Verification:** README has no active Focus-mode promise outside its historical
changelog, historical entries remain recognizable as release history, the old
Canvas plan is marked superseded, and build output contains only the ordinary
ratings page path.

### Task 6 — Run regression and browser smoke checks

**Files:** no further source changes unless a test identifies a stale consumer.

**Commands:**

```text
cmd /c node tests\ratingsPageContract.test.js
cmd /c npm run test:visual-design
cmd /c npm test
cmd /c npm run lint
cmd /c npm run build
cmd /c git diff --check
cmd /c rg -n -i "RatingsSphere|sphereView|sphereCanvas|RATINGS_FETCH_POSTER|RATINGS_CANCEL_POSTER" dist
cmd /c rg -n -i "ratings-sphere-posters-v2" dist/src/background/background.js
```

**Expected results:** all executable tests/lint/build checks exit 0; the
protocol scan has no matches (an `rg` exit code 1 is expected); the cache scan
shows only the explicit cleanup marker; `dist/` is generated successfully.

**Manual smoke:** reload the unpacked extension, open ratings, confirm there is
no Focus button, Canvas or sphere details panel, then verify filters, sorting,
empty/error states, ordinary card click, details modal, edit-rating action,
keyboard focus and dark/light responsive layouts.

## Verification Record

- `npm run test:ratings-page`: passed.
- `npm run test:visual-design`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; `dist/` contains no retired Focus/Sphere runtime path
  beyond the explicit one-time cache cleanup marker.
- `git diff --check`: passed; only existing line-ending warnings were reported.
- `npm test`: not fully green because the pre-existing
  `tests/movieDetailsCreditsUI.test.js:518` assertion fails for hidden actors.
  The failure is outside the ratings Focus retirement slice.
- Installed-extension browser smoke: not executed in the current environment;
  manual Chrome verification remains required.

## Plan Pressure Test

- **Owner / contract / retirement:** all old owners and message contracts are
  named; ordinary grid ownership is explicit.
- **Architecture integrity:** no compatibility shim or no-op view branch is
  retained.
- **Verification scope:** static absence checks plus full project checks and
  user-visible grid smoke are included.
- **Task executability:** each task names exact files, boundaries and commands.
- **Pressure result:** implementation executed after scoped destructive-change
  confirmation; static and targeted checks passed, with the known suite and
  browser-smoke limitations recorded above.

## Execution Readiness View

- **Intent Lock:** remove Focus entirely; keep ordinary ratings grid behavior.
- **Scope Fence:** ratings page sphere code, styles, tests, background bridge and
  active docs only.
- **Baseline Lock:** use the current files and the 2026-09-01 Canvas plan as
  historical context.
- **Approved Behavior:** one DOM grid, working filters/cards/details/actions.
- **Owner Constraints:** `RatingsPageManager` and `MovieCard` remain canonical.
- **Compatibility Boundary:** no ratings data, Firebase schema or unrelated
  image cache changes.
- **Retirement Boundary:** no Canvas/lens/sphere UI, code or poster protocol.
- **Test Obligations:** retirement contract, full tests, lint, build and smoke.
- **Review Gate:** inspect `rg` no-reference output before deleting renderer.
- **Drift Rule:** if another consumer appears, stop and classify it before
  adding a fallback.
- **Evidence Required:** command exit codes, no-reference contract output and
  manual grid smoke result.

## Risks and Rollback

- **Stale caller:** caught by no-reference scans and contract test; migrate the
  caller before deletion if found.
- **Accidental grid regression:** protected by preserving `moviesGrid` and
  `MovieCard` paths and running full tests.
- **Cache confusion:** only the exact sphere Cache Storage namespace is deleted;
  it is derived state, not ratings data, and no other cache is enumerated.
- **Rollback:** restore tracked changes from version control and restore the
  pre-edit backup for untracked Focus files; Git alone cannot recover files that
  were never tracked. No live data migration is required.
- **Dirty worktree:** do not reset, clean or overwrite unrelated user changes.

## Retirement Completion Criteria

The retirement is complete only when all are true:

- no Focus button, Canvas, sphere details panel or sphere CSS remains;
- no `RatingsSphere` import, class, message protocol or sphere poster cache owner
  remains in active source; only the exact retired namespace cleanup remains;
- `ratings.js` has no view-mode branch and renders the ordinary grid directly;
- ordinary filtering, sorting, cards, details, rating actions and accessibility
  pass regression checks;
- contract test is wired into `pretest`, full test suite, lint, build and manual
  grid smoke pass;
- README and Aegis plan status no longer describe Focus as an active feature.
