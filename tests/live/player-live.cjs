#!/usr/bin/env node
/**
 * Plays real films in the owner's running Chrome: their extension build, profile, sign-in,
 * blocker and network. The rig in tests/e2e cannot see what only that browser sees, and it
 * passed through a provider outage that left this one with no working source.
 *
 * Needs Chrome's own switch, once per Chrome start: chrome://inspect/#remote-debugging.
 * Chrome asks the owner to allow the connection. With a bridge already connected
 * (`npm run live:bridge`), the run goes through it and Chrome does not ask again.
 * Tests work in their own windows, read only
 * this extension's pages and frames, and put back what they change: the title's last source,
 * source preference and watch positions, and the local source-health counters, so each title
 * starts from the default order. Nothing is written to Firestore by playing. A provider
 * frame keeps its own position in that site's storage, out of reach here, so a title played in
 * a frame may later resume on that frame where the test stopped.
 *
 *   npm run test:live:player                      the three standard titles
 *   npm run test:live:player -- 301 404900        these titles
 *   npm run test:live:player -- --reload          reload the extension first; this closes its open tabs
 */
const fs = require('node:fs');
const path = require('node:path');
const { connectThroughBridge } = require('./chrome-bridge.cjs');

const EXTENSION_ID = 'dgdejomdgiabgcfijcdhjefijdfiemhd';
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const PORT_FILE = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'DevToolsActivePort');
const OUTPUT = path.join(__dirname, '..', '..', '.e2e-output', 'live');
const DEFAULT_TITLES = [258687, 404900, 5401195]; // a film, a series, an anime
const CONNECT_LIMIT_MS = 180000;
const START_LIMIT_MS = 40000;
const SOURCE_LIMIT_MS = 25000;
const POLL_MS = 500;
// The order of sources follows these counters, so a test's failures must not stay in them.
const SOURCE_HEALTH_KEY = 'movieExtension.playerMetricsV1';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Chrome {
    constructor() {
        this.nextId = 1;
        this.pending = new Map();
        this.frames = new Map(); // child sessionId -> { parent }
    }

    async connect() {
        if (!fs.existsSync(PORT_FILE)) {
            throw new Error('Remote debugging is off. Open chrome://inspect/#remote-debugging in Chrome and turn it on.');
        }
        const [port, socketPath] = fs.readFileSync(PORT_FILE, 'utf8').trim().split(/\r?\n/);
        console.log('Connecting to Chrome. If it asks, press Allow.');
        // A connection can fail while Chrome's question is still open, so the answer may take a few tries.
        const deadline = Date.now() + CONNECT_LIMIT_MS;
        for (;;) {
            try {
                this.socket = await new Promise((resolve, reject) => {
                    const socket = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
                    socket.onopen = () => resolve(socket);
                    socket.onerror = () => reject(new Error('Chrome did not allow the connection. Answer its question and run this again.'));
                });
                break;
            } catch (error) {
                if (Date.now() > deadline) throw error;
                await sleep(3000);
            }
        }
        this.socket.onmessage = event => this.receive(JSON.parse(event.data));
    }

    receive(message) {
        if (message.id) {
            const entry = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) entry?.reject(new Error(`${entry.method}: ${message.error.message}`));
            else entry?.resolve(message.result);
        } else if (message.method === 'Target.attachedToTarget' && message.sessionId) {
            const { sessionId } = message.params;
            this.frames.set(sessionId, { parent: message.sessionId });
        } else if (message.method === 'Target.detachedFromTarget') {
            this.frames.delete(message.params.sessionId);
        }
    }

    send(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
            this.pending.set(id, {
                method,
                resolve: value => { clearTimeout(timer); resolve(value); },
                reject: error => { clearTimeout(timer); reject(error); }
            });
            this.socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
        });
    }

    async evaluate(sessionId, expression) {
        const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
        return result.value;
    }

    close() { this.socket?.close(); }
}

/** One title open in its own window. */
class TitlePage {
    constructor(chrome, id) { this.chrome = chrome; this.id = id; }

    async open() {
        const { chrome } = this;
        const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank', newWindow: true, width: 1500, height: 950 });
        this.targetId = targetId;
        this.session = (await chrome.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
        await chrome.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, this.session);
        await chrome.send('Page.navigate', { url: `${ORIGIN}/src/pages/movie-details/movie-details.html?movieId=${this.id}` }, this.session);
        await this.waitFor(`Boolean([...document.querySelectorAll('.watch-movie-btn')].find(node => node.getBoundingClientRect().width > 0))`, 30000);
        await this.eval(`(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.update(tab.id, { muted: true }); })()`);
        this.title = await this.eval('document.title.split(" — ")[0]');
    }

    eval(expression) { return this.chrome.evaluate(this.session, expression); }

    async waitFor(expression, limit) {
        const deadline = Date.now() + limit;
        for (;;) {
            try { if (await this.eval(expression)) return true; } catch { /* The page is still arriving. */ }
            if (Date.now() > deadline) return false;
            await sleep(POLL_MS);
        }
    }

    /** The page keeps one position per title and, for a series, one per episode. */
    get isPositionKey() { return `key => /^movieExtension_progress_movie_${this.id}(?:_|$)/.test(key)`; }

    /** What the title's previous viewing left, so this run starts clean and can put it back. */
    async setAside() {
        this.kept = await this.eval(`(async () => {
            const keys = [...['watching_progress_', 'lastSource_', 'watchPrefs_'].map(prefix => prefix + ${this.id}), ${JSON.stringify(SOURCE_HEALTH_KEY)}];
            const stored = await chrome.storage.local.get(keys);
            await chrome.storage.local.remove(keys);
            const positions = {};
            for (const key of Object.keys(localStorage).filter(${this.isPositionKey})) {
                positions[key] = localStorage.getItem(key);
                localStorage.removeItem(key);
            }
            return { keys, stored, positions };
        })()`);
    }

    /** Leaves the player first: it saves its position while it goes away. */
    async putBack() {
        await this.chrome.send('Page.navigate', { url: `${ORIGIN}/src/pages/update/update_instructions.html` }, this.session);
        await this.waitFor(`location.pathname.endsWith('update_instructions.html') && document.readyState === 'complete'`, 10000);
        await this.eval(`(async () => {
            const kept = ${JSON.stringify(this.kept)};
            await chrome.storage.local.remove(kept.keys);
            await chrome.storage.local.set(kept.stored);
            Object.keys(localStorage).filter(${this.isPositionKey}).forEach(key => localStorage.removeItem(key));
            Object.entries(kept.positions).forEach(([key, value]) => localStorage.setItem(key, value));
        })()`);
    }

    async click(selector) {
        const point = await this.eval(`(() => {
            const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => item.getBoundingClientRect().width > 0);
            if (!node) return null;
            node.scrollIntoView({ block: 'center', inline: 'nearest' });
            const box = node.getBoundingClientRect();
            return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
        })()`);
        if (!point) return false;
        await sleep(150);
        const mouse = (type, extra = {}) => this.chrome.send('Input.dispatchMouseEvent', { type, ...point, ...extra }, this.session);
        await mouse('mouseMoved');
        await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 });
        await mouse('mouseReleased', { button: 'left', clickCount: 1 });
        return true;
    }

    async pickSource(value) {
        await this.click('#sourcePopoverToggle');
        await sleep(250);
        return this.click(`.source-btn[data-value="${value}"]`);
    }

    sources() { return this.eval(`[...document.querySelectorAll('.source-btn')].map(node => node.dataset.value)`); }

    /** The playing video, wherever it lives: this page or a provider's frame. */
    async video() {
        const read = find => `(() => {
            const video = ${find};
            if (!video) return null;
            return { src: video.currentSrc, t: video.currentTime, d: Number.isFinite(video.duration) ? video.duration : 0, w: video.videoWidth, h: video.videoHeight,
                paused: video.paused, frames: video.getVideoPlaybackQuality?.().totalVideoFrames || 0 };
        })()`;
        const local = await this.eval(read(`document.querySelector('#videoContainer video')`));
        if (local) return { where: 'page', ...local };
        const frame = await this.eval(`(() => { const node = document.querySelector('#videoContainer iframe'); try { return node ? new URL(node.src).host : null; } catch { return null; } })()`);
        if (!frame) return null;
        // A frame still loading when it was attached reports no address, so each one is asked.
        const inFrame = read(`location.host === ${JSON.stringify(frame)} && ([...document.querySelectorAll('video')].find(item => item.currentSrc) || document.querySelector('video'))`);
        for (const [sessionId, info] of this.chrome.frames) {
            if (info.parent !== this.session) continue;
            const value = await this.chrome.evaluate(sessionId, inFrame).catch(() => null);
            if (value) return { where: frame, ...value };
        }
        return null;
    }

    /** Playing means frames being decoded while time moves: a «ready» state proves nothing. */
    async waitForPlayback(limit, { differentFrom = null } = {}) {
        const started = Date.now();
        let previous = null;
        let moving = 0;
        while (Date.now() - started < limit) {
            const video = await this.video().catch(() => null);
            // Episodes can have one length and one address, so a new one also shows as time starting over.
            const isOtherVideo = !differentFrom || !video || video.where !== differentFrom.where || video.src !== differentFrom.src
                || Math.abs(video.d - differentFrom.d) > 1 || video.t < differentFrom.t;
            if (video && previous && isOtherVideo && !video.paused && video.w > 0 && video.t > previous.t && video.frames > previous.frames) moving += 1;
            else moving = 0;
            previous = video;
            if (moving >= 3) return { ok: true, seconds: (Date.now() - started) / 1000 - (POLL_MS * 3) / 1000, video };
            await sleep(POLL_MS);
        }
        // Chrome loads no media for a hidden page that has played nothing yet, so this result would say nothing about the source.
        const [state, visibility] = await this.eval(`[document.getElementById('videoContainer')?.dataset?.sourceState, document.visibilityState]`).catch(() => []);
        return { ok: false, seconds: limit / 1000, video: previous, state: visibility === 'hidden' ? `${state}, window hidden` : state };
    }

    async shot(name) {
        fs.mkdirSync(OUTPUT, { recursive: true });
        const { data } = await this.chrome.send('Page.captureScreenshot', { format: 'png' }, this.session);
        fs.writeFileSync(path.join(OUTPUT, `${name}.png`), Buffer.from(data, 'base64'));
    }

    close() { return this.chrome.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {}); }
}

const rows = [];
function record(title, step, result) {
    const video = result.video;
    rows.push({
        title, step,
        result: result.ok ? 'plays' : `no: ${result.state || 'nothing'}`,
        start: result.ok ? `${result.seconds.toFixed(1)} s` : '',
        size: video?.w ? `${video.w}x${video.h}` : '',
        length: video?.d ? `${Math.round(video.d / 60)} min` : '',
        frame: video?.where || ''
    });
    const row = rows.at(-1);
    console.log(`  ${row.result.padEnd(14)} ${step.padEnd(28)} ${row.start.padEnd(8)} ${row.size.padEnd(10)} ${row.length.padEnd(8)} ${row.frame}`);
}

async function runTitle(chrome, id) {
    const page = new TitlePage(chrome, id);
    await page.open();
    await page.setAside();
    console.log(`\n${page.title} (${id})`);
    let played = false;
    try {
        await page.click('.watch-movie-btn');
        const first = await page.waitForPlayback(START_LIMIT_MS);
        record(page.title, '«Смотреть», one press', first);
        await page.shot(`${id}-watch`);
        played = first.ok;

        if (await page.eval(`Boolean(document.getElementById('playerNextEpisodeBtn')?.getBoundingClientRect().width)`)) {
            const before = await page.video();
            await page.click('#playerNextEpisodeBtn');
            await sleep(1000);
            const next = await page.waitForPlayback(SOURCE_LIMIT_MS, { differentFrom: before });
            record(page.title, '«Следующая»', next);
            await page.shot(`${id}-next`);
        }

        for (const value of await page.sources()) {
            if (await page.eval(`document.querySelector('.source-btn[data-value="${value}"]')?.classList.contains('active')`)) continue;
            await page.pickSource(value);
            await sleep(800);
            const result = await page.waitForPlayback(SOURCE_LIMIT_MS);
            record(page.title, value.split(':').slice(0, 2).join(':'), result);
            await page.shot(`${id}-${value.replace(/\W+/g, '-')}`);
            played ||= result.ok;
        }
    } finally {
        await page.putBack().catch(error => console.warn(`  Could not put back ${id}: ${error.message}`));
        await page.close();
    }
    return played;
}

async function reloadExtension(chrome) {
    console.log('Reloading the extension.');
    const page = new TitlePage(chrome, 0);
    const { targetId } = await chrome.send('Target.createTarget', { url: `${ORIGIN}/src/pages/update/update_instructions.html`, newWindow: true, width: 500, height: 400 });
    page.session = (await chrome.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await sleep(800);
    await page.eval(`(setTimeout(() => chrome.runtime.reload(), 50), 'reloading')`);
    await sleep(3000);
    await chrome.send('Target.closeTarget', { targetId }).catch(() => {});
}

(async () => {
    const args = process.argv.slice(2);
    const titles = args.filter(arg => /^\d+$/.test(arg)).map(Number);
    // A connected bridge already holds the owner's one Allow for this task.
    const bridged = await connectThroughBridge();
    const chrome = bridged || new Chrome();
    if (bridged) console.log('Using the connected bridge; Chrome does not ask again.');
    else await chrome.connect();
    if (args.includes('--reload')) await reloadExtension(chrome);
    const results = [];
    for (const id of titles.length ? titles : DEFAULT_TITLES) results.push(await runTitle(chrome, id));
    chrome.close();
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, 'summary.json'), JSON.stringify(rows, null, 2));
    console.log(`\nScreenshots and summary: ${OUTPUT}. Look at them: frames and time say a video runs, not that it looks right.`);
    if (results.some(played => !played)) {
        console.error('A title has no source that plays.');
        process.exitCode = 1;
    }
})().catch(error => { console.error(error.message); process.exit(2); });
