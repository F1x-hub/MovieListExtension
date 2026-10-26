/**
 * «Эфир» page: one shared broadcast for every viewer, like a TV channel.
 *
 * The page subscribes to the channel document, works out where the broadcast is
 * right now (against server time, so viewers with wrong clocks still agree) and
 * loads the media itself. Movies play in the movie page, YouTube videos in
 * youtube-player.html; both use the shared movie player with its broadcast lock,
 * fed by BROADCAST_STATE from here. Viewers cannot pause or seek; sound,
 * fullscreen, speed and the rest stay personal. The admin uses the player's own
 * controls; their pause/play/seek becomes the timeline for everyone. Nothing is
 * restreamed by our servers.
 */
(function () {
    'use strict';

    const els = {};
    let channel = null;
    let mountedKey = '';
    let clockTimer = null;
    let unsubscribe = null;
    let standby = null;
    let programme = null;
    let mediaEnded = null;

    // What the YouTube player reported about the mounted video. A video published
    // without a length still ends on time: { key, sec } is the learned length.
    const ytInfo = { key: '', duration: 0, isLive: false, endSec: 0, stored: '' };

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
        const episodeKey = c.movie?.mediaType === 'tv-series'
            ? `:S${c.movie.seasonNumber}E${c.movie.episodeNumber}` : '';
        return c.mode === 'movie' ? `movie:${c.docPath}:${c.movie.kinopoiskId}${episodeKey}` : `youtube:${c.docPath}:${c.youtube.videoId}`;
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

    function playbackIdentity() {
        const anchor = Number.isFinite(channel?.playbackStartedAtMs) ? channel.playbackStartedAtMs : channel?.startedAtMs;
        return [channelKey(channel), anchor,
            channel?.[channel?.mode]?.pausedAtSec].join('|');
    }

    function renderStandby() {
        if (!standby || els.empty.hidden) return;
        const at = window.CinemaChannel.now();
        const next = window.CinemaChannel.nextScheduled(scheduleItems, at);
        standby.render({ channel, position: channel ? currentPosition() : null, next, nowMs: at,
            errorKeys: emptyKeys?.[0]?.startsWith('unavailable') ? emptyKeys : null });
    }

    function renderProgramme() {
        const nowMs = window.CinemaChannel.now();
        const items = window.CinemaChannel.projectPausedSchedule(scheduleItems, channel, nowMs);
        programme?.render({ items, channel, position: channel ? currentPosition() : null,
            nowMs, ready: scheduleReady, error: scheduleError });
    }

    function showEmpty(titleKey, textKey) {
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
        renderStandby();
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

    /**
     * computePosition plus the length the YouTube player reported, for videos
     * published without one: such a broadcast ends when the video does.
     */
    function currentPosition() {
        const position = window.CinemaChannel.computePosition(channel);
        if (mediaEnded && mediaEnded.identity !== playbackIdentity()) mediaEnded = null;
        if (mediaEnded && ['live', 'paused'].includes(position.state)) return { state: 'ended', offsetSec: mediaEnded.atSec };
        if (channel?.mode !== 'youtube' || channel.youtube.live || channel.youtube.durationSec || position.state !== 'live') return position;
        const sec = ytInfo.key === channelKey(channel) ? ytInfo.endSec : 0;
        return sec > 0 && position.offsetSec >= sec ? { state: 'ended', offsetSec: sec } : position;
    }

    function learnYoutubeLength(sec) {
        // Longer than YouTube's 12-hour upload cap: a live stream, never a length.
        if (channel?.mode !== 'youtube' || channel.youtube.live || ytInfo.isLive || !(sec > 0) || sec > 12 * 3600) return;
        const key = channelKey(channel);
        if (ytInfo.key !== key) Object.assign(ytInfo, { key, duration: 0, isLive: false, endSec: 0 });
        ytInfo.endSec = ytInfo.endSec > 0 ? Math.min(ytInfo.endSec, sec) : sec;
        // The admin's tab writes it down, so every viewer's page ends the show too.
        if (isAdmin && service && !channel.youtube.durationSec && ytInfo.stored !== key) {
            ytInfo.stored = key;
            service.setYoutubeDuration(channel, Math.ceil(ytInfo.endSec)).catch(error => {
                ytInfo.stored = '';
                console.warn('[Live] Could not store the video length:', error);
            });
        }
    }

    /** What the embedded YouTube player page reports about the video. */
    function onYoutubeReport(data) {
        if (data.type === 'BROADCAST_ENDED' && channel?.mode !== 'off'
            && !(channel?.mode === 'youtube' && (channel.youtube.live || ytInfo.isLive))) {
            if (Number.isFinite(Number(data.startMs)) && Math.abs(Number(data.startMs) - localStartMs()) > 2000) return;
            const reported = Number(data.atSec);
            const position = window.CinemaChannel.computePosition(channel);
            // A queued EOF from before a rewind must not end the new timeline.
            // Some wrappers omit startMs, so also validate its media position.
            if (position.state === 'paused' || pendingAdminPause?.key === channelKey(channel)
                || (Number.isFinite(reported) && reported > position.offsetSec + 2)) return;
            mediaEnded = { identity: playbackIdentity(), atSec: Number.isFinite(reported) ? Math.max(0, reported) : position.offsetSec };
            if (channel.mode === 'youtube') learnYoutubeLength(reported);
            renderClock(); return;
        }
        if (channel?.mode !== 'youtube') return;
        const key = channelKey(channel);
        if (ytInfo.key !== key) Object.assign(ytInfo, { key, duration: 0, isLive: false, endSec: 0 });
        if (data.type === 'BROADCAST_MEDIA_INFO') {
            if (data.isLive === true) {
                ytInfo.isLive = true;
                return;
            }
            const duration = Number(data.durationSec);
            if (Number.isFinite(duration) && duration > 0) {
                ytInfo.duration = duration;
                learnYoutubeLength(duration);
            }
        } else if (data.type === 'BROADCAST_SOURCE_ERROR') {
            relay.sourceFailed = true;
            if (!maybeAutoRelay()) {
                els.notice.hidden = false;
                els.notice.textContent = t('youtube_blocked');
            }
        }
    }

    /** Titles open their source: catalogue details or the current YouTube video. */
    function setTitle(text, movieId = NaN, youtubeVideoId = '') {
        const movie = Number.isSafeInteger(movieId) && movieId > 0;
        const youtube = /^[A-Za-z0-9_-]{11}$/.test(youtubeVideoId);
        if (!movie && !youtube) {
            els.title.textContent = text;
            return;
        }
        const link = document.createElement('a');
        link.className = 'live-title__link';
        link.href = movie ? `../movie-details/movie-details.html?movieId=${movieId}`
            : `https://www.youtube.com/watch?v=${youtubeVideoId}`;
        link.textContent = text;
        link.title = t(movie ? 'open_movie' : 'open_youtube');
        if (!movie) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
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
        const position = currentPosition();

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
            els.clock.hidden = Boolean(standby);
            return;
        }

        els.empty.hidden = true;
        els.stage.hidden = false;
        els.notice.hidden = true;
        const movieId = channel.mode === 'movie' ? Number(channel.movie?.kinopoiskId) : NaN;
        setTitle(channel.title || (channel.mode === 'youtube' ? t('title') : t('movie_on_air')), movieId,
            channel.mode === 'youtube' ? channel.youtube.videoId : '');

        let src;
        if (channel.mode === 'youtube') {
            const params = new URLSearchParams({
                v: channel.youtube.videoId,
                start: String(position.offsetSec),
                live: channel.youtube.live ? '1' : '0'
            });
            src = `youtube-player.html?${params}`;
        } else {
            const params = new URLSearchParams({
                movieId: String(channel.movie.kinopoiskId),
                embedded: 'true',
                autoplay: 'true',
                broadcastStart: String(localStartMs())
            });
            if (channel.movie.mediaType === 'tv-series') {
                params.set('mediaType', 'tv-series');
                params.set('seasonNumber', String(channel.movie.seasonNumber));
                params.set('episodeNumber', String(channel.movie.episodeNumber));
                if (channel.movie.episodeTitle) params.set('episodeTitle', channel.movie.episodeTitle);
                if (channel.movie.tmdbId) params.set('tmdbId', String(channel.movie.tmdbId));
            }
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
        const anchor = Number.isFinite(channel.playbackStartedAtMs) ? channel.playbackStartedAtMs : channel.startedAtMs;
        const serverStart = Number.isFinite(anchor) ? anchor : CinemaChannel.now() - position.offsetSec * 1000;
        return CinemaChannel.toLocalMs(serverStart);
    }

    /** Hands the channel clock to the embedded player (it enforces it on the media). */
    function postBroadcastState() {
        if (channel?.mode !== 'movie' && channel?.mode !== 'youtube') return;
        const frame = frameEl();
        if (!frame?.contentWindow) return;
        const pausedAtSec = channel[channel.mode].pausedAtSec;
        try {
            frame.contentWindow.postMessage({ type: 'BROADCAST_STATE', startMs: localStartMs(), pausedAtSec: Number.isFinite(pausedAtSec) ? pausedAtSec : null, admin: isAdmin }, window.location.origin);
        } catch { /* frame navigating */ }
    }

    // ---- Sound / fullscreen ----------------------------------------------------
    // Movies and YouTube keep the movie player's own controls; only the relay
    // video gets this small overlay.
    const VOLUME_KEY = 'movieExtension_videoVolume';

    function savedVolume() {
        try {
            const raw = localStorage.getItem(VOLUME_KEY);
            const value = raw === null ? NaN : Number(raw);
            return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
        } catch { return 1; }
    }

    function renderSound() {
        const relayOn = relay.watching && relay.video;
        els.controls.hidden = els.stage.hidden || !relayOn;
        if (els.controls.hidden) return;
        const muted = relay.video.muted || relay.video.volume === 0;
        els.mute.classList.toggle('is-muted', muted);
        // Keep the controls visible while sound is off, so viewers find the button.
        els.controls.classList.toggle('is-attention', muted);
        els.mute.setAttribute('aria-label', muted ? t('unmute') : t('mute'));
        const volume = String(muted ? 0 : relay.video.volume);
        if (els.volume.value !== volume) els.volume.value = volume;
    }

    function toggleSound() {
        const video = relay.video;
        if (!relay.watching || !video) return;
        if (video.muted || video.volume === 0) {
            video.muted = false;
            if (video.volume === 0) video.volume = 0.5;
            video.play().catch(() => {});
        } else {
            video.muted = true;
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
        try { await viewer?.leave(); } finally {
            els.notice.hidden = true;
            mountedKey = '';
            if (channel) mountMedia(true);
            renderRelayButtons();
        }
    }

    /** Switch a stuck or failing viewer to the relay. Returns true when it did. */
    function maybeAutoRelay() {
        if (isAdmin || relay.watching || !relay.status.active || !channel || channel.mode === 'off') return false;
        if (!['live', 'paused'].includes(currentPosition().state)) return false;
        const stuck = !playbackConfirmed && mediaMountedAt && Date.now() - mediaMountedAt > AUTO_RELAY_AFTER_MS;
        if (!relay.sourceFailed && !stuck) return false;
        enterRelay({ auto: true });
        return true;
    }

    // ---- Clock & status --------------------------------------------------------
    // The manual channel plus the schedule; `channel` is whatever is on air now.
    let manualChannel = null;
    let scheduleItems = [];
    let scheduleReady = false;
    let scheduleError = false;
    let channelSignature = '';

    function signatureOf(c) {
        const media = c?.[c?.mode];
        return [c?.docPath, c?.mode, c?.startedAtMs, c?.endsAtMs, c?.playbackStartedAtMs, media?.pausedAtSec, media?.videoId || media?.kinopoiskId, media?.mediaType, media?.seasonNumber, media?.episodeNumber, media?.episodeTitle, media?.durationSec, c?.title].join('|');
    }

    function refreshChannel({ force = false } = {}) {
        if (!manualChannel) return;
        let next = window.CinemaChannel.resolveChannel(manualChannel, scheduleItems);
        if (pendingAdminPause) {
            const source = [manualChannel, ...scheduleItems].find(item => channelKey(item) === pendingAdminPause.key);
            const overridden = manualChannel.startedAtMs > pendingAdminPause.startedAtMs;
            const confirmed = source && source[source.mode]?.pausedAtSec === pendingAdminPause.atSec;
            const newer = pendingAdminPause.committed && source?.updatedAtVersion
                && source.updatedAtVersion !== pendingAdminPause.baseVersion;
            if (!source || overridden || source.startedAtMs !== pendingAdminPause.startedAtMs || confirmed || newer) pendingAdminPause = null;
            else next = { ...source, [source.mode]: { ...source[source.mode], pausedAtSec: pendingAdminPause.atSec } };
        }
        const signature = signatureOf(next);
        const changed = signature !== channelSignature;
        if (!force && !changed) return;
        channelSignature = signature;
        const previousKey = channelKey(channel);
        channel = next;
        if (relay.watching && previousKey !== channelKey(channel)) {
            leaveRelay().catch(error => console.warn('[Live] Relay transition failed:', error));
            return;
        }
        mountMedia();
        postBroadcastState();
        renderClock();
    }

    function renderClock() {
        renderStandby();
        renderProgramme();
        if (!channel || channel.mode === 'off') return;
        const { CinemaChannel } = window;
        const position = currentPosition();
        if (relay.watching && !['live', 'paused'].includes(position.state)) {
            leaveRelay().catch(error => console.warn('[Live] Relay slot ended:', error));
            return;
        }
        const isLiveStream = channel.mode === 'youtube' && channel.youtube.live;
        const playing = !els.stage.hidden;

        els.badge.hidden = position.state !== 'live' && position.state !== 'paused';
        setText(els.badgeText, position.state === 'paused' ? t('badge_paused') : t('badge_live'));
        els.badge.classList.toggle('is-paused', position.state === 'paused');
        els.clock.hidden = isLiveStream || (!playing && (Boolean(standby) || position.state !== 'upcoming'));
        renderSound();

        if (position.state === 'paused') {
            setText(els.clock, t('clock_paused', { time: CinemaChannel.formatClock(position.offsetSec) }));
        } else if (position.state === 'upcoming') {
            setText(els.clock, t('clock_upcoming', { time: CinemaChannel.formatClock(position.offsetSec) }));
        } else if (position.state === 'live' && !isLiveStream) {
            const total = channel[channel.mode]?.durationSec || (channel.mode === 'youtube' && ytInfo.key === channelKey(channel) && ytInfo.duration > 0 ? Math.round(ytInfo.duration) : 0);
            setText(els.clock, total
                ? `${CinemaChannel.formatClock(position.offsetSec)} / ${CinemaChannel.formatClock(total)}`
                : t('clock_playing', { time: CinemaChannel.formatClock(position.offsetSec) }));
        }

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
    const lastAdminSent = { action: '', paused: false, atSec: 0, at: 0, baseSignature: '' };

    // The admin's own pause/play/seek in the player becomes the broadcast timeline.
    // Reports are coalesced so one drag on the progress bar is a single write.
    let pendingAdminAction = null;
    let adminActionTimer = null;
    let pendingAdminPause = null;

    function publishAdminAction(action, atSec) {
        if (!isAdmin || !service || !channel || channel.mode === 'off') return;
        if (channel.mode === 'youtube' && channel.youtube.live) return;
        // Scrubbing changes the position, not an earlier queued pause/play.
        // Coalescing only the final event loses that phase before the write.
        const queued = pendingAdminAction;
        const key = channelKey(channel);
        if (action === 'seek' && queued?.key === key && ['pause', 'resume'].includes(queued.action)) action = queued.action;
        pendingAdminAction = { action, atSec: Math.max(0, Number(atSec) || 0), key };
        if (action === 'pause' || (action === 'seek' && pendingAdminPause?.key === key)) {
            const duration = channel[channel.mode]?.durationSec || 0;
            const source = [manualChannel, ...scheduleItems].find(item => channelKey(item) === key) || channel;
            pendingAdminPause = { key, startedAtMs: channel.startedAtMs, baseVersion: source.updatedAtVersion, committed: false,
                atSec: duration > 0 ? Math.min(pendingAdminAction.atSec, Math.max(0, duration - 5)) : pendingAdminAction.atSec };
            pendingAdminAction.pauseIntent = pendingAdminPause;
            refreshChannel();
        } else if (action === 'resume') pendingAdminPause = null;
        clearTimeout(adminActionTimer);
        // A phase change at the very end must reach the server before the next
        // clock tick can replace the show; only progress-bar drags are debounced.
        if (action === 'seek') adminActionTimer = setTimeout(flushAdminAction, 350);
        else flushAdminAction();
    }

    async function flushAdminAction() {
        if (adminBusy) return;
        const request = pendingAdminAction;
        pendingAdminAction = null;
        if (!request || !channel || !service || !isAdmin || request.key !== channelKey(channel)) return;
        const source = [manualChannel, ...scheduleItems].find(item => channelKey(item) === request.key) || channel;
        const sourceSignature = signatureOf(source);
        const position = window.CinemaChannel.computePosition(source);
        const unconfirmed = Boolean(lastAdminSent.at && sourceSignature === lastAdminSent.baseSignature);
        const paused = unconfirmed
            ? lastAdminSent.paused
            : position.state === 'paused';
        const currentOffsetSec = unconfirmed
            ? (paused ? lastAdminSent.atSec : lastAdminSent.atSec + (Date.now() - lastAdminSent.at) / 1000)
            : position.offsetSec;

        let { action } = request;
        // Skip reports that only echo the current timeline; turn a coalesced
        // pause+seek+resume on an already-live channel into a seek.
        if (action === 'pause' && paused && !pendingAdminPause && Math.abs(currentOffsetSec - request.atSec) < 2) return;
        if (action === 'resume' && !paused) {
            if (Math.abs(currentOffsetSec - request.atSec) < 2) return;
            action = 'seek';
        }
        if (action === 'seek' && Math.abs(currentOffsetSec - request.atSec) < 2) return;

        const baseSignature = sourceSignature;
        adminBusy = true;
        try {
            await service.control(source, action, { offsetSec: request.atSec });
            const now = Date.now();
            Object.assign(lastAdminSent, { action, paused: action === 'pause' || (action === 'seek' && paused),
                atSec: request.atSec, at: now, baseSignature });
            if (pendingAdminPause && pendingAdminPause === request.pauseIntent) {
                pendingAdminPause.committed = true;
                refreshChannel();
                // Listener recovery must not leave a local pause permanently
                // hiding a newer server state if its acknowledgement was missed.
                setTimeout(() => {
                    if (pendingAdminPause !== request.pauseIntent) return;
                    pendingAdminPause = null;
                    refreshChannel({ force: true });
                }, 5000);
            }
        } catch (error) {
            if (pendingAdminPause?.key === request.key) pendingAdminPause = null;
            refreshChannel({ force: true });
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
        if (window.LiveStandby) standby = new window.LiveStandby(els.empty, t);
        if (window.LiveProgramme) programme = new window.LiveProgramme(document.getElementById('liveProgramme'), t);

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
                    renderProgramme();
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
        renderProgramme();
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
                if (['BROADCAST_MEDIA_INFO', 'BROADCAST_ENDED', 'BROADCAST_SOURCE_ERROR'].includes(event.data?.type)) {
                    onYoutubeReport(event.data);
                }
            }
        });
        // Background tabs get throttled timers: resync the moment the viewer comes back.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || !channel) return;
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
                scheduleReady = true;
                scheduleError = false;
                if (manualChannel) refreshChannel();
                renderProgramme();
            }, error => {
                console.warn('[Live] Schedule unavailable:', error);
                scheduleError = true;
                renderProgramme();
            });
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
            scheduleError = true;
            renderProgramme();
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
            programme?.destroy();
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
