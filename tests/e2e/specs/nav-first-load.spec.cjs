/**
 * Everything in the navigation bar sits where the account block leaves room, so
 * the block must have its final shape from the first paint. The saved display
 * name usually gives it, but only Navigation writes that name and it does not
 * run in the popup: the first page after signing in there has none to read.
 */
const { test, expect, emulator, storeTheme, stored, waitForStillness } = require('../lib/fixtures.cjs');
const { SECTIONS } = require('../lib/catalog.cjs');
const { delayAuthAnswer } = require('../lib/initScripts.cjs');

const THEMES = ['dark', 'light'];
const HOME = 'src/pages/home/home.html';
const POPUP = 'src/popup/popup.html';
const SETTINGS = 'src/pages/settings/settings.html';
const accountMenu = '#navUserProfile';
const signInButton = '#navSignInBtn';
const accountName = '#navUserName';
const invitation = '#homeSignInBtn';

test.use({ startSignedIn: false });

/** So that recording starts from this theme, not from a popup painted in the previous one. */
async function openPopup(page, { url }, theme) {
    await page.goto(url(POPUP));
    await storeTheme(page, theme);
    await page.reload();
}

async function signInFromPopup(page, { user }) {
    await page.locator('#loginEmail').fill(user.email);
    await page.locator('#loginEmailSubmitBtn').click();
    await page.locator('#loginPassword').fill(user.password);
    await page.locator('#loginPasswordSubmitBtn').click();
    await expect(page.locator('#authSection')).toBeHidden();
    await expect.poll(() => stored(page, 'authToken')).toBeTruthy();
}

async function loadHome(page, { url }) {
    await page.goto(url(HOME));
    await expect(page.locator('#films-grid .movie-card-component')).toHaveCount(SECTIONS.films.length);
    await waitForStillness(page);
}

const savedName = page => stored(page, 'userDisplayCache');
const storedSession = page => stored(page, 'isAuthenticated');
const popupProfileKey = ({ user }) => `user_profile_${user.uid}`;

/** By the clock pages see, which the rig pins. */
const daysAgo = (page, days) => page.evaluate(count => Date.now() - count * 24 * 60 * 60 * 1000, days);

async function ageSessionCopy(page) {
    const authTimestamp = await daysAgo(page, 2);
    await page.evaluate(value => chrome.storage.local.set({ authTimestamp: value }), authTimestamp);
}

// A signed-in Home has its own expectations in home-to-rating.spec.cjs. A guest's
// has nothing that may move at all, so those tests check every jump.
const barJumps = report => report.shifts.jumps.filter(jump => /nav/i.test(jump.what));

// While the page fades in, the browser's layout-shift entries rarely report a move:
// Films moved in every guest load, and they told of very few. So read the place,
// and allow no move at all: everything above Films holds its height from the start.
const trackFilms = page => page.addInitScript(() => globalThis.__e2eMotion.startTrack({ films: '#films-section' }));

async function expectFilmsToStay(page) {
    const { frames } = await page.evaluate(() => globalThis.__e2eMotion.stopTrack());
    const places = frames.map(({ items }) => items.films).filter(films => films.visible).map(films => films.y);
    expect(places, 'Films was on screen').not.toEqual([]);
    expect.soft(Math.max(...places) - Math.min(...places), `Films stood at ${[...new Set(places)]}`).toBeLessThan(1);
}

const barLayout = page => page.evaluate(() => Object.fromEntries(
    ['.nav-logo', '.nav-item', '.nav-search-container', '.nav-user'].map(selector => {
        const { x, width } = document.querySelector(selector).getBoundingClientRect();
        return [selector, { x: Math.round(x), width: Math.round(width) }];
    })
));

for (const theme of THEMES) {
    test(`the first page after signing in from the popup, ${theme} theme`, async ({ page, extension, motion }) => {
        await openPopup(page, extension, theme);
        await signInFromPopup(page, extension);
        expect(await savedName(page), 'with a saved name this would measure a later load').toBeUndefined();

        const report = await motion.pageLoad('first-load', theme, () => loadHome(page, extension));

        expect.soft(barJumps(report)).toEqual([]);
        await expect(page.locator(accountMenu)).toBeVisible();
        await expect(page.locator(signInButton)).toBeHidden();
        await expect(page.locator(accountName)).toHaveText(extension.user.displayName);

        const firstLoad = await barLayout(page);
        await loadHome(page, extension);
        expect(await barLayout(page), 'the first load should use the same place as later ones').toEqual(firstLoad);
    });

    test(`a guest's bar, ${theme} theme`, async ({ page, extension, motion }) => {
        await openPopup(page, extension, theme);
        await trackFilms(page);

        const report = await motion.pageLoad('guest-load', theme, () => loadHome(page, extension));

        expect.soft(report.shifts.jumps).toEqual([]);
        await expectFilmsToStay(page);
        await expect(page.locator(signInButton)).toBeVisible();
        await expect(page.locator(accountMenu)).toBeHidden();
        await expect(page.locator('.nav-header')).toHaveScreenshot(`nav-guest-${theme}.png`);
    });

    // Firebase usually answers within about 100 ms of the page appearing, too fast
    // to look at. Holding the answer back shows what stands there until then.
    test(`a guest's Home when Firebase answers late, ${theme} theme`, async ({ page, extension, motion }) => {
        await openPopup(page, extension, theme);
        await trackFilms(page);
        await page.addInitScript(delayAuthAnswer, { delayMs: 1500 });

        const report = await motion.pageLoad('guest-late-auth', theme, async () => {
            await page.goto(extension.url(HOME));
            await expect(page.locator('#films-section')).toBeVisible();
            await expect(page.locator(invitation), 'Firebase has not answered yet').toHaveCount(0);
            await expect(page.locator('.home-cta-card'), 'nobody is called a guest yet').toBeHidden();
            await expect(page.locator(invitation)).toBeVisible();
            await expect(page.locator('#films-grid .movie-card-component')).toHaveCount(SECTIONS.films.length);
            await waitForStillness(page);
        });

        expect.soft(report.shifts.jumps).toEqual([]);
        await expectFilmsToStay(page);
    });
}

// The one page that starts the bar itself, so the one that can start it too early.
test('the first Settings page after signing in', async ({ page, extension, motion }) => {
    await openPopup(page, extension, 'dark');
    await signInFromPopup(page, extension);
    expect(await savedName(page), 'with a saved name this would measure a later load').toBeUndefined();

    const report = await motion.pageLoad('settings-load', 'dark', async () => {
        await page.goto(extension.url(SETTINGS));
        await expect(page.locator(accountName)).toHaveText(extension.user.displayName);
        await waitForStillness(page);
    });

    expect.soft(report.shifts.jumps).toEqual([]);
    await expect(page.locator(signInButton)).toBeHidden();
});

test("a guest's Settings page", async ({ page, extension, motion }) => {
    await openPopup(page, extension, 'dark');

    const report = await motion.pageLoad('settings-guest-load', 'dark', async () => {
        await page.goto(extension.url(SETTINGS));
        await expect(page.locator(signInButton)).toBeVisible();
        await waitForStillness(page);
    });

    expect.soft(report.shifts.jumps).toEqual([]);
});

// Firestore holds a name the session's own copy does not have.
test.describe('a name only Firestore knows', () => {
    const NAME = 'Константин Иванов';

    test.beforeEach(({ extension: { user } }) => emulator.putDocument(`users/${user.uid}`, {
        displayName: user.displayName,
        firstName: 'Константин',
        lastName: 'Иванов',
        email: user.email,
        approvalStatus: 'approved',
        isAdmin: false
    }));

    async function signInAndWaitForPopupProfile(page, extension) {
        await openPopup(page, extension, 'dark');
        await signInFromPopup(page, extension);
        await expect.poll(() => stored(page, popupProfileKey(extension))).toBeTruthy();
    }

    test('the first page after signing in from the popup', async ({ page, extension, motion }) => {
        await signInAndWaitForPopupProfile(page, extension);
        expect(await savedName(page), 'with a saved name this would measure a later load').toBeUndefined();

        const report = await motion.pageLoad('firestore-name-load', 'dark', () => loadHome(page, extension));

        expect.soft(barJumps(report)).toEqual([]);
        await expect(page.locator(accountName)).toHaveText(NAME);
    });

    test('a saved name over a week old still holds the place', async ({ page, extension, motion }) => {
        await signInAndWaitForPopupProfile(page, extension);
        await page.evaluate(async ({ uid, displayName, timestamp }) => {
            await chrome.storage.local.remove(`user_profile_${uid}`);
            await chrome.storage.local.set({ userDisplayCache: { uid, displayName, timestamp } });
        }, { uid: extension.user.uid, displayName: NAME, timestamp: await daysAgo(page, 8) });

        const report = await motion.pageLoad('old-name-load', 'dark', () => loadHome(page, extension));

        expect.soft(barJumps(report)).toEqual([]);
        await expect(page.locator(accountName)).toHaveText(NAME);
    });
});

// Nobody clicks faster than the popup reads the profile, or than Home saves the name
// after signing in there, but a page can still open without either, and then the
// session's own copy of the name has to hold the place.
test('with nothing saved, the session copy of the name holds the place', async ({ page, extension, motion }) => {
    await openPopup(page, extension, 'light');
    await signInFromPopup(page, extension);
    await expect.poll(() => stored(page, popupProfileKey(extension))).toBeTruthy();
    // Closed first, or the popup could save it again. The blank page is white, hence the theme.
    await page.goto('about:blank');
    const [worker] = extension.context.serviceWorkers();
    await worker.evaluate(key => chrome.storage.local.remove(key), popupProfileKey(extension));

    const report = await motion.pageLoad('session-copy-load', 'light', () => loadHome(page, extension));

    expect.soft(barJumps(report)).toEqual([]);
    await expect(page.locator(accountName)).toHaveText(extension.user.displayName);
});

// The copy of the session in storage is refreshed only when a page's Firebase answers.
test.describe('a session copy older than a day', () => {
    test('the first load of the day keeps the account menu', async ({ page, extension, motion }) => {
        await openPopup(page, extension, 'dark');
        await signInFromPopup(page, extension);
        await ageSessionCopy(page);

        const report = await motion.pageLoad('next-day-load', 'dark', () => loadHome(page, extension));

        expect.soft(barJumps(report)).toEqual([]);
        await expect(page.locator(accountName)).toHaveText(extension.user.displayName);
        expect(await storedSession(page)).toBe(true);
    });

    test('a new page does not sign out a tab left open', async ({ page, extension }) => {
        await openPopup(page, extension, 'dark');
        await signInFromPopup(page, extension);
        await loadHome(page, extension);
        await ageSessionCopy(page);

        const newTab = await extension.context.newPage();
        await loadHome(newTab, extension);
        await page.waitForTimeout(1000);

        await expect(newTab.locator(accountMenu)).toBeVisible();
        await expect(page.locator(accountMenu)).toBeVisible();
        expect(await page.evaluate(() => globalThis.firebaseManager.getCurrentUser()?.uid)).toBe(extension.user.uid);
        expect(await storedSession(newTab)).toBe(true);
        await newTab.close();
    });

    test('a session Firebase no longer has ends at the sign-in button', async ({ page, extension }) => {
        await openPopup(page, extension, 'dark');
        const { uid, email, displayName } = extension.user;
        await page.evaluate(async ({ user, authTimestamp }) => {
            await chrome.storage.local.set({ user, authTimestamp, isAuthenticated: true });
        }, { user: { uid, email, displayName, photoURL: null }, authTimestamp: await daysAgo(page, 2) });

        await loadHome(page, extension);

        await expect(page.locator(signInButton)).toBeVisible();
        await expect(page.locator(accountMenu)).toBeHidden();
        expect(await storedSession(page)).toBe(false);
    });
});

test('the games button has its place from the first paint', async ({ page, extension, motion }) => {
    await openPopup(page, extension, 'dark');
    await page.evaluate(() => chrome.storage.local.set({ showGames: true }));

    const report = await motion.pageLoad('games-button-load', 'dark', () => loadHome(page, extension));

    expect.soft(barJumps(report)).toEqual([]);
    await expect(page.locator('#navGamesBtn')).toBeVisible();
});
