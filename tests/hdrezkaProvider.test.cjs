const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const project = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(project, file), 'utf8');
const movieUrl = 'https://hdrezka.co/films/fiction/1234-synthetic-film-2024.html';
const otherMovieUrl = 'https://hdrezka.co/films/fiction/1235-synthetic-film-1984.html';
const manifest = (host = 'weyland.stream.voidboost.one', height = 720) =>
    `https://${host}/synthetic-session/1/2/3/movie-${height}.mp4:hls:manifest.m3u8`;

function environment(service = { request: async () => ({ results: [] }) }) {
    const dom = new JSDOM('<!doctype html><div id="player"></div>', {
        runScripts: 'outside-only', url: 'https://extension.test/'
    });
    const { window } = dom;
    const writes = [];
    window.WatchPreferences = {
        get: async () => ({}),
        patch: async (movieId, delta) => { writes.push({ movieId, delta }); return delta; }
    };
    window.eval(read('src/shared/services/player/HdrezkaProtocol.js'));
    window.eval(read('src/shared/services/player/HdrezkaSessionService.js'));
    window.eval(read('src/shared/services/parsers/BaseParserService.js'));
    window.eval(read('src/shared/services/parsers/HdrezkaParser.js'));
    return { dom, window, protocol: window.HdrezkaProtocol, parser: new window.HdrezkaParser({ service }), writes };
}

function coordinatedApi(window, api) {
    api.runtime = { id: 'fixture', getURL: value => `chrome-extension://fixture/${value}` };
    api.tabs.get ||= async id => ({ id, status: 'complete', url: 'https://hdrezka.co/', active: false });
    const coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    api.runtime.sendMessage = message => coordinator.handleMessage(message, { id: 'fixture', url: api.runtime.getURL('src/pages/movie-details/movie-details.html') });
    return api;
}

async function recoveryMount(t) {
    const details = { movieId: '1234', kinopoiskId: '24680', activeTranslationId: '56',
        translations: [{ id: '56', name: 'Дубляж' }, { id: '336', name: 'Тестовая озвучка' }] };
    const control = { current: true, failureCode: null, expired: false, streamGate: null, nextDetails: null };
    const calls = [];
    const env = environment({
        request: async (operation, payload) => {
            calls.push({ operation, payload });
            if (operation === 'details') return details;
            if (operation !== 'streams') throw new Error(`Unexpected operation: ${operation}`);
            if (control.streamGate) await control.streamGate;
            if (control.failureCode) throw Object.assign(new Error(control.failureCode), { code: control.failureCode });
            return { ...(control.nextDetails || details), response: { success: true, premium_content: 0, quality: '480p',
                url: `[480p]${manifest('stream.voidboost.one', 480)},[720p]${manifest('stream.voidboost.one', 720)}` } };
        },
        resolve: async value => {
            if (control.expired) throw Object.assign(new Error('Expired fixture'), { code: 'HDREZKA_STREAM_EXPIRED' });
            return value.replace('stream.voidboost.one/', 'weyland.stream.voidboost.one/');
        }
    });
    const { dom, window, parser } = env;
    t.after(() => { window.document.getElementById('player')._hdrezkaDispose?.(); dom.window.close(); });
    window.HTMLMediaElement.prototype.pause = function () {};
    window.HTMLMediaElement.prototype.play = async function () {};
    class FixtureHls {
        static isSupported() { return true; }
        constructor() { this.handlers = new Map(); this.destroyed = false; }
        on(event, callback) { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(callback); }
        emit(event, data) { for (const callback of this.handlers.get(event) || []) callback(event, data); }
        loadSource() {}
        attachMedia() {}
        stopLoad() {}
        destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('hlsDestroying'); } }
    }
    window.Hls = FixtureHls;
    for (const name of ['UrlPolicy', 'HlsPolicyLoader', 'HlsPlaybackFactory']) {
        window.eval(read(`src/shared/services/player/${name}.js`));
    }
    const states = [];
    const overlays = [];
    const diagnostics = [];
    window.console.warn = (...args) => diagnostics.push(args.join(' '));
    window.PlayerSourceLifecycle = { setState: (_container, state, data) => overlays.push({ state, data }),
        watchVideo: () => ({ cancel() {} }) };
    let resolveFailure;
    const failure = new Promise(resolve => { resolveFailure = resolve; });
    const container = window.document.getElementById('player');
    const sources = await parser.getVideoSources({ url: movieUrl });
    const video = await parser.renderPlayer(container, sources, { movieId: '24680', isRequestCurrent: () => control.current,
        onLifecycleState: (state, data) => { states.push({ state, data }); if (state === 'error') resolveFailure(); } });
    assert.ok(video, 'recovery begins with a successful native mount');
    return { ...env, control, calls, container, video, hls: video._movieExtensionHls, states, overlays, diagnostics, failure };
}

test('HDRezka page URLs reject foreign hosts, credentials and non-page endpoints', t => {
    const { dom, protocol } = environment();
    t.after(() => dom.window.close());
    assert.equal(protocol.pageUrl(movieUrl), movieUrl);
    for (const rejected of [null, '', 'not a URL', 'javascript:alert(1)',
        movieUrl.replace('https:', 'http:'), movieUrl.replace('hdrezka.co', 'hdrezka.co.evil.test'),
        movieUrl.replace('hdrezka.co', 'evil.hdrezka.co'), movieUrl.replace('hdrezka.co', 'user:secret@hdrezka.co'),
        movieUrl.replace('hdrezka.co', 'hdrezka.co:8443'), 'https://hdrezka.co/ajax/get_cdn_series/',
        'https://hdrezka.co/search/?q=synthetic', 'https://hdrezka.co/films/fiction/not-a-film.html']) {
        assert.equal(protocol.pageUrl(rejected), null, `page rejected: ${rejected}`);
    }
});

test('HDRezka stream routing is explicit and limited to reviewed public HTTPS hosts', t => {
    const { dom, protocol } = environment();
    t.after(() => dom.window.close());
    for (const host of ['weyland', 'hronos', 'dagon', 'magic', 'bingo', 'eleos', 'ember']) {
        assert.equal(protocol.streamUrl(manifest(`${host}.stream.voidboost.one`)), manifest(`${host}.stream.voidboost.one`));
    }
    const routing = manifest('stream.voidboost.one');
    assert.equal(protocol.streamUrl(routing), null);
    assert.equal(protocol.streamUrl(routing, { routing: true }), routing);
    for (const rejected of [null, '', 'not a URL', 'file:///C:/movie.m3u8',
        manifest().replace('https:', 'http:'), manifest('other.stream.voidboost.one'),
        manifest('evil.weyland.stream.voidboost.one'), manifest('weyland.stream.voidboost.one.evil.test'),
        manifest('evil.eleos.stream.voidboost.one'), manifest('eleos.stream.voidboost.one.evil.test'),
        manifest('evil.ember.stream.voidboost.one'), manifest('ember.stream.voidboost.one.evil.test'),
        manifest('127.0.0.1'), manifest('localhost'), manifest('user:secret@weyland.stream.voidboost.one'),
        manifest('weyland.stream.voidboost.one:8443'),
        'https://weyland.stream.voidboost.one/ajax/get_cdn_series/',
        'https://weyland.stream.voidboost.one/synthetic/movie.mp4']) {
        assert.equal(protocol.streamUrl(rejected, { routing: true }), null, `stream rejected: ${rejected}`);
    }
});

test('HDRezka qualities select ordinary HLS variants without premium or MP4 alternatives', t => {
    const { dom, protocol } = environment();
    t.after(() => dom.window.close());
    const parts = [360, 480, 720, 1080].map(height =>
        `[${height}p]${manifest('stream.voidboost.one', height)} or https://stream.voidboost.one/synthetic/movie-${height}.mp4`);
    parts.push(`[<span class="pjs-prem-quality">1080p Ultra<img src="https://static.hdrezka.ac/prem-icon.svg"></span>]${manifest('stream.voidboost.one', 9999)}`);
    const result = protocol.qualities({ success: true, premium_content: 0, quality: '480p', url: parts.join(',') });
    assert.deepEqual(Array.from(result, item => item.height).sort((a, b) => a - b), [360, 480, 720, 1080]);
    for (const item of result) {
        assert.equal(item.url, manifest('stream.voidboost.one', item.height));
        assert.equal(item.url.includes('9999'), false, 'premium is not promoted to ordinary 1080p');
    }
});

test('HDRezka malformed, unsuccessful, premium and untrusted quality responses yield no streams', t => {
    const { dom, protocol } = environment();
    t.after(() => dom.window.close());
    for (const response of [null, {}, { success: false, url: `[720p]${manifest()}` },
        { success: 'true', url: `[720p]${manifest()}` },
        { success: true, premium_content: 1, url: `[720p]${manifest()}` },
        { success: true, premium_content: true, url: `[720p]${manifest()}` },
        { success: true, url: null }, { success: true, url: {} },
        { success: true, url: '[720p]https://evil.test/movie.m3u8' },
        { success: true, url: '[720p]https://stream.voidboost.one/synthetic/movie.mp4' },
        { success: true, url: `[1080p Ultra]${manifest('stream.voidboost.one', 1080)}` }]) {
        assert.equal(protocol.qualities(response).length, 0, 'invalid response must not produce a playable source');
    }
});

test('HDRezka resolver diagnostics retain only closed fields, never URLs, tokens or bodies', t => {
    const { dom, protocol } = environment();
    t.after(() => dom.window.close());
    const input = { code: 'HDREZKA_RESOLVER_RESPONSE_FAILED', cdnReason: 'http', status: 503,
        responseType: 'html', url: manifest(), message: 'secret token', body: '<html>private</html>' };
    assert.deepEqual(JSON.parse(JSON.stringify(protocol.resolverFailure(input))), {
        code: 'HDREZKA_RESOLVER_RESPONSE_FAILED', cdnReason: 'http', status: 503, responseType: 'html'
    });
    assert.deepEqual(JSON.parse(JSON.stringify(protocol.resolverFailure({
        code: manifest(), cdnReason: 'secret token', status: '503', responseType: '<html>private</html>'
    }))), { code: 'HDREZKA_RESOLVER_RESPONSE_FAILED' });
});

test('HDRezka resolver timeout stays distinct from network errors and aborts its request', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    window.history.replaceState(null, '', '#' + 'a'.repeat(32));
    let connect;
    let receive;
    let timeout;
    let cleared = false;
    let aborted = false;
    const messages = [];
    window.chrome = { runtime: { id: 'fixture', getURL: () => 'https://extension.test/',
        onConnect: { addListener(listener) { connect = listener; } } } };
    window.setTimeout = callback => { timeout = callback; return 1; };
    window.clearTimeout = () => { cleared = true; };
    window.fetch = async (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
            aborted = true;
            reject(new window.DOMException('May contain a signed URL', 'AbortError'));
        });
    });
    window.eval(read('src/pages/hdrezka-resolver/resolver.js'));
    connect({ name: 'hdrezka-resolver:' + 'a'.repeat(32), sender: { id: 'fixture', url: 'https://extension.test/player.html' },
        onDisconnect: { addListener() {} }, onMessage: { addListener(listener) { receive = listener; } },
        postMessage(value) { messages.push(value); } });
    const pending = receive({ url: manifest('stream.voidboost.one') });
    timeout();
    await pending;
    assert.equal(aborted, true);
    assert.equal(cleared, true);
    assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ code: 'HDREZKA_RESOLVE_FAILED', cdnReason: 'timeout', error: 'HDREZKA_RESOLVE_FAILED' }]);
});

test('HDRezka movie search checks exact title and year rather than accepting a remake, sequel or series', async t => {
    const requests = [];
    let results = [
        { url: otherMovieUrl, title: 'Дюна', year: 1984, isSeries: false },
        { url: movieUrl.replace('1234-', '1236-'), title: 'Дюна 2', year: 2024, isSeries: false },
        { url: movieUrl.replace('1234-', '1237-'), title: 'Дюна', year: 2024, isSeries: true },
        { url: movieUrl, title: 'Дюна', year: 2024, isSeries: false }
    ];
    const { dom, parser } = environment({ request: async (operation, payload) => {
        requests.push({ operation, payload });
        return { results };
    } });
    t.after(() => dom.window.close());
    assert.equal(parser.getPlayerType(), 'custom');
    assert.equal(parser.supportsMedia({ type: 'movie', isSeries: false }, 'movie'), true);
    assert.equal(parser.supportsMedia({ type: 'tv-series', isSeries: true }, 'tv-series'), false);
    assert.equal(parser.supportsMedia({ type: 'anime', isSeries: true }, 'anime'), false, 'anime series are not films');
    assert.equal((await parser.search('Дюна', 2024, { mediaType: 'movie' }))?.url, movieUrl);
    assert.equal(requests[0].operation, 'search');
    assert.equal(requests[0].payload.query, 'Дюна');
    results = results.slice(0, 3);
    assert.equal(await parser.search('Дюна', 2024, { mediaType: 'movie' }), null);
    results = [{ url: movieUrl, title: 'Дюна', year: 2023, isSeries: false }];
    assert.equal(await parser.search('Дюна', 2024, { mediaType: 'movie' }), null, 'year must match exactly');
    results = [{ url: 'https://evil.test/films/fiction/1234-movie.html', title: 'Дюна', year: 2024, isSeries: false }];
    assert.equal(await parser.search('Дюна', 2024, { mediaType: 'movie' }), null, 'matching text cannot authorize an external page');
});

test('HDRezka stable descriptors and source cache never retain signed playback responses', async t => {
    const operations = [];
    const { dom, parser, writes } = environment({ request: async (operation, payload) => {
        operations.push({ operation, payload });
        if (operation !== 'details') throw new Error(`Unexpected operation: ${operation}`);
        return {
            movieId: '1234', kinopoiskId: '24680', activeTranslationId: '56',
            translations: [{ id: '56', name: 'Дубляж' }, { id: '336', name: 'Тестовая озвучка' }],
            url: `${manifest()}?signed=DO_NOT_STORE`,
            streams: [{ height: 720, url: `${manifest()}?signed=DO_NOT_STORE` }]
        };
    } });
    t.after(() => dom.window.close());
    const sources = await parser.cachedVideoSources({ url: movieUrl });
    assert.ok(sources.length > 0);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].operation, 'details');
    assert.equal(operations[0].payload.url, movieUrl);
    assert.equal(sources.every(source => source.url === movieUrl), true, 'preload stores page descriptors');
    const cached = await parser.cachedVideoSources({ url: movieUrl });
    assert.equal(cached.length, sources.length);
    assert.equal(operations.length, 1, 'stable metadata is reusable without fetching playback links');
    parser.setPreferredTranslation('1234', '336', '24680');
    await new Promise(resolve => setTimeout(resolve, 0));
    const serialized = JSON.stringify({ sources, cache: Array.from(parser._sourceCache.entries()), writes });
    assert.equal(serialized.includes('DO_NOT_STORE'), false);
    assert.equal(serialized.includes('voidboost.one'), false);
    if (writes.length) {
        assert.equal(writes.at(-1).delta.providers.hdrezka.translationId, '336');
    }
});

test('HDRezka access-required search is recoverable and never cached as a missing film', async t => {
    let attempts = 0;
    const { dom, parser } = environment({ request: async () => {
        if (++attempts === 1) {
            const failure = new Error('Browser session needs access confirmation');
            failure.code = 'HDREZKA_ACCESS_REQUIRED';
            throw failure;
        }
        return { results: [{ url: movieUrl, title: 'Тестовый фильм', year: 2024, isSeries: false }] };
    } });
    t.after(() => dom.window.close());
    assert.equal(await parser.cachedSearch('Тестовый фильм', 2024, { mediaType: 'movie' }), null);
    assert.equal(parser.accessRequired, true, 'the source rail can distinguish browser access from a search miss');
    assert.equal((await parser.cachedSearch('Тестовый фильм', 2024, { mediaType: 'movie' }))?.url, movieUrl);
    assert.equal(attempts, 2, 'access confirmation can retry immediately');
    assert.equal(parser.accessRequired, false);
});

test('HDRezka native mount uses the shared lifecycle API and canonical progress ownership', async t => {
    const details = {
        movieId: '1234', kinopoiskId: '24680', activeTranslationId: '56',
        translations: [{ id: '56', name: 'Дубляж' }, { id: '336', name: 'Тестовая озвучка' }]
    };
    const operations = [];
    const { dom, window, parser, writes } = environment({
        request: async (operation, payload) => {
            operations.push({ operation, payload });
            if (operation === 'details') return details;
            if (operation === 'streams') return { ...details, response: {
                success: true, premium_content: 0, quality: '480p',
                url: `[480p]${manifest('stream.voidboost.one', 480)},[720p]${manifest('stream.voidboost.one', 720)}`
            } };
            throw new Error(`Unexpected operation: ${operation}`);
        },
        resolve: async value => value.replace('stream.voidboost.one/', 'weyland.stream.voidboost.one/')
    });
    t.after(() => dom.window.close());
    window.HTMLMediaElement.prototype.pause = function () {};
    window.HTMLMediaElement.prototype.play = async function () {};
    const lifecycles = [];
    const mounted = [];
    window.HlsPlaybackFactory = { create(video, url, options) {
        const transport = { destroy() {} };
        options.beforeLoad?.(transport);
        mounted.push({ video, url, options });
        return transport;
    } };
    window.PlayerSourceLifecycle = {
        setState() {},
        watchVideo(video, options) {
            assert.equal(typeof options.onState, 'function', 'lifecycle callback uses the shared watchVideo(video, options) contract');
            lifecycles.push({ video, options });
            return { cancel() {} };
        }
    };
    const sources = await parser.getVideoSources({ url: movieUrl });
    const container = window.document.getElementById('player');
    const states = [];
    const rendered = await parser.renderPlayer(container, sources, {
        movieId: '24680', resolvedTimestamp: 90,
        isRequestCurrent: () => true,
        onLifecycleState: (state, data) => states.push({ state, data })
    });
    assert.ok(rendered, 'native mount succeeds');
    const video = container.querySelector('video');
    assert.equal(video?.dataset.progressOwner, 'canonical');
    assert.equal(video?._movieExtensionHls, mounted[0].video._movieExtensionHls);
    assert.equal(mounted[0].options.networkProfile, 'hdrezka');
    assert.equal(mounted[0].options.providerManifestUrl, mounted[0].url);
    assert.equal(lifecycles.length, 1);
    lifecycles[0].options.onState('ready', { reason: 'ready' });
    assert.equal(states.at(-1).state, 'ready');
    assert.equal(container.__providerDubState.providerId, 'hdrezka');
    assert.equal(container.__providerDubState.activeTranslationId, '56');
    assert.equal(container.querySelectorAll('[data-quality-option]').length, 2);
    assert.equal(operations.some(item => item.operation === 'streams'), true);
    const persisted = JSON.stringify(writes);
    assert.equal(persisted.includes('voidboost.one'), false, 'preferences contain no stream addresses');
    const diagnostics = [];
    window.console.warn = (...args) => diagnostics.push(args.join(' '));
    assert.equal(mounted[0].options.onFatal({ reason: 'policy', data: { url: manifest() + '?private-token=secret' } }), true);
    assert.equal(container.dataset.hdrezkaFailure, 'HDREZKA_HLS_FAILED');
    assert.equal(container.dataset.hdrezkaPhase, 'hls-playback');
    assert.ok(diagnostics[0].includes('"hlsReason":"policy"'));
    assert.equal(/voidboost|private-token|secret/.test(diagnostics[0]), false, 'failure diagnostics keep no media URL or raw error data');
    container._hdrezkaDispose?.();
});

test('HDRezka quality expiry reports API access requirements instead of losing the recovery state', async t => {
    const { control, calls, container, parser, states, overlays, failure } = await recoveryMount(t);
    control.expired = true;
    control.failureCode = 'HDREZKA_ACCESS_REQUIRED';
    container.querySelector('[data-quality-option="720"]').click();
    await failure;
    assert.equal(calls.filter(call => call.operation === 'streams').length, 2, 'an expired quality requests fresh links once');
    assert.equal(parser.accessRequired, true);
    assert.equal(container.dataset.hdrezkaFailure, 'HDREZKA_ACCESS_REQUIRED');
    assert.equal(container.dataset.hdrezkaPhase, 'streams');
    assert.equal(states.at(-1).data.reason, 'access-required');
    assert.ok(overlays.at(-1).data.message.includes('оставьте вкладку открытой'));
});

test('HDRezka runtime expiry preserves typed access failure through the real HLS factory', async t => {
    const { control, hls, parser, container, states, diagnostics, failure } = await recoveryMount(t);
    control.failureCode = 'HDREZKA_ACCESS_REQUIRED';
    hls.emit('hlsError', { type: 'networkError', fatal: true, details: 'manifestLoadError', response: { code: 403 } });
    await failure;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(hls.destroyed, true, 'stop the old transport before the factory evaluates the failed refresh');
    assert.equal(parser.accessRequired, true);
    assert.equal(container.dataset.hdrezkaFailure, 'HDREZKA_ACCESS_REQUIRED');
    assert.equal(states.length, 1, 'the factory must not overwrite access-required with its generic source error');
    assert.equal(states[0].data.reason, 'access-required');
    assert.equal(diagnostics.some(text => text.includes('HDREZKA_HLS_FAILED')), false);
});

test('HDRezka runtime expiry preserves identity failures and keeps access-required false', async t => {
    const { control, hls, parser, container, states, failure } = await recoveryMount(t);
    control.nextDetails = { movieId: '9999', kinopoiskId: '24680', activeTranslationId: '56', translations: [] };
    hls.emit('hlsError', { type: 'networkError', fatal: true, details: 'manifestLoadError', response: { code: 403 } });
    await failure;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(hls.destroyed, true);
    assert.equal(parser.accessRequired, false);
    assert.equal(container.dataset.hdrezkaFailure, 'HDREZKA_IDENTITY_MISMATCH');
    assert.equal(states.length, 1);
    assert.equal(states[0].data.reason, 'provider-unavailable');
});

test('HDRezka dub failures publish access recovery and clear it for other failures', async t => {
    const { control, parser, container, states } = await recoveryMount(t);
    control.failureCode = 'HDREZKA_ACCESS_REQUIRED';
    assert.equal(await parser.changeTranslation(container, '336'), false);
    assert.equal(parser.accessRequired, true);
    assert.equal(container.dataset.hdrezkaFailure, 'HDREZKA_ACCESS_REQUIRED');
    assert.equal(states.at(-1).data.reason, 'access-required');
    control.failureCode = 'HDREZKA_UNAVAILABLE';
    assert.equal(await parser.changeTranslation(container, '336'), false);
    assert.equal(parser.accessRequired, false);
    assert.equal(states.at(-1).data.reason, 'provider-unavailable');
});

test('HDRezka late expiry failure cannot change access state or UI after another provider takes over', async t => {
    const { control, hls, parser, container, states } = await recoveryMount(t);
    let rejectStreams;
    control.streamGate = new Promise((_resolve, reject) => { rejectStreams = reject; });
    hls.emit('hlsError', { type: 'networkError', fatal: true, details: 'manifestLoadError', response: { code: 403 } });
    await new Promise(resolve => setImmediate(resolve));
    control.current = false;
    rejectStreams(Object.assign(new Error('Session needs access'), { code: 'HDREZKA_ACCESS_REQUIRED' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(parser.accessRequired, false);
    assert.equal(container.dataset.hdrezkaFailure, undefined);
    assert.equal(states.length, 0);
    assert.equal(hls.destroyed, false, 'a stale callback must not tear down the current transport');
});

test('HDRezka session requests reuse only queried site tabs and run self-contained code in MAIN', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    const queries = [];
    const executions = [];
    const removed = [];
    const service = new window.HdrezkaSessionService(coordinatedApi(window, {
        tabs: {
            query: async query => { queries.push(query); return [{ id: 41, status: 'complete' }]; },
            create: async () => { throw new Error('An existing user tab must be reused'); },
            remove: async id => { removed.push(id); }
        },
        scripting: { executeScript: async options => {
            executions.push(options);
            return [{ result: { results: [{ url: movieUrl, title: 'Тестовый фильм', year: '2024', isSeries: false }] } }];
        } }
    }));
    const [first, duplicate] = await Promise.all([
        service.request('search', { query: 'Тестовый фильм' }),
        service.request('search', { query: 'Тестовый фильм' })
    ]);
    assert.equal(first.results[0].url, movieUrl);
    assert.equal(duplicate.results[0].url, movieUrl);
    assert.equal(queries.length, 3, 'identical requests share one background operation and its acquisition checks');
    assert.equal(queries[0].url, 'https://hdrezka.co/*');
    assert.equal(executions.length, 1);
    assert.equal(executions[0].world, 'MAIN');
    assert.equal(executions[0].target.tabId, 41);
    assert.equal(executions[0].args[0], 'search');
    assert.equal(executions[0].args[1].query, 'Тестовый фильм');
    assert.equal(typeof executions[0].func, 'function');
    assert.deepEqual(removed, [], 'the session service never closes a reused user tab');
});

test('HDRezka extension requests discover films and streams without creating a site tab', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    window.AbortSignal = AbortSignal;
    const requests = [];
    window.fetch = async (url, options) => {
        requests.push({ url: new URL(url), options });
        const body = new URL(url).pathname === '/search/'
            ? `<div class="b-content__inline_item"><div class="b-content__inline_item-link"><a href="${movieUrl}">Тестовый фильм</a><div>2024</div></div></div>`
            : new URL(url).pathname === '/ajax/get_cdn_series/'
                ? JSON.stringify({ success: true, premium_content: 0, quality: '480p', url: `[480p]${manifest('stream.voidboost.one', 480)}` })
                : '<ul id="translators-list"><li class="active" data-translator_id="56">Дубляж</li></ul><input id="ctrl_favs" value="fixture-only">';
        return { status: 200, ok: true, text: async () => body };
    };
    const service = new window.HdrezkaSessionService({ tabs: { query: async () => [] } });
    const [first, duplicate] = await Promise.all([
        service.request('search', { query: 'Тестовый фильм' }),
        service.request('search', { query: 'Тестовый фильм' })
    ]);
    assert.equal(first.results[0].url, movieUrl);
    assert.equal(duplicate.results[0].url, movieUrl);
    assert.equal(requests.length, 1, 'identical extension requests share one fetch');
    assert.equal((await service.request('details', { url: movieUrl })).activeTranslationId, '56');
    const result = await service.request('streams', { url: movieUrl, translationId: '56' });
    assert.equal(result.movieId, '1234');
    assert.equal(result.response.success, true);
    assert.equal(requests.length, 4);
    for (const { url, options } of requests) {
        assert.equal(url.origin, 'https://hdrezka.co');
        assert.equal(options.credentials, 'include', 'the browser attaches its normal cookies without exporting them');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers?.Cookie, undefined);
    }
    const post = requests.at(-1);
    assert.equal(post.url.pathname, '/ajax/get_cdn_series/');
    assert.equal(new URLSearchParams(post.options.body).get('translator_id'), '56');
    assert.equal(new URLSearchParams(post.options.body).get('favs'), 'fixture-only');
    await assert.rejects(service.request('details', { url: movieUrl.replace('hdrezka.co', 'evil.test') }),
        failure => failure.code === 'HDREZKA_INVALID_REQUEST');
    assert.equal(requests.length, 4, 'an invalid film URL is refused before network access');
});

test('HDRezka extension challenges fail recoverably if background acquisition is unavailable', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    window.AbortSignal = AbortSignal;
    for (const challenged of [false, true]) {
        const created = [];
        const removed = [];
        window.fetch = async () => ({ status: challenged ? 403 : 200, ok: !challenged,
            text: async () => challenged ? 'Just a moment... challenge-platform' : '<p>No results</p>' });
        const service = new window.HdrezkaSessionService({
            tabs: {
                query: async () => [],
                create: async options => { created.push(options); throw new Error('Unexpected tab'); },
                remove: async id => { removed.push(id); }
            }
        });
        const pending = service.request('search', { query: 'Тестовый фильм' });
        if (challenged) await assert.rejects(pending, failure => failure.code === 'HDREZKA_ACCESS_REQUIRED');
        else assert.equal((await pending).results.length, 0);
        service.dispose();
        assert.deepEqual(created, []);
        assert.deepEqual(removed, []);
    }
});

test('HDRezka resolver frame CSP permits exactly the router and reviewed CDN hosts', t => {
    const { dom, protocol } = environment();
    t.after(() => dom.window.close());
    const markup = new JSDOM(read('src/pages/hdrezka-resolver/resolver.html'));
    t.after(() => markup.window.close());
    const directives = markup.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.split(';')
        .map(value => value.trim().split(/\s+/));
    assert.deepEqual(directives.find(value => value[0] === 'connect-src').slice(1).sort(),
        [protocol.ROUTER, ...protocol.CDN_HOSTS].map(host => `https://${host}`).sort());
    assert.deepEqual(directives.find(value => value[0] === 'default-src'), ['default-src', "'none'"]);
});

test('HDRezka automatically acquires one inactive session across pages and reuses it after worker restart', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    window.AbortSignal = AbortSignal;
    let fetches = 0;
    let tabs = [];
    const created = [];
    const executions = [];
    const api = {
        runtime: { id: 'fixture', getURL: value => `chrome-extension://fixture/${value}` },
        tabs: {
            query: async () => tabs,
            get: async id => tabs.find(tab => tab.id === id),
            create: async options => {
                created.push(options);
                await Promise.resolve();
                const tab = { id: 80 + created.length, status: 'complete' };
                tabs = [tab];
                return tab;
            },
            update: async () => { throw new Error('Automatic acquisition must not focus or navigate a tab'); },
            remove: async () => { throw new Error('The normal site context must remain open'); }
        },
        scripting: { executeScript: async options => { executions.push(options); return [{ result: { results: [] } }]; } }
    };
    let coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    api.runtime.sendMessage = message => coordinator.handleMessage(message, { id: 'fixture', url: api.runtime.getURL('src/pages/movie-details/movie-details.html') });
    window.fetch = async () => { fetches++; return { status: 403, ok: false, text: async () => 'challenge-platform' }; };
    const service = new window.HdrezkaSessionService(api);
    const otherPage = new window.HdrezkaSessionService(api);
    const results = await Promise.all([service.request('search', { query: 'Фильм' }), otherPage.request('search', { query: 'Original title' })]);
    assert.equal(results.every(result => result.results.length === 0), true, 'the original requests recover without a manual retry');
    assert.equal(created.length, 1, 'different extension pages share one background acquisition');
    assert.deepEqual(JSON.parse(JSON.stringify(created[0])), { url: 'https://hdrezka.co/', active: false });
    assert.equal(executions.every(options => options.world === 'MAIN' && options.target.tabId === 81), true);
    assert.equal(fetches, 2, 'each cold page tries direct access once');
    coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    assert.equal((await coordinator.handleMessage({ type: 'HDREZKA_ENSURE_SITE_SESSION' }, { id: 'fixture', url: api.runtime.getURL('src/pages/search/search.html') })).tabId, 81);
    assert.equal(created.length, 1, 'a restarted background reuses the existing session');
    assert.equal((await service.request('details', { url: movieUrl })).results.length, 0);
    tabs = [];
    assert.equal((await service.request('search', { query: 'Фильм' })).results.length, 0);
    assert.equal(created.length, 2, 'a closed site context is reacquired automatically on the next request');
    assert.equal(executions.at(-1).target.tabId, 82);
    assert.equal(fetches, 2, 'closing the tab does not restart rejected direct fetches');
    service.dispose();
    otherPage.dispose();
});

test('HDRezka explicit open-site action creates one tab and reuses it without navigation or cleanup', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    let tabs = [];
    const created = [];
    const updated = [];
    const api = { runtime: { id: 'fixture', getURL: value => `chrome-extension://fixture/${value}` }, tabs: {
        query: async () => tabs,
        create: async options => { created.push(options); const tab = { id: 82, status: 'complete' }; tabs = [tab]; return tab; },
        update: async (id, options) => { updated.push({ id, options }); },
        remove: async () => { throw new Error('A normal site context must stay open'); }
    } };
    const coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    api.runtime.sendMessage = message => coordinator.handleMessage(message, { id: 'fixture', url: api.runtime.getURL('src/pages/movie-details/movie-details.html') });
    const service = new window.HdrezkaSessionService(api);
    assert.deepEqual(await Promise.all([service.openSite('Фильм'), service.openSite('Фильм')]), [82, 82]);
    assert.equal(created.length, 1, 'duplicate explicit clicks share one site tab');
    const target = new URL(created[0].url);
    assert.equal(target.origin, 'https://hdrezka.co');
    assert.equal(target.pathname, '/search/');
    assert.equal(target.searchParams.get('q'), 'Фильм');
    assert.equal(created[0].active, false, 'creation itself never changes focus');
    assert.equal(await service.openSite('Другой фильм'), 82);
    assert.deepEqual(JSON.parse(JSON.stringify(updated)), [{ id: 82, options: { active: true } }, { id: 82, options: { active: true } }], 'only explicit open actions focus the existing page without replacing its URL');
    service.dispose();
    assert.equal(created.length, 1);
    await assert.rejects(service.openSite('x'.repeat(201)), error => error.code === 'HDREZKA_INVALID_REQUEST');
});

test('HDRezka session coordinator rejects web/content-script callers and retries a failed creation without leaking errors', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    let calls = 0;
    let fail = true;
    const api = { runtime: { id: 'fixture', getURL: value => `chrome-extension://fixture/${value}` }, tabs: {
        query: async () => { calls++; return []; },
        create: async () => { if (fail) throw new Error('private upstream detail'); return { id: 97 }; }
    } };
    const coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    const request = { type: 'HDREZKA_ENSURE_SITE_SESSION' };
    for (const sender of [null, { id: 'other', url: api.runtime.getURL('src/pages/search/search.html') },
        { id: 'fixture', url: 'https://hdrezka.co/' }, { id: 'fixture', url: 'chrome-extension://fixture.evil/page.html' }]) {
        assert.equal((await coordinator.handleMessage(request, sender)).error, 'HDREZKA_INVALID_REQUEST');
    }
    const sender = { id: 'fixture', url: api.runtime.getURL('src/pages/search/search.html') };
    assert.equal(await coordinator.handleMessage({ type: 'OTHER_FEATURE' }, sender), null);
    assert.equal((await coordinator.handleMessage({ type: 'HDREZKA_OPEN_SITE', query: 'x'.repeat(201) }, sender)).error, 'HDREZKA_INVALID_REQUEST');
    assert.equal(calls, 0, 'untrusted or invalid requests never reach browser APIs');
    assert.equal((await coordinator.handleMessage(request, sender)).error, 'HDREZKA_ACCESS_REQUIRED');
    fail = false;
    assert.equal((await coordinator.handleMessage(request, sender)).tabId, 97, 'a failed acquisition releases its shared promise');
    assert.equal(calls, 2);
});

test('HDRezka automatic and explicit session acquisition share one tab even while creation is pending', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    let created = 0;
    const updates = [];
    const api = { runtime: { id: 'fixture', getURL: value => `chrome-extension://fixture/${value}` }, tabs: {
        query: async () => [],
        create: async options => { created++; assert.equal(options.active, false); await Promise.resolve(); return { id: 96 }; },
        update: async (id, options) => { updates.push({ id, options }); }
    } };
    const coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    const sender = { id: 'fixture', url: api.runtime.getURL('src/pages/search/search.html') };
    const results = await Promise.all([coordinator.handleMessage({ type: 'HDREZKA_ENSURE_SITE_SESSION' }, sender),
        coordinator.handleMessage({ type: 'HDREZKA_OPEN_SITE', query: 'Фильм' }, sender)]);
    assert.equal(results.every(result => result.tabId === 96), true);
    assert.equal(created, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(updates)), [{ id: 96, options: { active: true } }]);
});

test('HDRezka retains a pending or failed owned tab across calls and background restart without creating duplicates', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    let created = 0;
    let stored = {};
    let owned = null;
    const api = { storage: { session: { get: async () => stored, set: async value => { stored = value; } } }, tabs: {
        query: async () => [], // A pending/error navigation is not URL-queryable.
        get: async id => { if (!owned || owned.id !== id) throw new Error('Closed'); return owned; },
        create: async options => { created++; owned = { id: 100 + created, status: 'loading', url: '', pendingUrl: options.url }; return owned; }
    } };
    let coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    assert.equal(await coordinator.ensureSite(), 101);
    assert.equal(await coordinator.ensureSite(), 101, 'a later request reuses the pending tab after the creation promise settles');
    coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    assert.equal(await coordinator.ensureSite(), 101, 'worker restart recovers only the stored tab ID');
    owned = { id: 101, status: 'complete', url: 'chrome-error://chromewebdata/' };
    assert.equal(await coordinator.ensureSite(), 101, 'navigation failure does not produce another background tab');
    assert.equal(created, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), { hdrezkaSiteSessionTab: 101 }, 'no URLs, cookies or tokens are persisted');
    owned = { id: 101, status: 'complete', url: 'https://example.test/user-navigation' };
    assert.equal(await coordinator.ensureSite(), 102, 'a tab the user navigated away is preserved and a new site context is acquired');
    owned = null;
    assert.equal(await coordinator.ensureSite(), 103, 'a closed tab is reacquired');
});

test('HDRezka hidden discovery returns data without creating a browser tab', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    const api = { tabs: { query: async () => [], create: async () => { throw new Error('No visible context is needed'); } } };
    const coordinator = new window.HdrezkaSiteSessionCoordinator(api, async () => ({ results: [{ url: movieUrl }] }));
    assert.equal((await coordinator.request('search', { query: 'Фильм' })).results[0].url, movieUrl);
    assert.equal(coordinator.sessionTabId, null);
    assert.equal(coordinator.activeRequests, 0);
    const premiumOnly = new window.HdrezkaSiteSessionCoordinator(api, async () => ({ error: 'HDREZKA_PREMIUM_REQUIRED' }));
    assert.equal((await premiumOnly.request('streams', { url: movieUrl, translationId: '56' })).error, 'HDREZKA_PREMIUM_REQUIRED',
        'an unavailable premium stream is not retried through a visible context');
});

test('HDRezka fallback closes only its own inactive tab after pending requests finish', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    let owned = null;
    let created = 0;
    const removed = [];
    let release;
    let started;
    const gate = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    const api = { tabs: {
        query: async () => owned ? [owned] : [],
        get: async () => owned,
        create: async options => { created++; owned = { id: 107, status: 'complete', url: options.url, active: options.active }; return owned; },
        remove: async id => { removed.push(id); owned = null; }
    }, scripting: { executeScript: async () => { started(); await gate; return [{ result: { results: [{ url: movieUrl }] } }]; } } };
    const coordinator = new window.HdrezkaSiteSessionCoordinator(api, async () => ({ error: 'HDREZKA_ACCESS_REQUIRED' }));
    const pending = coordinator.request('search', { query: 'Фильм' });
    await entered;
    await coordinator.closeIdleSession();
    assert.equal(removed.length, 0, 'a request in flight protects its context');
    release();
    assert.equal((await pending).results[0].url, movieUrl);
    assert.equal(created, 1);
    await coordinator.closeIdleSession();
    assert.deepEqual(removed, [107], 'the bootstrap tab is removed after obtaining data');
    assert.equal(coordinator.sessionTabId, null);
    owned = { id: 108, status: 'complete', url: 'https://hdrezka.co/', active: false };
    assert.equal((await coordinator.request('search', { query: 'Фильм' })).results[0].url, movieUrl);
    await coordinator.closeIdleSession();
    assert.deepEqual(removed, [107], 'a user-opened HDRezka tab is never closed');
});

test('HDRezka preserves an automatic tab after the user focuses or navigates it', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    let owned = null;
    let onActivated;
    const api = { tabs: {
        onActivated: { addListener: listener => { onActivated = listener; } },
        query: async () => [], get: async () => owned,
        create: async options => { owned = { id: 109, status: 'complete', url: options.url, active: false }; return owned; },
        remove: async () => { throw new Error('A context taken over by the user must survive'); }
    } };
    const coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    await coordinator.ensureSite();
    owned.active = true;
    await coordinator.closeIdleSession();
    assert.equal(coordinator.sessionTabId, null, 'focusing transfers ownership to the user');
    await coordinator.ensureSite();
    owned.url = 'https://example.test/user-navigation';
    await coordinator.closeIdleSession();
    assert.equal(coordinator.sessionTabId, null, 'navigating transfers ownership to the user');
    await coordinator.ensureSite();
    onActivated({ tabId: owned.id });
    owned.active = false; // The user has already returned to the film page.
    await coordinator.closeIdleSession();
    assert.equal(coordinator.sessionTabId, null, 'a prior user focus remains protected after another tab becomes active');
});

test('HDRezka cold-worker restoration settles before explicit focus can release cleanup ownership', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    let restore;
    const storageGate = new Promise(resolve => { restore = resolve; });
    let focused = 0;
    let cleared = 0;
    let queryStarted;
    let releaseQuery;
    const queryEntered = new Promise(resolve => { queryStarted = resolve; });
    const queryGate = new Promise(resolve => { releaseQuery = resolve; });
    const removed = [];
    const api = { runtime: { id: 'fixture', getURL: value => `chrome-extension://fixture/${value}` },
        storage: { session: { get: async () => storageGate, remove: async () => { cleared++; } } }, tabs: {
            query: async () => { queryStarted(); await queryGate; return [{ id: 110, status: 'complete' }]; },
            get: async () => ({ id: 110, url: 'https://hdrezka.co/', status: 'complete', active: false }),
            update: async () => { focused++; },
            remove: async id => { removed.push(id); }
        } };
    const coordinator = new window.HdrezkaSiteSessionCoordinator(api);
    const opening = coordinator.handleMessage({ type: 'HDREZKA_OPEN_SITE', query: 'Фильм' },
        { id: 'fixture', url: api.runtime.getURL('src/pages/movie-details/movie-details.html') });
    await Promise.resolve();
    assert.equal(focused, 0, 'explicit acquisition waits for the ownership restore');
    restore({ hdrezkaSiteSessionTab: 110 });
    await queryEntered;
    await coordinator.closeIdleSession();
    assert.deepEqual(removed, [], 'idle cleanup cannot race an explicit open action');
    releaseQuery();
    assert.equal((await opening).tabId, 110);
    assert.equal(focused, 1);
    assert.equal(cleared, 1);
    assert.equal(coordinator.sessionTabId, null);
    await coordinator.closeIdleSession();
    assert.deepEqual(removed, []);
    assert.equal(coordinator.sessionTabId, null, 'late restore cannot reclaim an explicitly opened tab');
});

test('HDRezka resolver frames are isolated, validate final paths, and clean up on disposal', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    const ports = [];
    const service = new window.HdrezkaSessionService({ runtime: {
        getURL: value => `https://extension.test/${value}`,
        connect: ({ name }) => {
            const port = { name, disconnected: false, onMessage: { addListener(fn) { port.receive = fn; } },
                onDisconnect: { addListener(fn) { port.closed = fn; } },
                postMessage(value) { port.sent = value; }, disconnect() { port.disconnected = true; } };
            ports.push(port);
            return port;
        }
    } });
    const first = service.resolve(manifest('stream.voidboost.one', 480));
    const second = service.resolve(manifest('stream.voidboost.one', 720));
    const frames = [...window.document.querySelectorAll('iframe[data-hdrezka-resolver]')];
    assert.equal(frames.length, 2);
    assert.equal(frames.every(frame => frame.hidden && frame.style.display === 'none'), true);
    assert.notEqual(frames[0].src, frames[1].src, 'concurrent resolutions have separate nonce-scoped ports');
    frames.forEach(frame => frame.dispatchEvent(new window.Event('load')));
    assert.equal(ports[0].sent.url, manifest('stream.voidboost.one', 480));
    ports[0].receive({ url: manifest('ember.stream.voidboost.one', 480) });
    assert.equal(await first, manifest('ember.stream.voidboost.one', 480));
    assert.equal(ports[0].disconnected, true);
    assert.equal(frames[0].isConnected, false);
    assert.equal(frames[1].isConnected, true);
    const rejected = assert.rejects(second, failure => failure.code === 'HDREZKA_INVALID_STREAM');
    ports[1].receive({ url: manifest('eleos.stream.voidboost.one', 1080) });
    await rejected;
    assert.equal(ports[1].disconnected, true);
    const abandoned = service.resolve(manifest('stream.voidboost.one', 480));
    const disposed = assert.rejects(abandoned, failure => failure.code === 'HDREZKA_RESOLVER_DISCONNECTED');
    service.dispose();
    await disposed;
    assert.equal(window.document.querySelectorAll('iframe[data-hdrezka-resolver]').length, 0);
    assert.equal(service.cleanups.size, 0);
});

test('HDRezka resolver load failures and deadlines remove their frame without browser tab APIs', async t => {
    for (const failure of ['error', 'timeout']) {
        const { dom, window } = environment();
        t.after(() => dom.window.close());
        let deadline;
        let cleared = false;
        window.setTimeout = (callback, ms) => { assert.equal(ms, 12000); deadline = callback; return 1; };
        window.clearTimeout = () => { cleared = true; };
        const service = new window.HdrezkaSessionService({ runtime: { getURL: value => `https://extension.test/${value}` } });
        const pending = service.resolve(manifest('stream.voidboost.one'));
        const rejected = assert.rejects(pending, error => error.code === (failure === 'timeout'
            ? 'HDREZKA_RESOLVE_FAILED' : 'HDREZKA_RESOLVER_SETUP_FAILED'));
        const frame = window.document.querySelector('iframe[data-hdrezka-resolver]');
        assert.ok(frame);
        if (failure === 'timeout') deadline();
        else frame.dispatchEvent(new window.Event('error'));
        await rejected;
        assert.equal(cleared, true);
        assert.equal(frame.isConnected, false);
        assert.equal(service.cleanups.size, 0);
    }
});

test('HDRezka injected browser search recognizes a real challenge response without copying cookies', async t => {
    const { dom, window } = environment();
    const provider = new JSDOM('<!doctype html><p>HDRezka</p>', {
        runScripts: 'outside-only', url: 'https://hdrezka.co/'
    });
    t.after(() => { dom.window.close(); provider.window.close(); });
    provider.window.AbortSignal = AbortSignal;
    const requests = [];
    const removed = [];
    provider.window.fetch = async (url, options) => {
        requests.push({ url, options });
        return { status: 403, ok: false, text: async () => '<html>Just a moment... challenge-platform</html>' };
    };
    const service = new window.HdrezkaSessionService(coordinatedApi(window, {
        tabs: {
            query: async () => [{ id: 17, status: 'complete' }],
            remove: async id => { removed.push(id); }
        },
        scripting: { executeScript: async options => [{ result:
            await provider.window.eval(`(${options.func.toString()})`)(...options.args)
        }] }
    }));
    await assert.rejects(service.request('search', { query: 'Тестовый фильм' }), failure => failure.code === 'HDREZKA_ACCESS_REQUIRED');
    assert.equal(requests.length, 1);
    const requestedUrl = new URL(requests[0].url);
    assert.equal(requestedUrl.origin, 'https://hdrezka.co');
    assert.equal(requestedUrl.pathname, '/search/');
    assert.equal(requestedUrl.searchParams.get('q'), 'Тестовый фильм');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].options.redirect, 'error');
    assert.equal(requests[0].options.headers?.Cookie, undefined);
    assert.deepEqual(removed, [], 'a challenge never closes the user tab');
});

test('HDRezka session refuses unknown operations before browser work', async t => {
    const { dom, window } = environment();
    t.after(() => dom.window.close());
    const service = new window.HdrezkaSessionService({
        tabs: { query: async () => { throw new Error('Unknown operation must never query tabs'); } }
    });
    await assert.rejects(service.request('arbitrary-fetch', { url: 'https://evil.test/' }), failure => failure.code === 'HDREZKA_INVALID_REQUEST');
});

test('HDRezka replaces an unavailable saved dub or active premium dub with the current ordinary translation', async t => {
    const { dom, window } = environment();
    const provider = new JSDOM('<!doctype html><p>HDRezka</p>', {
        runScripts: 'outside-only', url: 'https://hdrezka.co/'
    });
    t.after(() => { dom.window.close(); provider.window.close(); });
    provider.window.AbortSignal = AbortSignal;
    let activePremium = false;
    const posts = [];
    provider.window.fetch = async (url, options) => {
        if (new URL(url).pathname === '/ajax/get_cdn_series/') {
            posts.push(new URLSearchParams(options.body));
            return { status: 200, ok: true, text: async () => JSON.stringify({
                success: true, premium_content: 0, quality: '480p', url: `[480p]${manifest('stream.voidboost.one', 480)}`
            }) };
        }
        assert.equal(String(url), movieUrl);
        return { status: 200, ok: true, text: async () => '<!doctype html><ul id="translators-list">'
            + (activePremium ? '<li><a class="b-translator__item b-prem_translator active" data-translator_id="111">HDrezka Studio</a></li>' : '')
            + '<li><a class="b-translator__items" data-translator_id="56">Дубляж</a></li>'
            + '<li><a class="b-translator__item" data-translator_id="56">Дубляж</a></li></ul><input id="ctrl_favs" value="fixture-only">'
            + '<a href="https://www.kinopoisk.ru/film/24680/">Кинопоиск</a>' };
    };
    const service = new window.HdrezkaSessionService(coordinatedApi(window, {
        tabs: { query: async () => [{ id: 17, status: 'complete' }] },
        scripting: { executeScript: async options => [{ result:
            await provider.window.eval(`(${options.func.toString()})`)(...options.args)
        }] }
    }));
    for (const premium of [false, true]) {
        activePremium = premium;
        const result = await service.request('streams', { url: movieUrl, translationId: '336' });
        assert.equal(result.activeTranslationId, '56');
        assert.equal(result.translations.length, 1);
        assert.equal(result.translations[0].id, '56');
        assert.equal(result.translations[0].name, 'Дубляж');
        assert.equal(result.movieId, '1234');
        assert.equal(result.kinopoiskId, '24680');
        assert.equal(posts.at(-1).get('translator_id'), '56', 'the AJAX request uses the available ordinary dub');
        assert.equal(posts.at(-1).get('id'), '1234');
        assert.equal(posts.at(-1).get('action'), 'get_movie');
    }
    assert.equal(posts.length, 2);
});
