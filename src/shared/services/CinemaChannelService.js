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
 *
 * Scheduled documents additionally store a fixed `endsAt`; their `startedAt`
 * remains the grid start while optional `playbackStartedAt` carries seeks/resumes.
 * Occupancy changes commit with `settings/cinemaScheduleState.revision`.
 */
(function () {
    const COLLECTION = 'settings';
    const SCHEDULE_COLLECTION = 'cinemaSchedule';
    const DOC_ID = 'cinemaChannel';
    const SCHEDULE_STATE_ID = 'cinemaScheduleState';
    const SCHEDULE_LIMIT = 500;
    const SCHEDULE_FALLBACK_SEC = 4 * 3600;
    const MODES = ['off', 'youtube', 'movie'];
    const MAX_TITLE = 120;

    function readPause(value) {
        const sec = Number(value);
        return value !== null && value !== undefined && Number.isFinite(sec) && sec >= 0 ? sec : null;
    }

    // ---- Shared clock ---------------------------------------------------------
    // Viewers' computer clocks can be minutes apart; positions are computed against
    // Google's server time (HTTP Date of a tiny request) so everyone sees one moment.
    let clockOffsetMs = 0;
    let clockPromise = null;

    function now() {
        return Date.now() + clockOffsetMs;
    }

    async function sampleServerClock(url) {
        const sentAt = Date.now();
        const response = await fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'omit' });
        const receivedAt = Date.now();
        const serverMs = Date.parse(response.headers.get('date') || '');
        if (!Number.isFinite(serverMs)) throw new Error('NO_DATE_HEADER');
        const rtt = receivedAt - sentAt;
        // The Date header has 1s resolution: aim at the middle of that second.
        return { offset: serverMs + 500 - (sentAt + rtt / 2), rtt };
    }

    function syncClock() {
        if (clockPromise) return clockPromise;
        clockPromise = (async () => {
            const samples = [];
            for (let i = 0; i < 3; i += 1) {
                try { samples.push(await sampleServerClock('https://firestore.googleapis.com/')); } catch { /* offline */ }
            }
            if (!samples.length) return clockOffsetMs;
            samples.sort((a, b) => a.rtt - b.rtt);
            const best = samples[0].offset;
            // Ignore sub-second noise; only correct clocks that are really off.
            clockOffsetMs = Math.abs(best) > 1000 ? Math.round(best) : 0;
            return clockOffsetMs;
        })();
        return clockPromise;
    }

    /** Converts a server-time instant to this computer's clock (for players that use Date.now()). */
    function toLocalMs(serverMs) {
        return serverMs - clockOffsetMs;
    }

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

    function readDuration(value) {
        const sec = Number(value);
        return Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0;
    }

    /**
     * Normalizes a raw document into a safe channel object (or an «off» channel).
     * `meta.docPath` says where the item lives: the manual channel or a schedule entry.
     */
    function normalizeChannel(raw, meta = {}) {
        const docPath = meta.docPath || `${COLLECTION}/${DOC_ID}`;
        const startedAtMs = toMillis(raw?.startedAt);
        const endsAtMs = toMillis(raw?.endsAt);
        const scheduled = meta.scheduled === true;
        const base = {
            id: meta.id || DOC_ID, docPath, scheduled,
            endsAtMs: scheduled ? endsAtMs : NaN,
            playbackStartedAtMs: scheduled ? toMillis(raw?.playbackStartedAt) : NaN,
            explicitEnd: scheduled && Number.isFinite(endsAtMs) && endsAtMs > startedAtMs,
            updatedAtMs: toMillis(raw?.updatedAt),
            // Keep nanoseconds for optimistic edits made within the same millisecond.
            updatedAtVersion: timestampVersion(raw?.updatedAt)
        };
        // «Off» keeps its timestamp: stopping is itself an event on the timeline.
        const off = { ...base, mode: 'off', title: '', youtube: null, movie: null, startedAtMs: raw?.mode === 'off' ? toMillis(raw.startedAt) : NaN };
        if (!raw || typeof raw !== 'object' || !MODES.includes(raw.mode)) return off;
        const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE) : '';

        if (raw.mode === 'youtube') {
            const videoId = String(raw.youtube?.videoId || '');
            if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return off;
            const live = raw.youtube?.live === true;
            return {
                ...base,
                mode: 'youtube',
                title,
                youtube: { videoId, live, durationSec: readDuration(raw.youtube?.durationSec), pausedAtSec: live ? null : readPause(raw.youtube?.pausedAtSec) },
                movie: null,
                startedAtMs
            };
        }
        if (raw.mode === 'movie') {
            const kinopoiskId = Number(raw.movie?.kinopoiskId);
            if (!Number.isSafeInteger(kinopoiskId) || kinopoiskId <= 0) return off;
            const durationSec = Number(raw.movie?.durationSec);
            return {
                ...base,
                mode: 'movie',
                title,
                youtube: null,
                movie: {
                    kinopoiskId,
                    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec) : 0,
                    posterUrl: safeImageUrl(raw.movie?.posterUrl),
                    pausedAtSec: readPause(raw.movie?.pausedAtSec)
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
    function computePosition(channel, nowMs = now()) {
        if (!channel || channel.mode === 'off') return { state: 'off', offsetSec: 0 };
        const media = channel[channel.mode];
        if (channel.scheduled && channel.explicitEnd) {
            if (nowMs < channel.startedAtMs) return { state: 'upcoming', offsetSec: Math.ceil((channel.startedAtMs - nowMs) / 1000) };
            if (nowMs >= channel.endsAtMs) return { state: 'ended', offsetSec: media?.durationSec || 0 };
        }
        const anchorMs = channel.scheduled && Number.isFinite(channel.playbackStartedAtMs)
            ? channel.playbackStartedAtMs : channel.startedAtMs;
        // A live YouTube stream is always «now»: there is nothing to seek to.
        if (channel.mode === 'youtube' && channel.youtube?.live) {
            // A scheduled stream still has a start (and an optional end) on the timeline.
            if (Number.isFinite(channel.startedAtMs) && nowMs < channel.startedAtMs) {
                return { state: 'upcoming', offsetSec: Math.ceil((channel.startedAtMs - nowMs) / 1000) };
            }
            const runFor = media?.durationSec || 0;
            if (runFor > 0 && Number.isFinite(channel.startedAtMs) && nowMs - channel.startedAtMs >= runFor * 1000) {
                return { state: 'ended', offsetSec: 0 };
            }
            return { state: 'live', offsetSec: 0 };
        }
        if (Number.isFinite(media?.pausedAtSec)) {
            return { state: 'paused', offsetSec: Math.floor(media.pausedAtSec) };
        }
        if (!Number.isFinite(anchorMs)) return { state: 'live', offsetSec: 0 };

        const elapsed = Math.floor((nowMs - anchorMs) / 1000);
        if (elapsed < 0) return { state: 'upcoming', offsetSec: -elapsed };
        const duration = media?.durationSec || 0;
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
            const ytMinutes = Number(String(durationMin || '').replace(',', '.'));
            if (ytMinutes * 60 > 2147483647) throw cinemaError('bounds', 'Укажите допустимую длительность видео');
            return {
                mode: 'youtube',
                title: cleanTitle,
                youtube: {
                    videoId: info.id,
                    live: youtubeLive === true,
                    durationSec: Number.isFinite(ytMinutes) && ytMinutes > 0 ? Math.round(ytMinutes * 60) : 0,
                    pausedAtSec: null
                },
                movie: null
            };
        }

        const id = Number(String(kinopoiskId || '').trim());
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Укажите Kinopoisk ID фильма');
        const minutes = Number(String(durationMin || '').replace(',', '.'));
        if (minutes * 60 > 2147483647) throw cinemaError('bounds', 'Укажите допустимую длительность фильма');
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

    function timestampVersion(value) {
        if (value && typeof value.seconds === 'number') return `${value.seconds}:${value.nanoseconds || 0}`;
        const ms = toMillis(value);
        return Number.isFinite(ms) ? String(ms) : '';
    }

    /** Fixed slot bounds. Legacy lengths are display/overlap estimates, not new playback limits. */
    function getScheduleBounds(item) {
        const startMs = item?.startedAtMs;
        const explicitEnd = item?.scheduled === true && item.explicitEnd === true
            && Number.isFinite(item.endsAtMs) && item.endsAtMs > startMs;
        const duration = item?.[item?.mode]?.durationSec || (item?.scheduled ? SCHEDULE_FALLBACK_SEC : 0);
        return { startMs, endMs: explicitEnd ? item.endsAtMs : (duration ? startMs + duration * 1000 : Infinity), explicitEnd };
    }

    function nextScheduled(items = [], nowMs = now()) {
        return items.filter(item => item && item.mode !== 'off' && Number.isFinite(item.startedAtMs) && item.startedAtMs > nowMs)
            .sort((a, b) => a.startedAtMs - b.startedAtMs || String(a.id).localeCompare(String(b.id)))[0] || null;
    }

    function cinemaError(code, message) {
        return Object.assign(new Error(message), { code: `cinema/${code}` });
    }

    function validateBounds(startDate, endDate) {
        const startMs = startDate instanceof Date ? startDate.getTime() : NaN;
        const endMs = endDate instanceof Date ? endDate.getTime() : NaN;
        if (!Number.isFinite(startMs)) throw cinemaError('bounds', 'Укажите дату и время начала');
        if (!Number.isFinite(endMs) || endMs <= startMs) throw cinemaError('bounds', 'Время окончания должно быть позже начала');
        return { startMs, endMs };
    }

    function sameMedia(a, b) {
        return a.mode === b.mode && (a.mode === 'movie'
            ? a.movie?.kinopoiskId === b.movie?.kinopoiskId : a.youtube?.videoId === b.youtube?.videoId && a.youtube?.live === b.youtube?.live);
    }

    function checkOverlap(candidate, items, excludeId) {
        const { startMs, endMs } = getScheduleBounds(candidate);
        if (items.some(item => {
            if (item.id === excludeId || item.mode === 'off') return false;
            const other = getScheduleBounds(item);
            return startMs < other.endMs && endMs > other.startMs;
        })) throw cinemaError('overlap', 'Это время пересекается с другим показом. Выберите свободный промежуток.');
    }

    /**
     * Picks what the live page shows from the manual channel plus the schedule.
     * The most recently started item wins (a later start supersedes earlier ones,
     * a manual «stop» is an item too). With nothing on air, the next upcoming
     * scheduled item is returned so viewers see its countdown.
     */
    function resolveChannel(manual, scheduleItems = [], nowMs = now()) {
        const items = [manual, ...scheduleItems].filter(item => item && Number.isFinite(item.startedAtMs));
        const started = items.filter(item => item.startedAtMs <= nowMs).sort((a, b) => b.startedAtMs - a.startedAtMs);
        const latest = started[0];
        if (latest && latest.mode !== 'off') {
            // Media may finish before the allotted slot. Keep its reservation until
            // the fixed end; the live page shows standby instead of advancing early.
            if (latest.scheduled && latest.explicitEnd && nowMs < latest.endsAtMs) return latest;
            const position = computePosition(latest, nowMs);
            const media = latest[latest.mode];
            const capped = latest.scheduled && !media?.durationSec && !Number.isFinite(media?.pausedAtSec)
                && nowMs - latest.startedAtMs > SCHEDULE_FALLBACK_SEC * 1000;
            if (position.state !== 'ended' && !capped) return latest;
        }
        const upcoming = nextScheduled(scheduleItems, nowMs);
        if (upcoming) return upcoming;
        if (latest && latest.mode !== 'off') return latest; // shows «Показ завершился»
        return normalizeChannel(null);
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

        get scheduleRef() {
            return this.firebaseManager.db.collection(SCHEDULE_COLLECTION);
        }

        get scheduleStateRef() {
            return this.firebaseManager.db.collection(COLLECTION).doc(SCHEDULE_STATE_ID);
        }

        writeStamp() {
            return { updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: this.firebaseManager.getCurrentUser?.()?.uid || '' };
        }

        normalizeSchedule(snapshot) {
            return normalizeChannel(snapshot.data(), { id: snapshot.id, docPath: `${SCHEDULE_COLLECTION}/${snapshot.id}`, scheduled: true });
        }

        /**
         * Every occupancy writer reads and advances the same revision. The bounded
         * server query is deliberately outside the transaction read set (web SDK
         * transactions read document references only). A changed guard retries the
         * whole callback, including this fresh query, before either write commits.
         */
        async mutateSchedule(ref, prepare, { scan = true } = {}) {
            return this.firebaseManager.db.runTransaction(async transaction => {
                const state = await transaction.get(this.scheduleStateRef);
                const revision = state.exists ? state.data().revision : 0;
                if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
                    throw cinemaError('state', 'Не удалось проверить версию расписания. Обновите страницу.');
                }
                let items = [];
                if (scan) {
                    const snapshot = await this.scheduleRef.limit(SCHEDULE_LIMIT + 1).get({ source: 'server' });
                    if (snapshot.docs.length > SCHEDULE_LIMIT) throw cinemaError('limit', 'В расписании больше 500 показов. Удалите старые записи перед изменением.');
                    items = snapshot.docs.map(doc => this.normalizeSchedule(doc));
                }
                const snapshot = await transaction.get(ref);
                const mutation = prepare(snapshot, items);
                if (!mutation) return false;
                if (mutation.type === 'delete') transaction.delete(ref);
                else if (mutation.type === 'create') transaction.set(ref, mutation.data);
                else transaction.update(ref, mutation.data);
                transaction.set(this.scheduleStateRef, { revision: revision + 1, ...this.writeStamp() });
                return mutation.result;
            });
        }

        refFor(channel) {
            const path = channel?.docPath || `${COLLECTION}/${DOC_ID}`;
            const [collection, id] = path.split('/');
            return this.firebaseManager.db.collection(collection).doc(id);
        }

        /** Everyone: the planned shows, as normalized channels. */
        subscribeSchedule(onItems, onError) {
            return this.scheduleRef.onSnapshot(
                snapshot => onItems(snapshot.docs
                    .map(doc => normalizeChannel(doc.data(), { id: doc.id, docPath: `${SCHEDULE_COLLECTION}/${doc.id}`, scheduled: true }))
                    .filter(item => item.mode !== 'off')
                    .sort((a, b) => a.startedAtMs - b.startedAtMs)),
                error => { if (typeof onError === 'function') onError(error); }
            );
        }

        /** Admin only: plans a show for `startDate` (a Date in the admin's local time). */
        async schedule(input, startDate, endDate) {
            const payload = buildChannelPayload(input);
            if (payload.mode === 'off') throw new Error('Выберите, что показывать');
            const startMs = startDate instanceof Date ? startDate.getTime() : NaN;
            if (!Number.isFinite(startMs)) throw new Error('Укажите дату и время начала');
            if (startMs < now() - 60_000) throw new Error('Это время уже прошло');
            const end = endDate === undefined ? new Date(startMs + (payload[payload.mode].durationSec || SCHEDULE_FALLBACK_SEC) * 1000) : endDate;
            const { endMs } = validateBounds(startDate, end);
            const ref = this.scheduleRef.doc();
            return this.mutateSchedule(ref, (snapshot, items) => {
                if (snapshot.exists) throw cinemaError('stale', 'Этот показ уже изменён. Обновите расписание.');
                if (items.length >= SCHEDULE_LIMIT) throw cinemaError('limit', 'В расписании уже 500 показов. Удалите старые записи перед добавлением.');
                const data = { ...payload, startedAt: new Date(startMs), endsAt: new Date(endMs), ...this.writeStamp() };
                const result = normalizeChannel(data, { id: ref.id, docPath: `${SCHEDULE_COLLECTION}/${ref.id}`, scheduled: true });
                checkOverlap(result, items);
                return { type: 'create', data, result };
            });
        }

        async updateSchedule(item, startDate, endDate) {
            const { startMs, endMs } = validateBounds(startDate, endDate);
            if (!item?.scheduled || !/^[A-Za-z0-9_-]{1,64}$/.test(String(item.id || ''))) throw cinemaError('stale', 'Показ больше не найден. Обновите расписание.');
            const ref = this.scheduleRef.doc(item.id);
            return this.mutateSchedule(ref, (snapshot, items) => {
                const current = snapshot.exists ? this.normalizeSchedule(snapshot) : null;
                const sameEnd = current && (current.endsAtMs === item.endsAtMs || (!Number.isFinite(current.endsAtMs) && !Number.isFinite(item.endsAtMs)));
                if (!current || !sameEnd || current.startedAtMs !== item.startedAtMs || !sameMedia(current, item)
                    || current.updatedAtVersion !== item.updatedAtVersion) {
                    throw cinemaError('stale', 'Показ уже изменён в другом окне. Обновите расписание и повторите.');
                }
                const data = { startedAt: new Date(startMs), endsAt: new Date(endMs), ...this.writeStamp() };
                const delta = startMs - current.startedAtMs;
                if (delta !== 0) data.playbackStartedAt = new Date((Number.isFinite(current.playbackStartedAtMs) ? current.playbackStartedAtMs : current.startedAtMs) + delta);
                const result = normalizeChannel({ ...snapshot.data(), ...data }, { id: item.id, docPath: `cinemaSchedule/${item.id}`, scheduled: true });
                checkOverlap(result, items, item.id);
                return { type: 'update', data, result };
            });
        }

        async unschedule(itemId) {
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(itemId || ''))) return;
            return this.mutateSchedule(this.scheduleRef.doc(itemId), snapshot => snapshot.exists
                ? { type: 'delete', result: true } : null, { scan: false });
        }

        /** Admin housekeeping: drops shows that finished more than a day ago. */
        async sweepFinished(items, nowMs = now()) {
            const stale = items.filter(item => {
                if (item.explicitEnd) return nowMs - item.endsAtMs > 24 * 3600 * 1000;
                const position = computePosition(item, nowMs);
                const ageMs = nowMs - item.startedAtMs;
                return Number.isFinite(item.startedAtMs) && ageMs > 24 * 3600 * 1000
                    && (position.state === 'ended' || ageMs > (SCHEDULE_FALLBACK_SEC * 1000 + 24 * 3600 * 1000));
            });
            // All deletions advance the same guard; serial housekeeping avoids
            // exhausting transaction retries by contending with itself.
            let removed = 0;
            for (const item of stale) {
                if (await this.unschedule(item.id).catch(() => false)) removed += 1;
            }
            return removed;
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
         * Admin timeline control for a running broadcast (movie and non-live YouTube
         * video: pause/resume/seek). Scheduled slots keep their boundaries; only
         * their `playbackStartedAt` clock moves. Manual broadcasts use `startedAt`.
         * @param {'pause'|'resume'|'seek'} action
         */
        async control(channel, action, { offsetSec = null } = {}) {
            if (!channel || channel.mode === 'off') throw new Error('Эфир не запущен');
            if (channel.mode === 'youtube' && channel.youtube.live) throw new Error('Прямую трансляцию нельзя перематывать');
            const patchFor = current => {
                const key = current.mode;
                const media = current[key];
                const position = computePosition(current);
                const duration = media?.durationSec || 0;
                const clamp = sec => Math.max(0, duration > 0 ? Math.min(sec, Math.max(0, duration - 5)) : sec);
                const data = this.writeStamp();
                const setPause = value => {
                    if (current.scheduled) data[`${key}.pausedAtSec`] = value;
                    else data[key] = { ...media, pausedAtSec: value };
                };
                const anchorKey = current.scheduled ? 'playbackStartedAt' : 'startedAt';
                const hasAt = Number.isFinite(offsetSec);
                if (action === 'pause') {
                    setPause(clamp(hasAt ? offsetSec : position.offsetSec));
                } else if (action === 'resume') {
                    const at = hasAt ? offsetSec : (Number.isFinite(media.pausedAtSec) ? media.pausedAtSec : position.offsetSec);
                    setPause(null);
                    data[anchorKey] = new Date(now() - clamp(at) * 1000);
                } else if (action === 'seek') {
                    const next = clamp(hasAt ? offsetSec : 0);
                    if (Number.isFinite(media.pausedAtSec)) setPause(next);
                    else {
                        setPause(null);
                        data[anchorKey] = new Date(now() - next * 1000);
                    }
                } else {
                    throw new Error('Неизвестное действие');
                }
                return data;
            };
            const ref = this.refFor(channel);
            if (channel.scheduled) {
                await this.firebaseManager.db.runTransaction(async transaction => {
                    const snapshot = await transaction.get(ref);
                    const current = snapshot.exists ? this.normalizeSchedule(snapshot) : null;
                    if (!current || !sameMedia(current, channel) || current.startedAtMs !== channel.startedAtMs) throw cinemaError('stale', 'Показ уже изменён. Обновите расписание.');
                    transaction.update(ref, patchFor(current));
                });
                return;
            }
            await ref.set(patchFor(channel), { merge: true });
        }

        /**
         * Admin only: stores the real length of a YouTube video that was published
         * without one, so the broadcast ends by itself like a movie does.
         */
        async setYoutubeDuration(channel, durationSec) {
            const sec = readDuration(durationSec);
            if (channel?.mode !== 'youtube' || channel.youtube.live || channel.youtube.durationSec || !sec) return false;
            if (channel.scheduled) {
                // A legacy inferred end changes with duration, so it participates in
                // occupancy serialization. Explicit slots keep their fixed boundary.
                if (!channel.explicitEnd) {
                    return this.mutateSchedule(this.refFor(channel), (snapshot, items) => {
                        const current = snapshot.exists ? this.normalizeSchedule(snapshot) : null;
                        if (!current || !sameMedia(current, channel) || current.youtube.durationSec) return null;
                        const candidate = { ...current, youtube: { ...current.youtube, durationSec: sec } };
                        checkOverlap(candidate, items, current.id);
                        return { type: 'update', data: { 'youtube.durationSec': sec, ...this.writeStamp() }, result: true };
                    });
                }
                return this.firebaseManager.db.runTransaction(async transaction => {
                    const ref = this.refFor(channel);
                    const snapshot = await transaction.get(ref);
                    const current = snapshot.exists ? this.normalizeSchedule(snapshot) : null;
                    if (!current || !sameMedia(current, channel) || current.youtube.durationSec) return false;
                    // If another admin removed the explicit end, a fresh guarded
                    // duration mutation is needed instead of bypassing its revision.
                    if (!current.explicitEnd) throw cinemaError('stale', 'Показ уже изменён. Обновите расписание.');
                    transaction.update(ref, { 'youtube.durationSec': sec, ...this.writeStamp() });
                    return true;
                });
            }
            const FieldValue = firebase.firestore.FieldValue;
            const user = this.firebaseManager.getCurrentUser?.();
            await this.refFor(channel).set({
                // Merge only the learned field; an older probe must not restore an
                // old pause or media identity over a newer manual timeline.
                youtube: { durationSec: sec },
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: user?.uid || ''
            }, { merge: true });
            return true;
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

    const api = { CinemaChannelService, normalizeChannel, computePosition, resolveChannel, getScheduleBounds, nextScheduled, buildChannelPayload, formatClock, coverUrl, now, syncClock, toLocalMs, DOC_ID };
    if (typeof window !== 'undefined') Object.assign(window, { CinemaChannelService, CinemaChannel: api });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
