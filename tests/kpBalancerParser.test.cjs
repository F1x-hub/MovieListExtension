/**
 * Collaps, Alloha and Veoveo are asked by Kinopoisk ID. Collaps needs nothing else;
 * Alloha and Veoveo take a partner token that the aggregator behind kinopoisk.cx
 * publishes. That aggregator blocks an address after one request that does not look
 * like a browser's, so nothing here reaches the network: every answer is a stub.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const LIST_URL = 'https://p.linkpp.ink/api/players';
const answer = (status, body = '') => ({
    ok: status >= 200 && status < 300, status,
    body: { cancel: async () => undefined },
    text: async () => body,
    json: async () => JSON.parse(body)
});

function environment({ stored, fetch } = {}) {
    const dom = new JSDOM('<div id="host"></div>', { url: 'https://host.test/', runScripts: 'outside-only' });
    const w = dom.window;
    const writes = [];
    w.chrome = { storage: { local: {
        get: async key => (stored && key === 'kpBalancerAccessV1' ? { kpBalancerAccessV1: stored } : {}),
        set: async value => { if (value.kpBalancerAccessV1) writes.push(value.kpBalancerAccessV1); }
    } } };
    const requests = [];
    w.fetch = async url => {
        requests.push(String(url));
        return fetch ? fetch(String(url)) : answer(500);
    };
    w.AbortSignal = AbortSignal;
    w.eval(read('src/shared/services/parsers/BaseParserService.js'));
    w.eval(read('src/shared/services/parsers/KpBalancerParser.js'));
    // The balancer's stored domain is not what these tests are about.
    w.BalancerDomains.load = async () => undefined;
    const parser = id => new w.KpBalancerParser(id);
    return { dom, w, access: w.KpBalancerAccess, requests, writes, parser };
}

const listed = (allohaToken, veoveoToken) => JSON.stringify({ data: [
    { type: 'Alloha', iframeUrl: `https://theatre.stravers.live/?token_movie=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&token=${allohaToken}`, translations: [] },
    { type: 'Vibix', iframeUrl: 'data-publisher-id="1" data-type="movie" data-id="2"', translations: [] },
    { type: 'Veoveo', iframeUrl: `https://player.shortener2.link/balancer-api/iframe?movie_id=1&token=${veoveoToken}`, translations: [] },
    { type: 'Turbo', iframeUrl: null, translations: [] }
] });
const JWT = 'aaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccc';

test('Collaps is asked by the Kinopoisk ID alone, on the balancer domain of the day', async t => {
    const { dom, requests, parser } = environment({ fetch: async () => answer(200, '<title>Мстители</title>') });
    t.after(() => dom.window.close());
    const collaps = parser('collaps');
    const result = await collaps.cachedSearch('Мстители', 2012, { kinopoiskId: 263531, mediaType: 'movie' });
    assert.equal(result.url, 'https://api.corevia.ws/embed/kp/263531');
    assert.equal(result.titleVerified, true);
    assert.deepEqual(requests, ['https://api.corevia.ws/embed/kp/263531']);

    // The original title is another search for a site, and the same one for an ID.
    await collaps.cachedSearch('The Avengers', 2012, { kinopoiskId: '263531', mediaType: 'movie' });
    assert.equal(requests.length, 1, 'one question for one title, whatever its name');

    const sources = await collaps.cachedVideoSources(result);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].url, result.url);
    assert.equal(sources[0].type, 'iframe');
});

test('a name never stands in for an ID', async t => {
    const { dom, requests, parser } = environment({ fetch: async () => answer(200) });
    t.after(() => dom.window.close());
    for (const kinopoiskId of [undefined, null, '', 0, -5, 'Матрица', '12ab', '0123', 1.5]) {
        assert.equal(await parser('collaps').cachedSearch('Матрица', 1999, { kinopoiskId }), null, String(kinopoiskId));
    }
    assert.deepEqual(requests, []);
});

test('a title the balancer does not have is not offered and not asked again at once', async t => {
    const { dom, requests, parser } = environment({ fetch: async () => answer(404) });
    t.after(() => dom.window.close());
    const collaps = parser('collaps');
    assert.equal(await collaps.cachedSearch('Нет такого', 2020, { kinopoiskId: 99999999 }), null);
    assert.equal(await collaps.cachedSearch('No such', 2020, { kinopoiskId: 99999999 }), null);
    assert.equal(requests.length, 1);
    collaps.clearCache();
    await collaps.cachedSearch('Нет такого', 2020, { kinopoiskId: 99999999 });
    assert.equal(requests.length, 2, 'a forced search asks again');
});

test('an error is not remembered as "no such title"', async t => {
    let status = 503;
    const { dom, requests, parser } = environment({ fetch: async () => answer(status) });
    t.after(() => dom.window.close());
    const collaps = parser('collaps');
    assert.equal(await collaps.cachedSearch('Мстители', 2012, { kinopoiskId: 263531 }), null);
    status = 200;
    assert.ok(await collaps.cachedSearch('Мстители', 2012, { kinopoiskId: 263531 }));
    assert.equal(requests.length, 2);
});

test('Alloha is asked in the name of a site, and its frame address carries the film token', async t => {
    const page = "var u='https://x/?token_movie\\u003D6105d09d3758c8e402e39dba06e24e\\u0026id\\u003D842156';";
    const { dom, requests, parser } = environment({ fetch: async () => answer(200, page) });
    t.after(() => dom.window.close());
    const alloha = parser('alloha');
    const result = await alloha.cachedSearch('Мстители', 2012, { kinopoiskId: 263531 });
    const asked = new URL(requests[0]);
    assert.equal(asked.hostname, 'theatre.stravers.live');
    assert.equal(asked.searchParams.get('kp'), '263531');
    assert.equal(asked.searchParams.get('movieExtensionSite'), 'linkpp.ink', 'the Referer rule reads this mark');
    const embed = new URL(result.url);
    assert.equal(embed.searchParams.get('token_movie'), '6105d09d3758c8e402e39dba06e24e');
    assert.equal(embed.searchParams.get('token'), '5009a7a2d05cb714cc53c8408471e3');
    assert.equal(embed.searchParams.has('kp'), false);
    assert.equal(embed.searchParams.has('movieExtensionSite'), false, 'the renderer adds the mark to the frame itself');
    assert.equal((await alloha.cachedVideoSources(result))[0].url, result.url);
});

test('the Referer rule for Alloha covers both its frame and the question whether it has a title', () => {
    const rule = JSON.parse(read('src/background/provider-embed-rules.json'))
        .find(entry => new RegExp(entry.condition.regexFilter).test('https://theatre.stravers.live/?kp=1&token=a&movieExtensionSite=linkpp.ink'));
    assert.ok(rule, 'a rule for the site Alloha is asked in the name of');
    assert.equal(rule.action.requestHeaders[0].value, 'https://linkpp.ink/');
    assert.deepEqual(rule.condition.resourceTypes, ['sub_frame', 'xmlhttprequest']);
    assert.deepEqual(rule.condition.requestDomains, ['stravers.live', 'allarknow.online', 'stloadi.live']);
    const manifest = JSON.parse(read('manifest.json'));
    assert.ok(manifest.host_permissions.includes('https://*.shortener2.link/*'), 'Veoveo answers are read by an extension page');
});

test('a miss asks the aggregator for its tokens once a day, and a new token is tried at once', async t => {
    const fresh = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const { dom, requests, writes, access, parser } = environment({ fetch: async url => {
        if (url.startsWith(LIST_URL)) return answer(200, listed(fresh, JWT));
        return answer(url.includes(`token=${fresh}`) ? 200 : 404, 'token_movie=cccccccccccccccccccccccccccccc');
    } });
    t.after(() => dom.window.close());
    const result = await parser('alloha').cachedSearch('Мстители', 2012, { kinopoiskId: 263531 });
    assert.equal(new URL(result.url).searchParams.get('token'), fresh);
    assert.equal(requests.filter(url => url.startsWith(LIST_URL)).length, 1);
    assert.equal(requests.find(url => url.startsWith(LIST_URL)), `${LIST_URL}?kinopoisk=263531`);
    assert.equal(access.veoveo.token, JWT, 'one answer renews both');
    assert.equal(writes.at(-1).alloha.token, fresh);
    assert.ok(writes.at(-1).askedAt > 0);

    // Another title Alloha does not have: the day's question is already spent.
    await parser('alloha').cachedSearch('Нет такого', 2020, { kinopoiskId: 99999999 });
    await parser('veoveo').cachedSearch('Нет такого', 2020, { kinopoiskId: 99999998 });
    assert.equal(requests.filter(url => url.startsWith(LIST_URL)).length, 1);
});

test('the day between questions holds across pages', async t => {
    const { dom, requests, parser } = environment({
        stored: { askedAt: Date.now() - 60 * 60 * 1000 },
        fetch: async () => answer(404)
    });
    t.after(() => dom.window.close());
    assert.equal(await parser('veoveo').cachedSearch('Нет такого', 2020, { kinopoiskId: 99999999 }), null);
    assert.ok(!requests.some(url => url.startsWith(LIST_URL)));
});

test('only addresses and tokens of the known shape are taken from the list', t => {
    const { dom, access } = environment();
    t.after(() => dom.window.close());
    const before = { ...access.alloha };
    for (const payload of [
        null, {}, { data: 'text' }, { error: { title: 'x' } },
        JSON.parse(listed('not-hex!', 'no-dots')),
        { data: [{ type: 'Alloha', iframeUrl: 'https://evil.example/?token=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] },
        { data: [{ type: 'Alloha', iframeUrl: 'http://theatre.stravers.live/?token=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] },
        { data: [{ type: 'Alloha', iframeUrl: 'https://stravers.live.evil.example/?token=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] },
        { data: [{ type: 'Alloha', iframeUrl: null }, { type: 'Veoveo', iframeUrl: null }] }
    ]) {
        assert.equal(access.apply(access.parseList(payload)), false, JSON.stringify(payload));
    }
    assert.deepEqual({ ...access.alloha }, before);
    // Alloha's other known domains are covered by the manifest as well.
    assert.equal(access.apply(access.parseList({ data: [
        { type: 'Alloha', iframeUrl: 'https://new.allarknow.online/?token_movie=a&token=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
    ] })), true);
    assert.equal(access.alloha.host, 'new.allarknow.online');
});

test('a challenge page instead of the list changes nothing', async t => {
    const { dom, access, parser } = environment({ fetch: async url =>
        (url.startsWith(LIST_URL) ? answer(200, '<html>403</html>') : answer(404)) });
    t.after(() => dom.window.close());
    const before = access.alloha.token;
    assert.equal(await parser('alloha').cachedSearch('Мстители', 2012, { kinopoiskId: 263531 }), null);
    assert.equal(access.alloha.token, before);
});

test('Veoveo is asked by ID with its token; stored tokens win over the built-in ones', async t => {
    const { dom, requests, parser } = environment({
        stored: { veoveo: { host: 'player.shortener2.link', token: JWT } },
        fetch: async () => answer(200)
    });
    t.after(() => dom.window.close());
    const result = await parser('veoveo').cachedSearch('Мстители', 2012, { kinopoiskId: 263531 });
    assert.equal(result.url, `https://player.shortener2.link/balancer-api/iframe?kp=263531&token=${JWT}`);
    assert.deepEqual(requests, [result.url]);
});

test('each parser hands out only its own balancer frames', async t => {
    const { dom, parser } = environment();
    t.after(() => dom.window.close());
    const foreign = [
        'https://evil.example/embed/kp/1', 'http://api.corevia.ws/embed/kp/1', 'https://api.corevia.ws/embed/movie/1',
        'https://api.corevia.ws/embed/kp/1/../../x', 'javascript:alert(1)', '', null
    ];
    for (const url of foreign) assert.deepEqual([...await parser('collaps').getVideoSources(url)], [], String(url));
    assert.deepEqual([...await parser('alloha').getVideoSources('https://api.corevia.ws/embed/kp/1')], []);
    assert.deepEqual([...await parser('veoveo').getVideoSources(`https://player.shortener2.link/other?token=${JWT}`)], []);
    assert.equal((await parser('collaps').getVideoSources('https://api.corevia.ws/embed/kp/1')).length, 1);
});

// In the owner's Chrome on 2026-11-27 Alloha's frame for «Игра престолов» opened on S8E6.
// Moved to S1E2 through its menu, it fell back to S1E1 once the season had changed, played
// that, and reported it as the viewer's own move.
test('Alloha opens on the episode by its address, and is opened again for another one', async t => {
    const { dom, w, parser } = environment();
    t.after(() => dom.window.close());
    const source = { url: 'https://theatre.stravers.live/?token=5009a7a2d05cb714cc53c8408471e3&token_movie=83a9126c6994b1d6414b0f387f3cdf' };
    const opened = new URL(parser('alloha').getFrameUrl(source, { season: 1, episode: 2 }));
    assert.equal(opened.searchParams.get('season'), '1');
    assert.equal(opened.searchParams.get('episode'), '2');
    assert.equal(opened.searchParams.get('token_movie'), '83a9126c6994b1d6414b0f387f3cdf');
    for (const options of [{}, { season: null, episode: null }, { season: 0, episode: 1 }, { season: 1 }, { season: '1x', episode: 2 }]) {
        assert.equal(parser('alloha').getFrameUrl(source, options), source.url, JSON.stringify(options));
    }
    const venom = { url: 'https://api.corevia.ws/embed/kp/464963' };
    assert.equal(parser('collaps').getFrameUrl(venom, { season: 1, episode: 2 }), venom.url, 'Collaps is moved through its bridge, as with Ex-FS');

    // The renderer puts that address into the frame.
    const host = w.document.getElementById('host');
    parser('alloha').renderPlayer(host, [{ ...source, type: 'iframe' }], { season: 3, episode: 5, lifecycle: false, frameHello: false });
    const frame = new URL(host.querySelector('iframe').src);
    assert.equal(frame.searchParams.get('season'), '3');
    assert.equal(frame.searchParams.get('episode'), '5');
    assert.equal(frame.searchParams.get('movieExtensionSite'), 'linkpp.ink');

    const { KpBalancerAdapter } = require('../src/shared/services/player/adapters/KpBalancerAdapter.js');
    const alloha = new KpBalancerAdapter('alloha');
    alloha.activeContainer = host;
    assert.equal(await alloha.applySelection({ seasonNumber: 3, episodeNumber: 6 }), false, 'another episode: the page opens the frame again');
    assert.equal(await alloha.applySelection({ seasonNumber: 4, episodeNumber: 5 }), false, 'another season');
    assert.equal(alloha._frameOpenedOn({ seasonNumber: 3, episodeNumber: 5 }), true, 'the episode it was opened on goes to the bridge');
    alloha.activeContainer = null;
    assert.equal(await alloha.applySelection({ seasonNumber: 3, episodeNumber: 5 }), false, 'no frame, nothing to steer');
});

test('the three sources are registered, and their adapters say what the frames can do', () => {
    const init = read('src/shared/services/parsers/parser-init.js');
    assert.match(init, /new ParserRegistry\(\['kinogo', 'exfs', 'seasonvar', 'collaps', 'alloha', 'rutube', 'animego', 'officialyt', 'hdrezka', 'veoveo'\]\)/);
    const page = read('src/pages/movie-details/movie-details.html');
    assert.ok(page.indexOf('parsers/KpBalancerParser.js') < page.indexOf('parsers/parser-init.js'));
    assert.ok(page.indexOf('adapters/KpBalancerAdapter.js') < page.indexOf('player/PlaybackController.js'));

    const { KpBalancerAdapter } = require('../src/shared/services/player/adapters/KpBalancerAdapter.js');
    assert.deepEqual(KpBalancerAdapter.IDS, ['collaps', 'alloha', 'veoveo']);
    for (const id of ['collaps', 'alloha']) {
        const adapter = new KpBalancerAdapter(id);
        assert.equal(adapter.getSelectionMode(), 'NATIVE_BRIDGE', id);
        assert.equal(adapter.getProgressConfidence(), 'PARTIAL', id);
        assert.equal(adapter.supportsAutoNext(), false, id);
    }
    const veoveo = new KpBalancerAdapter('veoveo');
    assert.equal(veoveo.getSelectionMode(), 'OPAQUE');
    assert.equal(veoveo.getProgressConfidence(), 'OPAQUE');
    assert.equal(veoveo.supportsEpisodePicker(), false);
    // Its frame has season and episode menus of its own, so the viewer is sent there
    // instead of being told that the source searches by name.
    assert.equal(veoveo.hasOwnEpisodeList(), true);
    assert.match(read('src/pages/movie-details/movie-details.js'), /activeAdapter\.hasOwnEpisodeList\(\)/);
    assert.throws(() => new KpBalancerAdapter('turbo'));

    for (const file of ['src/shared/services/player/PlayerDiagnostics.js', 'src/shared/services/player/PlayerMetrics.js',
        'src/shared/services/player/WatchPreferences.js', 'src/pages/movie-details/PlayerDiagnosticsPanel.js']) {
        for (const id of KpBalancerAdapter.IDS) assert.ok(read(file).includes(`'${id}'`), `${file}: ${id}`);
    }
});
