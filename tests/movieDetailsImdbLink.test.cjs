/**
 * The Movie Details IMDb tile links to imdb.com only with a known IMDb ID.
 * The ID found on the hidden Kinopoisk page must reach the tile and the card
 * cache, and a title already checked is not re-scraped on every visit.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

global.window = global;
const storageValues = {
    movie_card_ratings_v4: {
        'kp:707636': {
            kpId: 707636,
            kpRating: 8.5,
            imdbRating: 8.5,
            imdbId: 'tt2359704',
            votes: { kp: 76300, imdb: 52000 },
            expiresAt: Date.now() + 60_000
        }
    }
};
global.chrome = {
    storage: {
        local: {
            async get(key) {
                if (typeof key === 'string') return { [key]: storageValues[key] };
                return Object.fromEntries(key.map(name => [name, storageValues[name]]));
            },
            async set(values) {
                Object.assign(storageValues, values);
            }
        }
    }
};
global.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'server-timestamp' } } };
global.KinopoiskRatingParsingService = class {
    async getKinopoiskRating() { return null; }
};
global.ImdbParsingService = class {
    async getImdbRating() { return null; }
};
require('../src/shared/services/RatingsRefreshService.js');

async function run() {
    const service = new global.RatingsRefreshService({ db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) }) } });

    // The card cache carries the IMDb ID into the refresh result.
    const cached = await service.checkAndRefreshRatings(707636, null);
    assert.equal(cached.imdbId, 'tt2359704');

    // A Kinopoisk-page patch stores the IMDb ID and the check time.
    storageValues.movie_card_ratings_v4['kp:999'] = {
        kpId: 999, kpRating: 7.1, imdbRating: 0, votes: { kp: 10 }, expiresAt: Date.now() + 60_000
    };
    await service.persistCardRatingPatch(999, { imdbRating: 6.4, imdbId: 'tt0000999', imdbChecked: true, votes: { imdb: 5 } });
    const patched = storageValues.movie_card_ratings_v4['kp:999'];
    assert.equal(patched.imdbId, 'tt0000999');
    assert.equal(patched.imdbRating, 6.4);
    assert.equal(patched.imdbState, 'available');
    assert.ok(Date.now() - patched.imdbCheckedAt < 1000);

    // A title without IMDb data is remembered as checked, even without a card record.
    await service.persistCardRatingPatch(555, { kpRating: 6.0, imdbChecked: true, votes: { kp: 100 } });
    const created = storageValues.movie_card_ratings_v4['kp:555'];
    assert.equal(created.kpRating, 6.0);
    assert.equal(created.imdbState, 'unavailable');
    assert.ok(created.imdbRetryAfter - Date.now() > 11 * 60 * 60 * 1000, 'card enrichment also waits ~12h');
    const merged = service.mergeRatingSources({ kpRating: 6.0, imdbRating: 0, votes: {} }, created);
    assert.ok(merged.imdbCheckedAt > 0, 'Movie Details sees the check time');

    // Movie Details: the page ID reaches the tile; checked titles are not re-scraped.
    const details = read('src/pages/movie-details/movie-details.js');
    assert.match(details, /imdbId: result\?\.imdbId \|\| pageRatings\?\.imdbId \|\| null,\s*imdbChecked: true,/);
    assert.match(details, /identity: \{ \.\.\.\(movie\.identity \|\| \{\}\), imdbId: knownImdbId \}/);
    assert.match(details, /\(\(resultImdbRating <= 0 \|\| !hasImdbId\) && !imdbRecentlyChecked\)/);
    assert.match(details, /const imdbId = String\(movie\?\.identity\?\.imdbId \|\| movie\?\.imdbId \|\| movie\?\.externalId\?\.imdb/);

    console.log('Movie Details IMDb link tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
