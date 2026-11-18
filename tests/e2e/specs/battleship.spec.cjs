/**
 * Networked Battleship with two real browsers. Alice is the rig's usual signed-in
 * user; Bob gets a second Chromium with the same build. Both pages run unmodified
 * against the Firestore and Auth emulators under the real rules. The `battleship`
 * Cloud Function is the real module (functions/battleship.js) answering in this
 * process through firebase-admin on the emulators, so every shot is refereed by
 * the server code that ships.
 *
 * Cells are pointed at on whichever board the browser gets: the WebGL board
 * where WebGL works, the flat grid where it does not; both answer
 * `screenPoint()`. The cell attributes checked below belong to the grid, which
 * the WebGL board keeps (invisible) for the keyboard and screen readers.
 */
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, emulator, storeTheme } = require('../lib/fixtures.cjs');
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
const { createBattleshipHandler } = require(path.join(config.ROOT, 'functions', 'battleship.js'));
const Rules = require(path.join(config.ROOT, 'functions', 'battleshipRules.js'));

const HEADED = process.env.E2E_HEADED === '1';
const RIVAL = { uid: 'e2e-user-2', email: 'e2e-rival@example.test', password: 'e2e-password-2', displayName: 'E2E Rival' };
const PAGE = 'src/pages/battleship/battleship.html';
const SHOTS_DIR = path.join(config.OUTPUT_DIR, 'battleship');

// Alice places this fleet by hand; Bob shoots only at the water around it.
const ALICE_FLEET = [
    { x: 0, y: 0, length: 4, vertical: false },
    { x: 0, y: 2, length: 3, vertical: true },
    { x: 5, y: 2, length: 3, vertical: false },
    { x: 9, y: 0, length: 2, vertical: true },
    { x: 2, y: 6, length: 2, vertical: false },
    { x: 9, y: 4, length: 2, vertical: true },
    { x: 5, y: 0, length: 1, vertical: false },
    { x: 5, y: 5, length: 1, vertical: false },
    { x: 0, y: 9, length: 1, vertical: false },
    { x: 9, y: 9, length: 1, vertical: false }
];

function admin() {
    const name = 'battleship-e2e';
    const app = adminApp.getApps().find(candidate => candidate.name === name)
        || adminApp.initializeApp({ projectId: config.PROJECT_ID }, name);
    return { db: adminFirestore.getFirestore(app), auth: adminAuth.getAuth(app) };
}

/** Answers the page's calls to the Cloud Function with the real handler. */
async function routeFunction(context, handler, calls) {
    await context.route(/^https:\/\/us-central1-[^/]+\.cloudfunctions\.net\/battleship/, async route => {
        const request = route.request();
        const headers = request.headers();
        let body = {};
        try {
            body = JSON.parse(request.postData() || '{}');
        } catch {
            body = {};
        }
        calls.push(body.action);
        const answer = { status: 200, headers: {}, body: '' };
        const res = {
            status(code) { answer.status = code; return this; },
            set(name, value) { answer.headers[name] = String(value); return this; },
            json(payload) { answer.headers['content-type'] = 'application/json'; answer.body = JSON.stringify(payload); return this; },
            send(payload) { answer.body = String(payload ?? ''); return this; }
        };
        await handler({ method: request.method(), body, get: header => headers[String(header).toLowerCase()] }, res);
        await route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
    });
}

async function launchRival(extension) {
    await emulator.createUser(RIVAL);
    await emulator.putDocument(`users/${RIVAL.uid}`, {
        displayName: RIVAL.displayName,
        email: RIVAL.email,
        approvalStatus: 'approved',
        isAdmin: false
    });
    const harness = await launchExtensionContext({
        extensionPath: config.EXTENSION_PATH,
        fixtureOrigin: config.AUTH_ORIGIN,
        additionalFixtureOrigins: [config.FIRESTORE_ORIGIN],
        headless: !HEADED,
        contextOptions: { viewport: config.VIEWPORT, timezoneId: config.TIMEZONE, deviceScaleFactor: 1 }
    });
    expect(harness.extensionId, 'both browsers run the same extension').toBe(extension.id);
    await installInitScripts(harness.context, {
        pinnedDate: config.PINNED_DATE,
        projectId: config.PROJECT_ID,
        authOrigin: config.AUTH_ORIGIN,
        firestoreHost: config.FIRESTORE_HOST,
        firestorePort: config.FIRESTORE_PORT
    });
    await installTmdb(harness.context);
    const pinned = new Date(config.PINNED_DATE).getTime();
    // Mini-games on, so Bob's other pages carry the Battleship notices.
    await harness.worker.evaluate(seed => chrome.storage.local.set(seed), {
        showGames: true,
        hubPromptV1: { reason: 'missing', until: pinned + 365 * 24 * 60 * 60 * 1000 }
    });
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
    await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: true, animations: 'disabled' });
}

const cell = (page, board, index) => page.locator(`#${board} .bs-cell[data-index="${index}"]`);

/**
 * Where a cell is on screen, asked from the board once its camera matches the
 * canvas (a board shown a moment ago may not have taken its size yet).
 */
async function cellPoint(page, board, index) {
    let point = null;
    await expect.poll(async () => {
        point = await page.evaluate(({ board, index }) => {
            const view = globalThis.battleshipPage?.gameView;
            const target = board === 'bsOwnBoard' ? view?.ownBoard : view?.enemyBoard;
            if (!target) return null;
            const settled = !target.canvas || target.flat
                || (target.viewport?.width === target.container.clientWidth && target.viewport?.height === target.container.clientHeight);
            const box = document.getElementById(board).getBoundingClientRect();
            const spot = settled ? target.screenPoint(index) : null;
            return spot && box.width > 0 && spot.x > box.left && spot.x < box.right && spot.y > box.top && spot.y < box.bottom ? spot : null;
        }, { board, index });
        return point !== null;
    }, { message: `${board} shows cell ${index}` }).toBe(true);
    return point;
}

async function hoverCell(page, board, index) {
    const { x, y } = await cellPoint(page, board, index);
    await page.mouse.move(x, y);
}

async function clickCell(page, board, index) {
    const { x, y } = await cellPoint(page, board, index);
    await page.mouse.click(x, y);
}

async function dragCell(page, board, from, to) {
    const start = await cellPoint(page, board, from);
    const end = await cellPoint(page, board, to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
}

/**
 * Pages hide horizontal scrolling (body overflow-x), so an element pushed past
 * the edge would only be cut off: compare the boxes with the window instead.
 */
async function expectInsideWindow(page, label) {
    const outside = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return [...document.querySelectorAll('#bsGame .bs-game__top > *, #bsGame .bs-banner, #bsGame .bs-arena, #bsGame .bs-side, #bsGame .bs-ready-btn, #bsGame .bs-dock__ship')]
            .filter(element => element.getClientRects().length > 0)
            .map(element => {
                const box = element.getBoundingClientRect();
                return { what: element.id || element.className, left: Math.floor(box.left), right: Math.ceil(box.right) };
            })
            .filter(box => box.left < 0 || box.right > width);
    });
    expect(outside, `${label}: nothing sticks out of the window`).toEqual([]);
}

test('two players play a full game, a rematch and a direct challenge', async ({ page: alice, extension }) => {
    test.setTimeout(240_000);
    const { db, auth } = admin();
    const calls = [];
    const handler = createBattleshipHandler({ db, auth });
    await routeFunction(extension.context, handler, calls);
    const { harness, page: bob } = await launchRival(extension);
    const bobErrors = [];
    bob.on('pageerror', error => bobErrors.push(error.message));
    await routeFunction(harness.context, handler, calls);
    const aliceUid = config.TEST_USER.uid;
    const url = query => extension.url(`${PAGE}${query || ''}`);

    try {
        let code;
        await test.step('Alice creates a game by code, Bob joins it with the typed code', async () => {
            await alice.goto(url());
            await expect(alice.locator('#bsLobby')).toBeVisible();
            await expect(alice.locator('#bsMyGames .bs-empty')).toBeVisible();
            await shot(alice, 'lobby-dark');
            await alice.locator('[data-action="create-private"]').click();
            await expect(alice.locator('.bs-code__value')).toHaveText(/^[A-Z2-9]{6}$/);
            code = (await alice.locator('.bs-code__value').textContent()).trim();
            await expect(alice).toHaveURL(new RegExp(`\\?game=${code}$`));
            await shot(alice, 'waiting-dark');

            await bob.goto(url());
            await expect(bob.locator('#bsLobby')).toBeVisible();
            await bob.locator('#bsJoinCode').fill('zz');
            await bob.locator('#bsJoinForm button[type="submit"]').click();
            await expect(bob.locator('#bsJoinError')).toBeVisible();
            await bob.locator('#bsJoinCode').fill(`${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()}`);
            await bob.locator('#bsJoinForm button[type="submit"]').click();
            await expect(bob).toHaveURL(new RegExp(`\\?game=${code}$`));
            await expect(bob.locator('#bsTools')).toBeVisible();
            await expect(alice.locator('#bsTools')).toBeVisible();
            await expect(alice.locator('#bsVersus')).toContainText(RIVAL.displayName);
        });

        await test.step('Alice places her fleet by hand; Bob takes a random one', async () => {
            await expect(alice.locator('#bsReadyBtn')).toBeDisabled();
            // The WebGL board wherever the browser has WebGL, the flat grid otherwise.
            const threeD = await alice.evaluate(() => Boolean(globalThis.battleshipPage.Board3D));
            await expect(alice.locator('#bsOwnBoard .bs-board3d.is-3d canvas')).toHaveCount(threeD ? 1 : 0);
            await expect(alice.locator('[data-action="board-view"]')).toHaveCount(threeD ? 1 : 0);
            test.info().annotations.push({ type: 'board', description: threeD ? 'WebGL' : 'flat' });
            let vertical = false;
            for (const ship of ALICE_FLEET) {
                if (ship.length > 1 && ship.vertical !== vertical) {
                    await alice.locator('[data-action="rotate"]').click();
                    vertical = ship.vertical;
                }
                const index = Rules.toIndex(ship.x, ship.y);
                await hoverCell(alice, 'bsOwnBoard', index);
                await expect(cell(alice, 'bsOwnBoard', index)).toHaveAttribute('data-preview', 'valid');
                await clickCell(alice, 'bsOwnBoard', index);
            }
            await expect(alice.locator('#bsOwnBoard .bs-cell[data-ship]')).toHaveCount(20);
            // A ship dragged onto another is refused and returns to its place.
            await dragCell(alice, 'bsOwnBoard', Rules.toIndex(5, 5), Rules.toIndex(6, 2));
            await expect(alice.locator('#bsPlacementStatus')).toHaveClass(/is-warning/);
            await expect(cell(alice, 'bsOwnBoard', Rules.toIndex(5, 5))).toHaveAttribute('data-ship', 'h-single');
            await expect(alice.locator('.bs-code-chip')).toBeInViewport();
            await expectInsideWindow(alice, 'placement');
            await shot(alice, 'placing-dark');
            await expect(alice.locator('#bsReadyBtn')).toBeEnabled();
            await alice.locator('#bsReadyBtn').click();
            await expect(alice.locator('#bsTools')).toBeHidden();
            await expect(alice.locator('#bsBanner')).toHaveAttribute('data-tone', 'wait');

            await bob.locator('[data-action="random"]').click();
            await expect(bob.locator('#bsOwnBoard .bs-cell[data-ship]')).toHaveCount(20);
            await bob.locator('#bsReadyBtn').click();
            await expect(bob.locator('#bsEnemyBoard')).toBeVisible();
            await expect(alice.locator('#bsEnemyBoard')).toBeVisible();
        });

        const gameRef = db.collection('battleshipGames').doc(code);
        const stored = (await gameRef.collection('fleets').doc(aliceUid).get()).data();
        expect(Rules.validateFleet(stored.ships).ships).toEqual(Rules.validateFleet(ALICE_FLEET).ships);

        await test.step('the rules keep each fleet away from the opponent', async () => {
            const outcome = await bob.evaluate(async ({ gameId, opponent }) => {
                const db = globalThis.firebaseManager.db;
                const me = globalThis.firebaseManager.auth.currentUser.uid;
                const attempt = async task => {
                    try {
                        await task();
                        return 'allowed';
                    } catch (error) {
                        return error.code;
                    }
                };
                return {
                    opponentFleet: await attempt(() => db.collection('battleshipGames').doc(gameId).collection('fleets').doc(opponent).get()),
                    ownFleet: await attempt(() => db.collection('battleshipGames').doc(gameId).collection('fleets').doc(me).get()),
                    gameWrite: await attempt(() => db.collection('battleshipGames').doc(gameId).update({ winnerUid: me })),
                    fleetWrite: await attempt(() => db.collection('battleshipGames').doc(gameId).collection('fleets').doc(me).set({ ships: [] })),
                    opponentPlayer: await attempt(() => db.collection('battleshipPlayers').doc(opponent).get()),
                    lobbyWrite: await attempt(() => db.collection('battleshipLobby').doc('open').set({ games: {} }))
                };
            }, { gameId: code, opponent: aliceUid });
            expect(outcome).toEqual({
                opponentFleet: 'permission-denied',
                ownFleet: 'allowed',
                gameWrite: 'permission-denied',
                fleetWrite: 'permission-denied',
                opponentPlayer: 'permission-denied',
                lobbyWrite: 'permission-denied'
            });
        });

        await test.step('they shoot in turns until Alice sinks the whole fleet', async () => {
            const bobFleet = (await gameRef.collection('fleets').doc(RIVAL.uid).get()).data().ships;
            const targets = bobFleet.flatMap(ship => Rules.shipCells(ship));
            const aliceShips = new Set(ALICE_FLEET.flatMap(ship => Rules.shipCells(Rules.normalizeShip(ship))));
            let bobShots = 0;
            let screenshotTaken = false;
            for (let guard = 0; guard < 80; guard += 1) {
                const game = (await gameRef.get()).data();
                if (game.status !== 'playing') break;
                const shooter = game.turnUid === aliceUid ? alice : bob;
                const other = shooter === alice ? bob : alice;
                await expect(shooter.locator('#bsBanner')).toHaveAttribute('data-tone', 'turn');
                await expect(other.locator('#bsBanner')).toHaveAttribute('data-tone', 'wait');
                let index;
                if (shooter === alice) {
                    index = targets.find(candidate => game.boards[RIVAL.uid][candidate] === '.');
                } else {
                    index = [...Array(100).keys()].find(candidate => !aliceShips.has(candidate) && game.boards[aliceUid][candidate] === '.');
                    bobShots += 1;
                }
                await clickCell(shooter, 'bsEnemyBoard', index);
                await expect.poll(async () => (await gameRef.get()).data().moveCount).toBe(game.moveCount + 1);
                if (!screenshotTaken && shooter === alice && game.moveCount >= 6) {
                    await expect(cell(alice, 'bsEnemyBoard', index)).not.toHaveAttribute('data-mark', 'unknown');
                    await expectInsideWindow(alice, 'battle');
                    await shot(alice, 'battle-dark');
                    await alice.setViewportSize({ width: 400, height: 900 });
                    await expectInsideWindow(alice, 'narrow battle');
                    const order = await alice.evaluate(() => {
                        const enemy = document.getElementById('bsEnemyBoard').getBoundingClientRect().top;
                        return enemy < document.getElementById('bsOwnBoard').getBoundingClientRect().top;
                    });
                    expect(order, 'on a narrow screen the board to shoot at comes first').toBe(true);
                    await shot(alice, 'battle-dark-narrow');
                    await alice.setViewportSize(config.VIEWPORT);
                    screenshotTaken = true;
                }
            }
            const game = (await gameRef.get()).data();
            expect(game.status).toBe('finished');
            expect(game.winnerUid).toBe(aliceUid);
            expect(bobShots).toBeLessThanOrEqual(1);
            await expect(alice.locator('#bsBanner')).toHaveAttribute('data-tone', 'win');
            await expect(bob.locator('#bsBanner')).toHaveAttribute('data-tone', 'loss');
            // Bob now sees where Alice's ships were.
            await expect(bob.locator('#bsEnemyBoard .bs-cell[data-ship]')).toHaveCount(20);
            await shot(alice, 'finished-win-dark');
            await shot(bob, 'finished-loss-dark');
        });

        let rematchCode;
        await test.step('Bob asks for a rematch and Alice accepts it from the result screen', async () => {
            await bob.locator('#bsBannerActions [data-action="rematch"]').click();
            await expect(bob).not.toHaveURL(new RegExp(`\\?game=${code}$`));
            rematchCode = new URL(bob.url()).searchParams.get('game');
            await expect(bob.locator('.bs-panel--waiting')).toBeVisible();
            const accept = alice.locator('#bsBannerActions [data-action="rematch"]');
            await expect(accept).toHaveText('Принять реванш');
            await accept.click();
            await expect(alice).toHaveURL(new RegExp(`\\?game=${rematchCode}$`));
            await expect(alice.locator('#bsTools')).toBeVisible();
            await expect(bob.locator('#bsTools')).toBeVisible();
            const rematch = (await db.collection('battleshipGames').doc(rematchCode).get()).data();
            expect(rematch.rematchOf).toBe(code);
            expect(rematch.status).toBe('placing');
        });

        await test.step('stats and results show in the lobby', async () => {
            await bob.locator('[data-action="leave"]').click();
            await bob.locator('.confirm-dialog-overlay [data-confirm-dialog="confirm"]').click();
            await expect(alice.locator('#bsBanner')).toHaveAttribute('data-tone', 'neutral');
            await alice.locator('#bsFooter [data-action="lobby"]').click();
            await expect(alice.locator('#bsLobby')).toBeVisible();
            await expect(alice.locator('#bsStats dd').nth(1)).toHaveText('1');
            await expect(alice.locator('#bsRecent .bs-result.is-win')).toHaveCount(1);
        });

        await test.step('Alice challenges Bob by name; Bob gets a notice on another page', async () => {
            await bob.goto(extension.url('src/pages/home/home.html'));
            await bob.waitForFunction(() => globalThis.navigationInstance?.battleshipNotifier);
            await alice.locator('#bsPlayerSearch').fill('E2E R');
            const challenge = alice.locator('#bsPlayerResults [data-action="challenge"]');
            await expect(challenge).toHaveCount(1);
            await expect(alice.locator('#bsPlayerResults')).toContainText(RIVAL.displayName);
            await challenge.click();
            await expect(alice.locator('.bs-panel--waiting')).toContainText(RIVAL.displayName);
            const notice = bob.locator('.battleship-notice[data-kind="invite"]');
            await expect(notice).toBeVisible();
            await expect(notice).toContainText(config.TEST_USER.displayName);
            await shot(bob, 'notice-dark');
            await notice.locator('.battleship-notice__open').click();
            await expect(bob.locator('.bs-panel--waiting [data-action="accept"]')).toBeVisible();
            await bob.locator('.bs-panel--waiting [data-action="accept"]').click();
            await expect(bob.locator('#bsTools')).toBeVisible();
            await expect(alice.locator('#bsTools')).toBeVisible();
        });

        await test.step('light theme and a narrow window', async () => {
            await storeTheme(alice, 'light');
            await alice.reload();
            await expect(alice.locator('#bsTools')).toBeVisible();
            await alice.locator('[data-action="random"]').click();
            await shot(alice, 'placing-light');
            await expectInsideWindow(alice, 'light placement');
            await alice.setViewportSize({ width: 400, height: 900 });
            await expectInsideWindow(alice, 'narrow placement');
            await shot(alice, 'placing-light-narrow');
            await alice.setViewportSize(config.VIEWPORT);
            await alice.goto(url());
            await expect(alice.locator('#bsLobby')).toBeVisible();
            await shot(alice, 'lobby-light');
        });

        expect(calls).toContain('fire');
        expect(bobErrors, 'uncaught exceptions on Bob\'s page').toEqual([]);
    } finally {
        await harness.close();
    }
});

test.describe('against the computer', () => {
    test.use({ startSignedIn: false });

    test('a guest plays a whole game against the computer, with no account and no server', async ({ page, extension }) => {
        test.setTimeout(120_000);
        const local = expression => page.evaluate(expression);
        await page.goto(extension.url(PAGE));
        await expect(page.locator('#bsBotPanel')).toBeVisible();
        await expect(page.locator('#bsGuestNote')).toBeVisible();
        await expect(page.locator('[data-action="create-public"]')).toBeHidden();
        await expect(page.locator('#bsBotLevels [role="radio"]')).toHaveCount(3);
        await expect(page.locator('#bsBotRecord')).toHaveText('На этом уровне вы ещё не играли');
        await page.locator('#bsBotLevels [data-level="hard"]').click();
        await expect(page.locator('#bsBotLevels [data-level="hard"]')).toHaveAttribute('aria-checked', 'true');
        await shot(page, 'bot-lobby-dark');

        await page.locator('[data-action="start-bot"]').click();
        await expect(page).toHaveURL(/\?bot=1$/);
        await expect(page.locator('#bsTools')).toBeVisible();
        await expect(page.locator('.bs-code-chip')).toContainText('Адмирал');
        await expect(page.locator('#bsBanner')).toContainText('Соперник уже готов к бою');
        await page.locator('[data-action="random"]').click();
        await page.locator('#bsReadyBtn').click();
        await expect(page.locator('#bsEnemyBoard')).toBeVisible();

        // Shoot only at the computer's ships (its fleet is in the page): every
        // shot hits and keeps the turn, so the player wins.
        for (let guard = 0; guard < 80; guard += 1) {
            await expect.poll(() => local(() => {
                const game = globalThis.battleshipPage.local.game;
                return game.status !== 'playing' || game.turnUid === 'you';
            }), { timeout: 15_000 }).toBe(true);
            const state = await local(() => {
                const { game, fleets } = globalThis.battleshipPage.local;
                return {
                    status: game.status,
                    marks: game.boards.bot,
                    cells: fleets.bot.flatMap(ship => globalThis.BattleshipRules.shipCells(ship))
                };
            });
            if (state.status !== 'playing') break;
            const index = state.cells.find(cell => state.marks[cell] === '.');
            await expect(page.locator('#bsBanner')).toHaveAttribute('data-tone', 'turn');
            await clickCell(page, 'bsEnemyBoard', index);
            await expect.poll(() => page.evaluate(cell => globalThis.battleshipPage.local.game.boards.bot[cell], index)).not.toBe('.');
        }
        await expect(page.locator('#bsBanner')).toHaveAttribute('data-tone', 'win');
        await expect(page.locator('#bsEnemyBoard .bs-cell[data-ship]')).toHaveCount(20);
        await shot(page, 'bot-win-dark');

        // A reload keeps the result; «Ещё партия» starts over at the same level.
        await page.reload();
        await expect(page.locator('#bsBanner')).toHaveAttribute('data-tone', 'win');
        await page.locator('#bsBannerActions [data-action="rematch"]').click();
        await expect(page.locator('#bsTools')).toBeVisible();
        await expect(page.locator('.bs-code-chip')).toContainText('Адмирал');
        await page.locator('.bs-back').click();
        await expect(page.locator('#bsLobby')).toBeVisible();
        await expect(page.locator('#bsBotRecord')).toHaveText('Побед: 1 · поражений: 0');
        await expect(page.locator('#bsBotResume')).toContainText('корабли ещё не расставлены');
        await page.locator('#bsBotResume [data-action="resume-bot"]').click();
        await expect(page.locator('#bsTools')).toBeVisible();

        // A link to an online game asks a guest to sign in.
        await page.goto(extension.url(`${PAGE}?game=K7Q2MX`));
        await expect(page.locator('#bsLobby')).toBeVisible();
        await expect(page.locator('#bsToast')).toContainText('Войдите');
    });
});
