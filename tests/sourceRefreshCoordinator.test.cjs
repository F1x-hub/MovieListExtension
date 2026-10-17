const assert = require('node:assert/strict');
const { SourceRefreshCoordinator } = require('../src/shared/services/player/SourceRefreshCoordinator.js');
const identity = { titleId: 'canonical-title-secret', providerId: 'animego', season: 1, episode: 2, requestId: 1 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const input = extra => ({ identity, status: 403, resource: 'manifest', refresh: async () => true, ...extra });

(async () => {
    let time = 100000;
    let saved = {};
    const storage = { get: async () => saved, set: async value => { saved = value; } };
    const coordinator = new SourceRefreshCoordinator({ storage, now: () => time });
    let count = 0;
    const gate = deferred();
    const request = input({ refresh: async () => { count++; await gate.promise; return true; } });
    const first = coordinator.run(request);
    const second = coordinator.run(request);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(count, 1, 'same identity/generation uses one refresh');
    gate.resolve();
    assert.deepEqual(await first, { handled: true, recovered: true, reason: 'refreshed' });
    assert.deepEqual(await second, await first);
    const logical = new SourceRefreshCoordinator({ storage: null });
    let refreshCount = 0;
    const logicalRequest = input({ identity: { ...identity, attemptId: 'logical-A', requestId: 'physical-1' },
        refresh: async () => { refreshCount++; return true; } });
    assert.equal((await logical.run(logicalRequest)).reason, 'refreshed');
    assert.equal((await logical.run({ ...logicalRequest,
        identity: { ...logicalRequest.identity, requestId: 'physical-2' } })).reason, 'exhausted',
    'a refreshed player retains the logical attempt budget');
    assert.equal((await logical.run({ ...logicalRequest,
        identity: { ...logicalRequest.identity, requestId: 'physical-3' } })).reason, 'cooldown');
    assert.equal(refreshCount, 1, 'physical remounts cannot obtain unlimited refreshes');
    const during = new SourceRefreshCoordinator({ storage: null });
    const refreshGate = deferred();
    let refreshStarted;
    const started = new Promise(resolve => { refreshStarted = resolve; });
    const held = { ...logicalRequest, refresh: async () => { refreshStarted(); await refreshGate.promise; return true; } };
    const oldFlight = during.run(held);
    await started;
    const duplicate = during.run(held);
    assert.equal((await during.run({ ...held, identity: { ...held.identity, requestId: 'physical-2' } })).reason, 'exhausted',
        'new physical error exhausts logical budget while old refresh remains pending');
    refreshGate.resolve();
    assert.equal((await oldFlight).reason, 'refreshed');
    assert.equal((await duplicate).reason, 'refreshed', 'old physical duplicate still joins its flight');
    assert.equal((await coordinator.run(input())).reason, 'exhausted');
    assert.equal((await coordinator.run(input())).reason, 'cooldown');
    assert.equal((await coordinator.run(input({ identity: { ...identity, episode: 3 } }))).recovered, true, 'episode budget is independent');
    assert.equal((await coordinator.run(input({ manual: true }))).recovered, true, 'explicit manual retry resets bounded budget');
    assert.equal((await coordinator.run(input())).reason, 'exhausted', 'manual retry allows only one refresh');
    time += 24 * 60 * 60 * 1000 + 1;
    assert.equal((await coordinator.run(input({ identity: { ...identity, requestId: 2 } }))).recovered, true, 'new generation after cooldown gets a budget');
    await coordinator.writes;
    assert.ok(!JSON.stringify(saved).includes('secret'));
    assert.ok(!JSON.stringify(saved).includes('animego'));
    assert.ok(!JSON.stringify(saved).includes('requestId'));
    assert.match(saved.playerRefreshBudgetV1[0].key, /^[a-f0-9]{64}$/);
    const restored = new SourceRefreshCoordinator({ storage, now: () => time });
    assert.equal((await restored.run(input({ identity: { ...identity, requestId: 2 } }))).reason, 'exhausted');

    const stale = new SourceRefreshCoordinator({ storage: null });
    const pending = deferred();
    let token;
    const active = stale.run(input({ refresh: async value => { token = value.isCurrent; await pending.promise; return true; } }));
    while (!token) await new Promise(resolve => setTimeout(resolve, 1));
    stale.invalidate(identity);
    assert.equal(token(), false);
    pending.resolve();
    assert.equal((await active).reason, 'stale');
    assert.equal((await stale.run(input({ isCurrent: () => false }))).reason, 'stale');
    assert.equal((await stale.run(input({ policyViolation: true }))).reason, 'policy');
    assert.equal((await stale.run(input({ networkProfile: 'local', status: 503 }))).reason, 'local');
    assert.equal((await stale.run(input({ status: 500 }))).reason, 'not-expired');
    assert.equal((await stale.run(input({ resource: 'file' }))).reason, 'not-expired');
    for (const resource of ['manifest', 'level', 'fragment', 'key']) {
        for (const status of [401, 403, 404, 410]) {
            const c = new SourceRefreshCoordinator({ storage: { get: async () => { throw Error('secret'); }, set: async () => { throw Error('secret'); } } });
            assert.equal((await c.run(input({ resource, status, fatal: false }))).recovered, true);
            assert.equal((await c.run(input({ resource, status, fatal: true }))).reason, 'exhausted');
        }
    }
    const bounded = new SourceRefreshCoordinator({ storage, now: () => time });
    for (let episode = 1; episode <= 70; episode++) await bounded.run(input({ identity: { ...identity, episode } }));
    await bounded.writes;
    assert.equal(bounded.records.size, 64);
    assert.equal(saved.playerRefreshBudgetV1.length, 64);
    time += 8 * 24 * 60 * 60 * 1000;
    bounded._prune();
    assert.equal(bounded.records.size, 0);
    const noCrypto = new SourceRefreshCoordinator({ storage, crypto: null });
    assert.equal((await noCrypto.run(input())).recovered, true);
    await noCrypto.writes;
    assert.ok(!JSON.stringify(saved).includes('secret'), 'hash unavailable never persists raw fallback identity');
    console.log('Source refresh coordinator tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
