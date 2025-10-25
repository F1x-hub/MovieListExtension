# Настройка расширения Chrome "Movie Rating Extension"

## Описание проекта

Расширение для Chrome, позволяющее пользователям искать фильмы через API Кинопоиска, оценивать их и делиться рейтингами с сообществом. Включает аутентификацию через Google и email, кэширование данных фильмов и систему рейтингов.

## Быстрый старт

### 1. Настройка Firebase

1. Перейдите в [Firebase Console](https://console.firebase.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите **Authentication** и **Firestore Database**
4. В Authentication включите провайдеры:
   - **Google** (для OAuth2)
   - **Email/Password** (для регистрации через email)
5. В Firestore создайте следующие коллекции:
   - `records` - для хранения записей пользователей
   - `users` - для профилей пользователей
   - `ratings` - для рейтингов фильмов
   - `movies` - для кэширования данных фильмов
6. Настройте правила безопасности Firestore:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Пользователи могут читать и писать только свои записи
    match /records/{document} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
    }
    
    // Пользователи могут читать и писать только свой профиль
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Рейтинги: пользователи могут читать все, писать только свои
    match /ratings/{document} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == resource.data.userId;
    }
    
    // Фильмы: все аутентифицированные пользователи могут читать и писать
    match /movies/{document} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 2. Получение конфигурации Firebase

1. В Firebase Console перейдите в **Project Settings** > **General**
2. В разделе **Your apps** нажмите **Add app** > **Web**
3. Зарегистрируйте приложение и скопируйте конфигурацию
4. Обновите `firestore.js` (строки 12-20):

```javascript
const firebaseConfig = {
    apiKey: "ваш-api-key",
    authDomain: "ваш-проект.firebaseapp.com",
    projectId: "ваш-проект-id",
    storageBucket: "ваш-проект.appspot.com",
    messagingSenderId: "ваш-sender-id",
    appId: "ваш-app-id",
    measurementId: "ваш-measurement-id" // опционально
};
```

### 3. Настройка Google OAuth2

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Выберите ваш Firebase проект
3. Перейдите в **APIs & Services** > **Credentials**
4. Создайте **OAuth 2.0 Client ID** для **Chrome Extension**
5. Добавьте ID вашего расширения в авторизованные источники
6. Скопируйте **Client ID**
7. Обновите `manifest.json` (строки 16-24):

```json
"oauth2": {
  "client_id": "ваш-client-id.apps.googleusercontent.com",
  "scopes": [
    "profile",
    "email",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ]
}
```

### 4. Настройка API Кинопоиска

1. Перейдите на [Kinopoisk API](https://kinopoisk.dev/)
2. Зарегистрируйтесь и получите API ключ
3. Обновите `src/config/kinopoisk.config.js` (строка 7):

```javascript
API_KEY: 'ваш-kinopoisk-api-key',
```

### 5. Создание иконок

Создайте три иконки в папке `icons/`:
- `icon16.png` (16x16 пикселей)
- `icon48.png` (48x48 пикселей)
- `icon128.png` (128x128 пикселей)

### 6. Сборка проекта

1. Установите зависимости:
```bash
npm install
```

2. Соберите проект:
```bash
npm run build
```

3. Файлы будут собраны в папку `dist/`

### 7. Установка расширения

1. Откройте Chrome и перейдите в `chrome://extensions/`
2. Включите **Режим разработчика**
3. Нажмите **Загрузить распакованное расширение**
4. Выберите папку `dist/` с собранными файлами
5. Расширение появится в списке

## Структура проекта

```
src/
├── config/
│   └── kinopoisk.config.js    # Конфигурация API Кинопоиска
├── services/
│   ├── KinopoiskService.js    # Сервис для работы с API Кинопоиска
│   ├── MovieCacheService.js   # Сервис кэширования фильмов
│   ├── RatingService.js       # Сервис рейтингов
│   └── UserService.js         # Сервис пользователей
└── styles/
    ├── common.css             # Общие стили
    ├── components.css         # Стили компонентов
    ├── popup.css              # Стили popup
    ├── search.css             # Стили поиска
    ├── poster-fixes.css       # Исправления постеров
    └── overflow-fixes.css     # Исправления переполнения
```

## Функциональность

### Основные возможности:
- **Поиск фильмов** через API Кинопоиска
- **Система рейтингов** (1-10) с комментариями
- **Аутентификация** через Google и email
- **Кэширование** данных фильмов в Firestore
- **Лента рейтингов** сообщества
- **Профили пользователей** с статистикой

### Страницы:
- **Popup** (`popup.html`) - основное окно расширения
- **Search** (`search.html`) - расширенный поиск фильмов

## Проверка работы

1. Нажмите на иконку расширения в панели инструментов
2. Войдите через Google или зарегистрируйтесь через email
3. Попробуйте найти фильм через поиск
4. Оцените фильм и добавьте комментарий
5. Проверьте, что данные сохраняются в Firestore

## Возможные проблемы

### Ошибка аутентификации
- Проверьте правильность Client ID в manifest.json
- Убедитесь, что Google sign-in включен в Firebase
- Проверьте настройки OAuth2 в Google Cloud Console

### Ошибка доступа к Firestore
- Проверьте правила безопасности Firestore
- Убедитесь, что пользователь аутентифицирован
- Проверьте конфигурацию Firebase

### Ошибки API Кинопоиска
- Проверьте правильность API ключа
- Убедитесь, что у вас есть доступ к API
- Проверьте лимиты запросов

### Расширение не загружается
- Проверьте синтаксис manifest.json
- Убедитесь, что все файлы собраны в папке dist/
- Проверьте консоль Chrome на ошибки
- Убедитесь, что все зависимости установлены

### Проблемы с поиском
- Проверьте подключение к интернету
- Убедитесь, что API Кинопоиска доступен
- Проверьте консоль браузера на ошибки CORS

## Дополнительные настройки

### Настройка кэширования
В `src/config/kinopoisk.config.js` можно изменить:
- `CACHE_DURATION` - время жизни кэша (по умолчанию 24 часа)
- `DEFAULT_LIMIT` - количество результатов по умолчанию

### Настройка стилей
Все стили находятся в папке `src/styles/` и могут быть настроены под ваши предпочтения.

### Настройка разрешений
В `manifest.json` можно добавить дополнительные разрешения при необходимости.
