/**
 * The announce stamp scene, played from the real announce modal of the film
 * page: the stamped poster is rendered to a JPEG and travels in the
 * SCHEDULE_ANNOUNCE message as `stampImage`. The service worker and the bot are
 * outside this check, so the page's runtime messages are answered here.
 */
const { test, expect: baseExpect, waitForStillness } = require('../lib/fixtures.cjs');
const { SECTIONS } = require('../lib/catalog.cjs');

const expect = baseExpect.configure({ soft: true, timeout: 5000 });
const film = SECTIONS.films[0];
const scene = 'dialog.announce-stamp';

async function openAnnounceModal(page, extension) {
    await page.goto(extension.url('src/pages/home/home.html'));
    const card = page.locator('#films-grid .movie-card-component [data-action="view-details"]').first();
    await baseExpect(card).toBeAttached();
    await card.click();
    await baseExpect(page.locator('h1.movie-detail-page-title')).toHaveText(film.title);
    await waitForStillness(page);

    // Answer the page's runtime messages: the bot is up and accepts the job.
    await page.evaluate(() => {
        const sent = [];
        globalThis.__announceMessages = sent;
        globalThis.__announceReply = { success: true };
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = async (message, ...rest) => {
            if (message?.type === 'CHECK_BOT_STATUS') return { ok: true };
            if (message?.type === 'SCHEDULE_ANNOUNCE') {
                sent.push(message);
                return globalThis.__announceReply;
            }
            return original(message, ...rest);
        };
    });
    // The announce button is admin-only; the test user is not an admin, so the
    // same delegated control is added to the action row.
    await page.locator('.movie-actions-container').first().evaluate(row => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn announce-movie-btn';
        button.textContent = 'Анонсировать';
        row.append(button);
    });
    await page.locator('.announce-movie-btn').click();
    await baseExpect(page.locator('#announceModal')).toBeVisible();
}

/** Waits for the owner's turn to aim, then strikes with the panel's button. */
async function strike(page) {
    await expect(page.locator(scene)).toHaveAttribute('data-status', 'aiming', { timeout: 15000 });
    await expect(page.locator(`${scene} .announce-stamp__strike`)).toBeFocused();
    await page.locator(`${scene} .announce-stamp__strike`).click();
}

const announceMessages = page => page.evaluate(() => globalThis.__announceMessages.map(message => ({
    type: message.type,
    name: message.movie?.name,
    rawDateStr: message.rawDateStr,
    contentType: message.stampImage?.contentType,
    head: message.stampImage?.data.slice(0, 4),
    bytes: message.stampImage ? atob(message.stampImage.data).length : 0
})));

test('the stamp scene plays from the announce modal and sends the stamped JPEG', async ({ page, extension }) => {
    await openAnnounceModal(page, extension);

    await test.step('send starts the scene above the modal and waits for the aim', async () => {
        // The temporary «Тест» button is gone: «Запланировать» is the only way in.
        await expect(page.locator('#testAnnounceBtn')).toHaveCount(0);
        await page.locator('#sendAnnounceBtn').click();
        await expect(page.locator(scene)).toBeVisible();
        await expect(page.locator(scene)).toHaveClass(/announce-stamp--playing/);
        await expect(page.locator(scene)).toHaveAttribute('data-status', 'aiming', { timeout: 15000 });
        await expect(page.locator(`${scene} .announce-stamp__hint`)).toBeVisible();
        // WebGL draws the stamp where the browser has it; otherwise the flat poster shows the outline.
        const flight = await page.locator(scene).evaluate(dialog => dialog.classList.contains('announce-stamp--flight'));
        if (flight) await expect(page.locator(`${scene} .announce-stamp__stage canvas`)).toHaveCount(1);
        else await expect(page.locator(`${scene} .announce-stamp__aim`)).toBeVisible();
        test.info().annotations.push({ type: 'stage', description: flight ? 'WebGL' : 'flat' });
        // Nothing is sent while the owner aims.
        await page.waitForTimeout(600);
        expect(await announceMessages(page)).toEqual([]);
        await strike(page);
    });

    await test.step('the stamped poster is sent as a JPEG under 3 MB', async () => {
        await expect(page.locator(scene)).toHaveAttribute('data-status', 'sent', { timeout: 15000 });
        const [message] = await announceMessages(page);
        expect(message?.type).toBe('SCHEDULE_ANNOUNCE');
        expect(message?.name).toBe(film.title);
        expect(message?.rawDateStr).toMatch(/^\d{2}\.\d{2}\.\d{4}, 12:00$/);
        expect(message?.contentType).toBe('image/jpeg');
        expect(message?.head).toBe('/9j/');
        expect(message?.bytes).toBeGreaterThan(10000);
        expect(message?.bytes).toBeLessThanOrEqual(3 * 1024 * 1024);
        // The scene ends on the very image that was sent, at the poster's aspect.
        const flat = await page.locator(`${scene} .announce-stamp__flat`).evaluate(image => ({ w: image.naturalWidth, h: image.naturalHeight, hidden: image.hidden }));
        expect(flat).toEqual({ w: 853, h: 1280, hidden: false });
        await expect(page.locator(`${scene} .announce-stamp__status-text`)).toContainText('Анонс запланирован');
        await test.info().attach('announce-stamp-sent', { body: await page.screenshot(), contentType: 'image/png' });
    });

    await test.step('closing after a send closes the announce modal too', async () => {
        await page.locator(`${scene} .announce-stamp__done`).click();
        await expect(page.locator(scene)).toHaveCount(0);
        await expect(page.locator('#announceModal')).toBeHidden();
    });
});

test('Escape while aiming cancels without sending; a failed send offers a retry', async ({ page, extension }) => {
    await openAnnounceModal(page, extension);

    await test.step('Escape while aiming', async () => {
        await page.locator('#sendAnnounceBtn').click();
        await expect(page.locator(scene)).toHaveAttribute('data-status', 'aiming', { timeout: 15000 });
        await page.keyboard.press('Escape');
        await expect(page.locator(scene)).toHaveCount(0);
        await page.waitForTimeout(400);
        expect(await announceMessages(page)).toEqual([]);
        // Only the scene closed: the form is still there to change the time.
        await expect(page.locator('#announceModal')).toBeVisible();
        await expect(page.locator('#sendAnnounceBtn')).toBeEnabled();
    });

    await test.step('a refused send keeps the image and retries it', async () => {
        await page.evaluate(() => { globalThis.__announceReply = { success: false, error: 'Бот недоступен' }; });
        await page.locator('#sendAnnounceBtn').click();
        await strike(page);
        await expect(page.locator(scene)).toHaveAttribute('data-status', 'failed', { timeout: 15000 });
        await expect(page.locator(`${scene} .announce-stamp__status-text`)).toHaveText('Бот недоступен');
        await expect(page.locator(`${scene} .announce-stamp__retry`)).toBeFocused();
        await page.evaluate(() => { globalThis.__announceReply = { success: true }; });
        await page.locator(`${scene} .announce-stamp__retry`).click();
        await expect(page.locator(scene)).toHaveAttribute('data-status', 'sent');
        const messages = await announceMessages(page);
        expect(messages).toHaveLength(2);
        expect(messages[1]?.bytes).toBe(messages[0]?.bytes);
    });
});

test('with reduced motion the owner aims on the flat poster with the keyboard, and the ink fades in', async ({ page, extension }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAnnounceModal(page, extension);
    await page.locator('#sendAnnounceBtn').click();
    await expect(page.locator(scene)).toHaveAttribute('data-status', 'aiming', { timeout: 15000 });
    await expect(page.locator(`${scene} .announce-stamp__stage canvas`)).toHaveCount(0);
    const aim = page.locator(`${scene} .announce-stamp__aim`);
    await expect(aim).toBeVisible();
    const before = await aim.evaluate(element => ({ left: parseFloat(element.style.left), rotate: parseFloat(element.style.rotate) }));
    // Arrows move the outline, E turns it (physical keys, any layout).
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('KeyE');
    const after = await aim.evaluate(element => ({ left: parseFloat(element.style.left), rotate: parseFloat(element.style.rotate) }));
    expect(after.left).toBeLessThan(before.left);
    expect(after.rotate).toBeCloseTo(before.rotate + 2, 5);
    // C switches the ink by hand; the outline shows it and the ink lands in it.
    const inkOf = () => page.locator(scene).evaluate(dialog => dialog.style.getPropertyValue('--stamp-ink'));
    const autoInk = await inkOf();
    await page.keyboard.press('KeyC');
    const pickedInk = await inkOf();
    expect(pickedInk).not.toBe(autoInk);
    // Enter on the focused «Поставить штамп» strikes; the ink lands where the outline was.
    await page.keyboard.press('Enter');
    await expect(page.locator(scene)).toHaveAttribute('data-status', 'sent', { timeout: 15000 });
    await expect(aim).toBeHidden();
    const impression = await page.locator(`${scene} .announce-stamp__impression`).evaluate(element => ({ left: parseFloat(element.style.left), rotate: parseFloat(element.style.rotate) }));
    expect(impression).toEqual(after);
    await expect(page.locator(`${scene} .announce-stamp__impression`)).toHaveAttribute('data-ink', pickedInk);
    expect(await announceMessages(page)).toHaveLength(1);
});
