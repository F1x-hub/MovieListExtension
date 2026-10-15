const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter');

const file = path.resolve(__dirname, '../src/shared/services/player/PlaybackController.js');
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function controllerFrom(source, saveProgress) {
    const context = vm.createContext({
        require: createRequire(file), module: { exports: {} },
        console: { warn() {}, info() {}, log() {} }, Set, Map, Date
    });
    vm.runInContext(source, context, { filename: file });
    const owner = new context.module.exports.PlaybackController({
        progressService: { saveProgress },
        container: { querySelectorAll: () => [], querySelector: () => null }
    });
    owner.setSelection({ kinopoiskId: 101, title: 'Outgoing', mediaType: 'tv-series',
        seasonNumber: 2, episodeNumber: 4, initialTimestamp: 187 });
    owner.runtimeState = { ...owner.runtimeState, progressConfidence: 'RELIABLE',
        currentTime: 187.9, duration: 1200, providerId: 'old',
        mediaIdentity: { kinopoiskId: 101, seasonNumber: 2, episodeNumber: 4 } };
    return owner;
}

function adapter(id, mount) {
    return { id, label: id, canHandle: () => true, mount,
        getProgressConfidence: () => 'OPAQUE', unmount() {} };
}

async function pendingWrite(source) {
    const write = deferred();
    const saved = [];
    let mounted = false;
    const owner = controllerFrom(source, (id, payload) => {
        saved.push({ id, payload });
        return write.promise;
    });
    owner.registerAdapter(adapter('next', async () => {
        mounted = true;
        return { providerId: 'next' };
    }));
    const switched = owner.switchProvider('next', { isSwitch: true });
    await tick();
    const mountedBeforeStorage = mounted;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, 101);
    assert.equal(saved[0].payload.timestamp, 187);
    assert.equal(saved[0].payload.season, '2 сезон');
    assert.equal(saved[0].payload.episode, '4 серия');
    assert.equal(saved[0].payload.providerId, 'old');
    write.resolve();
    await switched;
    assert.equal(owner.getSelection().initialTimestamp, 187);
    assert.equal(owner.getSelection().source, 'PROVIDER_SWITCH');
    return mountedBeforeStorage;
}

(async () => {
    const source = fs.readFileSync(file, 'utf8');
    if (process.argv.includes('--compare-head')) {
        const before = execFileSync('git', ['show', 'HEAD:src/shared/services/player/PlaybackController.js'], { encoding: 'utf8' });
        assert.equal(await pendingWrite(before), false, 'baseline must block mounting on storage');
        console.log('HEAD baseline: pending progress storage blocks provider mount');
    }
    assert.equal(await pendingWrite(source), true, 'pending storage must not block provider mount');

    // A delayed mount may not supersede a newer provider switch, even while
    // persistence of the outgoing provider is still unresolved.
    const write = deferred();
    const slow = deferred();
    const owner = controllerFrom(source, () => write.promise);
    owner.registerAdapter(adapter('slow', () => slow.promise));
    owner.registerAdapter(adapter('fast', async () => ({ providerId: 'fast' })));
    const oldSwitch = owner.switchProvider('slow').catch(error => error);
    await owner.switchProvider('fast');
    slow.resolve({ providerId: 'slow' });
    assert.equal((await oldSwitch).code, 'STALE_PLAYBACK_REQUEST');
    assert.equal(owner.getActiveProvider(), 'fast');
    write.reject(new Error('Storage unavailable'));
    await tick();
    assert.equal(owner.getActiveProvider(), 'fast');

    // Exercise the real adapter: stale cleanup must not blank the newer iframe
    // on two overlapping mounts of the very same provider instance.
    const previousDocument = global.document;
    const dom = new JSDOM('<div id="player"></div>');
    global.document = dom.window.document;
    try {
        const sameProvider = controllerFrom(source, async () => {});
        sameProvider.container = dom.window.document.getElementById('player');
        sameProvider.setSelection({ ...sameProvider.getSelection(), imdbId: 'tt1234567' });
        const vidsrc = new VidSrcAdapter();
        sameProvider.registerAdapter(vidsrc);
        const outcomes = await Promise.allSettled([
            sameProvider.switchProvider('vidsrc'), sameProvider.switchProvider('vidsrc')
        ]);
        assert.equal(outcomes[0].reason.code, 'STALE_PLAYBACK_REQUEST');
        assert.equal(outcomes[1].status, 'fulfilled');
        assert.equal(sameProvider.container.querySelectorAll('iframe').length, 1);
        assert.equal(vidsrc.activeIframe, sameProvider.activeMount.element);
        assert.notEqual(vidsrc.activeIframe.src, 'about:blank');
    } finally {
        global.document = previousDocument;
        dom.window.close();
    }
    console.log('Provider switch: mounts before storage settles, captures outgoing identity/timestamp, preserves latest switch and handles failed persistence');
})().catch(error => { console.error(error); process.exitCode = 1; });
