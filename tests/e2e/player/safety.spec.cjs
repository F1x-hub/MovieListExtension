/**
 * The control group, on the real internet: each guard these specs lean on is shown
 * doing its job, so a green run means something and a live run stays harmless.
 */
const { test, expect, lengthFits, judgePicture } = require('./viewer.cjs');
const { FILM } = require('./films.cjs');

test('production services cannot be reached, while the internet can', async ({ viewer, page, extension }) => {
    await page.goto(extension.url('src/pages/home/home.html'));
    const reach = url => page.evaluate(target => fetch(target, { mode: 'no-cors', cache: 'no-store' }).then(() => 'answered', () => 'unreachable'), url);
    for (const host of [
        'https://firestore.googleapis.com/',
        'https://identitytoolkit.googleapis.com/',
        'https://securetoken.googleapis.com/',
        'https://movielistdb-13208.firebaseio.com/',
        'https://us-central1-movielistdb-13208.cloudfunctions.net/spotifyToken',
        'https://movielistdb-13208-updates.web.app/'
    ]) {
        expect(await reach(host), host).toBe('unreachable');
    }
    expect(await reach('https://rutube.ru/'), 'real providers stay reachable').toBe('answered');
    expect(await page.evaluate(() => globalThis.firebase.apps[0].options.projectId)).toBe('demo-movielist-e2e');
    expect(viewer.productionHits).toEqual([]);
});

test('uBlock really blocks while the specs watch', async ({ viewer, page, extension, ublock }) => {
    test.skip(!ublock, 'This run is without uBlock');
    test.skip(!extension.ublock, 'uBlock Origin Lite is not installed in Chrome');
    console.log(`[player] uBlock Origin Lite ${extension.ublock.version}: ${extension.ublock.rulesets.length} filter lists on`);
    expect(extension.ublock.rulesets.length, 'filter lists are on').toBeGreaterThan(0);
    await page.goto('https://rutube.ru/', { waitUntil: 'commit' });
    // Rutube's own page loads counters and ad scripts, which the filter lists name.
    await expect.poll(() => viewer.blockedByUblock.size, { message: 'a real page has requests blocked', timeout: 30000 }).toBeGreaterThan(0);
});

test('a video nobody can see is not reported as playing', async ({ viewer, page }) => {
    await viewer.open(FILM);
    await viewer.checkSource(FILM, { filmstrip: false, watchSeconds: 3 });
    const source = (await viewer.sources()).find(candidate => candidate.value === 'parser:rutube');
    test.skip(!source, 'Rutube, which plays in the page itself, is not offered today');
    await page.addStyleTag({ content: '#videoContainer video { opacity: 0 !important; }' });
    const row = await viewer.checkSource(FILM, { source, filmstrip: false, watchSeconds: 8 });
    expect(row.outcome, 'the element itself reports that it plays').toBe('plays');
    await viewer.judgePictures();
    expect(row.outcome, `brightness ${row.brightest}, change ${row.pictureChange}`).toBe('no-picture');
    viewer.rows.length = 0;
});

test('a stream of another length is not accepted as the film', async ({ viewer }) => {
    await viewer.open(FILM);
    const somethingShorter = { ...FILM, runtimeMinutes: 20, lengthTolerance: 0.1 };
    await viewer.checkSource(somethingShorter, { filmstrip: false, watchSeconds: 3 });
    const rutube = (await viewer.sources()).find(candidate => candidate.value === 'parser:rutube');
    test.skip(!rutube, 'Rutube, which plays in the page itself, is not offered today');
    const row = await viewer.checkSource(somethingShorter, { source: rutube, filmstrip: false, watchSeconds: 3 });
    expect(row.outcome).toBe('wrong-length');
    viewer.rows.length = 0;
});

test('a tab the page opens by itself is noticed', async ({ viewer, page, extension }) => {
    await page.goto(extension.url('src/pages/home/home.html'));
    const [opened] = await Promise.all([
        extension.context.waitForEvent('page'),
        page.evaluate(() => { window.open('https://rutube.ru/'); })
    ]);
    await expect.poll(() => viewer.foreignTabs.length, { message: 'the tab is on record' }).toBe(1);
    await opened.close();
    viewer.foreignTabs.length = 0;
});

test('the judgements themselves', () => {
    expect(lengthFits(10144, FILM), 'the film').toBe(true);
    expect(lengthFits(150, FILM), 'a trailer').toBe(false);
    expect(lengthFits(1, FILM), 'a provider placeholder').toBe(false);
    expect(judgePicture({ brightest: 60, largestChange: 12 }), 'a moving picture').toBe(true);
    expect(judgePicture({ brightest: 0.4, largestChange: 0 }), 'a black screen').toBe(false);
    expect(judgePicture({ brightest: 60, largestChange: 0 }), 'a frozen picture').toBe(false);
});
