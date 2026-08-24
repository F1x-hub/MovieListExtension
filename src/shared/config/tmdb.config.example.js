// TMDB API Configuration Example
// Copy this file to tmdb.config.js and insert your TMDB Read Access Tokens / API Keys.
const TMDB_CONFIG = {
    BASE_URL: 'https://api.themoviedb.org/3',
    TMDB_PROXY_URL: 'https://us-central1-movielistdb-13208.cloudfunctions.net/tmdbProxy',

    // TMDB API Read Access Tokens / API Keys
    API_KEYS: [],
    currentKeyIndex: 0,

    // Stay below TMDB's approximate 40 requests/second service limit.
    MAX_REQUESTS_PER_SECOND: 35,
    DEFAULT_LANGUAGE: 'ru-RU',

    get API_KEY() {
        return this.API_KEYS[this.currentKeyIndex] || this.API_KEYS[0] || '';
    },

    rotateKey() {
        if (this.API_KEYS.length === 0) return '';
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.API_KEYS.length;
        console.log(`TMDB key rotated to index ${this.currentKeyIndex}`);
        return this.API_KEY;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TMDB_CONFIG;
} else if (typeof globalThis !== 'undefined') {
    globalThis.TMDB_CONFIG = TMDB_CONFIG;
} else if (typeof window !== 'undefined') {
    window.TMDB_CONFIG = TMDB_CONFIG;
} else {
    self.TMDB_CONFIG = TMDB_CONFIG;
}
