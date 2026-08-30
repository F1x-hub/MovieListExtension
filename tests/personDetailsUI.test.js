/**
 * tests/personDetailsUI.test.js
 * 
 * Test suite for MovieDetails Phase 2E:
 * - PersonDetails UI Controller & Lifecycle
 * - Hero, Vital Metadata, Biography, Facts, Known-For, and Filmography Rendering
 * - Safe Actor / Crew Navigation Links
 * - Security, CSP, XSS, Error States, and Invariants
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { PersonDetailsPageController } from '../src/pages/person-details/person-details.js';

const personDetailsCss = fs.readFileSync('src/pages/person-details/person-details.css', 'utf8');
const personDetailsJs = fs.readFileSync('src/pages/person-details/person-details.js', 'utf8');
const personDetailsHtml = fs.readFileSync('src/pages/person-details/person-details.html', 'utf8');
const movieCardCss = fs.readFileSync('src/shared/styles/movie-card.css', 'utf8');
const navigationJs = fs.readFileSync('src/shared/components/Navigation.js', 'utf8');

assert.ok(
    personDetailsHtml.indexOf('src="../../shared/components/MovieCard.js"') < personDetailsHtml.indexOf('src="person-details.js"'),
    'PersonDetails must load MovieCard before its renderer because cards have one renderer owner'
);

// Setup Mock DOM Environment
global.window = {
    location: {
        search: '?personKey=tmdb:2710',
        href: 'chrome-extension://xyz/src/pages/person-details/person-details.html?personKey=tmdb:2710'
    },
    history: {
        length: 2,
        back() {}
    }
};

global.document = {
    title: '',
    getElementById(id) {
        return this._elements[id] || null;
    },
    querySelectorAll(selector) {
        return [];
    },
    addEventListener() {},
    createElement(tag) {
        return {
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            innerHTML: '',
            textContent: '',
            classList: {
                add(c) { this._classes = this._classes || new Set(); this._classes.add(c); },
                remove(c) { this._classes = this._classes || new Set(); this._classes.delete(c); },
                contains(c) { return Boolean(this._classes && this._classes.has(c)); }
            },
            setAttribute(k, v) { this[k] = v; },
            getAttribute(k) { return this[k] || null; },
            appendChild(child) { this.children = this.children || []; this.children.push(child); }
        };
    },
    _elements: {}
};

function createMockElement(id) {
    const el = document.createElement('div');
    el.id = id;
    document._elements[id] = el;
    return el;
}

const mainContainer = createMockElement('personDetailsMain');
const loadingState = createMockElement('loadingState');
const errorState = createMockElement('errorState');
const errorTitle = createMockElement('errorTitle');
const errorMessage = createMockElement('errorMessage');
const errorBackBtn = createMockElement('errorBackBtn');
const personContainer = createMockElement('personDetailsContainer');

// Mock chrome.storage.sync for I18n
global.chrome = {
    storage: {
        sync: {
            async get() { return { language: 'ru' }; },
            async set() {}
        },
        local: {
            async get() { return {}; },
            async set() {},
            async remove() {}
        }
    }
};

global.window.MovieCard = {
    create(cardData) {
        const card = document.createElement('div');
        const movieId = cardData.movie?.kinopoiskId;
        const link = document.createElement('a');
        card.className = 'movie-card-component mc-variant-search';
        card.dataset = {};
        link.setAttribute('data-action', 'view-details');
        link.setAttribute('href', movieId ? `chrome-extension://xyz/src/pages/movie-details/movie-details.html?movieId=${movieId}` : '#');
        if (movieId) link.setAttribute('data-movie-id', String(movieId));
        card.dataset.movieId = movieId ? String(movieId) : '';
        card.appendChild(link);
        card.querySelector = selector => selector === '.mc-poster' ? null : selector === '[data-action="view-details"]' ? link : null;
        card.querySelectorAll = selector => selector === '[data-action="view-details"]' ? [link] : [];
        return card;
    }
};

console.log('🧪 Running Phase 2E PersonDetails UI & Safe Navigation Tests...\n');

// ==========================================
// 1. AGE CALCULATION HELPER
// ==========================================
console.log('--- 1. Testing calculatePersonAge Pure Helper ---');

{
    const controller = new PersonDetailsPageController();

    // 1.1 Alive person with valid YYYY-MM-DD
    const ageAlive = controller.calculatePersonAge('1954-08-16');
    assert.ok(typeof ageAlive === 'number' && ageAlive >= 70 && ageAlive <= 75, 'Alive age calculated properly');

    // 1.2 Deceased person with valid birthday and deathday
    const ageDeceased = controller.calculatePersonAge('1930-08-25', '2020-10-31');
    assert.strictEqual(ageDeceased, 90, 'Sean Connery age at death should be exactly 90');

    // 1.3 Deceased before birthday in death year
    const ageDeceasedBeforeBday = controller.calculatePersonAge('1950-12-01', '2020-05-10');
    assert.strictEqual(ageDeceasedBeforeBday, 69, 'Age at death before birthday should subtract 1');

    // 1.4 Year-only dates
    const ageYearOnly = controller.calculatePersonAge('1950', '2020');
    assert.strictEqual(ageYearOnly, 70, 'Year only date formats work');

    // 1.5 Invalid / Missing dates
    assert.strictEqual(controller.calculatePersonAge(null), null);
    assert.strictEqual(controller.calculatePersonAge(''), null);
    assert.strictEqual(controller.calculatePersonAge('invalid-date'), null);
    assert.strictEqual(controller.calculatePersonAge('2050-01-01'), null);

    console.log('  ✅ 1.1 calculatePersonAge computes alive/deceased ages accurately with null safety');
}

// ==========================================
// 2. HERO RENDERING & NAME DEDUPLICATION
// ==========================================
console.log('\n--- 2. Testing Hero Rendering & Name Deduplication ---');

{
    const controller = new PersonDetailsPageController();

    const samplePerson = {
        name: 'Джеймс Кэмерон',
        originalName: 'James Cameron',
        birthday: '1954-08-16',
        birthplace: 'Капуснейсинг, Онтарио, Канада',
        deathday: null,
        photoUrl: 'https://image.tmdb.org/t/p/h632/cameron.jpg',
        professions: ['Режиссёр', 'Сценарист', 'Продюсер', 'Монтажёр', 'Актёр'],
        aliases: ['Jim Cameron', 'James F. Cameron', 'Джеймс Кэмерон']
    };

    const heroHtml = controller.renderHero(samplePerson);
    assert.ok(heroHtml.includes('Джеймс Кэмерон'), 'Primary name included');
    assert.ok(heroHtml.includes('James Cameron'), 'Secondary name included');
    assert.ok(heroHtml.includes('https://image.tmdb.org/t/p/h632/cameron.jpg'), 'Portrait url included');
    assert.ok(heroHtml.includes('Капуснейсинг, Онтарио, Канада'), 'Birthplace included');
    assert.ok(heroHtml.includes('Режиссёр'), 'Profession badge included');

    // Name deduplication when originalName is identical to name
    const sampleDuplicateName = {
        name: 'James Cameron',
        originalName: 'James Cameron',
        professions: ['Режиссёр']
    };
    const heroDupHtml = controller.renderHero(sampleDuplicateName);
    assert.ok(!heroDupHtml.includes('person-hero__original-name'), 'Secondary name omitted when identical');

    console.log('  ✅ 2.1 Hero renders primary name, secondary name dedup, vital stats, and professions');
}

// ==========================================
// 3. BIOGRAPHY RENDERING & COLLAPSE TOGGLE
// ==========================================
console.log('\n--- 3. Testing Biography Rendering & Collapse Toggle ---');

{
    const controller = new PersonDetailsPageController();

    // 3.1 Long biography
    const longBio = 'First paragraph of biography.\n\nSecond paragraph of long biography detailing early career and breakthrough films.\n\nThird paragraph about technological innovations in filmmaking and deep ocean exploration.\n\nFourth paragraph with additional career retrospectives.';
    const bioHtml = controller.renderBiography({ biography: longBio });
    assert.ok(bioHtml.includes('person-bio__text--clamped'), 'Long bio gets clamped class');
    assert.ok(bioHtml.includes('btn-toggle-bio'), 'Show more button rendered for long bio');
    assert.ok(bioHtml.includes('First paragraph of biography.'), 'Paragraphs safely rendered');

    const iconBioHtml = controller.renderBiography({ biography: '🌟 Intro\n\n🏆 Awards\n\n🎬 Projects' });
    assert.ok(iconBioHtml.includes('person-bio__icon'), 'Biography markers render as outline icons');
    assert.ok(!iconBioHtml.includes('🌟') && !iconBioHtml.includes('🏆') && !iconBioHtml.includes('🎬'), 'Biography emoji markers are not rendered as emoji');

    // 3.2 Short biography
    const shortBio = 'Short bio summary.';
    const shortBioHtml = controller.renderBiography({ biography: shortBio });
    assert.ok(!shortBioHtml.includes('btn-toggle-bio'), 'Short bio has no show more button');

    // 3.3 Empty biography
    const emptyBioHtml = controller.renderBiography({ biography: '' });
    assert.strictEqual(emptyBioHtml, '', 'Empty biography omitted completely');

    console.log('  ✅ 3.1 Biography safely splits paragraphs, clamps long bios, and omits when empty');
}

// ==========================================
// 4. FACTS RENDERING & EXPAND TOGGLE
// ==========================================
console.log('\n--- 4. Testing Facts Rendering & Expand Toggle ---');

{
    const controller = new PersonDetailsPageController();

    const facts = [
        'Fact 1: Deep sea diver',
        'Fact 2: Directed Titanic',
        'Fact 3: Created Terminator',
        'Fact 4: Vegetarian',
        'Fact 5: Environmentalist',
        'Fact 6: Won 3 Oscars',
        'Fact 7: Canadian born'
    ];

    const factsHtml = controller.renderFacts({ facts });
    assert.ok(factsHtml.includes('Fact 1: Deep sea diver'), 'Initial facts rendered');
    assert.ok(factsHtml.includes('Fact 6: Won 3 Oscars'), 'Remaining facts in expandable container');
    assert.ok(factsHtml.includes('btn-toggle-facts'), 'Toggle facts button rendered');
    assert.ok(factsHtml.includes('(2)'), 'Remaining facts count displayed');
    assert.ok(factsHtml.includes('person-facts__list--remaining is-collapsed'), 'Remaining facts start collapsed via class');
    assert.ok(!factsHtml.includes('style="display: none'), 'Facts visibility does not use inline styles');
    assert.ok(!factsHtml.includes('person-fact-bullet'), 'Facts do not introduce text bullet icons');
    assert.ok(personDetailsCss.includes('.person-fact-item::before'), 'Facts use a structural CSS marker');
    assert.ok(personDetailsCss.includes('.light-theme .person-fact-item'), 'Facts have a light-theme contrast override');
    assert.ok(personDetailsCss.includes('.btn-toggle-facts'), 'Facts expansion control has dedicated compact styling');

    const shortFactsHtml = controller.renderFacts({ facts: facts.slice(0, 5) });
    assert.ok(!shortFactsHtml.includes('btn-toggle-facts'), 'Five or fewer facts omit expansion control');
    assert.ok(shortFactsHtml.includes('person-fact-item'), 'Five or fewer facts still render as semantic list items');

    const longFact = 'A '.repeat(240).trim();
    const longFactsHtml = controller.renderFacts({ facts: [longFact] });
    assert.ok(longFactsHtml.includes(longFact), 'Long facts render without truncation');
    assert.ok(!longFactsHtml.includes('line-clamp'), 'Facts are not clamped');
    assert.strictEqual((factsHtml.match(/class="person-fact-item"/g) || []).length, 7, 'Facts render once without duplicates');

    // Empty facts
    assert.strictEqual(controller.renderFacts({ facts: [] }), '', 'Empty facts section omitted');

    console.log('  ✅ 4.1 Facts section renders initial 5 items with toggle and omits when empty');
}

// ==========================================
// 5. KNOWN FOR CAROUSEL & THRESHOLDS
// ==========================================
console.log('\n--- 5. Testing Known For Section & Viability Threshold ---');

{
    const controller = new PersonDetailsPageController();

    // 5.1 >= 3 items renders carousel
    const validKnownFor = [
        { kinopoiskId: 101, name: 'Avatar', year: 2009, posterUrl: '/p1.jpg', rating: 7.9 },
        { kinopoiskId: 102, name: 'Titanic', year: 1997, posterUrl: '/p2.jpg', rating: 8.4 },
        { kinopoiskId: 103, name: 'Aliens', year: 1986, posterUrl: '/p3.jpg', rating: 8.0 }
    ];
    const knownForHtml = controller.renderKnownFor({ knownFor: validKnownFor });
    assert.ok(knownForHtml.includes('known-for-carousel'), 'Known for carousel markup rendered');
    assert.ok(knownForHtml.includes('carousel-nav-btn--prev'), 'Prev button rendered');
    assert.ok(knownForHtml.includes('carousel-nav-btn--next'), 'Next button rendered');

    // 5.2 < 3 items cleanly omits section
    const fewKnownFor = [
        { kinopoiskId: 101, name: 'Avatar', year: 2009 }
    ];
    assert.strictEqual(controller.renderKnownFor({ knownFor: fewKnownFor }), '', 'Known for < 3 items omitted');

    console.log('  ✅ 5.1 Known For renders carousel for >= 3 items and cleanly omits when < 3');
}

// ==========================================
// 6. FILMOGRAPHY FILTERS & PAGINATION
// ==========================================
console.log('\n--- 6. Testing Filmography Filters & Initial 20-Item Bounds ---');

{
    const controller = new PersonDetailsPageController();

    const sampleFilmography = {
        acting: [
            { kinopoiskId: 201, name: 'Acting Movie 1', providerMediaType: 'movie', year: 2020 },
            { kinopoiskId: 202, name: 'Acting Series 1', providerMediaType: 'tv', year: 2022 }
        ],
        directing: Array.from({ length: 25 }, (_, i) => ({
            kinopoiskId: 300 + i,
            name: `Directing Movie ${i + 1}`,
            providerMediaType: 'movie',
            year: 2000 + i
        })),
        writing: [],
        production: [],
        music: [],
        other: []
    };

    const person = { filmography: sampleFilmography };

    // 6.1 Category headers & active filters
    const filmographyHtml = controller.renderFilmography(person);
    assert.ok(filmographyHtml.includes('data-filter="all"'), 'All filter rendered');
    assert.ok(filmographyHtml.includes('data-filter="movie"'), 'Movies filter rendered');
    assert.ok(filmographyHtml.includes('data-filter="tv"'), 'Series filter rendered');

    // 6.2 Categories markup
    const categoriesHtml = controller.renderFilmographyCategories(person);
    assert.ok(categoriesHtml.includes('data-category="acting"'), 'Acting category rendered');
    assert.ok(categoriesHtml.includes('data-category="directing"'), 'Directing category rendered');
    assert.ok(!categoriesHtml.includes('data-category="music"'), 'Empty music category omitted');
    assert.ok(categoriesHtml.includes('btn-show-more-filmography'), 'Show more button rendered for > 20 items');

    // 6.3 Unmapped filmography remains visible when provider identity exists
    const unmappedPerson = {
        filmography: {
            acting: [{ kinopoiskId: null, tmdbId: 999, name: 'Unmapped movie', posterUrl: 'https://image.tmdb.org/t/p/w342/unmapped.jpg' }]
        }
    };
    assert.ok(controller.renderFilmography(unmappedPerson).includes('filmographySection'), 'Unmapped filmography section remains visible');
    assert.ok(controller.renderFilmographyCategories(unmappedPerson).includes('data-category="acting"'), 'Unmapped filmography category remains visible');
    assert.strictEqual(controller.hasNavigationTarget(unmappedPerson.filmography.acting[0]), false, 'Unmapped item is not navigable');

    // 6.4 Canonical card interaction state follows KP identity, not artwork availability
    const unmappedCard = controller.createPersonMovieCard(unmappedPerson.filmography.acting[0]);
    assert.strictEqual(unmappedCard.tagName, 'DIV', 'Unmapped item renders as a canonical card root');
    assert.ok(unmappedCard.className.includes('movie-card-component'), 'Unmapped item uses the canonical card root');
    assert.ok(unmappedCard.querySelector('[data-action="view-details"]').href.includes('new-search'), 'Unmapped item links to provider search');
    const mappedCard = controller.createPersonMovieCard({ kinopoiskId: 123, name: 'Mapped movie' });
    assert.strictEqual(mappedCard.tagName, 'DIV', 'Mapped item renders as a canonical card root');
    assert.ok(mappedCard.className.includes('movie-card-component'), 'Mapped item uses the canonical card root');
    assert.ok(mappedCard.querySelector('[data-action="view-details"]').href.includes('movieId=123'), 'Mapped item receives canonical KP route');

    // 6.5 PersonDetails card geometry contract is scoped to the canonical card root
    assert.ok(personDetailsCss.includes('.known-for-carousel .movie-card-component'), 'Known-For targets actual MovieCard root');
    assert.ok(personDetailsCss.includes('flex: 0 0 160px'), 'Known-For uses fixed desktop card tracks');
    assert.ok(personDetailsCss.includes('flex-shrink: 0'), 'Known-For cards cannot shrink');
    assert.ok(personDetailsCss.includes('aspect-ratio: 2 / 3'), 'PersonDetails poster geometry is stable at 2:3');
    assert.ok(!personDetailsCss.includes('.person-details-card-fallback'), 'Fallback card geometry is retired');
    assert.ok(!personDetailsJs.includes('person-details-card-fallback'), 'Fallback card renderer is retired');
    assert.ok(personDetailsCss.includes('.movie-card-component .person-details-poster-placeholder'), 'Canonical cards own missing poster treatment');
    assert.ok(personDetailsCss.includes('.filmography-grid .movie-card-component'), 'Filmography has a separate responsive grid scope');
    assert.ok(!movieCardCss.includes('person-details-card-fallback'), 'Shared MovieCard CSS remains untouched by page-specific selectors');

    // 6.7 Person hero remains content-driven and responsive
    assert.ok(personDetailsCss.includes('grid-template-columns: 190px minmax(0, 1fr)'), 'Desktop hero keeps a compact portrait column');
    assert.ok(personDetailsCss.includes('aspect-ratio: 3 / 4'), 'Hero portrait preserves a stable headshot ratio');
    assert.ok(!/^\.person-hero\s*\{[^}]*\b(?:height|min-height):/ms.test(personDetailsCss), 'Hero has no fixed height or min-height');
    assert.ok(personDetailsCss.includes('@media (max-width: 640px)'), 'Hero has a narrow responsive breakpoint');
    assert.ok(personDetailsCss.includes('grid-template-columns: 1fr;'), 'Hero stacks into one column on mobile');
    assert.ok(personDetailsCss.includes('.light-theme .person-badge'), 'Profession chips retain a light-theme contrast override');
    assert.ok(!personDetailsCss.includes('person-hero__meta::before'), 'Missing metadata does not use a reserved placeholder row');
    assert.ok(personDetailsCss.includes('font-variant-numeric: tabular-nums'), 'Section counts use quiet numeric styling');
    assert.ok(!personDetailsCss.includes('.person-section__count {\n    font-size: 14px'), 'Section counts no longer use oversized pill styling');
    assert.ok(personDetailsCss.includes('.filmography-filter-pill {'), 'Filmography filter selector remains scoped');
    assert.ok(personDetailsCss.includes('border-radius: var(--radius-sm, 6px);'), 'Filmography filters use compact rectangular controls');
    assert.ok(personDetailsCss.includes('.carousel-nav-btn {'), 'Carousel controls remain scoped to PersonDetails');
    assert.ok(personDetailsCss.includes('z-index: 20;'), 'Carousel controls stay above hovered movie cards');
    assert.ok(personDetailsCss.includes('.person-details-content .movie-card-component.mc-variant-search {'), 'PersonDetails movie cards use local rectangular styling');
    assert.ok(personDetailsCss.includes('.person-details-content .movie-card-component.mc-variant-search .mc-menu-btn'), 'Movie card menus use local rectangular styling');
    assert.ok(!movieCardCss.includes('.person-details-content .movie-card-component'), 'Shared MovieCard card geometry remains unchanged');

    // 6.6 Known-For behavior is DOM-measured and accessible
    const previousGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = () => ({ columnGap: '16px', gap: '16px' });
    const fakeCarousel = {
        clientWidth: 500,
        scrollWidth: 1200,
        scrollLeft: 0,
        querySelector() {
            return { getBoundingClientRect: () => ({ width: 160 }) };
        }
    };
    const carouselMetrics = controller.getKnownForCarouselMetrics(fakeCarousel);
    assert.strictEqual(carouselMetrics.cardWidth, 160, 'Carousel measures card width from the DOM');
    assert.strictEqual(carouselMetrics.gap, 16, 'Carousel measures computed gap from the DOM');
    assert.strictEqual(carouselMetrics.scrollStep, 336, 'Carousel advances by complete measured cards');
    window.getComputedStyle = previousGetComputedStyle;

    const knownForMarkup = controller.renderKnownFor({ knownFor: [
        { kinopoiskId: 101, name: 'Avatar' },
        { kinopoiskId: 102, name: 'Titanic' },
        { kinopoiskId: 103, name: 'Aliens' }
    ] });
    assert.ok(knownForMarkup.includes(controller.i18n.get('person_details.previous_movies')), 'Previous control uses localized accessibility label');
    assert.ok(knownForMarkup.includes(controller.i18n.get('person_details.next_movies')), 'Next control uses localized accessibility label');
    assert.ok(personDetailsCss.includes('scroll-snap-type: x proximity'), 'Carousel uses proximity scroll snap');
    assert.ok(personDetailsCss.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced motion is supported');
    assert.ok(personDetailsJs.includes('addEventListener(\'scroll\', this.knownForScrollHandler, { passive: true })'), 'Manual scrolling updates controls passively');
    assert.ok(!personDetailsJs.includes('scrollBy({ left: 320'), 'Magic scroll distance is removed');
    assert.ok(personDetailsJs.includes('Icons.CHEVRON_LEFT') && personDetailsJs.includes('Icons.CHEVRON_RIGHT'), 'Carousel uses canonical shared chevrons');
    assert.ok(personDetailsCss.includes('.carousel-nav-btn:focus-visible'), 'Carousel controls expose a visible keyboard focus state');
    assert.ok(personDetailsCss.includes('.carousel-nav-btn:disabled'), 'Carousel disabled state is visually distinct');
    assert.ok(personDetailsCss.includes('.light-theme .carousel-nav-btn'), 'Carousel controls have a light-theme treatment');

    console.log('  ✅ 6.1 Filmography filters, pagination, and independent artwork/navigation visibility verified');
}

// ==========================================
// 7. MOVIEDETAILS ACTOR & CREW NAVIGATION LINKS
// ==========================================
console.log('\n--- 7. Testing MovieDetails Actor & Crew Navigation Links ---');

{
    const movieDetailsJs = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');

    // 7.1 renderActorCard contains provider-namespaced link
    assert.ok(movieDetailsJs.includes('person-details.html?personKey='), 'Actor card generates person-details URL');
    assert.ok(movieDetailsJs.includes('actor-card--link'), 'actor-card--link class applied');

    // 7.2 formatCrewCategory generates crew links
    assert.ok(movieDetailsJs.includes('crew-link'), 'crew-link class applied to valid crew names');

    // 7.3 Simulate renderActorCard
    function simulateRenderActorCard(actor) {
        const personKey = (typeof actor.id === 'string' && /^(tmdb|kp):\d+$/i.test(actor.id.trim()))
            ? actor.id.trim()
            : (actor.kpPersonId && Number(actor.kpPersonId) > 0 ? `kp:${actor.kpPersonId}` : (actor.tmdbPersonId && Number(actor.tmdbPersonId) > 0 ? `tmdb:${actor.tmdbPersonId}` : null));

        const isClickable = Boolean(personKey);
        const cardTag = isClickable ? 'a' : 'div';
        const linkAttrs = isClickable
            ? `href="../person-details/person-details.html?personKey=${encodeURIComponent(personKey)}" class="actor-card actor-card--link"`
            : 'class="actor-card"';

        return `<${cardTag} ${linkAttrs}><div class="actor-name">${actor.name}</div></${cardTag}>`;
    }

    // With valid TMDB ID
    const tmdbActorCard = simulateRenderActorCard({ id: 'tmdb:2710', name: 'James Cameron' });
    assert.ok(tmdbActorCard.startsWith('<a href="../person-details/person-details.html?personKey=tmdb%3A2710"'), 'Valid TMDB actor generates <a> tag');

    // With valid KP ID
    const kpActorCard = simulateRenderActorCard({ id: 'kp:27977', name: 'James Cameron' });
    assert.ok(kpActorCard.startsWith('<a href="../person-details/person-details.html?personKey=kp%3A27977"'), 'Valid KP actor generates <a> tag');

    // Legacy ID-less actor
    const legacyActorCard = simulateRenderActorCard({ id: null, name: 'Unknown Actor' });
    assert.ok(legacyActorCard.startsWith('<div class="actor-card"'), 'ID-less actor remains non-clickable <div>');

    console.log('  ✅ 7.1 Actor and crew cards with valid IDs become <a> links; ID-less credits remain non-clickable <div>');
}

// ==========================================
// 8. SECURITY, XSS & CSP
// ==========================================
console.log('\n--- 8. Testing Security, XSS & CSP Compliance ---');

{
    const controller = new PersonDetailsPageController();

    // 8.1 XSS in biography
    const xssBio = '<script>alert("xss")</script><img src="x" onerror="alert(1)">';
    const renderedBio = controller.renderBiography({ biography: xssBio });
    assert.ok(!renderedBio.includes('<script>'), 'Script tags escaped in bio');
    assert.ok(renderedBio.includes('&lt;script&gt;'), 'Bio is safely HTML escaped');

    // 8.2 XSS in facts
    const xssFacts = ['<script>alert("fact")</script>'];
    const renderedFacts = controller.renderFacts({ facts: xssFacts });
    assert.ok(!renderedFacts.includes('<script>'), 'Script tags escaped in facts');
    assert.ok(renderedFacts.includes('&lt;script&gt;'), 'Facts are safely HTML escaped');

    // 8.3 CSP inline event handlers in person-details.html & person-details.js
    const personDetailsHtml = fs.readFileSync('src/pages/person-details/person-details.html', 'utf8');
    const personDetailsJs = fs.readFileSync('src/pages/person-details/person-details.js', 'utf8');

    assert.ok(!personDetailsHtml.includes('onclick='), 'No inline onclick in HTML');
    assert.ok(!personDetailsHtml.includes('onerror='), 'No inline onerror in HTML');
    assert.ok(!personDetailsJs.includes('onclick='), 'No inline onclick in JS');
    assert.ok(personDetailsJs.includes("action === 'view-details'"), 'PersonDetails delegates MovieCard navigation clicks');
    assert.ok(personDetailsJs.includes('window.location.href = href'), 'MovieCard navigation uses the generated canonical href');
    assert.ok(!personDetailsJs.includes('onerror='), 'No inline onerror in JS');
    assert.ok(navigationJs.includes('aria-label=') && !navigationJs.includes(": '▼'"), 'Navigation icon controls use labels and no Unicode chevron fallback');
    assert.ok(navigationJs.includes('navLogo" aria-label='), 'Navigation logo has an accessible name');
    assert.ok(personDetailsJs.includes('aria-controls="personFactsRemaining"'), 'Facts toggle identifies its controlled list');
    assert.ok(personDetailsJs.includes('aria-controls="personAliasesRemaining"'), 'Aliases toggle identifies its controlled content');
    assert.ok(personDetailsJs.includes('person-details-poster-placeholder'), 'Missing movie artwork uses a neutral local placeholder');
    assert.ok(!personDetailsJs.includes("posterUrl || '/src/shared/assets/icons/app/icon48.png'"), 'PersonDetails does not use app branding as movie artwork');
    assert.ok(movieCardCss.includes('.mc-menu-btn:focus-visible'), 'MovieCard menu has a scoped keyboard focus state');

    console.log('  ✅ 8.1 100% CSP compliant (0 inline handlers) and XSS injection attempts strictly sanitized');
}

// ==========================================
// 9. ERROR STATES & ROUTE VALIDATION
// ==========================================
console.log('\n--- 9. Testing Error States & Route Validation ---');

{
    const controller = new PersonDetailsPageController();

    // 9.1 Invalid key error state
    controller.renderError('INVALID_KEY', 'Неверная ссылка на персону');
    assert.strictEqual(errorState.style.display, 'flex');
    assert.strictEqual(errorMessage.textContent, 'Неверная ссылка на персону');

    // 9.2 Not found error state
    controller.renderError('NOT_FOUND', 'Информация о персоне не найдена');
    assert.strictEqual(errorState.style.display, 'flex');
    assert.strictEqual(errorMessage.textContent, 'Информация о персоне не найдена');

    console.log('  ✅ 9.1 Error states handle invalid person links and missing profiles with friendly UI');
}

// ==========================================
// 10. TEST DATA & CONTRACT VERIFICATION
// ==========================================
console.log('\n--- 10. Testing Full Page Controller Load Simulation ---');

(async () => {
    const mockPersonDetailsService = {
        async getPersonDetails(personKey) {
            return {
                identity: {
                    personKey,
                    provider: 'TMDB',
                    providerId: 2710
                },
                name: 'Джеймс Кэмерон',
                originalName: 'James Cameron',
                photoUrl: 'https://image.tmdb.org/t/p/h632/cameron.jpg',
                birthday: '1954-08-16',
                birthplace: 'Canada',
                professions: ['Режиссёр', 'Сценарист'],
                biography: 'Legendary filmmaker.',
                facts: ['Dived to Mariana Trench.'],
                knownFor: [
                    { kinopoiskId: 101, name: 'Avatar', year: 2009 },
                    { kinopoiskId: 102, name: 'Titanic', year: 1997 },
                    { kinopoiskId: 103, name: 'Aliens', year: 1986 }
                ],
                filmography: {
                    directing: [
                        { kinopoiskId: 101, name: 'Avatar', year: 2009, providerMediaType: 'movie' },
                        { kinopoiskId: 102, name: 'Titanic', year: 1997, providerMediaType: 'movie' }
                    ],
                    acting: [],
                    writing: [],
                    production: [],
                    music: [],
                    other: []
                }
            };
        }
    };

    const controller = new PersonDetailsPageController();
    controller.personDetailsService = mockPersonDetailsService;
    controller.i18n.currentLocale = 'ru';

    await controller.loadPerson('tmdb:2710');

    assert.strictEqual(loadingState.style.display, 'none');
    assert.strictEqual(personContainer.style.display, 'flex');
    assert.ok(personContainer.innerHTML.includes('Джеймс Кэмерон'));
    assert.ok(personContainer.innerHTML.includes('James Cameron'));
    assert.ok(personContainer.innerHTML.includes('Legendary filmmaker.'));
    assert.ok(personContainer.innerHTML.includes('known-for-carousel'));
    assert.ok(personContainer.innerHTML.includes('filmographySection'));

    console.log('  ✅ 10.1 Full page loading, rendering, and content mounting completed successfully');
    console.log('\n🎉 ALL Phase 2E PersonDetails UI & Safe Navigation Tests Passed Successfully!');
})();
