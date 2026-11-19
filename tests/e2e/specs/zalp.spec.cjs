/**
 * Networked Salvo (Залп) with two real browsers. Alice is the rig's usual signed-in user; Bob gets a second
 * Chromium with the same build. Both pages run unmodified against the Firestore and Auth emulators under the
 * real rules; the `zalp` Cloud Function is the real module (functions/zalp.js) answering in this process
 * through firebase-admin on the emulators.
 *
 * Alice opens a room, Bob joins by the link, Alice starts. Each of the first two turns is played with the
 * keyboard on the page whose turn it is and replayed on the other from the stream; a replay that ends in a
 * different state logs "came out different" and fails the test. Then Alice gives up and Bob wins.
 */
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, emulator } = require('../lib/fixtures.cjs');
const config = require('../lib/config.cjs');
const { launchExtensionContext } = require('../../helpers/extensionContext.cjs');
const { installInitScripts } = require('../lib/initScripts.cjs');
const { installTmdb } = require('../lib/externalWorld.cjs');

process.env.FIRESTORE_EMULATOR_HOST ||= `${config.FIRESTORE_HOST}:${config.FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= new URL(config.AUTH_ORIGIN).host;
const functionsModules = path.join(config.ROOT, 'functions', 'node_modules');
const adminApp = require(path.join(functionsModules, 'firebase-admin', 'lib', 'app', 'index.js'));
const adminAuth = require(path.join(functionsModules, 'firebase-admin', 'lib', 'auth', 'index.js'));
const adminFirestore = require(path.join(functionsModules, 'firebase-admin', 'lib', 'firestore', 'index.js'));
const { createZalpHandler } = require(path.join(config.ROOT, 'functions', 'zalp.js'));

const HEADED = process.env.E2E_HEADED === '1';
const RIVAL = { uid: 'e2e-user-2', email: 'e2e-rival@example.test', password: 'e2e-password-2', displayName: 'E2E Rival' };
const PAGE = 'src/pages/zalp/zalp.html';
const SHOTS_DIR = path.join(config.OUTPUT_DIR, 'zalp');

function admin() {
    const name = 'zalp-e2e';
    const app = adminApp.getApps().find((candidate) => candidate.name === name)
        || adminApp.initializeApp({ projectId: config.PROJECT_ID }, name);
    return { db: adminFirestore.getFirestore(app), auth: adminAuth.getAuth(app) };
}

/** Answers the page's calls to the Cloud Function with the real handler. */
async function routeFunction(context, handler, calls) {
    await context.route(/^https:\/\/us-central1-[^/]+\.cloudfunctions\.net\/zalp/, async (route) => {
        const request = route.request();
        const headers = request.headers();
        let body = {};
        try { body = JSON.parse(request.postData() || '{}'); } catch { body = {}; }
        calls.push(body.action);
        const answer = { status: 200, headers: {}, body: '' };
        const res = {
            status(code) { answer.status = code; return this; },
            set(name, value) { answer.headers[name] = String(value); return this; },
            json(payload) { answer.headers['content-type'] = 'application/json'; answer.body = JSON.stringify(payload); return this; },
            send(payload) { answer.body = String(payload ?? ''); return this; },
        };
        await handler({ method: request.method(), body, get: (header) => headers[String(header).toLowerCase()] }, res);
        await route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
    });
}

async function launchRival(extension) {
    await emulator.createUser(RIVAL);
    await emulator.putDocument(`users/${RIVAL.uid}`, { displayName: RIVAL.displayName, email: RIVAL.email, approvalStatus: 'approved', isAdmin: false });
    const harness = await launchExtensionContext({
        extensionPath: config.EXTENSION_PATH,
        fixtureOrigin: config.AUTH_ORIGIN,
        additionalFixtureOrigins: [config.FIRESTORE_ORIGIN],
        headless: !HEADED,
        contextOptions: { viewport: config.VIEWPORT, timezoneId: config.TIMEZONE, deviceScaleFactor: 1 },
    });
    expect(harness.extensionId, 'both browsers run the same extension').toBe(extension.id);
    await installInitScripts(harness.context, {
        pinnedDate: config.PINNED_DATE, projectId: config.PROJECT_ID, authOrigin: config.AUTH_ORIGIN,
        firestoreHost: config.FIRESTORE_HOST, firestorePort: config.FIRESTORE_PORT,
    });
    await installTmdb(harness.context);
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${extension.id}/src/pages/home/home.html`);
    await page.waitForFunction(() => globalThis.firebaseManager?.isInitialized);
    const projectId = await page.evaluate(({ email, password }) => globalThis.firebaseManager
        .signInWithEmail(email, password)
        .then(() => globalThis.firebase.apps[0].options.projectId), RIVAL);
    if (projectId !== config.PROJECT_ID) throw new Error(`Refusing to run against Firebase project "${projectId}"`);
    return { harness, page };
}

async function shot(page, name) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), animations: 'disabled' });
}

/** The page's game as the test needs it, or null in the menu. */
function zalpState(page) {
    return page.evaluate(async () => {
        const { Z } = await import(chrome.runtime.getURL('src/shared/games/zalp/ZalpCore.js'));
        const g = Z.UI?.game;
        if (!g || g.demo) return null;
        return { online: g.online, state: g.state, turn: g.turnNo, craters: g.craters.length, local: g.localTurn, hp: g.units.map((u) => u.hp) };
    });
}

function watchWarnings(page, into) {
    page.on('console', (message) => {
        const text = message.text();
        if (/came out different|ran past its stream/.test(text)) into.push(text);
    });
}

test('two players: a room, two turns replayed alike, then one gives up', async ({ page: alice, extension }) => {
    test.setTimeout(300000);
    const { db, auth } = admin();
    const handler = createZalpHandler({ db, auth });
    const calls = [];
    const warnings = [];
    await routeFunction(extension.context, handler, calls);
    const bob = await launchRival(extension);
    await routeFunction(bob.harness.context, handler, calls);
    watchWarnings(alice, warnings);
    watchWarnings(bob.page, warnings);
    try {
        await alice.goto(`chrome-extension://${extension.id}/${PAGE}`);
        await alice.click('label[for=zlModeOnline]');
        await expect(alice.locator('#zlOnlineReady')).toBeVisible({ timeout: 20000 });
        await alice.click('#zlCreate');
        await expect(alice.locator('#zlRoom')).toBeVisible({ timeout: 20000 });
        const code = (await alice.locator('#zlRoomCode').textContent()).trim();
        expect(code).toMatch(/^[A-Z0-9]{6}$/);

        await bob.page.goto(`chrome-extension://${extension.id}/${PAGE}?game=${code}`);
        await expect(bob.page.locator('#zlRoom')).toBeVisible({ timeout: 20000 });
        await expect(alice.locator('#zlRoomPlayers li')).toHaveCount(2);
        await expect(alice.locator('#zlRoomSplit')).toHaveText(/one on one|Один на один/i);
        await shot(alice, 'room');
        await alice.click('#zlRoomStart');

        for (let turn = 1; turn <= 2; turn++) {
            await expect.poll(async () => {
                const [a, b] = [await zalpState(alice), await zalpState(bob.page)];
                return Boolean(a && b && a.turn === turn && b.turn === turn && a.local !== b.local);
            }, { timeout: 60000, message: `both pages are in turn ${turn}, one of them plays it` }).toBe(true);
            const shooter = (await zalpState(alice)).local ? alice : bob.page;
            await shooter.keyboard.down('ArrowUp'); await shooter.waitForTimeout(250); await shooter.keyboard.up('ArrowUp');
            await shooter.keyboard.down('Space'); await shooter.waitForTimeout(650); await shooter.keyboard.up('Space');
            if (turn === 1) { await shooter.waitForTimeout(700); await shot(shooter, 'turn1-flight'); }
            await expect.poll(async () => {
                const [a, b] = [await zalpState(alice), await zalpState(bob.page)];
                return Boolean(a && b && a.turn > turn && b.turn > turn);
            }, { timeout: 120000, message: `both pages finished turn ${turn} and moved on` }).toBe(true);
            const game = (await db.collection('zalpGames').doc(code).get()).data();
            expect(game.snapshot.n).toBe(turn);
            const [a, b] = [await zalpState(alice), await zalpState(bob.page)];
            expect(a.hp, 'both pages agree on every fighter').toEqual(game.snapshot.units.map((u) => u.hp));
            expect(b.hp).toEqual(game.snapshot.units.map((u) => u.hp));
            expect(warnings, 'no replay came out different').toEqual([]);
        }
        expect(calls.filter((c) => c === 'stream').length, 'turns were streamed while they were played').toBeGreaterThan(2);
        expect(calls.filter((c) => c === 'endTurn').length).toBe(2);
        await shot(bob.page, 'turn3-spectator');

        await alice.click('#zlPauseBtn');
        await alice.click('#zlQuit');
        await expect(bob.page.locator('#zlResult')).toBeVisible({ timeout: 60000 });
        await expect(bob.page.locator('#zlResultTitle')).toHaveText(/Victory|Победа/);
        await shot(bob.page, 'result');
        const final = (await db.collection('zalpGames').doc(code).get()).data();
        expect(final.status).toBe('finished');
        expect(warnings).toEqual([]);
    } finally {
        await bob.harness.close();
    }
});
