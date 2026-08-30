/**
 * ImdbParsingService - Parses IMDb ratings from imdb.com and searches IMDb by title.
 * Used as a fallback when Kinopoisk doesn't provide IMDb data or when searching by English title.
 */
class ImdbParsingService {
    constructor() {
        this.baseUrl = 'https://www.imdb.com';
        this.suggestionBaseUrl = 'https://v3.sg.media-imdb.com';
    }

    /**
     * Normalize a title for fuzzy comparison.
     * @param {string} title
     * @returns {string}
     */
    normalizeTitle(title) {
        return String(title || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    /**
     * Search for IMDb ID by title and optional release year using IMDb suggestions API.
     * @param {string} title - English or international movie/show title
     * @param {number|string} [year] - Release year
     * @returns {Promise<string|null>} - IMDb ID (e.g. 'tt21285562') or null
     */
    async findImdbId(title, year = null) {
        if (!title || typeof title !== 'string') return null;
        const cleanTitle = title.trim();
        if (!cleanTitle) return null;

        try {
            const url = `${this.suggestionBaseUrl}/suggestion/x/${encodeURIComponent(cleanTitle)}.json`;
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json, text/plain, */*'
                }
            });

            if (!response.ok) {
                console.warn(`[ImdbParser] Suggestion API HTTP ${response.status} for "${cleanTitle}"`);
                return null;
            }

            const data = await response.json();
            const results = Array.isArray(data?.d) ? data.d : [];
            if (results.length === 0) return null;

            const targetYear = Number(year) || 0;
            const normTarget = this.normalizeTitle(cleanTitle);

            // Filter for valid title IDs (starting with 'tt')
            const candidates = results.filter(item => item && typeof item.id === 'string' && item.id.startsWith('tt'));
            if (candidates.length === 0) return null;

            let matched = null;

            // 1. Exact normalized title + exact year
            if (targetYear > 0) {
                matched = candidates.find(item => this.normalizeTitle(item.l) === normTarget && Number(item.y) === targetYear);
            }

            // 2. Exact normalized title + year tolerance (±1 year)
            if (!matched && targetYear > 0) {
                matched = candidates.find(item => this.normalizeTitle(item.l) === normTarget && Math.abs(Number(item.y) - targetYear) <= 1);
            }

            // 3. Exact normalized title (any year)
            if (!matched) {
                matched = candidates.find(item => this.normalizeTitle(item.l) === normTarget);
            }

            // 4. Substring/prefix title match + exact year
            if (!matched && targetYear > 0) {
                matched = candidates.find(item => {
                    const normItem = this.normalizeTitle(item.l);
                    return Number(item.y) === targetYear && (normItem.includes(normTarget) || normTarget.includes(normItem));
                });
            }

            // 5. Substring/prefix title match + year tolerance (±1 year)
            if (!matched && targetYear > 0) {
                matched = candidates.find(item => {
                    const normItem = this.normalizeTitle(item.l);
                    return Math.abs(Number(item.y) - targetYear) <= 1 && (normItem.includes(normTarget) || normTarget.includes(normItem));
                });
            }

            // 6. First candidate fallback
            if (!matched && candidates.length > 0) {
                matched = candidates[0];
            }

            return matched?.id || null;
        } catch (error) {
            console.warn('[ImdbParser] findImdbId error:', error?.message || error);
            return null;
        }
    }

    /**
     * Get IMDb rating by searching for its title and parsing the resulting title page.
     * @param {string} title - English or original title
     * @param {number|string} [year] - Release year
     * @returns {Promise<Object|null>} - { rating: number, votes: number, imdbId: string } or null
     */
    async getImdbRatingByTitle(title, year = null) {
        if (!title) return null;
        const imdbId = await this.findImdbId(title, year);
        if (!imdbId) return null;

        const ratingData = await this.getImdbRating(imdbId);
        if (!ratingData) return null;

        return {
            ...ratingData,
            imdbId
        };
    }

    /**
     * Get IMDb rating for a movie by IMDb ID
     * @param {string} imdbId - IMDb ID (e.g., 'tt1234567')
     * @returns {Promise<Object|null>} - { rating: number, votes: number, imdbId: string } or null
     */
    async getImdbRating(imdbId) {
        if (!imdbId) return null;

        try {
            const url = `${this.baseUrl}/title/${imdbId}/`;
            console.log('Parsing IMDb rating from:', url);

            const response = await fetch(url, {
                headers: {
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });

            console.log(`[ImdbParser] Response status: ${response.status}`);

            if (!response.ok) {
                console.warn(`[ImdbParser] ❌ Failed to load IMDb page: ${response.status}`);
                return null;
            }

            const html = await response.text();
            const parsed = this.parseImdbPage(html);
            if (parsed) {
                return {
                    ...parsed,
                    imdbId
                };
            }
            return null;

        } catch (error) {
            console.error('ImdbParsingService error:', error);
            return null;
        }
    }

    /**
     * Parse IMDb page HTML to extract rating and votes
     * @param {string} html - IMDb page HTML
     * @returns {Object|null} - { rating: number, votes: number }
     */
    parseImdbPage(html) {
        if (!html || typeof html !== 'string') return null;

        try {
            // Strategy 1: JSON-LD Schema (application/ld+json)
            // IMDb standardly embeds schema.org AggregateRating in <script type="application/ld+json">
            const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
            if (jsonLdMatches) {
                for (const block of jsonLdMatches) {
                    const jsonStr = block
                        .replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/i, '')
                        .replace(/<\/script>/i, '')
                        .trim();
                    try {
                        const data = JSON.parse(jsonStr);
                        const agg = data?.aggregateRating
                            || (Array.isArray(data?.['@graph']) && data['@graph'].find(item => item?.aggregateRating)?.aggregateRating);
                        if (agg) {
                            const rating = parseFloat(agg.ratingValue);
                            const votes = parseInt(String(agg.ratingCount || 0).replace(/\D/g, ''), 10) || 0;
                            if (rating > 0 && rating <= 10) {
                                console.log(`[ImdbParser] Parsed via JSON-LD: Rating=${rating}, Votes=${votes}`);
                                return { rating, votes };
                            }
                        }
                    } catch {
                        // ignore malformed JSON-LD block and check next
                    }
                }
            }

            // Strategy 2: DOM-based parsing
            if (typeof DOMParser !== 'undefined') {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                const ratingElement = doc.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"] span:first-child')
                    || doc.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"]');
                let rating = 0;

                if (ratingElement) {
                    const text = ratingElement.textContent.trim();
                    const match = text.match(/\d+(?:\.\d+)?/);
                    if (match) rating = parseFloat(match[0]);
                }

                let votes = 0;
                const scoreElement = doc.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"]');

                if (scoreElement && scoreElement.parentElement) {
                    const parent = scoreElement.parentElement;
                    const children = parent.children || [];

                    if (children.length >= 3) {
                        const votesElement = children[2];
                        if (votesElement) {
                            const voteText = votesElement.textContent.trim();
                            votes = this.parseVotes(voteText);
                        }
                    }
                }

                if (rating > 0) {
                    console.log(`[ImdbParser] Parsed via DOM: Rating=${rating}, Votes=${votes}`);
                    return { rating, votes };
                }
            }

            // Strategy 3: Regex fallback
            const ratingRegexMatch = html.match(/data-testid="hero-rating-bar__aggregate-rating__score"[^>]*>[\s\S]*?(\d+(?:\.\d+)?)/i);
            if (ratingRegexMatch) {
                const rating = parseFloat(ratingRegexMatch[1]);
                if (rating > 0 && rating <= 10) {
                    return { rating, votes: 0 };
                }
            }

            return null;
        } catch (error) {
            console.error('[ImdbParser] Parsing error:', error);
            return null;
        }
    }

    /**
     * Parse vote string (e.g. "20K", "1.5M", "2,345") into number
     * @param {string} voteStr
     * @returns {number}
     */
    parseVotes(voteStr) {
        if (!voteStr) return 0;

        const str = voteStr.toUpperCase().replace(/,/g, '');
        let multiplier = 1;

        if (str.endsWith('K')) {
            multiplier = 1000;
        } else if (str.endsWith('M')) {
            multiplier = 1000000;
        }

        const num = parseFloat(str.replace(/[KM]/g, ''));
        return Math.round(num * multiplier);
    }
}

// Export as global
if (typeof window !== 'undefined') {
    window.ImdbParsingService = ImdbParsingService;
}
if (typeof globalThis !== 'undefined') globalThis.ImdbParsingService = ImdbParsingService;
if (typeof module !== 'undefined' && module.exports) module.exports = ImdbParsingService;
