import { shuffled, t } from './gamesI18n.js';
import { LIBRARY_MIN_MOVIES, QuizLibraryError, loadLibraryMovies } from './MovieQuizLibrary.js';
import { POSTER_REVEAL_MS, availableTypes, maskDescription, planQuestionTypes, pointsFor } from './MovieQuizQuestions.js';
import { loadReferencePool, rankBySimilarity } from './MovieQuizSimilarity.js';

export class MovieQuizGame {
    static ROUNDS = 5;
    static SOURCES = ['library', 'popular'];
    // The last chosen source is offered first next time.
    static SOURCE_KEY = 'movieQuizSourceV1';
    static POSTER_CHECK_CONCURRENCY = 4;
    static CACHED_DESCRIPTION_LENGTH = 400;
    static OWN_MOVIE_BONUS = 0.75;
    static OPTION_JITTER = 2.5;
    static MIN_KP_VOTES = 50000;
    static CANDIDATE_TARGET = 10;
    static SEARCH_RESULT_LIMIT = 12;
    static MAX_SEARCH_QUERIES = 8;
    static FRAME_CONCURRENCY = 3;
    static ANSWER_FEEDBACK_MS = 1200;
    static IMAGE_TIMEOUT_MS = 6000;
    // Kinopoisk answers are cached locally so replays spend little of the shared API quota.
    static API_CACHE_KEY = 'movieQuizApiCacheV1';
    static API_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    static API_CACHE_MAX_SEARCHES = 120;
    static API_CACHE_MAX_FRAMES = 240;
    static SEARCH_QUERIES = [
        'Интерстеллар', 'Матрица', 'Гарри Поттер', 'Мстители', 'Начало', 'Джокер',
        'Темный рыцарь', 'Властелин колец', 'Зеленая миля', 'Форрест Гамп',
        'Бойцовский клуб', 'Побег из Шоушенка', 'Гладиатор', 'Титаник',
        'Шерлок Холмс', 'Один дома', 'Назад в будущее', 'Пираты Карибского моря',
        'Аватар', 'Дюна', 'Терминатор', 'Чужой', 'Парк Юрского периода', 'Звёздные войны',
        'Крестный отец', 'Криминальное чтиво', 'Леон', 'Пятый элемент', 'Остров проклятых',
        'Престиж', 'Достать ножи', 'Брат', 'Иван Васильевич меняет профессию',
        'Бриллиантовая рука', 'Ирония судьбы', 'Москва слезам не верит', 'Джентльмены удачи',
        'Кавказская пленница', 'Холоп', 'Движение вверх', 'Легенда №17', 'Т-34', 'Сталкер',
        'Король Лев', 'Шрек', 'Ледниковый период', 'Тайна Коко', 'Головоломка', 'ВАЛЛ-И',
        'Унесённые призраками', 'Хатико', '1+1', 'Волк с Уолл-стрит', 'Достучаться до небес',
        'Однажды в Голливуде', 'Бегущий по лезвию', 'Джон Уик', 'Миссия невыполнима',
        'Индиана Джонс', 'Люди в черном', 'Оно', 'Сияние', 'Безумный Макс', 'Ла-Ла Ленд',
        'Отель Гранд Будапешт', 'Зеленая книга', 'Чарли и шоколадная фабрика', 'Остров сокровищ',
        'Как приручить дракона', 'Тор'
    ];

    /**
     * Curated fallback bank categorized by genre/theme to ensure
     * highly believable, contextually relevant options without API dependency.
     */
    static CURATED_FALLBACK_POOL = [
        // Superhero / Sci-Fi / Action
        { kinopoiskId: 'fb_1', name: 'Железный человек', genres: ['фантастика', 'боевик'], franchise: 'железный человек' },
        { kinopoiskId: 'fb_2', name: 'Стражи Галактики', genres: ['фантастика', 'приключения'], franchise: 'стражи галактики' },
        { kinopoiskId: 'fb_3', name: 'Человек-паук', genres: ['фантастика', 'боевик'], franchise: 'человек-паук' },
        { kinopoiskId: 'fb_4', name: 'Бэтмен: Начало', genres: ['боевик', 'фантастика'], franchise: 'бэтмен' },
        { kinopoiskId: 'fb_5', name: 'Бегущий по лезвию 2049', genres: ['фантастика', 'триллер'], franchise: 'бегущий по лезвию' },
        { kinopoiskId: 'fb_6', name: 'Терминатор 2: Судный день', genres: ['фантастика', 'боевик'], franchise: 'терминатор' },
        { kinopoiskId: 'fb_7', name: 'Аватар', genres: ['фантастика', 'приключения'], franchise: 'аватар' },
        { kinopoiskId: 'fb_8', name: 'Дюна', genres: ['фантастика', 'приключения'], franchise: 'дюна' },
        { kinopoiskId: 'fb_9', name: 'Пятый элемент', genres: ['фантастика', 'боевик'], franchise: 'пятый элемент' },
        { kinopoiskId: 'fb_10', name: 'Люди Икс', genres: ['фантастика', 'боевик'], franchise: 'люди икс' },
        // Fantasy / Adventure
        { kinopoiskId: 'fb_11', name: 'Хоббит: Нежданное путешествие', genres: ['фэнтези', 'приключения'], franchise: 'хоббит' },
        { kinopoiskId: 'fb_12', name: 'Хроники Нарнии: Лев, колдунья и волшебный шкаф', genres: ['фэнтези', 'приключения'], franchise: 'хроники нарнии' },
        { kinopoiskId: 'fb_13', name: 'Звёздные войны: Эпизод 4 — Новая надежда', genres: ['фантастика', 'приключения'], franchise: 'звездные войны' },
        { kinopoiskId: 'fb_14', name: 'Индиана Джонс: В поисках утраченного ковчега', genres: ['приключения', 'боевик'], franchise: 'индиана джонс' },
        { kinopoiskId: 'fb_15', name: 'Парк Юрского периода', genres: ['приключения', 'фантастика'], franchise: 'парк юрского периода' },
        { kinopoiskId: 'fb_16', name: 'Мумия', genres: ['фэнтези', 'приключения'], franchise: 'мумия' },
        // Thriller / Crime / Mystery
        { kinopoiskId: 'fb_17', name: 'Криминальное чтиво', genres: ['криминал', 'триллер'], franchise: 'криминальное чтиво' },
        { kinopoiskId: 'fb_18', name: 'Семь', genres: ['триллер', 'детектив'], franchise: 'семь' },
        { kinopoiskId: 'fb_19', name: 'Остров проклятых', genres: ['триллер', 'детектив'], franchise: 'остров проклятых' },
        { kinopoiskId: 'fb_20', name: 'Престиж', genres: ['триллер', 'фантастика'], franchise: 'престиж' },
        { kinopoiskId: 'fb_21', name: 'Молчание ягнят', genres: ['триллер', 'детектив'], franchise: 'молчание ягнят' },
        { kinopoiskId: 'fb_22', name: 'Отступники', genres: ['триллер', 'криминал'], franchise: 'отступники' },
        { kinopoiskId: 'fb_23', name: 'Леон', genres: ['боевик', 'криминал'], franchise: 'леон' },
        { kinopoiskId: 'fb_24', name: 'Достать ножи', genres: ['детектив', 'комедия'], franchise: 'достать ножи' },
        // Drama / Classic
        { kinopoiskId: 'fb_25', name: '1+1', genres: ['драма', 'комедия'], franchise: '1+1' },
        { kinopoiskId: 'fb_26', name: 'Крестный отец', genres: ['драма', 'криминал'], franchise: 'крестный отец' },
        { kinopoiskId: 'fb_27', name: 'Шоу Трумана', genres: ['драма', 'комедия'], franchise: 'шоу трумана' },
        { kinopoiskId: 'fb_28', name: 'Игры разума', genres: ['драма', 'биография'], franchise: 'игры разума' },
        { kinopoiskId: 'fb_29', name: 'Список Шиндлера', genres: ['драма', 'история'], franchise: 'список шиндлера' },
        { kinopoiskId: 'fb_30', name: 'Запах женщины', genres: ['драма'], franchise: 'запах женщины' },
        // Comedy / Family
        { kinopoiskId: 'fb_31', name: 'День сурка', genres: ['комедия', 'фэнтези'], franchise: 'день сурка' },
        { kinopoiskId: 'fb_32', name: 'Маска', genres: ['комедия', 'фэнтези'], franchise: 'маска' },
        { kinopoiskId: 'fb_33', name: 'Брюс Всемогущий', genres: ['комедия', 'фэнтези'], franchise: 'брюс всемогущий' },
        { kinopoiskId: 'fb_34', name: 'Трасса 60', genres: ['комедия', 'фантастика'], franchise: 'трасса 60' }
    ];

    constructor(callbacks, audio) {
        this.callbacks = callbacks;
        this.audio = audio;
        this.panel = document.getElementById('movieQuiz');
        this.movies = [];
        this.roundTypes = [];
        this.referencePool = [];
        this.source = 'popular';
        this.round = 0;
        this.score = 0;
        this.correctCount = 0;
        this.highScore = 0;
        this.isAnswered = false;
        this.roundStartedAt = 0;
        this.revealAnimation = null;
        this.distractorMovies = [];
        this.allCandidates = [];
        this.shownOptionIds = new Set();
        this.shownOptionNames = new Set();
        this.shownFranchises = new Set();
        this.sessionId = 0;
        this.abortController = null;
        this.transitionTimer = null;
        this.stopped = true;
        this.apiCache = null;
    }

    async loadHighScore() {
        try {
            const { movieQuizHighScore = 0 } = await chrome.storage.local.get('movieQuizHighScore');
            this.highScore = movieQuizHighScore;
        } catch { /* Scores are optional. */ }
    }

    /** Opens on the source picker; a pick starts the round. */
    async start() {
        const sessionId = this.beginSession();
        this.resetRound();
        await this.loadHighScore();
        if (!this.isCurrentSession(sessionId)) return;
        this.callbacks.onStatsUpdate({ score: 0, highScore: this.highScore, level: 1, lines: MovieQuizGame.ROUNDS });
        this.source = await this.loadSource();
        if (!this.isCurrentSession(sessionId)) return;
        this.renderSetup();
    }

    resetRound() {
        this.round = 0;
        this.score = 0;
        this.correctCount = 0;
        this.movies = [];
        this.roundTypes = [];
        this.distractorMovies = [];
        this.allCandidates = [];
    }

    async loadSource() {
        try {
            const stored = (await chrome.storage.local.get(MovieQuizGame.SOURCE_KEY))?.[MovieQuizGame.SOURCE_KEY];
            return MovieQuizGame.SOURCES.includes(stored) ? stored : 'popular';
        } catch {
            return 'popular';
        }
    }

    saveSource(source) {
        try {
            chrome.storage.local.set({ [MovieQuizGame.SOURCE_KEY]: source });
        } catch { /* The remembered choice is a convenience. */ }
    }

    /** Builds five questions from the chosen source and shows the first one. */
    async play(source) {
        this.source = MovieQuizGame.SOURCES.includes(source) ? source : 'popular';
        this.saveSource(this.source);
        const sessionId = this.beginSession();
        this.resetRound();
        this.renderLoading(this.source);
        this.callbacks.onStatsUpdate({ score: 0, highScore: this.highScore, level: 1, lines: MovieQuizGame.ROUNDS });
        try {
            const poolPromise = loadReferencePool();
            const prepared = this.source === 'library'
                ? await this.prepareLibraryQuiz(sessionId)
                : await this.preparePopularQuiz(sessionId);
            this.referencePool = await poolPromise;
            if (!prepared || !this.isCurrentSession(sessionId)) return;
            this.movies = prepared.movies;
            this.roundTypes = prepared.types;
            this.allCandidates = prepared.candidates;
            const questionIds = new Set(this.movies.map(movie => String(movie.kinopoiskId)));
            this.distractorMovies = this.allCandidates
                .filter(movie => !questionIds.has(String(movie.kinopoiskId)));
            await this.saveRecentMovieIds();
            if (!this.isCurrentSession(sessionId)) return;
            this.showRound();
        } catch (error) {
            if (this.isCurrentSession(sessionId) && !MovieQuizGame.isAbortError(error)) {
                if (!(error instanceof QuizLibraryError)) {
                    console.error('[MovieQuiz] Failed to start the quiz:', error?.message || error);
                }
                this.renderError(this.getUserFacingError(error), {
                    offerPopular: this.source === 'library'
                });
            }
        }
    }

    async preparePopularQuiz(sessionId) {
        const signal = this.abortController.signal;
        const service = await this.createKinopoiskService();
        if (!service?.isConfigured?.()) throw new Error(t('quiz.error_not_configured'));
        await this.loadApiCache();
        const candidates = await this.loadQuizMovies(service, signal, sessionId);
        const moviesWithFrames = await this.attachQuizFrames(service, candidates, signal, sessionId);
        await this.saveApiCache();
        if (!this.isCurrentSession(sessionId)) return null;

        const pool = this.shuffle(moviesWithFrames);
        const selected = this.pickQuestions(pool);
        // Every question here has a frame; any of them may be swapped for a poster or a summary.
        for (const movie of pool) {
            if (!selected.includes(movie) && selected.length < MovieQuizGame.ROUNDS) selected.push(movie);
        }
        if (selected.length < MovieQuizGame.ROUNDS) throw new Error(t('quiz.error_not_enough'));
        await this.checkPosters(selected, signal);
        return { movies: selected, types: planQuestionTypes(selected), candidates: this.dedupeMovies(candidates) };
    }

    async prepareLibraryQuiz(sessionId) {
        const signal = this.abortController.signal;
        const library = await loadLibraryMovies({
            firebaseManager: window.firebaseManager,
            ensureMovieCacheService: () => this.ensureMovieCacheService(),
            signal
        });
        if (!this.isCurrentSession(sessionId)) return null;
        if (library.length < LIBRARY_MIN_MOVIES) throw MovieQuizGame.tooSmallLibrary(library.length);

        // Movies asked recently go last, so a small library still rotates its questions.
        const recentIds = await this.getRecentMovieIds();
        const isRecent = movie => recentIds.has(String(movie.kinopoiskId));
        const ordered = [
            ...this.shuffle(library.filter(movie => !isRecent(movie))),
            ...this.shuffle(library.filter(isRecent))
        ];
        await this.checkPosters(ordered.slice(0, MovieQuizGame.ROUNDS * 3), signal);
        if (!this.isCurrentSession(sessionId)) return null;
        const selected = this.pickQuestions(ordered.filter(movie => availableTypes(movie).length));
        if (selected.length < MovieQuizGame.ROUNDS) throw MovieQuizGame.tooSmallLibrary(selected.length);
        return { movies: selected, types: planQuestionTypes(selected), candidates: this.dedupeMovies(library) };
    }

    static tooSmallLibrary(count) {
        return new QuizLibraryError('too-small', t('quiz.library_too_small', { count, min: MovieQuizGame.ROUNDS }));
    }

    /** Up to five questions, each from a different franchise. */
    pickQuestions(movies) {
        const franchises = new Set();
        const selected = [];
        for (const movie of movies) {
            const key = MovieQuizGame.getFranchiseKey(movie.name);
            if (franchises.has(key)) continue;
            franchises.add(key);
            selected.push(movie);
            if (selected.length >= MovieQuizGame.ROUNDS) break;
        }
        return selected;
    }

    /** A poster that does not load is dropped, so its movie gets another kind of question. */
    async checkPosters(movies, signal) {
        const queue = movies.filter(movie => movie.posterUrl);
        const worker = async () => {
            while (queue.length) {
                const movie = queue.shift();
                if (!(await MovieQuizGame.canLoadImage(movie.posterUrl, signal))) movie.posterUrl = '';
            }
        };
        await Promise.all(Array.from({ length: Math.min(MovieQuizGame.POSTER_CHECK_CONCURRENCY, queue.length) }, worker));
    }

    async ensureMovieCacheService() {
        if (!window.MovieCacheService) {
            await MovieQuizGame.loadScript('src/shared/services/MovieCacheService.js', 'MovieCacheService');
        }
        return window.firebaseManager?.getMovieCacheService?.() || null;
    }

    beginSession() {
        this.abortController?.abort();
        if (this.transitionTimer) window.clearTimeout(this.transitionTimer);
        this.transitionTimer = null;
        this.abortController = new AbortController();
        this.stopped = false;
        this.shownOptionIds = new Set();
        this.shownOptionNames = new Set();
        this.shownFranchises = new Set();
        this.sessionId += 1;
        return this.sessionId;
    }

    isCurrentSession(sessionId) {
        return !this.stopped && sessionId === this.sessionId && !this.abortController?.signal.aborted;
    }

    static isAbortError(error) {
        return error?.name === 'AbortError' || (error?.cause && MovieQuizGame.isAbortError(error.cause));
    }

    static isLimitError(error) {
        const normalized = window.errorNormalizer?.normalize?.(error, {
            operation: 'movie-quiz-load',
            category: 'provider'
        });
        return normalized?.code === 'KINOPOISK_DAILY_LIMIT' ||
            /DAILY_LIMIT_REACHED|HTTP error! status: (402|403|429)/i.test(String(error?.message));
    }

    async createKinopoiskService() {
        if (!window.KinopoiskService) {
            await MovieQuizGame.loadScript('src/shared/config/kinopoisk.config.js', 'KINOPOISK_CONFIG');
            await MovieQuizGame.loadScript('src/shared/services/KinopoiskService.js', 'KinopoiskService');
        }
        return new window.KinopoiskService();
    }

    async loadApiCache() {
        const empty = { searches: {}, frames: {} };
        try {
            const stored = (await chrome.storage.local.get(MovieQuizGame.API_CACHE_KEY))?.[MovieQuizGame.API_CACHE_KEY];
            const now = Date.now();
            const fresh = (entries) => Object.fromEntries(Object.entries(entries || {})
                .filter(([, entry]) => entry && now - Number(entry.at) < MovieQuizGame.API_CACHE_TTL_MS));
            this.apiCache = stored && typeof stored === 'object'
                ? { searches: fresh(stored.searches), frames: fresh(stored.frames) }
                : empty;
        } catch {
            this.apiCache = empty;
        }
        this.apiCacheDirty = false;
    }

    async saveApiCache() {
        if (!this.apiCache || !this.apiCacheDirty) return;
        const newest = (entries, limit) => Object.fromEntries(Object.entries(entries)
            .sort(([, left], [, right]) => right.at - left.at)
            .slice(0, limit));
        try {
            await chrome.storage.local.set({
                [MovieQuizGame.API_CACHE_KEY]: {
                    searches: newest(this.apiCache.searches, MovieQuizGame.API_CACHE_MAX_SEARCHES),
                    frames: newest(this.apiCache.frames, MovieQuizGame.API_CACHE_MAX_FRAMES)
                }
            });
            this.apiCacheDirty = false;
        } catch { /* The cache only saves quota; the quiz works without it. */ }
    }

    static compactMovie(movie) {
        const posterUrl = movie?.posterUrl || movie?.poster?.url || '';
        return {
            kinopoiskId: movie.kinopoiskId,
            name: movie.name,
            year: Number(movie.year) || null,
            posterUrl: /^https:\/\//i.test(posterUrl) ? posterUrl : '',
            // Enough for a clipped plot question; the cache stays small.
            description: String(movie.description || movie.shortDescription || '')
                .slice(0, MovieQuizGame.CACHED_DESCRIPTION_LENGTH),
            votes: { kp: Number(movie?.votes?.kp) || 0 },
            // A series is kept out of film answers and the other way round.
            type: typeof movie.type === 'string' ? movie.type : '',
            isSeries: movie.isSeries === true,
            countries: Array.isArray(movie.countries)
                ? movie.countries.map(country => (typeof country === 'object' ? country?.name : country)).filter(Boolean)
                : [],
            genres: Array.isArray(movie.genres)
                ? movie.genres.map(genre => (typeof genre === 'object' ? genre?.name : genre)).filter(Boolean)
                : []
        };
    }

    async searchWithCache(service, query, signal) {
        const cached = this.apiCache?.searches?.[query];
        if (cached) return cached.docs;
        const { docs = [] } = await service.searchMovies(query, 1, MovieQuizGame.SEARCH_RESULT_LIMIT, {
            candidateLimit: MovieQuizGame.SEARCH_RESULT_LIMIT,
            signal,
            throwOnLimit: true
        });
        if (this.apiCache) {
            this.apiCache.searches[query] = { at: Date.now(), docs: docs.filter(Boolean).map(MovieQuizGame.compactMovie) };
            this.apiCacheDirty = true;
        }
        return docs;
    }

    async framesWithCache(service, movieId, signal) {
        const key = String(movieId);
        const cached = this.apiCache?.frames?.[key];
        if (cached) return cached.urls;
        const frames = await service.getMovieImages(movieId, { signal, throwOnLimit: true });
        const urls = (frames || [])
            .map(frame => frame?.url || frame?.previewUrl || frame?.originalUrl || '')
            .filter(url => /^https?:\/\//i.test(url))
            .slice(0, 8);
        if (this.apiCache) {
            this.apiCache.frames[key] = { at: Date.now(), urls };
            this.apiCacheDirty = true;
        }
        return urls;
    }

    async loadQuizMovies(service, signal, sessionId) {
        const movies = [];
        const fallbackMovies = [];
        const usedIds = new Set();
        const usedNames = new Set();
        let lastError = null;
        const recentIds = await this.getRecentMovieIds();
        const queries = this.shuffle([...MovieQuizGame.SEARCH_QUERIES]).slice(0, MovieQuizGame.MAX_SEARCH_QUERIES);
        for (const query of queries) {
            if (!this.isCurrentSession(sessionId) || movies.length >= MovieQuizGame.CANDIDATE_TARGET) break;
            try {
                const docs = await this.searchWithCache(service, query, signal);
                const eligible = docs.filter(candidate => {
                    const votes = Number(candidate?.votes?.kp) || 0;
                    return candidate?.kinopoiskId && candidate.name
                        && votes > MovieQuizGame.MIN_KP_VOTES
                        && !usedIds.has(String(candidate.kinopoiskId));
                });
                eligible.forEach(movie => {
                    const id = String(movie.kinopoiskId);
                    if (!fallbackMovies.some(candidate => String(candidate.kinopoiskId) === id)) fallbackMovies.push(movie);
                });
                let addedForQuery = 0;
                for (const movie of eligible) {
                    if (movies.length >= MovieQuizGame.CANDIDATE_TARGET) break;
                    const id = String(movie.kinopoiskId);
                    const name = this.normalizeTitle(movie.name);
                    if (!recentIds.has(id) && !usedIds.has(id) && !usedNames.has(name)) {
                        usedIds.add(id);
                        usedNames.add(name);
                        movies.push(movie);
                        addedForQuery += 1;
                        if (addedForQuery >= 2) break;
                    }
                }
            } catch (error) {
                if (MovieQuizGame.isAbortError(error)) throw error;
                if (MovieQuizGame.isLimitError(error)) throw error;
                lastError = error;
                // Continue with the remaining titles when one search request fails.
            }
        }

        // Recent history should improve variety, never make the game unavailable.
        for (const movie of fallbackMovies) {
            if (movies.length >= MovieQuizGame.CANDIDATE_TARGET) break;
            const id = String(movie.kinopoiskId);
            const name = this.normalizeTitle(movie.name);
            if (!usedIds.has(id) && !usedNames.has(name)) {
                usedIds.add(id);
                usedNames.add(name);
                movies.push(movie);
            }
        }
        if (movies.length < MovieQuizGame.ROUNDS && lastError) throw lastError;
        return movies;
    }

    async getRecentMovieIds() {
        try {
            const { movieQuizRecentIds = [] } = await chrome.storage.local.get('movieQuizRecentIds');
            return new Set(movieQuizRecentIds.map(String));
        } catch {
            return new Set();
        }
    }

    async saveRecentMovieIds() {
        try {
            const { movieQuizRecentIds = [] } = await chrome.storage.local.get('movieQuizRecentIds');
            const nextIds = [...this.movies.map(movie => String(movie.kinopoiskId)), ...movieQuizRecentIds];
            await chrome.storage.local.set({ movieQuizRecentIds: [...new Set(nextIds)].slice(0, 30) });
        } catch { /* Recent-question history is a progressive enhancement. */ }
    }

    shuffle(items) {
        return shuffled(items);
    }

    async attachQuizFrames(service, movies, signal, sessionId) {
        const moviesWithFrames = [];
        const queue = [...movies];
        const worker = async () => {
            while (queue.length && moviesWithFrames.length < MovieQuizGame.ROUNDS && this.isCurrentSession(sessionId)) {
                const movie = queue.shift();
                try {
                    const urls = this.shuffle(await this.framesWithCache(service, movie.kinopoiskId, signal));
                    const quizImageUrl = await this.findLoadableImage(urls.slice(0, 3), signal);
                    if (quizImageUrl && this.isCurrentSession(sessionId)) {
                        moviesWithFrames.push({ ...movie, quizImageUrl });
                    }
                } catch (error) {
                    if (MovieQuizGame.isAbortError(error)) throw error;
                    if (MovieQuizGame.isLimitError(error)) throw error;
                    // A movie without an available frame is skipped to keep the quiz fair.
                }
            }
        };
        const workers = Array.from(
            { length: Math.min(MovieQuizGame.FRAME_CONCURRENCY, queue.length) },
            () => worker()
        );
        await Promise.all(workers);
        return moviesWithFrames;
    }

    async findLoadableImage(urls, signal) {
        for (const url of urls) {
            if (await MovieQuizGame.canLoadImage(url, signal)) return url;
        }
        return '';
    }

    static canLoadImage(url, signal) {
        if (typeof Image === 'undefined') return Promise.resolve(true);
        return new Promise((resolve, reject) => {
            const image = new Image();
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                signal?.removeEventListener('abort', onAbort);
                image.onload = null;
                image.onerror = null;
                resolve(result);
            };
            const onAbort = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                image.src = '';
                reject(new DOMException('Quiz image loading aborted', 'AbortError'));
            };
            const timeoutId = window.setTimeout(() => finish(false), MovieQuizGame.IMAGE_TIMEOUT_MS);
            image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
            image.onerror = () => finish(false);
            image.referrerPolicy = 'no-referrer';
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();
            else image.src = url;
        });
    }

    static loadScript(path, globalName) {
        if (window[globalName]) return Promise.resolve();
        const existing = document.querySelector(`script[data-quiz-script="${path}"]`);
        if (existing) {
            if (existing.dataset.quizLoaded === 'true') {
                return Promise.reject(new Error(t('quiz.error_init', { name: globalName })));
            }
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', () => window[globalName] ? resolve() : reject(new Error(t('quiz.error_init', { name: globalName }))), { once: true });
                existing.addEventListener('error', () => reject(new Error(t('quiz.error_load', { path }))), { once: true });
            });
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(path);
            script.dataset.quizScript = path;
            script.onload = () => {
                script.dataset.quizLoaded = 'true';
                window[globalName] ? resolve() : reject(new Error(t('quiz.error_init', { name: globalName })));
            };
            script.onerror = () => reject(new Error(t('quiz.error_load', { path })));
            document.head.appendChild(script);
        });
    }

    /**
     * Extracts a normalized franchise root to avoid showing multiple installments
     * of the same franchise (e.g. "Матрица" and "Матрица: Воскрешение") in one question.
     */
    static getFranchiseKey(title) {
        if (!title) return '';
        let normalized = String(title).trim().toLowerCase().replace(/ё/g, 'е');
        normalized = normalized.split(/[:—–]| - |\s+\d+$|\s+(?:часть|фильм|сезон|эпизод)\s*\d*/i)[0].trim();
        normalized = normalized.replace(/^(гарри поттер|властелин колец|пираты карибского моря|звездные войны|индиана джонс|хроники нарнии|голодные игры|бегущий в лабиринте|трансформеры|люди икс|сумерки|человек-паук|темный рыцарь|мстители|матрица|хоббит|терминатор|парк юрского периода|бэтмен|шерлок холмс|джокер|один дома|назад в будущее|джон уик|миссия невыполнима|люди в черном|безумный макс|ледниковый период|шрек|как приручить дракона|чужой|тор)(?:\s.*|$)/i, '$1');
        normalized = normalized.replace(/\s+(?:[ivx]+|\d+)$/i, '').trim();
        return normalized;
    }

    getOptions(correct) {
        const correctId = String(correct.kinopoiskId);
        const correctName = this.normalizeTitle(correct.name);
        const correctFranchise = MovieQuizGame.getFranchiseKey(correct.name);

        const usedIds = new Set([correctId]);
        const usedNames = new Set([correctName]);
        const usedFranchisesInQuestion = new Set([correctFranchise]);
        const distractors = [];

        const tryAddCandidate = (candidate, allowCrossRoundReuse = false) => {
            if (distractors.length >= 3 || !candidate) return;
            const id = String(candidate.kinopoiskId || '');
            const normalizedName = this.normalizeTitle(candidate.name);
            const franchise = MovieQuizGame.getFranchiseKey(candidate.name);

            if (!id || !normalizedName || usedIds.has(id) || usedNames.has(normalizedName)) return;
            if (usedFranchisesInQuestion.has(franchise)) return;

            // Across the 5 rounds, avoid repeating options that were already shown in earlier rounds
            if (!allowCrossRoundReuse) {
                if (this.shownOptionIds.has(id) || this.shownOptionNames.has(normalizedName)) return;
                if (this.shownFranchises.has(franchise)) return;
            }

            usedIds.add(id);
            usedNames.add(normalizedName);
            usedFranchisesInQuestion.add(franchise);
            distractors.push(candidate);
        };

        const sessionCandidates = [
            ...(this.distractorMovies || []),
            ...(this.movies || []).filter(m => String(m.kinopoiskId) !== correctId),
            ...(this.allCandidates || []).filter(m => String(m.kinopoiskId) !== correctId)
        ];

        // Wrong answers are the movies most like the right one (setting, theme, genres,
        // years), from this round's movies and the bundled reference pool. The round's
        // own movies win a near tie, so «my movies» options are not all strangers.
        const sessionSet = new Set(sessionCandidates);
        // The small built-in list (no years or themes) only stands in when the pool did not load.
        const reference = this.referencePool?.length ? this.referencePool : MovieQuizGame.CURATED_FALLBACK_POOL;
        const ranked = rankBySimilarity(correct, [...sessionCandidates, ...reference], {
            // Enough jitter to rotate among the closest films between games.
            jitter: MovieQuizGame.OPTION_JITTER, bonus: candidate => (sessionSet.has(candidate) ? MovieQuizGame.OWN_MOVIE_BONUS : 0) });
        ranked.forEach(m => tryAddCandidate(m, false));

        // If still needed, relax session-level reuse (while strictly preserving in-question uniqueness)
        if (distractors.length < 3) ranked.forEach(m => tryAddCandidate(m, true));

        // Register options into session-level tracking so they won't repeat in subsequent rounds
        this.shownOptionIds.add(correctId);
        this.shownOptionNames.add(correctName);
        this.shownFranchises.add(correctFranchise);
        distractors.forEach(d => {
            this.shownOptionIds.add(String(d.kinopoiskId));
            this.shownOptionNames.add(this.normalizeTitle(d.name));
            this.shownFranchises.add(MovieQuizGame.getFranchiseKey(d.name));
        });

        return this.shuffle([correct, ...distractors]);
    }

    normalizeTitle(title) {
        return String(title || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
    }

    dedupeMovies(movies) {
        const usedIds = new Set();
        const usedNames = new Set();
        return movies.filter(movie => {
            const id = String(movie?.kinopoiskId || '');
            const name = this.normalizeTitle(movie?.name);
            if (!id || !name || usedIds.has(id) || usedNames.has(name)) return false;
            usedIds.add(id);
            usedNames.add(name);
            return true;
        });
    }

    showRound() {
        const movie = this.movies[this.round % this.movies.length];
        const type = this.roundTypes[this.round] || 'frame';
        const options = this.getOptions(movie);
        if (options.length !== 4) {
            this.renderError(t('quiz.error_options'));
            return;
        }

        this.isAnswered = false;
        this.cancelReveal();
        this.panel.replaceChildren();
        const progress = document.createElement('div');
        progress.className = 'quiz-progress';
        progress.textContent = `${t('quiz.progress', { round: this.round + 1, total: MovieQuizGame.ROUNDS })} · ${t(`quiz.type_${type}`)}`;
        const media = this.createMedia(movie, type);
        const prompt = document.createElement('p');
        prompt.className = 'quiz-prompt';
        prompt.textContent = t(type === 'frame' ? 'quiz.prompt' : `quiz.prompt_${type}`);
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'quiz-options';
        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'quiz-option';
            button.type = 'button';
            button.dataset.id = String(option.kinopoiskId);
            const number = document.createElement('span');
            number.textContent = String(index + 1);
            button.append(number, document.createTextNode(option.name));
            button.addEventListener('click', () => this.answer(button, movie));
            optionsContainer.appendChild(button);
        });
        this.panel.append(progress, media, prompt, optionsContainer);
        // Description and frame rounds start counting now; a poster starts once it is shown.
        this.roundStartedAt = type === 'poster' ? 0 : performance.now();
        this.callbacks.onStatsUpdate({ score: this.score, highScore: this.highScore, level: this.round + 1, lines: MovieQuizGame.ROUNDS });
        optionsContainer.querySelector('.quiz-option')?.focus({ preventScroll: true });
    }

    createMedia(movie, type) {
        if (type === 'description') return this.createDescription(movie);
        if (type === 'poster') return this.createPosterReveal(movie);
        const image = document.createElement('img');
        image.className = 'quiz-poster quiz-frame';
        image.src = movie.quizImageUrl;
        image.alt = t('quiz.frame_alt');
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => {
            image.style.display = 'none';
        };
        return image;
    }

    createDescription(movie) {
        const quote = document.createElement('blockquote');
        quote.className = 'quiz-description';
        quote.setAttribute('aria-label', t('quiz.description_label'));
        for (const segment of maskDescription(movie.description, movie.name) || []) {
            if (!segment.masked) {
                quote.append(document.createTextNode(segment.text));
                continue;
            }
            const mask = document.createElement('span');
            mask.className = 'quiz-mask';
            mask.dataset.word = segment.text;
            mask.style.setProperty('--mask-length', String(Math.min(10, Math.max(3, segment.text.length))));
            mask.textContent = '…';
            quote.append(mask);
        }
        return quote;
    }

    /** The poster starts zoomed in and blurred and clears up until the answer. */
    createPosterReveal(movie) {
        const frame = document.createElement('div');
        frame.className = 'quiz-media quiz-poster-reveal';
        const image = document.createElement('img');
        image.className = 'quiz-reveal-image';
        image.alt = t('quiz.poster_alt');
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('load', () => this.startReveal(image), { once: true });
        image.addEventListener('error', () => {
            image.hidden = true;
            this.roundStartedAt = performance.now();
        }, { once: true });
        image.src = movie.posterUrl;
        frame.append(image);
        return frame;
    }

    startReveal(image) {
        if (this.isAnswered || !image.isConnected) return;
        this.roundStartedAt = performance.now();
        if (typeof image.animate !== 'function') return;
        // Reduced motion keeps the clearing blur but drops the zoom and moves in steps.
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const keyframes = reduced
            ? [{ transform: 'scale(1.5)', filter: 'blur(16px)' }, { transform: 'scale(1.5)', filter: 'blur(3px)' }]
            : [{ transform: 'scale(2.6)', filter: 'blur(16px)' }, { transform: 'scale(1.5)', filter: 'blur(3px)' }];
        this.revealAnimation = image.animate(keyframes, {
            duration: POSTER_REVEAL_MS,
            easing: reduced ? 'steps(4, end)' : 'linear',
            fill: 'forwards'
        });
    }

    cancelReveal() {
        this.revealAnimation?.cancel();
        this.revealAnimation = null;
    }

    /** After the answer the whole question is shown: the full poster and the hidden words. */
    revealAnswerMedia() {
        this.cancelReveal();
        this.panel.querySelector('.quiz-poster-reveal')?.classList.add('is-revealed');
        this.panel.querySelectorAll('.quiz-mask').forEach(mask => {
            mask.textContent = mask.dataset.word || '';
            mask.classList.add('is-revealed');
        });
    }

    answer(button, correctMovie) {
        if (this.isAnswered) return;
        this.isAnswered = true;
        const type = this.roundTypes[this.round] || 'frame';
        const elapsed = performance.now() - (this.roundStartedAt || performance.now());
        const isCorrect = String(button.dataset.id) === String(correctMovie.kinopoiskId);
        this.revealAnswerMedia();

        this.panel.querySelectorAll('.quiz-option').forEach(option => {
            option.disabled = true;
            if (String(option.dataset.id) === String(correctMovie.kinopoiskId)) option.classList.add('correct');
        });
        let points = 0;
        if (isCorrect) {
            points = pointsFor(type, elapsed);
            this.score += points;
            this.correctCount += 1;
            button.classList.add('correct');
            this.audio.clear();
        } else {
            button.classList.add('incorrect');
            this.audio.gameOver();
        }
        const feedback = document.createElement('p');
        feedback.className = `quiz-feedback ${isCorrect ? 'is-correct' : 'is-incorrect'}`;
        feedback.textContent = isCorrect
            ? t('quiz.correct_points', { points })
            : t('quiz.correct_answer', { name: correctMovie.name });
        this.panel.appendChild(feedback);
        if (this.score > this.highScore) {
            this.highScore = this.score;
            chrome.storage.local.set({ movieQuizHighScore: this.highScore });
        }
        this.callbacks.onStatsUpdate({ score: this.score, highScore: this.highScore, level: this.round + 1, lines: MovieQuizGame.ROUNDS });
        const sessionId = this.sessionId;
        // The revealed poster or summary gets a moment longer than a frame.
        const delay = type === 'frame' ? MovieQuizGame.ANSWER_FEEDBACK_MS : MovieQuizGame.ANSWER_FEEDBACK_MS + 800;
        this.transitionTimer = window.setTimeout(() => {
            if (!this.isCurrentSession(sessionId)) return;
            this.round += 1;
            if (this.round < MovieQuizGame.ROUNDS) this.showRound();
            else this.showResult();
        }, delay);
    }

    showResult() {
        const result = document.createElement('div');
        result.className = 'quiz-result';
        const label = document.createElement('span');
        label.textContent = t('quiz.result_label');
        const score = document.createElement('strong');
        score.textContent = String(this.score);
        const summary = document.createElement('p');
        summary.textContent = t('quiz.result_summary', { correct: this.correctCount, total: MovieQuizGame.ROUNDS });
        const actions = document.createElement('div');
        actions.className = 'quiz-result-actions';
        const restart = document.createElement('button');
        restart.className = 'game-btn-primary quiz-restart';
        restart.type = 'button';
        restart.textContent = t('quiz.play_again');
        restart.addEventListener('click', () => this.restart());
        const change = document.createElement('button');
        change.className = 'quiz-secondary-btn';
        change.type = 'button';
        change.textContent = t('quiz.change_source');
        change.addEventListener('click', () => this.start());
        actions.append(restart, change);
        result.append(label, score, summary, actions);
        this.panel.replaceChildren(result);
        restart.focus({ preventScroll: true });
    }

    /** The source picker shown before a round. */
    renderSetup() {
        const setup = document.createElement('div');
        setup.className = 'quiz-setup';
        const title = document.createElement('h3');
        title.textContent = t('quiz.setup_title');
        const text = document.createElement('p');
        text.textContent = t('quiz.setup_text');
        const grid = document.createElement('div');
        grid.className = 'quiz-source-grid';
        let preferred = null;
        for (const source of MovieQuizGame.SOURCES) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'quiz-source-card';
            card.dataset.source = source;
            const name = document.createElement('strong');
            name.textContent = t(`quiz.source_${source}`);
            const hint = document.createElement('small');
            hint.textContent = t(`quiz.source_${source}_text`);
            card.append(name, hint);
            card.addEventListener('click', () => this.play(source));
            grid.append(card);
            if (source === this.source) preferred = card;
        }
        setup.append(title, text, grid);
        this.panel.replaceChildren(setup);
        preferred?.focus({ preventScroll: true });
    }

    renderLoading(source = this.source) {
        const status = document.createElement('div');
        status.className = 'quiz-status';
        status.textContent = t(source === 'library' ? 'quiz.loading_library' : 'quiz.loading');
        this.panel.replaceChildren(status);
    }

    renderError(message, { offerPopular = false } = {}) {
        const status = document.createElement('div');
        status.className = 'quiz-status quiz-error';
        const title = document.createElement('strong');
        title.textContent = t('quiz.unavailable');
        const details = document.createElement('span');
        details.textContent = message;
        const actions = document.createElement('div');
        actions.className = 'quiz-result-actions';
        const primary = document.createElement('button');
        primary.className = 'game-btn-primary quiz-restart';
        primary.type = 'button';
        if (offerPopular) {
            primary.textContent = t('quiz.play_popular');
            primary.addEventListener('click', () => this.play('popular'));
        } else {
            primary.textContent = t('quiz.retry');
            primary.addEventListener('click', () => this.restart());
        }
        const change = document.createElement('button');
        change.className = 'quiz-secondary-btn';
        change.type = 'button';
        change.textContent = t('quiz.change_source');
        change.addEventListener('click', () => this.start());
        actions.append(primary, change);
        status.append(title, details, actions);
        this.panel.replaceChildren(status);
        primary.focus({ preventScroll: true });
    }

    getUserFacingError(error) {
        if (error instanceof QuizLibraryError) {
            if (error.code === 'signed-out') return t('quiz.library_signed_out');
            if (error.code === 'unavailable') return t('quiz.library_unavailable');
            return error.message;
        }
        const presentation = window.ErrorPresentation?.getPresentation?.(error, {
            context: { operation: 'movie-quiz-load', category: 'provider' }
        });
        if (presentation?.message) return presentation.message;
        const message = String(error?.message || '');
        if (/DAILY_LIMIT_REACHED|429|суточн|limit/i.test(message)) return t('quiz.error_limit');
        if (/network|failed to fetch|сеть/i.test(message)) return t('quiz.error_network');
        return message || t('quiz.error_generic');
    }

    /** Plays again with the same source. */
    restart() {
        this.shownOptionIds.clear();
        this.shownOptionNames.clear();
        this.shownFranchises.clear();
        this.play(this.source);
    }

    render() { /* Quiz owns its HTML panel instead of the shared canvas. */ }
    togglePause() { /* Quiz waits for the next answer. */ }
    stop() {
        this.stopped = true;
        this.sessionId += 1;
        this.abortController?.abort();
        this.abortController = null;
        this.cancelReveal();
        if (this.transitionTimer) window.clearTimeout(this.transitionTimer);
        this.transitionTimer = null;
        this.shownOptionIds?.clear();
        this.shownOptionNames?.clear();
        this.shownFranchises?.clear();
        if (this.panel) this.panel.replaceChildren();
    }
}
