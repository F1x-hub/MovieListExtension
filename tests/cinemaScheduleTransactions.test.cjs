const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

global.Utils = require('../src/shared/utils/Utils.js');
global.firebase = { firestore: { FieldValue: { serverTimestamp: () => ({ serverTimestamp: true }) } } };
const { CinemaChannelService, normalizeChannel, computePosition, getScheduleBounds, nextScheduled, resolveChannel } = require('../src/shared/services/CinemaChannelService.js');

const HOUR = 3600_000;
const START = Date.now() + 10 * HOUR;
const STATE = 'settings/cinemaScheduleState';
const input = { mode: 'movie', kinopoiskId: 301, title: 'Movie', durationMin: 60 };
const clone = value => structuredClone(value);
const at = hours => new Date(START + hours * HOUR);

function movie(start = 0, end = 1, extra = {}) {
    return {
        mode: 'movie', title: 'Movie', startedAt: at(start), endsAt: at(end),
        youtube: null, movie: { kinopoiskId: 301, durationSec: 3600, pausedAtSec: null, posterUrl: '' },
        updatedAt: new Date(START - HOUR), updatedBy: 'admin', ...extra
    };
}

/** Models document-version retries and atomic commits; query reads are NOT transactional. */
function database(initial = {}) {
    const documents = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
    const versions = new Map([...documents.keys()].map(key => [key, 1]));
    const commits = [];
    let nextId = 0;
    let tick = START;
    const store = {
        documents, commits, retries: 0, queryCount: 0, failCommit: false,
        read: key => clone(documents.get(key)),
        put(key, value) { documents.set(key, clone(value)); versions.set(key, (versions.get(key) || 0) + 1); },
        remove(key) { documents.delete(key); versions.set(key, (versions.get(key) || 0) + 1); }
    };
    const snapshot = key => ({ id: key.split('/')[1], exists: documents.has(key), data: () => store.read(key) });
    const ref = key => ({ id: key.split('/')[1], path: key });
    const resolveStamps = value => {
        if (value?.serverTimestamp === true) return new Date(++tick);
        if (value instanceof Date || value === null || typeof value !== 'object') return clone(value);
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveStamps(item)]));
    };
    const applyPatch = (before, data) => {
        const result = clone(before);
        for (const [key, value] of Object.entries(data)) {
            if (key.includes('.')) {
                const [parent, child] = key.split('.');
                result[parent] = { ...result[parent], [child]: resolveStamps(value) };
            } else result[key] = resolveStamps(value);
        }
        return result;
    };
    store.manager = {
        getCurrentUser: () => ({ uid: 'admin' }),
        db: {
            collection(name) {
                return {
                    doc(id) { return ref(`${name}/${id || `auto-${++nextId}`}`); },
                    limit(count) {
                        return {
                            async get(options) {
                                assert.equal(options.source, 'server');
                                store.queryCount++;
                                return { docs: [...documents.keys()].filter(key => key.startsWith(`${name}/`)).slice(0, count).map(snapshot) };
                            }
                        };
                    }
                };
            },
            async runTransaction(callback) {
                for (let attempt = 0; attempt < 8; attempt++) {
                    const reads = new Map();
                    const writes = [];
                    const result = await callback({
                        async get(target) {
                            assert.ok(target.path, 'transactions only receive document references');
                            assert.equal(writes.length, 0, 'all reads precede writes');
                            reads.set(target.path, versions.get(target.path) || 0);
                            return snapshot(target.path);
                        },
                        set(target, data) { writes.push({ type: 'set', key: target.path, data }); },
                        update(target, data) { writes.push({ type: 'update', key: target.path, data }); },
                        delete(target) { writes.push({ type: 'delete', key: target.path }); }
                    });
                    if ([...reads].some(([key, version]) => (versions.get(key) || 0) !== version)) {
                        store.retries++;
                        continue;
                    }
                    if (store.failCommit) { store.failCommit = false; throw new Error('COMMIT_FAILED'); }
                    for (const write of writes) {
                        if (write.type === 'update' && !documents.has(write.key)) throw new Error('NOT_FOUND');
                    }
                    for (const write of writes) {
                        if (write.type === 'delete') store.remove(write.key);
                        else store.put(write.key, write.type === 'set' ? resolveStamps(write.data) : applyPatch(store.read(write.key), write.data));
                    }
                    if (writes.length) commits.push(writes.map(write => write.key));
                    return result;
                }
                throw new Error('TOO_MUCH_CONTENTION');
            }
        }
    };
    store.service = new CinemaChannelService(store.manager);
    store.item = id => normalizeChannel(store.read(`cinemaSchedule/${id}`), { id, docPath: `cinemaSchedule/${id}`, scheduled: true });
    return store;
}

test('explicit fixed slots override paused clocks and live YouTube; media EOF reserves the slot', () => {
    const current = normalizeChannel(movie(0, 2, { playbackStartedAt: at(0.25) }), { id: 'one', scheduled: true });
    const paused = { ...current, movie: { ...current.movie, pausedAtSec: 30 } };
    assert.equal(computePosition(paused, START - 1000).state, 'upcoming');
    assert.equal(computePosition(paused, START + 2 * HOUR).state, 'ended');
    assert.equal(computePosition(current, START + 0.5 * HOUR).offsetSec, 900);
    assert.equal(computePosition(current, START + 1.5 * HOUR).state, 'ended', 'source is shorter than slot');
    const next = normalizeChannel(movie(2, 3), { id: 'next', scheduled: true });
    const older = normalizeChannel(movie(-1, 4), { id: 'old', scheduled: true });
    assert.equal(resolveChannel(null, [older, current, next], START + 1.5 * HOUR).id, 'one');
    assert.equal(resolveChannel(null, [older, current, next], START + 2 * HOUR).id, 'next');
    assert.equal(nextScheduled([next, current], START + HOUR).id, 'next');
    const stream = normalizeChannel({ ...movie(), mode: 'youtube', movie: null, youtube: { videoId: 'dQw4w9WgXcQ', live: true } }, { scheduled: true });
    assert.equal(computePosition(stream, START + HOUR).state, 'ended');
});

test('legacy display bounds use runtime or 4h; manual streams retain indefinite playback', () => {
    const legacy = normalizeChannel(movie(0, 1, { endsAt: undefined }), { scheduled: true });
    assert.deepEqual(getScheduleBounds(legacy), { startMs: START, endMs: START + HOUR, explicitEnd: false });
    legacy.movie.durationSec = 0;
    assert.equal(getScheduleBounds(legacy).endMs, START + 4 * HOUR);
    assert.equal(computePosition(legacy, START + 10 * HOUR).state, 'live', 'legacy display estimate does not rewrite playback');
    const stream = normalizeChannel({ mode: 'youtube', startedAt: at(0), youtube: { videoId: 'dQw4w9WgXcQ', live: true } });
    assert.equal(getScheduleBounds(stream).endMs, Infinity);
    assert.equal(computePosition(stream, START + 100 * HOUR).state, 'live');
});

test('schedule returns normalized entry, supplies legacy default end and accepts adjacent boundaries', async () => {
    const store = database();
    const first = await store.service.schedule(input, at(0), at(1));
    assert.equal(first.id, 'auto-1');
    assert.equal(first.scheduled, true);
    assert.equal(first.explicitEnd, true);
    assert.equal(first.endsAtMs, START + HOUR);
    const second = await store.service.schedule(input, at(1));
    assert.equal(second.endsAtMs, START + 2 * HOUR);
    assert.equal(store.read(STATE).revision, 2);
    assert.ok(store.commits.every(keys => keys.includes(STATE) && keys.some(key => key.startsWith('cinemaSchedule/'))));
    await assert.rejects(store.service.schedule(input, at(0.5), at(1.5)), { code: 'cinema/overlap' });
    await assert.rejects(store.service.schedule(input, at(2), at(2)), { code: 'cinema/bounds' });
    await assert.rejects(store.service.schedule(input, new Date(Date.now() - HOUR), at(0)), /прошло/);
    assert.equal(store.read(STATE).revision, 2, 'failed overlap/bounds never increments state');
});

test('simultaneous conflicting creates serialize through the revision and re-query after retry', async () => {
    const store = database();
    const results = await Promise.allSettled([
        store.service.schedule(input, at(0), at(2)),
        store.service.schedule(input, at(1), at(3))
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'cinema/overlap');
    assert.equal(store.read(STATE).revision, 1);
    assert.ok(store.retries > 0);
    assert.ok(store.queryCount >= 3, 'retry reruns the server overlap query');
    assert.equal([...store.documents.keys()].filter(key => key.startsWith('cinemaSchedule/')).length, 1);
});

test('retime rejects stale versions/deletion, preserves end-resize playback and shifts moved anchors', async () => {
    const store = database({ 'cinemaSchedule/one': movie(0, 1, { playbackStartedAt: at(-0.25) }) });
    const original = store.item('one');
    const resized = await store.service.updateSchedule(original, at(0), at(2));
    assert.equal(resized.endsAtMs, START + 2 * HOUR);
    assert.equal(store.read('cinemaSchedule/one').playbackStartedAt.getTime(), START - 0.25 * HOUR);
    await assert.rejects(store.service.updateSchedule(original, at(0), at(3)), { code: 'cinema/stale' });
    const moved = await store.service.updateSchedule(store.item('one'), at(1), at(3));
    assert.equal(moved.playbackStartedAtMs, START + 0.75 * HOUR);
    await store.service.updateSchedule(store.item('one'), at(-1), at(1));
    assert.equal(store.item('one').startedAtMs, START - HOUR, 'editing an existing slot can affect a past/current start');
    const deleted = store.item('one');
    await store.service.unschedule('one');
    await assert.rejects(store.service.updateSchedule(deleted, at(0), at(1)), { code: 'cinema/stale' });
    assert.equal(store.read('cinemaSchedule/one'), undefined);
});

test('concurrent moves of different entries into the same gap permit exactly one', async () => {
    const store = database({ 'cinemaSchedule/one': movie(0, 1), 'cinemaSchedule/two': movie(3, 4) });
    const results = await Promise.allSettled([
        store.service.updateSchedule(store.item('one'), at(1), at(2)),
        store.service.updateSchedule(store.item('two'), at(1.5), at(2.5))
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'cinema/overlap');
});

test('updatedAt-only changes with sub-millisecond precision reject a stale edit', async () => {
    const firstStamp = { seconds: Math.floor(START / 1000), nanoseconds: 100 };
    const store = database({ 'cinemaSchedule/one': movie(0, 1, { updatedAt: firstStamp }) });
    const original = store.item('one');
    store.put('cinemaSchedule/one', { ...store.read('cinemaSchedule/one'), updatedAt: { ...firstStamp, nanoseconds: 200 } });
    assert.equal(store.item('one').updatedAtMs, original.updatedAtMs, 'milliseconds alone would miss this edit');
    await assert.rejects(store.service.updateSchedule(original, at(0), at(2)), { code: 'cinema/stale' });
    assert.equal(store.read(STATE), undefined);
});

test('failed commit rolls back both target and guard; deleting unknown entry is a no-op', async () => {
    const store = database({ 'cinemaSchedule/one': movie() });
    const before = store.read('cinemaSchedule/one');
    store.failCommit = true;
    await assert.rejects(store.service.updateSchedule(store.item('one'), at(1), at(2)), /COMMIT_FAILED/);
    assert.deepEqual(store.read('cinemaSchedule/one'), before);
    assert.equal(store.read(STATE), undefined);
    assert.equal(await store.service.unschedule('missing'), false);
    assert.equal(store.read(STATE), undefined);
});

test('scheduled pause/seek/resume updates fresh dotted media fields and never moves slots', async () => {
    const store = database({ 'cinemaSchedule/one': movie() });
    await store.service.control(store.item('one'), 'pause', { offsetSec: 40 });
    await store.service.control(store.item('one'), 'seek', { offsetSec: 50 });
    assert.equal(store.item('one').movie.pausedAtSec, 50);
    await store.service.control(store.item('one'), 'resume', { offsetSec: 50 });
    const current = store.item('one');
    assert.equal(current.startedAtMs, START);
    assert.equal(current.endsAtMs, START + HOUR);
    assert.ok(Number.isFinite(current.playbackStartedAtMs));
    assert.equal(current.movie.pausedAtSec, null);
    assert.equal(store.read(STATE), undefined, 'playback-only writes do not consume occupancy revisions');
    assert.ok(store.commits.every(keys => keys.length === 1));
});

test('delayed duration probe preserves pause; legacy bound changes participate in guard and overlap checks', async () => {
    const youtube = { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 0, pausedAtSec: null };
    const store = database({ 'cinemaSchedule/one': movie(0, 2, { mode: 'youtube', movie: null, youtube }) });
    const staleProbe = store.item('one');
    await store.service.control(store.item('one'), 'pause', { offsetSec: 15 });
    assert.equal(await store.service.setYoutubeDuration(staleProbe, 120), true);
    assert.equal(store.item('one').youtube.pausedAtSec, 15);
    assert.equal(store.item('one').youtube.durationSec, 120);
    assert.equal(store.read(STATE), undefined);

    const legacy = database({
        'cinemaSchedule/one': movie(0, 1, { endsAt: undefined, mode: 'youtube', movie: null, youtube }),
        'cinemaSchedule/two': movie(1, 2)
    });
    await assert.rejects(legacy.service.setYoutubeDuration(legacy.item('one'), 7200), { code: 'cinema/overlap' });
    assert.equal(legacy.item('one').youtube.durationSec, 0);
    assert.equal(await legacy.service.setYoutubeDuration(legacy.item('one'), 1800), true);
    assert.equal(legacy.read(STATE).revision, 1);
});

test('a stale manual duration probe only merges the learned field and cannot restore its old pause', async () => {
    const patches = [];
    const raw = { mode: 'youtube', startedAt: at(0), youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 0, pausedAtSec: null } };
    const beforePause = normalizeChannel(raw);
    raw.youtube.pausedAtSec = 15;
    const service = new CinemaChannelService({
        getCurrentUser: () => ({ uid: 'admin' }),
        db: { collection: () => ({ doc: () => ({ async set(patch, options) {
            assert.equal(options.merge, true);
            patches.push(patch);
            raw.youtube = { ...raw.youtube, ...patch.youtube };
        } }) }) }
    });
    assert.equal(await service.setYoutubeDuration(beforePause, 120), true);
    assert.deepEqual(patches[0].youtube, { durationSec: 120 });
    assert.equal(raw.youtube.pausedAtSec, 15);
    assert.equal(raw.youtube.videoId, 'dQw4w9WgXcQ');
});

test('bounded queries reject >500 entries without partial writes and still allow cleanup', async () => {
    const initial = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`cinemaSchedule/slot-${i}`, movie(i * 2, i * 2 + 1)]));
    const store = database(initial);
    await assert.rejects(store.service.schedule(input, at(2000), at(2001)), { code: 'cinema/limit' });
    await assert.rejects(store.service.updateSchedule(store.item('slot-0'), at(-1), at(0)), { code: 'cinema/limit' });
    assert.equal(store.read(STATE), undefined);
    await store.service.unschedule('slot-0');
    assert.equal(store.read(STATE).revision, 1);
    assert.equal(store.documents.size, 501, '500 schedule documents plus guard');
    await assert.rejects(store.service.schedule(input, at(2000), at(2001)), { code: 'cinema/limit' });
});

test('housekeeping waits a full day after explicit slot end and serializes its own guard writes', async () => {
    const store = database({
        'cinemaSchedule/old': movie(0, 1),
        'cinemaSchedule/recent': movie(1, 3),
        'cinemaSchedule/older': movie(-2, -1)
    });
    const items = ['old', 'recent', 'older'].map(store.item);
    assert.equal(await store.service.sweepFinished(items, START + 26 * HOUR), 2);
    assert.equal(store.read('cinemaSchedule/old'), undefined);
    assert.ok(store.read('cinemaSchedule/recent'));
    assert.equal(store.read(STATE).revision, 2);
    assert.equal(store.retries, 0, 'housekeeping does not contend with itself');
});

test('rules require guard for occupancy and legacy duration changes while preserving public schedule reads', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../rules/firestore.rules'), 'utf8');
    assert.match(rules, /getAfter\(statePath\)\.data/);
    assert.match(rules, /next\.revision == previous \+ 1/);
    assert.match(rules, /settingId == 'cinemaScheduleState' && isAdmin\(\)/);
    assert.match(rules, /\('endsAt' in request\.resource\.data\) && cinemaScheduleRevisionAdvanced\(\)/);
    assert.match(rules, /allow update: if isAdmin\(\) && validCinemaSchedule\(request\.resource\.data\)/);
    assert.match(rules, /before\.get\('endsAt', null\) == after\.get\('endsAt', null\)/);
    assert.match(rules, /\('endsAt' in after\) \|\| before\.youtube\.get\('durationSec', 0\) == after\.youtube\.get\('durationSec', 0\)/);
});
