// Spotify API Configuration
const SPOTIFY_CONFIG = {
    // Replace these with your actual Spotify credentials from developer.spotify.com
    CLIENT_ID: '0d0884a66c3b40ba9461dfd8488cef74', 
    CLIENT_SECRET: '4b03d0b7949e46d18afa278e6496da97',
    
    // API Endpoints
    ENDPOINTS: {
        TOKEN: 'https://accounts.spotify.com/api/token',
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
