const assert = require('node:assert/strict');
const { createSpotifyTokenHandler } = require('../functions/spotifyToken.js');

function createRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) { this.statusCode = code; return this; },
        set(name, value) { this.headers[name] = value; return this; },
        json(body) { this.body = body; return this; },
        send(body) { this.body = body; return this; }
    };
}

function request(overrides = {}) {
    return { method: 'GET', headers: { authorization: 'Bearer id-token' }, ...overrides };
}

function spotifyResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function run() {
    const silent = { error() {} };
    let clock = 1_000_000;
    let upstreamCalls = 0;
    let lastUpstream = null;
    const handler = createSpotifyTokenHandler({
        getCredentials: async () => ({ clientId: 'id', clientSecret: 'secret' }),
        verifyIdToken: async (token) => { if (token !== 'id-token') throw new Error('bad token'); },
        fetchImpl: async (url, options) => {
            upstreamCalls += 1;
            lastUpstream = { url, options };
            return spotifyResponse(200, { access_token: `spotify-${upstreamCalls}`, expires_in: 3600 });
        },
        now: () => clock,
        logger: silent
    });

    // Guests, bad tokens, wrong methods and foreign origins never reach Spotify.
    let res = createRes();
    await handler(request({ headers: {} }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');

    res = createRes();
    await handler(request({ headers: { authorization: 'Bearer forged' } }), res);
    assert.equal(res.statusCode, 401);

    res = createRes();
    await handler(request({ method: 'POST' }), res);
    assert.equal(res.statusCode, 405);

    res = createRes();
    await handler(request({ headers: { authorization: 'Bearer id-token', origin: 'https://evil.example' } }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(upstreamCalls, 0, 'rejected requests must not call Spotify');

    // A signed-in extension request receives a token and nothing about the secret.
    res = createRes();
    await handler(request({ headers: { authorization: 'Bearer id-token', origin: 'chrome-extension://abc' } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { token: 'spotify-1', expiresInSec: 3600 });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(lastUpstream.url, 'https://accounts.spotify.com/api/token');
    assert.equal(lastUpstream.options.headers.Authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
    assert.equal(JSON.stringify(res.body).includes('secret'), false);

    // The token is reused until shortly before it expires.
    clock += 30 * 60 * 1000;
    res = createRes();
    await handler(request(), res);
    assert.equal(res.body.token, 'spotify-1');
    assert.equal(upstreamCalls, 1);

    clock += 31 * 60 * 1000;
    res = createRes();
    await handler(request(), res);
    assert.equal(res.body.token, 'spotify-2');
    assert.equal(upstreamCalls, 2);

    // Missing credentials and upstream failures are generic errors.
    const unconfigured = createSpotifyTokenHandler({
        getCredentials: async () => ({ clientId: '', clientSecret: '' }),
        verifyIdToken: async () => {},
        fetchImpl: async () => { throw new Error('must not be called'); },
        logger: silent
    });
    res = createRes();
    await unconfigured(request(), res);
    assert.equal(res.statusCode, 503);

    const failing = createSpotifyTokenHandler({
        getCredentials: async () => ({ clientId: 'id', clientSecret: 'secret' }),
        verifyIdToken: async () => {},
        fetchImpl: async () => spotifyResponse(400, { error: 'invalid_client', error_description: 'Invalid client secret' }),
        logger: silent
    });
    res = createRes();
    await failing(request(), res);
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.stringify(res.body).includes('Invalid client secret'), false, 'upstream detail must not leak');

    console.log('Spotify token proxy tests passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
