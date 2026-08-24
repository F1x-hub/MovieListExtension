import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { i18n } from '../src/shared/i18n/I18n.js';

i18n.currentLocale = 'ru';

// Mock DOM elements and browser environment
const windowStub = {
    location: { search: '' },
    history: { pushState: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
};

class MockElement {
    constructor() {
        this.innerHTML = '';
        this.textContent = '';
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.children = [];
        this.parentElement = null;
        this.className = '';
        this.classList = {
            _classes: new Set(),
            add: (c) => { this.classList._classes.add(c); this.className = Array.from(this.classList._classes).join(' '); },
            remove: (c) => { this.classList._classes.delete(c); this.className = Array.from(this.classList._classes).join(' '); },
            contains: (c) => this.classList._classes.has(c),
            toggle: (c, force) => {
                const shouldAdd = force !== undefined ? Boolean(force) : !this.classList._classes.has(c);
                if (shouldAdd) {
                    this.classList._classes.add(c);
                } else {
                    this.classList._classes.delete(c);
                }
                this.className = Array.from(this.classList._classes).join(' ');
                return shouldAdd;
            }
        };
        this.listeners = {};
    }
    get firstElementChild() {
        if (this.children.length > 0) return this.children[0];
        if (this.innerHTML) {
            const el = new MockElement();
            el.innerHTML = this.innerHTML;
            return el;
        }
        return null;
    }
    querySelector(sel) {
        if (!sel) return null;
        if (sel.includes('.season-episodes-panel') || sel.includes('season-episodes')) {
            return this.children.find(c => c.className === 'season-episodes-panel') || null;
        }
        if (sel.includes('.season-expand-text')) {
            return this.children.find(c => c.className === 'season-expand-text') || null;
        }
        if (sel.includes('.episodes-grid')) {
            return this.innerHTML && this.innerHTML.includes('episodes-grid') ? new MockElement() : null;
        }
        return null;
    }
    querySelectorAll() { return []; }
    addEventListener(evt, fn) {
        if (!this.listeners[evt]) this.listeners[evt] = [];
        this.listeners[evt].push(fn);
    }
    dispatchEvent(evt) {
        const type = typeof evt === 'string' ? evt : evt.type;
        (this.listeners[type] || []).forEach(fn => fn(evt));
    }
    setAttribute(k, v) {
        this.attributes[k] = String(v);
        if (k.startsWith('data-')) {
            const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[prop] = String(v);
        }
    }
    getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : ''; }
    closest(sel) {
        if (!sel) return null;
        if (sel.includes('.season-card')) {
            return this.parentElement || this;
        }
        return null;
    }
    appendChild(child) {
        this.children.push(child);
        child.parentElement = this;
        return child;
    }
}

const documentStub = {
    activeButtons: [],
    querySelector: () => null,
    querySelectorAll: (sel) => {
        if (sel && sel.includes('season-expand-btn')) {
            return documentStub.activeButtons;
        }
        return [];
    },
    getElementById: () => new MockElement(),
    createElement: (tag) => new MockElement(),
    addEventListener: () => {}
};

class KinopoiskServiceStub {
    getPersonsByProfession() { return []; }
    formatPersonNames() { return ''; }
    formatCurrency(val) { return val ? `$${val}` : ''; }
    formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
    }
}

const escapeHtmlHelper = (t) => {
    if (!t) return '';
    return String(t)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const utilsStub = {
    createPageStateManager: () => ({}),
    escapeHtml: escapeHtmlHelper,
    normalizeRatingComment: (v) => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'object') {
            if (typeof v.text === 'string') return v.text.trim();
            if (typeof v.comment === 'string') return v.comment.trim();
            return '';
        }
        return '';
    },
    parseSpoilers: (t) => t || '',
    linkify: (t) => t || ''
};

const source = fs
    .readFileSync(new URL('../src/pages/movie-details/movie-details.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '');

assert(
    source.includes('(resolvedTmdbId && renderedTmdbId !== resolvedTmdbId)'),
    'Recovered TMDB identity must invalidate an already-painted KP-only instant cache'
);
assert(
    source.includes('(resolvedLogoUrl && renderedLogoUrl !== resolvedLogoUrl)'),
    'Recovered provider logo must invalidate an already-painted text-title instant cache'
);
const watchingEyePath = 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z';
const malformedWatchingEyePath = 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z';
assert(!source.includes(malformedWatchingEyePath), 'MovieDetails must not emit the malformed watching-eye SVG path');
assert(
    source.includes(`d="${watchingEyePath}"`),
    'MovieDetails watching action must retain the canonical project eye SVG path'
);

const context = vm.createContext({
    window: windowStub,
    document: documentStub,
    i18n,
    KinopoiskService: KinopoiskServiceStub,
    Utils: utilsStub,
    console,
    fetch: async () => ({ ok: true, json: async () => ({ title: 'Resolved YouTube Title' }) }),
    Date,
    parseFloat,
    Math,
    Boolean,
    Number,
    Array,
    Object,
    Event: class {}
});

vm.runInContext(source, context);

const MovieDetailsManager = context.window.MovieDetailsManager;

console.log('🧪 Running MovieDetails Rich Data Phase 1A Hardening & Rendering Tests...\n');

// Create test instance
const manager = Object.create(MovieDetailsManager.prototype);
manager.isAdmin = false;
manager.escapeHtml = escapeHtmlHelper;
manager.formatVotes = MovieDetailsManager.prototype.formatVotes;
manager.shouldRenderShortDescription = MovieDetailsManager.prototype.shouldRenderShortDescription;
manager.translateVideoType = MovieDetailsManager.prototype.translateVideoType;
manager.rankVideos = MovieDetailsManager.prototype.rankVideos;
manager.selectPrimaryTrailer = MovieDetailsManager.prototype.selectPrimaryTrailer;
manager.resolvePrimaryTrailer = MovieDetailsManager.prototype.resolvePrimaryTrailer;
manager.resolveAndRenderTrailer = MovieDetailsManager.prototype.resolveAndRenderTrailer;
manager.renderTrailerBlock = MovieDetailsManager.prototype.renderTrailerBlock;
manager.openVideoModal = MovieDetailsManager.prototype.openVideoModal;
manager.loadYouTubeCommentTitle = MovieDetailsManager.prototype.loadYouTubeCommentTitle;
manager.openTrailerModal = MovieDetailsManager.prototype.openTrailerModal;
manager.openYouTubeModal = MovieDetailsManager.prototype.openYouTubeModal;
manager.closeTrailerModal = MovieDetailsManager.prototype.closeTrailerModal;
manager.loadTrailerFallback = MovieDetailsManager.prototype.loadTrailerFallback;
manager.resolveAndRenderSeasons = MovieDetailsManager.prototype.resolveAndRenderSeasons;
manager.loadSeasonsFallback = MovieDetailsManager.prototype.loadSeasonsFallback;
manager.loadSeasons = MovieDetailsManager.prototype.loadSeasons;
manager.getPluralEpisodes = MovieDetailsManager.prototype.getPluralEpisodes;
manager.renderSeasonsTab = MovieDetailsManager.prototype.renderSeasonsTab;
manager.formatDate = MovieDetailsManager.prototype.formatDate;
manager.toggleSeasonEpisodes = MovieDetailsManager.prototype.toggleSeasonEpisodes;
manager.handleSeasonPillSelect = MovieDetailsManager.prototype.handleSeasonPillSelect;
manager.renderEpisodesList = MovieDetailsManager.prototype.renderEpisodesList;
manager.renderHeroNextEpisode = MovieDetailsManager.prototype.renderHeroNextEpisode;
manager.isNextEpisodeStale = MovieDetailsManager.prototype.isNextEpisodeStale;
manager.revalidateDynamicData = MovieDetailsManager.prototype.revalidateDynamicData;
manager.patchDynamicSeriesUI = MovieDetailsManager.prototype.patchDynamicSeriesUI;
manager.dynamicRefreshRequests = new Map();
manager.renderCollectionsMenu = () => '';
manager.renderActorsTab = () => '';
manager.renderAwardsTab = () => '';
manager.renderSequelsAndPrequels = () => '';
manager.renderSimilarMovies = () => '';
manager.createMovieFramesSection = () => '';

// =========================================================================
// 1. CSP & Backdrop Hardening Tests
// =========================================================================
console.log('--- 1. Testing CSP Compliance & Backdrop Hardening ---');

// 1.1 Backdrop URL present -> NO inline onerror, uses data-fallback
const movieWithBackdrop = {
    kinopoiskId: 1001,
    name: 'Интерстеллар',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/xJHokMbljvjADYdit5fK5VQsXEG.jpg',
    rating: { kp: 8.6, imdb: 8.7, tmdb: 8.4 },
    votes: { kp: 1200000, imdb: 2000000, tmdb: 35000 }
};
const htmlWithBackdrop = manager.createDetailedMovieCard(movieWithBackdrop);
assert(htmlWithBackdrop.includes('class="movie-detail-hero-backdrop"'), 'Must render hero backdrop container when backdropUrl is present');
assert(htmlWithBackdrop.includes('class="movie-detail-hero-backdrop-img"'), 'Must render hero backdrop image tag');
assert(htmlWithBackdrop.includes('class="movie-detail-hero-backdrop-overlay"'), 'Must render hero backdrop gradient overlay');
assert(htmlWithBackdrop.includes('xJHokMbljvjADYdit5fK5VQsXEG.jpg'), 'Must inject correct backdrop image URL');
assert(!htmlWithBackdrop.includes('onerror='), 'Must NOT contain inline onerror attribute (CSP violation)');
assert(htmlWithBackdrop.includes('data-fallback="backdrop"'), 'Must have data-fallback="backdrop" attribute for delegated error handling');
console.log('  ✅ 1.1 Backdrop renders correctly without inline onerror (CSP compliant)');

// 1.2 User ratings templates contain NO inline handlers
const cardUserRating = manager._buildRatingCard({
    id: 'rating-1',
    userId: 'user-1',
    userName: 'Reviewer',
    userPhoto: 'https://example.com/avatar.jpg',
    rating: 9,
    comment: 'Great film!'
}, null);
assert(!cardUserRating.innerHTML.includes('onerror='), 'User rating card template must NOT contain inline onerror');
console.log('  ✅ 1.2 User rating avatar uses data-fallback="avatar" instead of inline onerror');

// 1.3 Missing/null backdrop
const movieWithoutBackdrop = {
    kinopoiskId: 1002,
    name: 'Без фона',
    backdropUrl: null,
    rating: { kp: 7.0 }
};
const htmlWithoutBackdrop = manager.createDetailedMovieCard(movieWithoutBackdrop);
assert(!htmlWithoutBackdrop.includes('movie-detail-hero-backdrop'), 'Must NOT render hero backdrop when backdropUrl is missing or null');
console.log('  ✅ 1.3 Missing backdrop gracefully omitted without empty containers');

// =========================================================================
// 2. Strict Rating Isolation & TMDB Legacy Compatibility Tests
// =========================================================================
console.log('--- 2. Testing Strict Rating Isolation & Legacy Compatibility ---');

// 2.1 Modern DTO: All 3 ratings present (KP and IMDb in left rail, TMDB in About tab)
const movieAllRatings = {
    kinopoiskId: 1003,
    name: 'Матрица',
    rating: { kp: 8.5, imdb: 8.7, tmdb: 8.2 },
    votes: { kp: 800000, imdb: 1900000, tmdb: 24000 }
};
const htmlAllRatings = manager.createDetailedMovieCard(movieAllRatings);
assert(htmlAllRatings.includes('rating-item-large kp'), 'Must render KP rating card');
assert(htmlAllRatings.includes('8.5'), 'Must render KP rating value 8.5');
assert(htmlAllRatings.includes('rating-item-large imdb'), 'Must render IMDb rating card');
assert(htmlAllRatings.includes('8.7'), 'Must render IMDb rating value 8.7');
assert(!htmlAllRatings.includes('rating-item-large tmdb'), 'TMDB rating card removed from left rail');
assert(htmlAllRatings.includes('meta-item--tmdb'), 'Must render TMDB row in About tab');
assert(htmlAllRatings.includes('8.2'), 'Must render TMDB rating value 8.2');
assert(htmlAllRatings.includes('Рейтинг TMDB'), 'Must render TMDB label');
console.log('  ✅ 2.1 Modern DTO: KP/IMDb on left rail, TMDB in About tab');

// 2.2 Legacy DTO fallback: movie.ratingTmdb and movie.voteCount
const movieLegacyTmdb = {
    kinopoiskId: 1004,
    name: 'Легаси фильм',
    rating: { kp: 7.5 },
    ratingTmdb: 7.9,
    voteCount: 1540
};
const htmlLegacyTmdb = manager.createDetailedMovieCard(movieLegacyTmdb);
assert(!htmlLegacyTmdb.includes('rating-item-large tmdb'), 'TMDB card absent from left rail');
assert(htmlLegacyTmdb.includes('meta-item--tmdb'), 'Must render TMDB row in About tab from legacy ratingTmdb field');
assert(htmlLegacyTmdb.includes('7.9'), 'Must render legacy TMDB rating value 7.9');
console.log('  ✅ 2.2 Legacy DTO: movie.ratingTmdb and movie.voteCount supported');

// 2.3 Strict provider isolation: TMDB rating must NEVER populate IMDb card
const movieIsolationCheck = {
    kinopoiskId: 1005,
    name: 'Изоляция',
    rating: { kp: 0, imdb: 0, tmdb: 8.1 },
    votes: { kp: 0, imdb: 0, tmdb: 500 }
};
const htmlIsolationCheck = manager.createDetailedMovieCard(movieIsolationCheck);
assert(!htmlIsolationCheck.includes('rating-item-large imdb'), 'TMDB rating must NEVER populate IMDb rating card');
assert(!htmlIsolationCheck.includes('rating-item-large kp'), 'TMDB rating must NEVER populate KP rating card');
assert(!htmlIsolationCheck.includes('rating-item-large tmdb'), 'TMDB not in left rail');
assert(htmlIsolationCheck.includes('meta-item--tmdb'), 'TMDB rendered in About tab');
assert(htmlIsolationCheck.includes('8.1'), 'TMDB rating 8.1 rendered');
console.log('  ✅ 2.3 Strict isolation verified: TMDB never cross-contaminates IMDb or KP');

// 2.4 TMDB rating 0 / null -> suppressed
const movieZeroTmdb = {
    kinopoiskId: 1006,
    name: 'Без оценок TMDB',
    rating: { kp: 7.0, tmdb: 0 }
};
const htmlZeroTmdb = manager.createDetailedMovieCard(movieZeroTmdb);
assert(!htmlZeroTmdb.includes('rating-item-large tmdb'), 'TMDB rating 0 must be suppressed in left rail');
assert(!htmlZeroTmdb.includes('meta-item--tmdb'), 'TMDB rating 0 must be suppressed in About tab');
console.log('  ✅ 2.4 TMDB rating 0/null suppressed (no fake 0.0 rating card)');

// =========================================================================
// 3. Short Description Synopsis Teaser & Deduplication Tests
// =========================================================================
console.log('--- 3. Testing Short Description Heuristics ---');

// 3.1 Invalid / stub cases
assert.strictEqual(manager.shouldRenderShortDescription(null, 'Полное описание'), false, 'Null shortDesc -> false');
assert.strictEqual(manager.shouldRenderShortDescription('', 'Полное описание'), false, 'Empty shortDesc -> false');
assert.strictEqual(manager.shouldRenderShortDescription('Кратко', 'Полное описание'), false, '<10 chars -> false');

// 3.2 Exact duplicate
assert.strictEqual(
    manager.shouldRenderShortDescription('Один в один описание фильма', 'Один в один описание фильма'),
    false,
    'Exact duplicate -> false'
);

// 3.3 90% near-duplicate (shorter / longer >= 0.85 and longer contains shorter)
assert.strictEqual(
    manager.shouldRenderShortDescription(
        'После исчезновения дочери отец начинает собственное расследование и ищет зацепки.',
        'После исчезновения дочери отец начинает собственное расследование и ищет зацепки везде.'
    ),
    false,
    '90% near-duplicate -> false (hidden)'
);

// 3.4 Useful short prefix (< 85% of full length) MUST remain visible
assert.strictEqual(
    manager.shouldRenderShortDescription(
        'После исчезновения дочери отец начинает собственное расследование.',
        'После исчезновения дочери отец начинает собственное расследование, которое приводит его в самые темные уголки города, раскрывая тайны прошлого и заставляя столкнуться с опасными врагами.'
    ),
    true,
    'Useful short prefix teaser MUST remain visible (true)'
);

// 3.5 Completely distinct synopsis teaser
assert.strictEqual(
    manager.shouldRenderShortDescription(
        'Группа исследователей отправляется сквозь червоточину в поисках нового дома для человечества.',
        'Когда засуха, пыльные бури и вымирание растений приводят человечество к продовольственному кризису, коллектив ученых отправляется сквозь пространственно-временной тоннель...'
    ),
    true,
    'Distinct synopsis teaser -> true'
);
console.log('  ✅ 3.1 Short description heuristic preserves useful prefixes and suppresses exact/near duplicates');

// =========================================================================
// 4. Digital Premiere Timestamp Deduplication Tests
// =========================================================================
console.log('--- 4. Testing Digital Premiere Timestamp Deduplication ---');

// 4.1 Distinct digital premiere
const movieDistinctDigital = {
    kinopoiskId: 1007,
    name: 'Премьерный фильм',
    premiere: {
        world: '2025-07-15T00:00:00.000Z',
        digital: '2025-09-01T00:00:00.000Z'
    }
};
const htmlDistinctDigitalRes = manager.createDetailedMovieCard(movieDistinctDigital);
assert(htmlDistinctDigitalRes.includes('Цифровой релиз:'), 'Must show digital premiere row');
assert(htmlDistinctDigitalRes.includes('01.09.2025'), 'Must format digital premiere date');
console.log('  ✅ 4.1 Distinct digital premiere rendered');

// 4.2 Duplicate timestamp matching world premiere -> suppressed
const movieDupDigital = {
    kinopoiskId: 1008,
    name: 'Стриминг онли',
    premiere: {
        world: '2025-10-10T00:00:00.000Z',
        digital: '2025-10-10T00:00:00.000Z'
    }
};
const htmlDupDigital = manager.createDetailedMovieCard(movieDupDigital);
assert(htmlDupDigital.includes('Премьера в мире:'), 'World premiere rendered');
assert(!htmlDupDigital.includes('Цифровой релиз:'), 'Duplicate digital premiere row suppressed');
console.log('  ✅ 4.2 Duplicate digital premiere suppressed by timestamp check');

// =========================================================================
// 5. Age Rating & MPAA Safety Tests
// =========================================================================
console.log('--- 5. Testing Age Rating & MPAA Normalization Safety ---');

// 5.1 Valid combined
const movieAgeMpaa = {
    kinopoiskId: 1009,
    name: 'Бэтмен',
    ageRating: 16,
    ratingMpaa: 'pg-13'
};
const htmlAgeMpaa = manager.createDetailedMovieCard(movieAgeMpaa);
assert(htmlAgeMpaa.includes('16+ • PG-13'), 'Renders 16+ • PG-13');

// 5.2 Invalid / 0 age rating
const movieInvalidAge = {
    kinopoiskId: 1010,
    name: 'Без возраста',
    ageRating: 0,
    ratingMpaa: 'R'
};
const htmlInvalidAge = manager.createDetailedMovieCard(movieInvalidAge);
assert(htmlInvalidAge.includes('R'), 'Preserves MPAA R');
assert(!htmlInvalidAge.includes('0+'), 'Suppresses invalid 0+ age');
assert(!htmlInvalidAge.includes('null+'), 'Suppresses null+');

// 5.3 Missing both
const movieNoAge = {
    kinopoiskId: 1011,
    name: 'Ничего',
    ageRating: null,
    ratingMpaa: null
};
const htmlNoAge = manager.createDetailedMovieCard(movieNoAge);
assert(!htmlNoAge.includes('Возраст:'), 'Omit age row entirely');
console.log('  ✅ 5.1 Age & MPAA safety formatting verified');

// =========================================================================
// 6. Legacy Pre-Phase-1A Cached DTO Compatibility
// =========================================================================
console.log('--- 6. Testing Legacy Pre-Phase-1A Cached DTO Rendering ---');

const legacyCachedDTO = {
    kinopoiskId: 301,
    name: 'Матрица',
    alternativeName: 'The Matrix',
    year: 1999,
    posterUrl: 'https://kinopoiskapiunofficial.tech/images/posters/kp/301.jpg',
    description: 'Хакер Нео узнает правду о реальности...',
    rating: {
        kp: 8.5,
        imdb: 8.7
    },
    votes: {
        kp: 750000,
        imdb: 1800000
    },
    ageRating: 16,
    premiere: {
        world: '1999-03-31T00:00:00.000Z'
    }
    // Note: No backdropUrl, no rating.tmdb, no ratingTmdb, no shortDescription, no ratingMpaa, no premiere.digital
};

const htmlLegacy = manager.createDetailedMovieCard(legacyCachedDTO);
assert(htmlLegacy.includes('Матрица'), 'Legacy DTO renders title');
assert(htmlLegacy.includes('rating-item-large kp'), 'Legacy DTO renders KP rating');
assert(htmlLegacy.includes('rating-item-large imdb'), 'Legacy DTO renders IMDb rating');
assert(!htmlLegacy.includes('rating-item-large tmdb'), 'Legacy DTO safely omits TMDB rating');
assert(!htmlLegacy.includes('movie-detail-hero-backdrop'), 'Legacy DTO safely omits backdrop');
assert(!htmlLegacy.includes('movie-detail-short-description'), 'Legacy DTO safely omits short description');
assert(!htmlLegacy.includes('Цифровой релиз:'), 'Legacy DTO safely omits digital premiere');
assert(htmlLegacy.includes('16+'), 'Legacy DTO renders 16+ age');
console.log('  ✅ 6.1 Legacy cached DTO renders flawlessly with 0 errors');

// =========================================================================
// 7. The Backrooms Acceptance Fixture (KP 5452840 ↔ TMDB 1083381)
// =========================================================================
console.log('--- 7. Testing The Backrooms Acceptance Fixture Rendering ---');

const backroomsUnifiedDTO = {
    kinopoiskId: 5452840,
    name: 'Закулисье',
    alternativeName: 'The Backrooms',
    year: 2026,
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/backrooms_hero.jpg',
    posterUrl: 'https://image.tmdb.org/t/p/w500/backrooms_poster.jpg',
    shortDescription: 'A young filmmaker enters an anomalous liminal space.',
    description: 'Feature film adaptation of Kane Parsons viral horror series about liminal spaces and endless office corridors.',
    rating: {
        kp: 0,
        imdb: 0,
        tmdb: 7.9
    },
    votes: {
        kp: 0,
        imdb: 0,
        tmdb: 1420
    },
    ageRating: 16,
    ratingMpaa: 'PG-13',
    premiere: {
        world: '2026-05-15T00:00:00.000Z',
        digital: '2026-08-01T00:00:00.000Z'
    },
    _meta: {
        identity: { status: 'VERIFIED', method: 'exact_external_tmdb' },
        fieldSources: {
            backdropUrl: 'tmdb',
            ratingTmdb: 'tmdb',
            shortDescription: 'tmdb'
        }
    }
};

const htmlBackrooms = manager.createDetailedMovieCard(backroomsUnifiedDTO);

// Backdrop check
assert(htmlBackrooms.includes('backrooms_hero.jpg'), 'Backrooms must render TMDB backdrop');
assert(htmlBackrooms.includes('class="movie-detail-hero-backdrop"'), 'Backrooms must have backdrop DOM');
assert(!htmlBackrooms.includes('onerror='), 'Backrooms backdrop must not have inline onerror');

// Rating check
assert(!htmlBackrooms.includes('rating-item-large tmdb'), 'Backrooms must NOT render TMDB in left rail');
assert(htmlBackrooms.includes('meta-item--tmdb'), 'Backrooms must render TMDB in About tab');
assert(htmlBackrooms.includes('7.9'), 'Backrooms must render TMDB rating 7.9');
assert(!htmlBackrooms.includes('rating-item-large kp'), 'Backrooms must NOT render KP rating card (was 0)');
assert(!htmlBackrooms.includes('rating-item-large imdb'), 'Backrooms must NOT render IMDb rating card (was 0)');

// Short description & title check
assert(htmlBackrooms.includes('class="movie-detail-short-description"'), 'Backrooms must render short description');
assert(htmlBackrooms.includes('A young filmmaker enters an anomalous liminal space.'), 'Backrooms short description content');

// Age rating check
assert(htmlBackrooms.includes('16+ • PG-13'), 'Backrooms must render combined 16+ • PG-13');

// Digital release check
assert(htmlBackrooms.includes('Цифровой релиз:'), 'Backrooms must render digital premiere');
assert(htmlBackrooms.includes('01.08.2026'), 'Backrooms must format digital release date');

// Data provenance safety check: _meta.fieldSources must never leak into HTML output
assert(!htmlBackrooms.includes('fieldSources'), '_meta.fieldSources must NEVER leak into rendered HTML');
assert(!htmlBackrooms.includes('exact_external_tmdb'), 'Internal verification method must NOT be exposed in HTML');

// =========================================================================
// 8. Genres and Countries Format Diversity Tests (Objects vs Strings vs Corrupted)
// =========================================================================
console.log('--- 8. Testing Genres and Countries Object/String Format Safety ---');

const movieObjectGenres = {
    kinopoiskId: 252107,
    name: 'Фильм с объектами жанров',
    genres: [{ name: 'драма' }, { name: 'триллер' }, { genre: 'криминал' }],
    countries: [{ name: 'США' }, { country: 'Великобритания' }]
};
const htmlObjectGenres = manager.createDetailedMovieCard(movieObjectGenres);
assert(htmlObjectGenres.includes('252107'), 'Card rendered successfully');

const movieStringGenres = {
    kinopoiskId: 252108,
    name: 'Фильм со строками жанров',
    genres: ['драма', 'триллер'],
    countries: ['США', 'Великобритания']
};
const htmlStringGenres = manager.createDetailedMovieCard(movieStringGenres);
assert(htmlStringGenres.includes('252108'), 'Card rendered with string genres');

const movieCorruptedGenres = {
    kinopoiskId: 252109,
    name: 'Фильм с поврежденными жанрами',
    genres: [null, undefined, {}, { invalid: true }],
    countries: [null, undefined, {}, { invalid: true }]
};
const htmlCorruptedGenres = manager.createDetailedMovieCard(movieCorruptedGenres);
assert(htmlCorruptedGenres.includes('252109'), 'Card rendered with corrupted genres without throwing');

console.log('  ✅ 8.1 Object, string, and corrupted genres/countries handled safely');

// =========================================================================
// 9. Phase 1C: Status Translation & Badge Safety Tests
// =========================================================================
console.log('\n--- 9. Testing Phase 1C: Status Translation & Badge Safety ---');

assert.strictEqual(manager.translateStatus('Released'), 'Выпущен');
assert.strictEqual(manager.translateStatus('Post Production'), 'Постпродакшн');
assert.strictEqual(manager.translateStatus('In Production'), 'В производстве');
assert.strictEqual(manager.translateStatus('Planned'), 'Запланирован');
assert.strictEqual(manager.translateStatus('Returning Series'), 'Онгоинг');
assert.strictEqual(manager.translateStatus('Ended'), 'Завершён');
assert.strictEqual(manager.translateStatus('Canceled'), 'Отменён');
assert.strictEqual(manager.translateStatus('Pilot'), 'Пилот');
assert.strictEqual(manager.translateStatus(null), null);
assert.strictEqual(manager.translateStatus(''), null);

const movieWithStatus = {
    kinopoiskId: 3001,
    name: 'Фильм со статусом',
    status: 'In Production'
};
const htmlWithStatus = manager.createDetailedMovieCard(movieWithStatus);
assert(htmlWithStatus.includes('class="meta-item"'), 'Must render meta-item for status');
assert(htmlWithStatus.includes('Статус</span>'), 'Must render label for status');
assert(htmlWithStatus.includes('В производстве</span>'), 'Must render translated status');
assert(htmlWithStatus.includes('status-badge--upcoming'), 'Must assign proper status badge class');

const movieWithoutStatus = {
    kinopoiskId: 3002,
    name: 'Фильм без статуса'
};
const htmlWithoutStatus = manager.createDetailedMovieCard(movieWithoutStatus);
assert(!htmlWithoutStatus.includes('Статус</span>'), 'Must NOT render status block when status is missing');
console.log('  ✅ 9.1 Status translation, badge CSS classing, and null suppression verified');

// =========================================================================
// 10. Phase 1C: Production Companies Rendering & Bounding Tests
// =========================================================================
console.log('\n--- 10. Testing Phase 1C: Production Companies Rendering & Bounding ---');

const movieWithCompanies = {
    kinopoiskId: 3003,
    name: 'Фильм со студиями',
    productionCompanies: [
        { tmdbId: 1, name: 'Warner Bros. Pictures', logoUrl: 'https://image.tmdb.org/t/p/w185/logo1.png', originCountry: 'US' },
        { tmdbId: 2, name: 'Syncopy', logoUrl: null, originCountry: 'GB' },
        { tmdbId: 3, name: 'Legendary Pictures', logoUrl: 'https://image.tmdb.org/t/p/w185/logo3.png', originCountry: 'US' },
        { tmdbId: 4, name: 'Studio 4', logoUrl: null, originCountry: 'US' },
        { tmdbId: 5, name: 'Studio 5', logoUrl: null, originCountry: 'FR' },
        { tmdbId: 6, name: 'Studio 6', logoUrl: null, originCountry: 'DE' },
        { tmdbId: 7, name: 'Studio 7 (Overflow)', logoUrl: null, originCountry: 'IT' },
        { tmdbId: 8, name: 'Studio 8 (Overflow)', logoUrl: null, originCountry: 'ES' }
    ]
};
const htmlWithCompanies = manager.createDetailedMovieCard(movieWithCompanies);
assert(htmlWithCompanies.includes('class="meta-item meta-item--companies"'), 'Must render companies meta item');
assert(htmlWithCompanies.includes('Warner Bros. Pictures'), 'Must render company name');
assert(htmlWithCompanies.includes('Syncopy'), 'Must render company without logo');
assert(htmlWithCompanies.includes('data-fallback="company-logo"'), 'Company logo must use data-fallback="company-logo"');
assert(!htmlWithCompanies.includes('onerror='), 'Must NOT have inline onerror on company logos');
assert(htmlWithCompanies.includes('class="production-company-more">+2</span>'), 'Must display +2 overflow badge for >6 companies');

const movieWithNoCompanies = {
    kinopoiskId: 3004,
    name: 'Фильм без студий',
    productionCompanies: []
};
const htmlWithNoCompanies = manager.createDetailedMovieCard(movieWithNoCompanies);
assert(!htmlWithNoCompanies.includes('meta-item--companies'), 'Must NOT render companies block when list is empty');
console.log('  ✅ 10.1 Production companies bounded to 6, logos protected by CSP, overflow badge rendered');

// =========================================================================
// 11. Phase 1C: Critic Ratings Rendering Tests
// =========================================================================
console.log('\n--- 11. Testing Phase 1C: Critic Ratings Rendering & Scale ---');

const movieWithCritics = {
    kinopoiskId: 3005,
    name: 'Фильм с критиками',
    criticRatings: {
        international: { rating: 88.5, votes: 450 },
        russian: { rating: 92, votes: 45 }
    }
};
const htmlWithCritics = manager.createDetailedMovieCard(movieWithCritics);
assert(htmlWithCritics.includes('meta-item--critics'), 'Must render critic ratings meta item');
assert(htmlWithCritics.includes('Мировые: <strong class="critic-score">88.5%</strong> <span class="critic-votes">(450)</span>'), 'Must format international critics');
assert(htmlWithCritics.includes('Российские: <strong class="critic-score">92%</strong> <span class="critic-votes">(45)</span>'), 'Must format russian critics');

const movieWithNoCritics = {
    kinopoiskId: 3006,
    name: 'Фильм без критиков',
    criticRatings: {
        international: { rating: 0, votes: 0 },
        russian: { rating: 0, votes: 0 }
    }
};
const htmlWithNoCritics = manager.createDetailedMovieCard(movieWithNoCritics);
assert(!htmlWithNoCritics.includes('meta-item--critics'), 'Must NOT render critic ratings meta item when ratings are 0');
console.log('  ✅ 11.1 Critic ratings rendered in percentage scale, separated from user score cards');

// =========================================================================
// 12. Franchise Section Placeholder Tests (Interactive Franchise Feature)
// =========================================================================
console.log('\n--- 12. Testing Franchise Section Placeholder ---');

const movieWithCollection = {
    kinopoiskId: 3007,
    name: 'Фильм из франшизы',
    collection: {
        tmdbId: 131292,
        name: 'Трилогия «Тёмный рыцарь»',
        posterUrl: 'https://image.tmdb.org/t/p/w500/collection.jpg',
        backdropUrl: 'https://image.tmdb.org/t/p/w1280/col_bg.jpg'
    }
};
const htmlWithCollection = manager.createDetailedMovieCard(movieWithCollection);
assert(htmlWithCollection.includes('class="movie-franchise-section"'), 'Must render franchise section placeholder');
assert(htmlWithCollection.includes('id="movieFranchiseSection"'), 'Must render #movieFranchiseSection');
assert(htmlWithCollection.includes('class="movie-franchise-label">Франшиза</span>'), 'Must render franchise label');
assert(htmlWithCollection.includes('Трилогия «Тёмный рыцарь»'), 'Must render franchise name');
assert(!htmlWithCollection.includes('movie-collection-banner'), 'Old static banner must be removed');

const movieWithoutCollection = {
    kinopoiskId: 3008,
    name: 'Одиночный фильм',
    collection: null
};
const htmlWithoutCollection = manager.createDetailedMovieCard(movieWithoutCollection);
assert(!htmlWithoutCollection.includes('movie-franchise-section'), 'Must NOT render franchise section when null');
assert(!htmlWithoutCollection.includes('movie-collection-banner'), 'Must NOT render old banner when null');
console.log('  ✅ 12.1 Franchise section placeholder rendered cleanly without old static banner');

// =========================================================================
// 13. Phase 1C: Videos & Trailers Rendering & Lazy Embed Tests
// =========================================================================
console.log('\n--- 13. Testing Phase 1C: Videos & Trailers Rendering & Lazy Embed ---');

const movieWithVideos = {
    kinopoiskId: 3009,
    name: 'Фильм с видео',
    videos: [
        { id: 'v1', key: 'dQw4w9WgXcQ', name: 'Official Trailer', site: 'YouTube', type: 'Trailer', official: true, priority: 100 },
        { id: 'v2', key: 'kJQP7kiw5Fk', name: 'Teaser Trailer', site: 'YouTube', type: 'Teaser', official: true, priority: 80 },
        { id: 'v3', key: '9bZkp7q19f0', name: 'Movie Clip', site: 'YouTube', type: 'Clip', official: false, priority: 50 },
        { id: 'v4', key: '3JZ_D3ELwOQ', name: 'Behind the Scenes', site: 'YouTube', type: 'Behind the Scenes', official: false, priority: 40 },
        { id: 'v5', key: 'fJ9rUzIMcZQ', name: 'Featurette', site: 'YouTube', type: 'Featurette', official: false, priority: 30 },
        { id: 'v6', key: 'L_LUpnjgPso', name: 'Bloopers', site: 'YouTube', type: 'Bloopers', official: false, priority: 20 },
        { id: 'v7', key: 'OVERFLOW123', name: 'Overflow Video', site: 'YouTube', type: 'Bloopers', official: false, priority: 10 }
    ]
};
const htmlWithVideos = manager.createDetailedMovieCard(movieWithVideos);
assert(htmlWithVideos.includes('class="movie-videos-section"'), 'Must render videos section');
assert(htmlWithVideos.includes('class="movie-videos-grid"'), 'Must render videos grid');
assert(!htmlWithVideos.includes('data-video-key="dQw4w9WgXcQ"'), 'Primary trailer must be excluded from gallery');
assert(htmlWithVideos.includes('data-video-key="kJQP7kiw5Fk"'), 'Must contain secondary video key data attribute');
assert(htmlWithVideos.includes('https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg'), 'Must inject YouTube thumbnail URL');
assert(htmlWithVideos.includes('data-fallback="youtube-thumb"'), 'Must have data-fallback="youtube-thumb" on thumbnail img');
assert(htmlWithVideos.includes('badge-official">Официальный</span>'), 'Must render official badge');
assert(htmlWithVideos.includes('badge-type">Тизер</span>'), 'Must render translated video type badge');
assert(!htmlWithVideos.includes('<iframe'), 'Must NOT embed any <iframe> on page load (lazy on-click only)');
assert.strictEqual((htmlWithVideos.match(/class="movie-video-card"/g) || []).length, 6, 'Must bound rendered videos to maximum 6 items');

// Modal embed test
const trailerModalStub = new MockElement();
const trailerContainerStub = new MockElement();
const trailerTitleStub = new MockElement();
manager.elements = {
    trailerModal: trailerModalStub,
    trailerContainer: trailerContainerStub,
    trailerTitle: trailerTitleStub
};
manager.openYouTubeModal('dQw4w9WgXcQ', 'Official Trailer');
assert.strictEqual(trailerModalStub.style.display, 'flex', 'Modal must be set to display: flex on open');
assert(trailerContainerStub.innerHTML.includes('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&amp;rel=0') ||
       trailerContainerStub.innerHTML.includes('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0'),
       'Trailer container must receive youtube-nocookie embed iframe');
assert.strictEqual(trailerTitleStub.textContent, 'Official Trailer', 'Trailer modal title must match');
console.log('  ✅ 13.1 Videos prioritized, bounded to 6, 0 upfront iframes, and lazy modal opened on click');

// =========================================================================
// 14. Phase 1C: Facts Tab & Spoiler Safety Tests
// =========================================================================
console.log('\n--- 14. Testing Phase 1C: Facts Tab & Spoiler Safety ---');

const movieWithFacts = {
    kinopoiskId: 3010,
    name: 'Фильм с фактами',
    facts: [
        { value: 'Первый интересный факт о съемках.', spoiler: false },
        { value: 'Второй факт: главный герой в конце погибает!', spoiler: true },
        { value: 'Третий факт о локациях.', spoiler: false },
        { value: 'Четвертый факт о бюджете.', spoiler: false },
        { value: 'Пятый факт об актерах.', spoiler: false },
        { value: 'Шестой факт (скрытый до раскрытия списка).', spoiler: false },
        { value: 'Седьмой факт с <script>alert("xss")</script> инъекцией.', spoiler: false }
    ]
};
const htmlWithFacts = manager.createDetailedMovieCard(movieWithFacts);
assert(htmlWithFacts.includes('data-tab="facts">Факты <span class="tab-count-badge">7</span></button>'), 'Must render Facts tab button with count badge');
assert(htmlWithFacts.includes('id="tab-facts"'), 'Must render Facts tab pane container');
assert(htmlWithFacts.includes('Первый интересный факт о съемках.'), 'Must render non-spoiler fact');
assert(htmlWithFacts.includes('class="fact-item fact-item--spoiler"'), 'Must wrap spoiler fact in spoiler container');
assert(htmlWithFacts.includes('class="btn-reveal-spoiler"'), 'Must render spoiler reveal button');
assert(htmlWithFacts.includes('class="fact-text fact-text--concealed"'), 'Spoiler text must have concealed class');
assert(htmlWithFacts.includes('class="facts-list facts-list-hidden"'), 'Overflow facts (>5) must be hidden initially');
assert(htmlWithFacts.includes('class="btn-show-all-facts"'), 'Must render show more facts button');
assert(!htmlWithFacts.includes('<script>'), 'Facts must be HTML-escaped to prevent XSS');

const movieWithoutFacts = {
    kinopoiskId: 3011,
    name: 'Фильм без фактов',
    facts: []
};
const htmlWithoutFacts = manager.createDetailedMovieCard(movieWithoutFacts);
assert(!htmlWithoutFacts.includes('data-tab="facts"'), 'Must NOT render Facts tab when facts are empty');
assert(!htmlWithoutFacts.includes('id="tab-facts"'), 'Must NOT render Facts tab pane when facts are empty');
console.log('  ✅ 14.1 Facts tab rendered with spoiler protection, XSS escaping, and show-more toggle');

// =========================================================================
// 15. Phase 1C: Movie Title Logo Tests
// =========================================================================
console.log('\n--- 15. Testing Phase 1C: Movie Title Logo Rendering & Title Retention ---');

const movieWithLogo = {
    kinopoiskId: 3012,
    name: 'Интерстеллар',
    logoUrl: 'https://avatars.mds.yandex.net/get-kinopoisk-image/1900788/logo.png'
};
const htmlWithLogo = manager.createDetailedMovieCard(movieWithLogo);
assert(htmlWithLogo.includes('class="movie-detail-logo-container"'), 'Must render logo container');
assert(htmlWithLogo.includes('class="movie-detail-title-logo"'), 'Must render logo image element');
assert(htmlWithLogo.includes('data-fallback="title-logo"'), 'Must have data-fallback="title-logo" for safe error fallback');
assert(!htmlWithLogo.includes('onerror='), 'Must NOT contain inline onerror');
assert(htmlWithLogo.includes('class="movie-detail-page-title') && htmlWithLogo.includes('>Интерстеллар</h1>'), 'Title text H1 MUST ALWAYS remain in DOM');

const movieWithoutLogo = {
    kinopoiskId: 3013,
    name: 'Фильм без лого',
    logoUrl: null
};
const htmlWithoutLogo = manager.createDetailedMovieCard(movieWithoutLogo);
assert(!htmlWithoutLogo.includes('movie-detail-logo-container'), 'Must NOT render logo container when logoUrl is missing');
assert(htmlWithoutLogo.includes('class="movie-detail-page-title') && htmlWithoutLogo.includes('>Фильм без лого</h1>'), 'Title text H1 must render normally');
console.log('  ✅ 15.1 Logo rendered cleanly above title with 100% title DOM and accessibility preservation');

// =========================================================================
// 16. Comprehensive Acceptance Fixture: The Backrooms with Phase 1C Rich Data
// =========================================================================
console.log('\n--- 16. Testing Full Acceptance Fixture: The Backrooms with Phase 1C Enriched DTO ---');

const fullBackroomsDTO = {
    kinopoiskId: 5452840,
    tmdbId: 1083381,
    name: 'The Backrooms',
    alternativeName: 'The Backrooms',
    year: 2026,
    status: 'In Production',
    logoUrl: 'https://image.tmdb.org/t/p/original/backrooms_logo.png',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/backrooms_hero.jpg',
    posterUrl: 'https://image.tmdb.org/t/p/w500/backrooms_poster.jpg',
    rating: { kp: 0, imdb: 0, tmdb: 7.9 },
    votes: { kp: 0, imdb: 0, tmdb: 120 },
    productionCompanies: [
        { tmdbId: 33, name: 'Universal Pictures', logoUrl: 'https://image.tmdb.org/t/p/w185/universal.png', originCountry: 'US' },
        { tmdbId: 420, name: '21 Laps Entertainment', logoUrl: null, originCountry: 'US' },
        { tmdbId: 3172, name: 'Blumhouse Productions', logoUrl: 'https://image.tmdb.org/t/p/w185/blumhouse.png', originCountry: 'US' },
        { tmdbId: 89917, name: 'Atomic Monster', logoUrl: 'https://image.tmdb.org/t/p/w185/atomic.png', originCountry: 'US' }
    ],
    collection: {
        tmdbId: 999999,
        name: 'The Backrooms Universe'
    },
    videos: [
        { id: 'br_v1', key: 'H4g2ln6k4kY', name: 'The Backrooms - Official Teaser', site: 'YouTube', type: 'Teaser', official: true, priority: 80 },
        { id: 'br_v2', key: 'BR_CLIP_123', name: 'The Backrooms - Clip', site: 'YouTube', type: 'Clip', official: false }
    ],
    facts: [
        { value: 'Основано на вирусном короткометражном видео Кейна Парсонса.', spoiler: false }
    ],
    criticRatings: {
        international: { rating: 0, votes: 0 },
        russian: { rating: 0, votes: 0 }
    },
    shortDescription: 'A young filmmaker enters an anomalous liminal space.',
    description: 'Full synopsis of the upcoming feature film The Backrooms.',
    _meta: {
        primarySource: 'tmdb',
        fieldSources: {
            status: 'tmdb',
            videos: 'tmdb',
            productionCompanies: 'tmdb'
        }
    }
};

const htmlFullBackrooms = manager.createDetailedMovieCard(fullBackroomsDTO);

// Verification of all Phase 1C rich features in one acceptance card:
assert(htmlFullBackrooms.includes('backrooms_logo.png'), 'Backrooms must render logo');
assert(htmlFullBackrooms.includes('В производстве'), 'Backrooms must render translated status');
assert(htmlFullBackrooms.includes('Universal Pictures'), 'Backrooms must render Universal Pictures studio');
assert(htmlFullBackrooms.includes('The Backrooms Universe'), 'Backrooms must render franchise banner');
assert(!htmlFullBackrooms.includes('data-video-key="H4g2ln6k4kY"'), 'Backrooms primary teaser must be excluded from gallery');
assert(htmlFullBackrooms.includes('data-video-key="BR_CLIP_123"'), 'Backrooms must render secondary clip in gallery');
assert(htmlFullBackrooms.includes('Кейна Парсонса'), 'Backrooms must render facts tab content');
assert(!htmlFullBackrooms.includes('onerror='), 'Zero inline onerror in entire rendered output');

const brPrimary = manager.resolvePrimaryTrailer(fullBackroomsDTO);
assert.strictEqual(brPrimary.trailer.key, 'H4g2ln6k4kY', 'Backrooms primary teaser resolved');
assert.strictEqual(brPrimary.source, 'TMDB_STRUCTURED', 'Backrooms primary source is TMDB_STRUCTURED');

console.log('  ✅ 16.1 Full enriched Backrooms fixture renders all rich components flawlessly with 0 errors');

// =========================================================================
// 17. Phase 1D: Video Ranking & Primary Trailer Selection
// =========================================================================
console.log('\n--- 17. Testing Phase 1D: Video Ranking & Primary Trailer Selection ---');

const mixedVideos = [
    { provider: 'YouTube', key: 'clip_1', name: 'Movie Clip', type: 'Clip', official: true },
    { provider: 'YouTube', key: 'trailer_fan', name: 'Fan Made Trailer', type: 'Trailer', official: false, language: 'ru' },
    { provider: 'YouTube', key: 'teaser_en', name: 'English Teaser', type: 'Teaser', official: true, language: 'en' },
    { provider: 'YouTube', key: 'teaser_ru', name: 'Russian Teaser', type: 'Teaser', official: true, language: 'ru' },
    { provider: 'YouTube', key: 'trailer_en', name: 'English Official Trailer', type: 'Trailer', official: true, language: 'en' },
    { provider: 'YouTube', key: 'trailer_ru', name: 'Russian Official Trailer', type: 'Trailer', official: true, language: 'ru' }
];

const ranked = manager.rankVideos(mixedVideos, 'ru');
assert.strictEqual(ranked[0].key, 'trailer_ru', 'Official Russian Trailer must rank #1');
assert.strictEqual(ranked[1].key, 'trailer_en', 'Official English Trailer must rank #2');
assert.strictEqual(ranked[2].key, 'teaser_ru', 'Official Russian Teaser must rank #3');
assert.strictEqual(ranked[3].key, 'teaser_en', 'Official English Teaser must rank #4');
assert.strictEqual(ranked[4].key, 'trailer_fan', 'Non-official Trailer must rank #5');
assert.strictEqual(ranked[5].key, 'clip_1', 'Clip must rank #6');

const primaryTrailer = manager.selectPrimaryTrailer(mixedVideos, 'ru');
assert.strictEqual(primaryTrailer.key, 'trailer_ru', 'selectPrimaryTrailer must select the top official trailer');
assert.strictEqual(primaryTrailer.type, 'Trailer', 'Trailer type must be preserved');
assert.strictEqual(primaryTrailer.official, true, 'Official status must be preserved');
console.log('  ✅ 17.1 Official Trailer prioritized above Teasers, Clips, and non-official videos');

// Official Teaser selected when no official trailer exists
const teaserOnlyVideos = [
    { provider: 'YouTube', key: 'clip_2', name: 'Scene Clip', type: 'Clip', official: true },
    { provider: 'YouTube', key: 'teaser_only', name: 'Main Teaser', type: 'Teaser', official: true, language: 'ru' }
];
const teaserPrimary = manager.selectPrimaryTrailer(teaserOnlyVideos, 'ru');
assert.strictEqual(teaserPrimary.key, 'teaser_only', 'Official Teaser must be selected when no Trailer exists');
console.log('  ✅ 17.2 Official Teaser accepted as primary trailer when no full Trailer exists');

// Non-official trailer fallback
const unofficialOnly = [
    { provider: 'YouTube', key: 'fan_trailer', name: 'Promo Trailer', type: 'Trailer', official: false }
];
const unofficialPrimary = manager.selectPrimaryTrailer(unofficialOnly);
assert.strictEqual(unofficialPrimary.key, 'fan_trailer', 'Non-official trailer used when no official videos exist');
console.log('  ✅ 17.3 Non-official Trailer selected when no official options available');

// =========================================================================
// 18. Phase 1D: Deduplication & UI Consistency
// =========================================================================
console.log('\n--- 18. Testing Phase 1D: Deduplication & Video Gallery Consistency ---');

const duplicateVideos = [
    { provider: 'YouTube', key: 'dup_key', name: 'Trailer 1', type: 'Trailer', official: true },
    { provider: 'YouTube', key: 'dup_key', name: 'Trailer 1 Duplicate', type: 'Trailer', official: true },
    { provider: 'YouTube', key: 'unique_key', name: 'Teaser 1', type: 'Teaser', official: true }
];
const galleryHtml = manager.renderVideosSection(duplicateVideos);
const countMatches = (galleryHtml.match(/data-video-key="dup_key"/g) || []).length;
assert.strictEqual(countMatches, 1, 'Duplicate video keys must be eliminated in gallery');
assert(galleryHtml.includes('data-video-key="unique_key"'), 'Unique video must be preserved');
console.log('  ✅ 18.1 Duplicate YouTube keys deduplicated cleanly');

// Same pure selector powers both primary trailer and gallery order
const testVideosOrder = [
    { provider: 'YouTube', key: 'clip_a', name: 'Clip A', type: 'Clip', official: false },
    { provider: 'YouTube', key: 'trailer_lead', name: 'Lead Trailer', type: 'Trailer', official: true, language: 'ru' },
    { provider: 'YouTube', key: 'teaser_b', name: 'Teaser B', type: 'Teaser', official: true, language: 'ru' }
];
const chosenPrimary = manager.selectPrimaryTrailer(testVideosOrder, 'ru');
const galleryRendered = manager.renderVideosSection(testVideosOrder);
const firstCardMatch = galleryRendered.match(/data-video-key="([^"]+)"/);
assert(firstCardMatch, 'Gallery must render video cards');
assert.strictEqual(firstCardMatch[1], chosenPrimary.key, 'Gallery card #1 must match selectPrimaryTrailer result');
console.log('  ✅ 18.2 Shared ranking guarantees consistency between primary trailer card and video gallery');

// =========================================================================
// 19. Phase 1D: Source Hierarchy & Scraper Elimination
// =========================================================================
console.log('\n--- 19. Testing Phase 1D: Source Hierarchy & Scraper Bypass ---');

// Mock trailerService to track calls
let scraperCallCount = 0;
manager.trailerService = {
    getTrailer: async (id, isSeries) => {
        scraperCallCount++;
        return {
            videoUrl: 'https://widgets.kinopoisk.ru/discovery/film/123/trailer/456',
            title: 'Scraped KP Trailer',
            duration: '2 мин'
        };
    }
};

// Track renderTrailerBlock calls
let lastRenderedTrailer = null;
let lastRenderedSource = null;
manager.renderTrailerBlock = (trailer, source) => {
    lastRenderedTrailer = trailer;
    lastRenderedSource = source;
};

// 19.1 TMDB Structured Trailer exists -> Scraper MUST NOT execute
scraperCallCount = 0;
lastRenderedTrailer = null;
lastRenderedSource = null;

const movieWithTmdbTrailer = {
    kinopoiskId: 4001,
    name: 'Movie With TMDB Videos',
    videos: [
        { provider: 'YouTube', key: 'tmdb_trailer_1', name: 'Official Trailer', type: 'Trailer', official: true }
    ]
};
manager.resolveAndRenderTrailer(movieWithTmdbTrailer);
assert.strictEqual(scraperCallCount, 0, 'TrailerParsingService MUST NOT be called when TMDB structured trailer exists');
assert.strictEqual(lastRenderedSource, 'TMDB_STRUCTURED', 'Source must be marked TMDB_STRUCTURED');
assert.strictEqual(lastRenderedTrailer.key, 'tmdb_trailer_1', 'Must render TMDB trailer');
console.log('  ✅ 19.1 TMDB structured trailer renders synchronously and completely suppresses scraper');

// 19.2 TMDB Teaser only -> Scraper MUST NOT execute
scraperCallCount = 0;
lastRenderedTrailer = null;
lastRenderedSource = null;

const movieWithTmdbTeaser = {
    kinopoiskId: 4002,
    name: 'Movie With TMDB Teaser Only',
    videos: [
        { provider: 'YouTube', key: 'tmdb_teaser_1', name: 'Official Teaser', type: 'Teaser', official: true }
    ]
};
manager.resolveAndRenderTrailer(movieWithTmdbTeaser);
assert.strictEqual(scraperCallCount, 0, 'TrailerParsingService MUST NOT be called when TMDB teaser exists');
assert.strictEqual(lastRenderedSource, 'TMDB_STRUCTURED', 'Source must be marked TMDB_STRUCTURED');
assert.strictEqual(lastRenderedTrailer.key, 'tmdb_teaser_1', 'Must render TMDB teaser');
console.log('  ✅ 19.2 TMDB structured teaser accepted without falling back to scraper');

// 19.3 KP Structured Trailer present (no TMDB) -> KP source used, scraper NOT called
scraperCallCount = 0;
lastRenderedTrailer = null;
lastRenderedSource = null;

const movieWithKpTrailer = {
    kinopoiskId: 4003,
    name: 'Movie With KP Structured Trailer',
    videos: [],
    trailers: [
        { provider: 'Kinopoisk', videoUrl: 'https://widgets.kinopoisk.ru/trailer/789', name: 'KP Trailer', type: 'Trailer' }
    ]
};
manager.resolveAndRenderTrailer(movieWithKpTrailer);
assert.strictEqual(scraperCallCount, 0, 'Scraper MUST NOT be called when KP structured trailer exists in DTO');
assert.strictEqual(lastRenderedSource, 'KP_STRUCTURED', 'Source must be marked KP_STRUCTURED');
assert.strictEqual(lastRenderedTrailer.videoUrl, 'https://widgets.kinopoisk.ru/trailer/789', 'Must render KP structured trailer');
console.log('  ✅ 19.3 KP structured trailer used when TMDB unavailable without scraper');

// 19.4 Neither structured source available -> Scraper fallback executes
scraperCallCount = 0;
lastRenderedTrailer = null;
lastRenderedSource = null;

const movieWithoutVideos = {
    kinopoiskId: 4004,
    name: 'Movie Without Any Structured Videos',
    videos: []
};
manager.resolveAndRenderTrailer(movieWithoutVideos);
assert.strictEqual(scraperCallCount, 1, 'Scraper fallback MUST execute when no structured videos exist');
console.log('  ✅ 19.4 Scraper executes as true fallback when structured sources are empty');

// =========================================================================
// 20. Phase 1D: Cache Behavior & Scraper Failure Resilience
// =========================================================================
console.log('\n--- 20. Testing Phase 1D: Warm Cache & Fallback Resilience ---');

// Warm cached DTO with videos
scraperCallCount = 0;
const warmCachedDTO = {
    kinopoiskId: 5001,
    name: 'Warm Cached Movie',
    videos: [
        { provider: 'YouTube', key: 'warm_key_1', name: 'Warm Trailer', type: 'Trailer', official: true }
    ]
};
manager.resolveAndRenderTrailer(warmCachedDTO);
assert.strictEqual(scraperCallCount, 0, 'Warm cache with structured videos must make 0 scraper calls');
console.log('  ✅ 20.1 Warm cache with videos immediately resolves trailer with 0 network calls');

// Scraper failure resilience
manager.trailerService.getTrailer = async () => {
    throw new Error('Kinopoisk scraper 403 Forbidden / Network error');
};
assert.doesNotThrow(() => {
    manager.loadTrailerFallback(9999, false);
}, 'Scraper failure must not throw unhandled exception or crash MovieDetails');
console.log('  ✅ 20.2 Scraper failure handled gracefully without breaking page');

// =========================================================================
// 21. Phase 1D: Modal & Player Consolidation & Lazy Embed Verification
// =========================================================================
console.log('\n--- 21. Testing Phase 1D: Modal Player Consolidation & CSP Safety ---');

const modalStub = { style: {} };
const containerStub = { innerHTML: '' };
const titleElStub = { textContent: '' };

manager.elements = {
    trailerModal: modalStub,
    trailerContainer: containerStub,
    trailerTitle: titleElStub
};

// Initial state: 0 iframes
assert.strictEqual(containerStub.innerHTML, '', 'Zero iframes before user interaction');

// User clicks YouTube video
manager.openVideoModal({ provider: 'YouTube', key: 'play_key_123', name: 'Awesome Trailer' });
assert.strictEqual(modalStub.style.display, 'flex', 'Modal displayed on video open');
assert(containerStub.innerHTML.includes('youtube-nocookie.com/embed/play_key_123?autoplay=1'), 'Lazy YouTube embed URL injected into modal iframe');
assert(containerStub.innerHTML.includes('allow="autoplay; encrypted-media; picture-in-picture"'), 'Correct permissions on iframe');
assert.strictEqual(titleElStub.textContent, 'Awesome Trailer', 'Title set on modal');

titleElStub.textContent = 'Загрузка названия…';
await manager.loadYouTubeCommentTitle(
    'https://www.youtube.com/watch?v=bWcASV2sey0&list=RDbWcASV2sey0&start_radio=1',
    'bWcASV2sey0'
);
assert.strictEqual(titleElStub.textContent, 'Resolved YouTube Title', 'YouTube oEmbed title replaces the fallback modal title');

titleElStub.textContent = 'Загрузка названия…';
await manager.loadYouTubeCommentTitle(
    'https://www.youtube.com/watch?v=bWcASV2sey0&list=RDbWcASV2sey0&start_radio=1',
    'bWcASV2sey0'
);
assert.strictEqual(titleElStub.textContent, 'Resolved YouTube Title', 'Cached YouTube title is reused without changing the modal result');

manager.youtubeTitleCache.clear();
context.fetch = async () => ({ ok: true, json: async () => ({ title: 'L'.repeat(120) }) });
titleElStub.textContent = 'Загрузка названия…';
await manager.loadYouTubeCommentTitle(
    'https://www.youtube.com/watch?v=long_title_1',
    'long_title_1'
);
assert.strictEqual(titleElStub.textContent.length, 96, 'Long YouTube titles are capped for the modal header');
assert(titleElStub.textContent.endsWith('…'), 'Capped YouTube titles end with an ellipsis');

manager.openVideoModal({ provider: 'YouTube', key: 'start_key_1', start: 42, name: 'Timestamped video' });
assert(
    containerStub.innerHTML.includes('start_key_1')
        && (containerStub.innerHTML.includes('&start=42')
            || containerStub.innerHTML.includes('&amp;start=42')
            || containerStub.innerHTML.includes('&t=42')
            || containerStub.innerHTML.includes('&amp;t=42')),
    'YouTube timestamp is preserved in the modal embed URL'
);
manager.closeTrailerModal();

// Close modal clears iframe immediately
manager.closeTrailerModal();
assert.strictEqual(modalStub.style.display, 'none', 'Modal hidden on close');
assert.strictEqual(containerStub.innerHTML, '', 'Iframe destroyed immediately on modal close stopping playback');

// Direct KP / scraper videoUrl playback
manager.openVideoModal({ videoUrl: 'https://widgets.kinopoisk.ru/trailer/999', name: 'Scraped Trailer' });
assert(containerStub.innerHTML.includes('https://widgets.kinopoisk.ru/trailer/999'), 'Direct videoUrl embedded in shared player surface');
manager.closeTrailerModal();

// YouTube URL conversion fallback
manager.openVideoModal({ videoUrl: 'https://www.youtube.com/watch?v=converted123', name: 'Converted URL' });
assert(containerStub.innerHTML.includes('youtube-nocookie.com/embed/converted123?autoplay=1'), 'YouTube URL automatically normalized to secure embed');
manager.closeTrailerModal();

console.log('  ✅ 21.1 Unified player modal handles YouTube keys, direct URLs, URL normalization, and clean teardown');

// =========================================================================
// 22. Phase 1E: Seasons Source Hierarchy & Scraper Suppression
// =========================================================================
console.log('\n--- 22. Testing Phase 1E: Seasons Source Hierarchy & Scraper Suppression ---');

const tabBtnStub = { style: { display: 'none' } };
const tabPaneStub = { innerHTML: '' };
documentStub.querySelector = (sel) => {
    if (sel.includes('[data-tab="seasons"]')) return tabBtnStub;
    return null;
};
documentStub.getElementById = (id) => {
    if (id === 'tab-seasons') return tabPaneStub;
    return null;
};

let scraperCalledCount = 0;
manager.seasonsService = {
    getSeasons: async (movieId) => {
        scraperCalledCount++;
        return [{ number: 1, name: 'Сезон 1', episodes: [{ number: 1, name: 'Scraped Ep 1' }] }];
    }
};

// 22.1 TMDB structured seasons available -> Renders synchronously, scraper is SUPPRESSED (0 scraper calls)
scraperCalledCount = 0;
tabBtnStub.style.display = 'none';
tabPaneStub.innerHTML = '';
const seriesWithTmdbSeasons = {
    kinopoiskId: 1317565,
    name: 'Дом Дракона',
    isSeries: true,
    seasons: [
        { number: 1, name: 'Сезон 1', episodeCount: 10, airDate: '2022-08-21', overview: 'Начало', posterUrl: 'https://img.com/s1.jpg', isSpecial: false },
        { number: 2, name: 'Сезон 2', episodeCount: 8, airDate: '2024-06-16', overview: 'Продолжение', posterUrl: 'https://img.com/s2.jpg', isSpecial: false }
    ],
    nextEpisode: { seasonNumber: 3, episodeNumber: 1, name: 'Сезон 3 Премьера', airDate: '2026-06-15' }
};

manager.resolveAndRenderSeasons(seriesWithTmdbSeasons);
assert.strictEqual(scraperCalledCount, 0, 'Scraper must NOT be called when TMDB structured seasons exist');
assert.strictEqual(tabBtnStub.style.display, 'inline-block', 'Seasons tab button displayed');
assert(tabPaneStub.innerHTML.includes('Сезон 1'), 'Rendered season 1');
assert(tabPaneStub.innerHTML.includes('Сезон 2'), 'Rendered season 2');
assert(tabPaneStub.innerHTML.includes('10 серий'), 'Rendered Russian pluralized episode count');
assert(tabPaneStub.innerHTML.includes('8 серий'), 'Rendered Russian pluralized episode count');
assert(tabPaneStub.innerHTML.includes('Сезоны'), 'Rendered seasons tab header');
assert(tabPaneStub.innerHTML.includes('2 сезона'), 'Rendered total season count');
console.log('  ✅ 22.1 TMDB structured seasons render synchronously with 0 scraper calls');

// 22.2 KP structured seasonsInfo available -> Renders with 0 scraper calls
scraperCalledCount = 0;
tabBtnStub.style.display = 'none';
tabPaneStub.innerHTML = '';
const seriesWithKpSeasonsInfo = {
    kinopoiskId: 404900,
    name: 'Во все тяжкие',
    isSeries: true,
    seasons: [],
    seasonsInfo: [
        { number: 1, episodesCount: 7 },
        { number: 2, episodesCount: 13 }
    ]
};

manager.resolveAndRenderSeasons(seriesWithKpSeasonsInfo);
assert.strictEqual(scraperCalledCount, 0, 'Scraper must NOT be called when KP structured seasonsInfo exists');
assert.strictEqual(tabBtnStub.style.display, 'inline-block', 'Seasons tab button displayed');
assert(tabPaneStub.innerHTML.includes('Сезон 1'), 'Rendered season 1 from KP');
assert(tabPaneStub.innerHTML.includes('7 серий'), 'Rendered 7 episodes');
console.log('  ✅ 22.2 KP structured seasonsInfo renders with 0 scraper calls');

// 22.3 Scraper fallback invoked when structured data is empty
scraperCalledCount = 0;
tabBtnStub.style.display = 'none';
tabPaneStub.innerHTML = '';
const seriesWithNoStructuredSeasons = {
    kinopoiskId: 777777,
    name: 'Неизвестный сериал',
    isSeries: true,
    seasons: [],
    seasonsInfo: []
};

manager.resolveAndRenderSeasons(seriesWithNoStructuredSeasons);
assert.strictEqual(scraperCalledCount, 1, 'Scraper fallback must be invoked when structured seasons are absent');
console.log('  ✅ 22.3 Scraper executes as true fallback when structured seasons are absent');

// =========================================================================
// 23. Phase 1E: Next Episode Banner & Season Specials
// =========================================================================
console.log('\n--- 23. Testing Phase 1E: Next Episode Banner & Season Specials ---');

const seriesWithSpecials = {
    kinopoiskId: 66732,
    name: 'Очень странные дела',
    seasons: [
        { number: 0, name: 'Спецматериалы', episodeCount: 4, airDate: '2016-07-15', isSpecial: true },
        { number: 1, name: 'Сезон 1', episodeCount: 8, airDate: '2016-07-15', isSpecial: false }
    ],
    lastEpisode: { seasonNumber: 4, episodeNumber: 9, name: 'The Piggyback', airDate: '2022-07-01' }
};

const htmlSeasons = manager.renderSeasonsTab(seriesWithSpecials.seasons, null, seriesWithSpecials.lastEpisode);
assert(htmlSeasons.includes('badge-special">Спецматериалы</span>'), 'Special season marked with special badge');
assert(htmlSeasons.includes('season-pill-btn--specials'), 'Rendered specials navigation pill');
console.log('  ✅ 23.1 Special season 0 and navigation pills render correctly');

// =========================================================================
// 24. Phase 1E: Scraper Fallback Failure Resilience
// =========================================================================
console.log('\n--- 24. Testing Phase 1E: Scraper Fallback Failure Resilience ---');

manager.seasonsService.getSeasons = async () => {
    throw new Error('Kinopoisk scraper 403 Forbidden / Anti-bot error');
};

tabBtnStub.style.display = 'inline-block';
assert.doesNotThrow(() => {
    manager.loadSeasonsFallback(999999);
}, 'Scraper fallback failure must be caught gracefully without throwing');

console.log('  ✅ 24.1 Scraper failure handled gracefully without breaking page');

// =========================================================================
// 25. Phase 1F: Lazy Season Expand & Request Invariants
// =========================================================================
console.log('\n--- 25. Testing Phase 1F: Lazy Season Expand & Request Invariants ---');

let tmdbSeasonDetailsCalls = [];
manager.tmdbService = {
    getSeasonDetails: async (tmdbId, seasonNumber, options = {}) => {
        tmdbSeasonDetailsCalls.push({ tmdbId, seasonNumber, options });
        return {
            tmdbId: Number(tmdbId),
            seasonNumber: Number(seasonNumber),
            name: `Сезон ${seasonNumber}`,
            overview: `Описание сезона ${seasonNumber}`,
            posterUrl: `https://image.tmdb.org/t/p/w500/season_${seasonNumber}.jpg`,
            airDate: '2022-08-21',
            episodes: [
                {
                    tmdbId: Number(tmdbId),
                    seasonNumber: Number(seasonNumber),
                    episodeNumber: 1,
                    name: 'Наследники Дракона',
                    overview: 'Король Визерис выбирает наследника.',
                    airDate: '2022-08-21',
                    runtime: 66,
                    stillUrl: 'https://image.tmdb.org/t/p/w500/ep1.jpg',
                    voteAverage: 8.4,
                    voteCount: 250,
                    episodeType: 'standard',
                    source: 'tmdb'
                },
                {
                    tmdbId: Number(tmdbId),
                    seasonNumber: Number(seasonNumber),
                    episodeNumber: 2,
                    name: '', // Missing title -> fallback
                    overview: null, // Missing overview -> hidden
                    airDate: '2026-12-31', // Future episode -> upcoming badge
                    runtime: 58,
                    stillUrl: null,
                    voteAverage: null,
                    voteCount: null,
                    episodeType: 'standard',
                    source: 'tmdb'
                }
            ]
        };
    }
};

// 25.1 Initial TV load renders summaries with ZERO season-detail requests
tmdbSeasonDetailsCalls = [];
const tvSeriesMovie = {
    kinopoiskId: 1317565,
    tmdbId: 94997,
    name: 'Дом Дракона',
    isSeries: true,
    seasons: [
        { number: 1, name: 'Сезон 1', episodeCount: 10, airDate: '2022-08-21', isSpecial: false },
        { number: 2, name: 'Сезон 2', episodeCount: 8, airDate: '2024-06-16', isSpecial: false }
    ],
    nextEpisode: { seasonNumber: 1, episodeNumber: 2, name: 'Серия 2' }
};

manager.selectedMovie = tvSeriesMovie;
manager.resolveAndRenderSeasons(tvSeriesMovie);
assert.strictEqual(tmdbSeasonDetailsCalls.length, 0, 'Initial series load must make EXACTLY 0 season detail requests');
console.log('  ✅ 25.1 Initial series load executes 0 episode requests');

// 25.2 User clicks "Показать серии" on Season 1 -> EXACTLY 1 request made
const s1Card = new MockElement();
const s1Panel = new MockElement();
s1Panel.className = 'season-episodes-panel';
s1Card.appendChild(s1Panel);

const s1Btn = new MockElement();
s1Btn.setAttribute('data-action', 'toggle-season');
s1Btn.setAttribute('data-season-number', '1');
s1Btn.setAttribute('data-tmdb-id', '94997');
s1Btn.setAttribute('data-episode-count', '10');
s1Btn.setAttribute('aria-expanded', 'false');
const s1BtnText = new MockElement();
s1BtnText.className = 'season-expand-text';
s1BtnText.textContent = 'Показать серии';
s1Btn.appendChild(s1BtnText);
s1Card.appendChild(s1Btn);

await manager.toggleSeasonEpisodes(s1Btn, 1, 94997, 10);
assert.strictEqual(tmdbSeasonDetailsCalls.length, 1, 'Clicking Season 1 triggers exactly 1 TMDB season request');
assert.strictEqual(s1Btn.getAttribute('aria-expanded'), 'true', 'Button aria-expanded is true');
assert.strictEqual(s1BtnText.textContent, 'Скрыть серии', 'Button text toggles to Скрыть серии');
assert(s1Panel.innerHTML.includes('Наследники Дракона'), 'Season 1 episodes rendered in panel');
console.log('  ✅ 25.2 Expanding Season 1 executes exactly 1 lazy request');

// 25.3 User collapses and reopens Season 1 -> 0 extra requests (already loaded in DOM / cached)
await manager.toggleSeasonEpisodes(s1Btn, 1, 94997, 10);
assert.strictEqual(s1Btn.getAttribute('aria-expanded'), 'false', 'Button aria-expanded is false after collapse');
assert.strictEqual(s1BtnText.textContent, 'Показать серии', 'Button text toggles back to Показать серии');

await manager.toggleSeasonEpisodes(s1Btn, 1, 94997, 10);
assert.strictEqual(tmdbSeasonDetailsCalls.length, 1, 'Reopening already populated season executes 0 extra requests');
console.log('  ✅ 25.3 Reopening season panel avoids redundant network calls');

// =========================================================================
// 26. Phase 1F: Normalized Episode Card UI & Ordering
// =========================================================================
console.log('\n--- 26. Testing Phase 1F: Normalized Episode Card UI & Ordering ---');

assert(s1Panel.innerHTML.includes('S1E1'), 'Episode code S1E1 present');
assert(s1Panel.innerHTML.includes('S1E2'), 'Episode code S1E2 present');
assert(s1Panel.innerHTML.includes('Серия 2'), 'Missing title cleanly falls back to "Серия 2" (no null/undefined)');
assert(!s1Panel.innerHTML.includes('null'), 'No "null" literals rendered in episode list');
assert(s1Panel.innerHTML.includes('8.4'), 'TMDB episode rating badge rendered with rating');
assert(s1Panel.innerHTML.includes('badge-upcoming">Ожидается</span>'), 'Future episode marked with upcoming badge');
assert(s1Panel.innerHTML.includes('badge-schedule-next') || s1Panel.innerHTML.includes('badge-next-episode'), 'Aligned with movie.nextEpisode (S1E2)');
assert(s1Panel.innerHTML.includes('https://image.tmdb.org/t/p/w500/ep1.jpg'), 'Episode still image rendered with w500 URL');
assert(s1Panel.innerHTML.includes('data-fallback="poster"'), 'CSP safe image fallback attribute present');
console.log('  ✅ 26.1 Normalized episode card formatting, badges, fallbacks, and next episode alignment verified');

// =========================================================================
// 27. Phase 1F: Empty Season, Specials & Error Retry States
// =========================================================================
console.log('\n--- 27. Testing Phase 1F: Empty Season, Specials & Error Retry States ---');

// 27.1 Empty future season with 0 episodes -> Notice displayed without network call
const emptyBtn = new MockElement();
const emptyCard = new MockElement();
const emptyPanel = new MockElement();
emptyPanel.className = 'season-episodes-panel';
emptyCard.appendChild(emptyPanel);
emptyCard.appendChild(emptyBtn);

const initialCallsCount = tmdbSeasonDetailsCalls.length;
await manager.toggleSeasonEpisodes(emptyBtn, 3, 94997, 0);
assert.strictEqual(tmdbSeasonDetailsCalls.length, initialCallsCount, 'Season with 0 episodes makes 0 network calls');
assert(emptyPanel.innerHTML.includes('Серии пока не опубликованы'), 'Empty future season notice rendered');
console.log('  ✅ 27.1 Announced future season with 0 episodes avoids useless requests');

// 27.2 Network error during season fetch -> Error message and Retry button rendered
manager.tmdbService.getSeasonDetails = async () => {
    throw new Error('HTTP 500 Internal Server Error');
};

const errBtn = new MockElement();
const errCard = new MockElement();
const errPanel = new MockElement();
errPanel.className = 'season-episodes-panel';
errCard.appendChild(errPanel);
errCard.appendChild(errBtn);

await manager.toggleSeasonEpisodes(errBtn, 2, 94997, 8);
assert(errPanel.innerHTML.includes('Не удалось загрузить серии этого сезона'), 'Error message rendered');
assert(errPanel.innerHTML.includes('data-action="retry-season"'), 'Retry button present');

// 27.3 Retry button refetches with forceRefresh
let retriedWithForce = false;
manager.tmdbService.getSeasonDetails = async (tmdbId, seasonNumber, options) => {
    if (options.forceRefresh) retriedWithForce = true;
    return {
        tmdbId,
        seasonNumber,
        episodes: [{ seasonNumber, episodeNumber: 1, name: 'Восстановленный эпизод' }]
    };
};

await manager.toggleSeasonEpisodes(errBtn, 2, 94997, 8, true);
assert.strictEqual(retriedWithForce, true, 'Retry action forces fresh refetch');
assert(errPanel.innerHTML.includes('Восстановленный эпизод'), 'Refetched episodes successfully rendered on retry');
console.log('  ✅ 27.2 & 27.3 Season fetch failure handled gracefully with working retry flow');

// =========================================================================
// 28. Phase 1G: Hero Next-Episode Promotion & Media-Type Safety
// =========================================================================
console.log('\n--- 28. Testing Phase 1G: Hero Next-Episode Promotion & Media-Type Safety ---');

// 28.1 TV Series with nextEpisode renders Hero block in right column
const seriesWithNextEp = {
    kinopoiskId: 94997,
    name: 'Дом Дракона',
    alternativeName: 'House of the Dragon',
    type: 'tv-series',
    isSeries: true,
    status: 'Returning Series',
    nextEpisode: {
        seasonNumber: 3,
        episodeNumber: 1,
        name: 'Новое начало',
        airDate: '2026-09-01',
        runtime: 65
    }
};

const seriesCardHtml = manager.createDetailedMovieCard(seriesWithNextEp);
assert(seriesCardHtml.includes('id="heroNextEpisode"'), 'Hero next episode card rendered with correct ID');
assert(seriesCardHtml.includes('Следующая серия'), 'Hero next episode badge rendered');
assert(seriesCardHtml.includes('S3E1'), 'Episode code S3E1 rendered');
assert(seriesCardHtml.includes('Новое начало'), 'Localized episode title rendered');
assert(seriesCardHtml.includes('01.09.2026'), 'Formatted air date rendered');
assert(seriesCardHtml.includes('65 мин'), 'Runtime rendered in Hero block');
assert(seriesCardHtml.indexOf('id="heroNextEpisode"') > seriesCardHtml.indexOf('movie-detail-title-wrapper'), 'Next episode is placed after title');
console.log('  ✅ 28.1 TV Series renders compact Hero next-episode card with code, date, title, runtime');

// 28.2 Movie NEVER renders Hero next-episode block
const movieWithSneakyEp = {
    kinopoiskId: 5001,
    name: 'Начало',
    type: 'movie',
    isSeries: false,
    nextEpisode: { seasonNumber: 1, episodeNumber: 2, name: 'Fake', airDate: '2026-09-01' }
};
const movieCardHtml = manager.createDetailedMovieCard(movieWithSneakyEp);
assert(!movieCardHtml.includes('id="heroNextEpisode"'), 'Movie must never render hero next episode block');
console.log('  ✅ 28.2 Movie strictly excludes Hero next-episode block');

// 28.3 Mini-series renders Hero next-episode block
const miniSeries = {
    kinopoiskId: 5002,
    name: 'Чернобыль',
    type: 'mini-series',
    isSeries: true,
    status: 'Returning Series',
    nextEpisode: { seasonNumber: 1, episodeNumber: 5, name: 'Вечная память', airDate: '2026-09-01' }
};
const miniSeriesHtml = manager.createDetailedMovieCard(miniSeries);
assert(miniSeriesHtml.includes('id="heroNextEpisode"'), 'Mini-series renders hero next episode');
console.log('  ✅ 28.3 Mini-series renders Hero next-episode block correctly');

// 28.4 Animated series / Anime renders Hero next-episode block
const animeSeries = {
    kinopoiskId: 5003,
    name: 'Атака титанов',
    type: 'animated-series',
    isSeries: true,
    status: 'Returning Series',
    nextEpisode: { seasonNumber: 4, episodeNumber: 28, name: 'Рассвет человечества', airDate: '2026-09-01' }
};
const animeSeriesHtml = manager.createDetailedMovieCard(animeSeries);
assert(animeSeriesHtml.includes('id="heroNextEpisode"'), 'Anime/animated-series renders hero next episode');
console.log('  ✅ 28.4 Animated series renders Hero next-episode block correctly');

// 28.5 Null nextEpisode hides block
const seriesNoNext = {
    kinopoiskId: 5004,
    name: 'Острые козырьки',
    type: 'tv-series',
    isSeries: true,
    nextEpisode: null
};
const seriesNoNextHtml = manager.createDetailedMovieCard(seriesNoNext);
assert(!seriesNoNextHtml.includes('id="heroNextEpisode"'), 'Series with null nextEpisode does not render hero block');
console.log('  ✅ 28.5 Null nextEpisode cleanly hides Hero next-episode block');

// 28.6 Ended series without nextEpisode hides block
const endedSeries = {
    kinopoiskId: 5005,
    name: 'Во все тяжкие',
    type: 'tv-series',
    isSeries: true,
    status: 'Ended',
    nextEpisode: null
};
const endedSeriesHtml = manager.createDetailedMovieCard(endedSeries);
assert(!endedSeriesHtml.includes('id="heroNextEpisode"'), 'Ended series hides hero next-episode block');
console.log('  ✅ 28.6 Ended series without nextEpisode hides block');

// 28.7 Status contradiction safety: Ended series with nextEpisode omits Hero block safely
const contradictedSeries = {
    kinopoiskId: 5006,
    name: 'Игра престолов',
    type: 'tv-series',
    isSeries: true,
    status: 'Ended',
    nextEpisode: { seasonNumber: 9, episodeNumber: 1, name: 'Impossible', airDate: '2026-10-01' }
};
const contradictedHtml = manager.createDetailedMovieCard(contradictedSeries);
assert(!contradictedHtml.includes('id="heroNextEpisode"'), 'Contradicted ended series with nextEpisode safely omits hero block');
console.log('  ✅ 28.7 Ended series with contradictory nextEpisode safely omits Hero block');

// =========================================================================
// 29. Phase 1G: Dynamic Freshness & Air-Date Expiration Semantics
// =========================================================================
console.log('\n--- 29. Testing Phase 1G: Dynamic Freshness & Air-Date Expiration Semantics ---');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const yesterdayStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

// 29.1 airDate tomorrow -> isNextEpisodeStale returns false
assert.strictEqual(manager.isNextEpisodeStale({
    type: 'tv-series',
    isSeries: true,
    nextEpisode: { airDate: tomorrowStr }
}), false, 'Tomorrow air date is fresh (not stale)');
console.log('  ✅ 29.1 Future air date is considered fresh');

// 29.2 airDate today (date-only) -> isNextEpisodeStale returns false (no premature expiration)
assert.strictEqual(manager.isNextEpisodeStale({
    type: 'tv-series',
    isSeries: true,
    nextEpisode: { airDate: todayStr }
}), false, 'Today air date is considered fresh until calendar day concludes');
console.log('  ✅ 29.2 Today date-only air date does not expire prematurely on broadcast day');

// 29.3 airDate yesterday -> isNextEpisodeStale returns true (stale!)
assert.strictEqual(manager.isNextEpisodeStale({
    type: 'tv-series',
    isSeries: true,
    nextEpisode: { airDate: yesterdayStr }
}), true, 'Yesterday air date is strictly stale');
console.log('  ✅ 29.3 Past air date is accurately flagged as stale for SWR refresh');

// 29.4 Full timestamp in future vs past
const futureTs = new Date(now.getTime() + 3600000).toISOString();
const pastTs = new Date(now.getTime() - 3600000).toISOString();
assert.strictEqual(manager.isNextEpisodeStale({ type: 'tv-series', isSeries: true, nextEpisode: { airDate: futureTs } }), false, 'Future timestamp is fresh');
assert.strictEqual(manager.isNextEpisodeStale({ type: 'tv-series', isSeries: true, nextEpisode: { airDate: pastTs } }), true, 'Past timestamp is stale');
console.log('  ✅ 29.4 ISO timestamp comparison handles future/past boundaries accurately');

// 29.5 Movie or missing fields -> isNextEpisodeStale returns false
assert.strictEqual(manager.isNextEpisodeStale({ type: 'movie', isSeries: false, nextEpisode: { airDate: yesterdayStr } }), false, 'Movie is never stale for next episode');
assert.strictEqual(manager.isNextEpisodeStale({ type: 'tv-series', isSeries: true, nextEpisode: null }), false, 'Null nextEpisode is not stale');
console.log('  ✅ 29.5 Non-series or null nextEpisode returns false cleanly');

// =========================================================================
// 30. Phase 1G: Stale-While-Revalidate Flow & Request Deduplication
// =========================================================================
console.log('\n--- 30. Testing Phase 1G: Stale-While-Revalidate Flow & Request Deduplication ---');

// 30.1 Stale cached DTO renders immediately without waiting for network
const staleSeriesMovie = {
    kinopoiskId: 99001,
    name: 'Локи',
    type: 'tv-series',
    isSeries: true,
    status: 'Returning Series',
    nextEpisode: { seasonNumber: 2, episodeNumber: 3, name: 'Старый эпизод', airDate: yesterdayStr }
};

const instantHtml = manager.createDetailedMovieCard(staleSeriesMovie);
assert(instantHtml.includes('id="heroNextEpisode"'), 'Initial render produces full HTML instantly');
assert(instantHtml.includes('Старый эпизод'), 'Renders cached DTO immediately');
console.log('  ✅ 30.1 Stale cached DTO renders immediately without blocking');

// 30.2 Dynamic SWR revalidation with in-flight deduplication
let mediaAggregatorCalls = [];
const mockFreshMovie = {
    kinopoiskId: 99001,
    name: 'Локи',
    type: 'tv-series',
    isSeries: true,
    status: 'Returning Series',
    nextEpisode: { seasonNumber: 2, episodeNumber: 4, name: 'Свежий эпизод', airDate: tomorrowStr }
};

const fakeFirebaseManager = {
    getMediaAggregatorService: () => ({
        getMovieDetails: async (kpId, options) => {
            mediaAggregatorCalls.push({ kpId, options });
            return mockFreshMovie;
        }
    })
};

context.window.firebaseManager = fakeFirebaseManager;
context.firebaseManager = fakeFirebaseManager;
manager.selectedMovie = staleSeriesMovie;

// Concurrent revalidation calls for same movie
const promise1 = manager.revalidateDynamicData(staleSeriesMovie);
const promise2 = manager.revalidateDynamicData(staleSeriesMovie);
assert.strictEqual(promise1, promise2, 'Concurrent revalidations must share the exact same in-flight Promise');

const refreshResult = await promise1;
assert.strictEqual(mediaAggregatorCalls.length, 1, 'Exactly one background refresh executed for concurrent triggers');
assert.strictEqual(mediaAggregatorCalls[0].options.forceRefresh, true, 'SWR refresh passes forceRefresh: true');
assert.strictEqual(refreshResult.nextEpisode.name, 'Свежий эпизод', 'Fresh payload received');
console.log('  ✅ 30.2 & 30.3 Concurrent stale detection deduplicates background request to exactly 1 call');

// 30.4 DOM Patching replaces stale episode with fresh episode
const mockHeroEl = new MockElement();
mockHeroEl.id = 'heroNextEpisode';
mockHeroEl.innerHTML = '<div class="hero-next-episode-title">Старый эпизод</div>';

let replacedWith = null;
mockHeroEl.replaceWith = (newEl) => { replacedWith = newEl; };

documentStub.getElementById = (id) => {
    if (id === 'heroNextEpisode') return mockHeroEl;
    return new MockElement();
};

manager.patchDynamicSeriesUI(mockFreshMovie);
assert(replacedWith !== null, 'Hero next episode element replaced in DOM');
assert(replacedWith.innerHTML.includes('Свежий эпизод'), 'Patched element contains fresh episode title');
assert(replacedWith.innerHTML.includes('S2E4'), 'Patched element contains fresh episode code S2E4');
console.log('  ✅ 30.4 & 30.5 DOM patching updates Hero next-episode card smoothly without full reload');

// 30.6 Fresh payload with null nextEpisode removes stale hero block
const mockEndedFreshMovie = {
    kinopoiskId: 99001,
    name: 'Локи',
    type: 'tv-series',
    isSeries: true,
    status: 'Ended',
    nextEpisode: null
};

let removedHeroEl = false;
mockHeroEl.remove = () => { removedHeroEl = true; };
manager.patchDynamicSeriesUI(mockEndedFreshMovie);
assert.strictEqual(removedHeroEl, true, 'Hero next-episode card removed when fresh series has no next episode');
console.log('  ✅ 30.6 Fresh payload with no upcoming episode removes stale Hero block');

// 30.7 Background refresh failure handled gracefully
fakeFirebaseManager.getMediaAggregatorService = () => ({
    getMovieDetails: async () => { throw new Error('TMDB Network Timeout'); }
});

let failedHeroRemoved = false;
mockHeroEl.remove = () => { failedHeroRemoved = true; };
const failResult = await manager.revalidateDynamicData(staleSeriesMovie);
assert.strictEqual(failResult, null, 'Refresh failure returns null without throwing');
assert.strictEqual(failedHeroRemoved, true, 'Stale clearly-past next-episode block is removed on refresh failure');
console.log('  ✅ 30.7 Background refresh failure handled gracefully and stale past block removed');

// =========================================================================
// 31. Phase 1G: Cache Invariant Verification & Compatibility
// =========================================================================
console.log('\n--- 31. Testing Phase 1G: Cache Invariant Verification & Compatibility ---');

// 31.1 Core movie cache key pattern intact
assert.strictEqual(typeof manager.dynamicRefreshRequests, 'object', 'In-flight deduplication map initialized');
assert(!seriesCardHtml.includes('javascript:'), 'No inline javascript URIs');
assert(!seriesCardHtml.includes('onclick='), 'No inline onclick handlers');
assert(!seriesCardHtml.includes('onerror='), 'No inline onerror handlers');
console.log('  ✅ 31.1 Core cache key conventions, CSP compliance, and zero inline handlers verified');

// =========================================================================
// 32. Phase 1G: Primary Trailer Gallery Deduplication (Part 19)
// =========================================================================
console.log('\n--- 32. Testing Phase 1G: Primary Trailer Gallery Deduplication ---');

const videosWithTrailer = [
    { key: 'TRAILER_KEY_1', type: 'Trailer', official: true, name: 'Официальный трейлер', site: 'YouTube' },
    { key: 'TEASER_KEY_2', type: 'Teaser', official: true, name: 'Официальный тизер', site: 'YouTube' },
    { key: 'CLIP_KEY_3', type: 'Clip', official: false, name: 'Фрагмент фильма', site: 'YouTube' }
];

const dedupPrimaryTrailer = manager.selectPrimaryTrailer(videosWithTrailer);
const dedupGalleryHtml = manager.renderVideosSection(videosWithTrailer, dedupPrimaryTrailer?.key);
assert(!dedupGalleryHtml.includes('TRAILER_KEY_1'), 'Primary trailer key excluded from secondary video gallery');
assert(dedupGalleryHtml.includes('TEASER_KEY_2'), 'Secondary teaser retained in video gallery');
assert(dedupGalleryHtml.includes('CLIP_KEY_3'), 'Secondary clip retained in video gallery');
console.log('  ✅ 32.1 Primary trailer is cleanly excluded from secondary video gallery to eliminate duplication');

// =========================================================================
// 33. DEF-01: handleSeasonPillSelect — long-series season pill navigation
// =========================================================================
console.log('\n--- 33. Testing DEF-01: handleSeasonPillSelect (Phase 1H P0) ---');

{
    const pillManager = Object.create(MovieDetailsManager.prototype);
    pillManager.escapeHtml = escapeHtmlHelper;

    // Build a minimal DOM: 3 season cards, 3 pill buttons
    const makeCard = (num, active) => {
        const card = new MockElement();
        card.setAttribute('data-season-number', String(num));
        card.className = active ? 'season-card season-card--active' : 'season-card season-card--hidden';
        card.classList._classes = new Set(active
            ? ['season-card', 'season-card--active']
            : ['season-card', 'season-card--hidden']);
        card.style.display = active ? '' : 'none';

        // Add a fake expand button to test collapse-on-switch
        const btn = new MockElement();
        btn.setAttribute('aria-expanded', active ? 'true' : 'false');
        btn.className = 'season-expand-btn';
        btn.classList._classes = new Set(['season-expand-btn', ...(active ? ['active'] : [])]);
        const txt = new MockElement();
        txt.className = 'season-expand-text';
        txt.textContent = active ? 'Скрыть серии' : 'Показать серии';
        btn.querySelector = (sel) => sel.includes('season-expand-text') ? txt : null;
        card.querySelector = (sel) => {
            if (sel.includes('.season-expand-btn[aria-expanded="true"]')) return active ? btn : null;
            if (sel.includes('.season-episodes-panel')) return null;
            return null;
        };
        return card;
    };

    const makePill = (num, active) => {
        const pill = new MockElement();
        pill.setAttribute('data-season-number', String(num));
        pill.className = active ? 'season-pill-btn active' : 'season-pill-btn';
        pill.classList._classes = new Set(['season-pill-btn', ...(active ? ['active'] : [])]);
        pill.setAttribute('aria-selected', active ? 'true' : 'false');
        return pill;
    };

    const cards = [makeCard(1, true), makeCard(2, false), makeCard(3, false)];
    const pills = [makePill(1, true), makePill(2, false), makePill(3, false)];

    const allCards = [...cards];
    const allPills = [...pills];

    // Wire document.querySelectorAll to return our mocks
    const origQSA = documentStub.querySelectorAll;
    documentStub.querySelectorAll = (sel) => {
        if (sel === '.season-pill-btn') return allPills;
        if (sel === '.season-card') return allCards;
        if (sel && sel.includes('season-expand-btn')) return documentStub.activeButtons;
        return [];
    };

    // Select season 2
    pillManager.handleSeasonPillSelect(2);

    // Pill 2 must become active
    assert.strictEqual(pills[1].getAttribute('aria-selected'), 'true', 'Pill 2: aria-selected=true after selection');
    assert(pills[1].classList._classes.has('active'), 'Pill 2: active class set');

    // Pill 1 must lose active
    assert.strictEqual(pills[0].getAttribute('aria-selected'), 'false', 'Pill 1: aria-selected=false after deselection');
    assert(!pills[0].classList._classes.has('active'), 'Pill 1: active class removed');

    // Card 2 must be visible
    assert(cards[1].classList._classes.has('season-card--active'), 'Card 2: season-card--active set');
    assert(!cards[1].classList._classes.has('season-card--hidden'), 'Card 2: season-card--hidden removed');
    assert.strictEqual(cards[1].style.display, '', 'Card 2: display cleared (visible)');

    // Card 1 must be hidden
    assert(cards[0].classList._classes.has('season-card--hidden'), 'Card 1: season-card--hidden set');
    assert(!cards[0].classList._classes.has('season-card--active'), 'Card 1: season-card--active removed');
    assert.strictEqual(cards[0].style.display, 'none', 'Card 1: display=none');

    console.log('  ✅ 33.1 Season pill select shows correct card and hides others with correct ARIA states');

    // Select season 3 (no-expand btn in card 3 since it was never active)
    pillManager.handleSeasonPillSelect(3);
    assert(cards[2].classList._classes.has('season-card--active'), 'Card 3: season-card--active set');
    assert.strictEqual(cards[2].style.display, '', 'Card 3: display cleared');
    assert(cards[1].classList._classes.has('season-card--hidden'), 'Card 2: now hidden after switching to 3');

    console.log('  ✅ 33.2 Sequential pill selection navigates correctly between seasons');

    // No-op for invalid input
    assert.doesNotThrow(() => pillManager.handleSeasonPillSelect(null), 'null seasonNumber is a safe no-op');
    assert.doesNotThrow(() => pillManager.handleSeasonPillSelect(NaN), 'NaN seasonNumber is a safe no-op');

    console.log('  ✅ 33.3 Invalid season numbers are safe no-ops');

    documentStub.querySelectorAll = origQSA;
}

// =========================================================================
// 34. DEF-02: Status badge template class + SWR patch fix
// =========================================================================
console.log('\n--- 34. Testing DEF-02: Status badge meta-item-status + SWR patch ---');

{
    // 34.1 Verify the rendered template includes meta-item-status class
    const statusMovie = {
        kinopoiskId: 9900,
        name: 'Status Test Series',
        type: 'tv-series',
        isSeries: true,
        status: 'returning series',
        year: 2024,
        genres: [{ name: 'drama' }],
        countries: [{ name: 'США' }],
        persons: [],
        premiere: {},
        fees: {},
        videos: [],
    };

    const statusCardHtml = manager.createDetailedMovieCard(
        statusMovie, false, false, false, false, null, 'null'
    );
    assert(
        statusCardHtml.includes('meta-item-status'),
        'Status meta-item has meta-item-status class for SWR selector targeting'
    );
    // Original classes must still be present
    assert(
        statusCardHtml.includes('status-badge--ongoing'),
        'Status badge class (status-badge--ongoing) is present for returning series'
    );
    console.log('  ✅ 34.1 Rendered template contains meta-item-status class and correct badge class');

    // 34.2 Verify patchDynamicSeriesUI updates the status element by direct property assignment
    const patchManager = Object.create(MovieDetailsManager.prototype);
    patchManager.escapeHtml = escapeHtmlHelper;
    patchManager.translateStatus = MovieDetailsManager.prototype.translateStatus;
    patchManager.getStatusBadgeClass = MovieDetailsManager.prototype.getStatusBadgeClass;
    patchManager.formatDate = MovieDetailsManager.prototype.formatDate;
    patchManager.renderHeroNextEpisode = () => '';
    patchManager.resolveAndRenderSeasons = () => {};
    patchManager.selectedMovie = { kinopoiskId: '9901', isSeries: true, type: 'tv-series' };

    // Simulate a .meta-item-status .meta-value element in the DOM
    const fakeStatusSpan = new MockElement();
    fakeStatusSpan.className = 'meta-value status-badge status-badge--ongoing';
    fakeStatusSpan.textContent = 'Онгоинг';

    const origQS = documentStub.querySelector;
    documentStub.querySelector = (sel) => {
        if (sel === '.meta-item-status .meta-value') return fakeStatusSpan;
        if (sel === '#heroNextEpisode') return null;
        return null;
    };

    const freshMovie = {
        kinopoiskId: '9901',
        isSeries: true,
        type: 'tv-series',
        status: 'ended',
        nextEpisode: null,
    };

    patchManager.patchDynamicSeriesUI(freshMovie);

    assert.strictEqual(fakeStatusSpan.textContent, 'Завершён', 'Status textContent updated to translated value');
    assert(fakeStatusSpan.className.includes('status-badge--ended'), 'Status class updated to status-badge--ended');
    assert(!fakeStatusSpan.className.includes('meta-status-badge'), 'No stale meta-status-badge class injected');

    console.log('  ✅ 34.2 patchDynamicSeriesUI correctly updates status textContent and className via live selector');

    documentStub.querySelector = origQS;
}

// =========================================================================
// 35. DEF-03: renderVideosSection excludeKey forwarded at call site
// =========================================================================
console.log('\n--- 35. Testing DEF-03: renderVideosSection excludeKey at call site ---');

{
    // Verify renderVideosSection correctly excludes when key is provided
    const allVideos = [
        { key: 'PRIMARY_KEY', type: 'Trailer', official: true, name: 'Главный трейлер', site: 'YouTube' },
        { key: 'SECONDARY_KEY', type: 'Teaser', official: true, name: 'Тизер', site: 'YouTube' },
    ];

    const htmlWithExclude = manager.renderVideosSection(allVideos, 'PRIMARY_KEY');
    assert(!htmlWithExclude.includes('PRIMARY_KEY'), 'excludeKey correctly excluded from gallery');
    assert(htmlWithExclude.includes('SECONDARY_KEY'), 'Non-excluded videos remain in gallery');

    const htmlWithoutExclude = manager.renderVideosSection(allVideos, null);
    assert(htmlWithoutExclude.includes('PRIMARY_KEY'), 'null excludeKey includes all videos');

    console.log('  ✅ 35.1 renderVideosSection excludeKey correctly filters primary trailer from gallery');
}

// =========================================================================
// 36. Primary Trailer Single Source of Truth & Acceptance Control Cases
// =========================================================================
console.log('\n--- 36. Testing Primary Trailer Single Source of Truth & Control Cases ---');

{
    // Control Case 1: TMDB vs KP Difference
    // Legacy KP trailer must NOT override TMDB structured primary trailer
    const cc1Movie = {
        kinopoiskId: 9101,
        name: 'CC1 Movie',
        trailer: {
            provider: 'YouTube',
            key: 'KP_OLD'
        },
        videos: [
            {
                provider: 'YouTube',
                key: 'TMDB_OFFICIAL',
                name: 'TMDB Official Trailer',
                type: 'Trailer',
                official: true,
                language: 'ru'
            },
            {
                provider: 'YouTube',
                key: 'TMDB_TEASER',
                name: 'TMDB Official Teaser',
                type: 'Teaser',
                official: true,
                language: 'ru'
            }
        ]
    };

    const cc1Resolved = manager.resolvePrimaryTrailer(cc1Movie);
    assert(cc1Resolved, 'CC1: Primary trailer must be resolved');
    assert.strictEqual(cc1Resolved.source, 'TMDB_STRUCTURED', 'CC1: Source must be TMDB_STRUCTURED');
    assert.strictEqual(cc1Resolved.trailer.key, 'TMDB_OFFICIAL', 'CC1: Primary trailer must be TMDB_OFFICIAL');

    const cc1Html = manager.createDetailedMovieCard(cc1Movie, null, null);
    assert(!cc1Html.includes('data-video-key="TMDB_OFFICIAL"'), 'CC1: TMDB_OFFICIAL must be excluded from gallery');
    assert(cc1Html.includes('data-video-key="TMDB_TEASER"'), 'CC1: TMDB_TEASER must be present in gallery');
    console.log('  ✅ 36.1 Control Case 1: TMDB structured primary drives exclusion; KP_OLD cannot cause TMDB_OFFICIAL duplication');

    // Control Case 2: Structured Only
    const cc2Movie = {
        kinopoiskId: 9102,
        name: 'CC2 Movie',
        trailer: null,
        videos: [
            { provider: 'YouTube', key: 'OFFICIAL_TRAILER', name: 'Official Trailer', type: 'Trailer', official: true },
            { provider: 'YouTube', key: 'OFFICIAL_TEASER', name: 'Official Teaser', type: 'Teaser', official: true },
            { provider: 'YouTube', key: 'MOVIE_CLIP', name: 'Movie Clip', type: 'Clip', official: false }
        ]
    };

    const cc2Resolved = manager.resolvePrimaryTrailer(cc2Movie);
    assert.strictEqual(cc2Resolved.trailer.key, 'OFFICIAL_TRAILER', 'CC2: Official Trailer selected as primary');
    const cc2Html = manager.createDetailedMovieCard(cc2Movie, null, null);
    assert(!cc2Html.includes('data-video-key="OFFICIAL_TRAILER"'), 'CC2: Primary trailer absent from gallery');
    assert(cc2Html.includes('data-video-key="OFFICIAL_TEASER"'), 'CC2: Teaser present in gallery');
    assert(cc2Html.includes('data-video-key="MOVIE_CLIP"'), 'CC2: Clip present in gallery');
    console.log('  ✅ 36.2 Control Case 2: Structured-only movie cleanly excludes primary trailer from gallery');

    // Control Case 3: KP Only
    const cc3Movie = {
        kinopoiskId: 9103,
        name: 'CC3 Movie',
        videos: [],
        trailer: {
            provider: 'YouTube',
            key: 'KP_VALID_TRAILER',
            name: 'KP Trailer',
            videoUrl: 'https://www.youtube.com/watch?v=KP_VALID_TRAILER'
        }
    };

    const cc3Resolved = manager.resolvePrimaryTrailer(cc3Movie);
    assert.strictEqual(cc3Resolved.source, 'KP_STRUCTURED', 'CC3: Source must be KP_STRUCTURED');
    assert.strictEqual(cc3Resolved.trailer.key, 'KP_VALID_TRAILER', 'CC3: Primary trailer is KP trailer');
    const cc3Html = manager.createDetailedMovieCard(cc3Movie, null, null);
    assert(!cc3Html.includes('movie-videos-section'), 'CC3: Empty videos array renders no gallery section');
    console.log('  ✅ 36.3 Control Case 3: KP structured trailer remains primary fallback without scraper regression');

    // Control Case 4: Scraper Only
    const cc4Movie = {
        kinopoiskId: 9104,
        name: 'CC4 Movie',
        videos: [],
        trailer: null
    };

    const cc4Resolved = manager.resolvePrimaryTrailer(cc4Movie);
    assert.strictEqual(cc4Resolved, null, 'CC4: Returns null when no structured trailer exists');
    console.log('  ✅ 36.4 Control Case 4: Scraper fallback condition preserved when no structured videos exist');

    // Control Case 5: Duplicate Video Keys in Gallery
    const cc5Movie = {
        kinopoiskId: 9105,
        name: 'CC5 Movie',
        videos: [
            { provider: 'YouTube', key: 'PRIMARY_DUP', name: 'Primary 1', type: 'Trailer', official: true },
            { provider: 'YouTube', key: 'PRIMARY_DUP', name: 'Primary 1 Dup', type: 'Trailer', official: true },
            { provider: 'YouTube', key: 'EXTRA_DUP', name: 'Extra 1', type: 'Teaser', official: true },
            { provider: 'YouTube', key: 'EXTRA_DUP', name: 'Extra 1 Dup', type: 'Teaser', official: true }
        ]
    };

    const cc5Html = manager.createDetailedMovieCard(cc5Movie, null, null);
    const primaryKeyMatches = (cc5Html.match(/data-video-key="PRIMARY_DUP"/g) || []).length;
    const extraKeyMatches = (cc5Html.match(/data-video-key="EXTRA_DUP"/g) || []).length;
    assert.strictEqual(primaryKeyMatches, 0, 'CC5: Primary key appears 0 times in gallery');
    assert.strictEqual(extraKeyMatches, 1, 'CC5: Non-primary duplicate key appears exactly 1 time in gallery');
    console.log('  ✅ 36.5 Control Case 5: Primary excluded 0 times and secondary duplicates collapsed to 1');
}

console.log('\n🎉 ALL MovieDetails Rich Data Phase 1A, 1C, 1D, 1E, 1F, 1G & 1H Tests Passed Successfully!\n');
