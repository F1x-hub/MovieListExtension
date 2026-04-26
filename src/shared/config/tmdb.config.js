const TMDB_API_KEY = '6bbdd64f9b1ec1b13b153ca3981ee6ce';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const TMDB_CONFIG = {
    API_KEY: TMDB_API_KEY,
    BASE_URL: TMDB_BASE_URL
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

export { TMDB_API_KEY, TMDB_BASE_URL, TMDB_CONFIG };
