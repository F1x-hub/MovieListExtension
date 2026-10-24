/**
 * «Эфир» page: one shared broadcast for every viewer, like a TV channel.
 *
 * The page subscribes to the channel document, works out where the broadcast is
 * right now (against server time, so viewers with wrong clocks still agree) and
 * loads the media itself. Viewers cannot pause or seek: YouTube is driven through
 * our wrapper's command bridge, movies through the broadcast lock inside the
 * player. The admin uses the player's own controls; their pause/play/seek becomes
 * the timeline for everyone. Nothing is restreamed by our servers.
 */
(function () {
    'use strict';

    const DRIFT_SEC = 3;
    const els = {};
    let channel = null;
    let mountedKey = '';
    let clockTimer = null;
    let unsubscribe = null;

    // YouTube wrapper telemetry for the mounted frame.
    const yt = {
        origin: '',
        time: 0,
        duration: 0,
        committedTime: 0,
        at: 0,
        state: 'UNSTARTED',
        ready: false,
        hasStarted: false,
        wasPaused: false,
        mountedWithAutoplay: true,
        playAttemptAt: 0,
        muted: false,
        lastCommandAt: 0,
        mountedAt: 0,
        mountedAsAdmin: false,
        forcedMute: false,
        suppressUntil: 0
    };

    // Fallback relay (WebRTC from the admin's tab) for viewers whose sources fail.
    const AUTO_RELAY_AFTER_MS = 45000;
    const relay = { status: { active: false, sessionId: '' }, service: null, host: null, viewer: null, watching: false, video: null, sourceFailed: false };
    let mediaMountedAt = 0;
    let playbackConfirmed = false;

    function ensureNavigation() {
        if (window.navigation && typeof window.navigation.updateActivePage === 'function') {
            window.navigation.updateActivePage('live');
        } else if (typeof Navigation !== 'undefined') {
            window.navigation = new Navigation('live');
        }
    }

    function waitForFirebase(timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const check = () => {
                const manager = window.firebaseManager;
                if (manager?.db) return resolve(manager);
                if (Date.now() - started > timeoutMs) return reject(new Error('FIREBASE_UNAVAILABLE'));
                setTimeout(check, 100);
            };
            check();
        });
    }

    // The player is remounted only when WHAT is on air changes. Admin pause/seek
    // and clock corrections move the existing player in place.
    function channelKey(c) {
        if (!c || c.mode === 'off') return 'off';
        // Different schedule entries of the same title are still different shows.
        return c.mode === 'movie' ? `movie:${c.docPath}:${c.movie.kinopoiskId}` : `youtube:${c.docPath}:${c.youtube.videoId}`;
    }

    function frameEl() {
        return els.screen.querySelector('.live-frame');
    }

    // renderClock runs every second; skip DOM writes when nothing changed so the
    // page does not relayout under the playing video for no reason.
    function setText(el, text) {
        if (el && el.textContent !== text) el.textContent = text;
    }

    /** Text of a `live_page.*` locale key with {name} placeholders filled in. */
    function t(key, params = {}) {
        let text = window.i18n?.get?.(`live_page.${key}`) ?? key;
        Object.entries(params).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, String(value)); });
        return text;
    }

    // Empty-state text is re-rendered on a language switch; data-i18n is not used for
    // dynamic text because Navigation's translatePage() would overwrite it.
    let emptyKeys = null;

    function destroyYoutubeFrame() {
        const frame = frameEl();
        if (!frame?.contentWindow || !yt.origin || !mountedKey.startsWith('youtube:')) return;
        try { frame.contentWindow.postMessage({ action: 'DESTROY' }, yt.origin); } catch { /* frame navigating */ }
    }

    function syncFrameLock() {
        const frame = frameEl();
        if (!frame) return;
        const lock = channel?.mode === 'youtube' && !isAdmin && playbackConfirmed && !relay.sourceFailed && !relay.watching;
        frame.classList.toggle('is-locked', lock);
    }

    function showEmpty(titleKey, textKey) {
        destroyYoutubeFrame();
        els.screen.replaceChildren();
        els.stage.hidden = true;
        els.empty.hidden = false;
        emptyKeys = [titleKey, textKey];
        els.emptyTitle.textContent = t(titleKey);
        els.emptyText.textContent = t(textKey);
        els.badge.hidden = true;
        els.clock.hidden = true;
        els.controls.hidden = true;
        els.notice.hidden = true;
        setTitle(t('title'));
        mountedKey = '';
    }

    function createFrame(src, title) {
        const frame = document.createElement('iframe');
        frame.className = 'live-frame';
        frame.src = src;
        frame.title = title || t('title');
        frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
        frame.allowFullscreen = true;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        // Reveal the player only once it has painted, instead of a hard cut from black.
        frame.addEventListener('load', () => frame.classList.add('is-ready'), { once: true });
        setTimeout(() => frame.classList.add('is-ready'), 4000);
        return frame;
    }

    function youtubeSrc(videoId, startSec, { autoplay = true } = {}) {
        const config = window.PlayerConfig;
        if (config?.YOUTUBE_WRAPPER_URL) {
            yt.origin = new URL(config.YOUTUBE_WRAPPER_URL).origin;
            // Viewers get no pause/seek UI (sound and fullscreen live on this page);
            // the admin keeps YouTube's controls to drive the broadcast.
            return `${config.buildYouTubeEmbedUrl(videoId, { autoplay, start: startSec })}&controls=${isAdmin ? 1 : 0}`;
        }
        yt.origin = '';
        return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=${autoplay ? 1 : 0}&start=${startSec}&rel=0&controls=${isAdmin ? 1 : 0}&disablekb=${isAdmin ? 0 : 1}`;
    }

    /** The movie title links to its details page, where it can be rated. */
    function setTitle(text, movieId = NaN) {
        if (!Number.isSafeInteger(movieId) || movieId <= 0) {
            els.title.textContent = text;
            return;
        }
        const link = document.createElement('a');
        link.className = 'live-title__link';
        link.href = `../movie-details/movie-details.html?movieId=${movieId}`;
        link.textContent = text;
        link.title = t('open_movie');
        els.title.replaceChildren(link);
    }

    function mountMedia(force = false) {
        // While a viewer watches the admin's relay, the relay is the picture.
        if (relay.watching) return;
        const key = channelKey(channel);
        if (!force && key === mountedKey) return;
        mediaMountedAt = Date.now();
        playbackConfirmed = false;
        relay.sourceFailed = false;
        const { CinemaChannel } = window;
        const position = CinemaChannel.computePosition(channel);

        if (channel.mode === 'off') {
            showEmpty('off_title', 'off_text');
            return;
        }
        if (position.state === 'ended') {
            showEmpty('ended_title', 'ended_text');
            mountedKey = `ended:${key}`;
            return;
        }
        if (position.state === 'upcoming') {
            showEmpty('upcoming_title', 'upcoming_text');
            mountedKey = `upcoming:${key}`;
            els.clock.hidden = false;
            return;
        }

        els.empty.hidden = true;
        els.stage.hidden = false;
        els.notice.hidden = true;
        const movieId = channel.mode === 'movie' ? Number(channel.movie?.kinopoiskId) : NaN;
        setTitle(channel.title || (channel.mode === 'youtube' ? t('title') : t('movie_on_air')), movieId);

        let src;
        if (channel.mode === 'youtube') {
            const shouldAutoplay = position.state !== 'paused';
            const now = Date.now();
            Object.assign(yt, {
                time: position.offsetSec,
                duration: 0,
                committedTime: position.offsetSec,
                at: now,
                state: 'UNSTARTED',
                ready: false,
                hasStarted: false,
                wasPaused: position.state === 'paused',
                mountedWithAutoplay: shouldAutoplay,
                playAttemptAt: 0,
                muted: false,
                lastCommandAt: 0,
                mountedAt: now,
                mountedAsAdmin: isAdmin,
                forcedMute: false,
                suppressUntil: 0
            });
            src = youtubeSrc(channel.youtube.videoId, position.offsetSec, { autoplay: shouldAutoplay });
        } else {
            const params = new URLSearchParams({
                movieId: String(channel.movie.kinopoiskId),
                embedded: 'true',
                autoplay: 'true',
                broadcastStart: String(localStartMs())
            });
            src = `../movie-details/movie-details.html?${params}`;
        }

        destroyYoutubeFrame();
        els.screen.replaceChildren(createFrame(src, channel.title));
        els.screen.classList.toggle('live-screen--movie', channel.mode === 'movie');
        mountedKey = key;
        syncFrameLock();
        renderClock();
    }

    /** Broadcast start expressed in this computer's clock (players use Date.now()). */
    function localStartMs() {
        const { CinemaChannel } = window;
        const position = CinemaChannel.computePosition(channel);
        const serverStart = Number.isFinite(channel.startedAtMs) ? channel.startedAtMs : CinemaChannel.now() - position.offsetSec * 1000;
        return CinemaChannel.toLocalMs(serverStart);
    }

    /** Hands the channel clock to the embedded movie player (it enforces it on the media). */
    function postBroadcastState() {
        if (channel?.mode !== 'movie') return;
        const frame = frameEl();
        if (!frame?.contentWindow) return;
        try {
            frame.contentWindow.postMessage({ type: 'BROADCAST_STATE', startMs: localStartMs(), pausedAtSec: channel.movie.pausedAtSec, admin: isAdmin }, window.location.origin);
        } catch { /* frame navigating */ }
    }

    // ---- YouTube lock ----------------------------------------------------------
    function isOwnRecentWrite() {
        return Boolean(pendingAdminAction || adminBusy || (lastAdminWriteAt && Date.now() - lastAdminWriteAt < 2500));
    }

    function ytCommand(action, payload) {
        const frame = frameEl();
        if (!frame?.contentWindow || !yt.origin) return;
        const now = Date.now();
        if (action === 'PLAY' || action === 'PAUSE' || action === 'SEEK') {
            yt.lastCommandAt = now;
            yt.suppressUntil = Math.max(yt.suppressUntil, now + 2200);
        }
        if (action === 'PLAY') {
            yt.wasPaused = false;
        } else if (action === 'PAUSE') {
            yt.wasPaused = true;
            yt.playAttemptAt = 0;
        } else if (action === 'SEEK' && payload && Number.isFinite(payload.seconds)) {
            yt.time = payload.seconds;
            yt.committedTime = payload.seconds;
            yt.at = now;
        }
        try { frame.contentWindow.postMessage({ action, payload }, yt.origin); } catch { /* frame navigating */ }
    }

    function ytEstimatedTime() {
        return yt.state === 'PLAYING' ? yt.time + (Date.now() - yt.at) / 1000 : yt.time;
    }

    function enforceYoutube(position, { force = false } = {}) {
        if (channel?.mode !== 'youtube' || !yt.origin || !frameEl() || !yt.ready) return;
        // The active admin drives YouTube directly; viewers (and any passive second
        // admin tab receiving a remote timeline update) follow the channel.
        if (isAdmin && (!force || isOwnRecentWrite())) return;
        if (!force && Date.now() - yt.lastCommandAt < 900) return;

        const live = channel.youtube.live;
        if (position.state === 'paused') {
            yt.playAttemptAt = 0;
            if (yt.state === 'PLAYING' || yt.state === 'BUFFERING') {
                ytCommand('PAUSE');
            } else if (yt.state === 'PAUSED' && !live && Math.abs(ytEstimatedTime() - position.offsetSec) > 1.5) {
                ytCommand('SEEK', { seconds: position.offsetSec });
            }
            return;
        }

        if (position.state !== 'live') return;
        if (!live && yt.duration > 0 && position.offsetSec >= yt.duration - 1) return;

        const inactive = ['PAUSED', 'CUED', 'UNSTARTED', 'ENDED'].includes(yt.state);
        if (!yt.hasStarted && ['UNSTARTED', 'CUED', 'PAUSED'].includes(yt.state)) {
            if (!yt.playAttemptAt) yt.playAttemptAt = Date.now();
            // A browser that blocks autoplay with sound still allows it muted.
            if (!isAdmin && !yt.forcedMute && Date.now() - yt.playAttemptAt >= 1800) {
                yt.forcedMute = true;
                yt.muted = true;
                ytCommand('MUTE');
                if (!live && Math.abs(ytEstimatedTime() - position.offsetSec) > DRIFT_SEC) {
                    ytCommand('SEEK', { seconds: position.offsetSec });
                }
                ytCommand('PLAY');
                renderSound();
                els.notice.hidden = false;
                els.notice.textContent = t('relay_muted');
                return;
            }
        }

        if (!live && Math.abs(ytEstimatedTime() - position.offsetSec) > DRIFT_SEC) {
            ytCommand('SEEK', { seconds: position.offsetSec });
            if (!inactive) return;
        }
        if (inactive) {
            ytCommand('PLAY');
        }
    }

    function expectedAdminTimelineSec(pos) {
        if (pendingAdminAction) {
            return pendingAdminAction.atSec;
        }
        if (lastAdminSent.at && Date.now() - lastAdminSent.at < 2500) {
            return lastAdminSent.action === 'pause'
                ? lastAdminSent.atSec
                : lastAdminSent.atSec + (Date.now() - lastAdminSent.at) / 1000;
        }
        return pos.offsetSec;
    }

    function handleAdminYoutubeTelemetry(eventName, nextState, hasTime, previousState, previousTime) {
        if (!isAdmin || !channel || channel.mode !== 'youtube' || channel.youtube.live) return;

        if (Date.now() < yt.suppressUntil) {
            if (nextState === 'PLAYING') {
                yt.hasStarted = true;
                yt.wasPaused = false;
                if (hasTime) yt.committedTime = yt.time;
            } else if (nextState === 'PAUSED') {
                yt.wasPaused = true;
                if (hasTime) yt.committedTime = yt.time;
            }
            return;
        }

        const pos = window.CinemaChannel.computePosition(channel);
        const refSec = expectedAdminTimelineSec(pos);

        if (!yt.hasStarted) {
            if (nextState === 'PLAYING') {
                yt.hasStarted = true;
                yt.wasPaused = false;
                yt.committedTime = yt.time;
                if (pos.state === 'paused' || pendingAdminAction?.action === 'pause') {
                    publishAdminAction('resume', yt.time);
                } else if (hasTime && Math.abs(yt.time - pos.offsetSec) > DRIFT_SEC) {
                    ytCommand('SEEK', { seconds: pos.offsetSec });
                }
            } else if (
                pos.state === 'paused'
                && (nextState === 'PAUSED' || nextState === 'CUED')
                && hasTime
                && Math.abs(yt.time - refSec) > 1.5
            ) {
                yt.committedTime = yt.time;
                publishAdminAction('seek', yt.time);
            }
            return;
        }

        if (eventName === 'STATE_CHANGE' && nextState === 'PAUSED') {
            yt.wasPaused = true;
            yt.committedTime = yt.time;
            publishAdminAction('pause', yt.time);
            return;
        }

        if (nextState === 'PAUSED' && hasTime) {
            if (Math.abs(yt.time - previousTime) > 1.5 || Math.abs(yt.time - refSec) > 1.5) {
                yt.wasPaused = true;
                yt.committedTime = yt.time;
                publishAdminAction(pos.state === 'paused' ? 'seek' : 'pause', yt.time);
            }
            return;
        }

        if (nextState === 'PLAYING') {
            if (pos.state === 'paused' || pendingAdminAction?.action === 'pause' || yt.wasPaused) {
                yt.wasPaused = false;
                yt.committedTime = yt.time;
                publishAdminAction('resume', yt.time);
                return;
            }
            if (hasTime) {
                const jumpedFromPrev = Math.abs(yt.time - previousTime) > DRIFT_SEC;
                const jumpedFromCommitted = previousState !== 'PLAYING' && Math.abs(yt.time - yt.committedTime) > DRIFT_SEC;
                const refinedPendingSeek = pendingAdminAction?.action === 'seek' && Math.abs(yt.time - pendingAdminAction.atSec) > 0.5;
                if (jumpedFromPrev || jumpedFromCommitted || refinedPendingSeek) {
                    yt.committedTime = yt.time;
                    publishAdminAction('seek', yt.time);
                    return;
                }
                yt.committedTime = yt.time;
            }
            return;
        }

        if (nextState === 'BUFFERING' && hasTime && !yt.wasPaused && pos.state !== 'paused') {
            if (Math.abs(yt.time - previousTime) > DRIFT_SEC || Math.abs(yt.time - yt.committedTime) > DRIFT_SEC) {
                yt.committedTime = yt.time;
                publishAdminAction('seek', yt.time);
            }
        }
    }

    function onWrapperMessage(event) {
        const frame = frameEl();
        if (!yt.origin || event.origin !== yt.origin || !frame || event.source !== frame.contentWindow) return;
        const data = event.data;
        if (!data || data.source !== 'STARTTAB_PLAYER_WRAPPER') return;
        const payload = data.payload || {};
        const previousState = yt.state;
        const previousTime = ytEstimatedTime();
        const hasTime = payload.currentTime !== undefined && payload.currentTime !== null && Number.isFinite(Number(payload.currentTime));

        if (Number.isFinite(Number(payload.duration)) && Number(payload.duration) > 0) {
            yt.duration = Number(payload.duration);
        }
        if (hasTime) {
            yt.time = Number(payload.currentTime);
            yt.at = Date.now();
        }

        if (data.event === 'READY') {
            yt.ready = true;
            if (yt.state === 'UNSTARTED') yt.state = 'CUED';
            if (channel?.mode === 'youtube') {
                const pos = window.CinemaChannel.computePosition(channel);
                if (yt.mountedWithAutoplay && pos.state === 'live' && !yt.playAttemptAt) {
                    yt.playAttemptAt = Date.now();
                }
                if (!isAdmin) enforceYoutube(pos, { force: true });
            }
            return;
        }

        if (data.event === 'ERROR') {
            relay.sourceFailed = true;
            syncFrameLock();
            if (!maybeAutoRelay()) {
                els.notice.hidden = false;
                els.notice.textContent = t('youtube_blocked');
            }
            return;
        }

        let nextState;
        if (data.event === 'STATE_CHANGE' && payload.state) {
            yt.ready = true;
            nextState = payload.state;
            yt.state = nextState;
        } else if (data.event === 'TIME_UPDATE') {
            yt.ready = true;
            nextState = payload.state || 'PLAYING';
            yt.state = nextState;
        } else {
            return;
        }

        if (nextState === 'PLAYING') {
            yt.playAttemptAt = 0;
            playbackConfirmed = true;
        }
        syncFrameLock();

        if (isAdmin) {
            handleAdminYoutubeTelemetry(data.event, nextState, hasTime, previousState, previousTime);
        }
        if (nextState === 'PLAYING') {
            yt.hasStarted = true;
        }

        if (
            data.event === 'STATE_CHANGE'
            && nextState === 'PAUSED'
            && channel?.mode === 'youtube'
            && !channel.youtube.live
            && (!isAdmin || !isOwnRecentWrite())
        ) {
            const pos = window.CinemaChannel.computePosition(channel);
            if (pos.state === 'paused' && Math.abs(yt.time - pos.offsetSec) > 1.5) {
                enforceYoutube(pos, { force: true });
            } else if (!isAdmin && pos.state === 'live') {
                enforceYoutube(pos, { force: true });
            }
        }
    }

    // ---- Sound / fullscreen ----------------------------------------------------
    // Movies keep their own player controls; the relay video and a viewer's
    // control-less YouTube embed get this small overlay instead.
    const VOLUME_KEY = 'movieExtension.liveRelayVolume';

    function savedVolume() {
        try {
            const value = Number(localStorage.getItem(VOLUME_KEY));
            return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
        } catch { return 1; }
    }

    function renderSound() {
        const relayOn = relay.watching && relay.video;
        const youtubeViewer = !relay.watching && channel?.mode === 'youtube' && !isAdmin;
        els.controls.hidden = els.stage.hidden || !(relayOn || youtubeViewer);
        if (els.controls.hidden) return;
        const muted = relayOn ? relay.video.muted || relay.video.volume === 0 : yt.muted;
        els.mute.classList.toggle('is-muted', muted);
        // Keep the controls visible while sound is off, so viewers find the button.
        els.controls.classList.toggle('is-attention', muted);
        els.mute.setAttribute('aria-label', muted ? t('unmute') : t('mute'));
        // The wrapper bridge only knows mute/unmute, so volume is relay-only.
        els.volume.hidden = !relayOn;
        if (relayOn) {
            const volume = String(muted ? 0 : relay.video.volume);
            if (els.volume.value !== volume) els.volume.value = volume;
        }
    }

    function toggleSound() {
        if (relay.watching && relay.video) {
            const video = relay.video;
            if (video.muted || video.volume === 0) {
                video.muted = false;
                if (video.volume === 0) video.volume = 0.5;
                video.play().catch(() => {});
            } else {
                video.muted = true;
            }
            renderSound();
            return;
        }
        yt.muted = !yt.muted;
        ytCommand(yt.muted ? 'MUTE' : 'UNMUTE');
        if (!yt.muted && yt.forcedMute && els.notice.textContent === t('relay_muted')) {
            els.notice.hidden = true;
        }
        renderSound();
    }

    function onVolumeInput() {
        const video = relay.video;
        if (!video) return;
        const value = Number(els.volume.value);
        video.volume = value;
        video.muted = value === 0;
        if (value > 0) video.play().catch(() => {});
        try { localStorage.setItem(VOLUME_KEY, String(value)); } catch { /* storage blocked */ }
        renderSound();
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => {});
        } else {
            els.stage.requestFullscreen?.().catch(() => {});
        }
    }

    // ---- Fallback relay --------------------------------------------------------
    function renderRelayButtons() {
        const on = relay.status.active;
        els.relayHost.hidden = !isAdmin || !relay.service || !channel || channel.mode === 'off';
        if (!els.relayHost.hidden) {
            const viewers = relay.host ? relay.host.viewerCount() : 0;
            setText(els.relayHost, relay.host ? t('relay_stop', { count: viewers }) : t('relay_start'));
            els.relayHost.classList.toggle('btn-primary', Boolean(relay.host));
            els.relayHost.classList.toggle('btn-secondary', !relay.host);
        }
        els.relayWatch.hidden = isAdmin || !on;
        setText(els.relayWatch, relay.watching ? t('relay_back') : t('relay_watch'));
    }

    /**
     * Narrows a capture of this tab to the player only. Element Capture (Chrome 132+)
     * shows just the element even if something overlaps it; Region Capture crops
     * to its box on older Chrome. If the admin picked another tab, we keep it whole.
     */
    async function restrictCaptureToPlayer(stream) {
        const track = stream.getVideoTracks()[0];
        const target = frameEl() || els.screen;
        if (!track || !target) return;
        try {
            if (window.RestrictionTarget && typeof track.restrictTo === 'function') {
                await track.restrictTo(await window.RestrictionTarget.fromElement(target));
                return;
            }
        } catch (error) {
            console.info('[Live] Element Capture unavailable, trying Region Capture:', error?.message);
        }
        try {
            if (window.CropTarget && typeof track.cropTo === 'function') {
                await track.cropTo(await window.CropTarget.fromElement(target));
            }
        } catch (error) {
            console.info('[Live] Region Capture unavailable, sharing the whole tab:', error?.message);
        }
    }

    async function toggleHosting() {
        if (!relay.service) return;
        if (relay.host) {
            const host = relay.host;
            relay.host = null;
            await host.stop();
            renderRelayButtons();
            return;
        }
        if (!navigator.mediaDevices?.getDisplayMedia) {
            Utils?.showToast?.(t('relay_unsupported'), 'error');
            return;
        }
        try {
            // Capture this tab (the player is on it) with its sound.
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30, max: 30 }, height: { ideal: 720, max: 1080 } },
                audio: { suppressLocalAudioPlayback: false },
                preferCurrentTab: true,
                selfBrowserSurface: 'include',
                surfaceSwitching: 'exclude',
                systemAudio: 'include'
            });
            await restrictCaptureToPlayer(stream);
            relay.host = await relay.service.startHosting(stream, { onViewersChange: renderRelayButtons });
            stream.getVideoTracks()[0]?.addEventListener('ended', () => { relay.host = null; renderRelayButtons(); });
            Utils?.showToast?.(t('relay_started'), 'success', 5000);
        } catch (error) {
            if (error?.name !== 'NotAllowedError') {
                console.warn('[Live] Could not start the relay:', error);
                Utils?.showToast?.(error?.code === 'permission-denied' ? t('relay_admin_only') : t('relay_failed'), 'error');
            }
        }
        renderRelayButtons();
    }

    async function enterRelay({ auto = false } = {}) {
        if (relay.watching || !relay.status.active || !relay.service || isAdmin) return;
        destroyYoutubeFrame();
        relay.watching = true;
        const video = document.createElement('video');
        video.className = 'live-relay-video';
        video.autoplay = true;
        video.playsInline = true;
        video.volume = savedVolume();
        relay.video = video;
        els.empty.hidden = true;
        els.stage.hidden = false;
        els.screen.classList.remove('live-screen--movie');
        els.screen.replaceChildren(video);
        mountedKey = 'relay';
        els.notice.hidden = false;
        els.notice.textContent = auto
            ? t('relay_connecting_fallback')
            : t('relay_connecting');
        try {
            relay.viewer = await relay.service.join(relay.status.sessionId, {
                onStream: stream => {
                    video.srcObject = stream;
                    video.play().catch(() => {
                        video.muted = true;
                        video.play().catch(() => {});
                        els.notice.textContent = t('relay_muted');
                        renderSound();
                    });
                    if (!video.muted) els.notice.hidden = true;
                    renderSound();
                },
                onState: state => {
                    if (state === 'failed') {
                        els.notice.hidden = false;
                        els.notice.textContent = t('relay_blocked');
                    }
                }
            });
        } catch (error) {
            console.warn('[Live] Could not join the relay:', error);
            els.notice.hidden = false;
            els.notice.textContent = error?.message || t('relay_connect_failed');
        }
        renderRelayButtons();
        renderSound();
    }

    async function leaveRelay() {
        if (!relay.watching) return;
        relay.watching = false;
        const viewer = relay.viewer;
        relay.viewer = null;
        relay.video = null;
        await viewer?.leave();
        els.notice.hidden = true;
        mountedKey = '';
        if (channel) mountMedia(true);
        renderRelayButtons();
    }

    /** Switch a stuck or failing viewer to the relay. Returns true when it did. */
    function maybeAutoRelay() {
        if (isAdmin || relay.watching || !relay.status.active || !channel || channel.mode === 'off') return false;
        const stuck = !playbackConfirmed && mediaMountedAt && Date.now() - mediaMountedAt > AUTO_RELAY_AFTER_MS;
        if (!relay.sourceFailed && !stuck) return false;
        enterRelay({ auto: true });
        return true;
    }

    // ---- Clock & status --------------------------------------------------------
    // The manual channel plus the schedule; `channel` is whatever is on air now.
    let manualChannel = null;
    let scheduleItems = [];
    let channelSignature = '';

    function signatureOf(c) {
        const media = c?.[c?.mode];
        return [c?.docPath, c?.mode, c?.startedAtMs, media?.pausedAtSec, media?.videoId || media?.kinopoiskId, c?.title].join('|');
    }

    function refreshChannel({ force = false } = {}) {
        if (!manualChannel) return;
        const next = window.CinemaChannel.resolveChannel(manualChannel, scheduleItems);
        const signature = signatureOf(next);
        const changed = signature !== channelSignature;
        if (!force && !changed) return;
        const hadChannel = channelSignature !== '';
        channelSignature = signature;
        channel = next;
        yt.lastCommandAt = 0;
        mountMedia();
        postBroadcastState();
        if (hadChannel && changed && channel?.mode === 'youtube') {
            enforceYoutube(window.CinemaChannel.computePosition(channel), { force: true });
        }
        renderClock();
    }

    function renderClock() {
        if (!channel || channel.mode === 'off') return;
        const { CinemaChannel } = window;
        const position = CinemaChannel.computePosition(channel);
        const isLiveStream = channel.mode === 'youtube' && channel.youtube.live;
        const playing = !els.stage.hidden;

        els.badge.hidden = position.state !== 'live' && position.state !== 'paused';
        setText(els.badgeText, position.state === 'paused' ? t('badge_paused') : t('badge_live'));
        els.badge.classList.toggle('is-paused', position.state === 'paused');
        els.clock.hidden = isLiveStream || (!playing && position.state !== 'upcoming');
        renderSound();

        if (position.state === 'paused') {
            setText(els.clock, t('clock_paused', { time: CinemaChannel.formatClock(position.offsetSec) }));
        } else if (position.state === 'upcoming') {
            setText(els.clock, t('clock_upcoming', { time: CinemaChannel.formatClock(position.offsetSec) }));
        } else if (position.state === 'live' && !isLiveStream) {
            const total = channel[channel.mode]?.durationSec || (channel.mode === 'youtube' && yt.duration > 0 ? Math.round(yt.duration) : 0);
            setText(els.clock, total
                ? `${CinemaChannel.formatClock(position.offsetSec)} / ${CinemaChannel.formatClock(total)}`
                : t('clock_playing', { time: CinemaChannel.formatClock(position.offsetSec) }));
        }

        enforceYoutube(position);
        renderRelayButtons();
        if (position.state === 'live' || position.state === 'paused') maybeAutoRelay();

        // Switch screens when the broadcast starts or runs past its duration.
        if ((position.state === 'live' && (mountedKey.startsWith('upcoming:') || mountedKey.startsWith('ended:')))
            || (position.state === 'ended' && els.empty.hidden)) {
            mountMedia(true);
        }
        setText(els.subtitle, isLiveStream
            ? t('subtitle_stream')
            : isAdmin
                ? t('subtitle_admin')
            : position.state === 'paused'
                ? t('subtitle_paused')
                : t('subtitle_default'));
    }

    // ---- Admin timeline controls ------------------------------------------------
    let service = null;
    let isAdmin = false;
    let adminBusy = false;
    let lastAdminWriteAt = 0;
    const lastAdminSent = { action: '', atSec: 0, at: 0, baseSignature: '' };

    // The admin's own pause/play/seek in the player becomes the broadcast timeline.
    // Reports are coalesced so one drag on the progress bar is a single write.
    let pendingAdminAction = null;
    let adminActionTimer = null;

    function publishAdminAction(action, atSec) {
        if (!isAdmin || !service || !channel || channel.mode === 'off') return;
        if (channel.mode === 'youtube' && channel.youtube.live) return;
        pendingAdminAction = { action, atSec: Math.max(0, Number(atSec) || 0) };
        clearTimeout(adminActionTimer);
        adminActionTimer = setTimeout(flushAdminAction, 350);
    }

    async function flushAdminAction() {
        if (adminBusy) return;
        const request = pendingAdminAction;
        pendingAdminAction = null;
        if (!request || !channel || !service || !isAdmin) return;
        const position = window.CinemaChannel.computePosition(channel);
        const unconfirmed = Boolean(lastAdminSent.at && channelSignature === lastAdminSent.baseSignature);
        const paused = unconfirmed
            ? (lastAdminSent.action === 'pause' ? true : (lastAdminSent.action === 'resume' ? false : position.state === 'paused'))
            : position.state === 'paused';
        const currentOffsetSec = unconfirmed
            ? (paused ? lastAdminSent.atSec : lastAdminSent.atSec + (Date.now() - lastAdminSent.at) / 1000)
            : position.offsetSec;

        let { action } = request;
        // Skip reports that only echo the current timeline; turn a coalesced
        // pause+seek+resume on an already-live channel into a seek.
        if (action === 'pause' && paused && Math.abs(currentOffsetSec - request.atSec) < 2) return;
        if (action === 'resume' && !paused) {
            if (Math.abs(currentOffsetSec - request.atSec) < 2) return;
            action = 'seek';
        }
        if (action === 'seek' && Math.abs(currentOffsetSec - request.atSec) < 2) return;

        const baseSignature = channelSignature;
        adminBusy = true;
        lastAdminWriteAt = Date.now();
        try {
            await service.control(channel, action, { offsetSec: request.atSec });
            const now = Date.now();
            lastAdminWriteAt = now;
            Object.assign(lastAdminSent, { action, atSec: request.atSec, at: now, baseSignature });
        } catch (error) {
            console.warn('[Live] Admin control failed:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast(error?.code === 'permission-denied' ? t('control_admin_only') : (error?.message || t('control_failed')), 'error');
            }
        } finally {
            adminBusy = false;
            if (pendingAdminAction) {
                clearTimeout(adminActionTimer);
                adminActionTimer = setTimeout(flushAdminAction, 50);
            }
        }
    }

    function applyAdminRole(nextIsAdmin) {
        const changed = isAdmin !== nextIsAdmin;
        isAdmin = nextIsAdmin;
        try { chrome.storage?.local?.set?.({ cached_is_admin: nextIsAdmin }); } catch { /* storage unavailable */ }
        if (!channel) return;
        if (channel.mode === 'youtube' && yt.mountedAsAdmin !== isAdmin && !els.stage.hidden && !relay.watching) {
            mountMedia(true);
        } else {
            syncFrameLock();
        }
        if (changed) {
            postBroadcastState();
            renderClock();
        }
    }

    async function verifyAdminForUser(manager, user) {
        if (!user?.uid) {
            applyAdminRole(false);
            return;
        }
        try {
            const profile = await manager.db.collection('users').doc(user.uid).get();
            applyAdminRole(Boolean(profile.exists && profile.data()?.isAdmin === true));
        } catch { /* keep the cached answer */ }
    }

    async function detectAdmin(manager) {
        // Fast path: the flag other pages cache; then confirm against the user profile.
        try {
            const stored = await chrome.storage.local.get('cached_is_admin');
            if (stored?.cached_is_admin === true) applyAdminRole(true);
        } catch { /* ignore */ }
        if (!manager) return;
        try {
            const user = await manager.waitForAuthReady?.(10000);
            await verifyAdminForUser(manager, user);
        } catch { /* keep the cached answer */ }
    }

    async function start() {
        ['liveBadge', 'liveBadgeText', 'liveTitle', 'liveSubtitle', 'liveClock', 'liveStage', 'liveScreen', 'liveEmpty',
            'liveEmptyTitle', 'liveEmptyText', 'liveControls', 'liveMuteBtn', 'liveVolume', 'liveFullscreenBtn', 'liveNotice', 'liveRelayHostBtn', 'liveRelayWatchBtn']
            .forEach(id => { els[id.replace(/^live/, '').replace(/^./, c => c.toLowerCase())] = document.getElementById(id); });
        els.mute = els.muteBtn;
        els.fullscreen = els.fullscreenBtn;
        els.relayHost = els.relayHostBtn;
        els.relayWatch = els.relayWatchBtn;

        try {
            const { i18n } = await import('../../shared/i18n/I18n.js');
            await i18n.init();
            i18n.translatePage();
            document.documentElement.lang = i18n.currentLocale;
            document.title = t('page_title');
            els.subtitle.textContent = t('intro');
            i18n.onLocaleChange(lang => {
                document.documentElement.lang = lang;
                document.title = t('page_title');
                if (emptyKeys && !els.empty.hidden) {
                    els.emptyTitle.textContent = t(emptyKeys[0]);
                    els.emptyText.textContent = t(emptyKeys[1]);
                    setTitle(t('title'));
                }
                if (!channel) {
                    els.subtitle.textContent = t('intro');
                    return;
                }
                if (els.empty.hidden) mountMedia(true);
                renderClock();
                renderRelayButtons();
            });
        } catch (error) {
            console.warn('[Live] Translations unavailable:', error);
        }

        ensureNavigation();
        els.mute.addEventListener('click', toggleSound);
        els.volume.addEventListener('input', onVolumeInput);
        els.fullscreen.addEventListener('click', toggleFullscreen);
        els.relayHost.addEventListener('click', toggleHosting);
        els.relayWatch.addEventListener('click', () => (relay.watching ? leaveRelay() : enterRelay()));
        window.addEventListener('message', event => {
            if (event.origin === window.location.origin && event.source === frameEl()?.contentWindow) {
                if (event.data?.type === 'BROADCAST_READY') postBroadcastState();
                if (event.data?.type === 'BROADCAST_PLAYING') playbackConfirmed = true;
                if (event.data?.type === 'BROADCAST_ADMIN_ACTION' && ['pause', 'resume', 'seek'].includes(event.data.action)) {
                    publishAdminAction(event.data.action, event.data.atSec);
                }
                if (event.data?.type === 'BROADCAST_MUTED') {
                    els.notice.hidden = false;
                    els.notice.textContent = t('movie_muted');
                }
                return;
            }
            onWrapperMessage(event);
        });
        // Background tabs get throttled timers: resync the moment the viewer comes back.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || !channel) return;
            yt.lastCommandAt = 0;
            postBroadcastState();
            if (channel.mode === 'youtube' && !isAdmin) {
                enforceYoutube(window.CinemaChannel.computePosition(channel), { force: true });
            }
            renderClock();
        });

        const { CinemaChannel } = window;
        // Server-time correction; when it lands, re-send the clock to the players.
        CinemaChannel.syncClock().then(() => {
            if (!channel) return;
            postBroadcastState();
            if (channel.mode === 'youtube') {
                enforceYoutube(CinemaChannel.computePosition(channel), { force: true });
            }
            renderClock();
        });

        // A snapshot that never arrives (offline, blocked) must not leave the loader spinning forever.
        const stallTimer = setTimeout(() => {
            if (!channel) showEmpty('unavailable_title', 'unavailable_reload');
        }, 12000);

        let unsubscribeManual = null;
        let unsubscribeSchedule = null;
        try {
            const manager = await waitForFirebase();
            service = new window.CinemaChannelService(manager);
            if (window.LiveRelayService && typeof RTCPeerConnection === 'function') {
                relay.service = new window.LiveRelayService(manager);
                // Signed-out viewers cannot read relay status; they simply never see it.
                manager.waitForAuthReady?.(4000).then(user => {
                    if (!user) return;
                    relay.service.subscribeStatus(status => {
                        relay.status = status;
                        if (!status.active && relay.watching) leaveRelay();
                        renderRelayButtons();
                        maybeAutoRelay();
                    }, error => console.warn('[Live] Relay status unavailable:', error));
                });
            }
            detectAdmin(manager);
            window.addEventListener('authStateChanged', event => {
                verifyAdminForUser(manager, event.detail?.user || null);
            });
            unsubscribeSchedule = service.subscribeSchedule(items => {
                scheduleItems = items;
                if (manualChannel) refreshChannel();
            }, error => console.warn('[Live] Schedule unavailable:', error));
            unsubscribeManual = service.subscribe(next => {
                clearTimeout(stallTimer);
                manualChannel = next;
                refreshChannel({ force: true });
            }, error => {
                console.warn('[Live] Channel subscription failed:', error);
                showEmpty('unavailable_title', 'unavailable_later');
            });
        } catch (error) {
            console.warn('[Live] Firebase is not ready:', error);
            detectAdmin(null);
            showEmpty('unavailable_title', 'unavailable_later');
        }

        unsubscribe = () => {
            unsubscribeManual?.();
            unsubscribeSchedule?.();
        };
        // Planned shows start (and end) by time alone, so re-resolve every second.
        clockTimer = setInterval(() => { refreshChannel(); renderClock(); }, 1000);
        window.addEventListener('pagehide', () => {
            clearInterval(clockTimer);
            unsubscribe?.();
            relay.host?.stop();
            relay.viewer?.leave();
        }, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
