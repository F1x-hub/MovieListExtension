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
    const yt = { origin: '', time: 0, at: 0, state: 'UNSTARTED', muted: false, lastCommandAt: 0, mountedAt: 0, forcedMute: false };

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
        return c.mode === 'movie' ? `movie:${c.movie.kinopoiskId}` : `youtube:${c.youtube.videoId}`;
    }

    function frameEl() {
        return els.screen.querySelector('.live-frame');
    }

    function showEmpty(title, text) {
        els.screen.replaceChildren();
        els.stage.hidden = true;
        els.empty.hidden = false;
        els.emptyTitle.textContent = title;
        els.emptyText.textContent = text;
        els.badge.hidden = true;
        els.clock.hidden = true;
        els.controls.hidden = true;
        els.notice.hidden = true;
        els.title.textContent = 'Эфир';
        mountedKey = '';
    }

    function createFrame(src, title) {
        const frame = document.createElement('iframe');
        frame.className = 'live-frame';
        frame.src = src;
        frame.title = title || 'Эфир';
        frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
        frame.allowFullscreen = true;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        // Reveal the player only once it has painted, instead of a hard cut from black.
        frame.addEventListener('load', () => frame.classList.add('is-ready'), { once: true });
        setTimeout(() => frame.classList.add('is-ready'), 4000);
        return frame;
    }

    function youtubeSrc(videoId, startSec) {
        const config = window.PlayerConfig;
        if (config?.YOUTUBE_WRAPPER_URL) {
            yt.origin = new URL(config.YOUTUBE_WRAPPER_URL).origin;
            // Viewers get no pause/seek UI (sound and fullscreen live on this page);
            // the admin keeps YouTube's controls to drive the broadcast.
            return `${config.buildYouTubeEmbedUrl(videoId, { autoplay: true, start: startSec })}&controls=${isAdmin ? 1 : 0}`;
        }
        yt.origin = '';
        return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&start=${startSec}&rel=0&controls=${isAdmin ? 1 : 0}&disablekb=${isAdmin ? 0 : 1}`;
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
            showEmpty('Сейчас ничего не идёт', 'Когда начнётся показ, он появится здесь автоматически — страницу обновлять не нужно.');
            return;
        }
        if (position.state === 'ended') {
            showEmpty('Показ завершился', 'Следующий эфир появится здесь, как только его запустят.');
            mountedKey = `ended:${key}`;
            return;
        }
        if (position.state === 'upcoming') {
            showEmpty('Скоро начнётся', 'Показ стартует автоматически — оставайтесь на странице.');
            mountedKey = `upcoming:${key}`;
            els.clock.hidden = false;
            return;
        }

        els.empty.hidden = true;
        els.stage.hidden = false;
        els.notice.hidden = true;
        els.title.textContent = channel.title || (channel.mode === 'youtube' ? 'Эфир' : 'Фильм в эфире');

        let src;
        if (channel.mode === 'youtube') {
            Object.assign(yt, { time: position.offsetSec, at: Date.now(), state: 'UNSTARTED', muted: false, lastCommandAt: 0, mountedAt: Date.now(), forcedMute: false });
            src = youtubeSrc(channel.youtube.videoId, position.offsetSec);
        } else {
            const params = new URLSearchParams({
                movieId: String(channel.movie.kinopoiskId),
                embedded: 'true',
                autoplay: 'true',
                broadcastStart: String(localStartMs())
            });
            src = `../movie-details/movie-details.html?${params}`;
        }

        els.screen.replaceChildren(createFrame(src, channel.title));
        els.screen.classList.toggle('live-screen--movie', channel.mode === 'movie');
        mountedKey = key;
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
    function ytCommand(action, payload) {
        const frame = frameEl();
        if (!frame?.contentWindow || !yt.origin) return;
        yt.lastCommandAt = Date.now();
        try { frame.contentWindow.postMessage({ action, payload }, yt.origin); } catch { /* frame navigating */ }
    }

    function ytEstimatedTime() {
        return yt.state === 'PLAYING' ? yt.time + (Date.now() - yt.at) / 1000 : yt.time;
    }

    function enforceYoutube(position) {
        if (channel?.mode !== 'youtube' || !yt.origin || !frameEl()) return;
        // The admin drives YouTube themselves; their actions are published instead.
        if (isAdmin) return;
        // Give the wrapper a moment to load before steering it, and don't spam commands.
        if (Date.now() - yt.mountedAt < 2500 || Date.now() - yt.lastCommandAt < 900) return;
        const live = channel.youtube.live;
        if (position.state === 'paused') {
            if (yt.state === 'PLAYING' || yt.state === 'BUFFERING') ytCommand('PAUSE');
            else if (Math.abs(ytEstimatedTime() - position.offsetSec) > 1.5) ytCommand('SEEK', { seconds: position.offsetSec });
            return;
        }
        if (!live && Math.abs(ytEstimatedTime() - position.offsetSec) > DRIFT_SEC) {
            ytCommand('SEEK', { seconds: position.offsetSec });
            return;
        }
        if (['PAUSED', 'CUED', 'UNSTARTED'].includes(yt.state)) {
            // A browser that blocks autoplay with sound still allows it muted.
            if (!yt.forcedMute && Date.now() - yt.mountedAt > 6000 && yt.state !== 'PAUSED') {
                yt.forcedMute = true;
                ytCommand('MUTE');
                yt.muted = true;
                renderSound();
                setTimeout(() => ytCommand('PLAY'), 150);
                return;
            }
            ytCommand('PLAY');
        }
    }

    function onWrapperMessage(event) {
        const frame = frameEl();
        if (!yt.origin || event.origin !== yt.origin || !frame || event.source !== frame.contentWindow) return;
        const data = event.data;
        if (!data || data.source !== 'STARTTAB_PLAYER_WRAPPER') return;
        const payload = data.payload || {};
        const previousState = yt.state;
        const expected = ytEstimatedTime();
        if (Number.isFinite(Number(payload.currentTime))) {
            yt.time = Number(payload.currentTime);
            yt.at = Date.now();
        }
        if (data.event === 'STATE_CHANGE' && payload.state) yt.state = payload.state;
        if (isAdmin && !channel?.youtube?.live && Date.now() - yt.lastCommandAt > 1500 && Date.now() - yt.mountedAt > 2500) {
            if (data.event === 'STATE_CHANGE' && payload.state === 'PAUSED' && previousState !== 'PAUSED') publishAdminAction('pause', yt.time);
            else if (data.event === 'STATE_CHANGE' && payload.state === 'PLAYING' && previousState === 'PAUSED') publishAdminAction('resume', yt.time);
            else if (Math.abs(yt.time - expected) > DRIFT_SEC && previousState === 'PLAYING') publishAdminAction('seek', yt.time);
        }
        if (data.event === 'TIME_UPDATE') { yt.state = 'PLAYING'; playbackConfirmed = true; }
        if (data.event === 'READY') yt.state = yt.state === 'UNSTARTED' ? 'CUED' : yt.state;
        if (data.event === 'ERROR') {
            relay.sourceFailed = true;
            if (!maybeAutoRelay()) {
                els.notice.hidden = false;
                els.notice.textContent = 'YouTube не даёт показать это видео здесь. Если ведущий включит трансляцию, вы подключитесь к ней автоматически.';
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
        els.mute.setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
        // The wrapper bridge only knows mute/unmute, so volume is relay-only.
        els.volume.hidden = !relayOn;
        if (relayOn) els.volume.value = String(muted ? 0 : relay.video.volume);
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
            els.relayHost.textContent = relay.host ? `Остановить трансляцию · зрителей: ${viewers}` : 'Транслировать мою вкладку';
            els.relayHost.classList.toggle('btn-primary', Boolean(relay.host));
            els.relayHost.classList.toggle('btn-secondary', !relay.host);
        }
        els.relayWatch.hidden = isAdmin || !on;
        els.relayWatch.textContent = relay.watching ? 'Вернуться к источнику' : 'Смотреть трансляцию ведущего';
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
            Utils?.showToast?.('Этот браузер не умеет транслировать вкладку', 'error');
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
            Utils?.showToast?.('Трансляция включена. Не закрывайте и не сворачивайте эту вкладку.', 'success', 5000);
        } catch (error) {
            if (error?.name !== 'NotAllowedError') {
                console.warn('[Live] Could not start the relay:', error);
                Utils?.showToast?.(error?.code === 'permission-denied' ? 'Транслировать может только администратор' : 'Не удалось начать трансляцию', 'error');
            }
        }
        renderRelayButtons();
    }

    async function enterRelay({ auto = false } = {}) {
        if (relay.watching || !relay.status.active || !relay.service || isAdmin) return;
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
            ? 'Источник недоступен у вас — подключаемся к трансляции ведущего…'
            : 'Подключаемся к трансляции ведущего…';
        try {
            relay.viewer = await relay.service.join(relay.status.sessionId, {
                onStream: stream => {
                    video.srcObject = stream;
                    video.play().catch(() => {
                        video.muted = true;
                        video.play().catch(() => {});
                        els.notice.textContent = 'Трансляция идёт без звука — включите звук кнопкой на видео.';
                        renderSound();
                    });
                    if (!video.muted) els.notice.hidden = true;
                    renderSound();
                },
                onState: state => {
                    if (state === 'failed') {
                        els.notice.hidden = false;
                        els.notice.textContent = 'Не удалось соединиться с ведущим (сеть блокирует прямое подключение).';
                    }
                }
            });
        } catch (error) {
            console.warn('[Live] Could not join the relay:', error);
            els.notice.hidden = false;
            els.notice.textContent = error?.message || 'Не удалось подключиться к трансляции ведущего.';
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
    function renderClock() {
        if (!channel || channel.mode === 'off') return;
        const { CinemaChannel } = window;
        const position = CinemaChannel.computePosition(channel);
        const isLiveStream = channel.mode === 'youtube' && channel.youtube.live;
        const playing = !els.stage.hidden;

        els.badge.hidden = position.state !== 'live' && position.state !== 'paused';
        els.badgeText.textContent = position.state === 'paused' ? 'Пауза' : 'В эфире';
        els.badge.classList.toggle('is-paused', position.state === 'paused');
        els.clock.hidden = isLiveStream || (!playing && position.state !== 'upcoming');
        renderSound();

        if (position.state === 'paused') {
            els.clock.textContent = `Пауза на ${CinemaChannel.formatClock(position.offsetSec)}`;
        } else if (position.state === 'upcoming') {
            els.clock.textContent = `Начало через ${CinemaChannel.formatClock(position.offsetSec)}`;
        } else if (position.state === 'live' && !isLiveStream) {
            const total = channel.movie?.durationSec;
            els.clock.textContent = total
                ? `${CinemaChannel.formatClock(position.offsetSec)} / ${CinemaChannel.formatClock(total)}`
                : `Идёт ${CinemaChannel.formatClock(position.offsetSec)}`;
        }

        enforceYoutube(position);
        renderRelayButtons();
        if (position.state === 'live' || position.state === 'paused') maybeAutoRelay();

        // Switch screens when the broadcast starts or runs past its duration.
        if ((position.state === 'live' && (mountedKey.startsWith('upcoming:') || mountedKey.startsWith('ended:')))
            || (position.state === 'ended' && els.empty.hidden)) {
            mountMedia(true);
        }
        els.subtitle.textContent = isLiveStream
            ? 'Прямая трансляция — все смотрят одно и то же прямо сейчас.'
            : isAdmin
                ? 'Вы ведёте эфир: пауза и перемотка в плеере сразу меняют показ у всех зрителей.'
            : position.state === 'paused'
                ? 'Показ на паузе — продолжится у всех одновременно.'
                : 'Общий показ, как по телевизору: пауза и перемотка недоступны, все смотрят один момент.';
    }

    // ---- Admin timeline controls ------------------------------------------------
    let service = null;
    let isAdmin = false;
    let adminBusy = false;

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
        const request = pendingAdminAction;
        pendingAdminAction = null;
        if (!request || !channel || adminBusy) return;
        const position = window.CinemaChannel.computePosition(channel);
        const paused = position.state === 'paused';
        // Skip reports that only echo the current timeline.
        if (request.action === 'pause' && paused && Math.abs(position.offsetSec - request.atSec) < 2) return;
        if (request.action === 'resume' && !paused) return;
        if (request.action === 'seek' && Math.abs(position.offsetSec - request.atSec) < 2) return;
        adminBusy = true;
        try {
            await service.control(channel, request.action, { offsetSec: request.atSec });
        } catch (error) {
            console.warn('[Live] Admin control failed:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast(error?.code === 'permission-denied' ? 'Управлять эфиром может только администратор' : (error?.message || 'Не удалось изменить эфир'), 'error');
            }
        } finally {
            adminBusy = false;
        }
    }

    async function detectAdmin(manager) {
        const wasAdmin = isAdmin;
        // Fast path: the flag other pages cache; then confirm against the user profile.
        try {
            const stored = await chrome.storage.local.get('cached_is_admin');
            isAdmin = stored?.cached_is_admin === true;
        } catch { isAdmin = false; }
        if (!manager) return;
        try {
            const user = await manager.waitForAuthReady?.(4000);
            if (!user?.uid) { isAdmin = false; return; }
            const profile = await manager.db.collection('users').doc(user.uid).get();
            isAdmin = profile.exists && profile.data()?.isAdmin === true;
        } catch { /* keep the cached answer */ }
        // Role decides the player chrome (YouTube controls, movie lock): refresh it.
        if (channel && wasAdmin !== isAdmin) {
            if (channel.mode === 'youtube') mountMedia(true);
            postBroadcastState();
        }
    }

    async function start() {
        ['liveBadge', 'liveBadgeText', 'liveTitle', 'liveSubtitle', 'liveClock', 'liveStage', 'liveScreen', 'liveEmpty',
            'liveEmptyTitle', 'liveEmptyText', 'liveControls', 'liveMuteBtn', 'liveVolume', 'liveFullscreenBtn', 'liveNotice', 'liveRelayHostBtn', 'liveRelayWatchBtn']
            .forEach(id => { els[id.replace(/^live/, '').replace(/^./, c => c.toLowerCase())] = document.getElementById(id); });
        els.mute = els.muteBtn;
        els.fullscreen = els.fullscreenBtn;
        els.relayHost = els.relayHostBtn;
        els.relayWatch = els.relayWatchBtn;

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
                    els.notice.textContent = 'Браузер запустил фильм без звука — включите звук кнопкой громкости в плеере.';
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
            renderClock();
        });

        const { CinemaChannel } = window;
        // Server-time correction; when it lands, re-send the clock to the players.
        CinemaChannel.syncClock().then(() => {
            if (!channel) return;
            postBroadcastState();
            renderClock();
        });

        // A snapshot that never arrives (offline, blocked) must not leave the loader spinning forever.
        const stallTimer = setTimeout(() => {
            if (!channel) showEmpty('Эфир недоступен', 'Не удалось подключиться к каналу. Проверьте соединение и обновите страницу.');
        }, 12000);

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
            unsubscribe = service.subscribe(next => {
                clearTimeout(stallTimer);
                channel = next;
                yt.lastCommandAt = 0;
                mountMedia();
                postBroadcastState();
                renderClock();
            }, error => {
                console.warn('[Live] Channel subscription failed:', error);
                showEmpty('Эфир недоступен', 'Не удалось подключиться к каналу. Проверьте соединение и попробуйте позже.');
            });
        } catch (error) {
            console.warn('[Live] Firebase is not ready:', error);
            detectAdmin(null);
            showEmpty('Эфир недоступен', 'Не удалось подключиться к каналу. Проверьте соединение и попробуйте позже.');
        }

        clockTimer = setInterval(renderClock, 1000);
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
