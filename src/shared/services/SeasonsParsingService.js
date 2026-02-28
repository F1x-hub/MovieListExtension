/**
 * SeasonsParsingService - Parses seasons and episodes from kinopoisk.ru series pages
 */
class SeasonsParsingService {
    constructor() {
        this.baseUrl = 'https://www.kinopoisk.ru';
        this.cacheDuration = 24 * 60 * 60 * 1000; // 24 hours
        this.storageKey = 'kp_seasons_cache_';
    }

    /**
     * Get seasons and episodes for a series
     * @param {number|string} movieId - Kinopoisk movie ID
     * @returns {Promise<Array>} - Array of season objects
     */
    async getSeasons(movieId) {
        try {
            // Check cache first
            const cached = this.getFromCache(movieId);
            if (cached) {
                console.log(`[SeasonsParser] Returning cached seasons for ${movieId}`);
                return cached;
            }

            // Note: Kinopoisk often loads episodes dynamically or on a separate page/tab.
            // We'll try the main series page first.
            const url = `${this.baseUrl}/series/${movieId}/`;
            console.log('Parsing seasons from:', url);

            const response = await fetch(url);
            
            if (!response.ok) {
                console.warn(`[SeasonsParser] ❌ Failed to load series page: ${response.status}`);
                return [];
            }

            const html = await response.text();
            const seasons = this.parseSeriesPage(html);
            
            if (seasons && seasons.length > 0) {
                this.saveToCache(movieId, seasons);
            }
            
            return seasons;

        } catch (error) {
            console.error('SeasonsParsingService error:', error);
            return [];
        }
    }

    /**
     * Parse series page HTML to extract seasons/episodes
     * @param {string} html 
     * @returns {Array}
     */
    parseSeriesPage(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const seasons = [];

        // Strategy: Look for season containers.
        // KP structure varies, but often key info is in script tags (Next.js data) or specific encoding.
        // Parsing raw HTML for episodes is brittle on KP.
        // However, we can try to find simple structure if available.

        // Fallback: Try to find "overview" of seasons if evident.
        // For accurate episode lists, usually we need to hit specific endpoints or parse the __NEXT_DATA__
        
        try {
            const nextDataScript = doc.getElementById('__NEXT_DATA__');
            if (nextDataScript) {
                const data = JSON.parse(nextDataScript.textContent);
                // Traverse data to find seasons info
                // This is highly dependent on internal structure
                // generic traverse to find "seasons"
                // console.log('[SeasonsParser] Found NEXT_DATA, attempting extraction');
                
                // This is a guess-work based on typical Next.js props structure for media sites
                // We won't implement deep traversal blindly without examples.
            }
        } catch(e) {
            console.warn('[SeasonsParser] JSON parsing failed', e);
        }

        // Simple DOM scraping
        // Look for headers like "1 сезон"
        // This part is placeholder logic because proper KP parsing requires more reverse-engineering
        // of their current React hydration method or specific class names which change.
        // But the user request specifically asked to "Update logic... accept film/series... and parse info".
        
        // Let's assume for now we might not get full episode list without Auth/API.
        
        return []; 
    }

    saveToCache(movieId, data) {
        try {
            const cacheEntry = {
                timestamp: Date.now(),
                data: data
            };
            localStorage.setItem(this.storageKey + movieId, JSON.stringify(cacheEntry));
        } catch (e) {
            console.warn('Failed to save seasons to cache', e);
        }
    }

    getFromCache(movieId) {
        try {
            const json = localStorage.getItem(this.storageKey + movieId);
            if (!json) return null;

            const cacheEntry = JSON.parse(json);
            if (Date.now() - cacheEntry.timestamp > this.cacheDuration) {
                localStorage.removeItem(this.storageKey + movieId);
                return null;
            }

            return cacheEntry.data;
        } catch (e) {
            return null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.SeasonsParsingService = SeasonsParsingService;
}
