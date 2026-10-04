# План: автоматическое обновление расширения через GitHub ZIP и Native Messaging

Дата: `2026-09-08`
Статус: approved for implementation

## Цель

Дать пользователю Windows один короткий сценарий первой установки и автоматические
обновления распакованной Chrome MV3 установки через GitHub Releases. После первой
настройки пользователь не скачивает ZIP вручную и не запускает PowerShell-команды.

## Основание и факты

- Расширение уже проверяет `releases/latest`, но только запускает скачивание ZIP.
- В `src/background/background.js` зашит путь компьютера разработчика.
- Popup сообщает о загрузке как о почти завершённом обновлении.
- `chrome.runtime.reload()` перезагружает unpacked extension, но сам не скачивает и
  не устанавливает пакет; перезагрузка считается Chrome событием update.
- Native Messaging уже разрешён для отдельного MediaPlayer, поэтому updater должен
  иметь собственное имя host и собственный контракт.
- Текущий manifest ID: `dgdejomdgiabgcfijcdhjefijdfiemhd`.

## Границы

Входит:

- обновление Windows Chrome unpacked installation;
- Native Host `com.movielist.updater`;
- отдельный C#/.NET исполнитель с журналом, staging, проверкой SHA-256 и rollback;
- первая установка через `MovieListSetup.exe`/setup mode;
- подписанный `update.json`, GitHub Actions и проверка состава релиза;
- состояния UI: available, downloading, ready, deferred, installing, succeeded,
  failed и recovery;
- сохранение настроек обновлений для каждой подключённой установки.

Не входит в эту итерацию:

- публикация в Chrome Web Store;
- бесшумное снятие Developer Mode или обход ограничений Chrome;
- изменение `com.movielist.mediaplayer`;
- перенос или удаление пользовательских данных при миграции существующих установок;
- поддержка macOS/Linux без отдельного Native Host.

## Архитектура и владельцы

- `UpdateService` в расширении — единственный владелец состояния обновлений и
  пользовательских сообщений.
- Native Host — единственная граница Chrome → Windows. Он не принимает скрипты,
  произвольные shell-команды или произвольный путь назначения.
- `UpdateExecutor` — единственный владелец скачивания, распаковки, замены,
  journal и rollback. Он работает независимо от жизненного цикла service worker.
- GitHub Actions — единственный источник опубликованных ZIP и метаданных.
- `chrome.storage.local` содержит только состояние UX и идентификатор операции;
  рабочие файлы, резервные копии и journal находятся в каталоге установки помощника.

## Контракт релиза

Каждый релиз публикует:

```text
MovieList-extension-<version>.zip
update.json
update.json.sig
```

`update.json` содержит `schemaVersion`, `extensionId`, `version`, `assetName`,
`assetUrl`, `sha256`, `size`, `minUpdaterVersion` и `publishedAt`. Подписываются
канонические UTF-8 байты `update.json`; публичный ключ встроен в исполнитель.
Пакет принимается только при совпадении имени, размера, хеша, версии manifest и
extension ID. ZIP распаковывается в новую папку, а не поверх текущей.

## UX-сценарии

Первая установка: пользователь запускает Setup, выбирает постоянную папку профиля,
загружает её в Chrome один раз и нажимает «Проверить подключение». После успешной
проверки состояние сохраняется. При нескольких профилях каждый профиль подключается
отдельно, но скачанный пакет и кэш общие.

Обычное обновление: расширение тихо проверяет релиз с backoff, загружает пакет в
фоновом режиме и ждёт безопасного момента. При открытом просмотре, комнате,
фоновом аудио или несохранённой форме показывается «Обновление готово — установим
после завершения». После замены выполняется reload и подтверждение фактической
версии. При ошибке показывается одна кнопка восстановления.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: diagnostic reproduction and post-change regression
- Reason: пользователь не просил strict TDD; для протокола нужны контрактные и
  интеграционные проверки, но не обязательный RED/GREEN цикл.

## Изменяемые поверхности

- `src/background/background.js`: удалить текущий дублированный coordinator и
  подключить `UpdateService`.
- `src/shared/services/UpdateService.js`: состояние, metadata, native protocol,
  retry/backoff и безопасный момент установки.
- `src/popup/popup.html`, `src/popup/popup.js`, settings page: понятные статусы и
  настройка automatic updates.
- `native-host/Updater/`: C# Native Host, executor, setup mode, registry manifest.
- `scripts/package-release.js`, `scripts/generate-update-metadata.js`: сборка,
  allowlist, checksum и metadata.
- `.github/workflows/release.yml`: воспроизводимый draft/publish pipeline.
- `tests/updateService.test.js` и native tests: протокол, версии, rollback и
  повреждённые пакеты.

## Проверка

До пользовательского пилота должны пройти:

- чистая сборка и allowlist архива;
- проверка сигнатуры, хеша, размера, manifest version и extension ID;
- offline, timeout, 404, повреждённый ZIP и неверная подпись;
- закрытие Chrome, убийство updater, перезапуск Windows и нехватка места;
- файл-блокировка и восстановление предыдущей версии;
- открытый player/room/radio не прерываются;
- два профиля с разными настройками не запускают двойную установку;
- новая версия подтверждена через runtime message, а не только `onInstalled`;
- ручной setup доступен без терминала.

## Риски и retirement

- Старый GitHub download flow удаляется после работы нового executor и успешного
  интеграционного теста; до этого не оставлять два независимых владельца.
- Старый `update_instructions` экран удаляется после появления готового setup mode
  и миграционной проверки существующей установки.
- Переключение на новый native host нельзя публиковать без recovery path: если
  новая версия не запустится, расширение не сможет само себя восстановить.
