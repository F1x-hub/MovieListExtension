const assert = require('node:assert/strict');
const { create } = require('../src/shared/services/player/WatchPreferences.js');

(async () => {
    const data = { watchPrefs_123: { innerId: 'parser:animego' } };
    const storage = {
        get: async keys => { await new Promise(resolve => setTimeout(resolve, 1)); return structuredClone(data); },
        set: async values => { await new Promise(resolve => setTimeout(resolve, 1)); Object.assign(data, structuredClone(values)); }
    };
    const prefs = create({ storage, locks: null });
    assert.deepEqual(await prefs.get(123), { innerId: 'parser:animego' });
    await Promise.all([
        prefs.patch(123, { providers: { animego: { translationId: '42', qualityHeight: 720 } } }),
        prefs.patch(123, { innerId: 'parser:seasonvar' }),
        prefs.patch(123, { providers: { seasonvar: { translationId: 'stable-dub' } } })
    ]);
    assert.deepEqual(await prefs.get('123'), { innerId: 'parser:seasonvar', providers: {
        animego: { translationId: '42', qualityHeight: 720 }, seasonvar: { translationId: 'stable-dub' }
    } });
    const second = create({ storage, locks: null });
    await Promise.all([prefs.patch(123, { innerId: 'parser:animego' }), second.patch(123, { providers: { animego: { qualityHeight: 1080 } } })]);
    assert.equal((await prefs.get(123)).providers.animego.qualityHeight, 1080);
    assert.equal((await prefs.get(123)).innerId, 'parser:animego');
    const secretUrl = 'https://user:secret@provider.example/secret?token=secret#secret';
    await prefs.patch(123, { providers: {
        animego: { translationId: secretUrl, qualityHeight: 'secret', trackIndex: 1, url: secretUrl },
        'provider-secret': { translationId: secretUrl }
    } });
    assert.ok(!JSON.stringify(data).includes('secret'));
    await prefs.patch(123, { providers: { animego: { qualityHeight: 0, translationId: null } } });
    assert.deepEqual((await prefs.get(123)).providers.animego, { qualityHeight: 0 });
    await prefs.patch(123, { providers: { animego: null } });
    assert.equal((await prefs.get(123)).providers.animego, undefined);
    await prefs.patch(124, { innerId: secretUrl });
    assert.equal((await prefs.get(124)).innerId, secretUrl, 'legacy innerId URL remains compatible');
    for (const id of ['../secret', '', '0', -1, {}, Number.MAX_SAFE_INTEGER + 1]) assert.deepEqual(await prefs.patch(id, { innerId: 'x' }), {});
    const offline = create({ storage: { get: async () => { throw Error(); }, set: async () => { throw Error(); } }, locks: null });
    await offline.patch(123, { innerId: 'parser:animego' });
    await offline.patch(123, { providers: { animego: { translationId: 42 } } });
    assert.deepEqual(await offline.get(123), { innerId: 'parser:animego', providers: { animego: { translationId: '42' } } });
    const readOnlyStorage = create({ storage: { get: storage.get, set: async () => { throw Error(); } }, locks: null });
    await readOnlyStorage.patch(123, { innerId: 'parser:seasonvar' });
    await readOnlyStorage.patch(123, { providers: { animego: { qualityHeight: 2160 } } });
    assert.equal((await readOnlyStorage.get(123)).innerId, 'parser:seasonvar', 'failed writes are not overwritten by stale persisted data');
    let lockCount = 0;
    const locked = create({ storage, locks: { request: async (name, task) => { assert.match(name, /^movie-watch-preferences:watchPrefs_\d+$/); lockCount++; return task(); } } });
    await locked.patch(125, { innerId: 'parser:animego' });
    assert.equal(lockCount, 1);
    console.log('Watch preferences tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
