// Spotify API Configuration
// No credentials live in the extension: the Soundtrack tab gets a short-lived catalogue
// token from the authenticated `spotifyToken` Cloud Function, which keeps the client
// secret in Firebase Secret Manager (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET).
const SPOTIFY_CONFIG = {
    TOKEN_PROXY_URL: 'https://us-central1-movielistdb-13208.cloudfunctions.net/spotifyToken',

    // API Endpoints
    ENDPOINTS: {
        SEARCH: 'https://api.spotify.com/v1/search'
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SPOTIFY_CONFIG;
} else if (typeof window !== 'undefined') {
    window.SPOTIFY_CONFIG = SPOTIFY_CONFIG;
} else if (typeof self !== 'undefined') {
    self.SPOTIFY_CONFIG = SPOTIFY_CONFIG;
}
