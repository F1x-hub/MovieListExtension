/**
 * «Эфир» page: one shared broadcast for every viewer.
 *
 * The page subscribes to the channel document, works out where the broadcast is
 * right now and loads the media itself, so joining late lands on the same moment
 * as everyone else. Nothing is restreamed through our servers.
 */
(function () {
    'use strict';

    const els = {};
    let channel = null;
    let mountedKey = '';
    let clockTimer = null;
    let unsubscribe = null;

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

    function channelKey(c) {
        if (!c || c.mode === 'off') return 'off';
        // A movie keeps its player across admin pause/seek: the lock moves it in place.
        if (c.mode === 'movie') return `movie:${c.movie.kinopoiskId}`;
        return `youtube:${c.youtube.videoId}:${c.startedAtMs}`;
    }

    function showEmpty(title, text) {
        els.screen.replaceChildren();
        els.stage.hidden = true;
        els.empty.hidden = false;
        els.emptyTitle.textContent = title;
        els.emptyText.textContent = text;
        els.badge.hidden = true;
        els.clock.hidden = true;
        els.sync.hidden = true;
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

    function mountMedia(force = false) {
        const key = channelKey(channel);
        if (!force && key === mountedKey) return;
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
        els.title.textContent = channel.title || (channel.mode === 'youtube' ? 'Эфир' : 'Фильм в эфире');

        let src;
        if (channel.mode === 'youtube') {
            src = window.PlayerConfig?.buildYouTubeEmbedUrl
                ? window.PlayerConfig.buildYouTubeEmbedUrl(channel.youtube.videoId, { autoplay: true, start: position.offsetSec })
                : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(channel.youtube.videoId)}?autoplay=1&start=${position.offsetSec}&rel=0`;
        } else {
            const params = new URLSearchParams({
                movieId: String(channel.movie.kinopoiskId),
                embedded: 'true',
                autoplay: 'true',
                // Fall back to «now − offset» while the server timestamp is still pending.
                broadcastStart: String(Number.isFinite(channel.startedAtMs) ? channel.startedAtMs : Date.now() - position.offsetSec * 1000)
            });
            src = `../movie-details/movie-details.html?${params}`;
        }

        els.screen.replaceChildren(createFrame(src, channel.title));
        els.screen.classList.toggle('live-screen--movie', channel.mode === 'movie');
        mountedKey = key;
        renderClock();
    }

    /** Hands the channel clock to the embedded movie player (it enforces it on the media). */
    function postBroadcastState() {
        if (channel?.mode !== 'movie') return;
        const frame = els.screen.querySelector('.live-frame');
        if (!frame?.contentWindow) return;
        const startMs = Number.isFinite(channel.startedAtMs) ? channel.startedAtMs : Date.now();
        try {
            frame.contentWindow.postMessage({ type: 'BROADCAST_STATE', startMs, pausedAtSec: channel.movie.pausedAtSec }, window.location.origin);
        } catch { /* frame navigating */ }
    }

    function renderClock() {
        if (!channel || channel.mode === 'off') return;
        const { CinemaChannel } = window;
        const position = CinemaChannel.computePosition(channel);
        const isLiveStream = channel.mode === 'youtube' && channel.youtube.live;

        els.badge.hidden = position.state !== 'live' && position.state !== 'paused';
        els.badgeText.textContent = position.state === 'paused' ? 'Пауза' : 'В эфире';
        els.badge.classList.toggle('is-paused', position.state === 'paused');
        // Movies follow the clock on their own; only YouTube embeds need a manual re-sync.
        els.sync.hidden = isLiveStream || channel.mode === 'movie' || position.state !== 'live';
        els.clock.hidden = isLiveStream;

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
        // Switch screens when the broadcast starts or runs past its duration.
        renderAdmin(position);
        if ((position.state === 'live' && (mountedKey.startsWith('upcoming:') || mountedKey.startsWith('ended:')))
            || (position.state === 'ended' && els.empty.hidden)) {
            mountMedia(true);
        }
        els.subtitle.textContent = isLiveStream
            ? 'Прямая трансляция — все смотрят одно и то же прямо сейчас.'
            : channel.mode === 'movie'
                ? 'Фильм идёт по общему расписанию — пауза и перемотка недоступны, все смотрят один момент.'
                : 'Общий показ: вы подключились с того же момента, что и остальные.';
    }

    // ---- Admin timeline controls ------------------------------------------------
    let service = null;
    let isAdmin = false;
    let adminBusy = false;

    function renderAdmin(position) {
        const canControl = isAdmin && channel && channel.mode !== 'off'
            && !(channel.mode === 'youtube' && channel.youtube.live)
            && position.state !== 'ended';
        els.admin.hidden = !canControl;
        if (!canControl) return;
        const paused = position.state === 'paused';
        els.adminToggle.hidden = channel.mode !== 'movie';
        els.adminToggle.textContent = paused ? 'Продолжить' : 'Пауза';
        els.admin.querySelectorAll('button').forEach(button => { button.disabled = adminBusy; });
    }

    async function adminAction(action, delta) {
        if (!service || !channel || adminBusy) return;
        const position = window.CinemaChannel.computePosition(channel);
        adminBusy = true;
        renderAdmin(position);
        try {
            if (action === 'toggle') {
                await service.control(channel, position.state === 'paused' ? 'resume' : 'pause');
            } else if (action === 'restart') {
                await service.control(channel, 'seek', { offsetSec: 0 });
            } else {
                await service.control(channel, 'seek', { offsetSec: position.offsetSec + delta });
            }
        } catch (error) {
            console.warn('[Live] Admin control failed:', error);
            if (typeof Utils !== 'undefined') {
                Utils.showToast(error?.code === 'permission-denied' ? 'Управлять эфиром может только администратор' : (error?.message || 'Не удалось изменить эфир'), 'error');
            }
        } finally {
            adminBusy = false;
            renderAdmin(window.CinemaChannel.computePosition(channel));
        }
    }

    async function detectAdmin() {
        try {
            const stored = await chrome.storage.local.get('cached_is_admin');
            isAdmin = stored?.cached_is_admin === true;
        } catch { isAdmin = false; }
        if (channel) renderAdmin(window.CinemaChannel.computePosition(channel));
    }

    async function start() {
        ['liveBadge', 'liveBadgeText', 'liveTitle', 'liveSubtitle', 'liveClock', 'liveSyncBtn', 'liveStage', 'liveScreen', 'liveEmpty', 'liveEmptyTitle', 'liveEmptyText', 'liveAdmin', 'liveAdminToggle']
            .forEach(id => { els[id.replace(/^live/, '').replace(/^./, c => c.toLowerCase()) || id] = document.getElementById(id); });
        els.sync = els.syncBtn;

        ensureNavigation();
        els.sync.addEventListener('click', () => mountMedia(true));
        els.admin.addEventListener('click', event => {
            const button = event.target.closest('[data-live-admin]');
            if (button) adminAction(button.dataset.liveAdmin, Number(button.dataset.delta || 0));
        });
        window.addEventListener('message', event => {
            if (event.origin === window.location.origin && event.data?.type === 'BROADCAST_READY') postBroadcastState();
        });
        detectAdmin();

        // A snapshot that never arrives (offline, blocked) must not leave the loader spinning forever.
        const stallTimer = setTimeout(() => {
            if (!channel) showEmpty('Эфир недоступен', 'Не удалось подключиться к каналу. Проверьте соединение и обновите страницу.');
        }, 12000);

        try {
            const manager = await waitForFirebase();
            service = new window.CinemaChannelService(manager);
            unsubscribe = service.subscribe(next => {
                clearTimeout(stallTimer);
                channel = next;
                mountMedia();
                postBroadcastState();
            }, error => {
                console.warn('[Live] Channel subscription failed:', error);
                showEmpty('Эфир недоступен', 'Не удалось подключиться к каналу. Проверьте соединение и попробуйте позже.');
            });
        } catch (error) {
            console.warn('[Live] Firebase is not ready:', error);
            showEmpty('Эфир недоступен', 'Не удалось подключиться к каналу. Проверьте соединение и попробуйте позже.');
        }

        clockTimer = setInterval(renderClock, 1000);
        window.addEventListener('pagehide', () => {
            clearInterval(clockTimer);
            unsubscribe?.();
        }, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
