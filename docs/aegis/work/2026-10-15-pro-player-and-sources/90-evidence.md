# Pro player and sources — Evidence

Дата: 2026-10-15. Основание плана: `docs/aegis/plans/2026-10-15-pro-player-and-sources.md`.
Среда: Chromium 1194 из Playwright (без H.264/AAC), hls.js 1.6.15, Node 22; тестовые потоки VP9+Opus в fMP4. Все замеры на localhost, headless.

## Аудит кода и браузерные эксперименты (v1.3.6 и v1.3.7)

- Подмена плеера работает: cleaner переносит `<video>` провайдера в `.native-player-wrapper`, видео играет, в том числе под sandbox.
- Скрипт внутри iframe провайдера отправил `CHANGE_SOURCE`; на странице расширения событие пришло с origin провайдера и `source===iframe.contentWindow`, то есть прошло обе проверки `isTrustedPlayerMessage`.
- iframe без `sandbox` увёл вкладку расширения на сторонний URL; с `sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"` навигация вкладки и `window.open` заблокированы,
  content scripts, localStorage, fullscreen и postMessage работают.
- Полный `npm test` на v1.3.7 проходит (в песочнице три браузерных теста требуют `executablePath`: Playwright 1.62.1 ждёт Chromium 1234, установлен 1194).

## Прототип E1 (изолированная копия `origin/master`)

- Патч: `e1/e1-prototype.patch` (+425/−30: `movie-details.js` +320/−30, `player.css` +90, `locales.js` +12, `PlayerSourceLifecycle.js` +1, `player-cleaner.js` 1 строка).
- Тест: `e1/e1WatchAliasAcceptance.full.test.mjs` (jsdom на реальном `movie-details.html/js`): 10 проверок + a11y (11 тестов) проходят с флагом; на `origin/master` все падают.
- Существующие тесты: 109 команд основного списка, `test:watch-room`, `test:media-player`, `lint` проходят с выключенным флагом. Исправлены без правки тестов: литерал `sourceButtonsContainer.addEventListener('click'`
  (`playerVisualContract`), CSS-регулярка `\.source-buttons-container\s*\{`.
- Реальный Chromium: шапка «Смотреть · Источник ▾ · Торрент» рисуется, поповер открывается поверх плеера, Esc возвращает фокус. Сквозной запуск не проверен (нужны авторизация и сеть).

## DNR

- `e1/dnr-ext`: минимальное расширение с тем же `key` (extId `dgdejomdgiabgcfijcdhjefijdfiemhd`). Проверено: block режет fetch/XHR/`<video src>`/редиректы на `127.0.0.1`, `localhost`, `2130706433`, `0x7f.1`,
  `localhost.`, `LOCALHOST` со страницы расширения, service worker и offscreen-документа; allow приоритетом 2 пропускает разрешённый порт; обычная веб-страница не затронута. Один regex на все диапазоны
  превышает лимит 2 КБ (`memoryLimitExceeded`).
- Проверялся allow `^http://(127\.0\.0\.1|localhost):(3000|3579)/` (надмножество); узкий `127.0.0.1:3000` в стенде не прогонялся.

## hls.js loader

Проверено: блок до запроса, блок после редиректа 302 (запрос уже ушёл, данные не переданы), без повторов, `destroy()` без исключений; нарушение на фрагменте/ключе нефатально — нужен `destroy()` в фабрике.

## Лаборатория двух плееров (`lab/`)

`page.html`, `runner.cjs`, `server.cjs`: два hls.js (видео без звука + скрытый со звуком) и контроллер синхронизации; метрика — разница между вспышкой в видео (rVFC) и писком в аудио (AnalyserNode).

| Сценарий | Результат |
|---|---|
| Без коррекции, 25 с | −53…+47 мс |
| С контроллером | −18…+31 мс |
| Перемотка (в загруженное и незагруженное место) | ±25 мс после |
| Подвисание одного потока 7 с | оба замирают и возобновляются синхронно |
| Релиз «ускорен» на 4% (PAL), без учёта коэффициента | расхождение ~40 мс/с |
| То же, с коэффициентом 0.96 | −65…+18 мс |
| hls.js на `<audio>` со склеенным потоком | играет, качает и видео |
| Один hls.js, звук другого источника через `EXT-X-MEDIA` | `fragParsingError` |

Оговорки: замер не включает задержку вывода звука ОС (muted и не-muted элементы расходятся на 27–44 мс по `currentTime`); H.264/AAC и TS не проверялись; сеть локальная.

## E2 (отложено, по воротам E1.5) — сохранённая спецификация

Ведомый `<audio data-ghost="true">` вне `.player-surface`; `getAudioSink()` в девяти местах cleaner (инвариант: видео при DUAL всегда muted); `userRate` вместо `v.playbackRate`, `defaultPlaybackRate` после смены потока;
состояния IDLE → RESOLVING → READY_SINGLE|READY_DUAL → HOLD → SWITCHING → FOLLOWER_ENDED → DEGRADED → FAILED; `target=v.currentTime×ratio+offset`, коэффициент ≠1 не определяется автоматически (24/25 и 23.976/25 по
длительности неразличимы) — только из статической таблицы в коде или вручную; тик 250 мс + события; вход в коррекцию |d|>25 мс, выход <10 мс, `rate=base·(1−clamp(0.5d,±0.03))`, ≤1 смены/с, жёсткая перемотка при |d|>0.25 с с паузой 1 с
на `target+EWMA(lag)`; HOLD — `playbackRate=0` только на видео, вход при `waiting` ведомого >300 мс, события `extension-sync-hold/-release` (cleaner — лоадер, комната — защёлка `reportLocalBuffering`), нативные
`waiting/playing` не синтезируются; Media Session/PiP/скрытая вкладка/`devicechange`; ведомый hls.js: `capLevelToPlayerSize:false`, `rememberBandwidth:false`, `maxBufferLength:60`, `backBufferLength:30`, Kodik — выбор
URL с минимальной высотой (без фиксации 0×0 уходит на 720p: 11,7 МБ против 1,3 МБ); при 401/403/410 — `resolve(forceRefresh)` один раз, затем DEGRADED; смена потока замораживает контроллер и запись прогресса.

## Журнал аудита плана

Пять кругов независимой проверки (код, медиа и синхронизация, надёжность и безопасность, реализуемость, сходимость) и прототип E1: ~120 замечаний учтено; блокирующих замечаний к итоговой версии нет.
Ключевые развороты: `WatchParser` отложен (ломал `ParserRegistry`), E1 пересобран как псевдоним, облачные флаги и краудсорс смещений вырезаны, порт торрента в DNR исправлен на 3000, автовыбор по умолчанию подтверждён как KinoGo.
