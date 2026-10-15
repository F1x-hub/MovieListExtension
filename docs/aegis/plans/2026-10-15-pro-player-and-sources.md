# План: профессиональный уровень источников и плеера

Дата: 2026-10-15
Статус: утверждён владельцем в беседе (идея Video.js 10 отложена «на потом»); реализация не начата.
База кода: `origin/master` v1.3.7 (`83a8292`). Номера строк в этом плане — по ней; перед правкой сверять.
Область: `src/pages/movie-details/*`, `src/shared/services/player/*`, `src/shared/services/parsers/*`, `content-scripts/player-cleaner.js`,
`src/background/*.json`, `manifest.json`, `rules/firestore.rules` (только отдельный трек безопасности), CI.

## Цель

Довести источники и плеер до уровня, при котором сломанный чужой сайт не ломает продукт, ошибки понятны, поведение одинаково предсказуемо
во всех источниках, а качество проверяется автоматически в реальном браузере. Видимый результат для пользователя: два входа в окне плеера —
**«Смотреть»** (рабочее название) и **«Торрент»**; внутри «Смотреть» — меню «Источник», озвучка, качество, как у каждого источника сегодня,
плюс автопереход на запасной источник при отказе.

## Принципы

1. Сначала безопасность и наблюдаемость, потом внешний лоск.
2. Поведение по умолчанию не меняется скрытно: всё новое за локальным флагом, следующий релиз включает его по умолчанию.
3. Каждый шаг начинается с теста, который до правки падает (как в плане 2026-10-04).
4. Монолит `player-cleaner.js` разбираем по частям с характеризационными тестами, а не одним коммитом.
5. Удалённого выключателя нет (облачных флагов и Firestore-документов под это не заводим): откат — выпуском версии через собственный апдейтер.

## Базовое состояние (подтверждено в коде и экспериментами)

- Прямой поток на странице расширения есть только у Kodik (через AnimeGo, отдельный HLS-манифест на каждое качество), Seasonvar (один MP4 на озвучку)
  и Rutube (по названию, одна дорожка, прогресс OPAQUE). KinoGo, VidSrc и большая часть Ex-FS — iframe провайдера.
- Шапка источников: 5–8 кнопок. Автовыбор без lastSource берёт первую кнопку, то есть `parser:kinogo` даже для аниме (`movie-details.js:8312–8318`).
- Автоперехода на запасной источник нет; отказ приходит тремя путями (catch `loadParserSource` `:10497`, `PLAYER_SOURCE_STATE` `:8518–8545`, таймаут lifecycle).
- iframe провайдеров монтируются без `sandbox`: скрипт внутри такого iframe увёл вкладку расширения на сторонний URL и подделал сообщение `CHANGE_SOURCE`
  (воспроизведено в Chromium; отправителя `CHANGE_SOURCE` в коде нет).
- `rules.json` id 1,2,5,6 без `initiatorDomains` (снимают CSP/XFO у `kinopoisk.ru`, ставят `ACAO:*` на `rutube.ru`/`rtbcdn.ru` для всех инициаторов);
  `web_accessible_resources` открыты для `<all_urls>` (включая `content-scripts/*.js`).
- `player-cleaner.js` ~5,7 тыс. строк: `replacePlayer()` 3 920 строк, ≈344 присваивания `.style.X =` (354 вхождения `.style.`), 17 селекторов по хешированным классам Venom, 90 `console.*`,
  подписи плеера зашиты по-русски; Media Session отсутствует; в меню качества «Auto (Not found)».
- hls.js 1.6.15 (актуальная линия 1.7.x, источник один: GitHub releases).
- Тесты плеера работают на заглушках (`vm`/jsdom); реальный Chromium есть в CI только для интерфейса (v1.3.7), для плеера нет.
- Торрент-бэкенд: `http://127.0.0.1:3000` — единственный легитимный локальный запрос расширения.

## Дорожка A. Безопасность (E0), отдельный трек, ~1 неделя + ручной прогон провайдеров

- **A1 Sandbox** `allow-scripts allow-same-origin allow-forms allow-presentation` на iframe провайдеров: `BaseParserService.js:166`, `src/pages/movie-details/PlayerSurface.js:44`
  (класс `MovieDetailsPlayerSurface`; опция `{sandbox}`: `renderFrameInto` используют и трейлеры `movie-details.js:11565`), `VidSrcAdapter.js:112`, `search.js:4307` (перевести на
  `renderFrameInto`, подключив `../movie-details/PlayerSurface.js` в `search.html` перед `search.js` (он `type="module"`, ~`:306`) и вызывая `MovieDetailsPlayerSurface.renderFrameInto`; сейчас `${url}` без экранирования). Механизм отката — константа `SANDBOX_PROVIDERS`
  (**изначально пустая**): провайдер добавляется только после живого прогона. `allow-same-origin` обязателен (без него origin=`"null"`, и `isTrustedPlayerMessage`
  отбрасывает все сообщения) — закрепить тестом. Spotify (`movie-details.js:3431`) — отдельно.
- **A2** Удалить мёртвые обработчики `CHANGE_SOURCE` (`movie-details.js:8511,8723`, `search.js:4010`).
- **A3** `rules.json` id 1,2,5,6 → отдельный ruleset: `requestDomains` вместо подстрочного `urlFilter` + `initiatorDomains:[extId]`; у id 1/2 убрать
  `xmlhttprequest`; проверить JS-навигацию во фрейме виджета Кинопоиска. Тест: extId = sha256(`key`) = `dgdejomdgiabgcfijcdhjefijdfiemhd`.
- **A4** `createMenuItem` и заголовок подменю (`player-cleaner.js:4264–4286`) на `textContent` (завести `CHEVRON_SVG`).
- **A5 URL-политика сети.**
  (а) `PolicyLoader` в `HlsPlaybackFactory.buildConfig` (приложение 1; сброс `pLoader/fLoader/cmcd/progressive/emeEnabled`); единственный `new Hls(` — `BaseParserService.js:209` (`_createUnmanagedHls`, его зовёт `AnimeGoParser.js:769`): метод и вызов удалить, всё через фабрику (она создаёт `new HlsCtor(`, `:151`);
  GhostPlayer (`new this._Hls(`, `player-cleaner.js:5588`) — явное исключение; `search.js:4267` уже идёт через фабрику; профиль `isTorrentStream ? 'local' : 'remote'`
  (в `renderCustomPlayer` вычислять `isTorrentStream = Boolean(this.torrentPlaybackSession)` до `:10692`).
  (б) В фабрике перехват `response.text==='POLICY_VIOLATION'` при **любом** `fatal` → `destroy()` → `onFatal({reason:'policy'})` → источник исключается
  (нарушение на фрагменте/ключе приходит `fatal:false`, без `destroy()` hls.js перезапрашивает 4 раза).
  (в) Прямые присваивания `video.src`/`track.src`/`<source src>`: `BaseParserService.js:116,139–153`, `SeasonvarParser.js:507,564,658,828`, `SeasonvarAdapter.js:109`,
  `search.js:4245` (`<source src="${this.currentVideoUrl}">`), `player-cleaner.js:5617,5621` (GhostPlayer, ветка без HLS; проверять только при `typeof UrlPolicy !== 'undefined'`), `AnimeGoParser.js:774`, `movie-details.js:10692,10752` — проверять `UrlPolicy.check(url,{kind:'file'})` до присваивания.
  (г) `UrlPolicy.check(url,{kind:'manifest'|'level'|'init'|'fragment'|'key'|'file',profile:'remote'|'local'})`: allowlist хостов — только для `manifest` и `file`;
  остальное — https + публичный хост (принятый риск: фрагменты/ключи идут с поддоменов CDN). `profile:'remote'` **обязан отклонять loopback и приватные адреса**
  (DNR пропускает `127.0.0.1:3000` для любого удалённого URL); `profile:'local'` допускает только `http://127.0.0.1:3000/`. `UrlPolicy.js` — до
  `HlsPlaybackFactory.js` (`:467`) и на `search.html`. GhostPlayer на странице расширения наследует `PolicyLoader` (`player-cleaner.js:5591`) — добавить `destroy()` при
  нарушении; в iframe провайдера политикой не охвачен (принятый риск). Seasonvar-медиа по `http`: проверить автоповышение до https на странице расширения.
  (д) **DNR** `local_network_guard` (приложение 2): три block-правила (один regex превышает лимит 2 КБ) + allow только для `127.0.0.1:3000`. Порт `3579` в коде не
  используется (убрать из `host_permissions` отдельной задачей). Принятые остаточные риски: DNS-имена на частные адреса, DNS rebinding.
- **A6** `decodeSource` Kodik: перебор сдвигов 0–25 с валидацией (`new URL`, `.m3u8`); причина `decode_failed` в диагностике.
- **A7** `redactUrl()` (origin+path); исправить логи: `player-cleaner.js:3938`, `movie-details.js:10318,10481–10490` (`iframeSources` в `console.info`), `10580,10677`, KinogoSearchTrace.
- **Отдельный трек безопасности (вне этой цели):** лазейка `isApprovedUser` (`firestore.rules:51–58, 582`: истинно без `approvalStatus`, `users create` без поля);
  сужение `web_accessible_resources` по потребителям (watchlist-скрипты внедряют сервисы и `*-injected.js`; `player-cleaner.js:1048` — `suppress-errors.js`;
  `kinogo-watchlist-injected.js:120` встраивает `movie-details.html?embedded=true`), `use_dynamic_url` после проверки `runtime.getURL`.

## Дорожка B. Единый вход «Смотреть» (E1), M, 5–7 дней

Нового парсера и адаптера нет; код на `parser:<id>` (lastSource, RELIABLE, `bindProviderVideoTracking`, комнаты) не меняется.
Прототип собран и проверен в изолированной копии (см. `docs/aegis/work/2026-10-15-pro-player-and-sources/e1/`): +425/−30 строк, 10 приёмочных
проверок и a11y (всего 11 тестов) проходят с флагом `unifiedWatchEntry` (в прототипе — `localStorage['unifiedWatchEntry']==='1'`; хранилище флага выбирает владелец), на текущем коде все падают.

- **B1 Разметка:** `movie-details.html` не меняется. При включённом флаге метод `ensureWatchEntryDom()` создаёт `#watchEntryGroup` (`#watchEntryBtn`,
  `#sourcePopoverToggle` «▾», `#torrentEntryBtn`, `#sourcePopover[hidden]`) и **переносит** узел `#sourceButtonsContainer` в поповер (тот же id и обработчики; поиски
  `:8289,8301` и `WatchRoomPanel.js:344` продолжают работать). `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls` — на «▾», не на «Смотреть».
- **B2 Псевдоним:** «Смотреть» вне контейнера, без класса `.source-btn`, с `data-alias-value=<точный data-value выбранной внутренней кнопки, любой схемы>`;
  синхронизируется в конце `updateActiveSourceButton` (`:9921–9937`). Инвариант: `querySelectorAll('[data-value=X]').length===1`.
- **B3 «Торрент»** вне контейнера, показывается только у фильма при `mediaPlayerReady` (как сегодня), со своим `click` → `openTorrentPicker()`;
  `updateActiveSourceButton('mediaplayer:torrent')` переключает активность на `#torrentEntryBtn` и **не меняет** `data-alias-value`. Обработчик, вынесенный в метод,
  обязан сохранить литерал `sourceButtonsContainer.addEventListener('click'` (его ищет `playerVisualContract:53`); CSS поповера — в конце `player.css`.
- **B4 Приоритет выбора:** hint комнаты > `activeSourceValue` (`explicitSource`, `:8287–8296`) > `watchPrefs_${movieId}={innerId}` > lastSource > `rankInnerSources(movie)`
  (по умолчанию = текущий порядок кнопок; для порядка запасных Rutube последним для фильмов). Запись `watchPrefs` — **только в клике** (`{userInitiated:true}`),
  не в `changeVideoSource`. Ранняя ветка `initializedCustomParser` (`:8216–8233`) выполняется, только если нет `watchPrefs.innerId` и lastSource либо они совпадают с предзагруженным.
- **B5 Автопереход** (`handleWatchSourceFailure`, новая логика): `attemptedInnerIds` на запуск с учётом `requestId`; отказ = catch `loadParserSource` + обе ветки `unavailable`
  («Ничего не найдено», «Источники не найдены») + `PLAYER_SOURCE_STATE` (повторная попытка kinogo остаётся первой) + `onLifecycleState`; дедупликация (`run.failed` — одно
  решение на источник); таймаут lifecycle (5 с) показывает сообщение, но автопереход запускается только при `reason !== 'timeout'`; **не выполняется** в активной комнате и после
  ручного клика в текущем запуске (вместо этого сообщение + кнопка «Попробовать другой источник», опция `onTryOther` в `PlayerSourceLifecycle.setState`).
- **B6 Поповер:** закрытие по клику снаружи, Esc, стрелки, возврат фокуса после перестройки `innerHTML=''` (`:9660`, `:8242,8262,8277`, `:6788`); пока идёт поиск «Смотреть» показывает
  «Поиск источников…» (`aria-busy`); статус «найден» = `currentSources.some(s=>s.parserId===id)`, для Seasonvar «проверится при запуске» (в прототипе подсказка Seasonvar показывается
  всегда — доделать); статус не только цветом.
- **B7 Включение:** по умолчанию выключено + локальный тумблер администратора; следующий релиз включает по умолчанию; откат — релизом. Миграция: `lastSource_${movieId}` читается как есть.
- **B8 Приёмка:** 10 проверок + a11y (11 тестов) `e1/e1WatchAliasAcceptance.full.test.mjs` (шапка, дефолт без изменений, lastSource→псевдоним, hint, `bindProviderVideoTracking`, псевдоним на `vidsrc:`/URL,
  ручной выбор, предзагрузка против `watchPrefs`, автопереход, выключенный флаг, торрент-кнопка) + a11y; существующие тесты проходят с выключенным флагом.
  Сломаться могут: `torrentModalLayout.test.cjs:29`, `movieDetailsPhase3C:103`, `3D:98`, `playerVisualContract:53` и CSS-регулярка в нём, `movieDetailsPlayerAuditRegression:370–399`.
- **Не сделано в прототипе:** сквозной запуск (нужны авторизация и сеть), счётчики и копирование отчёта, тумблер администратора, статус «найден».

## Дорожка C. Надёжность источников и диагностика, ~1 неделя

- **C1 Здоровье источников.** Ночной workflow GitHub Actions: для каждого провайдера пробный прогон по эталонным тайтлам (поиск → список источников → разрешение потока; для Kodik —
  `/ftor` и декодирование), результат в сводке и при падении в issue. Данных пользователей нет. Оговорка: ранеры GitHub могут быть в другом регионе, чем пользователи (гео) — отчёт
  помечает «не удалось из региона ранера» отдельно от «сломан разбор».
- **C2 Экран «Диагностика»** в настройках: локальные счётчики без URL и uid (`resolveOk/Fail{sourceId}`, `fallbackReason`, `timeToFirstFrame`, `decode_failed`), копирование отчёта. Удалённой отправки нет.
- **C3 Контракт провайдера.** Явный список возможностей источника (серии, озвучки, качества, субтитры, срок жизни ссылки, нужен ли Referer) вместо размазанных по ~15 методам адаптеров;
  основа для здоровья и будущего каталога.
- **C4 Правила повторов:** повторное добывание ссылки при 401/403/410 (`onSourceExpired` в `HlsPlaybackFactory`, независимо от `fatal`), не бесконечные повторы; исключение источника на 24 ч
  при повторном 403 после `forceRefresh` (хранить в `chrome.storage.local` с TTL — `unavailableProviderIds` лишь Set в памяти).

## Дорожка D. Качество плеера и интерфейс, ~2–4 недели, итеративно

Каждый пункт: сначала характеризационный тест, потом правка, по одному контролу.
- **D1 Единые состояния:** загрузка с названием источника (вместо `0:00 / 0:00`), буферизация, ошибка с «Повторить» / «Попробовать другой источник», «Авто» вместо «Auto (Not found)».
- **D2 Media Session и управление:** `play/pause/seekto/previoustrack/nexttrack` → основное видео, `mediaSession.metadata`; горячие клавиши (пробел/K, J/L ±10 с, стрелки ±5 с, F, M, C, `<`/`>`
  скорость, `?` — подсказка); корректный PiP (`leavepictureinpicture`).
- **D3 Доступность по WCAG 2.2 AA:** шкала перемотки как ARIA-slider (`aria-valuetext`, Home/End/PageUp/PageDown), видимый фокус, подписи кнопок, навигация меню клавиатурой, `aria-live` для сообщений.
- **D4 i18n:** строки плеера из `player-cleaner.js` в `src/shared/i18n/locales.js` (RU+EN).
- **D5 Единый визуальный язык:** 354 присваивания `.style.*` → классы и токены (`player.css`, префикс `mre-`); убрать акцент `#4da6ff` у PiP/субтитров; поштучно.
- **D6 Разбор монолита:** порядок — меню настроек → громкость/скорость → оформление субтитров → превью (GhostPlayer) → шкала перемотки; перед громкостью/скоростью характеризационные тесты (файл без покрытия).
- **D7 Продуктовые мелочи:** запоминание озвучки и качества на тайтл (`watchPrefs`), карточка «Следующая серия» с отсчётом (на базе `AutoNextCoordinator`), «Продолжить с …».

## Дорожка E. Тесты и CI, параллельно с A–B

- Браузерный смоук плеера с расширением: `launchPersistentContext` + `channel:'chromium'` (в headless-shell `--load-extension` не работает), фикстуры VP9/Opus (в CI-Chromium нет H.264/AAC);
  сценарии: блок `127.0.0.1:9999` при разрешённом `:3000`, 403/истечение ссылки, нарушение политики, sandbox-контракт, утечка элементов. Подключить в `release.yml` рядом с существующими браузерными шагами.
- В среде разработки Playwright 1.62.1 ждёт Chromium 1234; в песочнице стоит 1194 — тесты с `chromium.launch` требуют `executablePath` (в CI `playwright install chromium` есть).
- Контрактные тесты на `readFileSync` (~166 файлов с `readFileSync`, из них ≈73 затрагивают `movie-details.js`/`player-cleaner.js`/`search.js`) — заложить время на обновление при каждой правке `movie-details.js`/`player-cleaner.js`.

## Ворота и отложенное

- **E1.5 (S–M, 2–3 дня, офлайн-скрипт, данные пользователей не нужны):** N тайтлов × озвучки Kodik × ключи `links`: (а) как часто нужной пары «озвучка + качество» нет в одном потоке;
  (б) длительности и смещения между озвучками и релизами в трёх точках (начало/середина/конец; ffmpeg/chromaprint); (в) доля совместимых пар (|Δдлительности| ≤0,5 с).
  **E2 (второй элемент со звуком, L, только Kodik)** делаем, если пара отсутствует в одном потоке ≥15% случаев и пары совместимы; иначе не делаем. Спецификация E2 (синхронизация, HOLD, audio sink и др.)
  сохранена в `docs/aegis/work/2026-10-15-pro-player-and-sources/90-evidence.md` (раздел «E2»).
- **E1c (XL):** единый каталог «все качества всех источников в одном меню» через `WatchParser` — только по отдельному решению после E1.5.
- **Video.js 10 / Media Chrome — на потом** (решение владельца). Перед любым внедрением — проба 1–2 дня на одном нативном источнике (Kodik): озвучки, оформление субтитров, клавиши, размер пакета, CSP.
  Известно: Media Chrome не показывает меню субтитров/аудиодорожек/качества и клавиши в README; Video.js 10 — бета, меню качества и аудиодорожек есть в changelog; для iframe-источников
  фреймворк, вероятно, не подходит (cleaner работает внутри чужого документа).

## Порядок и сроки (оценка трудозатрат разработчика, без запаса; при исполнении агентом календарь определяют шлюзы владельца)

| Недели | Работа |
|---|---|
| 1–2 | A (безопасность) + E (смоук в CI) параллельно с B (E1) |
| 3 | C (здоровье, диагностика, повторы) + E1.5 (замер) |
| 3–6 | D (интерфейс и разбор монолита), итеративно, по релизам |
| 4 | Решение по воротам: E2 да/нет; E1c да/нет |

## Критерии приёмки

- A: sandbox-контракт зелёный; `rules.json` проверен; блок `127.0.0.1:9999` при работающем торренте; живой прогон каждого провайдера перед добавлением в `SANDBOX_PROVIDERS`.
- B: 10 проверок приёмки + a11y; 0 регрессий прогресса RELIABLE и автоперехода на следующую серию; `lint` + `npm test` зелёные; смоук зелёный.
- C: ночной прогон работает; диагностика копируется; 403 не вызывает бесконечных повторов.
- D: по каждому пункту — тест до правки; браузерный смоук покрывает меню, громкость и скорость.
- Общие: время до первого кадра и доля ошибок воспроизведения измеряются локально; релиз с флагом, откат релизом.

## Решения владельца

Принято по умолчанию (рекомендации приняты в беседе; можно пересмотреть при реализации):
1. Меню «Источник ▾» — поповер в шапке. 2. Для аниме по умолчанию открывать `animego` (нативный Kodik с меню озвучки/качества) — **подтвердить при B4**, сейчас по умолчанию остаётся текущий порядок (KinoGo).
3. Таймаут lifecycle не запускает автопереход (только сообщение). 4. Удалённого выключателя нет, откат релизом. 5. «Торрент» остаётся только у фильмов. 6. Озвучки разных источников в один список не объединяются (подсказка в UI и changelog).
Открыто: название входа (рабочее «Смотреть»); Seasonvar-медиа по `http` (допустить с пометкой или исключить; зависит от проверки автоповышения в A5); делать ли E2 и E1c (после E1.5).

## Риски

Контрактные тесты на `readFileSync`; sandbox не проверяется в CI (нужен ручной прогон живых провайдеров, возможны гео-ограничения и детект sandbox); новая логика автоперехода (три пути отказа, комнаты);
рефакторинг cleaner без покрытия; зависимость от структуры чужих сайтов остаётся фундаментальной (C1 лишь сокращает время обнаружения поломки). Юридическое: нативное воспроизведение потоков провайдера убирает его
плеер/рекламу/брендинг — вероятное нарушение ToS провайдера (решение владельца); подмену Referer и `no-referrer` описать в политике приватности; CWS-политики не применяются (распространение через GitHub).

## Не подтверждено

Виден ли флаг из `localStorage` в режиме `?embedded=true` (страница расширения во фрейме на чужом сайте, возможное разделение хранилища); 
TS-демукс и H.264/AAC; живые провайдеры и CDN Kodik; sandbox на живых плеерах и Spotify; Bluetooth/`outputLatency`; фон/PiP/Media Session на реальных устройствах; сквозной запуск E1 (авторизация и сеть);
IPv6 и `127.0.0.2` в DNR; узкий allow `127.0.0.1:3000` (в стенде проверялся надмножественный allow на 3000/3579 — прогнать узкий перед A5); тайминг озвучек Kodik между релизами (гипотеза: тот же релиз → 0).

## Приложение 1. PolicyLoader (hls.js 1.6.15; проверено: блок до запроса, блок после редиректа, без повторов, `destroy()` безопасен)

```js
const Base = Hls.DefaultConfig.loader;
const kindOf = c => c.keyInfo ? 'key' : c.frag ? (c.frag.sn === 'initSegment' ? 'init' : 'fragment') : c.type; // manifest|level
class PolicyLoader extends Base {
  load(ctx, cfg, cb) {
    const r = UrlPolicy.check(ctx.url, { kind: kindOf(ctx), profile });
    if (!r.ok) { this.context = ctx; this.callbacks = cb; this.stats.loading.start = performance.now();
      Promise.resolve().then(() => this.callbacks && cb.onError({ code: 0, text: 'POLICY_VIOLATION' }, ctx, null, this.stats)); return; }
    super.load(ctx, cfg, cb);
  }
  readystatechange() {
    const x = this.loader;
    if (x && x.readyState >= 2 && !this.stats.aborted && !UrlPolicy.check(x.responseURL || this.context.url, { kind: kindOf(this.context), profile }).ok) {
      const { context, callbacks, stats } = this; this.abortInternal();
      callbacks && callbacks.onError({ code: 0, text: 'POLICY_VIOLATION' }, context, null, stats); return;
    }
    return super.readystatechange();
  }
}
// config: { loader: PolicyLoader, pLoader: undefined, fLoader: undefined, progressive: false, cmcd: undefined, emeEnabled: false }
// ERROR: if (d.response?.text === 'POLICY_VIOLATION') { hls.destroy(); exclude(source); }   // при любом fatal
```

Проверка в загрузчике лишь не даёт использовать данные: запрос на запрещённый хост уже ушёл — SSRF закрывает только DNR (приложение 2).

## Приложение 2. DNR `local_network_guard` (extId = `dgdejomdgiabgcfijcdhjefijdfiemhd`; стенд: `docs/aegis/work/2026-10-15-pro-player-and-sources/e1/dnr-ext`)

```json
[{"id":1,"priority":1,"action":{"type":"block"},"condition":{"regexFilter":"^https?://(localhost|127\\.[0-9]+\\.[0-9]+\\.[0-9]+|0\\.0\\.0\\.0)\\.?(:[0-9]+)?(/|$)","initiatorDomains":["dgdejomdgiabgcfijcdhjefijdfiemhd"],"resourceTypes":["xmlhttprequest","media","sub_frame","image","websocket","ping","other"]}},
 {"id":2,"priority":1,"action":{"type":"block"},"condition":{"regexFilter":"^https?://(10\\.[0-9]+|192\\.168|169\\.254|172\\.(1[6-9]|2[0-9]|3[01]))\\.[0-9]+\\.[0-9]+(:[0-9]+)?(/|$)","initiatorDomains":["dgdejomdgiabgcfijcdhjefijdfiemhd"],"resourceTypes":["xmlhttprequest","media","sub_frame","image","websocket","ping","other"]}},
 {"id":3,"priority":1,"action":{"type":"block"},"condition":{"regexFilter":"^https?://\\[(::1?|::ffff:[0-9a-f.:]+|f[c-d][0-9a-f]*:[0-9a-f:]*|fe[89ab][0-9a-f]*:[0-9a-f:]*)\\](:[0-9]+)?(/|$)","initiatorDomains":["dgdejomdgiabgcfijcdhjefijdfiemhd"],"resourceTypes":["xmlhttprequest","media","sub_frame","image","websocket","ping","other"]}},
 {"id":4,"priority":2,"action":{"type":"allow"},"condition":{"regexFilter":"^http://127\\.0\\.0\\.1:3000/","initiatorDomains":["dgdejomdgiabgcfijcdhjefijdfiemhd"],"resourceTypes":["xmlhttprequest","media","other"]}}]
```

## Приложение 3. createMenuItem на `textContent`

```js
const CHEVRON_SVG = '<svg class="player-settings-menu__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
const createMenuItem = (label, value) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'player-settings-menu__item'; b.setAttribute('role', 'menuitem');
  const l = document.createElement('span'); l.className = 'player-settings-menu__label'; l.textContent = label;
  const v = document.createElement('span'); v.className = 'player-settings-menu__value'; v.textContent = value;
  b.append(l, v); b.insertAdjacentHTML('beforeend', CHEVRON_SVG); return b; };
```
