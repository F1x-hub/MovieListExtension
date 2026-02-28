/**
 * KinogoParser - Parser for fix.kinogo.luxury streaming source.
 * Searches for movies and extracts iframe embed players.
 * 
 * @extends BaseParserService
 */
class KinogoParser extends BaseParserService {
    constructor() {
        super({
            id: 'kinogo',
            name: 'KinoGo',
            baseUrl: 'https://fix.kinogo.luxury'
        });
    }

    // ─── BaseParserService Contract ───────────────────────────────────

    /**
     * Search for a movie by title and year.
     * @param {string} title - Movie title (Russian preferred)
     * @param {string|number|null} year - Movie year
     * @returns {Promise<SearchResult|null>}
     */
    async search(title, year) {
        console.log(`[DEBUG KinogoParser] search() called. title: "${title}", year: ${year}`);
        try {
            const targetYear = year ? year.toString() : null;
            const searchUrl = `${this.baseUrl}/search/${encodeURIComponent(title)}`;
            console.log(`[DEBUG KinogoParser] Fetching: ${searchUrl}`);

            const response = await fetch(searchUrl);

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const html = await response.text();
            
            const result = this.parseSearchResults(html, title, targetYear);
            console.log(`[DEBUG KinogoParser] search result:`, result ? `url: ${result.url?.substring(0,80)}, year: ${result.year}` : 'null');
 
            if (result) {
                result.parserId = this.id;
            }
            return result;

        } catch (error) {
            console.error(`[${this.name}] Search error:`, error);
            throw error;
        }
    }

    /**
     * Get video sources from a search result.
     * @param {SearchResult} searchResult - Result from search()
     * @returns {Promise<Array<VideoSource>>}
     */
    async getVideoSources(searchResult) {
        console.log(`[DEBUG KinogoParser] getVideoSources() called. searchResult:`, typeof searchResult === 'string' ? searchResult.substring(0,80) : searchResult?.url?.substring(0,80));
        try {
            const url = typeof searchResult === 'string' ? searchResult : searchResult.url;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to load movie page: ${response.status}`);
            }

            const html = await response.text();

            // Direct extraction of embed source
            const source = this.extractKinogoDirectSource(html);
            console.log(`[DEBUG KinogoParser] getVideoSources result:`, source ? `found embed: ${source.url?.substring(0,80)}` : 'not found');
            return source ? [source] : [];

        } catch (error) {
            console.error(`[${this.name}] getVideoSources error:`, error);
            throw error;
        }
    }

    // ─── Internal Parsing Methods ─────────────────────────────────────

    /**
     * Parse search results HTML to find the best matching movie.
     * Looks for .shortstory cards, compares year from "Год выпуска:" block.
     */
    parseSearchResults(html, targetTitle, targetYear) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const cards = doc.querySelectorAll('.shortstory');
        const matches = [];

        for (const card of cards) {
            // Extract title and link
            // BEM: .shortstory__title a  (double underscore!)
            // Structure can be: .shortstory__title > a > h2
            const titleLink = card.querySelector('.shortstory__title a')
                || card.querySelector('.shortstory-title a')
                || card.querySelector('.zagolovki a')
                || card.querySelector('h2 a, h3 a, .title a');
            
            if (!titleLink) continue;

            const titleText = titleLink.textContent.trim();
            let url = titleLink.getAttribute('href') || '';
            if (url && !url.startsWith('http')) {
                url = url.startsWith('/') ? this.baseUrl + url : this.baseUrl + '/' + url;
            }

            if (!this.isTitleMatch(titleText, targetTitle)) continue;

            // Extract year from "Год выпуска:" label
            // HTML pattern: <b>Год выпуска:</b><a href="...">2012</a>
            let foundYear = null;
            const cardText = card.innerHTML;
            const yearLabelMatch = cardText.match(/Год\s*выпуска\s*:?\s*<\/b>\s*(?:<a[^>]*>)?\s*(\d{4})/i)
                || cardText.match(/Год\s*выпуска\s*:?\s*(\d{4})/i);
            if (yearLabelMatch) {
                foundYear = yearLabelMatch[1];
            } else {
                // Fallback: try to find any 4-digit year in the card text
                const textContent = card.textContent || '';
                const yearMatch = textContent.match(/\b(19|20)\d{2}\b/);
                foundYear = yearMatch ? yearMatch[0] : null;
            }

            // Detect type: series if genre contains "Сериалы" or title has "сезон"
            let type = 'film';
            const genreText = cardText.toLowerCase();
            if (genreText.includes('сериалы') || genreText.includes('сезон')) {
                type = 'series';
            }

            matches.push({
                title: titleText,
                url: url,
                year: foundYear,
                type: type,
                parserId: this.id,
                source: this.id
            });
        }

        // Prefer year match
        if (targetYear) {
            const yearMatch = matches.find(m => m.year === targetYear);
            if (yearMatch) return yearMatch;
        }

        if (matches.length > 0) return matches[0];
        return null;
    }

    /**
     * Simple title matching — normalized comparison.
     */
    isTitleMatch(foundTitle, targetTitle) {
        if (!foundTitle || !targetTitle) return false;
        const normalize = str => str.toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
        const normalizedFound = normalize(foundTitle);
        const normalizedTarget = normalize(targetTitle);
        return normalizedFound.includes(normalizedTarget) || normalizedTarget.includes(normalizedFound);
    }

    // ─── Direct Source Extraction ────────────────────────────────────

    /**
     * Extract the specific KinoGo embed source from data attributes.
     * Looks for links containing "embed" (e.g. api.variyt.ws/embed/...).
     * 
     * @param {string} html - Page HTML
     * @returns {VideoSource|null}
     */
    extractKinogoDirectSource(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        // Looks for links like https://api.variyt.ws/embed/movie/{id}
        const embedPattern = /https?:\/\/[^"'\s]+\/embed\/[^"'\s]+/i;

        // Scan all elements with data-* attributes
        const allElements = doc.querySelectorAll('*');
        for (const el of allElements) {
            for (const attr of el.attributes) {
                if (attr.name.startsWith('data-') && attr.value) {
                    const val = attr.value.trim();
                    if (embedPattern.test(val)) {
                        const match = val.match(embedPattern);
                        if (match) {
                            return {
                                name: 'KinoGo',
                                url: this._normalizeUrl(match[0]),
                                type: 'iframe'
                            };
                        }
                    }
                }
            }
        }

        return null;
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    /**
     * Normalize a URL: add protocol if missing, trim whitespace.
     */
    _normalizeUrl(url) {
        if (!url) return url;
        let u = url.trim();
        if (u.startsWith('//')) u = 'https:' + u;
        return u;
    }
}

// Export — backward compatible
if (typeof window !== 'undefined') {
    window.KinogoParser = KinogoParser;
}
