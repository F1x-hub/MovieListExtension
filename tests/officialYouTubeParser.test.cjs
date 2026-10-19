const assert = require('node:assert/strict');
const { test } = require('node:test');

global.BaseParserService = class { constructor(options) { Object.assign(this, options); } };
global.Utils = require('../src/shared/utils/Utils.js');
const OfficialYouTubeParser = require('../src/shared/services/parsers/OfficialYouTubeParser.js');

const video = (videoId, title, channel, length, verified = true) => ({
    videoRenderer: {
        videoId,
        title: { runs: [{ text: title }] },
        ownerText: { runs: [{ text: channel }] },
        ownerBadges: verified ? [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_VERIFIED' } }] : [],
        lengthText: { simpleText: length }
    }
});
const page = items => `<script>var ytInitialData = ${JSON.stringify({ contents: { list: items } })};</script>`;

test('only verified studio uploads of feature length are accepted', () => {
    const parser = new OfficialYouTubeParser();
    const videos = OfficialYouTubeParser.extractVideos(page([
        video('AAAAAAAAAAA', 'Бриллиантовая рука (реж. Гайдай, 1968 г.)', 'Mosfilm', '1:34:00', false),
        video('BBBBBBBBBBB', 'Бриллиантовая рука — лучшие моменты', 'Киноконцерн "Мосфильм"', '12:10'),
        video('CCCCCCCCCCC', 'Бриллиантовая рука (4К, комедия, 1968 г.)', 'Киноконцерн "Мосфильм"', '1:34:12')
    ]));
    assert.equal(videos.length, 3);
    assert.equal(parser._pickBest(videos, 'Бриллиантовая рука', 1968).videoId, 'CCCCCCCCCCC');
});

test('remakes with another year and unrelated titles are rejected', () => {
    const parser = new OfficialYouTubeParser();
    const videos = OfficialYouTubeParser.extractVideos(page([
        video('DDDDDDDDDDD', 'Ирония судьбы. Продолжение (2007 г.)', 'Киноконцерн "Мосфильм"', '1:53:00'),
        video('EEEEEEEEEEE', 'Служебный роман (1977 г.)', 'Киноконцерн "Мосфильм"', '2:39:00')
    ]));
    assert.equal(parser._pickBest(videos, 'Ирония судьбы, или С лёгким паром!', 1975), null);
});

test('a complete upload wins over «1 серия» of a two-part film', () => {
    const parser = new OfficialYouTubeParser();
    const videos = OfficialYouTubeParser.extractVideos(page([
        video('FFFFFFFFFFF', 'Москва слезам не верит, 1 серия (1979 г.)', 'Киноконцерн "Мосфильм"', '1:21:00'),
        video('GGGGGGGGGGG', 'Москва слезам не верит (1979 г.)', 'Киноконцерн "Мосфильм"', '2:20:00')
    ]));
    assert.equal(parser._pickBest(videos, 'Москва слезам не верит', 1979).videoId, 'GGGGGGGGGGG');
});

test('series are not offered; durations parse', async () => {
    const parser = new OfficialYouTubeParser();
    assert.equal(parser.supportsMedia({ type: 'tv-series' }), false);
    assert.equal(parser.supportsMedia({ type: 'movie' }), true);
    assert.equal(OfficialYouTubeParser.parseDuration('1:34:12'), 5652);
    const [source] = await parser.getVideoSources({ videoId: 'CCCCCCCCCCC', channelName: 'Мосфильм' });
    assert.equal(source.type, 'iframe');
    assert.match(source.url, /CCCCCCCCCCC/);
});
