const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BaseParserService } = require('../src/shared/services/parsers/BaseParserService');

class Scripted extends BaseParserService {
    constructor(result) { super({ id: 'scripted', name: 'scripted', baseUrl: 'https://provider.test' }); this.result = result; }
    async search() { return this.result; }
}
const quiet = fn => { const info = console.info; console.info = () => {}; try { return fn(); } finally { console.info = info; } };

test('a remake with the same title but another year is not «that movie»', async () => {
    const remake = new Scripted({ url: 'u', title: 'Король Лев', year: '2019' });
    assert.equal(await quiet(() => remake.cachedSearch('Король Лев', 1994)), null);
    const original = new Scripted({ url: 'u', title: 'Король Лев', year: '1994' });
    assert.equal((await original.cachedSearch('Король Лев', 1994))?.url, 'u');
    const offByOne = new Scripted({ url: 'u', title: 'Дюна', year: '2022' });
    assert.ok(await offByOne.cachedSearch('Дюна', 2021), 'release-year drift of one year is fine');
});

test('an unrelated title is rejected; Russian or original title variants are accepted', async () => {
    assert.equal(await quiet(() => new Scripted({ url: 'u', title: 'Мама, я дома', year: '2020' }).cachedSearch('Мама', 2020)), null);
    assert.ok(await new Scripted({ url: 'u', title: 'Начало / Inception', year: '2010' })
        .cachedSearch('Inception', 2010, { altName: 'Inception' }));
    assert.ok(await new Scripted({ url: 'u', title: 'Inception', year: '2010' })
        .cachedSearch('Начало', 2010, { altName: 'Inception' }), 'original title matches');
});

test('series may carry later years; self-verified parsers keep their own title rules', async () => {
    assert.ok(await new Scripted({ url: 'u', title: 'Ведьмак 3 сезон', year: '2023' })
        .cachedSearch('Ведьмак', 2019, { mediaType: 'tv-series' }));
    assert.ok(await new Scripted({ url: 'u', title: 'Бриллиантовая рука (4К, реж. Гайдай)', titleVerified: true })
        .cachedSearch('Бриллиантовая рука', 1968));
});
