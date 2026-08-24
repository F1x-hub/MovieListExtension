(function() {
    try {
        const theme = localStorage.getItem('movieExtensionTheme') || 'dark';
        if (theme === 'light') {
            document.documentElement.classList.add('light-theme');
            if (document.body) document.body.classList.add('light-theme');
        } else if (theme.startsWith('custom_')) {
            const rawCustoms = localStorage.getItem('movieExtensionCustomThemes');
            if (rawCustoms) {
                const customThemes = JSON.parse(rawCustoms);
                const customTheme = customThemes.find(t => t.id === theme);
                if (customTheme) {
                    if (customTheme.base === 'light') {
                        document.documentElement.classList.add('light-theme');
                        if (document.body) document.body.classList.add('light-theme');
                    } else {
                        document.documentElement.classList.remove('light-theme');
                        if (document.body) document.body.classList.remove('light-theme');
                    }
                    if (customTheme.variables) {
                        Object.keys(customTheme.variables).forEach(key => {
                            document.documentElement.style.setProperty(key, customTheme.variables[key]);
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.warn('theme-init error:', e);
    }
})();
