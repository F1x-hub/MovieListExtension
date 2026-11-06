/**
 * Episodes. The header can say anything, so each check also compares the real
 * stream's length with the episode's: S1E1 of Breaking Bad runs 58 minutes and S1E2
 * runs 48. KinoGo and Ex-FS switch inside the provider's own player and Seasonvar
 * loads each episode directly, so they cover the two ways an episode changes.
 * Rutube offers one video per title and has no episode controls by design.
 */
const { test, expect } = require('./viewer.cjs');
const { SERIES } = require('./films.cjs');

const soft = expect.soft;
const NEAR_MINUTES = 3;

const subtitle = page => page.locator('#videoSubtitle');
const minutes = seconds => (seconds / 60).toFixed(1);

function expectEpisodeLength(video, episode, what) {
    const expected = SERIES.episodeMinutes[episode];
    soft(Math.abs(video.duration / 60 - expected), `${what}: ${episode} runs ${expected} min, this stream ${minutes(video.duration)} min`).toBeLessThan(NEAR_MINUTES);
}

/** Starts the series and moves to a source, ready at S1E1. */
async function startOn(viewer, value) {
    await viewer.open(SERIES);
    const first = await viewer.checkSource(SERIES, { filmstrip: false, watchSeconds: 3 });
    if (first.value !== value) {
        const source = (await viewer.sources()).find(candidate => candidate.value === value);
        if (!source) return false;
        const row = await viewer.checkSource(SERIES, { source, filmstrip: false, watchSeconds: 3 });
        if (row.outcome !== 'plays') return false;
    }
    return first.outcome === 'plays' || first.value !== value;
}

/** Plays what the last press asked for; the previous stream has to leave first. */
async function playAfterPress(viewer, previous) {
    const pressedAt = Date.now();
    await expect.poll(async () => {
        const video = await viewer.mainVideo();
        return !video || video.currentTime < Math.max(1, previous.currentTime - 1);
    }, { message: 'the previous episode leaves the player', timeout: 25000, intervals: [250] }).toBe(true);
    const played = await viewer.playAsViewer(SERIES, { stateLogStartedAt: pressedAt, requested: false });
    expect(played.outcome, 'the episode plays').toBe('plays');
    return played.video;
}

for (const { name, value } of [
    { name: 'Seasonvar', value: 'parser:seasonvar' },
    { name: 'KinoGo', value: 'parser:kinogo' },
    { name: 'Ex-FS', value: 'parser:exfs' }
]) {
    test(`${name}: next, previous and the episode list change the real stream`, async ({ viewer, page }) => {
        test.skip(!await startOn(viewer, value), `${name} does not show this series today`);
        await expect(subtitle(page)).toHaveText('S1E1');
        expectEpisodeLength(await viewer.mainVideo(), 'S1E1', 'the first episode');

        await test.step('«Следующая» opens the next episode', async () => {
            const before = await viewer.mainVideo();
            await page.locator('#playerNextEpisodeBtn').click();
            await expect(subtitle(page)).toHaveText('S1E2');
            const video = await playAfterPress(viewer, before);
            console.log(`[player] ${name} S1E2: ${minutes(video.duration)} min`);
            await viewer.shot(`${name}-next-episode`);
            expectEpisodeLength(video, 'S1E2', '«Следующая»');
            await expect(page.locator('#playerPrevEpisodeBtn'), 'the episode controls stay available').toBeVisible();
        });

        await test.step('«Предыдущая» goes back', async () => {
            const before = await viewer.mainVideo();
            await page.locator('#playerPrevEpisodeBtn').click();
            await expect(subtitle(page)).toHaveText('S1E1');
            expectEpisodeLength(await playAfterPress(viewer, before), 'S1E1', '«Предыдущая»');
        });

        await test.step('the episode list opens any episode', async () => {
            const before = await viewer.mainVideo();
            await page.locator('#playerEpisodesListBtn').click();
            await expect(page.locator('#playerEpisodePickerPopover')).toBeVisible();
            await page.locator('.picker-season-btn[data-season-number="2"]').click();
            await viewer.shot(`${name}-episode-list`);
            await page.locator('#pickerEpisodesList .picker-episode-btn[data-episode-number="3"]').click();
            await expect(subtitle(page)).toHaveText('S2E3');
            expectEpisodeLength(await playAfterPress(viewer, before), 'S2E3', 'the episode list');
            await viewer.shot(`${name}-chosen-episode`);
        });
    });
}

test('another source keeps the episode', async ({ viewer, page }) => {
    // Seasonvar reaches S1E2 reliably, so what is tested here is the switch alone.
    test.skip(!await startOn(viewer, 'parser:seasonvar'), 'Seasonvar does not show this series today');
    const before = await viewer.mainVideo();
    await page.locator('#playerNextEpisodeBtn').click();
    await expect(subtitle(page)).toHaveText('S1E2');
    expectEpisodeLength(await playAfterPress(viewer, before), 'S1E2', 'Seasonvar');

    // KinoGo last: its failure to reach an episode also resets the selection, which
    // would hide what the sources after it do on their own.
    const others = (await viewer.sources()).sort((a, b) => (a.value === 'parser:kinogo') - (b.value === 'parser:kinogo'));
    for (const source of others) {
        // VidSrc may not answer, and Rutube has no episodes to keep.
        if (source.active || ['mediaplayer', 'vidsrc', 'parser:rutube'].some(prefix => source.value.startsWith(prefix))) continue;
        const row = await viewer.checkSource(SERIES, { source, filmstrip: false, watchSeconds: 3 });
        console.log(`[player] ${source.name} after S1E2: ${row.outcome}, header ${await subtitle(page).textContent()}, ${row.minutes} min`);
        if (row.outcome !== 'plays') continue;
        soft(await subtitle(page).textContent(), `${source.name} stays on the episode`).toBe('S1E2');
        expectEpisodeLength(await viewer.mainVideo(), 'S1E2', source.name);
    }
});

test('«Попробовать другой источник» continues the same episode', async ({ viewer, page }) => {
    await viewer.open(SERIES);
    await viewer.checkSource(SERIES, { filmstrip: false, watchSeconds: 3 });

    const failing = (await viewer.sources()).find(source => source.value.startsWith('vidsrc:'));
    test.skip(!failing, 'VidSrc is not offered today');
    const row = await viewer.checkSource(SERIES, { source: failing, filmstrip: false, watchSeconds: 3 });
    test.skip(row.outcome !== 'unavailable', 'VidSrc answers today, so nothing fails');
    await viewer.shot('source-failed');

    const pressedAt = Date.now();
    await viewer.videoArea.getByRole('button', { name: 'Попробовать другой источник' }).click();
    await expect.poll(async () => (await viewer.activeSource())?.value, { message: 'the page moves to another source', intervals: [250] }).not.toBe(failing.value);
    const played = await viewer.playAsViewer(SERIES, { stateLogStartedAt: pressedAt, requested: false });
    const active = await viewer.activeSource();
    console.log(`[player] VidSrc failed, moved to ${active.name}: ${played.outcome}, ${played.video ? minutes(played.video.duration) : '?'} min, presses ${played.presses}`);
    await viewer.shot('after-another-source');
    expect(played.outcome, 'the next source plays').toBe('plays');
    await expect(subtitle(page)).toHaveText('S1E1');
    expectEpisodeLength(played.video, 'S1E1', active.name);
});
