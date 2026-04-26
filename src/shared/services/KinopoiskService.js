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
     * Internal fetch method that automatically handles 403 API key rotation
     * @param {string} url - API URL
     * @param {Object} options - Fetch options
     * @returns {Promise<Response>} - Fetch response
     */
    async _fetchWithRotation(url, options = {}) {
        const maxAttempts = typeof KINOPOISK_CONFIG.API_KEYS !== 'undefined' 
            ? KINOPOISK_CONFIG.API_KEYS.length 
            : 1;
            
        let lastResponse = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const currentKey = typeof KINOPOISK_CONFIG.API_KEYS !== 'undefined' 
                ? KINOPOISK_CONFIG.API_KEY 
                : this.apiKey;
            
            const fetchOptions = { ...options };
            fetchOptions.headers = {
                ...options.headers,
                'X-API-KEY': currentKey,
                'Content-Type': 'application/json'
            };
            
            const response = await fetch(url, fetchOptions);
            lastResponse = response;

            if (response.status === 403 || response.status === 402) {
                console.warn(`KinopoiskService: ${response.status} Error with current key. Rotating to next key...`);
                if (typeof KINOPOISK_CONFIG.rotateKey === 'function') {
                    KINOPOISK_CONFIG.rotateKey();
                    this.apiKey = KINOPOISK_CONFIG.API_KEY;
                }
                
                if (attempt < maxAttempts - 1) {
                    continue;
                } // Else, fall through to return the failed response
            }
            
            return response;
        }

        return lastResponse;
    }

    /**
     * Search for movies by query
     * @param {string} query - Search query
     * @param {number} page - Page number (default: 1)
     * @param {number} limit - Results per page (default: 20)
     * @param {Object} filters - Optional filters object {yearFrom, yearTo, genresInclude, genresExclude, countriesInclude, countriesExclude}
     * @returns {Promise<Object>} - Search results
     */
    async searchMovies(query, page = 1, limit = this.defaultLimit, filters = null) {
        try {
            // Clean and normalize the query
            const cleanQuery = this.normalizeQuery(query);
            console.log(`KinopoiskService: Searching for "${query}" (normalized: "${cleanQuery}")`);
            
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.SEARCH}`;
            // NOTE: Do NOT add sortField/sortType here — that disables the API's built-in
            // relevance ranking (fuzzy match). Let the API rank by relevance naturally.
            const params = new URLSearchParams({
                query: cleanQuery,
                page: page.toString(),
                limit: limit.toString()
            });

            // Add year range filters if provided
            if (filters && filters.yearFrom) {
                params.append('year', `${filters.yearFrom}-${filters.yearTo || new Date().getFullYear()}`);
            }

            const fullUrl = `${url}?${params}`;
            console.log(`KinopoiskService: Request URL: ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, {
                method: 'GET'
            });

            console.log(`KinopoiskService: Response status: ${response.status}`);

            if (!response.ok) {
                // Check for daily limit reached (403 or 402 or 429)
                if (response.status === 403 || response.status === 402) {
                    const errorData = await response.json();
                    if (errorData.message && errorData.message.includes('суточный лимит')) {
                         if (typeof Utils !== 'undefined' && Utils.showToast) {
                            Utils.showToast('⚠️ Вы израсходовали ваш суточный лимит запросов. Обновите тариф или попробуйте завтра.', 'error', 5000);
                        }
                        throw new Error('DAILY_LIMIT_REACHED');
                    }
                }

                // Try alternative search strategies for failed requests
                if (response.status === 500 && this.hasCyrillic(query)) {
                    console.log('KinopoiskService: Trying alternative search for Cyrillic query...');
                    return await this.searchMoviesAlternative(query, page, limit);
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return this.normalizeSearchResults(data, query);
        } catch (error) {
            console.error('Error searching movies:', error);
            
            // Re-throw limit error to let caller handle it if needed, but we already showed toast
            if (error.message === 'DAILY_LIMIT_REACHED') {
                 // Return empty result to prevent crashing UI
                 return {
                    docs: [],
                    total: 0,
                    page: 1,
                    limit: limit,
                    pages: 0
                };
            }
            
            throw new Error(`Failed to search movies: ${error.message}`);
        }
    }

    /**
     * Get movies by filters (e.g. for similar movies fallback)
     * @param {Object} filters - Search filters
     * @param {number} page - Page number
     * @param {number} limit - Results limit
     * @returns {Promise<Object>} - Search results
     */
    async getMoviesByFilters(filters = {}, page = 1, limit = 10) {
        try {
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.MOVIE}`;
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                'votes.kp': '1000-10000000', // Ensure popular movies
                'poster.url': '!null', // Ensure poster exists
                'name': '!null' // Ensure title exists
            });

            if (filters.genres) {
                if (Array.isArray(filters.genres)) {
                    filters.genres.forEach(g => params.append('genres.name', g));
                } else {
                    params.append('genres.name', filters.genres);
                }
            }

            if (filters.year) {
                params.append('year', filters.year);
            }
            
            if (filters.excludeId) {
                // Not all endpoints support id exclusion, but we can filter client-side too
                // params.append('id', `!${filters.excludeId}`); 
            }

            // Exclude cartoons if original movie is not a cartoon
            if (filters.excludeGenres && Array.isArray(filters.excludeGenres)) {
                 filters.excludeGenres.forEach(g => params.append('genres.name', `!${g}`));
            }

            const fullUrl = `${url}?${params}`;
            console.log(`KinopoiskService: Filter Request URL: ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return {
                docs: data.docs ? data.docs.map(movie => this.normalizeMovieData(movie)) : [],
                total: data.total || 0,
                page: data.page || page,
                pages: data.pages || 0
            };
        } catch (error) {
            console.error('Error getting movies by filters:', error);
            return { docs: [] };
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
            
            const response = await this._fetchWithRotation(url, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Full movie API response:', data); // Debug log
            
            let movieData = this.normalizeMovieData(data);

            // Check if IMDb rating is missing and we have an IMDb ID
            if ((!movieData.imdbRating || movieData.imdbRating === 0) && movieData.externalId?.imdb) {
                console.log(`KinopoiskService: Missing IMDb rating for ${movieData.name}, attempting to parse from IMDb...`);
                
                if (typeof ImdbParsingService !== 'undefined') {
                    const imdbService = new ImdbParsingService();
                    const imdbData = await imdbService.getImdbRating(movieData.externalId.imdb);
                    
                    if (imdbData) {
                        console.log(`KinopoiskService: Updated IMDb rating for ${movieData.name}: ${imdbData.rating} (${imdbData.votes} votes)`);
                        movieData.imdbRating = imdbData.rating;
                        movieData.votes.imdb = imdbData.votes;
                    }
                } else {
                    console.warn('KinopoiskService: ImdbParsingService not found');
                }
            }

            return movieData;
        } catch (error) {
            console.error('Error getting movie details:', error);
            throw new Error(`Failed to get movie details: ${error.message}`);
        }
    }

    /**
     * Get movie images/frames by ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Array>} - Movie images
     */
    async getMovieImages(movieId) {
        try {
            // Try the images endpoint if it exists
            const url = `${this.baseUrl}/image?movieId=${movieId}&type=still`;
            
            const response = await this._fetchWithRotation(url, {
                method: 'GET'
            });

            if (!response.ok) {
                // Images are not critical, just return empty array on failure
                console.warn(`Failed to get images: ${response.status}`);
                return [];
            }

            const data = await response.json();
            return data.items || data.docs || [];
        } catch (error) {
            console.error('Error getting movie images:', error);
            return [];
        }
    }

    /**
     * Get movie awards by ID
     * @param {number} movieId - Kinopoisk movie ID
     * @returns {Promise<Array>} - Movie awards
     */
    async getMovieAwards(movieId) {
        try {
            // Correct endpoint for kinopoisk.dev is /movie/awards?movieId={id}
            const url = `${this.baseUrl}/movie/awards?movieId=${movieId}&limit=250`;
            console.log('Fetching awards from:', url);

            const response = await this._fetchWithRotation(url, {
                method: 'GET'
            });

            if (!response.ok) {
                console.warn(`Failed to get awards: ${response.status}`);
                return [];
            }

            const data = await response.json();
            return data.items || data.docs || [];
        } catch (error) {
            console.error('Error getting movie awards:', error);
            return [];
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
        const queryLower = query.toLowerCase().trim().replace(/ё/g, 'е');

        // Stem the query if the Snowball stemmer is available (handles Russian inflection:
        // e.g. "соседства" (genitive) and "Соседство" (nominative) both stem to "сосед")
        const stemmer = (typeof RussianStemmer !== 'undefined') ? RussianStemmer : null;
        const queryStem = stemmer ? stemmer.stemPhrase(queryLower) : queryLower;

        // Score a single movie against the query — higher = more relevant
        const score = (movie) => {
            const name    = (movie.name || '').toLowerCase().replace(/ё/g, 'е');
            const altName = (movie.alternativeName || '').toLowerCase();

            // ---- Tier 1-6: exact/prefix/contains matching on raw query ----

            // Tier 1: exact match on primary or alternative name
            if (name === queryLower || altName === queryLower) return 100;

            // Tier 2: primary name starts with query
            if (name.startsWith(queryLower)) return 80;

            // Tier 3: alternative name starts with query
            if (altName.startsWith(queryLower)) return 70;

            // Tier 4: primary name contains query as a whole word
            const safeQuery = queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const wordBoundary = new RegExp(`(^|\\s)${safeQuery}(\\s|$)`);
            if (wordBoundary.test(name)) return 60;
            if (wordBoundary.test(altName)) return 55;

            // Tier 5: primary name contains query anywhere
            if (name.includes(queryLower)) return 40;

            // Tier 6: alternative name contains query anywhere
            if (altName.includes(queryLower)) return 30;

            // ---- Tier 7-9: stem-based matching (handles inflected Russian forms) ----
            // e.g. query "соседства" stems to "соседств"
            //   "Соседство"        → stem "соседств"      → exact → score 95  ✓ wins
            //   "Шпион по соседству" → stem "шпион со…" → word  → score 35
            if (stemmer && queryStem && queryStem !== queryLower) {
                const nameStem    = stemmer.stemPhrase(name);
                const altNameStem = stemmer.stemPhrase(altName);

                const safeStem = queryStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                // Tier 7: the entire stemmed title IS the stemmed query (e.g. "Соседство")
                if (nameStem === queryStem) return 95;

                // Tier 7b: stemmed query appears as a whole token inside the stemmed title
                const stemWordRe = new RegExp(`(^| )${safeStem}( |$)`);
                if (stemWordRe.test(nameStem)) return 35;

                // Tier 8: stemmed query is a substring of the stemmed title (any position)
                if (nameStem.includes(queryStem)) return 20;

                // Tier 9: same checks for alternativeName
                if (altNameStem === queryStem) return 90;
                if (stemWordRe.test(altNameStem)) return 30;
                if (altNameStem.includes(queryStem)) return 15;
            }

            return 0;
        };

        return movies.sort((a, b) => {
            const scoreDiff = score(b) - score(a);
            if (scoreDiff !== 0) return scoreDiff;

            // Tiebreaker: most popular first (votes.kp)
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
            slogan: movie.slogan || '',
            genres: movie.genres?.map(g => g.name) || movie.genre || [],
            countries: movie.countries?.map(c => c.name) || movie.country || [],
            duration: movie.movieLength || movie.duration || 0,
            ageRating: movie.ageRating || 0,
            ratingMpaa: movie.ratingMpaa || '',
            type: movie.type || 'movie',
            votes: {
                kp: movie.votes?.kp || 0,
                imdb: movie.votes?.imdb || 0
            },
            
            // Crew and cast (persons)
            persons: movie.persons || [],
            
            // Box office and budget
            budget: movie.budget || null,
            fees: {
                world: movie.fees?.world || null,
                usa: movie.fees?.usa || null,
                russia: movie.fees?.russia || null
            },
            
            // Audience stats
            audience: movie.audience || [],
            
            // Premieres
            premiere: {
                world: movie.premiere?.world || null,
                russia: movie.premiere?.russia || null,
                digital: movie.premiere?.digital || null
            },
            
            // Release information
            distributors: movie.distributors || null,
            
            // Sequels and Prequels
            sequelsAndPrequels: movie.sequelsAndPrequels || [],
            
            // Similar Movies
            similarMovies: movie.similarMovies || [],
            
            // Additional fields for caching
            lastUpdated: new Date().toISOString(),
            
            // IDs
            externalId: movie.externalId || {},
            
            // Serialize seasons info if available
            seasonsInfo: movie.seasonsInfo || []
        };
    }
    
    /**
     * Get persons by profession from movie data
     * @param {Array} persons - Array of person objects from movie
     * @param {string} profession - Profession to filter by (e.g., 'DIRECTOR', 'ACTOR', 'WRITER')
     * @param {number} limit - Max number of persons to return
     * @returns {Array} - Filtered persons
     */
    getPersonsByProfession(persons, profession, limit = null) {
        if (!persons || !Array.isArray(persons)) return [];
        
        const targetProf = profession.toString().toLowerCase();
        
        const filtered = persons.filter(person => {
            const enProf = person.enProfession ? person.enProfession.toString().toLowerCase() : '';
            // If checking localized profession, strict match might be needed, but usually we search by EN key
            // The search.js passes 'DIRECTOR' etc.
            return enProf === targetProf;
        });
        
        return limit ? filtered.slice(0, limit) : filtered;
    }
    
    /**
     * Format persons list as comma-separated names
     * @param {Array} persons - Array of person objects
     * @returns {string} - Formatted names
     */
    formatPersonNames(persons) {
        if (!persons || persons.length === 0) return '';
        
        return persons
            .map(person => person.name || person.enName || 'Unknown')
            .filter(name => name !== 'Unknown')
            .join(', ');
    }
    
    /**
     * Format currency value with proper separators
     * @param {Object|number} value - Budget/fees object or number
     * @returns {string} - Formatted currency string
     */
    formatCurrency(value) {
        if (!value) return '';
        
        const amount = typeof value === 'object' ? value.value : value;
        const currency = typeof value === 'object' ? value.currency : 'USD';
        
        if (!amount) return '';
        
        // Format with spaces as thousand separators
        const formatted = amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        
        // Add currency symbol
        const symbols = {
            'USD': '$',
            'RUB': '₽',
            'EUR': '€'
        };
        
        const symbol = symbols[currency] || currency;
        
        return `${symbol}${formatted}`;
    }
    
    /**
     * Format date to readable format
     * @param {string} dateStr - ISO date string
     * @returns {string} - Formatted date
     */
    formatDate(dateStr) {
        if (!dateStr) return '';
        
        try {
            const date = new Date(dateStr);
            const day = date.getDate();
            const months = [
                'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
            ];
            const month = months[date.getMonth()];
            const year = date.getFullYear();
            
            return `${day} ${month} ${year}`;
        } catch (e) {
            return dateStr;
        }
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

    /**
     * Normalize search query for better API compatibility
     * @param {string} query - Original query
     * @returns {string} - Normalized query
     */
    normalizeQuery(query) {
        if (!query) return '';
        
        // Trim whitespace
        let normalized = query.trim();
        
        // Replace multiple spaces with single space
        normalized = normalized.replace(/\s+/g, ' ');
        
        // For Cyrillic queries, try some common normalizations
        if (this.hasCyrillic(normalized)) {
            // Convert to lowercase for consistency
            normalized = normalized.toLowerCase();
            
            // Only replace ё→е (safe). Do NOT replace й→и — that breaks words
            // like 'Бойцовский' → 'Боицовскии' which destroys search accuracy.
            normalized = normalized.replace(/ё/g, 'е');
        }
        
        return normalized;
    }

    /**
     * Check if string contains Cyrillic characters
     * @param {string} str - String to check
     * @returns {boolean} - True if contains Cyrillic
     */
    hasCyrillic(str) {
        return /[а-яё]/i.test(str);
    }

    /**
     * Alternative search method for problematic queries
     * @param {string} query - Original query
     * @param {number} page - Page number
     * @param {number} limit - Results limit
     * @returns {Promise<Object>} - Search results
     */
    async searchMoviesAlternative(query, page = 1, limit = this.defaultLimit) {
        const alternatives = [
            // Try without sortField and sortType
            {
                query: this.normalizeQuery(query),
                page: page.toString(),
                limit: limit.toString()
            },
            // Try with different sort parameters
            {
                query: this.normalizeQuery(query),
                page: page.toString(),
                limit: limit.toString(),
                sortField: 'year',
                sortType: '-1'
            }
        ];

        // Add Cyrillic-specific alternatives
        if (this.hasCyrillic(query)) {
            const cyrillicAlternatives = this.getCyrillicAlternatives(query);
            cyrillicAlternatives.forEach(altQuery => {
                alternatives.push({
                    query: altQuery,
                    page: page.toString(),
                    limit: limit.toString()
                });
            });
        }

        for (let i = 0; i < alternatives.length; i++) {
            try {
                console.log(`KinopoiskService: Trying alternative ${i + 1}:`, alternatives[i]);
                
                // Add delay between requests to avoid throttling
                if (i > 0) {
                    console.log(`KinopoiskService: Waiting 1 second to avoid throttling...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
                const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.SEARCH}`;
                const params = new URLSearchParams(alternatives[i]);
                
                const response = await this._fetchWithRotation(`${url}?${params}`, {
                    method: 'GET'
                });

                if (response.ok) {
                    const data = await response.json();
                    console.log(`KinopoiskService: Alternative ${i + 1} succeeded`);
                    return this.normalizeSearchResults(data, query);
                }
                
                console.log(`KinopoiskService: Alternative ${i + 1} failed with status:`, response.status);
                
                // If we get 429 (Too Many Requests), wait longer
                if (response.status === 429) {
                    console.log('KinopoiskService: Rate limited, waiting 3 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
                
            } catch (error) {
                console.log(`KinopoiskService: Alternative ${i + 1} error:`, error.message);
                
                // If throttled, wait before next attempt
                if (error.message.includes('throttled') || error.message.includes('Failed to fetch')) {
                    console.log('KinopoiskService: Request throttled, waiting 2 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        // If all alternatives fail, return empty results
        console.log('KinopoiskService: All alternatives failed, returning empty results');
        return {
            docs: [],
            total: 0,
            limit: limit,
            page: page,
            pages: 0
        };
    }

    /**
     * Simple transliteration for Cyrillic to Latin
     * @param {string} str - Cyrillic string
     * @returns {string} - Transliterated string
     */
    transliterate(str) {
        const translitMap = {
            'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
            'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
            'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
            'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
            'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
            ' ': ' '
        };

        return str.toLowerCase().split('').map(char => 
            translitMap[char] || char
        ).join('');
    }

    /**
     * Get alternative search queries for Cyrillic text
     * @param {string} query - Original Cyrillic query
     * @returns {Array<string>} - Array of alternative queries
     */
    getCyrillicAlternatives(query) {
        const alternatives = [];
        const lowerQuery = query.toLowerCase().trim();

        // Common movie title translations
        const movieTranslations = {
            'человек паук': ['spider man', 'spiderman'],
            'железный человек': ['iron man'],
            'темный рыцарь': ['dark knight'],
            'матрица': ['matrix'],
            'терминатор': ['terminator'],
            'бэтмен': ['batman'],
            'супермен': ['superman'],
            'мстители': ['avengers'],
            'звездные войны': ['star wars'],
            'звёздные войны': ['star wars'],
            'властелин колец': ['lord of the rings'],
            'гарри поттер': ['harry potter'],
            'джеймс бонд': ['james bond'],
            'форсаж': ['fast and furious', 'fast furious'],
            'пираты карибского моря': ['pirates of the caribbean'],
            'трансформеры': ['transformers'],
            'люди икс': ['x-men', 'xmen'],
            'фантастические твари': ['fantastic beasts'],
            'миссия невыполнима': ['mission impossible'],
            'крепкий орешек': ['die hard'],
            'назад в будущее': ['back to the future'],
            'индиана джонс': ['indiana jones'],
            'джуманджи': ['jumanji'],
            'кинг конг': ['king kong'],
            'годзилла': ['godzilla']
        };

        // Check for direct translations
        if (movieTranslations[lowerQuery]) {
            alternatives.push(...movieTranslations[lowerQuery]);
        }

        // Try transliteration
        const transliterated = this.transliterate(query);
        if (transliterated !== query) {
            alternatives.push(transliterated);
        }

        // Try partial matches for compound queries
        const words = lowerQuery.split(' ');
        if (words.length > 1) {
            for (const word of words) {
                if (movieTranslations[word]) {
                    // Try combining translated word with transliterated others
                    const translatedWords = words.map(w => 
                        movieTranslations[w] ? movieTranslations[w][0] : this.transliterate(w)
                    );
                    alternatives.push(translatedWords.join(' '));
                }
            }
        }

        // Remove duplicates and return
        return [...new Set(alternatives)];
    }
    /**
     * Get a random movie based on filters
     * @param {Object} filters - Filters: { countries, genres, yearFrom, yearTo, ratingFrom, ratingTo }
     * @returns {Promise<Object>} - Random movie data
     */
    async getRandomMovie(filters = {}) {
        try {
            console.log('KinopoiskService: Getting random movie with filters:', filters);
            
            const url = `${this.baseUrl}${KINOPOISK_CONFIG.ENDPOINTS.RANDOM}`;
            const params = new URLSearchParams();

            // API v1.4 random endpoint parameters
            // Standard filters
            if (filters.yearFrom || filters.yearTo) {
                const start = filters.yearFrom || 1900;
                const end = filters.yearTo || new Date().getFullYear();
                params.append('year', `${start}-${end}`);
            }

            if (filters.ratingFrom || filters.ratingTo) {
                const start = filters.ratingFrom || 1;
                const end = filters.ratingTo || 10;
                params.append('rating.kp', `${start}-${end}`);
            }

            if (filters.votesFrom || filters.votesTo) {
                const start = filters.votesFrom || 0;
                const end = filters.votesTo || 10000000;
                params.append('votes.kp', `${start}-${end}`);
            }

            // Handle multiple values for countries and genres
            // include: ['USA', 'France'] -> countries.name=USA&countries.name=France
            // exclude: ['Horror'] -> genres.name=!Horror (if supported) or handled client side
            // Note: The official docs saying "list of strings". We'll try appending multiple times.
            
            if (filters.countries && filters.countries.length > 0) {
                filters.countries.forEach(country => {
                    params.append('countries.name', country);
                });
            }

            if (filters.genres && filters.genres.length > 0) {
                filters.genres.forEach(genre => {
                    params.append('genres.name', genre);
                });
            }

            // Exclude filters - API v1.4 often supports !value
            // We'll try passing negated values
            if (filters.excludeCountries && filters.excludeCountries.length > 0) {
                filters.excludeCountries.forEach(country => {
                    params.append('countries.name', `!${country}`);
                });
            }

            if (filters.excludeGenres && filters.excludeGenres.length > 0) {
                filters.excludeGenres.forEach(genre => {
                    params.append('genres.name', `!${genre}`);
                });
            }

            if (filters.types && filters.types.length > 0) {
                filters.types.forEach(type => {
                    params.append('type', type);
                });
            }

            if (filters.excludeTypes && filters.excludeTypes.length > 0) {
                filters.excludeTypes.forEach(type => {
                    params.append('type', `!${type}`);
                });
            }

            // Ensure we get non-null name and poster
            params.append('notNullFields', 'name');
            params.append('notNullFields', 'poster.url');

            const fullUrl = `${url}?${params}`;
            console.log(`KinopoiskService: Random Request URL: ${fullUrl}`);

            const response = await this._fetchWithRotation(fullUrl, {
                method: 'GET'
            });

            if (!response.ok) {
                if (response.status === 403 || response.status === 402) {
                     throw new Error('DAILY_LIMIT_REACHED');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            // Random endpoint returns a single object, not docs array
            // But sometimes it might return docs if used differently. 
            // In v1.4/movie/random it returns a single movie object.
            
            console.log('KinopoiskService: Random movie response:', data);
            
            if (!data || (!data.id && !data.kinopoiskId)) {
                return null;
            }

            return this.normalizeMovieData(data);

        } catch (error) {
            console.error('Error getting random movie:', error);
             if (error.message === 'DAILY_LIMIT_REACHED') {
                 if (typeof Utils !== 'undefined' && Utils.showToast) {
                    Utils.showToast('⚠️ Вы израсходовали ваш суточный лимит запросов.', 'error');
                }
            }
            throw error;
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KinopoiskService;
}
if (typeof window !== 'undefined') {
    window.KinopoiskService = KinopoiskService;
}