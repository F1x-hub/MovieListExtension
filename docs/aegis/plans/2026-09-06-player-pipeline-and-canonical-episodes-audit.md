# Единый план: источники видео, скорость, качество и новый список серий

## Цель

Сократить время от нажатия «Смотреть» до первого кадра и остановки на буферизацию,
обеспечить правильный контент и качество, завершить переход на единое управление сериями.
Основание: три последовательных запроса пользователя 2026-09-06 и снимок Ex-FS с legacy-кнопкой.
Текущая поставка выполняет безопасный source-level срез: мост выбора, защита кэша,
постепенная предзагрузка и удаление внутренней legacy-кнопки. Live-замеры первого кадра,
iframe/fullscreen и HLS tuning ещё не выполнены. Отсутствие ошибок нельзя гарантировать
планом: ниже заданы проверяемые условия завершения.

## Архитектура

Поток: MovieDetails → ParserRegistry → parser.cachedSearch → cachedVideoSources →
PlaybackController/адаптер → HLS/native video либо iframe → подтверждённое воспроизведение.
MovieDetails представляет список; PlaybackController владеет каноническим выбором и прогрессом.
Адаптер применяет выбор. Cleaner представляет встроенные контролы и мост к провайдеру.
Не вводить второй контроллер, отдельный кэш поверх существующих или второй список серий.

## Стек

Chrome MV3, JavaScript, runtime messaging/postMessage, native video, HLS.js, Node tests.
package.json: 1.2.9; зависимость hls.js: ^1.6.15. Это диапазон зависимости, а не доказательство
версии загружаемого bundled-файла. Версию runtime установить отдельно до настройки HLS.

## Основания и совместимость

- `.agents/rules/agent.md`: приоритет PlaybackSelection, lifecycle, кэш, HLS и provider bridge.
- `CONTEXT.md`: Obsidian-Zinc, единые владельцы UI, одинаковая структура обеих тем.
- `docs/movie-details-performance-tracing.md`: существующие bounded traces и счётчики.
- `docs/aegis/plans/2026-09-06-player-usability-and-series-navigation.md`: смежная работа.
- Этот документ объединяет два плана из разговора; существующий план субтитров не отменяет.
- Сохранить season/episode при смене источника; explicit selection важнее progress/preload.
- Качество, звук и субтитры локальны, не добавлять их в состояние watch rooms.
- Проверять shared cleaner против Torrent/MediaPlayer, но не менять торрентный pipeline.
- Не менять auth, рейтинги, Firestore, разрешения и Native Host в рамках этого плана.
- Не редактировать dist вручную, не обновлять версии и не создавать commits автоматически.

## Готовность и границы

Требования готовы для аудита. Настройки HLS, TTL и величина ускорения зависят от измерений.
Первым исполняется измерительный этап; оптимизации допускаются после доказательства причины.
Строгий TDD не запрошен: диагностическое воспроизведение и поведенческие регрессии по изменению.
Исполнение последовательное, небольшими проверяемыми этапами. Новый общий framework не нужен.
Большие movie-details.js и player-cleaner.js уже перегружены: не добавлять туда новый менеджер.
Выделять helper только при доказанной обязанности и с миграцией всех его потребителей.

## Исходное состояние рабочего дерева

На старте есть многочисленные незакоммиченные изменения, включая cleaner, MovieDetails,
README, manifest/package, watch rooms и MediaPlayer. Не присваивать их этой работе.
Перед реализацией повторить `cmd /c git status --short` и проверить scoped diff.
План описывает наблюдавшийся working tree, а не чистый HEAD. При изменении владельцев
перечитать соответствующие участки и актуализировать этап до редактирования.

## Статический аудит: факты, риски и ограничения

| ID | Доказательство в текущем коде | Вывод и дальнейшая проверка |
|---|---|---|
| A1 | ParserRegistry.js:78–94 ждёт Promise.allSettled | Поиск имеет общий барьер; влияние на Watch измерить |
| A2 | movie-details.js:5854–5903 ждёт поиск, затем все источники | Старый cold-click путь имел общий барьер; теперь `handleWatchClick` выпускает первый priority-safe источник, а финальный набор догружается в фоне |
| A3 | BaseParserService.js:294–334: source cache по URL, общий TTL, кэширует [] | Проверить временные ошибки, токены и контекст; не объявлять все ключи неверными |
| A4 | movie-details.js:5906: TTL 5/15 минут по hostname | Проверить, не возвращает ли внутренний кэш просроченные данные после внешнего |
| A5 | cleaner содержит main `new Hls()` и ghost `new this._Hls(...)`; bundled hls.js сообщает 1.6.15 | Два HLS-владельца найдены; tuning и сравнение defaults требуют runtime measurements |
| A6 | cleaner:2566,2658: createEpisodeNavigationState, toggle:()=>{} | Старый dropdown уже headless; прежнее предположение о живом старом меню уточнено |
| A7 | В source-level срезе legacy-кнопка и пустой toggle удалены; внешний selector guard сохранён | Внутренний UI больше не создаётся; внешние provider DOM проверяются отдельно | 
| A8 | cleaner:83,108; movie-details:6222–6272 повторяют режим/скрытие | Возможна гонка готовности; причина видимости на скриншоте не воспроизведена |
| A9 | cleaner:2981–3005: host message либо local navigate | Две ветки навигации; standalone-потребителей проверить до удаления state |
| A10 | BasePlaybackAdapter.js:187–199: DISPATCHED и APPLIED → true | Доставка считалась успехом; теперь только APPLIED, с producer-side DOM confirmation |
| A11 | cleaner:4573 делает fullscreen для newContainer | Верхний host picker не гарантированно доступен внутри fullscreen iframe |
| A12 | BasePlaybackAdapter.js:187 проверяет type/requestId | В этом обработчике нет проверки source/origin; исследовать trust boundary |

Положительные свойства: cachedSearch/source уже объединяют in-flight запросы;
Seasonvar имеет специализированную дедупликацию; preloadAllPlayers хранит данные вместо
скрытого запуска обычных iframe/video; существует каноническое управление и набор тестов.
Не переписывать эти части только ради унификации.

## Этап 0. Зафиксировать воспроизводимый baseline

Файлы: текущие parsers, adapters, PlaybackController, cleaner, MovieDetails, manifest,
HLS bundles; существующие tests. Изменений runtime на этом этапе нет.

1. Записать revision, scoped working-tree diff, браузер, сборку расширения и профиль сети.
2. Перечислить реально зарегистрированные адаптеры и их supports/capabilities.
3. Составить для каждого цепочку запросов, кэши, fallback, timeout и владельца выбора.
4. Проверить HLS script URL, загруженную версию, ошибки CSP/CORS и frame topology.
5. Проверить standalone cleaner, extension native player, iframe и fullscreen потребителей.
6. Выполнить команды регрессий из раздела проверки, сохранив реальные exit codes.

Выход: карта провайдеров и воспроизводимых сценариев. Не считать название теста
RuntimeAcceptance доказательством реального запуска в браузере.

## Этап 1. Измерения до изменений

Владельцы: существующий MovieDetailsPerf и точки parser/adapter/player lifecycle.
Переиспользовать диагностику; добавлять события только если текущих недостаточно.

1. Присвоить попытке запуска ID и generation; различать foreground и speculative work.
2. Измерять search, source resolution, mount, manifest, первый сегмент и первый кадр.
3. Для native video использовать подтверждение кадра, где API доступен; playing/loadeddata
   записывать отдельными proxy-событиями, а не выдавать за фактический кадр.
4. Для iframe использовать подтверждённый provider bridge или ручное наблюдение;
   iframe load и отправку postMessage не называть первым кадром.
5. Считать network/cache/dedup, байты при доступности, retries, ошибки и потраченную предзагрузку.
6. Учитывать ограничения cross-origin timing: недоступные значения = unknown, не 0.
7. Скрывать query tokens, cookies, credentials и payload; не сохранять полные подписанные URL.

Протокол: минимум 5 запусков на сценарий для разведки; для выводов о хвосте задержек
30 повторений проблемного сценария, с явной отметкой, что p95 всё ещё оценка малой выборки.
Показывать n, median, min/max, p95 и процент отказов; не исключать failed attempts из отчёта.
Профили: обычная сеть и фиксированный throttling с записанными Mbps/RTT.
Кэш: отдельно cold extension caches, warm, preload; HTTP-кэш описывать отдельно.
Менять только тестовые playback cache entries, не очищать авторизацию и пользовательский прогресс.
Результаты хранить экспортом вне bounded истории на 20 traces, иначе длинная серия потеряется.

Выход: базовая таблица. Без неё не назначать произвольные HLS параметры и проценты ускорения.

## Этап 2. Корректность парсинга, источников и качеств

Файлы: BaseParserService, SeasonvarParser, KinogoParser, ExFsParser, RutubeParser,
соответствующие adapters и normalizeVideoSources в MovieDetails.

1. Проверить title/year/mediaType/season, одноимённый фильм и сериал, trailer вместо фильма.
2. Проверить абсолютные URL, redirects, nested playlists, HTML-заглушку с HTTP 200.
3. Различить HLS master/media playlist, MP4 и iframe; расширение URL само по себе недостаточно.
4. Проверить озвучки, субтитры и наличие именно выбранной серии у провайдера.
5. Сопоставить quality label с manifest/media metadata: resolution, bitrate, codec, fps.
6. Не создавать выдуманное 1080p по подписи сайта; неизвестные характеристики помечать явно.
7. Проверить auto/manual/auto, сохранение позиции/дорожки и отличие direct/opaque iframe.
8. Добавлять обезличенные локальные фикстуры для найденных ошибок; не обращаться к live CDN в unit tests.

Приёмка: правильная идентичность и проверяемые источники; несовместимый вариант отклоняется
с причиной. Runtime-проверка подтверждает доступность, unit fixture подтверждает разбор.

## Этап 3. Кэш, отмена и восстановление

Файлы: BaseParserService, специализированные caches Seasonvar, MovieDetails source cache,
запросы конкретных parsers. Не добавлять новый независимый слой кэширования.

1. Сопоставить TTL всех слоёв, включая токены и forced refresh.
2. Разделить стабильную страницу/поиск и временную ссылку, если baseline показывает проблему.
3. Проверить ключи на season/mediaType/translation только там, где это меняет ответ.
4. Отличать временную ошибку от подтверждённого not found; задать ограниченный negative TTL.
5. Проверить preload+click: один физический запрос при совпадении данных.
6. Защитить запись в cache от позднего ответа старого forced refresh/generation.
7. Отмена одного потребителя shared in-flight запроса не должна отменять другого.
8. Проверить отсутствие бесконечного refresh: ограниченный retry budget на попытку запуска.
9. Не считать каждый 403 истёкшим токеном: auth, блокировка, удаление и сеть различаются.

Приёмка: expired source заменяется актуальным, transient failure не отравляет кэш,
устаревшая операция не перезаписывает актуальный выбор и ответ.

## Этап 4. Единый список серий и протокол выбора

Файлы: MovieDetails JS/HTML, PlaybackController/Selection, BasePlaybackAdapter и
provider adapters, cleaner; shared player CSS только при необходимости отображения.

1. Составить таблицу producer/consumer всех selection/navigation/state сообщений.
2. Перевести buttons, next/previous, auto-next и resume на существующий playSelection/controller.
3. Список берёт доступность у адаптера; каталог TMDB не обещает существующее видео у провайдера.
4. Подтверждать применение выбора отдельно от отправки; соблюдать реальные signatures
   controller/adapter, не менять boolean API на новый тип в одном конце протокола.
5. Сверять requestId, активный source window, разрешённый origin, provider и generation;
   cleaner не возвращает успех без строгого `true` и подтверждённых season/episode.
6. Старый запрос не может снять pending нового; cleaner прекращает старые клики и ожидания,
   дубль ответа не вызывает второй переход.
7. Проверить nested frames: посредник нужен только при подтверждённой топологии,
   с валидацией на каждом переходе и ограниченным timeout.
8. Readiness/capability handshake относится к конкретному mount и повторяется после reload.
   Удалять таймеры повторного скрытия только после проверки поздней инициализации.
9. Добавить состояния loading/error/retry/empty/unavailable и корректные границы prev/next.

Приёмка: одна операция переключения на клик, подтверждённый season/episode,
неуспех виден пользователю, явный выбор не перезаписан progress/preload.

## Этап 5. Fullscreen и retirement legacy

Repair track: новый picker должен оставаться доступным в текущем fullscreen-контексте.
Retirement track: удалить мёртвую кнопку и затем старую навигационную ответственность.

1. Проверить fullscreen native/iframe и user activation на реальном браузере.
2. Выбрать host-owned fullscreen оболочку, если поддерживается; иначе отображать
   представление того же списка внутри текущего fullscreen-документа через проверенный мост.
   Нельзя просто открыть внешний popover поверх cross-origin fullscreen iframe.
3. Проверить вход/выход/Escape/focus, раскрытие списка и переключение без выхода из fullscreen.
4. Удалить .episode-list-btn и её пустой обработчик; не ограничиваться display:none.
5. Сохранить из createEpisodeNavigationState только доказанные provider/standalone обязанности
   до их переноса; не удалять native DOM-селекторы, нужные адаптеру для реального выбора.
6. Перевести standalone на тот же контракт и представление либо явно зафиксировать
   оставшуюся поддерживаемую границу. При сохранённой старой навигации не объявлять полную миграцию.
7. Удалить неиспользуемые toggle, styles, listeners, display-restore и sync timers.
8. Обновить тесты, которые проверяют скрытие, на отсутствие старого UI и работу нового.

Класс удаления: внутренний код, не пользовательские данные. Удалять по ответственности,
а не по имени переменной. Live storage и внешние provider DOM не удаляются.
Приёмка: legacy UI отсутствует; один владелец выбора; fullscreen и standalone не потеряли функции.

## Этап 6. Ускорение discovery

Файлы: ParserRegistry, preloadSources/preloadAllPlayers и их consumers.
Исполнять только после этапов 1–5 и повторной проверки причин ожидания.

1. Измерить, блокируют ли A1/A2 Watch, а не только окончательное заполнение списка.
2. Если да, выдавать provider result сразу и начинать его source resolution независимо.
3. Сохранить стабильный порядок провайдеров и выбранный источник; быстрый ответ не меняет выбор.
4. Ограничить speculative concurrency; выбранный провайдер имеет приоритет.
5. Не загружать лишние сезоны и не монтировать скрытые iframe ради предзагрузки.
6. Проверить unsupported-provider filtering до дорогих запросов.
7. Сравнить одинаковые сценарии по времени и wasted bytes; отклонить изменение без эффекта.

Текущий source-level срез реализует пункт 2 через `startProgressiveSourceDiscovery()`:
пустой или недоступный более приоритетный parser должен завершиться, прежде чем будет
выдан результат следующего parser; после этого медленные providers продолжают поиск,
а итоговый нормализованный список сохраняется одним cache write. Runtime-замеры Watch
и wasted bytes ещё обязательны перед численным заявлением об ускорении.

Приёмка: slow-provider fixture не блокирует готовый выбранный источник;
дедупликация, cancellation и partial results не нарушают selection.

## Этап 7. HLS, буфер и качество

Файлы: фактические HLS owners после инвентаризации, общий settings menu cleaner.
Перед кодом получить документацию установленной версии через context7, если доступен,
иначе официальную документацию. Не обновлять библиотеку одновременно с tuning.

1. Установить actual bundled version и все места new Hls; не предполагать один экземпляр.
2. Сравнить default и по одному изменению start quality/buffer/back buffer/recovery.
3. Измерить first frame, rebuffer ratio, dropped frames, память, seek latency и качество.
4. Проверить восстановление network/media errors с конечным бюджетом попыток.
5. Сохранить manual quality и возврат к ABR; не навязывать максимум при слабой сети.
6. Уничтожать старый HLS перед заменой; не оставлять загрузку сегментов после unmount.
7. Не переносить VOD-настройки без проверки на растущий Torrent HLS и iframe provider player.

Приёмка: выигрыш воспроизводим при сопоставимом качестве, без роста зависаний/ошибок;
не выдавать снижение разрешения за чистое ускорение.

## Этап 8. Итоговая регрессия и поставка

Матрица: каждый зарегистрированный поддерживаемый provider × фильм/сериал × cold/warm
× direct/iframe где доступно. Дополнительно throttling, expired URL, 200 error body,
пустой список, смена озвучки/качества, серия первого/последнего сезона, rapid clicks,
close during load, provider switch, same-movie reopen, fullscreen, dark/light, keyboard.

1. Прогнать focused tests каждой изменённой границы.
2. Прогнать lint/build после изменений JS; сборку проверить как unpacked extension.
3. Выполнить browser smoke на реальных провайдерах; фиксировать недоступные как blocked,
   не заменять live acceptance зелёными mock tests.
4. Сравнить до/после с одинаковой сетью, контентом, cache policy и качеством.
5. Убедиться в одном активном player session и отсутствии оставшихся legacy handlers.
6. Сохранить таблицу findings: ID, severity, reproduction, root cause, change, test, residual risk.
7. Обновить affected sections agent.md, README changelog и этот документ по фактическим изменениям.

Откат: каждый этап ограничен scoped diff; откатывать только собственные изменения.
Не использовать blanket reset/checkout поверх текущего dirty tree. Persistent данные не мигрируются.

## Команды проверки

Из корня проекта, каждая команда отдельно. Это существующие тесты, не обещание live-покрытия.

```bat
cmd /c node tests/playerEpisodePickerProviderUnification.test.js
cmd /c node tests/playerNativeBridgeContract.test.js
cmd /c node tests/playerProgressiveWatchPath.test.js
cmd /c node tests/playerLegacyEpisodeRetirement.test.js
cmd /c node tests/playerEpisodeNavigationBridge.test.js
cmd /c node tests/providerSwitchSelectionPreservation.test.js
cmd /c node tests/playerSourceContract.test.js
cmd /c node tests/rutubeParser.test.js
cmd /c node tests/kinogoParser.test.js
cmd /c node tests/seasonvarPreloadDedupPhase6F.test.js
cmd /c node tests/playerLifecycle.test.js
cmd /c node tests/playerSwitchTransactions.test.js
cmd /c node tests/playerCleanerIsolation.test.js
cmd /c node tests/movieDetailsPerfPhase6E.test.js
cmd /c node tests/torrentSharedPlayer.test.cjs
cmd /c node tests/watchRoomStagingController.test.cjs
cmd /c npm run lint
cmd /c npm run build
```

Новые поведенческие проверки по найденным дефектам: stale forced-refresh race,
shared request cancellation, slow provider partial result, DISPATCHED без APPLIED,
wrong frame response, duplicate ACK, stale mount, fullscreen picker, expired URL retry cap.
Реализацию этих тестов определить по воспроизведённому дефекту; этот план не содержит
выдуманных patches до диагностики и не разрешает безусловно переписывать весь pipeline.

## Самоаудит плана

- Исправлено: старый dropdown — headless state с пустым toggle, не доказанный второй живой popup.
- Исправлено: барьер allSettled не объявлен причиной всех задержек без измерения Watch path.
- Исправлено: DISPATCHED отделён от реального применения; изменения охватывают обе стороны.
- Добавлено: fullscreen user activation и cross-origin boundary до удаления старых входов.
- Добавлено: standalone и shared Torrent/watch-room consumers перед retirement.
- Добавлено: отмена shared in-flight и гонка forced refresh, а не только TTL.
- Добавлено: различие dependency range и actual HLS bundle.
- Добавлено: не более 20 traces в памяти, экспорт для длинных серий замеров.
- Добавлено: live failures/unknown timing не считать нулевой задержкой или успешным тестом.
- Не обещаны фиксированные проценты ускорения и отсутствие всех ошибок.

## Доказательства текущего аудита

2026-09-06: статические участки выше проверены по working tree.
Шесть targeted test files завершились exit 0: picker unification, navigation bridge,
provider-switch preservation, player source contract, Rutube parser, Seasonvar preload dedup.
Проверка scoped diff --check завершилась exit 0; README имеет предупреждение LF/CRLF.
Node выдал MODULE_TYPELESS_PACKAGE_JSON warning для части тестов; это не failure.
Live sites, fullscreen, первый кадр и численные показатели скорости ещё не проверены.
В текущем execution-срезе изменены bridge acknowledgement, origin/source validation,
ожидание async provider fallback, empty-source cache policy, progressive source preload
и cold-click release первого priority-safe source; медленные parsers продолжают работу
в фоне с одной финальной записью кэша. Также удалена внутренняя legacy-кнопка списка
серий. Полная browser migration, first-frame
замеры и HLS/performance tuning ещё не выполнены. Статический инвентарь HLS показывает
три точки создания: native mount в `BaseParserService`, основной `new Hls()` в cleaner
и отдельный ghost-preview `new this._Hls(...)`; bundled `src/shared/lib/hls.min.js`
сообщает runtime 1.6.15.
