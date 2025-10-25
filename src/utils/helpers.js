/**
 * Shared utility functions for the Movie Rating Extension
 */

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} - Escaped HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Truncate text to a maximum length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
function truncateText(text, maxLength = 100) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Show loading indicator
 * @param {HTMLElement} element - Loading element
 * @param {boolean} show - Whether to show or hide
 */
function toggleLoading(element, show) {
    if (element) {
        element.style.display = show ? 'flex' : 'none';
    }
}

/**
 * Show error message with auto-hide
 * @param {HTMLElement} element - Error message element
 * @param {string} message - Error message
 * @param {number} duration - Duration in milliseconds (default: 5000)
 */
function showErrorMessage(element, message, duration = 5000) {
    if (!element) return;
    
    element.textContent = message;
    element.style.display = 'block';
    
    setTimeout(() => {
        element.style.display = 'none';
    }, duration);
}

/**
 * Hide error message
 * @param {HTMLElement} element - Error message element
 */
function hideErrorMessage(element) {
    if (element) {
        element.style.display = 'none';
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        truncateText,
        toggleLoading,
        showErrorMessage,
        hideErrorMessage
    };
} else {
    window.Utils = {
        escapeHtml,
        truncateText,
        toggleLoading,
        showErrorMessage,
        hideErrorMessage
    };
}
