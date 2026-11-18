import { AudioFx } from '../AudioFx.js';

/**
 * Short synthesized cues for chess. They reuse the mini-games' AudioFx, so the
 * shared «gamesMuted» switch silences them too, and stay quiet until a click or
 * a key has unlocked audio for the page.
 */
export class ChessSounds {
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

    /** A piece set down on stone. */
    move() {
        this.sequence([[300, 0.035, 'triangle', 0.05, 0], [150, 0.06, 'sine', 0.045, 18]]);
    }

    capture() {
        this.sequence([[520, 0.04, 'square', 0.025, 0], [190, 0.09, 'triangle', 0.055, 24]]);
    }

    castle() {
        this.sequence([[300, 0.035, 'triangle', 0.05, 0], [150, 0.05, 'sine', 0.04, 18], [280, 0.035, 'triangle', 0.045, 140], [140, 0.05, 'sine', 0.04, 158]]);
    }

    check() {
        this.sequence([[880, 0.07, 'sine', 0.04, 0], [660, 0.11, 'sine', 0.035, 80]]);
    }

    promote() {
        this.sequence([[523, 0.07, 'triangle', 0.045, 0], [784, 0.1, 'triangle', 0.045, 70], [1046, 0.12, 'sine', 0.035, 150]]);
    }

    start() {
        this.sequence([[392, 0.08, 'sine', 0.04, 0], [587, 0.12, 'sine', 0.04, 90]]);
    }

    /** The turn came back to us in an online game. */
    yourTurn() {
        this.sequence([[784, 0.06, 'sine', 0.035, 0], [1046, 0.09, 'sine', 0.035, 80]]);
    }

    lowTime() {
        this.sequence([[1200, 0.05, 'square', 0.02, 0]]);
    }

    win() {
        this.audio.clear();
    }

    loss() {
        this.audio.gameOver();
    }

    draw() {
        this.sequence([[440, 0.1, 'sine', 0.04, 0], [440, 0.14, 'sine', 0.035, 140]]);
    }

    /** The cue for a move just shown on the board. */
    forMove(move) {
        if (!move) return;
        if (move.check) this.check();
        else if (move.promotion) this.promote();
        else if (move.castle) this.castle();
        else if (move.captured) this.capture();
        else this.move();
    }
}
