/**
 * New Year season: where the gifts under the tree lie.
 *
 * Each gift is a small 3D solid. Its picture is pre-rendered by
 * scripts/generate-newyear-art.cjs; this module knows the solids, projects them
 * and places the pictures. Body and lid are separate pictures, which is what lets
 * a gift actually open.
 */
(function (g) {
    'use strict';

    const PITCH = 0.38;

    const RED = [186, 24, 38], GOLD = [240, 196, 110], CREAM = [246, 240, 228], GREEN = [16, 104, 72], BLUE = [40, 86, 168];

    /* Positions are relative to the tree: x from its axis, y from the floor line. */
    const GIFTS = [
        { x: -98, y: -22, w: 78, d: 58, h: 56, lid: 14, yaw: 0.46, paper: 'flakes', ribbon: GOLD, back: true },
        { x: 110, y: -20, w: 88, d: 62, h: 64, lid: 15, yaw: -0.38, paper: 'night', ribbon: GOLD, back: true },
        { x: -190, y: -6, w: 66, d: 52, h: 46, lid: 12, yaw: 0.34, paper: 'gold', ribbon: RED },
        { x: 190, y: -8, w: 74, d: 56, h: 52, lid: 13, yaw: -0.42, paper: 'emerald', ribbon: CREAM },
        { x: -36, y: 2, w: 100, d: 70, h: 48, lid: 13, yaw: 0.22, paper: 'plaid', ribbon: RED },
        { x: 54, y: 0, round: true, r: 34, h: 48, lid: 14, paper: 'deco', ribbon: GOLD },
        { x: -46, y: -49, w: 52, d: 38, h: 26, lid: 9, yaw: -0.26, paper: 'silver', ribbon: BLUE },
        { x: -128, y: 19, w: 64, d: 48, h: 36, lid: 10, yaw: -0.28, paper: 'pine', ribbon: RED },
        { x: -240, y: 16, w: 50, d: 40, h: 32, lid: 9, yaw: 0.38, paper: 'candy', ribbon: GREEN },
        { x: 124, y: 19, w: 58, d: 46, h: 34, lid: 10, yaw: 0.3, paper: 'wine', ribbon: GOLD },
        { x: 238, y: 14, round: true, r: 30, h: 13, lid: 8, paper: 'can', ribbon: RED },
        { x: 18, y: 25, w: 48, d: 36, h: 24, lid: 8, yaw: -0.16, paper: 'gold', ribbon: GREEN }
    ];

    function projector(yaw) {
        const cy = Math.cos(yaw), sy = Math.sin(yaw), sp = Math.sin(PITCH), cp = Math.cos(PITCH);
        return (x, y, z) => [x * cy + z * sy, -y * cp + (-x * sy + z * cy) * sp];
    }

    function hull(points) {
        const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const half = list => {
            const out = [];
            list.forEach(p => {
                while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
                out.push(p);
            });
            out.pop();
            return out;
        };
        return half(pts).concat(half(pts.slice().reverse()));
    }

    function measure(spec, k) {
        const totalH = (spec.h + spec.lid) * k;
        const sp = Math.sin(PITCH), cp = Math.cos(PITCH);
        const outline = [];
        let bowSize, top;
        if (spec.round) {
            const r = (spec.r + 1.5) * k;
            outline.push([-r, 0], [r, 0], [-r * 0.7, r * sp * 0.72], [r * 0.7, r * sp * 0.72], [0, r * sp], [-r, -totalH * cp], [r, -totalH * cp], [-r * 0.7, -totalH * cp - r * sp * 0.72], [r * 0.7, -totalH * cp - r * sp * 0.72], [0, -totalH * cp - r * sp]);
            bowSize = Math.min(r * 0.84, 26 * k);
            top = [0, -totalH * cp];
        } else {
            const W = (spec.w / 2 + 1.5) * k, D = (spec.d / 2 + 1.5) * k;
            const pr = projector(spec.yaw);
            [[-W, -D], [W, -D], [W, D], [-W, D]].forEach(c => {
                outline.push(pr(c[0], 0, c[1]));
                outline.push(pr(c[0], totalH, c[1]));
            });
            bowSize = Math.min(W, D) * 0.86;
            top = pr(0, totalH, 0);
        }
        const by = top[1];
        outline.push([top[0] - bowSize * 0.9, by - bowSize * 0.5], [top[0] + bowSize * 0.9, by - bowSize * 0.5], [top[0], by - bowSize * 0.76]);
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        outline.forEach(p => {
            if (p[0] < x0) x0 = p[0];
            if (p[0] > x1) x1 = p[0];
            if (p[1] < y0) y0 = p[1];
            if (p[1] > y1) y1 = p[1];
        });
        const m = 16 * k;
        return {
            ox: Math.ceil(m - x0), oy: Math.ceil(m - y0),
            w: Math.ceil(x1 - x0 + m * 2), h: Math.ceil(y1 - y0 + m * 2),
            top, bowSize, hull: hull(outline), yTop: y0
        };
    }

    /* Everything the page needs, in order from back to front. */
    function layoutGifts(o) {
        const k = o.k || 1;
        return GIFTS.map((spec, i) => {
            const M = measure(spec, k);
            const baseX = o.cx + spec.x * k, baseY = o.floor + spec.y * k;
            const clip = M.hull.map(p => (p[0] + M.ox).toFixed(1) + 'px ' + (p[1] + M.oy).toFixed(1) + 'px').join(',');
            return {
                i, k,
                x: Math.round(baseX - M.ox), y: Math.round(baseY - M.oy), w: M.w, h: M.h,
                z: spec.back ? 2 : 6 + i,
                ox: M.ox, oy: M.oy,
                baseX, topY: baseY + M.yTop,
                clip: 'polygon(' + clip + ')'
            };
        });
    }

    const pictureName = (i, part) => 'gift-' + String(i).padStart(2, '0') + '-' + part + '.webp';

    g.NyGifts = { GIFTS, PITCH, projector, measure, layoutGifts, pictureName };
})(window);
