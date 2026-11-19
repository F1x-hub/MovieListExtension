// Salvo (Залп), core: constants, math helpers, seeded RNG, value noise, input, synthesized audio.
// Every engine module adds itself to this one namespace; the page imports them in order.
export const Z = {};

Z.K = {
    W: 2400, H: 1200,          // world size in units (1 unit = 1 terrain texel)
    STEP: 1 / 120,             // fixed physics step
    G: 560,                    // gravity, units/s^2
    MAX_V: 950,                // launch speed at full power
    WIND_MAX: 150,             // wind acceleration at 100%
    UNIT_R: 9,                 // fighter collision radius
    WALK: 58,                  // walk speed
    CLIMB: 7,                  // max step height while walking
    TURN_TIME: 45,
    RETREAT_TIME: 5,
    FALL_SAFE: 440,            // impact speed that starts hurting
    CHARGE_TIME: 1.5,          // seconds from zero to full power
};

Z.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
Z.lerp = (a, b, t) => a + (b - a) * t;
Z.smooth = (e0, e1, x) => { const t = Z.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
Z.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
Z.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
Z.randInt = (a, b) => Math.floor(Z.rand(a, b + 1));
Z.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
Z.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
// seeded variants: everything that changes play draws from a seeded source so every computer agrees
Z.shuffleWith = (arr, rand) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
Z.gaussWith = (rand) => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
Z.gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
Z.hex = (h, a = 1) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a]; };
Z.mix3 = (a, b, t) => [Z.lerp(a[0], b[0], t), Z.lerp(a[1], b[1], t), Z.lerp(a[2], b[2], t), a[3] === undefined ? 1 : Z.lerp(a[3], b[3] ?? 1, t)];

Z.rng = function (seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

Z.makeNoise = function (seed) {
    const rnd = Z.rng(seed);
    const V = new Float32Array(256);
    const P = new Uint8Array(512);
    const perm = [];
    for (let i = 0; i < 256; i++) { V[i] = rnd(); perm.push(i); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
    const fade = (t) => t * t * (3 - 2 * t);
    function n1(x) {
        const xi = Math.floor(x), xf = x - xi, u = fade(xf);
        const a = V[P[xi & 255]], b = V[P[(xi + 1) & 255]];
        return a + (b - a) * u;
    }
    function n2(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi, u = fade(xf), v = fade(yf);
        const X = xi & 255, Y = yi & 255;
        const a = V[P[X + P[Y]]], b = V[P[X + 1 + P[Y]]];
        const c = V[P[X + P[Y + 1]]], d = V[P[X + 1 + P[Y + 1]]];
        const top = a + (b - a) * u, bot = c + (d - c) * u;
        return top + (bot - top) * v;
    }
    function fbm1(x, oct = 4) {
        let s = 0, amp = 0.5, f = 1, norm = 0;
        for (let i = 0; i < oct; i++) { s += amp * n1(x * f + i * 17.3); norm += amp; amp *= 0.5; f *= 2.03; }
        return s / norm;
    }
    function fbm2(x, y, oct = 4) {
        let s = 0, amp = 0.5, f = 1, norm = 0;
        for (let i = 0; i < oct; i++) { s += amp * n2(x * f + i * 31.7, y * f - i * 11.1); norm += amp; amp *= 0.5; f *= 2.01; }
        return s / norm;
    }
    return { n1, n2, fbm1, fbm2 };
};

// ---------------------------------------------------------------- input
Z.input = {
    down: new Set(), hit: new Set(), up: new Set(), capture: false,
    alias: {
        KeyA: 'ArrowLeft', KeyD: 'ArrowRight', KeyW: 'ArrowUp', KeyS: 'ArrowDown', KeyQ: 'Tab',
        Numpad1: 'Digit1', Numpad2: 'Digit2', Numpad3: 'Digit3', Numpad4: 'Digit4', Numpad5: 'Digit5',
        NumpadEnter: 'Enter',
    },
    gameKeys: new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Backspace', 'Tab']),
    // `pending` keeps a press until a simulation tick takes it, so a tap shorter than a tick still counts
    pending: new Set(),
    press(code) { if (!this.down.has(code)) { this.down.add(code); this.hit.add(code); this.pending.add(code); } },
    release(code) { if (this.down.has(code)) { this.down.delete(code); this.up.add(code); } },
    isDown(code) { return this.down.has(code); },
    wasHit(code) { return this.hit.has(code); },
    wasUp(code) { return this.up.has(code); },
    take(code) { return this.pending.delete(code); },
    endFrame() { this.hit.clear(); this.up.clear(); },
    clear() { this.down.clear(); this.hit.clear(); this.up.clear(); this.pending.clear(); },
    init() {
        const norm = (e) => this.alias[e.code] || e.code;
        window.addEventListener('keydown', (e) => {
            const code = norm(e);
            if (this.capture && (this.gameKeys.has(code) || code.startsWith('Digit'))) e.preventDefault();
            if (e.repeat) return;
            this.press(code);
        });
        window.addEventListener('keyup', (e) => this.release(norm(e)));
        window.addEventListener('blur', () => this.clear());
        document.querySelectorAll('[data-key]').forEach((el) => {
            const key = el.dataset.key;
            const on = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); el.classList.add('on'); this.press(key); Z.audio.init(); };
            const off = () => { el.classList.remove('on'); this.release(key); };
            el.addEventListener('pointerdown', on);
            el.addEventListener('pointerup', off);
            el.addEventListener('pointercancel', off);
            el.addEventListener('lostpointercapture', off);
            el.addEventListener('contextmenu', (e) => e.preventDefault());
        });
    },
};

// ---------------------------------------------------------------- audio (all synthesized)
Z.audio = {
    ctx: null, master: null, muted: false, noise: null, planeNode: null,
    init() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
        try {
            const ctx = new AudioContext();
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -14; comp.ratio.value = 4;
            comp.connect(ctx.destination);
            this.master = ctx.createGain();
            this.master.gain.value = this.muted ? 0 : 0.5;
            this.master.connect(comp);
            const len = ctx.sampleRate * 2;
            this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
            const d = this.noise.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            this.ctx = ctx;
        } catch { this.ctx = null; }
    },
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05); },
    env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); },
    noiseSrc(t, dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05); return s; },
    tone(type, f0, f1, t, dur, peak, a = 0.005) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
        this.env(g, t, a, peak, dur); o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + a + 0.05);
    },
    hiss(t, dur, type, f0, f1, peak, q = 1, a = 0.005) {
        const s = this.noiseSrc(t, dur + a), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
        f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        this.env(g, t, a, peak, dur); s.connect(f).connect(g).connect(this.master);
    },
    play(name, k = 1) {
        if (!this.ctx || this.muted) return;
        const t = this.ctx.currentTime + 0.01;
        switch (name) {
            case 'boom': {
                const s = Z.clamp(k, 0.3, 1.6);
                this.hiss(t, 0.5 + 0.5 * s, 'lowpass', 1400 * s + 300, 90, 0.9 * Math.min(1, 0.5 + s * 0.6), 0.7);
                this.tone('sine', 95, 32, t, 0.45 + 0.25 * s, 0.9 * Math.min(1, s + 0.3));
                this.hiss(t, 0.12, 'highpass', 2500, 1200, 0.25 * s);
                break;
            }
            case 'launch': this.hiss(t, 0.45, 'bandpass', 500, 2600, 0.45, 2, 0.02); this.tone('sawtooth', 120, 60, t, 0.2, 0.08); break;
            case 'throw': this.hiss(t, 0.16, 'bandpass', 900, 1800, 0.25, 1.5, 0.02); break;
            case 'bounce': this.tone('triangle', 260 * k, 130 * k, t, 0.07, 0.22); break;
            case 'shot': this.hiss(t, 0.18, 'highpass', 900, 500, 0.8); this.tone('square', 140, 50, t, 0.08, 0.25); break;
            case 'jump': this.tone('square', 280, 620, t, 0.12, 0.07); break;
            case 'land': this.hiss(t, 0.08, 'lowpass', 700, 200, 0.18); break;
            case 'splash': this.hiss(t, 0.7, 'lowpass', 2400, 300, 0.5, 0.8, 0.01); this.hiss(t + 0.05, 0.35, 'bandpass', 3000, 1200, 0.18, 1.2); break;
            case 'turn': this.tone('sine', 660, 660, t, 0.13, 0.14); this.tone('sine', 990, 990, t + 0.12, 0.2, 0.14); break;
            case 'pickup': [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.07, 0.16, 0.14)); break;
            case 'tick': this.tone('sine', 1300, 1300, t, 0.04, 0.09); break;
            case 'hit': this.tone('sine', 210, 80, t, 0.18, 0.6); this.hiss(t, 0.06, 'bandpass', 1500, 800, 0.4, 1.5); break;
            case 'swing': this.hiss(t, 0.18, 'bandpass', 700, 2200, 0.22, 2, 0.04); break;
            case 'teleport': this.tone('sine', 300, 1600, t, 0.4, 0.14, 0.02); this.tone('triangle', 450, 2400, t + 0.05, 0.35, 0.07, 0.02); break;
            case 'fuse': this.hiss(t, 0.04, 'highpass', 4000, 4000, 0.05); break;
            case 'beep': this.tone('square', 1046, 1046, t, 0.06, 0.08); break;
            case 'click': this.tone('sine', 900, 900, t, 0.03, 0.08); break;
            case 'drown': this.tone('sine', 500, 90, t, 0.6, 0.15, 0.02); break;
            case 'win': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.12, 0.28, 0.16)); break;
            case 'plane': {
                const o = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
                o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(95, t + 1.2); o.frequency.linearRampToValueAtTime(60, t + 2.6);
                f.type = 'lowpass'; f.frequency.value = 600;
                g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 1); g.gain.linearRampToValueAtTime(0.0001, t + 2.6);
                o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 2.7);
                break;
            }
        }
    },
};
