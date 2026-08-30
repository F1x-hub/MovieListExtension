const assert = require('node:assert/strict');

const KINOPOISK_CONFIG = require('../src/shared/config/kinopoisk.config.js');
assert.equal(KINOPOISK_CONFIG.QUOTA_STORAGE_KEY, 'kp_quota_exhausted_until_v2');
globalThis.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
globalThis.quotaTracker = { track() {} };
globalThis.chrome = {
    runtime: {
        sendMessage: async () => ({ success: true, token: 'firebase-token' })
    }
};

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
const targetUrl = `${KINOPOISK_CONFIG.BASE_URL}/movie/1`;

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
        return response(401, { error: { code: 'AUTH_REQUIRED' } });
    };
    await assert.rejects(
        service._fetchWithRotation(targetUrl),
        (error) => error.code === 'KINOPOISK_AUTH' && error.status === 401
    );
    assert.equal(calls, 1);

    calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return response(503, { error: { code: 'KP_QUOTA_EXHAUSTED' } });
    };
    marked = 0;
    await assert.rejects(
        service._fetchWithRotation(targetUrl),
        (error) => error.name === 'QuotaExhaustedError' && error.code === 'DAILY_LIMIT_REACHED'
    );
    assert.equal(calls, 1);
    assert.equal(marked, 1);

    calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return response(429, { error: { code: 'KP_UPSTREAM_UNAVAILABLE' } });
    };
    await assert.rejects(
        service._fetchWithRotation(targetUrl),
        (error) => error.code === 'KINOPOISK_RATE_LIMITED' && error.status === 429
    );
    assert.equal(calls, 1);

    calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return response(503, { error: { code: 'KP_UPSTREAM_UNAVAILABLE' } });
    };
    await assert.rejects(
        service._fetchWithRotation(targetUrl),
        (error) => error.code === 'KINOPOISK_SERVER' && error.status === 503
    );
    assert.equal(calls, 1);

    calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        throw new Error('network down');
    };
    await assert.rejects(
        service._fetchWithRotation(targetUrl),
        (error) => error.code === 'KINOPOISK_NETWORK'
    );
    assert.equal(calls, 1);

    exhausted = true;
    calls = 0;
    await assert.rejects(
        service._fetchWithRotation(targetUrl),
        (error) => error.name === 'QuotaExhaustedError'
    );
    assert.equal(calls, 0);

    console.log('Kinopoisk proxy transport and quota circuit-breaker contract passed');
}

run()
    .finally(() => {
        delete globalThis.fetch;
        delete globalThis.chrome;
        delete globalThis.KINOPOISK_CONFIG;
        delete globalThis.kinopoiskQuota;
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
