/**
 * Everything outside the extension. TMDB traffic is answered locally and
 * Firebase talks to the emulators; every other host stays blocked by the
 * browser-level proxy in tests/helpers/extensionContext.cjs.
 */
const { AUTH_ORIGIN, FIRESTORE_ORIGIN, PROJECT_ID } = require('./config.cjs');
const { respond, posterSvg } = require('./catalog.cjs');

const JSON_HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };

async function answerTmdb(route, tmdbUrl) {
    const body = respond(tmdbUrl);
    await route.fulfill(body
        ? { status: 200, headers: JSON_HEADERS, body: JSON.stringify(body) }
        : { status: 404, headers: JSON_HEADERS, body: '{"success":false,"status_code":34}' });
}

async function installTmdb(context) {
    await context.route(/^https:\/\/us-central1-[^/]+\.cloudfunctions\.net\/tmdbProxy/, route => {
        const target = new URL(route.request().url()).searchParams.get('url');
        return answerTmdb(route, target);
    });
    await context.route(/^https:\/\/api\.themoviedb\.org\/3\//, route => answerTmdb(route, route.request().url()));
    await context.route(/^https:\/\/image\.tmdb\.org\//, route => {
        const match = /e2e-(poster|backdrop)-(\d+)/.exec(route.request().url());
        if (!match) return route.fulfill({ status: 404 });
        return route.fulfill({
            status: 200,
            headers: { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' },
            body: posterSvg(match[2], match[1])
        });
    });
}

/**
 * Live mode: the film's card. The Kinopoisk proxy accepts only a production
 * sign-in, so a card is a fixed record; finding and playing the film stay real.
 */
async function installFilmCards(context, films) {
    await context.route(/^https:\/\/us-central1-[^/]+\.cloudfunctions\.net\/kinopoiskProxy/, route => {
        const path = new URL(route.request().url()).searchParams.get('path') || '';
        const id = Number(/\/movie\/(\d+)$/.exec(path)?.[1]);
        const film = films.find(candidate => candidate.id === id);
        return route.fulfill(film
            ? { status: 200, headers: JSON_HEADERS, body: JSON.stringify(film) }
            : { status: 404, headers: JSON_HEADERS, body: '{"statusCode":404}' });
    });
}

const OWNER = { Authorization: 'Bearer owner', 'content-type': 'application/json' };
const DOCUMENTS = `${FIRESTORE_ORIGIN}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function request(url, options, what) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`${what}: HTTP ${response.status} ${await response.text()}`);
    return response.json();
}

function toFirestoreValue(value) {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (Number.isInteger(value)) return { integerValue: String(value) };
    if (typeof value === 'number') return { doubleValue: value };
    if (value === null) return { nullValue: null };
    throw new Error(`Unsupported seed value: ${value}`);
}

function fromFirestoreValue(value) {
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('nullValue' in value) return null;
    if ('timestampValue' in value) return value.timestampValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
    if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
    return value;
}

function fromFirestoreFields(fields) {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]));
}

/** Direct emulator access for the test itself; the extension goes through real rules. */
const emulator = {
    async reset() {
        await request(`${FIRESTORE_ORIGIN}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE', headers: OWNER }, 'clear Firestore');
        await request(`${AUTH_ORIGIN}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE', headers: OWNER }, 'clear Auth');
    },
    async createUser({ uid, email, password, displayName }) {
        await request(`${AUTH_ORIGIN}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`, {
            method: 'POST',
            headers: OWNER,
            body: JSON.stringify({ localId: uid, email, password, displayName, emailVerified: true })
        }, 'create user');
    },
    async putDocument(path, fields) {
        await request(`${DOCUMENTS}/${path}`, {
            method: 'PATCH',
            headers: OWNER,
            body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, toFirestoreValue(value)])) })
        }, `write ${path}`);
    },
    async listDocuments(collection) {
        const { documents = [] } = await request(`${DOCUMENTS}/${collection}`, { headers: OWNER }, `list ${collection}`);
        return documents.map(document => ({ id: document.name.split('/').pop(), ...fromFirestoreFields(document.fields || {}) }));
    }
};

module.exports = { installTmdb, installFilmCards, emulator };
