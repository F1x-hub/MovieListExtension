/**
 * The den: the scene where the cat trail is followed and finished. It shows how
 * far the cat has come out (catTrail.js), hints at the next step in its caption
 * and, at the last one, lets the viewer pet the cat. A stroke is a slow pass over
 * the head in one direction; hurrying startles the cat and takes a stroke back.
 *
 * The cat itself is CatPuppet: here are only its poses and the order of events. A
 * story is a chain of `wait` and `tween`; a press on the scene plays it to its end
 * at once, closing the dialog drops it, and without motion it has no length.
 */
import { renderAvatarFrame } from './AchievementBadge.js';
import { HEAD, renderCat, renderPaws } from './CatDenArt.js';
import { FRAME_PARTS, framePartUrl } from './CatFrameParts.js';
import { CALM, EARS, EYES, HIDDEN, REST, pair } from './CatPoses.js';
import { CatPuppet } from './CatPuppet.js';
import { CAT_FRAME, TRAIL_STEPS } from './catTrail.js';

export const STROKES = 9;
/** Where a hand is over the head, in units of the 640x400 drawing. */
const TOUCH = { x: 320, y: 186, rx: 132, ry: 122 };
const STROKE_LENGTH = 70;
const STROKE_PAUSE_MS = 240;
const TOO_FAST = 1.4;
const FAST_SAMPLES = 3;
const SAVE_TIMEOUT_MS = 10000;

const CLOSE_ICON = '<svg data-icon="CLOSE" aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5L15 15M15 5L5 15"/></svg>';
const HEART = 'M12 21C5 15 2 11 2 7.500 2 4 5 2 7.500 2 9.500 2 11 3 12 5 13 3 14.500 2 16.500 2 19 2 22 4 22 7.500 22 11 19 15 12 21Z';
const STAR = 'M12 1.500L15 8.500 22.500 9.200 16.800 14.200 18.500 21.500 12 17.600 5.500 21.500 7.200 14.200 1.500 9.200 9 8.500Z';
const SPARK = 'M12 0C12.800 8 16 11.200 24 12 16 12.800 12.800 16 12 24 11.200 16 8 12.800 0 12 8 11.200 11.200 8 12 0Z';
const RING = '<path d="M1 50a49 49 0 1 0 98 0a49 49 0 1 0-98 0Z"/>';
const COLORS = ['#ff407c', '#ff8fb0', '#ffd0de', '#c3a2ec', '#ffc9a0', '#dcecfb'];
const POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const between = (low, high) => low + Math.random() * (high - low);
const easeOut = k => 1 - (1 - k) ** 3;
const easeIn = k => k * k;
const easeInOut = k => (k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2);
const arc = k => Math.sin(k * Math.PI);

/** The lines a step can say, so the caption can keep room for the longest. */
const LINES = [
    ['hint_0', 'hint_ear'],
    ['hint_1', 'hint_shy', 'hint_peek'],
    ['hint_2', 'hint_fast', 'hint_pet_1', 'hint_pet_2', 'hint_pet_3', 'save_failed', 'hint_slow', 'done_text']
];

/** Counts strokes from pointer positions over the head. */
export class StrokeMeter {
    constructor() {
        this.lift();
        this.lastStroke = -Infinity;
    }

    /** The hand left the head. */
    lift() {
        this.x = null;
        this.direction = 0;
        this.travel = 0;
        this.counted = false;
        this.fast = 0;
    }

    /** @returns {'stroke'|'startle'|null} */
    move(x, time) {
        if (this.x === null) {
            this.x = x;
            this.time = time;
            return null;
        }
        const dx = x - this.x;
        const dt = Math.max(1, time - this.time);
        this.x = x;
        this.time = time;
        if (!dx) return null;
        this.fast = Math.abs(dx) / dt > TOO_FAST ? this.fast + 1 : 0;
        if (this.fast >= FAST_SAMPLES) {
            this.lift();
            return 'startle';
        }
        const direction = Math.sign(dx);
        if (direction !== this.direction) {
            this.direction = direction;
            this.travel = 0;
            this.counted = false;
        }
        this.travel += Math.abs(dx);
        if (this.counted || this.travel < STROKE_LENGTH || time - this.lastStroke < STROKE_PAUSE_MS) return null;
        this.counted = true;
        this.lastStroke = time;
        return 'stroke';
    }
}

export class CatDen {
    /**
     * @param {Object} options
     * @param {(key: string, params?: Object) => string} options.t - texts under `achievements`
     * @param {() => Promise<void>} options.onPetted - stores the last step; rejects when it could not
     * @param {() => void} options.onWear
     */
    constructor({ t, onPetted, onWear }) {
        this.t = t;
        this.onPetted = onPetted;
        this.onWear = onWear;
    }

    /**
     * @param {number} steps - steps passed, below TRAIL_STEPS
     * @param {string} [uid] - whose den, for playing a newly passed step once
     */
    open(steps, uid = '') {
        if (this.dialog) return;
        const seen = this.lastSeen(uid, steps);
        this.steps = steps;
        this.strokes = 0;
        this.state = 'story';
        this.mood = 0;
        this.hiding = '';
        this.reward = null;
        this.skipping = false;
        this.pending = new Set();
        this.meter = new StrokeMeter();
        this.abort = new AbortController();
        this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.build(seen);
        document.body.append(this.dialog);
        this.puppet = new CatPuppet(this.stage, { still: this.reduced });
        this.dialog.showModal();
        this.bind();
        this.puppet.live(() => (this.state === 'watching' && !this.hiding) || (this.state === 'petting' && !this.content));
        this.run(async () => {
            await this.lights();
            await this.story(seen);
        });
    }

    lastSeen(uid, steps) {
        const key = `catDenSeen_${uid}`;
        let seen = steps;
        try {
            seen = Math.min(steps, Math.max(0, Number(localStorage.getItem(key)) || 0));
            localStorage.setItem(key, String(steps));
        } catch { /* storage unavailable: nothing to replay */ }
        return seen;
    }

    /* ── The dialog ─────────────────────────────────────────────────────── */

    build(seen) {
        const dialog = document.createElement('dialog');
        dialog.className = 'cat-den';
        dialog.setAttribute('closedby', 'any');
        dialog.setAttribute('aria-labelledby', 'catDenTitle');
        dialog.innerHTML = `
            <button type="button" class="cat-den__close">${CLOSE_ICON}</button>
            <div class="cat-scene cat-den__stage" data-step="${seen}">${renderCat()}<div class="cat-den__fx" aria-hidden="true"></div></div>
            <div class="cat-den__panel">
                <div class="cat-den__paws" role="img">${renderPaws(TRAIL_STEPS)}</div>
                <h1 class="cat-den__title" id="catDenTitle"></h1>
                <div class="cat-den__hints"><p class="cat-den__hint" aria-live="polite"></p></div>
                <div class="cat-den__actions" inert><div>
                    <button type="button" class="btn btn-primary" data-den="wear"></button>
                    <button type="button" class="btn btn-secondary" data-den="later"></button>
                </div></div>
            </div>`;
        const find = selector => dialog.querySelector(selector);
        this.dialog = dialog;
        this.stage = find('.cat-den__stage');
        this.svg = find('.cat-art');
        this.fx = find('.cat-den__fx');
        this.paws = find('.cat-den__paws');
        this.title = find('.cat-den__title');
        this.hint = find('.cat-den__hint');
        this.actions = find('.cat-den__actions');
        this.closeButton = find('.cat-den__close');
        this.closeButton.setAttribute('aria-label', this.t('close'));
        find('[data-den="wear"]').textContent = this.t('cat.wear');
        find('[data-den="later"]').textContent = this.t('cat.later');
        // Unseen copies of every line hold the caption's height.
        for (const key of LINES.slice(seen, this.steps + 1).flat()) {
            const line = document.createElement('p');
            line.setAttribute('aria-hidden', 'true');
            line.textContent = this.t(`cat.${key}`);
            this.hint.parentElement.append(line);
        }
        this.ink(seen);
        this.title.textContent = this.t(`cat.title_${seen}`);
        this.hint.textContent = this.t(`cat.hint_${seen}`);
    }

    /** The scene's light, caption and paw prints for a step. */
    show(step) {
        this.stage.dataset.step = String(step);
        this.say(`cat.title_${step}`, `cat.hint_${step}`);
        this.ink(step, true);
    }

    /** Changes the caption; what it said fades behind what it says. */
    say(titleKey, hintKey) {
        for (const [element, key] of [[this.title, titleKey], [this.hint, hintKey]]) {
            const text = key && this.t(key);
            if (!text || element.textContent === text) continue;
            element.textContent = text;
            if (this.reduced) continue;
            element.animate([{ opacity: 0.1, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: OUT });
        }
    }

    /** Paw prints: `passed` steps are inked, and a part of the next one. */
    ink(passed, fresh = false) {
        [...this.paws.children].forEach((paw, index) => {
            const full = index < Math.floor(passed);
            paw.classList.toggle('is-passed', full);
            paw.style.setProperty('--ink', String(clamp(passed - index, 0, 1)));
        });
        this.paws.setAttribute('aria-label', this.t('cat.paws', { n: Math.floor(passed), m: TRAIL_STEPS }));
        const paw = fresh && this.paws.children[Math.floor(passed) - 1];
        if (paw && !this.reduced) {
            paw.animate([
                { transform: 'scale(1.9) rotate(-14deg)', opacity: 0.2 },
                { transform: 'scale(0.86) rotate(3deg)', opacity: 1, offset: 0.55 },
                { transform: 'none', opacity: 1 }
            ], { duration: 520, easing: OUT });
        }
    }

    bind() {
        const { signal } = this.abort;
        const on = (target, type, handler) => target.addEventListener(type, handler, { signal });
        on(this.closeButton, 'click', () => this.dialog.close());
        on(this.dialog, 'close', () => this.dispose());
        on(this.dialog, 'pointermove', event => this.look(event));
        on(this.dialog, 'pointerleave', () => this.lookAway());
        on(this.stage, 'pointermove', event => this.hover(event));
        on(this.stage, 'pointerleave', () => this.leave());
        on(this.stage, 'pointerup', event => event.pointerType !== 'mouse' && this.leave());
        on(this.stage, 'pointercancel', () => this.leave());
        on(this.stage, 'click', () => this.press());
        on(this.stage, 'keydown', event => this.key(event));
        on(this.actions, 'click', event => {
            const action = event.target.closest('[data-den]')?.dataset.den;
            if (!action) return;
            if (action === 'wear') this.onWear();
            this.dialog.close();
        });
    }

    dispose() {
        this.abort.abort();
        this.puppet.dispose();
        this.pending.clear();
        const dialog = this.dialog;
        this.dialog = null;
        // Left in place until its exit transition ends.
        setTimeout(() => dialog.remove(), 400);
    }

    /* ── Time ───────────────────────────────────────────────────────────── */

    run(story) {
        story().catch(error => {
            if (this.dialog && error?.name !== 'AbortError') console.warn('[CatDen] The scene stopped:', error);
        });
    }

    wait(ms) {
        const { signal } = this.abort;
        signal.throwIfAborted();
        if (this.skipping || this.reduced) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const finish = () => {
                clearTimeout(timer);
                this.pending.delete(finish);
                resolve();
            };
            const timer = setTimeout(finish, ms);
            this.pending.add(finish);
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(signal.reason);
            }, { once: true });
        });
    }

    /** Draws 0–1 over time. */
    async tween(ms, draw) {
        const { signal } = this.abort;
        const start = performance.now();
        while (!this.skipping && !this.reduced) {
            const now = await new Promise(requestAnimationFrame);
            signal.throwIfAborted();
            const share = clamp((now - start) / ms, 0, 1);
            draw(share);
            if (share === 1) return;
        }
        draw(1);
    }

    later(work, ms) {
        const timer = setTimeout(work, ms);
        this.abort.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
        return timer;
    }

    /** Plays the rest of the running story at once. */
    skip() {
        this.skipping = true;
        [...this.pending].forEach(finish => finish());
        this.fx.getAnimations({ subtree: true }).forEach(animation => animation.effect.getComputedTiming().iterations !== Infinity && animation.finish());
    }

    /* ── The story ──────────────────────────────────────────────────────── */

    /**
     * A drawing seen for the first time costs the graphics card a second of slow
     * frames. So the dialog opens on a dark stage, everything the scene will need is
     * drawn behind that dark, and the light comes on once frames are quick again.
     */
    async lights() {
        const { signal } = this.abort;
        if (!this.reduced) {
            await this.pause(260);
            signal.throwIfAborted();
            this.stage.classList.add('is-set');
            const rehearsal = this.rehearse();
            const start = performance.now();
            for (let last = start, quick = 0, more = true; quick < 5 && last - start < 2400;) {
                if (more) more = rehearsal.next();
                const now = await new Promise(requestAnimationFrame);
                signal.throwIfAborted();
                quick = !more && now - last < 45 ? quick + 1 : 0;
                last = now;
            }
            rehearsal.end();
        }
        this.stage.classList.add('is-set', 'is-lit');
    }

    /** Every pose and every small thing once, a pose a frame, next to unseen. */
    rehearse() {
        const boxed = this.steps === TRAIL_STEPS - 1;
        const scene = document.createElement('div');
        scene.className = 'cat-scene cat-den__rehearsal';
        scene.dataset.step = boxed ? '2' : '1';
        scene.setAttribute('aria-hidden', 'true');
        const bit = shape => `<svg class="cat-den__bit" viewBox="0 0 24 24" style="left:40%;top:40%"><path d="${shape}"/></svg>`;
        scene.innerHTML = renderCat() + `<div class="cat-den__puff" style="left:50%;top:80%"></div>${boxed
            ? `${[HEART, STAR, SPARK].map(bit).join('')}<svg class="cat-den__ring" viewBox="0 0 100 100" style="left:50%;top:50%">${RING}</svg><span class="cat-den__sound">${this.t('cat.purr')}</span><div class="cat-den__shine" style="opacity:1"></div>` : ''}`;
        this.stage.append(scene);
        const puppet = new CatPuppet(scene, { still: true });
        const lids = [{ ...pair('lid', 0), glow: 0.8, torch: 0.6 }, { ...pair('lid', 0.35) }, { ...pair('lid', 0.8) }, { ...pair('lid', 1) }, { tense: 1 }, { ...pair('lid', 0.5), happy: 1, tense: 0 },
            { ...pair('lid', 1) }, { ...pair('lid', 0), happy: 0, wide: 1, pupil: 1 }, { ...pair('flat', 1), headR: 5, figR: 3, figSY: 0.9 }];
        const box = { ...REST[2], lidL: 0.3 };
        const poses = [...lids.map(pose => ['sit', pose]), ...(boxed ? [
            ['front', { ...box, figX: -180 }], ['leap', { figY: -120, figSY: 0.8 }], ['box', { ...box, drop: EARS }], ['box', { drop: EYES, flapL: 20, flapR: -12, boxR: 3, boxSY: 0.92 }],
            ['box', { ...box, ...pair('paw', 0.5), tailPuff: 1, tailLift: 1 }], ['box', { ...REST[2], ...pair('lid', 1), happy: 1, smile: 1 }], ['face', { bloom: 0.9, bloomS: 1, fade: 1, tail: 0.4, headSY: 1.16 }], ['face', { boxIn: 0.5, boxY: 90, boxR: -4, bloom: 1, bloomS: 1.3, ...pair('paw', 0) }], ['face', { boxIn: 0, fade: 0.5 }]
        ] : [])];
        let index = 0;
        return {
            next: () => {
                const [mode, pose] = poses[index++];
                puppet.setMode(mode);
                puppet.jump(pose);
                return index < poses.length;
            },
            end: () => {
                puppet.dispose();
                scene.remove();
            }
        };
    }

    async story(seen) {
        await this.enter(seen, seen < this.steps);
        for (let step = seen + 1; step <= this.steps; step++) {
            await this.wait(650);
            await (step === 1 ? this.wakeUp() : this.boxArrives());
        }
        this.skipping = false;
        this.settle();
    }

    /** How the viewer finds the cat: as it was left, if something is about to happen. */
    async enter(step, waiting) {
        const { puppet } = this;
        if (step < 2) {
            puppet.jump(waiting ? REST[step] : { ...REST[step], ...pair('lid', 1), glow: 0 });
            await this.wait(700);
            if (step === 1 && !waiting) await this.openEyes();
            else puppet.flick('R');
            return;
        }
        puppet.setMode('box');
        puppet.jump({ ...REST[2], ...pair('paw', 0), drop: HIDDEN });
        await this.wait(750);
        await this.emerge();
    }

    /** The scene has caught up: from here on the cat answers the hand. */
    settle() {
        if (!this.dialog) return;
        if (this.steps < TRAIL_STEPS - 1) {
            this.state = 'watching';
            return;
        }
        this.state = 'petting';
        Object.entries({ role: 'button', tabindex: '0', 'aria-label': this.t('cat.pet') })
            .forEach(([name, value]) => this.stage.setAttribute(name, value));
        this.loadParts();
    }

    async openEyes() {
        const { puppet } = this;
        puppet.to({ ...pair('ear', 5), headY: -3, ...pair('lid', 0.72), glow: 0.35 });
        await this.wait(420);
        puppet.to({ ...pair('lid', 0), wide: 0.35, glow: 1, pupil: 0.85 });
        await this.wait(520);
        puppet.to({ ...REST[1] });
        await this.wait(260);
        puppet.blink();
        await this.wait(320);
    }

    /** Step 1: called by its own word, the cat opens its eyes. */
    async wakeUp() {
        const { puppet } = this;
        puppet.flick('L', 420);
        puppet.to({ ...pair('ear', 9), headY: -7, headR: 2 });
        await this.wait(260);
        puppet.flick('R', 420);
        await this.wait(520);
        this.show(1);
        puppet.to({ ...pair('lid', 0.8), glow: 0.4 });
        await this.wait(460);
        puppet.to({ ...pair('lid', 0.97), glow: 0.15 });
        await this.wait(260);
        puppet.to({ ...pair('lid', 0), wide: 0.6, glow: 1, pupil: 1 });
        await this.wait(620);
        puppet.to({ ...REST[1], headR: 0 });
        await this.wait(420);
        puppet.blink();
        await this.wait(170);
        puppet.blink();
        await this.wait(400);
    }

    /** Step 2: a box slides in, and no cat can stay out of it. */
    async boxArrives() {
        const { puppet } = this;
        const left = -186;
        // Something scrapes along the floor.
        puppet.lookAt({ x: 680, y: 320 }).to({ earL: 5, earR: -9, headR: 4, headX: 5, pupil: 0.5 }).flick('R', 300);
        await this.wait(620);
        puppet.jump({ ...REST[2], ...pair('paw', 0), ...pair('lid', 0), boxX: 590, drop: 0, glow: 0.85, figX: 0, headR: 4, headX: 5 });
        const slide = this.tween(760, k => puppet.jump({ boxX: 590 * (1 - easeOut(k)), boxR: 2.4 * (1 - k) }));
        await this.wait(150);
        // Out of the way!
        puppet.setMode('front');
        puppet.to({ wide: 1, pupil: 0.08, ...pair('flat', 0.85), tailPuff: 0.9, tailLift: 0.5, headR: -4, headX: -6, whisk: 8 });
        await this.tween(430, k => puppet.jump({ figX: left * easeInOut(k), figY: -arc(k) * 58, figR: -arc(k) * 6, figSX: 1 - arc(k) * 0.05, figSY: 1 + arc(k) * 0.07 }));
        puppet.kick({ figSY: -2.6, figSX: 1.8 });
        this.dust(320 + left, 380, 5);
        await slide;
        puppet.kick({ boxR: 24, flapL: 110, flapR: -80 });
        this.dust(454, 380, 5, 1);
        await this.wait(220);
        // The projector comes on.
        this.stage.dataset.step = '2';
        puppet.to({ glow: 0, wide: 0.2, ...pair('flat', 0.2), tailPuff: 0.2 });
        puppet.blink();
        await this.wait(420);
        // A box. Sniff it.
        puppet.lookAt({ x: 320, y: 280 }).to({ wide: 0, pupil: 0.6, ...pair('flat', 0), earL: 6, earR: 12, tailPuff: 0, tailLift: 0.25, headX: 12, headY: 6, headR: 9, whisk: -5 });
        await this.wait(420);
        for (let sniff = 0; sniff < 3; sniff++) {
            puppet.to({ headX: 22, headY: 13, whisk: -9 });
            await this.wait(115);
            puppet.to({ headX: 15, headY: 8, whisk: -4 });
            await this.wait(135);
        }
        // The hunter's wiggle.
        puppet.to({ pupil: 1, headX: 4, headY: 34, headR: 3, figSY: 0.9, figSX: 1.06, ...pair('flat', 0.3), tailLift: 0.9, tailAmp: 1.6 });
        await this.wait(280);
        await this.tween(640, k => puppet.jump({ figR: Math.sin(k * Math.PI * 8) * 2.8 }));
        // The leap: up over the rim, then down into the box.
        puppet.to({ headY: -6, headX: 6, headR: -6, ...pair('flat', 0.5) });
        let inside = false;
        await this.tween(620, k => {
            if (!inside && k > 0.5) {
                inside = true;
                puppet.setMode('leap');
            }
            const across = easeInOut(clamp(k / 0.62, 0, 1));
            const height = k < 0.5 ? -152 * easeOut(k / 0.5) : -152 + 390 * easeIn((k - 0.5) / 0.5);
            // Stretched on the way up, gathered over the rim.
            const gathered = easeInOut(clamp((k - 0.12) / 0.4, 0, 1));
            puppet.jump({ figX: left * (1 - across), figY: height, figR: k < 0.5 ? -9 * arc(k * 2) : 8 * arc(k), figSX: 0.92 - 0.1 * gathered, figSY: 1.1 - 0.28 * gathered });
        });
        puppet.setMode('box');
        puppet.lookAt(null).jump({ ...CALM, smile: 0.35, pupil: 0.8, drop: HIDDEN });
        puppet.kick({ boxSY: -3.2, boxSX: 2, boxR: 26, flapL: 380, flapR: 320, camY: 130, tailLift: 6 });
        this.dust(194, 380, 7, -1);
        this.dust(446, 380, 7, 1);
        this.show(2);
        await this.wait(700);
        puppet.kick({ boxR: 46 });
        await this.wait(260);
        puppet.kick({ boxR: -54 });
        await this.wait(460);
        await this.emerge(true);
    }

    /** Out of the box: ears, then eyes over the rim, then the rest. */
    async emerge(first = false) {
        const { puppet } = this;
        const slow = first ? 0.9 : 0.62;
        puppet.to({ drop: EARS });
        await this.wait(460 * slow);
        puppet.flick('L', 320);
        await this.wait(240 * slow);
        puppet.flick('R', 320);
        await this.wait(380 * slow);
        puppet.to({ drop: EYES, wide: 0.3, pupil: 0.85 });
        await this.wait(560 * slow);
        puppet.to({ glanceX: -8 });
        await this.wait(440 * slow);
        puppet.to({ glanceX: 8 });
        await this.wait(440 * slow);
        puppet.to({ glanceX: 0 }).blink();
        await this.wait(360 * slow);
        puppet.to({ ...REST[2], pawL: 1, pawR: 0 }).kick({ flapL: 40, boxR: -14 });
        await this.wait(150);
        puppet.to({ pawR: 1 }).kick({ flapR: 40, boxR: 16 });
        await this.wait(420);
    }

    /* ── The hand ───────────────────────────────────────────────────────── */

    /** Pointer position in the drawing. */
    point(event) {
        const matrix = this.svg.getScreenCTM();
        return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
    }

    /** 1 at the edge of the head, less inside, more outside. */
    reach({ x, y }) {
        return Math.hypot((x - TOUCH.x) / TOUCH.rx, (y - TOUCH.y) / TOUCH.ry);
    }

    look(event) {
        const point = this.point(event);
        if (!point) return;
        const { puppet } = this;
        this.hand = point;
        const step = Number(this.stage.dataset.step);
        puppet.to({ torchX: point.x, torchY: point.y, torch: [1, 0.55, 0][step] });
        if (this.state !== 'watching' && this.state !== 'petting') return;
        clearTimeout(this.bored);
        this.bored = this.later(() => !this.hiding && !this.content && puppet.lookAt(null), 2600);
        if (this.hiding || this.content) return;
        const dx = clamp((point.x - HEAD.x) / 280, -1, 1);
        const dy = clamp((point.y - HEAD.y) / 220, -1, 1);
        puppet.lookAt(point).to({ earL: dx * 9, earR: -dx * 9, headX: dx * 6, headY: dy * 3, headR: dx * 3 });
        if (step === 1) this.approach(point);
    }

    lookAway() {
        this.puppet.to({ torch: 0 });
        if (this.state !== 'watching' && this.state !== 'petting') return;
        if (!this.hiding) this.puppet.lookAt(null).to({ ...pair('ear', 0), headX: 0, headY: 0, headR: 0 });
    }

    hover(event) {
        const point = this.point(event);
        if (!point) return;
        const reach = this.reach(point);
        if (this.state === 'watching' && Number(this.stage.dataset.step) === 1) {
            if (this.hiding !== 'shut' && reach <= 1) this.hide(point);
            else if (this.hiding === 'shut' && reach > 1.14) this.calmDown();
        }
        if (this.state !== 'petting') return;
        if (reach > 1) {
            this.leave();
            return;
        }
        this.enjoy(point);
        // Every position the browser gathered since the last frame, so speed is measured honestly.
        const samples = event.getCoalescedEvents?.() || [];
        for (const sample of samples.length ? samples : [event]) {
            const at = this.point(sample);
            const result = this.meter.move(at.x, sample.timeStamp);
            if (result === 'startle') return void this.startle();
            if (result === 'stroke') this.stroke(at.x, at.y);
            if (this.state !== 'petting') return;
        }
    }

    leave() {
        this.meter.lift();
        if (this.hiding === 'shut') this.calmDown();
        if (!this.content) return;
        this.content = false;
        this.stage.classList.remove('is-content', 'is-purring');
        if (this.state !== 'petting') return;
        // A cat that has been petted long enough keeps its eyes half closed.
        const eased = this.strokes >= 5 ? 0.34 : 0;
        this.puppet.to({ ...pair('lid', eased), ...pair('flat', 0), happy: eased ? 0.7 : 0, pupil: 0.42, headX: 0, headY: 0, headR: 0, purr: 0, knead: 0, tailAmp: 1, tailLift: 0.2 });
    }

    press() {
        if (this.state === 'story' || this.state === 'reveal') {
            this.skip();
            return;
        }
        if (this.state !== 'watching' || Number(this.stage.dataset.step) !== 0) return;
        // A silhouette answers with one ear.
        const side = (this.hand?.x ?? HEAD.x) < HEAD.x ? -1 : 1;
        this.puppet.flick(side < 0 ? 'L' : 'R', 520).to({ headR: side * 9, headX: side * 5 });
        this.say(null, 'cat.hint_ear');
        clearTimeout(this.earTimer);
        this.earTimer = this.later(() => {
            this.puppet.to({ headR: 0, headX: 0 });
            this.say(null, 'cat.hint_0');
        }, 1900);
    }

    key(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (event.repeat) return;
        if (this.state === 'reveal') {
            this.skip();
            return;
        }
        if (this.state !== 'petting') return;
        const now = performance.now();
        const hurried = now - (this.keyTime ?? -Infinity) < STROKE_PAUSE_MS;
        this.keyTime = now;
        if (hurried) {
            this.startle();
            return;
        }
        const x = HEAD.x + (this.strokes % 2 ? 46 : -46);
        this.enjoy({ x, y: HEAD.y - 70 });
        this.stroke(x, HEAD.y - 70);
        clearTimeout(this.keyTimer);
        this.keyTimer = this.later(() => this.leave(), 1100);
    }

    /* ── Step 1: not yet ────────────────────────────────────────────────── */

    /** The nearer the hand, the warier the cat. */
    approach(point) {
        const near = clamp((2.2 - this.reach(point)) / 1.2, 0, 1);
        this.puppet.to({ ...pair('flat', near * 0.5), ...pair('lid', near * 0.26), pupil: 0.24 + near * 0.6, headY: near * 7, headSX: 1 - near * 0.015, headSY: 1 - near * 0.02, whisk: near * 4 });
    }

    hide(point) {
        const mood = ++this.mood;
        const away = point.x < HEAD.x ? 1 : -1;
        this.hiding = 'shut';
        this.stage.classList.add('is-shy');
        this.say(null, 'cat.hint_shy');
        this.squeeze(away);
        this.puppet.kick({ headY: 150, figSY: -0.7 });
        this.run(async () => {
            for (;;) {
                await this.pause(between(1500, 2300));
                if (mood !== this.mood) return;
                // One eye, only to check whether the hand is still there.
                const side = (this.hand?.x ?? HEAD.x) < HEAD.x ? 'L' : 'R';
                this.say(null, 'cat.hint_peek');
                this.puppet.lookAt(this.hand || point).to({ [`lid${side}`]: 0.4, tense: 0.2, pupil: 0.3, [`flat${side}`]: 0.6, glow: 0.8 });
                await this.pause(820);
                if (mood !== this.mood) return;
                this.say(null, 'cat.hint_shy');
                this.squeeze(away);
                this.puppet.kick({ headY: 70 });
            }
        });
    }

    squeeze(away) {
        this.puppet.to({ ...pair('lid', 1), ...pair('flat', 1), ...pair('ear', -3), tense: 1, wide: 0, glow: 0.2, headX: away * 9, headY: 19, headR: away * 4, headSX: 0.97, headSY: 0.94,
            figSX: 1.014, figSY: 0.965, whisk: 10, tailPuff: 0.4, tailLift: 0, mouth: 0 });
    }

    /** Waits out of the story: never skipped, only dropped with the dialog. */
    pause(ms) {
        return new Promise(resolve => this.later(resolve, ms));
    }

    /** The hand is gone: one eye, then the other. */
    calmDown() {
        const mood = ++this.mood;
        this.hiding = 'calming';
        this.run(async () => {
            const { puppet } = this;
            await this.pause(520);
            if (mood !== this.mood) return;
            const [first, second] = (this.hand?.x ?? 0) < HEAD.x ? ['L', 'R'] : ['R', 'L'];
            if (this.hand) puppet.lookAt(this.hand);
            puppet.to({ [`lid${first}`]: 0.4, tense: 0.2, pupil: 0.3, [`flat${first}`]: 0.4, headY: 10, glow: 0.8 });
            await this.pause(520);
            if (mood !== this.mood) return;
            puppet.to({ [`lid${second}`]: 0.4, [`flat${second}`]: 0.4, tense: 0, headY: 5 });
            await this.pause(380);
            if (mood !== this.mood) return;
            this.hiding = '';
            this.stage.classList.remove('is-shy');
            this.say(null, 'cat.hint_1');
            puppet.to(REST[1]);
            await this.pause(260);
            if (mood === this.mood) puppet.blink();
        });
    }

    /* ── Step 2: petting ────────────────────────────────────────────────── */

    /** The head leans into the hand, and the ear under it folds. */
    enjoy(point) {
        const { puppet } = this;
        if (!this.content) {
            this.content = true;
            this.stage.classList.add('is-content');
        }
        const nx = clamp((point.x - TOUCH.x) / TOUCH.rx, -1, 1);
        const ny = clamp((point.y - TOUCH.y) / TOUCH.ry, -1, 1);
        const fold = x => clamp(1 - Math.hypot(point.x - x, point.y - 128) / 74, 0, 1) * 0.85;
        const lid = [0.3, 0.55, 0.8][this.strokes] ?? 1;
        const trust = this.strokes / STROKES;
        puppet.lookAt(point).to({
            flatL: 0.12 + fold(HEAD.x - 62), flatR: 0.12 + fold(HEAD.x + 62), earL: 0, earR: 0,
            ...pair('lid', lid), happy: 1, tense: 0, wide: 0, smile: 0.45 + trust * 0.55, pupil: 0.5,
            headX: nx * 10, headY: 3 - Math.min(0, ny) * 5, headR: nx * 7,
            purr: clamp((this.strokes - 2) / 5, 0, 1), knead: this.strokes >= 4 ? 1 : 0, tailAmp: 1.2, tailLift: 0.3 + trust * 0.6
        });
        this.stage.classList.toggle('is-purring', this.strokes >= 4);
    }

    warm() {
        this.stage.style.setProperty('--warm', (this.strokes / STROKES).toFixed(3));
        this.stage.dataset.strokes = String(this.strokes);
        this.ink(TRAIL_STEPS - 1 + Math.min(0.96, this.strokes / STROKES));
    }

    stroke(x, y) {
        this.strokes++;
        this.warm();
        this.puppet.kick({ headY: 46, headSY: -0.5, headSX: 0.3 });
        this.ruffle(x, y);
        this.heart(x, y);
        if (this.strokes >= 4) this.purrs();
        const mood = [[1, 'cat.hint_pet_1'], [4, 'cat.hint_pet_2'], [7, 'cat.hint_pet_3']].findLast(([from]) => this.strokes >= from);
        if (this.strokes === mood[0] || this.hint.textContent === this.t('cat.hint_fast')) this.say(null, mood[1]);
        if (this.strokes >= STROKES) this.finish();
    }

    /** Into the box, and after a while back out, eyes first. */
    startle() {
        if (this.state !== 'petting') return;
        const { puppet } = this;
        this.state = 'startled';
        this.content = false;
        this.meter.lift();
        clearTimeout(this.keyTimer);
        this.strokes = Math.max(0, this.strokes - 1);
        this.warm();
        this.stage.classList.remove('is-content', 'is-purring');
        this.stage.classList.add('is-startled');
        this.say(null, 'cat.hint_fast');
        this.run(async () => {
            puppet.lookAt(this.hand || null).to({ ...pair('lid', 0), happy: 0, wide: 1, pupil: 0.05, ...pair('flat', 1), headX: 0, headR: 0, headY: -9, whisk: 9, smile: 0, purr: 0, knead: 0, tailPuff: 1, tailLift: 1, tailAmp: 0.3 });
            await this.pause(130);
            puppet.to({ drop: 128, headY: 0, ...pair('paw', 0) }).kick({ boxR: 50, boxSY: -1.3, flapL: 170, flapR: 150, camX: 46 });
            await this.pause(900);
            puppet.to({ drop: EYES, wide: 0.6, pupil: 0.25, ...pair('flat', 0.7), tailPuff: 0.4 });
            await this.pause(460);
            puppet.to({ glanceX: -7, look: 0 });
            await this.pause(340);
            puppet.to({ glanceX: 7 });
            await this.pause(340);
            puppet.to({ glanceX: 0, wide: 0, ...pair('flat', 0.2) }).blink();
            await this.pause(280);
            if (!this.dialog) return;
            puppet.to({ ...REST[2], pawR: 0 });
            await this.pause(140);
            puppet.to({ pawR: 1 });
            this.stage.classList.remove('is-startled');
            this.state = 'petting';
        });
    }

    async finish() {
        this.state = 'saving';
        clearTimeout(this.keyTimer);
        this.puppet.to({ ...pair('lid', 1), happy: 1, smile: 1, purr: 1, knead: 1, headX: 0, headY: 2, headR: 0, ...pair('flat', 0.15) });
        // The cat has made up its mind: a moment of purring before it shows.
        const moment = this.pause(this.reduced ? 0 : 900);
        let timer;
        try {
            await Promise.race([
                Promise.resolve(this.onPetted()),
                new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('The cat trail was not saved in time')), SAVE_TIMEOUT_MS); })
            ]);
        } catch (error) {
            console.warn('[CatDen] Could not save the last step:', error);
            if (!this.dialog) return;
            this.strokes = STROKES - 3;
            this.warm();
            this.state = 'petting';
            this.content = true;
            this.leave();
            this.say(null, 'cat.save_failed');
            return;
        } finally {
            clearTimeout(timer);
        }
        await moment;
        if (this.dialog) this.run(() => this.reveal());
    }

    /* ── The reveal ─────────────────────────────────────────────────────── */

    /** The frame, made ready while the cat is being petted. */
    async loadParts() {
        const loaded = await Promise.all(FRAME_PARTS.map(async part => {
            const image = new Image();
            image.src = framePartUrl(part.picture || part.name);
            await image.decode();
        })).then(() => true, () => false);
        if (!this.dialog) return;
        // Put together and moved out of sight now, so the turn itself costs nothing.
        const reward = this.buildReward(loaded);
        if (this.reduced) return;
        const held = (element, frame) => {
            const animation = element.animate([frame, frame], { duration: 1000 });
            animation.pause();
            return animation;
        };
        const poses = [
            ...[...reward.querySelectorAll('image')].map(image => held(image, { opacity: 0.6, transform: 'scale(0.7) rotate(24deg)' })),
            held(reward.querySelector('.cat-den__photo'), { clipPath: 'circle(30% at 50% 50%)' }),
            held(reward, { transform: 'translateY(3px) rotate(1deg)' })
        ];
        this.later(() => poses.forEach(animation => animation.cancel()), 600);
    }

    /** The cat says it trusts you and turns into the frame around your photo. */
    async reveal() {
        const { puppet } = this;
        this.state = 'reveal';
        this.skipping = false;
        this.content = false;
        this.dialog.classList.add('is-revealed');
        this.stage.classList.remove('is-content', 'is-purring');
        this.ink(TRAIL_STEPS, true);
        this.say(null, 'cat.hint_slow');
        // A slow blink is how a cat says it.
        puppet.lookAt(null).to({ ...pair('lid', 0), ...pair('flat', 0), happy: 0.45, pupil: 0.8, wide: 0, smile: 0.85, purr: 0.25, knead: 0, tailAmp: 0.8 });
        await this.wait(760);
        puppet.blink({ slow: true, hold: 240 });
        await this.wait(1750);
        // Out of the box, which drops away.
        puppet.to({ ...pair('paw', 0), headSX: 1.04, headSY: 0.92, headY: 10, ...pair('ear', 4), happy: 0, tail: 0 });
        await this.wait(210);
        puppet.setMode('face');
        puppet.to({ headSX: 1.06, headSY: 1.16, headY: 2, ...pair('flat', 0.3), pupil: 1, wide: 0.3, bloom: 0.8, bloomS: 0.8 });
        await this.tween(480, k => puppet.jump({ boxY: 230 * easeIn(k), boxR: -6 * k, boxIn: 1 - clamp((k - 0.5) / 0.5, 0, 1) }));
        puppet.to({ bloom: 1, bloomS: 1.3 });
        await this.wait(190);
        const reward = this.reward ?? this.buildReward(false);
        reward.classList.remove('is-waiting');
        const assembled = this.reduced ? null : this.assemble(reward);
        this.say('cat.done_title', 'cat.done_text');
        this.offer();
        this.wave(0);
        this.wave(170);
        await this.tween(180, k => puppet.jump({ fade: 1 - k }));
        puppet.to({ bloom: 0.16, bloomS: 1.25 });
        await assembled;
        this.state = 'done';
        this.skipping = false;
    }

    /** The buttons, and the focus with them. */
    offer() {
        ['role', 'tabindex', 'aria-label'].forEach(name => this.stage.removeAttribute(name));
        this.actions.inert = false;
        this.actions.querySelector('button').focus({ preventScroll: true });
    }

    buildReward(inParts) {
        const reward = document.createElement('div');
        reward.className = 'cat-den__reward is-waiting';
        const photo = document.createElement('div');
        photo.className = 'cat-den__photo';
        const source = document.getElementById('profilePhotoImg');
        if (source?.getAttribute('src') && source.style.display !== 'none') {
            const image = document.createElement('img');
            image.src = source.src;
            image.alt = '';
            photo.append(image);
        } else {
            photo.textContent = document.getElementById('profileInitials')?.textContent || '';
        }
        reward.append(photo);
        reward.insertAdjacentHTML('beforeend', inParts && !this.reduced
            ? `<svg class="cat-den__frame" viewBox="0 0 120 120" aria-hidden="true">${FRAME_PARTS.map(({ name, picture = name, mirrored, box: [x, y, width, height], root = '50% 50%' }) => {
                const image = `<image data-part="${name}" href="${framePartUrl(picture)}" x="${x}" y="${y}" width="${width}" height="${height}" style="transform-origin:${root}"/>`;
                return mirrored ? `<g transform="translate(120 0) scale(-1 1)">${image}</g>` : image;
            }).join('')}</svg><div class="cat-den__shine"></div>`
            : renderAvatarFrame(CAT_FRAME).replace('class="', 'class="cat-den__frame '));
        this.fx.append(reward);
        this.reward = reward;
        return reward;
    }

    /** Ring, ears and whiskers are the cat's own; the rest is put on one by one. */
    async assemble(reward) {
        const part = name => reward.querySelector(`[data-part="${name}"]`);
        const photo = reward.querySelector('.cat-den__photo');
        const whole = reward.querySelector('.cat-den__frame');
        photo.animate([{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(72% at 50% 50%)' }], { duration: 620, easing: OUT });
        if (!part('ring')) {
            whole.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320 });
            this.burst(320, 200, 34);
            return;
        }
        const pop = (name, delay, from, duration = 620, easing = POP) => part(name).animate([{ ...from }, { opacity: 1, transform: 'none' }], { duration, delay, easing, fill: 'backwards' });
        for (const name of ['ear-left', 'ear-mirror', 'ring']) part(name).animate([{ opacity: 0, transform: 'scale(1.12)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: OUT, fill: 'backwards' });
        // The drawn right ear has no part under the bow: until the bow is on, the left one stands in for it.
        part('ear-right').style.visibility = 'hidden';
        pop('whiskers-left', 120, { opacity: 0, transform: 'scaleX(0.1)' }, 460);
        pop('whiskers-right', 120, { opacity: 0, transform: 'scaleX(0.1)' }, 460);
        const charm = { opacity: 0, transform: 'scale(0) rotate(-70deg)' };
        ['flowers', 'stars', 'heart-big', 'heart-small', 'heart-ear', 'beads'].forEach((name, index) => {
            const delay = 420 + index * 110;
            pop(name, delay, charm);
            this.later(() => this.sparkle(name), delay + 120);
        });
        part('letters').animate([{ clipPath: 'inset(-10% 100% -10% 0)', opacity: 0.4 }, { clipPath: 'inset(-10% 0 -10% 0)', opacity: 1 }], { duration: 900, delay: 1750, easing: 'ease-in-out', fill: 'backwards' });
        // The bow comes down last and ties the whole thing.
        part('bow').animate([
            { opacity: 0, transform: 'translate(10px, -70px) rotate(38deg) scale(1.35)', easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
            { opacity: 1, transform: 'translate(0, 0) rotate(-4deg) scale(1.02, 0.86)', offset: 0.52, easing: OUT },
            { opacity: 1, transform: 'rotate(3deg) scale(0.95, 1.07)', offset: 0.7 },
            { opacity: 1, transform: 'rotate(-1deg) scale(1.02, 0.98)', offset: 0.86 },
            { opacity: 1, transform: 'none' }
        ], { duration: 860, delay: 1150, fill: 'backwards' });
        await this.wait(1150 + 440);
        part('ear-right').style.visibility = '';
        part('ear-mirror').style.visibility = 'hidden';
        reward.animate([{ transform: 'none' }, { transform: 'translateY(5px) rotate(1.6deg)' }, { transform: 'translateY(-2px) rotate(-0.8deg)' }, { transform: 'none' }], { duration: 420, easing: OUT });
        this.puppet.kick({ camY: 110 });
        this.wave(0);
        this.burst(352, 160, 38);
        await this.wait(700);
        reward.querySelector('.cat-den__shine').animate([{ opacity: 0, transform: 'rotate(-60deg)' }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.75 }, { opacity: 0, transform: 'rotate(330deg)' }], { duration: 1300, easing: 'ease-in-out' });
        await this.wait(1300);
        reward.classList.add('is-afloat');
    }

    /* ── Small things ───────────────────────────────────────────────────── */

    /** A shape flying over the scene, placed in units of the drawing. */
    bit(shape, x, y, color, frames, timing) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'cat-den__bit');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.innerHTML = `<path d="${shape}"/>`;
        svg.style.setProperty('--bit', color);
        this.fly(svg, x, y, frames, timing);
    }

    fly(element, x, y, frames, timing) {
        if (this.reduced) return;
        element.style.left = `${x / 6.4}%`;
        element.style.top = `${y / 4}%`;
        this.fx.append(element);
        const animation = element.animate(frames, { fill: 'both', easing: OUT, ...timing });
        animation.finished.then(() => element.remove(), () => element.remove());
    }

    heart(x, y) {
        const count = this.strokes >= 6 ? 2 : 1;
        for (let index = 0; index < count; index++) {
            const drift = between(-46, 46);
            const size = between(0.7, 1.15);
            this.bit(HEART, x + between(-14, 14), y, COLORS[(this.strokes + index) % 3], [
                { opacity: 0, transform: 'translate(0, 4px) scale(0.2)' },
                { opacity: 1, transform: `translate(${drift * 0.3}px, -24px) scale(${size}) rotate(${-drift / 4}deg)`, offset: 0.22 },
                { opacity: 0.9, transform: `translate(${drift * 0.2}px, -62px) scale(${size * 0.96}) rotate(${drift / 4}deg)`, offset: 0.6 },
                { opacity: 0, transform: `translate(${drift}px, -108px) scale(${size * 0.7}) rotate(${drift / 2}deg)` }
            ], { duration: between(1300, 1700), delay: index * 120, easing: 'ease-out' });
        }
    }

    /** Fur lifting under the hand. */
    ruffle(x, y) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'cat-den__ruffle');
        svg.setAttribute('viewBox', '0 0 34 20');
        svg.innerHTML = '<path d="M3 16C7 9 12 6 18 5M14 18C18 12 23 9 29 8M1 8C4 5 8 3 12 2"/>';
        const flip = this.meter.direction < 0 ? 'scaleX(-1) ' : '';
        this.fly(svg, x, Math.max(y, 132), [
            { opacity: 0, transform: `${flip}scale(0.7)` },
            { opacity: 0.75, transform: `${flip}translateX(4px) scale(1)`, offset: 0.3 },
            { opacity: 0, transform: `${flip}translateX(14px) scale(1.08)` }
        ], { duration: 620 });
    }

    purrs() {
        const side = this.strokes % 2 ? 1 : -1;
        const sound = document.createElement('span');
        sound.className = 'cat-den__sound';
        sound.textContent = this.t('cat.purr');
        this.fly(sound, HEAD.x + side * 116 - 14, 150 + between(-12, 26), [
            { opacity: 0, transform: 'translate(0, 6px) rotate(0) scale(0.8)' },
            { opacity: 0.95, transform: `translate(${side * 10}px, -6px) rotate(${side * 6}deg) scale(1)`, offset: 0.25 },
            { opacity: 0, transform: `translate(${side * 34}px, -44px) rotate(${side * 14}deg) scale(1.12)` }
        ], { duration: 1500, easing: 'ease-out' });
    }

    /** Dust from under something that landed at (x, y). */
    dust(x, y, count, side = 0) {
        for (let index = 0; index < count; index++) {
            const puff = document.createElement('div');
            puff.className = 'cat-den__puff';
            const way = side || (index % 2 ? 1 : -1);
            const size = between(0.5, 1);
            this.fly(puff, x + between(-14, 14), y - between(0, 6), [
                { opacity: 0, transform: `scale(${size * 0.4})` },
                { opacity: 0.8, transform: `translate(${way * between(10, 22)}px, ${-between(2, 8)}px) scale(${size})`, offset: 0.2 },
                { opacity: 0, transform: `translate(${way * between(34, 84)}px, ${-between(10, 34)}px) scale(${size * between(1.6, 2.4)})` }
            ], { duration: between(700, 1150), delay: index * 30 });
        }
    }

    /** A ring of light running out from the middle. */
    wave(delay) {
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        ring.setAttribute('class', 'cat-den__ring');
        ring.setAttribute('viewBox', '0 0 100 100');
        ring.innerHTML = RING;
        this.fly(ring, 320, 200, [{ opacity: 0.9, transform: 'scale(0.72)' }, { opacity: 0, transform: 'scale(1.9)' }], { duration: 900, delay });
    }

    sparkle(name) {
        const part = FRAME_PARTS.find(item => item.name === name);
        const reward = this.fx.querySelector('.cat-den__reward');
        if (!part || !reward) return;
        const unit = reward.clientWidth / 78 / this.stage.clientWidth * 640;
        const [x, y, width, height] = part.box;
        for (let index = 0; index < 3; index++) {
            const angle = between(0, Math.PI * 2);
            this.bit(SPARK, 320 + (x + width / 2 - 60) * unit, 200 + (y + height / 2 - 60) * unit, '#fff', [
                { opacity: 0, transform: 'scale(0.1)' },
                { opacity: 1, transform: `translate(${Math.cos(angle) * 16}px, ${Math.sin(angle) * 16}px) scale(0.8) rotate(40deg)`, offset: 0.35 },
                { opacity: 0, transform: `translate(${Math.cos(angle) * 34}px, ${Math.sin(angle) * 34}px) scale(0.1) rotate(120deg)` }
            ], { duration: between(520, 760) });
        }
    }

    burst(x, y, count) {
        const { width, height } = this.stage.getBoundingClientRect();
        const shapes = [HEART, STAR, HEART, SPARK];
        for (let index = 0; index < count; index++) {
            const angle = index * 2.399963;
            const reach = between(0.2, 0.5) * width;
            const dx = Math.cos(angle) * reach;
            const dy = Math.sin(angle) * reach * 0.58 - height * 0.06;
            const spin = between(-200, 200);
            const size = between(0.4, 1.2);
            this.bit(shapes[index % shapes.length], x, y, COLORS[index % COLORS.length], [
                { opacity: 0, transform: 'translate(0, 0) scale(0.1)' },
                { opacity: 1, transform: `translate(${dx * 0.82}px, ${dy * 0.82}px) scale(${size}) rotate(${spin * 0.5}deg)`, offset: 0.24 },
                { opacity: 1, transform: `translate(${dx}px, ${dy + height * 0.06}px) scale(${size}) rotate(${spin * 0.8}deg)`, offset: 0.6 },
                { opacity: 0, transform: `translate(${dx * 1.04}px, ${dy + height * 0.26}px) scale(${size * 0.7}) rotate(${spin}deg)` }
            ], { duration: between(1900, 3000), delay: between(0, 120), easing: 'cubic-bezier(0.15, 0.7, 0.35, 1)' });
        }
    }
}
