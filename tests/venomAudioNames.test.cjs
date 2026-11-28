/**
 * Venom names audio tracks from the balancer's list by position. When that list belongs to
 * another release («Мстители», KP 263531: «Рус. Дублированный» over an English file), the
 * guard moves the names onto the tracks the HLS manifest tags with their language.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const guard = fs.readFileSync(path.join(__dirname, '../content-scripts/provider-ad-guard.js'), 'utf8');

const master = tracks => ['#EXTM3U', ...tracks.map(([name, language], index) =>
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="${name}",DEFAULT=${index ? 'NO' : 'YES'},LANGUAGE="${language}",URI="a${index + 1}.m3u8"`),
...tracks.map(([name, language], index) =>
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="failover-audio-0",NAME="${name}",LANGUAGE="${language}",URI="b${index + 1}.m3u8"`),
'#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="audio0"', 'v.m3u8'].join('\n');

const AVENGERS_NAMES = ['Рус. Дублированный', 'Укр. Дубльований', 'Ю. Сербин', 'Eng.Original'];
const AVENGERS_TRACKS = [['eng0', 'en'], ['eng1', 'en'], ['rus2', 'ru'], ['rus3', 'ru']];

async function harness({ names, tracks, fetchOk = true }) {
    const fetched = [];
    let answer;
    const answered = new Promise(resolve => { answer = resolve; });
    const window = {
        location: Object.assign(new URL('https://api.corevia.ws/embed/kp/263531?santabarbaranoads=1'), { ancestorOrigins: [] }),
        localStorage: { getItem: () => null, setItem() {} },
        document: { referrer: '', documentElement: { dataset: {} }, addEventListener() {}, querySelectorAll: () => [] },
        history: { replaceState() {} },
        fetch: url => {
            fetched.push(url);
            return answered.then(() => ({ ok: fetchOk, text: async () => master(tracks) }));
        }
    };
    const context = vm.createContext({
        window, document: window.document, URL, Date, Math, Number, Object, JSON, Array, Promise, String, Set, self: {}, top: {},
        performance: { now: () => 0 },
        console: { info() {}, warn() {}, debug() {} },
        setTimeout: () => 0, clearTimeout() {}
    });
    vm.runInContext(guard, context);
    const events = {};
    const emitted = [];
    // Venom's engine: the same calls the real one makes (player-venom 0.3.8).
    const engine = {
        audioNames: null, audioOrder: null, audioAll_: null, audioList: null, played: 0,
        events: { AUDIO_LIST: 'audioList' },
        isAudioBlocked: name => name === 'delete',
        transformAudioList(list) {
            const shown = this.audioNames?.length === list.length ? this.audioNames : list;
            const order = this.audioOrder?.length === shown.length ? this.audioOrder : shown.map((_, index) => index);
            const placed = [];
            shown.forEach((name, index) => { placed[order[index]] = name; });
            this.audioAll_ = shown;
            this.audioList = placed.filter(name => !this.isAudioBlocked(name));
        },
        emit(type, value) { emitted.push([type, [...value]]); },
        get originalAudio() { return this.played; },
        set audio(index) { this.played = this.audioAll_.findIndex(name => name === this.audioList[index]); }
    };
    const internal = { source: engine };
    const facade = { once(type, handler) { (events[type] ||= []).push(handler); return facade; }, on() { return facade; } };
    const options = { container: {}, source: { dash: 'a.mpd', hls: 'https://cdn.example/master.m3u8', audio: { names, order: names.map((_, index) => index) } } };
    window.VenomPlayer = {
        make: made => {
            engine.audioNames = made.source.audio.names;
            engine.audioOrder = made.source.audio.order;
            return facade;
        }
    };
    window.VenomPlayer.make(options);
    const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
    return {
        fetched, emitted, engine, names: options.source.audio.names,
        // The engine reports its tracks: Venom builds the list and plays its default.
        buildList() { engine.transformAudioList(names.map((_, index) => String(index + 1))); engine.audio = 0; },
        async answerManifest() { answer(); await flush(); },
        play() { (events.timeupdate || []).splice(0).forEach(handler => handler.call(internal)); }
    };
}

test('the Avengers names move onto the tracks of their language', async () => {
    const h = await harness({ names: [...AVENGERS_NAMES], tracks: AVENGERS_TRACKS });
    assert.deepEqual(h.fetched, ['https://cdn.example/master.m3u8']);
    await h.answerManifest();
    assert.deepEqual(h.names, ['Eng.Original', 'Дорожка 2 (en)', 'Рус. Дублированный', 'Ю. Сербин'],
        'the dub sits on the Russian file; Ukrainian has no file and is dropped');
    h.buildList();
    h.play();
    h.engine.audio = h.engine.audioList.indexOf('Рус. Дублированный');
    assert.equal(h.engine.originalAudio, 2, '«Рус. Дублированный» plays the Russian file');
    assert.equal(h.emitted.length, 0, 'a list built after the fix needs no rebuild');
});

test('a list Venom built before the manifest came is rebuilt and the believed track is asked for again', async () => {
    const h = await harness({ names: [...AVENGERS_NAMES], tracks: AVENGERS_TRACKS });
    h.buildList();
    assert.equal(h.engine.originalAudio, 0, 'Venom plays file 0 as «Рус. Дублированный»');
    h.play();
    await h.answerManifest();
    assert.equal(h.emitted.length, 1);
    assert.equal(h.emitted[0][0], 'audioList');
    assert.deepEqual(h.emitted[0][1], ['Eng.Original', 'Дорожка 2 (en)', 'Рус. Дублированный', 'Ю. Сербин']);
    assert.equal(h.engine.originalAudio, 2, 'the Russian dub now plays');
});

test('names that agree with their tracks stay as they are', async () => {
    const names = ['Рус. Дублированный', 'Омикрон', 'Ю. Сербин', 'Укр. Дубльований', 'Eng.Original'];
    const h = await harness({ names: [...names], tracks: [['rus0', 'ru'], ['rus1', 'ru'], ['rus2', 'ru'], ['ukr3', 'uk'], ['eng4', 'en']] });
    await h.answerManifest();
    assert.deepEqual(h.names, names);
});

test('tags that say nothing, one stray tag or a failed manifest change nothing', async () => {
    const allRussian = await harness({ names: ['Рус. Дублированный', 'Eng.Original'], tracks: [['rus0', 'ru'], ['rus1', 'ru']] });
    await allRussian.answerManifest();
    assert.deepEqual(allRussian.names, ['Рус. Дублированный', 'Eng.Original']);

    const stray = await harness({ names: ['Рус. Дублированный', 'Укр. Дубльований', 'Eng.Original'], tracks: [['rus0', 'ru'], ['eng1', 'en'], ['eng2', 'en']] });
    await stray.answerManifest();
    assert.deepEqual(stray.names, ['Рус. Дублированный', 'Укр. Дубльований', 'Eng.Original']);

    const failed = await harness({ names: [...AVENGERS_NAMES], tracks: AVENGERS_TRACKS, fetchOk: false });
    await failed.answerManifest();
    assert.deepEqual(failed.names, AVENGERS_NAMES);
});

test('a different number of names and tracks is left to Venom', async () => {
    const h = await harness({ names: ['Рус. Дублированный', 'Eng.Original'], tracks: AVENGERS_TRACKS });
    await h.answerManifest();
    assert.deepEqual(h.names, ['Рус. Дублированный', 'Eng.Original']);
});
