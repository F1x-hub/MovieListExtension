/**
 * Real films, as the Kinopoisk API describes them. Only the card comes from here:
 * the sources have to find and play the film themselves. `runtimeMinutes` with
 * `lengthTolerance` is how a test tells the film from a placeholder or a trailer;
 * a series varies more from episode to episode.
 */
const FILM = {
    id: 258687,
    name: 'Интерстеллар',
    alternativeName: 'Interstellar',
    enName: 'Interstellar',
    type: 'movie',
    year: 2014,
    movieLength: 169,
    runtimeMinutes: 169,
    lengthTolerance: 0.1,
    description: 'Космическая экспедиция ищет новый дом для человечества.',
    rating: { kp: 8.6, imdb: 8.7 },
    votes: { kp: 900000, imdb: 2000000 },
    genres: [{ name: 'фантастика' }, { name: 'драма' }],
    countries: [{ name: 'США' }],
    externalId: { imdb: 'tt0816692', tmdb: 157336 },
    isSeries: false
};

const SERIES = {
    id: 404900,
    name: 'Во все тяжкие',
    alternativeName: 'Breaking Bad',
    enName: 'Breaking Bad',
    type: 'tv-series',
    year: 2008,
    seriesLength: 47,
    runtimeMinutes: 47,
    lengthTolerance: 0.45,
    description: 'Учитель химии узнаёт о смертельной болезни и начинает варить метамфетамин.',
    rating: { kp: 8.9, imdb: 9.5 },
    votes: { kp: 700000, imdb: 2000000 },
    genres: [{ name: 'драма' }, { name: 'криминал' }],
    countries: [{ name: 'США' }],
    externalId: { imdb: 'tt0903747', tmdb: 1396 },
    isSeries: true,
    // As measured on the real streams: the check that an episode is the one named.
    episodeMinutes: { S1E1: 58, S1E2: 48, S2E3: 47 },
    seasonsInfo: [
        { number: 1, episodesCount: 7 }, { number: 2, episodesCount: 13 }, { number: 3, episodesCount: 13 },
        { number: 4, episodesCount: 13 }, { number: 5, episodesCount: 16 }
    ]
};

const ANIME = {
    id: 5064506,
    name: 'Фрирен, провожающая в последний путь',
    alternativeName: "Sousou no Frieren",
    enName: "Frieren: Beyond Journey's End",
    type: 'anime',
    year: 2023,
    seriesLength: 25,
    runtimeMinutes: 25,
    lengthTolerance: 0.3,
    description: 'Эльфийка-волшебница заново открывает мир после смерти спутников.',
    rating: { kp: 8.7, imdb: 8.9 },
    votes: { kp: 50000, imdb: 80000 },
    genres: [{ name: 'аниме' }, { name: 'мультфильм' }, { name: 'фэнтези' }],
    countries: [{ name: 'Япония' }],
    externalId: { imdb: 'tt22248376', tmdb: 209867 },
    isSeries: true,
    seasonsInfo: [{ number: 1, episodesCount: 28 }]
};

module.exports = { FILM, SERIES, ANIME, ALL_FILMS: [FILM, SERIES, ANIME] };
