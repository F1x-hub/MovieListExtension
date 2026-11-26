/**
 * PlayerAmbientLight - the colours of the playing picture spread behind the player
 * dialog, like YouTube's ambient mode.
 *
 * A 48x27 copy of the picture is blended into a canvas behind the dialog; CSS blurs and
 * stretches it. The picture comes from the first of these that works for the source:
 *   page     - a <video> on this page (HDRezka, Seasonvar, AnimeGo, Rutube HLS, torrent):
 *              drawn directly; drawing never reads pixels, so another site's file is fine.
 *   frame    - a provider frame whose player-cleaner can read its own video: it sends
 *              48x27 pixels (PLAYER_AMBIENT_FRAME) while this page keeps asking.
 *   capture  - anything else (a protected picture, a video in a nested frame, no cleaner):
 *              a capture of this tab, cropped to the video. Chrome allows it only with the
 *              optional <all_urls> permission, asked for when the viewer turns the light on.
 * The dialog and its controls stay neutral; colour appears only outside it, on the scrim.
 * The setting is local (STORAGE_KEY) and never reaches a watch room.
 */
(function (global) {
    'use strict';
    const STORAGE_KEY = 'movieExtension_ambientLight';
    const WIDTH = 48;
    const HEIGHT = 27;
    const SAMPLE_MS = 200;
    const REDUCED_SAMPLE_MS = 1000;
    const IDLE_MS = 500;
    // Chrome allows two tab captures a second.
    const CAPTURE_MS = 550;
    // Pixels from the frame newer than this are preferred to a capture.
    const FRAME_FRESH_MS = 1500;
    // The frame samples only while asked; it stops by itself a few seconds after the last ask.
    const KEEPALIVE_MS = 2000;
    // Each sample replaces this share of the light, so a cut fades in instead of flashing.
    const BLEND = 0.35;
    const ALL_URLS = Object.freeze({ origins: ['<all_urls>'] });
    let sequence = 0;

    class PlayerAmbientLight {
        constructor({ modal, stage, container } = {}) {
            if (!modal || !stage || !container) throw new TypeError('PlayerAmbientLight needs the dialog, the stage and the video container');
            this.modal = modal;
            this.stage = stage;
            this.container = container;
            this.doc = modal.ownerDocument;
            this.enabled = true;
            this.hasAccess = false;
            this.mode = 'none';
            this.sourceKey = null;
            this.frame = null;
            this.lastFrameAt = 0;
            this.lastKeepaliveAt = 0;
            this.lastCaptureAt = 0;
            this.captureBusy = false;
            this.timer = null;
            this.disposed = false;
            this.reducedMotion = global.matchMedia?.('(prefers-reduced-motion: reduce)');
            // A capture covers the whole tab, so it would be cropped wrongly inside another page.
            this.canCapture = global.top === global && typeof global.chrome?.tabs?.captureVisibleTab === 'function';

            this.canvas = this.doc.createElement('canvas');
            this.canvas.className = 'player-ambient';
            this.canvas.width = WIDTH;
            this.canvas.height = HEIGHT;
            this.canvas.setAttribute('aria-hidden', 'true');
            this.context = this.canvas.getContext('2d');
            this.scratch = this.doc.createElement('canvas');
            this.scratch.width = WIDTH;
            this.scratch.height = HEIGHT;
            this.scratchContext = this.scratch.getContext('2d');
            // Before the workspace, so the dialog paints over the light.
            modal.prepend(this.canvas);

            this.onMessage = event => this.handleFrameMessage(event);
            global.addEventListener('message', this.onMessage);
            this.onSet = event => this.setEnabled(event.detail?.enabled === true);
            global.addEventListener('movie-player-ambient-set', this.onSet);
            this.onStorage = (changes, area) => {
                if (area === 'local' && Object.hasOwn(changes, STORAGE_KEY)) this.applyEnabled(changes[STORAGE_KEY].newValue !== false);
            };
            global.chrome?.storage?.onChanged?.addListener(this.onStorage);
            this.onPermissions = () => { void this.refreshAccess(); };
            global.chrome?.permissions?.onAdded?.addListener(this.onPermissions);
            global.chrome?.permissions?.onRemoved?.addListener(this.onPermissions);
            this.resizeObserver = new global.ResizeObserver(() => this.place());
            this.resizeObserver.observe(stage);
            this.resizeObserver.observe(modal);

            void this.load();
            this.schedule(0);
        }

        /** What the player menu shows: 'on', 'off' or 'needs-access'. */
        get status() {
            if (!this.enabled) return 'off';
            return this.mode === 'needs-access' ? 'needs-access' : 'on';
        }

        async load() {
            try {
                const stored = await global.chrome?.storage?.local?.get(STORAGE_KEY);
                if (stored && Object.hasOwn(stored, STORAGE_KEY)) this.applyEnabled(stored[STORAGE_KEY] !== false);
            } catch { /* The light stays on by default. */ }
            await this.refreshAccess();
        }

        async refreshAccess() {
            try {
                this.hasAccess = this.canCapture && await global.chrome.permissions.contains(ALL_URLS) === true;
            } catch {
                this.hasAccess = false;
            }
        }

        applyEnabled(enabled) {
            if (this.enabled === enabled) return;
            this.enabled = enabled;
            if (!enabled) this.reset();
            this.announce();
        }

        /**
         * The viewer's choice from the player menu. Runs inside the click (a click in a provider
         * frame activates this page as well), so Chrome can ask for capture access here. It asks
         * only once the menu says «Нужен доступ»: a frame that sends its own pixels needs none.
         */
        setEnabled(enabled) {
            if (this.disposed) return;
            if (enabled && this.canCapture && !this.hasAccess && this.mode === 'needs-access') {
                global.chrome.permissions.request(ALL_URLS)
                    .then(granted => { this.hasAccess = granted === true; this.schedule(0); })
                    .catch(() => { /* Refused or no longer in the click: the menu keeps saying so. */ });
            }
            this.applyEnabled(enabled);
            try { void global.chrome?.storage?.local?.set({ [STORAGE_KEY]: enabled }); } catch { /* Kept for this page only. */ }
        }

        isVisible() {
            return this.modal.style.display !== 'none'
                && !this.modal.classList.contains('minimized-overlay')
                && this.doc.visibilityState === 'visible'
                && !this.doc.fullscreenElement
                && !this.doc.pictureInPictureElement;
        }

        pageVideo() {
            const video = this.container.querySelector('video:not(.ghost-video)');
            return video && video.videoWidth > 0 && video.videoHeight > 0 ? video : null;
        }

        currentFrame() {
            const element = this.container.querySelector('iframe');
            if (!element) return null;
            if (this.frame?.element === element && this.frame.src === element.src) return this.frame;
            let origin = null;
            try {
                const url = new URL(element.src, global.location.href);
                if (['https:', 'http:'].includes(url.protocol)) origin = url.origin;
            } catch { /* Not a provider frame. */ }
            this.frame = origin ? { element, src: element.src, origin, requestId: ++sequence } : null;
            this.lastFrameAt = 0;
            this.lastKeepaliveAt = 0;
            return this.frame;
        }

        schedule(delay) {
            clearTimeout(this.timer);
            if (!this.disposed) this.timer = setTimeout(() => this.tick(), delay);
        }

        tick() {
            if (this.disposed) return;
            if (!this.enabled || !this.isVisible()) {
                // What a previous source needed says nothing about a new one.
                const key = this.pageVideo() || this.container.querySelector('iframe');
                if (key !== this.sourceKey) {
                    this.sourceKey = key;
                    this.mode = 'none';
                    this.reset();
                }
                this.keepFrameAsking();
                this.schedule(IDLE_MS);
                return;
            }
            const video = this.pageVideo();
            if (video) {
                this.useSource(video, 'page');
                this.draw(video);
            } else {
                const frame = this.currentFrame();
                this.keepFrameAsking();
                if (!frame) {
                    this.useSource(null, 'none');
                } else if (Date.now() - this.lastFrameAt <= FRAME_FRESH_MS) {
                    this.useSource(frame.element, 'frame');
                } else if (this.hasAccess) {
                    this.useSource(frame.element, 'capture');
                    void this.capture();
                } else {
                    this.useSource(frame.element, this.canCapture ? 'needs-access' : 'none');
                }
            }
            this.schedule(this.reducedMotion?.matches ? REDUCED_SAMPLE_MS : SAMPLE_MS);
        }

        /** A new source starts from darkness, never from the previous film's colours. */
        useSource(key, mode) {
            const changedMode = this.mode !== mode;
            // Without a picture the light goes out instead of freezing on the last colours.
            if (this.sourceKey !== key || (changedMode && ['none', 'needs-access'].includes(mode))) {
                this.sourceKey = key;
                this.reset();
            }
            this.mode = mode;
            if (changedMode) this.announce();
        }

        reset() {
            this.context.clearRect(0, 0, WIDTH, HEIGHT);
            this.canvas.classList.remove('is-lit');
        }

        /** Tells the frame's cleaner to keep sampling, and what its menu should show. */
        keepFrameAsking(force = false) {
            const frame = this.currentFrame();
            if (!frame || !frame.element.isConnected) return;
            const now = Date.now();
            if (!force && now - this.lastKeepaliveAt < KEEPALIVE_MS) return;
            this.lastKeepaliveAt = now;
            // Off or out of sight, the frame is told the state but not to sample.
            const sampling = this.enabled && this.isVisible();
            try {
                frame.element.contentWindow?.postMessage({
                    type: 'PLAYER_AMBIENT_START', requestId: frame.requestId,
                    status: this.status, sampling
                }, frame.origin);
            } catch { /* The frame is gone. */ }
        }

        announce() {
            this.keepFrameAsking(true);
            global.dispatchEvent(new global.CustomEvent('movie-player-ambient-status', { detail: { status: this.status } }));
        }

        handleFrameMessage(event) {
            const frame = this.frame;
            const type = event.data?.type;
            if (this.disposed || !frame || !frame.element.isConnected || frame.element.src !== frame.src
                || event.source !== frame.element.contentWindow || event.origin !== frame.origin
                || event.data?.requestId !== frame.requestId) return;
            if (type === 'PLAYER_AMBIENT_SET') {
                this.setEnabled(event.data.enabled === true);
            } else if (type === 'PLAYER_AMBIENT_FRAME') {
                const { width, height, pixels } = event.data;
                if (width !== WIDTH || height !== HEIGHT || !(pixels instanceof Uint8ClampedArray)
                    || pixels.length !== WIDTH * HEIGHT * 4) return;
                if (!this.enabled || !this.isVisible() || this.pageVideo()) return;
                this.lastFrameAt = Date.now();
                this.useSource(frame.element, 'frame');
                this.scratchContext.putImageData(new ImageData(pixels, WIDTH, HEIGHT), 0, 0);
                this.draw(this.scratch);
            }
        }

        async capture() {
            const now = Date.now();
            if (this.captureBusy || now - this.lastCaptureAt < CAPTURE_MS) return;
            this.captureBusy = true;
            this.lastCaptureAt = now;
            const key = this.sourceKey;
            try {
                const url = await global.chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 40 });
                const image = new global.Image();
                image.src = url;
                await image.decode();
                const box = this.container.getBoundingClientRect();
                if (this.mode !== 'capture' || this.sourceKey !== key || !this.isVisible() || !(box.width > 0)) return;
                const scale = image.naturalWidth / global.innerWidth;
                // Inside the video only, so the light never samples itself or the dialog.
                const left = Math.max(0, box.left * scale);
                const top = Math.max(0, box.top * scale);
                const width = Math.min(image.naturalWidth - left, box.width * scale);
                const height = Math.min(image.naturalHeight - top, box.height * scale);
                if (width > 0 && height > 0) this.draw(image, [left, top, width, height]);
            } catch {
                // A refused or failed capture leaves the light as it was.
            } finally {
                this.captureBusy = false;
            }
        }

        draw(source, crop = null) {
            const context = this.context;
            context.globalAlpha = this.reducedMotion?.matches ? 1 : BLEND;
            try {
                if (crop) context.drawImage(source, ...crop, 0, 0, WIDTH, HEIGHT);
                else context.drawImage(source, 0, 0, WIDTH, HEIGHT);
            } catch {
                return;
            } finally {
                context.globalAlpha = 1;
            }
            if (!this.canvas.classList.contains('is-lit')) {
                this.place();
                this.canvas.classList.add('is-lit');
            }
        }

        /** The light sits behind the video, a little larger than it, wherever the dialog moves it. */
        place() {
            const box = this.stage.getBoundingClientRect();
            const frame = this.modal.getBoundingClientRect();
            if (!(box.width > 0)) return;
            // The dialog nearly fills a laptop screen, so the light reaches well past it.
            const spreadX = box.width * 0.12;
            const spreadY = box.height * 0.2;
            const style = this.canvas.style;
            style.left = `${box.left - frame.left - spreadX}px`;
            style.top = `${box.top - frame.top - spreadY}px`;
            style.width = `${box.width + spreadX * 2}px`;
            style.height = `${box.height + spreadY * 2}px`;
        }

        destroy() {
            if (this.disposed) return;
            this.disposed = true;
            clearTimeout(this.timer);
            global.removeEventListener('message', this.onMessage);
            global.removeEventListener('movie-player-ambient-set', this.onSet);
            global.chrome?.storage?.onChanged?.removeListener(this.onStorage);
            global.chrome?.permissions?.onAdded?.removeListener(this.onPermissions);
            global.chrome?.permissions?.onRemoved?.removeListener(this.onPermissions);
            this.resizeObserver.disconnect();
            this.canvas.remove();
            if (global.movieAmbientLight === this) global.movieAmbientLight = null;
        }
    }

    PlayerAmbientLight.STORAGE_KEY = STORAGE_KEY;
    global.PlayerAmbientLight = PlayerAmbientLight;
})(typeof window === 'undefined' ? globalThis : window);
