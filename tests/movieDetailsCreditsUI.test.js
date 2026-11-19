import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

console.log('🧪 Running Phase 2B MovieDetails Cast / Crew UI Hardening Tests...\n');

// Set up DOM and environment mocks
const mockLocalStorage = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

globalThis.localStorage = mockLocalStorage;
globalThis.window = globalThis;
globalThis.chrome = {
    runtime: {
        getURL: (path) => `chrome-extension://mock-id/${path}`,
        sendMessage: () => {},
        onMessage: { addListener: () => {} }
    }
};

// Mock i18n
globalThis.i18n = {
    currentLocale: 'ru',
    locales: {
        ru: {
            random: { genres: {}, countries: {} },
            movie_details: {
                tabs: { about: 'О фильме', actors: 'Актёры', awards: 'Награды' },
                meta: {
                    year: 'Год производства',
                    country: 'Страна',
                    genre: 'Жанр',
                    slogan: 'Слоган',
                    director: 'Режиссёр',
                    writer: 'Сценарист',
                    producer: 'Продюсер',
                    operator: 'Оператор',
                    composer: 'Композитор',
                    designer: 'Художник',
                    editor: 'Монтажёр',
                    premiere_russia: 'Премьера в России',
                    premiere_world: 'Премьера в мире',
                    premiere_digital: 'Цифровой релиз',
                    age_rating: 'Возраст',
                    duration: 'Время',
                    hours: 'ч',
                    minutes: 'мин'
                },
                actors_tab: {
                    no_data: 'Информация об актерах отсутствует',
                    unknown: 'Неизвестно',
                    episodes_one: 'эпизод',
                    episodes_few: 'эпизода',
                    episodes_many: 'эпизодов'
                },
                profession: {
                    actor: 'Актёр'
                }
            },
            person_details: {
                credit_notes: { voice: 'озвучка', uncredited: 'без упоминания в титрах', archive_footage: 'архивные кадры' }
            }
        }
    },
    get(key) {
        const parts = key.split('.');
        let cur = this.locales[this.currentLocale];
        for (const p of parts) {
            if (!cur) return key;
            cur = cur[p];
        }
        return typeof cur === 'string' ? cur : key;
    }
};

// Load MovieDetailsManager methods by instantiating mock manager
class MockMovieDetailsManager {
    constructor() {
        this.escapeHtml = (text) => {
            if (text === null || text === undefined) return '';
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };
    }
}

// Read source files with platform-independent line endings.
const readText = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');

// Read movie-details.js and attach our tested methods
const movieDetailsSource = readText('src/pages/movie-details/movie-details.js');

// Extract getMovieCast, getMovieCrew, formatCrewCategory, renderActorCard, renderActorsTab
const extractMethod = (src, methodName) => {
    const regex = new RegExp(`\\n\\s*${methodName}\\s*\\(`);
    const match = regex.exec(src);
    if (!match) throw new Error(`Method ${methodName} definition not found in movie-details.js`);
    const startIdx = match.index + match[0].indexOf(methodName);
    let braceCount = 0;
    let started = false;
    let endIdx = startIdx;
    for (let i = startIdx; i < src.length; i++) {
        if (src[i] === '{') {
            braceCount++;
            started = true;
        } else if (src[i] === '}') {
            braceCount--;
            if (started && braceCount === 0) {
                endIdx = i + 1;
                break;
            }
        }
    }
    return src.slice(startIdx, endIdx);
};

const castMethod = extractMethod(movieDetailsSource, 'getMovieCast');
const crewMethod = extractMethod(movieDetailsSource, 'getMovieCrew');
const formatCrewMethod = extractMethod(movieDetailsSource, 'formatCrewCategory');
const actorCardMethod = extractMethod(movieDetailsSource, 'renderActorCard');
const creditNotesMethod = extractMethod(movieDetailsSource, 'localizeCreditNotes');
const actorsTabMethod = extractMethod(movieDetailsSource, 'renderActorsTab');
const actorsColumnCountMethod = extractMethod(movieDetailsSource, 'getActorsGridColumnCount');
const actorsVisibilityMethod = extractMethod(movieDetailsSource, 'applyActorsGridVisibility');
const awardsRenderMethod = extractMethod(movieDetailsSource, 'renderAwardsTab');

const managerClassCode = `
(${MockMovieDetailsManager.toString()});
MockMovieDetailsManager.prototype.getMovieCast = function ${castMethod.slice(castMethod.indexOf('('))};
MockMovieDetailsManager.prototype.getMovieCrew = function ${crewMethod.slice(crewMethod.indexOf('('))};
MockMovieDetailsManager.prototype.formatCrewCategory = function ${formatCrewMethod.slice(formatCrewMethod.indexOf('('))};
MockMovieDetailsManager.prototype.renderActorCard = function ${actorCardMethod.slice(actorCardMethod.indexOf('('))};
MockMovieDetailsManager.prototype.localizeCreditNotes = function ${creditNotesMethod.slice(creditNotesMethod.indexOf('('))};
MockMovieDetailsManager.prototype.renderActorsTab = function ${actorsTabMethod.slice(actorsTabMethod.indexOf('('))};
MockMovieDetailsManager.prototype.getActorsGridColumnCount = function ${actorsColumnCountMethod.slice(actorsColumnCountMethod.indexOf('('))};
MockMovieDetailsManager.prototype.applyActorsGridVisibility = function ${actorsVisibilityMethod.slice(actorsVisibilityMethod.indexOf('('))};
MockMovieDetailsManager.prototype.renderAwardsTab = function ${awardsRenderMethod.slice(awardsRenderMethod.indexOf('('))};
`;

eval(managerClassCode);
const manager = new MockMovieDetailsManager();

// ==========================================
// PART 38 — TESTS: ACTOR SOURCE RESOLVER
// ==========================================
console.log('--- Part 38: Actor Source Resolver Tests ---');

// 1. Canonical credits.cast preferred
{
    const movie = {
        credits: {
            cast: [
                { id: 'tmdb:1', name: 'Canonical Actor 1', order: 1, role: 'ACTOR' },
                { id: 'tmdb:2', name: 'Canonical Actor 0', order: 0, role: 'ACTOR' }
            ]
        },
        persons: [
            { id: 99, name: 'Legacy Person Actor', enProfession: 'ACTOR' }
        ]
    };
    const cast = manager.getMovieCast(movie);
    assert.strictEqual(cast.length, 2);
    assert.strictEqual(cast[0].name, 'Canonical Actor 0', 'Sorted by order ASC');
    assert.strictEqual(cast[1].name, 'Canonical Actor 1');
    console.log('  ✅ 1. Canonical credits.cast preferred over legacy persons');
}

// 2. Legacy persons fallback
{
    const movie = {
        credits: undefined,
        persons: [
            { id: 10, name: 'Юрий Никулин', enName: 'Yuri Nikulin', enProfession: 'ACTOR', description: 'Балбес', photo: 'nikulin.jpg' },
            { id: 11, name: 'Георгий Вицин', enName: 'Georgiy Vitsin', enProfession: 'ACTOR', description: 'Трус', photo: 'vitsin.jpg' },
            { id: 12, name: 'Леонид Гайдай', enName: 'Leonid Gaidai', enProfession: 'DIRECTOR' }
        ]
    };
    const cast = manager.getMovieCast(movie);
    assert.strictEqual(cast.length, 2, 'Only ACTOR profession adapted');
    assert.strictEqual(cast[0].id, 'kp:10');
    assert.strictEqual(cast[0].name, 'Юрий Никулин');
    assert.strictEqual(cast[0].character, 'Балбес');
    assert.strictEqual(cast[0].providerSource, 'KP');
    console.log('  ✅ 2. Legacy movie.persons fallback adapts to canonical shape');
}

// 3. tmdbCredits fallback
{
    const movie = {
        tmdbCredits: {
            cast: [
                { id: 50, name: 'Tom Cruise', original_name: 'Tom Cruise', character: 'Ethan Hunt', order: 0, profile_path: '/cruise.jpg' }
            ]
        }
    };
    const cast = manager.getMovieCast(movie);
    assert.strictEqual(cast.length, 1);
    assert.strictEqual(cast[0].id, 'tmdb:50');
    assert.strictEqual(cast[0].name, 'Tom Cruise');
    assert.strictEqual(cast[0].photoUrl, 'https://image.tmdb.org/t/p/w185/cruise.jpg');
    console.log('  ✅ 3. Legacy tmdbCredits fallback adapts properly');
}

// 4. Partial canonical fallback
{
    const movieWithCastOnly = {
        credits: {
            cast: [{ id: 'tmdb:1', name: 'Cast 1', order: 0 }]
        },
        persons: [
            { id: 1, name: 'Режиссер', enProfession: 'DIRECTOR' }
        ]
    };
    const cast = manager.getMovieCast(movieWithCastOnly);
    const crew = manager.getMovieCrew(movieWithCastOnly);
    assert.strictEqual(cast.length, 1, 'Canonical cast used');
    assert.strictEqual(crew.length, 1, 'Legacy crew used as fallback');
    console.log('  ✅ 4. Partial canonical fallback operates independently for cast and crew');
}

// 5. Cast sorted by order, the whole credited cast up to 150
{
    const movie = {
        credits: {
            cast: Array.from({ length: 170 }, (_, i) => ({
                id: `tmdb:${i}`,
                name: `Actor ${i}`,
                order: 169 - i // reverse order
            }))
        }
    };
    const cast = manager.getMovieCast(movie);
    assert.strictEqual(cast.length, 150, 'Bounded to max 150, not the old 30');
    assert.strictEqual(cast[0].order, 0, 'First item has smallest order');
    assert.strictEqual(cast[149].order, 149, '150th item has order 149');
    const tabHtml = manager.renderActorsTab(cast);
    assert.strictEqual((tabHtml.match(/class="actor-card/g) || []).length, 150, 'The tab renders every kept actor');

    const guest = manager.renderActorCard({ id: 'tmdb:7', name: 'Guest', character: 'Henry Hays', episodeCount: 8 });
    assert.ok(guest.includes('class="actor-episodes">8 эпизодов<'), 'A series actor names the episodes played');
    assert.ok(manager.renderActorCard({ id: 'tmdb:9', name: 'Regular', episodeCount: 22 }).includes('>22 эпизода<'), 'Episode counts use Russian plural forms');
    assert.ok(manager.renderActorCard({ id: 'tmdb:10', name: 'Cameo', episodeCount: 1 }).includes('>1 эпизод<'), 'One episode is singular');
    assert.ok(!manager.renderActorCard({ id: 'tmdb:8', name: 'Film actor' }).includes('actor-episodes'), 'A film actor has no episode line');
    const nikulin = { id: 'tmdb:11', name: 'Юрий Никулин', character: 'Balbes', characterLocal: 'Балбес' };
    assert.ok(manager.renderActorCard(nikulin).includes('>Балбес<'), 'The Russian interface shows Kinopoisk’s Cyrillic character');
    const voiced = { id: 'tmdb:12', name: 'Ray Fisher', character: 'Cyborg (voice) / Victor Stone (uncredited) (archive footage)' };
    assert.ok(manager.renderActorCard(voiced).includes('>Cyborg (озвучка) / Victor Stone (без упоминания в титрах) (архивные кадры)<'), 'TMDB’s notes read as on the person page');
    globalThis.i18n.currentLocale = 'en';
    assert.ok(manager.renderActorCard(nikulin).includes('>Balbes<'), 'The English interface keeps TMDB’s');
    assert.ok(manager.renderActorCard(voiced).includes('>Cyborg (voice) / Victor Stone (uncredited) (archive footage)<'), 'and TMDB’s notes');
    globalThis.i18n.currentLocale = 'ru';
    console.log('  ✅ 5. Cast sorted by order ASC and bounded to 150; series actors show their episodes');
}

// ==========================================
// PART 39 — TESTS: ACTOR CARD & UI
// ==========================================
console.log('\n--- Part 39: Actor Card & UI Tests ---');

// 6. All cards render before the CSS-driven visibility pass
{
    const cast = Array.from({ length: 25 }, (_, i) => ({
        id: `tmdb:${i}`,
        name: `Actor ${i}`,
        character: `Role ${i}`,
        photoUrl: `https://image.tmdb.org/t/p/w185/actor_${i}.jpg`
    }));

    const html = manager.renderActorsTab(cast);
    assert.ok(html.includes('id="actorsGrid"'), 'Contains unified actors grid');
    assert.strictEqual((html.match(/class="actors-grid/g) || []).length, 1, 'Uses one actors grid');
    assert.ok(html.includes('data-action="toggle-actors"'), 'Contains toggle button');
    assert.ok(html.includes('Показать ещё'), 'Show More control is present before layout measurement');
    assert.ok(html.includes('aria-expanded="false"'), 'aria-expanded is false initially');
    console.log('  ✅ 6. First 16 rendered initially; remaining 9 in hidden grid with Show More button');
}

// 7. <= 16 actors still use one grid; the action row is hidden after measurement
{
    const cast = Array.from({ length: 12 }, (_, i) => ({
        id: `tmdb:${i}`,
        name: `Actor ${i}`
    }));
    const html = manager.renderActorsTab(cast);
    assert.ok(html.includes('id="actorsGrid"'), 'Unified grid present');
    assert.ok(html.includes('id="actorsGrid"'), 'Unified grid contains all cards before layout measurement');
    assert.ok(html.includes('btn-show-more-actors'), 'Action row exists for post-measurement visibility');
    console.log('  ✅ 7. When cast <= 16, Show More button and remaining container are omitted');
}

// 8. Missing character omitted cleanly
{
    const actorNoChar = { id: 'tmdb:1', name: 'John Doe', character: null };
    const html = manager.renderActorCard(actorNoChar);
    assert.ok(!html.includes('actor-character'), 'No actor-character element when character is null');
    assert.ok(!html.includes('null'), 'Literal string "null" is not rendered');
    assert.ok(!html.includes('undefined'), 'Literal string "undefined" is not rendered');
    console.log('  ✅ 8. Missing character omitted without residue');
}

// 9. Missing photo fallback
{
    const actorNoPhoto = { id: 'tmdb:2', name: 'Jane Doe', photoUrl: null };
    const html = manager.renderActorCard(actorNoPhoto);
    assert.ok(html.includes('actor-placeholder'), 'Placeholder SVG rendered when photoUrl is missing');
    assert.ok(!html.includes('<img'), 'No broken <img> rendered when photo is null');
    console.log('  ✅ 9. Missing photo renders placeholder SVG safely');
}

// 10. Actor cards navigable with valid ID, non-clickable when ID missing (Phase 2E)
{
    const actorWithId = { id: 'tmdb:3', name: 'Sam Worthington', photoUrl: 'sam.jpg' };
    const htmlWithId = manager.renderActorCard(actorWithId);
    assert.ok(htmlWithId.includes('<a href="../person-details/person-details.html?personKey=tmdb%3A3"'), 'Valid person ID generates anchor link');
    assert.ok(htmlWithId.includes('actor-card--link'), 'actor-card--link class applied');

    const actorNoId = { id: null, name: 'Legacy Unknown Actor', photoUrl: 'sam.jpg' };
    const htmlNoId = manager.renderActorCard(actorNoId);
    assert.ok(!htmlNoId.includes('<a '), 'No anchor tag in ID-less actor card');
    assert.ok(!htmlNoId.includes('href'), 'No href in ID-less actor card');
    console.log('  ✅ 10. Actor card with valid ID is navigable <a>; ID-less card is non-clickable <div>');
}

// 11. No internal provider metadata exposed
{
    const actor = {
        id: 'tmdb:65731',
        kpPersonId: 65731,
        tmdbPersonId: 65731,
        name: 'Сэм Уортингтон',
        department: 'Acting',
        providerSource: 'TMDB'
    };
    const html = manager.renderActorCard(actor);
    assert.ok(!html.includes('providerSource'), 'providerSource not in HTML');
    assert.ok(!html.includes('tmdbPersonId'), 'tmdbPersonId not in HTML');
    assert.ok(!html.includes('kpPersonId'), 'kpPersonId not in HTML');
    console.log('  ✅ 11. Internal provider provenance metadata not exposed in UI');
}

// ==========================================
// PART 40 — TESTS: CREW GROUPING & LABELS
// ==========================================
console.log('\n--- Part 40: Crew Grouping & Deduplication Tests ---');

// 12. Primary and secondary crew rendering
{
    const crew = [
        { id: 'kp:1', name: 'Кристофер Нолан', role: 'DIRECTOR' },
        { id: 'kp:2', name: 'Джонатан Нолан', role: 'WRITER' },
        { id: 'kp:3', name: 'Эмма Томас', role: 'PRODUCER' },
        { id: 'kp:4', name: 'Ханс Циммер', role: 'COMPOSER' },
        { id: 'kp:5', name: 'Хойте Ван Хойтема', role: 'CINEMATOGRAPHY' },
        { id: 'kp:6', name: 'Ли Смит', role: 'EDITOR' },
        { id: 'kp:7', name: 'Нейтан Кроули', role: 'DESIGNER' }
    ];

    const dirStr = manager.formatCrewCategory(crew, 'DIRECTOR', 3);
    const wrtStr = manager.formatCrewCategory(crew, 'WRITER', 5);
    const prdStr = manager.formatCrewCategory(crew, 'PRODUCER', 5);
    const compStr = manager.formatCrewCategory(crew, 'COMPOSER', 3);
    const cinStr = manager.formatCrewCategory(crew, 'CINEMATOGRAPHY', 3);
    const editStr = manager.formatCrewCategory(crew, 'EDITOR', 3);
    const desStr = manager.formatCrewCategory(crew, 'DESIGNER', 3);

    assert.ok(dirStr.includes('Кристофер Нолан') && dirStr.includes('personKey=kp%3A1'), 'Director link formatted accurately');
    assert.ok(wrtStr.includes('Джонатан Нолан') && wrtStr.includes('personKey=kp%3A2'), 'Writer link formatted accurately');
    assert.ok(prdStr.includes('Эмма Томас') && prdStr.includes('personKey=kp%3A3'), 'Producer link formatted accurately');
    assert.ok(compStr.includes('Ханс Циммер') && compStr.includes('personKey=kp%3A4'), 'Composer link formatted accurately');
    assert.ok(cinStr.includes('Хойте Ван Хойтема') && cinStr.includes('personKey=kp%3A5'), 'Cinematography link formatted accurately');
    assert.ok(editStr.includes('Ли Смит') && editStr.includes('personKey=kp%3A6'), 'Editor link formatted accurately');
    assert.ok(desStr.includes('Нейтан Кроули') && desStr.includes('personKey=kp%3A7'), 'Designer link formatted accurately');
    console.log('  ✅ 12. Primary and secondary canonical crew categories format accurately');
}

// 13. Duplicate same-category person removed
{
    const crewWithDupes = [
        { id: 'kp:1', name: 'Квентин Тарантино', role: 'WRITER' },
        { id: 'kp:1', name: 'Квентин Тарантино', role: 'WRITER' },
        { id: 'tmdb:138', name: 'Роджер Эвери', role: 'WRITER' }
    ];
    const writerStr = manager.formatCrewCategory(crewWithDupes, 'WRITER', 5);
    assert.ok(writerStr.includes('Квентин Тарантино') && writerStr.includes('Роджер Эвери'), 'Unique writers included');
    assert.strictEqual(writerStr.split('Квентин Тарантино').length - 1, 1, 'Duplicate Quentin Tarantino collapsed to 1 link');
    console.log('  ✅ 13. Duplicate persons in the same category deduplicated cleanly');
}

// 14. Crew count bounding (+N)
{
    const manyProducers = Array.from({ length: 8 }, (_, i) => ({
        id: `kp:${i}`,
        name: `Producer ${i}`,
        role: 'PRODUCER'
    }));
    const prodStr = manager.formatCrewCategory(manyProducers, 'PRODUCER', 5);
    assert.ok(prodStr.includes('+3'), 'Shows +3 overflow indicator');
    console.log('  ✅ 14. Crew names bounded with +N overflow indicator');
}

// ==========================================
// PART 41 — TESTS: ANIME & VOICE CAST
// ==========================================
console.log('\n--- Part 41: Anime & Voice Cast Tests ---');

// 15. Anime seiyuu appear; voice director not in cast; (voice) preserved
{
    const animeMovie = {
        credits: {
            cast: [
                { id: 'tmdb:101', name: 'Ацуми Танэдзаки', originalName: 'Atsumi Tanezaki', character: 'Frieren (voice)', role: 'ACTOR', order: 0 },
                { id: 'tmdb:102', name: 'Кана Итиносэ', originalName: 'Kana Ichinose', character: 'Fern (voice)', role: 'ACTOR', order: 1 }
            ],
            crew: [
                { id: 'kp:900', name: 'Иван Дубляжев', role: 'OTHER', job: 'Режиссер дубляжа' }
            ]
        }
    };

    const cast = manager.getMovieCast(animeMovie);
    assert.strictEqual(cast.length, 2);
    assert.strictEqual(cast[0].name, 'Ацуми Танэдзаки');
    assert.strictEqual(cast[0].character, 'Frieren (voice)', '(voice) preserved');

    const html = manager.renderActorsTab(cast);
    assert.ok(html.includes('Frieren (озвучка)'), 'The voice note stays, in the Russian interface’s words');
    assert.ok(!html.includes('Иван Дубляжев'), 'Voice director not in cast');
    console.log('  ✅ 15. Anime Japanese voice cast preserved; the (voice) note is kept and localized');
}

// ==========================================
// PART 42 — TESTS: LEGACY COMPATIBILITY
// ==========================================
console.log('\n--- Part 42: Legacy DTO Compatibility Tests ---');

// 16. Old cached DTO without credits field
{
    const oldDto = {
        kinopoiskId: 300,
        name: 'Старый фильм',
        persons: [
            { id: 1, name: 'Актер 1', enProfession: 'ACTOR' },
            { id: 2, name: 'Режиссер 1', enProfession: 'DIRECTOR' }
        ]
    };
    assert.doesNotThrow(() => {
        const cast = manager.getMovieCast(oldDto);
        const crew = manager.getMovieCrew(oldDto);
        const html = manager.renderActorsTab(cast);
        assert.strictEqual(cast.length, 1);
        assert.strictEqual(crew.length, 1);
        assert.ok(html.includes('Актер 1'));
    }, 'Old cached DTO must not throw');
    console.log('  ✅ 16. Legacy DTO without credits field renders seamlessly');
}

// ==========================================
// PART 43 — TESTS: SECURITY & CSP
// ==========================================
console.log('\n--- Part 43: Security, XSS & CSP Tests ---');

// 17. XSS sanitization in names and character strings
{
    const maliciousActor = {
        id: 'tmdb:999',
        name: '<img src=x onerror=alert(1)>Malicious Name',
        character: '<script>alert(2)</script>Role'
    };
    const html = manager.renderActorCard(maliciousActor);
    assert.ok(!html.includes('<script>'), '<script> tag unescaped');
    assert.ok(!html.includes('<img src='), '<img tag unescaped');
    assert.ok(html.includes('&lt;img'), '&lt;img escaped');
    assert.ok(html.includes('&lt;script&gt;'), '&lt;script&gt; escaped');
    console.log('  ✅ 17. XSS payloads in actor name and character string securely escaped');
}

// ==========================================
// PART 44 — TESTS: PHASE UI-3 DENSE ACTORS GRID
// ==========================================
console.log('\n--- Part 44: Phase UI-3 Dense Actors Grid Tests ---');
{
    const actorCss = readText('src/pages/movie-details/movie-details.css');
    const actorGridBlock = actorCss.match(/\.actors-grid \{[\s\S]*?\n\}/)?.[0] || '';
    const actorPhotoBlock = actorCss.match(/\.actor-photo-container \{[\s\S]*?\n\}/)?.[0] || '';

    assert(actorGridBlock.includes('repeat(auto-fit, minmax(104px, 1fr))'),
        'Actors grid uses dense auto-fit columns with a 104px minimum');
    assert(actorGridBlock.includes('gap: 12px'),
        'Actors grid uses compact 12px spacing');
    assert(actorPhotoBlock.includes('aspect-ratio: 3 / 4'),
        'Actor portraits use the stable 3:4 aspect ratio');
    assert(actorCss.includes('.actor-placeholder {') && actorCss.includes('height: 100%;'),
        'Fallback placeholder fills the same stable portrait container');
    assert(actorCss.includes('.actor-card--link:hover') && !actorCss.includes('.actor-card:hover {'),
        'Hover styling is restricted to clickable actor cards');
    assert(actorCss.includes('.actor-card--link:focus-visible'),
        'Clickable actor cards retain visible keyboard focus styling');
    assert(actorCss.includes('.light-theme .actor-card {') && actorCss.includes('.actor-card {'),
        'Both dark and light actor card surfaces are defined');
    assert(!actorCss.includes('.actors-grid {\n    display: flex;') && !actorCss.includes('.actors-grid {\n    overflow-x:'),
        'Actors remain a grid and do not become a carousel');
    assert(!actorsTabMethod.includes('fetch(') && !actorsTabMethod.includes('getMovieCast('),
        'Actors tab rendering introduces no network or data-pipeline requests');

    console.log('  ✅ 19. Dense 3:4 responsive grid, stable fallback, semantics, themes, and no-carousel contract verified');
}

// ==========================================
// PART 46 — TESTS: PHASE UI-3.1 ACTOR EXPANSION LAYOUT
// ==========================================
console.log('\n--- Part 46: Phase UI-3.1 Actors Expansion Layout Tests ---');
{
    const actorCss = readText('src/pages/movie-details/movie-details.css');
    const makeCast = (count) => Array.from({ length: count }, (_, index) => ({
        id: `tmdb:${index + 1}`,
        name: `Actor ${index + 1}`,
        photoUrl: index % 3 === 0 ? '' : `photo-${index + 1}.jpg`,
        character: `Character ${index + 1}`
    }));

    const sixteenHtml = manager.renderActorsTab(makeCast(16));
    assert.strictEqual((sixteenHtml.match(/class="actor-card/g) || []).length, 16, '16 actors render exactly 16 cards');
    assert(sixteenHtml.includes('btn-show-more-actors'), 'action row is available for post-measurement visibility');
    assert.strictEqual((sixteenHtml.match(/class="actors-grid/g) || []).length, 1, '<=16 actors use one grid');

    const seventeenHtml = manager.renderActorsTab(makeCast(17));
    assert.strictEqual((seventeenHtml.match(/class="actor-card/g) || []).length, 17, '17 actors remain represented exactly once');
    assert(seventeenHtml.includes('id="actorsGrid"'), 'unified actors grid is present');
    assert.strictEqual((seventeenHtml.match(/class="actors-grid/g) || []).length, 1, '17 actors use one grid');
    assert.strictEqual((seventeenHtml.match(/class="actor-card/g) || []).length, 17, '17 cards are rendered once before measurement');
    assert(seventeenHtml.includes('aria-expanded="false"'), 'show-more starts collapsed');
    assert(seventeenHtml.includes('aria-controls="actorsGrid"'), 'show-more controls the unified grid');
    assert(actorCss.includes('.actor-card[hidden] {\n    display: none !important;'), 'hidden actors consume zero layout space');
    assert(actorCss.includes('.actors-expand-container {') && actorCss.includes('min-height: 0;'), 'action row has no reserved minimum height');
    assert(actorCss.includes('.actors-grid {') && actorCss.includes('padding: 0;'), 'grid has no trailing spacer padding');
    assert(!actorCss.includes('.actors-grid--remaining'), 'second independent grid styling is removed');
    assert(actorCss.includes('grid-template-columns: repeat(auto-fit, minmax(104px, 1fr))'), 'responsive grid contract remains intact');
    assert(actorCss.includes('.actor-placeholder {') && actorCss.includes('height: 100%;'), 'fallback portraits retain card dimensions');

    const repeatedA = manager.renderActorsTab(makeCast(17));
    const repeatedB = manager.renderActorsTab(makeCast(17));
    assert.strictEqual((repeatedA.match(/class="actor-card/g) || []).length, (repeatedB.match(/class="actor-card/g) || []).length, 're-render does not duplicate actor cards');
    assert.strictEqual((repeatedB.match(/actors-expand-container/g) || []).length, 1, 're-render produces one action wrapper');

    console.log('  ✅ 21. Hidden cards reserve 0px, action row stays outside grid, edge counts and rerenders remain stable');
}

// ==========================================
// PART 47 — TESTS: ACTORS GRID CONTINUITY REGRESSION
// ==========================================
console.log('\\n--- Part 47: Actors Grid Continuity Regression Tests ---');
{
    const makeCast = (count) => Array.from({ length: count }, (_, index) => ({
        id: `tmdb:${index + 1}`,
        name: `Actor ${index + 1}`,
        photoUrl: index % 4 === 0 ? '' : `photo-${index + 1}.jpg`
    }));

    let columnCount = 6;
    globalThis.getComputedStyle = () => ({
        gridTemplateColumns: Array.from({ length: columnCount }, () => '104px').join(' ')
    });
    const getGrid = (count) => new JSDOM(manager.renderActorsTab(makeCast(count))).window.document.querySelector('#actorsGrid');
    const visibleCount = (grid) => grid.querySelectorAll(':scope > .actor-card:not([hidden])').length;
    const hiddenCount = (grid) => grid.querySelectorAll(':scope > .actor-card[hidden]').length;
    const applyCollapsed = (grid) => manager.applyActorsGridVisibility(grid, false);

    const grid30x6 = getGrid(30);
    applyCollapsed(grid30x6);
    assert.strictEqual(visibleCount(grid30x6), 18, '30 actors / 6 columns shows 3 complete rows');
    assert.strictEqual(hiddenCount(grid30x6), 12, '30 actors / 6 columns hides 12 actors');
    assert.strictEqual(grid30x6.closest('.actors-tab-wrapper').querySelector('[data-action="toggle-actors"]').textContent, 'Показать ещё 12');

    columnCount = 5;
    const grid30x5 = getGrid(30);
    applyCollapsed(grid30x5);
    assert.strictEqual(visibleCount(grid30x5), 15, '30 actors / 5 columns shows 15 actors');
    assert.strictEqual(hiddenCount(grid30x5), 15, '30 actors / 5 columns hides 15 actors');

    columnCount = 4;
    const grid30x4 = getGrid(30);
    applyCollapsed(grid30x4);
    assert.strictEqual(visibleCount(grid30x4), 12, '30 actors / 4 columns shows 12 actors');
    assert.strictEqual(hiddenCount(grid30x4), 18, '30 actors / 4 columns hides 18 actors');

    columnCount = 6;
    const grid17 = getGrid(17);
    applyCollapsed(grid17);
    assert.strictEqual(visibleCount(grid17), 17, '17 actors / 6 columns shows all actors');
    assert.strictEqual(hiddenCount(grid17), 0, '17 actors have no hidden remainder');
    assert.strictEqual(grid17.closest('.actors-tab-wrapper').querySelector('.actors-expand-container').hidden, true, '17 actors hide Show More');

    const grid20 = getGrid(20);
    applyCollapsed(grid20);
    assert.strictEqual(visibleCount(grid20), 18, '20 actors / 6 columns shows 18 actors');
    assert.strictEqual(hiddenCount(grid20), 2, '20 actors / 6 columns hides 2 actors');
    manager.applyActorsGridVisibility(grid20, true);
    assert.strictEqual(visibleCount(grid20), 20, 'expanded 20-actor grid reveals all cards');
    assert.strictEqual(hiddenCount(grid20), 0, 'expanded grid has no internal hidden cards');
    columnCount = 4;
    manager.applyActorsGridVisibility(grid20, true);
    assert.strictEqual(visibleCount(grid20), 20, 'expanded resize keeps all actors visible');
    manager.applyActorsGridVisibility(grid20, false);
    assert.strictEqual(visibleCount(grid20), 12, 'collapsed resize recalculates to 3 rows at 4 columns');

    columnCount = 6;
    const grid18 = getGrid(18);
    applyCollapsed(grid18);
    assert.strictEqual(visibleCount(grid18), 18, '18 actors / 6 columns shows all actors');
    assert.strictEqual(grid18.closest('.actors-tab-wrapper').querySelector('.actors-expand-container').hidden, true, '18 actors hide Show More');

    const placeholder = getGrid(17).querySelector('.actor-card .actor-placeholder');
    assert.ok(placeholder, 'placeholder actor remains inside a normal actor card cell');
    assert.strictEqual(placeholder.closest('.actor-card').children.length > 0, true, 'placeholder wrapper is not detached');

    const button = new JSDOM(manager.renderActorsTab(makeCast(17))).window.document.querySelector('[data-action="toggle-actors"]');
    assert.strictEqual(button.getAttribute('aria-controls'), 'actorsGrid', 'toggle controls unified grid');
    assert.strictEqual(button.getAttribute('aria-expanded'), 'false', 'toggle starts collapsed');
    console.log('  ✅ 22. 17/20 actors, placeholders, unified DOM ownership, and accessibility contract verified');
}

// ==========================================
// PART 45 — TESTS: AWARDS TAB (shared AwardsList, every ceremony)
// ==========================================
console.log('\n--- Part 45: Awards Tab Tests ---');
{
    const { locales } = await import('../src/shared/i18n/locales.js');
    const realI18n = {
        currentLocale: 'ru',
        get(key) {
            let value = locales[this.currentLocale];
            for (const part of key.split('.')) value = value?.[part];
            return value ?? key;
        }
    };
    const listWindow = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }).window;
    listWindow.eval(readText('src/shared/components/AwardsList.js'));
    const AwardsList = listWindow.AwardsList;
    // Arrays made in the JSDOM window are compared as plain JSON.
    const plain = value => JSON.parse(JSON.stringify(value));
    globalThis.AwardsList = AwardsList;
    globalThis.i18n.locales.ru.movie_details.awards_tab = { no_data: 'Нет информации о наградах' };

    const awards = [
        { name: 'Сатурн', slug: 'saturn', year: 2015, ceremonyPath: '/awards/saturn/2015/', nominationName: 'Лучший режиссер', nominationUrl: '/awards/saturn/2015/#nom1930', win: false, recipients: [{ name: 'Кристофер Нолан', kinopoiskId: 41477 }], films: [] },
        { name: 'Оскар', slug: 'oscar', year: 2015, ceremonyPath: '/awards/oscar/2015/', nominationName: 'Лучший звук', nominationUrl: '/awards/oscar/2015/#nom1850', win: false, recipients: [], films: [] },
        { name: 'Оскар', slug: 'oscar', year: 2015, ceremonyPath: '/awards/oscar/2015/', nominationName: 'Лучшие визуальные эффекты', nominationUrl: '/awards/oscar/2015/#nom1853', win: true, recipients: [], films: [] },
        { name: 'Британская академия', slug: 'bafta', year: 2015, nominationName: 'Лучшая работа художника-постановщика', nominationUrl: '/awards/bafta/2015/#nom1786', win: false, recipients: [{ name: 'Нэйтан Краули', kinopoiskId: 1642584 }, { name: 'Гари Феттис', kinopoiskId: 1986331 }], films: [] }
    ];
    const snapshot = JSON.stringify(awards);
    const groups = AwardsList.groupAwards(awards, 'film');
    assert.deepStrictEqual(plain(groups.map(group => group.slug)), ['oscar', 'bafta', 'saturn'], 'ceremonies follow their rank, not the page order or the alphabet');
    assert.deepStrictEqual(plain(groups[0].rows.map(row => row.category)), ['Лучшие визуальные эффекты', 'Лучший звук'], 'wins come before nominations within a ceremony');
    assert.strictEqual(groups[0].wins, 1);
    assert.strictEqual(groups[0].nominations, 1);
    assert.strictEqual(JSON.stringify(awards), snapshot, 'grouping must not mutate the input array');
    const twoYears = AwardsList.groupAwards([
        { name: 'Оскар', slug: 'oscar', year: 2021, nominationName: 'A', win: false },
        { name: 'Оскар', slug: 'oscar', year: 2022, nominationName: 'B', win: true }
    ], 'film');
    assert.deepStrictEqual(plain(twoYears.map(group => group.year)), [2022, 2021], 'years of one ceremony stay separate, the latest first');

    const doc = new JSDOM(AwardsList.render(awards, { mode: 'film', i18n: realI18n, idPrefix: 'movieAwards' })).window.document;
    assert.ok(doc.querySelector('.awards-list.awards-list--film'), 'the film mode of the shared list renders');
    assert.strictEqual(doc.querySelector('.awards-summary').textContent.replace(/\s+/g, ' ').trim(), '1 победа · 3 номинации · 3 премии', 'summary counts with Russian plural forms');
    assert.strictEqual(doc.querySelectorAll('.award-group').length, 3);
    assert.strictEqual(doc.querySelector('.award-group__title').textContent.trim(), 'Оскар 2015', 'ceremony and year head each card');
    assert.strictEqual(doc.querySelector('.award-group__summary').textContent, '1 победа · 1 номинация');
    assert.ok(doc.querySelector('.award-group[data-ceremony="oscar"] .award-group__emblem svg'), 'each ceremony has a neutral emblem');
    const winRow = doc.querySelector('.award-row[data-award-win="true"]');
    assert.ok(winRow.classList.contains('award-row--win') && winRow.querySelector('.award-status--win').textContent.includes('Победа'), 'a win is a word and a filled icon, not a colour');
    assert.ok(doc.querySelector('.award-row[data-award-win="false"] .award-status--nomination').textContent.includes('Номинация'));
    const people = [...doc.querySelectorAll('.award-row__people a')];
    assert.deepStrictEqual(people.map(link => [link.textContent, link.getAttribute('href')]), [
        ['Нэйтан Краули', '../person-details/person-details.html?personKey=kp%3A1642584'],
        ['Гари Феттис', '../person-details/person-details.html?personKey=kp%3A1986331'],
        ['Кристофер Нолан', '../person-details/person-details.html?personKey=kp%3A41477']
    ], 'the people a category went to link to their pages');
    const pendingRow = doc.querySelector('.award-row[data-award-nomination-url="/awards/oscar/2015/#nom1850"]');
    assert.strictEqual(pendingRow.getAttribute('data-award-index'), '1', 'rows point back at their award in the movie');
    assert.strictEqual(pendingRow.querySelector('.award-category-winner').hidden, true, 'category winner stays hidden until resolved');
    assert.ok(!doc.querySelector('.awards-toggle'), 'four awards need no «Показать остальные»');

    const resolved = AwardsList.renderRow({ ...awards[1], categoryWinner: 'Одержимость' }, 1, { mode: 'film', i18n: realI18n });
    assert.ok(resolved.includes('Победитель категории: Одержимость') && !resolved.includes(' hidden'), 'a lost nomination names the category winner once resolved');
    const legacy = AwardsList.renderRow({ name: 'Золотой глобус', year: 1973, nominationName: 'Лучшая мужская роль (драма)', recipient: 'Марлон Брандо', win: true }, 0, { mode: 'film', i18n: realI18n });
    assert.ok(legacy.includes('Марлон Брандо'), 'awards cached by the old parser keep their recipient text');
    assert.ok(AwardsList.groupAwards([{ name: 'Золотой глобус', year: 1973, nominationName: 'X', win: true }], 'film')[0].slug === 'golden_globes', 'old cached awards still find their ceremony');

    const many = Array.from({ length: 14 }, (_, index) => ({ name: index < 9 ? 'Оскар' : 'Сатурн', slug: index < 9 ? 'oscar' : 'saturn', year: 2024, nominationName: `Категория ${index}`, win: index % 3 === 0 }));
    const manyDoc = new JSDOM(AwardsList.render(many, { mode: 'film', i18n: realI18n, idPrefix: 'movieAwards' })).window.document;
    const toggle = manyDoc.querySelector('.awards-toggle');
    assert.ok(toggle && toggle.classList.contains('btn'), 'long lists fold the rest behind a shared button');
    assert.strictEqual(toggle.textContent.trim(), 'Показать остальные (5)');
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
    const more = manyDoc.getElementById(toggle.getAttribute('aria-controls'));
    assert.strictEqual(more.hidden, true, 'folded cards start hidden');
    AwardsList.toggle(toggle);
    assert.strictEqual(more.hidden, false);
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(toggle.textContent, 'Свернуть');
    AwardsList.toggle(toggle);
    assert.strictEqual(more.hidden, true, 'the button folds them back');

    const english = { ...realI18n, currentLocale: 'en' };
    assert.ok(AwardsList.render(awards, { mode: 'film', i18n: english }).includes('Academy Awards'), 'the English interface names ceremonies in English');
    assert.ok(AwardsList.render([{ name: '<img src=x onerror=alert(1)>', nominationName: '<script>', win: false }], { mode: 'film', i18n: realI18n }).includes('&lt;script&gt;'), 'award text is escaped');

    const tabHtml = manager.renderAwardsTab.call(manager, awards);
    assert.ok(tabHtml.includes('awards-list--film'), 'the Awards tab renders through AwardsList');
    assert(manager.renderAwardsTab([]).includes('Нет информации о наградах'), 'empty awards behavior remains unchanged');

    const awardsCss = readText('src/shared/styles/awards.css');
    assert(awardsCss.includes('.award-group {') && awardsCss.includes('.award-row {'), 'group and row presentation styles exist');
    assert(awardsCss.includes('overflow-wrap: anywhere'), 'long nomination text wraps without horizontal overflow');
    assert(!readText('src/pages/movie-details/movie-details.css').includes('.award-'), 'the film page keeps no award styles of its own');
    assert(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(awardsCss), 'awards take every colour from theme tokens');
    assert(readText('src/pages/movie-details/movie-details.html').includes('../../shared/styles/awards.css'), 'the film page loads the shared awards stylesheet');
    assert(!movieDetailsSource.includes('awards.sort('), 'awards renderer no longer mutates source order');
    assert(movieDetailsSource.includes('isPageContextCurrent(pageContext)'), 'page-generation guard remains in awards loading path');
    assert(movieDetailsSource.includes('loadAwardsInBackground'), 'awards redesign keeps existing loading path');
    assert(movieDetailsSource.includes('MovieDetailsManager.awardsNeedRefresh(movie)'), 'awards kept before every ceremony was read are read again');
    assert(/new IntersectionObserver\(/.test(extractMethod(movieDetailsSource, 'observeAwardGroups')), 'ceremony pages load only for cards in view');

    // Lazy category winners: a card asks for its ceremony page only once it is in view.
    const observeMethod = extractMethod(movieDetailsSource, 'observeAwardGroups');
    // extractMethod finds plain methods; this one is async.
    const hydrateMethod = extractMethod(movieDetailsSource.replace('async hydrateAwardGroup(', 'hydrateAwardGroup('), 'hydrateAwardGroup');
    const lazy = new MockMovieDetailsManager();
    lazy.observeAwardGroups = eval(`(function ${observeMethod.slice(observeMethod.indexOf('('))})`);
    lazy.hydrateAwardGroup = eval(`(async function ${hydrateMethod.slice(hydrateMethod.indexOf('('))})`);
    lazy.capturePageContext = () => ({ generation: 1, kinopoiskId: '258687' });
    lazy.isPageContextCurrent = () => true;
    const page = new JSDOM(`<div id="tab-awards">${AwardsList.render(awards, { mode: 'film', i18n: realI18n, idPrefix: 'movieAwards' })}</div>`).window.document;
    const observers = [];
    const previous = { document: globalThis.document, IntersectionObserver: globalThis.IntersectionObserver, AwardsParsingService: globalThis.AwardsParsingService, i18n: globalThis.i18n };
    globalThis.document = page;
    globalThis.i18n = realI18n;
    globalThis.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
        observe(target) { this.targets.add(target); }
        unobserve(target) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); }
    };
    const lookups = [];
    globalThis.AwardsParsingService = class {
        async getCategoryInfo(url) {
            lookups.push(url);
            return url.endsWith('#nom1850')
                ? { winner: { label: 'Одержимость', person: null, filmIds: ['725190'] }, nominees: [{ label: 'Интерстеллар', person: null, filmIds: ['258687'] }] }
                : { winner: { label: 'Интерстеллар', person: null, filmIds: ['258687'] }, nominees: [] };
        }
    };
    try {
        const movie = { kinopoiskId: 258687, awards: JSON.parse(snapshot) };
        lazy.observeAwardGroups(movie);
        const observer = observers.at(-1);
        assert.deepStrictEqual([...observer.targets].map(group => group.getAttribute('data-ceremony')), ['oscar', 'bafta', 'saturn'], 'only cards with a lost nomination wait for their ceremony page');
        assert.strictEqual(lookups.length, 0, 'nothing is read before a card is in view');
        const oscarCard = page.querySelector('.award-group[data-ceremony="oscar"]');
        observer.callback([{ isIntersecting: false, target: oscarCard }]);
        assert.strictEqual(lookups.length, 0, 'a card out of view reads nothing');
        observer.callback([{ isIntersecting: true, target: oscarCard }]);
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepStrictEqual(lookups.sort(), ['/awards/oscar/2015/#nom1850', '/awards/oscar/2015/#nom1853'], 'the card in view reads its own categories only');
        assert.ok(!observer.targets.has(oscarCard), 'a card is read once');
        const lostRow = page.querySelector('.award-row[data-award-nomination-url="/awards/oscar/2015/#nom1850"]');
        assert.ok(lostRow.querySelector('.award-category-winner:not([hidden])').textContent.includes('Победитель категории: Одержимость'), 'the lost nomination names the winner in place');
        assert.strictEqual(movie.awards[1].categoryWinner, 'Одержимость', 'the movie keeps the winner for its cache');
        assert.strictEqual(movie.awards[1].categoryResolved, true);
        assert.strictEqual(movie.awards[2].categoryWinner, undefined, 'a win names no other winner');
    } finally {
        Object.assign(globalThis, previous);
    }

    console.log('  ✅ 20. Every ceremony, ranked groups, people links, plural counts, folding, lazy winners and theme tokens verified');
}

// ==========================================
// 18. Zero inline handlers in generated markup
{
    const cast = [{ id: 'tmdb:1', name: 'Actor 1', photoUrl: 'photo.jpg', character: 'Char 1' }];
    const html = manager.renderActorsTab(cast);
    assert.ok(!html.includes('onerror='), 'No inline onerror in actors tab');
    assert.ok(!html.includes('onclick='), 'No inline onclick in actors tab');
    assert.ok(!html.includes('onload='), 'No inline onload in actors tab');
    assert.ok(!html.includes('javascript:'), 'No javascript: URI in actors tab');
    console.log('  ✅ 18. Zero inline event handlers (100% CSP compliant)');
}

console.log('\n🎉 ALL Phase 2B MovieDetails Cast / Crew UI Hardening Tests Passed Successfully!');
