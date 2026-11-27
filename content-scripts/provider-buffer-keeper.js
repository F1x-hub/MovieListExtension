// Runs in MAIN before a provider's player starts, in frames this extension embeds.
// A provider's player owns its buffer and can throw loaded data away on every jump: Venom
// plays through dash.js 3, which on a seek removes all but the fragment being played, so
// ±10 s inside the loaded part loaded again. This keeps that data in the browser: five
// minutes behind, and everything ahead after a seek. The player still believes the data
// gone and downloads it again over what is there; playback does not wait for that.
(() => {
    'use strict';

    const KEEP_BEHIND_S = 300;
    // A removal ahead this soon after a seek is the player trimming, not a quality change.
    const SEEK_WINDOW_MS = 2500;
    // After the browser refuses an append for lack of room, the player cleans up as it wants.
    const QUOTA_PAUSE_MS = 30000;
    const SPARE_RANGE_S = 0.001;

    let embedded = true;
    try {
        embedded = self !== top;
    } catch {
        // A cross-origin top window is still an embedded provider frame.
    }
    if (!embedded) return;

    // Only frames this extension opened: the same boundary as provider-ad-guard.js. An
    // ordinary website's embed of the same player is left as its site made it.
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
    let flagged = false;
    try {
        const params = new URL(window.location.href).searchParams;
        flagged = params.get('santabarbaranoads') === '1' || params.has('movieExtensionSite');
    } catch {
        // An address that cannot be read carries no flag.
    }
    if (!flagged && !origins.some(origin => extensionOrigin.test(origin))) return;

    const proto = window.SourceBuffer?.prototype;
    if (!proto || typeof proto.remove !== 'function' || proto.remove.movieExtensionBufferKeeper) return;

    const nativeRemove = proto.remove;
    const nativeAppend = proto.appendBuffer;
    let lastSeekAt = -Infinity;
    let yieldUntil = 0;

    // Media events do not bubble, but the capture phase passes through the document.
    document.addEventListener('seeking', event => {
        if (event.target instanceof HTMLMediaElement) lastSeekAt = performance.now();
    }, true);

    /** The film's element: the longest one fed through Media Source Extensions. */
    function playingMedia() {
        let found = null;
        for (const media of document.querySelectorAll('video, audio')) {
            const address = media.currentSrc || media.src || '';
            if (!address.startsWith('blob:') && !media.srcObject) continue;
            if (!found || (Number(media.duration) || 0) > (Number(found.duration) || 0)) found = media;
        }
        return found;
    }

    /**
     * A moment where the buffer holds nothing. Removing it changes no data and lets the
     * browser run the removal itself: the `updating` flag and the update events a player
     * waits for stay real. Null when the buffer has no free moment.
     */
    function spareMoment(buffer, media) {
        const ranges = buffer.buffered;
        if (!ranges.length) return 0;
        if (ranges.start(0) > 1) return 0;
        for (let index = 0; index < ranges.length - 1; index++) {
            if (ranges.start(index + 1) - ranges.end(index) > 2) return ranges.end(index) + 1;
        }
        const end = ranges.end(ranges.length - 1);
        const duration = Number(media.duration);
        // Past the last frame of an endless or longer stream nothing is buffered.
        if (!Number.isFinite(duration) || duration - end > 2) return end + 1;
        return null;
    }

    function keep(buffer, media, start, end) {
        const moment = spareMoment(buffer, media);
        if (moment === null) return nativeRemove.call(buffer, start, end);
        return nativeRemove.call(buffer, moment, moment + SPARE_RANGE_S);
    }

    function remove(start, end) {
        const media = playingMedia();
        const now = performance.now();
        if (!media || now < yieldUntil || this.updating || !(end > start)) return nativeRemove.call(this, start, end);
        const time = media.currentTime;
        if (!Number.isFinite(time)) return nativeRemove.call(this, start, end);
        // dash.js prunes within a millisecond of the time being set, before `seeking` is
        // dispatched; the element's own flag is already set by then.
        if (media.seeking) lastSeekAt = now;
        const afterSeek = now - lastSeekAt <= SEEK_WINDOW_MS;
        // A flush across the playing moment replaces what plays: a quality or track change,
        // or dash.js starting over after a jump to a moment it has no fragment for. Holding
        // that data back made Venom's frame start over (seen live twice in three runs on
        // 2026-11-27), so it always passes.
        if (start <= time && end >= time) return nativeRemove.call(this, start, end);
        if (end < time) {
            const keepFrom = time - KEEP_BEHIND_S;
            if (keepFrom - start > SPARE_RANGE_S) return nativeRemove.call(this, start, Math.min(end, keepFrom));
            return keep(this, media, start, end);
        }
        if (afterSeek) return keep(this, media, start, end);
        return nativeRemove.call(this, start, end);
    }
    remove.movieExtensionBufferKeeper = true;
    proto.remove = remove;

    proto.appendBuffer = function appendBuffer(...args) {
        try {
            return nativeAppend.apply(this, args);
        } catch (error) {
            if (error?.name === 'QuotaExceededError') yieldUntil = performance.now() + QUOTA_PAUSE_MS;
            throw error;
        }
    };
})();
