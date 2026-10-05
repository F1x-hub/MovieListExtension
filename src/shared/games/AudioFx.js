/** Tiny Web Audio synthesizer shared by the mini-games; the mute flag is persisted. */
export class AudioFx {
    constructor() {
        this.ctx = null;
        this.muted = false;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                chrome.storage.local.get('gamesMuted', (data) => {
                    this.muted = data?.gamesMuted ?? false;
                });
            } catch { /* Sound preference is optional. */ }
        }
    }

    init() {
        if (!this.ctx) {
            const AudioContext = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
            if (AudioContext) {
                this.ctx = new AudioContext();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    setMuted(muted) {
        this.muted = muted;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ gamesMuted: muted });
        }
    }

    playTone(freq, duration, type = 'sine', gainVal = 0.05) {
        if (this.muted || !this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch {
            // Audio is decorative; a failed tone never interrupts a game.
        }
    }

    move() { this.playTone(220, 0.04, 'square', 0.02); }
    rotate() { this.playTone(440, 0.06, 'triangle', 0.04); }
    drop() { this.playTone(160, 0.08, 'sine', 0.06); }
    eat() {
        this.playTone(600, 0.08, 'triangle', 0.06);
        setTimeout(() => this.playTone(880, 0.1, 'sine', 0.06), 60);
    }
    clear() {
        if (this.muted || !this.ctx) return;
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
            setTimeout(() => this.playTone(freq, 0.09, 'triangle', 0.06), idx * 60);
        });
    }
    gameOver() {
        if (this.muted || !this.ctx) return;
        [350, 300, 250, 200, 150].forEach((freq, idx) => {
            setTimeout(() => this.playTone(freq, 0.12, 'sawtooth', 0.05), idx * 80);
        });
    }
}
