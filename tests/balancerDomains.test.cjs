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

// The lines that matter of https://kodir2.github.io/actualize.js in its 2026-11-06 form.
const script = (actual = 'https://api.corevia.ws') => `!function(){
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
    assert.equal(parsed.actualHost, 'api.corevia.ws');
    for (const retired of ['delivembed.cc', 'ameytools.club', 'namy.ws', 'nextembed.ws']) {
        assert.ok(parsed.retired.includes(retired), retired);
    }
    assert.equal(domains.parseScript('var nothing = 1;'), null, 'another script');
    assert.equal(domains.parseScript(script('https://evil.example')), null, 'an address not shaped like the balancer');
    assert.equal(domains.parseScript(script('http://api.corevia.ws')), null, 'not HTTPS');
});

// The same line in its 2026-11-17 form: zones are grouped as (?:a|b)\.net.
const groupedScript = `!function(){
var actual = "https://api.corevia.ws"
	,re=/^(?:https?:)?\\/\\/(?:mm|app?i\\w*)\\.((?:embedstorage|embf|multikland)\\.net|(?:buildplayer|mir-dikogo-zapada|synchroncode)\\.com|delivembed\\.cc|placehere\\.link|ameytools\\.club|(?:tobaco|namy|nextembed)\\.ws)/
	,delay=200,max=1000*60*60*24
}()`;

test('grouped zones in the current script are read too, so KinoGo embf.net embeds move to the current domain', t => {
    const { dom, domains } = environment();
    t.after(() => dom.window.close());
    const parsed = domains.parseScript(groupedScript);
    assert.equal(parsed.actualHost, 'api.corevia.ws');
    for (const retired of ['embf.net', 'embedstorage.net', 'multikland.net', 'synchroncode.com', 'mir-dikogo-zapada.com',
        'delivembed.cc', 'placehere.link', 'ameytools.club', 'tobaco.ws', 'namy.ws', 'nextembed.ws']) {
        assert.ok(parsed.retired.includes(retired), retired);
    }
    assert.ok(!parsed.retired.some(domain => domain.includes('?') || domain.includes('|')), 'only plain domains');
    // Known without a network answer as well: KinoGo printed this address for «Джуманджи».
    assert.equal(domains.actualize('https://api.embf.net/embed/movie/937'), 'https://api.corevia.ws/embed/movie/937');
});

test('an address on a domain the balancer left moves to the current one and keeps the rest', t => {
    const { dom, domains } = environment();
    t.after(() => dom.window.close());
    for (const [from, to] of [
        ['https://api.nextembed.ws/embed/movie/180', 'https://api.corevia.ws/embed/movie/180'],
        ['//api.ortified.ws/embed/kp/258687?season=2', 'https://api.corevia.ws/embed/kp/258687?season=2'],
        ['http://mm.namy.ws/embed/movie/1', 'https://api.corevia.ws/embed/movie/1']
    ]) assert.equal(domains.actualize(from), to, from);
    for (const same of [
        'https://api.corevia.ws/embed/movie/180',
        'https://walking-as.allarknow.online/?token_movie=a&token=b',
        'https://cinemar.cc/embed/1/token',
        'https://evil.nextembed.ws.example/embed/movie/1',
        'parser:kinogo', 'mediaplayer:torrent', '/relative/path', ''
    ]) assert.equal(domains.actualize(same), same, same);
    assert.equal(domains.actualize(null), null);
});

test('after a move the old current domain counts as left, and the new one is never rewritten', t => {
    const { dom, domains, w } = environment();
    t.after(() => dom.window.close());
    assert.equal(domains.apply({ actualHost: 'api.nextone.ws' }), true);
    assert.equal(domains.actualize('https://api.corevia.ws/embed/movie/1'), 'https://api.nextone.ws/embed/movie/1');
    assert.equal(domains.actualize('https://api.nextone.ws/embed/movie/1'), 'https://api.nextone.ws/embed/movie/1');
    assert.equal(w.BaseParserService.isActualBalancerUrl('https://api.nextone.ws/embed/movie/1'), true);
    assert.equal(w.BaseParserService.isSupportedProviderFrameUrl('https://api.nextone.ws/embed/movie/1'), true,
        'a domain the manifest does not list yet is still treated as the balancer');
    domains.apply({ actualHost: 'api.corevia.ws' });
    assert.equal(domains.actualize('https://api.nextone.ws/embed/movie/1'), 'https://api.corevia.ws/embed/movie/1', 'it can come back');
    assert.equal(domains.apply({ actualHost: 'not a host' }), false);
    assert.equal(domains.actualHost, 'api.corevia.ws');
});

test('a page uses what an earlier one learned and checks for a move at most hourly', async t => {
    const fresh = environment({ stored: { actualHost: 'api.learned.ws', retired: ['corevia.ws'], checkedAt: Date.now() - 1000 } });
    t.after(() => fresh.dom.window.close());
    await fresh.domains.load();
    assert.equal(fresh.domains.actualHost, 'api.learned.ws');
    assert.deepEqual(fresh.requests, [], 'nothing fetched within the hour');

    const stale = environment({
        stored: { actualHost: 'api.corevia.ws', retired: [], checkedAt: Date.now() - 2 * 60 * 60 * 1000 },
        fetch: async () => ({ ok: true, text: async () => script('https://api.moved.ws') })
    });
    t.after(() => stale.dom.window.close());
    await stale.domains.load();
    await settle();
    assert.deepEqual(stale.requests, ['https://kodir2.github.io/actualize.js']);
    assert.equal(stale.domains.actualHost, 'api.moved.ws');
    assert.equal(stale.writes.at(-1).actualHost, 'api.moved.ws', 'the next page starts from it');
    assert.ok(stale.writes.at(-1).retired.includes('corevia.ws'));
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
        assert.equal(domains.actualHost, 'api.corevia.ws');
        assert.equal(domains.actualize('https://api.nextembed.ws/embed/movie/1'), 'https://api.corevia.ws/embed/movie/1');
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
    assert.equal(src.host, 'api.corevia.ws');
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
    new w.FrameParser().renderPlayer(container, [{ name: 'KinoGo', url: 'https://api.corevia.ws/embed/movie/180', type: 'iframe' }], {
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
        { name: 'KinoGo', url: 'https://api.corevia.ws/embed/movie/180', type: 'iframe' },
        { name: 'KinoGo', url: 'https://walking-as.allarknow.online/?token_movie=a&token=b', type: 'iframe' }
    ], { lifecycle: false });
    await settle();
    await settle();
    assert.equal(new URL(container.querySelector('iframe').getAttribute('src')).host, 'walking-as.allarknow.online');
});

test('the current domain gets everything a balancer frame needs from the extension', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.ok(manifest.host_permissions.includes('https://*.corevia.ws/*'));
    const frameScripts = manifest.content_scripts.filter(entry => entry.matches.includes('*://*.nextembed.ws/*'));
    assert.equal(frameScripts.length, 2, 'the bridges at document_start and the cleaner at document_end');
    for (const entry of frameScripts) assert.ok(entry.matches.includes('*://*.corevia.ws/*'), entry.js.join());
    const rules = JSON.parse(read('src/background/provider-embed-rules.json'))
        .filter(rule => rule.condition.requestDomains.includes('nextembed.ws'));
    assert.ok(rules.length > 0);
    for (const rule of rules) assert.ok(rule.condition.requestDomains.includes('corevia.ws'), `rule ${rule.id}: the site's Referer must reach it`);
    assert.ok(manifest.host_permissions.includes('https://*.stream.voidboost.one/*'), 'every HDRezka CDN server');
});

/** An extension page's scripting API, with the manifest this repository ships. */
function scriptingApi(w, { registered = [] } = {}) {
    const log = [];
    w.chrome.runtime = { getManifest: () => JSON.parse(read('manifest.json')) };
    w.chrome.scripting = {
        getRegisteredContentScripts: async () => registered,
        unregisterContentScripts: async ({ ids }) => {
            log.push(['unregister', ids]);
            registered = registered.filter(script => !ids.includes(script.id));
        },
        registerContentScripts: async scripts => {
            log.push(['register', scripts]);
            registered = [...registered, ...scripts];
        }
    };
    return { log, current: () => registered };
}

test('a domain the manifest does not name gets the frame scripts of the known ones', async t => {
    const { dom, w, domains } = environment({ stored: { actualHost: 'api.nextone.ws', retired: [], checkedAt: Date.now() } });
    t.after(() => dom.window.close());
    const { log, current } = scriptingApi(w);
    await domains.load();
    const wanted = JSON.parse(read('manifest.json')).content_scripts.filter(entry => entry.matches.includes('*://*.corevia.ws/*'));
    assert.deepEqual(current().map(script => [...script.js]), wanted.map(entry => entry.js));
    for (const script of current()) {
        assert.deepEqual([...script.matches], ['*://*.nextone.ws/*'], 'that domain only');
        assert.equal(script.allFrames, true);
    }
    assert.deepEqual(current().map(script => [script.world, script.runAt]), [['MAIN', 'document_start'], ['ISOLATED', 'document_end']]);

    await domains.attachFrameScripts();
    assert.equal(log.length, 1, 'already registered');

    domains.apply({ actualHost: 'api.nexttwo.ws' });
    await domains.attachFrameScripts();
    assert.ok(current().every(script => script.matches[0] === '*://*.nexttwo.ws/*'), 'the domain it left loses them');

    domains.apply({ actualHost: 'api.corevia.ws' });
    await domains.attachFrameScripts();
    assert.deepEqual(current(), [], 'the manifest covers this one: a second copy would run the player twice');
});

test('a move learned by a page registers the scripts before the page acts on it', async t => {
    const { dom, w, domains } = environment({ fetch: async () => ({ ok: true, text: async () => script('https://api.moved.ws') }) });
    t.after(() => dom.window.close());
    const { current } = scriptingApi(w);
    assert.equal(await domains.refresh(), true);
    assert.equal(current().length, 2);
});

test('the manifest lets those scripts and the Referer rules reach the .ws zone', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.ok(manifest.host_permissions.includes('https://*.ws/*'));
    for (const entry of manifest.content_scripts) assert.ok(!entry.matches.includes('*://*.ws/*'), 'no frame script runs on the whole zone');
    const rules = JSON.parse(read('src/background/provider-embed-rules.json')).filter(rule => rule.condition.requestDomains.includes('corevia.ws'));
    for (const rule of rules) assert.ok(rule.condition.requestDomains.includes('ws'), `rule ${rule.id}`);
});

const embedPage = host => `<script>var embedHost= "${host}", consumerHost= "kinogo.la";</script><script>VenomPlayer.make(opts)</script>`;

test('a film page that prints the new domain first teaches it, once that host answers as the balancer', async t => {
    const { dom, w, domains, writes, requests } = environment({ fetch: async url => ({ ok: true, status: 200, text: async () => embedPage(new URL(url).host) }) });
    t.after(() => dom.window.close());
    w.AbortSignal.timeout ||= () => undefined;
    assert.equal(domains.isUnknownEmbed('//api.brandnew.club/embed/movie/5'), true);
    for (const known of ['https://api.corevia.ws/embed/movie/5', 'https://api.embf.net/embed/movie/5', 'https://walking-as.allarknow.online/?token_movie=a',
        'https://api.example.com/v1/data', 'https://player.example.com/embed/movie/5']) assert.equal(domains.isUnknownEmbed(known), false, known);
    await new w.FrameParser().checkEmbedAvailable('https://api.brandnew.club/embed/movie/5');
    assert.equal(domains.actualHost, 'api.brandnew.club');
    assert.equal(writes.at(-1).actualHost, 'api.brandnew.club', 'the next page starts from it');
    assert.equal(domains.actualize('https://api.corevia.ws/embed/movie/5'), 'https://api.brandnew.club/embed/movie/5');
    assert.ok(requests.length >= 1);
});

test('another site\'s player, or a page speaking for another host, teaches nothing', async t => {
    for (const page of ['<html>player</html>', embedPage('api.other.club')]) {
        const { dom, w, domains } = environment({ fetch: async () => ({ ok: true, status: 200, text: async () => page }) });
        t.after(() => dom.window.close());
        w.AbortSignal.timeout ||= () => undefined;
        assert.equal(await domains.adopt('https://api.brandnew.club/embed/movie/5'), false);
        assert.equal(domains.actualHost, 'api.corevia.ws');
    }
});

test('the balancer script is followed to a new place the sites load it from', async t => {
    const { dom, domains, requests, writes } = environment({ fetch: async url => url.includes('kodir2')
        ? { ok: false, status: 404 } : { ok: true, text: async () => script('https://api.moved.ws') } });
    t.after(() => dom.window.close());
    domains.noteScript('<script src="https://elsewhere.github.io/x/actualize.js"></script>');
    await settle();
    assert.equal(requests[0], 'https://elsewhere.github.io/x/actualize.js');
    assert.equal(domains.actualHost, 'api.moved.ws');
    assert.equal(writes.at(-1).scriptUrl, 'https://elsewhere.github.io/x/actualize.js');
    domains.noteScript('<script src="http://plain.example/actualize.js"></script><script src="/engine/actualize.js"></script>');
    assert.equal(domains.scriptUrl, 'https://elsewhere.github.io/x/actualize.js', 'HTTPS addresses only');
});

test('outside the .ws zone the Referer rules follow the domain too', async t => {
    const rules = [{ id: 5070, condition: {} }];
    const { dom, w, domains } = environment({ fetch: async () => ({ ok: true, json: async () => JSON.parse(read('src/background/provider-embed-rules.json')) }) });
    t.after(() => dom.window.close());
    scriptingApi(w);
    w.chrome.runtime.getURL = file => `https://host.test/${file}`;
    let added = [];
    w.chrome.declarativeNetRequest = {
        getDynamicRules: async () => [...rules, ...added],
        updateDynamicRules: async change => { added = change.addRules; }
    };
    domains.apply({ actualHost: 'api.faraway.club' });
    await domains.attachFrameScripts();
    assert.ok(added.length > 0);
    for (const rule of added) {
        assert.deepEqual([...rule.condition.requestDomains], ['faraway.club']);
        assert.ok(rule.id >= 5200 && rule.id < 5300, 'never over another rule');
    }
    domains.apply({ actualHost: 'api.corevia.ws' });
    await domains.attachFrameScripts();
    assert.deepEqual([...added], [], 'back in the zone the static rules are enough');
});

/** A mounted balancer frame, with its greeting timer under the test's control. */
function mountedFrame(t, { access = true } = {}) {
    const env = environment({ fetch: async () => ({ ok: true, status: 200, text: async () => '' }) });
    const { w, dom } = env;
    t.after(() => dom.window.close());
    w.console.warn = () => {};
    Object.defineProperty(w.document, 'hidden', { configurable: true, value: false });
    const timers = new Map();
    let timerId = 900000;
    const realSetTimeout = w.setTimeout.bind(w);
    const realClearTimeout = w.clearTimeout.bind(w);
    w.setTimeout = (handler, delay, ...rest) => {
        if (delay !== 6000) return realSetTimeout(handler, delay, ...rest);
        timers.set(++timerId, handler);
        return timerId;
    };
    w.clearTimeout = id => { if (!timers.delete(id)) realClearTimeout(id); };
    const scripting = scriptingApi(w);
    const asked = [];
    w.chrome.permissions = { contains: async () => access, request: async request => { asked.push(request); access = true; return true; } };
    const states = [];
    w.PlayerSourceLifecycle = { setState: (_host, state, options) => states.push([state, options]) };
    const parser = new w.FrameParser();
    parser.checkEmbedAvailable = async () => true;
    const container = w.document.getElementById('host');
    const sources = [
        { name: 'KinoGo', url: 'https://api.corevia.ws/embed/movie/1', type: 'iframe' },
        { name: 'KinoGo', url: 'https://walking-as.allarknow.online/?token_movie=a&token=b', type: 'iframe' }
    ];
    parser.renderPlayer(container, sources, { lifecycle: false });
    const frame = () => container.querySelector('iframe');
    const load = () => frame().dispatchEvent(new w.Event('load'));
    const expire = async () => {
        const [id, handler] = [...timers].at(-1);
        timers.delete(id);
        await handler();
        await settle();
    };
    const greet = () => w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'PLAYER_FRAME_HELLO' }, source: frame().contentWindow }));
    return { w, container, frame, load, expire, greet, scripting, timers, states, asked };
}

test('a frame that greets the page is left alone', async t => {
    const env = mountedFrame(t);
    env.load();
    assert.equal(env.timers.size, 1);
    env.greet();
    assert.equal(env.timers.size, 0, 'nothing waits any more');
    env.load();
    assert.equal(env.timers.size, 0, 'the frame may reload itself');
});

test('a silent frame gets its scripts again, then gives way to the next source instead of the balancer\'s own player', async t => {
    const env = mountedFrame(t);
    const first = env.frame();
    env.load();
    await env.expire();
    assert.notEqual(env.frame(), first, 'mounted once more');
    assert.equal(new URL(env.frame().src).host, 'api.corevia.ws');
    env.load();
    await env.expire();
    assert.equal(new URL(env.frame().src).host, 'walking-as.allarknow.online');
});

test('without access to the new domain the viewer is asked by a click, not left with another player', async t => {
    const env = mountedFrame(t, { access: false });
    env.load();
    await env.expire();
    const [state, options] = env.states.at(-1);
    assert.equal(state, 'error');
    assert.deepEqual(env.asked, [], 'never without a click');
    await options.onRetry();
    assert.deepEqual([...env.asked[0].origins], ['https://*.corevia.ws/*']);
    assert.ok(env.frame());
});
