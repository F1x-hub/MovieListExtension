// player-cleaner.js - Replaces third-party player UI with native video player
(function() {
    'use strict';
    

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
    let hlsInstance = null;
    let lastRealSource = null;
    let activePlaybackRetry = null;
    let activeRequestGuard = () => true;
    let activeWrapperListenerScope = null;
    let activeWrapper = null;
    let observerRoot = null;
    let pendingActiveEpisodeLabel = null; // Track clicked episode label
    let structuredPlaybackState = null; // Structured provider playback state (Phase 5B)
    let canonicalPickerRequested = false;
    let providerContentErrorReported = false;
    let roomSyncSubscriptionId = null;
    let roomSyncTelemetryVideo = null;
    let roomSyncTelemetryDisposers = [];
    let lastRoomSyncTimeupdateAt = 0;
    // The room bridge is deliberately timeline-only. Do not add player
    // preferences (audio, subtitles, quality, volume, speed) to this protocol.
    const ROOM_SYNC_TIMELINE_ACTIONS = new Set(['play', 'pause', 'seek']);
    
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
        window.parent?.postMessage({
            type: 'PLAYER_SOURCE_STATE',
            state: 'error',
            reason: 'provider-content-not-found',
            providerId: 'kinogo',
            url: window.location.href
        }, '*');
        return true;
    };

    const scheduleProviderContentErrorCheck = () => {
        [0, 250, 750, 1500].forEach(delay => {
            setTimeout(reportProviderContentError, delay);
        });
    };

    const applyCanonicalPickerVisibility = () => {
        const legacyButtons = document.querySelectorAll('.episode-list-btn');
        const nativeNavigationButtons = document.querySelectorAll('.provider-native-episode-nav');
        const buttons = [...legacyButtons, ...nativeNavigationButtons];
        buttons.forEach(button => {
            if (!button.dataset.canonicalPickerDisplay) {
                button.dataset.canonicalPickerDisplay = button.style.display || '';
            }
            button.style.display = canonicalPickerRequested
                ? 'none'
                : button.dataset.canonicalPickerDisplay;
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
        window.parent?.postMessage({
            type: 'ROOM_SYNC_TELEMETRY',
            subscriptionId: roomSyncSubscriptionId,
            kind,
            observedAtMs: now,
            ...roomSyncSnapshot(),
        }, '*');
    }

    function attachRoomSyncTelemetry() {
        const video = getRoomSyncVideo();
        if (!video || roomSyncTelemetryVideo === video) return;
        clearRoomSyncTelemetry();
        roomSyncTelemetryVideo = video;
        ['loadedmetadata', 'play', 'pause', 'seeking', 'seeked', 'ended', 'timeupdate'].forEach(kind => {
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
        if (event.data?.type === 'RESET_PERMANENT_VIDEO') {
            if (hlsInstance) {
                try { hlsInstance.destroy?.(); } catch { /* ignore */ }
                hlsInstance = null;
            }
            setPermanentVideo(null);
            activeWrapper = null;
        } else if (event.data?.type === 'SEASONVAR_PLAYBACK_STATE') {
            structuredPlaybackState = event.data;
        } else if (event.data?.type === 'SET_CANONICAL_PICKER_MODE') {
            canonicalPickerRequested = Boolean(event.data.enabled);
            const visibility = scheduleCanonicalPickerVisibility();
            console.info('[ExFsBridgeTrace] cleaner picker mode received', {
                enabled: canonicalPickerRequested,
                location: window.location.href.split('?')[0],
                hostname: window.location.hostname,
                ...visibility
            });
        } else if (event.data?.type === 'APPLY_PLAYBACK_SELECTION') {
            const request = event.data;
            console.info('[ExFsBridgeTrace] cleaner selection message received', {
                requestId: request.requestId,
                providerId: request.providerId || null,
                seasonNumber: request.seasonNumber,
                episodeNumber: request.episodeNumber,
                location: window.location.href.split('?')[0],
                hostname: window.location.hostname
            });
            const dispatchResult = async () => {
                const applySelection = window.movieExtension_applySelection
                    || window.movieExtension_restoreProgress;
                console.info('[ExFsBridgeTrace] cleaner selection handler lookup', {
                    requestId: request.requestId,
                    handler: typeof window.movieExtension_applySelection === 'function'
                        ? 'movieExtension_applySelection'
                        : typeof window.movieExtension_restoreProgress === 'function'
                            ? 'movieExtension_restoreProgress'
                            : 'none'
                });
                if (typeof applySelection !== 'function') return false;
                try {
                    return await Promise.resolve(applySelection(
                        request.seasonNumber,
                        request.episodeNumber,
                        request.providerId || null
                    )) !== false;
                } catch (error) {
                    console.warn('[PlayerCleaner] Native selection dispatch failed:', error);
                    return false;
                }
            };
            const acknowledge = (status, reason) => {
                const response = {
                    type: 'PLAYBACK_SELECTION_RESULT',
                    requestId: request.requestId,
                    status,
                    reason,
                    seasonNumber: request.seasonNumber,
                    episodeNumber: request.episodeNumber
                };
                try {
                    event.source?.postMessage(response, event.origin || '*');
                } catch {
                    window.parent?.postMessage(response, '*');
                }
                console.info('[ExFsBridgeTrace] cleaner selection result sent', {
                    requestId: request.requestId,
                    status,
                    reason
                });
            };
            let attemptsLeft = 8;
            const tryDispatch = async () => {
                if (await dispatchResult()) {
                    console.log('[PlayerCleaner] Native selection dispatched', {
                        requestId: request.requestId,
                        seasonNumber: request.seasonNumber,
                        episodeNumber: request.episodeNumber
                    });
                    acknowledge('DISPATCHED', 'provider-native-selector');
                    return;
                }
                if (attemptsLeft-- > 0) {
                    setTimeout(() => { void tryDispatch(); }, 200);
                    return;
                }
                acknowledge('UNAVAILABLE', 'provider-native-selector-not-ready');
            };
            void tryDispatch();
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
        activePlaybackRetry?.cancel?.();
        activePlaybackRetry = null;
        activeWrapperListenerScope?.dispose?.();
        activeWrapperListenerScope = null;
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

    function makeKeyboardActivatable(element, label) {
        if (!element) return;
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        if (label) element.setAttribute('aria-label', label);
        element.classList.add('player-keyboard-action');
        element.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
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
                if (path) path.setAttribute('fill', active ? '#4da6ff' : '#fff');
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

    function setCleanerSourceState(video, state, options = {}) {
        const lifecycle = window.PlayerSourceLifecycle;
        const container = video?.closest?.('.player-clean, .native-player-wrapper, .video-wrapper')
            || video?.parentElement;
        if (lifecycle && container) lifecycle.setState(container, state, options);
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
        emit(states.LOADING, { reason: 'start' });
        attemptPlay();

        return {
            promise,
            cancel() {
                finish(states.CANCELLED, { reason: 'cancelled' });
            }
        };
    }

    // Function to change video source while preserving state
    function changeVideoSource(newSrc, autoPlay = true) {
        if (!permanentVideo || !newSrc) return;
        
        lastRealSource = newSrc; // Update tracker
        console.log('[MovieExtension] Changing video source to:', newSrc);
        
        // Save current state
        const currentState = {
            volume: permanentVideo.volume,
            playbackRate: permanentVideo.playbackRate,
            muted: permanentVideo.muted,
            activeSubtitle: null
        };
        
        // Stop previous loading if any
        try {
            permanentVideo.pause();
        } catch {
            // Ignore pause error
        }
        
        // Find active subtitle track
        const tracks = Array.from(permanentVideo.textTracks || []);
        const activeTrack = tracks.find(t => t.mode === 'showing');
        if (activeTrack) {
            currentState.activeSubtitle = {
                label: activeTrack.label,
                language: activeTrack.language
            };
        }
        
        // Handle different source types
        if (newSrc.includes('.m3u8')) {
            // HLS stream
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                if (!hlsInstance) {
                    hlsInstance = new Hls();
                    hlsInstance.attachMedia(permanentVideo);
                }
                hlsInstance.loadSource(newSrc);
            } else if (permanentVideo.canPlayType('application/vnd.apple.mpegurl')) {
                // Native HLS support (Safari)
                permanentVideo.src = newSrc;
                permanentVideo.load();
            }
        } else {
            // Regular video file or blob URL
            permanentVideo.src = newSrc;
            // Catch load errors
            try {
                permanentVideo.load(); 
            } catch {
                console.log('[MovieExtension] Load interrupted (expected)');
            }
        }
        
        // Restore state after load
        permanentVideo.volume = currentState.volume;
        permanentVideo.playbackRate = currentState.playbackRate;
        permanentVideo.muted = currentState.muted;
        
        // Auto-play if requested
        if (autoPlay) {
            activePlaybackRetry?.cancel?.();
            const targetVideo = permanentVideo;
            activePlaybackRetry = tryPlayWithLimit(targetVideo, {
                maxAttempts: 40,
                intervalMs: 100,
                isRequestCurrent: () => activeRequestGuard(),
                isSourceCurrent: () => permanentVideo === targetVideo && lastRealSource === newSrc,
                onState: (state, detail) => {
                    if (!activeRequestGuard() || permanentVideo !== targetVideo || lastRealSource !== newSrc) return;
                    setCleanerSourceState(targetVideo, state, {
                        onRetry: state === 'error' || state === 'unavailable'
                            ? () => changeVideoSource(newSrc, true)
                            : null
                    });
                    if (state === 'error' || state === 'unavailable') {
                        const stateMessage = {
                            type: 'PLAYER_SOURCE_STATE',
                            state,
                            url: newSrc,
                            reason: detail.reason
                        };
                        window.postMessage(stateMessage, '*');
                        if (window.parent && window.parent !== window) {
                            window.parent.postMessage(stateMessage, '*');
                        }
                    }
                }
            });
        }
        
        // Restore subtitles after metadata loads
        if (currentState.activeSubtitle) {
            permanentVideo.addEventListener('loadedmetadata', () => {
                const newTracks = Array.from(permanentVideo.textTracks || []);
                const matchingTrack = newTracks.find(t => 
                    t.label === currentState.activeSubtitle.label ||
                    t.language === currentState.activeSubtitle.language
                );
                if (matchingTrack) {
                    newTracks.forEach(t => t.mode = 'disabled');
                    matchingTrack.mode = 'showing';
                }
            }, { once: true });
        }
        
        console.log('[MovieExtension] Video source changed, state preserved');
    }

    // BUG 3 FIX: Listen for reset signal from extension page when switching sources
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'RESET_PERMANENT_VIDEO') {
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
            tryPlayWithLimit,
            createListenerScope,
            activateWrapperListenerScope,
            teardownActiveWrapper,
            getPlayerObservationRoot,
            mutationsWithinRoot,
            cleanupCleanerOwnedIframes
        }
    };

    function replacePlayer(lifecycleOptions = {}) {
        if (typeof lifecycleOptions.isRequestCurrent === 'function') {
            activeRequestGuard = lifecycleOptions.isRequestCurrent;
        }
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

        if (!isInsideExtension) {
            return;
        }

        // Count all players in the entire document
        // EARLY EXIT: If we already have a permanentVideo and it's inside our wrapper, we're done
        // BUG 2 FIX: Also verify the element is actually in the document (not detached)
        if (permanentVideo 
            && document.contains(permanentVideo) 
            && permanentVideo.closest('.native-player-wrapper')) {
            // Before exiting, check if the site spawned a NEW video outside our wrapper
            const outsideVideo = document.querySelector('video:not(.native-player-wrapper video):not(.ghost-video)');
            if (!outsideVideo || (!outsideVideo.src && !outsideVideo.currentSrc)) {
                return;
            }
            
            // Validate: don't proceed to swap if the outside video has a non-media src
            const outsideSrc = outsideVideo.src || outsideVideo.currentSrc || '';
            if (outsideSrc && !isValidMediaSrc(outsideSrc)) {
                return;
            }
            
            // Don't downgrade from a working blob: src to a non-blob src
            const currentPermanentSrc = permanentVideo.src || permanentVideo.currentSrc || '';
            if (isValidMediaSrc(currentPermanentSrc) && currentPermanentSrc.startsWith('blob:') && !outsideSrc.startsWith('blob:')) {
                return;
            }
        }

        // Check if player already exists
        const existingWrapper = document.querySelector('.native-player-wrapper');
        if (existingWrapper && permanentVideo) {
            // Player already initialized, check for new video from site
            const siteVideo = document.querySelector('video:not(.native-player-wrapper video)');
            if (siteVideo && siteVideo.src) {
                const newSrc = siteVideo.src || siteVideo.currentSrc || '';
                
                // Validate: skip swap if new video has non-media src (e.g. embed page URL)
                if (!isValidMediaSrc(newSrc)) {
                    return;
                }
                
                // Don't downgrade from a working blob: src to a non-blob src
                const currentSrc = permanentVideo.src || permanentVideo.currentSrc || '';
                if (isValidMediaSrc(currentSrc) && currentSrc.startsWith('blob:') && !newSrc.startsWith('blob:')) {
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
                    localStorage.removeItem('movieExtension_autoplay_next');
                    permanentVideo.play().catch(e => {
                        if (e.name !== 'AbortError') console.log('[MovieExtension] Autoplay next failed:', e);
                    });
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
        const siteVideo = document.querySelector('video');
        
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
        
        if (!siteVideo.src && !siteVideo.currentSrc && siteVideo.querySelectorAll('source').length === 0) {
            return; // Video has no source
        }
        
        // Filter out video elements with non-media src (e.g. embed page URLs)
        const candidateSrc = siteVideo.src || siteVideo.currentSrc || '';
        if (candidateSrc && !isValidMediaSrc(candidateSrc)) {
            return;
        }
        
        // Extract source from site's video
        const initialSrc = siteVideo.src || siteVideo.currentSrc || (siteVideo.querySelector('source') ? siteVideo.querySelector('source').src : '');
        
        if (!initialSrc) {
            return; // No valid source
        }
        
        // IMPORTANT: Use site's original video element as our permanent element
        // This is critical for blob: URLs which are tied to the specific element
        setPermanentVideo(siteVideo);
        lastRealSource = siteVideo.src || siteVideo.currentSrc; // Initial source track
        
        // Configure the existing video element
        permanentVideo.removeAttribute('controls'); // Remove native controls
        permanentVideo.autoplay = true;
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
            centerPlayBtn.setAttribute('aria-label', 'Воспроизвести или поставить на паузу');
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
            centerPlayBtn.style.transition = 'opacity 160ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)';
            centerPlayBtn.style.backdropFilter = 'blur(16px) saturate(130%)';
            centerPlayBtn.style.boxShadow = '0 18px 48px rgba(0, 0, 0, 0.45), inset 0 1px rgba(255, 255, 255, 0.08)';
            makeKeyboardActivatable(centerPlayBtn, 'Воспроизвести или поставить на паузу');

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
            
            // Inject Dynamic Styles for Subtitles
            const subParams = document.createElement('style');
            subParams.textContent = `
                /* Move subtitles up when controls are visible */
                .native-player-wrapper.controls-visible video::-webkit-media-text-track-display {
                    transform: translateY(-80px) !important;
                    transition: transform 0.3s ease !important;
                }
                /* Reset when controls hidden */
                .native-player-wrapper:not(.controls-visible) video::-webkit-media-text-track-display {
                    transform: translateY(0) !important;
                    transition: transform 0.3s ease !important;
                }

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
                    transform: translateX(1px);
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
                    transition: opacity 180ms ease, transform 180ms cubic-bezier(.23, 1, .32, 1) !important;
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
                    transform: translateX(1px);
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
                    max-height: min(360px, calc(100vh - 110px));
                    padding: 6px !important;
                    overflow: hidden;
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
                    bottom: 42px !important;
                    width: 38px !important;
                    --popover-surface-radius: 12px;
                    --popover-surface-shadow: 0 16px 36px rgba(0, 0, 0, .42);
                    --popover-surface-backdrop: blur(16px);
                }
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
                    position:        fixed;
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
                .ghost-video {
                    width:         200px;
                    height:        112px;
                    object-fit:    cover;
                    border-radius: 6px;
                    border:        1.5px solid rgba(255,255,255,.15);
                    background:    #111;
                    display:       block;
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
            bottomControls.style.transform = 'translateY(8px)';
            bottomControls.style.transition = 'opacity 180ms ease, transform 180ms cubic-bezier(0.23, 1, 0.32, 1)';
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

            const getProgressKey = () => {
                let key = 'movieExtension_progress_' + window.location.pathname.replace(/\W/g, '_');
                const info = getActiveSeriesInfo();
                if (info.season) key += '_' + info.season.replace(/\s+/g, '');
                if (info.episode) key += '_' + info.episode.replace(/\s+/g, '');
                return key;
            };
            
            const saveProgress = () => {
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
                localStorage.removeItem(getProgressKey());
            });
            // --- PERSISTENT PROGRESS END ---

            progressContainer.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                const rect = progressContainer.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const width = rect.width;
                const percent = Math.max(0, Math.min(1, clickX / width));
                
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
                bottomControls.style.transform = shouldShow ? 'translateY(0)' : 'translateY(8px)';
                bottomControls.style.pointerEvents = shouldShow ? 'auto' : 'none';
                
                // Toggle class for CSS-based subtitle movement
                if (shouldShow) {
                    newContainer.classList.add('controls-visible');
                } else {
                    newContainer.classList.remove('controls-visible');
                }
                
                // Update center button visibility
                // Hide center button if loading
                centerPlayBtn.style.opacity = (shouldShow && !isLoading) ? opacity : '0';

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
            listenerScope.listen(document, 'keydown', (e) => {
                // Ensure player is active
                if (!document.body.contains(newContainer)) return;

                resetInactivityTimer();
                
                 // Method 3: Global keydown handler to ensure shortcuts work
                // regardless of what element is focused (buttons, etc.)
                const currentVid = permanentVideo || video;
                if (!currentVid) return;

                // Ignore if user is typing in an input
                if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

                switch(e.key) {
                    case 'ArrowLeft':
                        e.preventDefault();
                        e.stopPropagation();
                        if (Number.isFinite(currentVid.duration)) {
                             currentVid.currentTime = Math.max(0, currentVid.currentTime - 5);
                             // Trigger timeupdate manually or wait for event? Event will fire.
                             // But for instant update if paused:
                             if (typeof updateTime === 'function') updateTime();
                             
                             // Show progress bar update?
                             if (progressFilled) {
                                  const percent = (currentVid.currentTime / currentVid.duration) * 100;
                                  progressFilled.style.width = `${percent}%`;
                             }
                        }
                        break;
                    case 'ArrowRight':
                         e.preventDefault();
                         e.stopPropagation();
                         if (Number.isFinite(currentVid.duration)) {
                             currentVid.currentTime = Math.min(currentVid.duration, currentVid.currentTime + 5);
                             if (typeof updateTime === 'function') updateTime();
                              if (progressFilled) {
                                  const percent = (currentVid.currentTime / currentVid.duration) * 100;
                                  progressFilled.style.width = `${percent}%`;
                             }
                        }
                         break;
                    case ' ':
                    case 'Space': 
                        e.preventDefault();
                        e.stopPropagation();
                        if (currentVid.paused) currentVid.play().catch(()=>{});
                        else currentVid.pause();
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        e.stopPropagation();
                         if (currentVid.volume < 1) {
                             currentVid.volume = Math.min(1, currentVid.volume + 0.1);
                             currentVid.muted = false;
                         }
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        e.stopPropagation();
                         if (currentVid.volume > 0) currentVid.volume = Math.max(0, currentVid.volume - 0.1);
                        break;
                     case 'f':
                     case 'F':
                        e.preventDefault();
                        e.stopPropagation();
                        if (typeof toggleFullscreen === 'function') toggleFullscreen();
                        break;
                }
            });

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
                
                if (currentVid.paused) {
                    // Bottom Btn: Play
                    playPauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>';
                    // Center Btn: Play (Large)
                    centerPlayBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>';
                } else {
                    // Bottom Btn: Pause
                    playPauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
                    // Center Btn: Pause (Large)
                    centerPlayBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
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
                        const seasonNum = structuredPlaybackState?.activeSeasonNumber ?? null;
                        const epNum = structuredPlaybackState?.activeEpisodeNumber ?? (episodeLabel ? parseInt(String(episodeLabel).replace(/\D+/g, ''), 10) : null);
                        const currentSeasonLabel = seasonNum ? `${seasonNum} сезон` : '';
                        const epLabel = episodeLabel || (epNum ? `${epNum} серия` : '');
                        
                        const ts = (typeof previousTimestamp === 'number' && previousTimestamp > 0) 
                            ? Math.floor(previousTimestamp) 
                            : 0;
                        
                        console.log('[MovieExtension] Sending progress update:', currentSeasonLabel, epLabel, 'timestamp:', ts);
                        
                        window.parent.postMessage({
                            type: 'UPDATE_WATCHING_PROGRESS',
                            season: currentSeasonLabel,
                            seasonNumber: seasonNum,
                            episode: epLabel,
                            episodeNumber: epNum,
                            timestamp: ts
                        }, '*');
                        
                        window.parent.postMessage({
                            type: 'EPISODE_CHANGED',
                            episode: epNum || 1,
                            episodeLabel: epLabel,
                            season: currentSeasonLabel,
                            seasonNumber: seasonNum,
                            origin: 'USER_PROVIDER_SELECTION'
                        }, '*');
                        
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
                    episodeDropdown = createEpisodeNavigationState(seriesData.episodes, seriesData.seasons || [], 'Серия', (selectedItem) => {

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
            timeDisplay.style.zIndex = '2'; // Ensure visibility
            timeDisplay.style.position = 'relative';

            const formatTime = (seconds) => {
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = Math.floor(seconds % 60);
                return (h > 0 ? h + ':' : '') + (m < 10 && h > 0 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
            };
            // --- Auto-Play Logic ---
            const checkAutoPlay = () => {
                const autoPlayFlag = localStorage.getItem('movieExtension_autoplay_next');
                if (autoPlayFlag === 'true') {
                    localStorage.removeItem('movieExtension_autoplay_next');
                    
                    let isPlayPending = false;
                    const attemptPlay = () => {
                        if (isPlayPending) return;
                        isPlayPending = true;
                        
                        const p = video.play();
                        if (p && p.catch) {
                            p.catch(e => { /* ignore */ })
                             .finally(() => { isPlayPending = false; });
                        } else {
                            isPlayPending = false;
                        }
                    };

                    // Aggressive polling to start as soon as possible
                    const interval = setInterval(() => {
                        if (!video.paused) {
                            clearInterval(interval);
                            // Log Performance
                            const startTime = localStorage.getItem('movieExtension_autoplay_start_time');
                            if (startTime) {
                                const duration = Date.now() - parseInt(startTime, 10);
                            console.log(`[MovieExtension] Auto-play latency: ${duration}ms`);
                                localStorage.removeItem('movieExtension_autoplay_start_time');
                            }
                            return;
                        }
                        // Increase readyState requirement to 3 (HAVE_FUTURE_DATA) to avoid HLS buffering pauses
                        if (video.readyState >= 3) { 
                           attemptPlay();
                        }
                    }, 100);

                    // Stop trying after 5 seconds to prevent infinite loops
                    setTimeout(() => clearInterval(interval), 5000);
                }
            };
            // Check immediately on new player init
            checkAutoPlay();

            const updateTime = () => {
                const current = video.currentTime || 0;
                const total = video.duration || 0;
                timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
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
                        
                        window.parent.postMessage(progressData, '*');
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
            
            if (seriesData.hasSeries) {
                const prevEpisodeBtn = document.createElement('button');
                const nextEpisodeBtn = document.createElement('button');
                
                // Common styles
                [prevEpisodeBtn, nextEpisodeBtn].forEach(btn => {
                    btn.classList.add('provider-native-episode-nav');
                    btn.style.background = 'none';
                    btn.style.border = 'none';
                    btn.style.cursor = 'pointer';
                    btn.style.color = 'white';
                    btn.style.padding = '5px';
                    btn.style.display = 'flex'; 
                    btn.style.alignItems = 'center';
                    btn.style.justifyContent = 'center';
                    btn.style.opacity = '1';
                    btn.style.transition = 'opacity 0.2s, color 0.2s';
                    btn.style.position = 'relative'; // For tooltip
                });
    
                // Icons
                prevEpisodeBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
                nextEpisodeBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
    
                // Tooltips
                const createTooltip = (text) => {
                    const el = document.createElement('div');
                    el.textContent = text;
                    el.style.position = 'absolute';
                    el.style.bottom = '100%';
                    el.style.left = '50%';
                    el.style.transform = 'translate(-50%, -10px)';
                    el.style.background = 'rgba(0,0,0,0.8)';
                    el.style.color = 'white';
                    el.style.padding = '4px 8px';
                    el.style.borderRadius = '4px';
                    el.style.fontSize = '12px';
                    el.style.whiteSpace = 'nowrap';
                    el.style.pointerEvents = 'none';
                    el.style.opacity = '0';
                    el.style.transition = 'opacity 0.2s';
                    return el;
                };
    
                const prevTooltip = createTooltip('');
                const nextTooltip = createTooltip('');
                prevEpisodeBtn.appendChild(prevTooltip);
                nextEpisodeBtn.appendChild(nextTooltip);
    
                // Hover effects
                const setupHover = (btn, tooltip) => {
                    btn.addEventListener('mouseenter', () => {
                        if (!btn.disabled) {
                            btn.style.color = '#4da6ff'; // Active color
                            tooltip.style.opacity = '1';
                        }
                    });
                    btn.addEventListener('mouseleave', () => {
                        btn.style.color = 'white';
                        tooltip.style.opacity = '0';
                    });
                };
                setupHover(prevEpisodeBtn, prevTooltip);
                setupHover(nextEpisodeBtn, nextTooltip);
    
                // Logic to update buttons
                updateNavButtons = () => {
                    if (canonicalPickerRequested) {
                        prevEpisodeBtn.style.display = 'none';
                        nextEpisodeBtn.style.display = 'none';
                        return;
                    }
                    // Check if we have episodes
                    if (episodeDropdown && typeof episodeDropdown.getNavState === 'function') {
                        const state = episodeDropdown.getNavState();
                        
                        // Prev Button State
                        if (state.hasPrev) {
                            prevEpisodeBtn.disabled = false;
                            prevEpisodeBtn.style.opacity = '1';
                            prevEpisodeBtn.style.cursor = 'pointer';
                            prevTooltip.textContent = `Назад: ${state.prevItem.label}`;
                        } else {
                            prevEpisodeBtn.disabled = true;
                            prevEpisodeBtn.style.opacity = '0.3';
                            prevEpisodeBtn.style.cursor = 'default';
                            prevTooltip.textContent = '';
                        }
    
                        // Next Button State
                        if (state.hasNext) {
                            nextEpisodeBtn.disabled = false;
                            nextEpisodeBtn.style.opacity = '1';
                            nextEpisodeBtn.style.cursor = 'pointer';
                            nextTooltip.textContent = `Вперед: ${state.nextItem.label}`;
                        } else {
                            nextEpisodeBtn.disabled = true;
                            nextEpisodeBtn.style.opacity = '0.3';
                            nextEpisodeBtn.style.cursor = 'default';
                            nextTooltip.textContent = '';
                        }
                    }
                };
    
                // Actions
                prevEpisodeBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (canonicalPickerRequested) return;
                    if (permanentVideo) permanentVideo.focus(); // Fix focus
                    if (episodeDropdown && typeof episodeDropdown.navigate === 'function') {
                        episodeDropdown.navigate(-1);
                        updateNavButtons();
                    }
                };
                nextEpisodeBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (canonicalPickerRequested) return;
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
            const applyKinogoProviderSelection = async (targetSeason, targetEpisode) => {
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
            const applyNativeProviderSelection = async (targetSeason, targetEpisode) => {
                const listContainer = document.querySelector('div[class*="controls_"] div[class*="list_"]')
                    || document.querySelector('div[class*="list_"]');
                const getDropdowns = () => Array.from(
                    listContainer?.querySelectorAll?.('div[class*="dropdown_"]') || []
                );
                const getItems = dropdown => Array.from(
                    dropdown?.querySelectorAll?.('div[class*="item_"]') || []
                );
                const numberFromLabel = value => {
                    const match = String(value || '').match(/\d+/);
                    return match ? Number(match[0]) : null;
                };
                const clickExactItem = (dropdown, number, suffix) => {
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
                    if (!item) return false;
                    item.click();
                    console.info('[ExFsBridgeTrace] cleaner provider item clicked', {
                        targetNumber: Number(number),
                        suffix,
                        label: String(item.textContent || '').trim()
                    });
                    return true;
                };
                const waitFor = async (predicate, attempts = 24, delayMs = 150) => {
                    for (let attempt = 0; attempt < attempts; attempt += 1) {
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

                const seasonChanged = clickExactItem(seasonDropdown, targetSeason, 'сезон');
                const selectEpisode = () => clickExactItem(
                    getDropdowns()[1] || episodeDropdownElement,
                    targetEpisode,
                    'серия'
                );

                if (!seasonChanged) return selectEpisode();
                // React/Vue providers rebuild the episode menu after a season
                // click; resolve the new menu before selecting the episode.
                const episodeClicked = await waitFor(selectEpisode);
                console.info('[KinoGoBridgeTrace] class bridge episode confirmation', {
                    targetSeason: Number(targetSeason),
                    targetEpisode: Number(targetEpisode),
                    confirmed: Boolean(episodeClicked)
                });
                return Boolean(episodeClicked);
            };

            window.movieExtension_applySelection = async (targetSeason, targetEpisode, providerId = null) => {
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
                        targetEpisode
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
                const dispatched = applyNativeProviderSelection(targetSeason, targetEpisode);
                if (dispatched) {
                    console.log('[MovieExtension] Native provider selection clicked:', {
                        season: targetSeason,
                        episode: targetEpisode
                    });
                    return true;
                }
                if (typeof window.movieExtension_restoreProgress === 'function') {
                    window.movieExtension_restoreProgress(targetSeason, targetEpisode);
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
            volumeContainer.className = 'player-volume-control';
            volumeContainer.style.position = 'relative';
            volumeContainer.style.display = 'flex';
            volumeContainer.style.alignItems = 'center';
            volumeContainer.style.cursor = 'pointer';

            const volumeBtn = document.createElement('button');
            volumeBtn.className = 'player-control-button';
            volumeBtn.style.background = 'none';
            volumeBtn.style.border = 'none';
            volumeBtn.style.cursor = 'pointer';
            volumeBtn.style.color = 'white';
            volumeBtn.style.padding = '5px';
            volumeBtn.style.display = 'flex';
            volumeBtn.style.alignItems = 'center';
            volumeBtn.style.justifyContent = 'center'; // Center icon
            volumeBtn.style.width = '40px'; // Fixed width to prevent jumps
            volumeBtn.style.height = '40px'; 

            const volHighIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
            const volLowIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
            const volMuteIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';

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
            sliderContainer.style.position = 'absolute';
            sliderContainer.style.left = '50%';
            sliderContainer.style.transform = 'translateX(-50%)';
            sliderContainer.style.height = '100px';
            sliderContainer.style.padding = '12px 0';
            sliderContainer.style.display = 'none'; 
            sliderContainer.style.flexDirection = 'column';
            sliderContainer.style.alignItems = 'center';
            sliderContainer.style.justifyContent = 'center';
            sliderContainer.style.cursor = 'default'; // Don't inherit pointer
            sliderContainer.style.zIndex = '2147483643';

            const volTrack = document.createElement('div');
            volTrack.className = 'player-volume-track';
            volTrack.style.width = '4px';
            volTrack.style.height = '80px';
            volTrack.style.backgroundColor = 'rgba(255,255,255,0.2)';
            volTrack.style.borderRadius = '2px';
            volTrack.style.position = 'relative';
            volTrack.style.cursor = 'pointer';

            const volFill = document.createElement('div');
            volFill.style.position = 'absolute';
            volFill.style.bottom = '0';
            volFill.style.left = '0';
            volFill.style.width = '100%';
            volFill.style.height = (video.volume * 100) + '%';
            volFill.style.backgroundColor = '#f4f4f5';
            volFill.style.borderRadius = '2px';
            
            const volKnob = document.createElement('div');
            volKnob.style.width = '12px';
            volKnob.style.height = '12px';
            volKnob.style.backgroundColor = '#f4f4f5';
            volKnob.style.borderRadius = '50%';
            volKnob.style.position = 'absolute';
            volKnob.style.top = '0'; // Relative to fill top
            volKnob.style.left = '50%';
            volKnob.style.transform = 'translate(-50%, -50%)';
            
            volFill.appendChild(volKnob);
            volTrack.appendChild(volFill);
            sliderContainer.appendChild(volTrack);
            volumeContainer.appendChild(sliderContainer);

            // Volume Interactions
            // Load saved volume from localStorage
            const VOLUME_STORAGE_KEY = 'movieExtension_videoVolume';
            
            let intendedVolume = 1; // Default
            let lastVolume = 1; 
            let isEnforcing = false;

            // Helper to set volume safely and enforce it
            const setVolumeSafe = (vol, isMuted) => {
                isEnforcing = true;
                intendedVolume = vol;
                
                // Set state on current video
                if (permanentVideo) {
                    permanentVideo.volume = vol;
                    permanentVideo.muted = isMuted;
                }
                
                // Save to localStorage
                localStorage.setItem(VOLUME_STORAGE_KEY, vol.toString());
                
                // Update UI immediately
                updateVolumeUI();

                setTimeout(() => { isEnforcing = false; }, 50);
            };

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
                
                // Auto-Play & State logic
                const checkAutoPlay = () => {
                   const autoPlayFlag = localStorage.getItem('movieExtension_autoplay_next');
                   if (autoPlayFlag === 'true') {
                       localStorage.removeItem('movieExtension_autoplay_next');
                       videoEl.play().catch(() => {});
                   }
                };
                checkAutoPlay(); // Check on init

                const updateTime = () => {
                    const current = videoEl.currentTime || 0;
                    const total = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
                    timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
                    
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
                    if (!isEnforcing && (Math.abs(videoEl.volume - intendedVolume) > 0.01 || videoEl.muted !== (intendedVolume === 0))) {
                         if (videoEl.volume !== intendedVolume) {
                             videoEl.volume = intendedVolume;
                             videoEl.muted = (intendedVolume === 0);
                         }
                    }
                    updateVolumeUI();
                    e.stopImmediatePropagation();
                }, true);
            };

            // INITIAL SETUP
            
            // 1. Load Volume
            const savedVolume = localStorage.getItem(VOLUME_STORAGE_KEY);
            if (savedVolume !== null) {
                const vol = parseFloat(savedVolume);
                if (!isNaN(vol) && vol >= 0 && vol <= 1) {
                    permanentVideo.volume = vol;
                    permanentVideo.muted = (vol === 0);
                    intendedVolume = vol;
                }
            }
            // Update UI initially
            updateVolumeUI();
            
            // 2. Attach listeners to initial video
            setupVideoListeners(permanentVideo);
            
            // Expose for swap logic
            window._movieExtension_setupListeners = setupVideoListeners;

            volumeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                if (permanentVideo.muted || permanentVideo.volume === 0) {
                    setVolumeSafe(lastVolume || 1, false);
                } else {
                    lastVolume = permanentVideo.volume > 0 ? permanentVideo.volume : 1;
                    setVolumeSafe(0, true);
                }
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

            // --- EPISODE LIST BUTTON ---
            if (episodeDropdown && seriesData.hasSeries) {
                const episodeListBtn = document.createElement('button');
                episodeListBtn.className = 'episode-list-btn player-control-button';
                episodeListBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" height="26px" width="26px" version="1.1" id="Capa_1" viewBox="0 0 261.791 261.791" xml:space="preserve"><><path style="fill:#ffffff;" d="M213.02,58.899h-59.203l48-45.983c2.991-2.866,3.093-7.613,0.227-10.604   c-2.866-2.991-7.613-3.093-10.604-0.227l-59.308,56.815h-0.533L88.83,17.557c-2.979-2.879-7.727-2.798-10.605,0.18   c-2.879,2.978-2.798,7.726,0.18,10.605l31.612,30.558H48.771c-12.407,0-22.5,10.093-22.5,22.5v134.764   c0,12.407,10.093,22.5,22.5,22.5H213.02c12.406,0,22.5-10.093,22.5-22.5V81.399C235.52,68.993,225.426,58.899,213.02,58.899z    M220.52,216.163c0,4.135-3.364,7.5-7.5,7.5H48.771c-4.135,0-7.5-3.365-7.5-7.5V81.399c0-4.135,3.365-7.5,7.5-7.5H213.02   c4.136,0,7.5,3.365,7.5,7.5V216.163z"/>	</g></svg>`;
                episodeListBtn.style.background = 'none';
                episodeListBtn.style.border = 'none';
                episodeListBtn.style.cursor = 'pointer';
                episodeListBtn.style.padding = '5px';
                episodeListBtn.style.width = '40px'; 
                episodeListBtn.style.height = '40px';
                episodeListBtn.style.opacity = '0.7'; 
                episodeListBtn.style.display = 'flex';
                episodeListBtn.style.alignItems = 'center';
                episodeListBtn.style.justifyContent = 'center';
                episodeListBtn.style.color = 'white'; // FIX: Ensure icon is white initially
                episodeListBtn.title = 'Список серий';
                if (canonicalPickerRequested) {
                    episodeListBtn.style.display = 'none';
                }
                
                episodeListBtn.addEventListener('mouseenter', () => {
                    episodeListBtn.style.opacity = '1';
                    episodeListBtn.style.color = '#4da6ff'; // Highlight color
                });
                episodeListBtn.addEventListener('mouseleave', () => {
                    episodeListBtn.style.opacity = '0.7';
                    episodeListBtn.style.color = 'white';
                });
                
                episodeListBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (permanentVideo) permanentVideo.focus(); // Fix focus
                    if (episodeDropdown.toggle) episodeDropdown.toggle();
                });
                
                rightControls.appendChild(episodeListBtn);
                applyCanonicalPickerVisibility();
            }

            // --- SUBTITLES BUTTON START ---
            const subtitlesBtn = document.createElement('button');
            subtitlesBtn.className = 'subtitles-toggle-btn player-control-button';
            subtitlesBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="#ffffffff" width="32px" height="32px" viewBox="0 0 512 512"><title>subtitles</title><path d="M96 416Q82 416 73 407 64 398 64 384L64 128Q64 114 73 105 82 96 96 96L416 96Q430 96 439 105 448 114 448 128L448 384Q448 398 439 407 430 416 416 416L96 416ZM176 296L176 256 112 256 112 296 176 296ZM400 296L400 256 208 256 208 296 400 296ZM304 368L304 328 112 328 112 368 304 368ZM400 368L400 328 336 328 336 368 400 368Z"/></svg>`;
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
            subtitlesBtn.title = 'Субтитры';
            
            // Subtitle Persistence Keys (Moved to shared scope)
            // const SUB_ENABLED_KEY = 'movieExtension_subs_enabled';
            // const SUB_TRACK_KEY = 'movieExtension_subs_track';

            const updateSubBtnState = (isEnabled) => {
                subtitlesBtn.style.opacity = isEnabled ? '1' : '0.7';
                const path = subtitlesBtn.querySelector('path');
                if (path) path.setAttribute('fill', isEnabled ? '#4da6ff' : '#fff');
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
                pipBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" x="0px" y="0px" viewBox="0 0 64 64" style="enable-background:new 0 0 64 64;" xml:space="preserve"><path fill="#ffffff" d="M55.156,30.219H33.781c-1.965,0-3.563,1.598-3.563,3.563v15.141c0,1.965,1.598,3.563,3.563,3.563h21.375  c1.965,0,3.563-1.598,3.563-3.563V33.781C58.719,31.817,57.121,30.219,55.156,30.219z M33.781,48.922V33.781h21.375l0.003,15.141  H33.781z"/><path fill="#ffffff" d="M27.851,17.139c-0.984,0-1.781,0.798-1.781,1.781v4.517l-5.776-5.776c-0.696-0.696-1.823-0.696-2.519,0  c-0.696,0.695-0.696,1.823,0,2.519l5.776,5.776h-4.517c-0.984,0-1.781,0.798-1.781,1.781c0,0.984,0.798,1.781,1.781,1.781h8.817  c0.117,0,0.234-0.012,0.349-0.035c0.053-0.01,0.102-0.03,0.153-0.045c0.06-0.018,0.121-0.032,0.18-0.056  c0.061-0.025,0.115-0.059,0.172-0.091c0.045-0.025,0.091-0.044,0.134-0.073c0.195-0.13,0.363-0.298,0.494-0.494  c0.03-0.044,0.05-0.093,0.075-0.139c0.03-0.055,0.064-0.109,0.088-0.167c0.025-0.06,0.039-0.122,0.057-0.183  c0.015-0.05,0.034-0.098,0.044-0.149c0.023-0.115,0.035-0.232,0.035-0.349V18.92C29.633,17.937,28.835,17.139,27.851,17.139z"/><path fill="#ffffff" d="M25.765,48.923H9.734c-0.491,0-0.891-0.399-0.891-0.891V15.969c0-0.491,0.399-0.891,0.891-0.891h44.531  c0.491,0,0.891,0.4,0.891,0.891v9.797c0,0.984,0.798,1.781,1.781,1.781c0.983,0,1.781-0.798,1.781-1.781v-9.797  c0.001-2.456-1.997-4.453-4.452-4.453H9.734c-2.455,0-4.453,1.998-4.453,4.453v32.063c0,2.455,1.998,4.453,4.453,4.453h16.031  c0.984,0,1.781-0.798,1.781-1.781C27.546,49.721,26.748,48.923,25.765,48.923z"/></svg>`;
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
                pipBtn.title = 'Картинка в картинке';

                pipBtn.addEventListener('mouseenter', () => {
                    if (!document.pictureInPictureElement) {
                        pipBtn.style.opacity = '1';
                        pipBtn.style.color = '#4da6ff';
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
                        pipBtn.style.color = '#4da6ff';
                        pipBtn.style.opacity = '1';
                        // Ensure button stays visible/highlighted
                        pipBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" x="0px" y="0px" viewBox="0 0 64 64" style="enable-background:new 0 0 64 64;" xml:space="preserve"><path fill="#ffffff" d="M55.156,30.219H33.781c-1.965,0-3.563,1.598-3.563,3.563v15.141c0,1.965,1.598,3.563,3.563,3.563h21.375  c1.965,0,3.563-1.598,3.563-3.563V33.781C58.719,31.817,57.121,30.219,55.156,30.219z M33.781,48.922V33.781h21.375l0.003,15.141  H33.781z"/><path fill="#ffffff" d="M27.851,17.139c-0.984,0-1.781,0.798-1.781,1.781v4.517l-5.776-5.776c-0.696-0.696-1.823-0.696-2.519,0  c-0.696,0.695-0.696,1.823,0,2.519l5.776,5.776h-4.517c-0.984,0-1.781,0.798-1.781,1.781c0,0.984,0.798,1.781,1.781,1.781h8.817  c0.117,0,0.234-0.012,0.349-0.035c0.053-0.01,0.102-0.03,0.153-0.045c0.06-0.018,0.121-0.032,0.18-0.056  c0.061-0.025,0.115-0.059,0.172-0.091c0.045-0.025,0.091-0.044,0.134-0.073c0.195-0.13,0.363-0.298,0.494-0.494  c0.03-0.044,0.05-0.093,0.075-0.139c0.03-0.055,0.064-0.109,0.088-0.167c0.025-0.06,0.039-0.122,0.057-0.183  c0.015-0.05,0.034-0.098,0.044-0.149c0.023-0.115,0.035-0.232,0.035-0.349V18.92C29.633,17.937,28.835,17.139,27.851,17.139z"/><path fill="#ffffff" d="M25.765,48.923H9.734c-0.491,0-0.891-0.399-0.891-0.891V15.969c0-0.491,0.399-0.891,0.891-0.891h44.531  c0.491,0,0.891,0.4,0.891,0.891v9.797c0,0.984,0.798,1.781,1.781,1.781c0.983,0,1.781-0.798,1.781-1.781v-9.797  c0.001-2.456-1.997-4.453-4.452-4.453H9.734c-2.455,0-4.453,1.998-4.453,4.453v32.063c0,2.455,1.998,4.453,4.453,4.453h16.031  c0.984,0,1.781-0.798,1.781-1.781C27.546,49.721,26.748,48.923,25.765,48.923z"/></svg>`;
                        window.parent.postMessage({ type: 'PIP_ENTER' }, '*');
                    } else {
                        pipBtn.style.color = 'white';
                        pipBtn.style.opacity = '0.7';
                        pipBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" x="0px" y="0px" viewBox="0 0 64 64" style="enable-background:new 0 0 64 64;" xml:space="preserve"><path fill="#ffffff" d="M55.156,30.219H33.781c-1.965,0-3.563,1.598-3.563,3.563v15.141c0,1.965,1.598,3.563,3.563,3.563h21.375  c1.965,0,3.563-1.598,3.563-3.563V33.781C58.719,31.817,57.121,30.219,55.156,30.219z M33.781,48.922V33.781h21.375l0.003,15.141  H33.781z"/><path fill="#ffffff" d="M27.851,17.139c-0.984,0-1.781,0.798-1.781,1.781v4.517l-5.776-5.776c-0.696-0.696-1.823-0.696-2.519,0  c-0.696,0.695-0.696,1.823,0,2.519l5.776,5.776h-4.517c-0.984,0-1.781,0.798-1.781,1.781c0,0.984,0.798,1.781,1.781,1.781h8.817  c0.117,0,0.234-0.012,0.349-0.035c0.053-0.01,0.102-0.03,0.153-0.045c0.06-0.018,0.121-0.032,0.18-0.056  c0.061-0.025,0.115-0.059,0.172-0.091c0.045-0.025,0.091-0.044,0.134-0.073c0.195-0.13,0.363-0.298,0.494-0.494  c0.03-0.044,0.05-0.093,0.075-0.139c0.03-0.055,0.064-0.109,0.088-0.167c0.025-0.06,0.039-0.122,0.057-0.183  c0.015-0.05,0.034-0.098,0.044-0.149c0.023-0.115,0.035-0.232,0.035-0.349V18.92C29.633,17.937,28.835,17.139,27.851,17.139z"/><path fill="#ffffff" d="M25.765,48.923H9.734c-0.491,0-0.891-0.399-0.891-0.891V15.969c0-0.491,0.399-0.891,0.891-0.891h44.531  c0.491,0,0.891,0.4,0.891,0.891v9.797c0,0.984,0.798,1.781,1.781,1.781c0.983,0,1.781-0.798,1.781-1.781v-9.797  c0.001-2.456-1.997-4.453-4.452-4.453H9.734c-2.455,0-4.453,1.998-4.453,4.453v32.063c0,2.455,1.998,4.453,4.453,4.453h16.031  c0.984,0,1.781-0.798,1.781-1.781C27.546,49.721,26.748,48.923,25.765,48.923z"/></svg>`;
                        window.parent.postMessage({ type: 'PIP_EXIT' }, '*');
                    }
                };

                // Add to setupVideoListeners to ensure events are attached to current video
                const originalSetup = window._movieExtension_setupListeners;
                window._movieExtension_setupListeners = (v) => {
                    if (originalSetup) originalSetup(v);
                    v.addEventListener('enterpictureinpicture', updatePipState);
                    v.addEventListener('leavepictureinpicture', updatePipState);
                };
                
                // Also attach to current immediately
                if (permanentVideo) {
                    permanentVideo.addEventListener('enterpictureinpicture', updatePipState);
                    permanentVideo.addEventListener('leavepictureinpicture', updatePipState);
                }

                rightControls.appendChild(pipBtn);
            }
            // --- PIP BUTTON END ---

            rightControls.appendChild(volumeContainer);

            // Settings Button (User Provided)
            const settingsBtn = document.createElement('button');
            settingsBtn.className = 'player-control-button';
            settingsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 512 512"><title>ionicons-v5-q</title><path d="M262.29,192.31a64,64,0,1,0,57.4,57.4A64.13,64.13,0,0,0,262.29,192.31ZM416.39,256a154.34,154.34,0,0,1-1.53,20.79l45.21,35.46A10.81,10.81,0,0,1,462.52,326l-42.77,74a10.81,10.81,0,0,1-13.14,4.59l-44.9-18.08a16.11,16.11,0,0,0-15.17,1.75A164.48,164.48,0,0,1,325,400.8a15.94,15.94,0,0,0-8.82,12.14l-6.73,47.89A11.08,11.08,0,0,1,298.77,470H213.23a11.11,11.11,0,0,1-10.69-8.87l-6.72-47.82a16.07,16.07,0,0,0-9-12.22,155.3,155.3,0,0,1-21.46-12.57,16,16,0,0,0-15.11-1.71l-44.89,18.07a10.81,10.81,0,0,1-13.14-4.58l-42.77-74a10.8,10.8,0,0,1,2.45-13.75l38.21-30a16.05,16.05,0,0,0,6-14.08c-.36-4.17-.58-8.33-.58-12.5s.21-8.27.58-12.35a16,16,0,0,0-6.07-13.94l-38.19-30A10.81,10.81,0,0,1,49.48,186l42.77-74a10.81,10.81,0,0,1,13.14-4.59l44.9,18.08a16.11,16.11,0,0,0,15.17-1.75A164.48,164.48,0,0,1,187,111.2a15.94,15.94,0,0,0,8.82-12.14l6.73-47.89A11.08,11.08,0,0,1,213.23,42h85.54a11.11,11.11,0,0,1,10.69,8.87l6.72,47.82a16.07,16.07,0,0,0,9,12.22,155.3,155.3,0,0,1,21.46,12.57,16,16,0,0,0,15.11,1.71l44.89-18.07a10.81,10.81,0,0,1,13.14,4.58l42.77,74a10.8,10.8,0,0,1-2.45,13.75l-38.21,30a16.05,16.05,0,0,0-6.05,14.08C416.17,247.67,416.39,251.83,416.39,256Z" style="fill:none;stroke:#ffffff;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px"/></svg>`;
            settingsBtn.style.background = 'none';
            settingsBtn.style.border = 'none';
            settingsBtn.style.cursor = 'pointer';
            settingsBtn.style.padding = '5px';
            settingsBtn.title = 'Настройки';
            
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

            const createMenuItem = (label, value) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'player-settings-menu__item';
                item.setAttribute('role', 'menuitem');
                
                item.innerHTML = `
                    <span class="player-settings-menu__label">${label}</span>
                    <span class="player-settings-menu__value">${value}</span>
                    <svg class="player-settings-menu__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
                `;
                return item;
            };

            // Generic Sub-menu Renderer
            const renderSubMenuView = (title, items, activeCondition) => {
                settingsMenu.innerHTML = '';
                
                // Header with Back Button
                const header = document.createElement('button');
                header.type = 'button';
                header.className = 'player-settings-menu__back';
                header.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg><span>${title}</span>`;
                header.onclick = (e) => { e.stopPropagation(); renderMainView(); };
                settingsMenu.appendChild(header);

                // Items list
                const listContainer = document.createElement('div');
                listContainer.className = 'player-settings-menu__list';
                listContainer.setAttribute('role', 'menu');

                items.forEach(item => {
                     const div = document.createElement('button');
                     div.type = 'button';
                     div.className = 'player-settings-menu__option';
                     div.setAttribute('role', 'menuitemradio');
                     div.setAttribute('aria-checked', String(!!item.isActive));
                     div.innerHTML = `<span class="player-settings-menu__option-label"></span><span class="player-settings-menu__check" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>`;
                     div.querySelector('.player-settings-menu__option-label').textContent = item.label;
                     
                     if (item.isActive) {
                         div.classList.add('is-active');
                     }
                     
                     div.onclick = (e) => {
                         e.stopPropagation();
                         item.action();
                         // Refresh view to show new active state
                         // We re-generate the items by calling the parent view function again
                         if (item.refreshFn) item.refreshFn();
                     };
                     listContainer.appendChild(div);
                });
                settingsMenu.appendChild(listContainer);
            };

            // Speed View
            const renderSpeedView = () => {
                const currentVid = permanentVideo || video;
                const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
                const items = rates.map(rate => ({
                    label: rate + 'x',
                    isActive: currentVid.playbackRate === rate,
                    action: () => {
                        currentVid.playbackRate = rate;
                        // Save preference?
                    },
                    refreshFn: renderSpeedView
                }));
                renderSubMenuView('Скорость', items);
            }

            // Subtitles View
            const renderSubsView = () => {
                const currentVid = permanentVideo || video;
                const tracks = Array.from(currentVid.textTracks || []);
                // Add "Off" option
                const items = [{
                    label: 'Откл',
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
                
                renderSubMenuView('Субтитры', items);
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
                    if (lastToken.toLowerCase() === 'авто') return 'Авто';
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

            const RUTUBE_QUALITY_LADDER = [2160, 1440, 1080, 720, 480, 360, 240, 144];

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

                const isRutube = permanentVideo?.dataset?.playerProvider === 'rutube';
                const firstRutubeQuality = Math.max(0, RUTUBE_QUALITY_LADDER.length - variants.length);
                const selectLevel = levelIndex => {
                    hls.currentLevel = levelIndex;
                    hls.nextLevel = levelIndex;
                };

                return [
                    {
                        label: 'Автоматически',
                        isActive: hls.autoLevelEnabled,
                        action: () => { hls.currentLevel = -1; }
                    },
                    ...variants.map(({ index, level }, rank) => ({
                        // Rutube's direct stream reports non-display internal heights
                        // (for example 800). Its own player presents a fixed quality
                        // ladder, so use that user-facing naming here too.
                        label: isRutube
                            ? `${RUTUBE_QUALITY_LADDER[firstRutubeQuality + rank]}p`
                            : `${Math.round(level.height)}p`,
                        isActive: !hls.autoLevelEnabled && hls.currentLevel === index,
                        action: () => selectLevel(index)
                    }))
                ];
            };

            const getQualityOptions = () => {
                const nativeHlsOptions = getNativeHlsQualityOptions();
                if (nativeHlsOptions.length > 0) return nativeHlsOptions;
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
                    renderSubMenuView('Качество', [{label: 'Auto (Not found)', isActive: true, action: () => {}}]);
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
                
                renderSubMenuView('Качество', items);
            }

            // Voiceover View
            const renderVoiceoverView = () => {
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
                renderSubMenuView('Озвучка', items);
            };


            // Main View
            const renderMainView = () => {
                settingsMenu.innerHTML = '';
                const currentVid = permanentVideo || video;
                
                // Get current quality label
                const qualityOpts = getQualityOptions();
                const activeQuality = qualityOpts.find(o => o.isActive);
                const qualityLabel = activeQuality ? activeQuality.label : 'Auto';

                // Quality Item
                const qualityItem = createMenuItem('Качество', qualityLabel); 
                qualityItem.onclick = (e) => { e.stopPropagation(); renderQualityView(); };
                settingsMenu.appendChild(qualityItem);

                // Voiceover Item (New)
                if (currentVoiceoverOptions.length > 0) {
                    const activeVoiceover = currentVoiceoverOptions.find(o => o.isActive) || currentVoiceoverOptions[0];
                    const voiceLabel = activeVoiceover ? activeVoiceover.name : 'Unknown';
                    
                    const voiceItem = createMenuItem('Озвучка', voiceLabel);
                    voiceItem.onclick = (e) => { e.stopPropagation(); renderVoiceoverView(); };
                    settingsMenu.appendChild(voiceItem);
                }

                // Speed Item
                const speedItem = createMenuItem('Скорость', currentVid.playbackRate + 'x');
                speedItem.onclick = (e) => { e.stopPropagation(); renderSpeedView(); };
                settingsMenu.appendChild(speedItem);

                // Subtitles Item
                const tracks = Array.from(currentVid.textTracks || []);
                const activeTrack = tracks.find(t => t.mode === 'showing');
                // Clean up label (remove " - 1", " - 2" suffixes if present)
                let subLabel = activeTrack ? (activeTrack.label || activeTrack.language) : 'Откл';
                subLabel = subLabel.replace(/\s*-\s*\d+$/, ''); 

                const subsItem = createMenuItem('Субтитры', subLabel);
                subsItem.onclick = (e) => { e.stopPropagation(); renderSubsView(); };
                settingsMenu.appendChild(subsItem);
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
                    renderMainView(); // Reset to main on open
                    settingsMenu.style.display = 'flex';
                } else {
                    settingsMenu.style.display = 'none';
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
            fullscreenBtn.className = 'player-control-button';
            fullscreenBtn.style.background = 'none';
            fullscreenBtn.style.border = 'none';
            fullscreenBtn.style.cursor = 'pointer';
            fullscreenBtn.style.color = 'white';
            fullscreenBtn.style.padding = '5px';
            
            const updateFullIcon = () => {
                if (document.fullscreenElement) {
                     fullscreenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="#ffffffff" height="24px" width="24px" version="1.1" id="Layer_1" viewBox="0 0 512 512" xml:space="preserve"><g><g><g><path d="M505.752,6.248c-8.331-8.331-21.839-8.331-30.17,0L320,161.83V64c0-11.782-9.551-21.333-21.333-21.333     c-11.782,0-21.333,9.551-21.333,21.333v149.333c0,0.007,0.001,0.015,0.001,0.022c0.001,0.695,0.037,1.39,0.105,2.083     c0.031,0.318,0.091,0.627,0.136,0.94c0.054,0.375,0.098,0.75,0.171,1.122c0.071,0.359,0.17,0.708,0.259,1.061     c0.081,0.322,0.151,0.645,0.248,0.964c0.105,0.346,0.234,0.68,0.356,1.018c0.114,0.318,0.219,0.639,0.349,0.953     c0.131,0.316,0.284,0.618,0.43,0.926c0.152,0.323,0.296,0.649,0.465,0.966c0.158,0.295,0.338,0.575,0.509,0.861     c0.186,0.311,0.361,0.626,0.564,0.929c0.211,0.316,0.447,0.613,0.674,0.917c0.19,0.253,0.365,0.513,0.568,0.759     c0.892,1.087,1.889,2.085,2.977,2.977c0.246,0.202,0.506,0.378,0.759,0.568c0.304,0.228,0.601,0.463,0.917,0.674     c0.303,0.203,0.618,0.379,0.929,0.564c0.286,0.171,0.566,0.351,0.861,0.509c0.317,0.169,0.643,0.313,0.966,0.465     c0.308,0.145,0.611,0.299,0.926,0.43c0.314,0.13,0.635,0.235,0.953,0.349c0.338,0.122,0.672,0.251,1.018,0.356     c0.318,0.096,0.642,0.167,0.964,0.248c0.353,0.089,0.701,0.188,1.061,0.259c0.372,0.074,0.748,0.118,1.122,0.171     c0.314,0.045,0.622,0.104,0.94,0.136c0.693,0.068,1.388,0.105,2.083,0.105c0.007,0,0.015,0.001,0.022,0.001H448     c11.782,0,21.333-9.551,21.333-21.333c0-11.782-9.551-21.333-21.333-21.333h-97.83L505.752,36.418     C514.083,28.087,514.083,14.58,505.752,6.248z"/><path d="M234.56,296.562c-0.031-0.318-0.091-0.627-0.136-0.94c-0.054-0.375-0.098-0.75-0.171-1.122     c-0.071-0.359-0.17-0.708-0.259-1.061c-0.081-0.322-0.151-0.645-0.248-0.964c-0.105-0.346-0.234-0.68-0.356-1.018     c-0.114-0.318-0.219-0.639-0.349-0.953c-0.131-0.316-0.284-0.618-0.43-0.926c-0.152-0.323-0.296-0.649-0.465-0.966     c-0.158-0.295-0.338-0.575-0.509-0.861c-0.186-0.311-0.361-0.626-0.564-0.929c-0.211-0.316-0.447-0.613-0.674-0.917     c-0.19-0.253-0.365-0.513-0.568-0.759c-0.892-1.087-1.889-2.085-2.977-2.977c-0.246-0.202-0.506-0.378-0.759-0.568     c-0.304-0.228-0.601-0.463-0.917-0.674c-0.303-0.203-0.618-0.379-0.929-0.564c-0.286-0.171-0.566-0.351-0.861-0.509     c-0.317-0.169-0.643-0.313-0.966-0.465c-0.308-0.145-0.611-0.299-0.926-0.43c-0.314-0.13-0.635-0.235-0.953-0.349     c-0.338-0.122-0.672-0.251-1.018-0.356c-0.318-0.096-0.642-0.167-0.964-0.248c-0.353-0.089-0.701-0.188-1.061-0.259     c-0.372-0.074-0.748-0.118-1.122-0.171c-0.314-0.045-0.622-0.104-0.94-0.136c-0.7-0.069-1.402-0.106-2.105-0.106l0,0H64     c-11.782,0-21.333,9.551-21.333,21.333C42.667,310.449,52.218,320,64,320h97.83L6.248,475.582c-8.331,8.331-8.331,21.839,0,30.17     c8.331,8.331,21.839,8.331,30.17,0L192,350.17V448c0,11.782,9.551,21.333,21.333,21.333c11.782,0,21.333-9.551,21.333-21.333     V298.667l0,0C234.667,297.964,234.629,297.262,234.56,296.562z"/></g></g></g></svg>'; // Exit (approx)
                } else {
                     fullscreenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24" fill="none"><path d="M3 21L10.5 13.5M3 21V15.4M3 21H8.6" stroke="#ffffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21.0711 3L13.5 10.5M21.0711 3V8.65685M21.0711 3H15.4142" stroke="#ffffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; // Enter
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

            // Keyboard controls belong to this wrapper and are removed with it.
            {
                listenerScope.listen(document, 'keydown', (e) => {
                    // Only handle if player is visible and not typing in input
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                    
                    const currentVid = permanentVideo || video;
                    if (!currentVid) return;
                    
                    // Arrow Left: Seek backward 10 seconds
                    if (e.key === 'ArrowLeft' && Number.isFinite(currentVid.duration)) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        const newTime = Math.max(0, currentVid.currentTime - 10);
                        currentVid.currentTime = newTime;
                        showSeekIndicator(leftSeekIndicator, 'left');
                        console.log('[MovieExtension] Seek backward to:', newTime);
                    }
                    // Arrow Right: Seek forward 10 seconds  
                    else if (e.key === 'ArrowRight' && Number.isFinite(currentVid.duration)) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        const newTime = Math.min(currentVid.duration, currentVid.currentTime + 10);
                        currentVid.currentTime = newTime;
                        showSeekIndicator(rightSeekIndicator, 'right');
                        console.log('[MovieExtension] Seek forward to:', newTime);
                    }
                    // Arrow Up: Increase volume by 5%
                    else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        const currentVolume = currentVid.volume;
                        const newVolume = Math.min(1, currentVolume + 0.05);
                        setVolumeSafe(newVolume, false);
                        showVolumeIndicator(newVolume * 100);
                        console.log('[MovieExtension] Volume increased to:', Math.round(newVolume * 100) + '%');
                    }
                    // Arrow Down: Decrease volume by 5%
                    else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        const currentVolume = currentVid.volume;
                        const newVolume = Math.max(0, currentVolume - 0.05);
                        setVolumeSafe(newVolume, newVolume === 0);
                        showVolumeIndicator(newVolume * 100);
                        console.log('[MovieExtension] Volume decreased to:', Math.round(newVolume * 100) + '%');
                    }
                    // Space: Play/Pause
                    else if (e.key === ' ' || e.code === 'Space') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        if (currentVid.paused) {
                            currentVid.play().catch(() => {});
                        } else {
                            currentVid.pause();
                        }
                    }
                }, true); // Use capture phase to catch events before other handlers
            }

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
                    getCurrentUrl: () => {
                        if (lastRealSource && !lastRealSource.startsWith('blob:')) return lastRealSource;
                        
                        // 1. Try our own hlsInstance
                        if (hlsInstance && hlsInstance.url && !hlsInstance.url.startsWith('blob:')) {
                            return hlsInstance.url;
                        }

                        // 2. Try window.hls (site's own instance)
                        if (window.hls && window.hls.url && !window.hls.url.startsWith('blob:')) {
                            return window.hls.url;
                        }

                        // 3. Scan performance entries for .m3u8
                        try {
                            const entries = performance.getEntriesByType('resource');
                            const hlsEntry = entries.find(e => e.name.includes('.m3u8') && !e.name.includes('ghost-preview'));
                            if (hlsEntry) return hlsEntry.name;
                        } catch {
                            // Ignore error
                        }

                        // 4. Fallback to current video source
                        const vid = permanentVideo || document.querySelector('video');
                        return vid ? (vid.src || vid.currentSrc) : null;
                    },
                    getCurrentHls: () => hlsInstance || window.hls || null,
                    HlsClass: (typeof Hls !== 'undefined') ? Hls : null,
                });
            }

            // Communication with parent (Extension)
            // Notify parent that player is ready
            window.parent.postMessage({ type: 'PLAYER_READY' }, '*');

            // Listen for messages from parent
            listenerScope.listen(window, 'message', (event) => {
                if (event.data.type === 'SET_SOURCES') {
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
        
        // Strategy 0: Explicit Seasonvar Bridge (Added by Parser)
        const svContainer = document.querySelector('#seasonvar-voiceover-source');
        if (svContainer) {
            extractAndRender(svContainer.querySelectorAll('.seasonvar-voiceover-item'), container);
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
        observer.observe(observerRoot, { childList: true, subtree: true });
        return true;
    }

    function startPlayerObservation(attempt = 0) {
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
        if (activeWrapper && !document.contains(activeWrapper)) {
            teardownActiveWrapper();
        }
        if (permanentVideo && !document.contains(permanentVideo)) {
            setPermanentVideo(null);
            activeWrapper = null;
        }
        // First check if we need to intercept new video elements
        if (permanentVideo) {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // Check for new video elements added by the site
                    const addedVideos = Array.from(mutation.addedNodes)
                        .filter(node => node.tagName === 'VIDEO' && node.dataset.ghost !== 'true' && !node.classList.contains('ghost-video'));
                    
                    for (const newVideo of addedVideos) {
                        // Skip if it's our own video or extension native player
                        if (newVideo === permanentVideo) continue;
                        if (newVideo.closest('.native-player-wrapper')) continue;
                        if (isExtensionNativeVideo(newVideo)) continue;
                        
                        // Extract source from new video
                        const newSrc = newVideo.src || newVideo.currentSrc;
                        
                        if (newSrc) {
                            console.log('[MovieExtension] Detected new video element with src:', newSrc);
                            
                            // Update our permanent video
                            const shouldAutoPlay = localStorage.getItem('movieExtension_autoplay_next') === 'true';
                            changeVideoSource(newSrc, shouldAutoPlay);
                            
                            // Remove the site's video element
                            newVideo.remove();
                            
                            console.log('[MovieExtension] Removed site video, updated permanent video');
                            
                            // Don't initialize new player
                            return;
                        } else {
                            // Blob URL may be assigned after insertion — watch for it
                            console.log('[MovieExtension] New video without src detected, watching for source assignment...');
                            const srcWatcher = new MutationObserver((muts, obs) => {
                                const src = newVideo.src || newVideo.currentSrc;
                                if (src) {
                                    obs.disconnect();
                                    if (newVideo.closest('.native-player-wrapper') || isExtensionNativeVideo(newVideo)) return;
                                    console.log('[MovieExtension] Deferred src detected:', src);
                                    changeVideoSource(src, true);
                                    newVideo.remove();
                                }
                            });
                            srcWatcher.observe(newVideo, { attributes: true, attributeFilter: ['src'] });
                            // Fallback for blob URLs set via JS property (not attribute)
                            newVideo.addEventListener('loadedmetadata', function handler() {
                                const src = newVideo.src || newVideo.currentSrc;
                                if (src && !newVideo.closest('.native-player-wrapper') && !isExtensionNativeVideo(newVideo)) {
                                    srcWatcher.disconnect();
                                    console.log('[MovieExtension] Deferred src via loadedmetadata:', src);
                                    changeVideoSource(src, true);
                                    newVideo.remove();
                                }
                                newVideo.removeEventListener('loadedmetadata', handler);
                            }, { once: true });
                        }
                    }
                }
            }
        }
        
        // Call replacePlayer for initial setup
        replacePlayer();
    });
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            scheduleProviderContentErrorCheck();
            startPlayerObservation();
        }, { once: true });
    } else {
        scheduleProviderContentErrorCheck();
        startPlayerObservation();
    }



    // Listen for messages from parent extension
    window.addEventListener('message', (event) => {
        if (!event.data) return;
        
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
class GhostPlayer {
    constructor({ progressContainer, getActiveVideo, getCurrentUrl, getCurrentHls, HlsClass }) {
        this._progressContainer = progressContainer;
        this._getActiveVideo   = getActiveVideo;   // () => video element
        this._getCurrentUrl    = getCurrentUrl;    // () => string | null
        this._getCurrentHls    = getCurrentHls;    // () => Hls instance | null
        this._Hls              = HlsClass;         // Hls constructor (lazy-loaded)

        this._ghostHls   = null;
        this._lastUrl    = null;
        this._debounce   = null;

        this._tooltip    = null;
        this._ghostVideo = null;
        this._timeLabel  = null;

        this._build();
        this._bind();
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

        this._timeLabel = document.createElement('span');
        this._timeLabel.className = 'ghost-time-label';

        this._tooltip.appendChild(this._ghostVideo);
        this._tooltip.appendChild(this._timeLabel);
        document.body.appendChild(this._tooltip);
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    _bind() {
        this._onMove  = this._handleMove.bind(this);
        this._onLeave = this._handleLeave.bind(this);

        this._progressContainer.addEventListener('mousemove',  this._onMove);
        this._progressContainer.addEventListener('mouseleave', this._onLeave);
    }

    _handleMove(e) {
        const video = this._getActiveVideo();

        if (!video) {
            return;
        }
        if (!video.duration || isNaN(video.duration)) {
            return;
        }

        const rect     = this._progressContainer.getBoundingClientRect();
        const ratio    = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const seekTime = ratio * video.duration;

        this._showTooltip(e.clientX, rect.top, seekTime);

        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._seekGhost(seekTime), 120);
    }

    _handleLeave() {
        clearTimeout(this._debounce);
        this._tooltip.classList.remove('ghost-tooltip--visible');

        // Небольшая задержка перед реальным hide — плавный fade-out
        setTimeout(() => {
            if (!this._tooltip.classList.contains('ghost-tooltip--visible')) {
                this._tooltip.style.display = 'none';
            }
        }, 200);
    }

    // ─── Core ─────────────────────────────────────────────────────────────────

    _seekGhost(time) {
        const url = this._getCurrentUrl();

        if (!url) {
            return;
        }

        if (url !== this._lastUrl) {
            this._initSource(url);
            this._lastUrl = url;
        }

        // Ждём метаданных, потом сикаем
        const doSeek = () => {
            this._ghostVideo.currentTime = time;
            this._ghostVideo.pause();
        };

        if (this._ghostVideo.readyState >= 1) {
            doSeek();
        } else {
            this._ghostVideo.addEventListener('loadedmetadata', doSeek, { once: true });
        }
    }

    _initSource(url) {
        // Уничтожаем предыдущий HLS инстанс
        if (this._ghostHls) {
            this._ghostHls.destroy();
            this._ghostHls = null;
        }
        this._ghostVideo.removeAttribute('src');

        const isHlsUrl = !!(url && (url.includes('.m3u8') || (url.startsWith('blob:') && this._getCurrentHls())));

        if (isHlsUrl && this._Hls && this._Hls.isSupported()) {
            this._ghostHls = new this._Hls({
                maxBufferLength:    8,
                maxMaxBufferLength: 16,
                startFragPrefetch:  true,
            });
            this._ghostHls.on(this._Hls.Events.ERROR, (event, data) => {
                console.error('[GhostPlayer] ghostHls ERROR —', data.type, data.details);
            });
            this._ghostHls.loadSource(url);
            this._ghostHls.attachMedia(this._ghostVideo);
        } else if (isHlsUrl && this._ghostVideo && this._ghostVideo.canPlayType('application/vnd.apple.mpegurl')) {
            // Нативный HLS (Safari)
            this._ghostVideo.src = url;
            this._ghostVideo.load();
        } else {
            // MP4 или прямая ссылка
            // NEW: Ignore blob URLs if we don't have HLS.js (likely they are MediaSource blobs that can't be reused)
            if (url.startsWith('blob:') && !this._Hls) {
                console.warn('[GhostPlayer] _initSource — skipping blob URL because HlsClass is unavailable');
                return;
            }
            this._ghostVideo.src = url;
            this._ghostVideo.load();
        }

        this._ghostVideo.addEventListener('error', (e) => {
            console.error('[GhostPlayer] ghostVideo error —', this._ghostVideo.error?.code, this._ghostVideo.error?.message);
        }, { once: true });
    }

    // ─── UI ───────────────────────────────────────────────────────────────────

    _showTooltip(clientX, barTop, time) {
        this._tooltip.style.display = 'flex';
        // Принудительный reflow, чтобы offsetWidth был актуален
        const w = this._tooltip.offsetWidth || 180;
        const h = this._tooltip.offsetHeight || 116;

        let left = clientX - w / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));

        const top = barTop - h - 14; // Relative to viewport, no scroll needed for position: fixed

        this._tooltip.style.left = `${left}px`;
        this._tooltip.style.top  = `${top}px`;

        this._timeLabel.textContent = this._formatTime(time);
        
        // Use requestAnimationFrame to ensure display: flex is applied before adding visibility class
        requestAnimationFrame(() => {
            this._tooltip.classList.add('ghost-tooltip--visible');
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
        clearTimeout(this._debounce);
        this._progressContainer.removeEventListener('mousemove',  this._onMove);
        this._progressContainer.removeEventListener('mouseleave', this._onLeave);
        if (this._ghostHls) {
            this._ghostHls.destroy();
            this._ghostHls = null;
        }
        this._tooltip.remove();
    }
}
