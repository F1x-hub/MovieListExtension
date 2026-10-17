const assert = require('node:assert/strict');
const diagnostics = require('../src/shared/services/player/PlayerDiagnostics.js');

const secret = 'diagnostic-secret';
const sensitive = `https://user:${secret}@provider.example/${secret}/file.m3u8?token=${secret}#${secret}`;
for (const value of [sensitive, encodeURIComponent(sensitive), new Error(sensitive), {
    name: sensitive, message: sensitive, code: sensitive, status: sensitive,
    cause: { url: sensitive }, response: { text: sensitive, code: sensitive }, url: sensitive
}, null, undefined, 500, new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(sensitive); } })]) {
    assert.deepEqual(diagnostics.sanitizeError(value), { category: 'unknown' });
    assert.equal(diagnostics.errorCategory(value), 'unknown');
    assert.deepEqual(diagnostics.redactUrl(value, sensitive, sensitive), { providerId: 'unknown', resource: 'unknown' });
}
const getterError = {};
for (const key of ['name', 'message', 'response', 'code', 'status']) {
    Object.defineProperty(getterError, key, { get() { throw new Error('must not invoke getters'); } });
}
assert.deepEqual(diagnostics.sanitizeError(getterError), { category: 'unknown' });
for (const [input, expected] of [
    [{ name: 'AbortError', message: sensitive }, { category: 'aborted' }],
    [{ name: 'TimeoutError', url: sensitive }, { category: 'timeout' }],
    [{ name: 'NetworkError', message: sensitive }, { category: 'network' }],
    [{ response: { text: 'POLICY_VIOLATION', url: sensitive } }, { category: 'policy' }],
    [new Error('decode_failed'), { category: 'decode' }],
    [{ status: 403, message: sensitive }, { category: 'http', code: 403 }],
    [{ response: { code: 503, text: sensitive } }, { category: 'http', code: 503 }],
    [{ status: '403', message: sensitive }, { category: 'unknown' }],
    [{ status: 200, message: sensitive }, { category: 'unknown' }]
]) assert.deepEqual(diagnostics.sanitizeError(input), expected);
assert.equal(diagnostics.safeSourceId('parser:animego'), 'animego');
assert.equal(diagnostics.safeSourceId('kinogo'), 'kinogo');
assert.equal(diagnostics.safeSourceId('animego/secret'), 'unknown');
assert.deepEqual(diagnostics.redactUrl(sensitive, 'parser:animego', 'manifest'), { providerId: 'animego', resource: 'manifest' });
assert.ok(Object.isFrozen(diagnostics));
console.log('Player diagnostics tests passed');
