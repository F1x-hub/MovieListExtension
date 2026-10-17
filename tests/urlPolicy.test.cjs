const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, '../src/shared/services/player/UrlPolicy.js');
assert.ok(fs.existsSync(file), 'A5a needs a shared URL policy');
const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const policy = context.UrlPolicy;
assert.equal(typeof policy.check, 'function');
assert.ok(policy.check('https://cloud.solodcdn.com/movie/master.m3u8', { kind: 'manifest' }).ok);
assert.ok(policy.check('https://video.rtbcdn.ru/movie/master.m3u8', { kind: 'manifest' }).ok);
assert.equal(policy.check('https://cloud.solodcdn.com/a.m3u8#start').url, 'https://cloud.solodcdn.com/a.m3u8');
assert.equal(policy.check('https://evil-solodcdn.com/master.m3u8', { kind: 'manifest' }).ok, false);
assert.equal(policy.check('https://another.example.org/master.m3u8', { kind: 'manifest' }).ok, false);
assert.ok(policy.check('https://another.example.org/part.ts', { kind: 'fragment' }).ok);
for (const host of ['127.0.0.1', '127.0.0.2', '2130706433', '0x7f.1', '0.0.0.0',
    '10.2.3.4', '172.16.0.1', '192.168.2.3', '169.254.169.254', '100.64.0.1',
    '198.18.0.1', '192.0.2.1', '224.0.0.1', 'localhost.', 'a.localhost', 'printer.local',
    '[::]', '[::1]', '[::ffff:127.0.0.1]', '[fc00::1]', '[fe80::1]', '[2001:db8::1]',
    '[2001:1f::1]', '[2001:20::1]', '[3fff:fff::1]', '[2002:7f00:1::1]']) {
    for (const kind of ['manifest', 'level', 'init', 'fragment', 'key', 'file']) {
        assert.equal(policy.check(`https://${host}/media`, { kind, profile: 'remote' }).ok, false, `${host} ${kind}`);
    }
}
assert.ok(policy.check('https://[2606:4700:4700::1111]/part', { kind: 'fragment' }).ok);
for (const url of ['http://cloud.solodcdn.com/a', 'file:///private', 'blob:https://cloud.solodcdn.com/x',
    'https://user:secret@cloud.solodcdn.com/a', 'javascript:alert(1)']) {
    assert.equal(policy.check(url, { kind: 'manifest' }).ok, false);
}
assert.equal(policy.check('https://cloud.solodcdn.com/a', { kind: 'unknown' }).ok, false);
assert.equal(policy.check('https://cloud.solodcdn.com/a', { profile: 'unknown' }).ok, false);
assert.ok(policy.check('http://127.0.0.1:3000/stream', { kind: 'fragment', profile: 'local' }).ok);
for (const url of ['blob:http://127.0.0.1:3000/stream', 'http://localhost:3000/stream', 'http://127.0.0.1:3001/stream',
    'https://127.0.0.1:3000/stream', 'http://127.0.0.2:3000/stream']) {
    assert.equal(policy.check(url, { kind: 'fragment', profile: 'local' }).ok, false);
}
const localFixture = policy.create({ localOrigin: 'http://127.0.0.1:54321' });
assert.ok(localFixture.check('http://127.0.0.1:54321/hls/a', { kind: 'manifest', profile: 'local' }).ok);
assert.equal(localFixture.check('http://127.0.0.1:3000/a', { kind: 'manifest', profile: 'local' }).ok, false);
assert.equal(policy.kindOf({ type: 'manifest' }), 'manifest');
assert.equal(policy.kindOf({ type: 'audioTrack' }), 'level');
assert.equal(policy.kindOf({ type: 'subtitleTrack' }), 'level');
assert.equal(policy.kindOf({ frag: { sn: 'initSegment' } }), 'init');
assert.equal(policy.kindOf({ frag: { sn: 2 } }), 'fragment');
assert.equal(policy.kindOf({ keyInfo: {}, frag: { sn: 2 } }), 'key');
assert.equal(policy.kindOf({ type: '__proto__' }), null);
console.log('URL policy: resource/profile matrix, manifest hosts, normalized private IPs and local origin passed.');
