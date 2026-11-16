import { AudioFx } from '../AudioFx.js';

/**
 * Short synthesized cues for Battleship. They reuse the mini-games' AudioFx, so
 * the shared «gamesMuted» switch silences them too, and stay quiet until a click
 * has unlocked audio for the page.
 */
export class BattleshipSounds {
    constructor(audio = new AudioFx()) {
        this.audio = audio;
    }

    get muted() {
        return this.audio.muted;
    }

    setMuted(muted) {
        this.audio.setMuted(muted);
    }

    unlock() {
        this.audio.init();
    }

    sequence(notes) {
        if (this.audio.muted || !this.audio.ctx) return;
        notes.forEach(([frequency, duration, type, gain, delay]) => {
            setTimeout(() => this.audio.playTone(frequency, duration, type, gain), delay);
        });
    }

    /** A shot of ours went into the water. */
    splash() {
        this.sequence([[180, 0.12, 'sine', 0.05, 0], [120, 0.16, 'sine', 0.035, 40]]);
    }

    /** A shot of ours hit a ship. */
    hit() {
        this.sequence([[520, 0.07, 'square', 0.035, 0], [260, 0.14, 'triangle', 0.05, 50]]);
    }

    /** A shot of ours sank a ship. */
    sunk() {
        this.sequence([[660, 0.08, 'triangle', 0.05, 0], [494, 0.08, 'triangle', 0.05, 80], [330, 0.2, 'sawtooth', 0.04, 160]]);
    }

    /** The opponent hit one of our ships. */
    incomingHit() {
        this.sequence([[110, 0.2, 'sawtooth', 0.045, 0], [82, 0.24, 'sine', 0.05, 60]]);
    }

    /** The turn came back to us. */
    yourTurn() {
        this.sequence([[784, 0.07, 'sine', 0.04, 0], [1046, 0.1, 'sine', 0.04, 90]]);
    }

    victory() {
        this.audio.clear();
    }

    defeat() {
        this.audio.gameOver();
    }
}
