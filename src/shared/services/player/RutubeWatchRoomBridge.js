// Maps the documented Rutube embed protocol to the extension's room-sync
// protocol. This class owns only cross-origin player messages; room roles,
// revisions and persistence remain in WatchRoomStagingController.
class RutubeWatchRoomBridge {
    constructor({ getIframe, now = () => Date.now() } = {}) {
        this.getIframe = getIframe || (() => null);
        this.now = now;
        this.ready = false;
        this.durationMs = null;
        this.currentTimeMs = 0;
        this.lastTimeSample = null;
        this.lastState = 'paused';
        this.adPlaying = false;
        this.subscriptionId = null;
        this.readyWaiters = new Set();
    }

    isActive() {
        const iframe = this.getIframe?.();
        return Boolean(iframe?.contentWindow && this.getOrigin(iframe) === 'https://rutube.ru');
    }

    getOrigin(iframe = this.getIframe?.()) {
        try {
            return new URL(iframe?.src || '', globalThis.window?.location?.href).origin;
        } catch {
            return null;
        }
    }

    subscribe(subscriptionId) {
        this.subscriptionId = typeof subscriptionId === 'string' ? subscriptionId : null;
    }

    async probe(timeoutMs = 6000) {
        if (!this.isActive()) throw new Error('Rutube iframe is unavailable');
        if (this.ready) return this.getProbeResult();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.readyWaiters.delete(waiter);
                reject(new Error('Rutube player did not confirm readiness'));
            }, timeoutMs);
            const waiter = () => {
                clearTimeout(timeout);
                resolve(this.getProbeResult());
            };
            this.readyWaiters.add(waiter);
        });
    }

    getProbeResult() {
        return {
            capabilities: {
                observeTime: true,
                play: true,
                pause: true,
                seek: true,
                duration: true,
            },
            rutubeIframe: true,
        };
    }

    command({ action, positionMs } = {}) {
        const iframe = this.getIframe?.();
        const origin = this.getOrigin(iframe);
        if (!iframe?.contentWindow || origin !== 'https://rutube.ru') {
            throw new Error('Rutube iframe is unavailable');
        }

        let payload = null;
        if (action === 'play') payload = { type: 'player:play', data: {} };
        if (action === 'pause') payload = { type: 'player:pause', data: {} };
        if (action === 'seek') {
            const milliseconds = Number(positionMs);
            if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
            payload = { type: 'player:setCurrentTime', data: { time: milliseconds / 1000 } };
        }
        if (!payload) return;
        iframe.contentWindow.postMessage(JSON.stringify(payload), origin);
    }

    handleWindowMessage(event) {
        const iframe = this.getIframe?.();
        if (!iframe?.contentWindow || event?.source !== iframe.contentWindow || event?.origin !== 'https://rutube.ru') {
            return { handled: false, ready: false, messages: [] };
        }

        const data = this.parseMessage(event.data);
        if (!data) return { handled: false, ready: false, messages: [] };
        const type = data.type;
        if (!['player:ready', 'player:changeState', 'player:currentTime', 'player:durationChange', 'player:rollState', 'player:adStart', 'player:adEnd'].includes(type)) {
            return { handled: false, ready: false, messages: [] };
        }

        const messages = [];
        let ready = false;
        if (type === 'player:ready') {
            this.ready = true;
            ready = true;
            this.readyWaiters.forEach((waiter) => waiter());
            this.readyWaiters.clear();
        } else if (type === 'player:durationChange') {
            const duration = Number(data.data?.duration);
            if (Number.isFinite(duration) && duration >= 0) this.durationMs = Math.round(duration * 1000);
        } else if (type === 'player:rollState') {
            this.adPlaying = data.data?.state === 'play';
        } else if (type === 'player:adStart') {
            this.adPlaying = true;
        } else if (type === 'player:adEnd') {
            this.adPlaying = false;
        } else if (type === 'player:currentTime') {
            const time = Number(data.data?.time);
            if (Number.isFinite(time) && time >= 0) {
                const currentTimeMs = Math.round(time * 1000);
                if (!this.adPlaying && this.isMeaningfulSeek(currentTimeMs)) {
                    messages.push(this.telemetry('seeked', currentTimeMs));
                }
                this.currentTimeMs = currentTimeMs;
                this.lastTimeSample = { currentTimeMs, atMs: this.now() };
            }
        } else if (type === 'player:changeState' && !this.adPlaying) {
            const state = data.data?.state;
            if (state === 'playing' || state === 'paused') {
                this.lastState = state;
                messages.push(this.telemetry(state === 'playing' ? 'play' : 'pause', this.currentTimeMs));
            }
        }

        return { handled: true, ready, messages: messages.filter(Boolean) };
    }

    parseMessage(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        if (typeof value !== 'string' || value.length > 10_000) return null;
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    isMeaningfulSeek(nextTimeMs) {
        if (!this.lastTimeSample || this.lastState !== 'playing') return false;
        const elapsed = Math.max(0, this.now() - this.lastTimeSample.atMs);
        const expected = this.lastTimeSample.currentTimeMs + elapsed;
        return Math.abs(nextTimeMs - expected) > 2_000;
    }

    telemetry(kind, currentTimeMs) {
        if (!this.subscriptionId || !Number.isFinite(Number(currentTimeMs))) return null;
        return {
            type: 'ROOM_SYNC_TELEMETRY',
            subscriptionId: this.subscriptionId,
            kind,
            currentTimeMs: Math.max(0, Math.round(Number(currentTimeMs))),
        };
    }
}

if (typeof window !== 'undefined') window.RutubeWatchRoomBridge = RutubeWatchRoomBridge;
if (typeof module !== 'undefined' && module.exports) module.exports = { RutubeWatchRoomBridge };
