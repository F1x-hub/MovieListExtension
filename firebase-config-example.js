// Пример конфигурации Firebase
// Скопируйте этот код в firestore.js и замените значения на ваши

const firebaseConfig = {
  // Получите эти значения в Firebase Console > Project Settings > General > Your apps
  apiKey: "AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdefghijklmnopqrstuv"
};

// Пример правил безопасности Firestore
// Вставьте в Firebase Console > Firestore Database > Rules

/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Пользователи могут читать и писать только свои записи
    match /records/{document} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
    }
  }
}
*/

// Пример OAuth2 конфигурации для manifest.json
// Получите Client ID в Google Cloud Console > APIs & Services > Credentials

/*
"oauth2": {
  "client_id": "123456789012-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com",
  "scopes": [
    "profile",
    "email",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ]
}
*/
