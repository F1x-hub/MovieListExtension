# Firebase Firestore CRUD Chrome Extension

A modern Chrome extension that demonstrates CRUD operations with Firebase Firestore, featuring Google authentication and a beautiful user interface.

## Features

- 🔐 **Google Authentication** - Secure sign-in with Google OAuth2
- 📝 **CRUD Operations** - Create, Read, Update, and Delete records
- 🔄 **Real-time Updates** - Live data synchronization with Firestore
- 🎨 **Modern UI** - Beautiful, responsive interface with gradient design
- ⚡ **Fast Performance** - Optimized for Chrome Extension Manifest V3
- 🔒 **Secure** - User-specific data isolation and proper authentication

## Project Structure

```
├── manifest.json          # Chrome extension manifest
├── popup.html             # Main popup interface
├── popup.css              # Styling for the popup
├── popup.js               # Popup logic and event handling
├── firestore.js           # Firebase configuration and CRUD operations
├── background.js          # Service worker for background tasks
├── icons/                 # Extension icons (16px, 48px, 128px)
└── README.md              # This documentation
```

## Prerequisites

1. **Google Chrome** (version 88 or higher)
2. **Firebase Project** with Firestore enabled
3. **Google Cloud Console** project for OAuth2 credentials

## Setup Instructions

### 1. Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Enable **Authentication** and **Firestore Database**
4. In Authentication, enable **Google** sign-in provider
5. In Firestore, create a collection named `records`
6. Set up Firestore security rules:

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

### 2. Google OAuth2 Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your Firebase project
3. Navigate to **APIs & Services** > **Credentials**
4. Create **OAuth 2.0 Client ID** for **Chrome Extension**
5. Add your extension ID to authorized origins
6. Copy the **Client ID**

### 3. Extension Configuration

1. Open `manifest.json` and update the OAuth2 client ID:
```json
"oauth2": {
  "client_id": "YOUR_ACTUAL_CLIENT_ID.apps.googleusercontent.com"
}
```

2. Open `firestore.js` and update Firebase configuration:
```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 4. Icons Setup

Create an `icons` folder and add three icon files:
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)  
- `icon128.png` (128x128 pixels)

## Installation

### Development Mode

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the folder containing your extension files
5. The extension should appear in your extensions list

### Production Mode

1. Package your extension as a `.zip` file
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
3. Upload your extension package
4. Fill in store listing details
5. Submit for review

## Usage

1. **Install** the extension from Chrome Web Store or load unpacked
2. **Click** the extension icon in your browser toolbar
3. **Sign in** with your Google account
4. **Add records** using the form at the top
5. **View, edit, or delete** records from the list below
6. **Refresh** to sync with Firestore database

## API Reference

### FirebaseManager Class

#### Methods

- `signInWithGoogle()` - Authenticate with Google OAuth2
- `signOut()` - Sign out current user
- `addRecord(title, content)` - Create a new record
- `getRecords()` - Retrieve all user records
- `updateRecord(id, title, content)` - Update existing record
- `deleteRecord(id)` - Delete a record
- `listenToRecords(callback)` - Real-time updates listener

#### Properties

- `isAuthenticated()` - Check authentication status
- `getCurrentUser()` - Get current user object

### PopupManager Class

#### Methods

- `handleLogin()` - Process Google sign-in
- `handleAddRecord(e)` - Process form submission
- `loadRecords()` - Load and display records
- `startEditRecord(record)` - Begin edit mode
- `saveEditRecord(id)` - Save edited record
- `deleteRecord(id)` - Delete record with confirmation

## Security Features

- **User Isolation** - Each user can only access their own records
- **Authentication Required** - All operations require valid authentication
- **Input Validation** - Client-side validation for all inputs
- **XSS Protection** - HTML escaping for user-generated content
- **Secure OAuth2** - Google OAuth2 for secure authentication

## Troubleshooting

### Common Issues

1. **Authentication Fails**
   - Check OAuth2 client ID in manifest.json
   - Verify Firebase project configuration
   - Ensure Google sign-in is enabled in Firebase

2. **Firestore Permission Denied**
   - Check Firestore security rules
   - Verify user authentication status
   - Ensure proper user ID matching

3. **Extension Not Loading**
   - Check manifest.json syntax
   - Verify all required files are present
   - Check Chrome console for errors

4. **Icons Not Displaying**
   - Ensure icons folder exists
   - Verify icon file names match manifest.json
   - Check icon file formats (PNG recommended)

### Debug Mode

Enable Chrome extension debugging:
1. Go to `chrome://extensions/`
2. Find your extension
3. Click **Details**
4. Enable **Allow in incognito**
5. Open Chrome DevTools to see console logs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review Firebase documentation
- Check Chrome Extension documentation

## Changelog

### Version 1.0.0
- Initial release
- Google OAuth2 authentication
- Full CRUD operations
- Modern UI design
- Chrome Extension Manifest V3 support
