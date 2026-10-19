// player-cleaner.js - Replaces third-party player UI with native video player
(function() {
    'use strict';
    const pt = (key, fallback, params = {}) => window.PlayerLocale?.t(key, params, fallback) || fallback;
    const playerLocaleReady = window.PlayerLocale
        ? window.PlayerLocale.init()
        : (typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? import(chrome.runtime.getURL('src/shared/services/player/PlayerLocale.js')).then(() => window.PlayerLocale?.init()).catch(() => false)
            : Promise.resolve(false));

    // One icon set for the whole control dock: 24px grid, 2px rounded stroke,
    // currentColor. Play/Pause are solid so the primary action reads first.
    const playerIcon = (body, { size = 24, solid = false } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${solid ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    const PLAYER_ICONS = {
        play: (size) => playerIcon('<path d="M8 5v14l11-7z"/>', { size, solid: true }),
        pause: (size) => playerIcon('<rect x="6" y="5" width="3.5" height="14" rx="1"/><rect x="14.5" y="5" width="3.5" height="14" rx="1"/>', { size, solid: true }),
        prev: playerIcon('<path d="M15 18l-6-6 6-6"/>'),
        next: playerIcon('<path d="M9 18l6-6-6-6"/>'),
        volumeHigh: playerIcon('<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
        // Same footprint as volumeHigh (faint outer wave) so the speaker stays centered and does not jump.
        volumeLow: playerIcon('<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13" opacity=".3"/>'),
        volumeMute: playerIcon('<g transform="translate(-0.5 0)"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/></g>'),
        subtitles: playerIcon('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 11h3"/><path d="M13 11h4"/><path d="M7 15h6"/><path d="M16 15h1"/>'),
        pip: playerIcon('<rect x="3" y="5" width="18" height="14" rx="3"/><rect x="12" y="11" width="6" height="5" rx="1"/>'),
        pipActive: playerIcon('<rect x="3" y="5" width="18" height="14" rx="3"/><rect x="12" y="11" width="6" height="5" rx="1" fill="currentColor"/>'),
        settings: playerIcon('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
        fullscreen: playerIcon('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
        fullscreenExit: playerIcon('<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>')
    };


    // Only run if we are in an iframe (optional, but good practice since we expect to be embedded)
    if (window.self === window.top) {
        // Top level window
    } else {
        // Inside iframe
    }

    let observer = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // Increased attempts
    let currentVoiceoverOptions = []; // Shared state for voiceovers
    let permanentVideo = null; // Our single persistent video element
    let activePlaybackRetry = null;
    let activeRequestGuard = () => true;
    let activeWrapperListenerScope = null;
    let activeWrapper = null;
    let activeSubtitleAppearanceStyle = null;
    let activeSubtitleAppearanceWrapper = null;
    let activeSubtitleControlsDock = null;
    let activeSubtitleResizeObserver = null;
    let observerRoot = null;
    let pendingActiveEpisodeLabel = null; // Track clicked episode label
    let structuredPlaybackState = null; // Structured provider playback state (Phase 5B)
    let canonicalPickerRequested = false;
    let providerContentErrorReported = false;
    let selectionOperationGeneration = 0;
    let nativeSelectionReportTimer = null;
    let nativeSelectionListenerInstalled = false;
    let nativeSelectionOperation = null;
    let canonicalSelectionContext = null;
    let canonicalSelectionReady = false;
    let canonicalSelectionStabilizingUntil = 0;
    let lastNativeSelectionKey = null;
    let roomSyncSubscriptionId = null;
    let roomSyncTelemetryVideo = null;
    let roomSyncTelemetryDisposers = [];
    let lastRoomSyncTimeupdateAt = 0;
    // The room bridge is deliberately timeline-only. Do not add player
    // preferences (audio, subtitles, quality, volume, speed) to this protocol.
    const ROOM_SYNC_TIMELINE_ACTIONS = new Set(['play', 'pause', 'seek']);

    // Host commands come only from the extension page that embeds this
    // player. Provider pages and their ad frames share this window and must
    // not be able to drive the cleaner through postMessage.
    function isExtensionPageContext() {
        return window.location.protocol === 'chrome-extension:';
    }

    function getHostWindow() {
        return isExtensionPageContext() || window.parent === window ? window : window.parent;
    }

    function getHostOrigin() {
        if (isExtensionPageContext()) return window.location.origin;
        try {
            const id = typeof chrome !== 'undefined' ? chrome.runtime?.id : null;
            return id ? `chrome-extension://${id}` : null;
        } catch {
            return null;
        }
    }

    function isTrustedHostMessage(event) {
        if (!event?.data || event.source !== getHostWindow()) return false;
        const hostOrigin = getHostOrigin();
        return !hostOrigin || event.origin === hostOrigin;
    }

    function postToHost(payload) {
        const host = getHostWindow();
        if (host === window && !isExtensionPageContext()) return;
        try {
            host.postMessage(payload, getHostOrigin() || '*');
        } catch (error) {
            console.warn('[PlayerCleaner] Could not notify host:', error.message);
        }
    }

    const readNativeSelectionNumber = value => {
        const match = String(value || '').match(/\d+/);
        return match ? Number(match[0]) : null;
    };

    const readNativeProviderSelection = () => {
        if (structuredPlaybackState) {
            const seasonNumber = Number(structuredPlaybackState.activeSeasonNumber);
            const episodeNumber = Number(structuredPlaybackState.activeEpisodeNumber);
            return Number.isInteger(seasonNumber) && seasonNumber > 0
                && Number.isInteger(episodeNumber) && episodeNumber > 0
                ? { seasonNumber, episodeNumber }
                : null;
        }

        const listContainer = document.querySelector('div[class*="list_"]');
        const dropdowns = Array.from(
            listContainer?.querySelectorAll?.('div[class*="dropdown_"]') || []
        );
        if (dropdowns.length < 2) return null;

        const readDropdown = (dropdown, marker) => {
            const items = Array.from(dropdown.querySelectorAll('div[class*="item_"]'));
            const active = items.find(item => {
                const className = String(item.className || '');
                return className.includes('active')
                    || item.classList?.contains?.('active')
                    || item.getAttribute?.('aria-selected') === 'true';
            });
            const label = String(active?.textContent || '').trim();
            return label.toLowerCase().includes(marker)
                ? readNativeSelectionNumber(label)
                : null;
        };

        const seasonNumber = readDropdown(dropdowns[0], 'сезон');
        const episodeNumber = readDropdown(dropdowns[1], 'серия');
        return Number.isInteger(seasonNumber) && seasonNumber > 0
            && Number.isInteger(episodeNumber) && episodeNumber > 0
            ? { seasonNumber, episodeNumber }
            : null;
    };

    const selectionKey = selection => selection
        ? `${selection.seasonNumber}:${selection.episodeNumber}`
        : null;

    const reportNativeProviderSelection = (reason = 'native-dom') => {
        if (nativeSelectionOperation) return;
        const selection = readNativeProviderSelection();
        if (!selection) return;

        const key = selectionKey(selection);
        const expectedKey = selectionKey(canonicalSelectionContext);
        if (canonicalPickerRequested && canonicalSelectionContext && !canonicalSelectionReady) {
            if (key === expectedKey) {
                canonicalSelectionReady = true;
                canonicalSelectionStabilizingUntil = 0;
                return;
            }
            // A SET_CANONICAL_PICKER_MODE message can carry stale host state
            // after the provider has already moved on (for example host S4E18,
            // provider DOM S6E2). Reconcile that initial mismatch from the
            // provider DOM unless an explicit APPLY_PLAYBACK_SELECTION command
            // is currently in flight. The active operation remains protected
            // from transient DOM states while it is applying the requested S/E.
            if (nativeSelectionOperation) return;
        }
        if (canonicalPickerRequested
            && canonicalSelectionContext
            && canonicalSelectionStabilizingUntil > Date.now()) {
            if (key === expectedKey) canonicalSelectionStabilizingUntil = 0;
            return;
        }
        if (key === lastNativeSelectionKey) return;
        lastNativeSelectionKey = key;
        if (canonicalPickerRequested) {
            canonicalSelectionContext = {
                ...canonicalSelectionContext,
                ...selection
            };
            canonicalSelectionReady = true;
        }

        console.info('[ExFsBridgeTrace] native provider selection observed', {
            seasonNumber: selection.seasonNumber,
            episodeNumber: selection.episodeNumber,
            reason
        });
        postToHost({
            type: 'EPISODE_CHANGED',
            seasonNumber: selection.seasonNumber,
            episode: selection.episodeNumber,
            episodeNumber: selection.episodeNumber,
            season: `${selection.seasonNumber} сезон`,
            origin: 'USER_PROVIDER_SELECTION',
            providerId: canonicalSelectionContext?.providerId || null,
            selectionVersion: canonicalSelectionContext?.selectionVersion ?? null,
            providerState: 'NATIVE_DOM'
        });
    };

    const scheduleNativeProviderSelectionReport = (reason = 'native-dom') => {
        if (nativeSelectionReportTimer !== null) clearTimeout(nativeSelectionReportTimer);
        nativeSelectionReportTimer = setTimeout(() => {
            nativeSelectionReportTimer = null;
            reportNativeProviderSelection(reason);
        }, 0);
    };

    const installNativeSelectionObserver = () => {
        if (nativeSelectionListenerInstalled) return;
        nativeSelectionListenerInstalled = true;
        document.addEventListener('click', event => {
            const item = event.target?.closest?.('div[class*="item_"]');
            const label = String(item?.textContent || '').trim().toLowerCase();
            if (label.includes('сезон') || label.includes('серия')) {
                scheduleNativeProviderSelectionReport('native-click');
            }
        }, true);
    };
    
    let episodeDropdown = null;

    console.info('[KinoGoBridgeTrace] cleaner initialized', {
        location: window.location.href.split('?')[0],
        hostname: window.location.hostname,
        isTopLevel: window.self === window.top,
        readyState: document.readyState
    });

    const reportProviderContentError = () => {
        if (providerContentErrorReported || !document.body) return false;
        const bodyText = String(document.body.innerText || document.body.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
        const normalized = bodyText.toLowerCase();
        const notFound = normalized.includes('запрашиваемый контент не найден')
            || normalized.includes('requested content was not found')
            || normalized.includes('content not found');
        if (!notFound) return false;

        providerContentErrorReported = true;
        console.warn('[KinoGoBridgeTrace] provider content error detected', {
            location: window.location.href,
            hostname: window.location.hostname,
            message: bodyText.slice(0, 240)
        });
        postToHost({
            type: 'PLAYER_SOURCE_STATE',
            state: 'error',
            reason: 'provider-content-not-found',
            providerId: 'kinogo',
            url: window.location.href
        });
        return true;
    };

    const scheduleProviderContentErrorCheck = () => {
        [0, 250, 750, 1500].forEach(delay => {
            setTimeout(reportProviderContentError, delay);
        });
    };

    // An extension-page parser video (AnimeGo) whose episodes the host owns:
    // the player's arrows request navigation from the host page itself.
    const isHostEpisodeNavigation = () => permanentVideo?.dataset?.canonicalEpisodeNav === 'true'
        && isExtensionPageContext();

    // Arrows request host navigation in canonical provider frames and for
    // host-owned extension-page videos; otherwise they use the provider list.
    const usesHostEpisodeNavigation = () => (canonicalPickerRequested && window.parent && window.parent !== window)
        || isHostEpisodeNavigation();

    const applyCanonicalPickerVisibility = () => {
        const legacyButtons = document.querySelectorAll('.episode-list-btn');
        const nativeNavigationButtons = document.querySelectorAll('.provider-native-episode-nav');
        legacyButtons.forEach(button => {
            if (!button.dataset.canonicalPickerDisplay) {
                button.dataset.canonicalPickerDisplay = button.style.display || '';
            }
            button.style.display = canonicalPickerRequested
                ? 'none'
                : button.dataset.canonicalPickerDisplay;
        });
        nativeNavigationButtons.forEach(button => {
            if (!button.dataset.canonicalPickerDisplay) {
                button.dataset.canonicalPickerDisplay = button.style.display || '';
            }
            // The host picker owns episode selection, but these arrows are still
            // useful controls: they now request navigation from that same owner.
            const canonicalPickerOnly = button.dataset.canonicalPickerOnly === 'true';
            button.style.display = canonicalPickerRequested || isHostEpisodeNavigation()
                ? 'flex'
                : (canonicalPickerOnly ? 'none' : (button.dataset.canonicalPickerDisplay || 'flex'));
        });
        return {
            legacyButtonCount: legacyButtons.length,
            nativeNavigationButtonCount: nativeNavigationButtons.length
        };
    };

    const scheduleCanonicalPickerVisibility = () => {
        const visibility = applyCanonicalPickerVisibility();
        if (!canonicalPickerRequested) return visibility;
        [100, 300, 750, 1500].forEach(delay => {
            setTimeout(applyCanonicalPickerVisibility, delay);
        });
        return visibility;
    };

    function isExtensionNativeVideo(video) {
        if (!video) return false;
        if (video.classList?.contains('player-surface__media')) return true;
        if (video.dataset?.playerSourceActive === 'true') return true;
        if (video.closest?.('.video-container') || video.closest?.('.player-surface')) return true;
        if (typeof video.src === 'string' && video.src.startsWith('blob:chrome-extension:')) return true;
        return false;
    }

    function getRoomSyncVideo() {
        return permanentVideo || document.querySelector('video:not(.ghost-video)');
    }

    // «Эфир» broadcast lock. The embedding extension page sends the channel clock
    // ({ startMs, pausedAtSec }); viewers cannot pause or seek, the media simply
    // follows the shared timeline like a TV channel. Only the admin moves that
    // timeline, from the live page, and every viewer follows the new state.
    let broadcastState = null;
    const broadcastVideos = new WeakSet();
    const BROADCAST_DRIFT_SEC = 3;

    function broadcastTargetSec() {
        if (!broadcastState) return null;
        if (Number.isFinite(broadcastState.pausedAtSec)) return broadcastState.pausedAtSec;
        return (Date.now() - broadcastState.startMs) / 1000;
    }

    function enforceBroadcast(video = getRoomSyncVideo()) {
        if (!broadcastState || !video || !video.isConnected) return;
        const duration = Number(video.duration);
        if (!Number.isFinite(duration) || duration <= 0) return;
        const target = broadcastTargetSec();
        if (target >= duration - 1) return;
        const paused = Number.isFinite(broadcastState.pausedAtSec);
        const tolerance = paused ? 1 : BROADCAST_DRIFT_SEC;
        if (Math.abs(video.currentTime - target) > tolerance) {
            try { video.currentTime = Math.max(0, target); } catch { /* not seekable yet */ }
        }
        if (paused) {
            if (!video.paused) video.pause();
        } else if (video.paused && !video.ended) {
            video.play().catch(() => {
                video.muted = true;
                video.play().catch(() => {});
            });
        }
    }

    function watchBroadcastVideo(video) {
        if (!video || broadcastVideos.has(video)) return;
        broadcastVideos.add(video);
        const later = () => setTimeout(() => enforceBroadcast(video), 120);
        ['loadedmetadata', 'canplay', 'play', 'pause', 'seeked'].forEach(type => video.addEventListener(type, later));
    }

    function blockBroadcastKeys(event) {
        if (!broadcastState) return;
        const keys = [' ', 'k', 'K', 'j', 'J', 'l', 'L', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious'];
        if (keys.includes(event.key) || /^[0-9]$/.test(event.key)) {
            event.stopImmediatePropagation();
            event.preventDefault();
        }
    }

    function applyBroadcastState(data) {
        const startMs = Number(data.startMs);
        if (!Number.isFinite(startMs) || startMs <= 0) return;
        const pausedAtSec = data.pausedAtSec === null || data.pausedAtSec === undefined ? NaN : Number(data.pausedAtSec);
        const first = !broadcastState;
        broadcastState = { startMs, pausedAtSec: Number.isFinite(pausedAtSec) && pausedAtSec >= 0 ? pausedAtSec : NaN };
        if (first) {
            document.documentElement.classList.add('mre-broadcast');
            const style = document.createElement('style');
            style.textContent = [
                '.mre-broadcast .player-controls-group--left .player-control-button { display: none !important; }',
                '.mre-broadcast .player-progress-track { pointer-events: none !important; }'
            ].join(' ');
            (document.head || document.documentElement).appendChild(style);
            window.addEventListener('keydown', blockBroadcastKeys, true);
            setInterval(() => {
                document.querySelectorAll('video:not(.ghost-video)').forEach(watchBroadcastVideo);
                enforceBroadcast();
            }, 1000);
        }
        document.querySelectorAll('video:not(.ghost-video)').forEach(watchBroadcastVideo);
        enforceBroadcast();
    }

    function clearRoomSyncTelemetry() {
        roomSyncTelemetryDisposers.forEach(dispose => dispose());
        roomSyncTelemetryDisposers = [];
        roomSyncTelemetryVideo = null;
    }

    // KinoGo can replace its media element while the iframe itself stays alive.
    // Keep the room subscription attached to the current media element instead
    // of silently observing the detached one.
    function setPermanentVideo(video) {
        permanentVideo = video || null;
        if (!roomSyncSubscriptionId) return;
        if (!permanentVideo) {
            clearRoomSyncTelemetry();
            return;
        }
        attachRoomSyncTelemetry();
    }

    function postRoomSyncMessage(target, origin, payload) {
        if (!target || target !== window.parent) return;
        try {
            target.postMessage(payload, origin && origin !== 'null' ? origin : '*');
        } catch (error) {
            console.warn('[RoomSyncProbe] Could not notify parent:', error.message);
        }
    }

    function roomSyncSnapshot(video = getRoomSyncVideo()) {
        const duration = Number(video?.duration);
        const currentTime = Number(video?.currentTime);
        return {
            available: Boolean(video),
            currentTimeMs: Number.isFinite(currentTime) ? Math.max(0, Math.round(currentTime * 1000)) : null,
            durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null,
            paused: video ? Boolean(video.paused) : null,
            readyState: video ? Number(video.readyState || 0) : 0,
        };
    }

    function emitRoomSyncTelemetry(kind) {
        if (!roomSyncSubscriptionId) return;
        const now = Date.now();
        if (kind === 'timeupdate' && now - lastRoomSyncTimeupdateAt < 750) return;
        if (kind === 'timeupdate') lastRoomSyncTimeupdateAt = now;
        if (kind !== 'timeupdate') {
            console.info('[RoomSyncTrace] telemetry-emitted', { kind, subscriptionActive: true });
        }
        postToHost({
            type: 'ROOM_SYNC_TELEMETRY',
            subscriptionId: roomSyncSubscriptionId,
            kind,
            observedAtMs: now,
            ...roomSyncSnapshot(),
        });
    }

    function attachRoomSyncTelemetry() {
        const video = getRoomSyncVideo();
        if (!video || roomSyncTelemetryVideo === video) return;
        clearRoomSyncTelemetry();
        roomSyncTelemetryVideo = video;
        // waiting/playing/canplay let the room pause everyone while one
        // member is still loading.
        ['loadedmetadata', 'play', 'pause', 'seeking', 'seeked', 'ended', 'timeupdate', 'waiting', 'playing', 'canplay'].forEach(kind => {
            const listener = () => emitRoomSyncTelemetry(kind);
            video.addEventListener(kind, listener);
            roomSyncTelemetryDisposers.push(() => video.removeEventListener(kind, listener));
        });
    }

    async function executeRoomSyncCommand(command) {
        const action = String(command?.action || '');
        if (!ROOM_SYNC_TIMELINE_ACTIONS.has(action)) {
            return { ok: false, code: 'INVALID_COMMAND' };
        }
        const video = getRoomSyncVideo();
        if (!video) return { ok: false, code: 'VIDEO_UNAVAILABLE' };
        if (action === 'play') {
            await video.play();
        } else if (action === 'pause') {
            video.pause();
        } else if (action === 'seek') {
            const targetMs = Number(command.positionMs);
            const durationMs = Number(video.duration) * 1000;
            if (!Number.isFinite(targetMs) || targetMs < 0
                || (Number.isFinite(durationMs) && durationMs > 0 && targetMs > durationMs)) {
                return { ok: false, code: 'INVALID_POSITION' };
            }
            video.currentTime = targetMs / 1000;
        }
        attachRoomSyncTelemetry();
        return { ok: true, code: 'APPLIED' };
    }

    window.addEventListener('message', (event) => {
        if (!isTrustedHostMessage(event)) return;
        if (event.data?.type === 'RESET_PERMANENT_VIDEO') {
            selectionOperationGeneration += 1;
            if (nativeSelectionReportTimer !== null) {
                clearTimeout(nativeSelectionReportTimer);
                nativeSelectionReportTimer = null;
            }
            setPermanentVideo(null);
            activeWrapper = null;
            pendingActiveEpisodeLabel = null;
            structuredPlaybackState = null;
            canonicalPickerRequested = false;
            nativeSelectionOperation = null;
            canonicalSelectionContext = null;
            canonicalSelectionReady = false;
            canonicalSelectionStabilizingUntil = 0;
            lastNativeSelectionKey = null;
        } else if (event.data?.type === 'SEASONVAR_PLAYBACK_STATE') {
            structuredPlaybackState = event.data;
        } else if (event.data?.type === 'SET_CANONICAL_PICKER_MODE') {
            const activeStabilizationUntil = canonicalSelectionStabilizingUntil > Date.now()
                ? canonicalSelectionStabilizingUntil
                : 0;
            canonicalPickerRequested = Boolean(event.data.enabled);
            canonicalSelectionContext = canonicalPickerRequested
                && Number.isInteger(Number(event.data.seasonNumber))
                && Number(event.data.seasonNumber) > 0
                && Number.isInteger(Number(event.data.episodeNumber))
                && Number(event.data.episodeNumber) > 0
                ? {
                    seasonNumber: Number(event.data.seasonNumber),
                    episodeNumber: Number(event.data.episodeNumber),
                    providerId: event.data.providerId || null,
                    selectionVersion: Number.isInteger(event.data.selectionVersion)
                        ? event.data.selectionVersion
                        : null
                }
                : null;
            canonicalSelectionReady = !canonicalPickerRequested || !canonicalSelectionContext;
            // Initial canonical-mode messages describe host intent; they do
            // not prove that the provider DOM has applied it yet. Only an
            // acknowledged APPLY_PLAYBACK_SELECTION starts the short
            // stabilization window below.
            canonicalSelectionStabilizingUntil = activeStabilizationUntil;
            if (canonicalSelectionContext) {
                lastNativeSelectionKey = selectionKey(canonicalSelectionContext);
            }
            const visibility = scheduleCanonicalPickerVisibility();
            console.info('[ExFsBridgeTrace] cleaner picker mode received', {
                enabled: canonicalPickerRequested,
                location: window.location.href.split('?')[0],
                hostname: window.location.hostname,
                ...visibility
            });
            if (canonicalPickerRequested) {
                scheduleNativeProviderSelectionReport('canonical-mode');
            }
        } else if (event.data?.type === 'APPLY_PLAYBACK_SELECTION') {
            const request = event.data;
            const expectedParent = window.parent && window.parent !== window
                ? window.parent
                : window;
            const requestedSeason = Number(request.seasonNumber);
            const requestedEpisode = Number(request.episodeNumber);
            if (event.source !== expectedParent
                || !Number.isInteger(requestedSeason)
                || requestedSeason < 1
                || !Number.isInteger(requestedEpisode)
                || requestedEpisode < 1
                || (request.providerId != null && typeof request.providerId !== 'string')) {
                console.warn('[ExFsBridgeTrace] cleaner rejected invalid selection request', {
                    requestId: request.requestId || null,
                    hasExpectedParent: event.source === expectedParent,
                    seasonNumber: request.seasonNumber,
                    episodeNumber: request.episodeNumber,
                    providerId: request.providerId || null
                });
                return;
            }
            const operationGeneration = ++selectionOperationGeneration;
            const isCurrentOperation = () => operationGeneration === selectionOperationGeneration;
            nativeSelectionOperation = {
                seasonNumber: requestedSeason,
                episodeNumber: requestedEpisode,
                requestId: request.requestId || null
            };
            canonicalSelectionContext = {
                ...(canonicalSelectionContext || {}),
                seasonNumber: requestedSeason,
                episodeNumber: requestedEpisode,
                providerId: request.providerId || canonicalSelectionContext?.providerId || null
            };
            canonicalSelectionReady = false;
            canonicalSelectionStabilizingUntil = 0;
            console.info('[ExFsBridgeTrace] cleaner selection message received', {
                requestId: request.requestId,
                providerId: request.providerId || null,
                seasonNumber: request.seasonNumber,
                episodeNumber: request.episodeNumber,
                location: window.location.href.split('?')[0],
                hostname: window.location.hostname
            });
            const dispatchResult = async () => {
                if (!isCurrentOperation()) return false;
                const applySelection = window.movieExtension_applySelection;
                console.info('[ExFsBridgeTrace] cleaner selection handler lookup', {
                    requestId: request.requestId,
                    handler: typeof window.movieExtension_applySelection === 'function'
                        ? 'movieExtension_applySelection'
                        : 'none'
                });
                if (typeof applySelection !== 'function') return false;
                try {
                    return await Promise.resolve(applySelection(
                        request.seasonNumber,
                        request.episodeNumber,
                        request.providerId || null,
                        isCurrentOperation
                    )) === true;
                } catch (error) {
                    console.warn('[PlayerCleaner] Native selection dispatch failed:', error);
                    return false;
                }
            };
            const acknowledge = (status, reason) => {
                const ownsOperation = nativeSelectionOperation?.requestId === (request.requestId || null);
                if (ownsOperation && status === 'APPLIED') {
                    lastNativeSelectionKey = selectionKey(nativeSelectionOperation);
                    canonicalSelectionReady = true;
                    canonicalSelectionStabilizingUntil = Date.now() + 2500;
                }
                if (ownsOperation) {
                    nativeSelectionOperation = null;
                }
                const response = {
                    type: 'PLAYBACK_SELECTION_RESULT',
                    requestId: request.requestId,
                    providerId: request.providerId || null,
                    status,
                    reason,
                    seasonNumber: request.seasonNumber,
                    episodeNumber: request.episodeNumber
                };
                const responseOrigin = event.origin && event.origin !== 'null'
                    ? event.origin
                    : null;
                if (!responseOrigin || !event.source?.postMessage) {
                    console.warn('[ExFsBridgeTrace] cleaner skipped selection result without a trusted reply target', {
                        requestId: request.requestId,
                        responseOrigin
                    });
                    return;
                }
                try {
                    event.source.postMessage(response, responseOrigin);
                } catch {
                    console.warn('[ExFsBridgeTrace] cleaner failed to send selection result', {
                        requestId: request.requestId,
                        responseOrigin
                    });
                }
                console.info('[ExFsBridgeTrace] cleaner selection result sent', {
                    requestId: request.requestId,
                    status,
                    reason
                });
            };
            let attemptsLeft = 8;
            const tryDispatch = async () => {
                if (!isCurrentOperation()) {
                    acknowledge('CANCELLED', 'stale-selection');
                    return;
                }
                if (await dispatchResult()) {
                    if (!isCurrentOperation()) {
                        acknowledge('CANCELLED', 'stale-selection');
                        return;
                    }
                    console.log('[PlayerCleaner] Native selection dispatched', {
                        requestId: request.requestId,
                        seasonNumber: request.seasonNumber,
                        episodeNumber: request.episodeNumber
                    });
                    // The provider bridge waits for the selected season/episode
                    // to be reflected in its DOM before resolving. This is an
                    // applied selection, not merely a click dispatch.
                    acknowledge('APPLIED', 'provider-native-selector');
                    return;
                }
                if (!isCurrentOperation()) {
                    acknowledge('CANCELLED', 'stale-selection');
                    return;
                }
                if (attemptsLeft-- > 0) {
                    setTimeout(() => { void tryDispatch(); }, 200);
                    return;
                }
                acknowledge('UNAVAILABLE', 'provider-native-selector-not-ready');
            };
            void tryDispatch();
        } else if (event.source === window.parent && event.data?.type === 'BROADCAST_STATE' && isTrustedHostMessage(event)) {
            applyBroadcastState(event.data);
        } else if (event.source === window.parent && event.data?.type === 'ROOM_SYNC_PROBE') {
            const video = getRoomSyncVideo();
            postRoomSyncMessage(event.source, event.origin, {
                type: 'ROOM_SYNC_PROBE_RESULT',
                requestId: event.data.requestId,
                capabilities: {
                    observeTime: Boolean(video),
                    play: Boolean(video && typeof video.play === 'function'),
                    pause: Boolean(video && typeof video.pause === 'function'),
                    seek: Boolean(video && Number.isFinite(Number(video.duration)) && Number(video.duration) > 0),
                    duration: Boolean(video && Number.isFinite(Number(video.duration)) && Number(video.duration) > 0),
                    lockGuestTimeline: false,
                },
                ...roomSyncSnapshot(video),
            });
        } else if (event.source === window.parent && event.data?.type === 'ROOM_SYNC_SUBSCRIBE') {
            roomSyncSubscriptionId = String(event.data.subscriptionId || '');
            if (!/^[A-Za-z0-9_-]{16,128}$/.test(roomSyncSubscriptionId)) {
                roomSyncSubscriptionId = null;
                return;
            }
            console.info('[RoomSyncTrace] subscription-received', { subscriptionActive: true });
            attachRoomSyncTelemetry();
            emitRoomSyncTelemetry('snapshot');
        } else if (event.source === window.parent && event.data?.type === 'ROOM_SYNC_COMMAND') {
            const requestId = String(event.data.requestId || '');
            if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) return;
            void executeRoomSyncCommand(event.data).then(result => {
                postRoomSyncMessage(event.source, event.origin, {
                    type: 'ROOM_SYNC_COMMAND_RESULT',
                    requestId,
                    ...result,
                    ...roomSyncSnapshot(),
                });
            }).catch(error => {
                postRoomSyncMessage(event.source, event.origin, {
                    type: 'ROOM_SYNC_COMMAND_RESULT',
                    requestId,
                    ok: false,
                    code: error?.name === 'NotAllowedError' ? 'PLAYBACK_BLOCKED' : 'COMMAND_FAILED',
                    ...roomSyncSnapshot(),
                });
            });
        }
    });

    function createListenerScope() {
        const disposers = [];
        let disposed = false;

        return {
            listen(target, type, handler, options) {
                if (disposed || !target?.addEventListener) return () => {};
                target.addEventListener(type, handler, options);
                let active = true;
                const remove = () => {
                    if (!active) return;
                    active = false;
                    target.removeEventListener(type, handler, options);
                    const index = disposers.indexOf(remove);
                    if (index >= 0) disposers.splice(index, 1);
                };
                disposers.push(remove);
                return remove;
            },
            addDisposer(disposer) {
                if (typeof disposer !== 'function') return;
                if (disposed) disposer();
                else disposers.push(disposer);
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                while (disposers.length) {
                    try { disposers.pop()(); } catch (error) {
                        console.warn('[PlayerCleaner] Listener teardown failed:', error);
                    }
                }
            },
            get size() { return disposers.length; }
        };
    }

    function teardownActiveWrapper() {
        window._iframeGhostPlayer?.destroy?.();
        window._iframeGhostPlayer = null;
        activePlaybackRetry?.cancel?.();
        activePlaybackRetry = null;
        activeWrapperListenerScope?.dispose?.();
        activeWrapperListenerScope = null;
        activeSubtitleResizeObserver?.disconnect?.();
        activeSubtitleResizeObserver = null;
        activeSubtitleAppearanceStyle?.remove?.();
        activeSubtitleAppearanceStyle = null;
        activeSubtitleAppearanceWrapper?.classList?.remove('movie-extension-subtitle-host');
        activeSubtitleAppearanceWrapper = null;
        activeSubtitleControlsDock = null;
        if (subtitleAppearanceSaveTimer) {
            clearTimeout(subtitleAppearanceSaveTimer);
            subtitleAppearanceSaveTimer = null;
            saveSubtitleAppearance();
        }
        activeWrapper = null;
    }

    function activateWrapperListenerScope(scope, wrapper) {
        teardownActiveWrapper();
        activeWrapperListenerScope = scope;
        activeWrapper = wrapper;
    }

    function getPlayerObservationRoot(doc = document) {
        const explicitContainer = doc.getElementById?.('videoContainer')
            || doc.querySelector?.('#videoPlayerModal .video-container')
            || doc.getElementById?.('videoPlayerModal')
            // Third-party embeds such as Venom mount <video> asynchronously inside
            // a stable #player node. Observe it immediately instead of timing out
            // while waiting for the video element itself to exist.
            || doc.getElementById?.('player')
            || doc.querySelector?.('.player-container, .player-clean, .video-wrapper, .native-player-wrapper');
        if (explicitContainer) return explicitContainer;

        const videoParent = doc.querySelector?.('video')?.parentElement;
        return videoParent && videoParent !== doc.body && videoParent !== doc.documentElement
            ? videoParent
            : null;
    }

    function mutationsWithinRoot(mutations, root) {
        if (!root) return false;
        return Array.from(mutations || []).some(mutation =>
            mutation?.target === root || root.contains?.(mutation?.target)
        );
    }

    function needsPlayerReconciliation(mutation) {
        const target = mutation?.target;
        // Timeline, loader and menu rendering belongs to this cleaner. It must
        // not repeatedly scan the provider DOM just because its controls change.
        if (!target?.closest?.('.native-player-wrapper')) return true;
        const isMediaNode = node => node?.nodeType === 1
            && (node.matches?.('video:not(.ghost-video), source')
                || node.querySelector?.('video:not(.ghost-video), source'));
        if (mutation.type === 'attributes') {
            return mutation.attributeName === 'src' && isMediaNode(target);
        }
        return [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])].some(isMediaNode);
    }

    function cleanupCleanerOwnedIframes(root) {
        if (!root?.querySelectorAll) return 0;
        let removed = 0;
        root.querySelectorAll('iframe[data-player-cleaner-owned="true"][data-player-cleaner-stale="true"]')
            .forEach(iframe => {
                if (iframe.dataset.playerSourceActive === 'true') return;
                iframe.remove();
                removed += 1;
            });
        return removed;
    }

    const PLAYER_SHORTCUT_KEYS = new Set([' ', 'k', 'j', 'l', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'f', 'm', 'c', '<', '>', '?']);

    function bindPlayerAccessibility({ container, getVideo, scope, slider, toggleFullscreen, toggleSubtitles, onSeek, onVolume }) {
        // Text fields, menus and dialogs keep their own keys. Player buttons do not
        // swallow shortcuts: arrows and letters always reach the player, and only a
        // keyboard-focused (Tab) control keeps Space/Enter as its own activation.
        const ignored = target => Boolean(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="menu"],.player-settings-menu,dialog'));
        const keyboardFocusedControl = target => {
            const control = target?.closest?.('button,[role="button"]');
            try { return Boolean(control?.matches(':focus-visible')); } catch { return false; }
        };
        const seek = value => {
            if (!container.isConnected) return;
            const media = getVideo();
            if (media && Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(media.duration, value));
        };
        const help = document.createElement('div');
        help.className = 'player-shortcut-help'; help.hidden = true;
        help.setAttribute('role', 'status'); help.setAttribute('aria-live', 'polite');
        help.textContent = pt('shortcut_help', 'Пробел/K — пауза; J/L — ±10 с; ←/→ — ±5 с; F — полный экран; M — звук; C — субтитры; </> — скорость; ? — подсказка.');
        container.appendChild(help);
        /** Runs one shortcut; returns false when the key is not a player shortcut. */
        const runShortcut = rawKey => {
            const media = getVideo();
            const key = String(rawKey || '').toLowerCase();
            if (!media || !container.isConnected || !PLAYER_SHORTCUT_KEYS.has(key)) return false;
            if (key === ' ' || key === 'k') { if (media.paused) media.play().catch(() => {}); else media.pause(); }
            else if (['j', 'l', 'arrowleft', 'arrowright'].includes(key)) { seek(media.currentTime + ({ j: -10, l: 10, arrowleft: -5, arrowright: 5 }[key])); onSeek?.(key === 'j' || key === 'arrowleft' ? 'left' : 'right'); }
            else if (key === 'arrowup' || key === 'arrowdown') { media.volume = Math.max(0, Math.min(1, media.volume + (key === 'arrowup' ? .05 : -.05))); onVolume?.(media.volume * 100); }
            else if (key === 'f') toggleFullscreen?.();
            else if (key === 'm') media.muted = !media.muted;
            else if (key === 'c') toggleSubtitles?.();
            else if (key === '<' || key === '>') window.PlayerMediaControls.PlaybackRate.step(media, key === '>' ? 1 : -1);
            else if (key === '?') help.hidden = !help.hidden;
            return true;
        };
        // Capture on window, before the provider page sees the key: provider players
        // bind their own Space/arrow handlers to the same video, and both toggling
        // play/pause would cancel each other out.
        scope.listen(window, 'keydown', event => {
            if (!container.isConnected || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || ignored(event.target)) return;
            const key = event.key.toLowerCase();
            if ((key === ' ' || key === 'enter') && keyboardFocusedControl(event.target)) return;
            if (!PLAYER_SHORTCUT_KEYS.has(key) || !getVideo()) return;
            event.preventDefault(); event.stopImmediatePropagation();
            runShortcut(key);
        }, true);
        // Swallow the matching keyup too: some providers toggle on keyup instead.
        scope.listen(window, 'keyup', event => {
            if (!container.isConnected || event.ctrlKey || event.altKey || event.metaKey || ignored(event.target)) return;
            const key = event.key.toLowerCase();
            if ((key === ' ' || key === 'enter') && keyboardFocusedControl(event.target)) return;
            if (!PLAYER_SHORTCUT_KEYS.has(key) || !getVideo()) return;
            event.preventDefault(); event.stopImmediatePropagation();
        }, true);
        // The host page forwards shortcuts pressed while its focus is outside this frame.
        scope.listen(window, 'message', event => {
            if (event.data?.type !== 'PLAYER_SHORTCUT' || !isTrustedHostMessage(event)) return;
            runShortcut(event.data.key);
        });
        // A mouse click leaves focus on the clicked control, and Space would then
        // re-click it instead of pausing. Mouse clicks hand focus back to the page;
        // the settings menu keeps focus for its own keyboard navigation.
        scope.listen(container, 'click', event => {
            if (event.detail === 0) return;
            const control = event.target?.closest?.('button,[role="button"],[role="slider"]');
            if (!control || control.closest('.player-settings-menu') || control.matches('.player-settings-button')) return;
            if (document.activeElement === control) control.blur();
        });
        if (slider) {
            slider.tabIndex = 0; slider.classList.add('player-keyboard-action'); slider.setAttribute('role', 'slider'); slider.setAttribute('aria-label', pt('seek', 'Перемотка'));
            slider.setAttribute('aria-valuemin', '0');
            const update = () => {
                const media = getVideo();
                const duration = Number.isFinite(media?.duration) ? media.duration : 0;
                const time = Number.isFinite(media?.currentTime) ? media.currentTime : 0;
                slider.setAttribute('aria-valuemax', String(Math.floor(duration)));
                slider.setAttribute('aria-valuenow', String(Math.floor(time)));
                const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
                slider.setAttribute('aria-valuetext', `${clock(time)} / ${clock(duration)}`);
            };
            scope.listen(slider, 'keydown', event => {
                const media = getVideo();
                if (!media || !Number.isFinite(media.duration)) return;
                const targets = { Home: 0, End: media.duration, PageUp: media.currentTime + 60, PageDown: media.currentTime - 60, ArrowLeft: media.currentTime - 5, ArrowRight: media.currentTime + 5 };
                if (!Object.hasOwn(targets, event.key)) return;
                event.preventDefault(); event.stopPropagation(); seek(targets[event.key]); update();
            });
            const media = getVideo();
            if (media) for (const event of ['timeupdate', 'durationchange', 'loadedmetadata']) scope.listen(media, event, update);
            update();
        }
        scope.listen(container, 'keydown', event => {
            const menu = event.target.closest?.('.player-settings-menu');
            if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
            const items = [...menu.querySelectorAll('button,[role="button"],input,select')].filter(item => !item.disabled && !item.hidden);
            if (event.key === 'Escape') { menu.style.display = 'none'; container.querySelector('.player-settings-button')?.focus(); }
            else if (items.length) {
                const index = items.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next].focus();
            }
            event.preventDefault(); event.stopPropagation();
        });
        const session = window.navigator?.mediaSession;
        if (session) {
            const current = () => container.isConnected ? getVideo() : null;
            const actions = {
                play: () => current()?.play().catch(() => {}), pause: () => current()?.pause(),
                seekto: detail => { if (Number.isFinite(detail.seekTime)) seek(detail.seekTime); },
                previoustrack: () => container.querySelector('[data-player-episode-action="previous"]:not(:disabled)')?.click(),
                nexttrack: () => container.querySelector('[data-player-episode-action="next"]:not(:disabled)')?.click()
            };
            const owned = [];
            for (const [action, handler] of Object.entries(actions)) {
                try { session.setActionHandler(action, handler); owned.push(action); } catch { /* Platform capability varies. */ }
            }
            try { if (typeof window.MediaMetadata === 'function') session.metadata = new window.MediaMetadata({ title: document.title || 'MovieList' }); } catch { /* Optional API. */ }
            scope.addDisposer(() => {
                for (const action of owned) { try { session.setActionHandler(action, null); } catch { /* Optional API. */ } }
                try { session.metadata = null; } catch { /* Optional API. */ }
            });
        }
        scope.addDisposer(() => help.remove());
    }

    function makeKeyboardActivatable(element, label) {
        if (!element) return;
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        if (label) element.setAttribute('aria-label', label);
        element.classList.add('player-keyboard-action');
        element.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            // Focus left by a mouse click: Space belongs to play/pause, not this control.
            let keyboardFocus = true;
            try { keyboardFocus = element.matches(':focus-visible'); } catch { /* Older engines. */ }
            if (event.key === ' ' && !keyboardFocus) return;
            event.preventDefault();
            element.click();
        });
    }
    
    // Anime Skip State
    let animeSkipData = null; // { startTime, endTime, episodeLength }
    let skipButtonVisible = false;
    let skipButton = null;
    
    // Subtitle Persistence Keys (Shared)
    const SUB_ENABLED_KEY = 'movieExtension_subs_enabled';
    const SUB_TRACK_KEY = 'movieExtension_subs_track';
    const SUBTITLE_APPEARANCE_STORAGE_KEY = 'movieExtensionSubtitleAppearanceV1';
    const DEFAULT_SUBTITLE_APPEARANCE = window.PlayerMediaControls.SubtitleAppearance.defaults;
    let subtitleAppearance = { ...DEFAULT_SUBTITLE_APPEARANCE };
    const normalizeSubtitleAppearance = window.PlayerMediaControls.SubtitleAppearance.normalize;
    const getSubtitleAppearanceTextShadow = window.PlayerMediaControls.SubtitleAppearance.shadow;
    const getSubtitleAppearanceRgb = window.PlayerMediaControls.SubtitleAppearance.rgb;

    const updateActiveSubtitleAppearance = () => {
        const wrapper = activeSubtitleAppearanceWrapper;
        const style = activeSubtitleAppearanceStyle;
        if (!wrapper || !style || !document.contains(wrapper)) return;

        const video = wrapper.querySelector('video');
        const playerHeight = wrapper.clientHeight || video?.clientHeight || window.innerHeight || 0;
        const userOffset = Math.round(playerHeight * (subtitleAppearance.offsetPercent / 100));
        const dockHeight = activeSubtitleControlsDock?.offsetHeight || 0;
        const dockBottom = Number.parseFloat(activeSubtitleControlsDock?.style.bottom || '14') || 14;
        const controlsSafetyOffset = dockBottom + dockHeight + 12;
        const bottomOffset = wrapper.classList.contains('controls-visible')
            ? Math.max(userOffset, controlsSafetyOffset)
            : userOffset;
        const captionReserve = Math.min(140, Math.max(64, Math.round(playerHeight * 0.16)));
        const translateY = subtitleAppearance.position === 'top'
            ? -Math.max(0, playerHeight - userOffset - captionReserve)
            : -bottomOffset;
        const rgb = getSubtitleAppearanceRgb(subtitleAppearance.color);

        style.textContent = `
            .native-player-wrapper.movie-extension-subtitle-host video::cue {
                color: ${subtitleAppearance.color} !important;
                background-color: rgba(0, 0, 0, ${subtitleAppearance.backgroundOpacity}) !important;
                font-size: ${(subtitleAppearance.fontSizePercent / 100).toFixed(2)}em !important;
                text-shadow: ${getSubtitleAppearanceTextShadow(subtitleAppearance)} !important;
            }
            .native-player-wrapper.movie-extension-subtitle-host video::-webkit-media-text-track-display {
                color: ${subtitleAppearance.color} !important;
                background-color: rgba(0, 0, 0, ${subtitleAppearance.backgroundOpacity}) !important;
                transform: translateY(${translateY}px) !important;
                transition: transform 180ms ease !important;
                text-shadow: ${getSubtitleAppearanceTextShadow(subtitleAppearance)} !important;
            }
            .native-player-wrapper.movie-extension-subtitle-host video::-webkit-media-text-track-container {
                color: rgb(${rgb}) !important;
            }
        `;
    };

    const activateSubtitleAppearance = (wrapper, controlsDock) => {
        activeSubtitleResizeObserver?.disconnect?.();
        activeSubtitleAppearanceStyle?.remove?.();
        activeSubtitleAppearanceWrapper = wrapper;
        activeSubtitleControlsDock = controlsDock;
        wrapper.classList.add('movie-extension-subtitle-host');
        activeSubtitleAppearanceStyle = document.createElement('style');
        activeSubtitleAppearanceStyle.dataset.movieExtensionSubtitleAppearance = 'true';
        document.head.appendChild(activeSubtitleAppearanceStyle);
        updateActiveSubtitleAppearance();

        if (typeof ResizeObserver === 'function') {
            activeSubtitleResizeObserver = new ResizeObserver(updateActiveSubtitleAppearance);
            activeSubtitleResizeObserver.observe(wrapper);
            if (controlsDock) activeSubtitleResizeObserver.observe(controlsDock);
        }
    };

    const setSubtitleAppearance = rawValue => {
        subtitleAppearance = normalizeSubtitleAppearance(rawValue);
        updateActiveSubtitleAppearance();
    };

    let subtitleAppearanceSaveTimer = null;
    const saveSubtitleAppearance = () => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return;
        try {
            const result = chrome.storage.local.set({
                [SUBTITLE_APPEARANCE_STORAGE_KEY]: { ...subtitleAppearance }
            });
            result?.catch?.(() => {});
        } catch {
            // Keep the in-memory value when extension storage is unavailable.
        }
    };

    const persistSubtitleAppearance = rawValue => {
        setSubtitleAppearance(rawValue);
        if (subtitleAppearanceSaveTimer) clearTimeout(subtitleAppearanceSaveTimer);
        subtitleAppearanceSaveTimer = setTimeout(() => {
            subtitleAppearanceSaveTimer = null;
            saveSubtitleAppearance();
        }, 120);
    };

    const loadSubtitleAppearance = () => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        try {
            chrome.storage.local.get(SUBTITLE_APPEARANCE_STORAGE_KEY, stored => {
                if (chrome.runtime?.lastError) return;
                setSubtitleAppearance(stored?.[SUBTITLE_APPEARANCE_STORAGE_KEY]);
            });
        } catch {
            // The player still has a safe local default when extension storage is unavailable.
        }
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local' || !changes[SUBTITLE_APPEARANCE_STORAGE_KEY]) return;
            setSubtitleAppearance(changes[SUBTITLE_APPEARANCE_STORAGE_KEY].newValue);
        });
    }
    loadSubtitleAppearance();

    // === Anime Skip Button Logic (Global Scope) ===
    const showSkipButton = () => {
        if (!skipButtonVisible && skipButton) {
            skipButton.style.display = 'flex';
            skipButtonVisible = true;
            console.log('[MovieExtension] Skip button shown');
        }
    };
    
    const hideSkipButton = () => {
        if (skipButtonVisible && skipButton) {
            skipButton.style.display = 'none';
            skipButtonVisible = false;
            console.log('[MovieExtension] Skip button hidden');
        }
    };
    
    // Check skip button visibility based on current time
    const checkSkipButtonVisibility = (currentTime) => {
        // Fix: Use Number.isFinite for startTime to allow 0 (start of video)
        if (!animeSkipData || !Number.isFinite(animeSkipData.startTime) || !animeSkipData.endTime) {
            hideSkipButton();
            return;
        }
        
        const { startTime, endTime } = animeSkipData;
        const preShowTime = 3; // Show 3 seconds before opening starts
        
        // Show button if: within (startTime - 3s) to endTime range
        if (currentTime >= (startTime - preShowTime) && currentTime < endTime) {
            if (!skipButtonVisible) {
                console.log(`[SkipError] Skip window active (t=${currentTime.toFixed(1)}s, range: ${startTime}-${endTime}s) — showing button`);
            }
            showSkipButton();
        } else {
            hideSkipButton();
        }
    };

    // Shared Subtitle Restoration Logic
    const restoreSubtitlesLogic = (videoEl, wrapperEl) => {
        const isEnabled = localStorage.getItem(SUB_ENABLED_KEY) === 'true';
        if (!isEnabled) return;

        // Helper to update button (searched in wrapper)
        const updateBtn = (active) => {
            if (!wrapperEl) return;
            const btn = wrapperEl.querySelector('.subtitles-toggle-btn');
            if (btn) {
                btn.style.opacity = active ? '1' : '0.7';
                const path = btn.querySelector('path');
                if (path) path.setAttribute('fill', active ? '#f4f4f5' : '#a1a1aa');
            }
        };

        // Wait for tracks to load
        let attempts = 0;
        const checkTracks = setInterval(() => {
            attempts++;
            const tracks = Array.from(videoEl.textTracks || []);
            
            if (tracks.length > 0) {
                clearInterval(checkTracks);
                
                const savedLabel = localStorage.getItem(SUB_TRACK_KEY);
                let targetTrack = null;

                if (savedLabel) {
                    targetTrack = tracks.find(t => t.label === savedLabel);
                }

                if (!targetTrack) {
                     targetTrack = tracks.find(t => {
                        const l = (t.label || '').toLowerCase();
                        const lang = (t.language || '').toLowerCase();
                        return l.includes('rus') || l.includes('рус') || lang === 'ru';
                    });
                }
                
                if (!targetTrack && tracks.length > 0) targetTrack = tracks[0];

                if (targetTrack) {
                    tracks.forEach(t => t.mode = 'disabled');
                    targetTrack.mode = 'showing';
                    updateBtn(true);
                }
            }

            if (attempts > 20) clearInterval(checkTracks);
        }, 500);
    };
    
    // Inject preventative script to suppress AbortErrors from the site's own code
    // This runs efficiently once at startup
    try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content-scripts/suppress-errors.js');
        (document.head || document.documentElement).appendChild(script);
        script.onload = () => script.remove();
    } catch {
        // Silent catch
    }

    /**
     * Проверяет, является ли src настоящим медиа-источником,
     * а не HTML-страницей или пустышкой.
     */
    function findContentVideo() {
        // Venom has separate content and VAST/VPAID video containers. DOM order
        // is not media identity: a pre-roll can be inserted before the movie.
        const venomPlayer = document.querySelector('.player_1JR');
        const candidates = document.querySelectorAll(
            'video:not(.native-player-wrapper video):not(.ghost-video):not([data-ghost="true"])'
        );
        return Array.from(candidates).find(video =>
            !venomPlayer || (venomPlayer.contains(video) && video.closest('.video_9Xh'))
        ) || null;
    }

    function isValidMediaSrc(src) {
        if (!src || src === '' || src === 'about:blank') return false;
        
        // blob: URL — всегда валидный медиа-источник
        if (src.startsWith('blob:')) return true;
        
        // Прямые медиа-форматы
        if (/\.(mp4|webm|ogg|m3u8|mpd|ts|mkv)(\?|#|$)/i.test(src)) return true;
        
        // HLS/DASH манифесты через API-пути
        if (/\/(manifest|playlist|stream|hls|dash|video)\//i.test(src)) return true;
        
        // data: URI (poster/thumbnail как video — редко, но допустимо)
        if (src.startsWith('data:video/')) return true;
        
        // Всё остальное (embed-страницы, html-страницы) — не медиа
        return false;
    }

    function getPreviewMediaUrl(video, doc = document) {
        const hlsUrl = video?._movieExtensionHls?.url;
        if (hlsUrl && !hlsUrl.startsWith('blob:')) return hlsUrl;
        const source = video?.currentSrc || video?.src || video?.querySelector?.('source')?.src;
        if (source && !source.startsWith('blob:') && isValidMediaSrc(source)) return source;
        const preview = video?.dataset;
        if (preview?.playerPreviewUrl && preview.playerPreviewMedia === (source || '')) {
            try {
                const url = new URL(preview.playerPreviewUrl);
                if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
            } catch { /* Invalid provider metadata leaves the time label available. */ }
        }

        // Provider HLS/DASH instances live in MAIN, outside this content script's
        // world. For Venom's blob-backed movie, read the literal HLS alternative
        // from its own constructor config, without executing provider JavaScript.
        if (doc.querySelector?.('.player_1JR')) {
            for (const script of doc.querySelectorAll('script:not([src])')) {
                const config = script.textContent || '';
                if (!config.includes('makePlayer(')) continue;
                // A literal source in a playlist can belong to another episode.
                // The MAIN bridge tracks the active item instead.
                if (/\bplaylist\s*:/.test(config)) continue;
                const match = config.match(/\bsource\s*:\s*\{[\s\S]*?\bhls\s*:\s*(['"])(.*?)\1/);
                if (!match) continue;
                try {
                    const url = new URL(match[2].replace(/\\\//g, '/'), window.location.href);
                    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
                } catch {
                    // Malformed or unavailable preview sources leave a time-only tooltip.
                }
            }
        }
        return null; // Never reuse an MSE blob or an unrelated/ad performance entry.
    }

    function setCleanerSourceState(video, state, options = {}) {
        const lifecycle = window.PlayerSourceLifecycle;
        const container = video?.closest?.('.player-clean, .native-player-wrapper, .video-wrapper')
            || video?.parentElement;
        if (lifecycle && container) lifecycle.setState(container, state, options);
    }

    function playAdoptedVideo(video) {
        activePlaybackRetry?.cancel?.();
        activePlaybackRetry = tryPlayWithLimit(video, {
            isRequestCurrent: () => activeRequestGuard(),
            isSourceCurrent: () => permanentVideo === video && document.contains(video),
            onState: state => {
                if (!activeRequestGuard() || permanentVideo !== video) return;
                setCleanerSourceState(video, state, {
                    onRetry: state === 'error' || state === 'unavailable'
                        ? () => playAdoptedVideo(video)
                        : null
                });
            }
        });
    }

    function tryPlayWithLimit(video, options = {}) {
        const lifecycle = window.PlayerSourceLifecycle;
        const states = lifecycle?.STATES || {
            LOADING: 'loading', READY: 'ready', ERROR: 'error',
            UNAVAILABLE: 'unavailable', CANCELLED: 'cancelled'
        };
        const maxAttempts = options.maxAttempts ?? 40;
        const intervalMs = options.intervalMs ?? 100;
        const isRequestCurrent = options.isRequestCurrent || (() => true);
        const isSourceCurrent = options.isSourceCurrent || (() => true);
        let attempts = 0;
        let active = true;
        let timer = null;
        let resolveResult;
        const promise = new Promise(resolve => { resolveResult = resolve; });

        const emit = (state, detail = {}) => {
            options.onState?.(state, detail);
        };
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            video?.removeEventListener?.('error', onVideoError);
            video?.removeEventListener?.('loadeddata', onMediaReady);
            video?.removeEventListener?.('canplay', onMediaReady);
        };
        const finish = (state, detail = {}) => {
            if (!active) return;
            active = false;
            cleanup();
            emit(state, detail);
            resolveResult({ state, attempts, ...detail });
        };
        const onVideoError = () => finish(states.ERROR, {
            reason: 'media-error',
            error: video?.error || null
        });
        const onMediaReady = () => {
            if (!active || video?.readyState < 2) return;
            if (timer) clearTimeout(timer);
            attemptPlay();
        };
        const attemptPlay = () => {
            if (!active) return;
            if (!isRequestCurrent() || !isSourceCurrent()) {
                finish(states.CANCELLED, { reason: 'stale-request' });
                return;
            }
            if (video?.error) {
                onVideoError();
                return;
            }

            attempts += 1;
            if (video?.readyState >= 2) {
                try {
                    const playPromise = video.play();
                    Promise.resolve(playPromise).catch(error => {
                        if (error?.name !== 'AbortError') {
                            console.log('[MovieExtension] Auto-play prevented:', error?.message);
                        }
                    });
                } catch (error) {
                    console.log('[MovieExtension] Auto-play failed:', error?.message);
                }
                finish(states.READY, { reason: 'ready' });
                return;
            }

            if (attempts >= maxAttempts) {
                finish(states.UNAVAILABLE, { reason: 'retry-limit' });
                return;
            }
            timer = setTimeout(attemptPlay, intervalMs);
        };

        video?.addEventListener?.('error', onVideoError);
        video?.addEventListener?.('loadeddata', onMediaReady);
        video?.addEventListener?.('canplay', onMediaReady);
        emit(states.LOADING, { reason: 'start' });
        attemptPlay();

        return {
            promise,
            cancel() {
                finish(states.CANCELLED, { reason: 'cancelled' });
            }
        };
    }


    // BUG 3 FIX: Listen for reset signal from extension page when switching sources
    window.addEventListener('message', (e) => {
        if (!isTrustedHostMessage(e)) return;
        if (e.data.type === 'RESET_PERMANENT_VIDEO') {
            teardownActiveWrapper();
            setPermanentVideo(null);
        }
    });

    // Expose for internal use
    window.MovieExtension_PlayerCleaner = {
        init: replacePlayer,
        setRequestGuard(guard) {
            activeRequestGuard = typeof guard === 'function' ? guard : (() => true);
            if (!activeRequestGuard()) activePlaybackRetry?.cancel?.();
        },
        _test: {
            getPreviewMediaUrl,
            findContentVideo,
            setPermanentVideo,
            observePlayerContainer,
            replacePlayerForTest: () => replacePlayer({ allowTestContext: true }),
            tryPlayWithLimit,
            createListenerScope,
            bindPlayerAccessibility,
            activateWrapperListenerScope,
            teardownActiveWrapper,
            getPlayerObservationRoot,
            mutationsWithinRoot,
            needsPlayerReconciliation,
            cleanupCleanerOwnedIframes
        }
    };

    function replacePlayer(lifecycleOptions = {}) {
        if (typeof lifecycleOptions.isRequestCurrent === 'function') {
            activeRequestGuard = lifecycleOptions.isRequestCurrent;
        }
        if (!activeRequestGuard()) return;
        // Isolation: Strict check to ensure we are running inside OUR Extension
        let isInsideExtension = false;
        
        // 1. Check if we are the extension page itself
        if (window.location.protocol === 'chrome-extension:') {
            isInsideExtension = true;
            if (!document.querySelector('video') && !document.querySelector('iframe')) {
                return;
            }
        }
        
        // 2. Check if embedded in iframe by extension (original logic)
        try {
            const selfId = chrome.runtime.id;
            if (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0) {
                // Check the top-most ancestor
                const topOrigin = window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1];
                if (topOrigin && topOrigin.startsWith('chrome-extension://' + selfId)) {
                    isInsideExtension = true;
                }
            }
        } catch (e) {
            console.warn('[PlayerCleaner] Unable to verify iframe ancestry:', e.message);
        }

        if (!isInsideExtension && !lifecycleOptions.allowTestContext) {
            return;
        }

        // Count all players in the entire document
        // EARLY EXIT: If we already have a permanentVideo and it's inside our wrapper, we're done
        // BUG 2 FIX: Also verify the element is actually in the document (not detached)
        if (permanentVideo 
            && document.contains(permanentVideo) 
            && permanentVideo.closest('.native-player-wrapper')) {
            // Before exiting, check if the site spawned a NEW video outside our wrapper
            const outsideVideo = findContentVideo();
            if (!outsideVideo || (!outsideVideo.src && !outsideVideo.currentSrc)) {
                return;
            }
            
            // Validate: don't proceed to swap if the outside video has a non-media src
            const outsideSrc = outsideVideo.src || outsideVideo.currentSrc || '';
            if (outsideSrc && !isValidMediaSrc(outsideSrc)) {
                return;
            }
            
        }

        // Check if player already exists
        const existingWrapper = document.querySelector('.native-player-wrapper');
        if (existingWrapper && permanentVideo) {
            // Player already initialized, check for new video from site
            const siteVideo = findContentVideo();
            if (siteVideo && (siteVideo.src || siteVideo.currentSrc)) {
                const newSrc = siteVideo.src || siteVideo.currentSrc || '';
                
                // Validate: skip swap if new video has non-media src (e.g. embed page URL)
                if (!isValidMediaSrc(newSrc)) {
                    return;
                }
                
                
                // FIX: Verify and clear buffer visual state immediately to prevent "ghost" segments
                const bufferContainer = existingWrapper.querySelector('.native-buffer-container');
                if (bufferContainer) bufferContainer.innerHTML = ''; // Clear old buffer segments
                
                const progressFilled = existingWrapper.querySelector('.native-progress-filled');
                if (progressFilled) progressFilled.style.width = '0%'; // Reset progress bar
                
                // Save current settings from old video
                const savedSettings = {
                    volume: permanentVideo.volume,
                    playbackRate: permanentVideo.playbackRate,
                    muted: permanentVideo.muted,
                    currentTime: 0 // Start from beginning for new episode
                };
                
                // Note: activeSubtitle was previously used here, but we now use restoreSubtitlesLogic which relies on localStorage
                
                // Remove old video
                const oldVideo = permanentVideo;
                if (oldVideo) {
                    oldVideo.pause();
                    oldVideo.removeAttribute('src'); // Detach source
                    try { oldVideo.load(); } catch {
                        // Force release of media resources
                    }
                    oldVideo.remove(); // Remove from DOM
                }
                setPermanentVideo(null); // Clear reference strictly before reassigning
                
                // Configure new video from site
                siteVideo.removeAttribute('controls');
                siteVideo.autoplay = true;
                siteVideo.playsInline = true;
                siteVideo.style.width = '100%';
                siteVideo.style.height = '100%';
                siteVideo.style.objectFit = 'contain';
                siteVideo.style.position = 'relative';
                siteVideo.style.zIndex = 'auto';
                
                // Apply saved settings
                siteVideo.volume = savedSettings.volume;
                siteVideo.playbackRate = savedSettings.playbackRate;
                siteVideo.muted = savedSettings.muted;
                
                // Insert new video in the same position (before controls overlay)
                const controlsOverlay = existingWrapper.querySelector('div[style*="pointer-events: none"]');
                existingWrapper.insertBefore(siteVideo, controlsOverlay);
                
                // Update permanent video reference
                setPermanentVideo(siteVideo);
                
                // Re-attach event listeners to new video
                if (typeof window._movieExtension_setupListeners === 'function') {
                    window._movieExtension_setupListeners(permanentVideo);
                    // Trigger volume update to sync UI (icon/slider) which depends on valid video reference
                    permanentVideo.dispatchEvent(new Event('volumechange'));
                }

                // Sync Episode Selector Logic
                // Try to determine new episode label. The clicked item sent us here, 
                // but we need to update the UI on the new persistent player.
                // We'll trust that the user just clicked something that matches currently loading video.
                // However, without parsing the number from src (which is blob), we rely on 
                // re-scanning series data OR using the last clicked item if we tracked it.
                // Since we don't track it globally easily here, we will trigger a re-scan.
                
                // Ideally, we find the horizontal selector and update it.
                // Ideally, we find the horizontal selector and update it.
                if (episodeDropdown && episodeDropdown.setVideoActive && pendingActiveEpisodeLabel) {
                    episodeDropdown.setVideoActive(pendingActiveEpisodeLabel);
                    pendingActiveEpisodeLabel = null; // Reset
                }

                
                // Re-apply correct initial state for subtitles
                // Disable all by default first to ensure clean state
                Array.from(permanentVideo.textTracks || []).forEach(t => t.mode = 'disabled');
                
                // Then try to restore user preference
                if (typeof restoreSubtitlesLogic === 'function') {
                    // Delay slightly to let metadata load or rely on its internal interval
                    restoreSubtitlesLogic(permanentVideo, existingWrapper);
                    // Also hook metadata for faster reaction
                    permanentVideo.addEventListener('loadedmetadata', () => restoreSubtitlesLogic(permanentVideo, existingWrapper), {once:true});
                }
                
                // Auto-play if flag is set
                if (localStorage.getItem('movieExtension_autoplay_next') === 'true') {
                    localStorage.removeItem('movieExtension_autoplay_next');
                    localStorage.removeItem('movieExtension_autoplay_start_time');
                    playAdoptedVideo(permanentVideo);
                }
                
                // Re-scan for voiceovers/qualities (Site likely re-rendered them)
                // Re-scan for voiceovers/qualities (Site likely re-rendered them)
                // We reuse the controlsOverlay reference from above to exclude it
                console.log('[MovieExtension] Re-scanning voiceovers for new episode...');
                if (typeof findAndRenderVoiceovers === 'function') {
                    // Delay slightly to ensure site has rendered the new lists
                    setTimeout(() => {
                        findAndRenderVoiceovers(controlsOverlay, existingWrapper);
                        console.log('[MovieExtension] Voiceover scan complete. Count:', currentVoiceoverOptions.length);
                    }, 1500); // Increased delay slightly to be safe
                }
                
                console.info('[PlayerCleaner] Native source swapped', {
                    sourceType: newSrc.startsWith('blob:') ? 'blob' : 'url'
                });
            }
            
            // Cleaner only owns nodes it explicitly created and marked. UI-owned iframes may be
            // the newly selected source while this wrapper still belongs to the previous request.
            const modalContainer = document.getElementById('videoPlayerModal') 
                                || document.querySelector('.video-container')
                                || document;
            cleanupCleanerOwnedIframes(modalContainer);
            
            // Final DOM state (scoped to modalContainer)
            const finalVideos = modalContainer.querySelectorAll('video').length;
            const finalIframes = modalContainer.querySelectorAll('iframe').length;
            const finalWrappers = modalContainer.querySelectorAll('.native-player-wrapper').length;
            console.log(`[PlayerCleaner] DOM after cleanup (scoped): videos: ${finalVideos} iframes: ${finalIframes} wrappers: ${finalWrappers}`);
            
            return; // Player exists, nothing more to do
        }
        
        // Find site's video element to extract source
        const siteVideo = findContentVideo();
        
        // Scan for potential translator/season lists BEFORE we hide them
        // Common selectors in these players: .season-list, .episode-list, .translate-list, .box-list
        if (!window.extractedSources) {
            const potentialLists = document.querySelectorAll('ul, .dropdown, select, .list');
            
            potentialLists.forEach(el => {
                // Check content for keywords
                const text = el.textContent || '';
                if (text.includes('Original') || text.includes('Dubbing') || text.includes('Дубляж') || text.includes('TVShows')) {
                    // List detected
                }
            });
        }
        
        if (!siteVideo) {
            return; // No video found yet
        }
        
        if (!siteVideo.src && !siteVideo.currentSrc && siteVideo.querySelectorAll('source').length === 0
            && !siteVideo._movieExtensionHls) {
            return; // Video has no source
        }
        
        // Filter out video elements with non-media src (e.g. embed page URLs)
        const candidateSrc = siteVideo.src || siteVideo.currentSrc || '';
        if (candidateSrc && !isValidMediaSrc(candidateSrc)) {
            return;
        }
        
        // Extract source from site's video
        const initialSrc = siteVideo.src || siteVideo.currentSrc || (siteVideo.querySelector('source') ? siteVideo.querySelector('source').src : '');
        
        if (!initialSrc && !siteVideo._movieExtensionHls) {
            return; // No valid source
        }
        
        // IMPORTANT: Use site's original video element as our permanent element
        // This is critical for blob: URLs which are tied to the specific element
        setPermanentVideo(siteVideo);
        
        // Configure the existing video element
        permanentVideo.removeAttribute('controls'); // Remove native controls
        permanentVideo.autoplay = permanentVideo.dataset.playerProvider !== 'torrent';
        permanentVideo.playsInline = true;
        permanentVideo.style.width = '100%';
        permanentVideo.style.height = '100%';
        permanentVideo.style.objectFit = 'contain';
        permanentVideo.style.position = 'relative';
        permanentVideo.style.zIndex = 'auto';
        
        // DON'T remove site's video - we're using it!
        // siteVideo.remove(); // REMOVED
        
        // Use permanentVideo as 'video' reference for the rest of the function
        const video = permanentVideo;

                       
            
            // Create container to hold our new player
            const listenerScope = createListenerScope();
            const newContainer = document.createElement('div');
            // script.remove(); removed from here
            
            newContainer.className = 'native-player-wrapper player-surface__content';
            activateWrapperListenerScope(listenerScope, newContainer);

            // Global left-click enforcer for the custom player UI
            const clickEnforcer = (e) => {
                if ('button' in e && e.button !== 0) {
                    e.stopPropagation();
                    if (e.button === 1) e.preventDefault(); // Block middle click
                }
            };
            newContainer.addEventListener('mousedown', clickEnforcer, true);
            newContainer.addEventListener('mouseup', clickEnforcer, true);
            newContainer.addEventListener('click', clickEnforcer, true);
            
            // Check if we are running in the extension modal context
            // If so, we want to respect the parent container's layout
            const isEmbedded = window.location.protocol === 'chrome-extension:' || document.querySelector('.video-container');

            if (isEmbedded) {
                 newContainer.style.position = 'relative'; // Keep in flow
                 newContainer.style.width = '100%';
                 newContainer.style.height = '100%'; // Or 'auto' if flex handles it, but 100% is safe usually
                 newContainer.style.flex = '1'; // Occupy remaining space
                 newContainer.style.backgroundColor = '#000';
                 newContainer.style.display = 'flex';
                 newContainer.style.alignItems = 'center';
                 newContainer.style.justifyContent = 'center';
                 newContainer.style.zIndex = '1'; // Standard z-index
            } else {
                 // Standalone / Fullscreen overlay mode (Original behavior)
                 newContainer.style.position = 'fixed';
                 newContainer.style.top = '0';
                 newContainer.style.left = '0';
                 newContainer.style.width = '100%';
                 newContainer.style.height = '100%';
                 newContainer.style.backgroundColor = '#000';
                 newContainer.style.zIndex = '2147483647'; // Max z-index
                 newContainer.style.display = 'flex';
                 newContainer.style.alignItems = 'center';
                 newContainer.style.justifyContent = 'center';
            }

            // Controls Overlay for Center Button
            const controlsOverlay = document.createElement('div');
            controlsOverlay.style.position = 'absolute';
            controlsOverlay.style.top = '0';
            controlsOverlay.style.left = '0';
            controlsOverlay.style.width = '100%';
            controlsOverlay.style.height = '100%';
            controlsOverlay.style.pointerEvents = 'none'; // Click-through mostly
            controlsOverlay.style.zIndex = '2147483620';

            // Center Play/Pause Button
            const centerPlayBtn = document.createElement('button');
            centerPlayBtn.type = 'button';
            centerPlayBtn.setAttribute('aria-label', pt('play_pause', 'Воспроизвести или поставить на паузу'));
            centerPlayBtn.className = 'player-center-action player-keyboard-action';
            centerPlayBtn.style.position = 'absolute';
            centerPlayBtn.style.top = '50%';
            centerPlayBtn.style.left = '50%';
            centerPlayBtn.style.transform = 'translate(-50%, -50%)';
            centerPlayBtn.style.background = 'rgba(18, 18, 20, 0.72)';
            centerPlayBtn.style.border = '1px solid rgba(255, 255, 255, 0.16)';
            centerPlayBtn.style.borderRadius = '20px';
            centerPlayBtn.style.width = '66px';
            centerPlayBtn.style.height = '66px';
            centerPlayBtn.style.cursor = 'pointer';
            centerPlayBtn.style.pointerEvents = 'auto';
            centerPlayBtn.style.display = 'flex';
            centerPlayBtn.style.alignItems = 'center';
            centerPlayBtn.style.justifyContent = 'center';
            centerPlayBtn.style.transition = 'opacity 220ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1), scale 320ms cubic-bezier(0.16, 1, 0.3, 1)';
            centerPlayBtn.style.backdropFilter = 'blur(16px) saturate(130%)';
            centerPlayBtn.style.boxShadow = '0 18px 48px rgba(0, 0, 0, 0.45), inset 0 1px rgba(255, 255, 255, 0.08)';
            makeKeyboardActivatable(centerPlayBtn, pt('play_pause', 'Воспроизвести или поставить на паузу'));

            // Hover effect for center button
            centerPlayBtn.addEventListener('mouseenter', () => centerPlayBtn.style.transform = 'translate(-50%, -50%) scale(1.04)');
            centerPlayBtn.addEventListener('mouseleave', () => centerPlayBtn.style.transform = 'translate(-50%, -50%) scale(1.0)');

            centerPlayBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentVid = permanentVideo || video;
                if (currentVid) currentVid.focus(); // Fix focus
                console.log('[MovieExtension] Center Play clicked');
                if (currentVid.paused) {
                     currentVid.play().catch(e => {
                        if (e.name !== 'AbortError') console.log('[MovieExtension] Play failed:', e);
                     });
                } else {
                     currentVid.pause();
                }
            });

            controlsOverlay.appendChild(centerPlayBtn);

            // Seek Indicators (+10 / -10)
            const leftSeekIndicator = document.createElement('div');
            leftSeekIndicator.style.position = 'absolute';
            leftSeekIndicator.style.top = '50%';
            leftSeekIndicator.style.left = '15%';
            leftSeekIndicator.style.transform = 'translate(-50%, -50%)';
            leftSeekIndicator.style.fontSize = '48px';
            leftSeekIndicator.style.fontWeight = 'bold';
            leftSeekIndicator.style.color = '#ffffff';
            leftSeekIndicator.style.textShadow = '0 0 10px rgba(0,0,0,0.8)';
            leftSeekIndicator.style.opacity = '0';
            leftSeekIndicator.style.pointerEvents = 'none';
            leftSeekIndicator.style.zIndex = '2147483648';
            leftSeekIndicator.style.transition = 'opacity 0.2s ease';
            leftSeekIndicator.textContent = '-10';
            controlsOverlay.appendChild(leftSeekIndicator);

            const rightSeekIndicator = document.createElement('div');
            rightSeekIndicator.style.position = 'absolute';
            rightSeekIndicator.style.top = '50%';
            rightSeekIndicator.style.right = '15%';
            rightSeekIndicator.style.transform = 'translate(50%, -50%)';
            rightSeekIndicator.style.fontSize = '48px';
            rightSeekIndicator.style.fontWeight = 'bold';
            rightSeekIndicator.style.color = '#ffffff';
            rightSeekIndicator.style.textShadow = '0 0 10px rgba(0,0,0,0.8)';
            rightSeekIndicator.style.opacity = '0';
            rightSeekIndicator.style.pointerEvents = 'none';
            rightSeekIndicator.style.zIndex = '2147483648';
            rightSeekIndicator.style.transition = 'opacity 0.2s ease';
            rightSeekIndicator.textContent = '+10';
            controlsOverlay.appendChild(rightSeekIndicator);

            // Indicator animation timers
            let leftSeekTimeout = null;
            let rightSeekTimeout = null;

            // Show seek indicator with animation
            const showSeekIndicator = (indicator, timeoutRef) => {
                // Clear existing timeout if any
                if (timeoutRef === 'left' && leftSeekTimeout) {
                    clearTimeout(leftSeekTimeout);
                    leftSeekTimeout = null;
                }
                if (timeoutRef === 'right' && rightSeekTimeout) {
                    clearTimeout(rightSeekTimeout);
                    rightSeekTimeout = null;
                }
                
                // Force hide first to reset animation
                indicator.style.opacity = '0';
                
                // Show with slight delay to ensure reset
                setTimeout(() => {
                    indicator.style.opacity = '1';
                    
                    // Hide after 1 second
                    const timeout = setTimeout(() => {
                        indicator.style.opacity = '0';
                    }, 1000);
                    
                    if (timeoutRef === 'left') {
                        leftSeekTimeout = timeout;
                    } else {
                        rightSeekTimeout = timeout;
                    }
                }, 50);
            };

            // Volume Indicator (top-center)
            const volumeIndicator = document.createElement('div');
            volumeIndicator.style.position = 'absolute';
            volumeIndicator.style.top = '30px';
            volumeIndicator.style.left = '50%';
            volumeIndicator.style.transform = 'translateX(-50%)';
            volumeIndicator.style.fontSize = '28px';
            volumeIndicator.style.fontWeight = 'bold';
            volumeIndicator.style.color = '#ffffff';
            volumeIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            volumeIndicator.style.padding = '8px 20px';
            volumeIndicator.style.borderRadius = '8px';
            volumeIndicator.style.opacity = '0';
            volumeIndicator.style.pointerEvents = 'none';
            volumeIndicator.style.zIndex = '2147483648';
            volumeIndicator.style.transition = 'opacity 0.3s ease';
            volumeIndicator.textContent = '50%';
            controlsOverlay.appendChild(volumeIndicator);

            // Volume indicator animation timer
            let volumeIndicatorTimeout = null;

            // Show volume indicator with animation
            const showVolumeIndicator = (volumePercent) => {
                // Clear existing timeout
                if (volumeIndicatorTimeout) {
                    clearTimeout(volumeIndicatorTimeout);
                    volumeIndicatorTimeout = null;
                }
                
                // Update text
                volumeIndicator.textContent = Math.round(volumePercent) + '%';
                
                // Force show
                volumeIndicator.style.opacity = '0';
                
                setTimeout(() => {
                    volumeIndicator.style.opacity = '1';
                    
                    // Hide after 1.5 seconds
                    volumeIndicatorTimeout = setTimeout(() => {
                        volumeIndicator.style.opacity = '0';
                    }, 1500);
                }, 50);
            };


            // Video element is now permanently created, no need for injection logic




            // Move the video into our container
            const originalParent = video.parentElement;
            newContainer.appendChild(video);
            newContainer.appendChild(controlsOverlay); // Append controls


            if (isEmbedded && originalParent) {
                 // Embedded mode: specific injection
                 originalParent.appendChild(newContainer);
                 // Do NOT hide other elements
            } else {
                // Standalone mode: fullscreen body injection
                document.body.appendChild(newContainer);

                // Hide everything else in body except our container
                Array.from(document.body.children).forEach(child => {
                    if (child !== newContainer) {
                        child.style.display = 'none';
                        // Optional: remove if you want to be aggressive, but hiding is safer for scripts
                    }
                });
            }

            // Force focus
            video.focus();
            
            // State for Voiceovers (Removed local decl, using global)
            
            // Inject cleaner-owned styles. Subtitle appearance itself is kept in
            // a separate dynamic style so it can react to local user settings.
            const subParams = document.createElement('style');
            subParams.textContent = `
                /* Consistent keyboard focus for cleaner-owned controls */
                .native-player-wrapper button:focus-visible {
                    outline: 3px solid #fff !important;
                    outline-offset: 3px !important;
                }

                .native-player-wrapper .player-keyboard-action:focus-visible {
                    outline: 3px solid #fff !important;
                    outline-offset: 3px !important;
                }

                /* Obsidian-zinc cleaner controls (iframe-safe visual contract). */
                .native-player-wrapper .player-center-action {
                    width: 66px !important;
                    height: 66px !important;
                    color: #fafafa;
                    background: rgba(18, 18, 20, .72) !important;
                    border: 1px solid rgba(255, 255, 255, .16) !important;
                    border-radius: 20px !important;
                    box-shadow: 0 16px 40px rgba(0, 0, 0, .42), inset 0 1px rgba(255, 255, 255, .08);
                    backdrop-filter: blur(14px) saturate(130%) !important;
                }
                .native-player-wrapper .player-center-action svg {
                    width: 40px !important;
                    height: 40px !important;
                    transform: none !important;
                }
                .native-player-wrapper .player-center-action[data-icon="play"] svg {
                    transform: translateX(1px) !important;
                }
                .native-player-wrapper .player-control-dock {
                    min-height: 52px;
                    padding: 7px 10px !important;
                    gap: 8px !important;
                    background: rgba(18, 18, 20, .76) !important;
                    border: 1px solid rgba(255, 255, 255, .1) !important;
                    border-radius: 16px !important;
                    box-shadow: 0 18px 48px rgba(0, 0, 0, .42), inset 0 1px rgba(255, 255, 255, .05) !important;
                    backdrop-filter: blur(18px) saturate(130%) !important;
                    /* Hiding: the dock eases down and fades out unhurriedly. */
                    transition: opacity 280ms cubic-bezier(.4, 0, .2, 1), transform 340ms cubic-bezier(.4, 0, .2, 1) !important;
                    will-change: opacity, transform;
                }
                /* Showing: quicker, with a soft settle at the end. */
                .native-player-wrapper.controls-visible .player-control-dock {
                    transition: opacity 200ms ease-out, transform 380ms cubic-bezier(.16, 1, .3, 1) !important;
                }
                @keyframes mre-icon-swap {
                    from { opacity: 0; scale: .72; }
                    to { opacity: 1; scale: 1; }
                }
                /* Icons that change state (play/pause, fullscreen, PiP) pop in when swapped. */
                .native-player-wrapper .player-control-dock .player-control-button--primary svg,
                .native-player-wrapper .player-control-dock .pip-toggle-btn svg,
                .native-player-wrapper .player-control-dock .mre-fullscreen-button svg,
                .native-player-wrapper .player-center-action svg {
                    animation: mre-icon-swap 200ms cubic-bezier(.16, 1, .3, 1);
                }
                .native-player-wrapper .player-progress-track {
                    bottom: 62px !important;
                    left: 12px !important;
                    right: 12px !important;
                    height: 3px !important;
                    background-color: rgba(255, 255, 255, .2) !important;
                    border-radius: 999px !important;
                }
                .native-player-wrapper .player-progress-fill {
                    background-color: #f4f4f5 !important;
                    border-radius: 999px !important;
                    box-shadow: 0 0 14px rgba(255, 255, 255, .2);
                }
                .native-player-wrapper .player-progress-fill::after {
                    content: '';
                    position: absolute;
                    top: 50%;
                    right: -5px;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: #f4f4f5;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, .45);
                    opacity: 0;
                    transform: translateY(-50%) scale(.8);
                    transition: opacity 140ms ease, transform 140ms cubic-bezier(.23, 1, .32, 1);
                }
                .native-player-wrapper .player-progress-track:hover .player-progress-fill::after {
                    opacity: 1;
                    transform: translateY(-50%) scale(1);
                }
                .native-player-wrapper .player-controls-group {
                    gap: 6px !important;
                }
                .native-player-wrapper .player-control-dock .player-control-button {
                    width: 36px !important;
                    height: 36px !important;
                    display: grid !important;
                    place-items: center;
                    padding: 6px !important;
                    color: rgba(255, 255, 255, .82) !important;
                    background: transparent !important;
                    border: 1px solid transparent !important;
                    border-radius: 10px !important;
                    opacity: 1 !important;
                    transition: color 160ms ease, background-color 160ms ease,
                        border-color 160ms ease, transform 120ms cubic-bezier(.23, 1, .32, 1) !important;
                }
                .native-player-wrapper .player-control-dock .player-control-button--primary svg {
                    display: block;
                    transform: none;
                }
                .native-player-wrapper .player-control-dock .player-control-button--primary[data-icon="play"] svg {
                    /* M8 5v14l11-7z is optically right- and bottom-heavy. */
                    transform: translate(-1.5px, -0.5px);
                }
                .native-player-wrapper .player-control-dock .player-control-button--primary {
                    line-height: 0 !important;
                }
                /* Buttons have a fixed size; padding would shrink the content box below the glyph
                   (26px Play, 22px icons at the 32px mobile size) and push it off-center. */
                .native-player-wrapper .player-control-dock button.player-control-button {
                    padding: 0 !important;
                }
                .native-player-wrapper .player-control-dock .player-control-button:hover {
                    color: #fff !important;
                    background: rgba(255, 255, 255, .1) !important;
                    border-color: rgba(255, 255, 255, .1) !important;
                }
                .native-player-wrapper .player-control-dock .player-control-button:active {
                    transform: scale(.94);
                }
                .native-player-wrapper .player-control-dock .player-control-button svg {
                    width: 22px !important;
                    height: 22px !important;
                }
                .native-player-wrapper .player-control-dock .player-control-button--primary svg {
                    width: 26px !important;
                    height: 26px !important;
                }
                .native-player-wrapper .player-timecode {
                    margin-left: 2px;
                    color: rgba(255, 255, 255, .86) !important;
                    font: 500 12px/1.2 system-ui, sans-serif !important;
                    font-variant-numeric: tabular-nums;
                    letter-spacing: .01em;
                }
                .native-player-wrapper .popover-surface {
                    --popover-surface-bg: rgba(24, 24, 27, .94);
                    --popover-surface-border: rgba(255, 255, 255, .1);
                    --popover-surface-radius: 14px;
                    --popover-surface-shadow: 0 20px 50px rgba(0, 0, 0, .48);
                    --popover-surface-backdrop: blur(18px) saturate(130%);
                    background: var(--popover-surface-bg) !important;
                    border: 1px solid var(--popover-surface-border) !important;
                    border-radius: var(--popover-surface-radius) !important;
                    box-shadow: var(--popover-surface-shadow) !important;
                    backdrop-filter: var(--popover-surface-backdrop) !important;
                    -webkit-backdrop-filter: var(--popover-surface-backdrop) !important;
                }
                .native-player-wrapper .player-settings-menu {
                    box-sizing: border-box;
                    width: 268px;
                    min-width: 268px !important;
                    max-width: calc(100vw - 24px);
                    max-height: min(360px, calc(100vh - 110px), max(46px, calc(100% - 82px)));
                    padding: 6px !important;
                    overflow-x: hidden;
                    overflow-y: auto;
                    color: #f4f4f5;
                    color-scheme: dark;
                    font: 500 14px/1.3 system-ui, sans-serif !important;
                }
                .native-player-wrapper .player-settings-menu__item,
                .native-player-wrapper .player-settings-menu__back,
                .native-player-wrapper .player-settings-menu__option {
                    width: 100%;
                    min-width: 0;
                    appearance: none;
                    border: 0;
                    color: inherit;
                    font: inherit;
                    text-align: left;
                    cursor: pointer;
                }
                .native-player-wrapper .player-settings-menu__item {
                    min-height: 46px;
                    display: grid;
                    grid-template-columns: minmax(72px, auto) minmax(0, 1fr) 14px;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 10px;
                    background: transparent;
                    border-radius: 10px;
                    transition: background-color 160ms ease;
                }
                .native-player-wrapper .player-settings-menu__diagnostics {
                    margin-top: 6px;
                    border-top: 1px solid var(--ui-color-border, var(--popover-surface-border));
                    border-radius: 0;
                }
                .native-player-wrapper .player-settings-menu__item:hover,
                .native-player-wrapper .player-settings-menu__option:hover,
                .native-player-wrapper .player-settings-menu__back:hover {
                    background: rgba(255, 255, 255, .07) !important;
                }
                .native-player-wrapper .player-settings-menu__label {
                    color: #a1a1aa;
                }
                .native-player-wrapper .player-settings-menu__value {
                    min-width: 0;
                    overflow: hidden;
                    color: #f4f4f5;
                    font-weight: 600;
                    text-align: right;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .native-player-wrapper .player-settings-menu__chevron {
                    width: 14px;
                    height: 14px;
                    color: #71717a;
                }
                .native-player-wrapper .player-settings-menu__back {
                    min-height: 44px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 10px;
                    background: transparent;
                    border-bottom: 1px solid rgba(255, 255, 255, .08);
                    border-radius: 10px 10px 6px 6px;
                    font-weight: 650;
                }
                .native-player-wrapper .player-settings-menu__back svg {
                    width: 16px;
                    height: 16px;
                    color: #a1a1aa;
                }
                .native-player-wrapper .player-settings-menu__list {
                    max-height: 246px;
                    margin-top: 4px;
                    padding-right: 2px;
                    overflow-x: hidden;
                    overflow-y: auto;
                    overscroll-behavior: contain;
                    scrollbar-gutter: stable;
                    scrollbar-width: thin;
                    scrollbar-color: rgba(161, 161, 170, .48) transparent;
                }
                .native-player-wrapper .player-settings-menu__list::-webkit-scrollbar {
                    width: 6px;
                }
                .native-player-wrapper .player-settings-menu__list::-webkit-scrollbar-track {
                    margin-block: 5px;
                    background: transparent;
                }
                .native-player-wrapper .player-settings-menu__list::-webkit-scrollbar-button {
                    width: 0;
                    height: 0;
                    display: none;
                }
                .native-player-wrapper .player-settings-menu__list::-webkit-scrollbar-thumb {
                    background: rgba(161, 161, 170, .42);
                    border: 1px solid transparent;
                    border-radius: 999px;
                    background-clip: padding-box;
                }
                .native-player-wrapper .player-settings-menu__list::-webkit-scrollbar-thumb:hover {
                    background: rgba(212, 212, 216, .62);
                    background-clip: padding-box;
                }
                .native-player-wrapper .player-settings-menu__list::-webkit-scrollbar-corner {
                    background: transparent;
                }
                .native-player-wrapper .player-subtitle-appearance__body {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    max-height: 292px;
                    padding: 10px 8px 8px;
                    overflow-x: hidden;
                    overflow-y: auto;
                    overscroll-behavior: contain;
                    scrollbar-width: thin;
                    scrollbar-color: rgba(161, 161, 170, .48) transparent;
                }
                .native-player-wrapper .player-subtitle-appearance__body::-webkit-scrollbar {
                    width: 6px;
                }
                .native-player-wrapper .player-subtitle-appearance__body::-webkit-scrollbar-thumb {
                    background: rgba(161, 161, 170, .42);
                    border: 1px solid transparent;
                    border-radius: 999px;
                    background-clip: padding-box;
                }
                .native-player-wrapper .player-subtitle-appearance__preview {
                    min-height: 62px;
                    display: flex;
                    align-items: flex-end;
                    justify-content: center;
                    padding: 10px;
                    overflow: hidden;
                    background: linear-gradient(145deg, rgba(63, 63, 70, .9), rgba(9, 9, 11, .98));
                    border: 1px solid rgba(255, 255, 255, .1);
                    border-radius: 10px;
                }
                .native-player-wrapper .player-subtitle-appearance__preview[data-position="top"] {
                    align-items: flex-start;
                }
                .native-player-wrapper .player-subtitle-appearance__caption {
                    max-width: 100%;
                    padding: 3px 6px;
                    overflow-wrap: anywhere;
                    color: var(--player-subtitle-preview-color, #fff);
                    background: rgba(0, 0, 0, var(--player-subtitle-preview-bg, .45));
                    border-radius: 4px;
                    font-size: var(--player-subtitle-preview-size, 1em);
                    line-height: 1.2;
                    text-align: center;
                    text-shadow: var(--player-subtitle-preview-shadow, 0 2px 4px rgba(0, 0, 0, .96));
                }
                .native-player-wrapper .player-subtitle-appearance__control {
                    display: grid;
                    gap: 5px;
                }
                .native-player-wrapper .player-subtitle-appearance__control > label {
                    display: flex;
                    align-items: baseline;
                    justify-content: space-between;
                    gap: 8px;
                    color: #d4d4d8;
                    font-size: 12px;
                    font-weight: 600;
                }
                .native-player-wrapper .player-subtitle-appearance__control output {
                    color: #a1a1aa;
                    font-variant-numeric: tabular-nums;
                    font-weight: 500;
                }
                .native-player-wrapper .player-subtitle-appearance__control input[type="range"] {
                    width: 100%;
                    margin: 0;
                    accent-color: #f4f4f5;
                }
                .native-player-wrapper .player-subtitle-appearance__control input[type="color"],
                .native-player-wrapper .player-subtitle-appearance__control select {
                    box-sizing: border-box;
                    width: 100%;
                    min-height: 32px;
                    color: #f4f4f5;
                    color-scheme: dark;
                    background: rgba(39, 39, 42, .86);
                    border: 1px solid rgba(255, 255, 255, .12);
                    border-radius: 8px;
                }
                .native-player-wrapper .player-subtitle-appearance__control input[type="color"] {
                    padding: 2px;
                    cursor: pointer;
                }
                .native-player-wrapper .player-subtitle-appearance__control select {
                    padding: 0 8px;
                }
                .native-player-wrapper .player-subtitle-appearance__note {
                    color: #a1a1aa;
                    font-size: 11px;
                    line-height: 1.35;
                }
                .native-player-wrapper .player-subtitle-appearance__reset {
                    min-height: 34px;
                    padding: 7px 10px;
                    color: #d4d4d8;
                    background: rgba(255, 255, 255, .07);
                    border: 1px solid rgba(255, 255, 255, .1);
                    border-radius: 8px;
                    cursor: pointer;
                    font: 600 12px/1.2 system-ui, sans-serif;
                }
                .native-player-wrapper .player-subtitle-appearance__reset:hover {
                    color: #fff;
                    background: rgba(255, 255, 255, .12);
                }
                .native-player-wrapper .player-settings-menu__option {
                    min-height: 42px;
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) 22px;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 10px;
                    background: transparent;
                    border-radius: 9px;
                    transition: background-color 160ms ease;
                }
                .native-player-wrapper .player-settings-menu__option-label {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .native-player-wrapper .player-settings-menu__check {
                    width: 20px;
                    height: 20px;
                    display: grid;
                    place-items: center;
                    color: transparent;
                    background: transparent;
                    border: 1px solid transparent;
                    border-radius: 7px;
                    font-size: 12px;
                    font-weight: 800;
                }
                .native-player-wrapper .player-settings-menu__option.is-active {
                    color: #fafafa;
                    background: rgba(255, 255, 255, .075);
                }
                .native-player-wrapper .player-settings-menu__option.is-active .player-settings-menu__check {
                    color: #18181b;
                    background: #f4f4f5;
                    border-color: #f4f4f5;
                }
                .native-player-wrapper .player-volume-popover {
                    position: absolute; left: 50%; transform: translateX(-50%); height: 100px; padding: 12px 0;
                    flex-direction: column; align-items: center; justify-content: center; cursor: default; z-index: 2147483643;
                    bottom: 42px !important;
                    width: 38px !important;
                    --popover-surface-radius: 12px;
                    --popover-surface-shadow: 0 16px 36px rgba(0, 0, 0, .42);
                    --popover-surface-backdrop: blur(16px);
                }
                .native-player-wrapper { --mre-control-foreground: #f4f4f5; --mre-control-track: rgba(255,255,255,.2); }
                .native-player-wrapper .mre-volume-control { position: relative; display: flex; align-items: center; cursor: pointer; }
                .native-player-wrapper .mre-volume-button { background: none; border: none; cursor: pointer; color: var(--mre-control-foreground); padding: 5px; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; }
                .native-player-wrapper .mre-volume-track { width: 4px; height: 80px; background: var(--mre-control-track); border-radius: 2px; position: relative; cursor: pointer; }
                .native-player-wrapper .mre-volume-fill { position: absolute; bottom: 0; left: 0; width: 100%; background: var(--mre-control-foreground); border-radius: 2px; }
                .native-player-wrapper .mre-volume-knob { width: 12px; height: 12px; background: var(--mre-control-foreground); border-radius: 50%; position: absolute; top: 0; left: 50%; transform: translate(-50%, -50%); }
                @media (max-width: 600px) {
                    .native-player-wrapper .player-center-action {
                        width: 58px !important;
                        height: 58px !important;
                        border-radius: 17px !important;
                    }
                    .native-player-wrapper .player-control-dock {
                        left: 8px !important;
                        bottom: 8px !important;
                        width: calc(100% - 16px) !important;
                        padding: 5px 7px !important;
                        gap: 3px !important;
                    }
                    .native-player-wrapper .player-control-dock .player-control-button {
                        width: 32px !important;
                        height: 32px !important;
                        padding: 5px !important;
                    }
                    .native-player-wrapper .player-controls-group {
                        gap: 2px !important;
                    }
                    .native-player-wrapper .player-timecode {
                        font-size: 11px !important;
                    }
                    .native-player-wrapper .player-progress-track {
                        bottom: 54px !important;
                        left: 8px !important;
                        right: 8px !important;
                    }
                }
                @media (prefers-reduced-motion: reduce) {
                    .native-player-wrapper,
                    .native-player-wrapper *,
                    .native-player-wrapper *::before,
                    .native-player-wrapper *::after {
                        animation: none !important;
                        transition: none !important;
                        scroll-behavior: auto !important;
                    }
                    .native-player-wrapper .player-control-button:hover,
                    .native-player-wrapper .player-control-button:active {
                        transform: none !important;
                    }
                    .native-player-wrapper .player-center-action,
                    .native-player-wrapper .player-control-dock,
                    .native-player-wrapper .player-control-button,
                    .native-player-wrapper .player-progress-fill::after {
                        transition-duration: 0ms !important;
                    }
                }

                /* Ghost Player Tooltip */
                .ghost-tooltip {
                    display:         none;
                    position:        absolute;
                    z-index:         2147483642;
                    pointer-events:  none;
                    flex-direction:  column;
                    align-items:     center;
                    gap:             4px;
                    filter:          drop-shadow(0 4px 16px rgba(0,0,0,.7));
                    opacity:         0;
                    transform:       translateY(6px);
                    transition:      opacity .15s ease, transform .15s ease;
                }
                .ghost-tooltip--visible {
                    opacity:   1;
                    transform: translateY(0);
                }
                .native-player-wrapper .ghost-tooltip > .ghost-video {
                    position:      static;
                    inset:         auto;
                    flex:          none;
                    box-sizing:    border-box;
                    width:         200px;
                    height:        112px;
                    min-width:     200px;
                    min-height:    112px;
                    max-width:     none;
                    max-height:    none;
                    object-fit:    cover;
                    border-radius: 6px;
                    border:        1.5px solid rgba(255,255,255,.15);
                    background:    #111;
                    display:       block;
                }
                .native-player-wrapper .provider-native-episode-nav {
                    position: relative;
                    align-items: center;
                    justify-content: center;
                    padding: 5px;
                    color: #fafafa;
                    background: none;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: color .2s, background-color .2s;
                }

                .native-player-wrapper .provider-native-episode-nav:hover:not(:disabled) {
                    background: rgba(255, 255, 255, .12);
                }

                .native-player-wrapper .provider-native-episode-nav:disabled {
                    color: #8a8a93;
                    cursor: default;
                }

                .native-player-wrapper .provider-native-episode-nav__tooltip {
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translate(-50%, -10px);
                    padding: 4px 8px;
                    color: #fafafa;
                    font-size: 12px;
                    white-space: nowrap;
                    background: rgba(9, 9, 11, .88);
                    border-radius: 4px;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity .2s;
                }

                .native-player-wrapper .provider-native-episode-nav__tooltip:empty {
                    display: none;
                }

                .native-player-wrapper .provider-native-episode-nav:hover:not(:disabled) .provider-native-episode-nav__tooltip,
                .native-player-wrapper .provider-native-episode-nav:focus-visible .provider-native-episode-nav__tooltip {
                    opacity: 1;
                }

                .ghost-time-label {
                    font-size:      12px;
                    font-weight:    600;
                    color:          #fff;
                    background:     rgba(0,0,0,.65);
                    padding:        2px 8px;
                    border-radius:  4px;
                    letter-spacing: .03em;
                }
            `;
            document.head.appendChild(subParams);

            // Custom Bottom Controls
            const bottomControls = document.createElement('div');
            bottomControls.className = 'player-control-dock';
            bottomControls.style.position = 'absolute';
            bottomControls.style.bottom = '14px';
            bottomControls.style.left = '14px';
            bottomControls.style.width = 'calc(100% - 28px)';
            bottomControls.style.boxSizing = 'border-box'; // Fix overflow due to padding
            bottomControls.style.padding = '7px 10px';
            bottomControls.style.background = 'rgba(18, 18, 20, 0.76)';
            bottomControls.style.border = '1px solid rgba(255, 255, 255, 0.1)';
            bottomControls.style.borderRadius = '16px';
            bottomControls.style.boxShadow = '0 18px 48px rgba(0, 0, 0, 0.42), inset 0 1px rgba(255, 255, 255, 0.05)';
            bottomControls.style.backdropFilter = 'blur(18px) saturate(130%)';
            bottomControls.style.webkitBackdropFilter = 'blur(18px) saturate(130%)';
            bottomControls.style.display = 'flex';
            bottomControls.style.alignItems = 'center';
            bottomControls.style.gap = '8px';
            bottomControls.style.opacity = '0';
            bottomControls.style.transform = 'translateY(16px) scale(.985)';
            bottomControls.style.transition = 'opacity 280ms cubic-bezier(0.4, 0, 0.2, 1), transform 340ms cubic-bezier(0.4, 0, 0.2, 1)';
            bottomControls.style.zIndex = '2147483625'; 

            // --- PROGRESS BAR WITH THUMBNAIL PREVIEW START ---
            const progressContainer = document.createElement('div');
            progressContainer.className = 'player-progress-track';
            progressContainer.style.position = 'absolute';
            progressContainer.style.bottom = '62px';
            progressContainer.style.left = '12px';
            progressContainer.style.right = '12px';
            progressContainer.style.height = '3px';
            progressContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.18)';
            progressContainer.style.cursor = 'pointer';
            progressContainer.style.borderRadius = '999px';
            progressContainer.style.zIndex = '2147483640';
            // Increase hit area
            progressContainer.style.borderTop = '10px solid transparent';
            progressContainer.style.borderBottom = '10px solid transparent';
            progressContainer.style.backgroundClip = 'padding-box';
            progressContainer.style.boxSizing = 'content-box'; // FIX: Prevent height collapse on sites with border-box reset

            // Buffer Indicator Container
            const bufferContainer = document.createElement('div');
            bufferContainer.style.position = 'absolute';
            bufferContainer.style.top = '0';
            bufferContainer.style.left = '0';
            bufferContainer.style.width = '100%';
            bufferContainer.style.height = '100%';
            bufferContainer.style.borderRadius = '2px';
            bufferContainer.style.zIndex = '1'; // Behind progressFilled
            bufferContainer.style.pointerEvents = 'none';
            bufferContainer.className = 'native-buffer-container'; // ADDED CLASS for selection
            progressContainer.appendChild(bufferContainer);

            const progressFilled = document.createElement('div');
            progressFilled.style.height = '100%';
            progressFilled.style.width = '0%';
            progressFilled.style.backgroundColor = '#f4f4f5';
            progressFilled.style.borderRadius = '999px';
            progressFilled.style.position = 'relative';
            progressFilled.style.zIndex = '2'; // Above buffer
            progressFilled.className = 'native-progress-filled player-progress-fill';
            progressContainer.appendChild(progressFilled);

            // Progress Bar Logic
            const updateBuffer = () => {
                const currentVid = permanentVideo || video;
                if (!currentVid) return;

                const duration = currentVid.duration;
                if (!Number.isFinite(duration) || duration <= 0) return;

                const buffered = currentVid.buffered;
                
                // Clear existing segments
                bufferContainer.innerHTML = '';

                // Render segments
                // Render segments
                for (let i = 0; i < buffered.length; i++) {
                    let start = buffered.start(i);
                    const end = buffered.end(i);
                    
                    // Visual fix: If buffer starts slightly ahead of current time (< 2s),
                    // snap it to current time to avoid visual gap
                    if (start > currentVid.currentTime && (start - currentVid.currentTime) < 2) {
                        start = currentVid.currentTime;
                    }
                    
                    const widthPercent = ((end - start) / duration) * 100;
                    const leftPercent = (start / duration) * 100;

                    const segment = document.createElement('div');
                    segment.style.position = 'absolute';
                    segment.style.top = '0';
                    segment.style.left = `${leftPercent}%`;
                    segment.style.width = `${widthPercent}%`;
                    segment.style.height = '100%';
                    segment.style.backgroundColor = 'rgba(255, 255, 255, 0.4)'; // Gray/White transparent
                    segment.style.borderRadius = '2px';
                    bufferContainer.appendChild(segment);
                }
            };

            video.addEventListener('timeupdate', () => {
                const percent = (video.currentTime / video.duration) * 100;
                progressFilled.style.width = `${percent}%`;
            });
            
            video.addEventListener('progress', updateBuffer);
            video.addEventListener('timeupdate', updateBuffer); // Also update on time as buffer might change
            video.addEventListener('loadedmetadata', updateBuffer);

            // --- PERSISTENT PROGRESS START ---
            
            // Helper to scan for series data with robust wildcard selectors
            // Moved here to be accessible by progress logic
            const scanForSeriesData = () => {
                const data = {
                    seasons: [],
                    episodes: [],
                    hasSeries: false
                };

                // Phase 5B: Prioritize structured playback state (0 DOM scraping)
                if (structuredPlaybackState) {
                    data.hasSeries = true;
                    data.seasons = (structuredPlaybackState.seasons || []).map((s, index) => ({
                        label: s.name || `${s.seasonNumber} сезон`,
                        seasonNumber: s.seasonNumber,
                        isActive: s.seasonNumber === structuredPlaybackState.activeSeasonNumber,
                        url: s.url,
                        index
                    }));
                    data.episodes = (structuredPlaybackState.episodes || []).map((ep, index) => ({
                        label: ep.name || ep.title || `${ep.episodeNumber} серия`,
                        episodeNumber: ep.episodeNumber,
                        isActive: ep.episodeNumber === structuredPlaybackState.activeEpisodeNumber,
                        url: ep.url,
                        index
                    }));
                    return data;
                }

                // Fallback for third-party native players without structured bridge
                const listContainer = document.querySelector('div[class*="list_"]');
                if (!listContainer) return data;

                const dropdowns = listContainer.querySelectorAll('div[class*="dropdown_"]');
                
                dropdowns.forEach(dropdown => {
                    let headerText;
                    const headerSpan = dropdown.querySelector('span[class*="headText_"]');
                    if (headerSpan) {
                        headerText = headerSpan.textContent || '';
                    } else {
                        headerText = dropdown.textContent || ''; 
                    }
                    
                    const items = Array.from(dropdown.querySelectorAll('div[class*="item_"]'));
                    if (items.length === 0) return;

                    const listData = items.map((item, index) => ({
                        label: item.textContent.trim(),
                        isActive: item.className.includes('active') || item.classList.contains('active_1RhfH'),
                        element: item,
                        index: index
                    }));

                    const firstItemText = listData[0]?.label.toLowerCase() || '';
                    const lowerHeader = headerText.toLowerCase();
                    
                    if (firstItemText.includes('сезон') || lowerHeader.includes('сезон')) {
                        data.seasons = listData;
                    } else if (firstItemText.includes('серия') || lowerHeader.includes('серия')) {
                        data.episodes = listData;
                    }
                });

                if (data.seasons.length > 0 || data.episodes.length > 0) {
                    data.hasSeries = true;
                }

                return data;
            };

            const getActiveSeriesInfo = () => {
                if (structuredPlaybackState) {
                    return {
                        season: structuredPlaybackState.activeSeasonNumber ? `${structuredPlaybackState.activeSeasonNumber} сезон` : null,
                        episode: structuredPlaybackState.activeEpisodeNumber ? `${structuredPlaybackState.activeEpisodeNumber} серия` : null,
                        seasonNumber: structuredPlaybackState.activeSeasonNumber,
                        episodeNumber: structuredPlaybackState.activeEpisodeNumber
                    };
                }
                const data = scanForSeriesData();
                let season = null;
                let episode = null;

                if (data.seasons.length > 0) {
                     const activeS = data.seasons.find(s => s.isActive);
                     if (activeS) season = activeS.label;
                }
                
                if (data.episodes.length > 0) {
                     const activeE = data.episodes.find(e => e.isActive);
                     if (activeE) episode = activeE.label;
                }
                
                return { season, episode };
            };

            // Inside provider frames the embed path identifies the title. On the
            // extension page every title shares movie-details.html, so the key
            // uses the movie MovieDetails stamps on <html>; without it there is
            // no safe key. Videos whose position the canonical ProgressService
            // restores (Seasonvar) opt out so they are not seeked twice.
            const isExtensionPage = window.location.protocol === 'chrome-extension:'
                || document.documentElement?.dataset?.playerProgressScope !== undefined;
            const readProgressScope = () => (isExtensionPage
                ? String(document.documentElement?.dataset?.playerProgressScope || '')
                : window.location.pathname);
            const progressScope = readProgressScope();
            const localProgressEnabled = Boolean(progressScope)
                && video.dataset?.progressOwner !== 'canonical';
            const isProgressScopeCurrent = () => localProgressEnabled && readProgressScope() === progressScope;

            const getProgressKey = () => {
                let key = 'movieExtension_progress_' + progressScope.replace(/\W/g, '_');
                const info = getActiveSeriesInfo();
                if (info.season) key += '_' + info.season.replace(/\s+/g, '');
                if (info.episode) key += '_' + info.episode.replace(/\s+/g, '');
                return key;
            };
            
            const saveProgress = () => {
                if (!isProgressScopeCurrent()) return;
                if (video.currentTime > 5 && video.duration > 0) {
                    const key = getProgressKey();
                    // Don't save if near the end (e.g. < 30s remaining) to avoid stuck at credits
                    if (video.duration - video.currentTime > 30) {
                        localStorage.setItem(key, video.currentTime);
                    } else {
                        localStorage.removeItem(key); 
                    }
                }
            };

            const restoreProgress = () => {
                if (!isProgressScopeCurrent()) return;
                const key = getProgressKey();
                const savedTime = parseFloat(localStorage.getItem(key));
                // console.log('[MovieExtension] Restoring progress for key:', key, 'Time:', savedTime);
                if (savedTime && !isNaN(savedTime) && video.duration) {
                    // Sanity check
                    if (savedTime < video.duration - 5) {
                        // Restore with -10 seconds rewind for context
                        video.currentTime = Math.max(0, savedTime - 10);
                    }
                }
            };

            if (localProgressEnabled) {
                // Save periodically
                const progressInterval = setInterval(saveProgress, 5000);
                listenerScope.addDisposer(() => clearInterval(progressInterval));
                video.addEventListener('pause', saveProgress);
                listenerScope.listen(window, 'beforeunload', saveProgress);

                // Restore
                video.addEventListener('loadedmetadata', restoreProgress);
                // Try immediately if ready
                if (video.readyState >= 1) restoreProgress();

                video.addEventListener('ended', () => {
                    if (isProgressScopeCurrent()) localStorage.removeItem(getProgressKey());
                });
            }
            // --- PERSISTENT PROGRESS END ---

            progressContainer.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                const rect = progressContainer.getBoundingClientRect();
                const percent = window.PlayerMediaControls.Timeline.ratio(e.clientX, rect);
                if (percent === null) return;
                
                // Use current video
                const currentVid = permanentVideo || video;
                
                console.log('[MovieExtension] Progress click. Percent:', percent, 'Duration:', currentVid.duration);

                if (Number.isFinite(currentVid.duration) && currentVid.duration > 0) {
                     const newTime = currentVid.duration * percent;
                     
                     // Update progress bar IMMEDIATELY (visual feedback)
                     progressFilled.style.width = `${percent * 100}%`;
                     
                     currentVid.currentTime = newTime;
                     console.log('[MovieExtension] Seeked to:', newTime);
                     
                     // Update time display immediately (don't wait for timeupdate event)
                     if (timeDisplay) {
                         timeDisplay.textContent = `${formatTime(newTime)} / ${formatTime(currentVid.duration)}`;
                     }
                } else {
                    console.warn('[MovieExtension] Cannot seek - invalid duration:', currentVid.duration);
                }
            });

            // Hover preview and target time are owned by GhostPlayer below.
            // Keep one tooltip source for this progress track to avoid duplicate times.
            // --- PROGRESS BAR END ---

            bottomControls.appendChild(progressContainer);
            
            // Loader
            const loader = document.createElement('div');
            loader.innerHTML = `
                <svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="25" cy="25" r="20" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-dasharray="80 200">
                        <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/>
                    </circle>
                </svg>
            `;
            loader.style.position = 'absolute';
            loader.style.top = '50%';
            loader.style.left = '50%';
            loader.style.transform = 'translate(-50%, -50%)';
            loader.style.zIndex = '2147483647';
            loader.style.pointerEvents = 'none';
            loader.style.display = 'none'; 
            controlsOverlay.appendChild(loader);

            // Visibility Logic
            let isHovering = false;
            let isLoading = false;
            let loaderDelayId = null;
            let isUserInactive = false;
            let inactivityTimeout;
            
            const updateVisibility = () => {
                const currentVid = permanentVideo || video;
                const shouldShow = (isHovering && !isUserInactive) || (currentVid ? currentVid.paused : true);
                const opacity = shouldShow ? '1' : '0';
                
                // Hide cursor when controls are hidden (and inactive)
                newContainer.style.cursor = shouldShow ? 'default' : 'none';
                
                // Update bottom controls
                bottomControls.style.opacity = opacity;
                bottomControls.style.transform = shouldShow ? 'translateY(0) scale(1)' : 'translateY(16px) scale(.985)';
                bottomControls.style.pointerEvents = shouldShow ? 'auto' : 'none';
                
                // Toggle class for CSS-based subtitle movement
                if (shouldShow) {
                    newContainer.classList.add('controls-visible');
                } else {
                    newContainer.classList.remove('controls-visible');
                }
                updateActiveSubtitleAppearance();
                
                // Update center button visibility
                // Hide center button if loading
                centerPlayBtn.style.opacity = (shouldShow && !isLoading) ? opacity : '0';
                centerPlayBtn.style.scale = (shouldShow && !isLoading) ? '1' : '0.9';

                // Also update top-left selector if needed (wrapper)
                const voiceoverSelect = newContainer.querySelector('#nativeVoiceoverSelect')?.parentElement;
                if (voiceoverSelect) {
                    voiceoverSelect.style.opacity = opacity;
                    voiceoverSelect.style.transition = 'opacity 0.3s';
                }
            };

            const showLoader = () => {
                isLoading = true;
                // Media can emit a short `waiting` event while still playing.
                // Delay the indicator to avoid a distracting flash on every seek.
                if (loaderDelayId === null) {
                    loaderDelayId = setTimeout(() => {
                        if (isLoading) loader.style.display = 'block';
                        loaderDelayId = null;
                    }, 150);
                }
                // Force update visibility to hide play button immediately
                updateVisibility();
            };

            const hideLoader = () => {
                isLoading = false;
                if (loaderDelayId !== null) {
                    clearTimeout(loaderDelayId);
                    loaderDelayId = null;
                }
                loader.style.display = 'none';
                updateVisibility();
            };

            // Loading Events
            // Handled in setupVideoListeners now
            /*
            video.addEventListener('waiting', showLoader);
            video.addEventListener('seeking', showLoader);
            
            video.addEventListener('playing', hideLoader);
            video.addEventListener('seeked', hideLoader);
            video.addEventListener('canplay', hideLoader);
            video.addEventListener('canplaythrough', hideLoader);
            
            video.addEventListener('playing', hideLoader);
            video.addEventListener('canplay', hideLoader);
            video.addEventListener('pause', hideLoader);
            video.addEventListener('error', hideLoader);
            */

            newContainer.addEventListener('mouseenter', () => {
                isHovering = true;
                isUserInactive = false;
                updateVisibility();
                resetInactivityTimer();
            });
            
            newContainer.addEventListener('mouseleave', () => {
                isHovering = false;
                updateVisibility();
                clearTimeout(inactivityTimeout);
            });

            // Activity / Inactivity Logic
            const resetInactivityTimer = () => {
                clearTimeout(inactivityTimeout);
                isUserInactive = false;
                updateVisibility(); // Show immediately on movement
                
                const currentVid = permanentVideo || video;
                
                if (isHovering && currentVid && !currentVid.paused) {
                    inactivityTimeout = setTimeout(() => {
                        isUserInactive = true;
                        updateVisibility();
                    }, 3000);
                }
            };
            
            newContainer.addEventListener('mousemove', resetInactivityTimer);
            newContainer.addEventListener('click', resetInactivityTimer);
            // Call updateVisibility immediately so controls are visible on initial load when paused
            updateVisibility();

            // Play/Pause Button
            const playPauseBtn = document.createElement('button');
            playPauseBtn.className = 'player-control-button player-control-button--primary';
            playPauseBtn.style.background = 'none';
            playPauseBtn.style.border = 'none';
            playPauseBtn.style.cursor = 'pointer';
            playPauseBtn.style.color = 'white';
            playPauseBtn.style.padding = '5px';
            
            const updatePlayBtnIcon = () => {
                // Use current video always
                const currentVid = permanentVideo || video;
                playPauseBtn.dataset.icon = currentVid.paused ? 'play' : 'pause';
                centerPlayBtn.dataset.icon = currentVid.paused ? 'play' : 'pause';
                
                if (currentVid.paused) {
                    // Bottom Btn: Play
                    playPauseBtn.innerHTML = PLAYER_ICONS.play(32);
                    // Center Btn: Play (Large)
                    centerPlayBtn.innerHTML = PLAYER_ICONS.play(48);
                } else {
                    // Bottom Btn: Pause
                    playPauseBtn.innerHTML = PLAYER_ICONS.pause(32);
                    // Center Btn: Pause (Large)
                    centerPlayBtn.innerHTML = PLAYER_ICONS.pause(48);
                }
            };
            
            updatePlayBtnIcon();
            playPauseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentVid = permanentVideo || video;
                if (currentVid) currentVid.focus(); // Fix focus
                console.log('[MovieExtension] Play/Pause clicked. Current state:', currentVid.paused ? 'paused' : 'playing');
                if (currentVid.paused) {
                     currentVid.play().catch(err => console.error('[MovieExtension] Play error:', err));
                } else {
                     currentVid.pause();
                }
            });

            // --- SERIES / SEASON SELECTORS START ---




            // --- Watched Episodes Persistence ---
            const getWatchedKey = () => `movieExtension_watched_${window.location.pathname}`;
            
            const getWatchedEpisodes = () => {
                try {
                    const key = getWatchedKey();
                    return JSON.parse(localStorage.getItem(key) || '[]');
                } catch { return []; }
            };

            const markEpisodeAsWatched = (label) => {
                try {
                    const key = getWatchedKey();
                    const watched = getWatchedEpisodes();
                    if (!watched.includes(label)) {
                        watched.push(label);
                        localStorage.setItem(key, JSON.stringify(watched));
                    }
                } catch {
                    // Ignore error
                }
            };

            const createEpisodeNavigationState = (items, seasons, placeholder, onSelect) => {
                let activeItem = items.find(i => i.isActive) || items[0];
                let activeIndex = items.indexOf(activeItem);
                if (activeItem) markEpisodeAsWatched(activeItem.label);

                // --- PROGRESS UPDATE HELPER (Structured Phase 5B) ---
                const sendProgressUpdate = (episodeLabel, previousTimestamp) => {
                    try {
                        const parsedEpisodeNumber = episodeLabel
                            ? parseInt(String(episodeLabel).replace(/\D+/g, ''), 10)
                            : null;
                        const seasonNum = structuredPlaybackState?.activeSeasonNumber ?? null;
                        const epNum = Number.isFinite(parsedEpisodeNumber) && parsedEpisodeNumber > 0
                            ? parsedEpisodeNumber
                            : (structuredPlaybackState?.activeEpisodeNumber ?? null);
                        const currentSeasonLabel = seasonNum ? `${seasonNum} сезон` : '';
                        const epLabel = episodeLabel || (epNum ? `${epNum} серия` : '');
                        
                        const ts = (typeof previousTimestamp === 'number' && previousTimestamp > 0) 
                            ? Math.floor(previousTimestamp) 
                            : 0;
                        
                        console.log('[MovieExtension] Sending progress update:', currentSeasonLabel, epLabel, 'timestamp:', ts);
                        
                        postToHost({
                            type: 'UPDATE_WATCHING_PROGRESS',
                            season: currentSeasonLabel,
                            seasonNumber: seasonNum,
                            episode: epLabel,
                            episodeNumber: epNum,
                            timestamp: ts,
                            origin: 'USER_PROVIDER_SELECTION'
                        });
                        
                        postToHost({
                            type: 'EPISODE_CHANGED',
                            episode: epNum || 1,
                            episodeLabel: epLabel,
                            season: currentSeasonLabel,
                            seasonNumber: seasonNum,
                            origin: 'USER_PROVIDER_SELECTION'
                        });
                        
                        animeSkipData = null;
                        if (skipButton) {
                            skipButton.style.display = 'none';
                            skipButtonVisible = false;
                        }
                    } catch (err) {
                        console.error('[MovieExtension] Failed to send progress update:', err);
                    }
                };

                const returnedInterface = {
                    updateItems: (newItems) => {
                        items = newItems;
                        activeItem = items.find(i => i.isActive) || items[0];
                        activeIndex = items.indexOf(activeItem);
                    },
                    updateSeasons: (newSeasons) => {
                        seasons = newSeasons;
                    },
                    setVideoActive: (label) => {
                        const idx = items.findIndex(i => i.label === label);
                        if (idx !== -1) {
                            items.forEach(i => i.isActive = false);
                            items[idx].isActive = true;
                            activeIndex = idx;
                            activeItem = items[idx];
                            if (typeof callbacks.triggerUpdate === 'function') {
                                callbacks.triggerUpdate();
                            }
                        }
                    },
                    getNavState: () => {
                        return {
                            hasPrev: activeIndex > 0,
                            hasNext: activeIndex < items.length - 1,
                            prevItem: activeIndex > 0 ? items[activeIndex - 1] : null,
                            nextItem: activeIndex < items.length - 1 ? items[activeIndex + 1] : null,
                            currentItem: activeItem
                        };
                    },
                    navigate: (direction) => {
                        if (canonicalPickerRequested && window.parent && window.parent !== window) {
                            postToHost({
                                type: 'PLAYER_EPISODE_NAVIGATE',
                                direction: direction < 0 ? 'previous' : 'next'
                            });
                            return true;
                        }
                        const newIndex = activeIndex + direction;
                        if (newIndex >= 0 && newIndex < items.length) {
                            const targetItem = items[newIndex];
                            markEpisodeAsWatched(targetItem.label);
                            items.forEach(i => i.isActive = false);
                            targetItem.isActive = true;
                            activeIndex = newIndex;
                            activeItem = targetItem;
                            sendProgressUpdate(targetItem.label);
                            if (onSelect) onSelect(targetItem);
                            return true;
                        }
                        return false;
                    },
                    toggle: () => {},
                    // Self-reference placeholder
                    triggerUpdate: null
                };
                return returnedInterface;
            };

            // Helper for triggerUpdate
            const callbacks = { triggerUpdate: null }; // Shared object to simulate container.triggerUpdate

            const seriesData = scanForSeriesData();

            // Top Controls Bar
            let topControls = controlsOverlay.querySelector('.top-controls-bar');
            if (!topControls) {
                topControls = document.createElement('div');
                topControls.style.position = 'absolute';
                topControls.style.top = '20px';
                topControls.style.left = '20px';
                topControls.style.display = 'flex';
                topControls.style.gap = '10px';
                topControls.style.zIndex = '2147483625';
                topControls.style.pointerEvents = 'auto'; // Enable clicks
                topControls.className = 'top-controls-bar';
                controlsOverlay.appendChild(topControls);
            }

            /* 
            // Bottom Controls Bar (Already exists in scope)
            let bottomControls = controlsOverlay.querySelector('.bottom-controls-bar');
            if (!bottomControls) { ... }
            */

            if (seriesData.hasSeries) {
                // Episode Selector
                if (seriesData.episodes.length > 0) {
                    episodeDropdown = createEpisodeNavigationState(seriesData.episodes, seriesData.seasons || [], pt('episode', 'Серия'), (selectedItem) => {

                         if (selectedItem.element) {
                             selectedItem.element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
                         }
                         // navigate() calls onSelect.
                         // If we use navigate(), we update UI.
                         // If user clicks item manually, onSelect is called.
                         
                         // We need to ensure updateNavButtons is called.
                         // We will rely on the monkey-patch we added later:
                         // if (episodeDropdown) { ... episodeDropdown.updateItems = ... }
                         
                         // Wait, if I click manually, onSelect runs.
                         // Does generic `navigate` run? No.
                         // So we need to call updateNavButtons.
                         
                         // Since updateNavButtons is not yet defined, we can defer it or call it via a property we set later.
                         if (episodeDropdown && typeof episodeDropdown.triggerUpdate === 'function') {
                             episodeDropdown.triggerUpdate();
                         }
                    });
                    
                    // Expose updateActive method to sync with video changes (Stub or mapped to existing if needed)
                    // episodeDropdown.updateActive = ... (REMOVED: handled via setVideoActive in interface)
                    
                    // DO NOT append episodeDropdown to topControls as it is an interface object now
                    // topControls.appendChild(episodeDropdown);
                    
                    // Listen for episode restoration from SeasonvarParser
                    listenerScope.listen(document, 'episodeRestored', (e) => {
                        const { label } = e.detail || {};
                        console.log('[MovieExtension] episodeRestored event received:', label);
                        if (label && episodeDropdown && typeof episodeDropdown.setVideoActive === 'function') {
                            episodeDropdown.setVideoActive(label);
                            // Also trigger nav button update
                            if (typeof episodeDropdown.triggerUpdate === 'function') {
                                episodeDropdown.triggerUpdate();
                            }
                        }
                    });
                }
            }

            // Time Display
            const timeDisplay = document.createElement('span');
            timeDisplay.className = 'player-timecode';
            timeDisplay.style.color = 'white';
            timeDisplay.style.fontFamily = 'Arial, sans-serif';
            timeDisplay.style.fontSize = '14px';
            timeDisplay.textContent = '0:00 / 0:00';
            // Hidden until the media reports a duration, so a loading source
            // does not look like an empty 0:00 video.
            timeDisplay.style.visibility = 'hidden';
            timeDisplay.style.zIndex = '2'; // Ensure visibility
            timeDisplay.style.position = 'relative';

            const formatTime = window.PlayerMediaControls.Timeline.formatTime;
            // --- Auto-Play Logic ---
            const checkAutoPlay = () => {
                const autoPlayFlag = localStorage.getItem('movieExtension_autoplay_next');
                if (autoPlayFlag === 'true') {
                    localStorage.removeItem('movieExtension_autoplay_next');
                    localStorage.removeItem('movieExtension_autoplay_start_time');
                    
                    playAdoptedVideo(video);
                }
            };
            // Check immediately on new player init
            checkAutoPlay();

            const updateTime = () => {
                const current = video.currentTime || 0;
                const total = video.duration || 0;
                timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
                if (Number.isFinite(total) && total > 0) timeDisplay.style.visibility = 'visible';
            };

            // Video Events
            video.addEventListener('play', () => {
                updatePlayBtnIcon();
                updateVisibility();
            });
            video.addEventListener('ended', () => {
                // Clear saved progress for this video
                const key = getSavedKey(); // Assuming getSavedKey() is defined elsewhere
                localStorage.removeItem(key);
                
                // Set flag for auto-playing the next video
                localStorage.setItem('movieExtension_autoplay_next', 'true');
                localStorage.setItem('movieExtension_autoplay_start_time', Date.now().toString());
            });
            video.addEventListener('pause', () => {
                updatePlayBtnIcon();
                updateVisibility();
            });
            video.addEventListener('timeupdate', updateTime);
            video.addEventListener('loadedmetadata', updateTime);

            // Track progress for movies (send timestamp to parent)
            let lastProgressUpdate = 0;
            const PROGRESS_UPDATE_INTERVAL = 30000; // 30 seconds
            
            video.addEventListener('timeupdate', () => {
                const now = Date.now();
                if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
                    lastProgressUpdate = now;
                    
                    const timestamp = Math.floor(video.currentTime);
                    const info = getActiveSeriesInfo();
                    
                    // Send progress to parent window
                    if (window.parent && video.currentTime > 0 && !isNaN(video.duration)) {
                        const progressData = {
                            type: 'UPDATE_WATCHING_PROGRESS',
                            timestamp: timestamp,
                            season: info.season,
                            episode: info.episode
                        };
                        
                        postToHost(progressData);
                    }
                }
            });

            // Left Controls Group
            const leftControls = document.createElement('div');
            leftControls.className = 'player-controls-group player-controls-group--left';
            leftControls.style.display = 'flex';
            leftControls.style.alignItems = 'center';
            leftControls.style.gap = '10px'; // Slightly reduced gap for tighter controls
            leftControls.appendChild(playPauseBtn);

            // --- Navigation Buttons (Prev/Next) ---
            let updateNavButtons = () => {}; // Default no-op
            
            // Provision the arrows even when the first provider DOM scan is
            // empty. Ex-FS/KinoGo can enable canonical picker mode after this
            // player has initialized, so waiting for seriesData.hasSeries
            // would permanently lose the bottom navigation controls.
            {
                const prevEpisodeBtn = document.createElement('button');
                const nextEpisodeBtn = document.createElement('button');
                
                // Common styles
                // Visuals live in the injected cleaner stylesheet; only
                // display stays inline because picker visibility owns it.
                [prevEpisodeBtn, nextEpisodeBtn].forEach(btn => {
                    btn.type = 'button';
                    btn.classList.add('provider-native-episode-nav');
                    btn.style.display = 'flex';
                });
                prevEpisodeBtn.dataset.playerEpisodeAction = 'previous';
                prevEpisodeBtn.setAttribute('aria-label', pt('previous_episode', 'Предыдущая серия'));
                nextEpisodeBtn.dataset.playerEpisodeAction = 'next';
                nextEpisodeBtn.setAttribute('aria-label', pt('next_episode', 'Следующая серия'));
                [prevEpisodeBtn, nextEpisodeBtn].forEach(btn => {
                    btn.dataset.canonicalPickerOnly = seriesData.hasSeries ? 'false' : 'true';
                    if (!seriesData.hasSeries) btn.style.display = 'none';
                });
    
                // Icons
                prevEpisodeBtn.innerHTML = PLAYER_ICONS.prev;
                nextEpisodeBtn.innerHTML = PLAYER_ICONS.next;
    
                // Tooltips
                const createTooltip = (text) => {
                    const el = document.createElement('div');
                    el.className = 'provider-native-episode-nav__tooltip';
                    el.setAttribute('aria-hidden', 'true');
                    el.textContent = text;
                    return el;
                };
    
                const prevTooltip = createTooltip('');
                const nextTooltip = createTooltip('');
                prevEpisodeBtn.appendChild(prevTooltip);
                nextEpisodeBtn.appendChild(nextTooltip);
    
    
                // Logic to update buttons
                updateNavButtons = () => {
                    if (canonicalPickerRequested || isHostEpisodeNavigation()) {
                        prevEpisodeBtn.style.display = 'flex';
                        nextEpisodeBtn.style.display = 'flex';
                        // In canonical mode the host owns the episode list and
                        // boundary checks. Never disable these request controls
                        // from a stale provider-local dropdown snapshot.
                        [prevEpisodeBtn, nextEpisodeBtn].forEach(button => {
                            button.disabled = false;
                        });
                        prevTooltip.textContent = pt('previous_episode', 'Предыдущая серия');
                        nextTooltip.textContent = pt('next_episode', 'Следующая серия');
                        return;
                    }
                    // Standalone provider mode can use its own episode list.
                    if (episodeDropdown && typeof episodeDropdown.getNavState === 'function') {
                        const state = episodeDropdown.getNavState();
                        
                        // Prev Button State
                        if (state.hasPrev) {
                            prevEpisodeBtn.disabled = false;
                            prevTooltip.textContent = pt('back', `Назад: ${state.prevItem.label}`, { title: state.prevItem.label });
                        } else {
                            prevEpisodeBtn.disabled = true;
                            prevTooltip.textContent = '';
                        }
    
                        // Next Button State
                        if (state.hasNext) {
                            nextEpisodeBtn.disabled = false;
                            nextTooltip.textContent = pt('forward', `Вперед: ${state.nextItem.label}`, { title: state.nextItem.label });
                        } else {
                            nextEpisodeBtn.disabled = true;
                            nextTooltip.textContent = '';
                        }
                    }
                };
    
                // Actions
                prevEpisodeBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (usesHostEpisodeNavigation()) {
                        postToHost({
                            type: 'PLAYER_EPISODE_NAVIGATE',
                            direction: 'previous'
                        });
                        return;
                    }
                    if (permanentVideo) permanentVideo.focus(); // Fix focus
                    if (episodeDropdown && typeof episodeDropdown.navigate === 'function') {
                        episodeDropdown.navigate(-1);
                        updateNavButtons();
                    }
                };
                nextEpisodeBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (usesHostEpisodeNavigation()) {
                        postToHost({
                            type: 'PLAYER_EPISODE_NAVIGATE',
                            direction: 'next'
                        });
                        return;
                    }
                    if (permanentVideo) permanentVideo.focus(); // Fix focus
                     if (episodeDropdown && typeof episodeDropdown.navigate === 'function') {
                        episodeDropdown.navigate(1);
                        updateNavButtons();
                    }
                };
    
                leftControls.appendChild(prevEpisodeBtn);
                leftControls.appendChild(nextEpisodeBtn);
                applyCanonicalPickerVisibility();
                
                // Initial check
                setTimeout(updateNavButtons, 500); // Wait for episodeDropdown to potentially init
            } // End if (seriesData.hasSeries)

            if (episodeDropdown) {
                // Patch the navigate/update methods or add a listener
                const originalUpdate = episodeDropdown.updateItems;
                episodeDropdown.updateItems = (newItems) => {
                    if (originalUpdate) originalUpdate(newItems);
                    updateNavButtons();
                };
                
                // Allow callback to trigger update
                episodeDropdown.triggerUpdate = updateNavButtons;
                callbacks.triggerUpdate = updateNavButtons;
                
                // Let's also attach this function to the container so we can call it from outside if needed
                leftControls.updateNavButtons = updateNavButtons;
            }

            // --- KINOGO NATIVE SEASON/EPISODE BRIDGE ---
            const applyKinogoProviderSelection = async (
                targetSeason,
                targetEpisode,
                isCurrentOperation = () => true
            ) => {
                const seasonNumber = Number(targetSeason);
                const episodeNumber = Number(targetEpisode);
                if (!Number.isInteger(seasonNumber) || seasonNumber < 1
                    || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
                    console.warn('[KinoGoBridgeTrace] invalid selection', {
                        targetSeason,
                        targetEpisode,
                        seasonNumber,
                        episodeNumber
                    });
                    return false;
                }
                const itemSelector = (number) =>
                    `.select__drop-item[data-id="${Number(number)}"]`;
                const getSelect = type => document.querySelector(`[data-select="${type}"]`);
                const getItem = (root, number) => root?.querySelector?.(itemSelector(number)) || null;
                const getActiveId = root => root?.querySelector?.('.select__drop-item.active')?.getAttribute('data-id') || null;
                const describeItems = root => Array.from(root?.querySelectorAll?.('.select__drop-item') || [])
                    .map(item => ({
                        id: item.getAttribute('data-id'),
                        label: String(item.textContent || '').trim(),
                        active: item.classList.contains('active')
                    }));

                const waitFor = async (predicate, attempts = 20, delayMs = 150) => {
                    for (let attempt = 0; attempt < attempts; attempt += 1) {
                        if (!isCurrentOperation()) return null;
                        const value = predicate();
                        if (value) return value;
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                    }
                    return null;
                };

                const seasonSelect = getSelect('seasonType1');
                const episodeSelect = getSelect('episodeType1');
                console.info('[KinoGoBridgeTrace] selection scan', {
                    seasonNumber,
                    episodeNumber,
                    hasSeasonSelect: Boolean(seasonSelect),
                    hasEpisodeSelect: Boolean(episodeSelect),
                    currentSeason: getActiveId(seasonSelect),
                    currentEpisode: getActiveId(episodeSelect),
                    seasonItems: describeItems(seasonSelect),
                    episodeItems: describeItems(episodeSelect)
                });
                if (!seasonSelect || !episodeSelect) return false;

                let seasonItem = getItem(seasonSelect, seasonNumber);
                if (!seasonItem) {
                    console.warn('[KinoGoBridgeTrace] season item not found', {
                        seasonNumber,
                        available: describeItems(seasonSelect)
                    });
                    return false;
                }

                const seasonChanged = Number(getActiveId(seasonSelect)) !== seasonNumber;
                if (seasonChanged) {
                    if (!isCurrentOperation()) return false;
                    seasonItem.click();
                    console.info('[KinoGoBridgeTrace] season item clicked', {
                        seasonNumber,
                        label: String(seasonItem.textContent || '').trim()
                    });

                    const seasonApplied = await waitFor(
                        () => Number(getActiveId(getSelect('seasonType1'))) === seasonNumber,
                        20,
                        100
                    );
                    if (!seasonApplied) {
                        console.warn('[KinoGoBridgeTrace] season selection not confirmed', {
                            seasonNumber,
                            activeSeason: getActiveId(getSelect('seasonType1')),
                            seasonItems: describeItems(getSelect('seasonType1'))
                        });
                        return false;
                    }
                }

                // KinoGo rebuilds the episode menu after a season click. Poll
                // for the exact data-id instead of reusing the old episode list.
                const episodeItem = await waitFor(() => {
                    const currentEpisodeSelect = getSelect('episodeType1');
                    return getItem(currentEpisodeSelect, episodeNumber);
                }, 24, 150);
                if (episodeItem) {
                    if (!isCurrentOperation()) return false;
                    episodeItem.click();
                    console.info('[KinoGoBridgeTrace] episode item clicked', {
                        seasonNumber,
                        episodeNumber,
                        label: String(episodeItem.textContent || '').trim(),
                        seasonChanged
                    });

                    const episodeApplied = await waitFor(
                        () => Number(getActiveId(getSelect('episodeType1'))) === episodeNumber,
                        20,
                        100
                    );
                    console.info('[KinoGoBridgeTrace] selection confirmation', {
                        seasonNumber,
                        episodeNumber,
                        activeSeason: getActiveId(getSelect('seasonType1')),
                        activeEpisode: getActiveId(getSelect('episodeType1')),
                        confirmed: Boolean(episodeApplied)
                    });
                    return Boolean(episodeApplied)
                        && Number(getActiveId(getSelect('seasonType1'))) === seasonNumber;
                }

                console.warn('[KinoGoBridgeTrace] episode item not found after season update', {
                    seasonNumber,
                    episodeNumber,
                    episodeItems: describeItems(document.querySelector('[data-select="episodeType1"]'))
                });
                return false;
            };

            // --- RESTORE PROGRESS IMPLEMENTATION ---
            const applyNativeProviderSelection = async (
                targetSeason,
                targetEpisode,
                isCurrentOperation = () => true
            ) => {
                const listContainer = document.querySelector('div[class*="controls_"] div[class*="list_"]')
                    || document.querySelector('div[class*="list_"]');
                const getDropdowns = () => Array.from(
                    listContainer?.querySelectorAll?.('div[class*="dropdown_"]') || []
                );
                const getItems = dropdown => Array.from(
                    dropdown?.querySelectorAll?.('div[class*="item_"]') || []
                );
                const isActiveItem = item => Boolean(
                    item?.classList?.contains('active')
                    || String(item?.className || '').includes('active_')
                    || item?.getAttribute?.('aria-selected') === 'true'
                );
                const numberFromLabel = value => {
                    const match = String(value || '').match(/\d+/);
                    return match ? Number(match[0]) : null;
                };
                const clickExactItem = (dropdown, number, suffix) => {
                    if (!isCurrentOperation()) return null;
                    const items = getItems(dropdown);
                    const item = items.find(candidate =>
                        numberFromLabel(candidate.textContent) === Number(number)
                        && String(candidate.textContent || '').toLowerCase().includes(suffix)
                    );
                    console.info('[ExFsBridgeTrace] cleaner dropdown lookup', {
                        targetNumber: Number(number),
                        suffix,
                        itemCount: items.length,
                        itemLabels: items.map(candidate => String(candidate.textContent || '').trim()).slice(0, 20),
                        matchedLabel: item ? String(item.textContent || '').trim() : null
                    });
                    if (!item) return null;
                    item.click();
                    console.info('[ExFsBridgeTrace] cleaner provider item clicked', {
                        targetNumber: Number(number),
                        suffix,
                        label: String(item.textContent || '').trim()
                    });
                    return item;
                };
                const waitFor = async (predicate, attempts = 24, delayMs = 150) => {
                    for (let attempt = 0; attempt < attempts; attempt += 1) {
                        if (!isCurrentOperation()) return false;
                        const value = predicate();
                        if (value) return value;
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                    }
                    return false;
                };

                const dropdowns = getDropdowns();
                console.info('[ExFsBridgeTrace] cleaner provider DOM scan', {
                    targetSeason: Number(targetSeason),
                    targetEpisode: Number(targetEpisode),
                    hasListContainer: Boolean(listContainer),
                    controlsCount: document.querySelectorAll('div[class*="controls_"]').length,
                    listCount: document.querySelectorAll('div[class*="list_"]').length,
                    dropdownCount: dropdowns.length,
                    dropdownLabels: dropdowns.map(dropdown => String(dropdown.textContent || '').trim()).slice(0, 5)
                });
                if (!listContainer) return false;
                const seasonDropdown = dropdowns[0];
                const episodeDropdownElement = dropdowns[1];
                if (!seasonDropdown || !episodeDropdownElement) return false;

                const activeSeason = getItems(seasonDropdown).find(isActiveItem);
                const seasonAlreadySelected = Number(activeSeason
                    && numberFromLabel(activeSeason.textContent)) === Number(targetSeason);
                const seasonChanged = seasonAlreadySelected
                    ? activeSeason
                    : clickExactItem(seasonDropdown, targetSeason, 'сезон');
                if (!seasonChanged) return false;
                if (!seasonAlreadySelected) {
                    const seasonApplied = await waitFor(() => {
                        const currentSeasonDropdown = getDropdowns()[0] || seasonDropdown;
                        const currentActiveSeason = getItems(currentSeasonDropdown).find(isActiveItem);
                        return Number(currentActiveSeason
                            && numberFromLabel(currentActiveSeason.textContent)) === Number(targetSeason)
                            ? currentActiveSeason
                            : false;
                    }, 12, 100);
                    if (!seasonApplied) {
                        console.warn('[KinoGoBridgeTrace] class bridge season confirmation failed', {
                            targetSeason: Number(targetSeason)
                        });
                        return false;
                    }
                }
                const selectEpisode = () => clickExactItem(
                    getDropdowns()[1] || episodeDropdownElement,
                    targetEpisode,
                    'серия'
                );

                const currentEpisodeDropdown = () => getDropdowns()[1] || episodeDropdownElement;
                const activeEpisode = getItems(currentEpisodeDropdown()).find(isActiveItem);
                const episodeAlreadySelected = Number(activeEpisode
                    && numberFromLabel(activeEpisode.textContent)) === Number(targetEpisode);
                // React/Vue providers rebuild the episode menu after a season
                // click; resolve the new menu before selecting the episode.
                const episodeClicked = episodeAlreadySelected
                    ? activeEpisode
                    : await waitFor(selectEpisode);
                if (!episodeClicked) return false;
                const episodeApplied = await waitFor(() => {
                    const activeItem = getItems(currentEpisodeDropdown()).find(isActiveItem);
                    return activeItem
                        && numberFromLabel(activeItem.textContent) === Number(targetEpisode)
                        ? activeItem
                        : false;
                }, 12, 100);
                console.info('[KinoGoBridgeTrace] class bridge episode confirmation', {
                    targetSeason: Number(targetSeason),
                    targetEpisode: Number(targetEpisode),
                    clicked: Boolean(episodeClicked),
                    confirmed: Boolean(episodeApplied),
                    seasonConfirmed: seasonAlreadySelected || Boolean(
                        getItems(getDropdowns()[0] || seasonDropdown).find(item =>
                            isActiveItem(item)
                            && numberFromLabel(item.textContent) === Number(targetSeason)
                        )
                    )
                });
                return Boolean(episodeApplied && (
                    seasonAlreadySelected
                    || getItems(getDropdowns()[0] || seasonDropdown).some(item =>
                        isActiveItem(item)
                        && numberFromLabel(item.textContent) === Number(targetSeason)
                    )
                ));
            };

            window.movieExtension_applySelection = async (
                targetSeason,
                targetEpisode,
                providerId = null,
                isCurrentOperation = () => true
            ) => {
                if (!isCurrentOperation()) return false;
                const hasKinogoDataSelect = Boolean(
                    document.querySelector('[data-select="seasonType1"]')
                        && document.querySelector('[data-select="episodeType1"]')
                );
                console.info('[KinoGoBridgeTrace] applySelection dispatch', {
                    providerId,
                    targetSeason: Number(targetSeason),
                    targetEpisode: Number(targetEpisode),
                    hasKinogoDataSelect,
                    hasClassBasedDropdowns: Boolean(
                        document.querySelector('div[class*="controls_"] div[class*="dropdown_"]')
                    )
                });

                if (hasKinogoDataSelect) {
                    const kinogoApplied = await applyKinogoProviderSelection(
                        targetSeason,
                        targetEpisode,
                        isCurrentOperation
                    );
                    if (kinogoApplied) return true;
                    console.warn('[KinoGoBridgeTrace] data-select bridge did not apply; trying class bridge', {
                        targetSeason: Number(targetSeason),
                        targetEpisode: Number(targetEpisode)
                    });
                }

                // Stravers mirrors use a separate React/Vue DOM contract even
                // though the parent provider is still KinoGo. Do not let the
                // provider id force the wrong bridge; try the actual DOM.
                console.info('[KinoGoBridgeTrace] trying class-based provider bridge', {
                    targetSeason: Number(targetSeason),
                    targetEpisode: Number(targetEpisode),
                    providerId
                });
                const dispatched = await applyNativeProviderSelection(
                    targetSeason,
                    targetEpisode,
                    isCurrentOperation
                );
                if (dispatched) {
                    console.log('[MovieExtension] Native provider selection clicked:', {
                        season: targetSeason,
                        episode: targetEpisode
                    });
                    return true;
                }
                return false;
            };

            window.movieExtension_restoreProgress = (targetSeason, targetEpisode) => {
                 console.log('[MovieExtension] Executing restore logic:', targetSeason, targetEpisode);
                 if (!targetSeason && !targetEpisode) return;

                 // 1. Switch Season if needed
                 if (targetSeason && seriesData.seasons && seriesData.seasons.length > 0) {
                     // Check current season (native check or our UI check)
                     // We need to trigger the CLICK on the season tab.
                     // We can find the tab by text content.
                     const allDivs = document.querySelectorAll('div');
                     let seasonTab = null;
                     for (let div of allDivs) {
                         if (div.textContent.trim() === targetSeason) {
                             // Check if it looks like a season tab (background style)
                             if (div.style.background.includes('255, 255, 255, 0.1') || div.style.background === 'rgb(77, 166, 255)' || div.style.background === '#4da6ff') {
                                 seasonTab = div;
                                 break;
                             }
                         }
                     }
                     
                     if (seasonTab) {
                          console.log('[MovieExtension] Clicking season tab:', seasonTab);
                          seasonTab.click();
                     } else {
                          console.warn('[MovieExtension] Season tab not found:', targetSeason);
                     }
                 }
                 
                 // 2. Select Episode
                 setTimeout(() => {
                     if (targetEpisode && episodeDropdown) {
                         // Use interface method
                         if (typeof episodeDropdown.setVideoActive === 'function') {
                             console.log('[MovieExtension] Setting active video:', targetEpisode);
                             episodeDropdown.setVideoActive(targetEpisode);
                             
                             // Also ensure we "click" it to trigger side-effects (video load)?
                             // setVideoActive updates UI. Does it load video?
                             // No, setVideoActive only updates UI state.
                             // toggleModal/navigate logic handled clicks.
                             
                             // We need to find the item and execute the click handler to actually load the video.
                             // But we don't have direct access to the `item` objects array to trigger their onclick easily 
                             // unless we expose it.
                             
                             // Alternative: Trigger a matching provider-native episode card in DOM.
                             const allDivs = document.querySelectorAll('div');
                             let episodeCard = null;
                             for (let div of allDivs) {
                                  // Episode cards have minWidth 60px/100px and text content
                                  if (div.textContent.trim() === targetEpisode) {
                                      // Check style props unique to cards
                                      if (div.style.minWidth === '60px' || div.style.minWidth === '100px') {
                                          episodeCard = div;
                                          break;
                                      }
                                  }
                             }
                             
                             if (episodeCard) {
                                 console.log('[MovieExtension] Clicking episode card:', episodeCard);
                                 episodeCard.click();
                             } else {
                                 console.warn('[MovieExtension] Episode card not found:', targetEpisode);
                             }
                         }
                     }
                 }, 800); // Wait for season switch to populate episodes
            };
            // ---------------------------------------

            leftControls.appendChild(timeDisplay);

            // Right Controls Group
            const rightControls = document.createElement('div');
            rightControls.className = 'player-controls-group player-controls-group--right';
            rightControls.style.display = 'flex';
            rightControls.style.alignItems = 'center';
            rightControls.style.gap = '15px';
            rightControls.style.marginLeft = 'auto'; // Push to right

            // Volume Control
            const volumeContainer = document.createElement('div');
            volumeContainer.className = 'player-volume-control mre-volume-control';

            const volumeBtn = document.createElement('button');
            volumeBtn.className = 'player-control-button mre-volume-button';

            const volHighIcon = PLAYER_ICONS.volumeHigh;
            const volLowIcon = PLAYER_ICONS.volumeLow;
            const volMuteIcon = PLAYER_ICONS.volumeMute;

            const updateVolumeIcon = () => {
                const currentVid = permanentVideo || video;
                if (!currentVid) return; // Safety
                
                if (currentVid.muted || currentVid.volume === 0) {
                    volumeBtn.innerHTML = volMuteIcon;
                } else if (currentVid.volume < 0.5) {
                    volumeBtn.innerHTML = volLowIcon;
                } else {
                     volumeBtn.innerHTML = volHighIcon;
                }
            };
            updateVolumeIcon();
            volumeContainer.appendChild(volumeBtn);

            // Custom Vertical Slider
            const sliderContainer = document.createElement('div');
            sliderContainer.className = 'popover-surface player-volume-popover';
            sliderContainer.style.display = 'none'; 

            const volTrack = document.createElement('div');
            volTrack.className = 'player-volume-track mre-volume-track';

            const volFill = document.createElement('div');
            volFill.className = 'mre-volume-fill';
            volFill.style.height = (video.volume * 100) + '%';
            
            const volKnob = document.createElement('div');
            volKnob.className = 'mre-volume-knob';
            
            volFill.appendChild(volKnob);
            volTrack.appendChild(volFill);
            sliderContainer.appendChild(volTrack);
            volumeContainer.appendChild(sliderContainer);

            // Volume Interactions
            // Load saved volume from localStorage
            const VOLUME_STORAGE_KEY = 'movieExtension_videoVolume';
            
            const volumeController = new window.PlayerMediaControls.PlayerVolumeController({
                getVideo: () => permanentVideo,
                storage: localStorage,
                storageKey: VOLUME_STORAGE_KEY,
                onChange: () => updateVolumeUI()
            });
            listenerScope.addDisposer(() => volumeController.destroy());
            const setVolumeSafe = (vol, isMuted) => volumeController.set(vol, isMuted);

            const updateVolumeUI = () => {
                if (!permanentVideo) return;
                const percent = permanentVideo.muted ? 0 : permanentVideo.volume;
                volFill.style.height = (percent * 100) + '%';
                updateVolumeIcon();
            };
            
            // Helper to attach listeners to ANY video element
            const setupVideoListeners = (videoEl) => {
                if (!videoEl || videoEl.dataset.ghost === 'true' || videoEl.classList.contains('ghost-video')) return;
                
                // Remove old listeners if any (not easily possible with anonymous functions unless we track them, 
                // but since we destroy old video elements, it's fine)
                
                const updateTime = () => {
                    const current = videoEl.currentTime || 0;
                    const total = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
                    timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
                    timeDisplay.style.visibility = total > 0 ? 'visible' : 'hidden';
                    
                    // Update Progress Bar
                    if (progressFilled && total > 0) {
                        const percent = (current / total) * 100;
                        progressFilled.style.width = `${percent}%`;
                    }

                    // Scenario 4: Detect video element mismatch
                    if (permanentVideo && videoEl !== permanentVideo) {
                        console.warn(`[SkipError] timeupdate firing on stale video element — listener bound to different video than permanentVideo`);
                    }

                    // Check anime skip button
                    checkSkipButtonVisibility(current);
                };

                videoEl.addEventListener('play', () => {
                    updatePlayBtnIcon();
                    updateVisibility();
                    hideLoader();
                });
                
                videoEl.addEventListener('ended', () => {
                    const key = getSavedKey(); 
                    localStorage.removeItem(key);
                    localStorage.setItem('movieExtension_autoplay_next', 'true');
                    localStorage.setItem('movieExtension_autoplay_start_time', Date.now().toString());
                    hideLoader();
                });
                
                videoEl.addEventListener('pause', () => {
                    updatePlayBtnIcon();
                    updateVisibility();
                    hideLoader();
                });
                
                videoEl.addEventListener('timeupdate', updateTime);
                videoEl.addEventListener('loadedmetadata', () => {
                    updateTime();
                });
                
                // Loader Events
                videoEl.addEventListener('waiting', () => {
                    showLoader();
                });
                videoEl.addEventListener('seeking', () => {
                    showLoader();
                });
                videoEl.addEventListener('seeked', () => {
                    hideLoader();
                    checkSkipButtonVisibility(videoEl.currentTime);
                });
                videoEl.addEventListener('playing', () => {
                    hideLoader();
                });
                videoEl.addEventListener('canplay', () => {
                    hideLoader();
                });
                videoEl.addEventListener('canplaythrough', () => {
                    hideLoader();
                });
                videoEl.addEventListener('error', (e) => {
                    console.error('[MovieExtension] Video Event: error', e);
                    hideLoader();
                    
                    const src = videoEl.src || videoEl.currentSrc || '';
                    if (src && !isValidMediaSrc(src)) {
                        console.warn('[MovieExtension] Error on video with non-media src — likely bad swap occurred. src:', src);
                    }
                });
                
                // Volume Enforcement
                videoEl.addEventListener('volumechange', (e) => {
                    volumeController.enforce(videoEl, e);
                }, true);
            };

            // INITIAL SETUP
            
            // 1. Load Volume
            volumeController.restore();
            
            // A source that is still fetching shows the loader instead of an
            // idle play button. Idle sources (preload=none, blocked autoplay)
            // keep the play button so the user can start them.
            let pendingMediaTimeoutId = null;
            const syncPendingMediaState = (videoEl) => {
                clearTimeout(pendingMediaTimeoutId);
                if (!videoEl) return;
                const duration = Number(videoEl.duration);
                const hasMetadata = videoEl.readyState >= 1 && Number.isFinite(duration) && duration > 0;
                timeDisplay.style.visibility = hasMetadata ? 'visible' : 'hidden';
                const isFetching = !hasMetadata
                    && !videoEl.error
                    && (videoEl.networkState === 2 || (Boolean(videoEl.currentSrc) && !videoEl.paused));
                if (!isFetching) return;
                showLoader();
                pendingMediaTimeoutId = setTimeout(() => {
                    if (videoEl.readyState < 1) hideLoader();
                }, 20000);
            };

            // 2. Attach listeners to initial video
            setupVideoListeners(permanentVideo);
            syncPendingMediaState(permanentVideo);
            
            // Expose for swap logic
            window._movieExtension_setupListeners = (videoEl) => {
                setupVideoListeners(videoEl);
                syncPendingMediaState(videoEl);
            };

            volumeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                volumeController.toggle();
            });

            // Hover Logic
            let volTimeout;
            volumeContainer.addEventListener('mouseenter', () => {
                clearTimeout(volTimeout);
                sliderContainer.style.display = 'flex';
            });
            volumeContainer.addEventListener('mouseleave', () => {
                volTimeout = setTimeout(() => {
                    sliderContainer.style.display = 'none';
                }, 200);
            });


            // Drag Logic
            const updateVolumeFromEvent = (e) => {
                const rect = volTrack.getBoundingClientRect();
                const clientY = e.clientY;
                // Bottom is 0, Top is height
                let percent = (rect.bottom - clientY) / rect.height;
                percent = Math.max(0, Math.min(1, percent));
                
                setVolumeSafe(percent, percent === 0);
            };

            let isDraggingVol = false;
            volTrack.addEventListener('mousedown', (e) => {
                isDraggingVol = true;
                e.stopPropagation(); // prevent player click
                updateVolumeFromEvent(e);
            });
            
            listenerScope.listen(document, 'mousemove', (e) => {
                if (isDraggingVol) {
                    e.preventDefault();
                    updateVolumeFromEvent(e);
                }
            });

            listenerScope.listen(document, 'mouseup', () => {
                isDraggingVol = false;
            });
            
            
            // Replaced by Capture Phase listener above
            /*
            video.addEventListener('volumechange', () => {
                const percent = video.muted ? 0 : video.volume;
                volFill.style.height = (percent * 100) + '%';
                updateVolumeIcon();
                console.log('[MovieExtension] Volume changed event. Muted:', video.muted, 'Volume:', video.volume);
            });
            */

            // --- SUBTITLES BUTTON START ---
            const subtitlesBtn = document.createElement('button');
            subtitlesBtn.className = 'subtitles-toggle-btn player-control-button';
            subtitlesBtn.innerHTML = PLAYER_ICONS.subtitles;
            subtitlesBtn.style.background = 'none';
            subtitlesBtn.style.border = 'none';
            subtitlesBtn.style.cursor = 'pointer';
            subtitlesBtn.style.padding = '5px';
            subtitlesBtn.style.width = '40px'; 
            subtitlesBtn.style.height = '40px';
            subtitlesBtn.style.opacity = '0.7'; 
            subtitlesBtn.style.display = 'flex';
            subtitlesBtn.style.alignItems = 'center';
            subtitlesBtn.style.justifyContent = 'center';
            subtitlesBtn.title = pt('subtitles', 'Субтитры');
            
            // Subtitle Persistence Keys (Moved to shared scope)
            // const SUB_ENABLED_KEY = 'movieExtension_subs_enabled';
            // const SUB_TRACK_KEY = 'movieExtension_subs_track';

            const updateSubBtnState = (isEnabled) => {
                subtitlesBtn.style.opacity = isEnabled ? '1' : '0.7';
                const path = subtitlesBtn.querySelector('path');
                if (path) path.setAttribute('fill', isEnabled ? '#f4f4f5' : '#a1a1aa');
            };

            const toggleSubtitles = () => {
                // Use current video
                const currentVid = permanentVideo || video;
                const tracks = Array.from(currentVid.textTracks || []);
                console.log('[MovieExtension] Toggling subtitles. Found tracks:', tracks.length);
                
                if (tracks.length === 0) return;

                // Check if currently enabled (any track showing)
                const activeTrack = tracks.find(t => t.mode === 'showing');
                console.log('[MovieExtension] Current active track:', activeTrack);
                
                if (activeTrack) {
                    // Turn OFF
                    tracks.forEach(t => t.mode = 'disabled');
                    localStorage.setItem(SUB_ENABLED_KEY, 'false');
                    updateSubBtnState(false);
                    console.log('[MovieExtension] Subtitles disabled');
                } else {
                    // Turn ON
                    // 1. Try saved specific track
                    const savedLabel = localStorage.getItem(SUB_TRACK_KEY);
                    let targetTrack = null;

                    if (savedLabel) {
                        targetTrack = tracks.find(t => t.label === savedLabel);
                    }

                    // 2. If no saved or not found, try "Rus" defaults
                    if (!targetTrack) {
                        targetTrack = tracks.find(t => {
                            const l = (t.label || '').toLowerCase();
                            const lang = (t.language || '').toLowerCase();
                            return l.includes('rus') || l.includes('рус') || lang === 'ru';
                        });
                    }

                    // 3. Fallback to first available
                    if (!targetTrack) targetTrack = tracks[0];

                    if (targetTrack) {
                        tracks.forEach(t => t.mode = 'disabled');
                        targetTrack.mode = 'showing';
                        localStorage.setItem(SUB_ENABLED_KEY, 'true');
                        // Also save this as the current preference if none existed
                        if (!savedLabel) {
                            localStorage.setItem(SUB_TRACK_KEY, targetTrack.label);
                        }
                        updateSubBtnState(true);
                        console.log('[MovieExtension] Subtitles enabled. Track:', targetTrack.label);
                    } else {
                         console.warn('[MovieExtension] No suitable track found to enable');
                    }
                }
            };

            subtitlesBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                toggleSubtitles();
            });

            rightControls.appendChild(subtitlesBtn);

            // Restore Subtitles State on Load
            const restoreSubtitles = () => {
                restoreSubtitlesLogic(video, newContainer);
            };

            video.addEventListener('loadeddata', restoreSubtitles);
            // Also try immediately
            setTimeout(restoreSubtitles, 1000);

            // --- SUBTITLES BUTTON END ---

            // --- PIP BUTTON START ---
            if (document.pictureInPictureEnabled) {
                const pipBtn = document.createElement('button');
                pipBtn.className = 'pip-toggle-btn player-control-button';
                pipBtn.innerHTML = PLAYER_ICONS.pip;
                pipBtn.style.background = 'none';
                pipBtn.style.border = 'none';
                pipBtn.style.cursor = 'pointer';
                pipBtn.style.padding = '5px';
                pipBtn.style.width = '40px'; 
                pipBtn.style.height = '40px';
                pipBtn.style.opacity = '0.7'; 
                pipBtn.style.display = 'flex';
                pipBtn.style.alignItems = 'center';
                pipBtn.style.justifyContent = 'center';
                pipBtn.style.color = 'white'; 
                pipBtn.title = pt('pip', 'Картинка в картинке');

                pipBtn.addEventListener('mouseenter', () => {
                    if (!document.pictureInPictureElement) {
                        pipBtn.style.opacity = '1';
                        pipBtn.style.color = '#f4f4f5';
                    }
                });
                pipBtn.addEventListener('mouseleave', () => {
                    if (!document.pictureInPictureElement) {
                        pipBtn.style.opacity = '0.7';
                        pipBtn.style.color = 'white';
                    }
                });

                pipBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const currentVid = permanentVideo || video;
                    if (currentVid) currentVid.focus(); 

                    if (document.pictureInPictureElement) {
                        document.exitPictureInPicture().catch(console.error);
                    } else if (currentVid) {
                        currentVid.requestPictureInPicture().catch(console.error);
                    }
                });

                const updatePipState = () => {
                    if (document.pictureInPictureElement) {
                        pipBtn.style.color = '#f4f4f5';
                        pipBtn.style.opacity = '1';
                        // Ensure button stays visible/highlighted
                        pipBtn.innerHTML = PLAYER_ICONS.pipActive;
                        postToHost({ type: 'PIP_ENTER' });
                    } else {
                        pipBtn.style.color = 'white';
                        pipBtn.style.opacity = '0.7';
                        pipBtn.innerHTML = PLAYER_ICONS.pip;
                        postToHost({ type: 'PIP_EXIT' });
                    }
                };

                // Add to setupVideoListeners to ensure events are attached to current video
                const originalSetup = window._movieExtension_setupListeners;
                window._movieExtension_setupListeners = (v) => {
                    if (originalSetup) originalSetup(v);
                    listenerScope.listen(v, 'enterpictureinpicture', updatePipState);
                    listenerScope.listen(v, 'leavepictureinpicture', updatePipState);
                };
                
                const scopedPipSetup = window._movieExtension_setupListeners;
                listenerScope.addDisposer(() => { if (window._movieExtension_setupListeners === scopedPipSetup) window._movieExtension_setupListeners = originalSetup; });

                // Also attach to current immediately
                if (permanentVideo) {
                    listenerScope.listen(permanentVideo, 'enterpictureinpicture', updatePipState);
                    listenerScope.listen(permanentVideo, 'leavepictureinpicture', updatePipState);
                }

                rightControls.appendChild(pipBtn);
            }
            // --- PIP BUTTON END ---

            rightControls.appendChild(volumeContainer);

            // Settings Button (User Provided)
            const settingsBtn = document.createElement('button');
            settingsBtn.className = 'player-control-button';
            settingsBtn.innerHTML = PLAYER_ICONS.settings;
            settingsBtn.style.background = 'none';
            settingsBtn.style.border = 'none';
            settingsBtn.style.cursor = 'pointer';
            settingsBtn.style.padding = '5px';
            settingsBtn.title = pt('settings', 'Настройки');
            
            // Settings Menu Container
            const settingsMenu = document.createElement('div');
            settingsMenu.className = 'popover-surface player-settings-menu';
            settingsMenu.style.position = 'absolute';
            settingsMenu.style.bottom = '72px';
            settingsMenu.style.right = '8px';
            settingsMenu.style.display = 'none';
            settingsMenu.style.flexDirection = 'column';
            settingsMenu.style.zIndex = '2147483645';
            settingsMenu.setAttribute('role', 'menu');

            if (!window.PlayerSettingsMenu) throw new Error('PLAYER_SETTINGS_MENU_DEPENDENCY_MISSING');
            const createMenuItem = (label, value) => window.PlayerSettingsMenu.createItem(document, label, value);
            const renderSubMenuView = (title, items, activeCondition, onBack = renderMainView) => {
                window.PlayerSettingsMenu.renderSubmenu({ menu: settingsMenu, title, items, onBack,
                    backLabel: pt('back', `Назад: ${title}`, { title }) });
            };

            // Speed View
            const renderSpeedView = () => {
                const currentVid = permanentVideo || video;
                const rates = window.PlayerMediaControls.PlaybackRate.rates;
                const items = rates.map(rate => ({
                    label: rate + 'x',
                    isActive: currentVid.playbackRate === rate,
                    action: () => {
                        window.PlayerMediaControls.PlaybackRate.set(currentVid, rate);
                    },
                    refreshFn: renderSpeedView
                }));
                renderSubMenuView(pt('speed', 'Скорость'), items);
            }

            const appendSubtitleAppearanceItem = () => {
                const list = settingsMenu.querySelector('.player-settings-menu__list');
                if (!list) return;
                const appearanceItem = createMenuItem(
                    pt('subtitle_settings', 'Настройки субтитров'), `${subtitleAppearance.fontSizePercent}%`
                );
                appearanceItem.setAttribute('aria-label', pt('subtitle_appearance', 'Настройки оформления субтитров'));
                appearanceItem.onclick = (e) => {
                    e.stopPropagation();
                    renderSubtitleAppearanceView();
                };
                list.appendChild(appearanceItem);
            };

            const renderSubtitleAppearanceView = () => {
                settingsMenu.innerHTML = '';

                const header = document.createElement('button');
                header.type = 'button';
                header.className = 'player-settings-menu__back';
                header.setAttribute('aria-label', pt('back_subtitles', 'Назад к дорожкам субтитров'));
                header.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg><span>Настройки субтитров</span>';
                header.querySelector('span').textContent = pt('subtitle_settings', 'Настройки субтитров');
                header.onclick = (e) => { e.stopPropagation(); renderSubsView(); };
                settingsMenu.appendChild(header);

                const body = document.createElement('div');
                body.className = 'player-subtitle-appearance__body';
                body.setAttribute('role', 'group');
                body.setAttribute('aria-label', pt('subtitle_appearance', 'Настройки оформления субтитров'));

                const preview = document.createElement('div');
                preview.className = 'player-subtitle-appearance__preview';
                preview.setAttribute('aria-label', pt('subtitle_preview', 'Предпросмотр субтитров'));
                const caption = document.createElement('span');
                caption.className = 'player-subtitle-appearance__caption';
                caption.textContent = pt('subtitle_sample', 'Пример субтитров');
                preview.appendChild(caption);
                body.appendChild(preview);

                const updatePreview = () => {
                    preview.dataset.position = subtitleAppearance.position;
                    preview.style.setProperty(
                        '--player-subtitle-preview-size',
                        `${(subtitleAppearance.fontSizePercent / 100).toFixed(2)}em`
                    );
                    preview.style.setProperty('--player-subtitle-preview-color', subtitleAppearance.color);
                    preview.style.setProperty(
                        '--player-subtitle-preview-bg', String(subtitleAppearance.backgroundOpacity)
                    );
                    preview.style.setProperty(
                        '--player-subtitle-preview-shadow',
                        getSubtitleAppearanceTextShadow(subtitleAppearance)
                    );
                };

                const appendControl = ({ id, label, key, type = 'range', min, max, step, suffix, format }) => {
                    const control = document.createElement('div');
                    control.className = 'player-subtitle-appearance__control';
                    const labelEl = document.createElement('label');
                    labelEl.htmlFor = id;
                    const labelText = document.createElement('span');
                    labelText.textContent = label;
                    labelEl.appendChild(labelText);
                    const output = document.createElement('output');
                    output.htmlFor = id;
                    output.setAttribute('aria-live', 'polite');
                    labelEl.appendChild(output);
                    control.appendChild(labelEl);

                    const input = document.createElement(type === 'select' ? 'select' : 'input');
                    input.id = id;
                    input.name = id;
                    if (type !== 'select') input.type = type;
                    if (type === 'range') {
                        input.min = String(min);
                        input.max = String(max);
                        input.step = String(step);
                    }
                    if (type === 'color') input.title = label;
                    input.value = String(subtitleAppearance[key]);
                    if (type === 'select') {
                        const options = key === 'position'
                            ? [['bottom', pt('bottom', 'Снизу')], ['top', pt('top', 'Сверху')]]
                            : [['none', pt('none', 'Нет')], ['soft', pt('soft', 'Мягкая')], ['strong', pt('strong', 'Сильная')]];
                        options.forEach(([value, text]) => {
                            const option = document.createElement('option');
                            option.value = value;
                            option.textContent = text;
                            input.appendChild(option);
                        });
                        input.value = subtitleAppearance[key];
                    }
                    control.appendChild(input);

                    const formatValue = value => {
                        if (format) return format(value);
                        return `${value}${suffix || ''}`;
                    };
                    const syncOutput = () => {
                        output.textContent = type === 'color' || type === 'select'
                            ? ''
                            : formatValue(subtitleAppearance[key]);
                    };
                    const apply = () => {
                        persistSubtitleAppearance({ ...subtitleAppearance, [key]: input.value });
                        syncOutput();
                        updatePreview();
                    };
                    input.addEventListener('input', apply);
                    input.addEventListener('change', apply);
                    syncOutput();
                    body.appendChild(control);
                };

                appendControl({
                    id: 'playerSubtitleFontSize',
                    label: pt('size', 'Размер'),
                    key: 'fontSizePercent',
                    min: 75,
                    max: 200,
                    step: 5,
                    suffix: '%'
                });
                appendControl({
                    id: 'playerSubtitleColor',
                    label: pt('text_color', 'Цвет текста'),
                    key: 'color',
                    type: 'color'
                });
                appendControl({
                    id: 'playerSubtitlePosition',
                    label: pt('position', 'Расположение'),
                    key: 'position',
                    type: 'select'
                });
                appendControl({
                    id: 'playerSubtitleOffset',
                    label: pt('edge_offset', 'Отступ от края'),
                    key: 'offsetPercent',
                    min: 2,
                    max: 20,
                    step: 1,
                    suffix: '%'
                });
                appendControl({
                    id: 'playerSubtitleBackgroundOpacity',
                    label: pt('text_background', 'Фон под текстом'),
                    key: 'backgroundOpacity',
                    min: 0,
                    max: 0.9,
                    step: 0.05,
                    format: value => `${Math.round(Number(value) * 100)}%`
                });
                appendControl({
                    id: 'playerSubtitleTextShadow',
                    label: pt('text_shadow', 'Тень текста'),
                    key: 'textShadow',
                    type: 'select'
                });

                const note = document.createElement('div');
                note.className = 'player-subtitle-appearance__note';
                note.textContent = pt('subtitle_note', 'Изменения применяются сразу и сохраняются для следующих видео.');
                body.appendChild(note);

                const reset = document.createElement('button');
                reset.type = 'button';
                reset.className = 'player-subtitle-appearance__reset';
                reset.textContent = pt('reset_settings', 'Сбросить настройки');
                reset.addEventListener('click', (e) => {
                    e.stopPropagation();
                    persistSubtitleAppearance(DEFAULT_SUBTITLE_APPEARANCE);
                    renderSubtitleAppearanceView();
                });
                body.appendChild(reset);
                settingsMenu.appendChild(body);
                updatePreview();
            };

            // Subtitles View
            const renderSubsView = () => {
                const currentVid = permanentVideo || video;
                const hls = currentVid._movieExtensionHls;
                if (hls?.subtitleTracks?.length) {
                    const select = index => {
                        hls.subtitleTrack = index;
                        hls.subtitleDisplay = index >= 0;
                        updateSubBtnState(index >= 0);
                    };
                    renderSubMenuView(pt('subtitles', 'Субтитры'), [
                        { label: pt('off', 'Откл'), isActive: hls.subtitleTrack < 0 || !hls.subtitleDisplay,
                            action: () => select(-1), refreshFn: renderSubsView },
                        ...hls.subtitleTracks.map((track, index) => ({
                            label: track.name || track.lang || pt('track', `Дорожка ${index + 1}`, { number: index + 1 }),
                            isActive: hls.subtitleDisplay && hls.subtitleTrack === index,
                            action: () => select(index), refreshFn: renderSubsView
                        }))
                    ]);
                    appendSubtitleAppearanceItem();
                    return;
                }
                const tracks = Array.from(currentVid.textTracks || []);
                // Add "Off" option
                const items = [{
                    label: pt('off', 'Откл'),
                    isActive: tracks.every(t => t.mode === 'disabled' || t.mode === 'hidden'), 
                    action: () => {
                         tracks.forEach(t => t.mode = 'disabled'); // Or hidden
                         localStorage.setItem(SUB_ENABLED_KEY, 'false');
                         updateSubBtnState(false);
                         updateSubBtnState(false);
                    },
                    refreshFn: renderSubsView
                }];

                if (tracks.length > 0) {
                    tracks.forEach((track, index) => {
                        // Skip if no label (often metadata tracks)
                        if (!track.label && !track.language) return; 
                        
                        items.push({
                            label: track.label || track.language || `Track ${index + 1}`,
                            isActive: track.mode === 'showing',
                            action: () => {
                                // Disable others
                                tracks.forEach(t => t.mode = 'disabled');
                                track.mode = 'showing';
                                
                                // Save Preference
                                localStorage.setItem(SUB_ENABLED_KEY, 'true');
                                if (track.label) {
                                    localStorage.setItem(SUB_TRACK_KEY, track.label);
                                }
                                updateSubBtnState(true);
                                
                                updateSubBtnState(true);
                            },
                            refreshFn: renderSubsView
                        });
                    });
                } else {
                    // No tracks
                }
                
                renderSubMenuView(pt('subtitles', 'Субтитры'), items);
                appendSubtitleAppearanceItem();
            };

            // Quality View
            // Generic scanner for controls
            const findControlOptions = (keywords) => {
                 const candidates = [];
                 const hasKeyword = (text) => keywords.some(k => text.includes(k));
                 
                 // Scan all divs/lis/spans
                 document.querySelectorAll('li, div, span, a').forEach(el => {
                    // Avoid our own UI
                    if (newContainer.contains(el)) return;
                    // Check text
                    const txt = el.textContent.trim();
                    if (txt.length < 20 && hasKeyword(txt)) {
                        candidates.push(el);
                    }
                 });
                 
                 // Group by parent
                 const parentMap = new Map();
                 candidates.forEach(el => {
                     const p = el.parentElement;
                     if (p) parentMap.set(p, (parentMap.get(p) || 0) + 1);
                 });
                 
                 // Find best parent
                 let bestParent = null;
                 let maxCount = 0;
                 parentMap.forEach((count, parent) => {
                     // Check if this parent looks like a list
                     if (count > maxCount) {
                         maxCount = count;
                         bestParent = parent;
                     }
                 });
                 
                 if (!bestParent || maxCount < 2) return [];
                 
                 // Extract items from best parent
                 const results = [];
                 Array.from(bestParent.children).forEach(child => {
                     const txt = child.textContent.trim();
                     if (txt) {
                         // Robust active check: partial class match or specific data attribute
                         const isActive = Array.from(child.classList).some(c => c.toLowerCase().includes('active') || c.toLowerCase().includes('selected'));
                         
                         results.push({
                             label: txt,
                             element: child,
                             isActive: isActive
                         });
                     }
                 });
                 return results;
            }

            const cleanQualityLabel = (rawText) => {
                if (!rawText) return 'Auto';
                let text = rawText.trim();
                text = text.replace(/^(?:Качество|Quality|Разрешение|Resolution|Video Quality)\s*:?\s*/gi, '').trim();

                const tokenRegex = /(2160p\d*|1440p\d*|1080p\d*|720p\d*|480p\d*|360p\d*|240p\d*|4k|ultra\s*hd|full\s*hd|auto|авто)/gi;
                const allMatches = [...text.matchAll(tokenRegex)];
                if (allMatches.length > 0) {
                    const lastToken = allMatches[allMatches.length - 1][0];
                    if (lastToken.toLowerCase() === 'auto') return 'Auto';
                    if (lastToken.toLowerCase() === 'авто') return pt('auto', 'Авто');
                    if (lastToken.toLowerCase() === '4k') return '4K';
                    if (lastToken.toLowerCase() === 'full hd') return '1080p (Full HD)';
                    if (lastToken.toLowerCase() === 'ultra hd') return '4K (Ultra HD)';
                    return lastToken.toLowerCase();
                }

                const numMatch = text.match(/(2160|1440|1080|720|480|360|240)/);
                if (numMatch) {
                    return numMatch[0] + 'p';
                }

                return text || 'Auto';
            };

            const getNativeHlsQualityOptions = () => {
                const hls = permanentVideo?._movieExtensionHls;
                const levels = Array.isArray(hls?.levels) ? hls.levels : [];
                if (!hls || levels.length < 2) return [];

                const variantsByHeight = new Map();
                levels.forEach((level, index) => {
                    const height = Number(level?.height);
                    if (!Number.isFinite(height) || height <= 0) return;
                    const current = variantsByHeight.get(height);
                    if (!current || Number(level?.bitrate || 0) > Number(current.level?.bitrate || 0)) {
                        variantsByHeight.set(height, { index, level });
                    }
                });
                const variants = [...variantsByHeight.values()]
                    .sort((left, right) => right.level.height - left.level.height);
                if (variants.length < 2) return [];

                const selectLevel = levelIndex => {
                    hls.currentLevel = levelIndex;
                    hls.nextLevel = levelIndex;
                };

                // In auto mode, name the rendition currently playing (from the
                // manifest height, like the manual entries).
                const playingHeight = Math.round(Number(levels[hls.currentLevel]?.height));
                const autoLabel = hls.autoLevelEnabled && Number.isFinite(playingHeight) && playingHeight > 0
                    ? `${pt('auto', 'Авто')} · ${playingHeight}p`
                    : pt('automatic', 'Автоматически');

                return [
                    {
                        label: autoLabel,
                        isActive: hls.autoLevelEnabled,
                        action: () => { hls.currentLevel = -1; }
                    },
                    ...variants.map(({ index, level }) => ({
                        // Keep the label tied to the manifest metadata. A provider's
                        // visual ladder must not turn an internal height into a false
                        // 1080p/720p claim.
                        label: `${Math.round(level.height)}p`,
                        isActive: !hls.autoLevelEnabled && hls.currentLevel === index,
                        action: () => selectLevel(index)
                    }))
                ];
            };

            // Parsers whose qualities are separate streams (AnimeGo's Kodik
            // manifests carry one level each) list them in a hidden bridge.
            const getBridgeQualityOptions = () => {
                const bridge = document.querySelector('[data-player-quality-source]');
                const items = bridge ? Array.from(bridge.querySelectorAll('[data-quality-option]')) : [];
                if (items.length < 2) return [];
                return items.map(item => ({
                    label: item.textContent.trim(),
                    isActive: item.classList.contains('active'),
                    action: () => item.click()
                }));
            };

            const getQualityOptions = () => {
                const bridgeOptions = getBridgeQualityOptions();
                if (bridgeOptions.length > 0) return bridgeOptions;
                const nativeHlsOptions = getNativeHlsQualityOptions();
                if (nativeHlsOptions.length > 0) return nativeHlsOptions;
                if (permanentVideo?.dataset?.playerProvider === 'torrent') return [];
                const keywords = ['2160p', '1440p', '1080p', '720p', '480p', '360p', 'Auto', '4k', 'Ultra'];
                const rawOptions = findControlOptions(keywords);
                return rawOptions.map(opt => ({
                    ...opt,
                    label: cleanQualityLabel(opt.label)
                }));
            };

            const renderQualityView = () => {
                const options = getQualityOptions();
                
                if (options.length === 0) {
                    renderSubMenuView(pt('quality', 'Качество'), [{label: pt('automatic', 'Автоматически'), isActive: true, action: () => {}}]);
                    return;
                }

                const items = options.map(opt => ({
                    label: opt.label,
                    isActive: opt.isActive, 
                    action: () => {
                        // Native HLS variants provide their own action; provider DOM
                        // options retain the legacy element-click behaviour.
                        if (typeof opt.action === 'function') {
                            opt.action();
                        } else {
                            opt.element?.click?.();
                        }
                    },
                    refreshFn: () => {
                        setTimeout(renderQualityView, 200); 
                    }
                }));
                
                renderSubMenuView(pt('quality', 'Качество'), items);
            }

            // Voiceover View
            const renderVoiceoverView = () => {
                const hls = (permanentVideo || video)._movieExtensionHls;
                if (hls?.audioTracks?.length) {
                    renderSubMenuView(pt('voiceover', 'Озвучка'), hls.audioTracks.map((track, index) => ({
                        label: track.name || track.lang || pt('track', `Дорожка ${index + 1}`, { number: index + 1 }),
                        isActive: hls.audioTrack === index,
                        action: () => { hls.audioTrack = index; },
                        refreshFn: renderVoiceoverView
                    })));
                    return;
                }
                const items = currentVoiceoverOptions.map(opt => ({
                    label: opt.name,
                    isActive: opt.isActive || false, 
                    action: () => {
                         let targetEl = opt.element;
                         
                         // Lazy Re-bind: Check if element is still in DOM
                         if (!targetEl || !document.body.contains(targetEl)) {
                             // Try to find a new element with the same text
                             // We re-run the heuristic search on the whole document (excluding our UI)
                             const allDivs = Array.from(document.querySelectorAll('div, span, li, a, button, b, i'));
                             const match = allDivs.find(el => {
                                 // Check for exact text match or very close
                                 return el.textContent.trim() === opt.name && !newContainer.contains(el);
                             });
                             
                             if (match) {
                                 targetEl = match;
                                 // Update reference for future
                                 opt.element = match;
                             }
                         }

                         if (targetEl && document.body.contains(targetEl)) {
                             targetEl.click();
                             // Update active state locally
                             currentVoiceoverOptions.forEach(o => o.isActive = false);
                             opt.isActive = true;
                             
                             // Re-scan from bridge after a short delay to pick up new active state
                             setTimeout(() => {
                                 findAndRenderVoiceovers(controlsOverlay, newContainer);
                                 renderVoiceoverView(); // Refresh the submenu view
                             }, 200);
                         }
                    },
                    refreshFn: renderVoiceoverView
                }));
                renderSubMenuView(pt('voiceover', 'Озвучка'), items);
            };


            // The host opts framed players into diagnostics; standalone provider
            // pages and Search must not display a dead menu action.
            let diagnosticsRequestId = null;
            listenerScope.addDisposer(() => {
                if (diagnosticsRequestId !== null) postToHost({ type: 'PLAYER_DIAGNOSTICS_AVAILABLE',
                    requestId: diagnosticsRequestId, available: false });
            });
            // Main View
            const renderMainView = () => {
                settingsMenu.innerHTML = '';
                const currentVid = permanentVideo || video;
                
                // Get current quality label
                const qualityOpts = getQualityOptions();
                const activeQuality = qualityOpts.find(o => o.isActive);
                const qualityLabel = activeQuality ? activeQuality.label : 'Auto';

                // Quality Item
                const qualityItem = createMenuItem(pt('quality', 'Качество'), qualityLabel);
                qualityItem.onclick = (e) => { e.stopPropagation(); renderQualityView(); };
                if (qualityOpts.length || currentVid.dataset?.playerProvider !== 'torrent') settingsMenu.appendChild(qualityItem);

                // Voiceover Item (New)
                const hlsAudio = currentVid._movieExtensionHls?.audioTracks || [];
                if (hlsAudio.length) {
                    const selected = hlsAudio[currentVid._movieExtensionHls.audioTrack];
                    const voiceItem = createMenuItem(pt('voiceover', 'Озвучка'), '');
                    voiceItem.querySelector('.player-settings-menu__value').textContent = selected?.name || selected?.lang || pt('main_track', 'Основная');
                    voiceItem.onclick = e => { e.stopPropagation(); renderVoiceoverView(); };
                    settingsMenu.appendChild(voiceItem);
                } else if (currentVoiceoverOptions.length > 0 && currentVid.dataset?.playerProvider !== 'torrent') {
                    const activeVoiceover = currentVoiceoverOptions.find(o => o.isActive) || currentVoiceoverOptions[0];
                    const voiceLabel = activeVoiceover ? activeVoiceover.name : 'Unknown';
                    
                    const voiceItem = createMenuItem(pt('voiceover', 'Озвучка'), voiceLabel);
                    voiceItem.onclick = (e) => { e.stopPropagation(); renderVoiceoverView(); };
                    settingsMenu.appendChild(voiceItem);
                }

                // Speed Item
                const speedItem = createMenuItem(pt('speed', 'Скорость'), currentVid.playbackRate + 'x');
                speedItem.onclick = (e) => { e.stopPropagation(); renderSpeedView(); };
                settingsMenu.appendChild(speedItem);

                // Subtitles Item
                const tracks = Array.from(currentVid.textTracks || []);
                const activeTrack = tracks.find(t => t.mode === 'showing');
                const hlsSubtitleTracks = currentVid._movieExtensionHls?.subtitleTracks || [];
                const hlsSubtitleState = currentVid._movieExtensionHls;
                const activeHlsSubtitle = hlsSubtitleState?.subtitleDisplay
                    ? hlsSubtitleTracks[hlsSubtitleState.subtitleTrack]
                    : null;
                // Clean up label (remove " - 1", " - 2" suffixes if present)
                let subLabel = activeHlsSubtitle
                    ? (activeHlsSubtitle.name || activeHlsSubtitle.lang)
                    : activeTrack
                        ? (activeTrack.label || activeTrack.language)
                        : pt('off', 'Откл');
                subLabel = subLabel || pt('off', 'Откл');
                subLabel = subLabel.replace(/\s*-\s*\d+$/, ''); 

                const subsItem = createMenuItem(pt('subtitles', 'Субтитры'), subLabel);
                subsItem.onclick = (e) => { e.stopPropagation(); renderSubsView(); };
                settingsMenu.appendChild(subsItem);
                if ((isExtensionPageContext() && window.PlayerDiagnosticsPanel) || diagnosticsRequestId !== null) {
                    window.PlayerSettingsMenu.appendDiagnostics(settingsMenu, {
                        label: pt('diagnostics', 'Диагностика'),
                        onOpen: () => {
                            if (isExtensionPageContext()) window.dispatchEvent(new Event('movie-player-diagnostics'));
                            else postToHost({ type: 'PLAYER_DIAGNOSTICS_OPEN', requestId: diagnosticsRequestId });
                        }
                    });
                }
            };

            renderMainView();
            newContainer.appendChild(settingsMenu);

            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Focusing the video here might close the menu if we had a blur listener, 
                // but since we don't, it might just move keyboard focus.
                // However, if we want to navigate the menu with keys, we might NOT want to focus video?
                // But the user issue is about arrow keys affecting the video.
                // If the menu is open, maybe we WANT arrow keys to navigate the menu?
                // The current menu implementation uses DOM elements. 
                // If I focus video, the arrow keys will seek.
                // If the user wants to seek while menu is open, this is good.
                // If the user wants to navigate menu with arrows, this breaks it.
                // But currently, the menu doesn't seem to support keyboard nav (only click).
                // So focusing video is probably safer for the user's request.
                if (permanentVideo) permanentVideo.focus(); 
                
                if (settingsMenu.style.display === 'none') {
                    // Re-scan voiceovers to ensure freshness before showing
                    findAndRenderVoiceovers(controlsOverlay, newContainer);
                    renderMainView(); // Reset to main on open.
                    settingsMenu.style.display = 'flex';
                    settingsMenu.querySelector('button')?.focus();
                } else {
                    settingsMenu.style.display = 'none';
                    settingsBtn.focus();
                }
            });

            // Close menu when clicking outside
            listenerScope.listen(document, 'click', (e) => {
                if (!settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
                    settingsMenu.style.display = 'none';
                }
            });

            // Fullscreen Button
            const fullscreenBtn = document.createElement('button');
            fullscreenBtn.className = 'player-control-button mre-fullscreen-button';
            fullscreenBtn.style.background = 'none';
            fullscreenBtn.style.border = 'none';
            fullscreenBtn.style.cursor = 'pointer';
            fullscreenBtn.style.color = 'white';
            fullscreenBtn.style.padding = '5px';
            
            const updateFullIcon = () => {
                if (document.fullscreenElement) {
                     fullscreenBtn.innerHTML = PLAYER_ICONS.fullscreenExit; // Exit (approx)
                } else {
                     fullscreenBtn.innerHTML = PLAYER_ICONS.fullscreen; // Enter
                }
            };
            updateFullIcon();

            const toggleFullscreen = () => {
                if (!document.fullscreenElement) {
                    newContainer.requestFullscreen().catch(err => {
                        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
                    });
                } else {
                    document.exitFullscreen();
                }
            };

            fullscreenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                toggleFullscreen();
            });

            // Prevent native double-click fullscreen on video from breaking UI
            // Use 'click' with detail === 2 to ensure we are in a valid user gesture context for requestFullscreen
            newContainer.addEventListener('click', (e) => {
                if (e.detail === 2) {
                    e.stopPropagation();
                    e.preventDefault();
                    toggleFullscreen();
                }
            });
            
            listenerScope.listen(document, 'fullscreenchange', updateFullIcon);

            settingsBtn.classList.add('player-settings-button');
            const relabelPlayer = () => window.PlayerLocale?.localize?.(newContainer);
            let unsubscribeLocale = null;
            let localeDisposed = false;
            playerLocaleReady.then(() => {
                if (localeDisposed || !newContainer.isConnected) return;
                relabelPlayer();
                unsubscribeLocale = window.PlayerLocale?.subscribe(relabelPlayer);
            });
            listenerScope.addDisposer(() => { localeDisposed = true; unsubscribeLocale?.(); });
            playPauseBtn.setAttribute('aria-label', pt('play_pause', 'Воспроизвести или поставить на паузу'));
            fullscreenBtn.setAttribute('aria-label', pt('fullscreen', 'Полный экран'));
            settingsBtn.setAttribute('aria-label', pt('player_settings', 'Настройки плеера'));
            subtitlesBtn.setAttribute('aria-label', pt('toggle_subtitles', 'Включить или выключить субтитры'));
            bindPlayerAccessibility({ container: newContainer, getVideo: () => permanentVideo || video,
                scope: listenerScope, slider: progressContainer, toggleFullscreen, toggleSubtitles,
                onSeek: direction => showSeekIndicator(direction === 'left' ? leftSeekIndicator : rightSeekIndicator, direction),
                onVolume: showVolumeIndicator });

            // === Anime Opening Skip Button ===
            // === Anime Opening Skip Button ===
            skipButton = document.createElement('button');
            skipButton.id = 'skipOpeningBtn';
            skipButton.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px;">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                </svg>
                <span>Пропустить опенинг</span>
            `;
            skipButton.querySelector('span').textContent = pt('skip_opening', 'Пропустить опенинг');
            // Updated styles: Absolute positioning, Dark theme with Blue accent
            skipButton.style.cssText = `
                display: none;
                position: absolute;
                bottom: 80px;
                right: 30px;
                z-index: 60;
                align-items: center;
                background: #262627;
                border: 1px solid #3e3e3fff;
                border-radius: 8px;
                padding: 10px 20px;
                color: #ffffffff;
                font-family: inherit;
                font-size: 18px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(8px);
                letter-spacing: 0.3px;
            `;
            
            skipButton.addEventListener('mouseenter', () => {
                skipButton.style.background = '#C0C0C0';
                skipButton.style.color = '#262627';
                skipButton.style.boxShadow = '0 8px 20px rgba(192, 192, 192, 0.5)';
                skipButton.style.transform = 'translateY(-2px)';
            });
            
            skipButton.addEventListener('mouseleave', () => {
                skipButton.style.background = '#262627';
                skipButton.style.color = '#ffffffff';
                skipButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
                skipButton.style.transform = 'translateY(0)';
            });
            
            skipButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus();
                
                if (animeSkipData && animeSkipData.endTime) {
                    console.log('[MovieExtension] Skipping to:', animeSkipData.endTime);
                    permanentVideo.currentTime = animeSkipData.endTime;
                    hideSkipButton();
                }
            });

            // Note: Visibility functions and timeupdate listeners are now handled globally & via setupVideoListeners
            // This prevents duplicate logic and ensures button works on episode switch.

            // Append to main container (absolute positioning) instead of rightControls
            newContainer.appendChild(skipButton);
            rightControls.appendChild(settingsBtn);
            rightControls.appendChild(fullscreenBtn);

            bottomControls.appendChild(leftControls);
            bottomControls.appendChild(rightControls);

            bottomControls.querySelectorAll('button').forEach(button => {
                button.classList.add('player-control-button');
                button.style.width = '36px';
                button.style.height = '36px';
                button.style.display = 'grid';
                button.style.placeItems = 'center';
                button.style.padding = '6px';
                button.style.color = 'rgba(255, 255, 255, 0.82)';
                button.style.background = 'transparent';
                button.style.border = '1px solid transparent';
                button.style.borderRadius = '10px';
                button.style.opacity = '1';
                button.style.transition = 'color 160ms ease, background-color 160ms ease, border-color 160ms ease, transform 120ms cubic-bezier(0.23, 1, 0.32, 1)';
                button.addEventListener('mouseenter', () => {
                    if (button.disabled) return;
                    button.style.color = '#fff';
                    button.style.background = 'rgba(255, 255, 255, 0.1)';
                    button.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                });
                button.addEventListener('mouseleave', () => {
                    button.style.color = 'rgba(255, 255, 255, 0.82)';
                    button.style.background = 'transparent';
                    button.style.borderColor = 'transparent';
                });
            });

            newContainer.appendChild(bottomControls);
            activateSubtitleAppearance(newContainer, bottomControls);

            console.info('[PlayerCleaner] Native player ready', {
                origin: window.location.origin,
                sourceType: initialSrc.startsWith('blob:') ? 'blob' : 'url',
                uiVersion: 'obsidian-3'
            });

            // INITIALIZE GHOST PLAYER FOR IFRAME
            if (typeof GhostPlayer !== 'undefined') {
                window._iframeGhostPlayer = new GhostPlayer({
                    progressContainer: progressContainer,
                    getActiveVideo: () => permanentVideo || document.querySelector('video'),
                    getCurrentUrl: () => getPreviewMediaUrl(permanentVideo),
                    getCurrentType: () => permanentVideo?._movieExtensionHls ? 'hls'
                        : permanentVideo?.dataset?.playerPreviewType,
                    getCurrentHls: () => permanentVideo?._movieExtensionHls || window.hls || null,
                    HlsClass: (typeof Hls !== 'undefined') ? Hls : null,
                });
            }

            // Communication with parent (Extension)
            // Notify parent that player is ready
            postToHost({ type: 'PLAYER_READY' });

            // Listen for messages from parent
            listenerScope.listen(window, 'message', (event) => {
                if (!isTrustedHostMessage(event)) return;
                if (event.data.type === 'PLAYER_DIAGNOSTICS_QUERY' && Number.isSafeInteger(event.data.requestId)) {
                    const firstOptIn = diagnosticsRequestId === null;
                    diagnosticsRequestId = event.data.requestId;
                    if (firstOptIn) {
                        const restoreMenuFocus = settingsMenu.contains(document.activeElement);
                        renderMainView();
                        if (restoreMenuFocus) settingsMenu.querySelector('button')?.focus();
                    }
                    postToHost({ type: 'PLAYER_DIAGNOSTICS_AVAILABLE', requestId: diagnosticsRequestId, available: true });
                } else if (event.data.type === 'SET_SOURCES') {
                    // Sources received, no action needed here currently
                } else if (event.data.type === 'ANIME_SKIP_DATA') {
                    // Received anime skip times from parent
                    console.log('[MovieExtension] Received anime skip data:', event.data);
                    
                    if (event.data.skipTimes) {
                        animeSkipData = {
                            startTime: event.data.skipTimes.startTime,
                            endTime: event.data.skipTimes.endTime,
                            episodeLength: event.data.skipTimes.episodeLength
                        };
                        
                        console.log(`[SkipError] ANIME_SKIP_DATA received — range: ${animeSkipData.startTime}-${animeSkipData.endTime}s, permanentVideo: ${!!permanentVideo}, skipButton: ${!!skipButton}`);
                        
                        // Scenario 2: Skip data ready but no video or button
                        if (!permanentVideo) {
                            console.warn('[SkipError] Skip data received but permanentVideo is null — button cannot be shown');
                        }
                        if (!skipButton) {
                            console.warn('[SkipError] Skip data received but skipButton DOM element not created yet');
                        }
                        
                        // Immediately check if button should be visible
                        if (permanentVideo) {
                            checkSkipButtonVisibility(permanentVideo.currentTime);
                        }
                    } else {
                        // No skip data available, clear state
                        console.log(`[SkipError] ANIME_SKIP_DATA received with null skipTimes (ep: ${event.data.episodeNumber}) — clearing skip state`);
                        animeSkipData = null;
                        hideSkipButton();
                    }
                }
            });
            
            // 3. Find and Render Internal Voiceovers (This is the real top-left dropdown)
            findAndRenderVoiceovers(controlsOverlay, newContainer);

            // if (observer) observer.disconnect(); // KEEP OBSERVER ALIVE
            
            if (attempts > MAX_ATTEMPTS) {
                attempts = 0; // Infinite retry effectively, looking for video appearing later
            }
    }


    function findAndRenderVoiceovers(container, exclusionContainer) {
        
        // Strategy 0: Explicit parser bridge (Seasonvar, AnimeGo native Kodik)
        const bridgeContainer = document.querySelector('[data-player-voiceover-source], #seasonvar-voiceover-source');
        if (bridgeContainer) {
            extractAndRender(bridgeContainer.querySelectorAll('[data-voiceover-option], .seasonvar-voiceover-item'), container);
            return;
        }

        // Strategy 1: Look for the specific structure user provided
        // <div class="menu_..."><div class="item_...">Name</div></div>
        
        // Find potential menu containers by partial class or structure

        
        // Look for items with "item_" class prefix which is common in provided snippet
        const items = document.querySelectorAll('[class*="item_"]');
        
        if (items.length > 0) {
            
            // Group by parent
            const parentMap = new Map();
            items.forEach(el => {
                const text = el.textContent.trim();
                // Filter out irrelevant items (too short/long or empty)
                if (text.length > 2 && text.length < 50) {
                     const parent = el.parentElement;
                     if (parent) {
                         // Check if parent looks like a menu (has multiple children)
                         if (!parentMap.has(parent)) parentMap.set(parent, []);
                         parentMap.get(parent).push(el);
                     }
                }
            });

            // Find best parent
            let bestParent = null;
            let maxCount = 0;
            
            for (const [parent, children] of parentMap.entries()) {
                // Check if children contain known keywords
                const hasKeywords = children.some(child => {
                     const t = child.textContent;
                     return t.includes('Original') || t.includes('Dubbing') || t.includes('Дублированный') || t.includes('Red Head') || t.includes('TVShows');
                });
                
                if (hasKeywords && children.length > maxCount) {
                    maxCount = children.length;
                    bestParent = parent;
                }
            }

            if (bestParent) {
                extractAndRender(bestParent.children);
                return;
            }
        }
        
        // Strategy 2: Fallback to keyword search in all divs if class search fails
        // Heuristic: Find elements with text matching common voiceover names
        const keywords = ['TVShows', 'Dubbing', 'Original', 'Red Head', 'Дубляж', 'LostFilm', 'NewStudio', 'HDRezka', 'Кубик в Кубе', 'Eng.Original'];
        const textCandidates = [];
        
        const hasKeyword = (text) => keywords.some(k => text.includes(k));

        document.querySelectorAll('div, span, li').forEach(el => {
            if (exclusionContainer && exclusionContainer.contains(el)) return;
            if (el.textContent && el.textContent.length < 50 && hasKeyword(el.textContent)) {
                textCandidates.push(el);
            }
        });

        // Group by parent
        const textParentMap = new Map();
        textCandidates.forEach(el => {
            const parent = el.parentElement;
            if (parent) {
                textParentMap.set(parent, (textParentMap.get(parent) || 0) + 1);
            }
        });

        let bestTextParent = null;
        let maxTextCount = 0;
        textParentMap.forEach((count, parent) => {
            if (count > maxTextCount) {
                maxTextCount = count;
                bestTextParent = parent;
            }
        });

        if (bestTextParent && maxTextCount >= 2) {
             extractAndRender(bestTextParent.children);
        } else {
            // No voiceover found
        }
    }

    function extractAndRender(childrenCollection) {
        const voiceoverOptions = [];
        Array.from(childrenCollection).forEach(child => {
            let text = child.textContent.trim();
            text = text.replace(/^(?:Озвучка|Перевод|Аудиодорожка|Voiceover)\s*:?\s*/gi, '').trim();
            if (text) {
                voiceoverOptions.push({
                    name: text,
                    element: child
                });
            }
        });

        if (voiceoverOptions.length > 0) {
            // Update global state
            currentVoiceoverOptions = voiceoverOptions;
            
            // Try to detect active one (heuristic: "active" class or color)
            currentVoiceoverOptions.forEach(opt => {
                if (opt.element.classList.contains('active') || 
                    opt.element.classList.contains('selected') || 
                    opt.element.className.includes('active')) {
                    opt.isActive = true;
                }
            });
            // If none active, assume first? Or leave as is.
            if (!currentVoiceoverOptions.some(o => o.isActive)) {
                if(currentVoiceoverOptions.length > 0) currentVoiceoverOptions[0].isActive = true;
            }
        }
    }

    // REMOVED renderInternalVoiceoverSelector

    function observePlayerContainer() {
        const nextRoot = getPlayerObservationRoot();
        if (!nextRoot) return false;
        if (observerRoot === nextRoot) return true;
        observer?.disconnect?.();
        observerRoot = nextRoot;
        observer.observe(observerRoot, {
            attributes: true,
            attributeFilter: ['class', 'aria-selected', 'src'],
            childList: true,
            subtree: true
        });
        return true;
    }

    function startPlayerObservation(attempt = 0) {
        installNativeSelectionObserver();
        reportProviderContentError();
        if (observePlayerContainer()) {
            replacePlayer();
            return;
        }
        if (attempt < MAX_ATTEMPTS) {
            setTimeout(() => startPlayerObservation(attempt + 1), 100);
        }
    }

    // Observe only the concrete player subtree. Mutations elsewhere in the page
    // cannot trigger a player replacement.
    observer = new MutationObserver((mutations) => {
        if (!mutationsWithinRoot(mutations, observerRoot)) return;
        const nativePickerMutation = mutations.some(mutation => {
            const target = mutation.target?.closest?.('div[class*="dropdown_"], div[class*="list_"]');
            return Boolean(target);
        });
        if (nativePickerMutation) {
            scheduleNativeProviderSelectionReport('native-mutation');
        }
        if (activeWrapper && !document.contains(activeWrapper)) {
            teardownActiveWrapper();
        }
        if (permanentVideo && !document.contains(permanentVideo)) {
            setPermanentVideo(null);
            activeWrapper = null;
        }
        if (permanentVideo && !mutations.some(needsPlayerReconciliation)) return;
        // One adoption path owns initial mounts and provider source changes.
        // Never copy an arbitrary added video's URL into the current movie:
        // it may be an advert, and a blob's MSE owner must stay with its element.
        replacePlayer();
    });

    // HLS attaches a source after insertion. Mount controls without relying on a
    // later unrelated DOM mutation; retain the same video/primary HLS owner.
    const mountReadyVideo = event => {
        if (event.target?.tagName !== 'VIDEO' || event.target.dataset.ghost === 'true') return;
        if (!isExtensionNativeVideo(event.target) && event.target !== findContentVideo()) return;
        replacePlayer();
    };
    document.addEventListener('extension-player-source-ready', mountReadyVideo);
    document.addEventListener('loadedmetadata', mountReadyVideo, true);
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            scheduleProviderContentErrorCheck();
            startPlayerObservation();
        }, { once: true });
    } else {
        scheduleProviderContentErrorCheck();
        // Let the owned classic dependencies and document-end bootstrap settle
        // before mounting a video that already has a source.
        Promise.resolve().then(() => startPlayerObservation());
    }



    // Listen for messages from parent extension
    window.addEventListener('message', (event) => {
        if (!isTrustedHostMessage(event)) return;
        
        if (event.data.type === 'PAUSE') {
            console.log('[MovieExtension] Received PAUSE command from parent');
            const video = permanentVideo || document.querySelector('video');
            if (video) {
                if (!video.paused) {
                    video.pause();
                    console.log('[MovieExtension] Video paused by command');
                } else {
                    console.log('[MovieExtension] Video already paused');
                }
                
                // Send confirmation back to parent
                if (event.source) {
                    event.source.postMessage({ type: 'PAUSED_CONFIRMATION' }, event.origin);
                }
            } else {
                 console.warn('[MovieExtension] No video element found to pause');
            }
        }
    });

})();


// ─── GHOST PLAYER CLASS ───
