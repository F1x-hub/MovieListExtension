const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/shared/services/player/HlsPolicyLoader.js'), 'utf8');
const URL_OK = 'https://cdn.test/master.m3u8';
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function response(options = {}) {
    return {
        url: URL_OK, status: 200, ok: true, type: 'cors', redirected: false,
        headers: new Headers({ 'Content-Length': '3', Age: '12' }),
        text: async () => 'abc', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        json: async () => ({ value: 1 }), ...options
    };
}
function harness(fetchResult = () => Promise.resolve(response()), options = {}) {
    let now = 1;
    let next = 0;
    const timers = new Map();
    const calls = [];
    const checks = [];
    const events = [];
    // Deliberately small policy stub: loader transport tests own no production URL policy.
    const UrlPolicy = options.policy || {
        kindOf: context => context.type === 'manifest' ? 'manifest' : null,
        check: (url, detail) => {
            checks.push([url, detail]);
            return { ok: url === URL_OK, url, reason: 'test-denied' };
        }
    };
    const scope = vm.createContext({
        URL, Headers, AbortController, UrlPolicy, performance: { now: () => now },
        fetch: (...args) => { calls.push(args); return fetchResult(...args); },
        setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout: id => timers.delete(id)
    });
    vm.runInContext(source, scope);
    const Loader = scope.HlsPolicyLoader.forProfile(options.profile, {
        localManifestUrl: options.localManifestUrl, providerManifestUrl: options.providerManifestUrl
    });
    const loader = new Loader(options.hlsConfig);
    const callbacks = Object.fromEntries(['onSuccess', 'onProgress', 'onError', 'onTimeout', 'onAbort']
        .map(name => [name, (...args) => { events.push([name, ...args]); options[name]?.(loader, ...args); }]));
    return {
        loader, calls, events, checks, timers,
        start: (context = {}, config = {}) => loader.load({ url: URL_OK, type: 'manifest', responseType: 'text', ...context },
            { loadPolicy: { maxTimeToFirstByteMs: 20, maxLoadTimeMs: 100 }, ...config }, callbacks),
        tick: async ms => {
            now += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= now && timers.has(id)) { timers.delete(id); timer.fn(); }
            }
            await flush();
        }
    };
}

test('denied and unknown contexts fail before fetch without leaking reasons or URLs', async () => {
    for (const context of [{ url: 'http://private.test/?secret' }, { type: 'unknown' }]) {
        const h = harness();
        h.start(context);
        await flush();
        assert.equal(h.calls.length, 0);
        assert.equal(h.events.length, 1);
        assert.equal(JSON.stringify(h.events[0][1]), '{"code":0,"text":"POLICY_VIOLATION"}');
        assert.equal(h.events[0][3], null);
        assert.equal(h.timers.size, 0);
    }
});

test('manual redirect rejects opaque, HTTP, redirected and changed-final-URL responses', async () => {
    for (const options of [{ type: 'opaqueredirect', status: 0 }, { status: 302, ok: false },
        { redirected: true }, { url: 'http://private.test/secret' }, { url: 'https://cdn.test/other' }]) {
        const h = harness(() => Promise.resolve(response(options)));
        h.start();
        await flush();
        assert.equal(h.calls.length, 1, 'no redirect follow-up request');
        assert.equal(h.calls[0][1].redirect, 'manual');
        assert.equal(h.events.length, 1);
        assert.equal(h.events[0][1].text, 'POLICY_VIOLATION');
        assert.equal(h.events[0][3], null);
    }
});

test('even a policy-allowed different final URL cannot hide an internally followed redirect', async () => {
    const h = harness(() => Promise.resolve(response({ url: 'https://cdn.test/other.m3u8' })), {
        policy: { kindOf: () => 'manifest', check: url => ({ ok: true, url }) }
    });
    h.start();
    await flush();
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0][1].text, 'POLICY_VIOLATION');
    assert.equal(h.calls.length, 1);
});

test('GET omits credentials, retains headers, sets exclusive range, ignores custom network hooks', async () => {
    let hooks = 0;
    const h = harness(undefined, { hlsConfig: {
        fetchSetup: () => { hooks++; }, xhrSetup: () => { hooks++; },
        fetch: () => { hooks++; }, credentials: 'include', redirect: 'follow'
    } });
    h.start({ headers: { 'X-Stream': 'test', Range: 'bytes=0-999' }, rangeStart: 4, rangeEnd: 8 });
    await flush();
    const init = h.calls[0][1];
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.get('X-Stream'), 'test');
    assert.equal(init.headers.get('Range'), 'bytes=4-7');
    assert.equal(h.checks[0][1].profile, 'remote');
    assert.equal(hooks, 0);
});

test('text and binary emit a single full progress chunk before success with pinned stats', async () => {
    for (const responseType of ['text', 'arraybuffer']) {
        const h = harness();
        h.start({ responseType });
        await flush();
        assert.deepEqual(h.events.map(event => event[0]), ['onProgress', 'onSuccess']);
        assert.equal(h.events[0][3], h.events[1][1].data);
        assert.equal(h.loader.stats.loaded, 3);
        assert.equal(h.loader.stats.total, 3);
        assert.equal(h.loader.stats.retry, 0);
        assert.equal(h.loader.stats.chunkCount, 0);
        assert.equal(h.loader.stats.parsing.start, 0);
        assert.equal(h.loader.stats.buffering.first, 0);
        assert.ok(h.loader.stats.loading.end >= h.loader.stats.loading.first);
        assert.equal(h.loader.getCacheAge(), 12);
        assert.equal(h.loader.getResponseHeader('Content-Length'), '3');
        assert.equal(h.checks[0][1].profile, 'remote');
        assert.equal(h.timers.size, 0);
        await h.tick(200);
        assert.equal(h.events.length, 2, 'completed request never times out');
    }
});

test('JSON is parsed using the response contract', async () => {
    const h = harness();
    h.start({ responseType: 'json' });
    await flush();
    assert.deepEqual(h.events[1][1].data, { value: 1 });
});

test('HTTP errors retain status, sanitize text and never retry', async () => {
    const h = harness(() => Promise.resolve(response({ status: 403, ok: false, statusText: 'secret URL' })));
    h.start();
    await flush();
    await h.tick(1000);
    assert.equal(h.calls.length, 1);
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0][1].code, 403);
    assert.equal(h.events[0][1].text, 'HTTP_ERROR');
    assert.equal(h.events[0][3], null);
});

test('network errors have fixed safe text and null details', async () => {
    const h = harness(() => Promise.reject(new Error('https://secret.test/?token=SECRET')));
    h.start();
    await flush();
    assert.equal(h.events[0][1].text, 'NETWORK_ERROR');
    assert.equal(h.events[0][3], null);
});

test('first-byte timeout aborts request and suppresses late response', async () => {
    const pending = deferred();
    const h = harness(() => pending.promise);
    h.start();
    await flush();
    await h.tick(20);
    assert.equal(h.calls[0][1].signal.aborted, true);
    pending.resolve(response());
    await flush();
    assert.deepEqual(h.events.map(event => event[0]), ['onTimeout']);
    assert.equal(h.timers.size, 0);
});

test('headers clear first-byte timer but whole-body timeout keeps the original deadline', async () => {
    const headers = deferred();
    const body = deferred();
    const h = harness(() => headers.promise);
    h.start();
    await flush();
    await h.tick(15);
    headers.resolve(response({ text: () => body.promise }));
    await flush();
    await h.tick(5);
    assert.equal(h.events.length, 0);
    await h.tick(80);
    body.resolve('late body');
    await flush();
    assert.deepEqual(h.events.map(event => event[0]), ['onTimeout']);
    assert.equal(h.loader.stats.aborted, true);
});

test('legacy timeout bounds stalled body when loadPolicy is absent', async () => {
    const body = deferred();
    const h = harness(() => Promise.resolve(response({ text: () => body.promise })));
    h.start({}, { loadPolicy: undefined, timeout: 30 });
    await flush();
    await h.tick(30);
    assert.equal(h.events[0][0], 'onTimeout');
});

test('abort and destroy suppress late body success/rejection and cancel every timer', async () => {
    for (const method of ['abort', 'destroy']) {
        for (const outcome of ['resolve', 'reject']) {
            const body = deferred();
            const h = harness(() => Promise.resolve(response({ text: () => body.promise })));
            h.start();
            await flush();
            const signal = h.calls[0][1].signal;
            h.loader[method]();
            body[outcome](outcome === 'resolve' ? 'late' : new Error('late secret'));
            await flush();
            await h.tick(200);
            assert.equal(signal.aborted, true);
            assert.deepEqual(h.events.map(event => event[0]), method === 'abort' ? ['onAbort'] : []);
            assert.equal(h.timers.size, 0);
        }
    }
});

test('destroy from progress prevents success; destroy from error never causes duplicate callbacks', async () => {
    const h = harness(undefined, { onProgress: loader => loader.destroy() });
    h.start();
    await flush();
    assert.deepEqual(h.events.map(event => event[0]), ['onProgress']);
    const denied = harness(undefined, { onError: loader => loader.destroy() });
    denied.start({ type: 'unknown' });
    await flush();
    assert.deepEqual(denied.events.map(event => event[0]), ['onError']);
    assert.equal(denied.loader.context, null);
});

test('cancellation before async dispatch performs no request and loader cannot be reused', async () => {
    const h = harness();
    h.start();
    h.loader.destroy();
    await flush();
    assert.equal(h.calls.length, 0);
    assert.throws(() => h.start(), /only be used once/);
});

const LOCAL_MANIFEST = 'http://127.0.0.1:3000/api/playback/sessions/session-a/master.m3u8?token=signed';
const localPolicy = {
    kindOf: () => 'fragment',
    check: url => {
        try {
            const parsed = new URL(url);
            return { ok: parsed.protocol === 'http:' && parsed.origin === 'http://127.0.0.1:3000', url: parsed.href };
        } catch { return { ok: false }; }
    }
};

test('local constructor captures session directory and preserves query signatures', async () => {
    const url = 'http://127.0.0.1:3000/api/playback/sessions/session-a/segments/part.ts?signature=keep';
    const h = harness(() => Promise.resolve(response({ url })), {
        profile: 'local', localManifestUrl: LOCAL_MANIFEST, policy: localPolicy,
        hlsConfig: { localManifestUrl: 'http://127.0.0.1:3000/', networkProfile: 'remote' }
    });
    h.start({ url });
    await flush();
    assert.equal(h.calls[0][0], url);
    assert.deepEqual(h.events.map(event => event[0]), ['onProgress', 'onSuccess']);
});

test('local profile fails closed without valid non-root captured manifest scope', async () => {
    for (const localManifestUrl of [undefined, '', 'invalid', 'http://127.0.0.1:3000/master.m3u8',
        'http://127.0.0.1:3001/hls/master.m3u8', 'https://remote.test/hls/master.m3u8',
        'http://127.0.0.1:3000/hls/%FF.m3u8']) {
        const h = harness(undefined, { profile: 'local', localManifestUrl, policy: localPolicy });
        h.start({ url: LOCAL_MANIFEST });
        await flush();
        assert.equal(h.calls.length, 0, String(localManifestUrl));
        assert.equal(h.events[0][1].text, 'POLICY_VIOLATION');
    }
});

test('session scope rejects sibling directories, backend paths and encoded path traversal before fetch', async () => {
    for (const pathname of ['/api/playback/sessions/session-b/part.ts', '/api/admin/settings',
        '/api/playback/sessions/session-a-other/part.ts',
        '/api/playback/sessions/session-a/../session-b/part.ts',
        '/api/playback/sessions/session-a/%2e%2e/session-b/part.ts',
        '/api/playback/sessions/session-a/sub/%2e%2e%2f%2e%2e%2fsession-b/part.ts',
        '/api/playback/sessions/session-a/sub%5c..%5c..%5csession-b/part.ts',
        '/api/playback/sessions/session-a/%FF.ts']) {
        const h = harness(undefined, { profile: 'local', localManifestUrl: LOCAL_MANIFEST, policy: localPolicy });
        h.start({ url: `http://127.0.0.1:3000${pathname}` });
        await flush();
        assert.equal(h.calls.length, 0, pathname);
        assert.equal(h.events[0][1].text, 'POLICY_VIOLATION', pathname);
    }
});

test('HDRezka profile binds every resource to the captured final host and directory before fetch', async () => {
    const policyScope = vm.createContext({ URL });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/UrlPolicy.js'), 'utf8'), policyScope);
    const providerManifestUrl = 'https://weyland.stream.voidboost.one/signed/movie/index.m3u8';
    for (const kind of ['manifest', 'level', 'fragment', 'init', 'key']) {
        const policy = { ...policyScope.UrlPolicy, kindOf: () => kind };
        const allowed = harness(() => Promise.resolve(response({ url: providerManifestUrl })), { profile: 'hdrezka', providerManifestUrl, policy });
        allowed.start({ url: providerManifestUrl });
        await flush();
        assert.equal(allowed.calls.length, 1);
        assert.equal(allowed.events.at(-1)[0], 'onSuccess');
        for (const denied of ['https://hronos.stream.voidboost.one/signed/movie/part.ts',
            'https://weyland.stream.voidboost.one/signed/other/part.ts',
            'https://weyland.stream.voidboost.one/signed/movie/sub/%2e%2e%2f%2e%2e%2fother/part.ts']) {
            const h = harness(undefined, { profile: 'hdrezka', providerManifestUrl, policy });
            h.start({ url: denied });
            await flush();
            assert.equal(h.calls.length, 0, `${kind}: reject outside session before fetch`);
            assert.equal(h.events[0][1].text, 'POLICY_VIOLATION');
        }
    }
    for (const missing of [undefined, 'https://weyland.stream.voidboost.one/index.m3u8']) {
        const h = harness(undefined, { profile: 'hdrezka', providerManifestUrl: missing, policy: policyScope.UrlPolicy });
        h.start({ url: providerManifestUrl });
        await flush();
        assert.equal(h.calls.length, 0, 'missing/root session scope fails closed');
    }
});
