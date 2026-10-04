import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Running parser network hardening tests...');

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const baseParserSource = read('../src/shared/services/parsers/BaseParserService.js');
const kinogoParserSource = read('../src/shared/services/parsers/KinogoParser.js');
const seasonvarParserSource = read('../src/shared/services/parsers/SeasonvarParser.js');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function createContext(fetchImpl) {
    const context = vm.createContext({
        console: { ...console, log() {}, warn() {}, error() {} },
        window: {},
        chrome: undefined,
        fetch: fetchImpl,
        URL,
        URLSearchParams,
        AbortController,
        setTimeout,
        clearTimeout
    });
    vm.runInContext(baseParserSource, context);
    vm.runInContext(kinogoParserSource, context);
    vm.runInContext(seasonvarParserSource, context);
    return context;
}

// Resolves only when aborted, like a mirror that accepts the connection and never answers.
const hangingFetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(options.signal.reason || new Error('aborted')), { once: true });
});

// fetchWithTimeout unrefs its deadline timer in Node; keep the loop alive
// while the hanging-fetch scenarios wait on it.
const keepAlive = setInterval(() => {}, 1000);

(async () => {
    // 1. fetchWithTimeout aborts a stalled request at the deadline.
    {
        const context = createContext(hangingFetch);
        const parser = new context.window.KinogoParser({ requestTimeoutMs: 30 });
        const startedAt = Date.now();
        await assert.rejects(parser.fetchWithTimeout('https://kinogo.test/x'), /timed out/);
        const elapsed = Date.now() - startedAt;
        assert.ok(elapsed < 500, `stalled request must be aborted near the deadline (elapsed ${elapsed}ms)`);
    }

    // 2. A hanging first mirror does not block search; the hedged next mirror wins
    //    and the losing request is aborted.
    {
        let hangingAborted = false;
        const searchHtml = '<div class="shortstory"><h2><a href="/film/123-matrica.html">Матрица (1999)</a></h2></div>';
        const context = createContext((url, options = {}) => {
            if (url.startsWith('https://kinogo.la')) {
                return new Promise((_resolve, reject) => {
                    options.signal?.addEventListener('abort', () => {
                        hangingAborted = true;
                        reject(new Error('aborted'));
                    }, { once: true });
                });
            }
            return Promise.resolve({ ok: true, status: 200, text: async () => searchHtml });
        });
        const parser = new context.window.KinogoParser({ requestTimeoutMs: 5000, mirrorHedgeDelayMs: 25 });
        const startedAt = Date.now();
        const result = await parser.search('Матрица', 1999, { mediaType: 'film' });
        const elapsed = Date.now() - startedAt;
        assert.ok(result, 'hedged mirror must return a result');
        assert.ok(result.url.startsWith('https://kinogo.film/'), `result must come from the responsive mirror (${result.url})`);
        assert.ok(elapsed < 1000, `search must not wait for the hanging mirror (elapsed ${elapsed}ms)`);
        await delay(0);
        assert.ok(hangingAborted, 'the losing mirror request must be aborted once the race is decided');
    }

    // 3. Mirrors that fail fast fall through in priority order without hedging delay.
    {
        const fetched = [];
        const context = createContext(async (url) => {
            fetched.push(new URL(url).origin);
            throw new Error('blocked');
        });
        const parser = new context.window.KinogoParser({ mirrorHedgeDelayMs: 10_000 });
        const startedAt = Date.now();
        const sources = await parser.getVideoSources('https://kinogo.la/film/1.html');
        assert.equal(sources.length, 0, "no mirror may yield sources");
        assert.ok(Date.now() - startedAt < 1000, 'fast failures must not wait for the hedge delay');
        assert.ok(new Set(fetched).size >= 5, 'every mirror must be attempted');
    }

    // 4. Direct <video> URLs are scheme-checked and attribute-escaped.
    {
        const context = createContext(hangingFetch);
        const parser = new context.window.KinogoParser();
        const container = { innerHTML: '', querySelector: () => null };

        const hostile = 'https://cdn.test/a.mp4"><img src=x onerror=alert(1)>';
        assert.equal(parser.renderPlayer(container, [{ url: hostile, type: 'video' }], { lifecycle: false }), true);
        assert.ok(!container.innerHTML.includes('<img'), 'a scraped URL must not inject markup');
        assert.ok(!container.innerHTML.includes('a.mp4"'), 'a scraped URL must not close the src attribute');

        assert.equal(parser.renderPlayer(container, [{ url: 'javascript:alert(1)', type: 'video' }], { lifecycle: false }), false);
        assert.ok(!container.innerHTML.includes('javascript:'), 'non-network media schemes must be rejected');
    }

    // 5. Seasonvar translation and episode markup escape provider-controlled values.
    {
        const context = createContext(hangingFetch);
        const SeasonvarParser = context.window.SeasonvarParser;
        assert.ok(SeasonvarParser, 'SeasonvarParser must be exported on window');
        const parser = new SeasonvarParser();
        const html = parser._renderTranslationSelect([
            { id: '0', name: '<img src=x onerror=alert(1)>', url: '/pl/0"onmouseover="x', active: true },
            { id: '1', name: 'LostFilm', url: '/pl/1', active: false }
        ]);
        assert.ok(!html.includes('<img'), 'translation names must be escaped');
        assert.ok(!html.includes('"onmouseover'), 'translation URLs must not break out of data-url');
        assert.equal(context.window.BaseParserService.toMediaSrcAttribute('javascript:alert(1)'), null);
        assert.equal(context.window.BaseParserService.toMediaSrcAttribute('https://cdn.test/a.mp4?x=1&y=2'),
            'https://cdn.test/a.mp4?x=1&amp;y=2');
    }

    console.log('✅ parser network hardening tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => clearInterval(keepAlive));
