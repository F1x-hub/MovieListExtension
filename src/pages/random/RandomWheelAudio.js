const WHEEL_AUDIO_PATHS = {
    spin: 'src/shared/assets/audio/random-wheel-spin.mp3',
    winner: 'src/shared/assets/audio/random-wheel-winner.mp3'
};
const SPIN_FADE_SECONDS = 1.2;

/** Page-local audio: one looping spin or one result cue, tied to the wheel lifecycle. */
export class RandomWheelAudio {
    constructor(volume = 1) {
        this.context = null;
        this.gain = null;
        this.volume = 1;
        this.setVolume(volume);
        this.source = null;
        this.envelope = null;
        this.spinActive = false;
        this.spinDeadline = Infinity;
        this.spinFadeSeconds = SPIN_FADE_SECONDS;
        this.generation = 0;
        this.buffers = new Map();
    }

    setVolume(volume) {
        if (!Number.isFinite(volume)) return;
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.gain) {
            this.gain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.015);
        }
    }

    startSpin(durationMs = null) {
        if (!this.spinActive) {
            this.stop();
            this.spinActive = true;
            this.spinDeadline = durationMs === null ? Infinity : performance.now() + durationMs;
            this.spinFadeSeconds = durationMs === null ? SPIN_FADE_SECONDS : Math.min(SPIN_FADE_SECONDS, durationMs / 2000);
            void this._play('spin', this.generation);
        } else if (durationMs !== null) {
            // Keep the music continuous after the marathon server confirms its winner.
            this.spinDeadline = performance.now() + durationMs;
            this.spinFadeSeconds = Math.min(SPIN_FADE_SECONDS, durationMs / 2000);
            if (this.source) this._scheduleSpinEnd(durationMs);
        }
    }

    finish() {
        this.stop();
        void this._play('winner', this.generation);
    }

    stop() {
        this.generation++;
        this.spinActive = false;
        if (this.source) {
            this.source.stop();
            this.source.disconnect();
            this.source = null;
        }
        if (this.envelope) {
            this.envelope.disconnect();
            this.envelope = null;
        }
    }

    async _play(kind, generation) {
        try {
            // Create and resume in the spin click before any asynchronous server work.
            if (!this.context) {
                this.context = new AudioContext();
                this.gain = this.context.createGain();
                this.gain.gain.value = this.volume;
                this.gain.connect(this.context.destination);
            }
            const resumed = this.context.resume();
            const bufferPromise = this._getBuffer(kind);
            // Decode the result cue during the spin so the first winner has no loading gap.
            if (kind === 'spin') this._getBuffer('winner');
            const [, buffer] = await Promise.all([resumed, bufferPromise]);
            if (generation !== this.generation) return;

            const remaining = kind === 'spin' ? this.spinDeadline - performance.now() : Infinity;
            if (remaining <= 0) return;
            const source = this.context.createBufferSource();
            // Fade each spin separately so the volume slider and winner cue keep their level.
            const envelope = this.context.createGain();
            source.buffer = buffer;
            source.loop = kind === 'spin';
            source.connect(envelope);
            envelope.connect(this.gain);
            source.onended = () => {
                source.disconnect();
                envelope.disconnect();
                if (this.source === source) this.source = null;
                if (this.envelope === envelope) this.envelope = null;
            };
            source.start();
            this.source = source;
            this.envelope = envelope;
            // The audio clock stops short spins even when animation frames are throttled.
            if (Number.isFinite(remaining)) this._scheduleSpinEnd(remaining);
        } catch {
            // Unsupported or blocked audio must never prevent selecting a movie.
        }
    }

    _scheduleSpinEnd(remainingMs) {
        const now = this.context.currentTime;
        const remainingSeconds = remainingMs / 1000;
        const end = now + remainingSeconds;
        const fadeSeconds = this.spinFadeSeconds;
        const level = fadeSeconds > 0 ? Math.min(1, remainingSeconds / fadeSeconds) : 1;
        const fade = this.envelope.gain;
        fade.cancelScheduledValues(now);
        // Late decoding starts at the current fade level instead of briefly playing loudly.
        fade.setValueAtTime(level, now);
        if (remainingSeconds > fadeSeconds) fade.setValueAtTime(1, end - fadeSeconds);
        fade.linearRampToValueAtTime(0, end);
        this.source.stop(end);
    }

    _getBuffer(kind) {
        let promise = this.buffers.get(kind);
        if (!promise) {
            promise = this._loadBuffer(kind);
            this.buffers.set(kind, promise);
            promise.catch(() => this.buffers.delete(kind));
        }
        return promise;
    }

    async _loadBuffer(kind) {
        const response = await fetch(chrome.runtime.getURL(WHEEL_AUDIO_PATHS[kind]));
        if (!response.ok) throw new Error('Wheel audio unavailable');
        return this.context.decodeAudioData(await response.arrayBuffer());
    }
}
