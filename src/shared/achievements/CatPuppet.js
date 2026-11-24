/**
 * Brings the drawing of CatDenArt to life. Every movable value is a spring, so a
 * pose is only a set of targets: whatever the cat was doing, it moves on from
 * there. The eyelids are paths drawn between shapes, the pupils follow a point,
 * and breathing, the tail and purring run on a clock while the puppet is `alive`.
 * Without motion (`still`) values go straight to their targets.
 */
import { EYE, HEAD, boxTail, eyePaths, floorTail, mouthPath } from './CatDenArt.js';

/** The figure turns and stretches around the point where the cat sits. */
const SEAT = { x: 320, y: 378 };
const EAR_ROOT = '-54 -60';

/** [rest value, stiffness, damping ratio]; stiff is quick, a ratio below 1 overshoots. */
const SPRINGS = {
    // Where the cat looks: a point and how much attention it gets, or a glance straight ahead.
    lookX: [HEAD.x, 260, 1], lookY: [HEAD.y, 260, 1], look: [0, 90, 1], glanceX: [0, 420, 0.9], glanceY: [0, 420, 0.9],
    headX: [0, 60, 0.75], headY: [0, 70, 0.72], headR: [0, 52, 0.7], headSX: [1, 110, 0.6], headSY: [1, 110, 0.6],
    earL: [0, 190, 0.5], earR: [0, 190, 0.5], flatL: [0, 150, 0.62], flatR: [0, 150, 0.62],
    lidL: [0, 260, 0.95], lidR: [0, 260, 0.95], blink: [0, 1500, 1], happy: [0, 120, 1], tense: [0, 260, 1], wide: [0, 260, 0.6], pupil: [0.2, 46, 1],
    glow: [0, 60, 1], smile: [0, 110, 0.9], mouth: [0, 200, 0.8], whisk: [0, 130, 0.5],
    // The whole figure, and how far it has sunk into the box.
    figX: [0, 90, 0.8], figY: [0, 120, 0.7], figR: [0, 90, 0.6], figSX: [1, 160, 0.5], figSY: [1, 160, 0.5], drop: [0, 74, 0.66],
    pawL: [0, 240, 0.6], pawR: [0, 240, 0.6], knead: [0, 50, 1], purr: [0, 40, 1],
    tailLift: [0, 50, 0.6], tailPuff: [0, 130, 0.6], tailAmp: [1, 30, 1], tail: [1, 160, 1],
    boxX: [0, 120, 0.8], boxY: [0, 200, 0.5], boxR: [0, 190, 0.28], boxSX: [1, 260, 0.35], boxSY: [1, 260, 0.35], flapL: [0, 150, 0.2], flapR: [0, 150, 0.2],
    boxIn: [0, 60, 1], shadow: [1, 60, 1],
    torchX: [HEAD.x, 120, 1], torchY: [HEAD.y, 120, 1], torch: [0, 50, 1],
    bloom: [0, 60, 1], bloomS: [0.4, 60, 0.9], fade: [1, 60, 1],
    camX: [0, 420, 0.3], camY: [0, 420, 0.3]
};
const NAMES = Object.keys(SPRINGS);
/** The parts of the drawing it moves. */
export const PARTS = ['camera', 'torch', 'shadow', 'box-shadow', 'box-back', 'box-front', 'flap-l', 'flap-r', 'cut', 'figure', 'torso', 'head', 'purr', 'ear-l', 'ear-r',
    'glow-l', 'glow-r', 'clip-l', 'clip-r', 'iris-l', 'iris-r', 'pupil-l', 'pupil-r', 'shine-l', 'shine-r', 'lower-l', 'lower-r', 'lash-l', 'lash-r', 'eye-l', 'eye-r',
    'mouth', 'whisker-l', 'whisker-r', 'paws', 'paw-l', 'paw-r', 'tail-floor', 'tail-floor-edge', 'tail-box', 'tail-box-edge', 'bloom'];
const n = value => Math.round(value * 100) / 100;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const between = (low, high) => low + Math.random() * (high - low);

export class CatPuppet {
    /**
     * @param {Element} scene - renderCat() markup in the document
     * @param {{still?: boolean, alive?: boolean}} [options] - still: no motion at all;
     *   alive: false lets the clock sleep whenever every spring has settled
     */
    constructor(scene, { still = false, alive = true } = {}) {
        this.still = still;
        this.alive = alive && !still;
        this.part = Object.fromEntries(PARTS.map(name => [name, scene.querySelector(`[data-cat="${name}"]`)]));
        this.value = {};
        this.target = {};
        this.speed = {};
        this.spring = {};
        NAMES.forEach(name => {
            const [rest, stiffness, ratio] = SPRINGS[name];
            this.value[name] = this.target[name] = rest;
            this.speed[name] = 0;
            this.spring[name] = [stiffness, 2 * ratio * Math.sqrt(stiffness)];
        });
        this.drawn = new Map();
        this.time = Math.random() * 10;
        this.tailPhase = 0;
        this.tailRate = 1.5;
        this.timers = new Set();
        this.setMode('sit');
        this.wake();
    }

    /**
     * 'sit': on the floor; 'front': the same, before the box; 'leap': all of the cat,
     * as far as it is above the rim; 'box': only the head, above the rim; 'face': only
     * the head, all of it.
     */
    setMode(mode) {
        this.mode = mode;
        const { cut, 'box-front': front } = this.part;
        if (mode === 'front') front.after(cut);
        else if (cut.nextElementSibling !== front) front.before(cut);
        this.attr('cut', 'clip-path', mode === 'leap' || mode === 'box' ? cut.dataset.clip : 'none');
        this.attr('torso', 'display', mode === 'box' || mode === 'face' ? 'none' : 'inline');
        for (const part of ['tail-box', 'tail-box-edge']) this.attr(part, 'display', mode === 'box' || mode === 'face' ? 'inline' : 'none');
        this.wake();
    }

    /** New targets; the cat moves there by itself. */
    to(targets) {
        Object.assign(this.target, targets);
        if (this.still) this.jump(targets);
        this.wake();
        return this;
    }

    /** New values at once, without moving there. */
    jump(values) {
        Object.assign(this.target, values);
        Object.assign(this.value, values);
        Object.keys(values).forEach(name => { this.speed[name] = 0; });
        this.wake();
        return this;
    }

    /** A push: the spring answers and comes back. */
    kick(pushes) {
        if (!this.still) Object.entries(pushes).forEach(([name, speed]) => { this.speed[name] += speed; });
        this.wake();
        return this;
    }

    /** Looks at a point of the scene, or straight ahead. */
    lookAt(point) {
        if (point) this.to({ lookX: point.x, lookY: point.y, look: 1, glanceX: 0, glanceY: 0 });
        else this.to({ look: 0 });
        return this;
    }

    /** One blink; a slow one is how a cat says it trusts you. */
    blink({ hold = 60, slow = false } = {}) {
        if (this.still) return this;
        this.spring.blink = slow ? [70, 2 * Math.sqrt(70)] : [1500, 2 * Math.sqrt(1500)];
        this.to({ blink: 1 });
        this.after(slow ? 620 + hold : 70 + hold, () => this.to({ blink: 0 }));
        return this;
    }

    flick(side = Math.random() < 0.5 ? 'L' : 'R', force = 340) {
        return this.kick({ [`ear${side}`]: -force });
    }

    /** Small habits: blinks, glances and ear flicks, until dispose(). `when()` can hold them back. */
    live(when = () => true) {
        if (this.still) return;
        const habit = (low, high, act) => {
            const next = () => this.after(between(low, high), () => {
                if (when()) act();
                next();
            });
            next();
        };
        habit(2300, 5600, () => {
            this.blink();
            if (Math.random() < 0.18) this.after(240, () => when() && this.blink());
        });
        habit(2600, 6200, () => this.flick());
        habit(1500, 3800, () => {
            if (this.target.look > 0) return;
            const away = Math.random() < 0.6;
            this.to({ glanceX: away ? between(-7, 7) : 0, glanceY: away ? between(-3, 3) : 0 });
        });
    }

    after(ms, work) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            work();
        }, ms);
        this.timers.add(timer);
    }

    wake() {
        if (this.frame || this.disposed) return;
        if (this.still) {
            this.draw();
            return;
        }
        this.last = null;
        this.frame = requestAnimationFrame(now => this.tick(now));
    }

    tick(now) {
        const dt = Math.min(0.034, this.last === null ? 0.016 : (now - this.last) / 1000);
        this.last = now;
        this.time += dt;
        let moving = this.alive;
        for (const name of NAMES) {
            const target = this.target[name];
            if (this.value[name] === target && this.speed[name] === 0) continue;
            const [stiffness, damping] = this.spring[name];
            // Two half steps keep the stiffest springs steady on a slow frame.
            for (let half = 0; half < 2; half++) {
                this.speed[name] += (stiffness * (target - this.value[name]) - damping * this.speed[name]) * dt / 2;
                this.value[name] += this.speed[name] * dt / 2;
            }
            if (Math.abs(target - this.value[name]) < 0.0015 && Math.abs(this.speed[name]) < 0.01) {
                this.value[name] = target;
                this.speed[name] = 0;
            } else moving = true;
        }
        this.draw(dt);
        this.frame = moving ? requestAnimationFrame(next => this.tick(next)) : 0;
    }

    attr(part, name, value) {
        const key = part + name;
        if (this.drawn.get(key) === value) return;
        this.drawn.set(key, value);
        this.part[part]?.setAttribute(name, value);
    }

    draw(dt = 0) {
        const v = this.value;
        const t = this.time;
        const breath = this.alive ? Math.sin(t * 1.7) : 0;
        const purr = v.purr > 0.02 && this.alive ? v.purr : 0;
        const shake = v.camX || v.camY ? `translate(${n(v.camX / 6.4)}%, ${n(v.camY / 4)}%)` : '';
        if (this.drawn.get('shake') !== shake) {
            this.drawn.set('shake', shake);
            this.part.camera.style.transform = shake;
        }
        this.attr('torch', 'transform', `translate(${n(v.torchX)} ${n(v.torchY)})`);
        this.attr('torch', 'opacity', n(clamp(v.torch, 0, 1)));
        this.attr('bloom', 'opacity', n(clamp(v.bloom, 0, 1)));
        this.attr('bloom', 'transform', `translate(320 200) scale(${n(Math.max(0, v.bloomS))}) translate(-320 -200)`);

        // The figure.
        this.attr('figure', 'transform', `translate(${n(SEAT.x + v.figX)} ${n(SEAT.y + v.figY)}) rotate(${n(v.figR)}) scale(${n(v.figSX * (1 - breath * 0.002))} ${n(v.figSY * (1 + breath * 0.005))}) translate(${-SEAT.x} ${-SEAT.y})`);
        this.attr('figure', 'opacity', n(clamp(v.fade, 0, 1)));
        this.attr('shadow', 'opacity', n(this.mode === 'sit' || this.mode === 'front' ? clamp(v.shadow + v.figY / 160, 0.2, 1) : 0));
        this.attr('shadow', 'transform', `translate(${n(v.figX)} 0)`);
        this.attr('head', 'transform', `translate(${n(HEAD.x + v.headX)} ${n(HEAD.y + v.headY + v.drop + breath * 1.3)}) rotate(${n(v.headR)}) scale(${n(v.headSX)} ${n(v.headSY)})`);
        this.attr('purr', 'transform', purr ? `translate(${n((Math.random() - 0.5) * 1.5 * purr)} ${n((Math.random() - 0.5) * 1.1 * purr)})` : 'translate(0 0)');
        for (const [side, name] of [['l', 'L'], ['r', 'R']]) {
            const flat = clamp(v[`flat${name}`], -0.4, 1.2);
            this.attr(`ear-${side}`, 'transform', `rotate(${n(v[`ear${name}`] - flat * 34)} ${EAR_ROOT}) translate(${EAR_ROOT}) scale(${n(1 + flat * 0.04)} ${n(1 - flat * 0.34)}) translate(54 60)`);
            this.attr(`whisker-${side}`, 'transform', `rotate(${n(v.whisk + breath * 0.8)} 50 42)`);
        }
        this.drawEyes();
        this.attr('mouth', 'd', mouthPath({ smile: clamp(v.smile, -0.3, 1.2), open: clamp(v.mouth, 0, 1) }));

        // The tail: a slow S, quicker and wider when the cat is stirred.
        this.tailPhase += dt * this.tailRate;
        const sway = (Math.sin(this.tailPhase) + Math.sin(this.tailPhase * 2.1) * 0.22) * v.tailAmp;
        const boxed = this.mode === 'box' || this.mode === 'face';
        const tail = boxed ? 'tail-box' : 'tail-floor';
        const path = (boxed ? boxTail : floorTail)({ sway, lift: v.tailLift });
        const width = (boxed ? 20 : 22) + v.tailPuff * 13;
        for (const [part, extra] of [[tail, 0], [`${tail}-edge`, 4]]) {
            this.attr(part, 'd', path);
            this.attr(part, 'stroke-width', n(width + extra));
            this.attr(part, 'opacity', n(clamp(v.tail, 0, 1)));
        }

        this.drawBox(purr, t);
    }

    drawEyes() {
        const v = this.value;
        // The eyes are small next to the head's turn, so its slope can be ignored here.
        const headX = HEAD.x + v.headX + v.figX;
        const headY = HEAD.y + v.headY + v.drop + v.figY;
        for (const [side, name, sign] of [['l', 'L', -1], ['r', 'R', 1]]) {
            const lid = clamp(Math.max(v[`lid${name}`], v.blink), 0, 1);
            const shape = eyePaths({ lid, happy: clamp(v.happy, 0, 1), tense: clamp(v.tense, 0, 1), wide: clamp(v.wide, 0, 1.2) });
            this.attr(`clip-${side}`, 'd', shape.outline);
            this.attr(`lash-${side}`, 'd', shape.lash);
            this.attr(`lower-${side}`, 'd', shape.lower);
            this.attr(`lash-${side}`, 'stroke-width', n(4.6 - lid * 0.2));
            const dx = v.lookX - (headX + sign * EYE.x);
            const dy = v.lookY - (headY + EYE.y);
            const far = Math.hypot(dx, dy) || 1;
            const reach = clamp(far / 74, 0, 1) * clamp(v.look, 0, 1);
            const x = dx / far * 9 * reach + v.glanceX;
            const y = dy / far * 7 * reach + v.glanceY;
            const pupil = clamp(v.pupil, 0, 1);
            this.attr(`iris-${side}`, 'transform', `translate(${n(x * 0.8)} ${n(y * 0.8)})`);
            this.attr(`pupil-${side}`, 'transform', `translate(${n(x)} ${n(y)})`);
            this.attr(`pupil-${side}`, 'rx', n(4.4 + pupil * 11));
            this.attr(`pupil-${side}`, 'ry', n(18.5 - pupil * 1.5));
            this.attr(`shine-${side}`, 'transform', `translate(${n(x * 0.35)} ${n(y * 0.35)}) scale(${n(1 + pupil * 0.18)})`);
            this.attr(`glow-${side}`, 'opacity', n(clamp(v.glow, 0, 1) * (1 - lid)));
            // A lash only catches the light once the lids have met.
            const met = n(lid ** 6);
            if (this.drawn.get(side) !== met) {
                this.drawn.set(side, met);
                this.part[`eye-${side}`].style.setProperty('--lid', met);
            }
        }
    }

    drawBox(purr, t) {
        const v = this.value;
        const shown = clamp(v.boxIn, 0, 1);
        const shiver = purr ? (Math.random() - 0.5) * 0.5 * purr : 0;
        const box = `translate(${n(SEAT.x + v.boxX + shiver)} ${n(SEAT.y + v.boxY)}) rotate(${n(v.boxR)}) scale(${n(v.boxSX)} ${n(v.boxSY)}) translate(${-SEAT.x} ${-SEAT.y})`;
        for (const part of ['box-back', 'box-front']) {
            this.attr(part, 'transform', box);
            this.attr(part, 'display', shown > 0.01 ? 'inline' : 'none');
            this.attr(part, 'opacity', n(shown));
        }
        this.attr('box-shadow', 'opacity', n(shown * clamp(1 + v.boxY / 300, 0, 1)));
        this.attr('box-shadow', 'transform', `translate(${n(v.boxX)} 0)`);
        this.attr('flap-l', 'transform', `rotate(${n(v.flapL)} 195 264)`);
        this.attr('flap-r', 'transform', `rotate(${n(-v.flapR)} 445 264)`);
        // The paws hold the rim, so they go where the box goes.
        this.attr('paws', 'transform', box);
        const tread = this.alive ? v.knead : 0;
        for (const [side, name, phase] of [['l', 'L', 0], ['r', 'R', Math.PI]]) {
            const show = clamp(v[`paw${name}`], 0, 1.15);
            const lift = tread * (0.5 + Math.sin(t * 6.4 + phase) * 0.5) * 6;
            this.attr(`paw-${side}`, 'display', show > 0.04 ? 'inline' : 'none');
            this.attr(`paw-${side}`, 'transform', `translate(0 ${n(2 - lift - (1 - Math.min(1, show)) * 5)}) scale(${n(0.86 + Math.min(1, show) * 0.14 + lift * 0.008)} ${n(Math.max(0.04, show))}) translate(0 -2)`);
        }
    }

    dispose() {
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.timers.forEach(clearTimeout);
        this.timers.clear();
    }
}
