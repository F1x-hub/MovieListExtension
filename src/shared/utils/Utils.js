/**
 * Utility functions for the Movie Rating Extension
 */
class Utils {
    /**
     * Check whether cached movie metadata is sufficient for the detail views.
     * Budget and box-office fields are intentionally excluded: they are
     * legitimately unavailable for many films.
     * @param {Object|null|undefined} movie - Cached movie metadata
     * @returns {boolean} True when description, genres, and persons are present
     */
    static hasDetailedMovieInfo(movie) {
        return Boolean(movie) &&
            Boolean(movie.description?.trim()) &&
            Array.isArray(movie.genres) && movie.genres.length > 0 &&
            Array.isArray(movie.persons) && movie.persons.length > 0;
    }

    /**
     * Safely extract a trimmed genre name from string, number, or object ({name: '...'}, {genre: '...'}).
     * @param {string|Object|number} genre - Genre candidate
     * @returns {string} Clean trimmed genre string
     */
    static extractGenreName(genre) {
        if (!genre && genre !== 0) return '';
        if (typeof genre === 'string') return genre.trim();
        if (typeof genre === 'object') {
            const name = genre.name || genre.genre || '';
            return typeof name === 'string' ? name.trim() : (name ? String(name).trim() : '');
        }
        return String(genre).trim();
    }

    /**
     * Safely normalize an array of genres into an array of non-empty strings.
     * @param {Array<string|Object|number>} genres - Array of genres
     * @returns {Array<string>} Clean array of genre strings
     */
    static normalizeGenres(genres) {
        if (!Array.isArray(genres)) return [];
        return genres
            .map(g => Utils.extractGenreName(g))
            .filter(Boolean);
    }

    /**
     * Safely format genres for display.
     * @param {Array<string|Object|number>} genres - Array of genres
     * @param {number} [limit] - Optional max items
     * @returns {string} Comma-separated genre string
     */
    static formatGenres(genres, limit) {
        const normalized = Utils.normalizeGenres(genres);
        const sliced = typeof limit === 'number' ? normalized.slice(0, limit) : normalized;
        return sliced.join(', ');
    }

    /**
     * Safely extract a trimmed country name from string or object ({name: '...'}, {country: '...'}).
     * @param {string|Object} country - Country candidate
     * @returns {string} Clean trimmed country string
     */
    static extractCountryName(country) {
        if (!country) return '';
        if (typeof country === 'string') return country.trim();
        if (typeof country === 'object') {
            const name = country.name || country.country || '';
            return typeof name === 'string' ? name.trim() : (name ? String(name).trim() : '');
        }
        return String(country).trim();
    }

    /**
     * Safely normalize an array of countries into an array of non-empty strings.
     * @param {Array<string|Object>} countries - Array of countries
     * @returns {Array<string>} Clean array of country strings
     */
    static normalizeCountries(countries) {
        if (!Array.isArray(countries)) return [];
        return countries
            .map(c => Utils.extractCountryName(c))
            .filter(Boolean);
    }

    /**
     * Safely format countries for display.
     * @param {Array<string|Object>} countries - Array of countries
     * @param {number} [limit] - Optional max items
     * @returns {string} Comma-separated country string
     */
    static formatCountries(countries, limit) {
        const normalized = Utils.normalizeCountries(countries);
        const sliced = typeof limit === 'number' ? normalized.slice(0, limit) : normalized;
        return sliced.join(', ');
    }

    /**
     * Safely extract a pure numeric Kinopoisk ID from various object shapes
     * (Kinopoisk API docs, Firestore bookmarks, local cache objects, ratings).
     * Handles and sanitizes composite Firestore doc IDs (e.g. "userId_12345").
     * @param {Object|number|string} item - Movie object, DTO, or ID candidate
     * @returns {number|null} Clean numeric Kinopoisk ID, or null if invalid
     */
    static extractKinopoiskId(item) {
        if (item === null || item === undefined) return null;

        // Direct number
        if (typeof item === 'number' && Number.isInteger(item) && item > 0) {
            return item;
        }

        // Direct string
        if (typeof item === 'string') {
            const trimmed = item.trim();
            if (/^\d+$/.test(trimmed)) {
                const parsed = parseInt(trimmed, 10);
                return parsed > 0 ? parsed : null;
            }
            if (trimmed.includes('_')) {
                const parts = trimmed.split('_');
                const lastPart = parts[parts.length - 1];
                if (/^\d+$/.test(lastPart)) {
                    const parsed = parseInt(lastPart, 10);
                    return parsed > 0 ? parsed : null;
                }
            }
            return null;
        }

        if (typeof item !== 'object') return null;

        // 1. Direct kinopoiskId field (highest priority)
        const kpId = item.kinopoiskId || item.kpId;
        if (typeof kpId === 'number' && Number.isInteger(kpId) && kpId > 0) {
            return kpId;
        }
        if (typeof kpId === 'string' && /^\d+$/.test(kpId.trim())) {
            const parsed = parseInt(kpId.trim(), 10);
            if (parsed > 0) return parsed;
        }

        // 2. movieId field (used by FavoriteService, RatingService, Watchlist)
        const movieId = item.movieId;
        if (typeof movieId === 'number' && Number.isInteger(movieId) && movieId > 0) {
            return movieId;
        }
        if (typeof movieId === 'string' && /^\d+$/.test(movieId.trim())) {
            const parsed = parseInt(movieId.trim(), 10);
            if (parsed > 0) return parsed;
        }

        // 3. Nested movie object (e.g. item.movie)
        if (item.movie && typeof item.movie === 'object') {
            const nestedId = Utils.extractKinopoiskId(item.movie);
            if (nestedId) return nestedId;
        }

        // 4. item.id (only if pure numeric integer or numeric string without composite separator)
        const rawId = item.id;
        if (typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0) {
            return rawId;
        }
        if (typeof rawId === 'string') {
            const trimmedId = rawId.trim();
            if (/^\d+$/.test(trimmedId)) {
                const parsed = parseInt(trimmedId, 10);
                if (parsed > 0) return parsed;
            }
            // If composite ID like "${userId}_${movieId}", extract trailing numeric ID as fallback
            if (trimmedId.includes('_')) {
                const parts = trimmedId.split('_');
                const lastPart = parts[parts.length - 1];
                if (/^\d+$/.test(lastPart)) {
                    const parsed = parseInt(lastPart, 10);
                    if (parsed > 0) return parsed;
                }
            }
        }

        return null;
    }

    /**
     * Escape HTML to prevent XSS attacks (generic string escaping primitive)
     * @param {string|number|boolean} text - Primitive to escape
     * @returns {string} - Escaped text
     */
    static escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const str = String(text);
        if (typeof document !== 'undefined' && document.createElement) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Normalize a rating comment/review across string and legacy structured object schemas.
     * Contract:
     * - string -> trimmed string
     * - { text: "hello" } -> "hello"
     * - { comment: "hello" } -> "hello"
     * - null / undefined -> ""
     * - unknown object / other -> "" (Never stringify unknown objects into "[object Object]")
     * @param {*} value - Raw comment value from rating DTO
     * @returns {string} Clean normalized comment string
     */
    static normalizeRatingComment(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'object') {
            if (typeof value.text === 'string') return value.text.trim();
            if (typeof value.comment === 'string') return value.comment.trim();
            return '';
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value).trim();
        }
        return '';
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
     * Clean up movie title (remove file paths, extensions)
     * @param {string} title - Title to clean
     * @returns {string} - Cleaned title
     */
    static cleanTitle(title) {
        if (!title) return '';
        
        // Remove file path (forward and backward slashes)
        let clean = title.split(/[/\\]/).pop();
        
        // Remove common video extensions
        clean = clean.replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v)$/i, '');
        
        // If it looked like a filename (contains dots or underscores instead of spaces), replace them
        // But be careful not to break "Dr. Strange" or "Mr. Robot"
        // Heuristic: if no spaces are present, but dots/underscores are
        if (!clean.includes(' ') && (clean.includes('.') || clean.includes('_'))) {
            clean = clean.replace(/[._]/g, ' ');
        }
        
        return clean;
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
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
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
        } catch {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                return true;
            } catch {
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

    /**
     * Enforce Left-Click only (LKM) on interactive elements within a given root element.
     * Prevents middle/right-click from triggering custom UI event handlers, 
     * but preserves the native context menu.
     * @param {HTMLElement|Document} rootEl Element or document to attach the interceptor to
     */
    static enforceLeftClickOnly(rootEl) {
        if (!rootEl || rootEl._leftClickEnforcerInstalled) return;
        rootEl._leftClickEnforcerInstalled = true;

        const enforcer = (e) => {
            if (e.target.closest('a')) return;

            if ('button' in e && e.button !== 0) {
                e.stopPropagation();
                // middle-click (button === 1) намеренно НЕ блокируем —
                // браузер должен открыть ссылку в новой вкладке
            }
        };

        rootEl.addEventListener('mousedown', enforcer, true);
        rootEl.addEventListener('mouseup', enforcer, true);
        rootEl.addEventListener('click', enforcer, true);
    }

    /**
     * Открыть страницу фильма
     * @param {string|number} movieId - ID фильма
     * @param {boolean} newTab - Открыть в новой вкладке (default: false)
     * @param {Object} options - Optional route metadata, including tmdbId
     */
    static openMoviePage(movieId, newTab = false, options = {}) {
        const tmdbQuery = options.tmdbId ? `&tmdbId=${encodeURIComponent(options.tmdbId)}` : '';
        const typeQuery = options.mediaType ? `&mediaType=${encodeURIComponent(options.mediaType)}` : '';
        const sourceQuery = options.source ? `&source=${encodeURIComponent(options.source)}` : '';
        const titleQuery = options.title ? `&title=${encodeURIComponent(options.title)}` : '';
        const yearQuery = options.year ? `&year=${encodeURIComponent(options.year)}` : '';
        const url = chrome.runtime.getURL(
            `src/pages/movie-details/movie-details.html?movieId=${encodeURIComponent(movieId)}${tmdbQuery}${typeQuery}${sourceQuery}${titleQuery}${yearQuery}`
        );
        if (newTab) {
            const targetWindow = options.targetWindow;
            if (targetWindow && !targetWindow.closed) {
                targetWindow.location.href = url;
            } else {
                window.open(url, '_blank');
            }
        } else {
            window.location.href = url;
        }
    }

    /**
     * Open an immediate internal loading route for a TMDB-only Home card.
     * The Kinopoisk HTML lookup is performed by the details page after the
     * navigation, so the user always gets instant visual feedback.
     */
    static openMovieResolutionPage(info, newTab = false, targetWindow = null) {
        const params = new URLSearchParams({
            resolveTmdbId: String(info.tmdbId || ''),
            source: 'home-tmdb-only',
            title: String(info.title || ''),
            originalTitle: String(info.alternativeName || ''),
            year: String(info.year || ''),
            mediaType: String(info.mediaType || 'movie')
        });
        const url = chrome.runtime.getURL(
            `src/pages/movie-details/movie-details.html?${params.toString()}`
        );
        if (newTab) {
            if (targetWindow && !targetWindow.closed) targetWindow.location.href = url;
            else window.open(url, '_blank');
        } else {
            window.location.href = url;
        }
    }

    /**
     * Навесить обработчики кликов на контейнер с карточками фильмов
     * Поддерживает ЛКМ (переход) и СКМ/auxclick (новая вкладка)
     * @param {HTMLElement} container - Контейнер с карточками
     */
    static bindMovieCardNavigation(container, options = {}) {
        if (!container || container._movieNavBound) return;
        container._movieNavBound = true;

        /**
         * Extract card metadata from the click target.
         */
        function _extractCardInfo(e) {
            const target = e.target.closest('[data-action="view-details"]') || e.target.closest('.featured-card');
            if (!target) return null;

            const cardEl = target.closest('.movie-card-component, .featured-card') || target;
            const movieId = target.getAttribute('data-movie-id') || cardEl.getAttribute('data-movie-id') || '';
            const titleEl = cardEl.querySelector('.mc-title, .featured-title, .card-title');
            const title = target.getAttribute('data-movie-title') || cardEl.getAttribute('data-movie-title')
                || titleEl?.textContent?.trim() || target.getAttribute('title') || target.getAttribute('alt') || 'Unknown';
            const alternativeName = target.getAttribute('data-movie-original-title')
                || cardEl.getAttribute('data-movie-original-title') || '';
            const year = target.getAttribute('data-movie-year') || cardEl.getAttribute('data-movie-year') || '';
            const tmdbId = target.getAttribute('data-tmdb-id') || cardEl.getAttribute('data-tmdb-id') || '';
            const mediaType = target.getAttribute('data-media-type') || cardEl.getAttribute('data-media-type') || 'movie';
            const isTmdbOnly = target.getAttribute('data-is-tmdb-only') === 'true'
                || cardEl.getAttribute('data-is-tmdb-only') === 'true';
            const hasValidId = movieId && movieId !== 'null' && movieId !== 'undefined' && movieId !== '';

            return { target, cardEl, movieId: hasValidId ? movieId : null, tmdbId, title, alternativeName, year, mediaType, isTmdbOnly };
        }

        async function _resolveAndOpen(info, newTab = false, targetWindow = null) {
            if (info.movieId) {
                const routeOptions = info.isTmdbOnly ? {
                    tmdbId: info.tmdbId,
                    mediaType: info.mediaType,
                    source: 'home-tmdb-only',
                    title: info.title,
                    year: info.year
                } : {};
                if (targetWindow) routeOptions.targetWindow = targetWindow;
                Utils.openMoviePage(info.movieId, newTab, routeOptions);
                return;
            }
            if (info.isTmdbOnly) {
                Utils.openMovieResolutionPage(info, newTab, targetWindow);
                return;
            }
            if (typeof options.resolveMovie !== 'function') return;

            console.log('[MovieCardNavigation] Resolving TMDB-only card through Kinopoisk HTML:', {
                tmdbId: info.tmdbId,
                title: info.title,
                year: info.year,
                mediaType: info.mediaType
            });

            const resolved = await options.resolveMovie(info);
            const resolvedId = resolved?.kinopoiskId || resolved?.movieId || resolved;
            if (!resolvedId) {
                if (targetWindow && !targetWindow.closed) targetWindow.close();
                if (typeof options.onResolveFailure === 'function') {
                    options.onResolveFailure(info);
                }
                return;
            }

            info.cardEl.setAttribute('data-movie-id', String(resolvedId));
            info.target.setAttribute('data-movie-id', String(resolvedId));
            info.target.setAttribute('href', chrome.runtime.getURL(
                `src/pages/movie-details/movie-details.html?movieId=${encodeURIComponent(resolvedId)}${info.tmdbId ? `&tmdbId=${encodeURIComponent(info.tmdbId)}` : ''}`
            ));
            console.log('[MovieCardNavigation] TMDB-only card resolved:', {
                tmdbId: info.tmdbId,
                title: info.title,
                kinopoiskId: resolvedId
            });
            Utils.openMoviePage(resolvedId, newTab, {
                tmdbId: info.tmdbId,
                mediaType: info.mediaType,
                source: 'home-tmdb-only',
                title: info.title,
                year: info.year,
                targetWindow
            });
        }

        // Left-click handler
        container.addEventListener('click', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.mc-menu-btn') || e.target.closest('.mc-menu-dropdown')) return;

            const info = _extractCardInfo(e);
            if (!info || (!info.movieId && !info.isTmdbOnly && typeof options.resolveMovie !== 'function')) return;

            e.preventDefault();

            console.log('[MovieCardNavigation] Card clicked (LKM):', {
                title: info.title,
                movieId: info.movieId,
                href: info.target.getAttribute('href')
            });

            _resolveAndOpen(info, false).catch(error => {
                console.warn('[MovieCardNavigation] TMDB-only card resolution failed:', error);
            });
        });

        // Middle-click handler
        container.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            if (e.target.closest('.mc-menu-btn') || e.target.closest('.mc-menu-dropdown')) return;

            const info = _extractCardInfo(e);
            if (!info || (!info.movieId && !info.isTmdbOnly && typeof options.resolveMovie !== 'function')) return;

            e.preventDefault();

            // Reserve the tab during the trusted user gesture. The actual
            // destination is known only after the asynchronous HTML lookup.
            const targetWindow = window.open('about:blank', '_blank');

            console.log('[MovieCardNavigation] Card clicked (Middle-Click):', {
                title: info.title,
                movieId: info.movieId,
                href: info.target.getAttribute('href')
            });

            _resolveAndOpen(info, true, targetWindow).catch(error => {
                if (targetWindow && !targetWindow.closed) targetWindow.close();
                console.warn('[MovieCardNavigation] TMDB-only middle-click resolution failed:', error);
            });
        });

    }

    /**
     * Extract a YouTube video ID and optional start time from a public URL.
     *
     * The parser intentionally accepts only known YouTube hosts and URL shapes;
     * arbitrary URLs containing the word "youtube" must remain ordinary links.
     * @param {string} value - Raw or HTML-escaped URL
     * @returns {{id: string, startSeconds: number}|null}
     */
    static extractYouTubeVideoInfo(value) {
        if (typeof value !== 'string' || !value.trim()) return null;

        const normalized = value
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .trim()
            .replace(/[),.;!?]+$/, '');

        let url;
        try {
            url = new URL(normalized);
        } catch {
            return null;
        }

        const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
        const allowedHosts = new Set(['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com']);
        if (!allowedHosts.has(hostname)) return null;

        const pathParts = url.pathname.split('/').filter(Boolean);
        let id = '';

        if (hostname === 'youtu.be') {
            id = pathParts[0] || '';
        } else if (pathParts[0] === 'watch') {
            id = url.searchParams.get('v') || '';
        } else if (['embed', 'live', 'shorts', 'v', 'e'].includes(pathParts[0])) {
            id = pathParts[1] || '';
        }

        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;

        const timeValue = url.searchParams.get('start') || url.searchParams.get('t') || '';
        let startSeconds = 0;
        if (/^\d+$/.test(timeValue)) {
            startSeconds = Number.parseInt(timeValue, 10);
        } else {
            const timeMatch = timeValue.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
            if (timeMatch && timeMatch[0]) {
                startSeconds = (Number.parseInt(timeMatch[1] || '0', 10) * 3600)
                    + (Number.parseInt(timeMatch[2] || '0', 10) * 60)
                    + Number.parseInt(timeMatch[3] || '0', 10);
            }
        }

        return {
            id,
            startSeconds: Number.isSafeInteger(startSeconds) && startSeconds > 0 ? startSeconds : 0
        };
    }

    /**
     * Преобразует ссылки в тексте в кликабельные HTML-теги <a>
     * @param {string} text - Исходный текст (уже экранированный HTML)
     * @returns {string} - Текст с кликабельными ссылками
     */
    static linkify(text) {
        if (!text) return '';
        // Регулярное выражение для поиска URL (http, https)
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        return text.replace(urlRegex, (url) => {
            const youtubeInfo = Utils.extractYouTubeVideoInfo(url);
            const youtubeClass = youtubeInfo ? ' chat-link--youtube' : '';
            const youtubeDataAttrs = youtubeInfo
                ? ` data-youtube-id="${Utils.escapeHtml(youtubeInfo.id)}"${youtubeInfo.startSeconds ? ` data-youtube-start="${youtubeInfo.startSeconds}"` : ''}`
                : '';

            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link${youtubeClass}"${youtubeDataAttrs} style="color: #667eea; text-decoration: underline;">${url}</a>`;
        });
    }

    /**
     * Парсинг спойлеров в тексте (Discord-style ||текст||)
     * @param {string} text - Текст с тегами спойлера
     * @returns {string} - HTML со спойлерами
     */
    static parseSpoilers(text) {
        if (!text) return '';
        return text.replace(/\|\|(.*?)\|\|/g, (match, p1) => {
            return `<span class="spoiler-text" title="Click to show spoiler">${p1}</span>`;
        });
    }

    /**
     * Навесить делегирование раскрытия спойлеров на контейнер
     * @param {HTMLElement|Document} container
     */
    static bindSpoilerReveal(container) {
        if (!container || container._spoilerBound) return;
        container._spoilerBound = true;
        container.addEventListener('click', (e) => {
            const spoiler = e.target.closest('.spoiler-text');
            if (spoiler && !spoiler.classList.contains('revealed')) {
                spoiler.classList.add('revealed');
            }
        });
    }

    /**
     * Обработчик ошибки загрузки постера — подставляет fallback
     * @param {HTMLImageElement} img - Элемент изображения
     * @param {string} fallback - Путь к fallback изображению
     */
    static handlePosterError(img, fallback = '/src/shared/assets/icons/app/icon128-black.png') {
        if (!img) return;
        img.onerror = null; // предотвращаем бесконечную рекурсию
        img.src = fallback;
    }

    /**
     * Get a parameter from the URL
     * @param {string} param - Parameter name
     * @returns {string|null}
     */
    static getUrlParam(param) {
        return new URLSearchParams(window.location.search).get(param);
    }

    /**
     * Управление состояниями страницы (loader / error / content)
     * @param {Object} els - { loader, errorScreen, errorMessage, contentContainer }
     */
    static createPageStateManager(els) {
        return {
            showLoader() {
                if (window.errorDialog) window.errorDialog.hide();
                if (els.loader)           els.loader.style.display = 'flex';
                if (els.errorScreen)      els.errorScreen.style.display = 'none';
                if (els.contentContainer) els.contentContainer.style.display = 'none';
            },
            hideLoader() {
                if (els.loader) els.loader.style.display = 'none';
            },
            showContent() {
                if (window.errorDialog) window.errorDialog.hide();
                if (els.loader)           els.loader.style.display = 'none';
                if (els.errorScreen)      els.errorScreen.style.display = 'none';
                if (els.contentContainer) els.contentContainer.style.display = '';
            },
            showError(error, options = {}) {
                if (els.loader)           els.loader.style.display = 'none';
                if (els.contentContainer) els.contentContainer.style.display = 'none';
                if (window.errorDialog?.show) {
                    window.errorDialog.show(error, {
                        ...options,
                        onRetry: options.onRetry || els.onRetry,
                        onBack: options.onBack || els.onBack
                    });
                    if (els.errorScreen) els.errorScreen.style.display = 'none';
                    return;
                }
                if (els.errorScreen)      els.errorScreen.style.display = 'flex';
                if (els.errorMessage)     els.errorMessage.textContent = error || 'Unknown error';
            }
        };
    }

    /**
     * Универсальный делегат для табов и меню
     * @param {HTMLElement} rootEl - Корень для делегации (обычно document)
     */
    static bindTabsAndMenus(rootEl) {
        rootEl.addEventListener('mousedown', (e) => {
            // Табы
            const tabBtn = e.target.closest('.tab-btn');
            if (tabBtn) {
                const tabName = tabBtn.dataset.tab;
                const container = tabBtn.closest('.tabs-container') || document;
                
                container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                tabBtn.classList.add('active');
                
                container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
                const pane = container.querySelector(`#tab-${tabName}`);
                if (pane) pane.classList.add('active');
                return;
            }

            // Меню (Dropdowns)
            const menuBtn = e.target.closest('.mc-menu-btn');
            if (menuBtn) {
                e.stopPropagation();
                const menu = menuBtn.nextElementSibling;
                if (menu?.classList.contains('mc-menu-dropdown')) {
                    document.querySelectorAll('.mc-menu-dropdown.active').forEach(m => {
                        if (m !== menu) m.classList.remove('active');
                    });
                    menu.classList.toggle('active');
                }
                return;
            }

            // Закрытие меню при клике вне
            if (!e.target.closest('.mc-menu-dropdown')) {
                rootEl.querySelectorAll('.mc-menu-dropdown.active').forEach(m => m.classList.remove('active'));
            }
        });

        rootEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                rootEl.querySelectorAll('.mc-menu-dropdown.active').forEach(m => m.classList.remove('active'));
            }
        });
    }

    /**
     * Синхронизация состояния кнопок действий (Favorite / Watchlist)
     * @param {HTMLElement} btn - Элемент кнопки
     * @param {boolean} isActive - Активно ли состояние
     * @param {Object} labels - { active: '...', inactive: '...' }
     * @param {Object} icons - { active: '...', inactive: '...' }
     */
    static toggleActionButton(btn, isActive, labels = {}, icons = {}) {
        if (!btn) return;
        
        btn.classList.toggle('active', isActive);
        btn.setAttribute('data-active', isActive);
        
        const textEl = btn.querySelector('.mc-menu-item-text') || btn;
        if (labels.active && labels.inactive) {
            textEl.textContent = isActive ? labels.active : labels.inactive;
        }

        const iconEl = btn.querySelector('svg, i');
        if (iconEl && icons.active && icons.inactive) {
            iconEl.outerHTML = isActive ? icons.active : icons.inactive;
        }
    }
}

// Automatically apply the global interceptor to the document IF we are in an extension page
if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.location.protocol === 'chrome-extension:') {
    Utils.enforceLeftClickOnly(document);
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
} else {
    window.Utils = Utils;
}
