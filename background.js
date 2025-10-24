chrome.runtime.onInstalled.addListener(() => {
    console.log('Firebase Firestore CRUD Extension installed');
});

chrome.runtime.onStartup.addListener(() => {
    console.log('Firebase Firestore CRUD Extension started');
});

chrome.identity.onSignInChanged.addListener((account, signedIn) => {
    console.log('Sign in state changed:', { account, signedIn });
});

chrome.runtime.onSuspend.addListener(() => {
    console.log('Firebase Firestore CRUD Extension suspended');
});
