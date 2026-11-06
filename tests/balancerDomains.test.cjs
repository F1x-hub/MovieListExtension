/**
 * The balancer behind KinoGo and Ex-FS moves between domains, and the one it left answers
 * every embed with HTTP 422. That took both sources down on 2026-11-06 while the sites kept
 * working, because their pages rewrite the address with a script of the balancer's own.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// The lines that matter of https://kodir2.github.io/actualize.js as it was on 2026-11-06.
const script = (actual = 'https://api.femd.ws') => `!function(){
if(window['__actualize.js'])return;window['__actualize.js']=1;
var actual = "${actual}"
	,re=/^(?:https?:)?\\/\\/(?:mm|app?i\\w*)\\.(delivembed\\.cc|buildplayer\\.com|ameytools\\.club|(tobaco|luxembd|namy|variyt|zenithjs|ortified|nextembed)(\\.ws))/
	,delay=200,max=1000*60*60*24
}()`;

function environment({ stored, fetch } = {}) {
    const dom = new JSDOM('<div id="host"></div>', { url: 'https://host.test/', runScripts: 'outside-only' });
    const w = dom.window;
    const writes = [];
    w.chrome = { storage: { local: {
        get: async () => (stored ? { venomBalancerDomainsV1: stored } : {}),
        set: async value => { writes.push(value.venomBalancerDomainsV1); }
    } } };
    const requests = [];
    w.fetch = async (url, init) => {
        requests.push(String(url));
        return fetch ? fetch(String(url), init) : { ok: false, status: 500 };
    };
    w.eval(read('src/shared/services/parsers/BaseParserService.js'));
    w.eval(`window.FrameParser = class extends window.BaseParserService {
        constructor() { super({ id: 'frames', name: 'Frames', baseUrl: 'https://kinogo.la' }); }
        getPlayerType() { return 'iframe'; }
    };`);
    return { dom, w, domains: w.BalancerDomains, requests, writes };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('the balancer script is read as data for its current domain and the ones it left', t => {
    const { dom, domains } = environment();
    t.after(() => dom.window.close());
    const parsed = domains.parseScript(script());
    assert.equal(parsed.actualHost, 'api.femd.ws');
    for (const retired of ['delivembed.cc', 'ameytools.club', 'namy.ws', 'nextembed.ws']) {
        assert.ok(parsed.retired.includes(retired), retired);
    }
    assert.equal(domains.parseScript('var nothing = 1;'), null, 'another script');
    assert.equal(domains.parseScript(script('https://evil.example')), null, 'an address not shaped like the balancer');
    assert.equal(domains.parseScript(script('http://api.femd.ws')), null, 'not HTTPS');
});

test('an address on a domain the balancer left moves to the current one and keeps the rest', t => {
    const { dom, domains } = environment();
    t.after(() => dom.window.close());
    for (const [from, to] of [
        ['https://api.nextembed.ws/embed/movie/180', 'https://api.femd.ws/embed/movie/180'],
        ['//api.ortified.ws/embed/kp/258687?season=2', 'https://api.femd.ws/embed/kp/258687?season=2'],
        ['http://mm.namy.ws/embed/movie/1', 'https://api.femd.ws/embed/movie/1']
    ]) assert.equal(domains.actualize(from), to, from);
    for (const same of [
        'https://api.femd.ws/embed/movie/180',
        'https://walking-as.allarknow.online/?token_movie=a&token=b',
        'https://cinemar.cc/embed/1/token',
        'https://evil.nextembed.ws.example/embed/movie/1',
        'parser:kinogo', 'vidsrc:tt1', '/relative/path', ''
    ]) assert.equal(domains.actualize(same), same, same);
    assert.equal(domains.actualize(null), null);
});

test('after a move the old current domain counts as left, and the new one is never rewritten', t => {
    const { dom, domains, w } = environment();
    t.after(() => dom.window.close());
    assert.equal(domains.apply({ actualHost: 'api.nextone.ws' }), true);
    assert.equal(domains.actualize('https://api.femd.ws/embed/movie/1'), 'https://api.nextone.ws/embed/movie/1');
    assert.equal(domains.actualize('https://api.nextone.ws/embed/movie/1'), 'https://api.nextone.ws/embed/movie/1');
    assert.equal(w.BaseParserService.isActualBalancerUrl('https://api.nextone.ws/embed/movie/1'), true);
    assert.equal(w.BaseParserService.isSupportedProviderFrameUrl('https://api.nextone.ws/embed/movie/1'), true,
        'a domain the manifest does not list yet is still treated as the balancer');
    domains.apply({ actualHost: 'api.femd.ws' });
    assert.equal(domains.actualize('https://api.nextone.ws/embed/movie/1'), 'https://api.femd.ws/embed/movie/1', 'it can come back');
    assert.equal(domains.apply({ actualHost: 'not a host' }), false);
    assert.equal(domains.actualHost, 'api.femd.ws');
});

test('a page uses what an earlier one learned and checks for a move at most hourly', async t => {
    const fresh = environment({ stored: { actualHost: 'api.learned.ws', retired: ['femd.ws'], checkedAt: Date.now() - 1000 } });
    t.after(() => fresh.dom.window.close());
    await fresh.domains.load();
    assert.equal(fresh.domains.actualHost, 'api.learned.ws');
    assert.deepEqual(fresh.requests, [], 'nothing fetched within the hour');

    const stale = environment({
        stored: { actualHost: 'api.femd.ws', retired: [], checkedAt: Date.now() - 2 * 60 * 60 * 1000 },
        fetch: async () => ({ ok: true, text: async () => script('https://api.moved.ws') })
    });
    t.after(() => stale.dom.window.close());
    await stale.domains.load();
    await settle();
    assert.deepEqual(stale.requests, ['https://kodir2.github.io/actualize.js']);
    assert.equal(stale.domains.actualHost, 'api.moved.ws');
    assert.equal(stale.writes.at(-1).actualHost, 'api.moved.ws', 'the next page starts from it');
    assert.ok(stale.writes.at(-1).retired.includes('femd.ws'));
});

test('an unreachable or changed script keeps the known domain', async t => {
    for (const fetch of [
        async () => { throw new Error('offline'); },
        async () => ({ ok: false, status: 404 }),
        async () => ({ ok: true, text: async () => '<html>moved</html>' })
    ]) {
        const { dom, domains, w } = environment({ fetch });
        t.after(() => dom.window.close());
        w.console.warn = () => {};
        assert.equal(await domains.refresh(), false);
        assert.equal(domains.actualHost, 'api.femd.ws');
        assert.equal(domains.actualize('https://api.nextembed.ws/embed/movie/1'), 'https://api.femd.ws/embed/movie/1');
    }
});

test('forced checks are rate limited, so a refused film cannot hammer the script host', async t => {
    const { dom, domains, requests } = environment({ fetch: async () => ({ ok: true, text: async () => script() }) });
    t.after(() => dom.window.close());
    await domains.refresh({ force: true });
    await domains.refresh({ force: true });
    assert.equal(requests.length, 1);
});

test('a frame never opens on a domain the balancer left', async t => {
    const { dom, w } = environment({ fetch: async () => ({ ok: true, status: 200 }) });
    t.after(() => dom.window.close());
    const container = w.document.getElementById('host');
    new w.FrameParser().renderPlayer(container, [{ name: 'KinoGo', url: 'https://api.nextembed.ws/embed/movie/180', type: 'iframe' }], { lifecycle: false });
    const src = new URL(container.querySelector('iframe').getAttribute('src'));
    assert.equal(src.host, 'api.femd.ws');
    assert.equal(src.pathname, '/embed/movie/180');
    assert.equal(src.searchParams.get('santabarbaranoads'), '1');
    assert.equal(src.searchParams.get('movieExtensionSite'), 'kinogo.la');
    assert.equal(container.querySelector('iframe').getAttribute('referrerpolicy'), 'no-referrer');
});

test('a refused embed reveals a move: the same film opens from the new domain at once', async t => {
    const { dom, w, domains, requests } = environment({ fetch: async url => {
        if (url.includes('actualize.js')) return { ok: true, text: async () => script('https://api.moved.ws') };
        return { ok: true, status: url.includes('api.moved.ws') ? 200 : 422 };
    } });
    t.after(() => dom.window.close());
    const container = w.document.getElementById('host');
    const failures = [];
    new w.FrameParser().renderPlayer(container, [{ name: 'KinoGo', url: 'https://api.femd.ws/embed/movie/180', type: 'iframe' }], {
        lifecycle: false, onLifecycleState: state => failures.push(state)
    });
    await settle();
    await settle();
    assert.equal(new URL(container.querySelector('iframe').getAttribute('src')).host, 'api.moved.ws');
    assert.equal(domains.actualHost, 'api.moved.ws');
    assert.ok(requests.includes('https://kodir2.github.io/actualize.js'));
    assert.deepEqual(failures, [], 'the viewer never sees it fail');
});

test('a refused embed with no move goes on to the next source of the same provider', async t => {
    const { dom, w } = environment({ fetch: async url => {
        if (url.includes('actualize.js')) return { ok: true, text: async () => script() };
        return { ok: true, status: 422 };
    } });
    t.after(() => dom.window.close());
    w.console.warn = () => {};
    const container = w.document.getElementById('host');
    new w.FrameParser().renderPlayer(container, [
        { name: 'KinoGo', url: 'https://api.femd.ws/embed/movie/180', type: 'iframe' },
        { name: 'KinoGo', url: 'https://walking-as.allarknow.online/?token_movie=a&token=b', type: 'iframe' }
    ], { lifecycle: false });
    await settle();
    await settle();
    assert.equal(new URL(container.querySelector('iframe').getAttribute('src')).host, 'walking-as.allarknow.online');
});

test('the current domain gets everything a balancer frame needs from the extension', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.ok(manifest.host_permissions.includes('https://*.femd.ws/*'));
    const frameScripts = manifest.content_scripts.filter(entry => entry.matches.includes('*://*.nextembed.ws/*'));
    assert.equal(frameScripts.length, 2, 'the bridges at document_start and the cleaner at document_end');
    for (const entry of frameScripts) assert.ok(entry.matches.includes('*://*.femd.ws/*'), entry.js.join());
    const rules = JSON.parse(read('src/background/provider-embed-rules.json'))
        .filter(rule => rule.condition.requestDomains.includes('nextembed.ws'));
    assert.ok(rules.length > 0);
    for (const rule of rules) assert.ok(rule.condition.requestDomains.includes('femd.ws'), `rule ${rule.id}: the site's Referer must reach it`);
    assert.ok(manifest.host_permissions.includes('https://*.stream.voidboost.one/*'), 'every HDRezka CDN server');
});
