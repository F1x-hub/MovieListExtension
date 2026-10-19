const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');
const directory = path.join(__dirname, '../src/shared/services/player');
const scope = vm.createContext({ URL });
for (const file of ['UrlPolicy', 'HdrezkaProbeSources']) {
    vm.runInContext(fs.readFileSync(path.join(directory, `${file}.js`), 'utf8'), scope);
}
const url = 'https://weyland.stream.voidboost.one/session/movie/index.m3u8';
const entry = (value = url, status = 200) => ({ request: { method: 'GET', url: value }, response: { status } });

test('HAR import keeps successful reviewed manifests, deduplicates and does not expose headers', () => {
    const data = { log: { entries: [null, {}, entry(url, 302), entry(), entry(), entry('https://stream.voidboost.one/session/index.m3u8'),
        entry('https://weyland.stream.voidboost.one/session/part.ts'), entry('https://example.com/index.m3u8')] } };
    const sources = scope.HdrezkaProbeSources.fromHar(data);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].url, url);
    assert.deepEqual(Object.keys(sources[0]), ['url', 'host']);
    assert.throws(() => scope.HdrezkaProbeSources.fromHar({}));
    assert.throws(() => scope.HdrezkaProbeSources.fromHar({ log: { entries: Array(10001) } }));
});

test('HDRezka profile cannot expand the existing remote allowlist or permit routing and private hosts', () => {
    const policy = scope.UrlPolicy;
    assert.equal(policy.check(url).ok, false, 'existing providers must retain their allowlist');
    for (const kind of ['manifest', 'level', 'fragment', 'init', 'key']) {
        assert.equal(policy.check(url, { kind, profile: 'hdrezka' }).ok, true);
        for (const rejected of ['https://stream.voidboost.one/a.m3u8', 'https://other.stream.voidboost.one/a.m3u8',
            'https://evil.weyland.stream.voidboost.one/a.m3u8', 'https://weyland.stream.voidboost.one.evil.test/a.m3u8',
            'https://127.0.0.1/a.m3u8', 'http://weyland.stream.voidboost.one/a.m3u8',
            'https://user:password@weyland.stream.voidboost.one/a.m3u8']) {
            assert.equal(policy.check(rejected, { kind, profile: 'hdrezka' }).ok, false, rejected);
        }
    }
});
