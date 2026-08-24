/**
 * Offscreen Document — Persistent Anime Radio Player
 * This document lives outside the visible pages and survives navigation.
 * All control is done via chrome.runtime messages.
 */
const audio = document.getElementById('radio');
const scraperFrame = document.getElementById('scraperFrame');

// Default volume
if (audio) {
    audio.volume = 0.8;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- Kinopoisk Scraper Iframe Control ---
    if (message.target === 'offscreen-scraper') {
        switch (message.type) {
            case 'LOAD_SEARCH_FRAME':
                if (scraperFrame) {
                    console.log('[Offscreen] Loading scraper iframe:', message.searchUrl);
                    scraperFrame.src = message.searchUrl || 'about:blank';
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'scraperFrame not found' });
                }
                return false;

            case 'CLEANUP_SEARCH_FRAME':
                if (scraperFrame) {
                    console.log('[Offscreen] Cleaning up scraper iframe');
                    scraperFrame.src = 'about:blank';
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false });
                }
                return false;

            default:
                return false;
        }
    }

    if (message.target !== 'offscreen-radio') return false;

    switch (message.type) {
        case 'RADIO_PLAY':
            // If no source set yet, nothing to play
            if (!audio.src) {
                sendResponse({ success: false, error: 'No stream source set' });
                return false;
            }
            audio.play()
                .then(() => sendResponse({ success: true }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true; // async

        case 'RADIO_STOP':
            audio.pause();
            audio.currentTime = 0;
            // Reload src to fully disconnect the stream and save bandwidth
            audio.load();
            sendResponse({ success: true });
            return false;

        case 'RADIO_SET_SOURCE': {
            // Change stream URL. Stop current playback first.
            const wasPlaying = !audio.paused;
            audio.pause();
            audio.src = message.streamUrl || '';
            audio.load();
            if (wasPlaying && audio.src) {
                audio.play()
                    .then(() => sendResponse({ success: true, resumed: true }))
                    .catch(err => sendResponse({ success: false, error: err.message }));
                return true; // async
            }
            sendResponse({ success: true, resumed: false });
            return false;
        }

        case 'RADIO_SET_VOLUME':
            audio.volume = message.volume;
            sendResponse({ success: true });
            return false;

        case 'RADIO_SET_MUTED':
            audio.muted = message.muted;
            sendResponse({ success: true });
            return false;

        case 'RADIO_GET_STATE':
            sendResponse({
                isPlaying: !audio.paused,
                volume: audio.volume,
                isMuted: audio.muted,
                streamUrl: audio.src || ''
            });
            return false;

        default:
            return false;
    }
});
