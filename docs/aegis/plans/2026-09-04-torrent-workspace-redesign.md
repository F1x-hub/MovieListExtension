# План: единое рабочее пространство «Торрент» на странице фильма

**Дата:** 2026-09-04  
**Статус:** пользователь подтвердил план («го»); реализация выполняется  
**Область:** MovieDetails, торрент-поиск, сохранённые загрузки и активный
торрент-просмотр  
**Решение:** вариант A — единое inline-рабочее пространство внутри текущей
вкладки «Торрент»

## Goal

Перестроить торрент-интерфейс так, чтобы поиск раздач, текущая загрузка,
доступность просмотра, плеер и управление файлом воспринимались как один
связный рабочий процесс.

Пользователь должен без открытия DevTools понимать:

- что сейчас происходит с торрентом;
- сколько реально скачано;
- сколько видео уже доступно для просмотра;
- готов ли поток или идёт remux/transcode;
- сколько осталось до полной загрузки;
- какие действия доступны прямо сейчас;
- где находятся сохранённые загрузки после повторного открытия фильма.

Пустой самостоятельный `torrent-playback-status` не должен появляться. Если
активной загрузки или playback-сессии нет, статусная карточка скрыта, а в
панели отображаются поиск, результаты и сохранённые загрузки.

## Architecture

`MovieDetailsManager` остаётся единственным владельцем торрент-состояния и
рендеринга. Новый глобальный Torrent Center, отдельная страница или второй
контроллер состояния в этом плане не создаются.

Целевая иерархия:

```text
MovieDetails
└── source toolbar
    └── Torrent workspace (#torrentSourcePanel)
        ├── workspace header and connection/search status
        ├── active torrent card (#torrentPlaybackStatus, hidden when idle)
        ├── saved downloads (#torrentDownloadLibrary)
        └── other releases disclosure
            ├── quality filters
            ├── sort
            └── source list (#torrentSourceList)
        └── video player (#videoContainer, existing owner)
```

Текущий `#torrentPlaybackStatus` сохраняется как стабильный DOM ID для
минимизации риска, но становится дочерним блоком `#torrentSourcePanel` и
получает новую роль активной карточки. Старый класс и старое расположение
статуса не сохраняются.

Текущие API и данные не меняются: используются `listDownloads()`,
`pauseDownload()`, `resumeDownload()`, `playDownload()`, `deleteDownload()`,
`getPlaybackProgress()` и существующие поля playback-прогресса. Сервер,
Native Messaging, torrent-протокол, retention и локальная папка загрузок не
входят в эту задачу.

## Tech Stack

- Chrome Manifest V3 extension.
- Vanilla JavaScript, HTML and CSS.
- `MovieDetailsManager` как текущий owner MovieDetails и торрент-состояния.
- `MediaPlayerService` как существующий клиент локального MediaPlayer API.
- Node.js contract tests, ESLint и сгенерированный `dist/`.

## Baseline / Authority Refs

- `CONTEXT.md` — терминология Yin-Yang / Obsidian-Zinc и правило нейтрального
  UI chrome.
- `docs/design-system.md` — token ownership, theme parity, accessibility и
  ограничения цвета.
- `src/pages/movie-details/movie-details.html:200-241` — текущая разметка
  панели, загрузок, списка раздач и отдельного статуса.
- `src/pages/movie-details/movie-details.js:8622-9510` — открытие панели,
  поиск, фильтрация, сортировка, сохранённые загрузки и playback status.
- `src/pages/movie-details/movie-details.js:7903-7909` — очистка торрент-
  статуса при смене источника.
- `src/pages/movie-details/movie-details.js:10200-10325` — обновление
  torrent playback status по прогрессу сессии.
- `src/pages/movie-details/movie-details.css:4867-5380` — текущая CSS-зона
  torrent picker и `torrent-playback-status`.
- `src/shared/services/MediaPlayerService.js` — существующий клиентский
  контракт MediaPlayer.
- `tests/mediaPlayerIntegrationContract.test.js` — интеграционный контракт
  MediaPlayer, источников и управления загрузками.
- `tests/movieDetailsTorrentLibrary.test.js` — сортировка, фильтрация и
  форматирование торрент-данных.
- `README.md:216-383` — текущая документация и changelog торрент-функций.

## Compatibility Boundary

Сохраняются без изменения внешнего поведения:

- `mediaplayer:torrent` и существующая вкладка источника;
- `#torrentSourcePanel`, `#torrentSourceStatus`, `#torrentSourceControls`,
  `#torrentSourceSort`, `#torrentSourceList`;
- `#torrentDownloadLibrary` и `#torrentDownloadList`;
- `#torrentPlaybackStatus` как ID;
- существующие `data-download-action` для play/pause/resume/delete;
- текущие методы `openTorrentPicker`, `closeTorrentPicker`,
  `startTorrentPlayback`, `playSavedTorrent`, `pauseSavedTorrent`,
  `resumeSavedTorrent`, `deleteSavedTorrent`;
- сортировка по рекомендуемым, сидам, качеству и размеру;
- фильтры 4K, 2K, 1080p, 720p и SD;
- сохранение загрузки после закрытия страницы и продолжение через MediaPlayer;
- отдельные значения `torrent.download` и `playback.availableDuration`;
- существующий `#videoContainer`, HLS playback, playback-controller и смена
  провайдера;
- тёмная и светлая темы, responsive-поведение и общая система диалогов.

В эту задачу не входят:

- изменение backend API или схемы базы данных;
- изменение WebTorrent, ffmpeg, HLS или аппаратного ускорения;
- добавление общей страницы всех загрузок;
- изменение retention-настроек;
- автоматический перенос или удаление старых файлов;
- показ пользователю локального torrent locator;
- кнопка «Открыть папку», если для неё потребуется новый локальный endpoint.
  Она может быть отдельной безопасной задачей после этого редизайна.

## TDD Route

- **Mode:** off.
- **Decision:** skipped; пользователь запросил полноценный дизайн-план, а не
  strict test-first реализацию.
- **Test posture:** существующие contract/regression тесты расширяются после
  стабилизации разметки и состояния; затем выполняются build, lint и ручной
  smoke-проход.
- **Reason:** задача меняет состав и иерархию UI, но не меняет MediaPlayer
  API или torrent data contract.
- **Verification:** статический DOM-контракт, state/render tests, visual design
  contract, полный suite, lint, build и ручная матрица состояний.

## Aegis Visibility

Планирование необходимо, потому что текущая проблема возникла из-за двух
визуальных owners одного процесса: панель скрывается после запуска, а
`torrent-playback-status` остаётся отдельным блоком. План фиксирует одного
владельца, точный retirement старого расположения и проверку, что состояние
не распадается при закрытии и повторном открытии страницы.

## Plan Basis

Основание плана — текущий код и согласованный пользователем вариант A:
оставить пользователя на странице фильма, но превратить вкладку «Торрент» в
полноценную рабочую область. Главный продуктовый принцип — доступность
просмотра важнее одного процента скачивания: `100%` скачанного файла и
`29:01` доступного видео должны быть отдельными, видимыми значениями.

## BaselineUsageDraft

- **Required baseline refs:** текущая HTML/JS/CSS-разметка MovieDetails,
  `MediaPlayerService`, два торрент-теста, `CONTEXT.md` и
  `docs/design-system.md`.
- **Delivered context refs:** пользовательский screenshot с пустой полосой и
  предыдущая диагностика раздельных download/playback состояний.
- **Acknowledged before plan refs:** перечисленные baseline-файлы и текущая
  реализация в `movie-details.js`.
- **Cited in plan refs:** `Baseline / Authority Refs`, `UX Specification` и
  `Implementation Tasks`.
- **Missing refs:** нет blocker-источников; реальный browser smoke остаётся
  проверкой после реализации.
- **Decision:** continue.

## Requirement Ready Check

- **Requirement source:** текущий запрос пользователя и утверждённый вариант A.
- **Goal:** единое рабочее пространство, в котором статус, загрузка, поиск,
  результаты и управление не распадаются на пустые независимые блоки.
- **Scenarios:** idle, поиск, incremental results, active download, playback
  ready, paused, complete, error, закрытие/повторное открытие и смена
  провайдера.
- **Acceptance:** нет пустого standalone status; панель не скрывается после
  старта; download и playback readiness различимы; все действия доступны;
  состояния работают в dark/light и narrow layout.
- **Open blocker questions:** нет для реализации первого варианта.
- **Decision:** ready for implementation after user review of this written plan.

## Change Necessity

- **User-visible need:** текущая пустая полоса не объясняет состояние и
  отрывает активный playback от управления загрузкой.
- **No-change option:** только заменить текст в `torrent-playback-status` или
  добавить CSS-стили.
- **Why insufficient:** панель всё равно скрывается, действия остаются в
  другом DOM-блоке, а idle-состояние продолжает выглядеть как пустой статус.
- **Minimum change boundary:** одна HTML/CSS-зона MovieDetails, существующий
  торрент-рендеринг в `MovieDetailsManager`, текущие contract tests и
  documentation/build verification.
- **Decision:** code-change.

## Existence Check

- **Proposed new runtime surface:** отдельный `TorrentWorkspace` controller или
  новая страница загрузок.
- **Existing owner / reuse candidate:** `MovieDetailsManager` и
  `#torrentSourcePanel` уже владеют всеми torrent events, polling, source
  sorting и download actions.
- **Why existing surface is sufficient:** все необходимые данные уже приходят
  в текущие методы; проблема — в композиции DOM и lifecycle, а не в отсутствии
  API или state owner.
- **Creation proof:** для варианта A новый runtime owner не нужен; отдельный
  controller отклонён, чтобы не дублировать `torrentDownloads`, progress
  monitoring и current request lifecycle.
- **Test surface decision:** использовать существующие
  `mediaPlayerIntegrationContract.test.js` и `movieDetailsTorrentLibrary.test.js`;
  новый test file создавать только если после state extraction невозможно
  выразить контракт в этих owners.
- **Entropy / retirement impact:** удалить standalone status placement и его
  старый CSS owner; сохранить стабильный ID и методы, чтобы не ломать текущие
  callers.
- **Decision:** reuse-existing; no new runtime owner.

## Architecture Integrity Lens

- **Invariant:** один торрент-процесс должен иметь один видимый workspace и одно
  согласованное представление состояния.
- **Canonical owner / contract:** `MovieDetailsManager` + `#torrentSourcePanel`,
  данные из существующего `MediaPlayerService`.
- **Responsibility overlap:** старый sibling `#torrentPlaybackStatus` и
  `closeTorrentPicker()` после mount создают разрыв между status и controls;
  отдельный новый controller создал бы второй state owner.
- **Higher-level simplification:** изменить lifecycle панели и вложить active
  card в неё, вместо добавления ещё одной status-полосы или новой страницы.
- **Retirement / falsifier:** старый standalone class/placement удаляется;
  если после reference scan найдётся внешний consumer этого класса, сохранить
  только необходимый ID-контракт и отдельно классифицировать consumer до
  удаления.
- **Responsibility / capability boundary:** playback controller по-прежнему
  владеет видео; MovieDetailsManager по-прежнему владеет torrent UI. Новый
  workspace не получает право управлять HLS или torrent transport напрямую.
- **Verdict:** proceed with existing owner and delete-first visual composition.

## Plan-Time Complexity Check

- **Artifact class:** medium UI/lifecycle refactor inside an existing page.
- **Target files:** `movie-details.html`, `movie-details.js`,
  `movie-details.css`, two existing tests, `package.json` only if a focused
  test command needs adjustment, `README.md` and this plan.
- **Current pressure:** `movie-details.js` is a large 12k-line page manager,
  but torrent methods already form one contiguous owner around lines
  8622-9510; `movie-details.css` already has one contiguous torrent block.
- **Owner fit:** edit the existing contiguous owners; do not extract a new
  controller or duplicate state.
- **Add-in-place risk:** large template literals and repeated render calls can
  reintroduce stale empty markup or duplicate buttons.
- **Mitigation:** retain data attributes, add one workspace render/orchestration
  boundary, and add static/state contracts before release.
- **Recommendation:** edit in place for this slice; extract only a pure helper
  in a later plan if the focused owner grows beyond the current boundary.

## UX Specification

### Information architecture

The user sees the following order when the Torrent tab is active:

1. **Header:** `Торрент` or `Торрент-раздачи`, close control and a compact
   connection/search status.
2. **Active torrent card:** only when a playback session or active torrent
   needs attention. This is the primary status surface.
3. **Saved downloads:** persistent per-film downloads, including pause/resume,
   play, retry and delete.
4. **Other releases:** collapsible results area with count, quality filters,
   sorting and incremental results.
5. **Player:** the existing player remains below the workspace and is never
   replaced by a second video surface.

Wireframe:

```text
┌ Torrent                                                   × ┐
│ MediaPlayer ready · 95 releases found                      │
├─────────────────────────────────────────────────────────────┤
│ NOW / ACTIVE                                                │
│ Star Wars: Episode VI                 4K · NoName Club       │
│ Downloading / Preparing playback                            │
│                                                             │
│ Available to watch       29:01                              │
│ Downloaded               97%                                │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│ 6.6 MB/s · 5 peers · full download in 49 s                  │
│ [Continue watching] [Pause] [Delete]                        │
├─────────────────────────────────────────────────────────────┤
│ SAVED DOWNLOADS                                             │
│ 4K · 11 GB · 97% · 6.6 MB/s · 5 peers       [Pause] [...]   │
├─────────────────────────────────────────────────────────────┤
│ OTHER RELEASES (95)                                    ˅    │
│ [All] [4K] [2K] [1080p] [720p] [SD]   Sort: Recommended     │
│ release title · quality · size · seeds · peers   [Select]  │
│ release title · quality · size · seeds · peers   [Select]  │
│ [Show 10 more]                                              │
└─────────────────────────────────────────────────────────────┘
                         Existing video player
```

The labels in the final UI remain Russian and describe user actions, not
implementation details. Technical information such as `remux`, `audio-only`
or `transcode` appears as a secondary preparation line only when it explains a
real wait.

### State matrix

| State | Active card | Primary message | Available actions |
|---|---|---|---|
| `idle` | Hidden | Search or saved-download summary | Search, filters, sort |
| `searching` | Hidden unless a download is already active | `Ищем раздачи…` | Cancel/close, existing results |
| `metadata` / `probing` | Visible | `Определяем формат…` | Close workspace; download continues |
| `downloading` | Visible | `Скачивается` plus playback stage | Watch, pause, delete |
| `remuxing` | Visible | `Готовим быстрый поток` | Wait, pause download, delete |
| `transcoding` | Visible | `Готовим совместимое видео/аудио` | Wait, pause download, delete |
| `paused` | Visible if current; saved card otherwise | `Загрузка на паузе` | Continue, delete |
| `complete` | Visible while current; saved card on reopen | `Готово к просмотру` | Watch, delete |
| `error` | Visible | Concrete failure and next action | Retry/resume, delete |

Rules:

- `torrent.download.progress` is rendered only as `Скачано N%`.
- `playback.availableDurationSeconds` is rendered only as
  `Доступно для просмотра HH:MM:SS`.
- `video.duration` is never used as a substitute when API playback readiness
  exists.
- `0 Б/с` and `0 пиры` are shown only when the current API snapshot really
  reports zero; they are not used as placeholders before the first snapshot.
- `Пока нет` is shown only before the first positive available duration, never
  after a completed torrent has a verified playable HLS/VOD result.
- ETA is explicitly labelled as `до полной загрузки`, not as video duration.
- The active card must not claim `Готово к просмотру` until its playback state
  or completed-file path confirms it.

### Active card content

The active card contains:

- release title;
- quality badge and provider/indexer;
- textual state label with a non-color cue;
- a prominent playback-readiness metric;
- a separate download progress bar and percentage;
- speed, peers, total size and full-download ETA;
- preparation line for probing/remux/transcode when applicable;
- existing play/pause/resume/retry/delete actions.

The card does not expose a locator, access token or raw filesystem path.

### Saved downloads and results

- Saved downloads remain first because they represent the user’s durable state.
- The current active download must not be rendered twice as two competing
  primary cards; the active card owns its summary and the library row is either
  compact or visually marked as `Текущий файл`.
- Results show the first 10 entries initially. The existing incremental search
  continues collecting batches; `Показать ещё` reveals the next 10 locally
  without requesting the same batch again.
- The result count and visible count remain separate, for example
  `Найдено раздач: 95 · показано: 10`.
- Result cards preserve the current quality bucket, provider, size, seeders and
  leechers. The primary card action remains selecting the release for playback.
- Empty search results explain what happened and offer `Повторить поиск`.
- Missing TMDB ID is an explicit error state with an explanation; no blank
  rounded panel is allowed.

### Interaction and lifecycle

- Starting a release does not call `closeTorrentPicker()`.
- The workspace stays open while the player mounts and progress polling runs.
- The results disclosure may collapse automatically after selection, but the
  active card and saved-download section remain visible.
- The close button hides the workspace only; it must not delete, pause or revoke
  the persistent torrent download unless an existing explicit action does so.
- Switching away from Torrent still uses the existing cleanup path and removes
  the active card from the visible Torrent workspace.
- Reopening the Torrent tab calls the existing download refresh and shows the
  persisted card immediately, including paused/downloading/complete state.
- All active-card actions delegate to existing save/download methods so there
  is one pause/resume/delete authority.

### Accessibility

- `#torrentSourcePanel` remains a labelled `section`.
- The active card is a `section` with `aria-labelledby`; it is not a giant
  `role="status"` containing interactive buttons.
- Only a small status message sub-element uses `aria-live="polite"` and
  `aria-atomic="false"`.
- Progress bars keep `role="progressbar"`, min/max/current values and a clear
  Russian label.
- The results disclosure uses native `details/summary` or an equivalent
  keyboard-operable control with `aria-expanded` kept in sync.
- Buttons use explicit action labels: `Пауза`, `Продолжить`, `Смотреть`,
  `Повторить`, `Удалить`.
- Icon-only controls retain visible focus, accessible name and tooltip/title.
- Nested buttons are not placed inside a clickable source-card button.
- All states communicate meaning with text, icon, border or structure in
  addition to any semantic color.

### Visual direction

- Keep the Obsidian-Zinc/Yin-Yang neutral UI contract.
- Use existing canonical `--ui-color-*` and `--ui-control-*` roles for new or
  rewritten rules; do not add a torrent-specific accent palette.
- Keep poster/video content color inside its content boundary; do not promote
  provider colors to UI chrome.
- Make the playback-readiness metric the visual anchor and demote technical
  metrics to a compact secondary row.
- Use one restrained progress animation only for a live download; disable
  movement under `prefers-reduced-motion: reduce`.
- Use exact transitions for width, border and background; do not use
  `transition: all`.
- Preserve identical hierarchy and geometry in dark and light themes.
- Keep desktop density comfortable and collapse the metrics/actions into a
  two-column or stacked layout below 768px.

## Implementation Tasks

### Task 1 — Capture baseline and extend the existing contract surface

**Files:** read-only scan of the baseline refs; modify
`tests/mediaPlayerIntegrationContract.test.js` and
`tests/movieDetailsTorrentLibrary.test.js` only after the markup/state shape is
implemented.

**Why:** establish the old-to-new contract explicitly and prevent a partial
redesign from leaving the old sibling status or duplicate actions.

**Steps:**

1. Run `cmd /c rg -n -i "torrentSourcePanel|torrentPlaybackStatus|closeTorrentPicker|renderTorrentPlaybackStatus|torrentSourceList" src tests`.
2. Save the current `git status --short`; preserve unrelated dirty changes.
3. During implementation, add assertions that `torrentPlaybackStatus` appears
   inside the `torrentSourcePanel` block and before the closing panel section.
4. Add a contract assertion that the mount path no longer closes the workspace
   immediately after creating a playback session.
5. Add state/render assertions for the separate download percentage and
   available playback duration, and for the first-10/show-more result rule.

**Verification:** the reference scan maps every old selector to a planned
owner; any consumer outside the listed files stops the deletion of the old
class until that consumer is classified.

### Task 2 — Recompose MovieDetails markup around one Torrent workspace

**Files:** modify
`src/pages/movie-details/movie-details.html:200-241`.

**Why:** the empty visual block is caused by the status being a sibling of the
panel that contains all useful controls.

**Changes:**

1. Keep `#torrentSourcePanel` as the only Torrent workspace container.
2. Move `#torrentPlaybackStatus` inside that section, after the header and
   top-level source status, before saved downloads and results.
3. Change the active card semantics from a blanket `role="status"` to a
   labelled section; reserve the live region for its changing message.
4. Wrap source filters and `#torrentSourceList` in an accessible
   “Другие раздачи” disclosure with a count target.
5. Add one keyboard-operable `Показать ещё` control owned by the source-list
   region. Keep it hidden while all accumulated sources are already visible.
6. Preserve all existing IDs used by `MovieDetailsManager` and
   `MediaPlayerService` tests.
7. Remove the old sibling status node below the panel; there must be one
   `torrentPlaybackStatus` node only.

**Impact/compatibility:** no service API or player markup changes. The video
player remains the existing sibling after the workspace.

**Verification:** static markup asserts one status ID, status nested under the
panel, the player outside the workspace, and no empty standalone status block.

### Task 3 — Make MovieDetailsManager the single workspace orchestrator

**Files:** modify
`src/pages/movie-details/movie-details.js:8622-9510` and the progress update
callers around `10200-10325`.

**Why:** markup alone cannot fix the lifecycle that currently hides the panel
after starting playback.

**Changes:**

1. Add a small page-local `torrentVisibleSourceLimit` initialized to `10` and
   reset it on a new search or a new MovieDetails movie.
2. Add one page-local workspace render boundary that derives the visible mode
   from existing session/download/playback state and calls the existing source,
   download and status renderers in a deterministic order.
3. Keep `renderTorrentPlaybackStatus` as the internal method name for existing
   callers, but make it render the new active-card markup and its live message.
   Do not add a second status renderer.
4. Render active-card controls through the existing download action contract;
   route pause/resume/retry/play/delete to the current methods.
5. Replace `slice(0, 100)` as the initial visual limit with the local visible
   limit. Add the show-more action to increase the limit by 10 without
   re-requesting the search.
6. Update source summary text to distinguish total found, visible count and
   running search state.
7. In `mountTorrentPlaybackSession`, remove the immediate
   `closeTorrentPicker()` call. Set the workspace mode to active, keep the
   panel visible and allow the player to mount below it.
8. Keep `closeTorrentPicker()` for an explicit close/provider switch, but make
   it hide the workspace only; it must not delete or pause a persistent
   download.
9. On `openTorrentPicker`, refresh saved downloads first, preserve an active
   session when present, and render the active card/library before results.
10. Ensure progress callbacks can update a hidden workspace safely and that
    reopening the panel refreshes the latest persisted snapshot.
11. Keep `torrent.downloadedBytes`, `torrent.progress`, speed, peers and ETA
    separate from `playback.availableDurationSeconds`, `playback.state` and
    preparation mode.
12. Ensure the active card never displays placeholder `0 Б/с` or `—` before the
    first API snapshot; use a neutral loading label instead.

**Impact/compatibility:** all existing MediaPlayer calls and playback-session
URLs remain unchanged. The only lifecycle change is that the workspace stays
visible while the session is mounted.

**Verification:** focused tests prove state precedence, separate progress
values, no panel close in mount, pause/resume/delete delegation and persistent
reopen behavior.

### Task 4 — Redesign the torrent visual system in the existing CSS owner

**Files:** modify `src/pages/movie-details/movie-details.css:4867-5380`.

**Why:** the current CSS gives the status a generic rounded strip and makes the
source panel/library look like separate utilities instead of one workspace.

**Changes:**

1. Retire the old standalone `.torrent-playback-status` placement rules.
2. Add scoped workspace, active-card, disclosure and show-more rules under the
   existing MovieDetails torrent owner.
3. Build the active card with a strong readiness metric, a separate download
   rail, a compact technical row and an action row.
4. Use semantic `data-state` and text/icon cues for starting, downloading,
   paused, complete and error; do not rely on color alone.
5. Use canonical `--ui-color-*`/`--ui-control-*` tokens for new rules and
   preserve theme aliases only where required by the existing migration.
6. Keep source cards dense but readable; align quality at the edge and place
   provider/size/seeds/leechers in a secondary row.
7. Make the disclosure header and count visually distinct from the active card
   without adding a new chromatic accent.
8. Keep focus rings, button centering, reduced motion and exact transitions.
9. Add responsive rules for stacked metrics/actions, long release names,
   overflow and narrow viewport controls.

**Impact/compatibility:** no shared component selectors or global tokens are
changed. The CSS remains owned by `movie-details.css`.

**Verification:** `npm run test:visual-design`, dark/light manual inspection,
keyboard focus inspection and narrow viewport smoke all pass.

### Task 5 — Extend existing tests for the new state and composition contract

**Files:** modify `tests/mediaPlayerIntegrationContract.test.js`,
`tests/movieDetailsTorrentLibrary.test.js`; modify `package.json` only if the
existing `test:media-player` command needs an additional existing test entry.

**Why:** the current tests cover sorting and MediaPlayer calls but not the
composition/lifecycle defect that produced the empty status strip.

**Assertions:**

1. HTML contains exactly one `torrentPlaybackStatus`, nested in
   `torrentSourcePanel`, and contains the disclosure/show-more controls.
2. HTML contains no second standalone `.torrent-playback-status` sibling.
3. `mountTorrentPlaybackSession` does not close the workspace after mounting;
   `closeTorrentPicker` remains available for explicit close/provider cleanup.
4. Active status exposes separate selectors for download percentage, available
   duration, speed, peers, ETA and preparation state.
5. `getTorrentWorkspaceState`/equivalent precedence yields error, paused,
   preparation, downloading, complete and idle in the documented order.
6. Source rendering initially shows 10 items, reports total versus visible and
   increases the visible limit by 10 through the show-more action.
7. Existing quality bucket and sort assertions remain unchanged.
8. Existing service contract assertions for list, play, pause, resume, delete,
   progress and capability negotiation remain unchanged.

**Verification:**

```text
cmd /c node tests\movieDetailsTorrentLibrary.test.js
cmd /c node tests\mediaPlayerIntegrationContract.test.js
```

Both commands must exit with code 0 and keep their success messages.

### Task 6 — Build, documentation and generated-output verification

**Files:** modify `README.md` only for active documentation/changelog; generate
`dist/` through npm build; do not edit `dist/` manually.

**Changes:**

1. Update the MovieDetails torrent description to call the surface a unified
   workspace rather than a separate status picker.
2. Keep existing historical torrent changelog entries factual.
3. Add the meaningful user-facing redesign to the current changelog entry under
   `### Features` or `### Refactor`, following the repository version policy.
4. Do not change package or manifest version.

**Verification commands:**

```text
cmd /c npm run test:media-player
cmd /c npm run test:visual-design
cmd /c npm run lint
cmd /c npm test
cmd /c npm run build
cmd /c git diff --check
```

If `npm test` has an unrelated pre-existing failure, record the exact test and
assertion; do not hide it as a successful full-suite result.

## Manual Verification Matrix

Use the unpacked extension after `npm run build` and reload it from
`chrome://extensions`.

| Scenario | Expected visible result |
|---|---|
| Open Torrent with no download | No active status card and no empty rounded strip; search/results state is clear |
| Search in progress | Search status is visible; first batches render progressively; no duplicate rows |
| 95 results | Total says 95; 10 rows appear initially; `Показать ещё` reveals the next 10 |
| Start a release | Workspace remains open; active card appears above saved downloads/player |
| Active download | Download percent, speed, peers, ETA and available playback time are distinct |
| 100% downloaded, playback not ready | Explicit preparation state; no false `Готово к просмотру` |
| Playback ready while downloading | `Доступно для просмотра` is positive and can differ from torrent percent |
| Pause | Active card says `Пауза`; pieces remain; `Продолжить` is available |
| Close/reopen MovieDetails | Download card returns with current persisted state and controls |
| Complete | `Готово к просмотру` plus `Смотреть` and `Удалить` |
| Error | Concrete error state with `Повторить`/`Продолжить`, not an infinite spinner |
| Missing TMDB ID | Explicit explanatory error, no blank status/panel |
| Switch provider and return | Torrent cleanup works and a later reopen rebuilds the correct state |
| Dark theme | Same hierarchy, geometry and readable contrast |
| Light theme | Same hierarchy, geometry and readable contrast |
| Narrow viewport | Metrics/actions stack without clipping or horizontal overflow |
| Keyboard-only navigation | Focus order, disclosure, actions and close control are usable |
| Reduced motion | No progress/action animation that impedes use |

## Audit Corrections

Перед реализацией зафиксированы обязательные поправки по результатам аудита:

1. Ввести детерминированный приоритет состояний: ошибка → пауза → подготовка
   playback → загрузка → готово. `100%` торрента не означает `Готово к просмотру`,
   пока API playback не сообщает готовность или сохранённый файл не помечен
   воспроизводимым.
2. Значение `playback.availableDurationSeconds` из API является источником истины.
   Если snapshot уже получен и значение равно нулю, нельзя подменять его
   `video.duration` или старым локальным значением.
3. Активная раздача получает отдельный контекст и связывается с загрузкой только
   по `downloadId` либо по единственному строгому совпадению метаданных. При
   нескольких похожих загрузках догадки запрещены; гарантированные действия
   остаются в библиотеке сохранённых загрузок.
4. Снятие автоматического `closeTorrentPicker()` после запуска playback требует
   явной отмены только активного поиска, без инвалидирования новой playback-сессии.
5. Нативный `<details>` используется для раскрытия результатов; список раздач
   получает корректные `listitem`-обёртки без `role="listitem"` на кнопке.
6. Добавить jsdom-проверки реальной вложенности DOM, жизненного цикла и действий
   активной карточки; обновить visual contract под новую композицию, а не под
   удалённую четырёхколоночную статусную плашку.

## Plan Pressure Test

- **Owner / contract / retirement:** the existing MovieDetails torrent owner is
  retained; only the standalone status placement/class is retired.
- **Architecture integrity:** no new controller, page, service or backend
  contract is introduced.
- **Verification scope:** static composition, state transitions, source limit,
  existing service calls, visual contract, full suite and manual UI matrix are
  all covered.
- **Task executability:** every task names files, boundaries and commands; no
  task depends on an unspecified API.
- **Product risk:** keeping the panel open could reduce player vertical space;
  the disclosure and compact active card limit that risk while preserving the
  user’s context.
- **Pressure result:** proceed to implementation only after written-plan review.

## Execution Readiness View

- **Intent Lock:** make Torrent a single understandable workspace and remove
  the empty standalone status experience.
- **Scope Fence:** MovieDetails torrent HTML/JS/CSS, existing torrent tests,
  README and generated build output only.
- **Baseline Lock:** current IDs, methods, MediaPlayer API, download persistence
  and visual contract remain authoritative.
- **Approved Behavior:** active card stays with the workspace; saved downloads
  survive page closure; download and playback readiness remain separate.
- **Owner / Contract Constraints:** `MovieDetailsManager` owns UI state;
  `MediaPlayerService` owns local API calls; playback controller owns video.
- **Compatibility Boundary:** no backend schema, API, torrent transport,
  retention, credentials or locator changes.
- **Retirement Boundary:** remove the old sibling placement and generic status
  surface; preserve ID/data attributes needed by existing callers until all
  focused tests pass.
- **Task Batches:** markup → state/lifecycle → CSS → tests → build/docs/manual
  verification.
- **Test Obligations:** focused torrent tests, visual design test, lint, full
  regression suite, build and manual matrix.
- **Review Gates:** inspect DOM nesting and mount lifecycle before accepting
  CSS; inspect state precedence before accepting UI text.
- **Drift / Rewind Rules:** if a backend/API requirement appears, stop and split
  it into a new plan; if an external consumer of the retired class appears,
  preserve a minimal compatibility carrier and re-review retirement.
- **Evidence Required:** passing command output, generated build, DOM/state
  contract results and screenshots or named manual results for every critical
  state.
- **Advisory Boundary:** this is an implementation plan, not runtime completion
  authority.

## Risks and Rollback

- **Duplicate state:** prevent by retaining one `MovieDetailsManager` owner and
  one workspace orchestrator.
- **Panel lifecycle regression:** contract test checks that mount no longer hides
  the panel; provider-switch smoke checks the existing explicit close path.
- **Nested interactive markup:** active card becomes a section rather than a
  status/button container; source result cards remain one-action controls.
- **Long result lists:** local show-more limit prevents a large initial DOM while
  preserving already collected incremental data.
- **Stale persisted state:** reopening always calls existing `listDownloads()`;
  no new client cache is introduced.
- **Theme regression:** visual design contract plus dark/light manual check
  protect token and contrast rules.
- **Rollback:** revert the focused MovieDetails HTML/JS/CSS/test/docs changes
  from version control; no backend migration or user-data rollback is required.
- **Dirty worktree:** never reset, clean or overwrite unrelated user changes.

## Retirement Criteria

The redesign is complete only when all are true:

- `#torrentPlaybackStatus` has one instance and is nested in
  `#torrentSourcePanel`;
- no standalone empty `torrent-playback-status` sibling or old generic status
  layout remains;
- starting playback leaves the Torrent workspace visible;
- idle mode hides the active card rather than showing an empty placeholder;
- saved downloads, pause/resume/retry/play/delete and reopen behavior still
  work through existing service methods;
- torrent percentage and playback-ready duration remain visibly independent;
- source filters/sorting and incremental first-10/show-more behavior pass;
- all documented states pass focused tests and manual smoke;
- `npm run test:visual-design`, `npm run lint`, `npm test` and `npm run build`
  are recorded with their real outcomes;
- README and generated `dist/` describe and contain the new composition;
- no new Torrent runtime owner or backend contract was introduced.

## Approval Gate

Пользователь подтвердил план сообщением «го» после аудита. Реализация разрешена
в рамках указанной области; backend/API и остальные провайдеры не изменяются.
