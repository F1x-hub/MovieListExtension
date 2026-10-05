import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

console.log('🧪 Running parser search matching tests...');

const read = name => fs.readFileSync(
    new URL(`../src/shared/services/parsers/${name}.js`, import.meta.url),
    'utf8'
);

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'chrome-extension://extension-id/src/pages/movie-details/movie-details.html'
});
const storageData = { kinogo_active_mirror: 'https://b.test' };
const context = vm.createContext({
    console,
    window: {},
    fetch: null,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    DOMParser: dom.window.DOMParser,
    chrome: {
        storage: {
            local: {
                get: (keys, callback) => {
                    const result = {};
                    keys.forEach(key => { result[key] = storageData[key]; });
                    setTimeout(() => callback(result), 5);
                },
                set: (items, callback) => {
                    Object.assign(storageData, items);
                    callback?.();
                }
            }
        }
    }
});
for (const name of ['BaseParserService', 'KinogoParser', 'ExFsParser', 'SeasonvarParser']) {
    vm.runInContext(read(name), context);
}
const { BaseParserService, KinogoParser, ExFsParser, SeasonvarParser } = context.window;

const delay = (ms, value) => new Promise(resolve => setTimeout(() => resolve(value), ms));

(async () => {
    // ─── Shared whole-word title matching (item 5) ─────────────────────
    const exfs = new ExFsParser();
    assert.equal(exfs.isTitleMatch('Домовёнок Кузя', 'Дом'), false, 'a word prefix is not a title match');
    assert.equal(exfs.isTitleMatch('Джон Уик 3', 'Джон Уик'), false, 'a sequel must not match the first film');
    assert.equal(exfs.isTitleMatch('Джон Уик', 'Джон Уик 3'), false, 'the first film must not match a sequel');
    assert.equal(exfs.isTitleMatch('Матрица (1999)', 'Матрица'), true, 'a bracketed year is ignored');
    assert.equal(exfs.isTitleMatch('Ёлки 2', 'Елки 2'), true, 'ё and е are equivalent');
    assert.equal(exfs.isTitleMatch('Матрица / The Matrix', 'Матрица'), true);
    assert.equal(BaseParserService.compactTitle('Ёлки'), BaseParserService.compactTitle('Елки'));

    // ─── Ex-FS ranking, year rejection and URL resolution (items 5, 6) ─
    const exfsHtml = `<div id="dle-content">
        <div class="SeaRchresultPost"><div class="SeaRchresultPostTitle"><a href="/film/1-dom.html">Домовёнок</a></div><div class="SeaRchresultPostInfo">2019</div></div>
        <div class="SeaRchresultPost"><div class="SeaRchresultPostTitle"><a href="/film/2-dom-2.html">Дом 2</a></div><div class="SeaRchresultPostInfo">2020</div></div>
        <div class="SeaRchresultPost"><div class="SeaRchresultPostTitle"><a href="/film/3-dom.html">Дом</a></div><div class="SeaRchresultPostInfo">2011</div></div>
        <div class="SeaRchresultPost"><div class="SeaRchresultPostTitle"><a href="/film/4-dom.html">Дом</a></div><div class="SeaRchresultPostInfo">2016</div></div>
    </div>`;
    const exfsBest = exfs.parseSearchResults(exfsHtml, 'Дом', '2016');
    assert.equal(exfsBest?.url, 'https://ex-fs.net/film/4-dom.html',
        'the same-year exact title wins and relative links resolve against the provider');

    const remakeHtml = `<div id="dle-content">
        <div class="SeaRchresultPost"><div class="SeaRchresultPostTitle"><a href="https://ex-fs.net/film/5.html">Король Лев: Возвращение</a></div><div class="SeaRchresultPostInfo">1998</div></div>
    </div>`;
    assert.equal(exfs.parseSearchResults(remakeHtml, 'Король Лев', '2019'), null,
        'a non-exact title with a diverging year is rejected');

    // ─── Kinogo: ambiguous card text years (item 5) ────────────────────
    const kinogo = new KinogoParser({ mirrors: ['https://a.test', 'https://b.test'] });
    assert.equal(kinogo.extractUnambiguousYear('Матрица, 1999, США'), '1999');
    assert.equal(kinogo.extractUnambiguousYear('Матрица 1999 · обновлено 2024'), null);
    assert.equal(kinogo.extractUnambiguousYear('Просмотров: 12019'), null);

    // ─── Kinogo: saved mirror is read before the first search (item 6) ─
    await kinogo._activeMirrorReady;
    assert.equal(kinogo.getMirrors()[0], 'https://b.test', 'the stored mirror leads the mirror order');

    // ─── Kinogo: race no longer depends on response order (item 4) ─────
    const raceParser = (responses, options = {}) => {
        const parser = new KinogoParser({
            mirrors: ['https://a.test', 'https://b.test'],
            mirrorHedgeDelayMs: 5,
            mirrorFallbackGraceMs: 300,
            ...options
        });
        parser._activeMirrorReady = Promise.resolve();
        parser._activeMirror = 'https://a.test';
        parser._saveActiveMirror = mirror => { parser.savedMirror = mirror; };
        parser._searchMirror = mirror => responses[mirror]();
        return parser;
    };

    // Both mirrors return only weak matches; the slower priority mirror wins.
    const weak = raceParser({
        'https://a.test': () => delay(60, { title: 'Матрица', year: '2003', url: 'https://a.test/m.html' }),
        'https://b.test': () => delay(10, { title: 'Матрица', year: '2006', url: 'https://b.test/m.html' })
    });
    const weakResult = await weak.search('Матрица', 1999);
    assert.equal(weakResult.url, 'https://a.test/m.html', 'the priority mirror\'s weak match is preferred');
    assert.equal(weak.savedMirror, 'https://a.test');

    // A confident match ends the race at once, even from a later mirror.
    const startedAt = Date.now();
    const confident = raceParser({
        'https://a.test': () => delay(250, { title: 'Матрица', year: '2003', url: 'https://a.test/m.html' }),
        'https://b.test': () => delay(10, { title: 'Матрица', year: '1999', url: 'https://b.test/m.html' })
    });
    const confidentResult = await confident.search('Матрица', 1999);
    assert.equal(confidentResult.url, 'https://b.test/m.html');
    assert(Date.now() - startedAt < 200, 'a confident match must not wait for slower mirrors');

    // A weak match is not held longer than the grace period.
    const graceStartedAt = Date.now();
    const grace = raceParser({
        'https://a.test': () => delay(10, { title: 'Матрица', year: '2003', url: 'https://a.test/m.html' }),
        'https://b.test': () => delay(2000, null)
    }, { mirrorFallbackGraceMs: 50 });
    assert.equal((await grace.search('Матрица', 1999)).url, 'https://a.test/m.html');
    assert(Date.now() - graceStartedAt < 1000, 'the grace period bounds a weak match');

    assert.equal(kinogo.isConfidentSearchMatch({ title: 'Джек Ричер 2 сезон', year: '2023' }, 'Джек Ричер', '2023', {
        mediaType: 'tv-series',
        seasonNumber: 2
    }), true, 'a series title with the requested season is confident');
    assert.equal(kinogo.isConfidentSearchMatch({ title: 'Матрица', year: null }, 'Матрица', '1999'), false,
        'an unknown year is not confident when a year is requested');

    // ─── Seasonvar: searchBestMatch shares the search cache (item 6) ───
    const seasonvar = new SeasonvarParser();
    let searches = 0;
    seasonvar.search = async (title, _year, options) => {
        searches += 1;
        return { url: 'https://seasonvar.ru/serial-1.html', title, altName: options.altName };
    };
    const background = await seasonvar.cachedSearch('Ричер', 2022, { mediaType: 'tv-series', altName: 'Reacher' });
    const clicked = await seasonvar.searchBestMatch('Ричер', 'Reacher', 2022, { mediaType: 'tv-series' });
    assert.equal(searches, 1, 'background discovery and the source click share one Seasonvar search');
    assert.equal(clicked, background);
    assert.equal(clicked.altName, 'Reacher', 'the alternative title reaches Seasonvar ranking');

    // ─── Missing Venom embeds are dropped before mounting ──────────────
    const embedParser = new ExFsParser();
    const checked = [];
    embedParser.fetchWithTimeout = async url => {
        checked.push(url);
        if (url.includes('/kp/662551')) return { status: 404, body: null };
        if (url.includes('/kp/500')) throw new Error('network down');
        return { status: 200, body: null };
    };
    embedParser.getVideoSources = async () => [
        { name: 'Ex-FS', url: 'https://api.variyt.ws/embed/kp/662551', type: 'iframe' },
        { name: 'Ex-FS', url: 'https://api.variyt.ws/embed/kp/500', type: 'iframe' },
        { name: 'Ex-FS', url: 'https://api.variyt.ws/embed/kp/301', type: 'iframe' },
        { name: 'Other', url: 'https://other.test/embed/kp/662551', type: 'iframe' },
        { name: 'Signed', url: 'https://cinemar.cc/embed/1?token=abc', type: 'iframe' }
    ];
    const kept = await embedParser.cachedVideoSources({ url: 'https://ex-fs.net/film/50750-helter-skelter.html' });
    assert.deepEqual(kept.map(source => source.url), [
        'https://api.variyt.ws/embed/kp/500',
        'https://api.variyt.ws/embed/kp/301',
        'https://other.test/embed/kp/662551',
        'https://cinemar.cc/embed/1?token=abc'
    ], 'only a Venom embed answering 404 is dropped; errors keep the source');
    assert.equal(checked.length, 3, 'only unsigned Venom embeds are pre-checked');

    embedParser.clearCache();
    embedParser.getVideoSources = async () => [
        { name: 'Ex-FS', url: 'https://api.variyt.ws/embed/kp/662551', type: 'iframe' }
    ];
    const none = await embedParser.cachedVideoSources({ url: 'https://ex-fs.net/film/50750-helter-skelter.html' });
    assert.equal(none.length, 0, 'a film without any playable embed reports no sources');

    console.log('✅ Parser search matching tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
