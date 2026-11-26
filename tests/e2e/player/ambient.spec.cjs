/**
 * Which way does the ambient light get each real source's picture? For every source that
 * plays: a video of the page is drawn directly, a provider frame sends pixels, and anything
 * else needs a capture of the tab, which the rig's browser has no <all_urls> grant for
 * ('needs-access'). The light must never stay out without saying why.
 */
const { test, expect } = require('./viewer.cjs');
const { FILM, SERIES, ANIME } = require('./films.cjs');

const soft = expect.soft;

async function readLight(page) {
    // The light updates five times a second and frames come every 200 ms; give it a moment.
    await page.waitForTimeout(2500);
    return page.evaluate(() => {
        const light = window.movieAmbientLight;
        const frame = document.querySelector('#videoContainer iframe');
        let host;
        try { host = frame ? new URL(frame.src).host : 'page'; } catch { host = '?'; }
        return light ? { mode: light.mode, status: light.status, lit: light.canvas.classList.contains('is-lit'), host } : null;
    });
}

for (const film of [FILM, SERIES, ANIME]) {
    test(`${film.name}: the light finds each source's picture`, async ({ viewer }) => {
        await viewer.open(film);
        const rows = [];
        const check = async (label, source) => {
            const row = await viewer.checkSource(film, { source, filmstrip: false, watchSeconds: 3 });
            if (row.outcome !== 'plays') return;
            const light = await readLight(viewer.page);
            rows.push({ source: label, ...light });
            console.log(`[ambient] ${film.name} / ${label}: ${JSON.stringify(light)}`);
            soft(light, `${label}: the page created the light`).not.toBeNull();
            soft(['page', 'frame', 'capture', 'needs-access'], `${label}: the light has a way to the picture or says it needs access`).toContain(light?.mode);
            if (['page', 'frame'].includes(light?.mode)) soft(light.lit, `${label}: the light is on`).toBe(true);
        };
        await test.step('«Смотреть»', () => check('first source', null));
        const tried = [(await viewer.activeSource())?.value];
        for (const source of await viewer.sources()) {
            if (tried.includes(source.value) || source.value.startsWith('mediaplayer')) continue;
            tried.push(source.value);
            await test.step(source.name, () => check(source.name, source));
        }
        console.log(`[ambient] ${film.name}: ${rows.map(row => `${row.source}=${row.mode}`).join(', ')}`);
    });
}
