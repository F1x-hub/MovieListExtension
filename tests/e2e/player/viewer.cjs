/**
 * What a person watching does and sees, on real providers: real clicks, and the
 * <video> elements as the browser holds them, inside provider frames as well.
 * A source counts as playing only when frames are being decoded, time is moving
 * and the length matches the film. A "ready" state alone proves nothing.
 */
const fs = require('node:fs');
const path = require('node:path');
const { test: base, expect } = require('../lib/fixtures.cjs');
const { installFilmCards } = require('../lib/externalWorld.cjs');
const { startFilmstrip, renderFilmstrip } = require('../lib/filmstrip.cjs');
const { OUTPUT_DIR } = require('../lib/config.cjs');
const { ALL_FILMS } = require('./films.cjs');

const SUMMARY_FILE = path.join(OUTPUT_DIR, 'player-rows.jsonl');
const CONTAINER = '#videoContainer';
const FAILED_STATES = ['unavailable', 'error'];
const FIRST_PRESS_AFTER_READY_MS = 3000;
const NEXT_PRESS_AFTER_MS = 9000;
const MAX_PRESSES = 4;
const WRONG_LENGTH_AFTER_MS = 30000;
// Time moving this long, with no ad on screen, is the film and not a first flicker.
const MOVING_FOR_MS = 2500;
const LONGEST_ADS_MS = 150000;
// A pre-roll is a short video of its own; a trailer or a wrong film is longer than this.
const LONGEST_PRE_ROLL_SECONDS = 120;
// The two proxies are answered inside the test; nothing else there may ever answer.
const ALLOWED_PRODUCTION_PATH = /^\/(tmdbProxy|kinopoiskProxy)/;
const PRODUCTION_HOST = /(^|\.)(firebaseio\.com|firebaseapp\.com|firebasestorage\.app|cloudfunctions\.net|web\.app)$|^(firestore|identitytoolkit|securetoken|firebaseinstallations|firebasestorage)\.googleapis\.com$/;
// The extension's own temporary session tab, documented in the README. It must close.
const OWN_TEMPORARY_TAB = /^https:\/\/hdrezka\.co\//;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Runs in each frame. Preview decoders are never what the viewer is watching. */
function readVideosInFrame() {
    return [...document.querySelectorAll('video')]
        .filter(video => video.dataset.ghost !== 'true')
        .map(video => {
            const box = video.getBoundingClientRect();
            const quality = video.getVideoPlaybackQuality?.();
            return {
                currentTime: video.currentTime,
                duration: Number.isFinite(video.duration) ? video.duration : 0,
                paused: video.paused,
                ended: video.ended,
                seeking: video.seeking,
                readyState: video.readyState,
                width: video.videoWidth,
                height: video.videoHeight,
                decoded: quality?.totalVideoFrames ?? 0,
                dropped: quality?.droppedVideoFrames ?? 0,
                muted: video.muted,
                volume: video.volume,
                error: video.error?.code ?? null,
                shown: box.width > 0 && box.height > 0 && getComputedStyle(video).visibility !== 'hidden',
                inPlayer: location.protocol !== 'chrome-extension:' || Boolean(video.closest('#videoContainer'))
            };
        });
}

/** A hidden preloaded frame can hold a video too; only the player's visible frame counts. */
async function frameIsInPlayer(frame) {
    let current = frame;
    while (current.parentFrame()) {
        const element = await current.frameElement();
        const atTop = !current.parentFrame().parentFrame();
        const shown = await element.evaluate((node, selector) => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden'
                && (!selector || Boolean(node.closest(selector)));
        }, atTop ? CONTAINER : null);
        if (!shown) return false;
        current = current.parentFrame();
    }
    return true;
}

function lengthFits(duration, film) {
    const expected = film.runtimeMinutes * 60;
    return duration >= expected * (1 - film.lengthTolerance) && duration <= expected * (1 + film.lengthTolerance);
}

/** Kodik covers its player with a layer that holds the ad; its text comes and goes. */
function readAdInFrame() {
    const layer = document.querySelector('.creative-player');
    return Boolean(layer && layer.getBoundingClientRect().width > 0)
        || /Реклам[аыу]|Advertisement/i.test(document.body?.innerText || '');
}

/** Black or frozen: a viewer sees no film, whatever the element reports. */
function judgePicture({ brightest, largestChange }) {
    return brightest >= 3 && largestChange >= 0.3;
}

class Viewer {
    constructor(page, extension, testInfo) {
        this.page = page;
        this.extension = extension;
        this.testInfo = testInfo;
        this.rows = [];
        this.film = null;
        this.foreignTabs = [];
        this.productionHits = [];
        this.failedMedia = new Map();
        this.blockedByUblock = new Map();
        // A provider's frame answered with an error: its page may well be empty.
        this.refusedFrames = new Map();
        extension.context.on('requestfailed', request => {
            if (request.failure()?.errorText !== 'net::ERR_BLOCKED_BY_CLIENT') return;
            try {
                const { hostname } = new URL(request.url());
                this.blockedByUblock.set(hostname, (this.blockedByUblock.get(hostname) || 0) + 1);
            } catch { /* Not a URL worth reporting. */ }
        });
        extension.context.on('page', async opened => {
            // The test's own helper pages draw filmstrips; they are not the product's doing.
            if (this.openingHelperPages) return;
            await opened.waitForLoadState('commit', { timeout: 5000 }).catch(() => {});
            const url = opened.url();
            if (url && !url.startsWith('chrome-extension://') && !OWN_TEMPORARY_TAB.test(url)) this.foreignTabs.push(url.slice(0, 120));
        });
        extension.context.on('response', response => {
            try {
                const url = new URL(response.url());
                if (PRODUCTION_HOST.test(url.hostname) && !ALLOWED_PRODUCTION_PATH.test(url.pathname)) this.productionHits.push(url.hostname + url.pathname);
                if (response.status() >= 400 && response.frame?.() !== this.page.mainFrame()
                    && response.request().isNavigationRequest() && response.request().resourceType() === 'document') {
                    this.refusedFrames.set(url.hostname, response.status());
                }
                if (response.status() >= 400 && /\.(m3u8|ts|m4s|mp4)(\?|$)/.test(url.pathname)) {
                    const key = `${response.status()} ${url.hostname}`;
                    this.failedMedia.set(key, (this.failedMedia.get(key) || 0) + 1);
                }
            } catch { /* Not a URL worth reporting. */ }
        });
    }

    get videoArea() {
        return this.page.locator(CONTAINER);
    }

    async open(film) {
        this.film = film;
        const started = Date.now();
        await this.page.goto(this.extension.url(`src/pages/movie-details/movie-details.html?movieId=${film.id}`));
        await expect(this.page.locator('h1.movie-detail-page-title')).toHaveText(film.name, { timeout: 60000 });
        await expect(this.page.locator('.watch-movie-btn').first()).toBeVisible();
        return Date.now() - started;
    }

    /** Every playing candidate the viewer could actually be seeing or hearing. */
    async videos() {
        const found = [];
        for (const frame of this.page.frames()) {
            try {
                const list = await frame.evaluate(readVideosInFrame);
                if (!list.length || !await frameIsInPlayer(frame)) continue;
                list.filter(video => video.shown && video.inPlayer).forEach((video, index) => found.push({
                    ...video,
                    id: `${frame.name() || frame.url().slice(0, 60)}#${index}`,
                    host: frame === this.page.mainFrame() ? 'extension' : new URL(frame.url()).hostname
                }));
            } catch { /* The frame went away between listing and asking. */ }
        }
        return found;
    }

    /** The one being watched: a placeholder or an ad is shorter than the film. */
    async mainVideo() {
        const videos = await this.videos();
        return videos.sort((a, b) => b.duration - a.duration)[0] || null;
    }

    /** Every video in every frame, hidden ones too: what could still be heard. */
    async everyVideo() {
        const found = [];
        for (const frame of this.page.frames()) {
            try {
                (await frame.evaluate(readVideosInFrame)).forEach((video, index) => found.push({ ...video, id: `${frame.url().slice(0, 80)}#${index}` }));
            } catch { /* The frame went away between listing and asking. */ }
        }
        return found;
    }

    /** Whatever is really running right now, wherever it is. */
    async allPlaying() {
        const before = await this.everyVideo();
        await wait(700);
        const after = await this.everyVideo();
        return after.filter(video => !video.paused && before.some(old => old.id === video.id && video.currentTime > old.currentTime));
    }

    /** A provider's ad in the player. A press now would land on the advertiser's link. */
    async adShowing() {
        for (const frame of this.page.frames()) {
            if (frame === this.page.mainFrame()) continue;
            try {
                if (await frame.evaluate(readAdInFrame) && await frameIsInPlayer(frame)) return true;
            } catch { /* The frame went away between listing and asking. */ }
        }
        return false;
    }

    /** Sits through ads as a viewer has to. @returns {Promise<number>} Seconds spent. */
    async waitOutAds() {
        const startedAt = Date.now();
        while (await this.adShowing() && Date.now() - startedAt < LONGEST_ADS_MS) await wait(500);
        return (Date.now() - startedAt) / 1000;
    }

    async sourceState() {
        return this.videoArea.evaluate(node => ({
            state: node.dataset.sourceState || '',
            message: node.querySelector('.player-source-message, [data-role="message"]')?.textContent.trim()
                || (['unavailable', 'error'].includes(node.dataset.sourceState) ? node.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : '')
        })).catch(() => ({ state: '', message: '' }));
    }

    async sources() {
        return this.page.locator('.source-btn').evaluateAll(nodes => nodes.map(node => ({
            value: node.dataset.value,
            name: node.textContent.replace(/\s+/g, ' ').split(',')[0].split('—')[0].trim(),
            label: node.textContent.replace(/\s+/g, ' ').trim(),
            active: node.classList.contains('active')
        })));
    }

    async activeSource() {
        return (await this.sources()).find(source => source.active) || null;
    }

    /** Remembers each change of the source's state, with its time, from the moment of a press. */
    async startStateLog() {
        await this.page.evaluate(selector => {
            const node = document.querySelector(selector);
            globalThis.__e2eSourceObserver?.disconnect();
            const log = globalThis.__e2eSourceLog = [];
            const observer = new MutationObserver(() => {
                const state = node.dataset.sourceState || '';
                if (log.at(-1)?.state !== state) log.push({ at: Date.now(), state });
            });
            observer.observe(node, { attributes: true, attributeFilter: ['data-source-state'] });
            globalThis.__e2eSourceObserver = observer;
        }, CONTAINER);
    }

    readStateLog() {
        return this.page.evaluate(() => globalThis.__e2eSourceLog || []);
    }

    async pressWatch() {
        await this.page.locator('.watch-movie-btn').first().click();
    }

    async switchTo(source) {
        await this.page.locator('#sourcePopoverToggle').click();
        await this.page.locator(`.source-btn[data-value="${source.value}"]`).click();
    }

    async pressPicture() {
        const box = await this.videoArea.boundingBox();
        await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    /**
     * Presses play the way a person does: only when nothing is moving and something
     * is paused or missing, and again if the press changed nothing.
     */
    async playAsViewer(film, { limitMs = 75000, stateLogStartedAt = Date.now(), requested = true } = {}) {
        const result = { presses: 0, outcome: 'no-video', message: '', sawShortVideo: false, adSeconds: 0 };
        const elapsed = () => Date.now() - stateLogStartedAt;
        let nextPressAt = null;
        let previous = null;
        let wrongSince = null;
        let movingSince = null;
        while (elapsed() < limitMs + result.adSeconds * 1000) {
            if (await this.adShowing()) {
                result.adSeconds += await this.waitOutAds();
                previous = null;
                movingSince = null;
                nextPressAt = Date.now() + FIRST_PRESS_AFTER_READY_MS;
                continue;
            }
            const { state, message } = await this.sourceState();
            if (state === 'ready' && nextPressAt === null) nextPressAt = Date.now() + FIRST_PRESS_AFTER_READY_MS;
            // Without an explicit choice the page moves on to the next source by itself.
            if (FAILED_STATES.includes(state) && requested) return { ...result, outcome: 'unavailable', message };
            const current = await this.mainVideo();
            const moving = Boolean(current && previous && current.id === previous.id && !current.paused
                && current.decoded > previous.decoded && current.currentTime > previous.currentTime);
            previous = current;
            if (moving) {
                movingSince ??= Date.now();
                if (lengthFits(current.duration, film)) {
                    // Where the viewer joins the film: a provider's ad may run over the start of it.
                    if (Date.now() - movingSince >= MOVING_FOR_MS) return { ...result, outcome: 'plays', firstFrameMs: elapsed() - MOVING_FOR_MS, joinedAtSeconds: current.currentTime - MOVING_FOR_MS / 1000, video: current };
                    await wait(250);
                    continue;
                }
                result.lastDuration = current.duration;
                nextPressAt = Date.now() + FIRST_PRESS_AFTER_READY_MS;
                if (current.duration > 0 && current.duration <= LONGEST_PRE_ROLL_SECONDS) {
                    // Not an element an ad layer announces, but an ad all the same: it runs out.
                    const startedAt = Date.now();
                    while (Date.now() - startedAt < LONGEST_ADS_MS) {
                        const video = await this.mainVideo();
                        if (!video || video.duration > LONGEST_PRE_ROLL_SECONDS || video.ended) break;
                        if (video.paused && result.presses < MAX_PRESSES) {
                            await this.pressPicture();
                            result.presses++;
                        }
                        await wait(1000);
                    }
                    result.adSeconds += (Date.now() - startedAt) / 1000;
                    result.sawShortVideo = true;
                    previous = null;
                    movingSince = null;
                    continue;
                }
                wrongSince ??= Date.now();
                if (Date.now() - wrongSince > WRONG_LENGTH_AFTER_MS) return { ...result, outcome: 'wrong-length', video: current };
            } else {
                wrongSince = null;
                movingSince = null;
                // Over an error the centre holds its buttons, and the page is moving on by itself.
                if (state === 'ready' && nextPressAt && Date.now() >= nextPressAt && result.presses < MAX_PRESSES && (!current || current.paused)) {
                    await this.pressPicture();
                    result.presses++;
                    nextPressAt = Date.now() + NEXT_PRESS_AFTER_MS;
                }
            }
            await wait(250);
        }
        const last = await this.mainVideo();
        return { ...result, video: last, outcome: last ? 'not-moving' : 'no-video' };
    }

    /** Watches for a while: is it still moving, does it stall, is one picture playing? */
    async watch(seconds = 10) {
        const first = await this.mainVideo();
        const shots = [];
        let stalls = 0;
        let last = first;
        let mostPlayingTogether = 0;
        for (let second = 0; second < seconds; second++) {
            if (second % Math.ceil(seconds / 4) === 0) shots.push(await this.shootTopOfPicture());
            await wait(1000);
            const videos = await this.videos();
            mostPlayingTogether = Math.max(mostPlayingTogether, videos.filter(video => !video.paused && !video.ended && video.readyState >= 3).length);
            const now = videos.find(video => video.id === first?.id) || videos[0] || null;
            if (now && last && now.currentTime <= last.currentTime && !now.paused) stalls++;
            last = now || last;
        }
        shots.push(await this.shootTopOfPicture());
        return {
            shots,
            stalls,
            mostPlayingTogether,
            advanced: first && last ? last.currentTime - first.currentTime : 0,
            decoded: first && last ? last.decoded - first.decoded : 0,
            dropped: last?.dropped ?? 0,
            width: last?.width ?? 0,
            height: last?.height ?? 0,
            duration: last?.duration ?? 0,
            host: last?.host ?? ''
        };
    }

    /** Above the centre button and the dock, whose changes must not count as a moving picture. */
    async shootTopOfPicture() {
        const box = await this.videoArea.boundingBox();
        return this.page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: Math.round(box.height * 0.4) } }).catch(() => null);
    }

    async shot(name) {
        const file = this.testInfo.outputPath(`${name}.png`);
        await this.page.screenshot({ path: file });
        await this.testInfo.attach(`${name}.png`, { path: file, contentType: 'image/png' });
    }

    /** Presses, waits for a picture and watches it; returns one row of the report. */
    async checkSource(film, { source = null, filmstrip = true, watchSeconds = 10 } = {}) {
        await this.startStateLog();
        const pressedAt = Date.now();
        const strip = filmstrip ? await startFilmstrip(this.page) : null;
        if (source) await this.switchTo(source);
        else await this.pressWatch();
        const played = await this.playAsViewer(film, { stateLogStartedAt: pressedAt, requested: Boolean(source) });
        const painted = strip ? await strip.stop() : [];
        const active = await this.activeSource();
        const log = await this.readStateLog();
        const ready = log.find(entry => entry.state === 'ready');
        const name = source?.name || active?.name || 'Смотреть';
        const row = {
            title: film.name,
            source: name,
            value: source?.value || active?.value || '',
            outcome: played.outcome,
            message: played.message,
            readyAfterSeconds: ready ? round((ready.at - pressedAt) / 1000) : null,
            firstFrameAfterSeconds: played.firstFrameMs ? round(played.firstFrameMs / 1000) : null,
            presses: played.presses,
            adSeconds: played.adSeconds ? round(played.adSeconds) : 0,
            joinedAtSeconds: played.joinedAtSeconds === undefined ? null : Math.max(0, Math.round(played.joinedAtSeconds)),
            sawShortVideo: played.sawShortVideo,
            minutes: played.video ? round(played.video.duration / 60) : (played.lastDuration ? round(played.lastDuration / 60) : null),
            states: log.map(entry => entry.state).join(' → '),
            filmstrip: painted
        };
        const fileName = name.replace(/[^\p{L}\p{N}]+/gu, '-');
        if (['no-video', 'not-moving'].includes(row.outcome)) {
            const frameElement = await this.videoArea.locator('iframe').first().elementHandle({ timeout: 1000 }).catch(() => null);
            const frame = frameElement ? await frameElement.contentFrame().catch(() => null) : null;
            const host = frame?.url() ? new URL(frame.url()).hostname : null;
            if (host && this.refusedFrames.has(host)) {
                row.outcome = 'provider-refused';
                row.message = `${host} answered HTTP ${this.refusedFrames.get(host)}, yet the player calls the source ready`;
            }
        }
        if (played.outcome === 'plays') {
            const watched = await this.watch(watchSeconds);
            Object.assign(row, {
                host: watched.host,
                resolution: watched.width ? `${watched.width}×${watched.height}` : '',
                advancedSeconds: round(watched.advanced),
                stalls: watched.stalls,
                droppedFrames: watched.dropped,
                mostPlayingTogether: watched.mostPlayingTogether,
                shots: watched.shots
            });
            if (watched.advanced < watchSeconds * 0.5) row.outcome = 'not-moving';
            await this.showControls();
        }
        await this.shot(`${fileName}-${row.outcome}`);
        if (row.outcome !== 'plays') {
            const framesFile = this.testInfo.outputPath(`${fileName}-frames.json`);
            fs.writeFileSync(framesFile, JSON.stringify(await this.describeFrames(), null, 2));
            await this.testInfo.attach(`${fileName}-frames.json`, { path: framesFile, contentType: 'application/json' });
        }
        this.rows.push(row);
        return row;
    }

    /** What each frame really holds, kept with a failure so it can be understood later. */
    async describeFrames() {
        const described = [];
        for (const frame of this.page.frames()) {
            try {
                described.push({
                    inPlayer: await frameIsInPlayer(frame).catch(() => false),
                    ...await frame.evaluate(() => ({
                        url: location.origin + location.pathname.slice(0, 60),
                        title: document.title.slice(0, 80),
                        html: (document.body?.innerHTML || '').replace(/s+/g, ' ').slice(0, 300),
                        visibility: document.visibilityState,
                        focused: document.hasFocus(),
                        text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
                        controls: Boolean(document.querySelector('.player-control-dock')),
                        challenge: Boolean(document.querySelector('.cf-turnstile, #challenge-form, [src*="challenges.cloudflare"]')),
                        videos: [...document.querySelectorAll('video')].map(video => {
                            const box = video.getBoundingClientRect();
                            const style = getComputedStyle(video);
                            return {
                                className: String(video.className).slice(0, 40),
                                ghost: video.dataset.ghost === 'true',
                                duration: Math.round(video.duration || 0),
                                time: Math.round(video.currentTime * 10) / 10,
                                paused: video.paused,
                                readyState: video.readyState,
                                networkState: video.networkState,
                                error: video.error?.code ?? null,
                                decoded: video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
                                box: `${Math.round(box.width)}×${Math.round(box.height)}`,
                                visibility: style.visibility,
                                display: style.display,
                                opacity: style.opacity
                            };
                        })
                    }))
                });
            } catch (error) {
                described.push({ url: frame.url().slice(0, 80), unreadable: error.message.slice(0, 80) });
            }
        }
        return described.filter(frame => frame.unreadable || frame.inPlayer || frame.controls || frame.videos?.length || frame.challenge);
    }

    /** For checks about the player itself: whichever source shows the film today. */
    async playAnySource(film) {
        const first = await this.checkSource(film, { filmstrip: false, watchSeconds: 3 });
        if (first.outcome === 'plays') return first;
        for (const source of await this.sources()) {
            if (source.active || source.value.startsWith('mediaplayer')) continue;
            const row = await this.checkSource(film, { source, filmstrip: false, watchSeconds: 3 });
            if (row.outcome === 'plays') return row;
        }
        throw new Error('No source shows the film today');
    }

    async showControls() {
        const box = await this.videoArea.boundingBox();
        await this.page.mouse.move(box.x + box.width / 2, box.y + box.height - 70);
        await this.page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height - 66);
        await wait(350);
    }

    /** The frame that holds the player's own controls: the page, or a provider frame. */
    async controlsFrame() {
        for (const frame of this.page.frames()) {
            try {
                if (await frame.locator('.player-control-dock').count() && await frameIsInPlayer(frame)) return frame;
            } catch { /* The frame went away. */ }
        }
        return null;
    }

    /** Sees what the rows only measured: was anything visible and did it move? */
    async judgePictures() {
        this.openingHelperPages = true;
        const helper = await this.extension.context.newPage();
        try {
            for (const row of this.rows.filter(candidate => candidate.shots?.length)) {
                const stats = await helper.evaluate(async images => {
                    const load = source => new Promise((resolve, reject) => {
                        const image = new Image();
                        image.onload = () => resolve(image);
                        image.onerror = reject;
                        image.src = `data:image/png;base64,${source}`;
                    });
                    const canvas = document.createElement('canvas');
                    canvas.width = 160;
                    canvas.height = 40;
                    const drawing = canvas.getContext('2d', { willReadFrequently: true });
                    const pixels = [];
                    for (const source of images) {
                        drawing.drawImage(await load(source), 0, 0, 160, 40);
                        pixels.push(drawing.getImageData(0, 0, 160, 40).data);
                    }
                    const brightness = data => {
                        let total = 0;
                        for (let index = 0; index < data.length; index += 4) total += (data[index] + data[index + 1] + data[index + 2]) / 3;
                        return total / (data.length / 4);
                    };
                    const change = (a, b) => {
                        let total = 0;
                        for (let index = 0; index < a.length; index += 4) total += Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]);
                        return total / 3 / (a.length / 4);
                    };
                    return {
                        brightest: Math.max(...pixels.map(brightness)),
                        largestChange: Math.max(0, ...pixels.slice(1).map((data, index) => change(data, pixels[index])))
                    };
                }, row.shots.filter(Boolean).map(shot => shot.toString('base64')));
                row.brightest = round(stats.brightest);
                row.pictureChange = round(stats.largestChange);
                if (!judgePicture(stats)) row.outcome = 'no-picture';
                delete row.shots;
            }
            for (const row of this.rows.filter(candidate => candidate.filmstrip?.length)) {
                const sheet = await renderFilmstrip(this.extension.context, row.filmstrip, { title: `${row.title}: ${row.source}`, columns: 5, maxFrames: 15 });
                if (sheet) {
                    const file = this.testInfo.outputPath(`filmstrip-${row.source.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`);
                    fs.writeFileSync(file, sheet);
                    await this.testInfo.attach(file.split(/[\\/]/).pop(), { path: file, contentType: 'image/png' });
                }
                delete row.filmstrip;
            }
        } finally {
            await helper.close();
            this.openingHelperPages = false;
        }
    }

    /** Things that must hold however the providers behaved today. */
    async finish() {
        for (const row of this.rows) {
            delete row.shots;
            delete row.filmstrip;
            fs.mkdirSync(path.dirname(SUMMARY_FILE), { recursive: true });
            fs.appendFileSync(SUMMARY_FILE, `${JSON.stringify({ test: this.testInfo.title, ...row })}\n`);
        }
        const blocked = [...this.blockedByUblock].sort((a, b) => b[1] - a[1]);
        if (blocked.length) console.log(`[player] uBlock blocked ${blocked.reduce((sum, [, count]) => sum + count, 0)} requests, most from ${blocked.slice(0, 4).map(([host]) => host).join(', ')}`);
        await this.testInfo.attach('sources.json', { body: JSON.stringify({ ublock: this.extension.ublock?.version ?? null, rows: this.rows, failedMedia: [...this.failedMedia], blockedByUblock: blocked }, null, 2), contentType: 'application/json' });
        expect.soft(this.productionHits, 'the run reached production services').toEqual([]);
        expect.soft(this.foreignTabs, 'a press opened a tab nobody asked for').toEqual([]);
        await expect.poll(() => this.extension.context.pages().map(page => page.url()).filter(url => OWN_TEMPORARY_TAB.test(url)),
            { message: 'the temporary HDRezka tab closes by itself', timeout: 15000 }).toEqual([]);
    }
}

const test = base.extend({
    liveNetwork: [true, { option: true }],
    ublock: [process.env.E2E_NO_UBLOCK !== '1', { option: true }],
    viewer: async ({ page, extension }, use, testInfo) => {
        await installFilmCards(extension.context, ALL_FILMS);
        const viewer = new Viewer(page, extension, testInfo);
        await use(viewer);
        await viewer.finish();
    }
});

module.exports = { test, expect, wait, lengthFits, judgePicture, SUMMARY_FILE };
