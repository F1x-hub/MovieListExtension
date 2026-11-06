/**
 * Art generator, browser side: paints the season's static pictures needle by
 * needle. Runs only in scripts/generate-newyear-art.cjs; nothing here ships.
 */
(function (g) {
    'use strict';

    const A = g.NyArt, G = g.NyGifts;
    const TAU = A.TAU, rng = A.rng, clamp = A.clamp, lerp = A.lerp, mix = A.mix, rgb = A.rgb;
    const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
    const PITCH = G.PITCH;

    /* ---------- One bough: a curved stem carrying individual needles ---------- */

    function firTone(P, v) {
        v = clamp(v, 0, 1);
        return v < 0.5 ? mix(P.dark, P.mid, v * 2) : mix(P.mid, P.hi, (v - 0.5) * 2);
    }

    function bough(ctx, b) {
        const P = b.P, r = b.r;
        const side = b.ex >= b.sx ? 1 : -1;
        const len = Math.hypot(b.ex - b.sx, b.ey - b.sy);
        const n = Math.max(3, Math.round(len / b.step));
        const bins = new Map();
        const lumps = [];

        ctx.strokeStyle = rgb(mix(b.stem || P.bark, P.core, 0.35));
        ctx.lineWidth = b.lw * (b.stemW || 1.7);
        ctx.beginPath();
        ctx.moveTo(b.sx, b.sy);
        ctx.quadraticCurveTo(b.qx, b.qy, b.ex, b.ey);
        ctx.stroke();

        let inRun = false;
        for (let i = 1; i <= n; i++) {
            const s = i / n, u = 1 - s;
            const x = u * u * b.sx + 2 * u * s * b.qx + s * s * b.ex;
            const y = u * u * b.sy + 2 * u * s * b.qy + s * s * b.ey;
            const tx = 2 * u * (b.qx - b.sx) + 2 * s * (b.ex - b.qx);
            const ty = 2 * u * (b.qy - b.sy) + 2 * s * (b.ey - b.qy);
            const ang = Math.atan2(ty, tx);
            const warm = b.warmAt ? b.warmAt(x, y) : 0;
            const count = s > 0.9 ? 3 : (b.dense || 3);

            for (let j = 0; j < count; j++) {
                const upper = j === 0;
                const dir = j === 2 ? (r() < 0.5 ? -1 : 1) * 0.35 : (upper ? -side : side);
                const a = ang + dir * (0.5 + r() * 0.5);
                const L = b.needle * (0.5 + 0.62 * Math.sin(Math.PI * clamp(s * 0.94 + 0.06, 0, 1))) * (0.78 + r() * 0.44);
                const nx = x + Math.cos(a) * L;
                const ny = y + Math.sin(a) * L + L * 0.16;
                const mx = x + Math.cos(a) * L * 0.55;
                const my = y + Math.sin(a) * L * 0.55 - L * 0.05;

                let v = b.tone + s * b.span + (r() - 0.5) * 0.3 + (upper ? 0.1 : -0.07);
                let col = firTone(P, v);
                if (b.rimAt && upper) {
                    const rim = b.rimAt(x, y, s);
                    if (rim > 0 && r() < rim) col = mix(col, P.rim, 0.55);
                }
                if (warm > 0) col = mix(col, P.warm, Math.min(0.75, warm) * (0.5 + s * 0.5));
                const key = ((col[0] >> 3) << 10) | ((col[1] >> 3) << 5) | (col[2] >> 3);
                let list = bins.get(key);
                if (!list) { list = []; bins.set(key, list); }
                list.push(x, y, mx, my, nx, ny);
            }

            if (b.snow > 0 && s > 0.16) {
                if (!inRun && r() < b.snow * 0.26) inRun = true;
                else if (inRun && r() < 0.13) inRun = false;
                if (inRun) {
                    /* Snow lies along the bough in long soft ridges, thickest midway. */
                    const size = b.needle * (0.24 + r() * 0.3) * (0.55 + 0.75 * Math.sin(Math.PI * s));
                    lumps.push(x, y - size * 0.26 - b.lw * 0.5, size * 1.5, size * (0.34 + r() * 0.2), warm, side > 0 ? ang : ang - Math.PI);
                }
            }
        }

        ctx.lineWidth = b.lw;
        bins.forEach((list, key) => {
            ctx.strokeStyle = 'rgb(' + (((key >> 10) & 31) << 3 | 4) + ',' + (((key >> 5) & 31) << 3 | 4) + ',' + ((key & 31) << 3 | 4) + ')';
            ctx.beginPath();
            for (let k = 0; k < list.length; k += 6) {
                ctx.moveTo(list[k], list[k + 1]);
                ctx.quadraticCurveTo(list[k + 2], list[k + 3], list[k + 4], list[k + 5]);
            }
            ctx.stroke();
        });

        if (lumps.length) {
            const blob = (dy, sx, sy) => {
                for (let k = 0; k < lumps.length; k += 6) {
                    const rx = lumps[k + 2] * sx, ry = lumps[k + 3] * sy, x = lumps[k], y = lumps[k + 1] + lumps[k + 3] * dy;
                    ctx.moveTo(x + Math.cos(lumps[k + 5]) * rx, y + Math.sin(lumps[k + 5]) * rx);
                    ctx.ellipse(x, y, rx, ry, lumps[k + 5], 0, TAU);
                }
            };
            ctx.fillStyle = rgb(P.snowLo, 0.8);
            ctx.beginPath();
            blob(0.75, 1.02, 1);
            ctx.fill();
            ctx.fillStyle = rgb(mix(P.snowMid, P.snowLo, 0.2));
            ctx.beginPath();
            blob(0, 1, 1);
            ctx.fill();
            for (let k = 0; k < lumps.length; k += 6) {
                const tone = mix(P.snowHi, P.snowMid, r() * 0.55);
                ctx.fillStyle = rgb(mix(tone, P.warm, Math.min(0.42, lumps[k + 4] * 0.5)));
                ctx.beginPath();
                ctx.ellipse(lumps[k], lumps[k + 1] - lumps[k + 3] * 0.22, lumps[k + 2] * 0.8, lumps[k + 3] * 0.6, lumps[k + 5], 0, TAU);
                ctx.fill();
            }
        }
    }

    /* ---------- A whole fir: rings of boughs from the ground up ---------- */

    const firWidth = g.NyTree.firWidth;

    function paintFir(ctx, o) {
        const P = o.P, r = rng(o.seed), H = o.base - o.top, cx = o.cx, hw = o.hw;
        const gap = o.gap || Math.max(6, H / 42);
        const levels = Math.round(H / gap);
        const needle = o.needle || clamp(hw * 0.17, 3.6, 22);
        const step = o.step || Math.max(1.1, needle * 0.13);
        const lw = o.lw || clamp(needle * 0.058, 0.42, 1.1);
        ctx.lineCap = 'round';

        ctx.fillStyle = rgb(P.core);
        ctx.beginPath();
        ctx.moveTo(cx, o.top);
        for (let i = 1; i <= 26; i++) {
            const t = i / 26;
            ctx.lineTo(cx + firWidth(t, hw) * 0.62 * (0.9 + r() * 0.2), o.top + H * t);
        }
        for (let i = 26; i >= 1; i--) {
            const t = i / 26;
            ctx.lineTo(cx - firWidth(t, hw) * 0.62 * (0.9 + r() * 0.2), o.top + H * t);
        }
        ctx.closePath();
        ctx.fill();
        if (o.afterCore) o.afterCore(ctx);

        for (let i = levels; i >= 0; i--) {
            const t = i / levels;
            const y = o.top + H * t;
            const W = firWidth(t, hw) * (0.88 + r() * 0.24);
            const rings = t < 0.07 ? [1] : t < 0.22 ? [1, 0.58] : [1, 0.74, 0.46];
            rings.forEach(k => {
                [-1, 1].forEach(side => {
                    if (k < 1 && r() < 0.16) return;
                    const len = W * k * (0.86 + r() * 0.26);
                    if (len < 1.5) return;
                    const sy = y + (1 - k) * gap * 0.9 + r() * gap * 0.5;
                    const sx = cx + side * (1 - k) * W * 0.04;
                    const droop = len * (0.17 + 0.32 * t) * (0.78 + r() * 0.44);
                    const lit = side === (o.lightSide || 1);
                    bough(ctx, {
                        P, r, needle: needle * (0.72 + 0.28 * Math.min(1, t * 1.6)), step, lw,
                        sx, sy,
                        qx: sx + side * len * 0.52, qy: sy + droop * 0.12,
                        ex: sx + side * len, ey: sy + droop,
                        tone: (k === 1 ? 0.14 : k > 0.6 ? 0.06 : 0) + (lit ? 0.06 : -0.1),
                        span: k === 1 ? (lit ? 0.72 : 0.46) : (lit ? 0.5 : 0.3),
                        snow: (o.snow == null ? 1 : o.snow) * (k === 1 ? 1 : k > 0.6 ? 0.55 : 0.18),
                        warmAt: o.warmAt, rimAt: o.rimAt, dense: o.dense
                    });
                });
            });

            /* Short boughs reaching toward the viewer close the seam along the trunk. */
            if (t > 0.05) {
                const count = 2 + (W / (needle * 1.6) | 0);
                for (let n = 0; n < count; n++) {
                    const sx = cx + (r() - 0.5) * W * 0.9;
                    const side = r() < 0.5 ? -1 : 1;
                    const len = needle * (1.5 + r() * 1.8);
                    const lit = (sx - cx) * (o.lightSide || 1) > 0;
                    bough(ctx, {
                        P, r, needle: needle * 0.74, step, lw,
                        sx, sy: y + r() * gap,
                        qx: sx + side * len * 0.3, qy: y + r() * gap + len * 0.3,
                        ex: sx + side * len * 0.55, ey: y + r() * gap + len * 0.85,
                        tone: 0.08 + (lit ? 0.1 : -0.02), span: lit ? 0.42 : 0.24,
                        snow: (o.snow == null ? 1 : o.snow) * 0.12,
                        warmAt: o.warmAt, rimAt: o.rimAt, dense: o.dense, stemW: 1
                    });
                }
            }
        }
    }

    /* ---------- Distant trees: quick silhouettes with frosted edges ---------- */

    function jagFir(ctx, x, base, h, hw, color, frost, r) {
        const tiers = Math.max(4, Math.round(h / 13));
        const right = [], left = [];
        for (let i = 1; i <= tiers; i++) {
            const t = i / tiers, y = base - h + h * t;
            right.push([x + hw * Math.pow(t, 0.95) * (0.8 + r() * 0.4), y + r() * 2, x + hw * Math.pow(t, 0.95) * (0.38 + r() * 0.16)]);
            left.push([x - hw * Math.pow(t, 0.95) * (0.8 + r() * 0.4), y + r() * 2, x - hw * Math.pow(t, 0.95) * (0.38 + r() * 0.16)]);
        }
        ctx.fillStyle = rgb(color);
        ctx.beginPath();
        ctx.moveTo(x, base - h);
        right.forEach((p, i) => {
            ctx.lineTo(p[0], p[1]);
            if (i < tiers - 1) ctx.lineTo(p[2], p[1] - h / tiers * 0.08);
        });
        ctx.lineTo(x, base + 4);
        for (let i = tiers - 1; i >= 0; i--) {
            const p = left[i];
            if (i < tiers - 1) ctx.lineTo(p[2], p[1] - h / tiers * 0.08);
            ctx.lineTo(p[0], p[1]);
        }
        ctx.closePath();
        ctx.fill();

        if (frost) {
            ctx.strokeStyle = rgb(frost, 0.65);
            ctx.lineCap = 'round';
            ctx.lineWidth = Math.max(0.8, h / 120);
            ctx.beginPath();
            for (let i = 1; i < tiers; i++) {
                const a = right[i], b = left[i];
                if (r() < 0.8) { ctx.moveTo(a[0], a[1] - 0.5); ctx.quadraticCurveTo((a[0] + a[2]) / 2, a[1] - 3, a[2], a[1] - h / tiers * 0.22); }
                if (r() < 0.8) { ctx.moveTo(b[0], b[1] - 0.5); ctx.quadraticCurveTo((b[0] + b[2]) / 2, b[1] - 3, b[2], b[1] - h / tiers * 0.22); }
            }
            ctx.stroke();
        }
    }

    function fogBand(ctx, w, y0, y1, color, alpha) {
        const gr = ctx.createLinearGradient(0, y0, 0, y1);
        gr.addColorStop(0, rgb(color, 0));
        gr.addColorStop(1, rgb(color, alpha));
        ctx.fillStyle = gr;
        ctx.fillRect(-60, y0, w + 120, y1 - y0);
    }

    function wingFar(ctx, w, h, P, flip, seed) {
        const r = rng(seed);
        const X = x => (flip ? w - x : x);
        const row = (count, base, hMin, hMax, color, frost, wide) => {
            for (let i = 0; i < count; i++) {
                const x = X(-14 + (i + r() * 0.8) * (w + 28) / count);
                const hh = lerp(hMin, hMax, r());
                jagFir(ctx, x, base + r() * 16, hh, hh * wide * (0.85 + r() * 0.3), color, frost, r);
            }
        };
        row(10, h - 118, 120, 250, P.far3, P.farSnow, 0.16);
        fogBand(ctx, w, h - 300, h - 90, P.fog, 0.5);
        row(7, h - 82, 260, 470, P.far2, P.farSnow, 0.15);
        fogBand(ctx, w, h - 280, h - 60, P.fog, 0.42);
        row(5, h - 52, 180, 300, P.far1, P.farSnow, 0.2);
        return {};
    }

    /* Near trees are lit from the content side: warm low down by the marquee, cold rim up top. */
    function wingNear(ctx, w, h, P, flip, seeds, opts) {
        const X = x => (flip ? w - x : x);
        const lightSide = flip ? -1 : 1;
        const inner = x => clamp((flip ? w - x : x) / w, 0, 1);
        const warmAt = (x, y) => {
            const dy = (y - opts.glowY) / 240;
            return Math.exp(-dy * dy) * Math.pow(inner(x), 2.6) * (P.isLight ? 0.16 : 0.5);
        };
        const rimAt = (x, y, s) => (s > 0.45 ? clamp(1 - y / (h * 0.8), 0, 1) * 0.5 * (0.4 + inner(x)) : 0);
        const dumps = [];

        const firs = opts.firs;
        firs.forEach((t, i) => {
            paintFir(ctx, {
                P, cx: X(t.x), top: t.top, base: t.base, hw: t.hw, seed: seeds + i * 7, lightSide,
                needle: t.needle, gap: t.gap, snow: t.snow == null ? 1 : t.snow, warmAt, rimAt
            });
            for (let k = 0; k < 7; k++) {
                const tt = 0.2 + k * 0.1;
                dumps.push({ x: X(t.x) + (k % 2 ? 1 : -1) * firWidth(tt, t.hw) * 0.55, y: t.top + (t.base - t.top) * tt });
            }
        });

        A.snowBank(ctx, w, h, h - 58, 15, seeds + 40, {
            top: P.groundTop, mid: P.groundMid, bottom: P.groundBottom,
            hi: P.snowHi, lo: P.snowLo, edge: P.isLight ? 0.9 : 0.75
        });
        return dumps;
    }

    /* ---------- The tree ---------- */

    const treeColors = P => Object.assign({}, P, {
        core: [2, 11, 8], dark: [7, 33, 23], mid: [14, 68, 45], hi: [40, 124, 76], rim: [210, 236, 216],
        warm: [255, 170, 84], bark: [30, 20, 14],
        snowHi: [246, 250, 255], snowMid: [198, 216, 238], snowLo: [106, 134, 172]
    });

    /* Warmth is baked into the needles from a coarse map, so lookups stay cheap. */
    function warmMap(W, H, L) {
        const cell = 6, gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1;
        const map = new Float32Array(gw * gh);
        const sigma = 11.5 * L.k;
        L.lights.forEach(l => {
            const amp = 0.14 + 0.28 * Math.max(0, l.z);
            const x0 = Math.max(0, (l.x - sigma * 3) / cell | 0), x1 = Math.min(gw - 1, (l.x + sigma * 3) / cell | 0);
            const y0 = Math.max(0, (l.y - sigma * 3) / cell | 0), y1 = Math.min(gh - 1, (l.y + sigma * 3) / cell | 0);
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const dx = x * cell - l.x, dy = y * cell - l.y;
                    map[y * gw + x] += amp * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
                }
            }
        });
        return (x, y) => {
            const ix = x / cell | 0, iy = y / cell | 0;
            if (ix < 0 || iy < 0 || ix >= gw || iy >= gh) return 0;
            return Math.min(0.62, map[iy * gw + ix]);
        };
    }

    function treeBody(ctx, w, h, P) {
        const L = g.NyTree.treeLayout(w), T = treeColors(P), warmAt = warmMap(w, h, L);
        paintFir(ctx, {
            P: T, cx: L.cx, top: L.top, base: L.base, hw: L.hw, seed: 4242, lightSide: -1,
            needle: L.needle, gap: L.gap, snow: 0.1, warmAt, dense: 3,
            rimAt: (x, y, s) => (s > 0.5 ? 0.12 : 0),
            afterCore(c) {
                /* The heart of the tree glows through the gaps between boughs. */
                c.save();
                c.globalCompositeOperation = 'source-atop';
                const gr = c.createRadialGradient(L.cx, L.top + L.TH * 0.62, 6, L.cx, L.top + L.TH * 0.62, L.TH * 0.56);
                gr.addColorStop(0, 'rgba(255,170,84,0.62)');
                gr.addColorStop(0.55, 'rgba(180,96,40,0.26)');
                gr.addColorStop(1, 'rgba(120,60,20,0)');
                c.fillStyle = gr;
                c.fillRect(0, 0, w, h);
                c.restore();
            }
        });
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        const round = ctx.createLinearGradient(L.cx - L.hw, 0, L.cx + L.hw, 0);
        round.addColorStop(0, 'rgba(1,10,14,0.62)');
        round.addColorStop(0.3, 'rgba(1,10,14,0.08)');
        round.addColorStop(0.55, 'rgba(1,10,14,0)');
        round.addColorStop(1, 'rgba(1,10,14,0.68)');
        ctx.fillStyle = round;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        L.ornaments.forEach(o => {
            const y = o.y + o.len + o.R * 1.2;
            const gr = ctx.createRadialGradient(o.x, y, 0, o.x, y, o.R * 1.7);
            gr.addColorStop(0, 'rgba(1,8,6,0.62)');
            gr.addColorStop(1, 'rgba(1,8,6,0)');
            ctx.fillStyle = gr;
            ctx.fillRect(o.x - o.R * 2, y - o.R * 2, o.R * 4, o.R * 4);
        });
    }

    /* Small sprigs above the hooks: drawn over the ornaments so they hang inside the tree. */
    function treeSprigs(f, w, h, P) {
        const L = g.NyTree.treeLayout(w), k = L.k, T = treeColors(P), warmAt = warmMap(w, h, L);
        f.lineCap = 'round';
        const r = rng(3131);
        L.ornaments.forEach(o => {
            [-1, 1, r() < 0.5 ? -1 : 1].forEach((side, i) => {
                const needle = L.needle * (0.56 + r() * 0.2);
                const sx = o.x - side * (10 + r() * 7) * k, sy = o.y - (5 + r() * 7) * k;
                bough(f, {
                    P: T, r, needle, step: Math.max(1.1, needle * 0.15), lw: 0.62 * k + 0.2,
                    sx, sy,
                    qx: o.x - side * 2 * k, qy: o.y - (2 + i) * k,
                    ex: o.x + side * (9 + r() * 7) * k, ey: o.y + (3 + r() * 3) * k,
                    tone: 0.14, span: 0.5, snow: 0, warmAt, stemW: 1
                });
            });
        });
    }

    /* ---------- The gifts ---------- */

    /* ---------- Wrapping papers, drawn in the flat space of one face ---------- */

    function flake(x, cx, cy, R) {
        x.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3, ux = Math.cos(a), uy = Math.sin(a);
            x.moveTo(cx, cy);
            x.lineTo(cx + ux * R, cy + uy * R);
            const bx = cx + ux * R * 0.58, by = cy + uy * R * 0.58;
            [1, -1].forEach(d => {
                const b = a + d * 1.05;
                x.moveTo(bx, by);
                x.lineTo(bx + Math.cos(b) * R * 0.3, by + Math.sin(b) * R * 0.3);
            });
        }
        x.stroke();
    }

    const PAPERS = {
        flakes(x, W, H, s) {
            x.fillStyle = '#b4161f';
            x.fillRect(0, 0, W, H);
            x.strokeStyle = 'rgba(255,240,232,0.86)';
            x.lineWidth = 0.75 * s;
            x.lineCap = 'round';
            const step = 17 * s;
            for (let r = 0, y = 4 * s; y < H + step; y += step * 0.86, r++) {
                for (let c = r % 2 ? step / 2 : 0; c < W + step; c += step) flake(x, c, y, 5 * s);
            }
        },
        night(x, W, H, s) {
            x.fillStyle = '#16255f';
            x.fillRect(0, 0, W, H);
            x.fillStyle = '#f6cf7a';
            const step = 15 * s, r = rng(5);
            for (let i = 0, y = 3 * s; y < H + step; y += step * 0.84, i++) {
                for (let c = i % 2 ? step / 2 : 0; c < W + step; c += step) {
                    g.NyTree.fivePoint(x, c + (r() - 0.5) * 2 * s, y, (2.2 + r() * 2.2) * s, (1 + r() * 0.8) * s, r() * 1.2);
                    x.fill();
                }
            }
        },
        gold(x, W, H) {
            const gr = x.createLinearGradient(0, 0, W, H);
            gr.addColorStop(0, '#c98f2c');
            gr.addColorStop(0.24, '#ffe6a6');
            gr.addColorStop(0.44, '#d8a03a');
            gr.addColorStop(0.68, '#f6cf7c');
            gr.addColorStop(1, '#a8741c');
            x.fillStyle = gr;
            x.fillRect(0, 0, W, H);
            const r = rng(13);
            x.lineWidth = 0.5;
            for (let i = 0; i < 26; i++) {
                x.strokeStyle = r() < 0.5 ? 'rgba(255,248,214,0.32)' : 'rgba(110,70,10,0.2)';
                const px = r() * W, py = r() * H;
                x.beginPath();
                x.moveTo(px, py);
                x.lineTo(px + (r() - 0.5) * W * 0.5, py + (r() - 0.5) * H * 0.5);
                x.stroke();
            }
        },
        emerald(x, W, H, s) {
            x.fillStyle = '#0b6a50';
            x.fillRect(0, 0, W, H);
            x.fillStyle = 'rgba(248,232,186,0.92)';
            const step = 11 * s;
            for (let i = 0, y = 2 * s; y < H + step; y += step * 0.8, i++) {
                for (let c = i % 2 ? step / 2 : 0; c < W + step; c += step) {
                    x.beginPath();
                    x.arc(c, y, 1.7 * s, 0, TAU);
                    x.fill();
                }
            }
        },
        plaid(x, W, H, s) {
            x.fillStyle = '#efe8da';
            x.fillRect(0, 0, W, H);
            const band = (col, w, gap, off) => {
                x.fillStyle = col;
                for (let u = off * s; u < W; u += gap * s) x.fillRect(u, 0, w * s, H);
                for (let v = off * s; v < H; v += gap * s) x.fillRect(0, v, W, w * s);
            };
            band('rgba(176,26,38,0.56)', 7, 22, 0);
            band('rgba(14,88,62,0.5)', 3, 22, 11);
            band('rgba(232,186,92,0.72)', 0.8, 11, 5);
        },
        deco(x, W, H, s) {
            x.fillStyle = '#5f0f28';
            x.fillRect(0, 0, W, H);
            x.strokeStyle = 'rgba(242,198,112,0.9)';
            x.lineWidth = 0.65 * s;
            const R = 9 * s;
            for (let r = 0, y = H + R; y > -R; y -= R * 0.62, r++) {
                for (let c = r % 2 ? R : 0; c < W + R * 2; c += R * 2) {
                    for (let q = 1; q > 0.2; q -= 0.32) {
                        x.beginPath();
                        x.arc(c, y, R * q, Math.PI, 0);
                        x.stroke();
                    }
                }
            }
        },
        silver(x, W, H, s) {
            const gr = x.createLinearGradient(0, 0, W, H);
            gr.addColorStop(0, '#a4b2c8');
            gr.addColorStop(0.35, '#f4f7fc');
            gr.addColorStop(0.6, '#b6c2d6');
            gr.addColorStop(1, '#8695ae');
            x.fillStyle = gr;
            x.fillRect(0, 0, W, H);
            x.fillStyle = 'rgba(40,74,140,0.6)';
            for (let i = 0, y = 2 * s; y < H + 8 * s; y += 8 * s, i++) {
                for (let c = i % 2 ? 4 * s : 0; c < W + 8 * s; c += 8 * s) {
                    x.beginPath();
                    x.arc(c, y, 0.9 * s, 0, TAU);
                    x.fill();
                }
            }
        },
        pine(x, W, H, s) {
            x.fillStyle = '#0e4d39';
            x.fillRect(0, 0, W, H);
            x.fillStyle = 'rgba(236,190,98,0.85)';
            for (let u = 2 * s; u < W; u += 10 * s) x.fillRect(u, 0, 1.6 * s, H);
            x.fillStyle = 'rgba(255,255,255,0.1)';
            for (let u = 7 * s; u < W; u += 10 * s) x.fillRect(u, 0, 3 * s, H);
        },
        candy(x, W, H, s) {
            x.fillStyle = '#f4efe6';
            x.fillRect(0, 0, W, H);
            x.save();
            x.rotate(-0.72);
            x.fillStyle = '#c21b2a';
            const L = W + H;
            for (let u = -L; u < L; u += 12 * s) x.fillRect(u, -L, 6 * s, L * 2);
            x.restore();
        },
        wine(x, W, H, s) {
            x.fillStyle = '#7c1236';
            x.fillRect(0, 0, W, H);
            x.strokeStyle = 'rgba(244,204,124,0.8)';
            x.lineWidth = 0.7 * s;
            const step = 13 * s;
            for (let u = -H; u < W + H; u += step) {
                x.beginPath();
                x.moveTo(u, 0);
                x.lineTo(u + H, H);
                x.moveTo(u + H, 0);
                x.lineTo(u, H);
                x.stroke();
            }
        },
        can(x, W, H) {
            const gr = x.createLinearGradient(0, 0, W, H);
            gr.addColorStop(0, '#7f8894');
            gr.addColorStop(0.4, '#eef2f7');
            gr.addColorStop(0.7, '#a8b1bd');
            gr.addColorStop(1, '#626b78');
            x.fillStyle = gr;
            x.fillRect(0, 0, W, H);
        }
    };

    /* ---------- Faces ---------- */

    function onFace(x, O, U, V, W, H, draw) {
        x.save();
        x.transform(U[0], U[1], V[0], V[1], O[0], O[1]);
        x.beginPath();
        x.rect(0, 0, W, H);
        x.clip();
        draw(W, H);
        x.restore();
    }

    function vec(a, b, len) { return [(b[0] - a[0]) / len, (b[1] - a[1]) / len]; }

    function ribbonBand(x, c, u0, y0, w, h, vertical) {
        const rw = w;
        const gr = vertical ? x.createLinearGradient(u0, 0, u0 + rw, 0) : x.createLinearGradient(0, y0, 0, y0 + rw);
        gr.addColorStop(0, rgb(mix(c, BLACK, 0.34)));
        gr.addColorStop(0.2, rgb(c));
        gr.addColorStop(0.48, rgb(mix(c, WHITE, 0.42)));
        gr.addColorStop(0.76, rgb(c));
        gr.addColorStop(1, rgb(mix(c, BLACK, 0.34)));
        x.fillStyle = gr;
        if (vertical) x.fillRect(u0, y0, rw, h);
        else x.fillRect(u0, y0, h, rw);
    }

    function shadeFace(x, W, H, dark, warm, warmDir) {
        const gr = x.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, 'rgba(5,7,24,' + dark + ')');
        gr.addColorStop(1, 'rgba(3,5,20,' + Math.min(0.86, dark + 0.26) + ')');
        x.fillStyle = gr;
        x.fillRect(0, 0, W, H);
        if (warm > 0) {
            const w = x.createLinearGradient(warmDir > 0 ? W : 0, 0, warmDir > 0 ? 0 : W, 0);
            w.addColorStop(0, 'rgba(255,170,88,' + warm + ')');
            w.addColorStop(1, 'rgba(255,170,88,0)');
            x.fillStyle = w;
            x.fillRect(0, 0, W, H);
        }
    }

    function edge(x, a, b, alpha, width) {
        x.strokeStyle = 'rgba(255,246,226,' + alpha + ')';
        x.lineWidth = width;
        x.beginPath();
        x.moveTo(a[0], a[1]);
        x.lineTo(b[0], b[1]);
        x.stroke();
    }

    /* One rectangular solid: visible sides, then the top. */
    function solid(x, pr, w, d, y0, y1, o) {
        const W = w / 2, D = d / 2, h = y1 - y0;
        const paper = PAPERS[o.paper];
        const s = o.k;
        const rw = o.rw;
        const tl = pr(-W, y1, -D), tr = pr(W, y1, -D), fl = pr(-W, y1, D), fr = pr(W, y1, D);
        const bl = pr(-W, y0, D), br = pr(W, y0, D), btr = pr(W, y0, -D), btl = pr(-W, y0, -D);
        const showRight = o.yaw < 0;
        const treeSide = o.treeSide;

        if (showRight) {
            onFace(x, fr, vec(fr, tr, d), vec(fr, br, h), d, h, (fw, fh) => {
                paper(x, fw, fh, s);
                ribbonBand(x, o.ribbon, fw / 2 - rw / 2, 0, rw, fh, true);
                shadeFace(x, fw, fh, 0.42, treeSide < 0 ? 0.3 : 0, -1);
            });
        } else {
            onFace(x, tl, vec(tl, fl, d), vec(tl, btl, h), d, h, (fw, fh) => {
                paper(x, fw, fh, s);
                ribbonBand(x, o.ribbon, fw / 2 - rw / 2, 0, rw, fh, true);
                shadeFace(x, fw, fh, 0.42, treeSide > 0 ? 0.3 : 0, 1);
            });
        }
        onFace(x, fl, vec(fl, fr, w), vec(fl, bl, h), w, h, (fw, fh) => {
            paper(x, fw, fh, s);
            ribbonBand(x, o.ribbon, fw / 2 - rw / 2, 0, rw, fh, true);
            shadeFace(x, fw, fh, 0.14, 0.14, treeSide);
        });

        if (o.topFace === 'inside') {
            onFace(x, tl, vec(tl, tr, w), vec(tl, fl, d), w, d, (fw, fh) => {
                x.fillStyle = '#1c0d0a';
                x.fillRect(0, 0, fw, fh);
                const gr = x.createRadialGradient(fw / 2, fh / 2, 1, fw / 2, fh / 2, Math.max(fw, fh) * 0.6);
                gr.addColorStop(0, 'rgba(255,190,104,0.95)');
                gr.addColorStop(1, 'rgba(120,50,20,0.2)');
                x.fillStyle = gr;
                x.fillRect(0, 0, fw, fh);
            });
        } else {
            onFace(x, tl, vec(tl, tr, w), vec(tl, fl, d), w, d, (fw, fh) => {
                paper(x, fw, fh, s);
                ribbonBand(x, o.ribbon, fw / 2 - rw / 2, 0, rw, fh, true);
                ribbonBand(x, o.ribbon, 0, fh / 2 - rw / 2, rw, fw, false);
                const gr = x.createLinearGradient(0, 0, fw, fh);
                gr.addColorStop(0, 'rgba(255,255,255,0.16)');
                gr.addColorStop(0.5, 'rgba(255,255,255,0)');
                gr.addColorStop(1, 'rgba(4,6,22,0.12)');
                x.fillStyle = gr;
                x.fillRect(0, 0, fw, fh);
            });
        }

        const lw = Math.max(0.5, 0.7 * s);
        edge(x, fl, fr, 0.5, lw);
        edge(x, tl, fl, 0.3, lw);
        edge(x, fr, tr, 0.3, lw);
        edge(x, tl, tr, 0.16, lw);
        if (showRight) edge(x, fr, br, 0.22, lw);
        else edge(x, fl, bl, 0.22, lw);
    }

    /* A round box: wall with cylindrical light, an elliptical top. */
    function drum(x, r, y0, y1, o) {
        const sp = Math.sin(PITCH), cp = Math.cos(PITCH);
        const ry = r * sp, yb = -y0 * cp, yt = -y1 * cp;
        const s = o.k, rw = o.rw;
        const paper = PAPERS[o.paper];

        x.save();
        x.beginPath();
        x.moveTo(-r, yt);
        x.lineTo(-r, yb);
        x.ellipse(0, yb, r, ry, 0, Math.PI, 0, true);
        x.lineTo(r, yt);
        x.closePath();
        x.clip();
        x.translate(-r, yt - ry);
        paper(x, r * 2, yb - yt + ry * 2, s);
        x.translate(r, -(yt - ry));
        ribbonBand(x, o.ribbon, -rw / 2, yt - ry, rw, yb - yt + ry * 2, true);
        const gr = x.createLinearGradient(-r, 0, r, 0);
        gr.addColorStop(0, 'rgba(3,5,20,0.68)');
        gr.addColorStop(0.3, 'rgba(3,5,20,0.1)');
        gr.addColorStop(0.46, 'rgba(255,255,255,0.1)');
        gr.addColorStop(0.72, 'rgba(3,5,20,0.26)');
        gr.addColorStop(1, 'rgba(3,5,20,0.72)');
        x.fillStyle = gr;
        x.fillRect(-r, yt - ry, r * 2, yb - yt + ry * 2);
        x.restore();

        x.save();
        x.translate(0, yt);
        x.beginPath();
        x.ellipse(0, 0, r, ry, 0, 0, TAU);
        x.clip();
        if (o.topFace === 'inside') {
            const gi = x.createRadialGradient(0, 0, 1, 0, 0, r);
            gi.addColorStop(0, 'rgba(255,190,104,1)');
            gi.addColorStop(1, 'rgba(70,28,14,1)');
            x.fillStyle = gi;
            x.fillRect(-r, -r, r * 2, r * 2);
        } else {
            x.scale(1, sp);
            x.translate(-r, -r);
            paper(x, r * 2, r * 2, s);
            if (o.paper === 'can') {
                x.strokeStyle = 'rgba(60,68,80,0.5)';
                x.lineWidth = 0.7 * s;
                [0.86, 0.62, 0.34].forEach(q => {
                    x.beginPath();
                    x.arc(r, r, r * q, 0, TAU);
                    x.stroke();
                });
            }
            ribbonBand(x, o.ribbon, r - rw / 2, 0, rw, r * 2, true);
            ribbonBand(x, o.ribbon, 0, r - rw / 2, rw, r * 2, false);
        }
        x.restore();

        x.strokeStyle = 'rgba(255,246,226,0.42)';
        x.lineWidth = Math.max(0.5, 0.7 * s);
        x.beginPath();
        x.ellipse(0, yt, r, ry, 0, 0, Math.PI);
        x.stroke();
    }

    /* ---------- The bow: satin loops with hollow insides ---------- */

    function bowLoop(x, ang, L, W, c) {
        x.save();
        x.rotate(ang);
        const path = new Path2D();
        path.moveTo(0, 0);
        path.bezierCurveTo(L * 0.3, -W * 0.72, L * 0.92, -W * 0.92, L, -W * 0.04);
        path.bezierCurveTo(L * 0.95, W * 0.82, L * 0.34, W * 0.7, 0, 0);
        const gr = x.createLinearGradient(0, 0, L, 0);
        gr.addColorStop(0, rgb(mix(c, BLACK, 0.5)));
        gr.addColorStop(0.28, rgb(c));
        gr.addColorStop(0.68, rgb(mix(c, WHITE, 0.44)));
        gr.addColorStop(1, rgb(mix(c, BLACK, 0.12)));
        x.fillStyle = gr;
        x.fill(path);

        /* The opening of the loop: darker, offset toward the tip. */
        x.fillStyle = rgb(mix(c, BLACK, 0.58));
        x.beginPath();
        x.ellipse(L * 0.68, W * 0.06, L * 0.24, W * 0.36, 0.08, 0, TAU);
        x.fill();
        x.fillStyle = rgb(mix(c, BLACK, 0.34), 0.75);
        x.beginPath();
        x.ellipse(L * 0.61, W * 0.12, L * 0.16, W * 0.22, 0.08, 0, TAU);
        x.fill();

        x.strokeStyle = rgb(mix(c, WHITE, 0.72), 0.9);
        x.lineWidth = Math.max(0.4, W * 0.07);
        x.beginPath();
        x.moveTo(L * 0.1, -W * 0.28);
        x.bezierCurveTo(L * 0.34, -W * 0.68, L * 0.8, -W * 0.82, L * 0.96, -W * 0.26);
        x.stroke();
        x.strokeStyle = rgb(mix(c, BLACK, 0.5), 0.6);
        x.lineWidth = Math.max(0.3, W * 0.05);
        x.beginPath();
        x.moveTo(L * 0.06, W * 0.02);
        x.lineTo(L * 0.3, W * 0.16);
        x.moveTo(L * 0.06, -W * 0.04);
        x.lineTo(L * 0.3, -W * 0.22);
        x.stroke();
        x.restore();
    }

    function bowTail(x, side, L, W, c) {
        x.beginPath();
        x.moveTo(-W * 0.35 * side, 0);
        x.bezierCurveTo(side * L * 0.3, L * 0.1, side * L * 0.52, L * 0.42, side * L * 0.9, L * 0.72);
        x.lineTo(side * L * 0.86, L * 0.98);
        x.lineTo(side * L * 0.66, L * 0.82);
        x.lineTo(side * L * 0.56, L * 1.02);
        x.bezierCurveTo(side * L * 0.32, L * 0.68, side * L * 0.12, L * 0.34, W * 0.3 * side, W * 0.2);
        x.closePath();
        const gr = x.createLinearGradient(0, 0, side * L * 0.8, L * 0.9);
        gr.addColorStop(0, rgb(mix(c, BLACK, 0.34)));
        gr.addColorStop(0.5, rgb(mix(c, WHITE, 0.16)));
        gr.addColorStop(1, rgb(mix(c, BLACK, 0.22)));
        x.fillStyle = gr;
        x.fill();
    }

    function bow(x, cx, cy, size, c) {
        x.save();
        x.translate(cx, cy);
        const L = size, W = size * 0.56;
        bowTail(x, -1, L * 0.86, W * 0.46, c);
        bowTail(x, 1, L * 0.86, W * 0.46, c);
        bowLoop(x, -2.42, L * 0.72, W * 0.62, mix(c, BLACK, 0.1));
        bowLoop(x, -0.72, L * 0.72, W * 0.62, mix(c, BLACK, 0.1));
        bowLoop(x, -2.98, L, W, c);
        bowLoop(x, -0.16, L, W, c);
        const gr = x.createRadialGradient(-size * 0.05, -size * 0.07, size * 0.01, 0, 0, size * 0.22);
        gr.addColorStop(0, rgb(mix(c, WHITE, 0.62)));
        gr.addColorStop(0.55, rgb(c));
        gr.addColorStop(1, rgb(mix(c, BLACK, 0.48)));
        x.fillStyle = gr;
        x.beginPath();
        x.ellipse(0, 0, size * 0.2, size * 0.17, 0, 0, TAU);
        x.fill();
        x.restore();
    }

    /* ---------- A whole gift: its size on screen, its outline, its painting ---------- */

    function paintGift(ctx, spec, k, part, treeSide) {
        const M = G.measure(spec, k);
        ctx.translate(M.ox, M.oy);
        const rw = (spec.round ? spec.r * 0.26 : Math.min(spec.w, spec.d) * 0.17) * k;
        const o = { paper: spec.paper, ribbon: spec.ribbon, k, rw, yaw: spec.yaw || 0, treeSide };

        if (part === 'body') {
            /* Contact shadow on the snow. */
            const sr = (spec.round ? spec.r : Math.max(spec.w, spec.d) * 0.62) * k * 1.32;
            ctx.save();
            ctx.scale(1, 0.42);
            const gr = ctx.createRadialGradient(0, 4 * k, sr * 0.2, 0, 4 * k, sr);
            gr.addColorStop(0, 'rgba(2,5,18,0.72)');
            gr.addColorStop(1, 'rgba(2,5,18,0)');
            ctx.fillStyle = gr;
            ctx.fillRect(-sr, -sr, sr * 2, sr * 2);
            ctx.restore();
            if (spec.round) drum(ctx, spec.r * k, 0, spec.h * k, Object.assign({ topFace: 'inside' }, o));
            else solid(ctx, G.projector(spec.yaw), spec.w * k, spec.d * k, 0, spec.h * k, Object.assign({ topFace: 'inside' }, o));
            return;
        }

        const lip = 1.5 * k, y0 = (spec.h - 2) * k, y1 = (spec.h + spec.lid) * k;
        const ribbonC = spec.ribbon;
        if (spec.round) {
            drum(ctx, (spec.r + 1.5) * k, y0, y1, o);
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1.4 * k;
            ctx.beginPath();
            ctx.ellipse(0, -y0 * Math.cos(PITCH) + 0.6 * k, (spec.r + 1.5) * k, (spec.r + 1.5) * k * Math.sin(PITCH), 0, 0, Math.PI);
            ctx.stroke();
        } else {
            solid(ctx, G.projector(spec.yaw), spec.w * k + lip * 2, spec.d * k + lip * 2, y0, y1, o);
        }
        bow(ctx, M.top[0], M.top[1] - 1.5 * k, M.bowSize, ribbonC);
    }


    /* ---------- One job: size, scale, painter ---------- */

    const WING_W = 272, WING_H = 1124;
    const nearLeft = h => ({
        glowY: h * 0.68,
        firs: [
            { x: 186, top: h - 590, base: h - 32, hw: 88, needle: 11.5, gap: 9.5, snow: 0.9 },
            { x: 40, top: h - 960, base: h - 8, hw: 172, needle: 15.5, gap: 12 },
            { x: 158, top: h - 262, base: h - 26, hw: 50, needle: 8, gap: 7.5 }
        ]
    });
    const nearRight = h => ({
        glowY: h * 0.68,
        firs: [
            { x: 176, top: h - 720, base: h - 28, hw: 100, needle: 12.5, gap: 10, snow: 0.9 },
            { x: 30, top: h - 840, base: h - 6, hw: 156, needle: 15, gap: 12 },
            { x: 116, top: h - 340, base: h - 24, hw: 60, needle: 8.5, gap: 8 }
        ]
    });

    function render(w, h, scale, draw) {
        const c = document.createElement('canvas');
        c.width = Math.round(w * scale);
        c.height = Math.round(h * scale);
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        draw(ctx, w, h);
        return c;
    }

    g.NyArtJobs = {
        list() {
            const jobs = [];
            ['dark', 'light'].forEach(theme => {
                jobs.push({ name: 'wing-far-left-' + theme, theme, w: WING_W, h: WING_H, scale: 2, kind: 'farL' });
                jobs.push({ name: 'wing-far-right-' + theme, theme, w: WING_W, h: WING_H, scale: 2, kind: 'farR' });
                jobs.push({ name: 'wing-near-left-' + theme, theme, w: WING_W, h: WING_H, scale: 2, kind: 'nearL' });
                jobs.push({ name: 'wing-near-right-' + theme, theme, w: WING_W, h: WING_H, scale: 2, kind: 'nearR' });
            });
            jobs.push({ name: 'tree-body', theme: 'dark', w: g.NyTree.BASE_W, h: g.NyTree.BASE_H, scale: 2.5, kind: 'tree' });
            jobs.push({ name: 'tree-sprigs', theme: 'dark', w: g.NyTree.BASE_W, h: g.NyTree.BASE_H, scale: 2, kind: 'sprigs' });
            G.GIFTS.forEach((spec, i) => {
                const M = G.measure(spec, 1);
                ['body', 'lid'].forEach(part => {
                    jobs.push({ name: G.pictureName(i, part).replace('.webp', ''), theme: 'dark', w: M.w, h: M.h, scale: 2.5, kind: 'gift', gift: i, part });
                });
            });
            return jobs;
        },
        run(job, quality) {
            document.documentElement.className = 'season-newyear' + (job.theme === 'light' ? ' light-theme' : '');
            const P = A.palette(document.documentElement);
            const canvas = render(job.w, job.h, job.scale, (ctx, w, h) => {
                if (job.kind === 'farL') wingFar(ctx, w, h, P, false, 301);
                else if (job.kind === 'farR') wingFar(ctx, w, h, P, true, 417);
                else if (job.kind === 'nearL') wingNear(ctx, w, h, P, false, 21, nearLeft(h));
                else if (job.kind === 'nearR') wingNear(ctx, w, h, P, true, 63, nearRight(h));
                else if (job.kind === 'tree') treeBody(ctx, w, h, P);
                else if (job.kind === 'sprigs') treeSprigs(ctx, w, h, P);
                else paintGift(ctx, G.GIFTS[job.gift], 1, job.part, G.GIFTS[job.gift].x < 0 ? 1 : -1);
            });
            return canvas.toDataURL('image/webp', quality);
        }
    };
})(window);
