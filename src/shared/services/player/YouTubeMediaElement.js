/**
 * YouTubeMediaElement - a <video> stand-in for a YouTube embed.
 *
 * The shared movie player (content-scripts/player-cleaner.js) is built around an
 * HTMLVideoElement. This module returns a real, source-less <video> whose media
 * properties and methods are redirected to the YouTube IFrame API behind our
 * wrapper (public/player/embed.html): play/pause/currentTime/volume/muted/
 * playbackRate become wrapper commands, and the wrapper's telemetry comes back as
 * the usual media events (play, playing, pause, waiting, seeking, seeked,
 * timeupdate, durationchange, volumechange, ratechange, ended). YouTube's caption
 * tracks become the element's TextTracks, so the movie player's subtitle menu
 * lists them; choosing one turns that track on in YouTube, which draws it inside
 * the frame (no cues reach this page). The element itself
 * paints nothing: it sits transparent above the YouTube frame, so the movie
 * player's chrome is drawn over the picture.
 */
(function (global) {
    'use strict';

    const WRAPPER_SOURCE = 'STARTTAB_PLAYER_WRAPPER';
    // YouTube caps regular uploads at 12 hours; a longer "duration" is a stream.
    const MAX_UPLOAD_SEC = 12 * 3600;
    const TICK_MS = 250;
    const PLAY_TIMEOUT_MS = 2500;
    const BLOCKED_PAUSE_MS = 1000;

    function makeRanges(end) {
        const ranges = end > 0 ? [[0, end]] : [];
        return {
            length: ranges.length,
            start: index => { if (!ranges[index]) throw new RangeError('Index out of range'); return ranges[index][0]; },
            end: index => { if (!ranges[index]) throw new RangeError('Index out of range'); return ranges[index][1]; }
        };
    }

    /**
     * @param {object} options
     * @param {HTMLIFrameElement} options.frame  the wrapper iframe
     * @param {string} options.origin            the wrapper origin
     * @param {string} options.videoId
     * @param {number} [options.startSec]        where the wrapper cues the video
     * @param {boolean} [options.live]           a live stream: duration is Infinity
     * @param {Document} [options.document]
     * @param {(info: {duration: number, isLive: boolean}) => void} [options.onInfo]
     * @param {(info: {errorCode: number, message: string}) => void} [options.onError]
     * @returns {{ video: HTMLVideoElement, handleMessage: (event: MessageEvent) => boolean, destroy: () => void }}
     */
    function create({ frame, origin, videoId, startSec = 0, live = false, document: doc = global.document, onInfo = () => {}, onError = () => {} }) {
        const video = doc.createElement('video');
        const state = {
            ready: false,
            ytState: 'UNSTARTED',
            paused: true,
            ended: false,
            time: Math.max(0, Number(startSec) || 0),
            at: Date.now(),
            duration: live ? Infinity : NaN,
            isLive: live === true,
            loaded: 0,
            volume: 1,
            muted: false,
            rate: 1,
            seeking: false,
            playedOnce: false,
            seekTimer: null,
            playWaiters: [],
            queue: []
        };
        let ticker = null;
        let destroyed = false;

        const fire = type => video.dispatchEvent(new Event(type));

        function send(action, payload) {
            if (destroyed) return;
            // Commands sent before the player exists would be dropped by the wrapper.
            if (!state.ready && action !== 'DESTROY') {
                state.queue.push([action, payload]);
                return;
            }
            try { frame.contentWindow?.postMessage({ action, payload }, origin); } catch { /* frame navigating */ }
        }

        function estimatedTime() {
            const base = state.time;
            if (state.paused || state.seeking || state.ytState !== 'PLAYING') return base;
            const next = base + ((Date.now() - state.at) / 1000) * state.rate;
            return Number.isFinite(state.duration) ? Math.min(next, state.duration) : next;
        }

        function setTime(seconds) {
            state.time = Math.max(0, Number(seconds) || 0);
            state.at = Date.now();
        }

        // YouTube tried to start (or had time to) and stopped again: Chrome blocked
        // unmuted playback. Reject now, so the broadcast lock retries muted at once
        // instead of a timeout that a buffering report would have resolved.
        // A late confirmation of an earlier pause leaves a fresh play() alone.
        function rejectBlockedPlays() {
            const blocked = state.playWaiters.filter(waiter => waiter.started || Date.now() - waiter.at >= BLOCKED_PAUSE_MS);
            if (!blocked.length) return;
            state.playWaiters = state.playWaiters.filter(waiter => !blocked.includes(waiter));
            blocked.forEach(waiter => {
                clearTimeout(waiter.timer);
                waiter.reject(Object.assign(new Error('play() was blocked'), { name: 'NotAllowedError' }));
            });
        }

        function settlePlay(ok, error) {
            const waiters = state.playWaiters.splice(0);
            waiters.forEach(waiter => {
                clearTimeout(waiter.timer);
                if (ok) waiter.resolve(); else waiter.reject(error);
            });
        }

        function startTicker() {
            if (ticker) return;
            ticker = setInterval(() => { if (!state.paused) fire('timeupdate'); }, TICK_MS);
        }

        function stopTicker() {
            clearInterval(ticker);
            ticker = null;
        }

        function finishSeek() {
            if (!state.seeking) return;
            clearTimeout(state.seekTimer);
            state.seeking = false;
            fire('seeked');
            fire('timeupdate');
        }

        function updateDuration(value) {
            const raw = Number(value);
            if (!Number.isFinite(raw) || raw <= 0) return;
            const live = state.isLive || raw > MAX_UPLOAD_SEC;
            const next = live ? Infinity : raw;
            if (live && !state.isLive) state.isLive = true;
            if (next === state.duration) return;
            state.duration = next;
            fire('durationchange');
            onInfo({ duration: live ? 0 : raw, isLive: live });
        }

        // ---- HTMLMediaElement surface -------------------------------------------
        const define = (name, descriptor) => Object.defineProperty(video, name, { configurable: true, ...descriptor });
        define('src', { get: () => `blob:youtube/${videoId}`, set: () => {} });
        define('currentSrc', { get: () => `blob:youtube/${videoId}` });
        define('readyState', { get: () => (state.ready ? 4 : 0) });
        define('networkState', { get: () => (state.ready ? 1 : 2) });
        define('error', { get: () => null });
        define('paused', { get: () => state.paused });
        define('ended', { get: () => state.ended });
        define('seeking', { get: () => state.seeking });
        define('duration', { get: () => state.duration });
        define('buffered', { get: () => makeRanges(Number.isFinite(state.duration) ? state.duration * state.loaded : 0) });
        define('seekable', { get: () => makeRanges(Number.isFinite(state.duration) ? state.duration : 0) });
        define('videoWidth', { get: () => (state.ready ? 1280 : 0) });
        define('videoHeight', { get: () => (state.ready ? 720 : 0) });
        define('currentTime', {
            get: estimatedTime,
            set: value => {
                const seconds = Number(value);
                if (!Number.isFinite(seconds)) return;
                const target = Number.isFinite(state.duration) ? Math.min(Math.max(0, seconds), state.duration) : Math.max(0, seconds);
                setTime(target);
                state.ended = false;
                state.seeking = true;
                fire('seeking');
                send('SEEK', { seconds: target });
                // The wrapper's next report (or this timer) completes the seek.
                clearTimeout(state.seekTimer);
                state.seekTimer = setTimeout(finishSeek, 900);
            }
        });
        define('volume', {
            get: () => state.volume,
            set: value => {
                const next = Number(value);
                if (!Number.isFinite(next) || next < 0 || next > 1) throw new RangeError('The volume provided is outside the range [0, 1].');
                if (next === state.volume) return;
                state.volume = next;
                send('SET_VOLUME', { volume: Math.round(next * 100) });
                fire('volumechange');
            }
        });
        define('muted', {
            get: () => state.muted,
            set: value => {
                const next = Boolean(value);
                if (next === state.muted) return;
                state.muted = next;
                send(next ? 'MUTE' : 'UNMUTE');
                fire('volumechange');
            }
        });
        define('playbackRate', {
            get: () => state.rate,
            set: value => {
                const next = Number(value);
                if (!Number.isFinite(next) || next <= 0) return;
                setTime(estimatedTime());
                state.rate = next;
                send('SET_RATE', { rate: next });
                fire('ratechange');
            }
        });
        video.play = () => new Promise((resolve, reject) => {
            if (!state.paused && state.ytState === 'PLAYING') { resolve(); return; }
            const waiter = { resolve, reject, timer: null, at: Date.now(), started: false };
            // Chrome blocks unmuted autoplay silently: YouTube just stays put.
            waiter.timer = setTimeout(() => {
                state.playWaiters = state.playWaiters.filter(item => item !== waiter);
                if (state.ytState !== 'PLAYING' && state.ytState !== 'BUFFERING') {
                    if (!state.paused) { state.paused = true; fire('pause'); }
                    const error = new Error('play() was blocked');
                    error.name = 'NotAllowedError';
                    reject(error);
                } else {
                    resolve();
                }
            }, PLAY_TIMEOUT_MS);
            state.playWaiters.push(waiter);
            if (state.paused) {
                state.paused = false;
                state.ended = false;
                fire('play');
            }
            send('PLAY');
        });
        video.pause = () => {
            if (state.paused) return;
            setTime(estimatedTime());
            state.paused = true;
            fire('pause');
            settlePlay(false, Object.assign(new Error('The play() request was interrupted by a call to pause().'), { name: 'AbortError' }));
            send('PAUSE');
        };
        video.load = () => {};
        video.canPlayType = () => '';
        video.requestPictureInPicture = () => Promise.reject(Object.assign(new Error('Picture-in-picture is not available for YouTube'), { name: 'NotSupportedError' }));

        // ---- Captions ----------------------------------------------------------------
        const captionTracks = new Map();
        let applyingCaptions = false;

        function activeCaption() {
            for (const [languageCode, track] of captionTracks) {
                if (track.mode === 'showing') return languageCode;
            }
            return null;
        }

        function syncCaptions(list, active) {
            if (typeof video.addTextTrack !== 'function' || !Array.isArray(list)) return;
            applyingCaptions = true;
            list.forEach(item => {
                const code = String(item?.languageCode || '');
                if (!code || captionTracks.has(code)) return;
                const label = String(item.displayName || code);
                const track = video.addTextTrack('subtitles', label, code);
                track.mode = 'disabled';
                captionTracks.set(code, track);
            });
            captionTracks.forEach((track, code) => { track.mode = code === active ? 'showing' : 'disabled'; });
            applyingCaptions = false;
            video.dispatchEvent(new Event('extension-player-tracks-ready'));
            // The movie player may have restored a saved choice meanwhile.
            send('SET_CAPTIONS', { languageCode: activeCaption() });
        }

        video.textTracks?.addEventListener?.('change', () => {
            if (applyingCaptions || !captionTracks.size) return;
            send('SET_CAPTIONS', { languageCode: activeCaption() });
        });

        // ---- Wrapper telemetry ----------------------------------------------------
        function onState(next, payload) {
            const previous = state.ytState;
            state.ytState = next;
            if (next === 'PLAYING') {
                state.playedOnce = true;
                state.ended = false;
                finishSeek();
                if (state.paused) { state.paused = false; fire('play'); }
                if (previous !== 'PLAYING') fire('playing');
                settlePlay(true);
                startTicker();
            } else if (next === 'PAUSED') {
                stopTicker();
                finishSeek();
                rejectBlockedPlays();
                if (!state.paused) { state.paused = true; fire('pause'); }
                if (previous === 'BUFFERING') fire('canplay');
            } else if (next === 'BUFFERING') {
                state.playWaiters.forEach(waiter => { waiter.started = true; });
                // Like a <video>, only a playing element waits for data.
                if (!state.paused) fire('waiting');
            } else if (next === 'ENDED') {
                stopTicker();
                if (Number.isFinite(state.duration)) setTime(state.duration);
                const wasPaused = state.paused;
                state.paused = true;
                state.ended = true;
                fire('timeupdate');
                if (!wasPaused) fire('pause');
                fire('ended');
            } else if (next === 'CUED') {
                stopTicker();
                finishSeek();
            }
            if (payload && Number.isFinite(Number(payload.currentTime)) && next !== 'ENDED') fire('timeupdate');
        }

        function handleMessage(event) {
            if (destroyed || event.origin !== origin || event.source !== frame.contentWindow) return false;
            const data = event.data;
            if (!data || data.source !== WRAPPER_SOURCE) return false;
            const payload = data.payload || {};
            if (payload.isLive === true) state.isLive = true;
            if (Number.isFinite(Number(payload.loaded))) state.loaded = Math.max(0, Math.min(1, Number(payload.loaded)));
            // A cued video reports 0 before it has played, not the cue point.
            const reportedState = payload.state || state.ytState;
            const trustTime = !['UNSTARTED', 'CUED'].includes(reportedState) || state.playedOnce;
            if (trustTime && payload.currentTime !== undefined && payload.currentTime !== null && Number.isFinite(Number(payload.currentTime))) {
                setTime(Number(payload.currentTime));
            }
            updateDuration(payload.duration);
            if (state.isLive && state.duration !== Infinity) {
                state.duration = Infinity;
                fire('durationchange');
                onInfo({ duration: 0, isLive: true });
            }

            if (data.event === 'READY') {
                state.ready = true;
                state.ytState = 'CUED';
                // Apply what the player set before the frame was ready, then the rest.
                send('SET_VOLUME', { volume: Math.round(state.volume * 100) });
                send(state.muted ? 'MUTE' : 'UNMUTE');
                if (state.rate !== 1) send('SET_RATE', { rate: state.rate });
                const queued = state.queue.splice(0).filter(([action]) => !['SET_VOLUME', 'MUTE', 'UNMUTE', 'SET_RATE'].includes(action));
                queued.forEach(([action, payload]) => send(action, payload));
                ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough'].forEach(fire);
                return true;
            }
            if (data.event === 'CAPTIONS') {
                syncCaptions(payload.tracks, payload.active || null);
                return true;
            }
            if (data.event === 'ERROR') {
                settlePlay(false, Object.assign(new Error(payload.message || 'YouTube error'), { name: 'NotSupportedError' }));
                onError({ errorCode: Number(payload.errorCode) || 0, message: payload.message || '' });
                return true;
            }
            if (data.event === 'STATE_CHANGE' && payload.state) {
                onState(payload.state, payload);
            } else if (data.event === 'TIME_UPDATE') {
                if (payload.state === 'PLAYING' && state.ytState !== 'PLAYING') onState('PLAYING', payload);
                else if (state.seeking) finishSeek();
                else fire('timeupdate');
                if (Number.isFinite(state.duration) && Number.isFinite(Number(payload.duration))) fire('progress');
            }
            return true;
        }

        function destroy() {
            if (destroyed) return;
            stopTicker();
            clearTimeout(state.seekTimer);
            send('DESTROY');
            destroyed = true;
        }

        video.dataset.playerProvider = 'youtube';
        return { video, handleMessage, destroy, state };
    }

    const api = { create, MAX_UPLOAD_SEC };
    global.YouTubeMediaElement = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
