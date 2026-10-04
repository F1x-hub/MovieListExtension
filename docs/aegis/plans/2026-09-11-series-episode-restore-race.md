# План исправления: гонка восстановления серии при переключении эпизода

Дата: 2026-09-11  
Статус: hotfix source-level реализован, runtime-проверка pending  
Область: `MovieDetails`, legacy-путь `Search`, `PlaybackController`, Seasonvar и
`content-scripts/player-cleaner.js`.

## Goal

Исключить возврат на старую просмотренную серию после явного переключения. Если
пользователь был на S1E7 и выбрал S1E8, ни отложенное восстановление прогресса,
ни старый provider event не должны снова включить S1E4. При свежем открытии без
явного выбора сохранённый resume, например S1E4, должен по-прежнему применяться.

Критерий успеха: после канонического выбора S1E8 все поздние операции для
S1E4/S1E7 становятся no-op, а итоговые selection, provider state, URL серии и
сохранённый progress согласованы на S1E8.

## Диагноз

### Подтверждённая цепочка сбоя

1. `MovieDetails` получает `PLAYER_READY`, когда канонический выбор ещё может
   быть пустым, и запускает асинхронный `ProgressService.getProgress()`.
2. В хранилище находится запись, например S1E4.
3. Пользователь выбирает S1E8. `PlaybackController` уже принимает эту явную
   selection, но ранее запущенный Promise не отменяется и не получает новую
   ревизию выбора.
4. Когда Promise завершается, callback без повторной проверки отправляет в iframe
   `RESTORE_PROGRESS` для S1E4 и напрямую меняет `MovieDetails.currentEpisode`.
5. Provider применяет старую серию. Поэтому визуально кажется, что переключение
   на E8 случайно открыло уже просмотренную E4.

Минимальная модель этой последовательности воспроизвела отправку
`RESTORE_PROGRESS` для E4 уже после выбора E8. Это source-level reproduction, а не
полный live-тест Chrome, поэтому runtime confidence сейчас B.

### Почему существующие защиты не закрывают баг

- `isTrustedPlayerMessage()` проверяет source/origin и актуальный iframe для
  входящих сообщений, но callback `getProgress().then(...)` является уже
  разрешённой старой побочной операцией и повторно эти условия не проверяет.
- `sourceSwitchRequestId` защищает смену iframe/provider, но выбор серии может
  измениться внутри того же iframe. Нужна также ревизия канонической selection.
- `SeasonvarParser` уже имеет `selectionRequestId`, `renderRequestId` и проверки
  актуальности render. Они защищают parser/render race, но не внешний поздний
  `RESTORE_PROGRESS`.
- Существующие тесты подтверждают, что явный S3E6 перекрывает предзагруженный
  S4 и что provider switch сохраняет S/E. Они не покрывают поздний Promise
  восстановления.

### Вторичные усилители риска

- `src/pages/search/search.js` содержит отдельный legacy `PLAYER_READY`-путь,
  который всегда восстанавливает сохранённый progress без проверки нового выбора.
- В `player-cleaner.js` `structuredPlaybackState` переживает
  `RESET_PERMANENT_VIDEO`. При локальной навигации provider его старое
  `activeEpisodeNumber` может быть использовано вместо выбранной серии.
- `SEASONVAR_PLAYBACK_STATE` и периодические progress-события должны быть
  привязаны к актуальному mount/request, иначе старое событие может регрессировать
  selection или запись progress.

Вычисление соседнего эпизода в `PlaybackSelection.resolveAdjacentEpisode()` не
является первичным источником E4: оно работает как чистая функция от текущего
выбора и списка серий. Его нужно сохранить и дополнить только regression-тестом
полной цепочки.

## Архитектурная граница

Канонический владелец выбора остаётся один:

`MovieDetails -> PlaybackController -> adapter/parser -> iframe/provider`.

`PlaybackSelection` хранит S/E/source, `ProgressService` хранит resume, parser
преобразует selection в источник, а cleaner только выполняет provider-side DOM
операции и сообщает подтверждённое состояние. Новый второй controller или новый
кэш выбора добавлять нельзя.

Любое async-восстановление должно рассматриваться как транзакция с контекстом:

`movieId + iframe + sourceSwitchRequestId + selectionRevision + provider`.

Если хотя бы один компонент устарел, callback ничего не отправляет и не меняет
`currentEpisode`.

## Change Necessity

Изменение необходимо: текущая реализация нарушает уже установленное правило
«явный выбор пользователя имеет приоритет над progress/preload» и допускает
изменение provider state после завершения более новой операции. Исправление должно
быть локальным к существующим владельцам состояния; переписывание Seasonvar или
изменение формата пользовательской истории не требуется.

## TDD Route

Режим strict TDD не включён: пользователь попросил анализ и план, а не test-first
реализацию. Для выполнения плана используется diagnostic reproduction плюс
регрессионные тесты до и после исправления; RED/GREEN-последовательность не
предписывается как обязательная.

## Детальный план выполнения

### Фаза 0. Зафиксировать воспроизводимый контракт

Файлы:

- `tests/movieDetailsRestoreProgressRace.test.js` — новый контракт для
  `MovieDetails`.
- `tests/searchRestoreProgressRace.test.js` — новый контракт для legacy Search.
- при необходимости `tests/playerCleanerSelectionContract.test.js` — расширение
  существующего cleaner-контракта.

Шаги:

1. Сделать deferred `getProgress()` и воспроизвести последовательность
   `PLAYER_READY -> выбор S1E8 -> resolve stored S1E4`.
2. Зафиксировать ожидаемое поведение: ни одного `RESTORE_PROGRESS` для E4 и
   отсутствия `currentEpisode = 4` после явного выбора E8.
3. Зафиксировать обратное поведение: при отсутствии явного выбора и неизменном
   iframe сохранённый S1E4 отправляется ровно один раз.
4. Добавить случаи смены provider/iframe, нового movie и двух быстрых выборов
   `E7 -> E8`; поздний callback старого контекста во всех случаях должен быть
   no-op.
5. Добавить проверку, что payload с `seasonNumber`/`episodeNumber` использует
   числовые значения, а не строки вида `"4 серия"`.

Готовность фазы: тесты детерминированно падают на текущем MovieDetails/Search
callback и описывают как отмену старого resume, так и сохранение валидного resume.

### Фаза 1. Сделать восстановление progress отменяемой транзакцией в MovieDetails

Файл: `src/pages/movie-details/movie-details.js`.

1. Ввести небольшой внутренний `selectionRevision`/`restoreGeneration`, связанный
   с существующим `PlaybackController`, а не отдельный владелец S/E.
2. Увеличивать ревизию на `playSelection()`, `handleEpisodePlay()`, выборе в
   picker, `handlePlayerNavigate()`, смене movie/provider и уничтожении player.
   `beginSourceSwitchRequest()` продолжает отвечать за iframe/source request.
3. Вынести логику из `PLAYER_READY` в helper уровня страницы, который captures:
   `movieId`, конкретный iframe, текущий `sourceSwitchRequestId`, ревизию и
   безопасную подпись текущей selection.
4. После `getProgress()` повторно проверить все значения:
   - movie всё ещё тот же;
   - iframe тот же, подключён к контейнеру и остаётся активным;
   - request id всё ещё текущий;
   - selection revision не изменилась;
   - selection по-прежнему не содержит явных S/E и не имеет explicit source;
   - страница не выгружена и provider всё ещё допускает legacy restore.
5. При любой неудачной проверке завершать callback без `postMessage` и без записи
   в `currentEpisode`.
6. Нормализовать сохранённый progress до числовых S/E. Не использовать строковое
   `progress.episode` как каноническое состояние; `currentEpisode` может быть
   только совместимым отображаемым зеркалом после успешной проверки.
7. Не отправлять `RESTORE_PROGRESS`, если selection уже явная, даже если Promise
   завершился раньше визуального обновления UI.
8. Сохранить существующий resume на cold start, когда selection действительно
   отсутствует. Повторный `PLAYER_READY` не должен запускать второй restore для
   уже использованной ревизии.

Результат: позднее восстановление E4 не может переиграть S1E8 в том же iframe;
одного `sourceSwitchRequestId` достаточно для смены iframe, а `selectionRevision`
закрывает in-place переключение.

### Фаза 2. Закрыть и затем вывести legacy Search-путь

Файл: `src/pages/search/search.js`.

Короткий Repair Track обязателен до миграции:

1. Захватывать movie id, iframe, request/generation и selection context в момент
   `PLAYER_READY`.
2. Повторять те же проверки перед отправкой `RESTORE_PROGRESS`.
3. Инвалидировать контекст при `changeVideoSource()`, выборе серии, закрытии или
   смене movie.
4. Убрать прямое восстановление в новый iframe после устаревшего callback.

Retirement Track:

1. Проверить, можно ли все series-watch действия Search направить через уже
   существующий `MovieDetails/PlaybackController` route.
2. Если Search остаётся отдельной пользовательской поверхностью, заменить его
   дублирующее владение selection/progress на общий helper/контракт, не создавая
   третий controller.
3. После live-проверки удалить legacy direct restore и прямое сохранение progress
   из Search; оставить только явную передачу intent каноническому владельцу.

Критерий выхода из retirement: покрыты cold start, resume, E7->E8 и provider
switch, а в коде остаётся один путь изменения канонической selection.

### Фаза 3. Синхронизировать Seasonvar state и cleaner

Файлы:

- `content-scripts/player-cleaner.js`;
- `src/shared/services/parsers/SeasonvarParser.js`;
- `src/pages/movie-details/movie-details.js` для передачи host request context.

1. При каждом `RESET_PERMANENT_VIDEO` очищать `structuredPlaybackState` и
   связанное с ним локальное состояние; убрать расхождение между двумя reset
   listeners.
2. Передавать в `SEASONVAR_PLAYBACK_STATE` host-level request/selection context
   вместе с существующим `mountToken`. `mountToken` parser-local не заменяет
   host `sourceSwitchRequestId`.
3. Принимать state только для текущего iframe/request/mount; поздний state старого
   Seasonvar mount не должен заменять список episodes или active S/E.
4. В `sendProgressUpdate()` использовать числовой target локального user action,
   если он есть. Не брать старый `structuredPlaybackState.activeEpisodeNumber`
   поверх нового выбранного item.
5. В canonical picker mode оставлять направление навигации через
   `PLAYER_EPISODE_NAVIGATE`; legacy локальный picker не должен параллельно
   менять selection.
6. Оставить `SeasonvarParser`-проверки `selectionRequestId`/
   `renderRequestId`; расширить их только host request context, не добавляя
   независимую систему отмены.

### Фаза 4. Укрепить контракт progress-событий в PlaybackController

Файлы:

- `src/shared/services/player/PlaybackController.js`;
- `content-scripts/player-cleaner.js`;
- message handlers в `movie-details.js` и, пока не удалён, `search.js`.

1. Ввести typed envelope для progress event: `movieId`, `providerId`, host request
   id, selection revision, numeric `seasonNumber`/`episodeNumber`, timestamp и
   origin.
2. В `handleProgressUpdate()` предпочитать проверенные numeric fields; старые
   display strings использовать только как временный compatibility fallback.
3. Разделить два случая: genuine provider user selection может атомарно обновить
   каноническую selection; telemetry/progress старого mount не имеет права
   менять S/E и должен быть отброшен.
4. Перед записью через `ProgressService` проверять актуальность movie/provider/
   request/revision. Timestamp старого видео не должен регрессировать новый S/E.
5. Сохранить one-record-per-series semantics `ProgressService`; историю
   завершённых эпизодов и `EpisodeHistoryService` не менять.

### Фаза 5. Проверить preload и быстрые переключения

Файлы:

- `src/pages/movie-details/movie-details.js`;
- `src/shared/services/parsers/SeasonvarParser.js`;
- новые/расширенные Seasonvar regression tests.

1. Добавить тест с задержанным preload S1E4/S1E7 и явным выбором S1E8.
2. Проверить, что `mountPlayer()` повторно сверяет preloaded entry с текущей
   selection и не переиспользует season URL/source старого сезона.
3. Проверить, что `currentEpisodes`, `playerRegistry`, provider state и итоговый
   episode source обновляются только текущим request.
4. Сохранить и не регрессировать уже проходящий контракт «явный S3E6
   переопределяет preloaded S4».

### Фаза 6. Runtime-проверка и выпускной барьер

Ручная матрица в unpacked Chrome на реальном сериале:

1. Seasonvar: cold start без progress, resume с E4, открыть E7 и выбрать E8.
2. Seasonvar: быстрые клики E7 -> E8 и смена сезона до завершения загрузки.
3. Ex-FS/KinoGo native bridge: E7 -> E8, provider switch и возврат назад.
4. Повторить после reload, в fullscreen и при задержанном network response.
5. Проверить в логах отсутствие позднего `RESTORE_PROGRESS` после explicit E8,
   один итоговый актуальный `SEASONVAR_PLAYBACK_STATE`, соответствие URL S1E8 и
   отсутствие regress в сохранённом progress.

Автоматические команды после реализации:

```text
cmd /c node tests\movieDetailsRestoreProgressRace.test.js
cmd /c node tests\searchRestoreProgressRace.test.js
cmd /c node tests\playerCleanerSelectionContract.test.js
cmd /c node tests\seasonvarRestoreAndPickerLifecycle.test.js
cmd /c node tests\seasonvarS3E6AndPickerBugFix.test.js
cmd /c node tests\playerSwitchTransactions.test.js
cmd /c node tests\providerSwitchSelectionPreservation.test.js
cmd /c npm run lint
cmd /c npm run build
cmd /c git diff --check
```

После этого запускать полный `cmd /c npm test`. Если сохранится известный
несвязанный failure `tests/movieDetailsCreditsUI.test.js` на hidden actors layout,
его нужно отдельно классифицировать, а не приписывать исправлению player.

## Compatibility boundary и non-goals

- Не менять формат `ProgressService`, ключи хранения или историю завершённых
  эпизодов.
- Не редактировать `dist` вручную; только source и последующий build.
- Не удалять legacy provider controls до live evidence, что canonical picker
  работает в реальных iframe/fullscreen сценариях.
- Не добавлять новый controller, параллельный episode cache или широкие fallback,
  которые могут снова скрыть stale selection.
- Не считать contract/mock tests доказательством работы авторизованных Ex-FS/KinoGo,
  CDN/HLS и fullscreen; это отдельная runtime-проверка.

## Плановая проверка давления

Основной риск плана — добавить guard только в `MovieDetails` и оставить Search или
cleaner способными регрессировать S/E. Поэтому acceptance требует три слоя:

1. host-side invalidation async restore;
2. provider-side request/state validation;
3. единственный канонический owner для user selection и progress persistence.

Если после Фазы 1 тест на MovieDetails проходит, но тест Search или cleaner
показывает старый E4, работа не считается исправленной: сначала закрывается
соответствующая compatibility boundary, затем выполняется runtime matrix.

## Execution readiness

Технических блокеров для source-level реализации не выявлено. Готовы существующие
owners, request ids, parser lifecycle guards и тестовые harnesses. До полного
утверждения исправления остаётся обязательной live-проверка provider iframe,
fullscreen и задержанных сетевых ответов; эти сценарии в текущей сессии не
подтверждались.
