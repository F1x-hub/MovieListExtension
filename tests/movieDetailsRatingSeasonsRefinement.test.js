import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { i18n } from '../src/shared/i18n/I18n.js';
import SeriesEpisodeRatingService from '../src/shared/services/SeriesEpisodeRatingService.js';

console.log('🧪 Running MovieDetails Rating + Seasons UX Refinement Tests...\n');

i18n.currentLocale = 'ru';

// Mock DOM elements and browser environment
const windowStub = {
    location: { search: '' },
    history: { pushState: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
};

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
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
        return null;
    }

    scrollIntoView() {}

    querySelector(selector) {
        if (selector === '.season-episodes-panel') {
            let panel = this.children.find(c => c.classList && c.classList.contains('season-episodes-panel'));
            if (!panel) {
                panel = new MockElement('div');
                panel.className = 'season-episodes-panel';
                panel.classList.add('season-episodes-panel');
                this.appendChild(panel);
            }
            return panel;
        }
        if (selector === '.season-expand-icon') {
            const icon = new MockElement('span');
            icon.className = 'season-expand-icon';
            return icon;
        }
        return null;
    }

    closest(selector) {
        let curr = this;
        while (curr) {
            if (selector.startsWith('.') && curr.classList && curr.classList.contains(selector.slice(1))) {
                return curr;
            }
            curr = curr.parentElement;
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

    appendChild(child) {
        this.children.push(child);
        child.parentElement = this;
        return child;
    }
}

const mockDocElements = new Map();

const documentStub = {
    activeButtons: [],
    querySelector: (sel) => mockDocElements.get(sel) || null,
    querySelectorAll: () => [],
    getElementById: (id) => mockDocElements.get(`#${id}`) || null,
    createElement: (tag) => new MockElement(tag),
    body: new MockElement('body'),
    addEventListener: () => {},
    removeEventListener: () => {}
};

class KinopoiskServiceStub {
    formatCurrency(val) { return val ? `$${val}` : ''; }
    formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
    }
}

const escapeHtmlHelper = (t) => {
    if (t === null || t === undefined) return '';
    return String(t)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const utilsContext = vm.createContext({ module: { exports: {} } });
vm.runInContext(fs.readFileSync(new URL('../src/shared/utils/Utils.js', import.meta.url), 'utf8'), utilsContext);
const utilsStub = {
    selectRussianPlural: utilsContext.module.exports.selectRussianPlural,
    createPageStateManager: () => ({}),
    escapeHtml: escapeHtmlHelper,
    normalizeRatingComment: (v) => (typeof v === 'string' ? v.trim() : ''),
    getWatchStatusLabel: (s) => s,
    showConfirmModal: () => {},
    closeAllModals: () => {},
    openAuthModal: () => {}
};

const source = fs
    .readFileSync(new URL('../src/pages/movie-details/movie-details.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '');

const context = vm.createContext({
    window: windowStub,
    document: documentStub,
    i18n,
    KinopoiskService: KinopoiskServiceStub,
    Utils: utilsStub,
    utils: utilsStub,
    console,
    Date,
    parseFloat,
    Math,
    Boolean,
    Number,
    Array,
    Object,
    Event: class {}
});

vm.runInContext(fs.readFileSync(new URL('../src/pages/movie-details/MetaRenderer.js', import.meta.url), 'utf8'), context);
vm.runInContext(source, context);

const MovieDetailsManager = context.window.MovieDetailsManager;
context.SeriesEpisodeRatingService = SeriesEpisodeRatingService;
const manager = Object.create(MovieDetailsManager.prototype);
manager.isAdmin = false;
manager.escapeHtml = escapeHtmlHelper;
manager.getPluralSeasons = MovieDetailsManager.prototype.getPluralSeasons;

const css = fs.readFileSync('src/pages/movie-details/movie-details.css', 'utf8');
assert(/\.episode-rating-control\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s.test(css), 'the whole rating group is centered');
assert(/\.episode-rating-value\s*\{[^}]*flex:\s*0 0 5ch;[^}]*width:\s*5ch;/s.test(css), 'the value has a permanent slot');
assert(/\.episode-rating-remove-slot\s*\{[^}]*flex:\s*0 0 32px;/s.test(css), 'hidden removal does not shift the stars');
assert(/\.episode-rating-message\s*\{[^}]*flex-basis:\s*100%;[^}]*text-align:\s*center;/s.test(css), 'access and future messages are centered');
assert(source.includes('<span class="episode-rating-remove-slot"><button'), 'removal keeps its slot even when hidden');
assert(/@media \(max-width: 420px\)[\s\S]*\.episode-rating-scale\s*\{[^}]*repeat\(5,/s.test(css), 'mobile stars retain the centered two-row layout');

// =========================================================================
// PART 44: RATINGS TESTS (Tests 1 - 8)
// =========================================================================
console.log('--- Part 44: Testing Ratings UX Refinement & TMDB About Row ---');

const testMovieFullRatings = {
    kinopoiskId: 401515,
    name: "It's Always Sunny in Philadelphia",
    rating: { kp: 8.0, imdb: 8.8, tmdb: 8.3 },
    votes: { kp: 24000, imdb: 288000, tmdb: 1400 }
};

const htmlFull = manager.createDetailedMovieCard(testMovieFullRatings);

const htmlPendingProvider = manager.createDetailedMovieCard({
    kinopoiskId: 401514,
    name: 'IMDb enrichment pending',
    rating: { kp: 5.9, imdb: 0 },
    votes: { kp: 3663, imdb: 0 }
});
assert(htmlPendingProvider.includes('rating-item-large kp rating-item-large--loading'), '0. KP waits in the shared provider loading state');
assert(htmlPendingProvider.includes('rating-item-large imdb rating-item-large--loading'), '0. IMDb uses the same shared provider loading state');
assert.equal((htmlPendingProvider.match(/rating-value--skeleton/g) || []).length, 2, '0. Both provider values use synchronized skeletons');
console.log('  ✅ 0. KP and IMDb render as one synchronized provider rail while IMDb is pending');

const htmlProviderLinks = manager.createDetailedMovieCard({
    kinopoiskId: 662551,
    name: 'Хелтер-скелтер',
    externalId: { imdb: 'tt2125501' },
    rating: { kp: 6.4, imdb: 6.4 },
    votes: { kp: 5700, imdb: 3000 }
});
assert(htmlProviderLinks.includes('<a class="rating-item-large kp rating-item-large--link" href="https://www.kinopoisk.ru/film/662551/" target="_blank" rel="noopener noreferrer"'), '0b. KP tile links to the Kinopoisk film page');
assert(htmlProviderLinks.includes('<a class="rating-item-large imdb rating-item-large--link" href="https://www.imdb.com/title/tt2125501/" target="_blank" rel="noopener noreferrer"'), '0b. IMDb tile links to the IMDb title page');
const htmlNoImdbId = manager.createDetailedMovieCard({
    kinopoiskId: 662551,
    name: 'Без IMDb ID',
    imdbId: 'javascript:alert(1)',
    rating: { kp: 6.4, imdb: 6.4 },
    votes: { kp: 5700, imdb: 3000 }
});
assert(htmlNoImdbId.includes('<div class="rating-item-large imdb">'), '0b. IMDb tile stays a plain block without a valid tt ID');
assert(!htmlNoImdbId.includes('javascript:'), '0b. Invalid IMDb IDs never reach an href');
console.log('  ✅ 0b. Rating tiles open Kinopoisk / IMDb only for valid provider IDs');

// 1. TMDB large left card absent
assert(!htmlFull.includes('rating-item-large tmdb'), '1. TMDB rating card must be absent from left rating rail');
console.log('  ✅ 1. TMDB large left card absent from left rating rail');

// 2. KP left card remains
assert(htmlFull.includes('rating-item-large kp'), '2. KP rating card must be present on left rail');
assert(htmlFull.includes('8.0') || htmlFull.includes('8'), '2. KP rating value must be present');
console.log('  ✅ 2. KP left card preserved with correct rating');

// 3. IMDb left card remains
assert(htmlFull.includes('rating-item-large imdb'), '3. IMDb rating card must be present on left rail');
assert(htmlFull.includes('8.8'), '3. IMDb rating value must be present');
console.log('  ✅ 3. IMDb left card preserved with correct rating');

// 4. TMDB About row renders
assert(htmlFull.includes('meta-item--tmdb'), '4. TMDB rating row must render in About tab meta grid');
assert(htmlFull.includes('Рейтинг TMDB'), '4. Row must explicitly display "Рейтинг TMDB" label');
console.log('  ✅ 4. TMDB About row renders with explicit provider label');

// 5. TMDB About row rating correct
assert(htmlFull.includes('8.3'), '5. TMDB rating score 8.3 must be rendered in About row');
console.log('  ✅ 5. TMDB About row rating correct (8.3)');

// 6. TMDB votes correct
assert(htmlFull.includes('1,4 тыс. оценок') || htmlFull.includes('1,4 тыс. оценок'), '6. TMDB votes must use locale compact formatting (1,4 тыс. оценок)');
console.log('  ✅ 6. TMDB votes correctly formatted and localized');

// 7. null / 0 TMDB omitted
const movieZeroTmdb = {
    kinopoiskId: 401516,
    name: 'Zero TMDB Title',
    rating: { kp: 7.2, imdb: 7.4, tmdb: 0 },
    votes: { kp: 1000, imdb: 2000, tmdb: 0 }
};
const htmlZero = manager.createDetailedMovieCard(movieZeroTmdb);
assert(!htmlZero.includes('meta-item--tmdb'), '7. 0/null TMDB must not render meta-item--tmdb');
assert(!htmlZero.includes('rating-item-large tmdb'), '7. 0/null TMDB must not render in left rail');

const movieMissingVotes = {
    kinopoiskId: 401517,
    name: 'Rating Without Votes',
    rating: { kp: 7.0, tmdb: 6.9 },
    votes: {}
};
const htmlMissingVotes = manager.createDetailedMovieCard(movieMissingVotes);
assert(htmlMissingVotes.includes('meta-item--tmdb'), '7b. TMDB row renders when rating > 0 without votes');
assert(htmlMissingVotes.includes('6.9'), '7b. TMDB rating score 6.9 present');
assert(!htmlMissingVotes.includes('0 оценок'), '7b. 0 votes text omitted cleanly');
console.log('  ✅ 7. 0/null TMDB omitted, rating without votes cleanly handled');

// 8. provider isolation preserved
const movieTmdbOnly = {
    kinopoiskId: 401518,
    name: 'TMDB Only',
    rating: { kp: 0, imdb: 0, tmdb: 8.5 },
    votes: { kp: 0, imdb: 0, tmdb: 5000 }
};
const htmlTmdbOnly = manager.createDetailedMovieCard(movieTmdbOnly);
assert(!htmlTmdbOnly.includes('rating-item-large kp'), '8. KP card omitted when 0');
assert(!htmlTmdbOnly.includes('rating-item-large imdb'), '8. IMDb card omitted when 0');
assert(!htmlTmdbOnly.includes('rating-item-large tmdb'), '8. TMDB not in left rail');
assert(htmlTmdbOnly.includes('meta-item--tmdb'), '8. TMDB in About tab only');
assert(htmlTmdbOnly.includes('8.5'), '8. TMDB rating 8.5 rendered');
console.log('  ✅ 8. Rating provider isolation preserved with 0 cross-contamination');


// =========================================================================
// IMDb-style seasons browser exercises the live production methods.
const eighteenSeasons = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, episodeCount: 8, airDate: '2020-01-01' }));
eighteenSeasons.unshift({ number: 0, isSpecial: true, episodeCount: 2 });
const singleSeason = [eighteenSeasons[1]];
manager.selectedMovie = { kinopoiskId: 777, tmdbId: 888, type: 'TV_SERIES', seasons: eighteenSeasons };
const seasonsHtml18 = manager.renderSeasonsTab(eighteenSeasons, null, null, 888);
const seasonsDom = new JSDOM(seasonsHtml18).window.document;
const tabs = [...seasonsDom.querySelectorAll('[role="tablist"] [role="tab"]')];
assert.equal(tabs.length, 19, 'every normal season plus specials gets a tab');
assert.equal(tabs.at(-1).getAttribute('data-season-number'), '0', 'specials sort last');
assert.equal(tabs.filter(tab => tab.getAttribute('aria-selected') === 'true').length, 1);
assert(!seasonsHtml18.includes('season-expand-btn'), 'accordion actions are removed');
assert(!seasonsHtml18.includes('season-card'), 'poster season cards are removed');
assert(manager.renderSeasonsTab(singleSeason, null, null, 888).includes('role="tablist"'), 'one season still has a tab');
assert(seasonsHtml18.includes('18 сезонов'));
const episodes = [
    { seasonNumber: 1, episodeNumber: 1, name: '<Pilot>', overview: '<script>bad()</script>', airDate: '2020-01-01', runtime: 24, voteAverage: 8, voteCount: 100 },
    { seasonNumber: 1, episodeNumber: 2, name: 'Second', airDate: '2020-01-02', voteAverage: 9, voteCount: 300 },
    { seasonNumber: 1, episodeNumber: 3, name: 'No votes', airDate: '2020-01-03', voteAverage: 7, voteCount: 0 },
    { seasonNumber: 1, episodeNumber: 4, name: 'Future', airDate: '2099-01-01', voteAverage: 10, voteCount: 900 }
];
manager.selectedMovie = { kinopoiskId: 777, tmdbId: 888, type: 'TV_SERIES' };
manager.publicEpisodeStats = { movieId: 777, episodes: {
    '1:1': { sum: 800, count: 100, avg: 8 }, '1:2': { sum: 2700, count: 300, avg: 9 }, '1:4': { sum: 9000, count: 900, avg: 10 }
} };
const stats = manager.getSeasonEpisodeChartStats(episodes, '2020-01-01');
assert.equal(stats.average, 8.5, 'mean counts released episodes with votes equally');
assert.equal(stats.votes, 400, 'future and zero-vote episodes do not contribute votes');
assert.equal(manager.getEpisodeChartHeight(episodes[2], stats), 22);
assert.equal(manager.getEpisodeChartHeight(episodes[3], stats), 22);
assert(manager.getEpisodeChartHeight(episodes[1], stats) > manager.getEpisodeChartHeight(episodes[0], stats));
assert.equal(manager.getEpisodeChartHeight(episodes[1], stats), 60);
assert.equal(stats.minRating, 8);
assert.equal(stats.maxRating, 9);
assert(Math.abs(manager.getEpisodeChartHeight(episodes[0], stats) - (22 + 0.3 / 1.3 * 38)) < 1e-9);
assert.equal(manager.getEpisodeChartRatingHeight(0, stats), 22, 'values below lo clamp to the minimum');
const equalStats = { ...stats, minRating: 8, maxRating: 8, average: 8 };
assert.equal(manager.getEpisodeChartHeight(episodes[0], equalStats), 41, 'equal scores have middle-height bars');
assert.equal(manager.getSeasonEpisodeChartStats([episodes[2]]).votes, 0);
const resumed = manager.getDefaultSeasonEpisode(eighteenSeasons, { season: 2, episode: 3, timestamp: 20 }, null, {});
assert.equal(resumed.seasonNumber, 2); assert.equal(resumed.episodeNumber, 3);
assert.equal(manager.getDefaultSeasonEpisode(eighteenSeasons, null, null, {}).seasonNumber, 1);
const targeted = manager.getDefaultSeasonEpisode(eighteenSeasons, null, { seasonNumber: 3, episodeNumber: 5 }, {});
assert.equal(targeted.seasonNumber, 3);
assert.equal(targeted.episodeNumber, 5);
const historyDefault = manager.getDefaultSeasonEpisode(eighteenSeasons, null, null, { '2:4': { completedAt: 100 } });
assert.equal(historyDefault.seasonNumber, 2, 'last watched season is used without a resume target');
assert.equal(historyDefault.episodeNumber, 4);
manager.seasonsBrowserSeason = 1;
manager.seasonsBrowserEpisode = 1;
const chartHtml = manager.renderEpisodesList(episodes, null, null, null, { '1:2': { completed: true } }, null, '2020-01-01');
const chartDoc = new JSDOM(chartHtml).window.document;
const averageLine = chartDoc.querySelector('.episode-chart-average');
assert.equal(averageLine.getAttribute('aria-hidden'), 'true');
assert(Math.abs(Number(averageLine.style.getPropertyValue('--episode-bar-position')) - (8.5 - 7.7) / (9 - 7.7)) < 1e-6, 'mean uses exactly the bar-height scale');
assert(!new JSDOM(manager.renderEpisodesList([episodes[2]], null, null, null, {}, null)).window.document.querySelector('.episode-chart-average'), 'no votes means no mean line');
assert(!chartDoc.querySelector('.episode-column-bar .episode-column-markers'), 'markers never obscure scores');
assert.equal(chartDoc.querySelectorAll('.episode-column-label .episode-column-markers').length, episodes.length);
assert(/\.episode-column\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*56px/s.test(css), 'columns fill available width with a fixed minimum');
assert(/\.episode-chart-average\s*\{[^}]*bottom:\s*calc\(28px \+ 22px \+ var\(--episode-bar-position\) \* var\(--episode-height-range\)\)/s.test(css));
assert(css.includes('--episode-graph-height: 64px') && css.includes('--episode-graph-height: 56px'));
assert(!/\.episode-column\.is-selected \.episode-column-score\s*\{/.test(css), 'selected score has no inner plaque');
assert.equal(chartDoc.querySelectorAll('.episode-detail').length, 1, 'only selected episode has a detail card');
assert(chartHtml.includes('8.5'));
assert(chartHtml.includes('&lt;Pilot&gt;'));
assert(!chartDoc.querySelector('script'), 'TMDB descriptions are escaped');
assert(!chartHtml.includes('TMDB'), 'season score UI never uses TMDB votes or labels');
assert(chartDoc.querySelector('.episode-community-score').textContent.includes('8.0'));
const oldPublicStats = manager.publicEpisodeStats;
for (const [count, form, episodeForm, seasonForm] of [
    [1, 'оценка', 'серия', 'сезон'], [2, 'оценки', 'серии', 'сезона'],
    [5, 'оценок', 'серий', 'сезонов'], [11, 'оценок', 'серий', 'сезонов'],
    [21, 'оценка', 'серия', 'сезон'], [22, 'оценки', 'серии', 'сезона'],
    [25, 'оценок', 'серий', 'сезонов']
]) {
    assert.equal(manager.getPluralRatings(count), form);
    assert(manager.getEpisodeSeasonSummary([], { average: 9, votes: count }, 1).endsWith(`${count} ${form}`));
    manager.publicEpisodeStats = { movieId: 777, episodes: { '1:1': { sum: count * 9, count, avg: 9 } } };
    assert(manager.getCommunityEpisodeLabel({ seasonNumber: 1, episodeNumber: 1 }).endsWith(`${count} ${form}`));
    assert.equal(manager.getPluralEpisodes(count), episodeForm);
    assert.equal(manager.getPluralSeasons(count), seasonForm);
}
assert.equal(manager.getPluralRatings(1001), 'оценок', 'compact thousands use the genitive plural');
manager.publicEpisodeStats = oldPublicStats;
manager.publicEpisodeStats = { movieId: 777, episodes: {} };
const absentStatsHtml = manager.renderEpisodesList(episodes);
assert(absentStatsHtml.includes('оценок пока нет'));
assert(!new JSDOM(absentStatsHtml).window.document.querySelector('.episode-chart-average'));
manager.publicEpisodeStats = oldPublicStats;
manager.selectedMovie.backdropUrl = 'https://example.com/backdrop.jpg';
assert(manager.renderSelectedEpisode(episodes[0]).includes('episode-still-placeholder-label'));
assert(manager.renderSelectedEpisode(episodes[0]).includes('https://example.com/backdrop.jpg'));
delete manager.selectedMovie.backdropUrl;
assert(manager.renderSelectedEpisode(episodes[0]).includes('Кадр отсутствует'));
assert(/\.episode-column\s*\{[^}]*border:\s*0 !important;[^}]*box-shadow:\s*none !important;/s.test(css));
assert(!chartHtml.includes('episode-rating-popover'), 'direct stars replace the old popover');
assert(css.includes('overflow-x: auto'));
assert(css.includes(':focus-visible'));
console.log('  ✅ Season tabs, community mean, bar heights, defaults and safe single-card rendering');

// Real DOM tests exercise loading, keyboard selection and non-disruptive progress updates.
context.isSeriesMedia = movie => movie?.type === 'TV_SERIES';
const browser = Object.create(MovieDetailsManager.prototype);
browser.escapeHtml = escapeHtmlHelper;
browser.selectedMovie = { kinopoiskId: 777, tmdbId: 888, type: 'TV_SERIES' };
browser.publicEpisodeStats = oldPublicStats;
browser.currentEpisodeHistory = {};
browser.capturePageContext = () => ({});
browser.isPageContextCurrent = () => true;
browser.playbackController = { currentSelection: null };
const browserSeasons = [{ number: 1, episodeCount: 4, airDate: '2020-01-01' }, { number: 2, episodeCount: 2, airDate: '2020-01-01' }];
const browserDom = new JSDOM(`<div id="tab-seasons">${browser.renderSeasonsTab(browserSeasons, null, null, 888)}</div>`);
context.document = browserDom.window.document;
const detailCalls = [];
browser.tmdbService = { async getSeasonDetails(id, seasonNumber, options) {
    detailCalls.push({ id, seasonNumber, options });
    return { airDate: '2020-01-01', episodes: episodes.map(ep => ({ ...ep, seasonNumber })) };
} };
await browser.loadSelectedSeason();
assert.equal(detailCalls.length, 1, 'first selected season lazily loads once');
assert.equal(browser.seasonsBrowserEpisode, 1);
const liveDoc = browserDom.window.document;
const publicBefore = browser.publicEpisodeStats;
browser.adjustPublicEpisodeScore(1, 1, 8, 10);
assert.equal(browser.publicEpisodeStats.episodes['1:1'].sum, 802);
assert.equal(browser.publicEpisodeStats.episodes['1:1'].count, 100);
browser.adjustPublicEpisodeScore(1, 3, null, 7);
assert.equal(browser.publicEpisodeStats.episodes['1:3'].avg, 7);
assert(liveDoc.querySelector('.season-browser-summary').textContent.includes('401'));
browser.adjustPublicEpisodeScore(1, 3, 7, null);
assert(!browser.publicEpisodeStats.episodes['1:3']);
browser.publicEpisodeStats = publicBefore;
browser.refreshEpisodeCommunityUI();
let statsReads = 0;
context.firebaseManager = { db: { collection(name) {
    assert.equal(name, 'seriesEpisodeStats');
    return { doc(id) { assert.equal(id, '777'); return { async get() { statsReads++; return { exists: true, data: () => publicBefore }; } }; } };
} } };
await browser.loadPublicEpisodeStats(browser.selectedMovie);
await browser.loadPublicEpisodeStats(browser.selectedMovie);
assert.equal(statsReads, 1, 'one public read per page, including guests');
assert.equal(browser.getPublicEpisodeScore(episodes[0]).avg, 8);
await browser.loadPublicEpisodeStats({ kinopoiskId: 778, type: 'movie' });
assert.equal(statsReads, 1, 'films do not read episode aggregates');
browser.pageGeneration = 2;
context.firebaseManager.db.collection = () => ({ doc: () => ({ async get() { throw new Error('permission-denied'); } }) });
await browser.loadPublicEpisodeStats(browser.selectedMovie);
assert.equal(browser.getPublicEpisodeScore(episodes[0]), null, 'failed public reads leave an empty usable catalog');
browser.pageGeneration = 3;
context.firebaseManager.db.collection = () => ({ doc: () => ({ async get() { return { exists: false }; } }) });
await browser.loadPublicEpisodeStats(browser.selectedMovie);
assert.equal(browser.getPublicEpisodeScore(episodes[0]), null, 'missing aggregate documents mean no ratings');
browser.publicEpisodeStats = publicBefore;
browser.refreshEpisodeCommunityUI();
const chartRoot = liveDoc.querySelector('.episode-chart');
Object.defineProperties(chartRoot, {
    clientWidth: { configurable: true, value: 600 },
    scrollWidth: { configurable: true, value: 600 }
});
chartRoot.scrollLeft = 15;
browser.updateEpisodeChartScrollControls();
assert([...liveDoc.querySelectorAll('.episode-chart-scroll')].every(button => button.hidden), 'fitting columns never show scroll arrows');
Object.defineProperty(chartRoot, 'scrollWidth', { configurable: true, value: 900 });
chartRoot.scrollLeft = 0;
browser.updateEpisodeChartScrollControls();
assert(liveDoc.querySelector('[data-action="scroll-episode-chart"][data-direction="prev"]').hidden);
assert(!liveDoc.querySelector('[data-action="scroll-episode-chart"][data-direction="next"]').hidden);
chartRoot.scrollLeft = 300;
browser.updateEpisodeChartScrollControls();
assert(!liveDoc.querySelector('[data-action="scroll-episode-chart"][data-direction="prev"]').hidden);
assert(liveDoc.querySelector('[data-action="scroll-episode-chart"][data-direction="next"]').hidden);
const cardRoot = liveDoc.querySelector('.episode-detail');
browser.selectSeasonEpisode(2, { scroll: false });
assert.equal(browser.seasonsBrowserEpisode, 2);
assert.equal(liveDoc.querySelector('.episode-column.is-selected').dataset.episodeNumber, '2');
assert.equal(liveDoc.querySelector('.episode-title').textContent, 'Second');
assert.equal(liveDoc.querySelector('.episode-chart'), chartRoot, 'episode selection preserves chart DOM');
let prevented = false;
browser.handleSeasonsBrowserKeydown({ target: liveDoc.querySelector('.episode-column.is-selected'), key: 'End', preventDefault() { prevented = true; } });
assert(prevented);
assert.equal(browser.seasonsBrowserEpisode, 4, 'End selects final episode');
browser.handleSeasonsBrowserKeydown({ target: liveDoc.querySelector('.episode-column.is-selected'), key: 'Home', preventDefault() {} });
assert.equal(browser.seasonsBrowserEpisode, 1);
await browser.navigateSeasonEpisode('next');
assert.equal(browser.seasonsBrowserEpisode, 2);
browser.selectSeasonEpisode(4, { scroll: false });
await browser.navigateSeasonEpisode('next');
assert.equal(browser.seasonsBrowserSeason, 2, 'next on final episode advances season');
assert.equal(browser.seasonsBrowserEpisode, 1, 'next season starts with its first released episode');
await browser.navigateSeasonEpisode('prev');
assert.equal(browser.seasonsBrowserSeason, 1);
assert.equal(browser.seasonsBrowserEpisode, 4, 'previous at start goes to prior season final episode');
assert.equal(detailCalls.length, 2, 'returning to a loaded season uses in-memory cache');
await browser.handleSeasonPillSelect(1);
browser.selectSeasonEpisode(1, { scroll: false });
const stableChart = liveDoc.querySelector('.episode-chart');
const stableCard = liveDoc.querySelector('.episode-detail');
browser.currentProgressRecord = { season: 1, episode: 1, timestamp: 30, duration: 100, completed: false };
browser.currentEpisodeHistory = { '1:1': { cAt: 100 } };
browser.updateSeasonsBrowserState();
assert.equal(liveDoc.querySelector('.episode-chart'), stableChart);
assert.equal(liveDoc.querySelector('.episode-detail'), stableCard, 'progress patches existing detail card');
assert.equal(liveDoc.querySelector('[data-marker="watched"]').hidden, false);
assert.equal(liveDoc.querySelector('[data-marker="resume"]').hidden, false, 'rewatch supports watched and resume together');
assert.equal(liveDoc.querySelector('[data-action="toggle-episode-watched"]').getAttribute('aria-pressed'), 'true');
assert.equal(liveDoc.querySelector('[data-action="play-episode"]').dataset.timestamp, '30');
browser.progressService = { async getProgress() { return { season: 1, episode: 1, timestamp: 40, duration: 100 }; } };
browser.episodeHistoryService = { async getHistory() { return { '1:1': { cAt: 100 } }; } };
await browser.refreshSeasonsProgress();
assert.equal(liveDoc.querySelector('.episode-chart'), stableChart, 'refresh keeps the strip DOM and scroll state');
assert.equal(liveDoc.querySelector('.episode-detail'), stableCard, 'refresh patches existing card');
assert.equal(liveDoc.querySelector('[data-action="play-episode"]').dataset.timestamp, '40');
browser.playbackController.currentSelection = { kinopoiskId: 777, seasonNumber: 1, episodeNumber: 2 };
browser.updateActiveEpisodePlayingState(browser.playbackController.currentSelection);
assert.equal(browser.seasonsBrowserEpisode, 2, 'player switches select matching open-season episode');
assert.equal(liveDoc.querySelector('.episode-chart'), stableChart);
browser.updateActiveEpisodePlayingState({ kinopoiskId: 777, seasonNumber: 2, episodeNumber: 3 });
assert.equal(browser.seasonsBrowserSeason, 1, 'player switching another season does not replace browsing season');

// A failed load has a visible retry, with a forced fetch that can recover.
browser.tmdbService.getSeasonDetails = async () => { throw new Error('offline'); };
await browser.loadSelectedSeason(1, { forceRefresh: true });
assert(liveDoc.querySelector('[data-action="retry-season"]'));
let forced = false;
browser.tmdbService.getSeasonDetails = async (id, seasonNumber, options) => {
    forced = options.forceRefresh;
    return { episodes: episodes.map(ep => ({ ...ep, seasonNumber })) };
};
await browser.loadSelectedSeason(1, { forceRefresh: true });
assert(forced);
assert(liveDoc.querySelector('.episode-detail'));

// A slower response for an old selection never paints over the current season.
let releaseOld;
browser.tmdbService.getSeasonDetails = (id, seasonNumber) => seasonNumber === 1
    ? new Promise(resolve => { releaseOld = resolve; })
    : Promise.resolve({ episodes: [{ ...episodes[0], seasonNumber: 2, name: 'Current season' }] });
const oldLoad = browser.loadSelectedSeason(1, { forceRefresh: true });
await browser.handleSeasonPillSelect(2, { forceRefresh: true });
releaseOld({ episodes: [{ ...episodes[0], name: 'Stale season' }] });
await oldLoad;
assert.equal(liveDoc.querySelector('.episode-title').textContent, 'Current season');
assert.equal(browser.seasonsBrowserSeason, 2);

// Returning to an in-flight season shares the fetch and still paints the latest request.
let releaseShared;
let sharedCalls = 0;
browser.seasonsBrowserCache.delete(1);
browser.tmdbService.getSeasonDetails = () => {
    sharedCalls += 1;
    return new Promise(resolve => { releaseShared = resolve; });
};
const firstShared = browser.handleSeasonPillSelect(1);
const secondShared = browser.handleSeasonPillSelect(1);
assert.equal(sharedCalls, 1);
releaseShared({ episodes: [{ ...episodes[0], name: 'Shared season' }] });
await Promise.all([firstShared, secondShared]);
assert.equal(liveDoc.querySelector('.episode-title').textContent, 'Shared season');
assert.equal(liveDoc.querySelector('#season-browser-panel').hasAttribute('aria-busy'), false);

// A forced replacement must remain cached even when the older fetch finishes last.
let releaseSuperseded, releaseReplacement;
browser.tmdbService.getSeasonDetails = () => new Promise(resolve => {
    if (!releaseSuperseded) releaseSuperseded = resolve;
    else releaseReplacement = resolve;
});
const superseded = browser.loadSelectedSeason(1, { forceRefresh: true });
const replacement = browser.loadSelectedSeason(1, { forceRefresh: true });
releaseReplacement({ episodes: [{ ...episodes[0], name: 'Replacement season' }] });
await replacement;
releaseSuperseded({ episodes: [{ ...episodes[0], name: 'Superseded season' }] });
await superseded;
assert.equal(liveDoc.querySelector('.episode-title').textContent, 'Replacement season');
assert.equal(browser.seasonsBrowserCache.get(1).episodes[0].name, 'Replacement season');

// Keyboard stars choose adjacent values and stop at the ends of the scale.
browser.currentUser = { uid: 'user' };
liveDoc.querySelector('.episode-rating-slot').innerHTML = browser.renderEpisodeRatingControl(episodes[0]);
const chosen = [];
browser.changeEpisodeRating = async (button, score) => { chosen.push(score); };
const radios = [...liveDoc.querySelectorAll('[role="radio"]')];
assert.equal(radios.length, 10);
browser.handleEpisodeRatingKeydown({ target: radios[0], key: 'ArrowRight', preventDefault() {} });
browser.handleEpisodeRatingKeydown({ target: radios[1], key: 'End', preventDefault() {} });
assert.deepEqual(chosen, [2, 10]);
browser.previewEpisodeStars(radios[0].closest('.episode-rating-control'), 4);
assert.equal(radios.filter(star => star.classList.contains('is-filled')).length, 4, 'hover preview fills up to the hovered value');
const seasonKeys = [];
browser.handleSeasonPillSelect = async season => { seasonKeys.push(season); };
const seasonTabs = [...liveDoc.querySelectorAll('.season-tab')];
browser.handleSeasonsBrowserKeydown({ target: seasonTabs[0], key: 'ArrowRight', preventDefault() {} });
browser.handleSeasonsBrowserKeydown({ target: seasonTabs[1], key: 'Home', preventDefault() {} });
assert.deepEqual(seasonKeys, [2, 1], 'season arrows and Home load the targeted tab');
context.document = documentStub;
console.log('  ✅ Lazy cache, retry/race, navigation, keyboard and targeted progress state');

// Episode updates are independent, including before the private read completes.
context.isSeriesMedia = movie => movie?.type === 'TV_SERIES';
manager.currentUser = { uid: 'user' };
manager.selectedMovie = { kinopoiskId: 777, tmdbId: 888, type: 'TV_SERIES' };
manager.currentSeriesEpisodeRatings = null;
manager.currentPersonalRating = { rating: 8, ratingSource: 'episodes', episodeAverage: 8.4, episodesRatedCount: 12 };
const titleRating = manager.currentPersonalRating;
manager.currentRating = 8;
manager.applyOptimisticEpisodeRating(1, 1, 9);
assert.equal(manager.currentSeriesEpisodeRatings.episodes['1:1'].r, 9);
assert.equal(manager.currentPersonalRating, titleRating, 'episode writes leave the title rating untouched');
assert.equal(manager.currentRating, 8);
assert.equal(manager.getPersonalRatingDisplayValue(titleRating), 8, 'legacy average is ignored');
manager.applyOptimisticEpisodeRating(1, 1, null);
assert.equal(manager.currentSeriesEpisodeRatings.exists, false);
assert.equal(manager.currentPersonalRating, titleRating, 'last episode removal preserves the title rating');

const label = new MockElement();
const rateButton = new MockElement('button');
rateButton.querySelector = selector => selector === '.rate-movie-label' ? label : null;
manager.elements = { movieDetailsContainer: { querySelector: () => rateButton } };
manager.isPageContextCurrent = () => true;
manager.patchPersonalRating(titleRating, {});
assert.equal(label.textContent, 'Ваша оценка: 8/10');
manager.selectedMovie.type = 'movie';
manager.patchPersonalRating({ rating: 7 }, {});
assert.equal(label.textContent, 'Ваша оценка: 7/10', 'all media use the same title label');
manager.patchPersonalRating(null, {});
assert.equal(label.textContent, 'Оценить');
manager.selectedMovie.type = 'TV_SERIES';
assert(!manager.renderSeasonsTab(singleSeason, null, null, 888).includes('seriesEpisodeRatingSummary'));
assert(!manager.renderSeasonsTab(singleSeason, null, null, 888).includes('season-card__episode-average'));
manager.episodeRatingsPermissionDeniedMovieId = null;
manager.currentSeriesEpisodeRatings = { episodes: { '1:1': { r: 8 } }, exists: true };
const ratedEpisodeHtml = manager.renderEpisodesList([{
    seasonNumber: 1, episodeNumber: 1, name: 'Pilot', airDate: '2020-01-01', runtime: 24
}]);
const ratedDoc = new JSDOM(ratedEpisodeHtml).window.document;
assert.equal(ratedDoc.querySelectorAll('[role="radiogroup"]').length, 1);
assert.equal(ratedDoc.querySelectorAll('[role="radio"]').length, 10);
assert(ratedEpisodeHtml.includes('Вы ★ 8'));
assert.equal(ratedDoc.querySelector('[data-rating="8"]').getAttribute('aria-checked'), 'true');
assert(ratedDoc.querySelector('[data-action="episode-rating-remove"]'));
manager.currentUser = null;
assert(manager.renderEpisodeRatingControl(episodes[0]).includes('Войдите'), 'guest gets sign-in guidance');
manager.currentUser = { uid: 'user' };
manager.selectedMovie.kinopoiskId = null;
assert(!manager.renderEpisodeRatingControl(episodes[0]).includes('role="radio"'), 'TMDB-only series cannot be rated');
manager.selectedMovie.kinopoiskId = 777;
const futureRatingDoc = new JSDOM(manager.renderEpisodeRatingControl(episodes[3])).window.document;
assert([...futureRatingDoc.querySelectorAll('[role="radio"]')].every(star => star.disabled), 'future episode stars are disabled');

// A denied private write rolls back only the episode state.
const beforeDeniedWrite = manager.currentSeriesEpisodeRatings;
const publicBeforeDeniedWrite = manager.publicEpisodeStats;
const beforeTitleRating = manager.currentPersonalRating;
const trigger = { setAttribute() {}, focus() {} };
const popover = {};
const control = {
    dataset: { seasonNumber: '1', episodeNumber: '1', released: 'true' },
    classList: { remove() {} },
    querySelector: selector => selector === '.episode-rating-popover' ? popover : trigger
};
manager.episodeRatingUiVersion = 0;
manager.capturePageContext = () => ({});
context.firebaseManager = { getSeriesEpisodeRatingService: () => ({
    async setEpisodeRating() { throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' }); }
}) };
let toastMessage = '';
context.Utils.showToast = message => { toastMessage = message; };
await manager.changeEpisodeRating({ closest: () => control }, 9);
assert.equal(manager.currentSeriesEpisodeRatings, beforeDeniedWrite);
assert.equal(manager.publicEpisodeStats, publicBeforeDeniedWrite, 'failed writes roll back the public optimistic contribution');
assert.equal(manager.currentPersonalRating, beforeTitleRating);
assert.equal(manager.isEpisodeRatingMutationPending, false);
assert.equal(toastMessage, i18n.get('movie_details.series_episode_rules_error'));
assert(/\.episode-detail-nav\s*\{[^}]*top:\s*50%;[^}]*translateY\(-50%\)/s.test(css));
assert(!/\.episode-detail(?:\:hover|\:focus-within)[^{]*\.episode-detail-nav/.test(css), 'neither arrow relies on hover');
assert(!/\.episode-detail-nav\[data-direction="prev"\]\s*\{[^}]*opacity:\s*0/s.test(css));
const selectedStyle = css.match(/\.episode-column\.is-selected \.episode-column-bar\s*\{([^}]+)\}/)[1];
assert(selectedStyle.includes('background: var(--ui-color-interactive)'));
assert(selectedStyle.includes('color: var(--ui-color-page)'));
assert(!selectedStyle.includes('warning') && !selectedStyle.includes('gradient'));
assert(css.includes('.episode-column:focus-visible .episode-column-label'));
const boundaryDoc = new JSDOM(manager.renderSelectedEpisode({ seasonNumber: 1, episodeNumber: 1, name: 'Only', airDate: '2020-01-01' })).window.document;
const boundaryArrows = [...boundaryDoc.querySelectorAll('.episode-detail-nav')];
assert.equal(boundaryArrows.length, 2);
assert(boundaryArrows.every(button => !button.hidden && button.disabled && button.getAttribute('aria-disabled') === 'true'));

// Saved ratings mark watched once, and removing/changing a rating never toggles it off.
let markCalls = 0, ratingWrites = 0, refreshed = 0;
manager.currentEpisodeHistory = {};
manager.refreshSeasonsProgress = async () => { refreshed++; };
manager.episodeHistoryService = {
    async markCompleted(movieId, season, episode, options) {
        markCalls++;
        assert.equal(options.source, 'MANUAL');
        return { [`${season}:${episode}`]: { cAt: 123 } };
    },
    async unmarkCompleted() { throw new Error('rating must never unmark watched'); }
};
context.firebaseManager = { getSeriesEpisodeRatingService: () => ({
    async setEpisodeRating({ rating }) { ratingWrites++; return { state: { episodes: { '1:1': { r: rating } } } }; },
    async removeEpisodeRating() { return { state: { episodes: {} } }; }
}) };
await manager.changeEpisodeRating({ closest: () => control }, 9);
assert.equal(markCalls, 1);
assert.equal(refreshed, 1);
assert(manager.currentEpisodeHistory['1:1']);
await manager.changeEpisodeRating({ closest: () => control }, 7);
await manager.changeEpisodeRating({ closest: () => control }, null);
assert.equal(markCalls, 1);
assert(manager.currentEpisodeHistory['1:1'], 'removal preserves completion');

// Concurrent star clicks share one rating mutation and one watched write.
manager.currentEpisodeHistory = {};
let finishMark;
manager.episodeHistoryService.markCompleted = async () => {
    markCalls++;
    return new Promise(resolve => { finishMark = resolve; });
};
const rapid = manager.changeEpisodeRating({ closest: () => control }, 8);
await manager.changeEpisodeRating({ closest: () => control }, 10);
await Promise.resolve();
assert.equal(ratingWrites, 3, 'pending star clicks do not duplicate the transaction');
assert.equal(markCalls, 2);
finishMark({ '1:1': { cAt: 456 } });
await rapid;

manager.currentEpisodeHistory = {};
manager.episodeHistoryService.markCompleted = async () => { throw new Error('storage offline'); };
await manager.changeEpisodeRating({ closest: () => control }, 6);
assert.equal(manager.currentSeriesEpisodeRatings.episodes['1:1'].r, 6, 'watched failure does not roll back a saved score');
assert.equal(toastMessage, i18n.get('movie_details.series_episode_watched_error'));
const marksBeforeFuture = markCalls;
control.dataset.released = 'false';
await manager.changeEpisodeRating({ closest: () => control }, 9);
assert.equal(markCalls, marksBeforeFuture);
assert.equal(manager.currentSeriesEpisodeRatings.episodes['1:1'].r, 6);
control.dataset.released = 'true';
console.log('  ✅ Independent title ratings, personal badges and inline episode rating controls passed');

console.log('\n🎉 MovieDetails Rating + Seasons Refinement Tests Passed Successfully!\n');
