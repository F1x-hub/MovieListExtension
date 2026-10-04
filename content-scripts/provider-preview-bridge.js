// MAIN-world bridge: publish only the source belonging to a provider's media
// element. Never infer the movie from unrelated network/ad requests.
(() => {
    'use strict';
    const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}(?:\/|$)/i;
    const ancestors = Array.from(window.location.ancestorOrigins || []);
    if (window.self === window.top || !ancestors.some(origin => extensionOrigin.test(origin))
        && !extensionOrigin.test(document.referrer || '')
        && new URL(window.location.href).searchParams.get('santabarbaranoads') !== '1') return;

    const owners = new WeakMap();
    const containers = new Map();
    const normalize = value => {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const url = new URL(value, window.location.href);
            return /^https?:$/.test(url.protocol) ? url.href : null;
        } catch { return null; }
    };
    const clear = video => {
        delete video.dataset.playerPreviewUrl;
        delete video.dataset.playerPreviewType;
        delete video.dataset.playerPreviewMedia;
    };
    const publish = (video, owner) => {
        if (!video?.dataset || video.dataset.ghost === 'true') return;
        owners.set(video, owner);
        const source = owner.source;
        const hls = normalize(source?.hls);
        const url = hls || normalize(source?.file &&
            Object.entries(source.file).sort((a, b) => Number(a[0]) - Number(b[0]))[0]?.[1]);
        if (!url) { clear(video); return; }
        video.dataset.playerPreviewUrl = url;
        video.dataset.playerPreviewType = hls ? 'hls' : 'video';
        video.dataset.playerPreviewMedia = video.currentSrc || video.src || '';
    };
    document.addEventListener('loadstart', event => {
        if (event.target?.tagName === 'VIDEO') clear(event.target);
    }, true);
    document.addEventListener('loadedmetadata', event => {
        const video = event.target;
        if (video?.tagName !== 'VIDEO' || video.dataset.ghost === 'true') return;
        const owner = owners.get(video) || [...containers].find(([container]) => container.contains(video))?.[1];
        if (owner) publish(video, owner);
    }, true);

    const bindHls = library => {
        const prototype = library?.prototype;
        if (!prototype?.loadSource || !prototype.attachMedia || prototype._moviePreviewBridge) return library;
        try {
            const loadSource = prototype.loadSource;
            const attachMedia = prototype.attachMedia;
            const destroy = prototype.destroy;
            const states = new WeakMap();
            const stateFor = instance => {
                if (!states.has(instance)) states.set(instance, { source: null, video: null });
                return states.get(instance);
            };
            prototype.loadSource = function(url) {
                const state = stateFor(this);
                state.source = { hls: normalize(url) };
                const result = loadSource.call(this, url);
                if (state.video) publish(state.video, state);
                return result;
            };
            prototype.attachMedia = function(video) {
                const state = stateFor(this);
                if (state.video && state.video !== video) { clear(state.video); owners.delete(state.video); }
                state.video = video;
                const result = attachMedia.call(this, video);
                publish(video, state);
                return result;
            };
            if (destroy) prototype.destroy = function(...args) {
                const state = states.get(this);
                if (state?.video && owners.get(state.video) === state) {
                    clear(state.video);
                    owners.delete(state.video);
                }
                states.delete(this);
                return destroy.apply(this, args);
            };
            Object.defineProperty(prototype, '_moviePreviewBridge', { value: true });
        } catch { /* A read-only provider library retains its original behavior. */ }
        return library;
    };
    const descriptor = Object.getOwnPropertyDescriptor(window, 'Hls');
    if (!descriptor || descriptor.configurable && 'value' in descriptor) {
        let library = bindHls(window.Hls);
        Object.defineProperty(window, 'Hls', {
            configurable: true, enumerable: true,
            get() { return library; }, set(value) { library = bindHls(value); }
        });
    } else bindHls(window.Hls);

    window.MovieExtensionPreviewBridge = {
        trackVenom(player, options) {
            const container = options?.container || document.body;
            if (!container?.querySelectorAll) return;
            const playlist = options?.playlist;
            const owner = { source: options?.source };
            const select = selection => {
                const item = playlist?.flat?.find(item => String(item.id) === String(selection?.id))
                    || playlist?.seasons?.find(item => String(item.season) === String(selection?.season))
                        ?.episodes?.find(item => String(item.episode) === String(selection?.episode));
                // Do not retain the previous episode when the next source is opaque.
                owner.source = item?.source || (item?.hls || item?.file ? item : null);
                container.querySelectorAll('video:not(.ghost-video)').forEach(clear);
            };
            if (playlist) select(playlist.current);
            containers.set(container, owner);
            const bind = instance => {
                instance?.on?.('playlistItem', select);
                instance?.on?.('ready', () => {
                    container.querySelectorAll('video:not(.ghost-video)').forEach(video => publish(video, owner));
                });
                // Preserve the provider's callback while subscribing to renewed players.
                const property = Object.getOwnPropertyDescriptor(instance || {}, 'onRenew');
                if (instance && (!property || property.configurable && 'value' in property)) {
                    let callback = instance.onRenew;
                    Object.defineProperty(instance, 'onRenew', {
                        configurable: true,
                        get() { return function(next) { bind(next); return callback?.call(this, next); }; },
                        set(value) { callback = value; }
                    });
                }
            };
            bind(player);
            container.querySelectorAll('video:not(.ghost-video)').forEach(video => publish(video, owner));
        }
    };
})();
