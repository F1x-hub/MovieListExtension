const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { exchangeJwtForAccessToken } = require('../scripts/create-google-access-token.cjs');

const originalFetch = global.fetch;
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = {
    client_email: 'updater-audit@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
};

(async () => {
    let attempts = 0;
    global.fetch = async () => {
        attempts += 1;
        if (attempts < 3) return { ok: false, status: 503 };
        return { ok: true, status: 200, json: async () => ({ access_token: 'test-access-token' }) };
    };
    const token = await exchangeJwtForAccessToken(credentials);
    assert.equal(token, 'test-access-token');
    assert.equal(attempts, 3, 'transient OAuth failures must be retried up to three total attempts');

    attempts = 0;
    global.fetch = async () => {
        attempts += 1;
        return { ok: false, status: 403 };
    };
    await assert.rejects(
        exchangeJwtForAccessToken(credentials),
        /HTTP 403/
    );
    assert.equal(attempts, 1, 'permission failures must fail without retrying');
    console.log('googleAccessToken.test.cjs passed');
})().finally(() => {
    global.fetch = originalFetch;
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
