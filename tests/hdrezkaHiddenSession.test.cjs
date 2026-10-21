const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
const nonce = '1'.repeat(32);
const movieUrl = 'https://hdrezka.co/films/fiction/1234-synthetic-film-2024.html';
const tick = () => new Promise(resolve => setImmediate(resolve));
const access = value => assert.equal(value.error, 'HDREZKA_ACCESS_REQUIRED');

function events() {
    const listeners = new Map();
    return {
        addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
        emit(type, value = {}) { for (const listener of [...listeners.get(type) || []]) listener(value); }
    };
}

function offscreen() {
    const frames = [];
    const timers = new Map();
    let counter = 0;
    let handler;
    const runtime = { id: 'a'.repeat(32), getURL: file => `${extensionOrigin}/${file}`,
        onMessage: { addListener(listener) { handler = listener; } } };
    const scope = vm.createContext({ ...events(), URL, chrome: { runtime },
        crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` },
        setTimeout(callback, ms) { const id = ++counter; timers.set(id, { callback, ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        document: {
            createElement(tag) {
                assert.equal(tag, 'iframe');
                const frame = { ...events(), style: {}, attributes: {}, posts: [],
                    setAttribute(key, value) { this.attributes[key] = value; },
                    remove() { const index = frames.indexOf(this); if (index !== -1) frames.splice(index, 1); } };
                frame.contentWindow = { postMessage: (data, targetOrigin) => frame.posts.push({ data, targetOrigin }) };
                return frame;
            },
            body: { appendChild(frame) { frames.push(frame); } }
        }
    });
    vm.runInContext(read('src/shared/services/player/HdrezkaProtocol.js'), scope);
    vm.runInContext(read('src/offscreen/hdrezka-session.js'), scope);
    const sender = { id: runtime.id, url: runtime.getURL('src/background/background.js') };
    const send = (action = 'search', input = { query: 'Synthetic Film' }, source = sender) => {
        let resolve;
        const result = new Promise(done => { resolve = done; });
        const asynchronous = handler({ type: 'HDREZKA_OFFSCREEN_REQUEST', target: 'offscreen-hdrezka', action, input }, source, resolve);
        return { result, asynchronous };
    };
    const message = (frame, type, extra = {}, overrides = {}) => scope.emit('message', { isTrusted: true,
        source: frame.contentWindow, origin: 'https://hdrezka.co',
        data: { type, nonce: new URL(frame.src).hash.split('=')[1], ...extra }, ...overrides });
    const timeout = ms => {
        const entry = [...timers].find(([, value]) => value.ms === ms);
        assert.ok(entry, `expected a ${ms} ms deadline`);
        timers.delete(entry[0]); entry[1].callback();
    };
    return { scope, frames, timers, sender, send, message, timeout };
}

function bridge({ parentOrigin = extensionOrigin, top = false, hash = `#movielist-hdrezka=${nonce}` } = {}, request = async () => ({ results: [] })) {
    const posted = [];
    const parent = { postMessage: (data, targetOrigin) => posted.push({ data, targetOrigin }) };
    const scope = vm.createContext({ ...events(), location: { hash, origin: 'https://hdrezka.co', ancestorOrigins: [parentOrigin] },
        chrome: { runtime: { getURL: file => `${extensionOrigin}/${file}` } }, parent, top: {}, HdrezkaSiteRequest: request });
    if (top) vm.runInContext('top = globalThis', scope);
    vm.runInContext(read('content-scripts/hdrezka-session-bridge.js'), scope);
    const message = (requestId, overrides = {}) => scope.emit('message', { isTrusted: true, source: parent, origin: extensionOrigin,
        data: { type: 'HDREZKA_SITE_REQUEST', nonce, requestId, action: 'search', input: { query: 'Synthetic Film' } }, ...overrides });
    return { scope, posted, parent, message };
}

test('HDRezka offscreen accepts only the background sender and closed provider inputs', async () => {
    const env = offscreen();
    for (const sender of [null, { id: 'foreign', url: env.sender.url },
        { ...env.sender, url: `${extensionOrigin}/src/pages/search/search.html` },
        { ...env.sender, url: 'https://hdrezka.co/' }, { ...env.sender, tab: { id: 7 } }]) {
        const pending = env.send('search', { query: 'Synthetic Film' }, sender);
        assert.equal(pending.asynchronous, false);
        access(await pending.result);
    }
    for (const [action, input] of [['fetch', { url: movieUrl }], ['search', { query: 'a' }],
        ['details', { url: movieUrl.replace('hdrezka.co', 'evil.test') }], ['streams', { url: movieUrl, translationId: 'bad' }]]) {
        access(await env.send(action, input).result);
    }
    assert.equal(env.frames.length, 0);
    assert.equal(env.timers.size, 0);
});

test('HDRezka offscreen deduplicates requests and authenticates handshake and response correlation', async () => {
    const env = offscreen();
    const first = env.send();
    const duplicate = env.send();
    const details = env.send('details', { url: movieUrl });
    assert.equal(env.frames.length, 1);
    const frame = env.frames[0];
    assert.equal(frame.attributes.sandbox, 'allow-scripts allow-same-origin');
    assert.equal(frame.attributes.allow, "autoplay 'none'; camera 'none'; microphone 'none'");
    assert.equal(frame.hidden, true);
    for (const overrides of [{ origin: 'https://evil.test' }, { source: {} }, { isTrusted: false }]) {
        env.message(frame, 'HDREZKA_SITE_READY', {}, overrides);
    }
    env.message(frame, 'HDREZKA_SITE_READY', { nonce: 'f'.repeat(32) });
    await tick();
    assert.equal(frame.posts.length, 0);
    env.message(frame, 'HDREZKA_SITE_READY');
    frame.emit('load');
    await tick();
    assert.equal(frame.posts.length, 2, 'identical calls share one provider operation');
    const search = frame.posts.find(item => item.data.action === 'search').data;
    const detail = frame.posts.find(item => item.data.action === 'details').data;
    assert.notEqual(search.requestId, detail.requestId);
    assert.equal(frame.posts.every(item => item.targetOrigin === 'https://hdrezka.co'), true);
    env.message(frame, 'HDREZKA_SITE_RESULT', { requestId: 'f'.repeat(32), data: { error: 'wrong' } });
    env.message(frame, 'HDREZKA_SITE_RESULT', { requestId: search.requestId, data: { results: [] } });
    assert.equal((await first.result).results.length, 0);
    assert.equal((await duplicate.result).results.length, 0);
    env.message(frame, 'HDREZKA_SITE_RESULT', { requestId: detail.requestId, data: { movieId: '1234' } });
    assert.equal((await details.result).movieId, '1234');
    assert.equal(env.timers.size, 0);
    env.scope.emit('pagehide');
    assert.equal(env.frames.length, 0);
});

test('HDRezka offscreen deadlines and navigation settle all callers and release the hidden frame', async () => {
    for (const mode of ['ready-timeout', 'response-timeout', 'navigation', 'child-pagehide', 'pagehide']) {
        const env = offscreen();
        const pending = env.send();
        const frame = env.frames[0];
        if (mode === 'ready-timeout') env.timeout(5000);
        else {
            env.message(frame, 'HDREZKA_SITE_READY'); frame.emit('load'); await tick();
            if (mode === 'response-timeout') env.timeout(20000);
            if (mode === 'navigation') frame.emit('load');
            if (mode === 'child-pagehide') env.message(frame, 'HDREZKA_SITE_CLOSED');
            if (mode === 'pagehide') env.scope.emit('pagehide');
        }
        access(await pending.result);
        assert.equal(env.frames.length, 0, mode);
        assert.equal(env.timers.size, 0, mode);
    }
});

test('HDRezka isolated bridge is inert in normal tabs and foreign parent frames', () => {
    for (const options of [{ top: true }, { parentOrigin: 'https://evil.test' }, { hash: '#unrelated' }]) {
        assert.equal(bridge(options).posted.length, 0);
    }
});

test('HDRezka isolated bridge validates messages and coalesces identical provider work', async () => {
    let calls = 0;
    let finish;
    const env = bridge({}, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
    assert.equal(env.posted[0].data.type, 'HDREZKA_SITE_READY');
    const id = '2'.repeat(32);
    for (const overrides of [{ origin: 'https://hdrezka.co' }, { source: {} }, { isTrusted: false },
        { data: { type: 'HDREZKA_SITE_REQUEST', nonce: 'f'.repeat(32), requestId: id } }]) env.message(id, overrides);
    await tick();
    assert.equal(calls, 0);
    env.message(id); env.message('3'.repeat(32)); env.message(id);
    await tick();
    assert.equal(calls, 1);
    finish({ results: [{ url: movieUrl }] });
    await tick();
    const results = env.posted.filter(item => item.data.type === 'HDREZKA_SITE_RESULT');
    assert.equal(results.length, 2);
    assert.equal(results.every(item => item.targetOrigin === extensionOrigin && item.data.nonce === nonce), true);
    assert.equal(results[0].data.data.results[0].url, movieUrl);
});

test('HDRezka bridge pagehide fails pending callers and suppresses late provider results', async () => {
    let finish;
    const env = bridge({}, () => new Promise(resolve => { finish = resolve; }));
    env.message('2'.repeat(32)); await tick();
    env.scope.emit('pagehide');
    const results = env.posted.filter(item => item.data.type === 'HDREZKA_SITE_RESULT');
    assert.equal(results.length, 1);
    access(results[0].data.data);
    assert.equal(env.posted.at(-1).data.type, 'HDREZKA_SITE_CLOSED');
    const count = env.posted.length;
    finish({ results: [] }); await tick();
    assert.equal(env.posted.length, count);
});

test('HDRezka hidden bridge manifest stays isolated and does not replace the watchlist script', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const bridge = manifest.content_scripts.find(entry => entry.js.includes('content-scripts/hdrezka-session-bridge.js'));
    assert.deepEqual(bridge.matches, ['https://hdrezka.co/*']);
    assert.deepEqual(bridge.js, ['src/shared/services/player/HdrezkaSessionService.js', 'content-scripts/hdrezka-session-bridge.js']);
    assert.equal(bridge.all_frames, true);
    assert.equal(bridge.run_at, 'document_start');
    assert.equal(bridge.world, 'ISOLATED');
    assert.ok(manifest.content_scripts.some(entry => entry.js.includes('content-scripts/hdrezka-watchlist.js')));
    assert.ok(read('src/offscreen/offscreen.html').includes('src="hdrezka-session.js"'));
});
