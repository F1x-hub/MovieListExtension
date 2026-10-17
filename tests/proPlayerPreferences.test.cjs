const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/shared/services/player/ProPlayerPreferences.js'), 'utf8');
function load(chrome) {
    const scope = { chrome };
    vm.runInNewContext(source, scope);
    return scope.ProPlayerPreferences;
}
test('defaults fail closed and accepts only literal true', async () => {
    assert.equal(await load().isEnabled(), false);
    const prefs = load({ storage: { local: { get: async () => ({ [load().KEY]: 'true' }) } } });
    assert.equal(await prefs.isEnabled(), false);
    assert.equal(await load({ storage: { local: { get: async () => { throw Error('offline'); } } } }).isEnabled(), false);
    await assert.rejects(load().setEnabled(true), /LOCAL_STORAGE_UNAVAILABLE/);
});
test('round trips only the browser-local flag and propagates failed writes', async () => {
    const state = {};
    const prefs = load({ storage: { local: { get: async () => state, set: async values => Object.assign(state, values) } } });
    assert.equal(prefs.KEY, 'movieExtension.proPlayerEnabledV1');
    await prefs.setEnabled(true);
    assert.equal(await prefs.isEnabled(), true);
    await prefs.setEnabled('true');
    assert.equal(await prefs.isEnabled(), false);
    assert.deepEqual(Object.keys(state), [prefs.KEY]);
    await assert.rejects(load({ storage: { local: { set: async () => { throw Error('quota'); } } } }).setEnabled(true), /quota/);
});
test('subscription filters areas and keys and disposes the exact listener', () => {
    let listener;
    const prefs = load({ storage: { onChanged: { addListener: fn => { listener = fn; }, removeListener: fn => { assert.equal(fn, listener); listener = null; } } } });
    const values = [];
    const dispose = prefs.subscribe(value => values.push(value));
    listener({ [prefs.KEY]: { newValue: true } }, 'sync');
    listener({ unrelated: {} }, 'local');
    listener({ [prefs.KEY]: { newValue: true } }, 'local');
    listener({ [prefs.KEY]: {} }, 'local');
    assert.deepEqual(values, [true, false]);
    dispose();
    assert.equal(listener, null);
});
