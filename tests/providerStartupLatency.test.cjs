const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(storage = {}) {
    const dom = new JSDOM('<div id="player"></div>', {
        url: 'chrome-extension://test/movie-details.html', runScripts: 'outside-only'
    });
    const { window } = dom;
    window.chrome = { storage: { local: {
        get: (keys, done) => done(Object.fromEntries(keys.map(key => [key, storage[key]]))),
        set: values => { Object.assign(storage, values); return Promise.resolve(); }
    } } };
    for (const file of ['BaseParserService', 'ExFsParser', 'KinogoParser']) {
        window.eval(fs.readFileSync(path.join(__dirname, `../src/shared/services/parsers/${file}.js`), 'utf8'));
    }
    return { dom, window, storage, host: window.document.getElementById('player') };
}

test('Ex-FS uses search POST + one movie page; probe never gates mount or repeat-open caches', async () => {
    const h = harness();
    try {
        const parser = new h.window.ExFsParser();
        const calls = [];
        let finishProbe;
        parser.fetchWithTimeout = (url, options = {}, timeout) => {
            calls.push({ url, method: options.method || 'GET', timeout });
            if (url.includes('do=search')) return Promise.resolve({ ok: true, text: async () =>
                '<div id="dle-content"><div class="SeaRchresultPost"><div class="SeaRchresultPostTitle"><a href="/film/matrix.html">Матрица</a></div><div class="SeaRchresultPostInfo">1999</div></div></div>' });
            if (url.includes('/film/')) return Promise.resolve({ ok: true, text: async () =>
                '<ul class="nav-tabs"><li><a href="#full">Плеер Full HD</a></li></ul><div class="tab-content"><div class="tab-pane" id="full"><iframe src="https://api.variyt.ws/embed/kp/301"></iframe></div></div>' });
            return new Promise(resolve => { finishProbe = resolve; });
        };
        const result = await parser.cachedSearch('Матрица', 1999, { mediaType: 'movie' });
        let settled = false;
        const pending = parser.cachedVideoSources(result).then(value => { settled = true; return value; });
        await tick();
        assert.equal(settled, true, 'source discovery must settle while the probe is still unresolved');
        const sources = await pending;
        assert.equal(parser.renderPlayer(h.host, sources, { lifecycle: false }), true);
        assert.ok(h.host.querySelector('iframe'), 'the player is mounted before probe completion');
        assert.equal(await parser.cachedSearch('Матрица', 1999, { mediaType: 'movie' }), result);
        assert.equal(await parser.cachedVideoSources(result), sources);
        assert.equal(calls.length, 3, 'second open reuses both provider pages and the in-flight probe');
        assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'GET']);
        assert.equal(calls[2].timeout, 4000, 'keep the availability timeout budget');
        finishProbe({ status: 200 }); await tick();
        await parser.cachedVideoSources(result);
        assert.equal(calls.length, 3, 'successful availability is reused too');
    } finally { h.dom.window.close(); }
});

test('late missing embeds fail over finitely; a stale or detached mount cannot replace a new player', async () => {
    const h = harness();
    try {
        const parser = new h.window.ExFsParser();
        const completions = new Map();
        parser.fetchWithTimeout = url => new Promise(resolve => completions.set(url, resolve));
        const sources = [301, 302].map(id => ({ type: 'iframe', url: `https://api.variyt.ws/embed/kp/${id}` }));
        let current = true;
        parser.renderPlayer(h.host, sources, { lifecycle: false, isRequestCurrent: () => current });
        completions.get(sources[0].url)({ status: 404 }); await tick();
        assert.ok(h.host.querySelector('iframe').src.includes('/302'), 'missing first embed advances to fallback');
        current = false;
        const replacement = h.host.querySelector('iframe');
        completions.get(sources[1].url)({ status: 410 }); await tick();
        assert.equal(h.host.querySelector('iframe'), replacement, 'stale checks cannot touch the current player');
        current = true;
        parser.clearCache();
        parser.renderPlayer(h.host, sources, { lifecycle: false });
        const old = h.host.querySelector('iframe');
        h.host.replaceChildren(h.window.document.createElement('video'));
        completions.get(sources[0].url)({ status: 404 }); await tick();
        assert.equal(old.isConnected, false);
        assert.ok(h.host.querySelector('video'), 'detached embed cannot overwrite replacement media');
        parser.clearCache();
        let failures = 0;
        parser.fetchWithTimeout = async () => ({ status: 404 });
        parser.renderPlayer(h.host, sources, { lifecycle: false, onLifecycleState: state => { if (state === 'error') failures++; } });
        await tick();
        assert.equal(failures, 1, 'all missing embeds terminate once without a fallback loop');
    } finally { h.dom.window.close(); }
});

test('probe network failure keeps playback and cache invalidation rejects late refinement', async () => {
    const h = harness();
    try {
        const parser = new h.window.ExFsParser();
        const sources = [{ type: 'iframe', url: 'https://api.variyt.ws/embed/kp/301' }];
        parser.getVideoSources = async () => sources;
        let finish;
        parser.fetchWithTimeout = () => new Promise(resolve => { finish = resolve; });
        await parser.cachedVideoSources('page');
        parser.clearCache();
        finish({ status: 404 }); await tick();
        assert.equal(parser._sourceCache.size, 0);
        parser.fetchWithTimeout = async () => { throw Error('timeout'); };
        const pending = await parser.cachedVideoSources('page');
        parser.renderPlayer(h.host, pending, { lifecycle: false }); await tick();
        assert.ok(h.host.querySelector('iframe'), 'unknown availability leaves normal lifecycle handling intact');
    } finally { h.dom.window.close(); }
});

test('KinoGo remembers an allowlisted mirror with TTL and keeps failover and series preference', async () => {
    const h = harness({ kinogo_active_mirror: 'https://kinogo.film', kinogo_active_mirror_at: Date.now() });
    try {
        const Parser = h.window.KinogoParser;
        const parser = new Parser({ mirrorHedgeDelayMs: 5 });
        await parser._activeMirrorReady;
        const calls = [];
        parser._searchMirror = async mirror => {
            calls.push(mirror);
            return { title: 'Матрица', year: '1999', url: `${mirror}/matrix.html` };
        };
        await parser.search('Матрица', 1999, { mediaType: 'movie' });
        assert.deepEqual(calls, ['https://kinogo.film']);
        assert.ok(h.storage.kinogo_active_mirror_at <= Date.now());
        assert.equal(parser.getMirrors({ mediaType: 'tv-series' })[0], 'https://kinogo.my');
        calls.length = 0;
        parser._searchMirror = async mirror => {
            calls.push(mirror);
            if (mirror === 'https://kinogo.film') throw Error('dead mirror');
            return { title: 'Матрица', year: '1999', url: `${mirror}/matrix.html` };
        };
        await parser.search('Матрица', 1999, { mediaType: 'movie' });
        assert.deepEqual(calls, ['https://kinogo.film', 'https://kinogo.la']);
        const reopened = new Parser(); await reopened._activeMirrorReady;
        assert.equal(reopened.getMirrors()[0], 'https://kinogo.la');
        for (const [mirror, timestamp] of [
            ['https://kinogo.film', Date.now() - Parser.MIRROR_TTL_MS - 1],
            ['https://kinogo.film', Date.now() + 60000],
            ['https://unknown.test', Date.now()], ['https://kinogo.film', undefined]
        ]) {
            h.storage.kinogo_active_mirror = mirror; h.storage.kinogo_active_mirror_at = timestamp;
            const expired = new Parser(); await expired._activeMirrorReady;
            assert.equal(expired.getMirrors()[0], 'https://kinogo.la');
        }
    } finally { h.dom.window.close(); }
});

test('KinoGo persists only the winning source mirror, even if an aborted loser answers late', async () => {
    const h = harness();
    try {
        const parser = new h.window.KinogoParser({ mirrorHedgeDelayMs: 5 });
        await parser._activeMirrorReady;
        let finishSlow;
        const response = { ok: true, text: async () => 'fixture' };
        parser.fetchWithTimeout = url => url.startsWith('https://kinogo.la/')
            ? new Promise(resolve => { finishSlow = resolve; }) : Promise.resolve(response);
        parser.extractKinogoDirectSources = (_html, pageUrl) => [{ type: 'iframe', url: `${pageUrl}/embed` }];
        const sources = await parser.getVideoSources({ url: 'https://kinogo.la/film.html' });
        assert.ok(sources[0].url.startsWith('https://kinogo.film/'));
        assert.equal(h.storage.kinogo_active_mirror, 'https://kinogo.film');
        finishSlow(response); await tick();
        assert.equal(h.storage.kinogo_active_mirror, 'https://kinogo.film', 'late loser cannot poison the next open');
    } finally { h.dom.window.close(); }
});
