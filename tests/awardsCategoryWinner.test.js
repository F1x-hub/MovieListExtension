/**
 * AwardsParsingService: nomination category links and ceremony winner parsing.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('');
const context = vm.createContext({
    window: {},
    DOMParser: dom.window.DOMParser,
    console: { log() {}, warn() {}, error() {} },
    fetch: (...args) => context.__fetch(...args)
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/shared/services/AwardsParsingService.js'), 'utf8'), context);
const AwardsParsingService = context.window.AwardsParsingService;

const filmAwardsHtml = `
<table cellspacing="0"><tr><td class="news"><b><a href="/awards/oscar/2018/">Оскар, 2018 год</a></b></td></tr>
<tr><td class="news">Победитель</td></tr>
<tr><td><ul class="trivia"><li class="trivia"><a class="all" href="/awards/oscar/2018/#nom1847">Лучшая работа оператора</a></li></ul></td></tr>
<tr><td class="news">Номинации</td></tr>
<tr><td><ul class="trivia"><li class="trivia"><a class="all" href="/awards/oscar/2018/#nom1850">Лучший звук</a></li></ul></td></tr>
</table>`;

const ceremonyHtml = `
<table id="itemList">
<tr><td class="news"><a name="nom1840"></a><b>Лучшая мужская роль</b></td></tr>
<tr><td class="awardCol1"></td><td class="awardCol2"><b><a class="all" href="/name/6650/">Гари Олдман</a>&nbsp;—&nbsp;<a class="all" href="/film/972777/">Темные времена</a></b><br><span>Gary Oldman — Darkest Hour</span></td></tr>
<tr><td colspan="2"><table><tr><td class="news">Номинанты:</td></tr><tr><td><ul class="trivia">
<li class="trivia"><a href="/name/1113516/" class="all">Дэниэл Калуя</a>&nbsp;—&nbsp;<a href="/film/944708/" class="all">Прочь</a><br><span>Daniel Kaluuya — Get Out</span></li>
</ul></td></tr></table></td></tr>
<tr><td class="news"><a name="nom1850"></a><b>Лучший звук</b></td></tr>
<tr><td class="awardCol1"></td><td class="awardCol2"><b><a class="all" href="/film/931677/">Дюнкерк</a></b></td></tr>
<tr><td colspan="2"><table><tr><td class="news">Номинанты:</td></tr><tr><td><ul class="trivia">
<li class="trivia"><a href="/film/589290/" class="all">Бегущий по лезвию 2049</a><br><span>Blade Runner 2049</span></li>
</ul></td></tr></table></td></tr>
</table>`;

(async () => {
    const parser = new AwardsParsingService();
    const awards = parser.parseAwardsPage(filmAwardsHtml);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(awards.map(a => [a.nominationName, a.nominationUrl, a.win]))), [
        ['Лучшая работа оператора', '/awards/oscar/2018/#nom1847', true],
        ['Лучший звук', '/awards/oscar/2018/#nom1850', false]
    ], 'nominations keep their ceremony category link');

    const plain = (value) => JSON.parse(JSON.stringify(value));
    const categories = plain(parser.parseCeremonyWinners(ceremonyHtml));
    assert.deepStrictEqual(categories.nom1850, {
        winner: { label: 'Дюнкерк', person: null, filmIds: ['931677'] },
        nominees: [{ label: 'Бегущий по лезвию 2049', person: null, filmIds: ['589290'] }]
    }, 'film-only category keeps winner and nominee films');
    assert.deepStrictEqual(categories.nom1840, {
        winner: { label: 'Гари Олдман — Темные времена', person: 'Гари Олдман', filmIds: ['972777'] },
        nominees: [{ label: 'Дэниэл Калуя — Прочь', person: 'Дэниэл Калуя', filmIds: ['944708'] }]
    }, 'person categories expose the person and drop the English subtitle');

    let fetches = 0;
    context.__fetch = async (url) => {
        fetches += 1;
        assert.strictEqual(url, 'https://www.kinopoisk.ru/awards/oscar/2018/');
        return { ok: true, text: async () => ceremonyHtml };
    };
    assert.strictEqual((await parser.getCategoryInfo('/awards/oscar/2018/#nom1850')).winner.label, 'Дюнкерк');
    assert.strictEqual((await parser.getCategoryInfo('/awards/oscar/2018/#nom1840')).winner.person, 'Гари Олдман');
    assert.strictEqual(fetches, 1, 'one ceremony page is fetched once for all its categories');
    assert.strictEqual(await parser.getCategoryInfo('/film/1/'), null, 'non-category links are ignored');

    console.info('✅ awardsCategoryWinner: links, ceremony winners, and per-ceremony caching verified');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
