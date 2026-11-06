/**
 * Does each source the page offers really show the film? «Смотреть» is pressed at
 * once, as a viewer would, and then every other offered source is tried in turn.
 */
const { test, expect } = require('./viewer.cjs');
const { FILM, SERIES, ANIME } = require('./films.cjs');

// One broken source must not hide what the others do.
const soft = expect.soft;

for (const film of [FILM, SERIES, ANIME]) {
    test(`${film.name}: every offered source plays the film`, async ({ viewer }) => {
        const pageSeconds = await viewer.open(film) / 1000;
        console.log(`[player] ${film.name}: film page in ${pageSeconds.toFixed(1)} s`);

        const first = await test.step('«Смотреть» finds a source and shows the film', () => viewer.checkSource(film));

        await test.step('the source list', async () => {
            await viewer.page.locator('#sourcePopoverToggle').click();
            await viewer.shot('source-list');
            await viewer.page.locator('#sourcePopoverToggle').click();
        });
        const tried = [first.value];
        for (const source of await viewer.sources()) {
            if (tried.includes(source.value) || source.value.startsWith('mediaplayer')) continue;
            tried.push(source.value);
            await test.step(`${source.name} from the source list`, () => viewer.checkSource(film, { source }));
        }
        await viewer.judgePictures();

        for (const row of viewer.rows) {
            console.log(`[player] ${film.name} / ${row.source}: ${row.outcome}`
                + (row.outcome === 'plays' ? `, frame after ${row.firstFrameAfterSeconds} s (ads ${row.adSeconds} s, joined at ${row.joinedAtSeconds} s), ${row.resolution}, ${row.minutes} min, presses ${row.presses}, stalls ${row.stalls}` : ` (${row.message || row.states})`));
            if (row.outcome === 'unavailable') {
                // Allowed: the provider may be down. Saying so plainly is the requirement.
                soft(row.message, `${row.source} says why it does not play`).toBeTruthy();
            } else {
                soft(row.outcome, `${row.source}: ${row.message || `states ${row.states}`}`).toBe('plays');
                soft(row.mostPlayingTogether, `${row.source}: only one picture plays`).toBe(1);
            }
        }
        expect(viewer.rows.filter(row => row.outcome === 'plays').map(row => row.source), 'at least one source shows the film').not.toEqual([]);
    });
}
