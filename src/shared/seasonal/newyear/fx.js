/**
 * New Year season: the page-wide live layer.
 *
 * One animation loop drives the aurora, snow that lands on posters and gets
 * shaken off, the forest's parallax, Santa's flight, the logo's clap and, when the
 * Home sign asks for them, fireworks and the sparkler. The sign registers its own
 * drawing as a ticker, so there is never a second loop.
 *
 * The loop stops while the tab is hidden, while the player is open or a page is
 * fullscreen. Under reduced motion it draws one still frame and nothing moves.
 */
(function (g) {
    'use strict';

    const A = g.NyArt;
    const TAU = Math.PI * 2;
    const { sprite, dot: dotSprite, glow: glowSprite, core: coreSprite, glint: glintSprite } = A.sprites;

    const bokehSprite = c => sprite(64, (x, s) => {
        const gr = x.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s / 2);
        gr.addColorStop(0, 'rgba(' + c + ',0.9)');
        gr.addColorStop(0.5, 'rgba(' + c + ',0.6)');
        gr.addColorStop(1, 'rgba(' + c + ',0)');
        x.fillStyle = gr;
        x.fillRect(0, 0, s, s);
    });

    function crystalPath(x, s) {
        const R = s * 0.46, m = s / 2;
        x.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3, ux = Math.cos(a), uy = Math.sin(a);
            x.moveTo(m, m);
            x.lineTo(m + ux * R, m + uy * R);
            [[0.32, 0.22], [0.56, 0.27], [0.78, 0.16]].forEach(p => {
                const bx = m + ux * R * p[0], by = m + uy * R * p[0];
                [1, -1].forEach(d => {
                    const b = a + d * Math.PI / 3;
                    x.moveTo(bx, by);
                    x.lineTo(bx + Math.cos(b) * R * p[1], by + Math.sin(b) * R * p[1]);
                });
            });
        }
        x.stroke();
    }

    const crystalSprite = c => sprite(96, (x, s) => {
        x.lineCap = 'round';
        x.strokeStyle = 'rgba(' + c + ',0.28)';
        x.lineWidth = 6;
        crystalPath(x, s);
        x.strokeStyle = 'rgba(' + c + ',1)';
        x.lineWidth = 2.4;
        crystalPath(x, s);
    });

    /* ---------- Aurora: low-resolution curtains, upscaled by the browser ---------- */

    function Aurora(canvas, o) {
        const w = o.w, h = o.h;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, h), d = img.data;
        const R = A.rng(o.seed || 5);
        const table = new Float32Array(2048);
        for (let i = 0; i < 2048; i++) table[i] = R();
        const noise = x => {
            const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = table[i & 2047];
            return a + (table[(i + 1) & 2047] - a) * u;
        };
        const fbm = x => noise(x) * 0.58 + noise(x * 2.13 + 11.3) * 0.29 + noise(x * 4.37 + 37.1) * 0.13;
        const cur = o.curtains.map(c => {
            const fall = new Float32Array(h * 2), tone = new Float32Array(h * 2);
            const tail = h * c.tail, sharp = h * c.sharp;
            for (let i = 0; i < h * 2; i++) {
                const dd = i - h;
                fall[i] = dd > 0 ? Math.exp(-(dd * dd) / (2 * sharp * sharp)) : Math.exp(dd / tail);
                tone[i] = Math.min(1, Math.max(0, -dd / (tail * 1.15)));
            }
            return Object.assign({}, c, { fall, tone, base: new Float32Array(w), amp: new Float32Array(w) });
        });
        const RR = new Float32Array(w * h), GG = new Float32Array(w * h), BB = new Float32Array(w * h);
        const alpha = o.alpha == null ? 1 : o.alpha;

        return function frame(t) {
            RR.fill(0); GG.fill(0); BB.fill(0);
            for (let n = 0; n < cur.length; n++) {
                const c = cur[n];
                for (let x = 0; x < w; x++) {
                    const u = x / w;
                    c.base[x] = h * (c.y + c.wave * (fbm(u * c.f + t * c.s + c.o) - 0.5) * 2);
                    const ray = 0.55 + fbm(u * c.rf + t * c.rs + c.o * 3) * 0.9;
                    const sweep = fbm(u * 1.3 - t * c.ss + c.o * 2);
                    c.amp[x] = ray * (0.1 + sweep * sweep * sweep * 3.2) * c.gain;
                }
                const lo = c.low, hi = c.high;
                for (let y = 0; y < h; y++) {
                    const row = y * w;
                    for (let x = 0; x < w; x++) {
                        const idx = (y - c.base[x] | 0) + h;
                        if (idx < 0 || idx >= h * 2) continue;
                        const v = c.fall[idx] * c.amp[x];
                        if (v < 0.004) continue;
                        const m = c.tone[idx], p = row + x;
                        RR[p] += v * (lo[0] + (hi[0] - lo[0]) * m);
                        GG[p] += v * (lo[1] + (hi[1] - lo[1]) * m);
                        BB[p] += v * (lo[2] + (hi[2] - lo[2]) * m);
                    }
                }
            }
            for (let p = 0, q = 0; p < w * h; p++, q += 4) {
                const r = RR[p], gr = GG[p], b = BB[p];
                const m = r > gr ? (r > b ? r : b) : (gr > b ? gr : b);
                if (m < 0.003) { d[q + 3] = 0; continue; }
                d[q] = r / m * 255;
                d[q + 1] = gr / m * 255;
                d[q + 2] = b / m * 255;
                d[q + 3] = (m > 1 ? 1 : m) * 255 * alpha;
            }
            ctx.putImageData(img, 0, 0);
        };
    }

    const AURORA_DARK = [
        { y: 0.62, wave: 0.26, f: 2.1, s: 0.035, o: 0.3, rf: 22, rs: 0.07, ss: 0.02, tail: 0.34, sharp: 0.05, gain: 0.72, low: [0.22, 0.95, 0.66], high: [0.22, 0.4, 0.95] },
        { y: 0.4, wave: 0.24, f: 1.5, s: -0.025, o: 2.1, rf: 16, rs: -0.055, ss: 0.016, tail: 0.34, sharp: 0.055, gain: 0.54, low: [0.26, 0.78, 0.92], high: [0.62, 0.26, 0.92] },
        { y: 0.78, wave: 0.14, f: 3.1, s: 0.05, o: 4.7, rf: 30, rs: 0.1, ss: 0.03, tail: 0.2, sharp: 0.035, gain: 0.34, low: [0.4, 0.95, 0.74], high: [0.16, 0.6, 0.8] }
    ];
    const AURORA_LIGHT = [
        { y: 0.74, wave: 0.1, f: 1.5, s: 0.03, o: 0.3, rf: 15, rs: 0.05, ss: 0.018, tail: 0.6, sharp: 0.12, gain: 0.5, low: [0.45, 0.72, 1], high: [0.72, 0.62, 1] },
        { y: 0.5, wave: 0.14, f: 1.1, s: -0.02, o: 2.1, rf: 11, rs: -0.04, ss: 0.014, tail: 0.5, sharp: 0.14, gain: 0.34, low: [0.98, 0.72, 0.8], high: [0.7, 0.8, 1] }
    ];

    /* ---------- Surfaces: the top edges snow can lie on ---------- */

    const COL = 3;
    const SURFACE_SELECTOR = '.featured-card:not(.featured-card--skeleton), .movie-card-component:not(.mc-is-loading), [data-snow-surface]';

    /* Where snow may slip off a fir in the margins, in wing coordinates (272 x 1124). */
    const WING_DUMPS = {
        left: [[186, 534, 88], [40, 164, 172], [158, 862, 50]],
        right: [[96, 404, 100], [242, 284, 156], [156, 784, 60]]
    };

    function mount(layer, opts) {
        const root = document.documentElement;
        const isLight = root.classList.contains('light-theme');
        const reduced = g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const quiet = !!opts?.quiet;
        const R = A.rng(1234);
        const cs = getComputedStyle(root);
        const token = n => A.parse(cs.getPropertyValue(n)).map(v => v | 0).join(',');
        let W = g.innerWidth, H = g.innerHeight;
        let dead = false, raf = 0;
        const timers = new Set();
        const later = (fn, ms) => {
            const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
            timers.add(id);
            return id;
        };
        const tickers = new Set();

        /* ---------- Layers ---------- */

        const P0 = A.palette(root);
        const sky = document.createElement('div');
        sky.className = 'ny-sky';
        sky.setAttribute('aria-hidden', 'true');
        sky.innerHTML = '<canvas class="ny-sky__stars"></canvas><canvas class="ny-sky__aurora"></canvas><canvas class="ny-sky__santa"></canvas>';
        document.body.prepend(sky);
        const starsEl = sky.querySelector('.ny-sky__stars');
        const auroraEl = sky.querySelector('.ny-sky__aurora');
        const santaEl = sky.querySelector('.ny-sky__santa');
        A.paintStars(starsEl, P0);

        layer.innerHTML = '<div class="ny-wing ny-wing--left"><div class="ny-wing__layer ny-wing__far" data-depth="5"></div><div class="ny-wing__layer ny-wing__near" data-depth="13"></div></div>'
            + '<div class="ny-wing ny-wing--right"><div class="ny-wing__layer ny-wing__far" data-depth="5"></div><div class="ny-wing__layer ny-wing__near" data-depth="13"></div></div>'
            + (quiet ? '' : '<canvas class="ny-fx"></canvas>');
        const fx = layer.querySelector('.ny-fx');
        const depthEls = Array.from(layer.querySelectorAll('[data-depth]')).map(el => ({ el, d: +el.dataset.depth, lx: 0, ly: 0 }));

        const pileHost = document.createElement('div');
        pileHost.className = 'ny-piles';
        pileHost.setAttribute('aria-hidden', 'true');
        const pileEl = document.createElement('canvas');
        pileHost.appendChild(pileEl);
        if (!quiet) document.body.appendChild(pileHost);
        const pilePad = 240, pileDpr = Math.min(g.devicePixelRatio || 1, 1.5);
        const pileCtx = pileEl.getContext('2d');
        let pileY = null;

        const dpr = Math.min(g.devicePixelRatio || 1, 1.5);
        const ctx = fx ? fx.getContext('2d') : null;

        function sizeLayers() {
            W = g.innerWidth;
            H = g.innerHeight;
            if (fx) {
                fx.width = Math.round(W * dpr);
                fx.height = Math.round(H * dpr);
            }
            pileEl.style.width = W + 'px';
            pileEl.style.height = (H + pilePad * 2) + 'px';
            pileEl.width = Math.round(W * pileDpr);
            pileEl.height = Math.round((H + pilePad * 2) * pileDpr);
            pileY = null;
        }
        sizeLayers();

        /* The layer spans the page so it scrolls with it; only its body height counts. */
        function fitPileHost() {
            pileHost.style.height = Math.max(document.body.offsetHeight, g.innerHeight) + 'px';
        }
        fitPileHost();
        const bodyObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fitPileHost) : null;
        bodyObserver?.observe(document.body);

        const flakeColor = token('--ny-flake');
        const SP = {
            dot: dotSprite(flakeColor), bokeh: bokehSprite(flakeColor), crystal: crystalSprite(flakeColor),
            core: coreSprite('255,240,205'), bulb: glowSprite('255,190,104'),
            glint: glintSprite(isLight ? '120,165,215' : '255,255,255')
        };

        /* ---------- Falling snow in three depths ---------- */

        const flakes = [];
        function seedFlakes() {
            flakes.length = 0;
            const area = A.clamp((W * H) / (1920 * 1080), 0.3, 1.25);
            const make = (kind, zA, zB, sA, sB, aA, aB, fA, fB) => {
                const z = A.lerp(zA, zB, R());
                flakes.push({
                    kind, z,
                    x: R() * (W + 200) - 100, y: R() * H, py: 0,
                    s: A.lerp(sA, sB, R()), a: A.lerp(aA, aB, R()), fall: A.lerp(fA, fB, R()),
                    ph: R() * TAU, fq: 0.5 + R() * 1.1, sw: 6 + R() * 18 * (0.4 + z),
                    rot: R() * TAU, rv: (R() - 0.5) * 1.6, tp: R() * TAU, tv: 0.5 + R() * 1.2,
                    ex: 0, ey: 0
                });
            };
            for (let i = 0; i < 150 * area; i++) make(0, 0.06, 0.3, 1, 2, 0.22, 0.55, 20, 40);
            for (let i = 0; i < 90 * area; i++) make(1, 0.42, 0.72, 2.2, 4, 0.55, 0.9, 46, 82);
            for (let i = 0; i < 26 * area; i++) make(2, 0.5, 0.86, 10, 19, 0.5, 0.92, 50, 84);
            for (let i = 0; i < 14 * area; i++) make(3, 0.95, 1.25, 9, 20, 0.08, 0.2, 120, 190);
        }
        if (!reduced && !quiet) seedFlakes();

        /* ---------- Snow that lands on posters ---------- */

        const surfaceOf = new WeakMap();
        const active = new Set();

        function buildSurface(el) {
            const width = el.offsetWidth;
            const declared = el.dataset.snowSurface;
            const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
            const inset = declared ? +declared : Math.max(1, radius - 3);
            const n = Math.ceil((width - inset * 2) / COL) + 1;
            if (n < 8) return null;
            const mh = Math.min(19, 7 + (width - inset * 2) * 0.03);
            const h = new Float32Array(n), cap = new Float32Array(n);
            const r = A.rng(width + inset * 7 + (el.offsetLeft | 0));
            const a = r() * TAU, b = r() * TAU;
            for (let i = 0; i < n; i++) {
                const u = i / (n - 1);
                const edge = 1 - Math.pow(Math.abs(2 * u - 1), 5);
                const wave = 0.72 + 0.2 * Math.sin(u * 9 + a) + 0.12 * Math.sin(u * 23 + b);
                cap[i] = mh * edge * wave;
                h[i] = cap[i] * (0.5 + r() * 0.1);
            }
            /* A surface may keep a stretch clear, like the sign behind the tree. */
            const carveX = +el.dataset.snowCarveX, carveHalf = +el.dataset.snowCarveHalf;
            if (carveX && carveHalf) {
                for (let i = 0; i < n; i++) {
                    const q = A.clamp((Math.abs(i * COL - (carveX - inset)) - carveHalf) / 26, 0, 1);
                    cap[i] *= q;
                    h[i] *= q;
                }
            }
            const drips = [];
            for (let i = 0; i < n / 22; i++) drips.push({ c: 3 + r() * (n - 6) | 0, len: 2 + r() * 5, w: 3 + r() * 5 });
            return {
                el, width, inset, n, h, cap, drips, x: 0, y: 0, w: 0, lastY: null, on: false, near: false,
                grip: R() * 0.8, clip: el.closest('.featured-slider-section')
            };
        }

        /* Cards come and go; only those near the viewport are ever measured per frame. */
        const io = typeof IntersectionObserver === 'function' && !quiet
            ? new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        let s = surfaceOf.get(entry.target);
                        if (!s || s.width !== entry.target.offsetWidth) {
                            s = buildSurface(entry.target);
                            if (s) surfaceOf.set(entry.target, s);
                        }
                        if (s) active.add(s);
                    } else {
                        const s = surfaceOf.get(entry.target);
                        if (s) active.delete(s);
                    }
                });
                /* The still picture of reduced motion has to include cards that appeared later. */
                if (reduced) onReducedScroll();
            }, { rootMargin: pilePad + 'px 0px' })
            : null;
        const watched = new WeakSet();

        function observeSurfaces() {
            if (dead || !io) return;
            const list = document.querySelectorAll(SURFACE_SELECTOR);
            for (let i = 0; i < list.length && i < 400; i++) {
                if (!watched.has(list[i])) {
                    watched.add(list[i]);
                    io.observe(list[i]);
                }
            }
            active.forEach(s => { if (!s.el.isConnected) active.delete(s); });
        }

        function scanSurfaces() {
            if (dead || !io) return;
            observeSurfaces();
            later(scanSurfaces, 1200);
        }
        scanSurfaces();

        const parts = [];
        function emit(x, y, vx, vy, life, s, kind) {
            if (parts.length > 700) return;
            parts.push({ x, y, vx, vy, life, max: life, s, kind: kind || 0, age: 0 });
        }

        function deposit(sf, c, amt) {
            for (let k = -2; k <= 2; k++) {
                const i = c + k;
                if (i < 0 || i >= sf.n) continue;
                const add = amt * (k === 0 ? 1 : Math.abs(k) === 1 ? 0.62 : 0.26);
                sf.h[i] = Math.min(sf.cap[i], sf.h[i] + add);
            }
        }

        function shed(sf, power, vy, keep) {
            const count = Math.min(sf.n, 2 + sf.n * power * 0.5 | 0);
            for (let i = 0; i < count; i++) {
                const c = R() * sf.n | 0;
                const take = Math.min(sf.h[c] - sf.cap[c] * (keep || 0), (0.5 + R() * 2.4) * (0.4 + power * 2));
                if (take <= 0.05) continue;
                sf.h[c] -= take;
                if (R() < 0.7) emit(sf.x + c * COL, sf.y - sf.h[c] - 1, (R() - 0.5) * 70, A.clamp(vy, -260, 260) * 0.2 - R() * 40, 0.9 + R() * 1.1, 1.3 + R() * 2.2);
            }
        }

        /* ---------- Pointer ---------- */

        const P = { x: W / 2, y: H / 2, vx: 0, vy: 0, seen: false, t: 0 };
        function onMove(e) {
            const dt = Math.max(0.008, (e.timeStamp - P.t) / 1000);
            if (P.seen) {
                P.vx += ((e.clientX - P.x) / dt - P.vx) * 0.35;
                P.vy += ((e.clientY - P.y) / dt - P.vy) * 0.35;
            }
            P.x = e.clientX; P.y = e.clientY; P.t = e.timeStamp; P.seen = true;
        }
        g.addEventListener('pointermove', onMove, { passive: true });

        /* ---------- Sparkler: the cursor writes with light inside the sign ---------- */

        const trail = [];
        let sparkZone = null;
        function sparklerMove() {
            if (!P.seen || !sparkZone) return;
            const r = sparkZone.getBoundingClientRect();
            const inside = P.x > r.left + 24 && P.x < r.right - 24 && P.y > r.top + 24 && P.y < r.bottom - 24;
            const speed = Math.hypot(P.vx, P.vy);
            if (!inside || speed < 8) return;
            const last = trail[trail.length - 1];
            if (!last || Math.hypot(P.x - last.x, P.y - last.y) > 2.5) trail.push({ x: P.x, y: P.y, age: 0, br: last && Math.hypot(P.x - last.x, P.y - last.y) > 80 });
            const n = 2 + Math.min(6, speed / 180) | 0;
            for (let i = 0; i < n; i++) {
                const a = R() * TAU, v = 60 + R() * 240;
                emit(P.x, P.y, Math.cos(a) * v + P.vx * 0.1, Math.sin(a) * v + P.vy * 0.1, 0.25 + R() * 0.5, 1, 1);
            }
        }

        /* ---------- Fireworks, for the first day of the year ---------- */

        let fireworks = false;
        const rockets = [], flashes = [];
        const fireColors = ['255,214,130', '255,120,120', '140,215,255', '190,150,255', '150,240,190', '255,255,245'];
        const fireSprites = fireColors.map(coreSprite);
        const fireGlows = fireColors.map(glowSprite);
        const small = () => W < 900;
        function launch() {
            const x = W * (0.08 + R() * 0.84);
            rockets.push({ x, y: H * 0.62, vx: (R() - 0.5) * 60, vy: -(small() ? 380 : 520) - R() * 170, fuse: 0.75 + R() * 0.55, c: R() * fireColors.length | 0 });
        }
        function burst(x, y, c) {
            /* Three shapes: a round peony, a thin ring and a long falling willow. */
            const shape = R();
            const n = small() ? 70 : 150;
            const speed = (small() ? 150 : 250) + R() * 130;
            flashes.push({ x, y, c, age: 0, r: small() ? 110 : 200 });
            for (let i = 0; i < n; i++) {
                const a = i / n * TAU + R() * 0.04;
                const v = shape < 0.3 ? speed * (0.92 + R() * 0.12) : speed * Math.pow(R(), 0.5) * 1.05;
                const life = shape > 0.72 ? 1.9 + R() * 1.1 : 1.1 + R() * 0.9;
                emit(x, y, Math.cos(a) * v, Math.sin(a) * v, life, shape > 0.72 ? 1.5 : 1.9, shape > 0.72 ? 2 : 2 + c);
            }
            if (shape < 0.72) {
                for (let i = 0; i < n / 3; i++) {
                    const a = R() * TAU, v = speed * 0.34 * R();
                    emit(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.6 + R() * 0.6, 1.5, 2 + 5);
                }
            }
        }

        /* ---------- Aurora ---------- */

        const skyAurora = Aurora(auroraEl, {
            w: W < 900 ? 200 : 460, h: W < 900 ? 130 : 200, seed: 5,
            curtains: isLight ? AURORA_LIGHT : AURORA_DARK, alpha: isLight ? 0.55 : 1
        });
        /* Beside a broadcast the sky holds still: one frame, then nothing to draw while the video plays. */
        if (quiet) skyAurora(8);
        const extraAuroras = new Set();

        /* ---------- Santa, through the free band of sky on Home ---------- */

        const santa = !quiet && !reduced && opts?.santa && g.NySleigh
            ? g.NySleigh.Flight(santaEl, { W, H, light: isLight, speed: W < 900 ? 92 : 240, pairs: W < 900 ? 2 : 3 })
            : null;
        function santaBandY() {
            const hero = document.querySelector('.featured-poster');
            if (!hero) return null;
            const next = document.querySelector('.ny-marquee, .ny-strip') || document.getElementById('personal-tier');
            const a = hero.getBoundingClientRect().bottom;
            const b = next ? next.getBoundingClientRect().top : a + 110;
            const y = (a + b) / 2 + (W < 900 ? 2 : 6);
            return y > 90 && y < H - 60 ? y : null;
        }
        function santaFly() {
            if (dead || !santa) return;
            if (isPaused()) { later(santaFly, 8000); return; }
            const y = santaBandY();
            /* The sky band has scrolled away: try again rather than fly behind solid content. */
            if (y == null) { later(santaFly, 8000); return; }
            santa.start(g.NySleigh.route(W, y, W < 900), () => later(santaFly, 45000));
        }
        if (santa) later(santaFly, 3400);

        /* ---------- The logo claps now and then, and the clap shakes snow loose ---------- */

        function clap() {
            if (dead) return;
            if (!isPaused()) {
                document.querySelectorAll('.nav-logo, [data-seasonal-logo]').forEach(logo => {
                    const mark = logo.querySelector('.season-logo');
                    if (!mark?.getBoundingClientRect().width) return;
                    logo.classList.add('is-clap');
                    later(() => {
                        const r = mark.getBoundingClientRect();
                        const x = r.left + r.width / 2;
                        const count = Math.min(70, 26 * r.width / 30);
                        for (let i = 0; i < count; i++) emit(x + (R() - 0.5) * r.width * 0.85, r.bottom + R() * 3, (R() - 0.5) * 90, 10 + R() * 70, 0.9 + R() * 0.9, 1.1 + R() * 1.9);
                    }, 170);
                    later(() => logo.classList.remove('is-clap'), 950);
                });
            }
            later(clap, 9000 + R() * 8000);
        }
        if (!reduced && !quiet) later(clap, 2600);

        /* A clump of snow lets go of a bough somewhere in the forest. */
        function dumpSnow() {
            if (dead) return;
            const wing = layer.querySelector('.ny-wing');
            if (W >= 1640 && wing && !isPaused()) {
                const side = R() < 0.5 ? 'left' : 'right';
                const k = (wing.offsetWidth + 48) / 272;
                const fir = WING_DUMPS[side][R() * 3 | 0];
                const t = 0.2 + (R() * 7 | 0) * 0.1;
                const firTop = H + 44 - 1124 * k + fir[1] * k;
                const px = (fir[0] - 24 + (R() < 0.5 ? -1 : 1) * fir[2] * 0.55 * t) * k;
                const x = side === 'left' ? px : W - px;
                const y = firTop + (1000 * k - fir[1] * k) * t;
                const n = 26 + R() * 30 | 0;
                for (let i = 0; i < n; i++) emit(x + (R() - 0.5) * 26, y + (R() - 0.5) * 6, (R() - 0.5) * 34, R() * 30, 1.2 + R() * 1.4, 1 + R() * 2.4);
            }
            later(dumpSnow, 2600 + R() * 4200);
        }
        if (!reduced && !quiet) later(dumpSnow, 3400);

        /* ---------- The frame ---------- */

        let t = 0, last = performance.now(), wasPaused = false;
        let auroraT = 0, scrollLast = g.scrollY || 0, scrollV = 0, scrollEase = scrollLast, flingCalm = true, slowFrames = 0;
        let pilesHeldUntil = 0;
        let lite = false;
        const px = { x: 0, y: 0 };

        function isPaused() {
            return document.hidden
                || document.body.classList.contains('player-modal-open')
                || !!document.fullscreenElement;
        }

        function step(now) {
            if (dead) return;
            raf = requestAnimationFrame(step);
            if (isPaused()) {
                wasPaused = true;
                last = now;
                return;
            }
            if (wasPaused) {
                wasPaused = false;
                last = now;
                scrollLast = g.scrollY || 0;
            }
            const started = performance.now();
            frame(now);
            /* A machine that cannot keep up gets less snow and a slower aurora. */
            if (!lite) {
                slowFrames = performance.now() - started > 12 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
                if (slowFrames > 90) {
                    lite = true;
                    flakes.length = Math.ceil(flakes.length * 0.5);
                }
            }
        }

        const drawFlakeWith = (dt, wind, pSpeed) => f => {
            f.py = f.y;
            f.x += (wind * (0.22 + f.z) + Math.sin(t * f.fq + f.ph) * f.sw + f.ex) * dt;
            f.y += (f.fall + f.ey - scrollV * (0.02 + 0.15 * f.z)) * dt;
            if (P.seen) {
                const dx = f.x - P.x, dy = f.y - P.y, d2 = dx * dx + dy * dy, RR = 170;
                if (d2 < RR * RR) {
                    const d = Math.sqrt(d2) + 0.01, q = 1 - d / RR, push = q * q * (70 + pSpeed * 0.65);
                    f.ex += (dx / d * push + P.vx * q * 0.55) * dt * (0.5 + f.z);
                    f.ey += (dy / d * push + P.vy * q * 0.55) * dt * (0.5 + f.z);
                }
            }
            const damp = Math.exp(-dt * 1.5);
            f.ex *= damp; f.ey *= damp;
            if (f.x < -80) f.x += W + 160; else if (f.x > W + 80) f.x -= W + 160;
            if (f.y > H + 40 || f.y < -120) {
                f.y = f.y > 0 ? -20 - R() * 50 : H + 20;
                f.py = f.y;
                f.x = R() * (W + 160) - 80;
            }

            /* Mid-depth flakes can land. */
            if (f.z > 0.4 && f.z < 0.9 && f.y > f.py) {
                for (const s of active) {
                    if (!s.on) continue;
                    const c = (f.x - s.x) / COL | 0;
                    if (c < 0 || c >= s.n || f.x < s.x) continue;
                    const top = s.y - s.h[c];
                    if (f.py <= top && f.y >= top) {
                        if (s.h[c] < s.cap[c]) deposit(s, c, f.kind === 2 ? 1.5 : 0.8);
                        f.y = -20 - R() * 60;
                        f.py = f.y;
                        f.x = R() * (W + 160) - 80;
                        break;
                    }
                }
            }

            if (f.kind === 2) {
                f.rot += f.rv * dt;
                const c = Math.cos(f.rot), sn = Math.sin(f.rot), sy = 0.45 + 0.55 * Math.abs(Math.cos(t * f.tv + f.tp));
                ctx.globalAlpha = f.a;
                ctx.setTransform(dpr * c, dpr * sn, -dpr * sn * sy, dpr * c * sy, dpr * f.x, dpr * f.y);
                ctx.drawImage(SP.crystal, -f.s / 2, -f.s / 2, f.s, f.s);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            } else {
                ctx.globalAlpha = f.a;
                ctx.drawImage(f.kind === 3 ? SP.bokeh : SP.dot, f.x - f.s / 2, f.y - f.s / 2, f.s, f.s);
            }
        };

        let snowHiCache = null, snowLoCache = null, pileLine = null;

        function drawPiles(dt, scrollTop, pSpeed) {
            const pc = pileCtx;
            if (scrollTop !== pileY) {
                pileEl.style.transform = 'translate3d(0,' + (scrollTop - pilePad) + 'px,0)';
                pileY = scrollTop;
            }
            pc.setTransform(pileDpr, 0, 0, pileDpr, 0, pileDpr * pilePad);
            pc.clearRect(0, -pilePad, W, H + pilePad * 2);
            if (!snowHiCache) {
                snowHiCache = 'rgb(' + token('--ny-snow-hi') + ')';
                snowLoCache = 'rgb(' + token('--ny-snow-mid') + ')';
                pileLine = cs.getPropertyValue('--ny-pile-line').trim() || null;
            }

            for (const s of active) {
                if (!s.near) continue;

                /* Snow creeps back on its own and slumps toward a natural slope. */
                for (let c = 0; c < s.n - 1; c++) {
                    if (s.h[c] < s.cap[c] * 0.92) s.h[c] += 0.0035 * s.cap[c] * dt * 3;
                    const diff = s.h[c] - s.h[c + 1];
                    if (Math.abs(diff) > 0.7) {
                        const m = diff * 0.08;
                        s.h[c] -= m;
                        s.h[c + 1] += m;
                    }
                }

                /* The cursor brushes snow off. */
                if (P.seen && !reduced && P.y > s.y - 28 && P.y < s.y + 12 && P.x > s.x - 16 && P.x < s.x + s.w + 16 && pSpeed > 14) {
                    const cc = (P.x - s.x) / COL;
                    const rr = 11;
                    for (let c = Math.max(0, cc - rr | 0); c < Math.min(s.n, cc + rr); c++) {
                        const q = 1 - Math.abs(c - cc) / rr;
                        if (q <= 0) continue;
                        const take = Math.min(s.h[c], q * q * (0.5 + pSpeed * 0.012));
                        if (take <= 0.02) continue;
                        s.h[c] -= take;
                        if (R() < 0.45 + take * 0.2) emit(s.x + c * COL, s.y - s.h[c] - 1, P.vx * (0.14 + R() * 0.26) + (R() - 0.5) * 50, -28 - R() * 90 + P.vy * 0.14, 0.7 + R() * 1, 1.1 + R() * 2);
                    }
                }

                /* A carousel hides part of its cards; their snow goes with them. */
                pc.save();
                if (s.clip) {
                    const cr = s.clip.getBoundingClientRect();
                    pc.beginPath();
                    pc.rect(cr.left, s.y - 40, cr.width, 70);
                    pc.clip();
                }

                /* Under a pixel of snow is no snow at all: nothing is drawn there, no outline either. */
                const lift = c => { const v = s.h[c] - 0.7; return v > 0 ? v : 0; };
                const yb = s.y + 0.5;
                const gr = pc.createLinearGradient(0, s.y - 16, 0, s.y + 2);
                gr.addColorStop(0, snowHiCache);
                gr.addColorStop(0.72, snowHiCache);
                gr.addColorStop(1, snowLoCache);
                pc.fillStyle = gr;
                pc.beginPath();
                pc.moveTo(s.x - 1, yb);
                let px0 = s.x, py0 = yb - lift(0);
                pc.lineTo(px0, py0);
                for (let c = 1; c < s.n; c++) {
                    const x1 = s.x + c * COL, y1 = yb - lift(c);
                    pc.quadraticCurveTo(px0, py0, (px0 + x1) / 2, (py0 + y1) / 2);
                    px0 = x1; py0 = y1;
                }
                pc.lineTo(s.x + (s.n - 1) * COL + 1, yb);
                for (let d = s.drips.length - 1; d >= 0; d--) {
                    const dr = s.drips[d], hh = s.h[dr.c];
                    if (hh < 5) continue;
                    const x = s.x + dr.c * COL, l = dr.len * Math.min(1, (hh - 5) / 5);
                    pc.lineTo(x + dr.w / 2, yb);
                    pc.quadraticCurveTo(x + dr.w / 2, yb + l, x, yb + l);
                    pc.quadraticCurveTo(x - dr.w / 2, yb + l, x - dr.w / 2, yb);
                }
                pc.closePath();
                pc.fill();

                /* The outline (light theme) and the contact shadow follow the snow, not the card. */
                const trace = (floor, yAt) => {
                    let pen = false;
                    pc.beginPath();
                    for (let c = 0; c < s.n; c++) {
                        const e = lift(c), x = s.x + c * COL;
                        if (e > floor) {
                            if (pen) pc.lineTo(x, yAt(e));
                            else { pc.moveTo(x, yAt(e)); pen = true; }
                        } else {
                            pen = false;
                        }
                    }
                };
                if (pileLine) {
                    trace(0.5, e => yb - e);
                    pc.strokeStyle = pileLine;
                    pc.lineWidth = 0.8;
                    pc.lineJoin = 'round';
                    pc.stroke();
                }
                trace(1, () => yb + 1);
                pc.strokeStyle = 'rgba(0,0,0,0.14)';
                pc.lineWidth = 2;
                pc.stroke();
                pc.restore();
            }
        }

        function frame(now) {
            let dt = (now - last) / 1000;
            last = now;
            if (dt > 0.05) dt = 0.05;
            if (dt <= 0) dt = 1 / 240;
            t += dt;

            P.vx *= Math.exp(-dt * 7);
            P.vy *= Math.exp(-dt * 7);

            const scrollTop = g.scrollY || 0;
            const scrollDelta = scrollTop - scrollLast;
            scrollLast = scrollTop;

            /* The wheel moves the page in jumps. Everything in the air follows a smoothed speed. */
            scrollV += (A.clamp(scrollDelta / dt, -2600, 2600) - scrollV) * (1 - Math.exp(-dt * 5));
            scrollEase += (scrollTop - scrollEase) * (1 - Math.exp(-dt * 4));

            /* Parallax eases toward the pointer and drifts a little with scrolling. */
            const k = 1 - Math.exp(-dt * 3.2);
            px.x += ((P.seen ? P.x / W - 0.5 : 0) - px.x) * k;
            px.y += ((P.seen ? P.y / H - 0.5 : 0) - px.y) * k;
            if (W >= 1640) {
                for (let i = 0; i < depthEls.length; i++) {
                    const d = depthEls[i];
                    const sx = -px.x * d.d * 2, sy = -px.y * d.d * 0.7 - Math.min(40, scrollEase * d.d * 0.0014);
                    if (Math.abs(sx - d.lx) > 0.02 || Math.abs(sy - d.ly) > 0.02) {
                        d.el.style.transform = 'translate3d(' + sx.toFixed(2) + 'px,' + sy.toFixed(2) + 'px,0)';
                        d.lx = sx; d.ly = sy;
                    }
                }
            }

            auroraT += dt;
            if (auroraT > (lite ? 1 / 12 : 1 / 24)) {
                if (!quiet) skyAurora(t);
                extraAuroras.forEach(fn => fn(t));
                auroraT = 0;
            }

            tickers.forEach(fn => fn(t, dt, P));

            if (quiet) return;

            /* Read surface positions. Calm scrolling leaves the snow alone: only a card that moves
               by itself (the hover lift) or a really fast fling knocks some of it off. */
            const fling = (Math.abs(scrollV) - 1000) / 1800;
            if (Math.abs(scrollV) < 200) {
                if (!flingCalm) active.forEach(q => { q.grip = R() * 0.8; });
                flingCalm = true;
            } else if (fling > 0) {
                flingCalm = false;
            }
            const pilesHeld = performance.now() < pilesHeldUntil;
            for (const known of active) {
                let s = known;
                const r = s.el.getBoundingClientRect();
                if (Math.abs(r.width - s.width) > 1) {
                    /* The window changed size: the pile is rebuilt for the new width. */
                    const rebuilt = buildSurface(s.el);
                    active.delete(s);
                    if (!rebuilt) continue;
                    surfaceOf.set(s.el, rebuilt);
                    active.add(rebuilt);
                    s = rebuilt;
                }
                s.x = r.left + s.inset;
                s.y = r.top;
                s.w = r.width - s.inset * 2;
                s.on = s.y > -30 && s.y < H + 30;
                s.near = s.y > -pilePad + 30 && s.y < H + pilePad - 30;
                if (s.lastY != null && !reduced && s.on) {
                    const vy = (s.y - s.lastY) / dt;
                    const own = vy + scrollDelta / dt;
                    if (Math.abs(own) > 30 && !pilesHeld) shed(s, Math.min(0.3, Math.abs(own) / 900), own);
                    if (fling > s.grip) shed(s, Math.min(0.45, (fling - s.grip) * 0.9), vy, 0.5);
                }
                s.lastY = s.y;
            }

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);

            const wind = 12 + 20 * Math.sin(t * 0.13) + 14 * Math.sin(t * 0.37 + 1.7) + 6 * Math.sin(t * 1.1);
            const pSpeed = Math.hypot(P.vx, P.vy);
            const drawFlake = drawFlakeWith(dt, wind, pSpeed);

            for (let i = 0; i < flakes.length; i++) if (flakes[i].kind === 0) drawFlake(flakes[i]);
            ctx.globalAlpha = 1;
            drawPiles(dt, scrollTop, pSpeed);
            if (!reduced) sparklerMove();
            for (let i = 0; i < flakes.length; i++) if (flakes[i].kind !== 0) drawFlake(flakes[i]);

            /* Snow banks in the margins glitter. */
            if (W >= 1640) {
                const count = 46;
                for (let i = 0; i < count; i++) {
                    const v = Math.sin(t * (0.5 + (i * 37 % 14) / 10) + i * 1.7);
                    if (v > 0.965) {
                        const z = (v - 0.965) / 0.035, size = 3 + z * 9;
                        const side = layer.querySelector('.ny-wing').offsetWidth;
                        const sx = ((i * 53) % side);
                        const x = i % 2 ? sx : W - sx;
                        const y = H - 8 - ((i * 29) % 44);
                        ctx.globalAlpha = z;
                        ctx.drawImage(SP.glint, x - size / 2, y - size / 2, size, size);
                    }
                }
                ctx.globalAlpha = 1;
            }

            /* Fireworks. */
            if (fireworks && !reduced) {
                nextRocket -= dt;
                if (nextRocket <= 0) { launch(); nextRocket = 0.45 + R() * 1.1; }
                ctx.globalCompositeOperation = isLight ? 'source-over' : 'lighter';
                for (let i = rockets.length - 1; i >= 0; i--) {
                    const k2 = rockets[i];
                    k2.x += k2.vx * dt; k2.y += k2.vy * dt; k2.vy += 90 * dt; k2.fuse -= dt;
                    ctx.globalAlpha = 0.9;
                    ctx.drawImage(fireSprites[k2.c], k2.x - 3, k2.y - 3, 6, 6);
                    if (R() < 0.7) emit(k2.x, k2.y, (R() - 0.5) * 16, 18 + R() * 30, 0.3 + R() * 0.3, 1, 1);
                    if (k2.fuse <= 0) { burst(k2.x, k2.y, k2.c); rockets.splice(i, 1); }
                }
                for (let i = flashes.length - 1; i >= 0; i--) {
                    const fl = flashes[i];
                    fl.age += dt;
                    if (fl.age > 0.3) { flashes.splice(i, 1); continue; }
                    ctx.globalAlpha = (1 - fl.age / 0.3) * 0.55;
                    const size = fl.r * (0.7 + fl.age * 2);
                    ctx.drawImage(fireGlows[fl.c], fl.x - size, fl.y - size, size * 2, size * 2);
                }
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
            }

            /* Everything loose: shaken snow, sparks, firework stars. */
            ctx.lineCap = 'round';
            for (let i = parts.length - 1; i >= 0; i--) {
                const p = parts[i];
                p.age += dt;
                if (p.age >= p.max) { parts.splice(i, 1); continue; }
                const q = p.age / p.max;
                if (p.kind === 0) {
                    p.vy += 340 * dt;
                    const drag = Math.exp(-dt * 1.7);
                    p.vx = p.vx * drag + wind * 0.5 * dt;
                    p.vy *= drag;
                    p.x += p.vx * dt; p.y += (p.vy - scrollV * 0.25) * dt;
                    ctx.globalAlpha = (1 - q) * 0.95;
                    ctx.drawImage(SP.dot, p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
                } else if (p.kind === 1) {
                    p.vy += 300 * dt;
                    const drag = Math.exp(-dt * 3.4);
                    p.vx *= drag; p.vy *= drag;
                    p.x += p.vx * dt; p.y += p.vy * dt;
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.strokeStyle = 'rgba(255,204,120,' + ((1 - q) * 0.95) + ')';
                    ctx.lineWidth = 1.1;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x - p.vx * 0.034, p.y - p.vy * 0.034);
                    ctx.stroke();
                    ctx.globalCompositeOperation = 'source-over';
                } else {
                    p.vy += 150 * dt;
                    const drag = Math.exp(-dt * 2.1);
                    p.vx *= drag; p.vy *= drag;
                    p.x += p.vx * dt; p.y += p.vy * dt;
                    const ci = (p.kind - 2) % fireSprites.length;
                    ctx.globalCompositeOperation = isLight ? 'source-over' : 'lighter';
                    const tw = q > 0.62 ? (Math.sin(p.age * 38 + i) * 0.5 + 0.5) : 1;
                    const al = (1 - q * q) * tw;
                    ctx.strokeStyle = 'rgba(' + fireColors[ci] + ',' + al * 0.7 + ')';
                    ctx.lineWidth = p.s * 1.05;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x - p.vx * 0.1, p.y - p.vy * 0.1);
                    ctx.stroke();
                    ctx.globalAlpha = al;
                    const size = p.s * 3.6;
                    ctx.drawImage(fireSprites[ci], p.x - size / 2, p.y - size / 2, size, size);
                    ctx.globalAlpha = 1;
                    ctx.globalCompositeOperation = 'source-over';
                }
            }
            ctx.globalAlpha = 1;

            /* The sparkler's light trail fades like a long exposure. */
            if (trail.length) {
                ctx.globalCompositeOperation = 'lighter';
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                for (let i = 0; i < trail.length; i++) trail[i].age += dt;
                while (trail.length && trail[0].age > 1.5) trail.shift();
                for (let i = 1; i < trail.length; i++) {
                    const a = trail[i - 1], b = trail[i];
                    if (b.br) continue;
                    const q = 1 - b.age / 1.5;
                    ctx.strokeStyle = 'rgba(255,190,96,' + (q * q * 0.36) + ')';
                    ctx.lineWidth = 7 * q;
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                    ctx.strokeStyle = 'rgba(255,242,214,' + (q * q) + ')';
                    ctx.lineWidth = 1.7 * q + 0.3;
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                }
                const head = trail[trail.length - 1];
                if (head && head.age < 0.3) {
                    ctx.globalAlpha = 1 - head.age / 0.3;
                    ctx.drawImage(SP.bulb, head.x - 22, head.y - 22, 44, 44);
                    ctx.globalAlpha = 1;
                }
                ctx.globalCompositeOperation = 'source-over';
            }

            /* Santa flies last: his canvas sits behind the content anyway. */
            if (santa) santa.update(dt);
        }
        let nextRocket = 0.6;

        /* ---------- Resize, theme changes ---------- */

        function onResize() {
            sizeLayers();
            santa?.resize(W, H);
            A.paintStars(starsEl, P0);
            if (!reduced && !quiet) seedFlakes();
            fitPileHost();
            if (reduced) stillFrame();
        }
        let resizeTimer = 0;
        const onResizeSoon = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { if (!dead) onResize(); }, 180);
        };
        g.addEventListener('resize', onResizeSoon, { passive: true });

        /* Reduced motion: one still frame, snow already settled, nothing moves afterwards. */
        function stillFrame() {
            last = performance.now() - 16;
            frame(performance.now());
        }
        let queued = false;
        const onReducedScroll = () => {
            if (queued || dead) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; if (!dead) stillFrame(); });
        };
        if (reduced) {
            t = 8;
            skyAurora(8);
            later(stillFrame, 400);
            g.addEventListener('scroll', onReducedScroll, { passive: true });
        } else {
            raf = requestAnimationFrame(step);
        }

        return {
            reduced,
            emit,
            later,
            addTicker(fn) { tickers.add(fn); return () => tickers.delete(fn); },
            addAurora(canvas) {
                const fn = Aurora(canvas, {
                    w: 300, h: 110, seed: 19, curtains: AURORA_DARK, alpha: 1
                });
                extraAuroras.add(fn);
                if (reduced) fn(8);
                return () => extraAuroras.delete(fn);
            },
            setSparklerZone(el) { sparkZone = el; },
            setFireworks(on) { fireworks = !!on; },
            redraw() { if (reduced) stillFrame(); },
            rescanSurfaces: observeSurfaces,
            /* For a change of layout: cards that slide with the page keep their snow. */
            holdPiles(ms) { pilesHeldUntil = performance.now() + ms; },
            destroy() {
                dead = true;
                cancelAnimationFrame(raf);
                clearTimeout(resizeTimer);
                timers.forEach(clearTimeout);
                timers.clear();
                g.removeEventListener('pointermove', onMove);
                g.removeEventListener('resize', onResizeSoon);
                g.removeEventListener('scroll', onReducedScroll);
                io?.disconnect();
                bodyObserver?.disconnect();
                sky.remove();
                pileHost.remove();
                layer.innerHTML = '';
            }
        };
    }

    /* ---------- The season's entry point for SeasonalThemeService ---------- */

    let current = null, currentLayer = null, themeObserver = null;
    const readyCallbacks = new Set();

    function isLiveBroadcast() {
        return /\/pages\/live\//.test(location.pathname);
    }

    function start(layer) {
        current = mount(layer, {
            // The broadcast is a video in the page: nothing may fall across it.
            quiet: isLiveBroadcast(),
            santa: /\/pages\/home\//.test(location.pathname)
        });
        readyCallbacks.forEach(fn => fn(current));
    }

    g.NewYearDecor = {
        mount(layer) {
            if (currentLayer === layer) return;
            this.unmount();
            currentLayer = layer;
            start(layer);
            /* A theme switch changes the sky and the snow's colors. */
            let wasLight = document.documentElement.classList.contains('light-theme');
            themeObserver = new MutationObserver(() => {
                const isLight = document.documentElement.classList.contains('light-theme');
                if (isLight === wasLight || !currentLayer) return;
                wasLight = isLight;
                current?.destroy();
                start(currentLayer);
            });
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        },
        unmount() {
            themeObserver?.disconnect();
            themeObserver = null;
            current?.destroy();
            current = null;
            currentLayer = null;
        },
        /* The sign attaches itself to the loop, now or whenever the loop (re)starts. */
        onReady(fn) {
            readyCallbacks.add(fn);
            if (current) fn(current);
            return () => readyCallbacks.delete(fn);
        }
    };
})(window);
