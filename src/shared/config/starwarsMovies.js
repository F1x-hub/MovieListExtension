export const EXPLICIT_KINOPOISK_IDS = new Set([
    // Original Trilogy
    447, // Episode IV: A New Hope
    448, // Episode V: The Empire Strikes Back
    449, // Episode VI: Return of the Jedi
    // Prequel Trilogy
    338, // Episode I: The Phantom Menace
    339, // Episode II: Attack of the Clones
    5619, // Episode III: Revenge of the Sith
    // Sequel Trilogy
    714888, // Episode VII: The Force Awakens
    840152, // Episode VIII: The Last Jedi
    902553, // Episode IX: The Rise of Skywalker
    // Stories & Animated
    840153, // Rogue One: A Star Wars Story
    706655, // Solo: A Star Wars Story
    279159, // Star Wars: The Clone Wars (Film)
    409640, // Star Wars: The Clone Wars (Series)
    773426, // Star Wars Rebels
    1048347, // The Mandalorian
    1227976, // Andor
    1301980, // Obi-Wan Kenobi
    1438541, // Ahsoka
    1438538, // The Book of Boba Fett
    1399370, // Star Wars: The Bad Batch
    1438543, // The Acolyte
    5046830, // Tales of the Jedi
    5046831, // Star Wars: Visions
    5046832  // Skeleton Crew
]);

export const EXCLUDED_KINOPOISK_IDS = new Set();

const STARWARS_TITLE_PATTERN = /зв[её]здны[еяm]?\s+войн[ыаменам]|star[\s-]?wars|мандалорец|mandalorian|асока|ahsoka|боба\s+фетт|boba\s+fett|андор|andor|кеноби|kenobi|бракованная\s+партия|bad\s+batch|аколит|acolyte/i;

export function isStarWarsMovie(movie) {
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

    return namesToCheck.some(name => STARWARS_TITLE_PATTERN.test(name));
}
