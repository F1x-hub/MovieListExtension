/**
 * Offscreen Document — Persistent Anime Radio Player
 * This document lives outside the visible pages and survives navigation.
 * All control is done via chrome.runtime messages.
 */
// Scraper iframe traces: localStorage 'movielist:debug-ratings' = '1'.
function scraperTrace(...args) {
    try {
        if (globalThis.localStorage?.getItem('movielist:debug-ratings') === '1') console.info(...args);
    } catch {
        // Tracing is optional.
    }
}

const audio = document.getElementById('radio');
// Scraper frame slots: slot 0 is the frame in offscreen.html, further slots are
// created on demand so the background can load Kinopoisk pages in parallel.
const scraperSlots = new Map();

function getScraperSlot(slot = 0) {
    const index = Number.isInteger(slot) && slot >= 0 && slot < 4 ? slot : 0;
    if (scraperSlots.has(index)) return scraperSlots.get(index);
    let frame = index === 0 ? document.getElementById('scraperFrame') : null;
    if (!frame && index > 0) {
        frame = document.createElement('iframe');
        frame.id = `scraperFrame${index}`;
        frame.style.cssText = 'display:none; width:0; height:0; border:0;';
        document.body.appendChild(frame);
    }
    if (!frame) return null;
    const state = { frame, requestId: null, startedAt: 0 };
    frame.addEventListener('load', () => {
        scraperTrace('[KinopoiskOffscreenTrace]', {
            stage: 'iframe:load',
            slot: index,
            requestId: state.requestId,
            stageDurationMs: state.startedAt ? Date.now() - state.startedAt : null
        });
    });
    frame.addEventListener('error', (error) => {
        console.warn('[KinopoiskOffscreenTrace]', {
            stage: 'iframe:error',
            slot: index,
            requestId: state.requestId,
            stageDurationMs: state.startedAt ? Date.now() - state.startedAt : null,
            error: error?.message || 'iframe-load-error'
        });
    });
    scraperSlots.set(index, state);
    return state;
}

// Default volume
if (audio) {
    audio.volume = 0.8;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- Kinopoisk Scraper Iframe Control ---
    if (message.target === 'offscreen-scraper') {
        switch (message.type) {
            case 'LOAD_SEARCH_FRAME': {
                const state = getScraperSlot(message.slot);
                if (state) {
                    state.requestId = message.requestId || null;
                    state.startedAt = Date.now();
                    scraperTrace('[KinopoiskOffscreenTrace]', {
                        stage: 'iframe:load-start',
                        slot: message.slot ?? 0,
                        requestId: state.requestId,
                        searchUrl: message.searchUrl
                    });
                    state.frame.src = message.searchUrl || 'about:blank';
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'scraperFrame not found' });
                }
                return false;
            }

            case 'CLEANUP_SEARCH_FRAME': {
                const state = getScraperSlot(message.slot);
                if (state) {
                    scraperTrace('[KinopoiskOffscreenTrace]', {
                        stage: 'iframe:cleanup',
                        slot: message.slot ?? 0,
                        requestId: state.requestId
                    });
                    state.frame.src = 'about:blank';
                    state.requestId = null;
                    state.startedAt = 0;
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false });
                }
                return false;
            }

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
