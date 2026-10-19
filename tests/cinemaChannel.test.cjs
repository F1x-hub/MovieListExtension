const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

global.Utils = require('../src/shared/utils/Utils.js');
const { normalizeChannel, computePosition, buildChannelPayload, formatClock } = require('../src/shared/services/CinemaChannelService.js');

const START = Date.UTC(2026, 9, 19, 18, 0, 0);

test('unknown or broken documents fall back to an «off» channel', () => {
    assert.equal(normalizeChannel(null).mode, 'off');
    assert.equal(normalizeChannel({ mode: 'stream' }).mode, 'off');
    assert.equal(normalizeChannel({ mode: 'youtube', youtube: { videoId: '<script>' } }).mode, 'off');
    assert.equal(normalizeChannel({ mode: 'movie', movie: { kinopoiskId: -3 } }).mode, 'off');
});

test('a late viewer joins at the broadcast position', () => {
    const channel = normalizeChannel({ mode: 'movie', movie: { kinopoiskId: 301, durationSec: 8160 }, startedAt: new Date(START) });
    assert.deepEqual(computePosition(channel, START + 47 * 60 * 1000 + 12_000), { state: 'live', offsetSec: 47 * 60 + 12 });
    assert.equal(computePosition(channel, START + 8160 * 1000).state, 'ended');
    assert.deepEqual(computePosition(channel, START - 30_000), { state: 'upcoming', offsetSec: 30 });
});

test('Firestore timestamps and live YouTube streams', () => {
    const vod = normalizeChannel({ mode: 'youtube', youtube: { videoId: 'dQw4w9WgXcQ' }, startedAt: { seconds: START / 1000, nanoseconds: 0 } });
    assert.equal(computePosition(vod, START + 90_000).offsetSec, 90);
    const live = normalizeChannel({ mode: 'youtube', youtube: { videoId: 'dQw4w9WgXcQ', live: true }, startedAt: new Date(START) });
    assert.deepEqual(computePosition(live, START + 9_999_000), { state: 'live', offsetSec: 0 });
});

test('admin payloads accept YouTube links and Kinopoisk IDs and reject junk', () => {
    assert.deepEqual(buildChannelPayload({ mode: 'youtube', youtubeUrl: 'https://www.youtube.com/live/dQw4w9WgXcQ', youtubeLive: true, title: ' Стрим ' }).youtube,
        { videoId: 'dQw4w9WgXcQ', live: true, durationSec: 0, pausedAtSec: null });
    assert.equal(buildChannelPayload({ mode: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ?t=30', title: ' Стрим ' }).title, 'Стрим');
    assert.deepEqual(buildChannelPayload({ mode: 'movie', kinopoiskId: '301', durationMin: '136', posterUrl: 'https://st.kp.yandex.net/301.jpg' }).movie, { kinopoiskId: 301, durationSec: 8160, posterUrl: 'https://st.kp.yandex.net/301.jpg', pausedAtSec: null });
    assert.equal(buildChannelPayload({ mode: 'movie', kinopoiskId: '301', posterUrl: 'javascript:alert(1)' }).movie.posterUrl, '');
    assert.throws(() => buildChannelPayload({ mode: 'youtube', youtubeUrl: 'https://evil.example/watch?v=dQw4w9WgXcQ' }), /YouTube/);
    assert.throws(() => buildChannelPayload({ mode: 'movie', kinopoiskId: 'abc' }), /Kinopoisk/);
    assert.equal(buildChannelPayload({ mode: 'off' }).mode, 'off');
});

test('an admin pause freezes every viewer at the same second', () => {
    const paused = normalizeChannel({ mode: 'movie', movie: { kinopoiskId: 301, durationSec: 8160, pausedAtSec: 397 }, startedAt: new Date(START) });
    assert.deepEqual(computePosition(paused, START + 3_600_000), { state: 'paused', offsetSec: 397 });
    const running = normalizeChannel({ mode: 'movie', movie: { kinopoiskId: 301, pausedAtSec: null }, startedAt: new Date(START) });
    assert.equal(computePosition(running, START + 10_000).state, 'live');
});

test('YouTube videos can be paused by the admin, live streams never', () => {
    const vod = normalizeChannel({ mode: 'youtube', youtube: { videoId: 'dQw4w9WgXcQ', pausedAtSec: 61 }, startedAt: new Date(START) });
    assert.deepEqual(computePosition(vod, START + 999_000), { state: 'paused', offsetSec: 61 });
    const live = normalizeChannel({ mode: 'youtube', youtube: { videoId: 'dQw4w9WgXcQ', live: true, pausedAtSec: 61 }, startedAt: new Date(START) });
    assert.equal(computePosition(live, START).state, 'live');
});

test('clock formatting', () => {
    assert.equal(formatClock(75), '1:15');
    assert.equal(formatClock(3 * 3600 + 5), '3:00:05');
});

test('Firestore rules let everyone read the channel and only admins publish it', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../rules/firestore.rules'), 'utf8');
    assert.match(rules, /allow read: if settingId == 'commentReactions' \|\| settingId == 'cinemaChannel';/);
    assert.match(rules, /settingId == 'cinemaChannel'\s*&& isAdmin\(\)/);
});

test('a viewer with a wrong computer clock still lands on the server-time position', async () => {
    const realFetch = global.fetch;
    const skewMs = 5 * 60 * 1000; // server is 5 minutes ahead of this computer
    global.fetch = async () => ({ headers: { get: () => new Date(Date.now() + skewMs).toUTCString() } });
    try {
        const { syncClock, now, toLocalMs } = require('../src/shared/services/CinemaChannelService.js');
        await syncClock();
        assert.ok(Math.abs(now() - (Date.now() + skewMs)) < 1500, 'server clock offset applied');
        const serverStart = now() - 60_000;
        const channel = normalizeChannel({ mode: 'movie', movie: { kinopoiskId: 301 }, startedAt: new Date(serverStart) });
        assert.equal(Math.round(computePosition(channel).offsetSec / 10), 6, 'one minute in, measured on server time');
        assert.ok(Math.abs(toLocalMs(serverStart) - (Date.now() - 60_000)) < 1500, 'players get the start in local time');
    } finally {
        global.fetch = realFetch;
    }
});

test('fallback relay: signaling rules keep offers admin-only and docs small', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../rules/firestore.rules'), 'utf8');
    assert.match(rules, /match \/liveRelay\/\{docId\}/);
    assert.match(rules, /request\.resource\.data\.state in \['request', 'answered'\]/);
    assert.match(rules, /allow delete: if isAdmin\(\) \|\| \(isAuthenticated\(\) && request\.auth\.uid == viewerId\)/);
    const { isValidSdp } = require('../src/shared/services/LiveRelayService.js');
    assert.equal(isValidSdp({ type: 'offer', sdp: 'v=0' }, 'offer'), true);
    assert.equal(isValidSdp({ type: 'answer', sdp: 'v=0' }, 'offer'), false);
    assert.equal(isValidSdp({ type: 'offer', sdp: 'x'.repeat(300_000) }, 'offer'), false);
});

test('schedule: planned shows start on their own and later starts supersede earlier ones', () => {
    const { resolveChannel } = require('../src/shared/services/CinemaChannelService.js');
    const H = 3600 * 1000;
    const sched = (id, startMs, extra = {}) => normalizeChannel(
        { mode: 'movie', title: id, movie: { kinopoiskId: 301, durationSec: 7200, ...extra }, startedAt: new Date(startMs) },
        { id, docPath: `cinemaSchedule/${id}`, scheduled: true });
    const manualOff = normalizeChannel({ mode: 'off', startedAt: new Date(START - H) });
    const evening = sched('evening', START + 2 * H);
    const night = sched('night', START + 5 * H);

    // Before anything starts: the next show is announced with a countdown.
    let shown = resolveChannel(manualOff, [evening, night], START);
    assert.equal(shown.id, 'evening');
    assert.equal(computePosition(shown, START).state, 'upcoming');
    // At its time it is on air, without anyone pressing a button.
    shown = resolveChannel(manualOff, [evening, night], START + 2 * H + 60_000);
    assert.equal(shown.id, 'evening');
    assert.deepEqual(computePosition(shown, START + 2 * H + 60_000), { state: 'live', offsetSec: 60 });
    // After it ends, the next planned show counts down again.
    assert.equal(resolveChannel(manualOff, [evening, night], START + 4 * H + 1000).id, 'night');
    // A manual stop during a show takes it off air.
    const stopped = normalizeChannel({ mode: 'off', startedAt: new Date(START + 3 * H) });
    assert.equal(resolveChannel(stopped, [evening], START + 3 * H + 1000).mode, 'off');
    // Admin controls write to the schedule entry, not the manual channel.
    assert.equal(evening.docPath, 'cinemaSchedule/evening');
});

test('schedule rules: anyone reads planned shows, only admins plan them', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../rules/firestore.rules'), 'utf8');
    assert.match(rules, /match \/cinemaSchedule\/\{itemId\} \{\s*allow read: if true;\s*allow create, update: if isAdmin\(\)/);
});
