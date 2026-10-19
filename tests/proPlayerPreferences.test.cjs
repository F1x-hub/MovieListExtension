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
test('watch interface is always enabled, even with a stale stored opt-out', async () => {
    assert.equal(await load().isEnabled(), true);
    assert.equal(await load({ storage: { local: { get: async () => ({ 'movieExtension.proPlayerEnabledV1': false }) } } }).isEnabled(), true);
    assert.equal(typeof load().subscribe(() => {}), 'function');
});
