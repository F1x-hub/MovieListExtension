# A5-0: проверка сетевой границы и решение G-A5

Дата: 2026-10-16. Статус: проверены перечисленные модели Chromium; production
UrlPolicy/loader/DNR ещё не внедрены. Полная матрица A5-0 не закрыта.

## Эксперимент

Команда: npm run test:player-network-experiment. Изолированный настоящий Chromium,
страница расширения и его service worker; два собственных HTTP-сервера на случайных
127.0.0.1-портах. Реальный MediaPlayer :3000 не используется. Источник снаружи
моделируется отдельным локальным origin; это не проверка публичного DNS/HTTPS.
Все session DNR rules существуют только в временном профиле и удаляются в конце.
Сервер назначения считает реально принятые HTTP-запросы. Только синтетическое HLS.

| Сценарий | Фактический результат |
| --- | --- |
| Block-only правило на sink, extension-initiated redirect | Fetch отказан, счётчик sink не изменился |
| Более приоритетный глобальный allow на sink | Redirect прошёл, sink получил HTTP-запрос |
| Тот же allow ограничен текущим tabId | Redirect всё равно прошёл: одна вкладка не разделяет remote/local |
| Fetch redirect:error при активном allow | Fetch отказан до запроса к sink, счётчик не изменился |
| Remote-описание HLS с absolute child URI на allowed sink | Init/фрагменты получены с sink, синтетическое видео играет |
| Запрос из provider-origin iframe при block-only initiatorDomains extId | Запрос к sink проходит: инициатор frame не extension origin |
| Sandbox с allow-same-origin | postMessage event.origin равен provider fixture origin |
| Sandbox без allow-same-origin | postMessage event.origin равен строке null |
| canPlayType(application/vnd.apple.mpegurl) | maybe; это объявленная capability, не проверка native HLS decoding |

В тесте допускаются напрямую только точные origin обоих собственных серверов;
implicit loopback/link-local proxy bypass вычтен. Это необходимо, чтобы proxy не
замаскировал результат DNR. Проверки не обращаются к чужим private/link-local узлам.

## Вывод

Глобальное исключение local origin и одно tabId не обеспечивают строгого запрета
контакта remote-потока с local endpoint. Проверка финального responseURL тоже
запаздывает. Отдельно подтверждён пробел provider-initiated iframe запросов.
Это дефект модели гарантии, а не доказательство обхода авторизации MediaPlayer API.

Контролируемый Fetch без автоматического redirect — проверенный кандидат только
для загрузчиков, которые действительно используют этот transport. Он не управляет
внутренними загрузками native HLS, прямого video.src MP4 или track.src. Сам HLS
Loader interface/stats/range/auth/abort и возможные легитимные CDN redirects ещё
требуют реализации и тестов; этот эксперимент не делает такой loader готовым.

## Два допустимых продолжения, выбор владельца

1. Поэтапная ограниченная гарантия. Сначала UrlPolicy и управляемый HLS transport;
   remote native fallback не используется в строгом HLS-пути. Прямой MP4 и
   provider-owned iframe сохраняются с явно ограниченной гарантией; их рабочие
   пути не отключаются молча. A5 в целом не считается закрытым. Перед выпуском
   нужен живой прогон CDN/редиректов и отдельное решение по direct files.
2. Сначала общая архитектура изоляции. Подготовить отдельный проект remote/local
   сетевых principals (например, изолированная среда remote-плеера и проверенный
   bridge либо контролируемый media transport). Сохранение progress, canonical
   selection, комнат, native controls и direct MP4 должно быть доказано прототипом.
   Новые runtime permissions/backend изменения требуют отдельных карточек. Такая
   архитектура пока не спроектирована и не авторизована данным экспериментом.

Рекомендация для инкрементальной работы — вариант 1, если владелец принимает его
ограничения. До ответа G-A5 не внедрять обещающую строгую защиту production-ветку A5.
Независимые E1-задачи могут продолжаться после решений G1.

## Не проверено

Direct MP4/track redirects, native HLS decoding/вложенные URI, реальный public
HTTPS/CDN, DNS rebinding, сессионные гонки и смена torrent→remote, весь backend API.
Unknown не превращается в passed по этому короткому эксперименту.

## Независимое ревью

Три независимых read-only ревью не нашли существенных замечаний. Тестовый ревьюер
повторил sandbox contract и Chromium-эксперимент; остальные подтвердили границы
выводов по коду. Полная A5-0 матрица по-прежнему не закрыта.

## Решение владельца G-A5

В сообщении 2026-10-16 выбран вариант: «Поэтапно: сначала управляемый HLS; прямой
MP4 и чужие iframe пока сохранить с явно ограниченной гарантией». Точный timestamp
недоступен. Это разрешает следующую ограниченную HLS-карточку, но не объявляет
полную A5-защиту готовой и не разрешает релиз/публикацию.
