/**
 * IconUtils - Utility for handling theme-aware icons
 */
const IconUtils = {
    /**
     * Get the icon path for the specified theme and size
     * @param {string} theme - 'light' or 'dark'
     * @param {number} size - 16, 48, or 128
     * @returns {string} - Relative path to the icon
     */
    getIconPath: (theme, size) => {
        // Default to white/standard if not light theme
        if (theme !== 'light') {
            return `/src/shared/assets/icons/app/icon${size}-white.png`;
        }
        return `/src/shared/assets/icons/app/icon${size}-black.png`;
    },

    /**
     * Get the current page's theme-aware application icon.
     * @param {number} size - 16, 48, or 128
     * @returns {string} - Extension-root-relative icon path
     */
    getCurrentThemeIconPath: (size) => {
        const root = typeof document !== 'undefined' ? document.documentElement : null;
        const body = typeof document !== 'undefined' ? document.body : null;
        const isLightTheme = Boolean(
            root?.classList?.contains('light-theme') ||
            body?.classList?.contains('light-theme')
        );
        return IconUtils.getIconPath(isLightTheme ? 'light' : 'dark', size);
    },

    /**
     * Update the browser extension icon based on the theme
     * @param {string} theme - 'light' or 'dark'
     */
    updateExtensionIcon: (theme) => {
        if (typeof chrome === 'undefined' || !chrome.action) return;

        const path = {
            16: IconUtils.getIconPath(theme, 16),
            48: IconUtils.getIconPath(theme, 48),
            128: IconUtils.getIconPath(theme, 128)
        };

        chrome.action.setIcon({ path: path }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to set icon:', chrome.runtime.lastError);
            }
        });
    }
};

// Export for ES modules or global scope
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IconUtils;
} else if (typeof window !== 'undefined') {
    window.IconUtils = IconUtils;
} else {
    self.IconUtils = IconUtils;
}
