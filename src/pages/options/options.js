const settingsUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('src/pages/settings/settings.html')
    : '';

if (settingsUrl && window.location.pathname.endsWith('/options.html')) {
    window.location.replace(settingsUrl);
}
