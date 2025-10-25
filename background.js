// Background service worker for Movie Rating Extension
// Minimal setup - most logic is handled in popup and search pages

chrome.runtime.onInstalled.addListener(() => {
    console.log('Movie Rating Extension installed');
});
