// Kinopoisk API Configuration
const KINOPOISK_CONFIG = {
    // Base URL for Kinopoisk API
    BASE_URL: 'https://api.kinopoisk.dev/v1.4',
    
    // API Key - replace with your actual key
    API_KEY: 'Q6Q938P-CG3M56S-GKJRF4P-J3TSZ6S',
    
    // Default request parameters
    DEFAULT_LIMIT: 20,
    DEFAULT_PAGE: 1,
    
    // Cache settings
    CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    
    // Endpoints
    ENDPOINTS: {
        SEARCH: '/movie/search',
        MOVIE: '/movie'
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KINOPOISK_CONFIG;
} else {
    window.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
}
