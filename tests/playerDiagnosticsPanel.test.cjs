const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const { MovieDetailsModalStack } = require('../src/pages/movie-details/ModalStack.js');
const source = fs.readFileSync(path.join(__dirname, '../src/pages/movie-details/PlayerDiagnosticsPanel.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('QoE summary shows measured zeros, rebuffer and TTFF percentiles; unknown and legacy reports show no data', async () => {
    const h = harness({ report: async () => ({ counters: [],
        qoe: [{ providerId: 'animego', sessions: 2, stallCount: 0, rebufferMsTotal: 0, rebufferMsMax: 0, url: 'SECRET' },
            { providerId: 'torrent', sessions: 1, stallCount: 2, rebufferMsTotal: 900, rebufferMsMax: 600 },
            { providerId: 'https://SECRET', sessions: 5 }],
        ttff: [{ providerId: 'animego', quality: 'exact', count: 2, measuredCount: 2, meanMs: 800, maxMs: 900, p50Ms: 1000, p95Ms: 1000 },
            { providerId: 'kinogo', quality: 'unknown', count: 1, measuredCount: 99, p50Ms: 1, p95Ms: 1 },
            { providerId: 'seasonvar', quality: 'exact', count: 3, meanMs: 100, maxMs: 200 }] }) });
    await h.panel.open();
    const text = h.panel.summary.textContent;
    assert.match(text, /animego — Остановок для буферизации: 0/);
    assert.match(text, /torrent — Всего буферизация: 900 мс/);
    assert.match(text, /torrent — Самая долгая буферизация: 600 мс/);
    assert.match(text, /animego \(exact\) — TTFF p50 \/ p95: 1000 мс \/ 1000 мс/);
    assert.match(text, /kinogo \(unknown\) — TTFF p50 \/ p95: Нет данных/);
    assert.match(text, /seasonvar \(exact\) — TTFF p50 \/ p95: Нет данных/);
    await h.panel.copy(); assert.ok(!h.copied().includes('SECRET'));
    assert.equal(JSON.parse(h.copied()).ttff[1].p95Ms, null);
    h.window.eval(fs.readFileSync(path.join(__dirname, '../src/shared/i18n/locales.js'), 'utf8').replace('export const locales', 'window.testLocales'));
    h.window.PlayerLocale = { t: (key, _params, fallback) => h.window.testLocales.en.player[key] || fallback };
    h.panel.localize();
    assert.match(h.panel.summary.textContent, /Buffering stalls: 0/);
    assert.match(h.panel.summary.textContent, /TTFF p50 \/ p95: No data/);
    h.panel.destroy(); h.dom.window.close();
    const empty = harness(); await empty.panel.open();
    assert.match(empty.panel.summary.textContent, /Остановок для буферизации: Нет данных/);
    assert.match(empty.panel.summary.textContent, /TTFF p50 \/ p95: Нет данных/);
    empty.panel.destroy(); empty.dom.window.close();
});
function harness(metrics = {}) {
    const dom = new JSDOM('<header id="host"><button id="minimizeVideoBtn">Minimize</button></header><div class="source-toolbar"></div><div id="player"></div>', {
        url: 'chrome-extension://test/movie-details.html', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const { window } = dom;
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
    window.PlayerMetrics = { report: async () => ({ counters: [], ttff: [] }), reset: async () => true, ...metrics };
    let copied;
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async value => { copied = value; } } });
    window.eval(source);
    const panel = new window.PlayerDiagnosticsPanel({ host: window.document.getElementById('host'),
        before: window.document.getElementById('minimizeVideoBtn'), playerHost: window.document.getElementById('player') });
    return { dom, window, panel, copied: () => copied };
}
test('opens once, restores focus on close and Escape, removes UI on destroy', async () => {
    const h = harness();
    const { panel, window } = h;
    assert.equal(panel.ensure(), panel.dialog);
    panel.button.click(); await tick();
    assert.equal(panel.dialog.open, true);
    assert.equal(window.document.activeElement.dataset.action, 'close');
    panel.dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    assert.equal(panel.dialog.open, false);
    assert.equal(window.document.activeElement, panel.button);
    await panel.open();
    panel.destroy();
    assert.equal(window.document.querySelector('dialog'), null);
    assert.equal(panel.ensure(), null);
    h.dom.window.close();
});

test('header fallback and native gear action stay exclusive across player recreation and destroy', async () => {
    const h = harness();
    const { window, panel } = h;
    const doc = window.document;
    let subscriptions = 0;
    window.PlayerLocale = { t: (_key, _params, fallback) => fallback,
        subscribe: () => { subscriptions++; return () => subscriptions--; } };
    assert.equal(doc.querySelector('.source-toolbar').children.length, 0);
    assert.equal(panel.button.nextElementSibling.id, 'minimizeVideoBtn');
    assert.equal(panel.button.getAttribute('aria-label'), 'Диагностика');
    assert.equal(panel.button.hidden, false);
    window.eval(fs.readFileSync(path.join(__dirname, '../src/shared/services/player/PlayerSettingsMenu.js'), 'utf8'));
    const player = doc.getElementById('player');
    for (let i = 0; i < 3; i++) {
        player.innerHTML = '<button class="player-settings-button">Settings</button><div role="menu"></div>';
        const menu = player.querySelector('[role="menu"]');
        const options = { label: 'Диагностика', onOpen: () => window.dispatchEvent(new window.Event('movie-player-diagnostics')) };
        window.PlayerSettingsMenu.appendDiagnostics(menu, options);
        window.PlayerSettingsMenu.appendDiagnostics(menu, options);
        await tick();
        assert.equal(panel.button.hidden, true);
        assert.equal(menu.querySelectorAll('[data-action="diagnostics"]').length, 1);
        menu.querySelector('button').click(); await tick();
        assert.equal(menu.style.display, 'none');
        assert.equal(panel.dialog.open, true);
        assert.equal(doc.querySelectorAll('dialog').length, 1);
        panel.dialog.close();
        assert.equal(doc.activeElement, player.querySelector('.player-settings-button'));
        player.replaceChildren(doc.createElement('iframe')); await tick();
        assert.equal(panel.button.hidden, false, 'iframe/torrent without custom controls uses header');
        panel.ensure();
        assert.equal(doc.querySelectorAll('.player-diagnostics-trigger').length, 1);
    }
    panel.destroy();
    const next = new window.PlayerDiagnosticsPanel({ host: doc.getElementById('host'), playerHost: player });
    assert.equal(subscriptions, 1);
    window.dispatchEvent(new window.Event('movie-player-diagnostics')); await tick();
    assert.equal(next.dialog.open, true);
    assert.equal(doc.querySelectorAll('dialog').length, 1);
    next.destroy();
    assert.equal(subscriptions, 0);
    assert.equal(doc.querySelectorAll('.player-diagnostics-trigger,dialog').length, 0);
    h.dom.window.close();
});
test('native diagnostics owns Tab and Escape above the actual page modal stack', async () => {
    const h = harness();
    let closedPlayer = 0, trappedBackground = 0;
    const stack = new MovieDetailsModalStack({ trapFocus: () => { trappedBackground++; } });
    stack.register('video-player', { order: 80, isOpen: () => true, close: () => { closedPlayer++; } });
    const detach = stack.attach(h.window.document);
    await h.panel.open();
    h.panel.copyButton.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    h.panel.copyButton.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(trappedBackground, 0);
    assert.equal(closedPlayer, 0);
    h.panel.dialog.dispatchEvent(new h.window.Event('cancel', { cancelable: true }));
    assert.equal(h.panel.dialog.open, false);
    assert.equal(h.window.document.activeElement, h.panel.button);
    detach(); h.dom.window.close();
});

test('copy exports only closed metrics fields, no arbitrary text or markup', async () => {
    const h = harness({ report: async () => ({ title: 'SECRET', url: 'https://SECRET', counters: [{ providerId: 'animego', type: 'resolveOk', reason: 'unknown', count: 2, uid: 'SECRET' }, { providerId: 'SECRET', type: 'fallback', reason: 'unknown', count: 1 }], ttff: [{ providerId: 'unknown', quality: 'unknown', count: 1, meanMs: 0, title: '<img src=x>' }] }) });
    await h.panel.open();
    assert.match(h.panel.summary.textContent, /Ответов о готовности источника: 2/);
    assert.match(h.panel.summary.textContent, /Измерение недоступно; это не ошибка воспроизведения/);
    assert.equal(h.panel.output.closest('details').open, false, 'technical JSON is secondary to the readable report');
    h.panel.copyButton.click(); await tick();
    assert.ok(h.copied());
    assert.ok(!h.copied().includes('SECRET'));
    assert.ok(!h.copied().includes('<img'));
    assert.equal(JSON.parse(h.copied()).ttff[0].meanMs, null);
    assert.equal(h.panel.dialog.querySelector('img'), null);
    h.panel.destroy(); h.dom.window.close();
});
test('report, copy and reset failures remain inline and recoverable', async () => {
    let fails = true;
    let resets = 0;
    const h = harness({ report: async () => { if (fails) throw Error('PRIVATE'); return { counters: [], ttff: [] }; }, reset: async () => { resets++; return !fails; } });
    await h.panel.open();
    assert.match(h.panel.status.textContent, /Не удалось загрузить/);
    assert.equal(h.panel.copyButton.disabled, true);
    await h.panel.reset();
    assert.match(h.panel.status.textContent, /Не удалось сбросить/);
    fails = false;
    await h.panel.refresh();
    h.window.navigator.clipboard.writeText = async () => { throw Error('PRIVATE'); };
    await h.panel.copy();
    assert.match(h.panel.status.textContent, /Не удалось скопировать/);
    await h.panel.reset();
    assert.equal(resets, 2);
    assert.match(h.panel.status.textContent, /сброшена/);
    assert.equal(h.panel.resetButton.disabled, false);
    h.panel.destroy(); h.dom.window.close();
});
test('destroy invalidates pending report completion', async () => {
    let resolve;
    const h = harness({ report: () => new Promise(done => { resolve = done; }) });
    const pending = h.panel.open();
    h.panel.destroy();
    resolve({ counters: [], ttff: [] });
    await pending;
    assert.equal(h.panel.json, null);
    assert.equal(h.window.document.querySelector('dialog'), null);
    h.dom.window.close();
});

test('real native cleaner menu opens the host dialog and leaves iframe controls on the header fallback', async () => {
    const h = harness();
    const { window, panel } = h;
    try {
        const player = window.document.getElementById('player');
        player.id = 'videoContainer'; player.className = 'video-container';
        player.innerHTML = '<video src="https://fixture.test/movie.mp4"></video>';
        window.chrome = { runtime: { id: 'test', getURL: () => 'data:text/javascript,' } };
        window.ResizeObserver = class { observe() {} disconnect() {} };
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        window.HTMLMediaElement.prototype.pause = () => {};
        window.HTMLMediaElement.prototype.load = () => {};
        // jsdom treats chrome-extension: as an opaque origin; Chrome provides
        // storage there. Supply that browser facility for the real cleaner.
        const storage = new Map();
        Object.defineProperty(window, 'localStorage', { value: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)
        } });
        for (const file of ['src/shared/services/player/PlayerSettingsMenu.js',
            'src/shared/services/player/PlayerMediaControls.js', 'src/shared/services/player/PlayerGhostPreview.js',
            'content-scripts/player-cleaner.js']) {
            window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
        }
        window.MovieExtension_PlayerCleaner._test.replacePlayerForTest(); await tick();
        const gear = player.querySelector('.player-settings-button');
        assert.ok(gear);
        assert.equal(panel.button.hidden, true);
        for (let i = 0; i < 3; i++) {
            gear.click();
            const menu = player.querySelector('.player-settings-menu');
            const item = menu.querySelector('[data-action="diagnostics"]');
            assert.equal(menu.querySelectorAll('[data-action="diagnostics"]').length, 1);
            assert.equal(menu.lastElementChild, item);
            item.click(); await tick();
            assert.equal(panel.dialog.open, true);
            assert.equal(menu.style.display, 'none');
            panel.dialog.close();
            assert.equal(window.document.activeElement, gear);
        }
        window.MovieExtension_PlayerCleaner._test.teardownActiveWrapper();
        player.replaceChildren(window.document.createElement('iframe')); await tick();
        assert.equal(panel.button.hidden, false);
    } finally {
        window.MovieExtension_PlayerCleaner?._test.teardownActiveWrapper();
        panel.destroy(); h.dom.window.close();
    }
});

test('framed settings handshake is scoped to the active iframe, origin and query generation', async () => {
    const h = harness();
    const { window, panel } = h;
    try {
        const player = window.document.getElementById('player');
        const frame = window.document.createElement('iframe');
        frame.src = 'https://api.variyt.ws/embed/kp/301';
        player.append(frame);
        const queries = [];
        frame.contentWindow.postMessage = (data, origin) => queries.push({ data, origin });
        await tick();
        assert.equal(queries.length, 1);
        assert.equal(queries[0].origin, 'https://api.variyt.ws');
        const requestId = queries[0].data.requestId;
        const send = (data, origin = 'https://api.variyt.ws', source = frame.contentWindow) =>
            window.dispatchEvent(new window.MessageEvent('message', { data, origin, source }));
        send({ type: 'PLAYER_DIAGNOSTICS_AVAILABLE', requestId, available: true }, 'https://evil.test');
        send({ type: 'PLAYER_DIAGNOSTICS_AVAILABLE', requestId, available: true }, undefined, window);
        assert.equal(panel.button.hidden, false);
        send({ type: 'PLAYER_DIAGNOSTICS_AVAILABLE', requestId, available: true });
        assert.equal(panel.button.hidden, true);
        send({ type: 'PLAYER_DIAGNOSTICS_OPEN', requestId: requestId - 1 });
        assert.equal(panel.dialog.open, false);
        send({ type: 'PLAYER_DIAGNOSTICS_OPEN', requestId }); await tick();
        assert.equal(panel.dialog.open, true);
        panel.dialog.close();
        frame.src = 'https://api.variyt.ws/embed/kp/302';
        frame.contentWindow.postMessage = (data, origin) => queries.push({ data, origin });
        send({ type: 'PLAYER_DIAGNOSTICS_OPEN', requestId });
        assert.equal(panel.dialog.open, false, 'navigation invalidates old messages immediately');
        await tick();
        const nextId = queries.at(-1).data.requestId;
        assert.notEqual(nextId, requestId);
        assert.equal(panel.button.hidden, false);
        send({ type: 'PLAYER_DIAGNOSTICS_AVAILABLE', requestId, available: true });
        assert.equal(panel.button.hidden, false);
        send({ type: 'PLAYER_DIAGNOSTICS_AVAILABLE', requestId: nextId, available: true });
        assert.equal(panel.button.hidden, true);
        send({ type: 'PLAYER_DIAGNOSTICS_AVAILABLE', requestId: nextId, available: false });
        assert.equal(panel.button.hidden, false, 'destroyed framed controls restore the header fallback');
        player.replaceChildren(); await tick();
        send({ type: 'PLAYER_DIAGNOSTICS_OPEN', requestId: nextId });
        assert.equal(panel.dialog.open, false);
    } finally { panel.destroy(); h.dom.window.close(); }
});

test('real provider cleaner requires a trusted host opt-in and sends only the diagnostics action', async () => {
    const dom = new JSDOM('<div id="videoContainer"><video src="https://fixture.test/movie.mp4"></video></div>', {
        url: 'https://api.variyt.ws/embed/kp/301', runScripts: 'outside-only',
        pretendToBeVisual: true, virtualConsole: new VirtualConsole()
    });
    const { window } = dom;
    const messages = [];
    const host = { postMessage: (data, origin) => messages.push({ data, origin }) };
    Object.defineProperty(window, 'parent', { value: host });
    window.chrome = { runtime: { id: 'test', getURL: () => 'data:text/javascript,' } };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    window.HTMLMediaElement.prototype.pause = () => {};
    window.HTMLMediaElement.prototype.load = () => {};
    try {
        for (const file of ['src/shared/services/player/PlayerSettingsMenu.js',
            'src/shared/services/player/PlayerMediaControls.js', 'src/shared/services/player/PlayerGhostPreview.js',
            'content-scripts/player-cleaner.js']) {
            window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
        }
        const hooks = window.MovieExtension_PlayerCleaner._test;
        hooks.replacePlayerForTest(); await tick();
        const gear = window.document.querySelector('.player-settings-button');
        const query = (source, origin) => window.dispatchEvent(new window.MessageEvent('message', {
            source, origin, data: { type: 'PLAYER_DIAGNOSTICS_QUERY', requestId: 123 }
        }));
        query(host, 'https://evil.test'); query(window, 'chrome-extension://test');
        gear.click();
        assert.equal(window.document.querySelector('[data-action="diagnostics"]'), null);
        gear.click();
        query(host, 'chrome-extension://test');
        assert.ok(window.document.querySelector('[data-action="diagnostics"]'), 'the item exists before availability is acknowledged');
        assert.ok(messages.some(item => item.data.type === 'PLAYER_DIAGNOSTICS_AVAILABLE'
            && item.data.requestId === 123 && item.data.available === true && item.origin === 'chrome-extension://test'));
        gear.click();
        const item = window.document.querySelector('[data-action="diagnostics"]');
        assert.ok(item); item.click();
        assert.equal(item.parentElement.style.display, 'none');
        assert.equal(messages.at(-1).data.type, 'PLAYER_DIAGNOSTICS_OPEN');
        assert.equal(messages.at(-1).data.requestId, 123);
        assert.equal(window.document.querySelector('dialog'), null, 'only the extension host owns the report');
        hooks.teardownActiveWrapper();
        assert.equal(messages.at(-1).data.available, false);
    } finally {
        window.MovieExtension_PlayerCleaner?._test.teardownActiveWrapper(); dom.window.close();
    }
});
