/**
 * AniskipService - Service for fetching anime opening skip times
 * Uses MyAnimeList for anime identification and AniSkip API for timestamps
 */
class AniskipService {
    constructor() {
        this.aniskipApiUrl = 'https://api.aniskip.com/v1';
        this.malSearchUrl = 'https://myanimelist.net/anime.php';
        this.cacheKeyPrefix = 'aniskip_mal_id_';
        this.skipTimesCachePrefix = 'aniskip_times_';
        this.cacheDuration = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
    }

    /**
     * Calculate Levenshtein distance between two strings
     * @param {string} a - First string
     * @param {string} b - Second string
     * @returns {number} - Levenshtein distance
     */
    levenshteinDistance(a, b) {
        if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
        
        const matrix = [];
        
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        
        return matrix[b.length][a.length];
    }

    /**
     * Calculate similarity percentage between two strings
     * @param {string} a - First string
     * @param {string} b - Second string
     * @returns {number} - Similarity percentage (0-100)
     */
    calculateSimilarity(a, b) {
        if (!a || !b) return 0;
        
        const normalizedA = a.toLowerCase().trim();
        const normalizedB = b.toLowerCase().trim();
        
        if (normalizedA === normalizedB) return 100;
        
        const maxLen = Math.max(normalizedA.length, normalizedB.length);
        if (maxLen === 0) return 100;
        
        const distance = this.levenshteinDistance(normalizedA, normalizedB);
        return ((maxLen - distance) / maxLen) * 100;
    }

    /**
     * Normalize anime title for comparison
     * @param {string} title - Anime title
     * @returns {string} - Normalized title
     */
    normalizeTitle(title) {
        if (!title) return '';
        
        return title
            .toLowerCase()
            .replace(/[.:!?'"()[\]{}]/g, '')     // Remove punctuation
            .replace(/\s+/g, ' ')                 // Normalize whitespace
            .replace(/\bseason\b/gi, '')          // Remove "season"
            .replace(/\bpart\b/gi, '')            // Remove "part"
            .replace(/\d+(st|nd|rd|th)/gi, '')    // Remove ordinals
            .trim();
    }

    /**
     * Get cached MAL ID for an anime title
     * @param {string} title - Anime title
     * @returns {number|null} - MAL ID or null if not cached
     */
    getCachedMALId(title) {
        try {
            const key = this.cacheKeyPrefix + this.normalizeTitle(title);
            const cached = localStorage.getItem(key);
            if (!cached) return null;
            
            const data = JSON.parse(cached);
            if (Date.now() - data.timestamp > this.cacheDuration) {
                localStorage.removeItem(key);
                return null;
            }
            
            return data.malId;
        } catch (e) {
            console.warn('[AniskipService] Cache read error:', e);
            return null;
        }
    }

    /**
     * Cache MAL ID for an anime title
     * @param {string} title - Anime title
     * @param {number} malId - MAL ID
     */
    cacheMALId(title, malId) {
        try {
            const key = this.cacheKeyPrefix + this.normalizeTitle(title);
            localStorage.setItem(key, JSON.stringify({
                malId: malId,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('[AniskipService] Cache write error:', e);
        }
    }

    /**
     * Search MyAnimeList for an anime and find the best match
     * @param {string} title - Anime title to search
     * @param {number} episodesCount - Expected episode count for validation
     * @param {number|null} releaseYear - Expected release year for validation
     * @returns {Promise<number|null>} - MAL ID or null if not found
     */
    async searchMAL(title, episodesCount = null, releaseYear = null) {
        console.log(`[AniskipService] Searching MAL for: "${title}" (episodes: ${episodesCount}, year: ${releaseYear})`);
        
        // Check cache first
        const cachedId = this.getCachedMALId(title);
        if (cachedId) {
            console.log(`[AniskipService] Found cached MAL ID: ${cachedId}`);
            return cachedId;
        }

        try {
            const searchUrl = `${this.malSearchUrl}?q=${encodeURIComponent(title)}&cat=anime`;
            const response = await fetch(searchUrl);
            
            if (!response.ok) {
                console.warn(`[AniskipService] MAL search failed: ${response.status}`);
                return null;
            }

            const html = await response.text();
            const results = this.parseMALSearchResults(html);
            
            if (results.length === 0) {
                console.log('[AniskipService] No results found on MAL');
                return null;
            }

            console.log(`[AniskipService] Found ${results.length} results on MAL`);

            // Find best match using fuzzy matching and year comparison
            const match = this.findBestMatch(title, results, episodesCount, releaseYear);
            
            if (match) {
                console.log(`[AniskipService] Best match: "${match.title}" (MAL ID: ${match.malId}, similarity: ${match.similarity.toFixed(1)}%)`);
                this.cacheMALId(title, match.malId);
                return match.malId;
            }

            console.log('[AniskipService] No suitable match found');
            return null;

        } catch (error) {
            console.error('[AniskipService] MAL search error:', error);
            return null;
        }
    }

    /**
     * Parse MAL search results from HTML
     * @param {string} html - HTML content from MAL search page
     * @returns {Array<{title: string, malId: number, episodes: number|null, type: string}>}
     */
    parseMALSearchResults(html) {
        const results = [];
        
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Find anime rows in search results
            // MAL uses table with class "js-block-list" or similar structure
            const rows = doc.querySelectorAll('table tr');
            
            for (const row of rows) {
                // Find the title link
                // Priority 1: Link inside .title class
                let titleLink = row.querySelector('.title a[href*="/anime/"]');
                
                // Priority 2: Any link with /anime/ that has text content
                if (!titleLink) {
                    const links = row.querySelectorAll('a[href*="/anime/"]');
                    for (const link of links) {
                        if (link.textContent.trim().length > 0) {
                            titleLink = link;
                            break;
                        }
                    }
                }

                if (!titleLink) continue;
                
                const href = titleLink.getAttribute('href');
                const malIdMatch = href.match(/\/anime\/(\d+)/);
                if (!malIdMatch) continue;
                
                const malId = parseInt(malIdMatch[1], 10);
                const title = titleLink.textContent.trim();
                
                // Try to find episode count
                let episodes = null;
                const episodesCell = row.querySelector('td.eps, td:nth-child(4)');
                if (episodesCell) {
                    const epsText = episodesCell.textContent.trim();
                    const epsMatch = epsText.match(/(\d+)/);
                    if (epsMatch) {
                        episodes = parseInt(epsMatch[1], 10);
                    }
                }

                // Try to find type (TV, Movie, OVA, etc.)
                let type = 'TV';
                const typeCell = row.querySelector('td.type, td:nth-child(3)');
                if (typeCell) {
                    type = typeCell.textContent.trim();
                }

                // Try to find start date/year
                let year = null;
                
                // Strategy 1: Check hidden hoverinfo div (sinfo{malId})
                // User reported this contains "Title (YYYY)"
                const sinfo = doc.getElementById(`sinfo${malId}`);
                if (sinfo) {
                    const hoverTitle = sinfo.querySelector('.hovertitle');
                    if (hoverTitle) {
                        const titleText = hoverTitle.textContent.trim();
                        // Extract (YYYY) from end of title
                        const yearMatch = titleText.match(/\((\d{4})\)/);
                        if (yearMatch) {
                            year = parseInt(yearMatch[1], 10);
                        }
                    }
                }

                // Strategy 2: If no year found, check the 6th column (Start Date)
                if (!year) {
                    // Start date is usually in the 6th column or has specific formatting
                    const dateCell = row.querySelector('td:nth-child(6)');
                    if (dateCell) {
                        const dateText = dateCell.textContent.trim();
                        // Date formats: "Apr 9, 2022" or "2022" or "Oct, 2022"
                        // Extract 4 digits
                        const yearMatch = dateText.match(/(\d{4})/);
                        if (yearMatch) {
                            year = parseInt(yearMatch[1], 10);
                        }
                    }
                }
                
                results.push({ title, malId, episodes, type, year });
            }
        } catch (e) {
            console.error('[AniskipService] Error parsing MAL results:', e);
        }
        
        return results;
    }

    /**
     * Find the best matching anime from search results
     * @param {string} searchTitle - Original search title
     * @param {Array} results - MAL search results
     * @param {number|null} expectedEpisodes - Expected episode count
     * @param {number|null} releaseYear - Expected release year
     * @returns {Object|null} - Best match with similarity score, or null
     */
    findBestMatch(searchTitle, results, expectedEpisodes, releaseYear) {
        const SIMILARITY_THRESHOLD = 70; // 70% minimum similarity
        const normalizedSearch = this.normalizeTitle(searchTitle);
        
        let bestMatch = null;
        let bestScore = 0;

        for (const result of results) {
            const normalizedResult = this.normalizeTitle(result.title);
            let similarity = this.calculateSimilarity(normalizedSearch, normalizedResult);
            
            // Bonus points for episode count match
            if (expectedEpisodes && result.episodes) {
                if (result.episodes === expectedEpisodes) {
                    similarity = Math.min(100, similarity + 10); // +10% bonus for exact episode match
                } else if (Math.abs(result.episodes - expectedEpisodes) <= 2) {
                    similarity = Math.min(100, similarity + 5); // +5% bonus for close episode match
                }
            }

            // Bonus points for year match (crucial if episodes count is unknown/mismatch)
            if (releaseYear && result.year) {
                if (result.year === releaseYear) {
                    similarity = Math.min(100, similarity + 10); // +10% bonus for exact year match
                } else if (Math.abs(result.year - releaseYear) <= 1) {
                    similarity = Math.min(100, similarity + 5); // +5% bonus for +/- 1 year
                }
            }
            
            // Prefer TV series over movies/OVAs for series searches
            if (result.type === 'TV' && expectedEpisodes && expectedEpisodes > 1) {
                similarity = Math.min(100, similarity + 3);
            }
            
            if (similarity > bestScore) {
                bestScore = similarity;
                bestMatch = { ...result, similarity };
            }
        }

        // Return only if above threshold
        if (bestMatch && bestScore >= SIMILARITY_THRESHOLD) {
            return bestMatch;
        }

        return null;
    }

    /**
     * Get skip times from AniSkip API
     * @param {number} malId - MyAnimeList anime ID
     * @param {number} episodeNumber - Episode number
     * @returns {Promise<Object|null>} - Skip times or null
     */
    async getSkipTimes(malId, episodeNumber) {
        console.log(`[AniskipService] Fetching skip times for MAL ID: ${malId}, Episode: ${episodeNumber}`);
        
        // Check cache first
        const cacheKey = `${this.skipTimesCachePrefix}${malId}_${episodeNumber}`;
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                if (Date.now() - data.timestamp < this.cacheDuration) {
                    console.log('[AniskipService] Using cached skip times');
                    return data.skipTimes;
                }
            }
        } catch (e) {}

        try {
            const url = `${this.aniskipApiUrl}/skip-times/${malId}/${episodeNumber}?types=op`;
            const response = await fetch(url, {
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                console.warn(`[AniskipService] AniSkip API error: ${response.status}`);
                console.warn(`[SkipError] Episode ${episodeNumber} — no skip data from AniSkip (MAL: ${malId}, status: ${response.status})`);
                return null;
            }

            const data = await response.json();
            
            if (!data.found || !data.results || data.results.length === 0) {
                console.log('[AniskipService] No skip times found for this episode');
                console.warn(`[SkipError] Episode ${episodeNumber} — AniSkip returned empty results (MAL: ${malId}, found: ${data.found}, results: ${data.results?.length || 0})`);
                return null;
            }

            // Get the opening skip time (first result with skip_type === 'op')
            const opResult = data.results.find(r => r.skip_type === 'op');
            if (!opResult) {
                console.log('[AniskipService] No opening found in results');
                return null;
            }

            const skipTimes = {
                startTime: opResult.interval.start_time,
                endTime: opResult.interval.end_time,
                skipType: opResult.skip_type,
                episodeLength: opResult.episode_length
            };

            console.log(`[AniskipService] Opening: ${skipTimes.startTime}s - ${skipTimes.endTime}s`);

            // Cache the result
            try {
                localStorage.setItem(cacheKey, JSON.stringify({
                    skipTimes: skipTimes,
                    timestamp: Date.now()
                }));
            } catch (e) {}

            return skipTimes;

        } catch (error) {
            console.error('[AniskipService] Error fetching skip times:', error);
            return null;
        }
    }

    /**
     * Main entry point - get opening timestamps for an anime
     * @param {Object} movieData - Movie data from Kinopoisk API
     * @param {number} currentEpisode - Current episode number
     * @returns {Promise<Object|null>} - Skip times or null
     */
    async getOpeningTimestamps(movieData, currentEpisode = 1) {
        // Only works for anime type
        if (!movieData || movieData.type !== 'anime') {
            console.log('[AniskipService] Not an anime, skipping');
            return null;
        }

        // Prioritize alternative name (usually English) for MAL search as MAL requires English titles
        const title = movieData.alternativeName || movieData.name;
        if (!title) {
            console.log('[AniskipService] No title available');
            return null;
        }

        // Get episode count from seasonsInfo
        let episodesCount = null;
        if (movieData.seasonsInfo && movieData.seasonsInfo.length > 0) {
            // Sum up all episodes from all seasons, or just use first season
            episodesCount = movieData.seasonsInfo.reduce((sum, season) => 
                sum + (season.episodesCount || 0), 0);
        }

        // Search for MAL ID with year fallback
        const malId = await this.searchMAL(title, episodesCount, movieData.year);
        if (!malId) {
            console.log('[AniskipService] Could not find MAL ID');
            console.warn(`[SkipError] Could not find MAL ID for "${title}" (year: ${movieData.year}, episodes: ${episodesCount}) — skip button will not appear`);
            return null;
        }

        // Get skip times for the episode
        const skipTimes = await this.getSkipTimes(malId, currentEpisode);
        if (!skipTimes) {
            console.log('[AniskipService] No skip times available');
            console.warn(`[SkipError] Episode ${currentEpisode} — no skip times returned (MAL: ${malId}, title: "${title}")`);
            return null;
        }

        return {
            malId: malId,
            episodeNumber: currentEpisode,
            ...skipTimes
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AniskipService;
}
if (typeof window !== 'undefined') {
    window.AniskipService = AniskipService;
}
