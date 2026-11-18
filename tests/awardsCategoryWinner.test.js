/**
 * AwardsParsingService: every ceremony on a Kinopoisk awards page, the people and films
 * a category went to, person pages and their cache, and the ceremony winner lookup.
 * The markup follows the real pages (/film/258687/awards/, /name/37859/awards/).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('');
const storage = new Map();
const context = vm.createContext({
    window: {},
    DOMParser: dom.window.DOMParser,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: (...args) => context.__fetch(...args),
    chrome: {
        storage: {
            local: {
                async get(key) { return storage.has(key) ? { [key]: structuredClone(storage.get(key)) } : {}; },
                async set(values) { Object.entries(values).forEach(([key, value]) => storage.set(key, structuredClone(value))); },
                async remove(keys) { [].concat(keys).forEach(key => storage.delete(key)); }
            }
        }
    }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/shared/services/AwardsParsingService.js'), 'utf8'), context);
const AwardsParsingService = context.window.AwardsParsingService;
const plain = (value) => JSON.parse(JSON.stringify(value));

const ceremonyTable = (path, title, sections) => `
<table cellspacing="0" cellpadding="0" border="0" width="100%">
<tr><td height="40" class="news"><b><a href="${path}" class="all">${title}</a></b></td>
<td align="center" width="80" rowspan="6" valign="top"><a href="${path}"><img src="https://st.kp.yandex.net/images/award-small.jpg"></a></td></tr>
${sections.map(([label, items]) => `
<tr><td class="news" style="padding: 10px; color: #777"><b>${label}</b> (${items.length}):</td></tr>
<tr><td class="news" style="padding: 10px; padding-left: 50px"><ul class="trivia">
${items.map(item => `<li class="trivia">${item}</li>`).join('\n')}
</ul></td></tr>`).join('')}
<tr><td class="news">&nbsp;</td></tr>
</table>`;

// The page wraps every ceremony in layout tables; they must not be read as ceremonies.
const filmAwardsHtml = `<html><body><table cellspacing="0"><tr><td><table cellspacing="0"><tr><td>
${ceremonyTable('/awards/oscar/2015/', 'Оскар, 2015 год', [
        ['<font color="#ff6600"><b>Победитель</b></font>', ["<a href='/awards/oscar/2015/#nom1853' class='all'>Лучшие визуальные эффекты</a>"]],
        ['Номинации', ["<a href='/awards/oscar/2015/#nom1850' class='all'>Лучший звук</a>", "<a href='/awards/oscar/2015/#nom1856' class='all'>Лучший саундтрек</a>"]]
    ])}
${ceremonyTable('/awards/bafta/2015/', 'Британская академия, 2015 год', [
        ['Номинации', [
            "<a href='/awards/bafta/2015/#nom1779' class='all'>Лучшая работа оператора</a>\n(<a href=\"/name/758887/\" class=\"all\">Хойте Ван Хойтема</a>)",
            "<a href='/awards/bafta/2015/#nom1786' class='all'>Лучшая работа художника-постановщика</a>\n(<a href=\"/name/1642584/\" class=\"all\">Нэйтан Краули</a>, <a href=\"/name/1986331/\" class=\"all\">Гари Феттис</a>)"
        ]]
    ])}
${ceremonyTable('/awards/georges/2015/', 'Жорж, 2015 год', [
        ['Номинации', ["<a href='/awards/sag/2016/#nom2802' class='all'>Лучший зарубежный актер</a>"]]
    ])}
${ceremonyTable('/awards/saturn/2015/', 'Сатурн, 2015 год', [
        ['<b>Победитель</b>', ["<a href='/awards/saturn/2015/#nom1938' class='all'>Лучший научно-фантастический фильм</a>"]],
        ['Номинации', ["<a href='/awards/saturn/2015/#nom1930' class='all'>Лучший режиссер</a> (<a href=\"/name/41477/\" class=\"all\">Кристофер Нолан</a>)"]]
    ])}
</td></tr></table></td></tr></table></body></html>`;

const personAwardsHtml = `<html><head><title>Леонардо ДиКаприо — награды и кинопремии — Кинопоиск</title></head><body>
${ceremonyTable('/awards/oscar/2016/', 'Оскар, 2016 год', [
        ['Победитель', ["<a href='/awards/oscar/2016/#nom1840' class='all'>Лучшая мужская роль</a>\n(<a href=\"/film/499327/\" class=\"all\" style=\"color: #333\">«Выживший»</a>)"]]
    ])}
${ceremonyTable('/awards/sag/2024/', 'Премия Гильдии актеров, 2024 год', [
        ['Номинации', ["<a href='/awards/sag/2024/#nom2817' class='all'>Лучший актерский состав</a>\n(<a href=\"/film/1077781/\" class=\"all\">«Убийцы цветочной луны»</a>)"]]
    ])}
</body></html>`;

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
    assert.strictEqual(AwardsParsingService.SCHEMA_VERSION, 2, 'schema 2 marks awards that keep every ceremony');

    // Film page: every ceremony, sections, people.
    const awards = plain(parser.parseAwardsPage(filmAwardsHtml));
    assert.deepStrictEqual([...new Set(awards.map(a => a.slug))], ['oscar', 'bafta', 'georges', 'saturn'],
        'every ceremony on the page is kept, not only the Oscar and the Golden Globe');
    assert.deepStrictEqual(awards.filter(a => a.slug === 'oscar').map(a => [a.nominationName, a.nominationUrl, a.win, a.year]), [
        ['Лучшие визуальные эффекты', '/awards/oscar/2015/#nom1853', true, 2015],
        ['Лучший звук', '/awards/oscar/2015/#nom1850', false, 2015],
        ['Лучший саундтрек', '/awards/oscar/2015/#nom1856', false, 2015]
    ], 'winners and nominations keep their section, year and category link');
    const art = awards.find(a => a.nominationName === 'Лучшая работа художника-постановщика');
    assert.strictEqual(art.name, 'Британская академия');
    assert.strictEqual(art.ceremonyPath, '/awards/bafta/2015/');
    assert.deepStrictEqual(art.recipients, [
        { name: 'Нэйтан Краули', kinopoiskId: 1642584 },
        { name: 'Гари Феттис', kinopoiskId: 1986331 }
    ], 'the people a category went to are read with their Kinopoisk IDs');
    assert.deepStrictEqual(art.films, [], 'a film page names no films');
    const georges = awards.find(a => a.slug === 'georges');
    assert.strictEqual(georges.nominationName, 'Лучший зарубежный актер');
    assert.strictEqual(georges.nominationUrl, null, 'an anchor of another ceremony is not kept as the category link');
    assert.deepStrictEqual(awards.find(a => a.nominationName === 'Лучший режиссер').recipients, [{ name: 'Кристофер Нолан', kinopoiskId: 41477 }]);
    assert.strictEqual(awards.length, 8, 'layout tables add nothing and nothing is counted twice');
    assert.deepStrictEqual(plain(parser.parseAwardsPage('')), [], 'an empty page has no awards');

    // Person page: the film of every row.
    const personAwards = plain(parser.parseAwardsPage(personAwardsHtml));
    assert.deepStrictEqual(personAwards.map(a => [a.slug, a.year, a.nominationName, a.win, a.films]), [
        ['oscar', 2016, 'Лучшая мужская роль', true, [{ title: 'Выживший', kinopoiskId: 499327 }]],
        ['sag', 2024, 'Лучший актерский состав', false, [{ title: 'Убийцы цветочной луны', kinopoiskId: 1077781 }]]
    ], 'a person page names the film of every award, without the quotes');

    // Fetching: the film page, then the person page and its cache.
    const requested = [];
    context.__fetch = async (url) => {
        requested.push(url);
        if (url.endsWith('/film/258687/awards/')) return { ok: true, text: async () => filmAwardsHtml };
        if (url.endsWith('/name/37859/awards/')) return { ok: true, text: async () => personAwardsHtml };
        if (url.endsWith('/name/1/awards/')) return { ok: true, text: async () => '<html><body>captcha</body></html>' };
        if (url.endsWith('/name/2/awards/')) return { ok: false, status: 503, text: async () => '' };
        if (url === 'https://www.kinopoisk.ru/awards/oscar/2018/') return { ok: true, text: async () => ceremonyHtml };
        throw new Error(`unexpected ${url}`);
    };
    assert.strictEqual((await parser.getAwards(258687)).length, 8, 'getAwards reads the film page');
    assert.deepStrictEqual(plain(await parser.getAwards('abc')), [], 'an invalid movie ID is not requested');

    const first = await parser.getPersonAwards(37859);
    assert.strictEqual(first.length, 2);
    const second = await parser.getPersonAwards('37859');
    assert.strictEqual(second.length, 2);
    assert.strictEqual(requested.filter(url => url.endsWith('/name/37859/awards/')).length, 1, 'a person page is read once and then kept');
    assert.deepStrictEqual(storage.get('kp_person_awards_v1_index'), [37859], 'the cache keeps an index of people');
    assert.strictEqual(await parser.getPersonAwards(1), null, 'a page without the awards layout is not an answer');
    assert.strictEqual(await parser.getPersonAwards(2), null, 'a failed load is not an answer');
    assert.ok(!storage.has('kp_person_awards_v1_1') && !storage.has('kp_person_awards_v1_2'), 'failed loads are not kept');
    const entry = storage.get('kp_person_awards_v1_37859');
    storage.set('kp_person_awards_v1_37859', { ...entry, savedAt: Date.now() - AwardsParsingService.PERSON_CACHE_TTL_MS - 1 });
    await parser.getPersonAwards(37859);
    assert.strictEqual(requested.filter(url => url.endsWith('/name/37859/awards/')).length, 2, 'an entry older than a week is read again');

    for (let id = 100; id < 100 + AwardsParsingService.PERSON_CACHE_LIMIT + 2; id += 1) await parser.writePersonCache(id, []);
    const index = storage.get('kp_person_awards_v1_index');
    assert.strictEqual(index.length, AwardsParsingService.PERSON_CACHE_LIMIT, 'the person cache stays bounded');
    assert.ok(!storage.has('kp_person_awards_v1_37859') && !storage.has('kp_person_awards_v1_100'), 'the oldest entries are removed');

    const aborted = new AbortController();
    aborted.abort();
    assert.strictEqual(await new AwardsParsingService().getPersonAwards(555, { signal: aborted.signal }), null, 'an aborted page asks for nothing');

    // Ceremony pages: who won each category.
    const categories = plain(parser.parseCeremonyWinners(ceremonyHtml));
    assert.deepStrictEqual(categories.nom1850, {
        winner: { label: 'Дюнкерк', person: null, filmIds: ['931677'] },
        nominees: [{ label: 'Бегущий по лезвию 2049', person: null, filmIds: ['589290'] }]
    }, 'film-only category keeps winner and nominee films');
    assert.deepStrictEqual(categories.nom1840, {
        winner: { label: 'Гари Олдман — Темные времена', person: 'Гари Олдман', filmIds: ['972777'] },
        nominees: [{ label: 'Дэниэл Калуя — Прочь', person: 'Дэниэл Калуя', filmIds: ['944708'] }]
    }, 'person categories expose the person and drop the English subtitle');

    const before = requested.length;
    assert.strictEqual((await parser.getCategoryInfo('/awards/oscar/2018/#nom1850')).winner.label, 'Дюнкерк');
    assert.strictEqual((await parser.getCategoryInfo('/awards/oscar/2018/#nom1840')).winner.person, 'Гари Олдман');
    assert.strictEqual(requested.length - before, 1, 'one ceremony page is fetched once for all its categories');
    assert.strictEqual(await parser.getCategoryInfo('/film/1/'), null, 'non-category links are ignored');

    console.info('✅ awardsCategoryWinner: every ceremony, people, films, person cache, and ceremony winners verified');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
