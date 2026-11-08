(function(global) {
    'use strict';
// How long the pointer rests before the preview decodes a point not prepared yet.
const PREVIEW_DELAY_MS = 80;
// Without a stylesheet the frame keeps the size the player CSS gives it.
const FRAME_WIDTH = 200;
const FRAME_HEIGHT = 112;
const FRAME_QUALITY = 0.8;
// How often the player looks whether frames can be prepared in the background.
const FILL_CHECK_MS = 1000;
// A short pause between prepared frames keeps the page responsive.
const FILL_GAP_MS = 15;
// The playing film keeps this many seconds ahead before preparation takes the network.
const FILL_MIN_AHEAD_S = 8;
// A point that does not decode in this time is skipped.
const FILL_STEP_TIMEOUT_MS = 20000;
// Preparation stops for a source after this many points in a row fail.
const FILL_MAX_FAILURES = 6;
// Prepared frames are kept an hour past the film's length, and at least two hours.
const FRAME_KEEP_EXTRA_MS = 60 * 60 * 1000;
const FRAME_KEEP_MIN_MS = 2 * 60 * 60 * 1000;

/**
 * Prepared frames on extension pages survive a reopened player for a while and are then
 * deleted. Inside a provider's frame they stay in memory: that storage belongs to the site.
 */
const PreviewFrameArchive = {
    _db: null,

    available() {
        return global.location?.protocol === 'chrome-extension:' && typeof global.indexedDB !== 'undefined';
    },

    open() {
        if (!this.available()) return Promise.resolve(null);
        this._db ||= new Promise(resolve => {
            try {
                const request = global.indexedDB.open('movieExtensionPreviewFrames', 1);
                request.onupgradeneeded = () => {
                    const store = request.result.createObjectStore('frames', { keyPath: 'id' });
                    store.createIndex('source', 'source');
                    store.createIndex('expiresAt', 'expiresAt');
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
                request.onblocked = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
        return this._db;
    },

    async load(source) {
        const db = await this.open();
        if (!db) return [];
        await this.purge(db);
        return new Promise(resolve => {
            try {
                const now = Date.now();
                const request = db.transaction('frames', 'readonly').objectStore('frames').index('source').getAll(source);
                request.onsuccess = () => resolve((request.result || []).filter(record => record.expiresAt > now));
                request.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });
    },

    async save(record) {
        const db = await this.open();
        if (!db) return;
        try {
            db.transaction('frames', 'readwrite').objectStore('frames').put(record);
        } catch { /* Keeping frames between visits is a convenience. */ }
    },

    // Frames past their time are deleted whenever a player opens a source.
    purge(db) {
        return new Promise(resolve => {
            try {
                const transaction = db.transaction('frames', 'readwrite');
                const range = global.IDBKeyRange.upperBound(Date.now());
                const request = transaction.objectStore('frames').index('expiresAt').openCursor(range);
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return;
                    cursor.delete();
                    cursor.continue();
                };
                transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
            } catch {
                resolve();
            }
        });
    }
};

/**
 * Frames of one source: one for each point the pointer can take on the track when the
 * player fills the screen. Finer steps cannot be reached, so they are never prepared.
 */
class PreviewFrames {
    constructor({ identity, key, duration, cells }) {
        this.identity = identity;
        this.duration = duration;
        this.cells = cells;
        this.frames = new Map();
        this.failed = new Set();
        this.failures = 0;
        this.disabled = false;
        this.destroyed = false;
        this.loaded = false;
        this.archiveSource = key ? `${key}|${cells}|${Math.round(duration)}` : null;
        this.expiresAt = Date.now() + Math.max(FRAME_KEEP_MIN_MS, duration * 1000 + FRAME_KEEP_EXTRA_MS);
        this.ready = (this.archiveSource ? PreviewFrameArchive.load(this.archiveSource) : Promise.resolve([]))
            .then(records => {
                for (const record of records) {
                    if (!this.destroyed && record.blob && !this.frames.has(record.cell)) this._add(record.cell, record.blob);
                }
            })
            .catch(() => undefined)
            .finally(() => { this.loaded = true; });
    }

    cellAt(time) {
        return Math.max(0, Math.min(this.cells - 1, Math.floor(time / this.duration * this.cells)));
    }

    timeOf(cell) {
        return Math.min(Math.max(0, this.duration - 0.05), (cell + 0.5) / this.cells * this.duration);
    }

    get(cell) {
        return this.frames.get(cell) || null;
    }

    get size() {
        return this.frames.size;
    }

    put(cell, blob) {
        if (this.destroyed || this.frames.has(cell)) return;
        this._add(cell, blob);
        this.failures = 0;
        if (this.archiveSource) {
            void PreviewFrameArchive.save({
                id: `${this.archiveSource}|${cell}`, source: this.archiveSource, cell, blob, expiresAt: this.expiresAt
            });
        }
    }

    fail(cell) {
        this.failed.add(cell);
        this.failures += 1;
        if (this.failures >= FILL_MAX_FAILURES) this.disabled = true;
    }

    // The next point to prepare: from the film's position forward, then from the start.
    nextMissing(from, availableEnd) {
        if (this.disabled || this.destroyed) return null;
        const start = this.cellAt(Math.max(0, from || 0));
        for (let step = 0; step < this.cells; step++) {
            const cell = (start + step) % this.cells;
            if (this.frames.has(cell) || this.failed.has(cell)) continue;
            if (this.timeOf(cell) > availableEnd) continue;
            return cell;
        }
        return null;
    }

    destroy() {
        this.destroyed = true;
        for (const frame of this.frames.values()) global.URL.revokeObjectURL(frame.url);
        this.frames.clear();
    }

    _add(cell, blob) {
        this.frames.set(cell, { blob, url: global.URL.createObjectURL(blob) });
    }
}

class GhostPlayer {
    constructor({ progressContainer, getActiveVideo, getCurrentUrl, getCurrentType, getCurrentHls, getPreviewSource, HlsClass }) {
        this._progressContainer = progressContainer;
        this._getActiveVideo   = getActiveVideo;   // () => video element
        this._getCurrentUrl    = getCurrentUrl;    // () => string | null
        this._getCurrentType   = getCurrentType || (() => null);
        this._getCurrentHls    = getCurrentHls;    // () => Hls instance | null
        // () => { url, config } | null: a lighter stream of the same film for previews.
        this._getPreviewSource = getPreviewSource || (() => null);
        this._Hls              = HlsClass;         // Hls constructor (lazy-loaded)

        this._ghostHls   = null;
        this._lastUrl    = null;
        this._debounce   = null;
        this._previewSource = null;
        this._failedPreviews = new WeakSet();

        // The point the preview video is decoding, for the pointer or in the background.
        this._request = null;
        this._requestTimer = null;
        this._frames = null;
        this._hoverCell = null;
        // The point whose decoded frame the preview video is showing.
        this._videoCell = null;
        this._fillTimer = null;

        this._tooltip    = null;
        this._ghostVideo = null;
        this._timeLabel  = null;
        this._targetTime = null;
        this._destroyed = false;
        this._hovering = false;
        this._hideTimer = null;
        this._showFrame = null;

        this._build();
        this._bind();
        this._scheduleFill(FILL_CHECK_MS);
    }

    // ─── DOM ──────────────────────────────────────────────────────────────────

    _build() {
        this._tooltip = document.createElement('div');
        this._tooltip.className = 'ghost-tooltip';
        this._tooltip.setAttribute('aria-hidden', 'true');

        this._ghostVideo = document.createElement('video');
        this._ghostVideo.className   = 'ghost-video';
        this._ghostVideo.dataset.ghost = "true"; // Tag it for other scripts
        this._ghostVideo.muted       = true;
        this._ghostVideo.preload     = 'none';
        this._ghostVideo.controls    = false;
        this._ghostVideo.playsInline = true;

        // A prepared frame, shown at once in the video's place.
        this._frameImage = document.createElement('img');
        this._frameImage.className = 'ghost-frame';
        this._frameImage.alt = '';
        this._frameImage.decoding = 'sync';
        this._frameImage.style.visibility = 'hidden';

        this._timeLabel = document.createElement('span');
        this._timeLabel.className = 'ghost-time-label';

        // Says why a torrent's moment cannot be chosen yet; hidden elsewhere.
        this._statusLabel = document.createElement('span');
        this._statusLabel.className = 'ghost-status-label';
        this._statusLabel.hidden = true;

        this._tooltip.appendChild(this._ghostVideo);
        this._tooltip.appendChild(this._frameImage);
        this._tooltip.appendChild(this._timeLabel);
        this._tooltip.appendChild(this._statusLabel);
        this._getTooltipHost().appendChild(this._tooltip);
        this._onMetadata = () => this._applyTarget();
        this._onSeeked = () => this._onFrameReady();
        this._ghostVideo.addEventListener('loadedmetadata', this._onMetadata);
        this._ghostVideo.addEventListener('seeked', this._onSeeked);
        this._ghostVideo.addEventListener('loadeddata', this._onSeeked);
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    _bind() {
        this._onMove  = this._handleMove.bind(this);
        this._onLeave = this._handleLeave.bind(this);

        this._progressContainer.addEventListener('mousemove',  this._onMove);
        this._progressContainer.addEventListener('mouseleave', this._onLeave);
    }

    _handleMove(e) {
        if (this._destroyed) return;
        const video = this._getActiveVideo();

        if (!video) {
            return;
        }
        // A torrent being prepared spans the whole film, not just what is converted.
        const timeline = global.PlayerMediaControls.Timeline;
        const span = timeline.describe(video);
        if (span.duration <= 0) {
            return;
        }

        const rect     = this._progressContainer.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio    = timeline.ratio(e.clientX, rect);
        if (ratio === null) return;
        const seekTime = Math.min(ratio * span.duration, Math.max(0, span.duration - 0.05));
        const available = timeline.isAvailable(span, seekTime);

        this._hovering = true;
        clearTimeout(this._hideTimer);
        this._setStatus(available ? '' : this._unavailableText(span, seekTime));

        this._showTooltip(e.clientX, rect.top, seekTime);

        clearTimeout(this._debounce);
        // No frame exists yet for a moment that is not prepared.
        if (!available) {
            this._hoverCell = null;
            this._hideVideoFrame();
            this._showFrameImage(null);
            this._dropHoverRequest();
            return;
        }
        const frames = this._framesFor(video, span);
        const cell = frames ? frames.cellAt(seekTime) : null;
        this._hoverCell = cell;
        const known = cell === null ? null : frames.get(cell);
        if (known) {
            // The frame of this point is ready: nothing needs to load.
            this._hideVideoFrame();
            this._showFrameImage(known.url);
            this._dropHoverRequest();
            return;
        }
        // The decoded frame of this very point is already on screen.
        if (cell !== null && cell === this._videoCell && this._ghostVideo.style.visibility === 'visible') return;
        // Only the right frame is shown: until it is decoded, the time stands alone.
        this._hideVideoFrame();
        this._showFrameImage(null);
        if (this._request?.kind === 'hover' && this._request.cell !== cell) this._dropHoverRequest();
        this._debounce = setTimeout(() => this._seekGhost(seekTime, cell), PREVIEW_DELAY_MS);
    }

    _hideVideoFrame() {
        this._videoCell = null;
        this._ghostVideo.style.visibility = 'hidden';
    }

    _unavailableText(span, time) {
        const t = global.PlayerLocale?.t;
        return time <= span.downloadedEnd
            ? (t?.('timeline_preparing', {}, 'Скачано, готовим к просмотру') || 'Скачано, готовим к просмотру')
            : (t?.('timeline_not_downloaded', {}, 'Ещё не скачано') || 'Ещё не скачано');
    }

    _setStatus(text) {
        this._statusLabel.textContent = text;
        this._statusLabel.hidden = !text;
        this._tooltip.classList.toggle('ghost-tooltip--unavailable', Boolean(text));
    }

    _handleLeave() {
        this._hovering = false;
        this._hoverCell = null;
        cancelAnimationFrame(this._showFrame);
        clearTimeout(this._debounce);
        this._dropHoverRequest();
        this._ghostVideo.pause();
        this._tooltip.classList.remove('ghost-tooltip--visible');

        // Небольшая задержка перед реальным hide — плавный fade-out
        this._hideTimer = setTimeout(() => {
            if (!this._tooltip.classList.contains('ghost-tooltip--visible')) {
                this._tooltip.style.display = 'none';
            }
        }, 200);
        // Preparation waits while the pointer is on the track.
        this._scheduleFill(300);
    }

    _dropHoverRequest() {
        if (this._request?.kind !== 'hover') return;
        this._cancelRequest();
        this._ghostHls?.stopLoad();
    }

    _cancelRequest() {
        clearTimeout(this._requestTimer);
        this._request = null;
        this._targetTime = null;
    }

    // ─── Prepared frames ──────────────────────────────────────────────────────

    // Frames belong to one source: another film, episode or stream starts over. A parser
    // may name its film in `data-preview-frames-key`, so frames outlive a new stream URL.
    _framesFor(video, span) {
        const key = video.dataset?.previewFramesKey || null;
        const identity = key || [video.currentSrc || video.src || '', video.dataset?.playerPreviewUrl || '',
            video._movieExtensionHls?.url || '', video._movieExtensionPreview?.url || ''].join('\n');
        const current = this._frames;
        if (current && current.identity === identity && Math.abs(current.duration - span.duration) <= 1) return current;
        const cells = this._cellCount(span.duration);
        if (!cells) return current && current.identity === identity ? current : null;
        current?.destroy();
        this._cancelRequest();
        // Whatever the preview showed belongs to the previous source.
        this._hideVideoFrame();
        this._showFrameImage(null);
        // The preview video may still hold the previous source; it reloads before use.
        this._lastUrl = null;
        this._frames = new PreviewFrames({ identity, key, duration: span.duration, cells });
        return this._frames;
    }

    // One frame per point the pointer can take when the player fills the screen.
    _cellCount(duration) {
        const track = this._progressContainer.getBoundingClientRect();
        if (!(track.width > 0) || !(duration > 0)) return 0;
        const player = this._getTooltipHost().getBoundingClientRect?.();
        // The track keeps its side margins in fullscreen.
        const margins = Math.max(0, (player?.width || track.width) - track.width);
        const screenWidth = Number(global.screen?.width) || 0;
        const widest = Math.max(track.width, screenWidth - margins);
        // A short clip still needs no more than one frame a second.
        return Math.max(1, Math.min(Math.round(widest), Math.ceil(duration)));
    }

    _showFrameImage(url) {
        const image = this._frameImage;
        if (!url) {
            image.style.visibility = 'hidden';
            return;
        }
        if (image.getAttribute('src') !== url) image.src = url;
        image.style.visibility = 'visible';
    }

    // Keeps the frame the preview video has just decoded for its point.
    _keepFrame(frames, cell) {
        const video = this._ghostVideo;
        if (frames.destroyed || frames.disabled || !video.videoWidth || !video.videoHeight) return;
        const size = this._frameSize();
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        try {
            const context = canvas.getContext('2d');
            if (!context) return;
            // Crop like the video's object-fit: cover, so both pictures match.
            const scale = Math.max(size.width / video.videoWidth, size.height / video.videoHeight);
            const width = size.width / scale;
            const height = size.height / scale;
            context.drawImage(video, (video.videoWidth - width) / 2, (video.videoHeight - height) / 2,
                width, height, 0, 0, size.width, size.height);
            canvas.toBlob(blob => {
                if (!blob || this._destroyed) return;
                frames.put(cell, blob);
                // The pointer may rest on this point before the video itself is shown.
                if (this._hovering && this._hoverCell === cell && frames === this._frames
                    && this._ghostVideo.style.visibility !== 'visible') this._showFrameImage(frames.get(cell)?.url);
            }, 'image/jpeg', FRAME_QUALITY);
        } catch {
            // A picture from another site without permission cannot be kept.
            frames.disabled = true;
        }
    }

    _frameSize() {
        const scale = Math.min(2, Math.max(1, global.devicePixelRatio || 1));
        const width = this._ghostVideo.clientWidth || FRAME_WIDTH;
        const height = this._ghostVideo.clientHeight || FRAME_HEIGHT;
        return { width: Math.round(width * scale), height: Math.round(height * scale) };
    }

    // While the film plays, prepares the frames of the points not shown yet, from the
    // film's position forward, so a later hover shows them at once.
    _scheduleFill(delay = FILL_CHECK_MS) {
        clearTimeout(this._fillTimer);
        if (this._destroyed) return;
        this._fillTimer = setTimeout(() => this._fillStep(), delay);
    }

    _fillStep() {
        if (this._destroyed) return;
        let next = FILL_CHECK_MS;
        try {
            if (this._request || this._hovering || global.document?.hidden) return;
            const video = this._getActiveVideo();
            const span = video ? global.PlayerMediaControls?.Timeline?.describe(video) : null;
            if (!span || span.duration <= 0) return;
            const frames = this._framesFor(video, span);
            if (!frames || !frames.loaded || frames.disabled || !this._isFilmSteady(video)) return;
            const cell = frames.nextMissing(video.currentTime, span.availableEnd);
            if (cell === null) return;
            // The decoded frame schedules the next step; a failure does too.
            if (this._seekGhost(frames.timeOf(cell), cell, 'fill')) next = null;
        } finally {
            if (next !== null) this._scheduleFill(next);
        }
    }

    // Preparation never competes with a film that is starting, seeking or short of data.
    _isFilmSteady(video) {
        if (video.seeking || video.readyState < 3) return false;
        if (video.paused) return true;
        const time = video.currentTime;
        const ranges = video.buffered;
        for (let index = 0; index < (ranges?.length || 0); index++) {
            if (ranges.start(index) <= time + 0.5 && ranges.end(index) > time) {
                return ranges.end(index) - time >= FILL_MIN_AHEAD_S;
            }
        }
        return false;
    }

    _failFillRequest() {
        const request = this._request;
        if (!request || request.kind !== 'fill') return;
        this._cancelRequest();
        if (request.frames === this._frames) request.frames.fail(request.cell);
        this._ghostHls?.stopLoad();
        this._scheduleFill(FILL_GAP_MS);
    }

    // ─── Core ─────────────────────────────────────────────────────────────────

    _seekGhost(time, cell = null, kind = 'hover') {
        if (this._destroyed) return false;
        // A lighter stream of the same film, when the source offers one, costs
        // less per frame than the quality being watched.
        let preview = this._getPreviewSource();
        if (!preview?.url || !preview.config || this._failedPreviews.has(preview)) preview = null;
        const url = preview?.url || this._getCurrentUrl();

        if (!url || url.startsWith('blob:')) {
            return false;
        }

        clearTimeout(this._requestTimer);
        // The preview video moves to another moment: what it showed no longer stands.
        this._hideVideoFrame();
        this._request = { time, cell, kind, frames: this._frames };
        this._targetTime = time;
        if (url !== this._lastUrl) {
            this._previewSource = preview;
            this._initSource(url);
            this._lastUrl = url;
        } else {
            this._ghostHls?.startLoad(time);
        }
        if (kind === 'fill') this._requestTimer = setTimeout(() => this._failFillRequest(), FILL_STEP_TIMEOUT_MS);

        this._applyTarget();
        return true;
    }

    _applyTarget() {
        if (this._destroyed || this._targetTime === null || this._ghostVideo.readyState < 1) return;
        // The preview has its own source and buffers. The primary video's MSE
        // range can cover only the current fragment, not the requested frame.
        this._ghostVideo.currentTime = this._targetTime;
        this._ghostVideo.pause();
        this._onFrameReady();
    }

    _onFrameReady() {
        const request = this._request;
        const video = this._ghostVideo;
        if (this._destroyed || !request || video.readyState < 2 || video.seeking) return;
        if (Math.abs(video.currentTime - request.time) >= 0.5) return;
        this._cancelRequest();
        if (request.cell !== null && request.frames && request.frames === this._frames) {
            this._keepFrame(request.frames, request.cell);
        }
        this._ghostHls?.stopLoad();
        if (request.kind === 'hover') {
            // Shown only while the pointer still rests on the point it was decoded for.
            if (this._hovering && request.cell === this._hoverCell) {
                video.style.visibility = 'visible';
                this._videoCell = request.cell;
                this._showFrameImage(null);
            }
        } else {
            this._scheduleFill(FILL_GAP_MS);
        }
    }

    _initSource(url) {
        // Уничтожаем предыдущий HLS инстанс
        if (this._ghostHls) {
            this._ghostHls.destroy();
            this._ghostHls = null;
        }
        this._ghostVideo.removeAttribute('src');

        const isHlsUrl = this._getCurrentType() === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url);
        this._Hls ||= typeof Hls !== 'undefined' ? Hls : null;
        // A lighter preview stream brings its own protected transport and scope.
        const preview = this._previewSource || null;
        const activeConfig = preview?.config || this._getCurrentHls?.()?.config || {};
        const protectedHls = activeConfig.loader?.movieExtensionPolicyLoader === true;
        // When the lighter stream fails, later frames use the stream being watched.
        const dropPreview = () => {
            if (preview) this._failedPreviews?.add(preview);
            this._lastUrl = null;
        };
        if (isHlsUrl && window.location.protocol === 'chrome-extension:' && !protectedHls) {
            this._ghostVideo.style.visibility = 'hidden';
            return;
        }

        if (isHlsUrl && this._Hls && this._Hls.isSupported()) {
            this._ghostHls = new this._Hls({
                // Keep source-specific loaders/authentication from the active
                // extension stream (including signed local torrent sessions).
                ...activeConfig,
                autoStartLoad: false,
                // One frame needs one piece: do not fetch the pieces after it.
                maxBufferLength:    2,
                maxMaxBufferLength: 4,
                backBufferLength: 0,
                startFragPrefetch: false,
            });
            const instance = this._ghostHls;
            this._ghostHls.on(this._Hls.Events.ERROR, (event, data) => {
                if (data.response?.text === 'POLICY_VIOLATION') {
                    if (this._ghostHls !== instance) return;
                    this._ghostHls = null;
                    this._ghostVideo.style.visibility = 'hidden';
                    dropPreview();
                    instance.destroy();
                    return;
                }
                if (data.fatal) {
                    this._ghostVideo.style.visibility = 'hidden';
                    // The next frame reloads the source instead of asking a dead player.
                    if (this._ghostHls === instance) dropPreview();
                }
                console.debug('[GhostPlayer] Preview unavailable:', globalThis.PlayerDiagnostics?.sanitizeError(data) || { category: 'unknown' });
            });
            this._ghostHls.on(this._Hls.Events.MANIFEST_PARSED, () => {
                if (this._destroyed || this._ghostHls !== instance || this._targetTime === null) return;
                const levels = this._ghostHls.levels || [];
                const lowest = levels.reduce((best, level, index) =>
                    level.bitrate < levels[best].bitrate ? index : best, 0);
                if (levels.length) {
                    this._ghostHls.startLevel = lowest;
                    this._ghostHls.loadLevel = lowest;
                }
                this._ghostHls.startLoad(this._targetTime);
            });
            instance.loadSource(url);
            if (this._ghostHls === instance) instance.attachMedia(this._ghostVideo);
        } else if (isHlsUrl && protectedHls) {
            this._ghostVideo.style.visibility = 'hidden';
            return;
        } else if (isHlsUrl && this._ghostVideo && this._ghostVideo.canPlayType('application/vnd.apple.mpegurl')) {
            // Нативный HLS (Safari)
            this._ghostVideo.src = url;
            this._ghostVideo.load();
        } else {
            // MP4 или прямая ссылка
            this._ghostVideo.src = url;
            this._ghostVideo.load();
        }

        this._ghostVideo.addEventListener('error', (e) => {
            console.error('[GhostPlayer] ghostVideo error', { code: Number(this._ghostVideo.error?.code) || 0 });
        }, { once: true });
    }

    // ─── UI ───────────────────────────────────────────────────────────────────

    _getTooltipHost() {
        // Provider frames mount a fixed wrapper at the maximum z-index. A body
        // sibling is painted beneath that wrapper even when its own z-index is
        // very large. Keep the preview in the same player stacking context.
        return this._progressContainer.closest('.native-player-wrapper')
            || document.fullscreenElement || document.body;
    }

    _showTooltip(clientX, barTop, time) {
        const host = this._getTooltipHost();
        if (this._tooltip.parentElement !== host) host.appendChild(this._tooltip);
        this._tooltip.style.display = 'flex';
        // Принудительный reflow, чтобы offsetWidth был актуален
        const w = this._tooltip.offsetWidth || 180;
        const h = this._tooltip.offsetHeight || 116;

        const hostRect = host.getBoundingClientRect();
        const hostWidth = host.clientWidth || window.innerWidth;
        const scaleX = hostRect.width > 0 ? host.offsetWidth / hostRect.width : 1;
        const scaleY = hostRect.height > 0 ? host.offsetHeight / hostRect.height : 1;
        let left = (clientX - hostRect.left) * scaleX - w / 2;
        left = Math.max(8, Math.min(left, hostWidth - w - 8));

        const top = Math.max(8, (barTop - hostRect.top) * scaleY - h - 14);

        this._tooltip.style.left = `${left}px`;
        this._tooltip.style.top  = `${top}px`;

        this._timeLabel.textContent = this._formatTime(time);

        // Use requestAnimationFrame to ensure display: flex is applied before adding visibility class
        cancelAnimationFrame(this._showFrame);
        this._showFrame = requestAnimationFrame(() => {
            if (!this._destroyed && this._hovering) this._tooltip.classList.add('ghost-tooltip--visible');
        });

    }

    _formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        clearTimeout(this._debounce);
        clearTimeout(this._hideTimer);
        clearTimeout(this._fillTimer);
        clearTimeout(this._requestTimer);
        cancelAnimationFrame(this._showFrame);
        this._progressContainer.removeEventListener('mousemove',  this._onMove);
        this._progressContainer.removeEventListener('mouseleave', this._onLeave);
        if (this._ghostHls) {
            this._ghostHls.destroy();
            this._ghostHls = null;
        }
        this._ghostVideo.removeEventListener('loadedmetadata', this._onMetadata);
        this._ghostVideo.removeEventListener('seeked', this._onSeeked);
        this._ghostVideo.removeEventListener('loadeddata', this._onSeeked);
        this._request = null;
        this._frames?.destroy();
        this._frames = null;
        this._previewSource = null;
        this._ghostVideo.pause();
        this._ghostVideo.removeAttribute('src');
        this._ghostVideo.load();
        this._tooltip.remove();
    }
}
    global.GhostPlayer = GhostPlayer;
})(typeof window !== 'undefined' ? window : globalThis);
