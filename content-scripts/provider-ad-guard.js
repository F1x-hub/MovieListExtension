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

    // Venom plays DASH (`dash`, or `dasha` for AV1) before HLS. Its DASH engine, dash.js
    // 3.0, throws away all but the fragment being played on every seek, so jumping around
    // loads again; its HLS engine keeps what it loaded, but this balancer's HLS stops at
    // 720p while DASH has 1080p. So DASH plays while the viewer watches, HLS takes over
    // while they jump around, and DASH comes back after a while of plain watching. The
    // switch is Venom's own `renew` with `_fallFrom`, the path it takes itself when DASH
    // fails to decode: a new player at the same moment, the dub kept. Measured on Collaps
    // on 2026-11-28: HLS plays 1–7.5 s after the burst (its first fragments are slow to
    // come), DASH about 2 s after the calm period, unseen at a pause. A new episode starts
    // on DASH.
    const SEEK_BURST = 3;
    const SEEK_BURST_MS = 5000;
    // The burst is over: the jump the viewer settled on is where HLS starts.
    const SEEK_SETTLE_MS = 700;
    const CALM_BEFORE_DASH_MS = 120000;
    const PAUSE_AFTER_SEEK_MS = 20000;
    // A starting film seeks by itself (Venom's resume, then the move to the asked moment):
    // those are not the viewer's, so seeks count from a while after it plays.
    const QUIET_AFTER_START_MS = 3000;
    const RESUME_LIMIT_MS = 8000;
    // Its HLS module is fetched on the first switch, so the first start can take seconds.
    const PLAY_RETRY_MS = 20000;

    function switchEngineBySeeking(facade, options) {
        if (typeof facade?.once !== 'function') return;
        // The extension's controls move the film into their own wrapper, out of Venom's
        // container, so media events are watched on the whole frame.
        const container = document;
        let player = null;
        // Venom hands its internal player to listeners as `this`; only it can renew.
        const capture = () => facade.once('timeupdate', function captureInternal() {
            if (typeof this?.renew === 'function' && this.config?.source) player = this;
        });
        capture();
        const film = () => [...container.querySelectorAll('video')]
            .filter(video => video.isConnected && video.dataset.ghost !== 'true' && (video.currentSrc || video.src))
            .sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0))[0] || null;
        const hasDash = source => Boolean(source && (source.dash || source.dasha));
        const hasHls = source => Boolean(source && (source.hls || source.hlsList));
        let dashSource = null;
        let onHls = false;
        let switching = false;
        let seeks = [];
        let settleTimer = null;
        let calmTimer = null;
        let quietUntil = Infinity;
        // A new episode or title builds its source from the playlist: DASH again.
        function onEpisode() {
            quietUntil = Infinity;
            onHls = false;
            dashSource = null;
            seeks = [];
            clearTimeout(calmTimer);
            clearTimeout(settleTimer);
            capture();
        }

        const renewAt = (config, time, wasPaused) => {
            switching = true;
            quietUntil = Infinity;
            const previous = film();
            // A time in the frame's address outranks `time` unless it is ignored.
            const next = player.renew({ ...config, time, ignoreUrlTime: true });
            player = next;
            // Listeners belong to one player: the new one needs its own.
            next.on?.('playlistItem', onEpisode);
            capture();
            // In case Venom still starts elsewhere, the film is moved to `time` below.
            const started = performance.now();
            let finished = false;
            const done = () => {
                if (finished) return;
                finished = true;
                switching = false;
                waitForCalm();
            };
            const settle = () => {
                const video = film();
                if (!video || video === previous) {
                    if (performance.now() - started < RESUME_LIMIT_MS) setTimeout(settle, 50);
                    else done();
                    return;
                }
                // Venom's HLS loads nothing until the film is played, and it first fetches
                // its HLS module and attaches a new source, which undoes an early play().
                if (!wasPaused) {
                    const until = performance.now() + PLAY_RETRY_MS;
                    const keepPlaying = () => {
                        if (!video.isConnected || performance.now() > until) return;
                        if (video.paused) video.play().catch(() => {});
                        if (video.paused || video.readyState < 3) setTimeout(keepPlaying, 250);
                    };
                    keepPlaying();
                }
                const go = () => {
                    if (Math.abs(video.currentTime - time) > 1) video.currentTime = time;
                    setTimeout(done, 1000);
                };
                if (video.readyState >= 1) go();
                else {
                    video.addEventListener('loadedmetadata', go, { once: true });
                    // A paused film loads on the viewer's play: the count of seeks may go on.
                    if (wasPaused) setTimeout(done, 1000);
                }
            };
            settle();
        };

        // Which engine plays, for diagnostics and the live check.
        const mark = engine => { document.documentElement.dataset.movieExtensionEngine = engine; };

        const toHls = () => {
            const video = film();
            const source = player?.config?.source;
            if (!video || switching || onHls || !hasDash(source) || !hasHls(source)) return;
            dashSource = { ...source };
            onHls = true;
            seeks = [];
            mark('hls');
            renewAt({ ...player.config, source: { ...source }, _fallFrom: source.dash ? 'dash' : 'dasha' }, video.currentTime, video.paused);
            waitForCalm();
        };

        // While playing the switch back costs a short stop (about 2 s measured); at the
        // viewer's own pause it costs nothing they see, so a pause is taken when one comes.
        const toDash = ({ atPause = false } = {}) => {
            const video = film();
            if (!video || switching || !onHls || !dashSource || video.seeking) return;
            if (atPause ? !video.paused : video.paused) return;
            onHls = false;
            clearTimeout(calmTimer);
            mark('dash');
            // The HLS player's config may still carry the `_fallFrom` that dropped DASH.
            const { _fallFrom: dropped, ...config } = player.config;
            renewAt({ ...config, source: { ...dashSource } }, video.currentTime, atPause);
        };

        const waitForCalm = () => {
            clearTimeout(calmTimer);
            if (onHls) calmTimer = setTimeout(toDash, CALM_BEFORE_DASH_MS);
        };

        let lastSeekAt = 0;
        container.addEventListener('seeking', event => {
            if (switching || !player || event.target?.tagName !== 'VIDEO' || event.target.dataset.ghost === 'true') return;
            if (performance.now() < quietUntil) return;
            lastSeekAt = performance.now();
            if (onHls) { waitForCalm(); return; }
            const now = performance.now();
            seeks = seeks.filter(at => now - at < SEEK_BURST_MS);
            seeks.push(now);
            clearTimeout(settleTimer);
            if (seeks.length >= SEEK_BURST) settleTimer = setTimeout(toHls, SEEK_SETTLE_MS);
        }, true);
        // Calm means watching: a paused film waits, and the count starts again on play.
        container.addEventListener('pause', event => {
            if (switching || event.target?.tagName !== 'VIDEO' || event.target.dataset.ghost === 'true') return;
            clearTimeout(calmTimer);
            // A pause right after jumping around is part of the search, not the end of it.
            if (onHls && performance.now() - lastSeekAt >= PAUSE_AFTER_SEEK_MS) setTimeout(() => toDash({ atPause: true }), 300);
        }, true);
        container.addEventListener('playing', event => {
            if (event.target?.tagName !== 'VIDEO' || event.target.dataset.ghost === 'true') return;
            if (quietUntil === Infinity) quietUntil = performance.now() + QUIET_AFTER_START_MS;
            if (onHls && !switching) waitForCalm();
        }, true);
        facade.on?.('playlistItem', onEpisode);
    }

    // Venom names its audio tracks from the balancer's list (`source.audio.names`) by
    // position alone. For some films that list belongs to another release: «Мстители»
    // (KP 263531) carries «Рус. Дублированный, Укр., Ю. Сербин, Eng.Original» over files
    // that are English, English, Russian dub, Russian, so «Дублированный» played English
    // (heard on 2026-11-28). The HLS manifest tags every track with its language
    // (`NAME="rus2",LANGUAGE="ru"`), and on other films those tags match the names. When
    // they clearly disagree, the names are moved onto the tracks of their language.
    const NAME_LANGUAGES = [
        ['ru', /^(?:рус|rus)|\(рус/i],
        ['uk', /^(?:укр|ukr)|\(укр|дубльован/i],
        ['en', /^(?:eng|англ)|english/i]
    ];
    const TAG_LANGUAGES = { rus: 'ru', ukr: 'uk', eng: 'en' };

    function nameLanguage(name) {
        const text = String(name || '').trim();
        return NAME_LANGUAGES.find(([, pattern]) => pattern.test(text))?.[0] || null;
    }

    /** Languages of the first audio group, in track order, from an HLS master playlist. */
    function trackLanguages(master) {
        const tracks = String(master).split(/\r?\n/).filter(line => line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(line));
        const group = tracks[0]?.match(/GROUP-ID="([^"]*)"/)?.[1];
        return tracks.filter(line => line.match(/GROUP-ID="([^"]*)"/)?.[1] === group).map(line => {
            const language = line.match(/LANGUAGE="([a-z]{2,3})/i)?.[1]?.toLowerCase();
            if (language) return TAG_LANGUAGES[language] || language;
            const name = line.match(/NAME="([a-z]{3})/i)?.[1]?.toLowerCase();
            return TAG_LANGUAGES[name] || null;
        });
    }

    /** Names placed on the tracks of their language, or null when the names fit already. */
    function namesForTracks(names, languages) {
        if (names.length !== languages.length || new Set(languages.filter(Boolean)).size < 2) return null;
        const spoken = names.map(nameLanguage);
        const conflicts = spoken.filter((language, index) => language && languages[index] && language !== languages[index]).length;
        // One stray tag proves nothing; a list from another release disagrees in several places.
        if (conflicts < 2) return null;
        const placed = new Array(names.length).fill(null);
        const place = (name, language) => {
            const index = languages.findIndex((tag, at) => tag === language && placed[at] === null);
            if (index >= 0) placed[index] = name;
        };
        names.forEach((name, index) => { if (spoken[index]) place(name, spoken[index]); });
        // A name without a language marker is a voiceover author: Russian in these catalogues.
        names.forEach((name, index) => { if (!spoken[index] && name !== 'delete') place(name, 'ru'); });
        return placed.map((name, index) => name ?? `Дорожка ${index + 1} (${languages[index] || '?'})`);
    }

    function alignAudioNamesWithTracks(facade, options) {
        const source = options?.source;
        const names = source?.audio?.names;
        if (!Array.isArray(names) || names.length < 2 || typeof source.hls !== 'string'
            || typeof window.fetch !== 'function' || typeof facade?.once !== 'function') return;
        let internal = null;
        let believed = null;
        // Venom reads the names when its engine reports the tracks. A list it built
        // before the manifest came is built again, and the track Venom believed it was
        // playing is asked for under its new place.
        const rebuild = () => {
            const engine = internal?.source;
            if (!believed || !engine || typeof engine.transformAudioList !== 'function' || !Array.isArray(engine.audioList)) return;
            const order = engine.audioOrder?.length === names.length ? engine.audioOrder : names.map((_, index) => index);
            const expected = [];
            names.forEach((name, index) => { expected[order[index]] = name; });
            const visible = expected.filter(name => !engine.isAudioBlocked?.(name));
            if (visible.length === engine.audioList.length && visible.every((name, index) => name === engine.audioList[index])) return;
            let playing = null;
            try { playing = believed[engine.originalAudio]; } catch { /* No engine yet. */ }
            engine.transformAudioList(names.map((_, index) => String(index + 1)));
            engine.emit?.(engine.events?.AUDIO_LIST || 'audioList', engine.audioList);
            const wanted = engine.audioList.indexOf(playing);
            if (wanted >= 0) engine.audio = wanted;
        };
        facade.once('timeupdate', function captureInternal() {
            if (this?.source) internal = this;
            rebuild();
        });
        window.fetch(source.hls).then(response => (response.ok ? response.text() : '')).then(master => {
            const fixed = namesForTracks(names, trackLanguages(master));
            if (!fixed) return;
            believed = [...names];
            // Venom keeps this very array: changed in place, its engines and renewals see it.
            names.splice(0, names.length, ...fixed);
            console.info('[ProviderAdGuard] Audio names moved onto their tracks', { from: believed, to: fixed });
            rebuild();
        }).catch(() => { /* Venom keeps the balancer's names. */ });
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
                        try { switchEngineBySeeking(player, prepared); }
                        catch { /* Venom keeps the engine it chose. */ }
                        try { keepPlaybackSmooth(player, prepared); }
                        catch { /* The chosen quality stays. */ }
                        try { alignAudioNamesWithTracks(player, prepared); }
                        catch { /* Venom keeps the balancer's names. */ }
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
