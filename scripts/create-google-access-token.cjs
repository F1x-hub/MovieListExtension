const fs = require('node:fs');
const crypto = require('node:crypto');

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function readCredentials() {
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.GOOGLE_GHA_CREDS_PATH;
    const raw = credentialsPath
        ? fs.readFileSync(credentialsPath, 'utf8')
        : process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Google service-account credentials are unavailable');

    let credentials;
    try {
        credentials = JSON.parse(raw);
    } catch {
        throw new Error('Google service-account credentials are not valid JSON');
    }
    if (!credentials.client_email || !credentials.private_key) {
        throw new Error('Google service-account credentials must contain client_email and private_key');
    }
    return credentials;
}

function base64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function createJwtAssertion(credentials, now = Math.floor(Date.now() / 1000)) {
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64Url(JSON.stringify({
        iss: credentials.client_email,
        scope: process.env.GOOGLE_OAUTH_SCOPE || DEFAULT_SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: now,
        exp: now + 3600
    }));
    const unsigned = `${header}.${payload}`;
    const signature = crypto
        .createSign('RSA-SHA256')
        .update(unsigned)
        .sign(credentials.private_key, 'base64url');
    return `${unsigned}.${signature}`;
}

async function exchangeJwtForAccessToken(credentials) {
    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: createJwtAssertion(credentials)
    });
    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Google OAuth token exchange failed with HTTP ${response.status}`);
    const result = await response.json();
    if (!result.access_token) throw new Error('Google OAuth token exchange returned no access token');
    return result.access_token;
}

function writeTokenToGithubEnvironment(token) {
    const environmentFile = process.env.GITHUB_ENV;
    if (!environmentFile) throw new Error('GITHUB_ENV is unavailable; cannot pass the access token to later steps');
    process.stdout.write(`::add-mask::${token}\n`);
    fs.appendFileSync(environmentFile, `GOOGLE_ACCESS_TOKEN=${token}\n`, 'utf8');
}

async function main() {
    const token = await exchangeJwtForAccessToken(readCredentials());
    writeTokenToGithubEnvironment(token);
    console.log('Created a short-lived Google OAuth token for Firebase Hosting verification.');
}

module.exports = { base64Url, createJwtAssertion, exchangeJwtForAccessToken, readCredentials };

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
