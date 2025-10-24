# Настройка расширения Chrome с Firebase Firestore

## Быстрый старт

### 1. Настройка Firebase

1. Перейдите в [Firebase Console](https://console.firebase.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите **Authentication** и **Firestore Database**
4. В Authentication включите провайдер **Google**
5. В Firestore создайте коллекцию `records`
6. Настройте правила безопасности Firestore:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /records/{document} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
    }
  }
}
```

### 2. Получение конфигурации Firebase

1. В Firebase Console перейдите в **Project Settings** > **General**
2. В разделе **Your apps** нажмите **Add app** > **Web**
3. Зарегистрируйте приложение и скопируйте конфигурацию
4. Обновите `firestore.js`:

```javascript
const firebaseConfig = {
  apiKey: "ваш-api-key",
  authDomain: "ваш-проект.firebaseapp.com",
  projectId: "ваш-проект-id",
  storageBucket: "ваш-проект.appspot.com",
  messagingSenderId: "ваш-sender-id",
  appId: "ваш-app-id"
};
```

### 3. Настройка Google OAuth2

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Выберите ваш Firebase проект
3. Перейдите в **APIs & Services** > **Credentials**
4. Создайте **OAuth 2.0 Client ID** для **Chrome Extension**
5. Добавьте ID вашего расширения в авторизованные источники
6. Скопируйте **Client ID**
7. Обновите `manifest.json`:

```json
"oauth2": {
  "client_id": "ваш-client-id.apps.googleusercontent.com"
}
```

### 4. Создание иконок

Создайте три иконки в папке `icons/`:
- `icon16.png` (16x16 пикселей)
- `icon48.png` (48x48 пикселей)
- `icon128.png` (128x128 пикселей)

### 5. Установка расширения

1. Откройте Chrome и перейдите в `chrome://extensions/`
2. Включите **Режим разработчика**
3. Нажмите **Загрузить распакованное расширение**
4. Выберите папку с файлами расширения
5. Расширение появится в списке

## Проверка работы

1. Нажмите на иконку расширения в панели инструментов
2. Войдите через Google
3. Добавьте тестовую запись
4. Проверьте, что данные сохраняются в Firestore

## Возможные проблемы

### Ошибка аутентификации
- Проверьте правильность Client ID в manifest.json
- Убедитесь, что Google sign-in включен в Firebase

### Ошибка доступа к Firestore
- Проверьте правила безопасности Firestore
- Убедитесь, что пользователь аутентифицирован

### Расширение не загружается
- Проверьте синтаксис manifest.json
- Убедитесь, что все файлы на месте
- Проверьте консоль Chrome на ошибки
