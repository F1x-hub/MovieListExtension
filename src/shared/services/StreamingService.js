/**
 * StreamingService - Handles interaction with ex-fs.net
 * Searches for movies and extracts video player sources
 */
class StreamingService {
    constructor() {
        this.baseUrl = 'https://ex-fs.net';
    }

    /**
     * Search for a movie by title and year
     * @param {string} title - Movie title (Russian preferred)
     * @param {string} year - Movie year
     * @returns {Promise<Object|null>} - Found movie object or null
     */
    async search(title, year) {
        try {
            // Convert year to string for comparison
            const targetYear = year ? year.toString() : null;
            
            // Prepare search parameters
            // ex-fs.net uses POST request for search
            const formData = new FormData();
            formData.append('do', 'search');
            formData.append('subaction', 'search');
            formData.append('story', title);

            const response = await fetch(`${this.baseUrl}/index.php?do=search`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const html = await response.text();
            return this.parseSearchResults(html, title, targetYear);

        } catch (error) {
            console.error('StreamingService search error:', error);
            throw error;
        }
    }

    /**
     * Parse search results HTML to find the best matching movie
     * @param {string} html - Search results HTML
     * @param {string} targetTitle - Title to match
     * @param {string} targetYear - Year to match
     * @returns {Object|null} - Movie object with url and title
     */
    parseSearchResults(html, targetTitle, targetYear) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Select all search result items
        const contentArea = doc.querySelector('#dle-content') || doc.body;
        const links = Array.from(contentArea.querySelectorAll('a'));

        // Filter links that look like movie pages (e.g., /film/...)
        const movieLinks = links.filter(link => 
            link.href.includes('/film/') || link.href.includes('/serials/') || link.href.includes('/multfilm/')
        );

        const matches = [];

        // Find all potential matches
        for (const link of movieLinks) {
            const titleElement = link.querySelector('h2, h3, .title') || link;
            const titleText = titleElement.textContent.trim();
            
            // Simple fuzzy match for title
            if (this.isTitleMatch(titleText, targetTitle)) {
                // Try to extract year from title or link text
                // Look for 4 digits in the text (19xx or 20xx)
                let foundYear = null;
                
                // 1. Check link text
                let yearMatch = link.textContent.match(/\b(19|20)\d{2}\b/);
                
                // 2. If not found, check parent container (traverse up to find the movie card context)
                if (!yearMatch) {
                    let parent = link.parentElement;
                    // Traverse up a few levels to find a container that might have the year
                    // usually it's in a sibling div or the parent wrapper
                    for (let i = 0; i < 3; i++) {
                        if (!parent) break;
                        // Check text content of parent, but be careful not to grab too much
                        // We look for the year pattern. 
                        // Often it's at the start of a line or separated by commas
                        const parentText = parent.textContent || '';
                        yearMatch = parentText.match(/\b(19|20)\d{2}\b/);
                        if (yearMatch) break;
                        parent = parent.parentElement;
                    }
                }

                foundYear = yearMatch ? yearMatch[0] : null;

                matches.push({
                    title: titleText,
                    url: link.href,
                    year: foundYear
                });
            }
        }

        // 1. Try to find exact match with year
        if (targetYear) {
            const yearMatch = matches.find(m => m.year === targetYear);
            if (yearMatch) {
                console.log('Found match with year:', yearMatch);
                return yearMatch;
            }
        }

        // 2. If no year match (or no target year), return the first title match
        // Ideally we might want to prefer the one WITHOUT a year if targetYear is missing, 
        // but usually we just take the first relevant result.
        if (matches.length > 0) {
            console.log('Found match by title only:', matches[0]);
            return matches[0];
        }

        return null;
    }

    isTitleMatch(foundTitle, targetTitle) {
        if (!foundTitle || !targetTitle) return false;
        const normalize = str => str.toLowerCase().replace(/[^a-zа-я0-9]/g, '');
        return normalize(foundTitle).includes(normalize(targetTitle));
    }

    /**
     * Get video sources from a movie page URL
     * @param {string} url - Movie page URL
     * @returns {Promise<Array>} - List of video sources
     */
    async getVideoSources(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to load movie page: ${response.status}`);
            }

            const html = await response.text();
            return this.parseMoviePage(html);

        } catch (error) {
            console.error('StreamingService getVideoSources error:', error);
            throw error;
        }
    }

    /**
     * Parse movie page HTML to extract video players
     * @param {string} html - Movie page HTML
     * @returns {Array} - List of player objects { name, url, type }
     */
    parseMoviePage(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const players = [];

        // Based on the provided HTML context:
        // <div class="tab-pane active" id="tab6"><iframe ...></iframe></div>
        // <div class="tab-pane" id="tab7"><iframe ...></iframe></div>
        
        const tabContent = doc.querySelector('.tab-content');
        if (!tabContent) return players;

        const panes = tabContent.querySelectorAll('.tab-pane');
        
        panes.forEach(pane => {
            const iframe = pane.querySelector('iframe');
            if (iframe && iframe.src) {
                let name = 'Player';
                const id = pane.id;
                
                // Try to find the tab label for this pane
                // <ul class="nav-tabs"><li><a href="#tab6">Плеер Full HD</a></li>...</ul>
                const tabLink = doc.querySelector(`.nav-tabs a[href="#${id}"]`);
                if (tabLink) {
                    name = tabLink.textContent.trim();
                }

                players.push({
                    name: name,
                    url: iframe.src,
                    type: 'iframe' // Most likely an iframe embed
                });
            }
        });

        return players;
    }
}

// Export as global or module depending on environment
if (typeof window !== 'undefined') {
    window.StreamingService = StreamingService;
}
