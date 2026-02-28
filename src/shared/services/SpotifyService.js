/**
 * SpotifyService - Handles Spotify API interactions
 * Used for searching and retrieving soundtracks
 */
class SpotifyService {
    constructor() {
        this.config = typeof window !== 'undefined' && window.SPOTIFY_CONFIG 
            ? window.SPOTIFY_CONFIG 
            : (typeof require !== 'undefined' ? require('../config/spotify.config.js') : null);
            
        this.accessToken = null;
        this.tokenExpiration = 0;
    }

    /**
     * Get a valid access token (via Background Script to avoid CORS)
     * @returns {Promise<string|null>} Access token or null if failed
     */
    async getAccessToken() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'GET_SPOTIFY_TOKEN' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('SpotifyService: Runtime error', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }
                
                if (response && response.success) {
                    resolve(response.token);
                } else {
                    console.error('SpotifyService: Failed to get token', response ? response.error : 'Unknown error');
                    resolve(null);
                }
            });
        });
    }

    /**
     * Search for a movie soundtrack
     * @param {string} movieTitle - Title of the movie
     * @param {number} year - Release year (optional filter)
     * @returns {Promise<string|null>} Spotify URI or null if not found
     */
    async searchSoundtrack(movieTitle, year = null) {
        const token = await this.getAccessToken();
        if (!token) return null;

        try {
            // Refined Query: Search specifically for albums
            // Using boolean OR to catch variations but process filtering client-side
            const query = encodeURIComponent(`album:${movieTitle} soundtrack`);
            const url = `${this.config.ENDPOINTS.SEARCH}?q=${query}&type=album&limit=20`; // Increased limit for better filtering

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) return null;

            const data = await response.json();
            if (!data.albums || !data.albums.items.length) return null;

            let candidates = data.albums.items;
            const targetTitle = movieTitle.toLowerCase();
            const targetYear = year ? parseInt(year) : null;

            // Algorithm Steps:

            // 1. Scoring Function
            // Assign points based on relevance
            candidates.forEach(album => {
                let score = 0;
                const name = album.name.toLowerCase();
                const albumYear = parseInt(album.release_date.split('-')[0]);

                // A. Title Match (Critical)
                if (name.includes(targetTitle)) {
                    score += 50;
                    // Boost for exact starts-with match
                    if (name.startsWith(targetTitle)) score += 20;
                } else {
                    // Penalty if title is widely different (but search API is fuzzy)
                    score -= 50; 
                }

                // B. Year Match (High Importance)
                // Soundtracks usually release same year or year +/- 1
                if (targetYear && !isNaN(albumYear)) {
                    const diff = Math.abs(targetYear - albumYear);
                    if (diff === 0) score += 30;
                    else if (diff <= 1) score += 20;
                    else if (diff <= 2) score += 10;
                    else score -= 10; // Older/Newer irrelevant matches
                }

                // C. Keyword Match (Specificity)
                if (name.includes('original motion picture soundtrack') || name.includes('original motion picture score')) {
                    score += 20;
                } else if (name.includes('soundtrack') || name.includes('ost')) {
                    score += 10;
                }

                // D. Artist/Type Check (Optional refinement - avoiding "Various Artists" if Score is preferred?)
                // User didn't specify, but "Original Score" usually implies composer. 
                // We'll trust "Original Motion Picture Soundtrack" keyword.

                album._relevanceScore = score;
            });

            // 2. Filter out low relevance
            // Must have positive score (implies at least title match + some other factor)
            candidates = candidates.filter(c => c._relevanceScore > 0);

            if (candidates.length === 0) {
                 // Fallback: Try looser search if strict filtering failed
                 // But for "Doctor Strange" vs "Stranger Things", strict title match is key.
                 // If no candidates, maybe the API returned only "Stranger Things" items?
                 // Let's rely on the API recall. If nothing matches our title, better to show nothing than wrong item.
                 return null;
            }

            // 3. Sort by Score DESC, then Popularity DESC
            candidates.sort((a, b) => {
                if (b._relevanceScore !== a._relevanceScore) {
                    return b._relevanceScore - a._relevanceScore;
                }
                return (b.popularity || 0) - (a.popularity || 0);
            });

            const bestMatch = candidates[0];
            return bestMatch ? bestMatch.uri : null;

        } catch (error) {
            console.error('SpotifyService: Search error', error);
            return null;
        }
    }

    /**
     * Get the embed URL for a Spotify URI
     * @param {string} uri - spotify:album:id type URI
     * @returns {string} HTTP URL for iframe
     */
    getEmbedUrl(uri) {
        if (!uri) return '';
        // Convert 'spotify:album:123' to 'https://open.spotify.com/embed/album/123'
        const parts = uri.split(':');
        if (parts.length < 3) return '';
        const type = parts[1];
        const id = parts[2];
        return `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
    }
}

// Export as global
if (typeof window !== 'undefined') {
    window.SpotifyService = SpotifyService;
}
