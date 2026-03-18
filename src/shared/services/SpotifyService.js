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
            // Refined Query: Search for both albums and playlists
            // Using boolean OR to catch variations but process filtering client-side
            const query = encodeURIComponent(`${movieTitle} soundtrack`);
            const url = `${this.config.ENDPOINTS.SEARCH}?q=${query}&type=album,playlist&limit=50`; // Increased limit for better filtering

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) return null;

            const data = await response.json();
            
            let candidates = [];
            if (data.albums && data.albums.items) {
                candidates = candidates.concat(data.albums.items.map((item, index) => ({ ...item, _searchType: 'album', _spotifyRank: index })));
            }
            if (data.playlists && data.playlists.items) {
                candidates = candidates.concat(data.playlists.items.map((item, index) => ({ ...item, _searchType: 'playlist', _spotifyRank: index })));
            }

            if (candidates.length === 0) return null;

            const targetTitle = movieTitle.toLowerCase();
            const targetYear = year ? parseInt(year) : null;

            const normalize = str => str.replace(/[^\w\sа-яА-Я]/g, '').trim().replace(/\s+/g, ' ');
            const normalizedTarget = normalize(targetTitle);

            // Algorithm Steps:

            // 1. Scoring Function
            // Assign points based on relevance
            candidates.forEach(item => {
                let score = 0;
                const name = item.name ? item.name.toLowerCase() : '';
                
                // Native Spotify Relevance (Top results reliably have high followers/popularity)
                if (item._spotifyRank !== undefined) {
                    score += Math.max(0, 20 - item._spotifyRank);
                }

                // Official Spotify playlist bonus
                if (item._searchType === 'playlist' && item.owner && (item.owner.id === 'spotify' || item.owner.display_name === 'Spotify')) {
                    score += 30;
                }

                // Prioritize official albums if they exist
                if (item._searchType === 'album') {
                    score += 10;
                }

                // A. Title Match (Critical)
                if (name.includes(targetTitle)) {
                    score += 50;
                    // Boost for exact starts-with match
                    if (name.startsWith(targetTitle)) score += 20;
                } else {
                    // Penalty if title is widely different (but search API is fuzzy)
                    score -= 50; 
                }

                // B. Year Match (High Importance) - Only for albums
                // Soundtracks usually release same year or year +/- 1
                if (item._searchType === 'album' && targetYear && item.release_date) {
                    const albumYear = parseInt(item.release_date.split('-')[0]);
                    if (!isNaN(albumYear)) {
                        const diff = Math.abs(targetYear - albumYear);
                        if (diff === 0) score += 30;
                        else if (diff <= 1) score += 20;
                        else if (diff <= 2) score += 10;
                        // No negative penalty for diff > 2 because official "Complete Scores" and remasters often release decades later
                    }
                }

                // C. Compensation for Playlists with strong title matches
                if (item._searchType === 'playlist' && name.includes(targetTitle)) {
                    score += 15;
                }

                // D. Keyword Match (Specificity)
                if (name.includes('original motion picture soundtrack') || name.includes('original motion picture score')) {
                    score += 20;
                } else if (name.includes('soundtrack') || name.includes('ost') || name.includes('саундтрек')) {
                    score += 10;
                }

                // E. Exact Match Bonus
                // Strip common irrelevant keywords then find exact matching title
                let cleanName = name
                    .replace(/original motion picture soundtrack/g, '')
                    .replace(/original motion picture score/g, '')
                    .replace(/soundtracks/g, '')
                    .replace(/soundtrack/g, '')
                    .replace(/ost/g, '')
                    .replace(/саундтрек/g, '')
                    .replace(/themes/g, '')
                    .replace(/theme/g, '')
                    .replace(/music/g, '')
                    .replace(/from/g, '');
                    
                cleanName = normalize(cleanName);

                if (cleanName === normalizedTarget) {
                    score += 50; // Huge bonus for exactly matching the movie title when ignoring "soundtrack" words
                } else if (cleanName && normalizedTarget && (cleanName.startsWith(normalizedTarget + ' ') || cleanName.endsWith(' ' + normalizedTarget))) {
                    score += 10;
                }

                item._relevanceScore = score;
            });

            // 2. Filter out low relevance
            // Must have positive score (implies at least title match + some other factor)
            candidates = candidates.filter(c => c._relevanceScore > 0);

            if (candidates.length === 0) {
                 // Try looser search if strict filtering failed
                 // Rely on the API recall. If nothing matches our title, better to show nothing than wrong item.
                 return null;
            }

            // 3. Sort by Score DESC, then Spotify Rank ASC, then Popularity DESC
            candidates.sort((a, b) => {
                if (b._relevanceScore !== a._relevanceScore) {
                    return b._relevanceScore - a._relevanceScore;
                }
                
                // If scores are tied, trust Spotify's original search ranking
                // Spotify search natively sorts by high popularity and saves
                if (a._spotifyRank !== undefined && b._spotifyRank !== undefined) {
                    return a._spotifyRank - b._spotifyRank;
                }
                
                // Fallback to popularity
                const aPop = a.popularity || 0;
                const bPop = b.popularity || 0;
                
                return bPop - aPop;
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
