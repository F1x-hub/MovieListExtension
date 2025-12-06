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
        const suffix = theme === 'light' ? '-black' : '-white';
        // Default to white/standard if not light theme
        if (theme !== 'light') {
            return `/icons/icon${size}-white.png`;
        }
        return `/icons/icon${size}-black.png`;
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
