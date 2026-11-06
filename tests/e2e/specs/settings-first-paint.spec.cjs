/**
 * The footer buttons on Settings are as wide as their labels, and the markup can
 * only hold one language. A page that translates itself after it has painted shows
 * the wrong language first and then moves the buttons, so the labels have to be
 * final from the first frame. The frames below rule out hiding the page instead:
 * a button that is not there, or not visible, fails as well.
 */
const { test, expect, storeTheme, waitForStillness } = require('../lib/fixtures.cjs');

const THEMES = ['dark', 'light'];
const SETTINGS = 'src/pages/settings/settings.html';
const RUSSIAN = { save: 'Сохранить настройки', reset: 'Сбросить по умолчанию' };
const ENGLISH = { save: 'Save Settings', reset: 'Reset to Defaults' };

test.use({ startSignedIn: false });

/** Runs before the page's scripts and keeps what each frame is about to paint. */
function recordFooterFrames() {
    const frames = globalThis.__e2eFooterFrames = [];
    const describe = id => {
        const button = document.getElementById(id);
        const { x, width } = button.getBoundingClientRect();
        return `${button.textContent} @${Math.round(x)} w${Math.round(width)} ${getComputedStyle(button).visibility}`;
    };
    const onFrame = () => {
        // A frame with a body but without the footer would paint a page still being parsed.
        if (document.body) {
            frames.push(document.getElementById('saveBtn')
                ? `${document.querySelector('.settings-pane.active')?.id} | ${describe('saveBtn')} | ${describe('resetBtn')}`
                : 'no footer');
        }
        requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
}

async function loadSettings(page, { url }, motion, label, theme) {
    const report = await motion.pageLoad(label, theme, async () => {
        await page.goto(url(SETTINGS));
        await page.locator('.nav-header').waitFor();
        await waitForStillness(page);
    });
    return { report, frames: await page.evaluate(() => globalThis.__e2eFooterFrames) };
}

function expectFooterFinalFromFirstFrame(frames, labels) {
    expect.soft(frames.length, 'no frames were recorded').toBeGreaterThan(0);
    expect.soft([...new Set(frames)], 'the footer changed between frames').toHaveLength(1);
    expect.soft(frames[0]).toContain(labels.save);
    expect.soft(frames[0]).toContain(labels.reset);
    expect.soft(frames[0]).not.toContain('hidden');
}

function expectFinalFromFirstFrame({ report, frames }, labels) {
    expect.soft(report.shifts.jumps, 'anything moved while the page loaded').toEqual([]);
    expectFooterFinalFromFirstFrame(frames, labels);
}

async function chooseLanguage(page, nativeName) {
    await page.locator('#languageDropdown .dropdown-trigger').click();
    await page.locator('#languageDropdown .dropdown-option', { hasText: nativeName }).click();
    await page.locator('#saveBtn').click();
    await expect(page.locator('.toast')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(recordFooterFrames);
});

// As on a new profile: nothing is saved and there is no copy of it yet.
test('with no language saved, following the browser language', async ({ page, extension, motion }) => {
    await page.goto(extension.url(SETTINGS));
    await waitForStillness(page);
    await page.evaluate(() => localStorage.removeItem('movieExtensionLanguage'));

    expectFinalFromFirstFrame(await loadSettings(page, extension, motion, 'settings-new-profile', 'dark'), RUSSIAN);
});

for (const theme of THEMES) {
    test(`a returning visit, ${theme} theme`, async ({ page, extension, motion }) => {
        await page.goto(extension.url(SETTINGS));
        await storeTheme(page, theme);
        await page.reload();
        await waitForStillness(page);

        expectFinalFromFirstFrame(await loadSettings(page, extension, motion, 'settings-return', theme), RUSSIAN);
    });

    test.describe('signed in', () => {
        test.use({ startSignedIn: true });

        test(`a returning visit, ${theme} theme`, async ({ page, extension, motion }) => {
            await page.goto(extension.url(SETTINGS));
            await storeTheme(page, theme);
            await page.reload();
            await waitForStillness(page);

            expectFinalFromFirstFrame(await loadSettings(page, extension, motion, 'settings-return-signed-in', theme), RUSSIAN);
        });
    });
}

// These two sections are longer than the window: opened a frame late, they take the
// footer out of view and bring a scrollbar that moves the buttons. What they do inside
// themselves while they load is listed under known defects in the rig's README.
for (const section of ['updates', 'mediaplayer']) {
    test(`a returning visit to the ${section} section`, async ({ page, extension, motion }) => {
        await page.goto(extension.url(SETTINGS));
        await page.evaluate(saved => localStorage.setItem('movieExtensionActiveSettingsPaneV1', saved), section);
        await page.reload();
        await waitForStillness(page);

        const { frames } = await loadSettings(page, extension, motion, `settings-return-to-${section}`, 'dark');
        expectFooterFinalFromFirstFrame(frames, RUSSIAN);
        expect.soft(frames[0]).toContain(`pane-${section}`);
    });
}

test('a language chosen here holds from the next load, in both directions', async ({ page, extension, motion }) => {
    await page.goto(extension.url(SETTINGS));
    await waitForStillness(page);

    await chooseLanguage(page, 'English');
    expectFinalFromFirstFrame(await loadSettings(page, extension, motion, 'settings-after-choosing-english', 'dark'), ENGLISH);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await chooseLanguage(page, 'Русский');
    expectFinalFromFirstFrame(await loadSettings(page, extension, motion, 'settings-after-choosing-russian', 'dark'), RUSSIAN);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});

// With no page open, nothing can tell this browser before its next load: that one
// load may correct itself, and the point is that it does and the next is settled.
test('a language changed elsewhere corrects itself and then holds', async ({ page, extension, motion }) => {
    await page.goto(extension.url(SETTINGS));
    await waitForStillness(page);
    await page.goto('about:blank');
    await extension.context.serviceWorkers()[0].evaluate(() => chrome.storage.sync.set({ language: 'en' }));

    await page.goto(extension.url(SETTINGS));
    await expect(page.locator('#saveBtn')).toHaveText(ENGLISH.save);
    await waitForStillness(page);

    expectFinalFromFirstFrame(await loadSettings(page, extension, motion, 'settings-after-outside-change', 'dark'), ENGLISH);
});
