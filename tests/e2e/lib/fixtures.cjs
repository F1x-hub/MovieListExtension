const fs = require('node:fs');
const path = require('node:path');
const { test: base, expect } = require('@playwright/test');
const { launchExtensionContext } = require('../../helpers/extensionContext.cjs');
const config = require('./config.cjs');
const { installInitScripts } = require('./initScripts.cjs');
const { installTmdb, emulator } = require('./externalWorld.cjs');
const { kinopoiskMappings } = require('./catalog.cjs');
const { startFilmstrip, renderFilmstrip, measureBrightness } = require('./filmstrip.cjs');
const { analyzeElement, layoutAnimations, summarizeShifts, summarizeLongFrames, themeFlashes } = require('./motionAnalysis.cjs');

const HEADED = process.env.E2E_HEADED === '1';
const PINNED_TIME = new Date(config.PINNED_DATE).getTime();

function pageUrl(extensionId, relativePath) {
    return `chrome-extension://${extensionId}/${relativePath}`;
}

/** Marks prompts a returning user has already dealt with, so they do not cover the page. */
async function seedReturningUser(worker) {
    await worker.evaluate(seed => chrome.storage.local.set(seed), {
        home_kp_html_mapping_v5: kinopoiskMappings(PINNED_TIME - 60 * 60 * 1000),
        // Native messaging has no host here; the Hub offer is its own concern.
        hubPromptV1: { reason: 'missing', until: PINNED_TIME + 365 * 24 * 60 * 60 * 1000 }
    });
}

// To wait on this, poll it: page.waitForFunction takes any promise as a truthy answer.
const stored = (page, key) => page.evaluate(name => chrome.storage.local.get(name).then(all => all[name]), key);

async function signIn(page, extensionId, user) {
    await page.goto(pageUrl(extensionId, 'src/pages/home/home.html'));
    await page.waitForFunction(() => globalThis.firebaseManager?.isInitialized);
    const projectId = await page.evaluate(({ email, password }) => globalThis.firebaseManager
        .signInWithEmail(email, password)
        .then(() => globalThis.firebase.apps[0].options.projectId), user);
    // The guard against ever testing on production data.
    if (projectId !== config.PROJECT_ID) throw new Error(`Refusing to run against Firebase project "${projectId}"`);
    // Every journey then starts the way a returning user's does: from the Home
    // cache, with the personal preview and the name already known. The last two
    // come from Firestore, about 400 ms after the sign-in itself.
    const returningUserKeys = ['authToken', 'home_discovery_cache_v14', `home_personal_preview_v2_${user.uid}`, 'userDisplayCache'];
    for (const key of returningUserKeys) {
        await expect.poll(() => stored(page, key), `${key} is saved`).toBeTruthy();
    }
}

function watchForPageErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    return errors;
}

/** Loaded and still: images and finite animations have all finished. */
async function waitForStillness(page, quietMs = 400) {
    await page.waitForFunction(ms => {
        const busy = () => [...document.images].some(image => image.loading !== 'lazy' && !image.complete)
            || document.getAnimations().some(animation => animation.playState === 'running'
                && animation.effect?.getComputedTiming?.().iterations !== Infinity);
        const state = globalThis.__e2eStillSince ||= { since: performance.now() };
        if (busy()) state.since = performance.now();
        return performance.now() - state.since >= ms;
    }, quietMs, { polling: 100 });
    await page.evaluate(() => { delete globalThis.__e2eStillSince; });
}

/** Takes effect on the next load, for specs where that load is the one being measured. */
async function storeTheme(page, theme) {
    await page.evaluate(id => {
        localStorage.setItem('movieExtensionTheme', id);
        return chrome.storage.local.set({ theme: id });
    }, theme);
}

async function setTheme(page, theme) {
    await storeTheme(page, theme);
    // Recording starts from this theme, not from a page painted in the previous one.
    await page.reload();
    await waitForStillness(page);
}

function describeReport(report) {
    const parts = [`${report.label}: shift ${report.shifts.score} (${report.shifts.count}), long frames ${report.longFrames.count}, brightness ${report.brightness.min}..${report.brightness.max}`];
    for (const element of report.elements || []) {
        const timing = [
            element.appearedAfterInputMs !== null ? `appears after ${element.appearedAfterInputMs} ms` : null,
            element.goneAfterInputMs !== null ? `gone after ${element.goneAfterInputMs} ms` : null,
            `moves ${element.animatedForMs} ms`
        ].filter(Boolean).join(', ');
        parts.push(`${element.name} ${timing}`);
    }
    if (report.shifts.jumps.length) {
        const distinct = [...new Set(report.shifts.jumps.map(jump => (jump.px ? `${jump.what} ${jump.px}px` : jump.what)))];
        parts.push(`jumps: ${distinct.join(', ')}`);
    }
    if (report.problems?.length) parts.push(`PROBLEMS: ${report.problems.join('; ')}`);
    if (report.flashes?.length) parts.push(`FLASH in ${report.flashes.length} frames`);
    return parts.join(' | ');
}

const test = base.extend({
    extension: async ({}, use) => {
        await emulator.reset();
        await emulator.createUser(config.TEST_USER);
        await emulator.putDocument(`users/${config.TEST_USER.uid}`, {
            displayName: config.TEST_USER.displayName,
            email: config.TEST_USER.email,
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
        await installInitScripts(harness.context, {
            pinnedDate: config.PINNED_DATE,
            projectId: config.PROJECT_ID,
            authOrigin: config.AUTH_ORIGIN,
            firestoreHost: config.FIRESTORE_HOST,
            firestorePort: config.FIRESTORE_PORT
        });
        await installTmdb(harness.context);
        await seedReturningUser(harness.worker);
        try {
            await use({
                context: harness.context,
                id: harness.extensionId,
                url: relativePath => pageUrl(harness.extensionId, relativePath),
                user: config.TEST_USER
            });
        } finally {
            await harness.close();
        }
    },

    /** False hands the spec a blank page of a guest; how and whether to sign in is up to it. */
    startSignedIn: [true, { option: true }],

    page: async ({ extension, startSignedIn }, use, testInfo) => {
        const page = await extension.context.newPage();
        const pageErrors = watchForPageErrors(page);
        if (startSignedIn) await signIn(page, extension.id, extension.user);
        await use(page);
        await testInfo.attach('page-errors.json', { body: JSON.stringify(pageErrors, null, 2), contentType: 'application/json' });
        await page.close();
        expect(pageErrors, 'uncaught exceptions on the page').toEqual([]);
    },

    /** Records one interaction or page load: frames, shifts and what was actually painted. */
    motion: async ({ extension, page }, use, testInfo) => {
        const recordings = [];
        const keep = (label, theme, painted, report) => {
            recordings.push({ label, theme, painted, report });
            return report;
        };
        await use({
            /** act() must navigate and wait until the page has finished loading. */
            async pageLoad(label, theme, act) {
                const filmstrip = await startFilmstrip(page);
                await act();
                const { shifts, longFrames } = await page.evaluate(() => globalThis.__e2eMotion.read());
                return keep(label, theme, await filmstrip.stop(), {
                    label,
                    shifts: summarizeShifts(shifts),
                    longFrames: summarizeLongFrames(longFrames)
                });
            },
            async record(label, theme, targets, act, { settleMs = 700, analyze = {} } = {}) {
                const filmstrip = await startFilmstrip(page);
                await page.evaluate(selectors => {
                    globalThis.__e2eMotion.reset();
                    globalThis.__e2eMotion.startTrack(selectors);
                }, targets);
                await act();
                await page.waitForTimeout(settleMs);
                const track = await page.evaluate(() => globalThis.__e2eMotion.stopTrack());
                const { shifts, longFrames } = await page.evaluate(() => globalThis.__e2eMotion.read());
                const elements = Object.keys(targets).map(name => analyzeElement(track.frames, name, analyze[name], track.inputAt));
                return keep(label, theme, await filmstrip.stop(), {
                    label,
                    elements,
                    problems: elements.flatMap(element => element.problems),
                    layoutAnimations: layoutAnimations(track.animated),
                    animatedProperties: Object.keys(track.animated),
                    shifts: summarizeShifts(shifts),
                    longFrames: summarizeLongFrames(longFrames)
                });
            }
        });
        // Rendering needs helper pages, so it waits until the journey is over:
        // opening one mid-journey would disturb the page being measured.
        const reports = [];
        for (const { label, theme, painted, report } of recordings) {
            const brightness = await measureBrightness(extension.context, painted);
            const full = {
                ...report,
                paintedFrames: painted.length,
                brightness: {
                    min: Math.min(...brightness.map(frame => frame.value)),
                    max: Math.max(...brightness.map(frame => frame.value))
                },
                flashes: themeFlashes(brightness, theme)
            };
            reports.push(full);
            console.log(`[motion] ${describeReport(full)}`);
            const sheet = await renderFilmstrip(extension.context, painted, { title: `${label} (${theme})`, columns: 5, maxFrames: 20 });
            if (sheet) {
                const sheetPath = testInfo.outputPath(`filmstrip-${label}.png`);
                fs.writeFileSync(sheetPath, sheet);
                await testInfo.attach(`filmstrip-${label}.png`, { path: sheetPath, contentType: 'image/png' });
            }
        }
        const summaryPath = testInfo.outputPath('motion-report.json');
        fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
        fs.writeFileSync(summaryPath, JSON.stringify(reports, null, 2));
        await testInfo.attach('motion-report.json', { path: summaryPath, contentType: 'application/json' });
        for (const report of reports) {
            expect(report.flashes, `${report.label}: frames flashing the wrong theme's brightness`).toEqual([]);
        }
    }
});

module.exports = { test, expect, emulator, setTheme, storeTheme, stored, waitForStillness };
