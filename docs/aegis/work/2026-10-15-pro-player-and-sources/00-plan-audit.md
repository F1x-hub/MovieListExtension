# Аудит планов источников и плеера

Дата: 2026-10-15. Тип: аудит и исправление документации, без реализации плеера.

## Область и входные материалы

Владелец передал два текста: продуктовый план и исполнительный план v5, затем попросил провести аудит и исправить план. Исходные вложения сохранены без изменений. Результат — [СПЕК редакции 2](../../plans/2026-10-15-pro-player-and-sources.md) и [исполнительный план v6](../../plans/2026-10-15-pro-player-and-sources-execution.md).

База: 83a82928c0c33a8cd2f7f9e5e77a10c73622f674, manifest/package 1.3.7. Перед работой были только чужие untracked .firebase/, .vs/, artifacts/, audit-output/, scratch/; они не менялись. Ветки/refs не обновлялись, worktrees не создавались, commit/push/release не выполнялись.

Читались .agents/rules/agent.md, релевантные README, docs/AGENT.md, CONTEXT.md, docs/design-system.md, UPDATER_RELEASE, package scripts, release workflow и целевые renderer/HLS/lifecycle/MediaPlayer/Kodik implementation. Проводился отдельный read-only review сетевой части субагентом; он подтвердил пробелы модели, но не воспроизводил эксплуатацию.

## Находки и принятые исправления

| ID | Находка | Исправление документа |
| --- | --- | --- |
| P01 | responseURL проверяется после автоматического redirect; глобальный allow :3000 не связывает запрос с local session | A5-0/G-A5, три разные гарантии, endpoint-hit counter, убрать готовый XHR/DNR рецепт |
| P02 | native HLS/direct MP4/track могут идти вне управляемого loader | Native remote bypass запрещён при строгой политике; остальные media redirects включены в A5-0; отключение существующего пути согласовывается |
| P03 | initiatorDomains extId не означает всю иерархию iframe | Явная граница extension-owned/provider/nested, отдельный тест и остаточные риски |
| P04 | loader enum неполон, caller override может вернуть обходной transport | Полная context matrix, unknown-kind deny, protected config после overrides, проверка cmcd/EME/content steering |
| P05 | regex 2 KB описан как размер строки; JSON принят дословно | Compiled size/isRegexSupported/реальная загрузка ruleset, явные priorities, candidate после A5-0 |
| P06 | origin+path сохраняет path tokens | Fixed categories/allowlisted templates, synthetic nested/path/query/userinfo тесты |
| P07 | refresh и fallback не имеют общего бюджета; 24 ч бан слишком широк | Один single-flight refresh на media identity/generation; один fallback owner; bounded per-identity cooldown и manual retry |
| P08 | Null sandbox allowlist закрывает задачу так, будто защита включена | Разделить infrastructure-ready и реальные проверенные providers |
| P09 | C1 offline fixtures закрывают обещание ночного live-мониторинга | Offline-ready и operational отдельно; schedule/issue creation/live по авторизации, incident dedup |
| P10 | Один runner не доказывает геоблок; iframe load не TTFF | network_or_access_unconfirmed, measured/approximate/unknown TTFF |
| P11 | E1.5 считает duration достаточной совместимостью | Exact release identity, anchors/drift, validation метода, sample denominator/unknown; 15% — эвристика |
| P12 | Нет source/prototype/branch, но успех заявлен как проверенный | Исторический статус; фиксированный source+hash либо новые contract tests; убрать старый обязательный blob |
| P13 | Linux-only commands и browser revision выданы за универсальные | Windows/CI среды отдельно, platform launchers/path discovery, Node 24 локально vs 22 CI |
| P14 | NO_PROXY и browser preload названы сетевой изоляцией всех тестов | Node transport mocks с границей покрытия; hard isolation отдельно; положительные controls |
| P15 | Запрет всего сетевого кода противоречит реализации продукта | Разделить code authoring, offline execution, live, workflow enable и публикацию |
| P16 | Ревью требует ещё не существующие ответы до самого ревью | Код/документы → review → sanitized evidence → docs-only final review; один согласованный commit |
| P17 | Непадающие характеризационные тесты противоречат общему red-first и D acceptance | Тип теста red→green или green→green указан явно |
| P18 | Default-on в следующем релизе обещан автоматически | G7 отдельно; E1 flag off до приёмки, security fixes не маскируются UX flag |
| P19 | Имена rules/G0/section references и объём тестов создают лишние остановки | Явные gates/карточки, зависимости, текущие project scripts и ограничение только зависимой работы |
| P20 | Неточные SHA(key), произвольный selector, неполная prefs migration | DER/128-bit ID алгоритм, dataset/CSS.escape, keyboard/user intent и сохранение lastSource/innerId |

## Уточнение силы предыдущих выводов

Уже есть device-token авторизация MediaPlayerService.requestJson и native pairing/getDeviceToken. Этот аудит не проверял backend implementation и не доказывает неавторизованный доступ к API. P01 — дефект проектируемой гарантии отсутствия сетевого контакта, а не воспроизведённая эксплуатация.

По BaseParserService.renderPlayer подтверждены native video.src HLS-ветки; по GhostPlayer._initSource — отдельный HLS ctor с наследованием active config; по HlsPlaybackFactory — terminal manifest statuses и fatal-gated обработка. Это основания требований, не доказательство готовности новой защиты.

Исходные ref origin/claude/elegant-galileo-ltuk2k, СПЕК и e1-prototype.patch в checkout отсутствовали. Заявленные 11 тестов/209 команд/0 падений не воспроизведены. После этого аудита каталог work содержит данный отчёт, а не восстановленные прототип/стенды.

Фактически проверены Node v24.18.0, версии manifest/package 1.3.7 и экспорт hls.js 1.6.15; CI по release.yml использует Node 22; lockfile Playwright 1.62.1. Новых библиотек/браузеров не установлено.

## Проверка результата

- Все три новых файла прочитаны обратно; 8 относительных Markdown-ссылок в них ведут на существующие файлы, code fences закрыты, trailing whitespace отсутствует.
- README содержит ровно один Unreleased с английской Docs-записью; опубликованные версии/записи сохранены. INDEX и Documentation map ведут на новые документы.
- git diff --check пройден; node tests/releaseNotes.test.cjs пройден: Unreleased совместим с генератором и не попадает в заметки текущего релиза.
- Финальный независимый read-only review двух планов, аудита и README/INDEX не обнаружил существенных замечаний. Код выбора источников/серий/комнат не изменён.
- Runtime tests/lint/build не требуются для этого docs-only изменения и не доказывали бы реализацию плана.
- Live provider/network exploit/installed extension/device/полный baseline не запускались. A5-0 и новое E1 — будущие задачи, результаты здесь не заявляются.

## Фиксация документов (SHA-256)

Исходные вложения не редактировались; хеши позволяют сопоставить переданные тексты с исправленными версиями. При будущей правке планов хеши обновляются, старый Git blob из v5 не используется.

| Документ | SHA-256 |
| --- | --- |
| СПЕК редакция 2 | fce106a79db8d2880ebd7855928cbe3c515e423aac0cc306dbe0fffe0c2a0aa8 |
| Исполнительный план v6 | 06cb95d16eec614cafac1dedf2d36e82c3d494c45c21f9553bc3e2c541383e85 |
| Исходное вложение: продуктовый план | ca5532f72c512dfe251043af3102813f0ff90cc54abd0351735b77c3e84751d1 |
| Исходное вложение: исполнительный v5 | 21e1a4ae6d57f9c18b3f15c5f1747c917c27f5b9be3bf42e466990c094127e47 |

## Источники

- [Chrome DNR](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest): initiator, ruleset priority, compiled regex, session rules.
- [Playwright extensions](https://playwright.dev/docs/chrome-extensions): bundled Chromium и persistent context.
- [Fetch Standard](https://fetch.spec.whatwg.org/#http-redirect-fetch): redirect mode; пригодность конкретного transport ещё требует A5-0.
