// Runs in MAIN before a supported provider constructs its VenomPlayer.
// player-venom exposes a native no-ad query flag; use it only for provider
// frames owned by this extension and leave ordinary website embeds unchanged.
(() => {
    'use strict';

    // Venom never adapts: without a choice saved by the viewer it plays its lowest
    // quality. A number above every rung makes it take the highest one.
    const BEST_QUALITY = 99999;
    // Allplay saves whatever it plays (480p at first) as if the viewer had chosen it.
    const ALLPLAY_STORAGE_KEY = 'allplay';
    const ALLPLAY_CHOSEN_KEY = 'movieExtension_qualityChosen';
    const ALLPLAY_BEST = 2160;
    const STALL_MS = 2500;
    const STALL_WINDOW_MS = 120000;
    const START_LIMIT_MS = 12000;

    const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}(?:\/|$)/i;
    const origins = [];
    try {
        if (document.referrer) origins.push(document.referrer);
    } catch {
        // Ignore restricted referrer access and rely on ancestorOrigins.
    }
    try {
        origins.push(...Array.from(window.location.ancestorOrigins || []));
    } catch {
        // Ignore browsers that do not expose ancestorOrigins.
    }

    let embedded = true;
    try {
        embedded = self !== top;
    } catch {
        // A cross-origin top window is still an embedded provider frame.
    }
    if (!embedded) return;

    try {
        const providerUrl = new URL(window.location.href);
        const extensionAncestor = origins.some(origin => extensionOrigin.test(origin));
        const hasNoAdFlag = providerUrl.searchParams.get('santabarbaranoads') === '1';
        // Chromium can hide both document.referrer and ancestorOrigins when a
        // cross-origin provider iframe uses referrerpolicy=no-referrer. The
        // flag is an explicit marker added by this extension, so it is safe to
        // use it as the second half of the embedding boundary.
        if (!extensionAncestor && !hasNoAdFlag) return;

        if (!hasNoAdFlag) {
            providerUrl.searchParams.set('santabarbaranoads', '1');
            window.history.replaceState(null, '', providerUrl.href);
        }

        // player-venom normally honors santabarbaranoads itself. Keep a
        // provider-side fallback as well: some builds resolve the URL through
        // top.location before their query parser, then still pass adsConfig to
        // the constructor. Install these accessors before the provider's
        // inline scripts assign adsConfig and the UMD library.
        installVenomAdConfigGuard();
        // Set by the host page beside the ad flag: a plain website embed never has both.
        disablePeerToPeer();
        installVenomFactoryGuard();
        preferBestAllplayQuality();
        console.info('[ProviderAdGuard] Venom no-ad mode enabled', {
            host: providerUrl.hostname,
            embeddedBy: origins.find(origin => extensionOrigin.test(origin)) || 'santabarbaranoads'
        });
    } catch (error) {
        console.warn('[ProviderAdGuard] Failed to enable Venom no-ad mode:', error);
    }

    // Venom serves what it has downloaded to other viewers over WebRTC. That takes the
    // viewer's upload and processor; the film itself comes from the CDN either way.
    function disablePeerToPeer() {
        for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
            try { Object.defineProperty(window, name, { configurable: true, writable: true, value: undefined }); }
            catch { /* Playback does not depend on it. */ }
        }
    }

    function hasSavedQuality() {
        try { return Object.keys(window.localStorage).some(key => key.endsWith('.quality')); }
        catch { return false; }
    }

    // Allplay takes its quality from storage when it starts and settles on the nearest one
    // the episode has. A press in its quality menu, or in ours, is the viewer's choice.
    function preferBestAllplayQuality() {
        if (!/(?:^|\.)(?:stravers\.live|allarknow\.online|stloadi\.live)$/.test(window.location.hostname)) return;
        const chosen = () => {
            try { return window.localStorage.getItem(ALLPLAY_CHOSEN_KEY) === '1'; } catch { return true; }
        };
        const remember = () => {
            if (chosen()) return;
            try {
                const saved = JSON.parse(window.localStorage.getItem(ALLPLAY_STORAGE_KEY) || '{}') || {};
                window.localStorage.setItem(ALLPLAY_STORAGE_KEY, JSON.stringify({ ...saved, quality: ALLPLAY_BEST }));
            } catch { /* Storage may be closed: Allplay keeps its own default. */ }
        };
        remember();
        document.addEventListener('click', event => {
            if (!event.target?.closest?.('[data-allplay="quality"]')) return;
            try { window.localStorage.setItem(ALLPLAY_CHOSEN_KEY, '1'); } catch { /* Not kept. */ }
        }, true);
        watchStalls(document, video => video.classList.contains('allplay__video'), () => {
            const player = window.player;
            const lower = Math.max(...(player?.options?.quality || []).map(Number).filter(value => value < Number(player.quality)));
            if (chosen() || !Number.isFinite(lower)) return;
            player.quality = lower;
            // The next episode starts from the best one again.
            setTimeout(remember, 0);
        });
    }

    // One step down when the connection cannot keep the best quality: two long stalls in
    // two minutes, or a start that takes too long. A quality the viewer chose stays.
    function keepPlaybackSmooth(player, options) {
        const container = options?.container || document.body;
        watchStalls(container, video => container.contains(video), () => {
            const settings = player?.cp?.settings;
            if (hasSavedQuality() || !Array.isArray(settings?.qualities) || typeof settings.changeQuality !== 'function') return;
            const current = Number(settings.currentQuality);
            const lower = Math.max(...settings.qualities.map(Number).filter(value => value < current));
            if (!Number.isFinite(lower)) return;
            settings.changeQuality(lower);
            player.updateQuality?.(lower);
            settings.currentQuality = lower;
        });
    }

    function watchStalls(root, owns, onPersistent) {
        const stalls = [];
        let stallTimer = null;
        let startTimer = null;
        let startedAt = 0;
        const stepDown = () => {
            stalls.length = 0;
            try { onPersistent(); } catch { /* The quality stays. */ }
        };
        const clear = () => {
            clearTimeout(stallTimer);
            clearTimeout(startTimer);
            stallTimer = startTimer = null;
        };
        const isFilm = video => video?.tagName === 'VIDEO' && video.dataset.ghost !== 'true' && owns(video);
        root.addEventListener('play', event => {
            if (!isFilm(event.target) || startedAt || startTimer) return;
            startTimer = setTimeout(stepDown, START_LIMIT_MS);
        }, true);
        root.addEventListener('playing', event => {
            if (!isFilm(event.target)) return;
            startedAt ||= Date.now();
            clear();
        }, true);
        for (const type of ['seeking', 'pause']) {
            root.addEventListener(type, event => { if (isFilm(event.target)) clear(); }, true);
        }
        root.addEventListener('waiting', event => {
            const video = event.target;
            if (!isFilm(video) || video.seeking || !startedAt || stallTimer) return;
            stallTimer = setTimeout(() => {
                stallTimer = null;
                if (video.paused || video.readyState > 2) return;
                const now = Date.now();
                stalls.push(now);
                while (stalls.length && now - stalls[0] > STALL_WINDOW_MS) stalls.shift();
                if (stalls.length >= 2) stepDown();
            }, STALL_MS);
        }, true);
    }

    function installVenomFactoryGuard() {
        let library;
        Object.defineProperty(window, 'VenomPlayer', {
            configurable: true,
            enumerable: true,
            get() { return library; },
            set(value) {
                if (!value || typeof value.make !== 'function') {
                    library = value;
                    return;
                }
                // The UMD bundle assigns this global before the page calls
                // make(). Its module exports may be read-only; do not mutate them.
                library = Object.create(value);
                Object.defineProperty(library, 'make', {
                    value(options, ...args) {
                        const prepared = options && typeof options === 'object'
                            ? { ...options, ads: null, stats: null, quality: BEST_QUALITY } : options;
                        const player = value.make.call(value, prepared, ...args);
                        try { keepPlaybackSmooth(player, prepared); }
                        catch { /* The chosen quality stays. */ }
                        try { window.MovieExtensionPreviewBridge?.trackVenom(player, prepared); }
                        catch { /* Preview discovery must not interrupt provider playback. */ }
                        return player;
                    }
                });
            }
        });
    }

    function installVenomAdConfigGuard() {
        let adsConfigValue;

        try {
            Object.defineProperty(window, 'adsConfig', {
                configurable: true,
                enumerable: true,
                get() {
                    return adsConfigValue;
                },
                set(value) {
                    // A null value makes player-venom take its explicit
                    // no-ads path (`!options.ads`) even if its own query
                    // detection is bypassed by an embedding boundary.
                    adsConfigValue = value && typeof value === 'object' ? null : value;
                }
            });
        } catch (error) {
            console.debug('[ProviderAdGuard] Could not guard adsConfig:', error);
        }

    }
})();
