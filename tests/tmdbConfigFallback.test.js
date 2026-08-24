const assert = require('node:assert/strict');

const servicePath = require.resolve('../src/shared/services/TMDBService.js');
const previousConfig = globalThis.TMDB_CONFIG;

try {
    delete globalThis.TMDB_CONFIG;
    delete require.cache[servicePath];

    const TMDBService = require(servicePath);
    const service = new TMDBService();

    assert.equal(service.baseUrl, 'https://api.themoviedb.org/3');
    assert.equal(service.defaultLanguage, 'ru-RU');
    assert.equal(service.isConfigured(), false);

    console.log('✅ TMDBService starts safely when the local secret config is absent');
} finally {
    if (previousConfig === undefined) {
        delete globalThis.TMDB_CONFIG;
    } else {
        globalThis.TMDB_CONFIG = previousConfig;
    }
}
