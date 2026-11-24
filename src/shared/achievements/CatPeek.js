/**
 * The silhouette that stands in the frame picker until the cat trail is done. It
 * looks at the pointer while that is over the card; in the box it keeps low and
 * comes up to whoever points at it or reaches it with the keyboard.
 */
import { HEAD, renderCat } from './CatDenArt.js';
import { EYES, HIDDEN, REST, pair } from './CatPoses.js';
import { CatPuppet } from './CatPuppet.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
/** In the box only the eyes are over the rim until somebody comes near. */
const LOW = { ...REST[2], ...pair('paw', 0), drop: EYES, pupil: 0.6 };

export class CatPeek {
    /**
     * @param {HTMLElement} button - becomes the silhouette
     * @param {number} step - steps passed
     * @param {HTMLElement} [around] - where the pointer is watched
     */
    constructor(button, step, around = button) {
        this.step = step;
        this.abort = new AbortController();
        button.innerHTML = renderCat({ compact: true });
        this.svg = button.querySelector('.cat-art');
        this.puppet = new CatPuppet(button, { still: matchMedia('(prefers-reduced-motion: reduce)').matches, alive: false });
        const { signal } = this.abort;
        const on = (target, type, handler) => target.addEventListener(type, handler, { signal });
        on(around, 'pointermove', event => this.look(event));
        on(around, 'pointerleave', () => this.lookAway());
        for (const type of ['pointerenter', 'focus']) on(button, type, () => this.near(true));
        for (const type of ['pointerleave', 'blur']) on(button, type, () => this.near(false));
        this.arrive();
        this.puppet.live();
    }

    arrive() {
        const { puppet, step } = this;
        if (step === 2) {
            puppet.setMode('box');
            puppet.jump({ ...LOW, drop: HIDDEN }).to(LOW);
            return;
        }
        puppet.jump({ ...REST[step], ...pair('lid', 1), glow: 0 });
        if (step === 1) puppet.after(350, () => puppet.to(REST[1]));
    }

    look(event) {
        const matrix = this.svg.getScreenCTM();
        if (!matrix) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        const dx = clamp((point.x - HEAD.x) / 320, -1, 1);
        this.puppet.lookAt(point).to({ earL: dx * 9, earR: -dx * 9, headX: dx * 7, headR: dx * 4, torchX: point.x, torchY: point.y, torch: this.step < 2 ? 0.7 : 0 });
    }

    lookAway() {
        this.puppet.lookAt(null).to({ ...pair('ear', 0), headX: 0, headR: 0, torch: 0 });
    }

    near(close) {
        const { puppet, step } = this;
        if (step === 0) puppet.to({ headY: close ? -5 : 0 }).flick();
        else if (step === 1) puppet.to({ ...pair('flat', close ? 0.4 : 0), ...pair('lid', close ? 0.22 : 0), headY: close ? 6 : 0, pupil: close ? 0.7 : REST[1].pupil });
        else puppet.to(close ? { drop: 0, ...pair('paw', 1), pupil: 0.45, smile: 0.6 } : LOW);
    }

    dispose() {
        this.abort.abort();
        this.puppet.dispose();
    }
}
