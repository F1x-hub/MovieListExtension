/**
 * Invented titles standing in for TMDB, so a screenshot never depends on what
 * is trending today. Identifiers are stable; posters are generated from them.
 */

const RELEASE_DATE = '2026-03-14';
const FIRST_AIR_DATE = '2026-02-07';

const TITLES = {
    featured: ['Северный перевал', 'Последний рейс', 'Шум прибоя', 'Город без карт', 'Тихая гавань', 'Зимний обход', 'Ночной смотритель', 'Вторая луна', 'Дорога на юг', 'Письмо из бухты'],
    films: ['Дальний свет', 'Часовая мастерская', 'Без обратного адреса', 'Красный маяк', 'Девятый вагон', 'Стеклянный дом', 'Пыль и соль', 'Перекрёсток', 'Осенний марафон теней', 'Холодный чай', 'Старая пристань', 'Узкий мост'],
    series: ['Смена караула', 'Дом на сваях', 'Хроники порта', 'Шестой отдел', 'Чужие письма', 'Долгая зима', 'Район семь', 'Точка сборки', 'Ночной рейс', 'Сводки с берега', 'Верхний город', 'Тёмная вода'],
    cartoons: ['Лис и фонарь', 'Облачная почта', 'Кот-картограф', 'Сад на крыше', 'Мышонок и маяк', 'Большая стирка', 'Ёжик-штурман', 'Город зонтов', 'Страна пуговиц', 'Медведь-почтальон', 'Звёздный сачок', 'Лодка из бумаги'],
    anime: ['Хранитель ветра', 'Школа на обрыве', 'Клинок рассвета', 'Сигнал с луны', 'Лето без конца', 'Город шестерёнок', 'Песня дождя', 'Последний поезд', 'Небесный архив', 'Дневник мастера', 'Шёпот леса', 'Огни залива']
};

const SECTION_ID_BASE = { featured: 91000, films: 92000, series: 93000, cartoons: 94000, anime: 95000 };

function toItem(section, title, index) {
    const id = SECTION_ID_BASE[section] + index + 1;
    const isTv = section === 'series' || section === 'anime';
    const common = {
        id,
        overview: `«${title}» — вымышленное описание фильма для автоматической проверки интерфейса расширения.`,
        poster_path: `/e2e-poster-${id}.jpg`,
        backdrop_path: `/e2e-backdrop-${id}.jpg`,
        vote_average: 7.1 + (index % 5) / 10,
        vote_count: 4200 + index * 10,
        popularity: 900 - index,
        adult: false,
        genre_ids: section === 'cartoons' || section === 'anime' ? [16] : isTv ? [18] : [28, 18],
        original_language: section === 'anime' ? 'ja' : 'en'
    };
    return isTv
        ? { ...common, name: title, original_name: `Original ${id}`, first_air_date: FIRST_AIR_DATE, origin_country: section === 'anime' ? ['JP'] : ['US'], media_type: 'tv' }
        : { ...common, title, original_title: `Original ${id}`, release_date: RELEASE_DATE, media_type: 'movie' };
}

const SECTIONS = Object.fromEntries(Object.entries(TITLES)
    .map(([section, titles]) => [section, titles.map((title, index) => toItem(section, title, index))]));
const BY_ID = new Map(Object.values(SECTIONS).flat().map(item => [item.id, item]));

function page(results, requestedPage = 1) {
    const slice = Number(requestedPage) === 1 ? results : [];
    return { page: Number(requestedPage), results: slice, total_pages: 1, total_results: results.length };
}

function movieDetails(item) {
    return {
        ...item,
        imdb_id: `tt${String(item.id).padStart(7, '0')}`,
        tagline: 'Вымышленный фильм для проверки интерфейса',
        runtime: 112,
        status: 'Released',
        genres: [{ id: 28, name: 'боевик' }, { id: 18, name: 'драма' }],
        production_companies: [],
        production_countries: [{ iso_3166_1: 'US', name: 'США' }],
        spoken_languages: [{ iso_639_1: 'en', name: 'English' }],
        belongs_to_collection: null,
        credits: { cast: [], crew: [] },
        release_dates: { results: [] },
        videos: { results: [] },
        images: { backdrops: [], logos: [], posters: [] },
        external_ids: { imdb_id: `tt${String(item.id).padStart(7, '0')}` }
    };
}

function tvDetails(item) {
    return {
        ...item,
        tagline: '',
        status: 'Returning Series',
        in_production: true,
        number_of_seasons: 1,
        number_of_episodes: 8,
        episode_run_time: [45],
        last_air_date: FIRST_AIR_DATE,
        next_episode_to_air: null,
        seasons: [],
        genres: [{ id: 18, name: 'драма' }],
        networks: [],
        production_companies: [],
        production_countries: [],
        spoken_languages: [],
        credits: { cast: [], crew: [] },
        videos: { results: [] },
        content_ratings: { results: [] },
        images: { backdrops: [], logos: [], posters: [] },
        external_ids: {}
    };
}

/** Answers one TMDB URL. Anything not listed is an empty result, as for an obscure title. */
function respond(tmdbUrl) {
    const url = new URL(tmdbUrl);
    const path = url.pathname.replace(/^\/3/, '');
    const pageNumber = url.searchParams.get('page') || 1;
    if (path === '/trending/movie/week') return page(SECTIONS.featured, pageNumber);
    if (path === '/movie/now_playing') return page(SECTIONS.films, pageNumber);
    if (path === '/trending/tv/week') return page(SECTIONS.series, pageNumber);
    if (path === '/discover/movie') {
        if (url.searchParams.has('with_keywords')) return page(SECTIONS.films, pageNumber);
        const isCartoon = url.searchParams.get('with_genres') === '16' && !url.searchParams.has('with_original_language');
        return page(isCartoon ? SECTIONS.cartoons : [], pageNumber);
    }
    if (path === '/discover/tv') {
        return page(url.searchParams.get('with_original_language') === 'ja' ? SECTIONS.anime : [], pageNumber);
    }
    const details = /^\/(movie|tv)\/(\d+)$/.exec(path);
    if (details) {
        const item = BY_ID.get(Number(details[2]));
        if (!item) return null;
        return details[1] === 'movie' ? movieDetails(item) : tvDetails(item);
    }
    return page([], pageNumber);
}

function hueFor(id) {
    return (Number(id) * 47) % 360;
}

function posterSvg(id, kind) {
    const hue = hueFor(id);
    const [width, height] = kind === 'backdrop' ? [1280, 720] : [500, 750];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="hsl(${hue}, 45%, 38%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360}, 45%, 16%)"/>
        </linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <circle cx="${width * 0.72}" cy="${height * 0.3}" r="${width * 0.14}" fill="hsl(${hue}, 60%, 70%)" opacity="0.35"/>
    </svg>`;
}

/**
 * The Home click resolves a TMDB card to Kinopoisk through a scrape of the live
 * site. That lookup is seeded as an already verified result, as a returning
 * user's cache would hold it, so the journey needs no third-party HTML.
 */
function kinopoiskMappings(updatedAt) {
    const mappings = {};
    for (const section of ['featured', 'films', 'cartoons']) {
        for (const item of SECTIONS[section]) {
            mappings[`movie:${item.id}`] = {
                status: 'resolved',
                kpId: kinopoiskIdFor(item.id),
                tmdbId: item.id,
                mediaType: 'movie',
                title: item.title,
                originalTitle: item.original_title,
                year: Number(item.release_date.slice(0, 4)),
                resolvedMediaType: 'movie',
                source: 'kinopoisk-html',
                verified: true,
                kpRating: item.vote_average,
                kpVotes: item.vote_count,
                imdbRating: item.vote_average,
                imdbId: `tt${String(item.id).padStart(7, '0')}`,
                updatedAt
            };
        }
    }
    return mappings;
}

function kinopoiskIdFor(tmdbId) {
    return 5000000 + Number(tmdbId);
}

module.exports = { SECTIONS, respond, posterSvg, kinopoiskMappings, kinopoiskIdFor };
