const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BaseParserService } = require('../src/shared/services/parsers/BaseParserService');
const { ExFsAdapter } = require('../src/shared/services/player/adapters/ExFsAdapter');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');

const registrySource = fs.readFileSync(
    path.join(__dirname, '../src/shared/services/parsers/ParserRegistry.js'),
    'utf8'
);
const registryContext = { BaseParserService, window: {}, console };
registryContext.globalThis = registryContext;
vm.createContext(registryContext);
new vm.Script(registrySource).runInContext(registryContext);
const { ParserRegistry } = registryContext.window;

class ScriptedParser extends BaseParserService {
    constructor(id, respond) {
        super({ id, name: id, baseUrl: 'https://provider.test' });
        this.respond = respond;
        this.calls = [];
    }

    async search(title, year, options) {
        this.calls.push({ title, year, options });
        return this.respond(title, this.calls.length);
    }
}

(async () => {
    // 1. A miss (a parser's swallowed network failure) is not cached, so a
    //    retry searches again instead of replaying "not found" for an hour.
    const flaky = new ScriptedParser('flaky', (_title, attempt) => (
        attempt === 1 ? null : { url: 'https://provider.test/film', title: 'Film' }
    ));
    assert.equal(await flaky.cachedSearch('Фильм', 2020), null);
    const retried = await flaky.cachedSearch('Фильм', 2020);
    assert.equal(retried?.url, 'https://provider.test/film', 'retry after a miss must search again');
    await flaky.cachedSearch('Фильм', 2020);
    assert.equal(flaky.calls.length, 2, 'a found result is still cached');

    // 2. searchAll tries the fallback title only when the primary title misses.
    const originalOnly = new ScriptedParser('original', title => (
        title === 'Original Title' ? { url: 'https://provider.test/original', title } : null
    ));
    const primaryHit = new ScriptedParser('primary', title => ({ url: `https://provider.test/${title}`, title }));
    const registry = new ParserRegistry(['original', 'primary']);
    registry.register(originalOnly);
    registry.register(primaryHit);
    const results = await registry.searchAll('Русское название', 2020, { fallbackTitle: 'Original Title' });
    assert.equal(results.length, 2);
    assert.deepEqual(originalOnly.calls.map(call => call.title), ['Русское название', 'Original Title']);
    assert.deepEqual(primaryHit.calls.map(call => call.title), ['Русское название']);
    assert.equal(originalOnly.calls[0].options.fallbackTitle, undefined, 'fallbackTitle is not a parser option');

    // A movie without a Russian name searches by its original title only once.
    const noRussian = new ScriptedParser('noRussian', () => null);
    const soloRegistry = new ParserRegistry(['noRussian']);
    soloRegistry.register(noRussian);
    await soloRegistry.searchAll('Original Title', 2020, { fallbackTitle: 'Original Title' });
    assert.deepEqual(noRussian.calls.map(call => call.title), ['Original Title']);
    assert.equal(ParserRegistry.getSearchTitles(undefined, '  ', null).length, 0);

    // 3. Adapters accept the single SearchResult that parser.search() returns
    //    and never pass the Kinopoisk ID as the release year.
    for (const AdapterClass of [ExFsAdapter, RutubeAdapter, SeasonvarAdapter]) {
        const searchCalls = [];
        const sourceCalls = [];
        const parser = {
            async search(title, year, options) {
                searchCalls.push({ title, year, options });
                return { url: 'https://provider.test/title.html', title };
            },
            async getVideoSources(target) {
                sourceCalls.push(target);
                return [];
            }
        };
        const adapter = new AdapterClass({ parserService: parser });
        adapter.parserService = parser;
        await assert.rejects(
            adapter.mount({ querySelector: () => null }, {
                title: 'Фильм',
                kinopoiskId: 326,
                mediaType: 'movie'
            }, {}),
            error => error.code === 'PROVIDER_LOAD_FAILED'
        );
        assert.equal(searchCalls.length, 1, `${AdapterClass.name} searches once`);
        assert.equal(searchCalls[0].year, null, `${AdapterClass.name} must not pass kinopoiskId as year`);
        assert.deepEqual(sourceCalls, ['https://provider.test/title.html'],
            `${AdapterClass.name} must load sources from the single search result`);
    }

    console.log('parserSearchRetryAndFallback tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
