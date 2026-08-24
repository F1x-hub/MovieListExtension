const assert = require('node:assert/strict');

const KINOPOISK_CONFIG = require('../src/shared/config/kinopoisk.config.js');
globalThis.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
globalThis.quotaTracker = { track() {} };

const originalKeys = KINOPOISK_CONFIG.API_KEYS;
const originalIndex = KINOPOISK_CONFIG.currentKeyIndex;
KINOPOISK_CONFIG.API_KEYS = ['test-key-1', 'test-key-2', 'test-key-3'];
KINOPOISK_CONFIG.currentKeyIndex = 0;

let exhausted = false;
let marked = 0;
globalThis.kinopoiskQuota = {
    async isQuotaExhausted() {
        return exhausted;
    },
    async markQuotaExhausted() {
        marked += 1;
    }
};

const KinopoiskService = require('../src/shared/services/KinopoiskService.js');

function response(status, payload) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: () => null },
        clone() {
            return { json: async () => payload };
        },
        json: async () => payload
    };
}

async function run() {
    const service = new KinopoiskService();
    let calls = 0;

    globalThis.fetch = async () => {
        calls += 1;
        return response(403, { message: 'forbidden' });
    };
    await assert.rejects(
        service._fetchWithRotation('https://api.example.test/movie/1'),
        (error) => error.code === 'KINOPOISK_ACCESS_DENIED' && error.status === 403
    );
    assert.equal(calls, 3);
    assert.equal(marked, 0);

    calls = 0;
    KINOPOISK_CONFIG.currentKeyIndex = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return response(401, { message: 'invalid api key' });
    };
    await assert.rejects(
        service._fetchWithRotation('https://api.example.test/movie/1'),
        (error) => error.code === 'KINOPOISK_AUTH' && error.status === 401
    );
    assert.equal(calls, 3);
    assert.equal(marked, 0);

    calls = 0;
    KINOPOISK_CONFIG.currentKeyIndex = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return {
            ...response(429, { message: 'too many requests' }),
            headers: { get: () => '0' }
        };
    };
    await assert.rejects(
        service._fetchWithRotation('https://api.example.test/movie/1'),
        (error) => error.code === 'KINOPOISK_RATE_LIMITED' && error.status === 429
    );
    assert.equal(calls, 3);

    calls = 0;
    KINOPOISK_CONFIG.currentKeyIndex = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return response(503, { message: 'service unavailable' });
    };
    await assert.rejects(
        service._fetchWithRotation('https://api.example.test/movie/1'),
        (error) => error.code === 'KINOPOISK_SERVER' && error.status === 503
    );
    assert.equal(calls, 3);

    calls = 0;
    marked = 0;
    KINOPOISK_CONFIG.currentKeyIndex = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return response(402, { message: 'daily quota reached' });
    };
    await assert.rejects(
        service._fetchWithRotation('https://api.example.test/movie/1'),
        (error) => error.name === 'QuotaExhaustedError' && error.code === 'DAILY_LIMIT_REACHED'
    );
    assert.equal(calls, 3);
    assert.equal(marked, 1);

    exhausted = true;
    calls = 0;
    await assert.rejects(
        service._fetchWithRotation('https://api.example.test/movie/1'),
        (error) => error.name === 'QuotaExhaustedError'
    );
    assert.equal(calls, 0);

    console.log('Kinopoisk quota circuit-breaker classification contract passed');
}

run()
    .finally(() => {
        KINOPOISK_CONFIG.API_KEYS = originalKeys;
        KINOPOISK_CONFIG.currentKeyIndex = originalIndex;
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
