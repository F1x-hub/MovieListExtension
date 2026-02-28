/**
 * SequelsParsingService - Parses movie sequels and prequels from kinopoisk.ru
 * Used as a fallback when API images fail to load
 */
class SequelsParsingService {
    constructor() {
        this.baseUrl = 'https://www.kinopoisk.ru';
        this.cacheDuration = 24 * 60 * 60 * 1000; // 24 hours
        this.storageKey = 'kp_sequels_cache_v2_';
    }

    /**
     * Get sequels for a movie by kinopoisk ID
     * @param {number|string} movieId - Kinopoisk movie ID
     * @returns {Promise<Array>} - Array of sequel objects with posters
     */
    async getSequels(movieId, isSeries = false) {
        try {
            // Check cache first
            const cached = this.getFromCache(movieId);
            if (cached) {
                console.log(`[SequelsParser] Returning cached sequels for ${movieId}`);
                return cached;
            }

            const url = `${this.baseUrl}/${isSeries ? 'series' : 'film'}/${movieId}/`;
            console.log('Parsing sequels from:', url);

            const response = await fetch(url);
            
            if (!response.ok) {
                console.warn(`[SequelsParser] ❌ Failed to load movie page: ${response.status}`);
                return [];
            }

            const html = await response.text();
            const sequels = this.parseMoviePage(html);
            
            if (sequels && sequels.length > 0) {
                this.saveToCache(movieId, sequels);
            }
            
            return sequels;

        } catch (error) {
            console.error('SequelsParsingService error:', error);
            return [];
        }
    }

    /**
     * Parse movie page HTML to extract sequels section
     * @param {string} html - Movie page HTML
     * @returns {Array} - Array of { id, title, year, posterUrl }
     */
    parseMoviePage(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const sequels = [];

        // Try to find the section by data-tid (most reliable if KP hasn't changed it)
        // Or look for the header "Сиквелы и приквелы"
        let section = doc.querySelector('[data-tid="326c794f"]'); // This is the container tid provided by user
        
        // Fallback: search by header text if selector fails
        if (!section) {
            const headers = Array.from(doc.querySelectorAll('h3, h2, div'));
            const header = headers.find(h => h.textContent.includes('Сиквелы и приквелы') || h.textContent.includes('Sequels and Prequels'));
            if (header) {
                // The section usually follows the header or is the parent
                section = header.closest('section') || header.parentElement;
            }
        }

        if (!section) {
            console.log('[SequelsParser] No sequels section found');
            return [];
        }

        // Find all movie items in the section
        // Kinopoisk list items usually have specific structures
        const items = section.querySelectorAll('li, div[data-tid="d4e8d214"], .styles_root__3a8_k'); // Common selectors, might need adjustment

        // If specific selectors fail, try a more generic approach within the section
        const candidateItems = items.length > 0 ? items : section.querySelectorAll('a[href^="/film/"], a[href^="/series/"]');

        candidateItems.forEach(item => {
            try {
                // It might be a direct link or a container
                const link = item.tagName === 'A' ? item : item.querySelector('a[href^="/film/"], a[href^="/series/"]');
                if (!link) return;

                const href = link.getAttribute('href');
                const idMatch = href.match(/\/(?:film|series)\/(\d+)\//);
                if (!idMatch) return;
                
                const id = parseInt(idMatch[1]);
                const title = link.getAttribute('aria-label') || link.querySelector('img')?.getAttribute('alt') || link.textContent.trim();
                
                // Extract poster
                const img = link.querySelector('img');
                let posterUrl = null;
                if (img) {
                    posterUrl = img.getAttribute('src') || img.getAttribute('data-src');
                    // Ensure valid protocol
                    if (posterUrl && posterUrl.startsWith('//')) {
                        posterUrl = 'https:' + posterUrl;
                    }
                }

                // Extract year if available (often in a separate span or part of text)
                let year = null;
                const yearEl = item.querySelector('.year, span[class*="year"]'); // Generic guess
                if (yearEl) {
                    year = parseInt(yearEl.textContent.trim());
                } else {
                    // Try to find 4 digits in text content
                    const text = item.textContent;
                    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
                    if (yearMatch) year = parseInt(yearMatch[0]);
                }

                if (id && posterUrl) {
                    sequels.push({
                        id,
                        title,
                        year,
                        posterUrl
                    });
                }
            } catch (e) {
                console.warn('[SequelsParser] Error parsing item', e);
            }
        });

        console.log(`[SequelsParser] Found ${sequels.length} sequels`);
        return sequels;
    }

    saveToCache(movieId, data) {
        try {
            const cacheEntry = {
                timestamp: Date.now(),
                data: data
            };
            localStorage.setItem(this.storageKey + movieId, JSON.stringify(cacheEntry));
        } catch (e) {
            console.warn('Failed to save sequels to cache', e);
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

            // Sanitize URLs from cache just in case
            if (cacheEntry.data && Array.isArray(cacheEntry.data)) {
                cacheEntry.data.forEach(item => {
                    if (item.posterUrl && item.posterUrl.startsWith('//')) {
                        item.posterUrl = 'https:' + item.posterUrl;
                    }
                });
            }

            return cacheEntry.data;
        } catch (e) {
            return null;
        }
    }
}

// Export as global
if (typeof window !== 'undefined') {
    window.SequelsParsingService = SequelsParsingService;
}
