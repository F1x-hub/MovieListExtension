/**
 * New Year season: shared drawing helpers.
 *
 * Loaded on demand by SeasonalThemeService only while the season is active.
 * Colors for painted layers come from `--ny-*` tokens on the season root.
 */
(function (g) {
    'use strict';

    const TAU = Math.PI * 2;

    function rng(seed) {
        let a = seed | 0;
        return function () {
            a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const rgb = (c, al) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (al == null ? 1 : al) + ')';

    function parse(s) {
        s = (s || '').trim();
        if (s[0] === '#') {
            let h = s.slice(1);
            if (h.length === 3) h = h.replace(/./g, '$&$&');
            const n = parseInt(h, 16);
            return [n >> 16 & 255, n >> 8 & 255, n & 255];
        }
        const m = s.match(/[\d.]+/g);
        return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
    }

    function palette(el) {
        const cs = getComputedStyle(el);
        const c = n => parse(cs.getPropertyValue('--ny-' + n));
        return {
            core: c('fir-core'), dark: c('fir-dark'), mid: c('fir-mid'), hi: c('fir-hi'), rim: c('fir-rim'),
            bark: c('bark'),
            snowHi: c('snow-hi'), snowMid: c('snow-mid'), snowLo: c('snow-lo'),
            groundTop: c('ground-top'), groundMid: c('ground-mid'), groundBottom: c('ground-bottom'),
            far1: c('far-1'), far2: c('far-2'), far3: c('far-3'), farSnow: c('far-snow'), fog: c('fog'),
            warm: c('warm'), gold: c('gold'), goldDeep: c('gold-deep'),
            star: c('star'),
            signGroundTop: c('sign-ground-top'), signGroundMid: c('sign-ground-mid'), signGroundBottom: c('sign-ground-bottom'),
            signSnowHi: c('sign-snow-hi'), signSnowLo: c('sign-snow-lo'),
            isLight: cs.getPropertyValue('--ny-is-light').trim() === '1'
        };
    }

    /* A wavy snow bank. Returns its surface function for placing things on it. */
    function snowBank(ctx, w, h, base, amp, seed, colors) {
        const r = rng(seed);
        const p1 = r() * TAU, p2 = r() * TAU, p3 = r() * TAU;
        const f = x => base + Math.sin(x * 0.019 + p1) * amp + Math.sin(x * 0.047 + p2) * amp * 0.42 + Math.sin(x * 0.11 + p3) * amp * 0.12;
        const trace = (from, to) => {
            for (let x = from; x <= to; x += 3) ctx.lineTo(x, f(x));
        };
        const top = base - amp * 1.5;
        const gr = ctx.createLinearGradient(0, top, 0, h);
        gr.addColorStop(0, rgb(colors.top));
        gr.addColorStop(0.34, rgb(colors.mid));
        gr.addColorStop(1, rgb(colors.bottom));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(-20, h + 2);
        trace(-20, w + 20);
        ctx.lineTo(w + 20, h + 2);
        ctx.closePath();
        ctx.fill();

        /* Wind-carved ripples: long thin crescents following the surface. */
        for (let i = 0; i < 26; i++) {
            const x0 = r() * w, span = 16 + r() * 54, dy = 3 + r() * (h - base + amp) * 0.8;
            ctx.strokeStyle = r() < 0.55 ? rgb(colors.hi, 0.12 + r() * 0.2) : rgb(colors.lo, 0.14 + r() * 0.22);
            ctx.lineWidth = 0.5 + r() * 0.9;
            ctx.beginPath();
            ctx.moveTo(x0, f(x0) + dy);
            ctx.quadraticCurveTo(x0 + span / 2, f(x0 + span / 2) + dy - 2 - r() * 3, x0 + span, f(x0 + span) + dy);
            ctx.stroke();
        }
        ctx.strokeStyle = rgb(colors.hi, colors.edge);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-20, f(-20));
        trace(-20, w + 20);
        ctx.stroke();
        return f;
    }

    /* ---------- Art Deco geometry of the sign ---------- */

    function decoPolygon(W, H, i, s) {
        return [
            [i + 2 * s, i], [W - i - 2 * s, i], [W - i - 2 * s, i + s], [W - i - s, i + s], [W - i - s, i + 2 * s], [W - i, i + 2 * s],
            [W - i, H - i - 2 * s], [W - i - s, H - i - 2 * s], [W - i - s, H - i - s], [W - i - 2 * s, H - i - s], [W - i - 2 * s, H - i],
            [i + 2 * s, H - i], [i + 2 * s, H - i - s], [i + s, H - i - s], [i + s, H - i - 2 * s], [i, H - i - 2 * s],
            [i, i + 2 * s], [i + s, i + 2 * s], [i + s, i + s], [i + 2 * s, i + s]
        ];
    }

    function polygonPath(pts) {
        return 'M' + pts.map(p => p[0] + ' ' + p[1]).join('L') + 'Z';
    }

    function polygonClip(pts) {
        return 'polygon(' + pts.map(p => p[0] + 'px ' + p[1] + 'px').join(',') + ')';
    }

    function samplePolygon(pts, gap) {
        let total = 0;
        const segs = pts.map((p, i) => {
            const q = pts[(i + 1) % pts.length];
            const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
            total += l;
            return { p, q, l };
        });
        const count = Math.round(total / gap), d = total / count, out = [];
        let run = 0, seg = 0;
        for (let i = 0; i < count; i++) {
            const at = i * d;
            while (run + segs[seg].l < at) { run += segs[seg].l; seg++; }
            const t = (at - run) / segs[seg].l;
            out.push([lerp(segs[seg].p[0], segs[seg].q[0], t), lerp(segs[seg].p[1], segs[seg].q[1], t)]);
        }
        return out;
    }

    function marqueeGeometry(W, H) {
        const outer = decoPolygon(W, H, 0.75, 13);
        const band = decoPolygon(W, H, 21, 13);
        return {
            w: W, h: H,
            outer: polygonPath(outer),
            band: polygonPath(band),
            ring: polygonPath(outer) + polygonPath(band),
            clip: polygonClip(band)
        };
    }

    /* ---------- Small painters that are cheap enough to run in the page ---------- */

    function fitCanvas(canvas, scale) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        return { ctx, w, h };
    }

    function paintStars(canvas, P) {
        const { ctx, w, h } = fitCanvas(canvas, 1);
        if (P.isLight) return;
        const r = rng(77);
        const count = Math.round(520 * Math.min(1.6, w / 1920));
        for (let i = 0; i < count; i++) {
            const y = Math.pow(r(), 1.5) * h;
            const a = (1 - y / h) * (0.25 + r() * 0.75);
            const s = r() < 0.06 ? 1.25 : 0.4 + r() * 0.55;
            ctx.fillStyle = rgb(r() < 0.14 ? P.warm : P.star, a);
            ctx.beginPath();
            ctx.arc(r() * w, y, s, 0, TAU);
            ctx.fill();
        }
    }

    /* Sockets and glass of the sign's lamps. Returns where each lamp is. */
    function paintBulbs(canvas, P, inset, step, gap) {
        const { ctx, w, h } = fitCanvas(canvas, Math.min(g.devicePixelRatio || 1, 2));
        const pts = samplePolygon(decoPolygon(w, h, inset, step), gap);
        return pts.map((p, i) => {
            ctx.fillStyle = rgb(P.goldDeep);
            ctx.beginPath();
            ctx.arc(p[0], p[1], 5.6, 0, TAU);
            ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.beginPath();
            ctx.arc(p[0], p[1], 4.5, 0, TAU);
            ctx.fill();
            const gr = ctx.createRadialGradient(p[0] - 1.2, p[1] - 1.4, 0.3, p[0], p[1], 3.9);
            gr.addColorStop(0, 'rgba(255,244,214,0.95)');
            gr.addColorStop(0.5, rgb(P.gold, 0.8));
            gr.addColorStop(1, rgb(P.goldDeep, 0.9));
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.arc(p[0], p[1], 3.9, 0, TAU);
            ctx.fill();
            return { x: p[0], y: p[1], i };
        });
    }

    /* The floor of the sign: drifted snow, warm where the tree stands. */
    function paintSignFloor(canvas, P, treeX) {
        const { ctx, w, h } = fitCanvas(canvas, Math.min(g.devicePixelRatio || 1, 2));
        snowBank(ctx, w, h, h - 36, 7, 91, {
            top: P.signGroundTop, mid: P.signGroundMid, bottom: P.signGroundBottom,
            hi: P.signSnowHi, lo: P.signSnowLo, edge: 0.75
        });
        ctx.globalCompositeOperation = 'source-atop';
        const gr = ctx.createRadialGradient(treeX, h - 26, 10, treeX, h - 26, Math.min(w * 0.7, 420));
        gr.addColorStop(0, 'rgba(255,176,92,0.72)');
        gr.addColorStop(0.45, 'rgba(255,150,80,0.26)');
        gr.addColorStop(1, 'rgba(255,150,80,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
    }

    /* ---------- Small sprites shared by every live layer ---------- */

    function sprite(size, draw) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        draw(c.getContext('2d'), size);
        return c;
    }

    function radial(color, stops, size) {
        return sprite(size || 64, (x, s) => {
            const gr = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
            stops.forEach(p => gr.addColorStop(p[0], 'rgba(' + color + ',' + p[1] + ')'));
            x.fillStyle = gr;
            x.fillRect(0, 0, s, s);
        });
    }

    const sprites = {
        sprite,
        radial,
        dot: c => radial(c, [[0, 1], [0.55, 0.9], [1, 0]], 24),
        glow: c => radial(c, [[0, 1], [0.16, 0.52], [0.42, 0.14], [1, 0]], 96),
        core: c => radial(c, [[0, 1], [0.5, 0.75], [1, 0]], 24),
        glint: c => sprite(48, (x, s) => {
            const m = s / 2, R = s / 2;
            const gr = x.createRadialGradient(m, m, 0, m, m, R * 0.5);
            gr.addColorStop(0, 'rgba(' + c + ',0.9)');
            gr.addColorStop(1, 'rgba(' + c + ',0)');
            x.fillStyle = gr;
            x.fillRect(0, 0, s, s);
            x.fillStyle = 'rgba(' + c + ',1)';
            x.beginPath();
            x.moveTo(m, 0);
            x.quadraticCurveTo(m, m, s, m);
            x.quadraticCurveTo(m, m, m, s);
            x.quadraticCurveTo(m, m, 0, m);
            x.quadraticCurveTo(m, m, m, 0);
            x.fill();
        })
    };

    /* Bundled pictures live next to the other shared assets. */
    function assetUrl(name) {
        const path = 'src/shared/assets/seasonal/newyear/' + name;
        return g.chrome?.runtime?.getURL ? g.chrome.runtime.getURL(path) : '/' + path;
    }

    g.NyArt = {
        TAU, rng, clamp, lerp, mix, rgb, parse, palette, snowBank, marqueeGeometry,
        paintStars, paintBulbs, paintSignFloor, sprites, assetUrl
    };
})(window);
