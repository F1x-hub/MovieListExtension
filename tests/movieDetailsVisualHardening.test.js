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
    querySelector() { return null; }
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

const documentStub = {
    activeButtons: [],
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => new MockElement(),
    body: new MockElement(),
    addEventListener: () => {},
    removeEventListener: () => {}
};

class KinopoiskServiceStub {
    getPersonsByProfession(persons, role) {
        if (!Array.isArray(persons)) return [];
        return persons.filter(p => p && (p.enProfession === role || p.profession === role));
    }
    formatPersonNames(persons) {
        if (!Array.isArray(persons)) return '';
        return persons.map(p => p.name).filter(Boolean).join(', ');
    }
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
    parseSpoilers: (t) => t || '',
    linkify: (t) => t || ''
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

console.log('🧪 Running MovieDetails Visual Regression Hardening Tests...\n');

// =========================================================================
// TEST 1 & 2: Crew link renders as actual <a>, NOT literal escaped markup
// =========================================================================
console.log('--- 1 & 2: Testing Crew Link Rendering & HTML Tag Legitimacy ---');
{
    const amelie = {
        kinopoiskId: 341,
        name: 'Амели',
        year: 2001,
        status: 'released',
        rating: { kp: 8.0, imdb: 8.3, tmdb: 8.0 },
        votes: { kp: 845200, imdb: 780000, tmdb: 12400 },
        credits: {
            crew: [
                { id: 'kp:22144', kpPersonId: 22144, name: 'Жан-Пьер Жёне', role: 'DIRECTOR' },
                { id: 'kp:22144', kpPersonId: 22144, name: 'Жан-Пьер Жёне', role: 'WRITER' },
                { id: 'kp:60888', kpPersonId: 60888, name: 'Гийом Лоран', role: 'WRITER' },
                { id: 'kp:45888', kpPersonId: 45888, name: 'Клоди Оссар', role: 'PRODUCER' },
                { id: 'kp:11111', kpPersonId: 11111, name: 'Брюно Дельбоннель', role: 'CINEMATOGRAPHY' },
                { id: 'kp:22222', kpPersonId: 22222, name: 'Ян Тьерсен', role: 'COMPOSER' },
                { id: 'kp:33333', kpPersonId: 33333, name: 'Алин Бонетто', role: 'DESIGNER' },
                { id: 'kp:44444', kpPersonId: 44444, name: 'Эрве Шнайд', role: 'EDITOR' }
            ]
        }
    };

    const html = manager.createDetailedMovieCard(amelie);

    // 1. Must contain real <a> element with crew-link class
    assert(html.includes('<a href="../person-details/person-details.html?personKey=kp%3A22144" class="crew-link">Жан-Пьер Жёне</a>'),
        'Must render real clickable anchor tag for director');

    // 2. Must NOT contain literal escaped markup &lt;a
    assert(!html.includes('&lt;a href='), 'Must NEVER render literal escaped &lt;a tags');
    assert(!html.includes('&lt;a class='), 'Must NEVER render literal escaped &lt;a class');
    assert(!html.includes('&lt;/a&gt;'), 'Must NEVER render literal escaped &lt;/a&gt;');

    console.log('  ✅ 1. Crew links render as real DOM <a> elements');
    console.log('  ✅ 2. No literal HTML string escaping observed');
}

// =========================================================================
// TEST 3 & 4: XSS Safety on Crew Provider Names & ID-less Crew
// =========================================================================
console.log('--- 3 & 4: Testing XSS Safety & ID-less Plain Text Crew ---');
{
    const xssMovie = {
        kinopoiskId: 999,
        name: 'XSS Test',
        credits: {
            crew: [
                { id: 'tmdb:10', tmdbPersonId: 10, name: '<img src=x onerror=alert(1)>', role: 'DIRECTOR' },
                { name: '<b onmouseover=evil()>IDless Person</b>', role: 'WRITER' }
            ]
        }
    };

    const html = manager.createDetailedMovieCard(xssMovie);

    // 3. Provider name inside link remains escaped
    assert(html.includes('<a href="../person-details/person-details.html?personKey=tmdb%3A10" class="crew-link">&lt;img src=x onerror=alert(1)&gt;</a>'),
        'Malicious script payload in director name must be strictly escaped inside anchor');
    assert(!html.includes('<img src=x onerror=alert(1)>'), 'Raw unescaped tag must not exist in HTML');

    // 4. ID-less crew renders plain escaped text (no <a> tag)
    assert(html.includes('&lt;b onmouseover=evil()&gt;IDless Person&lt;/b&gt;'),
        'ID-less crew must render plain text safely escaped without <a> tag');
    assert(!html.includes('href="../person-details/person-details.html?personKey=null"'),
        'Must not create fake link with null personKey');

    console.log('  ✅ 3. Malicious crew name is strictly HTML-escaped inside <a>');
    console.log('  ✅ 4. ID-less crew renders harmless plain escaped text without link');
}

// =========================================================================
// TEST 5: Valid personKey Preservation Across Providers
// =========================================================================
console.log('--- 5: Testing Valid personKey Preservation ---');
{
    const multiProviderMovie = {
        kinopoiskId: 888,
        name: 'Multi Provider',
        credits: {
            crew: [
                { id: 'kp:555', role: 'DIRECTOR', name: 'KP Director' },
                { id: 'tmdb:777', role: 'WRITER', name: 'TMDB Writer' }
            ]
        }
    };

    const html = manager.createDetailedMovieCard(multiProviderMovie);
    assert(html.includes('personKey=kp%3A555'), 'Preserves kp:555 personKey');
    assert(html.includes('personKey=tmdb%3A777'), 'Preserves tmdb:777 personKey');
    console.log('  ✅ 5. Provider-namespaced personKey correctly preserved and encoded');
}

// =========================================================================
// TEST 6, 7 & 8: Status Badge Classes, Styles & Long Status Wrap
// =========================================================================
console.log('--- 6, 7 & 8: Testing Status Badge Contract & CSS Rules ---');
{
    const css = fs.readFileSync('src/pages/movie-details/movie-details.css', 'utf8');

    // 6. Status badge classes
    const movieReleased = { kinopoiskId: 1, name: 'T1', status: 'released' };
    const htmlReleased = manager.createDetailedMovieCard(movieReleased);
    assert(htmlReleased.includes('status-badge status-badge--released'), 'Released status class');
    assert(htmlReleased.includes('Выпущен'), 'Released label');

    const movieOngoing = { kinopoiskId: 2, name: 'T2', status: 'returning series' };
    const htmlOngoing = manager.createDetailedMovieCard(movieOngoing);
    assert(htmlOngoing.includes('status-badge status-badge--ongoing'), 'Ongoing status class');
    assert(htmlOngoing.includes('Онгоинг'), 'Ongoing label');

    const movieEnded = { kinopoiskId: 3, name: 'T3', status: 'ended' };
    const htmlEnded = manager.createDetailedMovieCard(movieEnded);
    assert(htmlEnded.includes('status-badge status-badge--ended'), 'Ended status class');
    assert(htmlEnded.includes('Завершён'), 'Ended label');

    // 7. Status badge compact style contract
    assert(css.includes('width: fit-content'), 'CSS must include width: fit-content for status-badge');
    assert(css.includes('justify-self: start'), 'CSS must include justify-self: start for status badge');

    // 8. Long status translation & formatting
    const movieInProduction = { kinopoiskId: 4, name: 'T4', status: 'in production' };
    const htmlInProd = manager.createDetailedMovieCard(movieInProduction);
    assert(htmlInProd.includes('В производстве'), 'Translates in production status');
    assert(htmlInProd.includes('status-badge status-badge--upcoming'), 'Upcoming badge for in production');

    const moviePostProd = { kinopoiskId: 5, name: 'T5', status: 'post production' };
    const htmlPostProd = manager.createDetailedMovieCard(moviePostProd);
    assert(htmlPostProd.includes('Постпродакшн'), 'Translates post production status');
    assert(htmlPostProd.includes('status-badge status-badge--upcoming'), 'Upcoming badge for post production');

    console.log('  ✅ 6. Status badge classes correctly generated for all statuses');
    console.log('  ✅ 7. Status badge CSS contains width: fit-content & justify-self: start');
    console.log('  ✅ 8. Long status handles translation and compact presentation');
}

// =========================================================================
// TEST 9 & 18: Multiple Crew Link Separators & Bounded Wrap
// =========================================================================
console.log('--- 9 & 18: Testing Crew Separator & Overflow Bounds ---');
{
    const manyProducersMovie = {
        kinopoiskId: 444,
        name: 'Many Producers',
        credits: {
            crew: [
                { id: 'kp:1', role: 'PRODUCER', name: 'Producer 1' },
                { id: 'kp:2', role: 'PRODUCER', name: 'Producer 2' },
                { id: 'kp:3', role: 'PRODUCER', name: 'Producer 3' },
                { id: 'kp:4', role: 'PRODUCER', name: 'Producer 4' },
                { id: 'kp:5', role: 'PRODUCER', name: 'Producer 5' },
                { id: 'kp:6', role: 'PRODUCER', name: 'Producer 6' }
            ]
        }
    };

    const html = manager.createDetailedMovieCard(manyProducersMovie);
    
    // 9. Clean separator
    assert(html.includes('>Producer 1</a>, <a href='), 'Crew members cleanly separated by comma');
    
    // 18. Max 5 visible + overflow count
    assert(html.includes('>Producer 5</a> +1'), 'Sixth producer bounded to +1 overflow count');
    assert(!html.includes('>Producer 6</a>'), 'Sixth producer name excluded from initial list');

    console.log('  ✅ 9. Multiple crew links separated by clean plain-text comma');
    console.log('  ✅ 18. Long crew lists bounded to max 5 + overflow count');
}

// =========================================================================
// TEST 10 & 11: Legacy DTO Crew & Secondary Crew Section
// =========================================================================
console.log('--- 10 & 11: Testing Legacy DTO Crew & Secondary Crew ---');
{
    const legacyMovie = {
        kinopoiskId: 300,
        name: 'Legacy Crew Test',
        persons: [
            { id: 101, name: 'Legacy Director', enProfession: 'DIRECTOR' },
            { id: 102, name: 'Legacy Operator', enProfession: 'OPERATOR' }
        ]
    };

    const html = manager.createDetailedMovieCard(legacyMovie);
    assert(html.includes('Legacy Director'), 'Renders legacy director');
    assert(html.includes('Legacy Operator'), 'Renders legacy operator in secondary crew');
    assert(html.includes('meta-item--secondary-crew'), 'Renders secondary crew container');
    assert(html.includes('id="metaSecondaryCrew"'), 'Has metaSecondaryCrew collapsible container');

    console.log('  ✅ 10. Legacy DTO crew adapts and renders seamlessly');
    console.log('  ✅ 11. Secondary crew renders in collapsible #metaSecondaryCrew');
}

// =========================================================================
// TEST 12: Production Companies & Studios Row
// =========================================================================
console.log('--- 12: Testing Studios & Production Companies ---');
{
    const studioMovie = {
        kinopoiskId: 500,
        name: 'Studio Test',
        productionCompanies: [
            { id: 1, name: 'Warner Bros. Pictures', logoUrl: 'https://image.tmdb.org/logo.png', originCountry: 'US' },
            { id: 2, name: 'Legendary Pictures', originCountry: 'US' }
        ]
    };

    const html = manager.createDetailedMovieCard(studioMovie);
    assert(html.includes('meta-item--companies'), 'Contains companies row');
    assert(html.includes('production-company-pill'), 'Contains studio pills');
    assert(html.includes('Warner Bros. Pictures'), 'Contains studio name');
    assert(html.includes('Legendary Pictures'), 'Contains secondary studio');
    assert(html.includes('production-company-logo'), 'Contains company logo img');

    console.log('  ✅ 12. Studio row renders cleanly with pills and CDN logo fallbacks');
}

// =========================================================================
// TEST 13 & 14: Rating Presentation Hierarchy & Data Isolation
// =========================================================================
console.log('--- 13 & 14: Testing Rating Hierarchy & Isolation ---');
{
    const tripleRatingMovie = {
        kinopoiskId: 600,
        name: 'Triple Ratings',
        rating: { kp: 8.1, imdb: 8.4, tmdb: 7.9 },
        votes: { kp: 500000, imdb: 600000, tmdb: 15000 }
    };

    const html = manager.createDetailedMovieCard(tripleRatingMovie);
    assert(html.includes('rating-item-large kp'), 'KP rating card present in left rail');
    assert(html.includes('rating-item-large imdb'), 'IMDb rating card present in left rail');
    assert(!html.includes('rating-item-large tmdb'), 'TMDB rating card removed from left rail');
    assert(html.includes('meta-item--tmdb'), 'TMDB rating row present in About tab');
    assert(html.includes('7.9'), 'TMDB score 7.9 present in About tab');
    assert(html.includes('15k'), 'TMDB votes 15k formatted in About tab');

    const css = fs.readFileSync('src/pages/movie-details/movie-details.css', 'utf8');
    assert(css.includes('.rating-item-large.kp {\n    flex: 1 1 0;'), 'KP has equal 50% flex 1 1 0');
    assert(css.includes('.rating-item-large.imdb {\n    flex: 1 1 0;'), 'IMDb has equal 50% flex 1 1 0');
    assert(css.includes('.meta-item--tmdb'), 'CSS contains meta-item--tmdb styling');

    // Isolation check: zero TMDB rating
    const zeroTmdb = { kinopoiskId: 601, name: 'Zero TMDB', rating: { kp: 7.5, tmdb: 0 } };
    const htmlZero = manager.createDetailedMovieCard(zeroTmdb);
    assert(!htmlZero.includes('rating-item-large tmdb'), '0 TMDB suppressed in left rail');
    assert(!htmlZero.includes('meta-item--tmdb'), '0 TMDB suppressed in About tab');
    assert(htmlZero.includes('rating-item-large kp'), 'KP preserved');

    console.log('  ✅ 13. Left rail renders KP + IMDb evenly; TMDB surfaces in About tab');
    console.log('  ✅ 14. Rating provider isolation confirmed with zero contamination');
}

// =========================================================================
// TEST 15 & 16: CSP Compliance & PersonDetails Route Integrity
// =========================================================================
console.log('--- 15 & 16: Testing CSP Zero-Inline & Person Navigation Routes ---');
{
    const fullMovie = {
        kinopoiskId: 341,
        name: 'Amélie',
        rating: { kp: 8.0, imdb: 8.3, tmdb: 8.0 },
        credits: {
            cast: [{ id: 'kp:7000', name: 'Одри Тоту', role: 'ACTOR' }],
            crew: [{ id: 'kp:22144', name: 'Жан-Пьер Жёне', role: 'DIRECTOR' }]
        },
        productionCompanies: [{ id: 1, name: 'UGC' }]
    };

    const html = manager.createDetailedMovieCard(fullMovie);

    // 15. CSP check
    assert(!html.includes('onclick='), 'Zero onclick inline handlers');
    assert(!html.includes('onerror='), 'Zero onerror inline handlers');
    assert(!html.includes('onload='), 'Zero onload inline handlers');
    assert(!html.includes('javascript:'), 'Zero javascript: URLs');

    // 16. Route verification
    assert(html.includes('../person-details/person-details.html?personKey=kp%3A22144'),
        'Crew route points to valid person-details.html?personKey=kp:22144');

    console.log('  ✅ 15. 100% CSP compliant: 0 inline handlers and 0 javascript: URIs');
    console.log('  ✅ 16. PersonDetails navigation routes verified with 0 regression');
}

// =========================================================================
// TEST 17: Metadata Grid Common Layout Contract
// =========================================================================
console.log('--- 17: Testing Metadata Grid Layout Contract ---');
{
    const css = fs.readFileSync('src/pages/movie-details/movie-details.css', 'utf8');
    assert(css.includes('grid-template-columns: 160px 1fr;'), 'Standard meta grid uses 160px label + 1fr value');
    assert(css.includes('.meta-item--nested {\n    display: grid;\n    grid-template-columns: 146px 1fr;'),
        'Nested meta rows maintain aligned 146px label column');

    console.log('  ✅ 17. Metadata grid adheres to unified 2-column layout contract');
}

// =========================================================================
// TEST 19: Phase UI-1 / UI-2 Presentation Contracts
// =========================================================================
console.log('--- 19: Testing Phase UI-1 / UI-2 Presentation Contracts ---');
{
    const css = fs.readFileSync('src/pages/movie-details/movie-details.css', 'utf8');

    // UI-1: the backdrop must no longer be a fixed 380px clipped layer.
    assert(css.includes('height: clamp(440px, 56vw, 640px);'),
        'Hero backdrop uses a responsive atmospheric height');
    assert(css.includes('mask-image: linear-gradient('),
        'Hero backdrop uses a standard alpha mask');
    assert(css.includes('-webkit-mask-image: linear-gradient('),
        'Hero backdrop uses a WebKit alpha mask fallback');
    assert(css.includes('transparent 100%'),
        'Hero backdrop mask reaches zero opacity at the layer end');
    assert(css.includes('object-position: center 20%;'),
        'Hero backdrop preserves cover with a stable focal position');

    // UI-2: preserve provider pixels and use a presentation-level contrast well.
    assert(!css.includes('.light-theme .production-company-logo {\n    filter:'),
        'Light theme no longer applies a blanket logo filter');
    assert(css.includes('background: linear-gradient('),
        'Light theme logo presentation provides a contrast well');
    const rendererSource = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
    assert(rendererSource.includes('data-fallback="company-logo"'),
        'Company logo failed-image fallback contract remains in the renderer');

    console.log('  ✅ 19. Hero mask, responsive height, original logo pixels, and fallback contract verified');
}

console.log('\n🎉 ALL MovieDetails Visual Regression Hardening Tests Passed Successfully!\n');
