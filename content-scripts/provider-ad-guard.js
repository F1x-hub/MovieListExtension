// Runs in MAIN before a supported provider constructs its VenomPlayer.
// player-venom exposes a native no-ad query flag; use it only for provider
// frames owned by this extension and leave ordinary website embeds unchanged.
(() => {
    'use strict';

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
        installVenomFactoryGuard();
        console.info('[ProviderAdGuard] Venom no-ad mode enabled', {
            host: providerUrl.hostname,
            embeddedBy: origins.find(origin => extensionOrigin.test(origin)) || 'santabarbaranoads'
        });
    } catch (error) {
        console.warn('[ProviderAdGuard] Failed to enable Venom no-ad mode:', error);
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
                            ? { ...options, ads: null } : options;
                        const player = value.make.call(value, prepared, ...args);
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
