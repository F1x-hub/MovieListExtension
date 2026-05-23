# AGENT.md — Movie Rating Extension

> Этот файл описывает правила и контекст для AI-агентов, работающих с данным проектом.
> Читается автоматически при запуске агента в корне репозитория.

---

## Проект

**Movie Rating Extension** — браузерное расширение Chrome (Manifest V3) для управления рейтингами, просмотрами и релизами фильмов/сериалов. Интегрируется с Firebase, Кинопоиском, TMDB и встраивает свой UI прямо в страницы онлайн-кинотеатров.

| Параметр | Значение |
|:---|:---|
| **Платформа** | Chrome Extension Manifest V3 |
| **Стек** | Vanilla JS + HTML + CSS (строго без React/Vue/фреймворков) |
| **Сборка** | Кастомные NPM-скрипты (copyfiles, rimraf, nodemon). Без Webpack/Vite |
| **База данных** | Firebase Firestore (movielistdb-13208) |
| **Внешние API** | Kinopoisk, TMDB, IMDb, MyAnimeList, Spotify |
| **ОС разработчика** | Windows |

---

## Архитектура

### Точки входа

| Контекст | Файл | Назначение |
|:---|:---|:---|
| Background | `src/background/background.js` | Service Worker — сеть, авторизация, токены |
| Popup | `src/popup/` | Главный popup расширения |
| Pages | `src/pages/` | search, ratings, watchlist, bookmarks, movie-details, calendar, random, profile, admin |
| Content Scripts | `content-scripts/` | Инъекции в HDRezka, Ex-Fs, Zfilms, Kinogo, Rutube, Kinopoisk, IMDb |
| Shared | `src/shared/` | Компоненты, сервисы, утилиты, Firebase |

### Модульная система (критически важно)

- **НИКАКИХ** `require()` и голых импортов из `node_modules`
- Все импорты — только **относительные пути**: `import { x } from '../../shared/utils.js'`
- Внешние библиотеки (`firebase-compat`, `hls.js`) — только локально из `/libs/`, без CDN
- Глобальные переменные через `window.*` (например, `window.firebase`, `window.MyParser`)

### IPC: Content Script ↔ Background Worker

```
Content Script
  └─ window.postMessage({ type: 'MOVIE_DATA', ... })
       └─ background.js (Service Worker)
            └─ fetch() к внешним API (обход CORS)
                 └─ chrome.runtime.sendMessage() → ответ в Content Script
```

Все внешние fetch-запросы делаются **только в Background Worker** — не в content scripts и не в страницах.

### State Management

| Слой | Механизм |
|:---|:---|
| Облако | Firebase Firestore — основное хранилище |
| Локальный кэш | `chrome.storage.local` — токены, сессии, кэш |
| Темы | CSS Custom Properties + `data-theme` атрибут |

---

## Структура папок

```
/
├── manifest.json                   ← V3, хосты, пермишены, DNR правила
├── src/
│   ├── background/background.js    ← Service Worker
│   ├── pages/                      ← Многостраничный UI
│   ├── popup/                      ← Popup расширения
│   └── shared/
│       ├── components/             ← MovieCard.js, Navigation.js и др.
│       ├── services/               ← KinopoiskService, TMDBService, RatingService
│       │   └── parsers/            ← Парсеры видео-источников (плагинная архитектура)
│       ├── utils/                  ← RussianStemmer.js, Utils.js, debounce
│       └── firestore.js            ← Firebase init, Auth, Storage
├── content-scripts/                ← Инъекции на сторонние сайты
└── libs/                           ← firebase-compat, hls.js (локально)
```

---

## Система парсеров (плагинная архитектура)

Все парсеры видео-источников наследуют `BaseParserService` и регистрируются в `ParserRegistry`.

### Добавление нового парсера

**1. Создать файл:** `src/shared/services/parsers/MyParser.js`

```js
class MyParser extends BaseParserService {
  constructor() {
    super({ id: 'myparser', name: 'My Source', baseUrl: 'https://my-source.net' });
  }

  async search(title, year) {
    // Вернуть SearchResult | null
    return { url: '...', title: '...', parserId: this.id };
  }

  async getVideoSources(searchResult) {
    // Вернуть VideoSource[]
    return [{ name: 'Player 1', url: 'https://...', type: 'iframe' }];
  }
}
window.MyParser = MyParser;
```

**2. Зарегистрировать** в `parser-init.js`: `registry.register(new MyParser())`

**3. Добавить `<script>`** в `movie-details.html` и `search.html` до `parser-init.js`:
```html
<script defer src="../../shared/services/parsers/MyParser.js"></script>
```

### Контракт BaseParserService

| Метод | Обязателен | Описание |
|:---|:---|:---|
| `search(title, year)` | да | Поиск, вернуть `SearchResult\|null` |
| `getVideoSources(searchResult)` | да | Вернуть `VideoSource[]` |
| `renderPlayer(container, sources, options)` | нет | Кастомный плеер (по умолч. iframe) |
| `getPlayerType()` | нет | `'iframe'`, `'video'`, `'custom'` |

Для кэширования использовать `cachedSearch()` вместо `search()` (TTL по умолч. 1 час).

---

## Безопасность

| Аспект | Реализация |
|:---|:---|
| CSP | `script-src 'self'; object-src 'self'` — строго |
| Авторизация | Firebase Auth: Google OAuth через `chrome.identity.launchWebAuthFlow` + Email/Password |
| Токены | Хранятся в `chrome.storage.local`, обновляются Service Worker'ом |
| CORS | Все внешние запросы — только через Background Service Worker |
| Реклама | `player-cleaner.js` — детектирует и скрывает баннеры в сторонних плеерах |

---

## Функциональные модули

| Модуль | Описание |
|:---|:---|
| Умный поиск | Russian Snowball Stemmer (морфологический анализ) + Kinopoisk + TMDB |
| Закладки / Коллекции | Смотрю / В планах / Избранное + кастомные коллекции |
| Календарь релизов | Динамический на базе закладок, обратный отсчёт через TMDB |
| Рандомайзер | Пул фильмов + анимация слот-машины (roulette) через `requestAnimationFrame` |
| Нативный плеер | HLS (m3u8), парсинг Rutube, память таймкодов, AniSkip (пропуск опенингов) |
| Аниме Радио | Anison.FM в навбаре, состояние сохраняется при навигации |
| Инъекции в плееры | Content Scripts определяют фильм (regex/DOM) и рендерят UI расширения поверх чужого плеера |
| Локализация | Кастомная i18n система (`locales.js`) |
| Админ панель | Управление пользователями, модерация контента |

---

## Правила агента (обязательные)

### Формат ответов

1. **Язык**: Только русский язык.
2. **Промпты**: Формат `## Промпт: Название` с пометкой `(Не запускать команды — применить самостоятельно)`.
3. **Код**: Только diff — не выводить файл целиком.
4. **Чеклист**: Размещать в конце каждого ответа.
5. **Терминал**: Не запускать команды самостоятельно. Описывать шаги. Исключение — явное разрешение.
6. **Объяснения**: Сначала кратко объяснить причину проблемы, затем — решение.
7. **Таблицы**: Использовать для сравнений было/стало, конфигураций, вариантов.
8. **Иконки**: Только SVG. Никаких emoji — ни в UI-коде, ни в ответах агента.

### Конвенции кода

- ES6 Modules с **относительными путями** — никаких голых импортов
- `async`/`await` везде, где есть асинхронность
- UI строго на Vanilla JS (`document.createElement` + интерполяция)
- Стили — только CSS Custom Properties. Никакого хардкода цветов
- `debounce` — собственная реализация, без lodash
- Анимации — через `requestAnimationFrame`
- Новые классы-парсеры экспонировать через `window.MyParser = MyParser`

### Manifest V3 — ограничения

- Background — только Service Worker, не persistent background page
- Нет доступа к DOM из background.js
- Все сетевые запросы к внешним API — только из background.js
- CSP запрещает inline-скрипты и eval()
- `chrome.storage.local` вместо `localStorage` в Service Worker

---

## Команды терминала (справочно)

```bash
npm run build     # Сборка расширения
npm run watch     # Режим наблюдения (nodemon)
npm run clean     # Очистка dist (rimraf)
npm run copy      # Копирование файлов (copyfiles)
```

---

## Что нельзя трогать

- Не добавлять React/Vue/Angular/Svelte — Vanilla JS строго обязателен
- Не использовать CDN для библиотек — только `/libs/` локально
- Не использовать `require()` — только ES6 `import`
- Не делать fetch к внешним API из content scripts — только через background.js
- Не хардкодить цвета HEX — только CSS Custom Properties
- Не добавлять inline-скрипты в HTML — нарушает CSP
