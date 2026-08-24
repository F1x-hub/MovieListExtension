// Venom films are intentionally omitted: Spider-Man is not their lead character.
export const EXPLICIT_KINOPOISK_IDS = new Set([
    838, 2898, 82441,
    278217, 602409,
    690593, 1008445, 1309570, 5494049,
    920265, 1219177,
    435, 464870, 77439, 436329, 95340, 409894, 579499, 961708, 5022877
]);

export const EXCLUDED_KINOPOISK_IDS = new Set();

const SPIDERMAN_TITLE_PATTERN = /человек[\s-]?паук|spider[\s-]?man/i;

export function isSpidermanMovie(movie) {
    if (!movie) return false;

    const kinopoiskId = Number(movie.kinopoiskId || movie.id || movie.kpId || movie.movieId);

    if (EXCLUDED_KINOPOISK_IDS.has(kinopoiskId)) return false;
    if (EXPLICIT_KINOPOISK_IDS.has(kinopoiskId)) return true;

    const namesToCheck = [
        movie.name,
        movie.title,
        movie.movieTitle,
        movie.nameRu,
        movie.alternativeName,
        movie.enName,
        movie.originalTitle,
        movie.nameOriginal,
        movie.nameEn
    ].filter(Boolean);

    return namesToCheck.some(name => SPIDERMAN_TITLE_PATTERN.test(name));
}

