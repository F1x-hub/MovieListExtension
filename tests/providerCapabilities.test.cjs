const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const scope = { console };
const root = path.join(__dirname, '..');
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/shared/services/player/ProviderCapabilities.js'), 'utf8'), scope);
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/shared/services/player/adapters/BasePlaybackAdapter.js'), 'utf8') + '\nglobalThis.TestBase = BasePlaybackAdapter;', scope);
const { describe } = scope.ProviderCapabilities;
test('unknown declarations remain unknown instead of falsely unsupported', () => {
    const value = describe();
    assert.equal(value.declared.movies, null);
    assert.equal(value.declared.audioTracks, null);
    assert.equal(value.playable, null);
    assert.equal(value.trackIdentityEligible, false);
});
test('reads real base adapter declarations and preserves unsupported versus unknown', () => {
    const adapter = new scope.TestBase('test');
    const value = describe({ adapter, parser: {}, readiness: 'loading' });
    assert.equal(value.declared.movies, true);
    assert.equal(value.declared.directSeasonEpisode, false);
    assert.equal(value.declared.audioTracks, null);
    assert.equal(value.declared.selectionMode, 'OPAQUE');
    assert.equal(value.parserAvailable, true);
    assert.equal(value.playable, null);
    assert.ok(Object.isFrozen(value.declared));
});
test('discovery never implies playable and readiness retains terminal false', () => {
    for (const readiness of ['discovered', null, 'loading', { state: 'loading' }]) assert.equal(describe({ readiness }).playable, null);
    for (const readiness of ['error', 'unavailable', 'cancelled']) assert.equal(describe({ readiness }).playable, false);
    assert.equal(describe({ readiness: 'ready' }).playable, true);
});
test('tracks require complete exact episode identity and readiness', () => {
    const selection = { kinopoiskId: 12, mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 2 };
    assert.equal(describe({ selection, readiness: 'ready' }).trackIdentityEligible, true);
    for (const change of [{ episodeNumber: null }, { seasonNumber: 0 }, { kinopoiskId: '12' }]) {
        assert.equal(describe({ selection: { ...selection, ...change }, readiness: 'ready' }).trackIdentityEligible, false);
    }
    assert.equal(describe({ selection, readiness: 'loading' }).trackIdentityEligible, false);
    assert.equal(describe({ selection: { kinopoiskId: 12, mediaType: 'movie' }, readiness: 'ready' }).trackIdentityEligible, true);
});
test('rejects mismatched adapter, thrown methods and nonboolean claims', () => {
    assert.equal(describe({ providerId: 'other', adapter: new scope.TestBase('test') }).declared.movies, null);
    const value = describe({ adapter: { supportsMovies() { throw Error('private-url'); }, supportsSeries: () => 'yes' } });
    assert.equal(value.declared.movies, null);
    assert.equal(value.declared.series, null);
    assert.ok(!JSON.stringify(value).includes('private-url'));
});
