const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const ProviderRatingsBackfill = require('../src/shared/services/ProviderRatingsBackfill.js');

(async () => {
    const now = Date.now();

    // Selection: missing IMDb or KP is fetched; complete, settled, seen and duplicate titles are not.
    {
        const entries = [
            { kinopoiskId: 1, kpRating: 7.1, imdbRating: 0 },
            { kinopoiskId: 2, kpRating: 7.1, imdbRating: 6.8 },
            { kinopoiskId: 3, kpRating: 0, imdbRating: 0, mediaType: 'tv-series' },
            { kinopoiskId: 4, kpRating: 6, imdbRating: 0 },
            { kinopoiskId: 5, kpRating: 6, imdbRating: 0 },
            { kinopoiskId: 1, kpRating: 7.1, imdbRating: 0 },
            { kinopoiskId: 9, kpRating: 0, imdbRating: 0 }
        ];
        const cache = {
            'kp:4': { imdbCheckVersion: 2, imdbRetryAfter: now + 1000 }, // a real recent "no IMDb" answer
            'kp:5': { imdbRetryAfter: now + 1000 } // pre-fix record: re-checked
        };
        const pending = ProviderRatingsBackfill.select(entries, cache, new Set([9]), now);
        assert.deepEqual(pending.map(entry => entry.kinopoiskId), [1, 3, 5]);
        assert.equal(pending[1].mediaType, 'tv-series');
    }

    // DOM: cached ratings apply instantly, missing ones are fetched once and persisted.
    {
        const dom = new JSDOM(`<div id="root">
            <div class="movie-card-component" data-movie-id="10" data-kp-rating="7.5"></div>
            <div class="movie-card-component" data-movie-id="20" data-kp-rating="6.6"></div>
            <div class="movie-card-component" data-movie-id="20" data-kp-rating="6.6"></div>
            <div class="movie-card-component mc-is-loading" data-movie-id="30"></div>
        </div>`);
        const root = dom.window.document.getElementById('root');
        const store = { movie_card_ratings_v4: { 'kp:10': { kpRating: 7.5, imdbRating: 8.1, expiresAt: now + 60000 } } };
        const fetched = [];
        const persisted = [];
        const updated = [];
        const service = new ProviderRatingsBackfill({
            root,
            storage: { get: async key => ({ [key]: store[key] }) },
            getRatings: async id => { fetched.push(id); return { kpRating: 6.6, kpVotes: 900, imdbRating: 7.2, imdbVotes: 4000, imdbAnswered: true }; },
            persist: async (id, record) => { persisted.push({ id, record }); },
            updateCard: (card, ratings) => {
                updated.push({ id: card.dataset.movieId, ratings });
                if (ratings.imdbRating > 0) card.dataset.imdbRating = String(ratings.imdbRating);
            }
        });
        await service.scan();
        assert.deepEqual(fetched, [20], 'only the title without a cached IMDb rating is fetched, once');
        assert.ok(updated.some(entry => entry.id === '10' && entry.ratings.imdbRating === 8.1), 'cached IMDb applies without a request');
        assert.equal(updated.filter(entry => entry.id === '20').length, 2, 'every card of the title is updated');
        assert.equal(persisted[0].id, 20);
        assert.deepEqual(persisted[0].record.votes, { kp: 900, imdb: 4000 });
        assert.equal(persisted[0].record.imdbChecked, true);
        assert.equal(fetched.includes(30), false, 'loading placeholders are skipped');

        await service.scan();
        assert.deepEqual(fetched, [20], 'a second scan does not refetch');

        // A re-rendered card gets the session result immediately.
        root.insertAdjacentHTML('beforeend', '<div class="movie-card-component" data-movie-id="20" data-kp-rating="6.6"></div>');
        updated.length = 0;
        await service.scan();
        assert.deepEqual(fetched, [20]);
        assert.equal(updated.length, 1);
        dom.window.close();
    }

    console.log('Provider ratings backfill tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
