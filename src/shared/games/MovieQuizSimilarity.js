/**
 * Wrong answers that look like the right one.
 *
 * Random wrong answers give the question away: a plot about a Roman general
 * next to «Матрица», «Интерстеллар» and «Леон» leaves one choice. Each movie is
 * described by its genres, its year and setting/theme tags; tags come from the
 * bundled reference pool or, for the player's own movies, from words of the
 * plot. Wrong answers are the candidates closest to the right one.
 */

export const REFERENCE_POOL_PATH = 'src/shared/data/games/movie-quiz/reference-pool.json';

// Word stems (lower case, ё as е) that put a plot into a setting or a theme.
const TAG_STEMS = {
    antiquity: ['гладиат', 'легион', 'фараон', 'спартан', 'античн', 'цезар', 'император', 'древнего рима', 'древний рим', 'римск', 'рабств', 'сенатор'],
    medieval: ['рыцар', 'средневек', 'крестонос', 'викинг', 'феодал', 'князь', 'княже', 'королевств', 'монгол'],
    historical: ['дворян', 'графин', 'царск', ' царь', ' царя', ' царю', 'революц', 'викториан', 'xix век', 'xviii век', 'аристократ', 'холоп', 'крепостн', ' барин', ' барыня', 'помещик', 'усадьб', 'декабрист'],
    war: [' войн', 'солдат', 'фронт', 'армии', 'армия', 'нацист', 'фашист', 'окоп', 'блокад', 'десант', 'взвод', 'сражен', 'битв', 'генерал'],
    western: ['ковбо', 'шериф', 'дикий запад', 'дикого запада', 'индейц', 'ранчо', 'охотник за головами', 'салун'],
    space: ['космос', 'космич', 'космонавт', 'астронавт', 'планет', 'галактик', 'звездол', 'орбит', ' марс', 'червоточин', 'черной дыр', 'черная дыра', 'вселенн', 'межзвездн'],
    aliens: ['пришел', 'инопланет', 'внеземн'],
    future: ['будущ', 'антиутоп', 'армии машин', 'армия машин', 'восстани машин', 'против машин', 'с машинами'],
    ai: ['робот', 'андроид', 'киборг', 'искусственн', 'армии машин', 'армия машин', 'восстани машин', 'против машин', 'с машинами', 'мир машин'],
    postapoc: ['апокалип', 'постапокал', 'пустош', 'после конца света'],
    time: ['во времени', 'машину времени', 'машина времени', 'в прошлое', 'временн', ' петл'],
    mind: ['сознани', 'памят', 'сновиден', 'реальност', 'иллюзи', 'психиатр'],
    crime: ['преступ', 'бандит', ' банд', 'гангстер', 'наркот', 'убийств', 'мошен', 'криминал'],
    mafia: ['мафи', 'гангстер', ' клан'],
    heist: ['ограблен', 'грабител', 'сейф', 'налет', 'аферист'],
    hitman: ['киллер', 'наемн', 'убийца'],
    police: ['полиц', 'детектив', 'следовател', 'фбр', 'сыщик', 'инспектор'],
    maniac: ['маньяк', 'серийн'],
    prison: ['тюрьм', 'заключенн', 'побег из', 'надзират', 'смертник'],
    spy: ['шпион', 'разведчик', 'спецагент', ' агент'],
    romance: ['любов', 'влюб', 'свадьб', 'невест', 'возлюбленн'],
    superhero: ['супергер', 'сверхспособ', 'суперсил', 'мутант'],
    magic: ['волшеб', 'магии', 'магическ', 'чародей', 'колдун', 'ведьм', 'заклинан', ' чудо'],
    fantasy: ['дракон', 'эльф', 'гном', 'орк', 'хоббит', 'волшебн'],
    horror: ['ужас', 'кошмар', 'проклят', 'нечист'],
    ghost: ['призрак', 'привидени', 'мертвец', 'духи', 'загробн'],
    demon: ['демон', 'одержим', 'экзорц', 'дьявол'],
    monster: ['монстр', 'чудовищ', 'тварь', 'твари', 'клоун', 'существ', 'динозавр', 'юрск', 'ящер', 'акул', 'гигантск'],
    zombie: ['зомби', 'живых мертв'],
    disaster: ['катастроф', 'цунами', 'землетряс', 'вирус', 'эпидеми', 'крушени', 'извержени'],
    survival: ['выжи', 'необитаем', 'выбраться'],
    sea: ['океан', 'корабл', 'лайнер', 'пират', 'подводн', 'морск', 'в море', 'капитан', ' остров'],
    plane: ['самолет', 'пилот', 'летчик', 'авиа'],
    sport: ['чемпион', 'тренер', ' матч', ' бокс', 'хоккей', 'футбол', 'баскетбол', 'олимпи', 'спортсм', 'турнир', ' гонк'],
    music: ['музык', 'певиц', 'певец', 'джаз', 'концерт', 'рок-', 'пианист', 'музыкант'],
    school: ['школ', 'студент', 'одноклассн', 'колледж', 'университет'],
    animals: ['собак', 'пес ', 'щенок', 'кот ', ' звер', 'животн', 'львен', 'волк', 'мамонт', ' тигр', ' лев ', 'ленивец', ' панд', 'обезьян', 'пингвин', 'медвед', 'кролик', ' лис ', ' лиса', 'енот'],
    ussr: ['советск', 'ссср', 'колхоз', 'пионер'],
    newyear: ['новый год', 'новогодн', 'рождеств'],
    science: ['ученый', 'ученые', 'математик', 'физик', 'изобретат'],
    business: ['миллион', 'бизнес', 'биржев', 'брокер', 'стартап'],
    hospital: ['больниц', 'врач', 'пациент', 'болезн', 'парализ'],
    russia: ['российск', 'россии', 'россия', 'москв', 'петербург', 'девяност']
};

// Genres that pin a theme down. Broad ones («фэнтези», «криминал») are left out:
// Kinopoisk gives «фэнтези» to horror films too.
const GENRE_TAGS = {
    военный: 'war',
    вестерн: 'western',
    ужасы: 'horror',
    спорт: 'sport',
    музыка: 'music',
    мюзикл: 'music',
    мелодрама: 'romance'
};

// Tags a reference-pool entry may carry: the plot tags, the genre tags and a few
// themes that only hand-written entries have.
export const KNOWN_TAGS = new Set([...Object.keys(TAG_STEMS), ...Object.values(GENRE_TAGS), 'family', 'cars', 'friendship', 'road']);

const ANIMATION_GENRES = new Set(['мультфильм', 'аниме']);
// Kinopoisk countries of rated movies (from the shared movie cache).
const COUNTRY_TAGS = { ссср: ['ussr'], россия: ['russia'] };
// Where and when a film is set is what a frame or a plot shows first, so a
// shared era outweighs a shared theme, and both outweigh a shared genre:
// a period frame among modern comedies gives itself away.
export const ERA_TAGS = new Set(['antiquity', 'medieval', 'historical', 'western', 'future', 'space', 'postapoc', 'ussr', 'russia']);
const ERA_WEIGHT = 4.5;
const TAG_WEIGHT = 3;
const GENRE_WEIGHT = 1;
const MAX_YEAR_PENALTY = 2.5;
// A series among films stands out as much as a cartoon among live action.
const SERIES_MISMATCH_PENALTY = 8;
// Science fiction shows in a frame or a plot (machines, dinosaurs, spaceships):
// a non-fiction film among fiction answers, or the reverse, is easy to rule out.
const SCI_FI_GENRE = 'фантастика';
const SCI_FI_MISMATCH_PENALTY = 4;
// A cartoon among live-action answers (or the other way round) is spotted at a glance.
const ANIMATION_MISMATCH_PENALTY = 10;
// Soviet or Russian films next to Hollywood ones stand out the same way.
const ORIGIN_MISMATCH_PENALTY = 4;
const ORIGIN_TAGS = ['ussr', 'russia'];

function normalize(text) {
    return String(text || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/**
 * Tags a plot points to. Stems match inside words; a stem that starts with a
 * space only matches at a word start (« войн» is war, «двойник» is not).
 */
export function tagsFromText(text) {
    const haystack = ` ${normalize(text).replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;
    if (haystack.trim().length === 0) return [];
    return Object.entries(TAG_STEMS)
        .filter(([, stems]) => stems.some(stem => haystack.includes(stem)))
        .map(([tag]) => tag);
}

const profiles = new WeakMap();

/** Genres, tags, year and kind of a movie, worked out once per object. */
export function profileOf(movie) {
    if (!movie || typeof movie !== 'object') return { genres: new Set(), tags: new Set(), year: null, animated: false, series: false };
    const cached = profiles.get(movie);
    if (cached) return cached;
    const genres = new Set((Array.isArray(movie.genres) ? movie.genres : [])
        .map(genre => normalize(typeof genre === 'object' ? genre?.name : genre).trim())
        .filter(Boolean));
    const countries = (Array.isArray(movie.countries) ? movie.countries : [])
        .map(country => normalize(typeof country === 'object' ? country?.name : country).trim());
    const handTags = Array.isArray(movie.tags) ? movie.tags : [];
    // Reference entries carry hand-set tags; other movies get theirs from plot,
    // genres and countries.
    const tags = new Set(handTags.length ? handTags : [
        // Without a plot the title helps: «Парк Юрского периода» says dinosaurs.
        ...tagsFromText(movie.description || movie.name),
        ...[...genres].map(genre => GENRE_TAGS[genre]).filter(Boolean),
        ...countries.flatMap(country => COUNTRY_TAGS[country] || [])
    ]);
    const type = normalize(movie.type);
    const year = Number(movie.year);
    const profile = {
        genres,
        tags,
        year: Number.isInteger(year) && year > 1800 ? year : null,
        animated: [...genres].some(genre => ANIMATION_GENRES.has(genre)),
        series: movie.isSeries === true || type.includes('series') || type.includes('сериал')
    };
    profiles.set(movie, profile);
    return profile;
}

function overlap(left, right) {
    let count = 0;
    for (const item of left) if (right.has(item)) count += 1;
    return count;
}

/** How alike two movies are; higher is closer. */
export function similarity(target, candidate) {
    const a = profileOf(target);
    const b = profileOf(candidate);
    let score = GENRE_WEIGHT * overlap(a.genres, b.genres);
    for (const tag of a.tags) {
        if (b.tags.has(tag)) score += ERA_TAGS.has(tag) ? ERA_WEIGHT : TAG_WEIGHT;
    }
    score -= a.year && b.year ? Math.min(MAX_YEAR_PENALTY, Math.abs(a.year - b.year) / 10) : 1;
    if (a.animated !== b.animated) score -= ANIMATION_MISMATCH_PENALTY;
    if (a.series !== b.series) score -= SERIES_MISMATCH_PENALTY;
    if (a.genres.has(SCI_FI_GENRE) !== b.genres.has(SCI_FI_GENRE)) score -= SCI_FI_MISMATCH_PENALTY;
    const aOrigin = ORIGIN_TAGS.some(tag => a.tags.has(tag));
    const bOrigin = ORIGIN_TAGS.some(tag => b.tags.has(tag));
    if (aOrigin !== bOrigin) score -= ORIGIN_MISMATCH_PENALTY;
    return score;
}

/**
 * Candidates from closest to farthest. A small random jitter keeps repeated
 * questions from always showing the same three answers.
 */
export function rankBySimilarity(target, candidates, { random = Math.random, jitter = 1, bonus = () => 0 } = {}) {
    return candidates
        .map(candidate => ({ candidate, score: similarity(target, candidate) + bonus(candidate) + random() * jitter }))
        .sort((left, right) => right.score - left.score)
        .map(entry => entry.candidate);
}

/** Pool entries in the shape the quiz uses. */
export function normalizeReferencePool(data) {
    const movies = Array.isArray(data?.movies) ? data.movies : [];
    return movies
        .filter(entry => typeof entry?.n === 'string' && entry.n.trim())
        .map((entry, index) => ({
            kinopoiskId: `pool_${index + 1}`,
            name: entry.n.trim(),
            year: Number(entry.y) || null,
            genres: Array.isArray(entry.g) ? entry.g : [],
            tags: Array.isArray(entry.t) ? entry.t : [],
            isReference: true
        }));
}

let poolPromise = null;

/** Loads the bundled reference pool once per page; an empty pool on failure. */
export function loadReferencePool({ fetchImpl = globalThis.fetch, getUrl = path => globalThis.chrome?.runtime?.getURL?.(path) || path } = {}) {
    if (!poolPromise) {
        poolPromise = Promise.resolve()
            .then(() => fetchImpl(getUrl(REFERENCE_POOL_PATH)))
            .then(response => {
                if (!response?.ok) throw new Error(`Reference pool HTTP ${response?.status}`);
                return response.json();
            })
            .then(normalizeReferencePool)
            .catch(error => {
                console.warn('[MovieQuiz] Reference pool unavailable:', error?.message || error);
                poolPromise = null;
                return [];
            });
    }
    return poolPromise;
}
