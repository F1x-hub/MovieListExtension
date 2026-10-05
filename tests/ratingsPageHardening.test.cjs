// Regression tests for the ratings page hardening pass: attribute escaping, untrusted
// avatar URLs, CSP-safe image fallbacks, keyboard-operable controls, non-blocking
// loading, partial profile failures and the non-blocking legacy sort-field scan.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(projectRoot, file), 'utf8');
const DOCUMENT_ID = '__name__';

global.firebase = { firestore: { FieldPath: { documentId: () => DOCUMENT_ID } } };
// A browser-like document whose textContent/innerHTML round trip (the old escaping
// trick) leaves quotes untouched, exactly like a real DOM does.
global.document = {
    createElement: () => {
        let text = '';
        return {
            set textContent(value) { text = String(value); },
            get innerHTML() { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        };
    }
};
global.window = global;
global.location = { protocol: 'file:' };
global.KINOPOISK_CONFIG = { CACHE_DURATION: 24 * 60 * 60 * 1000 };

const Utils = require('../src/shared/utils/Utils');
const { MovieCard } = require('../src/shared/components/MovieCard');
const UserService = require('../src/shared/services/UserService');
const MovieCacheService = require('../src/shared/services/MovieCacheService');

function createFakeDb(collections, { failWhen = () => false } = {}) {
    const queries = [];
    const matches = (doc, [field, op, value]) => {
        const actual = field === DOCUMENT_ID ? doc.id : doc.data[field];
        if (op === '==') return actual === value;
        if (op === 'in') return value.includes(actual);
        if (op === '>=') return actual >= value;
        if (op === '<=') return actual <= value;
        throw new Error(`Unsupported operator ${op}`);
    };
    const makeQuery = (name, filters, orders = []) => ({
        where: (field, op, value) => makeQuery(name, [...filters, [field, op, value]], orders),
        orderBy: (field, direction) => makeQuery(name, filters, [...orders, [field, direction]]),
        limit: () => makeQuery(name, filters, orders),
        startAfter: () => makeQuery(name, filters, orders),
        get: async () => {
            queries.push({ name, filters, orders });
            if (failWhen(filters)) throw new Error('permission-denied');
            // Like Firestore, an orderBy field excludes documents that lack it
            const docs = (collections[name] || [])
                .filter(doc => filters.every(filter => matches(doc, filter)))
                .filter(doc => orders.every(([field]) => field === DOCUMENT_ID || doc.data[field] != null))
                .map(doc => ({ id: doc.id, data: () => ({ ...doc.data }) }));
            return { docs, forEach: callback => docs.forEach(callback) };
        }
    });
    return { queries, collection: name => makeQuery(name, []) };
}

(async () => {
    // 1. Escaping covers quotes, so values cannot break out of HTML attributes.
    const hostile = 'x" onmouseover="alert(1)';
    for (const [name, escape] of [['Utils', Utils.escapeHtml], ['MovieCard', MovieCard.escapeHtml.bind(MovieCard)]]) {
        assert.equal(escape(hostile), 'x&quot; onmouseover=&quot;alert(1)', `${name}.escapeHtml escapes double quotes`);
        assert.equal(escape("it's <b>"), 'it&#039;s &lt;b&gt;', `${name}.escapeHtml escapes single quotes and tags`);
        assert.equal(escape(null), '');
    }

    // 2. Avatar URLs from user profiles are untrusted.
    const fallback = '/src/shared/assets/icons/app/icon48.png';
    assert.equal(MovieCard.safeImageUrl('https://lh3.googleusercontent.com/a.png'), 'https://lh3.googleusercontent.com/a.png');
    assert.equal(MovieCard.safeImageUrl('chrome-extension://abc/src/shared/assets/icons/app/icon48.png'), 'chrome-extension://abc/src/shared/assets/icons/app/icon48.png');
    assert.equal(MovieCard.safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    assert.equal(MovieCard.safeImageUrl('/src/shared/assets/x.png'), '/src/shared/assets/x.png');
    assert.equal(MovieCard.safeImageUrl('javascript:alert(1)'), fallback);
    assert.equal(MovieCard.safeImageUrl('data:text/html;base64,AAAA'), fallback);
    assert.equal(MovieCard.safeImageUrl('//evil.example/x.png'), fallback);
    assert.equal(MovieCard.safeImageUrl(''), fallback);

    const movieCardJs = read('src/shared/components/MovieCard.js');
    assert.doesNotMatch(movieCardJs, /\sonerror="/, 'Inline onerror is blocked by the extension CSP');
    assert.match(movieCardJs, /this\.bindImageFallbacks\(card\);/, 'Cards bind image fallbacks with addEventListener');
    assert.match(movieCardJs, /this\.safeImageUrl\(userPhoto\)/, 'The featured rater avatar is sanitized');
    assert.match(movieCardJs, /this\.safeImageUrl\(r\.userPhoto\)/, 'Rater popup avatars are sanitized');
    assert.doesNotMatch(movieCardJs, /ещё<\/span>|title="Перейти в профиль"|'Скоро в кино'/, 'Card text is localized');

    const rules = read('rules/firestore.rules');
    assert.match(rules, /function isSafePhotoUrl\(value\)/, 'Rules validate profile photo URLs');
    const usersRules = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /collections/{collectionId}', rules.indexOf('match /users/{userId}')));
    assert.equal((usersRules.match(/isSafePhotoUrl\(request\.resource\.data\.photoURL\)/g) || []).length, 2, 'Create and owner update check photoURL');

    // 3. Profiles: chunks run in parallel and one failing chunk keeps the others.
    const userIds = Array.from({ length: 12 }, (_, index) => `user-${index}`);
    const usersDb = createFakeDb(
        { users: userIds.map(id => ({ id, data: { displayName: id } })) },
        { failWhen: filters => filters[0]?.[2]?.includes('user-11') }
    );
    const userService = new UserService({ db: usersDb });
    const detailed = await userService.getUserProfilesByIdsDetailed(userIds);
    assert.equal(detailed.profiles.length, 10, 'The healthy chunk still returns its profiles');
    assert.deepEqual(detailed.failedIds, ['user-10', 'user-11'], 'Failed IDs are reported for a retry');
    assert.equal((await userService.getUserProfilesByIds(userIds)).length, 10, 'The plain helper keeps partial results');

    // 4. The legacy sort-field scan never delays a load once any result is cached.
    const storage = {};
    global.chrome = {
        storage: {
            local: {
                get: async key => (typeof key === 'string' ? (key in storage ? { [key]: storage[key] } : {}) : {}),
                set: async values => Object.assign(storage, values)
            }
        }
    };
    const moviesDb = createFakeDb({
        movies: [
            { id: '10', data: { hasCommunityRating: true, lastRatingUpdatedAt: '2026-03-01', updatedAt: '2020-01-01' } },
            { id: '11', data: { hasCommunityRating: true, updatedAt: '2026-02-01' } }
        ]
    });
    const movieCacheService = new MovieCacheService({ db: moviesDb });
    storage[MovieCacheService.MISSING_SORT_FIELD_CACHE_KEY] = {
        ids: ['11'],
        scannedAt: Date.now() - MovieCacheService.MISSING_SORT_FIELD_SCAN_TTL - 1
    };
    const stale = await movieCacheService.getMissingSortFieldMovies();
    assert.deepEqual(stale.map(movie => movie.id), ['11'], 'An expired result is used right away');
    assert.ok(moviesDb.queries.some(query => query.filters.length === 1 && query.filters[0][0] === 'hasCommunityRating'),
        'and refreshed by one background scan');
    await movieCacheService.missingSortFieldScanPromise;
    assert.ok(Date.now() - storage[MovieCacheService.MISSING_SORT_FIELD_CACHE_KEY].scannedAt < 1000, 'The background scan stores its result');

    moviesDb.queries.length = 0;
    const first = movieCacheService.scanMissingSortFieldMovies();
    const second = movieCacheService.scanMissingSortFieldMovies();
    assert.equal(first, second, 'Concurrent scans share one request');
    await first;
    assert.equal(moviesDb.queries.length, 1);

    // 5. Merging legacy documents into the first page keeps healthy ones ordered by
    // lastRatingUpdatedAt (the old code compared their metadata updatedAt instead).
    const page = await movieCacheService.getMoviesByAvgRating({ sortBy: 'date', sortDir: 'desc', limit: 8 });
    assert.deepEqual(page.movies.map(movie => movie.id), ['10', '11']);

    // 6. Local-only cache lookup reads no Firestore document.
    moviesDb.queries.length = 0;
    global.localStorage = {
        getItem: key => (key === 'kp_movie_42' ? JSON.stringify({ kinopoiskId: 42, name: 'Local', posterUrl: 'https://p/x.jpg' }) : null)
    };
    const local = await movieCacheService.getLocalCachedMovies(['42', '43']);
    assert.equal(local['42'].name, 'Local');
    assert.equal(local['43'], undefined);
    assert.equal(moviesDb.queries.length, 0, 'getLocalCachedMovies never queries Firestore');
    delete global.localStorage;

    // 7. Page markup and controls: keyboard-operable, non-blocking, labelled.
    const ratingsJs = read('src/pages/ratings/ratings.js');
    const ratingsHtml = read('src/pages/ratings/ratings.html');
    assert.doesNotMatch(ratingsJs, /(clearFiltersBtn|toggleFiltersBtn|retryBtn|ratingModalClose|saveRatingBtn|cancelRatingBtn|activeFiltersList|trigger|option)\??\.addEventListener\('mousedown'/,
        'Buttons and dropdown options react to click, so Enter and Space work');
    assert.match(ratingsJs, /handleDropdownKeydown\(dropdownId, e\)/, 'Dropdown lists handle arrow keys and Escape');
    assert.match(ratingsJs, /handleRatingModalKeydown\(e\)/, 'The rating dialog handles Escape and Tab');
    assert.match(ratingsJs, /removeEl = document\.createElement\('button'\)/, 'Filter tag removal is a real button');
    assert.match(ratingsHtml, /fonts\.googleapis\.com[^>]*media="print" data-async-style/, 'Font CSS does not block the first paint');
    assert.match(ratingsHtml, /<script src="\.\.\/\.\.\/shared\/utils\/asyncStyles\.js"><\/script>/);
    assert.match(ratingsHtml, /rel="preload" as="script" href="\.\.\/\.\.\/\.\.\/libs\/firebase-auth-compat\.js"/);
    assert.match(ratingsHtml, /id="avgRatingTo"[^>]*aria-label=/, 'The upper range handle has a name');
    assert.match(ratingsHtml, /<label class="rating-main-label" for="ratingSlider"/);
    assert.doesNotMatch(ratingsHtml, /<button(?![^>]*type=)[^>]*>/, 'Every button declares its type');

    console.log('Ratings page hardening tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
