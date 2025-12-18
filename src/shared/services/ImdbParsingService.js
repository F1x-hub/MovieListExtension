/**
 * ImdbParsingService - Parses IMDb ratings from imdb.com
 * Used as a fallback when API doesn't provide IMDb data
 */
class ImdbParsingService {
    constructor() {
        this.baseUrl = 'https://www.imdb.com';
    }

    /**
     * Get IMDb rating for a movie by IMDb ID
     * @param {string} imdbId - IMDb ID (e.g., 'tt1234567')
     * @returns {Promise<Object|null>} - { rating: number, votes: number } or null
     */
    async getImdbRating(imdbId) {
        if (!imdbId) return null;

        try {
            const url = `${this.baseUrl}/title/${imdbId}/`;
            console.log('Parsing IMDb rating from:', url);

            const response = await fetch(url, {
                headers: {
                    'Accept-Language': 'en-US,en;q=0.9', // Request English content
                }
            });
            
            console.log(`[ImdbParser] Response status: ${response.status}`);
            
            if (!response.ok) {
                console.warn(`[ImdbParser] ❌ Failed to load IMDb page: ${response.status}`);
                return null;
            }

            const html = await response.text();
            return this.parseImdbPage(html);

        } catch (error) {
            console.error('ImdbParsingService error:', error);
            return null;
        }
    }

    /**
     * Parse IMDb page HTML to extract rating and votes
     * @param {string} html - IMDb page HTML
     * @returns {Object|null} - { rating, votes }
     */
    parseImdbPage(html) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Selectors based on user provided data
            // Rating: <span class="sc-4dc495c1-1 lbQcRY">6.2</span>
            // Votes: <div class="sc-4dc495c1-3 eNfgcR">20K</div> or similar structure

            // Use data-testid for more reliable selection as requested
            const ratingElement = doc.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"] span:first-child');
            let rating = 0;
            
            if (ratingElement) {
                rating = parseFloat(ratingElement.textContent.trim());
            }

            // Votes element is usually near the rating
            // Based on user snippet: <div class="sc-4dc495c1-3 eNfgcR">20K</div> inside the rating block
            // However, class names like 'sc-...' are dynamic generated classes and might change.
            // We'll try to find the votes by looking for the sibling or parent structure if possible,
            // or just rely on the structure inside "data-testid='hero-rating-bar__aggregate-rating'"

            // Votes parsing
            // Structure: 
            // <div class="sc-4dc495c1-0 fUqjJu"> (Parent)
            //   <div data-testid="hero-rating-bar__aggregate-rating__score">...</div> (Rating)
            //   <div class="..."></div> (Spacer/Separator)
            //   <div class="sc-4dc495c1-3 eNfgcR">20K</div> (Votes)
            // </div>
            
            let votes = 0;
            const scoreElement = doc.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"]');
            
            if (scoreElement && scoreElement.parentElement) {
                // The votes are usually the 3rd child of the shared parent
                const parent = scoreElement.parentElement;
                const children = parent.children;
                
                if (children.length >= 3) {
                    // Try the 3rd child (index 2)
                    const votesElement = children[2];
                    if (votesElement) {
                         const voteText = votesElement.textContent.trim();
                         votes = this.parseVotes(voteText);
                    }
                }
            }
            
            // Fallback: search within the aggregate container if strictly structured parsing fails
            if (votes === 0) {
                const aggregateContainer = doc.querySelector('[data-testid="hero-rating-bar__aggregate-rating"]');
                if (aggregateContainer) {
                    const textContent = aggregateContainer.textContent;
                     // Regex to find things like "2.4M", "20K", "123" that are NOT the rating
                     // This is risky but a fallback.
                     // Better fallback: standard IMDb classes sometimes used for votes like .sc-bde20123-3 (changes dynamically)
                     
                     // Let's stick to the relative positioning logic as primary, but if that fails, 
                     // try to find any text in the container that matches vote patterns
                }
            }

            console.log(`[ImdbParser] Parsed: Rating=${rating}, Votes=${votes}`);
            
            if (rating > 0) {
                return { rating, votes };
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
