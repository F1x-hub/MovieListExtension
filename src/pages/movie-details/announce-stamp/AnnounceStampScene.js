/**
 * Announce stamp scene: the poster lies on a dark desk, a lacquered stamp drops
 * onto it from above, spins its date rollers, slams down and lifts away, the
 * camera rises over the poster and the ink impression stays. The finished
 * poster is rendered to a JPEG (the very image the scene ends on) and handed to
 * `onSend`.
 *
 * The flight is WebGL (announceStampStage.js, loaded on demand). With reduced
 * motion, without WebGL or when the stage cannot start, the poster is shown
 * flat and the impression fades in. Timings and look come from one settings
 * object (announceStampCore.js).
 */
import {
    IMPRESSION_VIEWBOX,
    STAMP_IMAGE_CONTENT_TYPE,
    STAMP_IMAGE_MAX_BYTES,
    buildImpressionSvg,
    buildStampImagePayload,
    chooseInk,
    clampImpressionCentre,
    createImpressionLayout,
    formatImpressionLine,
    formatImpressionParts,
    inkOptions,
    mergeStampSettings,
    nextInk,
    nudgeAim,
    samplePosterUnder,
    ticketOutlinePath
} from './announceStampCore.js';

const POSTER_TIMEOUT_MS = 8000;
const FALLBACK_SIZE = { width: 800, height: 1200 };
// Width of the impression texture the stage paints on the poster.
const STAGE_IMPRESSION_WIDTH = 2048;

let activeScene = null;

/** Modal-stack hooks for the page: Escape and focus go to the open scene. */
export const announceStampLayer = {
    isOpen: () => Boolean(activeScene?.dialog?.open),
    close: () => activeScene?.close(),
    getElement: () => (activeScene?.dialog?.open ? activeScene.dialog : null)
};

export function prefersReducedMotion() {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

const abortError = () => new DOMException('Announce stamp scene closed', 'AbortError');
const isAbort = error => error?.name === 'AbortError';

function createElement(tag, className, attrs = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    for (const [name, value] of Object.entries(attrs)) {
        if (name === 'text') element.textContent = value;
        else element.setAttribute(name, value);
    }
    return element;
}

function loadImage(url) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    return image.decode().then(() => image);
}

function svgUrl(markup) {
    return URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
}

function wrapLines(ctx, text, maxWidth, maxLines) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width <= maxWidth || !line) {
            line = next;
        } else {
            lines.push(line);
            line = word;
        }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        let last = kept[maxLines - 1];
        while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
        kept[maxLines - 1] = `${last.trimEnd()}…`;
        return kept;
    }
    return lines;
}

/** A neutral title card used when the poster cannot be loaded or drawn. */
async function drawFallbackPoster({ title, year }) {
    const { width, height } = FALLBACK_SIZE;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const ground = ctx.createLinearGradient(0, 0, 0, height);
    ground.addColorStop(0, '#27272a');
    ground.addColorStop(1, '#09090b');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 4;
    ctx.strokeRect(36, 36, width - 72, height - 72);

    // A film frame strip, so the card reads as a cinema ticket rather than an error.
    ctx.fillStyle = '#18181b';
    ctx.fillRect(36, 120, width - 72, 64);
    ctx.fillStyle = '#3f3f46';
    for (let x = 60; x < width - 60; x += 56) ctx.fillRect(x, 138, 28, 28);

    ctx.fillStyle = '#fafafa';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let fontSize = 84;
    let lines;
    do {
        ctx.font = `800 ${fontSize}px 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
        lines = wrapLines(ctx, title || 'Без названия', width - 160, 4);
        fontSize -= 6;
    } while (lines.length > 3 && fontSize > 48);
    const lineHeight = fontSize * 1.22;
    // Upper half: the impression lands lower on the card.
    const top = height * 0.3 - (lines.length - 1) * lineHeight / 2;
    lines.forEach((line, index) => ctx.fillText(line, width / 2, top + index * lineHeight));
    if (year) {
        ctx.fillStyle = '#a1a1aa';
        ctx.font = `600 44px 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
        ctx.fillText(String(year), width / 2, top + lines.length * lineHeight + 30);
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    return { bitmap, url: URL.createObjectURL(blob), aspect: width / height, isFallback: true };
}

/**
 * The poster as an untainted bitmap plus an object URL for the screen. Both
 * poster CDNs (Yandex avatars, TMDB) answer CORS with `*`, so a credentialless
 * fetch gives a blob the canvas may read. Any failure yields the title card.
 */
export async function loadPosterSource({ posterUrl, title, year, signal } = {}) {
    let url = '';
    try {
        const parsed = new URL(String(posterUrl || '').trim().replace(/^\/\//, 'https://'));
        if (parsed.protocol === 'http:') parsed.protocol = 'https:';
        if (parsed.protocol === 'https:') url = parsed.href;
    } catch {
        url = '';
    }
    if (url) {
        try {
            const timeout = AbortSignal.timeout(POSTER_TIMEOUT_MS);
            const response = await fetch(url, {
                credentials: 'omit',
                mode: 'cors',
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout
            });
            if (!response.ok) throw new Error(`Poster HTTP ${response.status}`);
            const blob = await response.blob();
            if (!blob.type.startsWith('image/')) throw new Error(`Poster is ${blob.type || 'not an image'}`);
            const objectUrl = URL.createObjectURL(blob);
            let bitmap;
            try {
                bitmap = await createImageBitmap(blob);
            } catch {
                // createImageBitmap cannot decode some formats (SVG); an <img> of the
                // same-origin blob can, and stays untainted.
                try {
                    const image = await loadImage(objectUrl);
                    bitmap = await createImageBitmap(image, { resizeWidth: image.naturalWidth || 600, resizeHeight: image.naturalHeight || 900 });
                } catch (error) {
                    URL.revokeObjectURL(objectUrl);
                    throw error;
                }
            }
            if (!bitmap.width || !bitmap.height) {
                URL.revokeObjectURL(objectUrl);
                throw new Error('Poster has no size');
            }
            return { bitmap, url: objectUrl, aspect: bitmap.width / bitmap.height, isFallback: false };
        } catch (error) {
            if (signal?.aborted) throw abortError();
            console.warn('[AnnounceStamp] Poster unavailable, using the title card:', error?.message || error);
        }
    }
    return drawFallbackPoster({ title, year });
}

/**
 * The stamped poster as a JPEG: poster aspect, long side `exportLongSide`,
 * the impression at the scene's position, angle, colour and ink texture.
 * Quality steps down until the file fits the 3 MB contract.
 * @returns {Promise<Blob>}
 */
export async function renderStampedPoster({ poster, layout, settings: rawSettings, parts, maxBytes = STAMP_IMAGE_MAX_BYTES }) {
    const settings = mergeStampSettings(rawSettings);
    const aspect = poster.width / poster.height;
    const longSide = settings.exportLongSide;
    const width = Math.round(aspect >= 1 ? longSide : longSide * aspect);
    const height = Math.round(aspect >= 1 ? longSide / aspect : longSide);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(poster, 0, 0, width, height);

    const inkWidth = layout.width * width;
    const inkHeight = inkWidth * IMPRESSION_VIEWBOX.height / IMPRESSION_VIEWBOX.width;
    const markup = buildImpressionSvg({ label: settings.label, parts, inkColor: layout.ink || settings.inkColor, layout, pixelWidth: inkWidth, backing: settings.inkBacking });
    const url = svgUrl(markup);
    try {
        const ink = await loadImage(url);
        ctx.save();
        ctx.globalAlpha = settings.inkOpacity;
        ctx.translate(layout.x * width, layout.y * height);
        ctx.rotate(layout.rotation * Math.PI / 180);
        ctx.drawImage(ink, -inkWidth / 2, -inkHeight / 2, inkWidth, inkHeight);
        ctx.restore();
    } finally {
        URL.revokeObjectURL(url);
    }

    let quality = settings.jpegQuality;
    let blob = await canvas.convertToBlob({ type: STAMP_IMAGE_CONTENT_TYPE, quality });
    while (blob.size > maxBytes && quality > 0.45) {
        quality -= 0.12;
        blob = await canvas.convertToBlob({ type: STAMP_IMAGE_CONTENT_TYPE, quality });
    }
    if (blob.size > maxBytes) throw new RangeError('Stamped poster does not fit 3 MB');
    return blob;
}

/** `stampImage` for SCHEDULE_ANNOUNCE: base64 without the data: prefix, size-checked. */
export async function blobToStampImage(blob) {
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('Could not read the image'));
        reader.readAsDataURL(blob);
    });
    return buildStampImagePayload(dataUrl, STAMP_IMAGE_CONTENT_TYPE);
}

function playThud() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const audio = new AudioCtx();
        const now = audio.currentTime;
        const body = audio.createOscillator();
        const bodyGain = audio.createGain();
        body.type = 'sine';
        body.frequency.setValueAtTime(130, now);
        body.frequency.exponentialRampToValueAtTime(42, now + 0.16);
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.exponentialRampToValueAtTime(0.55, now + 0.008);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        body.connect(bodyGain).connect(audio.destination);

        // A short filtered noise burst for the paper slap.
        const noise = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.06), audio.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 2;
        const slap = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const slapGain = audio.createGain();
        slap.buffer = noise;
        filter.type = 'lowpass';
        filter.frequency.value = 1400;
        slapGain.gain.value = 0.35;
        slap.connect(filter).connect(slapGain).connect(audio.destination);

        body.start(now);
        slap.start(now);
        body.stop(now + 0.25);
        setTimeout(() => audio.close().catch(() => {}), 400);
    } catch {
        // Sound is decoration; the scene goes on without it.
    }
}

const ICONS = {
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    sent: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    failed: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>'
};

class AnnounceStampScene {
    constructor(options) {
        this.options = options;
        this.settings = mergeStampSettings(options.settings);
        this.parts = formatImpressionParts(options.date, options.time);
        this.line = formatImpressionLine(this.settings.label, this.parts);
        this.reduced = prefersReducedMotion();
        this.controller = new AbortController();
        this.urls = [];
        this.status = 'preparing';
        this.blob = null;
        this.closed = false;
        this.done = new Promise(resolve => { this.resolveDone = resolve; });
        const seed = new Uint32Array(1);
        crypto.getRandomValues(seed);
        this.seed = seed[0];
    }

    get signal() {
        return this.controller.signal;
    }

    track(url) {
        this.urls.push(url);
        return url;
    }

    build() {
        const dialog = createElement('dialog', 'announce-stamp', { 'aria-label': `Анонс показа: ${this.line}` });
        dialog.style.setProperty('--stamp-ink', this.settings.inkColor);
        dialog.style.setProperty('--stamp-ink-opacity', String(this.settings.inkOpacity));
        dialog.innerHTML = `
            <div class="announce-stamp__viewport">
                <div class="announce-stamp__stage" aria-hidden="true"></div>
                <div class="announce-stamp__paper" aria-hidden="true">
                    <img class="announce-stamp__poster" alt="">
                    <img class="announce-stamp__impression" alt="">
                    <svg class="announce-stamp__aim" viewBox="0 0 ${IMPRESSION_VIEWBOX.width} ${IMPRESSION_VIEWBOX.height}" preserveAspectRatio="none" hidden>
                        <path class="announce-stamp__aim-halo" d="${ticketOutlinePath()}"/>
                        <path class="announce-stamp__aim-line" d="${ticketOutlinePath()}"/>
                    </svg>
                </div>
                <img class="announce-stamp__flat" alt="" aria-hidden="true" hidden>
                <div class="announce-stamp__loading app-loader app-loader--section" hidden><div class="app-loader__indicator"></div></div>
            </div>
            <div class="announce-stamp__panel">
                <div class="announce-stamp__message">
                    <p class="announce-stamp__status" role="status" aria-live="polite">
                        <span class="announce-stamp__status-icon" aria-hidden="true"></span>
                        <span class="announce-stamp__status-text">Готовим постер…</span>
                    </p>
                    <p class="announce-stamp__hint" id="announceStampHint" hidden>Стрелки — сдвиг, Q и E — поворот, C — цвет чернил, Enter — поставить</p>
                </div>
                <div class="announce-stamp__actions">
                    <button type="button" class="btn btn-primary announce-stamp__strike" aria-describedby="announceStampHint" hidden>Поставить штамп</button>
                    <button type="button" class="btn btn-secondary announce-stamp__retry" hidden>Повторить</button>
                    <button type="button" class="btn btn-secondary announce-stamp__plain" hidden>Отправить без штампа</button>
                    <button type="button" class="btn btn-primary announce-stamp__done" hidden>Готово</button>
                </div>
            </div>
            <button type="button" class="announce-stamp__close" aria-label="Закрыть" autofocus>${ICONS.close}</button>`;
        const $ = selector => dialog.querySelector(selector);
        this.dialog = dialog;
        this.el = {
            viewport: $('.announce-stamp__viewport'),
            stage: $('.announce-stamp__stage'),
            paper: $('.announce-stamp__paper'),
            poster: $('.announce-stamp__poster'),
            impression: $('.announce-stamp__impression'),
            aim: $('.announce-stamp__aim'),
            flat: $('.announce-stamp__flat'),
            loading: $('.announce-stamp__loading'),
            panel: $('.announce-stamp__panel'),
            status: $('.announce-stamp__status'),
            statusIcon: $('.announce-stamp__status-icon'),
            statusText: $('.announce-stamp__status-text'),
            hint: $('.announce-stamp__hint'),
            strike: $('.announce-stamp__strike'),
            retry: $('.announce-stamp__retry'),
            plain: $('.announce-stamp__plain'),
            done: $('.announce-stamp__done'),
            close: $('.announce-stamp__close')
        };
        this.el.close.addEventListener('click', () => this.close());
        this.el.done.addEventListener('click', () => this.close());
        // «Повторить» resends the same image.
        this.el.retry.addEventListener('click', () => this.send(this.blob));
        this.el.plain.addEventListener('click', () => this.send(null));
        this.el.strike.addEventListener('click', () => this.aimTarget?.strike());
        dialog.addEventListener('keydown', event => this.onAimKey(event));
        // Escape normally reaches the page's modal stack first; this covers the rest.
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            this.close();
        });
        document.body.append(dialog);
    }

    /**
     * Keyboard aiming, on any layout (physical keys): arrows move the stamp by
     * 1% of the poster (Shift: 5%), Q/E or [ ] turn it by 2° (Shift: 10°), C
     * changes the ink, Enter strikes. A focused button keeps its own Enter and Space.
     */
    onAimKey(event) {
        const target = this.aimTarget;
        if (!target || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.code === 'KeyC') {
            event.preventDefault();
            this.switchInk();
            return;
        }
        const step = event.shiftKey ? 0.05 : 0.01;
        const turn = event.shiftKey ? 10 : 2;
        const changes = {
            ArrowLeft: { x: -step },
            ArrowRight: { x: step },
            ArrowUp: { y: -step },
            ArrowDown: { y: step },
            KeyQ: { rotation: -turn },
            BracketLeft: { rotation: -turn },
            KeyE: { rotation: turn },
            BracketRight: { rotation: turn }
        };
        const change = changes[event.code];
        if (change) {
            event.preventDefault();
            target.nudge(change);
            return;
        }
        if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
            event.preventDefault();
            target.strike();
        }
    }

    /** The owner aims: the panel says how, and «Поставить штамп» strikes. */
    startAiming(target) {
        this.aimTarget = target;
        this.dialog.classList.add('announce-stamp--aiming');
        this.setStatus('aiming', 'Наведите штамп на постер и кликните. Колесо поворачивает, правая кнопка меняет цвет');
    }

    /**
     * The aim moved: unless the owner picked the ink, take the one that stands
     * out best on the part of the poster under the ticket.
     */
    onAim(layout) {
        this.layout = { ...this.layout, ...layout };
        if (this.inkPicked) return;
        const ink = chooseInk(samplePosterUnder(this.posterSample, this.layout), this.inks);
        if (ink !== this.ink) this.setInk(ink);
    }

    /** The owner's own pick (C or right click): the next ink, kept from now on. */
    switchInk() {
        if (!this.aimTarget) return;
        this.inkPicked = true;
        this.setInk(nextInk(this.ink, this.inks));
    }

    setInk(ink) {
        this.ink = ink;
        // The outline is drawn in the ink, on a halo that contrasts with it.
        const [r, g, b] = [1, 3, 5].map(offset => parseInt(ink.slice(offset, offset + 2), 16));
        const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
        this.dialog.style.setProperty('--stamp-ink', ink);
        this.dialog.style.setProperty('--stamp-ink-halo', light ? 'rgb(0 0 0 / 0.6)' : 'rgb(255 255 255 / 0.7)');
        this.stage?.setInk(ink);
    }

    /** A small copy of the poster to read the colours under the ticket from. */
    samplePoster(bitmap) {
        try {
            const width = 96;
            const height = Math.max(1, Math.round(width * bitmap.height / bitmap.width));
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0, width, height);
            return { data: ctx.getImageData(0, 0, width, height).data, width, height };
        } catch {
            return null;
        }
    }

    /** The strike chose the final place and angle: render the JPEG while the stamp comes down. */
    onStrike(layout) {
        if (this.closed) return;
        this.aimTarget = null;
        this.layout = { ...layout, ink: this.ink };
        this.dialog.classList.remove('announce-stamp--aiming');
        this.setStatus('animating', this.line);
        this.startRendering();
    }

    startRendering() {
        this.rendering = renderStampedPoster({ poster: this.poster.bitmap, layout: this.layout, settings: this.settings, parts: this.parts });
        this.rendering.catch(() => {});
    }

    setStatus(status, text) {
        this.status = status;
        this.dialog.dataset.status = status;
        this.el.statusText.textContent = text;
        this.el.statusIcon.innerHTML = ICONS[status] || '';
        const finished = status === 'sent' || status === 'failed' || status === 'render-failed';
        const aiming = status === 'aiming';
        this.el.hint.hidden = !aiming;
        this.el.strike.hidden = !aiming;
        this.el.retry.hidden = status !== 'failed';
        this.el.plain.hidden = status !== 'render-failed';
        this.el.done.hidden = !finished;
        this.el.done.textContent = status === 'sent' ? 'Готово' : 'Закрыть';
        if (aiming) this.el.strike.focus();
        else if (finished) (status === 'sent' ? this.el.done : (this.el.retry.hidden ? this.el.plain : this.el.retry)).focus();
    }

    /** Px kept under the poster for the floating panel (`--stamp-panel-space`). */
    panelSpace() {
        return parseFloat(getComputedStyle(this.el.viewport).paddingBlockEnd) || 0;
    }

    layoutPaper(aspect) {
        // The open dialog fills the viewport; window.innerWidth can read 0 in a background pane.
        const box = this.dialog.getBoundingClientRect();
        const viewWidth = box.width || document.documentElement.clientWidth || 800;
        const viewHeight = box.height || document.documentElement.clientHeight || 600;
        const maxWidth = Math.max(200, Math.min(viewWidth - 48, 560));
        const maxHeight = Math.max(240, viewHeight - this.panelSpace() - 56);
        const height = Math.min(maxHeight, maxWidth / aspect);
        this.paper = { width: Math.round(height * aspect), height: Math.round(height) };
        this.dialog.style.setProperty('--paper-w', `${this.paper.width}px`);
        this.dialog.style.setProperty('--paper-h', `${this.paper.height}px`);
    }

    /** Puts `element` on the flat poster where the impression of `layout` goes. */
    placeOnPaper(element, layout) {
        const style = element.style;
        style.left = `${(layout.x - layout.width / 2) * 100}%`;
        style.top = `${(layout.y - layout.height / 2) * 100}%`;
        style.width = `${layout.width * 100}%`;
        style.height = `${layout.height * 100}%`;
        style.rotate = `${layout.rotation}deg`;
    }

    /** The impression SVG in `ink` at `pixelWidth` (default: its own size), as an object URL. */
    impressionUrl(ink, pixelWidth) {
        // The ink texture depends only on the label, date, seeds and colour, not on the place.
        return this.track(svgUrl(buildImpressionSvg({
            label: this.settings.label, parts: this.parts, inkColor: ink, layout: this.layout, pixelWidth, backing: this.settings.inkBacking
        })));
    }

    placeImpression() {
        this.placeOnPaper(this.el.impression, this.layout);
        if (this.el.impression.dataset.ink === this.ink) return;
        this.el.impression.dataset.ink = this.ink;
        this.el.impression.src = this.impressionUrl(this.ink);
    }

    animate(element, keyframes, options) {
        if (this.signal.aborted) return Promise.reject(abortError());
        const animation = element.animate(keyframes, { fill: 'forwards', ...options });
        return animation.finished.catch(error => {
            throw this.signal.aborted ? abortError() : error;
        });
    }

    /**
     * The WebGL flight: the stamp drops in, the owner aims it, it strikes.
     * Resolves true once it has played to its last frame (straight above the
     * poster, at the JPEG's size), false when WebGL or the stage is unavailable
     * so the caller can fall back to the flat scene.
     */
    async playStage() {
        let stageModule;
        try {
            stageModule = await import('./announceStampStage.js');
        } catch (error) {
            console.warn('[AnnounceStamp] 3D stage unavailable:', error?.message || error);
            return false;
        }
        if (this.closed) throw abortError();
        if (!stageModule.isWebGLAvailable()) return false;
        let stage = null;
        try {
            // Every ink is drawn up front, so a switch while aiming is instant.
            const images = await Promise.all(this.inks.map(ink => loadImage(this.impressionUrl(ink, STAGE_IMPRESSION_WIDTH))));
            if (this.closed) throw abortError();
            stage = new stageModule.StampStage({
                host: this.el.stage,
                poster: this.poster,
                impressions: new Map(this.inks.map((ink, index) => [ink, images[index]])),
                ink: this.ink,
                layout: this.layout,
                parts: this.parts,
                settings: this.settings,
                paper: this.paper,
                panelSpace: () => this.panelSpace(),
                seed: this.seed,
                onAim: layout => this.onAim(layout),
                onInkSwitch: () => this.switchInk(),
                onStrike: layout => this.onStrike(layout),
                onImpact: () => { if (this.settings.sound) playThud(); }
            });
            this.stage = stage;
            await stage.prepare(this.signal);
        } catch (error) {
            stage?.dispose();
            this.stage = null;
            if (isAbort(error) || this.closed) throw abortError();
            console.warn('[AnnounceStamp] 3D stage could not start:', error?.message || error);
            return false;
        }
        this.dialog.classList.add('announce-stamp--flight');
        this.el.loading.hidden = true;
        // The canvas comes up with the stage scrim; the stamp is still out of frame.
        this.animate(this.el.stage, [{ opacity: 0 }, { opacity: 1 }], { duration: Math.max(120, this.settings.timings.intro * 0.6), easing: 'ease-out' }).catch(() => {});
        // The stamp follows the aim from the moment it comes into view.
        this.startAiming(stage);
        await stage.play(this.signal);
        return true;
    }

    /**
     * The flat scene (reduced motion, no WebGL): the poster shows with a dashed
     * outline of the ticket that follows the pointer, the wheel turns it, a
     * click or Enter puts the ink there, and it fades in.
     */
    async playFlat() {
        this.el.impression.style.opacity = '0';
        this.el.loading.hidden = true;
        await this.animate(this.el.paper, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'linear' });
        await this.aimFlat();
        if (this.settings.sound) playThud();
        await this.animate(this.el.impression, [{ opacity: 0 }, { opacity: this.settings.inkOpacity }], { duration: this.settings.timings.fade, easing: 'ease-out' });
    }

    aimFlat() {
        return new Promise((resolve, reject) => {
            const { viewport, paper, aim } = this.el;
            const aspect = this.poster.aspect;
            const apply = layout => {
                this.onAim(layout);
                this.placeOnPaper(aim, this.layout);
            };
            const onContextMenu = event => {
                event.preventDefault();
                this.switchInk();
            };
            const pointAt = event => {
                const rect = paper.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                apply({
                    ...this.layout,
                    ...clampImpressionCentre({
                        x: (event.clientX - rect.left) / rect.width,
                        y: (event.clientY - rect.top) / rect.height,
                        rotation: this.layout.rotation,
                        width: this.layout.width,
                        aspect
                    })
                });
            };
            const onWheel = event => {
                event.preventDefault();
                const delta = event.deltaY || event.deltaX;
                if (delta) apply(nudgeAim(this.layout, { rotation: Math.sign(delta) * (event.shiftKey ? 0.5 : 3) }, aspect));
            };
            const cleanup = () => {
                viewport.removeEventListener('pointermove', pointAt);
                viewport.removeEventListener('wheel', onWheel);
                viewport.removeEventListener('click', onClick);
                viewport.removeEventListener('contextmenu', onContextMenu);
                // An <svg> has no `hidden` property: toggle the attribute itself.
                aim.toggleAttribute('hidden', true);
            };
            const strike = () => {
                if (this.aimTarget !== target) return;
                cleanup();
                this.placeImpression();
                this.onStrike(this.layout);
                resolve();
            };
            const onClick = event => {
                pointAt(event);
                strike();
            };
            const target = {
                nudge: change => apply(nudgeAim(this.layout, change, aspect)),
                strike
            };
            apply(this.layout);
            aim.toggleAttribute('hidden', false);
            viewport.addEventListener('pointermove', pointAt);
            viewport.addEventListener('wheel', onWheel, { passive: false });
            viewport.addEventListener('click', onClick);
            viewport.addEventListener('contextmenu', onContextMenu);
            this.signal.addEventListener('abort', () => {
                cleanup();
                reject(abortError());
            }, { once: true });
            this.startAiming(target);
        });
    }

    async showFlat(blob) {
        // The crisp final view is the JPEG itself: what is shown is what is sent.
        // After the flight it fades in over the stage's last frame, which shows
        // the same poster and ink at the same size and place.
        this.el.flat.src = this.track(URL.createObjectURL(blob));
        await this.el.flat.decode().catch(() => {});
        if (this.closed) return;
        this.el.flat.hidden = false;
        this.dialog.classList.remove('announce-stamp--playing');
        this.dialog.classList.add('announce-stamp--final');
        const stage = this.stage;
        if (!stage) return;
        const done = () => {
            stage.dispose();
            if (this.stage === stage) this.stage = null;
            this.dialog.classList.remove('announce-stamp--flight');
        };
        const fade = this.settings.timings.fade;
        if (fade) {
            await this.el.flat.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade, easing: 'ease-out' })
                .finished.catch(() => {});
        }
        done();
    }

    async send(blob) {
        if (this.closed || this.status === 'sending') return;
        this.setStatus('sending', 'Отправляем анонс в Telegram…');
        let result;
        try {
            result = await this.options.onSend(blob);
        } catch (error) {
            result = { ok: false, error: error?.message };
        }
        if (this.closed) return;
        if (result?.ok) {
            this.setStatus('sent', result.message || `Анонс запланирован: ${this.parts.dateText}, ${this.parts.time}`);
        } else {
            this.setStatus('failed', result?.error || 'Не удалось отправить анонс');
        }
    }

    async run() {
        this.build();
        activeScene = this;
        this.dialog.showModal();
        this.el.loading.hidden = false;
        this.el.paper.style.opacity = '0';
        try {
            const poster = await loadPosterSource({ ...this.options, signal: this.signal });
            if (this.closed) {
                poster.bitmap.close?.();
                return this.done;
            }
            this.track(poster.url);
            this.poster = poster;
            this.layout = createImpressionLayout(this.settings, poster.aspect, this.seed);
            this.posterSample = this.samplePoster(poster.bitmap);
            this.inks = inkOptions(this.settings.inkColor);
            this.inkPicked = false;
            this.setInk(chooseInk(samplePosterUnder(this.posterSample, this.layout), this.inks));
            this.layoutPaper(poster.aspect);
            this.el.poster.src = poster.url;
            await this.el.poster.decode().catch(() => {});
            this.placeImpression();
            await this.el.impression.decode().catch(() => {});

            if (this.settings.skipAnimation) {
                // No scene, no aiming: the default place and angle, the clearest ink.
                this.el.loading.hidden = true;
                this.layout = { ...this.layout, ink: this.ink };
                this.startRendering();
            } else {
                this.dialog.classList.add('announce-stamp--playing');
                this.setStatus('animating', this.line);
                // The JPEG is rendered from the place the owner strikes (onStrike).
                const flew = !this.reduced && await this.playStage();
                if (!flew) await this.playFlat();
            }
            this.el.paper.style.opacity = '';

            let blob;
            try {
                blob = await this.rendering;
            } catch (error) {
                console.error('[AnnounceStamp] Render failed:', error);
                if (!this.closed) this.setStatus('render-failed', 'Не удалось подготовить картинку со штампом');
                return this.done;
            }
            if (this.closed) return this.done;
            this.blob = blob;
            await this.showFlat(blob);
            if (this.closed) return this.done;
            await this.send(blob);
        } catch (error) {
            if (!isAbort(error) && !this.closed) {
                console.error('[AnnounceStamp] Scene failed:', error);
                this.el.loading.hidden = true;
                this.setStatus('render-failed', 'Анимация не удалась');
            }
        }
        return this.done;
    }

    teardown() {
        this.closed = true;
        this.controller.abort();
        this.stage?.dispose();
        this.stage = null;
        for (const animation of this.dialog.getAnimations({ subtree: true })) animation.cancel();
        if (this.dialog.open) this.dialog.close();
        this.dialog.remove();
        for (const url of this.urls) URL.revokeObjectURL(url);
        this.poster?.bitmap?.close?.();
        if (activeScene === this) activeScene = null;
    }

    close() {
        if (this.closed) return;
        const status = this.status;
        this.teardown();
        this.resolveDone({
            status: ['sent', 'failed', 'sending'].includes(status) ? status : 'cancelled',
            blob: this.blob
        });
    }
}

/**
 * Play the stamp scene and send the stamped poster through `onSend(blob)`.
 * Resolves when the scene closes with
 * `{ status: 'sent' | 'failed' | 'sending' | 'cancelled', blob }`;
 * `sending` means it was closed while the send was still running.
 * @param {{ posterUrl?: string, title?: string, year?: string|number, date: string, time: string, settings?: object, onSend: (blob: Blob|null) => Promise<{ ok: boolean, message?: string, error?: string }> }} options
 */
export function playAnnounceStamp(options) {
    if (activeScene) activeScene.close();
    if (typeof options?.onSend !== 'function') throw new TypeError('playAnnounceStamp needs onSend');
    const scene = new AnnounceStampScene(options);
    return scene.run();
}
