/**
 * Utility functions for the Movie Rating Extension
 */
class Utils {
    /**
     * Escape HTML to prevent XSS attacks
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text
     */
    static escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Truncate text to specified length
     * @param {string} text - Text to truncate
     * @param {number} maxLength - Maximum length
     * @returns {string} - Truncated text
     */
    static truncateText(text, maxLength = 100) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength).trim() + '...';
    }

    /**
     * Format timestamp for display
     * @param {Date|Object} timestamp - Timestamp to format
     * @returns {string} - Formatted timestamp
     */
    static formatTimestamp(timestamp) {
        if (!timestamp) return '';
        
        let date;
        if (timestamp.toDate) {
            // Firestore timestamp
            date = timestamp.toDate();
        } else if (timestamp instanceof Date) {
            date = timestamp;
        } else {
            date = new Date(timestamp);
        }
        
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    /**
     * Debounce function calls
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} - Debounced function
     */
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Throttle function calls
     * @param {Function} func - Function to throttle
     * @param {number} limit - Time limit in milliseconds
     * @returns {Function} - Throttled function
     */
    static throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    /**
     * Generate unique ID
     * @returns {string} - Unique ID
     */
    static generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Deep clone an object
     * @param {Object} obj - Object to clone
     * @returns {Object} - Cloned object
     */
    static deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => Utils.deepClone(item));
        if (typeof obj === 'object') {
            const clonedObj = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = Utils.deepClone(obj[key]);
                }
            }
            return clonedObj;
        }
    }

    /**
     * Check if element is in viewport
     * @param {Element} element - Element to check
     * @returns {boolean} - True if in viewport
     */
    static isInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    /**
     * Smooth scroll to element
     * @param {Element|string} element - Element or selector
     * @param {number} offset - Offset from top
     */
    static scrollToElement(element, offset = 0) {
        const target = typeof element === 'string' ? document.querySelector(element) : element;
        if (!target) return;

        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
        });
    }

    /**
     * Format file size
     * @param {number} bytes - Size in bytes
     * @returns {string} - Formatted size
     */
    static formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Validate email address
     * @param {string} email - Email to validate
     * @returns {boolean} - True if valid
     */
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Get URL parameters
     * @param {string} param - Parameter name
     * @returns {string|null} - Parameter value
     */
    static getUrlParameter(param) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(param);
    }

    /**
     * Set URL parameter without page reload
     * @param {string} param - Parameter name
     * @param {string} value - Parameter value
     */
    static setUrlParameter(param, value) {
        const url = new URL(window.location);
        url.searchParams.set(param, value);
        window.history.pushState({}, '', url);
    }

    /**
     * Remove URL parameter without page reload
     * @param {string} param - Parameter name
     */
    static removeUrlParameter(param) {
        const url = new URL(window.location);
        url.searchParams.delete(param);
        window.history.pushState({}, '', url);
    }

    /**
     * Copy text to clipboard
     * @param {string} text - Text to copy
     * @returns {Promise<boolean>} - Success status
     */
    static async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                return true;
            } catch (err) {
                return false;
            } finally {
                document.body.removeChild(textArea);
            }
        }
    }

    /**
     * Show toast notification
     * @param {string} message - Message to show
     * @param {string} type - Type: success, error, warning, info
     * @param {number} duration - Duration in milliseconds
     */
    static showToast(message, type = 'info', duration = 3000) {
        // Remove existing toasts
        const existingToasts = document.querySelectorAll('.utils-toast');
        existingToasts.forEach(toast => toast.remove());

        const toast = document.createElement('div');
        toast.className = `utils-toast utils-toast-${type}`;
        toast.textContent = message;
        
        // Add styles
        Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '8px',
            color: 'white',
            fontWeight: '500',
            fontSize: '14px',
            zIndex: '10000',
            maxWidth: '300px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            transform: 'translateX(100%)',
            transition: 'transform 0.3s ease',
            backgroundColor: type === 'success' ? '#28a745' : 
                           type === 'error' ? '#dc3545' : 
                           type === 'warning' ? '#ffc107' : '#17a2b8'
        });

        document.body.appendChild(toast);

        // Animate in
        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
        }, 10);

        // Animate out and remove
        setTimeout(() => {
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    /**
     * Create loading spinner element
     * @param {string} size - Size: small, medium, large
     * @returns {Element} - Spinner element
     */
    static createSpinner(size = 'medium') {
        const spinner = document.createElement('div');
        spinner.className = `utils-spinner utils-spinner-${size}`;
        
        const sizeMap = {
            small: '20px',
            medium: '40px',
            large: '60px'
        };
        
        Object.assign(spinner.style, {
            width: sizeMap[size],
            height: sizeMap[size],
            border: '3px solid rgba(255, 255, 255, 0.3)',
            borderTop: '3px solid #667eea',
            borderRadius: '50%',
            animation: 'utils-spin 1s linear infinite',
            display: 'inline-block'
        });

        // Add keyframe animation if not exists
        if (!document.querySelector('#utils-spinner-styles')) {
            const style = document.createElement('style');
            style.id = 'utils-spinner-styles';
            style.textContent = `
                @keyframes utils-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        return spinner;
    }

    /**
     * Format number with commas
     * @param {number} num - Number to format
     * @returns {string} - Formatted number
     */
    static formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * Get random item from array
     * @param {Array} array - Array to pick from
     * @returns {*} - Random item
     */
    static getRandomItem(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    /**
     * Shuffle array
     * @param {Array} array - Array to shuffle
     * @returns {Array} - Shuffled array
     */
    static shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Check if device is mobile
     * @returns {boolean} - True if mobile
     */
    static isMobile() {
        return window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    /**
     * Get contrast color (black or white) for background
     * @param {string} hexColor - Hex color code
     * @returns {string} - 'black' or 'white'
     */
    static getContrastColor(hexColor) {
        // Remove # if present
        hexColor = hexColor.replace('#', '');
        
        // Convert to RGB
        const r = parseInt(hexColor.substr(0, 2), 16);
        const g = parseInt(hexColor.substr(2, 2), 16);
        const b = parseInt(hexColor.substr(4, 2), 16);
        
        // Calculate luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        
        return luminance > 0.5 ? 'black' : 'white';
    }

    /**
     * Get display name based on user profile settings
     * @param {Object} profile - User profile object
     * @param {Object} fallbackUser - Fallback user object (from Firebase Auth)
     * @returns {string} - Display name
     */
    static getDisplayName(profile, fallbackUser = null) {
        if (!profile && !fallbackUser) {
            return 'Unknown User';
        }

        const displayNameFormat = profile?.displayNameFormat || 'fullname';
        
        if (displayNameFormat === 'username' && profile?.username) {
            return profile.username;
        } else {
            const firstName = profile?.firstName || '';
            const lastName = profile?.lastName || '';
            const fullName = [firstName, lastName].filter(Boolean).join(' ');
            
            if (fullName) {
                return fullName;
            } else {
                return profile?.displayName || fallbackUser?.displayName || fallbackUser?.email || 'Unknown User';
            }
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
} else {
    window.Utils = Utils;
}
