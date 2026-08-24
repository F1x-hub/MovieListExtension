import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.document = {
    getElementById: () => ({ replaceChildren() {} })
};
globalThis.chrome = {
    storage: {
        local: {
            async get() { return { movieQuizRecentIds: [] }; },
            async set() {}
        }
    }
};

const { MovieQuizGame } = await import('../src/shared/components/GamesModal.js');

function createGame() {
    return new MovieQuizGame({ onStatsUpdate() {} }, { clear() {}, gameOver() {} });
}

function makeMovie(id, name) {
    return {
        kinopoiskId: id,
        name,
        posterUrl: `https://example.com/${id}.jpg`,
        votes: { kp: 100000 }
    };
}

{
    const game = createGame();
    const correct = makeMovie(1, 'Матрица');
    game.movies = [correct, makeMovie(5, 'Интерстеллар')];
    game.distractorMovies = [
        makeMovie(2, ' матрица '),
        makeMovie(3, 'Дюна'),
        makeMovie(4, 'Начало'),
        makeMovie(6, 'Гладиатор')
    ];

    const options = game.getOptions(correct);
    assert.equal(options.length, 4, 'quiz must always produce four options');
    assert.equal(new Set(options.map(option => game.normalizeTitle(option.name))).size, 4, 'option titles must be unique');
    assert.equal(options.filter(option => option.kinopoiskId === correct.kinopoiskId).length, 1, 'correct option must occur once');
}

{
    const game = createGame();
    const sessionId = game.beginSession();
    const allMovies = Array.from({ length: 12 }, (_, index) => makeMovie(index + 1, `Фильм ${index + 1}`));
    chrome.storage.local.get = async () => ({
        movieQuizRecentIds: allMovies.map(movie => String(movie.kinopoiskId))
    });
    let requestCount = 0;
    const service = {
        async searchMovies(_query, _page, _limit, options) {
            assert.equal(options.candidateLimit, MovieQuizGame.SEARCH_RESULT_LIMIT);
            const start = requestCount * 2;
            requestCount += 1;
            return { docs: allMovies.slice(start, start + 2) };
        }
    };

    const candidates = await game.loadQuizMovies(service, game.abortController.signal, sessionId);
    assert.equal(candidates.length, MovieQuizGame.CANDIDATE_TARGET, 'recent history must fall back instead of blocking the quiz');
    assert.ok(requestCount <= MovieQuizGame.MAX_SEARCH_QUERIES, 'quiz search must respect its request budget');
    game.stop();
}

{
    const game = createGame();
    game.beginSession();
    const signal = game.abortController.signal;
    let timerRan = false;
    game.transitionTimer = window.setTimeout(() => { timerRan = true; }, 10);
    game.stop();
    await new Promise(resolve => window.setTimeout(resolve, 20));
    assert.equal(signal.aborted, true, 'stopping the quiz must abort active requests');
    assert.equal(timerRan, false, 'stopping the quiz must cancel the next-round timer');
}

{
    const game = createGame();
    game.beginSession();
    const correct = makeMovie(100, 'Мстители: Эра Альтрона');
    game.distractorMovies = [
        makeMovie(101, 'Матрица'),
        makeMovie(102, 'Матрица: Воскрешение'),
        makeMovie(103, 'Матрица: Перезагрузка'),
        makeMovie(104, 'Темный рыцарь: Возрождение легенды'),
        makeMovie(105, 'Темный рыцарь'),
        makeMovie(106, 'Интерстеллар')
    ];

    const options = game.getOptions(correct);
    assert.equal(options.length, 4, 'must return exactly 4 options');
    const franchises = options.map(opt => MovieQuizGame.getFranchiseKey(opt.name));
    assert.equal(new Set(franchises).size, 4, 'each option in a question must belong to a distinct franchise');
    const matrixCount = franchises.filter(f => f === 'матрица').length;
    assert.ok(matrixCount <= 1, 'must never have more than 1 Matrix movie in the options for a non-Matrix question');
    game.stop();
}

{
    const game = createGame();
    game.beginSession();
    const round1 = makeMovie(201, 'Интерстеллар');
    const round2 = makeMovie(202, 'Гладиатор');
    game.movies = [round1, round2];
    game.distractorMovies = [
        makeMovie(301, 'Властелин колец: Возвращение короля'),
        makeMovie(302, 'Пираты Карибского моря: На краю света'),
        makeMovie(303, 'Начало'),
        makeMovie(304, 'Бойцовский клуб'),
        makeMovie(305, 'Титаник'),
        makeMovie(306, 'Джокер')
    ];

    const optionsRound1 = game.getOptions(round1);
    const optionsRound2 = game.getOptions(round2);

    const r1Names = new Set(optionsRound1.map(o => o.name));
    const r2Distractors = optionsRound2.filter(o => o.kinopoiskId !== round2.kinopoiskId);

    // Verify cross-round uniqueness
    for (const d of r2Distractors) {
        assert.ok(!r1Names.has(d.name), `Distractor "${d.name}" from round 2 must not have appeared in round 1`);
    }
    game.stop();
}

{
    const game = createGame();
    game.beginSession();
    const correct = makeMovie(401, 'Мстители');
    game.distractorMovies = []; // completely empty candidates

    const options = game.getOptions(correct);
    assert.equal(options.length, 4, 'fallback pool must provide 4 options even when candidates are empty');
    assert.equal(new Set(options.map(o => o.name)).size, 4, 'fallback options must be unique');
    game.stop();
}

console.log('✅ Movie quiz logic tests passed!');

