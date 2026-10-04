import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SeasonvarParser } from '../src/shared/services/parsers/SeasonvarParser.js';

test('SeasonvarParser parses translations when default translation is defined as var pl = {"0": ...}', async () => {
    const sampleHtml = `
        <html>
        <head><title>Modern Family Season 6</title></head>
        <body>
            <div id="player_wrap">
                <script>
                    var pl = {'0': "/playls2/hash123/trans/10449/plist.txt?time=1789775811"};
                </script>
                <ul class="pgs-trans">
                    <li data-click="translate" data-translate="0" data-translate-percent="85.46" class="act">Стандартный</li>
                    <li data-click="translate" data-translate="1" data-translate-percent="14.5">Субтитры</li>
                    <script>pl[1] = "/playls2/hash123/trans%D0%A1%D1%83%D0%B1%D1%82%D0%B8%D1%82%D1%80%D1%8B/10449/plist.txt?time=1789775811";</script>
                    <li data-click="translate" data-translate="68">Трейлеры</li>
                    <script>pl[68] = "/playls2/hash123/trans%D0%A2%D1%80%D0%B5%D0%B9%D0%BB%D0%B5%D1%80%D1%8B/10449/plist.txt?time=1789775811";</script>
                </ul>
            </div>
            <div class="pgs-seaslist">
                <h2>6 сезон</h2>
            </div>
        </body>
        </html>
    `;

    const dom = new JSDOM(sampleHtml, { url: 'http://seasonvar.ru/serial-10449-Modern_Family-6-season.html' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.DOMParser = dom.window.DOMParser;

    const parser = new SeasonvarParser();
    parser.getSeasonvarPage = async (url) => {
        return {
            url,
            html: sampleHtml,
            doc: dom.window.document
        };
    };

    parser._fetchPlaylist = async (url) => {
        return [
            { "title": "1 серия SD/FullHD<br>LostFilm", "file": "//cdn.example.com/s06e01.mp4" },
            { "title": "2 серия SD/FullHD<br>LostFilm", "file": "//cdn.example.com/s06e02.mp4" }
        ];
    };

    const seriesInfo = await parser.getSeriesInfoUncached('http://seasonvar.ru/serial-10449-Modern_Family-6-season.html');
    assert.ok(seriesInfo, 'seriesInfo should exist');
    assert.ok(seriesInfo.translations, 'translations should exist');
    assert.equal(seriesInfo.translations.length, 2, 'Should extract 2 translations (Стандартный and Субтитры, ignoring Трейлеры)');
    
    const standard = seriesInfo.translations.find(t => t.id === '0');
    assert.ok(standard, 'Standard translation should be extracted');
    assert.ok(standard.name.includes('LostFilm') || standard.name.includes('Стандартный'), 'Should preserve translation name');
    assert.equal(standard.url, 'http://seasonvar.ru/playls2/hash123/trans/10449/plist.txt?time=1789775811');

    const subs = seriesInfo.translations.find(t => t.id === '1');
    assert.ok(subs, 'Subtitles translation should be extracted');
    assert.equal(subs.name, 'Субтитры');
    assert.ok(subs.url.includes('trans%D0%A1%D1%83%D0%B1%D1%82%D0%B8%D1%82%D1%80%D1%8B'));

    // Test renderPlayer DOM output contains #seasonvar-voiceover-source
    const playerDom = new JSDOM('<!DOCTYPE html><div id="player-container"></div>');
    const container = playerDom.window.document.getElementById('player-container');
    global.window = playerDom.window;
    global.document = playerDom.window.document;

    const sources = [
        { title: '1 серия', url: 'http://cdn.example.com/s06e01.mp4', episodeNumber: 1, seasonNumber: 6 }
    ];
    sources.translations = seriesInfo.translations;

    await parser.renderPlayer(container, sources, {
        season: 6,
        episode: 1,
        translations: seriesInfo.translations
    });

    const bridge = container.querySelector('#seasonvar-voiceover-source');
    assert.ok(bridge, '#seasonvar-voiceover-source must be rendered in DOM');
    const items = bridge.querySelectorAll('.seasonvar-voiceover-item');
    assert.equal(items.length, 2, 'Should render 2 voiceover items in bridge');
    assert.ok(items[0].textContent.includes('LostFilm') || items[0].textContent.includes('Стандартный'));
    assert.ok(items[1].textContent.includes('Субтитры'));
});
