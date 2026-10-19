const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(require('node:path').join(__dirname, '../src/shared/services/player/WatchSourcePolicy.js'), 'utf8');
const scope = {};
vm.runInNewContext(source, scope);
const policy = scope.WatchSourcePolicy;

const report = {
    counters: [
        { providerId: 'exfs', type: 'resolveOk', reason: 'unknown', count: 1 },
        { providerId: 'exfs', type: 'resolveFail', reason: 'network', count: 6 },
        { providerId: 'kinogo', type: 'resolveOk', reason: 'unknown', count: 9 },
        { providerId: 'kinogo', type: 'resolveFail', reason: 'timeout', count: 1 },
        { providerId: 'rutube', type: 'resolveOk', reason: 'unknown', count: 1 }
    ],
    ttff: [{ providerId: 'kinogo', quality: 'exact', p50Ms: 1500 }]
};

test('health scores come from this user\'s real start rate, with too-few attempts kept neutral', () => {
    const health = policy.healthFromReport(report);
    assert.ok(health.kinogo > 0.8, 'reliable source scores high');
    assert.ok(health.exfs < 0.2, 'mostly failing source scores low');
    assert.equal(health.rutube, undefined, 'one attempt is not evidence');
});

test('ranking tries the healthiest source first and keeps the old order without data', () => {
    const values = ['parser:exfs', 'parser:kinogo', 'parser:seasonvar'];
    const health = policy.healthFromReport(report);
    assert.deepEqual([...policy.rank(values, { health })], ['parser:kinogo', 'parser:seasonvar', 'parser:exfs']);
    assert.deepEqual([...policy.rank(values, {})], values, 'no metrics: existing button order');
    // Anime preference still beats health.
    assert.equal(policy.rank(['parser:kinogo', 'parser:animego'], { anime: true, health })[0], 'parser:animego');
});
