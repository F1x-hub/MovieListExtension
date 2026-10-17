const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const extId = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
    .slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
assert.equal(extId, 'dgdejomdgiabgcfijcdhjefijdfiemhd');
const registration = manifest.declarative_net_request.rule_resources.find(entry => entry.path === 'src/background/player-response-header-rules.json');
assert.ok(registration?.enabled, 'scoped response header rules must be enabled as a separate ruleset');
const rules = JSON.parse(fs.readFileSync(path.join(root, registration.path), 'utf8'));
assert.deepEqual(rules.map(rule => rule.id), [1, 2, 5, 6]);
const hosts = { 1: 'widgets.kinopoisk.ru', 2: 'www.kinopoisk.ru', 5: 'rutube.ru', 6: 'rtbcdn.ru' };
const expectedHeaders = id => id < 5 ? [
    { header: 'x-frame-options', operation: 'remove' },
    { header: 'content-security-policy', operation: 'remove' }
] : [
    { header: 'access-control-allow-origin', operation: 'set', value: '*' },
    { header: 'access-control-allow-methods', operation: 'set', value: 'GET, POST, OPTIONS, HEAD' },
    { header: 'access-control-allow-headers', operation: 'set', value: '*' }
];
for (const rule of rules) {
    assert.equal(rule.priority, 1);
    assert.deepEqual(rule.action, { type: 'modifyHeaders', responseHeaders: expectedHeaders(rule.id) });
    assert.deepEqual(rule.condition, {
        requestDomains: [hosts[rule.id]], initiatorDomains: [extId],
        resourceTypes: rule.id < 5 ? ['sub_frame'] : ['xmlhttprequest', 'media', 'other']
    }, 'scope must exclude broad URL substring matching, parent domains and arbitrary initiators');
}
assert.equal(manifest.declarative_net_request.rule_resources.some(entry => entry.path === 'src/background/rules.json'), false);
assert.ok(manifest.declarative_net_request.rule_resources.some(entry => entry.path === 'src/background/provider-embed-rules.json' && entry.enabled));
// Schema contracts above establish these exclusions; Chrome matching is a separate browser gate.
for (const rule of rules.filter(rule => rule.id < 5)) {
    assert.equal(rule.condition.resourceTypes.includes('xmlhttprequest'), false);
    assert.equal(rule.condition.requestDomains.includes('kinopoisk.ru'), false);
    assert.equal(rule.condition.initiatorDomains.includes('kinopoisk.ru'), false);
}
console.log('Player header rules: scoped domains, extension initiator, frame-only security-header removal and preserved CORS/embed compatibility contracts passed.');
