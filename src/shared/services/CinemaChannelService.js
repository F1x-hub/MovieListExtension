/**
 * CinemaChannelService - the shared «Эфир» channel.
 *
 * The channel is a single Firestore document (`settings/cinemaChannel`) that only
 * admins may write. It never carries video: it only says WHAT is on air and WHEN
 * the broadcast started. Every viewer computes the current position locally and
 * loads the media itself (YouTube embed or the regular movie player), so the
 * broadcast costs one document read per viewer and no video bandwidth.
 *
 *   {
 *     mode: 'off' | 'youtube' | 'movie',
 *     title: string,
 *     youtube: { videoId: string, live: boolean } | null,
 *     movie: { kinopoiskId: number, durationSec: number, posterUrl?: string,
 *              pausedAtSec?: number | null } | null,   // set while the admin holds a pause
 *     startedAt: Timestamp,          // broadcast start (server time)
 *     updatedAt: Timestamp,
 *     updatedBy: string              // admin uid
 *   }
 */
(function () {
    const COLLECTION = 'settings';
    const DOC_ID = 'cinemaChannel';
    const MODES = ['off', 'youtube', 'movie'];
    const MAX_TITLE = 120;

    function safeImageUrl(value) {
        const url = String(value || '').trim();
        return /^https:\/\/[^\s"'<>]{1,500}$/.test(url) ? url : '';
    }

    function toMillis(value) {
        if (!value) return NaN;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number') return value;
        if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    /** Normalizes a raw document into a safe channel object (or an «off» channel). */
    function normalizeChannel(raw) {
        const off = { mode: 'off', title: '', youtube: null, movie: null, startedAtMs: NaN };
        if (!raw || typeof raw !== 'object' || !MODES.includes(raw.mode)) return off;
        const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE) : '';
        const startedAtMs = toMillis(raw.startedAt);

        if (raw.mode === 'youtube') {
            const videoId = String(raw.youtube?.videoId || '');
            if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return off;
            return { mode: 'youtube', title, youtube: { videoId, live: raw.youtube?.live === true }, movie: null, startedAtMs };
        }
        if (raw.mode === 'movie') {
            const kinopoiskId = Number(raw.movie?.kinopoiskId);
            if (!Number.isSafeInteger(kinopoiskId) || kinopoiskId <= 0) return off;
            const durationSec = Number(raw.movie?.durationSec);
            return {
                mode: 'movie',
                title,
                youtube: null,
                movie: {
                    kinopoiskId,
                    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec) : 0,
                    posterUrl: safeImageUrl(raw.movie?.posterUrl),
                    pausedAtSec: Number.isFinite(Number(raw.movie?.pausedAtSec)) && raw.movie?.pausedAtSec !== null && Number(raw.movie.pausedAtSec) >= 0
                        ? Number(raw.movie.pausedAtSec)
                        : null
                },
                startedAtMs
            };
        }
        return off;
    }

    /**
     * Where the broadcast is right now.
     * @returns {{ state: 'off'|'live'|'paused'|'upcoming'|'ended', offsetSec: number }}
     */
    function computePosition(channel, nowMs = Date.now()) {
        if (!channel || channel.mode === 'off') return { state: 'off', offsetSec: 0 };
        // A live YouTube stream is always «now»: there is nothing to seek to.
        if (channel.mode === 'youtube' && channel.youtube?.live) return { state: 'live', offsetSec: 0 };
        if (channel.mode === 'movie' && Number.isFinite(channel.movie?.pausedAtSec)) {
            return { state: 'paused', offsetSec: Math.floor(channel.movie.pausedAtSec) };
        }
        if (!Number.isFinite(channel.startedAtMs)) return { state: 'live', offsetSec: 0 };

        const elapsed = Math.floor((nowMs - channel.startedAtMs) / 1000);
        if (elapsed < 0) return { state: 'upcoming', offsetSec: -elapsed };
        const duration = channel.movie?.durationSec || 0;
        if (duration > 0 && elapsed >= duration) return { state: 'ended', offsetSec: duration };
        return { state: 'live', offsetSec: elapsed };
    }

    /** Builds the Firestore payload an admin writes. Throws a readable error on bad input. */
    function buildChannelPayload({ mode, title = '', youtubeUrl = '', youtubeLive = false, kinopoiskId = '', durationMin = '', posterUrl = '' } = {}) {
        if (!MODES.includes(mode)) throw new Error('Неизвестный режим эфира');
        const cleanTitle = String(title || '').trim().slice(0, MAX_TITLE);
        if (mode === 'off') return { mode: 'off', title: cleanTitle, youtube: null, movie: null };

        if (mode === 'youtube') {
            const info = typeof Utils !== 'undefined' && Utils.extractYouTubeVideoInfo
                ? Utils.extractYouTubeVideoInfo(String(youtubeUrl || '').trim())
                : null;
            if (!info?.id) throw new Error('Укажите ссылку на видео или трансляцию YouTube');
            return { mode: 'youtube', title: cleanTitle, youtube: { videoId: info.id, live: youtubeLive === true }, movie: null };
        }

        const id = Number(String(kinopoiskId || '').trim());
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Укажите Kinopoisk ID фильма');
        const minutes = Number(String(durationMin || '').replace(',', '.'));
        return {
            mode: 'movie',
            title: cleanTitle,
            youtube: null,
            movie: {
                kinopoiskId: id,
                durationSec: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0,
                posterUrl: safeImageUrl(posterUrl),
                // A new broadcast must not inherit the previous one's pause (writes merge).
                pausedAtSec: null
            }
        };
    }

    /** Cover image for a channel: YouTube thumbnail or the stored movie poster. */
    function coverUrl(channel) {
        if (channel?.mode === 'youtube') return `https://i.ytimg.com/vi/${encodeURIComponent(channel.youtube.videoId)}/hqdefault.jpg`;
        if (channel?.mode === 'movie') return channel.movie.posterUrl || '';
        return '';
    }

    function formatClock(totalSec) {
        const sec = Math.max(0, Math.floor(totalSec || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    }

    class CinemaChannelService {
        constructor(firebaseManager) {
            this.firebaseManager = firebaseManager;
        }

        get ref() {
            return this.firebaseManager.db.collection(COLLECTION).doc(DOC_ID);
        }

        /** Live subscription; returns an unsubscribe function. */
        subscribe(onChannel, onError) {
            return this.ref.onSnapshot(
                snapshot => onChannel(normalizeChannel(snapshot.exists ? snapshot.data() : null)),
                error => { if (typeof onError === 'function') onError(error); }
            );
        }

        async read() {
            const snapshot = await this.ref.get();
            return normalizeChannel(snapshot.exists ? snapshot.data() : null);
        }

        /**
         * Admin timeline control for a running broadcast (movie: pause/resume/seek,
         * YouTube video: seek). Moves `startedAt` so every viewer follows.
         * @param {'pause'|'resume'|'seek'} action
         */
        async control(channel, action, { offsetSec = 0 } = {}) {
            if (!channel || channel.mode === 'off') throw new Error('Эфир не запущен');
            const position = computePosition(channel);
            const duration = channel.movie?.durationSec || 0;
            const clamp = sec => Math.max(0, duration > 0 ? Math.min(sec, duration - 5) : sec);
            const FieldValue = firebase.firestore.FieldValue;
            const user = this.firebaseManager.getCurrentUser?.();
            const data = { updatedAt: FieldValue.serverTimestamp(), updatedBy: user?.uid || '' };

            if (action === 'pause') {
                if (channel.mode !== 'movie') throw new Error('Пауза доступна только для фильма');
                data.movie = { ...channel.movie, pausedAtSec: clamp(position.offsetSec) };
            } else if (action === 'resume') {
                if (channel.mode !== 'movie') return;
                const at = Number.isFinite(channel.movie.pausedAtSec) ? channel.movie.pausedAtSec : position.offsetSec;
                data.movie = { ...channel.movie, pausedAtSec: null };
                data.startedAt = new Date(Date.now() - clamp(at) * 1000);
            } else if (action === 'seek') {
                const next = clamp(offsetSec);
                if (channel.mode === 'movie' && Number.isFinite(channel.movie.pausedAtSec)) {
                    data.movie = { ...channel.movie, pausedAtSec: next };
                } else {
                    data.startedAt = new Date(Date.now() - next * 1000);
                }
            } else {
                throw new Error('Неизвестное действие');
            }
            await this.ref.set(data, { merge: true });
        }

        /** Admin only (enforced by Firestore rules). `restart` resets the broadcast clock to now. */
        async save(input, { restart = true } = {}) {
            const payload = buildChannelPayload(input);
            const FieldValue = firebase.firestore.FieldValue;
            const user = this.firebaseManager.getCurrentUser?.();
            const data = {
                ...payload,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: user?.uid || ''
            };
            if (restart || payload.mode === 'off') data.startedAt = FieldValue.serverTimestamp();
            await this.ref.set(data, { merge: true });
            return payload;
        }
    }

    const api = { CinemaChannelService, normalizeChannel, computePosition, buildChannelPayload, formatClock, coverUrl, DOC_ID };
    if (typeof window !== 'undefined') Object.assign(window, { CinemaChannelService, CinemaChannel: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
