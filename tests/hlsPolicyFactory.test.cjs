const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const directory = path.join(__dirname, '../src/shared/services/player');
const URL_REMOTE = 'https://video.solodcdn.com/master.m3u8';
const URL_LOCAL = 'http://127.0.0.1:3000/hls/master.m3u8';

function setup({ omit, options = {} } = {}) {
    const timers = new Map();
    let nextTimer = 0;
    const fetchCalls = [];
    let instance;
    const scope = vm.createContext({
        URL, Headers, AbortController, performance, CustomEvent, console,
        setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
        clearTimeout: id => timers.delete(id),
        fetch: (...args) => { fetchCalls.push(args); return new Promise(() => {}); }
    });
    for (const file of ['UrlPolicy', 'HlsPolicyLoader', 'HlsPlaybackFactory']) {
        if (file !== omit) vm.runInContext(fs.readFileSync(path.join(directory, `${file}.js`), 'utf8'), scope);
    }
    class FakeHls {
        static isSupported() { return true; }
        static Events = { ERROR: 'error', DESTROYING: 'destroying' };
        constructor(config) { this.config = config; this.handlers = new Map(); this.calls = []; instance = this; }
        on(name, callback) { this.handlers.set(name, callback); }
        emit(name, data) { this.handlers.get(name)?.(name, data); }
        loadSource() { this.calls.push('loadSource'); }
        attachMedia() { this.calls.push('attachMedia'); }
        stopLoad() { this.calls.push('stopLoad'); }
        startLoad() { this.calls.push('startLoad'); }
        recoverMediaError() { this.calls.push('recoverMediaError'); }
        destroy() { this.calls.push('destroy'); this.emit('destroying'); }
    }
    const video = new EventTarget();
    const fatals = [];
    const events = [];
    video.addEventListener('extension-hls-fatal', event => events.push(event.detail));
    const factory = scope.HlsPlaybackFactory;
    const hls = factory.create(video, URL_REMOTE, { Hls: FakeHls, onFatal: info => fatals.push(info), ...options });
    return { factory, hls, scope, fatals, events, timers, fetchCalls, instance };
}

test('protected config wins against caller loader, hooks and alternate network controllers', () => {
    const escape = () => { throw new Error('must not execute'); };
    const config = {
        loader: escape, pLoader: escape, fLoader: escape, fetchSetup: escape, xhrSetup: escape,
        cmcd: {}, cmcdController: escape, progressive: true, emeEnabled: true, emeController: escape,
        drmSystems: {}, drmSystemOptions: {}, widevineLicenseUrl: 'https://private/license',
        licenseXhrSetup: escape, licenseResponseCallback: escape, contentSteeringController: escape,
        interstitialsController: escape, backBufferLength: 12, capLevelToPlayerSize: false
    };
    const h = setup({ options: { config } });
    assert.equal(typeof h.hls.config.loader, 'function');
    assert.notEqual(h.hls.config.loader, escape);
    for (const key of ['pLoader', 'fLoader', 'fetchSetup', 'xhrSetup', 'cmcd', 'cmcdController',
        'emeController', 'drmSystems', 'drmSystemOptions', 'widevineLicenseUrl', 'licenseXhrSetup',
        'licenseResponseCallback', 'contentSteeringController', 'interstitialsController']) {
        assert.equal(h.hls.config[key], undefined, key);
    }
    assert.equal(h.hls.config.progressive, false);
    assert.equal(h.hls.config.emeEnabled, false);
    assert.equal(h.hls.config.backBufferLength, 12);
    assert.equal(h.hls.config.capLevelToPlayerSize, false);
});

test('missing policy/transport dependencies and unknown profile fail closed', () => {
    for (const omit of ['UrlPolicy', 'HlsPolicyLoader']) {
        const h = setup({ omit });
        assert.equal(h.hls, null);
        assert.equal(h.factory.buildConfig(), null);
        assert.equal(h.fetchCalls.length, 0);
    }
    assert.equal(setup({ options: { networkProfile: 'other' } }).hls, null);
});

test('retry policy does not confer local access; explicit networkProfile selects its own boundary', async () => {
    for (const policy of ['bounded', 'persistent']) {
        for (const networkProfile of [undefined, 'remote', 'local']) {
            const h = setup({ options: { policy, networkProfile, localManifestUrl: URL_LOCAL } });
            const loader = new h.hls.config.loader(h.hls.config);
            const errors = [];
            loader.load({ type: 'manifest', url: URL_LOCAL, responseType: 'text' }, { timeout: 100 }, {
                onError: error => errors.push(error), onSuccess() {}, onTimeout() {}
            });
            for (let i = 0; i < 4; i++) await Promise.resolve();
            assert.equal(h.fetchCalls.length, networkProfile === 'local' ? 1 : 0);
            assert.equal(errors.length, networkProfile === 'local' ? 0 : 1);
            loader.destroy();
        }
    }
});

test('nonfatal policy errors destroy once, cancel persistent retry and report policy once', () => {
    for (const policy of ['bounded', 'persistent']) {
        const h = setup({ options: { policy } });
        h.hls.emit('error', { type: 'networkError', fatal: true, details: 'fragLoadError' });
        assert.equal(h.timers.size, 1);
        const blocked = { type: 'networkError', fatal: false, details: 'keyLoadError',
            response: { code: 0, text: 'POLICY_VIOLATION' } };
        h.hls.emit('error', blocked);
        h.hls.emit('error', blocked);
        h.hls.emit('error', { type: 'networkError', fatal: true });
        assert.equal(h.timers.size, 0);
        assert.equal(h.hls.calls.filter(name => name === 'destroy').length, 1);
        assert.equal(h.hls.calls.filter(name => name === 'startLoad').length, 0);
        assert.deepEqual(h.fatals.map(info => info.reason), ['policy']);
        assert.deepEqual(h.events.map(info => info.reason), ['policy']);
    }
});

test('handled policy failure still destroys transport and suppresses duplicate outer event', () => {
    const reasons = [];
    const h = setup({ options: { onFatal: info => { reasons.push(info.reason); return true; } } });
    h.hls.emit('error', { fatal: false, response: { text: 'POLICY_VIOLATION' } });
    assert.deepEqual(reasons, ['policy']);
    assert.equal(h.events.length, 0);
    assert.equal(h.hls.calls.filter(name => name === 'destroy').length, 1);
});

test('synchronous startup policy error never attaches or returns a destroyed instance', () => {
    const h = setup({ options: { beforeLoad: hls => {
        hls.loadSource = () => {
            hls.calls.push('loadSource');
            hls.emit('error', { fatal: false, response: { text: 'POLICY_VIOLATION' } });
        };
    } } });
    assert.equal(h.hls, null);
    assert.equal(h.instance.calls.includes('attachMedia'), false);
    assert.equal(h.instance.calls.filter(name => name === 'destroy').length, 1);
    assert.deepEqual(h.fatals.map(info => info.reason), ['policy']);
});

test('beforeLoad or attachFirst lifecycle invalidation stops subsequent startup work', () => {
    const destroyed = setup({ options: { beforeLoad: hls => hls.destroy() } });
    assert.equal(destroyed.hls, null);
    assert.deepEqual(destroyed.instance.calls, ['destroy']);
    const attach = setup({ options: { attachFirst: true, beforeLoad: hls => {
        hls.attachMedia = () => { hls.calls.push('attachMedia'); hls.destroy(); };
    } } });
    assert.equal(attach.hls, null);
    assert.deepEqual(attach.instance.calls, ['attachMedia', 'destroy']);
});
