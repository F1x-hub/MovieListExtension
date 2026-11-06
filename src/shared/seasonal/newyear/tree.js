/**
 * New Year season: the decorated fir, live part.
 *
 * The body is a pre-rendered picture whose needles are already warmed by its own
 * lights. This layer draws what moves: swinging ornaments (painted in ornaments.js),
 * twinkling lights, the film garland that keeps running around the tree, and the star.
 */
(function (g) {
    'use strict';

    const A = g.NyArt;
    const TAU = A.TAU, rng = A.rng, clamp = A.clamp, lerp = A.lerp, mix = A.mix, rgb = A.rgb;
    const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

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

        /* Ornaments in staggered rows, big low down and small near the top. The gifts hide
           the lower part of the tree in every layout, so they hang closer together above it. */
        const ornaments = [];
        let n = 0, rowT = 0.14, odd = false;
        const minD = 29;
        while (rowT < 1) {
            const wd = widthAt(rowT) * 0.86;
            const spacing = rowT < 0.74 ? 37 : 62;
            const cnt = Math.max(1, Math.round(wd * 2 / spacing));
            const step = wd * 2 / cnt;
            for (let i = 0; i < cnt; i++) {
                const shift = cnt > 1 ? (odd ? 0.24 : -0.24) * step : 0;
                const x = cx - wd + step * (i + 0.5) + shift + (r() - 0.5) * 6;
                const y = top + TH * rowT + (r() - 0.5) * 8;
                if (ornaments.some(o => Math.hypot(o.x - x, o.y - y) < minD)) continue;
                ornaments.push({
                    x, y, R: lerp(8.6, 14.6, rowT) * (0.9 + r() * 0.2), t: rowT,
                    seed: 500 + n,
                    len: 3 + r() * 5,
                    ph: r() * TAU, fq: 0.5 + r() * 0.8, spin: 0.4 + r() * 0.5,
                    gp: r() * TAU, gs: 0.35 + r() * 0.8
                });
                n++;
            }
            odd = !odd;
            rowT += lerp(0.086, 0.07, rowT);
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

    function fivePoint(x, cx, cy, R, r0, rot) {
        x.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = (rot || 0) - Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r0 : R;
            if (i) x.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q);
            else x.moveTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q);
        }
        x.closePath();
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

        const ornaments = g.NyOrnaments.dress(L.ornaments).map(o => Object.assign(o, {
            th: (Math.random() - 0.5) * 0.1, om: 0, sprite: g.NyOrnaments.sprite(o, scale)
        }));
        /* A lamp that an ornament hangs in front of stays behind it. */
        const lamps = L.lights.map(l => Object.assign({}, l, {
            behind: ornaments.some(o => Math.abs(l.x - o.x) < o.sprite.bodyHalfW * 0.92
                && l.y > o.y + o.sprite.bodyTop && l.y < o.y + o.sprite.bodyTop + o.sprite.bodyH)
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

        /* The sprigs lie over the moving glow, so they carry a still copy of it. Without it they
           read as dark patches on a lit tree. */
        let sprigsLit = null;
        function ensureSprigs() {
            const sprigs = opts.sprigs;
            if (sprigsLit || !sprigs?.complete || !sprigs.naturalWidth) return;
            const light = document.createElement('canvas');
            light.width = canvas.width;
            light.height = canvas.height;
            const lx = light.getContext('2d');
            lx.setTransform(dpr, 0, 0, dpr, 0, 0);
            lx.globalCompositeOperation = 'lighter';
            lamps.forEach(l => {
                lx.globalAlpha = 0.66 * (0.34 + 0.66 * Math.max(0, l.z)) * 0.74;
                const gs = (20 + 17 * 0.66) * l.s;
                lx.drawImage(glow, l.x - gs / 2, l.y - gs / 2, gs, gs);
            });
            lx.setTransform(1, 0, 0, 1, 0, 0);
            lx.globalAlpha = 1;
            lx.globalCompositeOperation = 'destination-in';
            lx.drawImage(sprigs, 0, 0, light.width, light.height);
            sprigsLit = document.createElement('canvas');
            sprigsLit.width = canvas.width;
            sprigsLit.height = canvas.height;
            const sx = sprigsLit.getContext('2d');
            sx.drawImage(sprigs, 0, 0, sprigsLit.width, sprigsLit.height);
            sx.globalCompositeOperation = 'lighter';
            sx.drawImage(light, 0, 0);
        }

        let ign = opts.lit ? 1.2 : 0, starHit = !!opts.lit, filmU = 0;
        const texW = tex.width;

        function drawOrnament(o, t) {
            const c = Math.cos(o.th), s = Math.sin(o.th), sp = o.sprite;
            let fx = 1;
            if (sp.flat) fx = 0.35 + 0.65 * Math.abs(Math.cos(t * o.spin + o.ph));
            ctx.setTransform(dpr * c * fx, dpr * s * fx, -dpr * s, dpr * c, dpr * o.x, dpr * o.y);
            ctx.drawImage(sp.canvas, -sp.ox, -sp.oy, sp.w, sp.h);
        }

        function lampPower(l, t, wave, on) {
            const hit = clamp(1 - (l.t - wave) / 0.2, 0, 1);
            return (0.66 + 0.2 * Math.sin(t * l.sp + l.ph) + 0.14 * Math.sin(t * 1.1 - l.t * 16)) * on + hit * 0.9;
        }

        function drawLampCore(l, v, f) {
            ctx.globalAlpha = Math.min(1, (0.45 + 0.55 * v) * f);
            const cs = (3.8 + 2.2 * v) * l.s;
            ctx.drawImage(core, l.x - cs / 2, l.y - cs / 2, cs, cs);
        }

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
            const wave = 1 - ign * 1.08;

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
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            /* Lights. A slow wave runs along the wire; each lamp also breathes on its own. Their
               glow goes on the needles behind the ornaments: over them it would wash every
               color toward yellow. */
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < lamps.length; i++) {
                const l = lamps[i];
                const on = clamp((l.t - wave) / 0.05, 0, 1);
                if (on <= 0) continue;
                const v = lampPower(l, t, wave, on);
                const f = 0.34 + 0.66 * Math.max(0, l.z);
                ctx.globalAlpha = Math.min(1, v * f * 0.74);
                const gs = (20 + 17 * v) * l.s;
                ctx.drawImage(glow, l.x - gs / 2, l.y - gs / 2, gs, gs);
                if (l.behind) drawLampCore(l, v, f);
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';

            /* Ornaments hang like pendulums; the cursor and a slow breeze keep them moving.
               Glass hangs among the sprigs; the figures hang in front, so none of them loses a
               halo or a hat. */
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
                if (!o.sprite.inFront) drawOrnament(o, t);
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ensureSprigs();
            if (sprigsLit) ctx.drawImage(sprigsLit, 0, 0, W, H);
            for (let i = 0; i < ornaments.length; i++) {
                if (ornaments[i].sprite.inFront) drawOrnament(ornaments[i], t);
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            /* Before the lights come on, everything above the wave stays in the dark. */
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

            /* The lamps themselves sit on the branches in front. */
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < lamps.length; i++) {
                const l = lamps[i];
                const on = clamp((l.t - wave) / 0.05, 0, 1);
                if (on <= 0 || l.behind) continue;
                drawLampCore(l, lampPower(l, t, wave, on), 0.34 + 0.66 * Math.max(0, l.z));
            }

            /* Glass catches the light now and then. */
            ctx.globalAlpha = 1;
            for (let i = 0; i < ornaments.length; i++) {
                const o = ornaments[i];
                if (!o.sprite.glass) continue;
                const v = Math.sin(t * o.gs + o.gp);
                if (v > 0.965 && o.t * 1 > wave) {
                    const q = (v - 0.965) / 0.035, size = (5 + q * 15) * k;
                    const cy = o.y + o.sprite.bodyTop + o.R * 0.55;
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
