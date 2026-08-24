const assert = require('node:assert/strict');
const {
    createKinopoiskProxyHandler,
    parseKinopoiskApiKeys,
    parseKinopoiskTarget
} = require('../functions/kinopoiskProxy.js');

function request(overrides = {}) {
    return {
        method: 'GET',
        headers: {},
        query: { path: '/v1.4/movie/123' },
        ...overrides
    };
}

function response(status, body = '{}', headers = {}) {
    return {
        status,
        headers: {
            get(name) {
                return headers[name] || headers[name.toLowerCase()] || null;
            }
        },
        async text() {
            return body;
        }
    };
}

function createTestResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        set(name, value) {
            this.headers[name] = value;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        }
    };
}

async function run() {
    assert.deepEqual(parseKinopoiskApiKeys('["one", "two", "one"]'), ['one', 'two']);
    assert.deepEqual(parseKinopoiskApiKeys('one\ntwo,three'), ['one', 'two', 'three']);
    assert.equal(parseKinopoiskTarget('/v1.4/movie/1').pathname, '/v1.4/movie/1');
    assert.throws(() => parseKinopoiskTarget('https://evil.example/v1.4/movie/1'));
    assert.throws(() => parseKinopoiskTarget('/v1/movie/1'));

    let secretReads = 0;
    const noAuthHandler = createKinopoiskProxyHandler({
        getSecretValue: async () => {
            secretReads += 1;
            return '["test-key"]';
        },
        verifyIdToken: async () => {},
        fetchImpl: async () => response(200, '{}'),
        sleepImpl: async () => {}
    });
    const noAuthResult = createTestResponse();
    await noAuthHandler(request(), noAuthResult);
    assert.equal(noAuthResult.statusCode, 401);
    assert.equal(noAuthResult.body.error.code, 'AUTH_REQUIRED');
    assert.equal(secretReads, 0);

    let calls = 0;
    const authRotationHandler = createKinopoiskProxyHandler({
        getSecretValue: async () => '["test-key-1", "test-key-2"]',
        verifyIdToken: async () => {},
        fetchImpl: async () => {
            calls += 1;
            return calls === 1
                ? response(401, '{"message":"invalid key"}')
                : response(200, '{"id":123}', { 'content-type': 'application/json' });
        },
        sleepImpl: async () => {}
    });
    const authRotationResult = createTestResponse();
    await authRotationHandler(request({ headers: { authorization: 'Bearer firebase-token' } }), authRotationResult);
    assert.equal(authRotationResult.statusCode, 200);
    assert.equal(calls, 2);

    calls = 0;
    const rotationHandler = createKinopoiskProxyHandler({
        getSecretValue: async () => '["test-key-1", "test-key-2"]',
        verifyIdToken: async (token) => assert.equal(token, 'firebase-token'),
        fetchImpl: async () => {
            calls += 1;
            return response(403, '{"message":"forbidden"}');
        },
        sleepImpl: async () => {}
    });
    const rotationResult = createTestResponse();
    await rotationHandler(request({ headers: { authorization: 'Bearer firebase-token' } }), rotationResult);
    assert.equal(rotationResult.statusCode, 503);
    assert.equal(rotationResult.body.error.code, 'KP_QUOTA_EXHAUSTED');
    assert.equal(calls, 2);

    calls = 0;
    const serverRetryHandler = createKinopoiskProxyHandler({
        getSecretValue: async () => '["test-key"]',
        verifyIdToken: async () => {},
        fetchImpl: async () => {
            calls += 1;
            return response(503, '{"message":"temporarily unavailable"}');
        },
        sleepImpl: async () => {}
    });
    const serverRetryResult = createTestResponse();
    await serverRetryHandler(request({ headers: { authorization: 'Bearer firebase-token' } }), serverRetryResult);
    assert.equal(serverRetryResult.statusCode, 502);
    assert.equal(serverRetryResult.body.error.code, 'KP_UPSTREAM_UNAVAILABLE');
    assert.equal(calls, 2);

    calls = 0;
    const retryHandler = createKinopoiskProxyHandler({
        getSecretValue: async () => '["test-key"]',
        verifyIdToken: async () => {},
        fetchImpl: async () => {
            calls += 1;
            return calls === 1
                ? response(429, '{}', { 'Retry-After': '0' })
                : response(200, '{"id":123}', { 'content-type': 'application/json' });
        },
        sleepImpl: async () => {}
    });
    const retryResult = createTestResponse();
    await retryHandler(request({ headers: { authorization: 'Bearer firebase-token' } }), retryResult);
    assert.equal(retryResult.statusCode, 200);
    assert.equal(retryResult.body, '{"id":123}');
    assert.equal(calls, 2);

    let invalidTargetCalls = 0;
    const invalidTargetHandler = createKinopoiskProxyHandler({
        getSecretValue: async () => '["test-key"]',
        verifyIdToken: async () => {},
        fetchImpl: async () => {
            invalidTargetCalls += 1;
            return response(200, '{}');
        },
        sleepImpl: async () => {}
    });
    const invalidTargetResult = createTestResponse();
    await invalidTargetHandler(request({
        headers: { authorization: 'Bearer firebase-token' },
        query: { path: 'https://evil.example/v1.4/movie/1' }
    }), invalidTargetResult);
    assert.equal(invalidTargetResult.statusCode, 400);
    assert.equal(invalidTargetCalls, 0);

    console.log('Kinopoisk proxy auth, allowlist, rotation, and retry contract passed');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
