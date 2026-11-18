/**
 * Networked chess with two real browsers. Alice is the rig's usual signed-in
 * user; Bob gets a second Chromium with the same build. Both pages run
 * unmodified against the Firestore and Auth emulators under the real rules. The
 * `chess` Cloud Function is the real module (functions/chess.js) answering in
 * this process through firebase-admin on the emulators, so every move is
 * replayed and checked by the server code that ships.
 *
 * Moves are clicked on whichever board the browser gets: the 3D board where
 * WebGL works, the flat one where it does not; both answer `screenPoint()`.
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
const { createChessHandler } = require(path.join(config.ROOT, 'functions', 'chess.js'));

const HEADED = process.env.E2E_HEADED === '1';
const RIVAL = { uid: 'e2e-user-2', email: 'e2e-rival@example.test', password: 'e2e-password-2', displayName: 'E2E Rival' };
const PAGE = 'src/pages/chess/chess.html';
const SHOTS_DIR = path.join(config.OUTPUT_DIR, 'chess');

function admin() {
    const name = 'chess-e2e';
    const app = adminApp.getApps().find(candidate => candidate.name === name)
        || adminApp.initializeApp({ projectId: config.PROJECT_ID }, name);
    return { db: adminFirestore.getFirestore(app), auth: adminAuth.getAuth(app) };
}

/** Answers the page's calls to the Cloud Function with the real handler. */
async function routeFunction(context, handler, calls) {
    await context.route(/^https:\/\/us-central1-[^/]+\.cloudfunctions\.net\/chess/, async route => {
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
    // Mini-games on, so Bob's other pages carry the chess notices.
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

async function boardReady(page) {
    await page.waitForFunction(() => {
        const board = globalThis.chessPage?.gameView?.board;
        return Boolean(board) && board.ready !== false;
    });
}

async function clickSquare(page, square) {
    const point = await page.evaluate(sq => globalThis.chessPage.gameView.board.screenPoint(sq, 0.3), square);
    await page.mouse.click(point.x, point.y);
}

/** One move by clicks, confirmed by the server. */
async function play(page, gameRef, from, to) {
    const before = (await gameRef.get()).data().moveCount;
    await boardReady(page);
    await expect.poll(() => page.evaluate(() => {
        const view = globalThis.chessPage.gameView;
        return view.canUserMove() && (view.board.canAct ? view.board.canAct() : true);
    })).toBe(true);
    await clickSquare(page, from);
    try {
        await expect.poll(() => page.evaluate(() => globalThis.chessPage.gameView.board.selected), { timeout: 8000 }).toBe(from);
    } catch (error) {
        const state = await page.evaluate(sq => {
            const view = globalThis.chessPage.gameView;
            const board = view.board;
            const point = board.screenPoint(sq, 0.3);
            const element = document.elementFromPoint(point.x, point.y);
            return {
                board: board.constructor.name,
                selected: board.selected,
                canAct: board.canAct?.(),
                interactive: board.interactive(),
                animating: board.isAnimating(),
                tweens: board.tweens?.size,
                cameraTween: Boolean(board.cameraTween),
                ready: board.ready,
                pointer: board.pointer ? { intent: board.pointer.intent, mode: board.pointer.mode, square: board.pointer.square } : null,
                review: view.reviewPly,
                pending: view.pendingMove,
                turn: view.game.turn(),
                color: view.playerColor,
                atPoint: element ? `${element.tagName}.${element.className}` : null,
                point
            };
        }, from);
        await shot(page, `failed-select-${from}`);
        throw new Error(`${from} was not selected: ${JSON.stringify(state)}\n${error.message}`);
    }
    await clickSquare(page, to);
    await expect.poll(async () => (await gameRef.get()).data().moveCount).toBe(before + 1);
}

/** Pages hide horizontal scrolling, so compare the boxes with the window instead. */
async function expectInsideWindow(page, label) {
    const outside = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return [...document.querySelectorAll('#chessGame .chess-stage, #chessGame .chess-player, #chessGame .chess-status, #chessGame .chess-actions, #chessGame .chess-moves-panel')]
            .filter(element => element.getClientRects().length > 0)
            .map(element => {
                const box = element.getBoundingClientRect();
                return { what: element.className, left: Math.floor(box.left), right: Math.ceil(box.right) };
            })
            .filter(box => box.left < 0 || box.right > width);
    });
    expect(outside, `${label}: nothing sticks out of the window`).toEqual([]);
}

test('two players play chess: a mate, ratings, a rematch, a draw and a challenge', async ({ page: alice, extension }) => {
    test.setTimeout(300_000);
    const { db, auth } = admin();
    const calls = [];
    const handler = createChessHandler({ db, auth });
    await routeFunction(extension.context, handler, calls);
    const { harness, page: bob } = await launchRival(extension);
    const bobErrors = [];
    bob.on('pageerror', error => bobErrors.push(error.message));
    await routeFunction(harness.context, handler, calls);
    const aliceUid = config.TEST_USER.uid;
    const url = query => extension.url(`${PAGE}${query || ''}`);

    try {
        let code;
        await test.step('Alice creates a game by code as White, Bob joins it with the typed code', async () => {
            await alice.goto(url());
            await expect(alice.locator('#chessLobby')).toBeVisible();
            await expect(alice.locator('#chessOnlineControls')).toBeVisible();
            await expect(alice.locator('#chessMyGames .chess-empty')).toBeVisible();
            await alice.locator('[data-group="onlineSide"][data-value="white"]').click();
            await alice.locator('[data-group="timeControl"][data-value="10+5"]').click();
            await shot(alice, 'lobby-dark');
            await alice.locator('[data-action="create-private"]').click();
            await expect(alice.locator('.chess-code__value')).toHaveText(/^[A-Z2-9]{6}$/);
            code = (await alice.locator('.chess-code__value').textContent()).trim();
            await expect(alice).toHaveURL(new RegExp(`\\?game=${code}$`));
            await shot(alice, 'waiting-dark');

            await bob.goto(url());
            await expect(bob.locator('#chessLobby')).toBeVisible();
            await bob.locator('#chessJoinCode').fill('zz');
            await bob.locator('#chessJoinForm button[type="submit"]').click();
            await expect(bob.locator('#chessJoinError')).toBeVisible();
            await bob.locator('#chessJoinCode').fill(`${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()}`);
            await bob.locator('#chessJoinForm button[type="submit"]').click();
            await expect(bob).toHaveURL(new RegExp(`\\?game=${code}$`));
            await expect(alice.locator('#chessStageCard')).toBeHidden();
            await expect(alice.locator('#chessPlayerTop')).toContainText(RIVAL.displayName);
            await expect(bob.locator('#chessPlayerBottom .chess-glyph--b')).toHaveCount(1);
        });

        const gameRef = db.collection('chessGames').doc(code);
        await test.step('the rules keep players to their own documents and every write on the server', async () => {
            const outcome = await bob.evaluate(async ({ gameId, opponent }) => {
                const fdb = globalThis.firebaseManager.db;
                const attempt = async task => {
                    try {
                        await task();
                        return 'allowed';
                    } catch (error) {
                        return error.code;
                    }
                };
                return {
                    gameRead: await attempt(() => fdb.collection('chessGames').doc(gameId).get()),
                    gameWrite: await attempt(() => fdb.collection('chessGames').doc(gameId).update({ result: '0-1' })),
                    opponentPlayer: await attempt(() => fdb.collection('chessPlayers').doc(opponent).get()),
                    lobbyWrite: await attempt(() => fdb.collection('chessLobby').doc('open').set({ games: {} }))
                };
            }, { gameId: code, opponent: aliceUid });
            expect(outcome).toEqual({
                gameRead: 'allowed',
                gameWrite: 'permission-denied',
                opponentPlayer: 'permission-denied',
                lobbyWrite: 'permission-denied'
            });
        });

        await test.step('they play the Scholar\'s mate move by move', async () => {
            await play(alice, gameRef, 'e2', 'e4');
            await expect(bob.locator('#chessStatus')).toHaveAttribute('data-tone', 'turn');
            await play(bob, gameRef, 'e7', 'e5');
            await play(alice, gameRef, 'f1', 'c4');
            await play(bob, gameRef, 'b8', 'c6');
            await play(alice, gameRef, 'd1', 'h5');
            await play(bob, gameRef, 'g8', 'f6');
            await expectInsideWindow(alice, 'game');
            await shot(alice, 'before-mate-dark');
            await play(alice, gameRef, 'h5', 'f7');
            const game = (await gameRef.get()).data();
            expect(game.status).toBe('finished');
            expect(game.result).toBe('1-0');
            expect(game.endReason).toBe('checkmate');
            expect(game.sans).toEqual(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
            expect(game.ratingDelta).toEqual({ [aliceUid]: 20, [RIVAL.uid]: -20 });
            await expect(alice.locator('#chessStatus')).toHaveAttribute('data-tone', 'win');
            await expect(bob.locator('#chessStatus')).toHaveAttribute('data-tone', 'loss');
            await expect(alice.locator('#chessResult')).toContainText('1220');
            await shot(alice, 'finished-win-dark');
            await shot(bob, 'finished-loss-dark');
        });

        let rematchCode;
        await test.step('Bob asks for a rematch and Alice accepts it from the result card', async () => {
            await bob.locator('#chessResult [data-action="rematch"]').click();
            await expect(bob).not.toHaveURL(new RegExp(`\\?game=${code}$`));
            rematchCode = new URL(bob.url()).searchParams.get('game');
            await expect(bob.locator('#chessStageCard')).toBeVisible();
            const accept = alice.locator('#chessResult [data-action="rematch"]');
            await expect(accept).toHaveText('Принять реванш');
            await accept.click();
            await expect(alice).toHaveURL(new RegExp(`\\?game=${rematchCode}$`));
            await expect(bob.locator('#chessStageCard')).toBeHidden();
            const rematch = (await db.collection('chessGames').doc(rematchCode).get()).data();
            expect(rematch.rematchOf).toBe(code);
            expect(rematch.whiteUid).toBe(RIVAL.uid);
            expect(rematch.blackUid).toBe(aliceUid);
        });

        await test.step('in the rematch Bob offers a draw and Alice accepts', async () => {
            const rematchRef = db.collection('chessGames').doc(rematchCode);
            await play(bob, rematchRef, 'd2', 'd4');
            await play(alice, rematchRef, 'd7', 'd5');
            await bob.locator('#chessActions [data-action="draw"]').click();
            await expect(alice.locator('#chessStatus')).toHaveAttribute('data-tone', 'offer');
            await shot(alice, 'draw-offer-dark');
            await alice.locator('#chessStatus [data-action="draw-accept"]').click();
            await expect.poll(async () => (await rematchRef.get()).data().result).toBe('1/2-1/2');
            await expect(bob.locator('#chessStatus')).toHaveAttribute('data-tone', 'draw');
        });

        await test.step('the lobby shows the rating and the results', async () => {
            await alice.locator('[data-action="lobby"]').first().click();
            await expect(alice.locator('#chessLobby')).toBeVisible();
            await expect(alice.locator('#chessStats dd').first()).toHaveText(/^12\d\d$/);
            await expect(alice.locator('#chessRecent .chess-result-tag.is-win')).toHaveCount(1);
            await expect(alice.locator('#chessRecent .chess-result-tag.is-draw')).toHaveCount(1);
            await shot(alice, 'lobby-after-dark');
        });

        await test.step('Alice challenges Bob by name; Bob gets a notice on another page', async () => {
            await bob.goto(extension.url('src/pages/home/home.html'));
            await bob.waitForFunction(() => globalThis.navigationInstance?.chessNotifier);
            await alice.locator('#chessPlayerSearch').fill('E2E R');
            const challenge = alice.locator('#chessPlayerResults [data-action="challenge"]');
            await expect(challenge).toHaveCount(1);
            await challenge.click();
            await expect(alice.locator('#chessStageCard')).toContainText(RIVAL.displayName);
            const notice = bob.locator('.battleship-notice[data-source="chess"][data-kind="invite"]');
            await expect(notice).toBeVisible();
            await expect(notice).toContainText(config.TEST_USER.displayName);
            await shot(bob, 'notice-dark');
            await notice.locator('.battleship-notice__open').click();
            await expect(bob.locator('#chessStageCard [data-action="accept"]')).toBeVisible();
            await bob.locator('#chessStageCard [data-action="accept"]').click();
            await expect(bob.locator('#chessStageCard')).toBeHidden();
            await expect(alice.locator('#chessStageCard')).toBeHidden();
        });

        await test.step('light theme and a narrow window', async () => {
            await storeTheme(alice, 'light');
            await alice.reload();
            await boardReady(alice);
            await shot(alice, 'game-light');
            await alice.setViewportSize({ width: 400, height: 900 });
            await expectInsideWindow(alice, 'narrow game');
            const order = await alice.evaluate(() => {
                const top = document.getElementById('chessPlayerTop').getBoundingClientRect().top;
                const stage = document.getElementById('chessStage').getBoundingClientRect().top;
                return top < stage;
            });
            expect(order, 'on a narrow screen the opponent comes above the board').toBe(true);
            await shot(alice, 'game-light-narrow');
            await alice.setViewportSize(config.VIEWPORT);
        });

        expect(calls).toContain('move');
        expect(bobErrors, 'uncaught exceptions on Bob\'s page').toEqual([]);
    } finally {
        await harness.close();
    }
});
