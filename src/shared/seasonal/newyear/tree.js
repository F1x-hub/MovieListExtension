/**
 * New Year season: the decorated fir, live part.
 *
 * The body is a pre-rendered picture whose needles are already warmed by its own
 * lights. This layer draws what moves: swinging ornaments, twinkling lights, the
 * film garland that keeps running around the tree, and the star.
 */
(function (g) {
    'use strict';

    const A = g.NyArt;
    const TAU = A.TAU, rng = A.rng, clamp = A.clamp, lerp = A.lerp, mix = A.mix, rgb = A.rgb;
    const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

    const ORNAMENT_COLORS = {
        red: [198, 24, 40],
        gold: [228, 168, 54],
        ice: [172, 198, 228],
        blue: [26, 62, 150]
    };

    /* ---------- Where everything hangs: shared with the art generator ---------- */

    const BASE_W = 380, BASE_H = 476;
    const firWidth = (t, hw) => hw * (Math.pow(t, 0.92) * 0.97 + 0.03);
    let base = null;
    const scaled = {};

    function baseLayout() {
        if (base) return base;
        const cx = BASE_W / 2, top = 92, bottom = BASE_H - 12, hw = 152, TH = bottom - top;
        const r = rng(9091);
        const widthAt = t => firWidth(t, hw);

        /* Lights sit on a wire wound around the cone, so they read as a real string. */
        const lights = [];
        const count = 250, turns = 12;
        for (let i = 0; i < count; i++) {
            const u = (i + 0.5) / count;
            const t = 0.03 + 0.97 * Math.sqrt(u);
            const th = t * turns * TAU + r() * 0.3;
            const z = Math.cos(th);
            if (z < -0.3) continue;
            const wd = widthAt(t) * 0.92;
            lights.push({
                x: cx + Math.sin(th) * wd + (r() - 0.5) * 6,
                y: top + TH * t + z * wd * 0.1 + (r() - 0.5) * 6,
                z, t, ph: r() * TAU, sp: 0.5 + r() * 1.5, s: 0.72 + r() * 0.5
            });
        }

        /* Ornaments in staggered rows, big low down and small near the top. */
        const ornaments = [];
        const cycle = ['red', 'gold', 'red', 'ice', 'gold', 'red', 'blue', 'gold'];
        const decos = ['plain', 'band', 'plain', 'meridian', 'plain', 'stars', 'plain', 'frost'];
        let n = 0, rowT = 0.15;
        const minD = 31;
        while (rowT < 1) {
            const wd = widthAt(rowT) * 0.86;
            const cnt = Math.max(1, Math.round(wd * 2 / (minD * 1.22)));
            for (let i = 0; i < cnt; i++) {
                const x = cx + lerp(-wd, wd, (i + 0.5 + (r() - 0.5) * 0.55) / cnt);
                const y = top + TH * rowT + (r() - 0.5) * 12;
                if (ornaments.some(o => Math.hypot(o.x - x, o.y - y) < minD)) continue;
                const R = lerp(8.6, 14.6, rowT) * (0.9 + r() * 0.2);
                const roll = r();
                const type = rowT < 0.2 ? 'ball' : roll < 0.12 ? 'icicle' : roll < 0.22 ? 'cone' : roll < 0.3 ? 'star' : 'ball';
                ornaments.push({
                    x, y, R, type, t: rowT,
                    color: ORNAMENT_COLORS[cycle[n % cycle.length]],
                    deco: decos[(n * 3) % decos.length],
                    seed: 500 + n,
                    len: 3 + r() * 5,
                    ph: r() * TAU, fq: 0.5 + r() * 0.8, spin: 0.4 + r() * 0.5,
                    gp: r() * TAU, gs: 0.35 + r() * 0.8
                });
                n++;
            }
            rowT += lerp(0.082, 0.06, rowT);
        }
        ornaments.sort((a, b) => a.y - b.y);
        base = { cx, top, base: bottom, hw, TH, lights, ornaments, needle: 15, gap: 8.2, starY: top - 13, starR: 29 };
        return base;
    }

    function treeLayout(W) {
        const key = String(W);
        if (scaled[key]) return scaled[key];
        const b = baseLayout(), k = W / BASE_W;
        const hw = b.hw * k;
        return (scaled[key] = {
            k, hw,
            cx: b.cx * k, top: b.top * k, base: b.base * k, TH: b.TH * k,
            widthAt: t => firWidth(t, hw),
            needle: b.needle * k, gap: b.gap * k, starY: b.starY * k, starR: b.starR * k,
            lights: b.lights.map(l => Object.assign({}, l, { x: l.x * k, y: l.y * k, s: l.s * k })),
            ornaments: b.ornaments.map(o => Object.assign({}, o, { x: o.x * k, y: o.y * k, R: o.R * k, len: o.len * k }))
        });
    }

    /* ---------- Ornaments ---------- */

    function fivePoint(x, cx, cy, R, r0, rot) {
        x.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = (rot || 0) - Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r0 : R;
            if (i) x.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q);
            else x.moveTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q);
        }
        x.closePath();
    }

    function ball(x, cy, R, o) {
        const c = o.color, r = rng(o.seed);
        const gr = x.createRadialGradient(-R * 0.36, cy - R * 0.42, R * 0.05, 0, cy, R * 1.14);
        gr.addColorStop(0, rgb(mix(c, WHITE, 0.78)));
        gr.addColorStop(0.17, rgb(mix(c, WHITE, 0.32)));
        gr.addColorStop(0.46, rgb(c));
        gr.addColorStop(0.82, rgb(mix(c, BLACK, 0.56)));
        gr.addColorStop(1, rgb(mix(c, BLACK, 0.8)));
        x.fillStyle = gr;
        x.beginPath();
        x.arc(0, cy, R, 0, TAU);
        x.fill();

        x.save();
        x.beginPath();
        x.arc(0, cy, R, 0, TAU);
        x.clip();
        const ink = c === ORNAMENT_COLORS.gold ? 'rgba(120,28,30,0.85)' : 'rgba(255,214,128,0.95)';
        if (o.deco === 'band') {
            x.strokeStyle = ink;
            x.lineWidth = R * 0.11;
            [-0.3, 0.3].forEach(q => {
                x.beginPath();
                x.ellipse(0, cy + R * q, R * 1.02, R * 0.22, 0, 0.1, Math.PI - 0.1);
                x.stroke();
            });
            x.fillStyle = ink;
            for (let i = -3; i <= 3; i++) {
                const a = i * 0.42;
                x.beginPath();
                x.arc(Math.sin(a) * R * 0.98, cy + Math.cos(a) * R * 0.22 + R * 0.02, R * 0.07, 0, TAU);
                x.fill();
            }
        } else if (o.deco === 'meridian') {
            x.strokeStyle = ink;
            x.lineWidth = R * 0.075;
            for (let i = 1; i <= 3; i++) {
                x.beginPath();
                x.ellipse(0, cy, Math.sin(i * 0.5) * R, R, 0, 0, TAU);
                x.stroke();
            }
            x.beginPath();
            x.moveTo(0, cy - R);
            x.lineTo(0, cy + R);
            x.stroke();
        } else if (o.deco === 'stars') {
            x.fillStyle = ink;
            for (let i = 0; i < 7; i++) {
                const a = r() * TAU, q = Math.sqrt(r()) * R * 0.86;
                fivePoint(x, Math.cos(a) * q, cy + Math.sin(a) * q, R * 0.17, R * 0.07, r());
                x.fill();
            }
        } else if (o.deco === 'frost') {
            x.strokeStyle = 'rgba(255,255,255,0.72)';
            x.lineWidth = R * 0.05;
            x.lineCap = 'round';
            for (let i = 0; i < 5; i++) {
                const a = i * 1.26 + 0.4;
                x.beginPath();
                x.moveTo(0, cy);
                x.quadraticCurveTo(Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.1, Math.cos(a + 0.5) * R * 0.92, cy + Math.sin(a + 0.5) * R * 0.92);
                x.stroke();
            }
        }
        /* Warm bounce from the lights around it. */
        const b = x.createRadialGradient(R * 0.5, cy + R * 0.62, 0, R * 0.5, cy + R * 0.62, R * 0.9);
        b.addColorStop(0, 'rgba(255,196,120,0.58)');
        b.addColorStop(1, 'rgba(255,196,120,0)');
        x.fillStyle = b;
        x.fillRect(-R, cy - R, R * 2, R * 2);
        x.restore();

        /* A curved window of light, the thing that makes glass read as glass. */
        x.save();
        x.translate(-R * 0.42, cy - R * 0.46);
        x.rotate(-0.72);
        x.fillStyle = 'rgba(255,255,255,0.92)';
        x.beginPath();
        x.ellipse(0, 0, R * 0.27, R * 0.13, 0, 0, TAU);
        x.fill();
        x.restore();
        x.fillStyle = 'rgba(255,255,255,0.55)';
        x.beginPath();
        x.arc(R * 0.2, cy - R * 0.66, R * 0.055, 0, TAU);
        x.fill();
        x.strokeStyle = 'rgba(255,226,180,0.42)';
        x.lineWidth = Math.max(0.5, R * 0.05);
        x.beginPath();
        x.arc(0, cy, R - 0.5, 0.15 * Math.PI, 0.55 * Math.PI);
        x.stroke();
    }

    function icicle(x, cy, R, o) {
        const L = R * 3.6, W = R * 0.66;
        x.beginPath();
        x.moveTo(-W * 0.45, cy - R);
        x.bezierCurveTo(-W, cy - R + L * 0.16, -W * 0.62, cy - R + L * 0.5, 0, cy - R + L);
        x.bezierCurveTo(W * 0.62, cy - R + L * 0.5, W, cy - R + L * 0.16, W * 0.45, cy - R);
        x.closePath();
        const gr = x.createLinearGradient(-W, 0, W, 0);
        gr.addColorStop(0, '#5f86c2');
        gr.addColorStop(0.32, '#eaf5ff');
        gr.addColorStop(0.62, '#a8c8ee');
        gr.addColorStop(1, '#3f629f');
        x.fillStyle = gr;
        x.fill();
        x.save();
        x.clip();
        x.strokeStyle = 'rgba(255,255,255,0.72)';
        x.lineWidth = Math.max(0.5, R * 0.09);
        for (let i = 0; i < 7; i++) {
            const y = cy - R + i * L / 7;
            x.beginPath();
            x.moveTo(-W, y + R * 0.3);
            x.quadraticCurveTo(0, y + R * 0.1, W, y - R * 0.3);
            x.stroke();
        }
        x.restore();
    }

    function pineCone(x, cy, R) {
        const L = R * 2.5, W = R * 0.92;
        const top = cy - R;
        x.beginPath();
        x.ellipse(0, top + L / 2, W, L / 2, 0, 0, TAU);
        const gr = x.createLinearGradient(-W, 0, W, 0);
        gr.addColorStop(0, '#6d4312');
        gr.addColorStop(0.4, '#f4cf7c');
        gr.addColorStop(1, '#5c360d');
        x.fillStyle = gr;
        x.fill();
        x.save();
        x.clip();
        const rows = 7;
        for (let i = rows; i >= 0; i--) {
            const y = top + i * L / rows;
            const cols = 5;
            for (let c = -cols; c <= cols; c++) {
                const px = (c + (i % 2) * 0.5) * W * 0.46;
                x.beginPath();
                x.arc(px, y, W * 0.27, 0, Math.PI);
                x.lineWidth = Math.max(0.4, R * 0.05);
                x.strokeStyle = 'rgba(70,38,6,0.72)';
                x.stroke();
                x.beginPath();
                x.arc(px, y + 0.5, W * 0.21, 0.5, Math.PI - 0.5);
                x.strokeStyle = 'rgba(255,240,190,0.55)';
                x.stroke();
            }
        }
        x.restore();
    }

    function flatStar(x, cy, R) {
        const RR = R * 1.26;
        for (let i = 0; i < 10; i++) {
            const a0 = -Math.PI / 2 + i * Math.PI / 5, a1 = a0 + Math.PI / 5;
            const r0 = i % 2 ? RR * 0.44 : RR, r1 = i % 2 ? RR : RR * 0.44;
            x.fillStyle = i % 2 ? '#fff0bb' : '#cf8f25';
            x.beginPath();
            x.moveTo(0, cy);
            x.lineTo(Math.cos(a0) * r0, cy + Math.sin(a0) * r0);
            x.lineTo(Math.cos(a1) * r1, cy + Math.sin(a1) * r1);
            x.closePath();
            x.fill();
        }
    }

    function ornamentSprite(o, scale) {
        const R = o.R;
        const capH = o.type === 'star' ? 0 : R * 0.36;
        const tall = o.type === 'icicle' ? R * 3.6 : o.type === 'cone' ? R * 2.5 : o.type === 'star' ? R * 2.6 : R * 2;
        const sw = Math.ceil((o.type === 'star' ? R * 1.3 : R) * 2 + 10), sh = Math.ceil(o.len + capH + tall + 8);
        const c = document.createElement('canvas');
        c.width = Math.ceil(sw * scale);
        c.height = Math.ceil(sh * scale);
        const x = c.getContext('2d');
        x.scale(scale, scale);
        x.translate(sw / 2, 2);

        x.strokeStyle = 'rgba(240,222,170,0.8)';
        x.lineWidth = 0.6;
        x.beginPath();
        x.moveTo(0, 0);
        x.lineTo(0, o.len + 1);
        x.stroke();

        const cy = o.len + capH + (o.type === 'star' ? R * 1.3 : R) - 1;
        if (o.type === 'ball') ball(x, cy, R, o);
        else if (o.type === 'icicle') icicle(x, cy, R, o);
        else if (o.type === 'cone') pineCone(x, cy, R);
        else flatStar(x, cy, R);

        if (capH) {
            const cw = o.type === 'icicle' ? R * 0.62 : R * 0.64;
            const gr = x.createLinearGradient(-cw / 2, 0, cw / 2, 0);
            gr.addColorStop(0, '#7a5417');
            gr.addColorStop(0.42, '#ffe7ac');
            gr.addColorStop(1, '#6b4712');
            x.fillStyle = gr;
            x.fillRect(-cw / 2, o.len, cw, capH);
            x.fillStyle = 'rgba(60,34,4,0.5)';
            for (let i = 1; i < 3; i++) x.fillRect(-cw / 2, o.len + capH * i / 3, cw, Math.max(0.4, capH * 0.08));
        }
        return { canvas: c, ox: sw / 2, oy: 2, w: sw, h: sh, flat: o.type === 'star' };
    }

    /* ---------- The film garland: one long texture mapped onto slices of a spiral ---------- */

    function filmTexture() {
        const fw = 36, fh = 30, frames = 42;
        const c = document.createElement('canvas');
        c.width = fw * frames;
        c.height = fh;
        const x = c.getContext('2d');
        const tones = [[255, 186, 84], [232, 72, 84], [255, 218, 132], [92, 196, 240], [255, 142, 72], [120, 220, 170], [190, 136, 240]];
        x.fillStyle = '#120b08';
        x.fillRect(0, 0, c.width, fh);
        const r = rng(71);
        for (let i = 0; i < frames; i++) {
            const col = tones[i % tones.length];
            const px = i * fw;
            const gr = x.createLinearGradient(0, 6, 0, fh - 6);
            gr.addColorStop(0, rgb(mix(col, WHITE, 0.35)));
            gr.addColorStop(0.55, rgb(col));
            gr.addColorStop(1, rgb(mix(col, BLACK, 0.5)));
            x.fillStyle = gr;
            x.fillRect(px + 2.5, 6.5, fw - 5, fh - 13);
            /* A hint of a picture in each frame: a horizon and a bright spot. */
            x.fillStyle = rgb(mix(col, BLACK, 0.62), 0.75);
            x.fillRect(px + 2.5, fh - 13, fw - 5, 6.5);
            x.fillStyle = 'rgba(255,250,235,0.8)';
            x.beginPath();
            x.arc(px + 8 + r() * 20, 11 + r() * 3, 2.1, 0, TAU);
            x.fill();
            x.fillStyle = 'rgba(255,238,206,0.92)';
            for (let p = 0; p < 4; p++) {
                x.fillRect(px + 2 + p * 9, 1.4, 4.6, 2.8);
                x.fillRect(px + 2 + p * 9, fh - 4.2, 4.6, 2.8);
            }
        }
        x.fillStyle = 'rgba(255,214,140,0.9)';
        x.fillRect(0, 0, c.width, 0.9);
        x.fillRect(0, fh - 0.9, c.width, 0.9);
        return c;
    }

    function filmSlices(L) {
        const out = [];
        const turns = 3.25, step = 3 * L.k;
        let th = 0.35, u = 0;
        const total = turns * TAU;
        while (th < total) {
            const s = th / total;
            const t = lerp(0.1, 0.985, Math.pow(s, 0.86));
            const rr = L.widthAt(t) * 0.99 + 1;
            const w = lerp(8, 18, t) * L.k;
            const c0 = Math.cos(th), s0 = Math.sin(th);
            const next = th + step / Math.max(rr, 6);
            const c1 = Math.cos(next), s1 = Math.sin(next);
            const y0 = L.top + L.TH * t + rr * c0 * 0.15;
            const y1 = L.top + L.TH * t + rr * c1 * 0.15 + (next - th) / total * L.TH * 0.86;
            const du = step * 30 / w;
            if (c0 > -0.08) {
                out.push({
                    ax: L.cx + rr * s0, ay: y0 - w / 2,
                    bx: L.cx + rr * s1, by: y1 - w / 2,
                    dx: L.cx + (rr + w * 0.2) * s0, dy: y0 + w / 2,
                    u, du, a: clamp(c0 * 3.6 + 0.28, 0, 1) * (0.78 + 0.22 * c0)
                });
            }
            u += du;
            th = next;
        }
        return out;
    }

    /* ---------- The live layer ---------- */

    function TreeLive(canvas, opts) {
        const S = A.sprites;
        const W = canvas.clientWidth, H = canvas.clientHeight;
        const dpr = Math.min(g.devicePixelRatio || 1, 2);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        const ctx = canvas.getContext('2d');
        const L = treeLayout(W), k = L.k;
        const scale = Math.max(2, dpr * 1.5);

        const ornaments = L.ornaments.map(o => Object.assign({}, o, {
            th: (Math.random() - 0.5) * 0.1, om: 0, sprite: ornamentSprite(o, scale)
        }));

        const tex = filmTexture();
        const slices = filmSlices(L);
        const glow = S.glow('255,196,112'), core = S.core('255,244,214');
        const halo = S.glow('255,206,132'), flare = S.glint('255,240,205'), glint = S.glint('255,255,255');

        const starSprite = S.sprite(Math.ceil(L.starR * 2.4 * scale), (x, s) => {
            x.translate(s / 2, s / 2);
            x.scale(scale, scale);
            const R = L.starR;
            for (let i = 0; i < 10; i++) {
                const a0 = -Math.PI / 2 + i * Math.PI / 5, a1 = a0 + Math.PI / 5;
                const r0 = i % 2 ? R * 0.42 : R, r1 = i % 2 ? R : R * 0.42;
                const gr = x.createLinearGradient(0, 0, Math.cos(a0 + 0.3) * R, Math.sin(a0 + 0.3) * R);
                if (i % 2) { gr.addColorStop(0, '#fff8d8'); gr.addColorStop(1, '#ffd777'); }
                else { gr.addColorStop(0, '#eeb244'); gr.addColorStop(1, '#a86d14'); }
                x.fillStyle = gr;
                x.beginPath();
                x.moveTo(0, 0);
                x.lineTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
                x.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
                x.closePath();
                x.fill();
            }
            fivePoint(x, 0, 0, R, R * 0.42);
            x.strokeStyle = 'rgba(255,246,214,0.85)';
            x.lineWidth = 0.7;
            x.stroke();
        });

        /* The unlit tree: its silhouette in dark, revealed from the ground up when it lights. */
        let dark = null, shade = null;
        function ensureDark(body) {
            if (dark || !body || !body.complete || !body.naturalWidth) return;
            dark = document.createElement('canvas');
            dark.width = canvas.width;
            dark.height = canvas.height;
            const x = dark.getContext('2d');
            x.drawImage(body, 0, 0, dark.width, dark.height);
            x.globalCompositeOperation = 'source-in';
            x.fillStyle = 'rgb(3,8,16)';
            x.fillRect(0, 0, dark.width, dark.height);
            shade = document.createElement('canvas');
            shade.width = canvas.width;
            shade.height = canvas.height;
        }

        let ign = opts.lit ? 1.2 : 0, starHit = !!opts.lit, filmU = 0;
        const texW = tex.width;

        function draw(t, dt, P) {
            const body = opts.body;
            if (ign < 1.2) {
                ign += dt / 2.6;
                if (!starHit && ign > 1.02) {
                    starHit = true;
                    if (opts.onStar) opts.onStar(L.cx, L.starY);
                }
            }
            filmU += dt * 26;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);

            /* Garland shadow, then the running film. */
            for (let i = 0; i < slices.length; i++) {
                const q = slices[i];
                ctx.globalAlpha = q.a;
                const ux = (q.bx - q.ax) / q.du, uy = (q.by - q.ay) / q.du;
                const vx = (q.dx - q.ax) / 30, vy = (q.dy - q.ay) / 30;
                const sx = (q.u - filmU % texW + texW * 8) % (texW - q.du - 1);
                ctx.setTransform(ux * dpr, uy * dpr, vx * dpr, vy * dpr, q.ax * dpr, q.ay * dpr);
                ctx.drawImage(tex, sx, 0, q.du, 30, 0, 0, q.du * 1.14, 30);
            }
            ctx.globalAlpha = 1;

            /* Ornaments hang like pendulums; the cursor and a slow breeze keep them moving. */
            for (let i = 0; i < ornaments.length; i++) {
                const o = ornaments[i];
                let acc = -34 * o.th - 1.15 * o.om + Math.sin(t * o.fq + o.ph) * 0.5;
                if (P.seen) {
                    const dx = P.x - o.x, dy = P.y - o.y - o.R, d = Math.hypot(dx, dy), RR = 96 * k;
                    if (d < RR) {
                        const q = 1 - d / RR;
                        /* A positive angle swings the ornament left, so a push to the right is negative. */
                        acc -= clamp(P.vx, -1100, 1100) * 0.24 * q * q;
                    }
                }
                o.om += acc * dt;
                o.th = clamp(o.th + o.om * dt, -0.95, 0.95);
                const c = Math.cos(o.th), s = Math.sin(o.th), sp = o.sprite;
                let fx = 1;
                if (sp.flat) fx = 0.35 + 0.65 * Math.abs(Math.cos(t * o.spin + o.ph));
                ctx.setTransform(dpr * c * fx, dpr * s * fx, -dpr * s, dpr * c, dpr * o.x, dpr * o.y);
                ctx.drawImage(sp.canvas, -sp.ox, -sp.oy, sp.w, sp.h);
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (opts.sprigs?.complete && opts.sprigs.naturalWidth) ctx.drawImage(opts.sprigs, 0, 0, W, H);

            /* Before the lights come on, everything above the wave stays in the dark. */
            const wave = 1 - ign * 1.08;
            if (ign < 1.05 && body) {
                ensureDark(body);
                if (dark) {
                    const x = shade.getContext('2d');
                    x.globalCompositeOperation = 'source-over';
                    x.setTransform(1, 0, 0, 1, 0, 0);
                    x.clearRect(0, 0, shade.width, shade.height);
                    x.drawImage(dark, 0, 0);
                    x.globalCompositeOperation = 'destination-in';
                    const yy = (L.top + L.TH * wave) * dpr, soft = 70 * dpr * k;
                    const gr = x.createLinearGradient(0, yy - soft, 0, yy + soft);
                    gr.addColorStop(0, 'rgba(0,0,0,0.86)');
                    gr.addColorStop(1, 'rgba(0,0,0,0)');
                    x.fillStyle = gr;
                    x.fillRect(0, 0, shade.width, shade.height);
                    ctx.drawImage(shade, 0, 0, W, H);
                }
            }

            /* Lights. A slow wave runs along the wire; each lamp also breathes on its own. */
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < L.lights.length; i++) {
                const l = L.lights[i];
                const on = clamp((l.t - wave) / 0.05, 0, 1);
                if (on <= 0) continue;
                const hit = clamp(1 - (l.t - wave) / 0.2, 0, 1);
                const front01 = Math.max(0, l.z);
                const v = (0.66 + 0.2 * Math.sin(t * l.sp + l.ph) + 0.14 * Math.sin(t * 1.1 - l.t * 16)) * on + hit * 0.9;
                const f = 0.34 + 0.66 * front01;
                ctx.globalAlpha = Math.min(1, v * f * 0.74);
                const gs = (20 + 17 * v) * l.s;
                ctx.drawImage(glow, l.x - gs / 2, l.y - gs / 2, gs, gs);
                ctx.globalAlpha = Math.min(1, (0.45 + 0.55 * v) * f);
                const cs = (3.8 + 2.2 * v) * l.s;
                ctx.drawImage(core, l.x - cs / 2, l.y - cs / 2, cs, cs);
            }

            /* Glass catches the light now and then. */
            ctx.globalAlpha = 1;
            for (let i = 0; i < ornaments.length; i++) {
                const o = ornaments[i];
                if (o.type !== 'ball') continue;
                const v = Math.sin(t * o.gs + o.gp);
                if (v > 0.965 && o.t * 1 > wave) {
                    const q = (v - 0.965) / 0.035, size = (5 + q * 15) * k;
                    const cy = o.y + o.len + o.R * 0.36 + o.R * 0.55;
                    ctx.globalAlpha = q;
                    ctx.drawImage(glint, o.x - o.R * 0.42 - size / 2, cy - o.R * 0.46 - size / 2, size, size);
                }
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';

            /* The star lights last, with a flash that settles into a slow breathing. */
            const starOn = clamp((ign - 0.98) / 0.06, 0, 1);
            const flash = clamp(1 - (ign - 1.02) / 0.16, 0, 1) * (ign > 1.02 ? 1 : 0);
            const R = L.starR, sx = L.cx, sy = L.starY;
            ctx.globalAlpha = 0.42 + 0.58 * starOn;
            ctx.drawImage(starSprite, sx - R * 1.2, sy - R * 1.2 + Math.sin(t * 0.7) * 0.4, R * 2.4, R * 2.4);
            ctx.globalAlpha = 1;
            if (starOn > 0) {
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = starOn * (0.62 + 0.16 * Math.sin(t * 1.9)) + flash * 0.4;
                const hs = R * (5.2 + flash * 4.5);
                ctx.drawImage(halo, sx - hs / 2, sy - hs / 2, hs, hs);
                ctx.translate(sx, sy);
                ctx.rotate(t * 0.14);
                ctx.globalAlpha = starOn * (0.5 + 0.28 * Math.sin(t * 1.3 + 1)) + flash * 0.5;
                const fl = R * (2.3 + 0.35 * Math.sin(t * 1.7) + flash * 1.8);
                ctx.drawImage(flare, -fl, -fl * 0.08, fl * 2, fl * 0.16);
                ctx.rotate(Math.PI / 2);
                ctx.drawImage(flare, -fl * 0.74, -fl * 0.065, fl * 1.48, fl * 0.13);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.globalCompositeOperation = 'source-over';
            }
            ctx.globalAlpha = 1;
        }

        return { draw, isLit: () => ign > 1 };
    }

    g.NyTree = { BASE_W, BASE_H, firWidth, treeLayout, TreeLive, fivePoint };
})(window);
