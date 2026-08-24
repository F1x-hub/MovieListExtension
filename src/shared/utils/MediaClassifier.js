/**
 * MediaClassifier - Centralized Semantic Content Classification for Home Discovery
 * Classifies media items into strict content categories: film, series, cartoon, anime.
 * 
 * Invariants:
 *  - film:    Live-action movies (mediaType === 'movie' AND !isAnimation)
 *  - series:  Live-action TV series (mediaType === 'tv' AND !isAnimation)
 *  - cartoon: Western / Non-Japanese animation (isAnimation AND !isAnime) [movies & TV]
 *  - anime:   Japanese animation (isAnimation AND isAnime) [movies & TV]
 *  - unknown: Insufficient semantic metadata (must NOT enter strict category sections)
 */

const TMDB_ANIMATION_GENRE_ID = 16;

/**
 * Check if a media item is animation (western or anime).
 * Handles TMDB numeric genre IDs, Kinopoisk string/object genres, and explicit type tags.
 * @param {Object} item
 * @returns {boolean}
 */
function isAnimation(item) {
    if (!item) return false;

    // 1. Check genreIds / genre_ids array (TMDB)
    const gIds = item.genreIds || item.genre_ids;
    if (Array.isArray(gIds) && gIds.includes(TMDB_ANIMATION_GENRE_ID)) {
        return true;
    }

    // 2. Check genres array with objects/strings/IDs (TMDB & Kinopoisk)
    if (Array.isArray(item.genres)) {
        const hasAnimGenre = item.genres.some(g => {
            if (typeof g === 'number') return g === TMDB_ANIMATION_GENRE_ID;
            if (g && typeof g.id === 'number') return g.id === TMDB_ANIMATION_GENRE_ID;
            if (typeof g === 'string') {
                const lower = g.toLowerCase().trim();
                return lower === 'animation' || lower === 'мультфильм' || lower === 'аниме' || lower === 'мультсериал';
            }
            if (g && typeof g.name === 'string') {
                const lower = g.name.toLowerCase().trim();
                return lower === 'animation' || lower === 'мультфильм' || lower === 'аниме' || lower === 'мультсериал';
            }
            return false;
        });
        if (hasAnimGenre) return true;
    }

    // 3. Check explicit type tags (Kinopoisk & internal models)
    if (item.type === 'cartoon' || item.type === 'anime' || item.type === 'animated-series' || item.type === 'anime-film') {
        return true;
    }

    return false;
}

/**
 * Check if an animation item is Japanese Anime.
 * Must be animation first, then validated against Japanese origin signals.
 * @param {Object} item
 * @returns {boolean}
 */
function isAnime(item) {
    if (!item) return false;
    if (!isAnimation(item)) return false;

    // 1. Check originalLanguage / original_language
    const lang = (item.originalLanguage || item.original_language || '').toLowerCase().trim();
    if (lang === 'ja' || lang === 'jpn' || lang === 'japanese') {
        return true;
    }

    // 2. Check originCountry / origin_country
    const originCountry = item.originCountry || item.origin_country;
    if (Array.isArray(originCountry) && originCountry.some(c => typeof c === 'string' && c.toUpperCase() === 'JP')) {
        return true;
    }

    // 3. Check production countries / countries list (TMDB & Kinopoisk)
    const countries = item.countries || item.production_countries || item.productionCountries;
    if (Array.isArray(countries)) {
        const isJpCountry = countries.some(c => {
            if (typeof c === 'string') {
                const lower = c.toLowerCase().trim();
                return lower === 'japan' || lower === 'япония' || lower === 'jp';
            }
            if (c && typeof c.iso_3166_1 === 'string') {
                return c.iso_3166_1.toUpperCase() === 'JP';
            }
            if (c && typeof c.name === 'string') {
                const lower = c.name.toLowerCase().trim();
                return lower === 'japan' || lower === 'япония';
            }
            return false;
        });
        if (isJpCountry) return true;
    }

    // 4. Check explicit anime genre tag in genres list
    if (Array.isArray(item.genres)) {
        const hasAnimeGenre = item.genres.some(g => {
            if (typeof g === 'string') return g.toLowerCase().trim() === 'аниме' || g.toLowerCase().trim() === 'anime';
            if (g && typeof g.name === 'string') return g.name.toLowerCase().trim() === 'аниме' || g.name.toLowerCase().trim() === 'anime';
            return false;
        });
        if (hasAnimeGenre) return true;
    }

    // 5. Check explicit type
    if (item.type === 'anime' || item.type === 'anime-film') {
        return true;
    }

    return false;
}

/**
 * Classify any media item into one of the strict Home categories.
 * Enforces metadata sufficiency policy: items with missing/empty genre information
 * return 'unknown' to prevent accidental classification of unparsed animation as live-action film.
 * @param {Object} item
 * @returns {'film'|'series'|'cartoon'|'anime'|'unknown'}
 */
function classifyHomeMedia(item) {
    if (!item || typeof item !== 'object') return 'unknown';

    // 1. Verify semantic metadata sufficiency
    const gIds = item.genreIds || item.genre_ids;
    const hasGenreIds = Array.isArray(gIds) && gIds.length > 0;
    const hasGenres = Array.isArray(item.genres) && item.genres.length > 0;
    const hasExplicitAnimType = item.type === 'cartoon' || item.type === 'anime' || item.type === 'animated-series' || item.type === 'anime-film';

    // If semantic metadata is entirely absent, item cannot be safely classified
    if (!hasGenreIds && !hasGenres && !hasExplicitAnimType) {
        return 'unknown';
    }

    // 2. Animation Branch (Western animation or Anime)
    if (isAnimation(item)) {
        return isAnime(item) ? 'anime' : 'cartoon';
    }

    // 3. Live-Action Branch (Film or Series)
    const isTv = item.mediaType === 'tv' || item.isSeries === true || (typeof item.type === 'string' && ['tv-series', 'tv-show', 'tv_series', 'mini-series', 'mini_series'].includes(item.type.toLowerCase().replace(/_/g, '-'))) || item.first_air_date !== undefined;
    return isTv ? 'series' : 'film';
}

/**
 * Unified Category Gate Helper.
 * Checks whether a candidate item strictly belongs to the requested section.
 * @param {Object} item
 * @param {'films'|'series'|'cartoons'|'anime'|'featured'} section
 * @returns {boolean}
 */
function isCandidateForSection(item, section) {
    if (!item) return false;
    if (section === 'featured') return true; // Featured showcase is mixed trending

    const category = classifyHomeMedia(item);

    switch (section) {
        case 'films':
            return category === 'film';
        case 'series':
            return category === 'series';
        case 'cartoons':
            return category === 'cartoon';
        case 'anime':
            return category === 'anime';
        default:
            return false;
    }
}

/**
 * Check if an animation item is Western / non-Japanese cartoon.
 * @param {Object} item
 * @returns {boolean}
 */
function isCartoon(item) {
    if (!item) return false;
    return isAnimation(item) && !isAnime(item);
}

const MediaClassifier = {
    TMDB_ANIMATION_GENRE_ID,
    isAnimation,
    isAnime,
    isCartoon,
    classifyHomeMedia,
    isCandidateForSection
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MediaClassifier;
}
if (typeof window !== 'undefined') {
    window.MediaClassifier = MediaClassifier;
}
if (typeof globalThis !== 'undefined') {
    globalThis.MediaClassifier = MediaClassifier;
}
