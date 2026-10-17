# План: профессиональный уровень источников и плеера

Дата: 2026-10-15. Редакция: 2, после аудита. Статус: исправленный план; реализация не начата. Текущий запрос разрешает изменение документов, но не реализацию или релиз. Проверенная база: HEAD 83a82928c0c33a8cd2f7f9e5e77a10c73622f674; manifest/package 1.3.7. Номера строк — ориентиры, перед правкой искать по символам. Область будущей реализации: MovieDetails, Search, shared player/parsers, player-cleaner, целевые настройки/i18n/стили, тесты и документация. manifest.json, src/background/*.json и CI — только по соответствующим карточкам; rules/firestore.rules, native/server — отдельные треки.


## Цель

Довести источники и плеер до уровня, при котором сломанный чужой сайт не ломает продукт, ошибки понятны, поведение одинаково предсказуемо во всех источниках, а качество проверяется автоматически в реальном браузере. Видимый результат для пользователя: два входа в окне плеера — «Смотреть» (рабочее название) и «Торрент»; внутри «Смотреть» — меню «Источник», озвучка, качество, как у каждого источника сегодня, плюс автопереход на запасной источник при отказе.


## Принципы

Сначала безопасность и наблюдаемость, потом внешний лоск.
E1 и его автопереход — за локальным флагом, по умолчанию выключены. Исправления безопасности не скрывать за продуктовым флагом; sandbox включается по проверенным провайдерам. Включение E1 по умолчанию — отдельное решение на релизе, не автоматически в следующей версии.
Новые функции и исправления: целевой тест red→green. Перенос без изменения поведения и сохранённые контракты: характеризация/регрессия green→green. Тип теста и ожидаемый отказ указывать в карточке.
Монолит player-cleaner.js разбираем по частям с характеризационными тестами, а не одним коммитом.
Удалённого выключателя нет (облачных флагов и Firestore-документов под это не заводим): откат — выпуском версии через собственный апдейтер.

## Базовое состояние и сила доказательств

Статические факты сверяются с указанной базой. Эксперименты и точные метрики исходного документа остаются историческими до воспроизведения. В текущем checkout нет каталога E1 и ref origin/claude/elegant-galileo-ltuk2k; результаты прототипа этим аудитом не подтверждены. Это не доказывает отсутствия материалов в другом окружении.
Прямой поток на странице расширения есть только у Kodik (через AnimeGo, отдельный HLS-манифест на каждое качество), Seasonvar (один MP4 на озвучку) и Rutube (по названию, одна дорожка, прогресс OPAQUE). KinoGo, VidSrc и большая часть Ex-FS — iframe провайдера.
Шапка источников: 5–8 кнопок. Автовыбор без lastSource берёт первую кнопку, то есть parser:kinogo даже для аниме (movie-details.js:8312–8318).
Автоперехода на запасной источник нет; отказ приходит тремя путями (catch loadParserSource :10497, PLAYER_SOURCE_STATE :8518–8545, таймаут lifecycle).
В целевых renderer нет sandbox по умолчанию. Исходное вложение заявляет Chromium-эксперимент с top navigation и поддельным CHANGE_SOURCE; этот эксперимент текущим аудитом не воспроизведён. Наличие приёмников CHANGE_SOURCE подтверждено статически, легитимного отправителя в целевом поиске не найдено.
rules.json id 1,2,5,6 без initiatorDomains (снимают CSP/XFO у kinopoisk.ru, ставят ACAO:* на rutube.ru/rtbcdn.ru для всех инициаторов); web_accessible_resources открыты для <all_urls> (включая content-scripts/*.js).
player-cleaner.js ~5,7 тыс. строк: replacePlayer() 3 920 строк, ≈344 присваивания .style.X = (354 вхождения .style.), 17 селекторов по хешированным классам Venom, 90 console.*, подписи плеера зашиты по-русски; Media Session отсутствует; в меню качества «Auto (Not found)» (рядом уже есть «Автоматически», :4693).
Локальный hls.js — 1.6.15 (проверено через экспорт версии). Обновление библиотеки — отдельная карточка после сверки стабильного релиза, security fixes и совместимости; prerelease не считать стабильной линией.
Тесты плеера работают на заглушках (vm/jsdom); реальный Chromium есть в CI только для интерфейса (v1.3.7), для плеера нет.
MediaPlayer по умолчанию использует http://127.0.0.1:3000; MediaPlayerService имеет device-token авторизацию и нормализацию origin URL сессии. Пробел сетевой границы ниже не доказывает неавторизованный доступ к backend. Порт 3579 и все local-потребители проверить до удаления permissions.

## Дорожка A. Безопасность (E0), отдельный трек, ~1 неделя + ручной прогон провайдеров


A1 Sandbox allow-scripts allow-same-origin allow-forms allow-presentation для проверенных iframe провайдеров: BaseParserService.renderPlayer, MovieDetailsPlayerSurface.renderFrameInto, VidSrcAdapter.mount и Search. Search перевести на общий безопасный renderer, подключив PlayerSurface до search.js. SANDBOX_PROVIDERS изначально пуст; добавление — после живого прогона. allow-same-origin нужен текущему origin-checked bridge, но не является безусловным правилом для любой архитектуры; не применять этот набор к chrome-extension:/same-origin страницам. Top-navigation/popups/downloads не разрешать без отдельного решения. Трейлеры/Spotify — отдельные политики. Готовая инфраструктура с пустым списком не означает включённой защиты реальных провайдеров; учитывать nested frames и остаточные риски.

A2 Удалить мёртвые обработчики CHANGE_SOURCE (movie-details.js:8511,8723, search.js:4010).

A3 rules.json id 1,2,5,6: отдельный ruleset с requestDomains по фактическим widgets.kinopoisk.ru/www.kinopoisk.ru и rutube/CDN-потребителям вместо подстрочного urlFilter; initiatorDomains:[extId]; у 1/2 убрать xmlhttprequest. Родительские домены не добавлять без потребности. extId вычислять из DER-байтов декодированного manifest.key: первые 128 бит SHA-256, hex 0..f → a..p; сверить с runtime.id (ожидание базы: dgdejomdgiabgcfijcdhjefijdfiemhd). Проверить JS-навигацию виджета. initiatorDomains — непосредственный инициатор запроса, не всё дерево iframe; подзапросы виджета требуют самостоятельной проверки.

A4 createMenuItem и заголовок подменю (player-cleaner.js:4264–4286) на textContent (завести CHEVRON_SVG).

A5 URL-политика сети — сначала A5-0, затем реализация.
- A5-0: локальный эксперимент remote/local, redirect и одновременных сессий. Разделить гарантии: запрещённый ответ не используется; HTTP-запрос до запрещённого endpoint не доходит; backend отклоняет запрос без авторизации. CORS/fetch error, abort после responseURL и отказ API не доказывают отсутствие контакта.
- Граница: extension-owned loaders и media-src. Provider/nested iframe имеет собственного инициатора; initiatorDomains:[extId] не охватывает автоматически всё дерево. Для него отдельный эксперимент и остаточный риск. DNS rebinding и публичные DNS-имена на private IP строковая UrlPolicy не закрывает.
- UrlPolicy.check(url,{kind,profile}): URL API, запрет credentials/неподдержанных схем/непубличных буквальных IP в remote. Матрица IPv4, включая 2130706433/0x7f.1, IPv6/mapped IPv4, trailing dot и границы hostname. Явное отображение всех context kinds установленного hls.js: master/level/audio/subtitle playlists, init/fragments/keys/files. Неизвестный kind — отказ.
- Remote: HTTPS; host allowlist стартовых manifest/file; дочерние ресурсы — HTTPS и публичный hostname с остаточным риском стороннего CDN. Относительный URI разрешается относительно фактического parent URL. Local: подтверждённый MediaPlayer origin и ресурсы активной сессии. Transport profile отделён от retry-policy bounded/persistent.
- Redirect: responseURL проверяется слишком поздно для запрета контакта. Проверить transport с запретом автоматических редиректов (например, Fetch redirect:'error') либо иной механизм до следующего запроса. Легитимный CDN redirect требует отдельного проверенного пути; XHR-прототип исходного приложения 1 не является готовой защитой.
- DNR — дополнительная граница. Глобальный allow всего http://127.0.0.1:3000/ для extId не принимать как remote/local изоляцию; tabIds тоже не связывает запрос с сессией в общей вкладке. Конкретные transport, сессионное исключение и endpoint разрешаются лишь после A5-0. Если строгая граница недостижима, предложить владельцу ограниченную гарантию; риск не объявлять устранённым.
- HlsPlaybackFactory накладывает защитные поля после caller overrides, использует переданный HlsCtor и проверенный loader; исключить обход через pLoader/fLoader и дополнительные сетевые каналы cmcd/progressive/EME/content steering. POLICY_VIOLATION при fatal:false/true: ровно одно завершение, отмена retries, destroy и onFatal({reason:'policy'}), без двойного fallback.
- Удалить _createUnmanagedHls и два вызова без обхода через video.src. При строгом remote HLS отсутствие управляемого loader даёт понятный unsupported state. Native HLS fallback запрещён до доказательства контроля вложенных URI/redirect; local fallback — отдельный контракт сессии.
- Проверить video/audio/source/track src в BaseParserService, AnimeGoParser, SeasonvarParser/Adapter, Search, MovieDetails и GhostPlayer. Прямой MP4 и track redirect входят в A5-0: проверка первого URL недостаточна. Не обещать отсутствие контакта через неконтролируемый media-src. Отключение работающего пути требует отдельного решения и проверки замены, не допускается молча.
- GhostPlayer extension-page наследует transport/profile и уничтожает загрузчик при нарушении; отсутствие политики не открывает src fallback. Provider-frame GhostPlayer — отдельная граница. isTorrentStream связать с активным requestId/сессией, не наличием устаревшего torrentPlaybackSession.
- Seasonvar HTTP: проверить HTTPS на живых файлах, включая seek; не молча переписывать схему. Сохранение HTTP/исключение пути — G1 после G2.
- Приёмка: private initial URL; allowed origin → redirect на :9999 и :3000; private HLS URI; MP4/track redirect; stale/cancel; параллельные remote/local; torrent→remote. На запрещённом endpoint HTTP-hit counter=0, легитимная local session играет. Только собственные локальные origin; test-only allowlist/host mapping не попадают в production, TLS не ослабляется. A5-0 фиксирует фактические возможности выбранной платформы, не обещает решение до эксперимента.

A6 decodeSource Kodik: ограниченный перебор сдвигов 0–25 с валидацией и регрессиями текущего формата; plain/protocol-relative URL сохраняются. Проверка .m3u8 — в pathname, не подстрокой во всём URL; HTTPS/host — через UrlPolicy. decode_failed не содержит исходной строки. Живой протокол не считается исправленным без отдельной проверки.

A7 redactUrl(): по умолчанию providerId + фиксированная категория ресурса/причина, без произвольного pathname/query/fragment/userinfo. origin+path недостаточно: секрет бывает сегментом пути. Допускается только явный безопасный шаблон endpoint с плейсхолдерами переменных частей; постоянный хеш полного URL не использовать. Проверить секреты в path/query/fragment/userinfo, вложенных объектах и Error.message. Целевые места: player-cleaner, MovieDetails iframeSources/renderCustomPlayer и KinogoSearchTrace; оригиналы URL не включать в доказательства.
Отдельный трек безопасности (вне этой цели): захардкоженные секреты в коде расширения — Authorization-ключ в src/background/background.js (SCHEDULE_ANNOUNCE, :898) и CLIENT_SECRET в src/shared/config/spotify.config.js (:5, используется в background.js): ротация и вынос на сервер, значения в документы не копировать; лазейка isApprovedUser (firestore.rules:51–58, 582: истинно без approvalStatus, users create без поля); сужение web_accessible_resources по потребителям (watchlist-скрипты внедряют сервисы и *-injected.js; player-cleaner.js:1048 — suppress-errors.js; kinogo-watchlist-injected.js:120 встраивает movie-details.html?embedded=true), use_dynamic_url после проверки runtime.getURL.

## Дорожка B. Единый вход «Смотреть» (E1), 5–7 дней; уровень ревью по карточкам

Нового парсера и адаптера нет; parser:<id>, lastSource, RELIABLE, bindProviderVideoTracking и контракты комнат сохраняются. Исходное вложение заявляет прототип +425/−30 и 11 тестов; материалы сейчас недоступны, результат не воспроизведён. Получить фиксированный commit/blob и полный каталог с хешами либо реализовать тесты B8 по контракту заново. Отсутствующий прототип блокирует его применение, а не независимую реализацию согласованной карточки.


B1 Разметка: movie-details.html не меняется. При включённом флаге метод ensureWatchEntryDom() создаёт #watchEntryGroup (#watchEntryBtn, #sourcePopoverToggle «▾», #torrentEntryBtn, #sourcePopover[hidden]) и переносит узел #sourceButtonsContainer в поповер (тот же id и обработчики; поиски :8289,8301 и WatchRoomPanel.js:344 продолжают работать). aria-haspopup="dialog", aria-expanded, aria-controls — на «▾», не на «Смотреть».

B2 Псевдоним: «Смотреть» вне контейнера, без класса .source-btn, с data-alias-value=<точный data-value выбранной внутренней кнопки, любой схемы>; синхронизируется в конце updateActiveSourceButton (:9921–9937). Инвариант: ровно одна внутренняя кнопка с точным data-value; сравнивать dataset.value, не вставлять произвольный URL в selector без CSS.escape.

B3 «Торрент» вне контейнера, показывается только у фильма при mediaPlayerReady (как сегодня), со своим click → openTorrentPicker(); updateActiveSourceButton('mediaplayer:torrent') переключает активность на #torrentEntryBtn и не меняет data-alias-value. Обработчик, вынесенный в метод, обязан сохранить литерал sourceButtonsContainer.addEventListener('click' (его ищет playerVisualContract:53); CSS поповера — в конце player.css.

B4 Приоритет выбора: hint комнаты > activeSourceValue (explicitSource, :8287–8296) > watchPrefs_${movieId}={innerId} > lastSource > rankInnerSources(movie) (по умолчанию = текущий порядок кнопок; для порядка запасных Rutube последним для фильмов). Запись watchPrefs.innerId — только при явном выборе внутреннего источника ({userInitiated:true}), включая keyboard activation. Автопереход и псевдоним «Смотреть» не меняют предпочтение; lastSource остаётся совместимым отдельным механизмом, запись при fallback проверяется отдельно. Предзагрузка не обходит разрешение приоритета: initializedCustomParser можно переиспользовать лишь при совпадении с итоговым выбранным источником и канонической S/E. Если оба сохранённых предпочтения отсутствуют, сохраняется прежний default; каждое присутствующее предпочтение учитывается по указанному приоритету. Room hint/explicit selection не теряются из-за раннего return.

B5 Автопереход (handleWatchSourceFailure, новая логика): attemptedInnerIds на запуск с учётом requestId; отказ = catch loadParserSource + обе ветки unavailable («Ничего не найдено», «Источники не найдены») + PLAYER_SOURCE_STATE (повторная попытка kinogo остаётся первой) + onLifecycleState; дедупликация (run.failed — одно решение на источник); таймаут lifecycle (5 с) показывает сообщение, но автопереход запускается только при reason !== 'timeout'; не выполняется в активной комнате и после ручного выбора внутреннего источника в текущем запуске. Вместо этого сообщение + «Попробовать другой источник» (onTryOther в PlayerSourceLifecycle.setState): это явная новая ограниченная попытка, а не повод оставить manual-флаг навсегда блокирующим кнопку. В комнате переключение возможно только через существующий разрешённый owner/controller flow; всем участникам кнопку не показывать как обход room-authority. Бюджет Kinogo retry и C4 refresh не складывается в бесконечную цепочку.

B6 Поповер: закрытие по клику снаружи, Esc, стрелки, возврат фокуса после перестройки innerHTML='' (:9660, :8242,8262,8277, :6788); пока идёт поиск «Смотреть» показывает «Поиск источников…» (aria-busy); статус «найден» = currentSources.some(s=>s.parserId===id), что означает обнаружение, не подтверждённый playback; для Seasonvar «проверится при запуске» (в прототипе подсказка Seasonvar показывается всегда — доделать); статус не только цветом.

B7 Включение: по умолчанию выключено + локальный тумблер администратора; включение по умолчанию только по G7 после приёмки. Флаг — UX, не security boundary. chrome.storage.local требует init cache до DOM; localStorage — проверки embedded и отказа storage. Откат выпущенной версии — релизом. Миграция: lastSource_${movieId} читается как есть.

B8 Приёмка: 11 групп контрактов из раздела B8 исполнительного плана. e1/e1WatchAliasAcceptance.full.test.mjs — только историческое имя недоступного прототипа; будущие tests/e1WatchAliasAcceptance.test.mjs и browser smoke пишутся/восстанавливаются по контракту. Отдельно проверить header/torrent, default off, lastSource/alias, room hint, tracking, URL/dataset, user intent, preload selection, fallback и a11y. Существующие регрессии обязаны проходить с выключенным флагом; часть green→green, не все обязаны падать на базе. Сломаться могут: torrentModalLayout.test.cjs:29, movieDetailsPhase3C:103, 3D:98, playerVisualContract:53 и CSS-регулярка в нём, movieDetailsPlayerAuditRegression:370–399.
По исходному вложению, в прототипе не сделано (сам прототип недоступен): сквозной запуск (нужны авторизация и сеть), счётчики и копирование отчёта, тумблер администратора, статус «найден».

## Дорожка C. Надёжность источников и диагностика, ~1 неделя


C1 Здоровье источников. Ночной GitHub Actions: эталонные тайтлы, поиск → источники → разрешение потока; Kodik — /ftor и декодирование. Задать таймауты, малую частоту и лимиты. Issue — один на инцидент, с дедупликацией и восстановлением; создание issue требует явного разрешения. Сетевой код можно реализовать/ревьюить локально, запускать только фикстуры до разрешения live. Результаты: available, parse_regression (воспроизводится на фикстуре), network_or_access_unconfirmed. Один отказ runner не доказывает геоблокировку. Разделить статусы «реализован офлайн» и «мониторинг включён и проверен».

C2 Экран «Диагностика»: ограниченные локальные счётчики resolveOk/Fail{sourceId}, fallbackReason, TTFF, decode_failed; копирование и сброс, без URL/uid/тайтлов/серий/токенов. TTFF — от старта попытки до первого представленного кадра (requestVideoFrameCallback, где доступен); readyState/loadeddata/currentTime — отдельно помеченные приближения. Для opaque iframe без достоверной телеметрии TTFF=unknown, не iframe load/ноль. Ограничить retention/cardinality; удалённой отправки нет.

C3 Контракт провайдера. Явный список возможностей источника (серии, озвучки, качества, субтитры, срок жизни ссылки, нужен ли Referer) вместо размазанных по ~15 методам адаптеров; основа для здоровья и будущего каталога.

C4 Повторы. Ключ попытки: providerId + canonical media identity (фильм/сезон/серия) + source generation/requestId. Максимум один single-flight forceRefresh на попытку при 401/403/410, включая fatal:false; стандартные retries не должны параллельно обновлять ссылку или запускать B5. После refresh одна повторная загрузка, затем одно решение B5; stale callback ничего не монтирует. Сохранить selection, комнату и позицию. Повторный 403 после refresh: cooldown 24 ч только для соответствующей media identity, не провайдера целиком. Хранить bounded записи с expiresAt в chrome.storage.local без URL/uid/подписей; при отказе storage деградировать в память. Manual retry явно обходит cooldown и получает новый ограниченный бюджет. 401/410/404 не приравнивать к глобальному бану. Local persistent retry ожидаемых 5xx сохраняется; policy violation не повторяется. Тесты: manifest/fragment/key, fatal:false/true, single-flight, stale/смена серии, refresh↔fallback; один плохой эпизод не выключает другой.

## Дорожка D. Качество плеера и интерфейс, ~2–4 недели, итеративно

По одному контролу: перенос без изменения поведения — характеризация green→green; новая функция/исправление — целевой red→green плюс сохранённые регрессии.


D1 Единые состояния: загрузка с названием источника (вместо 0:00 / 0:00), буферизация, ошибка с «Повторить» / «Попробовать другой источник», «Автоматически» (как уже в player-cleaner.js:4693) вместо «Auto (Not found)».

D2 Media Session и управление: play/pause/seekto/previoustrack/nexttrack → основное видео, mediaSession.metadata; горячие клавиши (пробел/K, J/L ±10 с, стрелки ±5 с, F, M, C, </> скорость, ? — подсказка); корректный PiP (leavepictureinpicture).

D3 Доступность с целевыми требованиями WCAG 2.2 AA (этот список не доказывает соответствие всему стандарту): шкала перемотки как ARIA-slider (aria-valuetext, Home/End/PageUp/PageDown), видимый фокус, подписи кнопок, навигация меню клавиатурой, aria-live для сообщений.

D4 i18n: строки плеера из player-cleaner.js в src/shared/i18n/locales.js (RU+EN).

D5 Единый визуальный язык: ≈344 присваивания .style.X = → классы и токены (player.css, префикс mre-; player.css во фреймы провайдеров не подключается — манифест внедряет для player-cleaner только js, поэтому способ доставки CSS (манифест css или вставка <style>) решается в G1/G5 до D5); убрать акцент #4da6ff у PiP/субтитров; поштучно.

D6 Разбор монолита: порядок — меню настроек → громкость/скорость → оформление субтитров → превью (GhostPlayer) → шкала перемотки; перед громкостью/скоростью характеризационные тесты (файл без покрытия).

D7 Продуктовые мелочи: запоминание озвучки и качества на тайтл (watchPrefs), карточка «Следующая серия» с отсчётом (на базе AutoNextCoordinator), «Продолжить с …».

## Дорожка E. Тесты и CI, параллельно с A–B

Браузерный смоук расширения: launchPersistentContext и bundled Chromium Playwright с channel:'chromium'; headless shell не использовать для загрузки расширения. VP9/Opus фикстуры; H.264/AAC/TS — отдельные фактические проверки. Сценарии A5-0, 403 refresh/fallback, sandbox, DOM/listener leaks, меню/громкость/скорость. Сеть проверять серверными счётчиками, не только requestfailed. Включение в release.yml — отдельная карточка.
Среда аудита: Windows/PowerShell, Node v24.18.0; CI release.yml — Node 22; lockfile — Playwright 1.62.1. Записывать обе среды отдельно. Chromium path/revision определять на месте; несовпадение сборки — отдельный риск, не безусловно рабочая подмена всем тестам.
Набор readFileSync-контрактов определить поиском по изменённым символам/путям; ~166/~73 исходного документа — оценки, не фиксированный список. Не ослаблять контракт ради зелёного результата; обоснованное изменение статического теста согласовывается.

## Ворота и отложенное

E1.5: офлайн-анализ заранее собранных данных; live-сбор — отдельное разрешённое действие. До сбора задать N, выборку, знаменатель доли отсутствующей пары «озвучка + качество» и unknown. Проверять exact фильм/сезон/серию/версию монтажа; длительность и смещение минимум в начале/середине/конце, отсутствие вставок и drift. |Δдлительности| ≤0,5 с — фильтр, не доказательство синхронизации. chromaprint разных дубляжей не гарантирует соответствия; метод валидировать или использовать проверенные ручные якоря. Порог ≥15% — продуктовая эвристика с описанием неопределённости. E2 (второй audio-элемент, L, только Kodik) — отдельное G4 при потребности и совместимости. Полной проверенной спецификации E2 в checkout нет: до реализации восстановить/подготовить sync/HOLD/seek/buffering/audio-only и единственного владельца прогресса; ссылка на отсутствующий 90-evidence.md не заменяет контракт.
E1c (XL): единый каталог «все качества всех источников в одном меню» через WatchParser — только по отдельному решению после E1.5.
Video.js / Media Chrome отложены по исходному решению владельца. План не выбирает новый framework и не выводит его возможности из одного README. Перед отдельной пробой сверить официальные docs/стабильность и проверить нативный источник: озвучки, субтитры, клавиши, CSP, пакет и iframe-границу.

## Порядок и сроки (оценка трудозатрат разработчика, без запаса; при исполнении агентом календарь определяют шлюзы владельца)

| Ориентир | Работа |
| --- | --- |
| 1–2 недели | T0, A5-0/A; B после зависимостей; параллельные ветки только отдельно |
| Затем | C3 → C4 → C2 → C1, E1.5 после определения выборки |
| 3–6 недель | D итеративно; выпуск отдельно по G7 |
| После E1.5 | G4: E2/E1c да или нет, без фиксированной недели |

## Критерии приёмки


A: инфраструктурные тесты и A5-0 зелёные; endpoint-hit матрица подтверждает выбранные гарантии, легитимный torrent работает. Отдельно список провайдеров с реально включённым sandbox. Пустой SANDBOX_PROVIDERS означает только инфраструктуру; незакрытый A5-0 нельзя выдать за полную готовность безопасности.

B: B8, keyboard/a11y, E1 fixture-smoke; flag off сохраняет поведение, flag on — RELIABLE/следующую серию. Timeout показывает сообщение без автоматического перехода; catch/unavailable/PLAYER_SOURCE_STATE дают один fallback; stale/manual/room подавляют его; ручной «Попробовать другой источник» работает. Installed/live — отдельная обязательная отметка перед выпуском.

C: offline-контракты здоровья, копирование диагностики и bounded refresh зелёные. Operational C1 закрывается только после разрешённого live-прогона, schedule и issue-dedup; до этого «реализовано офлайн, мониторинг не включён».

D: red→green для нового поведения, green→green для переноса; smoke меню/громкости/скорости, обе темы/ширины и клавиатура. Устройства/opaque-провайдеры проверяются отдельно.
Общие: TTFF/ошибки по C2 с явными unknown; fixture, installed, live и device evidence имеют отдельные статусы. Release/G7 отделён от готовности реализации.

## Решения владельца

Исторические решения перенесены из вложения; исходная беседа не проверялась. Текущий запрос не разрешает реализацию/релиз и не утверждает новые UX-решения. Открытые решения — G1/G4/G7:

- Меню «Источник» — поповер в шапке; доступный SVG toggle.
- Аниме default пока сохраняет текущий порядок (KinoGo). AnimeGo — открытое решение G1, не применяемая рекомендация.
- Timeout не запускает автопереход; удалённого выключателя нет; «Торрент» только для фильмов.
- Озвучки разных источников пока не объединяются; подсказка в UI/changelog.
- Открыты название входа, storage/admin toggle, Seasonvar HTTP, CSS/i18n delivery, G-A5 и E2/E1c после замеров.

## Риски

Контрактные тесты на readFileSync; CI проверяет sandbox-контракт на фикстуре, но не живую совместимость провайдеров (нужен отдельный прогон, возможны ограничения доступа и детект sandbox); новая логика автоперехода (три пути отказа, комнаты); рефакторинг cleaner без покрытия; зависимость от структуры чужих сайтов остаётся фундаментальной (C1 лишь сокращает время обнаружения поломки). Юридическое: конкретные условия провайдеров/приватность проверяет владелец; этот план не выносит юридического заключения. Способ распространения не заменяет такую проверку.


## Не подтверждено

Живые sandbox/Seasonvar HTTPS/CDN, installed E1/embedded storage, кодеки/устройства/Bluetooth/PiP, исходные прототип и 11 тестов, полный baseline тестов, итоговый transport/DNR A5-0 и измерения E1.5. Документация не превращает эти пункты в проверенные результаты.


## Приложение 1. Контракт загрузчика

Исходный XHR PolicyLoader переопределял внутренний readystatechange и проверял responseURL после перенаправления. Его код убран как недостаточный для строгой гарантии. A5-0 выбирает transport; A5b проверяет installed hls.js, abort/stats/range/timeout/keys и все context kinds. Предпочитать публичный Loader interface внутренним полям XhrLoader. Нет необработанного fallback; одно завершение при fatal:false/true.


## Приложение 2. Контракт DNR

Исходный JSON с глобальным allow :3000 не переносится дословно. A5f реализует только решение A5-0 с явными приоритетами, включённым ruleset, initiator/resourceTypes и проверенными local потребителями. Покрыть private/loopback IPv4/IPv6/mapped формы, redirect chains, ws/wss, одновременные профили и конфликт allow/modifyHeaders. Если выбраны session rules — проверить lifecycle после service worker restart/обновления и отсутствие stale grants.
Лимит 2 KB относится к скомпилированному regex, не длине исходника/JSON. Проверить isRegexSupported и реальную загрузку ruleset без предупреждений. Три regex — кандидат, не неизменяемый рецепт.
DNS rebinding и provider-initiated запросы остаются вне гарантии без отдельного доказательства.


## Приложение 3. createMenuItem на textContent

```js
const CHEVRON_SVG = '<svg class="player-settings-menu__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
const createMenuItem = (label, value) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'player-settings-menu__item'; b.setAttribute('role', 'menuitem');
  const l = document.createElement('span'); l.className = 'player-settings-menu__label'; l.textContent = label;
  const v = document.createElement('span'); v.className = 'player-settings-menu__value'; v.textContent = value;
  b.append(l, v); b.insertAdjacentHTML('beforeend', CHEVRON_SVG); return b; };
```

## Связанные документы и источники

- [Исполнительный план v6](2026-10-15-pro-player-and-sources-execution.md).
- [Аудит редакции 2](../work/2026-10-15-pro-player-and-sources/00-plan-audit.md).
- [Chrome DNR](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) — initiatorDomains, priorities, compiled regex и session rules.
- [Playwright extensions](https://playwright.dev/docs/chrome-extensions) — persistent context и bundled Chromium.
- [Fetch Standard](https://fetch.spec.whatwg.org/#http-redirect-fetch) — redirect mode.
- [hls.js releases](https://github.com/video-dev/hls.js/releases) — проверять перед отдельным обновлением.
