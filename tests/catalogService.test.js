const assert = require('node:assert/strict');
const {
    CATALOG_CATEGORIES,
    normalizeCatalogCategory
} = require('../src/shared/config/catalogCategories.js');
const CatalogService = require('../src/shared/services/CatalogService.js');

function createStorage() {
    const values = new Map();
    return {
        get(keys, callback) {
            const requested = Array.isArray(keys) ? keys : [keys];
            const result = {};
            requested.forEach(key => {
                if (values.has(key)) result[key] = values.get(key);
            });
            callback(result);
        },
        set(data, callback) {
            Object.entries(data).forEach(([key, value]) => values.set(key, value));
            callback?.();
        },
        remove(keys, callback) {
            (Array.isArray(keys) ? keys : [keys]).forEach(key => values.delete(key));
            callback?.();
        }
    };
}

async function run() {
    assert.deepEqual(Object.keys(CATALOG_CATEGORIES), ['films', 'series', 'cartoons', 'anime']);
    assert.equal(normalizeCatalogCategory('movie'), 'films');
    assert.equal(normalizeCatalogCategory('tv-series'), 'series');
    assert.equal(normalizeCatalogCategory('cartoon'), 'cartoons');
    assert.equal(normalizeCatalogCategory('unknown'), 'films');

    const storage = createStorage();
    let providerCalls = 0;
    const tmdbService = {
        async getCatalogPage(options) {
            providerCalls += 1;
            return {
                page: options.page,
                totalPages: 3,
                totalResults: 48,
                items: [
                    { tmdbId: 101, name: 'One', kinopoiskId: null, mediaType: 'movie' },
                    { tmdbId: 101, name: 'Duplicate', kinopoiskId: null, mediaType: 'movie' },
                    { tmdbId: 102, name: 'Two', kinopoiskId: 0, mediaType: 'movie' }
                ]
            };
        }
    };

    const service = new CatalogService({ tmdbService, storage });
    const first = await service.getCategoryPage('movie', { page: 1 });
    assert.equal(first.category, 'films');
    assert.equal(first.items.length, 2);
    assert.equal(first.items[0].isTmdbOnly, true);
    assert.equal(providerCalls, 1);

    const cached = await service.getCategoryPage('films', { page: 1 });
    assert.equal(cached.isFromCache, true);
    assert.equal(providerCalls, 1);

    const fresh = await service.getCategoryPage('films', { page: 1 }, { forceRefresh: true });
    assert.equal(fresh.isFromCache, false);
    assert.equal(providerCalls, 2);

    const cleared = await service.clearCache();
    assert.equal(cleared, 1);

    console.log('✅ Catalog category, normalization, deduplication, caching, and scoped clear tests passed');
}

run().catch(error => {
    console.error('❌ CatalogService tests failed:', error);
    process.exitCode = 1;
});
