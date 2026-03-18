// Kinopoisk API Configuration
const KINOPOISK_CONFIG = {
    // Base URL for Kinopoisk API
    BASE_URL: 'https://api.kinopoisk.dev/v1.4',
    
    // Array of API Keys for rotation
    API_KEYS: [
        'Q6Q938P-CG3M56S-GKJRF4P-J3TSZ6S',
        'ZX91BN3-Q1H4T4X-KEPN3J5-288P8B3'
        // Add additional keys here
    ],
    
    // Index of the currently active key
    currentKeyIndex: 0,
    
    // Get the currently active API key
    get API_KEY() {
        return this.API_KEYS[this.currentKeyIndex] || this.API_KEYS[0];
    },
    
    // Rotate to the next available key
    rotateKey() {
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.API_KEYS.length;
        console.log(`Rotated to API Key index: ${this.currentKeyIndex}`);
        return this.API_KEY;
    },
    
    // Default request parameters
    DEFAULT_LIMIT: 20,
    DEFAULT_PAGE: 1,
    
    // Cache settings
    CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    
    // Endpoints
    ENDPOINTS: {
        SEARCH: '/movie/search',
        MOVIE: '/movie',
        RANDOM: '/movie/random'
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KINOPOISK_CONFIG;
} else if (typeof globalThis !== 'undefined') {
    globalThis.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
} else if (typeof window !== 'undefined') {
    window.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
} else {
    self.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
}
