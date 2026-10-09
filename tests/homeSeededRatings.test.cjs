const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const MovieRatingsEnrichmentService = require('../src/shared/services/MovieRatingsEnrichmentService.js');

async function run() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;
    global.chrome = { runtime: { getURL: path => `chrome-extension://test/${path}` } };
    global.Utils = { extractKinopoiskId: value => value?.kinopoiskId || value?.movieId || null };
    window.i18n = { get: key => key, currentLocale: 'ru' };
    const { MovieCard } = require('../src/shared/components/MovieCard.js');
    global.MovieCard = MovieCard;
    window.MovieCard = MovieCard;

    const makeCard = (values = {}) => {
        const card = MovieCard.create({ movie: {
            kinopoiskId: 123, name: 'Seeded movie', kpRating: 7.6,
            imdbRating: 8.2, imdbId: 'tt1234567', ...values
        } }, { variant: 'search', showThreeDotMenu: false, showRatingSkeleton: true });
        document.body.appendChild(card);
        return card;
    };
    const makeStorage = records => ({
        values: { movie_card_ratings_v4: records || {} },
        get(keys, callback) { callback(this.values); },
        set(values, callback) { Object.assign(this.values, values); callback?.(); }
    });
    const createService = options => new MovieRatingsEnrichmentService({ trace: false, ...options });
    const assertBadges = (card, kp, imdb) => {
        assert.equal(card.dataset.kpRating, String(kp));
        assert.equal(card.dataset.imdbRating, String(imdb));
        assert.match(card.querySelector('.mc-badge-kp').textContent, new RegExp(String(kp).replace('.', '\\.')));
        assert.match(card.querySelector('.mc-badge-imdb').textContent, new RegExp(String(imdb).replace('.', '\\.')));
        assert.equal(card.querySelector('.mc-badge-loading'), null);
        assert.equal(card.querySelector('.mc-badge-unavailable'), null);
    };
    const flush = async (service, card) => {
        service.pendingCards.add(card);
        await service.flushPendingCards();
        await service.lastBackgroundEnrichment;
    };

    // Cold cache uses the actual MovieCard metadata, never an overlay mock.
    const coldStorage = makeStorage();
    const cold = createService({ storage: coldStorage });
    const coldCard = makeCard();
    assert.equal(cold.itemFromCard(coldCard).imdbId, 'tt1234567');
    await flush(cold, coldCard);
    assertBadges(coldCard, 7.6, 8.2);
    assert.equal(coldStorage.values.movie_card_ratings_v4['kp:123'].kpRating, 7.6);

    // A negative persisted response must not override known metadata.
    const negativeStorage = makeStorage({ 'kp:123': {
        kpId: 123, kpRating: 0, imdbRating: 0, status: 'no-ratings',
        kpState: 'unavailable', imdbState: 'unavailable',
        expiresAt: Date.now() + 60_000, retryAfter: Date.now() + 60_000
    } });
    const negative = createService({ storage: negativeStorage });
    const negativeCard = makeCard();
    await flush(negative, negativeCard);
    assertBadges(negativeCard, 7.6, 8.2);
    assert.equal(negativeStorage.values.movie_card_ratings_v4['kp:123'].imdbRating, 8.2);

    // Expired zero/partial cache enters the candidate path and retains both seeds.
    const partial = createService({ storage: makeStorage({ 'kp:123': {
        kpId: 123, kpRating: 0, imdbRating: 0, status: 'partial',
        kpState: 'pending', imdbState: 'pending', expiresAt: Date.now() - 1
    } }) });
    const partialCard = makeCard();
    await flush(partial, partialCard);
    assertBadges(partialCard, 7.6, 8.2);
    assert.equal(partialCard.dataset.ratingsState, 'ready');

    // Only missing IMDb needs provider work. Its failure must not erase seeded KP.
    let pageCalls = 0;
    const failed = createService({
        storage: makeStorage(), enableDetailFallback: true,
        imdbParser: { async getImdbRatingsBatch(ids) { assert.deepEqual(ids, ['tt1234567']); return null; } },
        kinopoiskService: { async scrapeMoviePageRatingsOffscreen() { pageCalls++; throw new Error('offline'); } }
    });
    const failedCard = makeCard({ imdbRating: 0 });
    await flush(failed, failedCard);
    assert.equal(pageCalls, 1);
    assert.equal(failedCard.dataset.kpRating, '7.6');
    assert.ok(failedCard.querySelector('.mc-badge-kp'));
    assert.equal(failedCard.querySelector('.mc-badge-loading'), null);

    // Direct application of cache/background records preserves seeds as well.
    cold.applyRatings(coldCard, { kpId: 123, kpRating: 0, imdbRating: 0, status: 'partial', kpState: 'pending', imdbState: 'pending' });
    assertBadges(coldCard, 7.6, 8.2);
    cold.applyRatings(coldCard, { kpId: 123, kpRating: 7.3, imdbRating: 7.9, status: 'resolved' });
    assertBadges(coldCard, 7.3, 7.9); // Positive updated ratings may move downward.
    MovieCard.updateCompactRatings(coldCard, { kpRating: 0, imdbRating: 0, status: 'no-ratings' });
    assertBadges(coldCard, 7.3, 7.9);

    // Seeded providers also survive failed TMDB identity searches/createRecord.
    const unmapped = createService({ storage: makeStorage(), navigationService: { async resolve() { throw new Error('offline'); } } });
    const unmappedCard = makeCard({ kinopoiskId: null, tmdbId: 789, isTmdbOnly: true });
    await flush(unmapped, unmappedCard);
    assertBadges(unmappedCard, 7.6, 8.2);
    const unmappedRecord = (await unmapped.readCache())['tmdb:movie:789'];
    assert.equal(unmappedRecord.kpRating, 7.6);
    assert.equal(unmappedRecord.imdbId, 'tt1234567');
    dom.window.close();
    console.log('Home seeded KP/IMDb ratings survive cold/negative/partial cache and provider failures');
}

module.exports = { run };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
