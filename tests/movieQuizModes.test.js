import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="movieQuiz"></div></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.DOMException = dom.window.DOMException;
const store = {};
globalThis.chrome = {
    runtime: { getURL: path => path },
    storage: {
        local: {
            get: async key => ({ [key]: store[key] }),
            set: async value => { Object.assign(store, value); }
        }
    }
};

// The quiz fetches its bundled reference pool; serve it from the repository.
const { readFile } = await import('node:fs/promises');
globalThis.fetch = async url => {
    const body = await readFile(new URL(`../${url}`, import.meta.url), 'utf8');
    return { ok: true, json: async () => JSON.parse(body) };
};

const {
    clipDescription, maskDescription, pointsFor, availableTypes, planQuestionTypes,
    POSTER_REVEAL_MS, POSTER_MAX_POINTS, POSTER_MIN_POINTS
} = await import('../src/shared/games/MovieQuizQuestions.js');
const {
    loadLibraryMovies, movieFromListDoc, movieFromCachedMovie, safePosterUrl, clearLibraryCache, QuizLibraryError
} = await import('../src/shared/games/MovieQuizLibrary.js');
const { MovieQuizGame } = await import('../src/shared/games/MovieQuizGame.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const plot = 'Программист Нео узнаёт, что мир вокруг него — иллюзия. Вместе с Морфеусом он выходит из Матрицы и вступает в войну с машинами, которые держат людей в плену.';

// --- Plot questions hide the title and names, not the sentence starts --------
{
    const segments = maskDescription(plot, 'Матрица');
    assert.ok(segments, 'a full plot makes a question');
    const hidden = segments.filter(segment => segment.masked).map(segment => segment.text);
    assert.deepEqual(hidden, ['Нео', 'Морфеусом', 'Матрицы'], 'names and the title in any case form are hidden');
    assert.equal(segments.map(segment => segment.text).join(''), plot, 'the segments rebuild the summary');
    assert.ok(!hidden.includes('Программист') && !hidden.includes('Вместе'), 'a capital at a sentence start is kept');

    assert.equal(maskDescription('Короткий текст.', 'Фильм'), null, 'a short summary is not a question');
    assert.equal(maskDescription('Анна Петрова и Иван Сидоров. Мария Кузнецова, Пётр Смирнов, Ольга Иванова, Дмитрий Орлов и Сергей Волков.', 'Друзья'),
        null, 'a summary that would be mostly hidden is not used');

    const long = `${'Слово '.repeat(30)}конец. ${'Ещё '.repeat(80)}`;
    const clipped = clipDescription(long, 200);
    assert.ok(clipped.length <= 201 && clipped.endsWith('.'), 'a long summary is cut at a sentence end');
}

// --- Points: a poster pays more the sooner it is guessed ----------------------
{
    assert.equal(pointsFor('poster', 0), POSTER_MAX_POINTS);
    assert.equal(pointsFor('poster', POSTER_REVEAL_MS / 2), (POSTER_MAX_POINTS + POSTER_MIN_POINTS) / 2);
    assert.equal(pointsFor('poster', POSTER_REVEAL_MS * 3), POSTER_MIN_POINTS, 'a late answer still scores the minimum');
    assert.equal(pointsFor('description', 50_000), 100);
    assert.equal(pointsFor('frame', 50_000), 100);
}

// --- Kinds are spread across the five questions -------------------------------
{
    const full = { name: 'Матрица', quizImageUrl: 'https://x/frame.jpg', posterUrl: 'https://x/p.jpg', description: plot };
    assert.deepEqual(availableTypes(full), ['frame', 'poster', 'description']);
    assert.deepEqual(availableTypes({ name: 'X', posterUrl: '', description: 'мало' }), []);

    const count = types => types.reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
    const mixed = count(planQuestionTypes(Array.from({ length: 5 }, () => full)));
    assert.deepEqual(Object.values(mixed).sort(), [1, 2, 2], 'three kinds over five questions: 2, 2 and 1');

    const library = count(planQuestionTypes(Array.from({ length: 5 }, () => ({ ...full, quizImageUrl: '' }))));
    assert.deepEqual(Object.values(library).sort(), [2, 3], 'without frames posters and plots alternate');
}

// --- Library documents become quiz movies -------------------------------------
{
    assert.deepEqual(movieFromListDoc({
        movieId: '301', movieTitle: 'The Matrix', movieTitleRu: 'Матрица', releaseYear: 1999,
        posterPath: 'http://avatars.mds.yandex.net/p.jpg', description: plot, genres: ['Фантастика']
    }), {
        kinopoiskId: 301, name: 'Матрица', year: 1999, posterUrl: 'https://avatars.mds.yandex.net/p.jpg',
        description: plot, genres: ['фантастика']
    });
    assert.equal(movieFromListDoc({ movieId: 'x', movieTitle: 'Без ID' }), null);
    assert.equal(movieFromCachedMovie({ name: 'Дюна', genres: [{ name: 'драма' }] }, '42').kinopoiskId, 42);
    assert.equal(safePosterUrl('javascript:alert(1)'), '');
    assert.equal(safePosterUrl('//image.tmdb.org/t/p/w500/a.jpg'), 'https://image.tmdb.org/t/p/w500/a.jpg');
}

// --- Loading the library from Firestore ----------------------------------------
function fakeFirebase(uid, collections) {
    const reads = [];
    const query = (name, filters = {}) => ({
        where: (field, op, value) => query(name, { ...filters, [field]: value }),
        limit: () => query(name, filters),
        get: async () => {
            reads.push(name);
            const docs = (collections[name] || []).filter(doc => doc.userId === filters.userId);
            return { forEach: callback => docs.forEach(doc => callback({ data: () => doc })) };
        }
    });
    return {
        reads,
        db: { collection: name => query(name) },
        waitForAuthReady: async () => (uid ? { uid } : null),
        getCurrentUser: () => (uid ? { uid } : null)
    };
}

const listDoc = (id, name, extra = {}) => ({
    userId: 'u1', movieId: id, movieTitle: name, posterPath: `https://avatars.mds.yandex.net/${id}.jpg`,
    description: '', releaseYear: 2000 + id, ...extra
});

{
    clearLibraryCache();
    await assert.rejects(loadLibraryMovies({ firebaseManager: {} }), error => error instanceof QuizLibraryError && error.code === 'unavailable');
    await assert.rejects(loadLibraryMovies({ firebaseManager: fakeFirebase(null, {}) }), error => error.code === 'signed-out');

    const firebase = fakeFirebase('u1', {
        watchlist: [listDoc(1, 'Матрица'), listDoc(2, 'Дюна', { posterPath: '' })],
        favorites: [listDoc(1, 'Матрица', { description: plot }), listDoc(3, 'Интерстеллар'), { ...listDoc(9, 'Чужой'), userId: 'u2' }],
        ratings: [{ userId: 'u1', movieId: 4 }, { userId: 'u1', movieId: 1 }]
    });
    let lookups = null;
    const movies = await loadLibraryMovies({
        firebaseManager: firebase,
        ensureMovieCacheService: async () => ({
            async getBatchCachedMovies(ids) {
                lookups = ids;
                return { 4: { kinopoiskId: 4, name: 'Леон', posterUrl: 'https://avatars.mds.yandex.net/4.jpg' } };
            }
        })
    });
    const byId = Object.fromEntries(movies.map(movie => [movie.kinopoiskId, movie]));
    assert.deepEqual(Object.keys(byId).map(Number).sort(), [1, 3, 4], 'lists and ratings are merged; another user and a movie without poster or plot are left out');
    assert.equal(byId[1].description, plot, 'a second list fills what the first lacked');
    assert.deepEqual(lookups, [4], 'only rated movies missing from the lists are looked up');

    const readsBefore = firebase.reads.length;
    await loadLibraryMovies({ firebaseManager: firebase });
    assert.equal(firebase.reads.length, readsBefore, 'a replay within minutes reads nothing again');
}

// --- The quiz: source picker, library round and scoring -----------------------
const libraryMovies = [
    ['Матрица', plot],
    ['Дюна', 'Наследник знатного рода Пол Атрейдес отправляется на пустынную планету Арракис, где добывают ценную пряность и где его семью ждёт предательство.'],
    ['Леон', 'Профессиональный убийца Леон берёт под опеку двенадцатилетнюю соседку Матильду, чью семью убили продажные полицейские из отдела по борьбе с наркотиками.'],
    ['Интерстеллар', 'Бывший пилот Купер оставляет детей на умирающей Земле и вместе с командой учёных летит через червоточину искать новый дом для человечества.'],
    ['Гладиатор', 'Преданный генерал Максимус становится рабом и гладиатором, чтобы отомстить императору Коммоду за гибель своей семьи и спасти Рим от тирании.'],
    ['Титаник', 'Бедный художник Джек и аристократка Роуз встречаются на борту огромного лайнера, который отправляется в свой первый и последний рейс через Атлантику.']
].map(([name, description], index) => ({
    userId: 'u1', movieId: index + 10, movieTitle: name, description,
    posterPath: `https://avatars.mds.yandex.net/${index}.jpg`
}));

{
    clearLibraryCache();
    window.firebaseManager = fakeFirebase('u1', { watchlist: libraryMovies });
    const stats = [];
    const quiz = new MovieQuizGame({ onStatsUpdate: value => stats.push(value) }, { clear() {}, gameOver() {} });
    await quiz.start();
    const panel = document.getElementById('movieQuiz');
    const cards = [...panel.querySelectorAll('.quiz-source-card')];
    assert.deepEqual(cards.map(card => card.dataset.source), ['library', 'popular'], 'the quiz opens on the source picker');
    assert.equal(document.activeElement, cards[1], 'popular is offered first until something else was chosen');

    cards[0].click();
    for (let i = 0; i < 10 && !panel.querySelector('.quiz-option'); i++) await settle();
    assert.equal(store[MovieQuizGame.SOURCE_KEY], 'library', 'the choice is remembered');
    assert.equal(quiz.movies.length, MovieQuizGame.ROUNDS);
    assert.ok(quiz.roundTypes.every(type => type === 'poster' || type === 'description'),
        'my movies never ask for Kinopoisk frames');
    assert.equal(panel.querySelectorAll('.quiz-option').length, 4);

    // Answer every round correctly and check the media of each kind.
    for (let round = 0; round < MovieQuizGame.ROUNDS; round++) {
        const type = quiz.roundTypes[round];
        if (type === 'poster') assert.ok(panel.querySelector('.quiz-poster-reveal img'), 'a poster round shows the poster');
        else {
            const masks = panel.querySelectorAll('.quiz-mask');
            assert.ok(masks.length > 0, 'a plot round hides words');
            assert.ok([...masks].every(mask => mask.textContent === '…'), 'hidden words are not in the text');
        }
        const correctId = String(quiz.movies[round].kinopoiskId);
        panel.querySelector(`.quiz-option[data-id="${correctId}"]`).click();
        if (type === 'description') {
            assert.ok([...panel.querySelectorAll('.quiz-mask')].every(mask => mask.textContent !== '…'),
                'the answer uncovers the hidden words');
        }
        assert.match(panel.querySelector('.quiz-feedback').textContent, /\+\d+/, 'the feedback shows the points');
        clearTimeout(quiz.transitionTimer);
        quiz.round += 1;
        if (quiz.round < MovieQuizGame.ROUNDS) quiz.showRound();
        else quiz.showResult();
    }
    assert.equal(quiz.correctCount, 5);
    assert.ok(quiz.score > 0 && quiz.score <= 500);
    assert.match(panel.querySelector('.quiz-result p').textContent, /5/, 'the summary counts correct answers, not points / 100');
    assert.ok(panel.querySelector('.quiz-secondary-btn'), 'the result offers other movies');
    quiz.stop();
}

{
    clearLibraryCache();
    window.firebaseManager = fakeFirebase('u1', { watchlist: libraryMovies.slice(0, 3) });
    const quiz = new MovieQuizGame({ onStatsUpdate() {} }, { clear() {}, gameOver() {} });
    await quiz.play('library');
    const panel = document.getElementById('movieQuiz');
    assert.match(panel.querySelector('.quiz-error span').textContent, /3/, 'a small library says how many movies it has');
    assert.ok(panel.querySelector('.quiz-restart').textContent.length > 0);
    assert.equal(document.activeElement, panel.querySelector('.quiz-restart'), 'the way out is focused');

    window.firebaseManager = fakeFirebase(null, {});
    clearLibraryCache();
    await quiz.play('library');
    assert.equal(panel.querySelector('.quiz-error span').textContent, 'Войдите в аккаунт, чтобы играть по своим фильмам.');
    quiz.stop();
}

// --- Wrong answers look like the right one ------------------------------------
{
    const { readFileSync } = await import('node:fs');
    const { normalizeReferencePool, tagsFromText, profileOf, KNOWN_TAGS, loadReferencePool } = await import('../src/shared/games/MovieQuizSimilarity.js');
    const raw = JSON.parse(readFileSync(new URL('../src/shared/data/games/movie-quiz/reference-pool.json', import.meta.url), 'utf8'));
    const pool = normalizeReferencePool(raw);

    assert.ok(pool.length >= 200, 'the reference pool is broad');
    const names = pool.map(movie => movie.name.toLocaleLowerCase('ru-RU'));
    assert.equal(new Set(names).size, names.length, 'reference titles are unique');
    for (const movie of pool) {
        assert.ok(movie.year >= 1930 && movie.year <= 2026, `${movie.name}: plausible year`);
        assert.ok(movie.genres.length > 0 && movie.tags.length > 0, `${movie.name}: genres and tags`);
        for (const tag of movie.tags) assert.ok(KNOWN_TAGS.has(tag), `${movie.name}: known tag ${tag}`);
    }

    const loaded = await loadReferencePool({
        fetchImpl: async () => ({ ok: true, json: async () => raw }),
        getUrl: path => path
    });
    assert.equal(loaded.length, pool.length, 'the loader returns the bundled pool');

    const gladiatorPlot = 'Преданный генерал Максимус становится рабом и гладиатором, чтобы отомстить императору Коммоду за гибель своей семьи и спасти Рим от тирании.';
    assert.ok(['antiquity', 'war'].every(tag => tagsFromText(gladiatorPlot).includes(tag)), 'the plot words set the era');
    assert.ok(!tagsFromText('Его двойник живёт в соседнем городе.').includes('war'), '«двойник» is not a war');

    const run = (correct, library = []) => {
        const quiz = new MovieQuizGame({ onStatsUpdate() {} }, { clear() {}, gameOver() {} });
        quiz.beginSession();
        quiz.referencePool = pool;
        quiz.allCandidates = library;
        quiz.distractorMovies = library;
        const options = quiz.getOptions(correct).filter(option => option !== correct);
        quiz.stop();
        return options;
    };

    // The reported case: a Roman general's plot next to the Matrix, Interstellar and Léon.
    const library = [
        { kinopoiskId: 1, name: 'Матрица', description: plot },
        { kinopoiskId: 2, name: 'Интерстеллар', description: 'Бывший пилот Купер летит через червоточину искать новый дом для человечества.' },
        { kinopoiskId: 3, name: 'Леон', description: 'Профессиональный убийца Леон берёт под опеку соседку Матильду.' }
    ];
    const gladiator = { kinopoiskId: 9, name: 'Гладиатор', description: gladiatorPlot, year: 2000 };
    for (let attempt = 0; attempt < 20; attempt++) {
        const options = run(gladiator, library);
        assert.equal(options.length, 3);
        for (const option of options) {
            assert.ok(!['Матрица', 'Интерстеллар', 'Леон'].includes(option.name), `«${option.name}» is no answer to a Roman plot`);
            const tags = profileOf(option).tags;
            assert.ok(['antiquity', 'medieval', 'war'].some(tag => tags.has(tag)), `«${option.name}» belongs to the same era or war`);
        }
    }

    const cartoon = { kinopoiskId: 20, name: 'Зверополис', genres: ['мультфильм', 'комедия', 'детектив'], year: 2016 };
    for (const option of run(cartoon)) assert.ok(profileOf(option).animated, `a cartoon gets cartoons, not «${option.name}»`);

    const soviet = { kinopoiskId: 21, name: 'Бриллиантовая рука', genres: ['комедия', 'криминал'], year: 1968, description: 'Советский служащий Семён Горбунков едет в круиз и случайно становится курьером контрабандистов.' };
    for (const option of run(soviet)) {
        const tags = profileOf(option).tags;
        assert.ok(tags.has('ussr') || tags.has('russia'), `a Soviet comedy gets Soviet or Russian films, not «${option.name}»`);
    }
}

// --- Cases reported from play ---------------------------------------------------
{
    const { readFileSync } = await import('node:fs');
    const { normalizeReferencePool, profileOf } = await import('../src/shared/games/MovieQuizSimilarity.js');
    const pool = normalizeReferencePool(JSON.parse(readFileSync(new URL('../src/shared/data/games/movie-quiz/reference-pool.json', import.meta.url), 'utf8')));
    const optionsFor = (correct, session = []) => {
        const quiz = new MovieQuizGame({ onStatsUpdate() {} }, { clear() {}, gameOver() {} });
        quiz.beginSession();
        quiz.referencePool = pool;
        quiz.allCandidates = session;
        quiz.distractorMovies = session;
        const options = quiz.getOptions(correct).filter(option => option !== correct);
        quiz.stop();
        return options;
    };

    // 1. «К событиям «Ледниковый период 3»…»: the part number gave the sequel away.
    const iceAge = {
        kinopoiskId: 501,
        name: 'Ледниковый период 3: Эра динозавров',
        year: 2009,
        genres: ['мультфильм', 'комедия', 'приключения', 'семейный'],
        description: 'К событиям «Ледникового периода 3» жизнь главных героев мультфильма потерпела некоторые изменения. Мамонты Мэнни и Элли ожидают появление на свет своего детёныша; саблезубый тигр Диего впал в раздумье.'
    };
    const hidden = maskDescription(iceAge.description, iceAge.name).filter(segment => segment.masked).map(segment => segment.text);
    assert.ok(hidden.includes('3'), 'the part number inside the quoted title is hidden');
    assert.ok(hidden.includes('Ледникового') && hidden.includes('периода'), 'the whole quoted title is hidden');
    const shrek = maskDescription('Огр по прозвищу Шрек 2 года живёт с женой на болоте, пока родители принцессы не зовут их в гости в далёкое королевство.', 'Шрек 2')
        .filter(segment => segment.masked).map(segment => segment.text);
    assert.deepEqual(shrek, ['Шрек', '2'], 'a number right after the title word is hidden');
    for (let attempt = 0; attempt < 10; attempt++) {
        for (const option of optionsFor(iceAge)) {
            const profile = profileOf(option);
            assert.ok(profile.animated && profile.tags.has('animals'), `an animal cartoon gets animal cartoons, not «${option.name}»`);
        }
    }

    // 2. A frame of Pennywise for «Оно» next to a series and two period films.
    const it = { kinopoiskId: 502, name: 'Оно', year: 2017, type: 'movie', genres: ['ужасы', 'фэнтези'], description: 'Дети из городка Дерри исчезают. Компания подростков встречает злого клоуна, который питается их страхами.' };
    const castleRock = { kinopoiskId: 503, name: 'Касл-Рок', year: 2018, type: 'tv-series', isSeries: true, genres: ['ужасы', 'триллер', 'драма'] };
    for (let attempt = 0; attempt < 10; attempt++) {
        const options = optionsFor(it, [castleRock]);
        assert.ok(!options.includes(castleRock), 'a series is not offered for a film');
        for (const option of options) {
            const tags = profileOf(option).tags;
            assert.ok(tags.has('horror') && (tags.has('monster') || tags.has('maniac') || tags.has('demon')),
                `a monster horror gets monster horror films, not «${option.name}»`);
        }
    }

    // A space plot without the word «космос» still gets space films, not «Топ Ган» for «пилот».
    const interstellar = { kinopoiskId: 505, name: 'Интерстеллар', year: 2014, genres: ['фантастика', 'драма', 'приключения'], description: 'Бывший пилот Купер оставляет детей на умирающей Земле и вместе с командой учёных летит через червоточину искать новый дом для человечества.' };
    for (let attempt = 0; attempt < 10; attempt++) {
        for (const option of optionsFor(interstellar)) {
            const tags = profileOf(option).tags;
            assert.ok(tags.has('space') || tags.has('future'), `a space plot gets space films, not «${option.name}»`);
        }
    }

    // Second report: «Матрица: Перезагрузка» plot next to «Последний самурай» and «Король Артур»,
    // «Парк Юрского периода» plot next to «Хатико», and a pterosaur frame next to «Человек-паук».
    const reloaded = { kinopoiskId: 506, name: 'Матрица: Перезагрузка', year: 2003, genres: ['фантастика', 'боевик'], description: 'Борцы за свободу Нео, Тринити и Морфеус продолжают руководить восстанием людей против Армии Машин. Они вынуждены использовать не только арсенал превосходного оружия, но и свои выдающиеся навыки.' };
    const park = { kinopoiskId: 507, name: 'Парк Юрского периода', year: 1993, genres: ['фантастика', 'боевик', 'триллер', 'приключения'], description: 'Экспансивный богач и профессор уговаривает двух палеонтологов приехать на остров у побережья Коста-Рики, где он устроил Парк Юрского периода. Парк населён давно вымершими динозаврами.' };
    const park3 = { kinopoiskId: 508, name: 'Парк Юрского периода 3', year: 2001, type: 'movie', genres: ['фантастика', 'боевик', 'триллер', 'приключения'] };
    for (let attempt = 0; attempt < 10; attempt++) {
        for (const option of optionsFor(reloaded)) {
            const profile = profileOf(option);
            assert.ok(profile.genres.has('фантастика') && (profile.tags.has('ai') || profile.tags.has('future')),
                `a machine war plot gets science fiction about machines or the future, not «${option.name}»`);
        }
        for (const option of optionsFor(park)) {
            assert.ok(profileOf(option).tags.has('monster') && option.name !== 'Хатико: Самый верный друг',
                `a dinosaur plot gets creature films, not «${option.name}»`);
        }
        for (const option of optionsFor(park3)) {
            assert.ok(profileOf(option).genres.has('фантастика'), `a science fiction frame gets science fiction, not «${option.name}»`);
            assert.ok(!/юрского периода/i.test(option.name), 'the same franchise is never a wrong answer');
        }
    }

    // 3. A period frame from «Холоп» next to modern comedies.
    const kholop = { kinopoiskId: 504, name: 'Холоп', year: 2019, genres: ['комедия'], countries: ['Россия'], description: 'Избалованного сына богатого отца убеждают, что он попал в XIX век и стал холопом в усадьбе барина.' };
    for (let attempt = 0; attempt < 10; attempt++) {
        for (const option of optionsFor(kholop)) {
            const tags = profileOf(option).tags;
            assert.ok(!['Горько!', 'Ёлки'].includes(option.name), `«${option.name}» is a modern comedy`);
            assert.ok(['historical', 'medieval'].some(tag => tags.has(tag)) && (tags.has('russia') || tags.has('ussr')),
                `a Russian period film gets Russian period films, not «${option.name}»`);
        }
    }
}

console.log('✅ Movie quiz modes tests passed!');
