/**
 * SimilarMoviesParsingService - Parses movie posters from kinopoisk.ru pages
 * Used to fetch high-quality posters for similar movies section
 */
class SimilarMoviesParsingService {
    constructor() {
        this.baseUrl = 'https://www.kinopoisk.ru';
        this.cacheDuration = 24 * 60 * 60 * 1000; // 24 hours
        this.storageKeyPrefix = 'poster_cache_';
        this.requestDelay = 300; // 300ms between requests
        this.maxConcurrent = 3; // Max concurrent requests
        this.activeRequests = 0;
        this.requestQueue = [];
    }

    /**
     * Get similar movies by parsing Kinopoisk website
     * @param {number|string} filmId - Kinopoisk movie ID
     * @returns {Promise<Array>} - Array of similar movies or empty array
     */
    async getSimilarMovies(filmId, isSeries = false) {
        try {
            // console.log(`[SimilarMoviesParser] Fetching similar movies from website for: ${filmId}`);
            
            // Fetch the movie page
            const section = isSeries ? 'series' : 'film';
            const response = await fetch(`${this.baseUrl}/${section}/${filmId}/`, {
                method: 'GET',
                headers: {
                    'Accept': 'text/html'
                }
            });

            if (!response.ok) {
                console.warn(`[SimilarMoviesParser] Failed to fetch page: ${response.status}`);
                return [];
            }

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Find the "Similar Movies" carousel items
            // We look for elements with role="listitem" inside the carousel container
            // The structure is complex and classes change, but the listitem role is fairly stable
            // Also looking for the header "Если вам понравился этот фильм" to be sure
            
            // Try to find the section first
            let carouselItems = [];
            const headers = Array.from(doc.querySelectorAll('h3, h2'));
            const similarHeader = headers.find(h => h.textContent.includes('Если вам понравился этот фильм'));
            
            if (similarHeader) {
                // Find the container following the header
                // It's usually in a section parent or sibling
                const section = similarHeader.closest('section') || similarHeader.parentElement;
                if (section) {
                    carouselItems = section.querySelectorAll('[role="listitem"]');
                }
            }
            
            // Fallback: search generally for the class pattern if specific section not found
            if (!carouselItems || carouselItems.length === 0) {
                 carouselItems = doc.querySelectorAll('.styles_carouselItem__GOTrF, [class*="styles_carouselItem"]');
            }

            if (!carouselItems || carouselItems.length === 0) {
                // console.log('[SimilarMoviesParser] No similar movies section found on page');
                return [];
            }

            const similarMovies = Array.from(carouselItems).map(item => {
                try {
                    // Extract ID from link
                    const link = item.querySelector('a[href^="/film/"], a[href^="/series/"]');
                    const href = link?.getAttribute('href');
                    const idMatch = href?.match(/\/(?:film|series)\/(\d+)\//);
                    const id = idMatch ? parseInt(idMatch[1]) : null;

                    if (!id) return null;

                    // Extract Title and Year
                    // Title is usually in the first text node of the caption or a specific span
                    const titleEl = item.querySelector('[class*="styles_title"] span span, [class*="styles_title"]');
                    const title = titleEl?.textContent.trim() || '';

                    // Year is usually in a subtitle class
                    const subtitleEl = item.querySelector('[class*="styles_subtitle"]');
                    const subtitle = subtitleEl?.textContent.trim() || '';
                    const yearMatch = subtitle.match(/(\d{4})/);
                    const year = yearMatch ? parseInt(yearMatch[1]) : 0;

                    // Poster
                    const img = item.querySelector('img');
                    let posterUrl = img?.getAttribute('src');
                    const srcset = img?.getAttribute('srcset');
                    
                    if (srcset) {
                        // formats like: url 1x, url 2x, etc.
                        // take the last one (highest resolution)
                        const sources = srcset.split(',').map(s => s.trim().split(' ')[0]);
                        if (sources.length > 0) {
                            posterUrl = sources[sources.length - 1];
                        }
                    }

                    if (posterUrl && !posterUrl.startsWith('http')) {
                        posterUrl = 'https:' + posterUrl;
                    }

                    // Rating
                    const ratingEl = item.querySelector('[class*="styles_rating"] span[aria-hidden="true"], [class*="styles_rating"]');
                    const rating = ratingEl ? parseFloat(ratingEl.textContent.trim()) : 0;

                    return {
                        kinopoiskId: id,
                        name: title,
                        originalName: '', // Usually not available in this view
                        year: year,
                        posterUrl: posterUrl,
                        kpRating: rating,
                        imdbRating: 0,
                        genres: [], // Not available in this view usually
                        countries: [], 
                        type: 'movie'
                    };
                } catch (e) {
                    console.warn('[SimilarMoviesParser] Error parsing item', e);
                    return null;
                }
            }).filter(m => m && m.kinopoiskId && m.name); // Filter invalid items

            // console.log(`[SimilarMoviesParser] Parsed ${similarMovies.length} similar movies`);
            return similarMovies;

        } catch (error) {
            console.error('[SimilarMoviesParser] Error getting similar movies:', error);
            return [];
        }
    }

    /**
     * Get poster URL for a single movie
     * @param {number|string} filmId - Kinopoisk movie ID
     * @returns {Promise<string|null>} - Poster URL or null if failed
     */
    async getPoster(filmId, isSeries = false) {
        try {
            // Check cache first
            const cached = this.getFromCache(filmId);
            if (cached) {
                console.log(`[SimilarMoviesParser] Cache hit for ${filmId}`);
                return cached;
            }

            // Fetch from page
            const posterUrl = await this.fetchPosterFromPage(filmId, isSeries);
            
            if (posterUrl) {
                this.saveToCache(filmId, posterUrl);
                return posterUrl;
            }

            return null;
        } catch (error) {
            console.warn(`[SimilarMoviesParser] Error getting poster for ${filmId}:`, error);
            return null;
        }
    }

    /**
     * Get posters for multiple movies with rate limiting
     * @param {Array} similarMovies - Array of similar movie objects from API
     * @returns {Promise<Map>} - Map of filmId -> posterUrl
     */
    async getPostersForMovies(similarMovies) {
        const results = new Map();
        
        if (!similarMovies || similarMovies.length === 0) {
            return results;
        }

        // console.log(`[SimilarMoviesParser] Processing ${similarMovies.length} similar movies`);

        // First, check cache for all movies
        const uncachedMovies = [];
        for (const movie of similarMovies) {
            const filmId = movie.id || movie.filmId || movie.kinopoiskId;
            if (!filmId) continue;

            const cached = this.getFromCache(filmId);
            if (cached) {
                console.log(`[SimilarMoviesParser] Cache hit for ${filmId}`);
                results.set(filmId, cached);
            } else {
                uncachedMovies.push({ ...movie, filmId });
            }
        }

        // console.log(`[SimilarMoviesParser] Found ${results.size} cached, ${uncachedMovies.length} need fetching`);

        // If all are cached, return immediately
        if (uncachedMovies.length === 0) {
            return results;
        }

        // Process only uncached movies with rate limiting
        const promises = uncachedMovies.map(async (movie) => {
            const filmId = movie.filmId;

            // Wait for queue slot
            await this.waitForSlot();
            
            try {
                const posterUrl = await this.fetchPosterFromPage(filmId, movie.type && ['tv-series', 'mini-series', 'animated-series'].includes(movie.type));
                if (posterUrl) {
                    this.saveToCache(filmId, posterUrl);
                    results.set(filmId, posterUrl);
                }
            } finally {
                this.releaseSlot();
            }

            // Add delay between requests
            await this.delay(this.requestDelay);
        });

        await Promise.all(promises);
        
        // console.log(`[SimilarMoviesParser] Total posters: ${results.size} out of ${similarMovies.length}`);
        return results;
    }

    /**
     * Fetch poster from Kinopoisk movie page
     * @param {number|string} filmId - Kinopoisk movie ID
     * @returns {Promise<string|null>} - Poster URL or null
     */
    /**
     * Fetch poster using KinopoiskService API
     * @param {number|string} filmId - Kinopoisk movie ID
     * @returns {Promise<string|null>} - Poster URL or null
     */
    async fetchPosterFromPage(filmId, isSeries = false) {
        try {
            // Get KinopoiskService instance
            let service = null;
            if (typeof firebaseManager !== 'undefined') {
                service = firebaseManager.getKinopoiskService();
            } else if (typeof KinopoiskService !== 'undefined') {
                // Fallback if not using firebaseManager (less likely in this app structure)
                service = new KinopoiskService();
            }

            if (!service) {
                console.warn('[SimilarMoviesParser] KinopoiskService not available, cannot fetch poster');
                return null;
            }

            // console.log(`[SimilarMoviesParser] Fetching poster via API for: ${filmId}`);
            
            // We use getMovieById to get the details including the poster
            // This consumes API quota but guarantees a valid result without CORS issues
            const movieData = await service.getMovieById(filmId);
            
            if (movieData && movieData.posterUrl) {
                return movieData.posterUrl;
            }
            
            return null;
        } catch (error) {
            console.warn(`[SimilarMoviesParser] API fetch error for ${filmId}:`, error);
            return null;
        }
    }

    /**
     * Parse poster URL from movie page HTML
     * @param {string} html - Movie page HTML
     * @returns {string|null} - Poster URL or null
     */
    /**
     * @deprecated HTML parsing is replaced by API calls. This method is kept as a placeholder or can be removed.
     */
    parsePosterFromPage(html) {
        return null;
    }

    /**
     * @deprecated
     */
    extractBestPosterUrl(img) {
        return null;
    }

    /**
     * Save poster URL to cache
     * @param {number|string} filmId - Film ID
     * @param {string} posterUrl - Poster URL
     */
    saveToCache(filmId, posterUrl) {
        try {
            const cacheEntry = {
                timestamp: Date.now(),
                url: posterUrl
            };
            localStorage.setItem(this.storageKeyPrefix + filmId, JSON.stringify(cacheEntry));
        } catch (e) {
            console.warn('[SimilarMoviesParser] Failed to save to cache:', e);
        }
    }

    /**
     * Get poster URL from cache
     * @param {number|string} filmId - Film ID
     * @returns {string|null} - Cached poster URL or null
     */
    getFromCache(filmId) {
        try {
            const json = localStorage.getItem(this.storageKeyPrefix + filmId);
            if (!json) return null;

            const cacheEntry = JSON.parse(json);
            
            // Check TTL
            if (Date.now() - cacheEntry.timestamp > this.cacheDuration) {
                localStorage.removeItem(this.storageKeyPrefix + filmId);
                return null;
            }

            // Ensure valid protocol
            let url = cacheEntry.url;
            if (url && url.startsWith('//')) {
                url = 'https:' + url;
            }

            return url;
        } catch (e) {
            return null;
        }
    }

    /**
     * Wait for available request slot
     * @returns {Promise<void>}
     */
    async waitForSlot() {
        return new Promise(resolve => {
            const tryAcquire = () => {
                if (this.activeRequests < this.maxConcurrent) {
                    this.activeRequests++;
                    resolve();
                } else {
                    this.requestQueue.push(tryAcquire);
                }
            };
            tryAcquire();
        });
    }

    /**
     * Release request slot
     */
    releaseSlot() {
        this.activeRequests--;
        if (this.requestQueue.length > 0) {
            const next = this.requestQueue.shift();
            next();
        }
    }

    /**
     * Delay helper
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export as global
if (typeof window !== 'undefined') {
    window.SimilarMoviesParsingService = SimilarMoviesParsingService;
}
