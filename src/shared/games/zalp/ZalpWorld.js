import { Z } from './ZalpCore.js';
// Terrain: a W x H mask (2 bytes per texel: R = solid 0/255, G = scorch 0..255) generated from noise,
// carved by explosions, queried by every physics body, and mirrored into a WebGL texture.
Z.THEMES = {
    meadow: {
        sky0: '#4f97de', sky1: '#cfe8f5', hills: ['#a9c7dc', '#7fa9a6', '#5d8a5f'], cloud: '#ffffff', sun: '#fff1bf',
        dirt0: '#8b5a34', dirt1: '#6c4426', rock: '#8f877b', top0: '#4fae34', top1: '#8bd24e', burn: '#271c16', edge: '#24170e',
        wTop: '#36a3c6', wDeep: '#0b3a60', topThick: 10, debris: '#7b502d',
    },
    desert: {
        sky0: '#e9783f', sky1: '#ffd9a0', hills: ['#ecb98f', '#cc8c62', '#a7644a'], cloud: '#fff0dc', sun: '#fff5cf',
        dirt0: '#cf8a4e', dirt1: '#ad6239', rock: '#874630', top0: '#f2cb8d', top1: '#e2aa66', burn: '#2a1912', edge: '#46200f',
        wTop: '#35b3ad', wDeep: '#0d4858', topThick: 7, debris: '#c07a45',
    },
    snow: {
        sky0: '#6f9bd3', sky1: '#e7eef7', hills: ['#cad8eb', '#a5bad6', '#8299b9'], cloud: '#ffffff', sun: '#ffffff',
        dirt0: '#6c798b', dirt1: '#525e6f', rock: '#9db2c8', top0: '#f6f9fd', top1: '#d6e4f2', burn: '#1d2128', edge: '#1d2531',
        wTop: '#79c2e5', wDeep: '#163c64', topThick: 12, debris: '#e9f0f7',
    },
    volcano: {
        sky0: '#170d1c', sky1: '#6e2a20', hills: ['#3b1f27', '#2b1519', '#1c0e11'], cloud: '#56323a', sun: '#ff9550',
        dirt0: '#3b3337', dirt1: '#2a2428', rock: '#5c4b46', top0: '#4b4145', top1: '#6c5b57', burn: '#100b0b', edge: '#090505',
        wTop: '#ff9a2a', wDeep: '#8a1a06', topThick: 6, debris: '#4a4044', stars: true, lava: true,
    },
};

Z.World = class {
    constructor(seed, themeKey) {
        this.W = Z.K.W; this.H = Z.K.H;
        this.seed = seed;
        this.themeKey = themeKey;
        this.theme = Z.THEMES[themeKey];
        this.data = new Uint8Array(this.W * this.H * 2);
        this.waterY = this.H - 78;
        this.dirty = null;
        this.generate();
    }

    generate() {
        const { W, H } = this;
        const N = Z.makeNoise(this.seed);
        const rnd = Z.rng(this.seed ^ 0x9e3779b9);
        const style = Math.floor(rnd() * 3); // 0 one big island, 1 split by a deep gorge, 2 archipelago
        const phase = rnd() * 6.28;
        const surf = new Float32Array(W + 1);
        for (let x = 0; x <= W; x++) {
            const e = Z.smooth(0, 300, Math.min(x, W - x));
            let h = H * 0.5 - (N.fbm1(x * 0.0026 + 3.1, 4) - 0.5) * 560 - (N.fbm1(x * 0.012 + 9, 3) - 0.5) * 80;
            if (style === 1) h += Math.exp(-(((x - W / 2) / 150) ** 2)) * 480;
            if (style === 2) h += Math.max(0, Math.sin((x / W) * Math.PI * 4 + phase) - 0.55) * 900;
            surf[x] = Z.lerp(H + 80, h, e);
        }
        // density on a coarse grid, then bilinear per texel: fast and gives smooth contours
        const S = 4, gw = W / S + 1, gh = H / S + 1;
        const grid = new Float32Array(gw * gh);
        for (let gy = 0; gy < gh; gy++) {
            const y = gy * S;
            for (let gx = 0; gx < gw; gx++) {
                const x = Math.min(W, gx * S);
                const e = Z.smooth(40, 260, Math.min(x, W - x));
                let d = (y - surf[x]) / 55;
                d += (N.fbm2(x * 0.0062, y * 0.0062, 4) - 0.5) * 1.8;
                if (y > surf[x] + 45) d -= Z.smooth(0.6, 0.7, N.fbm2(x * 0.0042 + 50, y * 0.0085 + 20, 3)) * 3.2;
                const band = Z.smooth(H * 0.1, H * 0.22, y) * (1 - Z.smooth(H * 0.36, H * 0.46, y));
                // fades subtract (never multiply) so every contour closes smoothly instead of being sliced flat
                d = Math.max(d, (N.fbm2(x * 0.0042 + 100, y * 0.011 + 100, 3) - 0.665) * 9 - (1 - band) * 4);
                d -= (1 - e) * 6;
                if (y < 24) d = -1;
                grid[gy * gw + gx] = d;
            }
        }
        const data = this.data;
        for (let y = 0; y < H; y++) {
            const gy = Math.floor(y / S), fy = (y % S) / S, r0 = gy * gw, r1 = Math.min(gh - 1, gy + 1) * gw;
            for (let x = 0; x < W; x++) {
                const gx = Math.floor(x / S), fx = (x % S) / S;
                const a = grid[r0 + gx], b = grid[r0 + gx + 1], c = grid[r1 + gx], d = grid[r1 + gx + 1];
                const v = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
                data[(y * W + x) << 1] = v > 0 ? 255 : 0;
            }
        }
    }

    solid(x, y) {
        x |= 0; y |= 0;
        if (x < 0 || x >= this.W || y < 0) return false;
        if (y >= this.H) return true;
        return this.data[(y * this.W + x) << 1] > 127;
    }

    circleHit(x, y, r) {
        if (this.solid(x, y)) return true;
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            if (this.solid(x + Math.cos(a) * r, y + Math.sin(a) * r)) return true;
        }
        return false;
    }

    // outward surface normal from the solid texels around (x, y)
    normal(x, y, r = 4) {
        let sx = 0, sy = 0;
        for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (this.solid(x + i, y + j)) { sx += i; sy += j; }
        const l = Math.hypot(sx, sy);
        return l < 0.001 ? { x: 0, y: -1 } : { x: -sx / l, y: -sy / l };
    }

    // remove a disc and scorch a ring around it; returns how many solid texels were removed
    carve(cx, cy, r) {
        const { W, H, data } = this, ring = 9, R = r + ring;
        const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R));
        const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
        let removed = 0;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const d = Math.hypot(x - cx, y - cy);
                if (d > R) continue;
                const i = (y * W + x) << 1;
                if (d < r) { if (data[i]) removed++; data[i] = 0; data[i + 1] = 0; }
                else if (data[i]) data[i + 1] = Math.max(data[i + 1], (230 * (1 - (d - r) / ring)) | 0);
            }
        }
        this.markDirty(x0, y0, x1 + 1, y1 + 1);
        return removed;
    }

    markDirty(x0, y0, x1, y1) {
        const d = this.dirty;
        this.dirty = d ? [Math.min(d[0], x0), Math.min(d[1], y0), Math.max(d[2], x1), Math.max(d[3], y1)] : [x0, y0, x1, y1];
    }

    flushDirty() {
        if (!this.dirty) return;
        const [x0, y0, x1, y1] = this.dirty;
        Z.R.updateMask(this.data, x0, y0, x1, y1);
        this.dirty = null;
    }

    // march a segment; returns the first solid point or null
    ray(x0, y0, x1, y1, step = 1.5) {
        const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len / step));
        for (let i = 1; i <= n; i++) {
            const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
            if (this.solid(x, y)) return { x, y, t };
        }
        return null;
    }

    // standing spots on top surfaces, above the water, spread apart
    spawnPoints(n, minDist = 150, rand = Math.random) {
        const R = Z.K.UNIT_R, cands = [];
        for (let x = 90; x < this.W - 90; x += 6) {
            for (let y = 30; y < this.waterY - 40; y++) {
                if (!this.solid(x, y) && this.solid(x, y + 1)) {
                    const uy = y - R - 1;
                    if (!this.circleHit(x, uy, R) && !this.circleHit(x, uy - 14, R)) cands.push({ x, y: uy });
                    y += 30;
                }
            }
        }
        Z.shuffleWith(cands, rand);
        const out = [];
        for (let pass = 0; pass < 3 && out.length < n; pass++) {
            const md = minDist * (1 - pass * 0.35);
            for (const c of cands) {
                if (out.length >= n) break;
                if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) > md)) out.push(c);
            }
        }
        while (out.length < n) out.push({ x: 200 + rand() * (this.W - 400), y: 40 });
        return out;
    }
};
