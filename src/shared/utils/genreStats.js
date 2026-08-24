/**
 * GenreStats Utility - Calculates top-3 most rated genres
 */

/**
 * Calculate top-N genres from a list of movie genres
 * @param {Array<string|Object>} genresList - List of genre strings or objects with .name
 * @param {number} limit - Maximum number of top genres to return (default 3)
 * @returns {Array<string>} - Array of 0-3 top genre names
 */
function calculateTopGenres(genresList, limit = 3) {
    if (!Array.isArray(genresList) || genresList.length === 0) {
        return [];
    }

    const counts = {};
    for (const genre of genresList) {
        if (!genre) continue;
        const name = typeof genre === 'string' ? genre.trim() : (genre.name ? String(genre.name).trim() : (genre.genre ? String(genre.genre).trim() : ''));
        if (!name || name.toLowerCase() === 'unknown') continue;

        // Capitalize first letter for display consistency
        const normalized = name.charAt(0).toUpperCase() + name.slice(1);
        counts[normalized] = (counts[normalized] || 0) + 1;
    }

    return Object.keys(counts)
        .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'ru'))
        .slice(0, limit);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculateTopGenres };
}
if (typeof window !== 'undefined') {
    window.calculateTopGenres = calculateTopGenres;
}
