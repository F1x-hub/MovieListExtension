import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const source = read('../src/pages/movie-details/PlayerSurface.js');
const dom = new JSDOM('<div id="player"></div>', { url: 'https://host.test/', runScripts: 'outside-only' });
try {
    dom.window.eval(source);
    let Surface = dom.window.MovieDetailsPlayerSurface;
    assert.equal(typeof Surface.getProviderSandbox, 'function', 'A1 needs a shared provider sandbox policy');
    assert.equal(Surface.getProviderSandbox('https://provider.test/embed'), null, 'empty production list changes no provider');
    const container = dom.window.document.getElementById('player');
    Surface.renderFrameInto(container, 'https://provider.test/embed');
    assert.equal(container.querySelector('iframe').hasAttribute('sandbox'), false);
    const marker = 'const SANDBOX_PROVIDERS = Object.freeze([]);';
    assert.ok(source.includes(marker), 'providers remain disabled pending live verification');
    const configured = new JSDOM('<div id="player"></div>', { url: 'https://host.test/', runScripts: 'outside-only' });
    try {
        configured.window.eval(source.replace(marker, "const SANDBOX_PROVIDERS = Object.freeze(['provider.test', 'host.test', 'vidsrc-embed.ru']);"));
        Surface = configured.window.MovieDetailsPlayerSurface;
        const policy = Surface.getProviderSandbox('https://provider.test/embed');
        assert.equal(policy, 'allow-scripts allow-same-origin allow-forms allow-presentation');
        assert.equal(Surface.getProviderSandbox('https://provider.test.evil.test/embed'), null);
        assert.equal(Surface.getProviderSandbox('https://host.test/embed'), null, 'never apply same-origin provider privileges');
        assert.equal(Surface.getProviderSandbox('chrome-extension://test/embed'), null);
        const target = configured.window.document.getElementById('player');
        assert.equal(Surface.renderFrameInto(target, 'https://provider.test/embed', { sandbox: policy }), true);
        assert.equal(target.querySelector('iframe').getAttribute('sandbox'), policy);
        assert.equal(target.querySelector('iframe').getAttribute('sandbox').split(' ').includes('allow-top-navigation'), false);
        Surface.renderFrameInto(target, 'https://provider.test/trailer');
        assert.equal(target.querySelector('iframe').hasAttribute('sandbox'), false, 'generic/trailer call stays opt-in');
        assert.equal(Surface.renderFrameInto(target, 'https://provider.test/embed', { sandbox: 'allow-top-navigation' }), false);
        configured.window.eval(read('../src/shared/services/parsers/BaseParserService.js'));
        class Parser extends configured.window.BaseParserService {}
        const parser = new Parser({ id: 'test', name: 'Test', baseUrl: 'https://site.test' });
        await parser.renderPlayer(target, [{ url: 'https://provider.test/embed', name: 'Test', type: 'iframe' }], { lifecycle: false });
        assert.equal(target.querySelector('iframe').getAttribute('sandbox'), policy, 'real parser mount applies shared policy');
        configured.window.eval(read('../src/shared/services/player/adapters/BasePlaybackAdapter.js'));
        configured.window.eval(read('../src/shared/services/player/adapters/VidSrcAdapter.js'));
        const mounted = await new configured.window.VidSrcAdapter().mount(target, { imdbId: 'tt1234567', mediaType: 'movie' });
        assert.equal(mounted.element.getAttribute('sandbox'), policy, 'real VidSrc mount applies shared policy');
    } finally { configured.window.close(); }
    const search = read('../src/pages/search/search.js');
    assert.ok(search.includes('MovieDetailsPlayerSurface.renderFrameInto'));
    assert.doesNotMatch(search, /<iframe src="\$\{url\}"/);
    const html = read('../src/pages/search/search.html');
    assert.ok(html.indexOf('src="../movie-details/PlayerSurface.js"') < html.indexOf('src="search.js"'));
    for (const file of ['../src/shared/services/parsers/BaseParserService.js',
        '../src/shared/services/player/adapters/VidSrcAdapter.js', '../src/pages/movie-details/movie-details.js']) {
        assert.ok(read(file).includes('getProviderSandbox'), `provider mount uses policy: ${file}`);
    }
    console.log('Provider sandbox infrastructure: explicit tokens, empty default, isolated allowlist, safe renderer and provider call sites passed.');
} finally { dom.window.close(); }
