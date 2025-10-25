/**
 * KinopoiskService - Service for interacting with Kinopoisk API
 * Handles movie search and detailed movie information retrieval
 */
class KinopoiskService {
    constructor() {
        this.baseUrl = KINOPOISK_CONFIG.BASE_URL;
        this.apiKey = KINOPOISK_CONFIG.API_KEY;
        this.defaultLimit = KINOPOISK_CONFIG.DEFAULT_LIMIT;
    }

    /**
     * Search for movies by query
     * @param {string} query - Search query
     * @param {number} page - Page number (default: 1)
     * @param {number} limit - Results per page (default: 20)
     * @returns {Promise<Object>} - Search results
     */
    async searchMovies(query, page = 1, limit = this.defaultLimit) {
        try {
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.SEARCH}`;
            const params = new URLSearchParams({
                query: query,
                page: page.toString(),
                limit: limit.toString(),
                sortField: 'name', // Sort by name first
                sortType: '1' // Ascending order for alphabetical sorting
            });

            const response = await fetch(`${url}?${params}`, {
                method: 'GET',
                headers: {
                    'X-API-KEY': this.apiKey,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return this.normalizeSearchResults(data, query);
        } catch (error) {
            console.error('Error searching movies:', error);
            throw new Error(`Failed to search movies: ${error.message}`);
        }
    }

    /**
     * Get detailed movie information by ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Object>} - Movie details
     */
    async getMovieById(movieId) {
        try {
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.MOVIE}/${movieId}`;
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'X-API-KEY': this.apiKey,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return this.normalizeMovieData(data);
        } catch (error) {
            console.error('Error getting movie details:', error);
            throw new Error(`Failed to get movie details: ${error.message}`);
        }
    }

    /**
     * Normalize search results to consistent format
     * @param {Object} data - Raw API response
     * @param {string} query - Original search query
     * @returns {Object} - Normalized search results
     */
    normalizeSearchResults(data, query = '') {
        let movies = data.docs ? data.docs.map(movie => this.normalizeMovieData(movie)) : [];
        
        // Sort by relevance: exact name match first, then by popularity
        if (query) {
            movies = this.sortMoviesByRelevance(movies, query);
        }
        
        return {
            docs: movies,
            total: data.total || 0,
            page: data.page || 1,
            limit: data.limit || this.defaultLimit,
            pages: data.pages || 1
        };
    }

    /**
     * Sort movies by relevance: exact name match first, then by popularity
     * @param {Array} movies - Array of movies
     * @param {string} query - Search query
     * @returns {Array} - Sorted movies
     */
    sortMoviesByRelevance(movies, query) {
        const queryLower = query.toLowerCase().trim();
        
        return movies.sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            
            // Exact match gets highest priority
            const aExactMatch = aName === queryLower;
            const bExactMatch = bName === queryLower;
            
            if (aExactMatch && !bExactMatch) return -1;
            if (!aExactMatch && bExactMatch) return 1;
            
            // Starts with query gets second priority
            const aStartsWith = aName.startsWith(queryLower);
            const bStartsWith = bName.startsWith(queryLower);
            
            if (aStartsWith && !bStartsWith) return -1;
            if (!aStartsWith && bStartsWith) return 1;
            
            // Contains query gets third priority
            const aContains = aName.includes(queryLower);
            const bContains = bName.includes(queryLower);
            
            if (aContains && !bContains) return -1;
            if (!aContains && bContains) return 1;
            
            // Finally sort by popularity (votes.kp) descending
            const aVotes = a.votes?.kp || 0;
            const bVotes = b.votes?.kp || 0;
            
            return bVotes - aVotes;
        });
    }

    /**
     * Normalize movie data to consistent format
     * @param {Object} movie - Raw movie data from API
     * @returns {Object} - Normalized movie data
     */
    normalizeMovieData(movie) {
        // Process poster URL to ensure it's valid
        let posterUrl = movie.poster?.url || movie.posterUrl || '';
        if (posterUrl && !posterUrl.startsWith('http')) {
            posterUrl = '';
        }
        
        return {
            kinopoiskId: movie.id || movie.kinopoiskId,
            name: movie.name || movie.title || 'Unknown Title',
            alternativeName: movie.alternativeName || movie.alternativeTitle || '',
            posterUrl: posterUrl,
            year: movie.year || 0,
            kpRating: movie.rating?.kp || movie.kpRating || 0,
            imdbRating: movie.rating?.imdb || movie.imdbRating || 0,
            description: movie.description || movie.shortDescription || '',
            genres: movie.genres?.map(g => g.name) || movie.genre || [],
            countries: movie.countries?.map(c => c.name) || movie.country || [],
            duration: movie.movieLength || movie.duration || 0,
            ageRating: movie.ageRating || 0,
            type: movie.type || 'movie',
            votes: {
                kp: movie.votes?.kp || 0,
                imdb: movie.votes?.imdb || 0
            },
            // Additional fields for caching
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Check if API key is configured
     * @returns {boolean} - True if API key is set
     */
    isConfigured() {
        return this.apiKey && this.apiKey !== 'YOUR_KINOPOISK_API_KEY_HERE';
    }

    /**
     * Get API usage statistics (if available)
     * @returns {Object} - API usage info
     */
    getApiInfo() {
        return {
            baseUrl: this.baseUrl,
            configured: this.isConfigured(),
            endpoints: KINOPOISK_CONFIG.ENDPOINTS
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KinopoiskService;
} else {
    window.KinopoiskService = KinopoiskService;
}