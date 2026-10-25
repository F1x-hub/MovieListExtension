/**
 * «Эфир» YouTube player page, embedded by the live page like the movie page is.
 *
 * The YouTube video plays in our wrapper with YouTube's own chrome off; a
 * YouTubeMediaElement stands in for the <video> so the shared movie player
 * (player-cleaner.js) mounts its usual controls over it. The broadcast lock is
 * the movie one: the live page sends BROADCAST_STATE straight to the player, and
 * the player's reports (admin actions, «playing», «muted») are relayed back up.
 * This page also reports what only YouTube knows: the video length (so a show
 * published without one still ends), live streams, the end and load errors.
 *
 * URL: youtube-player.html?v=<id>&start=<sec>&live=0|1
 */
(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const videoId = params.get('v') || '';
    const startSec = Math.max(0, Math.floor(Number(params.get('start')) || 0));
    const liveStream = params.get('live') === '1';

    function toParent(message) {
        if (window.parent === window) return;
        try { window.parent.postMessage(message, window.location.origin); } catch { /* not embedded */ }
    }

    function start() {
        const config = window.PlayerConfig;
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !config?.YOUTUBE_WRAPPER_URL || !window.YouTubeMediaElement) {
            toParent({ type: 'BROADCAST_SOURCE_ERROR', errorCode: 2 });
            return;
        }
        const origin = new URL(config.YOUTUBE_WRAPPER_URL).origin;
        const frame = document.createElement('iframe');
        frame.title = 'YouTube';
        frame.allow = 'autoplay; encrypted-media';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        // The broadcast lock starts playback; the wrapper only loads the video.
        frame.src = `${config.buildYouTubeEmbedUrl(videoId, { autoplay: false, start: startSec })}&controls=0`;
        document.getElementById('ytLayer').append(frame);

        let reportedLength = 0;
        const media = window.YouTubeMediaElement.create({
            frame,
            origin,
            videoId,
            startSec,
            live: liveStream,
            onInfo: ({ duration, isLive }) => {
                if (isLive || liveStream) {
                    toParent({ type: 'BROADCAST_MEDIA_INFO', isLive: true, durationSec: 0 });
                    return;
                }
                if (duration > 0 && Math.abs(duration - reportedLength) >= 1) {
                    reportedLength = duration;
                    toParent({ type: 'BROADCAST_MEDIA_INFO', isLive: false, durationSec: duration });
                }
            },
            onError: ({ errorCode }) => {
                document.body.classList.add('has-source-error');
                toParent({ type: 'BROADCAST_SOURCE_ERROR', errorCode });
            }
        });
        const { video } = media;
        video.id = 'nativeVideoPlayer';
        video.className = 'player-surface__media';
        video.playsInline = true;
        // The broadcast lock only moves media with a known length; a stream is
        // always «now», so it simply plays (muted if the browser insists).
        if (liveStream) {
            video.addEventListener('canplay', () => {
                if (!video.paused) return;
                video.play().catch(() => {
                    video.muted = true;
                    video.play().catch(() => {});
                    toParent({ type: 'BROADCAST_MUTED' });
                });
            }, { once: true });
        }
        video.addEventListener('ended', () => {
            if (!liveStream) toParent({ type: 'BROADCAST_ENDED', atSec: Number(video.currentTime) || 0 });
        });

        window.addEventListener('message', event => {
            if (media.handleMessage(event)) return;
            const type = event.data?.type;
            // On an extension page the player's host is this page itself: hand it
            // the live page's clock as its own message.
            if (type === 'BROADCAST_STATE' && window.parent !== window && event.source === window.parent
                && event.origin === window.location.origin) {
                window.postMessage({
                    type,
                    startMs: Number(event.data.startMs),
                    pausedAtSec: event.data.pausedAtSec ?? null,
                    admin: event.data.admin === true
                }, window.location.origin);
                return;
            }
            // The player reports to this page (its host); pass them to the live page.
            if (event.source === window && event.origin === window.location.origin
                && ['BROADCAST_MUTED', 'BROADCAST_PLAYING', 'BROADCAST_ADMIN_ACTION'].includes(type)) {
                toParent(type === 'BROADCAST_ADMIN_ACTION'
                    ? { type, action: event.data.action, atSec: Number(event.data.atSec) || 0 }
                    : { type });
            }
        });
        window.addEventListener('pagehide', () => media.destroy(), { once: true });
        // Esc must not close the only thing on screen.
        window.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopImmediatePropagation(); event.preventDefault(); }
        }, true);

        // The movie player puts its own wrapper in fullscreen, but the picture is
        // the YouTube layer beside it: take the whole page instead.
        const host = document.getElementById('playerHost');
        const requestFullscreen = Element.prototype.requestFullscreen;
        Element.prototype.requestFullscreen = function (options) {
            const target = host.contains(this) ? document.documentElement : this;
            return requestFullscreen.call(target, options);
        };

        host.append(video);
        video.dispatchEvent(new Event('extension-player-source-ready', { bubbles: true }));
        toParent({ type: 'BROADCAST_READY' });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
