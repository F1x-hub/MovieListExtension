const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const DOCUMENT_ID = '__name__';

global.firebase = { firestore: { FieldPath: { documentId: () => DOCUMENT_ID } } };

const RatingService = require('../src/shared/services/RatingService');
const MovieCacheService = require('../src/shared/services/MovieCacheService');

// Minimal in-memory Firestore: supports where('==' | 'in') chains and get().
function createFakeDb(collections) {
    const queries = [];
    const matches = (doc, [field, op, value]) => {
        const actual = field === DOCUMENT_ID ? doc.id : doc.data[field];
        if (op === '==') return actual === value;
        if (op === 'in') return value.includes(actual);
        throw new Error(`Unsupported operator ${op}`);
    };
    const makeQuery = (name, filters, orders = []) => ({
        where: (field, op, value) => makeQuery(name, [...filters, [field, op, value]], orders),
        orderBy: (field, direction) => makeQuery(name, filters, [...orders, [field, direction]]),
        limit: () => makeQuery(name, filters, orders),
        startAfter: () => makeQuery(name, filters, orders),
        get: async () => {
            queries.push({ name, filters, orders });
            const docs = (collections[name] || [])
                .filter(doc => filters.every(filter => matches(doc, filter)))
                .map(doc => ({ id: doc.id, data: () => ({ ...doc.data }) }));
            return { docs, forEach: callback => docs.forEach(callback) };
        },
        onSnapshot: (next) => {
            queries.push({ name, filters, orders, live: true });
            const docs = (collections[name] || [])
                .filter(doc => filters.every(filter => matches(doc, filter)))
                .map(doc => ({ id: doc.id, data: () => ({ ...doc.data }) }));
            next({ docs });
            return () => { queries.push({ unsubscribed: true }); };
        }
    });
    return { queries, collection: name => makeQuery(name, []) };
}

(async () => {
    // 1. Ratings for a whole page come from one batched query set, not one query pair per movie.
    const ratingsDb = createFakeDb({
        ratings: [
            { id: 'user-a_1', data: { userId: 'user-a', movieId: 1, rating: 8, createdAt: '2026-01-01T00:00:00.000Z' } },
            { id: 'user-b_1', data: { userId: 'user-b', movieId: '1', rating: 6, createdAt: '2026-02-01T00:00:00.000Z' } },
            { id: 'user-a_2', data: { userId: 'user-a', movieId: 2, rating: 10, createdAt: '2026-01-05T00:00:00.000Z' } },
            { id: 'legacy-x', data: { userId: 'user-a', movieId: 2, rating: 1, createdAt: '2025-01-05T00:00:00.000Z' } }
        ]
    });
    const ratingService = new RatingService({ db: ratingsDb });
    const movieIds = Array.from({ length: 8 }, (_, index) => index + 1);
    const { averages, ratersByMovie } = await ratingService.getMovieRatingsBatch(movieIds, 50);

    assert.equal(ratingsDb.queries.length, 1, '8 movies (16 numeric/string IDs) need a single "in" query');
    assert.deepEqual(averages[1], { average: 7, count: 2 });
    assert.deepEqual(averages[2], { average: 10, count: 1 }, 'Canonical rating wins over a legacy duplicate');
    assert.deepEqual(averages[3], { average: 0, count: 0 });
    assert.deepEqual(ratersByMovie.get(1).map(r => r.userId), ['user-b', 'user-a'], 'Raters are newest first');
    assert.deepEqual(ratersByMovie.get(3), []);

    const fetchedAverages = await ratingService.fetchAverageRatingsFromFirestore(movieIds);
    assert.deepEqual(fetchedAverages[1], averages[1], 'Average helper keeps its previous contract');

    // 2. The legacy missing-timestamp scan reads the whole collection only when its cache is stale.
    const storage = {};
    global.chrome = {
        storage: {
            local: {
                get: async key => (key in storage ? { [key]: storage[key] } : {}),
                set: async values => Object.assign(storage, values)
            }
        }
    };

    const moviesDb = createFakeDb({
        movies: [
            { id: '10', data: { hasCommunityRating: true, lastRatingUpdatedAt: '2026-01-01' } },
            { id: '11', data: { hasCommunityRating: true } },
            { id: '12', data: { hasCommunityRating: true, lastRatingUpdatedAt: null } }
        ]
    });
    const movieCacheService = new MovieCacheService({ db: moviesDb });

    const firstScan = await movieCacheService.getMissingSortFieldMovies();
    assert.deepEqual(firstScan.map(movie => movie.id).sort(), ['11', '12']);
    assert.deepEqual(moviesDb.queries[0].filters, [['hasCommunityRating', '==', true]], 'Stale cache triggers the full scan');
    assert.deepEqual(storage[MovieCacheService.MISSING_SORT_FIELD_CACHE_KEY].ids.sort(), ['11', '12']);

    moviesDb.queries.length = 0;
    const cachedScan = await movieCacheService.getMissingSortFieldMovies();
    assert.deepEqual(cachedScan.map(movie => movie.id).sort(), ['11', '12']);
    assert.equal(moviesDb.queries.length, 1);
    assert.equal(moviesDb.queries[0].filters[0][0], DOCUMENT_ID, 'Fresh cache re-reads only the known IDs');

    storage[MovieCacheService.MISSING_SORT_FIELD_CACHE_KEY] = { ids: [], scannedAt: Date.now() };
    moviesDb.queries.length = 0;
    assert.deepEqual(await movieCacheService.getMissingSortFieldMovies(), []);
    assert.equal(moviesDb.queries.length, 0, 'A fresh empty scan result needs no Firestore read');

    storage[MovieCacheService.MISSING_SORT_FIELD_CACHE_KEY] = {
        ids: [],
        scannedAt: Date.now() - MovieCacheService.MISSING_SORT_FIELD_SCAN_TTL - 1
    };
    moviesDb.queries.length = 0;
    await movieCacheService.getMissingSortFieldMovies();
    assert.equal(moviesDb.queries.length, 1, 'An expired scan result is refreshed');
    assert.deepEqual(moviesDb.queries[0].filters, [['hasCommunityRating', '==', true]]);

    // 2b. The ratings page 'avg' sort key orders by the real avgRating field.
    moviesDb.queries.length = 0;
    await movieCacheService.getMoviesByAvgRating({ sortBy: 'avg', sortDir: 'asc', limit: 8 });
    assert.deepEqual(moviesDb.queries[0].orders[0], ['avgRating', 'asc'], "'avg' maps to avgRating, not a missing 'avg' field");

    // 2c. The live listener uses the indexed first-page query (hasCommunityRating +
    // lastRatingUpdatedAt desc + documentId desc) and returns an unsubscribe.
    moviesDb.queries.length = 0;
    let liveMovies = null;
    const unsubscribe = movieCacheService.watchNewestRatedMovies({ limit: 8, onChange: movies => { liveMovies = movies; } });
    const liveQuery = moviesDb.queries[0];
    assert.equal(liveQuery.live, true);
    assert.deepEqual(liveQuery.filters, [['hasCommunityRating', '==', true]]);
    assert.deepEqual(liveQuery.orders, [['lastRatingUpdatedAt', 'desc'], [DOCUMENT_ID, 'desc']]);
    assert.equal(liveMovies.length, 3, 'Snapshot documents reach the page callback');
    unsubscribe();
    assert.equal(moviesDb.queries.at(-1).unsubscribed, true);

    // 3. Ratings page source contract: batched, parallel enrichment and accumulated profiles.
    const ratingsJs = fs.readFileSync(path.join(projectRoot, 'src/pages/ratings/ratings.js'), 'utf8');
    assert.doesNotMatch(ratingsJs, /getMovieRatings\(/, 'Ratings page must not query raters movie by movie');
    assert.match(ratingsJs, /getMovieRatingsBatch\(/, 'Ratings page uses the batched raters query');
    assert.match(ratingsJs, /await Promise\.all\(\[\s*this\.mergeProviderRatingsForPage/, 'Page enrichment runs in parallel');
    const loadUserProfilesBody = ratingsJs.slice(
        ratingsJs.indexOf('async loadUserProfiles('),
        ratingsJs.indexOf('async fetchBookmarksMap(')
    );
    assert.doesNotMatch(loadUserProfilesBody, /userProfilesMap\.clear\(\)/, 'Profiles accumulate across pages');
    assert.match(ratingsJs, /profiles: this\.getCachedProfilesFor\(ratings\)/, 'Page cache stores rater profiles');
    assert.match(ratingsJs, /this\.restoreCachedProfiles\(cache\.profiles\)/, 'Cached render restores rater profiles');

    // 4. Sorting: keys are parsed by their last '-', only date/avg sort on the server.
    assert.doesNotMatch(ratingsJs, /filters\.sort[^;\n]*\.split\('-'\)/, "'avg-rating-desc' must not be split on every '-'");
    assert.match(ratingsJs, /field === 'date' \|\| field === 'avg'/, 'Only date and avg are server-side sorts');
    assert.match(ratingsJs, /loadAllForClientSort\(\)/, 'Client-only sorts load every page before sorting');
    assert.match(ratingsJs, /case 'rating':[\s\S]{0,200}getMyRating\(a\)/, '"My rating" sorts by the signed-in user rating');

    // 5. One click handler for card actions; card navigation stays with Utils.
    assert.doesNotMatch(ratingsJs, /moviesGrid\?\.addEventListener\('mousedown'/, 'Card actions must not also fire on mousedown');
    assert.doesNotMatch(ratingsJs, /search\.html\?movieId/, 'Cards must not navigate to the legacy search route');
    assert.match(ratingsJs, /stopImmediatePropagation\(\)/, 'Handled card clicks stop the card navigation listener');
    assert.match(ratingsJs, /this\.setupGridEventListeners\(\);[\s\S]*Utils\.bindMovieCardNavigation\(this\.elements\.moviesGrid\)/,
        'Action listener is registered before card navigation, which binds to the real grid element');

    // Card rows align: no empty bottom block competes with the ratings row's
    // margin-top:auto (it pushed rated-by-me cards' ratings up a row).
    const movieCardJs = fs.readFileSync(path.join(projectRoot, 'src/shared/components/MovieCard.js'), 'utf8');
    const movieCardCss = fs.readFileSync(path.join(projectRoot, 'src/shared/styles/movie-card.css'), 'utf8');
    assert.doesNotMatch(movieCardJs, /class="mc-actions"/, 'MovieCard renders no empty .mc-actions block');
    assert.doesNotMatch(movieCardCss, /^\.mc-actions\s*\{/m, 'No auto-margin .mc-actions rule');
    assert.match(movieCardCss, /\.mc-ratings-row \{[^}]*margin-top: auto;/, 'Ratings row stays bottom-aligned');

    // 6. Small fixes.
    const ratingsHtml = fs.readFileSync(path.join(projectRoot, 'src/pages/ratings/ratings.html'), 'utf8');
    assert.doesNotMatch(ratingsHtml, /\son[a-z]+="/i, 'Inline handlers are blocked by the extension CSP');
    assert.doesNotMatch(ratingsHtml, /id="userFilterGroup"[^>]*display:\s*none/, 'User filter must be visible');
    assert.match(ratingsJs, /async editRating\(movieId\) \{[\s\S]{0,200}this\.findMovieData\(movieId\)/, 'editRating matches IDs numerically');
    assert.doesNotMatch(ratingsJs, /myRating: Number\(currentUserRating/, 'myRating never comes from another rater');

    console.log('Ratings page audit fix tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
