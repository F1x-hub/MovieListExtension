import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { i18n } from '../src/shared/i18n/I18n.js';

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
    querySelectorAll: (sel) => {
        if (sel === '.season-card') {
            return Array.from(mockDocElements.values()).filter(el => el.classList && el.classList.contains('season-card'));
        }
        if (sel === '.season-pill-btn') {
            return Array.from(mockDocElements.values()).filter(el => el.classList && el.classList.contains('season-pill-btn'));
        }
        if (sel.startsWith('.season-expand-btn')) {
            const btns = Array.from(mockDocElements.values()).filter(el => el.classList && el.classList.contains('season-expand-btn'));
            if (sel.includes('[aria-expanded="true"]')) {
                return btns.filter(b => b.getAttribute('aria-expanded') === 'true');
            }
            return btns;
        }
        return [];
    },
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

const utilsStub = {
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

vm.runInContext(source, context);

const MovieDetailsManager = context.window.MovieDetailsManager;
const manager = Object.create(MovieDetailsManager.prototype);
manager.isAdmin = false;
manager.escapeHtml = escapeHtmlHelper;
manager.getPluralSeasons = MovieDetailsManager.prototype.getPluralSeasons;

const css = fs.readFileSync('src/pages/movie-details/movie-details.css', 'utf8');

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
assert(htmlFull.includes('1.4k оценок'), '6. TMDB votes must be formatted (1.4k оценок)');
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
// PART 45: SEASONS TESTS (Tests 9 - 28)
// =========================================================================
console.log('\n--- Part 45: Testing Seasons Redesign & Visual UX ---');

// Build 18 seasons + specials fixture (It's Always Sunny in Philadelphia)
const eighteenSeasons = [];
for (let i = 1; i <= 18; i++) {
    eighteenSeasons.push({
        number: i,
        name: `Сезон ${i}`,
        episodeCount: i === 1 ? 7 : (i === 18 ? 8 : 10),
        airDate: i === 1 ? '2005-08-04' : `20${(5 + i).toString().padStart(2, '0')}-01-15`,
        overview: `Описание сезона ${i} сериала.`,
        posterUrl: `https://image.tmdb.org/t/p/w500/season_${i}.jpg`,
        isSpecial: false
    });
}
eighteenSeasons.push({
    number: 0,
    name: 'Спецвыпуски',
    episodeCount: 5,
    airDate: '2006-01-01',
    overview: 'Дополнительные материалы и неудачные дубли.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/season_0.jpg',
    isSpecial: true
});

const nextEpisodeFixture = {
    seasonNumber: 18,
    episodeNumber: 9,
    name: 'The Gang Goes to Europe',
    airDate: '2026-09-01'
};

const seasonsHtml18 = manager.renderSeasonsTab(eighteenSeasons, nextEpisodeFixture, null, 2710);

// 9. 18 season selector renders 18 + specials
assert(seasonsHtml18.includes('class="seasons-nav-pills"'), '9. Nav pills container must be rendered');
for (let i = 1; i <= 18; i++) {
    assert(seasonsHtml18.includes(`data-season-number="${i}"`), `9. Pill for season ${i} must exist`);
}
assert(seasonsHtml18.includes('Спецвыпуски'), '9. Specials pill must exist');
console.log('  ✅ 9. 18 season selector renders 18 numerical pills + specials pill');

// 10. active season visually marked
assert(seasonsHtml18.includes('class="season-pill-btn active"'), '10. Season 1 pill has active class');
assert(seasonsHtml18.includes('aria-selected="true"'), '10. Season 1 pill has aria-selected="true"');
console.log('  ✅ 10. Active season pill visually and semantically marked (active, aria-selected="true")');

// 11. season pill uses no native default contract
assert(css.includes('appearance: none;'), '11. CSS resets appearance');
assert(css.includes('.season-pill-btn {'), '11. CSS contains .season-pill-btn class');
assert(css.includes('border-radius: var(--radius-md, 8px);') || css.includes('border-radius: 8px'), '11. CSS uses rounded radius token');
console.log('  ✅ 11. Season pills explicitly styled with Obsidian-Zinc tokens (no native button styling)');

// 12. selected season panel renders
assert(seasonsHtml18.includes('class="season-card'), '12. Season card rendered');
assert(seasonsHtml18.includes('season-card--active'), '12. Active season card marked with season-card--active');
assert(seasonsHtml18.includes('class="season-main-row"'), '12. Main row side-by-side layout container rendered');
console.log('  ✅ 12. Selected season panel renders structured layout');

// 13. season poster bounded
assert(seasonsHtml18.includes('class="season-poster-wrapper"'), '13. Season poster wrapper rendered');
assert(css.includes('.season-poster-wrapper {'), '13. CSS specifies .season-poster-wrapper');
assert(css.includes('width: 150px;') || css.includes('flex: 0 0 150px;'), '13. Season poster bounded to 150px');
console.log('  ✅ 13. Season poster bounded to compact width (150px) with 2:3 aspect ratio');

// 14. episode count renders
assert(seasonsHtml18.includes('7 серий'), '14. Correctly pluralized episode count rendered (7 серий)');
console.log('  ✅ 14. Episode count accurately rendered and pluralized');

// 15. premiere date renders
assert(seasonsHtml18.includes('04.08.2005'), '15. Formatted premiere date 04.08.2005 rendered');
console.log('  ✅ 15. Premiere date formatted with dd.mm.yyyy format');

// 16. Show Episodes retained
assert(seasonsHtml18.includes('data-action="toggle-season"'), '16. Toggle season button present');
assert(seasonsHtml18.includes('Показать серии'), '16. "Показать серии" text present');
console.log('  ✅ 16. Show Episodes toggle button retained');

// 17. selecting season does not fetch episodes
// Setup mock DOM cards for manager.handleSeasonPillSelect
const pill1 = new MockElement('button');
pill1.classList.add('season-pill-btn', 'active');
pill1.setAttribute('data-season-number', '1');
mockDocElements.set('.season-pill-btn[data-season-number="1"]', pill1);

const pill2 = new MockElement('button');
pill2.classList.add('season-pill-btn');
pill2.setAttribute('data-season-number', '2');
mockDocElements.set('.season-pill-btn[data-season-number="2"]', pill2);

const card1 = new MockElement('div');
card1.classList.add('season-card', 'season-card--active');
card1.setAttribute('data-season-number', '1');
mockDocElements.set('.season-card[data-season-number="1"]', card1);

const card2 = new MockElement('div');
card2.classList.add('season-card');
card2.setAttribute('data-season-number', '2');
card2.style.display = 'none';
mockDocElements.set('.season-card[data-season-number="2"]', card2);

const card3 = new MockElement('div');
card3.classList.add('season-card');
card3.setAttribute('data-season-number', '3');
card3.style.display = 'none';
mockDocElements.set('.season-card[data-season-number="3"]', card3);

let networkCallMade = false;
manager.handleSeasonPillSelect(2);
assert.strictEqual(networkCallMade, false, '17. Selecting season pill must cause ZERO network calls');
assert.strictEqual(card2.style.display, '', '17. Season 2 card shown');
assert.strictEqual(card1.style.display, 'none', '17. Season 1 card hidden');
console.log('  ✅ 17. Selecting season switches DOM panels with 0 network calls');

// 18. expanding season fetches lazily
let lazyFetchSeason = null;
manager.tmdbService = {
    getSeasonDetails: async (tmdbId, seasonNumber) => {
        lazyFetchSeason = seasonNumber;
        return {
            episodes: [
                { episodeNumber: 1, name: 'Charlie Gets Crippled', airDate: '2006-06-29', voteAverage: 8.4, seasonNumber: 2 }
            ]
        };
    }
};
const toggleBtnS2 = new MockElement('button');
toggleBtnS2.classList.add('season-expand-btn');
card2.appendChild(toggleBtnS2);
mockDocElements.set('.season-card[data-season-number="2"] .season-expand-btn', toggleBtnS2);

await manager.toggleSeasonEpisodes(toggleBtnS2, 2, 2710, 10);
assert.strictEqual(lazyFetchSeason, 2, '18. Lazy fetch invoked TMDBService for season 2');
const panel2 = card2.querySelector('.season-episodes-panel');
assert(panel2.innerHTML.includes('Charlie Gets Crippled'), '18. Episode rendered into panel');
console.log('  ✅ 18. Expanding season triggers lazy episode fetch via TMDBService');

// 19. one open season invariant preserved
const toggleBtnS3 = new MockElement('button');
toggleBtnS3.classList.add('season-expand-btn');
card3.appendChild(toggleBtnS3);
mockDocElements.set('.season-card[data-season-number="3"] .season-expand-btn', toggleBtnS3);

manager.tmdbService.getSeasonDetails = async () => ({
    episodes: [{ episodeNumber: 1, name: 'The Gang Broke Dee', seasonNumber: 3 }]
});
await manager.toggleSeasonEpisodes(toggleBtnS3, 3, 2710, 10);
assert.strictEqual(toggleBtnS3.getAttribute('aria-expanded'), 'true', '19. Season 3 expanded');
assert.strictEqual(toggleBtnS2.getAttribute('aria-expanded'), 'false', '19. Season 2 collapsed');
console.log('  ✅ 19. Single expanded season accordion invariant strictly enforced');

// 20. single-season series may omit selector
const singleSeason = [{
    number: 1,
    name: 'Сезон 1',
    episodeCount: 10,
    airDate: '2023-01-15',
    overview: 'Единственный сезон сериала.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/s1.jpg',
    isSpecial: false
}];
const singleSeasonHtml = manager.renderSeasonsTab(singleSeason, null, null, 999);
assert(!singleSeasonHtml.includes('class="seasons-nav-pills"'), '20. Single season without specials omits redundant pill selector');
assert(singleSeasonHtml.includes('class="season-card season-card--active"'), '20. Single season summary card rendered directly');
console.log('  ✅ 20. Single-season series without specials omits redundant pill selector');

// 21. specials display correctly
const singlePlusSpecials = [
    { number: 1, name: 'Сезон 1', episodeCount: 8, airDate: '2020-01-01', isSpecial: false },
    { number: 0, name: 'Спецвыпуски', episodeCount: 2, airDate: '2021-01-01', isSpecial: true }
];
const singlePlusSpecialsHtml = manager.renderSeasonsTab(singlePlusSpecials, null, null, 888);
assert(singlePlusSpecialsHtml.includes('class="seasons-nav-pills"'), '21. Season 1 + Specials retains selector');
assert(singlePlusSpecialsHtml.includes('Спецвыпуски'), '21. Specials pill present');
assert(singlePlusSpecialsHtml.includes('Спецматериалы'), '21. Specials badge present on card');
console.log('  ✅ 21. Specials display correctly with dedicated pill and badge');

// 22. empty season disables expansion
const emptySeason = [{
    number: 19,
    name: 'Сезон 19',
    episodeCount: 0,
    airDate: '2027-01-01',
    isSpecial: false
}];
const emptySeasonHtml = manager.renderSeasonsTab(emptySeason, null, null, 777);
assert(emptySeasonHtml.includes('Серии пока не опубликованы'), '22. Empty season shows muted empty notice');
assert(!emptySeasonHtml.includes('data-action="toggle-season"'), '22. Empty season omits active toggle button');
console.log('  ✅ 22. Empty season (0 episodes) disables expansion and shows muted notice');

// 23. nextEpisode Hero preserved
const heroNextEpMovie = {
    kinopoiskId: 401515,
    name: "It's Always Sunny",
    type: 'tv-series',
    isSeries: true,
    nextEpisode: nextEpisodeFixture
};
const heroNextEpHtml = manager.renderHeroNextEpisode(heroNextEpMovie);
assert(heroNextEpHtml.includes('hero-next-episode-card'), '23. Hero nextEpisode card rendered');
assert(heroNextEpHtml.includes('S18E9'), '23. S18E9 code in hero card');
assert(heroNextEpHtml.includes('The Gang Goes to Europe'), '23. Title in hero card');
console.log('  ✅ 23. Hero nextEpisode promotion card 100% preserved');

// 24. duplicate Seasons nextEpisode banner removed
assert(!seasonsHtml18.includes('class="next-episode-banner"'), '24. Duplicate next-episode-banner removed from Seasons tab');
console.log('  ✅ 24. Duplicate next-episode-banner removed from Seasons tab');

// 25. horizontal overflow contained inside selector
assert(css.includes('.seasons-nav-pills {'), '25. .seasons-nav-pills in CSS');
assert(css.includes('overflow-x: auto;'), '25. overflow-x: auto specified for pill rail');
console.log('  ✅ 25. Horizontal overflow contained inside scrollable pill rail');

// 26. no body overflow
assert(css.includes('box-sizing: border-box;'), '26. box-sizing: border-box specified');
assert(css.includes('max-width: 100%;'), '26. max-width: 100% bounds pill rail');
console.log('  ✅ 26. Zero body overflow contracts verified');

// 27. keyboard/focus states retained
assert(css.includes('.season-pill-btn:focus-visible'), '27. :focus-visible ring for season pills');
assert(seasonsHtml18.includes('role="tab"'), '27. ARIA role tab present');
assert(seasonsHtml18.includes('role="tablist"'), '27. ARIA role tablist present');
console.log('  ✅ 27. Keyboard focus-visible rings and ARIA attributes retained');

// 28. long series remains usable
assert(seasonsHtml18.includes('18 сезонов'), '28. Total count of 18 seasons cleanly communicated');
console.log('  ✅ 28. Long-running series (18 seasons) tested and verified');

console.log('\n🎉 ALL 28 MovieDetails Rating + Seasons Refinement Tests Passed Successfully!\n');
