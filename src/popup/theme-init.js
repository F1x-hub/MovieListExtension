(function() {
    try {
        if (window.ThemeService) {
            window.ThemeService.applyCurrentTheme({
                persist: false,
                syncChromeStorage: false
            });
        }
    } catch (e) {
        console.warn('theme-init error:', e);
    }
})();
