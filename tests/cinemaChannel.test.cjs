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

test('episode payloads keep a complete canonical selection and the selected episode runtime', () => {
    const payload = buildChannelPayload({
        mode: 'movie', kinopoiskId: '301', mediaType: 'tv-series', seasonNumber: '0', episodeNumber: '2',
        episodeTitle: ' Спецвыпуск ', tmdbId: '1399', durationMin: '42.5'
    });
    assert.deepEqual(payload.movie, {
        kinopoiskId: 301, durationSec: 2550, posterUrl: '', pausedAtSec: null,
        tmdbId: 1399, mediaType: 'tv-series', seasonNumber: 0, episodeNumber: 2, episodeTitle: 'Спецвыпуск'
    });
    const normalized = normalizeChannel({ ...payload, startedAt: new Date(START) });
    assert.deepEqual(normalized.movie, payload.movie);
    assert.equal(computePosition(normalized, START + 2550_000).state, 'ended');
    const legacy = buildChannelPayload({ mode: 'movie', kinopoiskId: 301 });
    assert.equal('mediaType' in legacy.movie, false);
    assert.equal('seasonNumber' in legacy.movie, false);
    assert.equal('tmdbId' in legacy.movie, false);
    assert.equal(buildChannelPayload({ mode: 'movie', kinopoiskId: 301, tmdbId: 12 }).movie.tmdbId, 12);
});

test('invalid or half-specified episode fields are rejected instead of becoming a different episode', () => {
    const base = { mode: 'movie', kinopoiskId: 301 };
    const episode = { mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 2 };
    const invalid = [
        { seasonNumber: 1 }, { episodeNumber: 2 }, { episodeTitle: 'Series' }, { mediaType: 'movie' },
        { mediaType: 'tv-series' }, { mediaType: 'tv-series', seasonNumber: 1 },
        { ...episode, seasonNumber: -1 }, { ...episode, seasonNumber: 1.5 }, { ...episode, seasonNumber: true },
        { ...episode, episodeNumber: 0 }, { ...episode, episodeNumber: '' }, { ...episode, episodeNumber: null },
        { ...episode, episodeNumber: '1e3' }, { ...episode, episodeNumber: Number.MAX_SAFE_INTEGER + 1 },
        { ...episode, episodeTitle: 123 }, { ...episode, episodeTitle: 'x'.repeat(201) },
        { ...episode, tmdbId: 0 }, { ...episode, tmdbId: true }, { tmdbId: -2 }
    ];
    for (const fields of invalid) assert.throws(() => buildChannelPayload({ ...base, ...fields }), { code: 'cinema/episode' }, JSON.stringify(fields));
    for (const fields of invalid) {
        assert.equal(normalizeChannel({ mode: 'movie', movie: { kinopoiskId: 301, ...fields } }).mode, 'off', JSON.stringify(fields));
    }
    assert.equal(normalizeChannel({ mode: 'movie', movie: { kinopoiskId: 301, ...episode, seasonNumber: '1' } }).mode, 'off', 'stored fields require integer types');
});

test('manual and scheduled rules share strict movie/episode validation with bounded titles', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../rules/firestore.rules'), 'utf8');
    assert.match(rules, /settingId == 'cinemaChannel'\s*&& isAdmin\(\)\s*&& validCinemaChannel\(request\.resource\.data\)/);
    assert.match(rules, /function validCinemaChannel\(data\)[\s\S]*?&& validCinemaMedia\(data\);/);
    assert.match(rules, /function validCinemaSchedule\(data\)[\s\S]*?&& validCinemaMedia\(data\);/);
    assert.match(rules, /validCinemaDuration\(data\.movie\) && validCinemaEpisode\(data\.movie\)/);
    assert.match(rules, /media\.seasonNumber is int && media\.seasonNumber >= 0/);
    assert.match(rules, /media\.episodeNumber is int && media\.episodeNumber >= 1/);
    assert.match(rules, /media\.episodeTitle is string && media\.episodeTitle\.size\(\) <= 200/);
    assert.match(rules, /media\.tmdbId is int && media\.tmdbId > 0/);
    for (const field of ['mediaType', 'seasonNumber', 'episodeNumber']) {
        assert.ok(rules.includes(`before.movie.get('${field}', null) == after.movie.get('${field}', null)`), `${field} changes require occupancy revision`);
    }
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
    assert.match(rules, /match \/cinemaSchedule\/\{itemId\} \{\s*allow read: if true;\s*allow create: if isAdmin\(\)/);
    assert.match(rules, /allow delete: if isAdmin\(\) && cinemaScheduleRevisionAdvanced\(\)/);
    assert.match(rules, /cinemaScheduleOccupancyUnchanged\(\) \|\| cinemaScheduleRevisionAdvanced\(\)/);
});

test('CinemaChannelService.control updates pause, seek, and resume for YouTube VOD and rejects live streams', async () => {
    const { CinemaChannelService } = require('../src/shared/services/CinemaChannelService.js');
    const prevFirebase = global.firebase;
    global.firebase = {
        firestore: {
            FieldValue: { serverTimestamp: () => 'SERVER_TS' }
        }
    };
    try {
        const writes = [];
        let docState = {
            mode: 'youtube',
            title: 'Клип',
            startedAt: new Date(Date.now() - 30_000),
            youtube: { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 200, pausedAtSec: null }
        };
        const makeRef = docPath => ({
            id: docPath.split('/')[1],
            docPath,
            async set(patch, opts) {
                writes.push({ docPath, patch, opts });
                docState = { ...docState, ...patch };
            }
        });
        const manager = {
            getCurrentUser: () => ({ uid: 'admin-1' }),
            db: {
                async runTransaction(callback) {
                    return callback({
                        get: async ref => ({ id: ref.id, exists: true, data: () => docState }),
                        update(ref, patch) {
                            writes.push({ docPath: ref.docPath, patch });
                            for (const [key, value] of Object.entries(patch)) {
                                if (key.includes('.')) {
                                    const [parent, field] = key.split('.');
                                    docState[parent] = { ...docState[parent], [field]: value };
                                } else docState[key] = value;
                            }
                        }
                    });
                },
                collection(name) {
                    return {
                        doc(id) {
                            return makeRef(`${name}/${id}`);
                        }
                    };
                }
            }
        };
        const service = new CinemaChannelService(manager);

        // 1. Pause clamps to durationSec - 5 when durationSec is known.
        await service.control(normalizeChannel(docState), 'pause', { offsetSec: 199 });
        assert.equal(docState.youtube.pausedAtSec, 195);
        assert.equal(writes.at(-1).docPath, 'settings/cinemaChannel');

        // 2. Seek while paused moves pausedAtSec without unpausing.
        const prevStartedAt = docState.startedAt;
        await service.control(normalizeChannel(docState), 'seek', { offsetSec: 84 });
        assert.equal(docState.youtube.pausedAtSec, 84);
        assert.equal(docState.startedAt, prevStartedAt);

        // 3. Resume clears pausedAtSec and anchors startedAt to offsetSec.
        await service.control(normalizeChannel(docState), 'resume', { offsetSec: 84 });
        assert.equal(docState.youtube.pausedAtSec, null);
        const resumedPos = computePosition(normalizeChannel(docState));
        assert.equal(resumedPos.state, 'live');
        assert.ok(Math.abs(resumedPos.offsetSec - 84) <= 2);

        // 4. Seek while live keeps pausedAtSec: null and shifts startedAt.
        await service.control(normalizeChannel(docState), 'seek', { offsetSec: 140 });
        assert.equal(docState.youtube.pausedAtSec, null);
        const seekedPos = computePosition(normalizeChannel(docState));
        assert.equal(seekedPos.state, 'live');
        assert.ok(Math.abs(seekedPos.offsetSec - 140) <= 2);

        // 5. Scheduled YouTube item writes to cinemaSchedule/{id}.
        const scheduled = normalizeChannel(docState, { id: 'slot-1', docPath: 'cinemaSchedule/slot-1', scheduled: true });
        await service.control(scheduled, 'pause', { offsetSec: 50 });
        assert.equal(writes.at(-1).docPath, 'cinemaSchedule/slot-1');

        // 6. Live YouTube streams cannot be paused or seeked.
        const liveStream = normalizeChannel({
            mode: 'youtube',
            startedAt: new Date(),
            youtube: { videoId: 'dQw4w9WgXcQ', live: true, durationSec: 0, pausedAtSec: null }
        });
        await assert.rejects(() => service.control(liveStream, 'seek', { offsetSec: 10 }), /Прямую трансляцию/);
    } finally {
        global.firebase = prevFirebase;
    }
});
