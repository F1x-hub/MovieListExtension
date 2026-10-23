/**
 * Achievement badge artwork: the approved medal-and-shield frames for tiers
 * I–VII (faceted metal rim, laurels, wings, gem, crown, ribbon) with the
 * achievement's icon inside. Badges are self-contained content art, so their
 * metal colors are fixed and do not follow the interface theme.
 */

const PALETTES = [
    ['#F2C091', '#C9824A', '#8E5428', '#4A2A12'],
    ['#F4F7FA', '#C6CED6', '#8B96A2', '#3E4650'],
    ['#FFE79A', '#EDBB32', '#B4840C', '#5C4103'],
    ['#DDF7FA', '#8DD3DE', '#4A9AAA', '#1E4F5A'],
    ['#E9E3FF', '#A898FF', '#6C55E0', '#2F2180'],
    ['#FFD6E8', '#F27BAE', '#BE3B78', '#5E1636'],
    ['#FFE6BF', '#FFA23F', '#DA5616', '#6E2105']
];
const RUBY = ['#FFB3B8', '#E5484D', '#9E2329'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const CX = 60;
const CY = 60;
const LIGHT = [-0.55, -0.83];

const f = n => n.toFixed(1);
const P = list => list.map(q => `${f(q[0])},${f(q[1])}`).join(' ');
const poly = (pts, fill, extra = '') => `<polygon points="${P(pts)}" fill="${fill}" ${extra}/>`;
const offset = (rel, scale = 1, dy = 0) => rel.map(q => [CX + q[0] * scale, CY + dy + q[1] * scale]);
function tone(x, y, p) {
    const dx = x - CX, dy = y - CY, m = Math.hypot(dx, dy) || 1;
    const k = (dx * LIGHT[0] + dy * LIGHT[1]) / m;
    return k > 0.35 ? p[0] : k > -0.25 ? p[1] : p[2];
}
const circlePts = (r, n = 28) => Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
});
const starPts = (cx, cy, R, r) => Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? r : R;
    return [cx + k * Math.cos(a), cy + k * Math.sin(a)];
});

function bevel(outer, k, p, face) {
    let s = '';
    const inner = outer.map(q => [CX + (q[0] - CX) * k, CY + (q[1] - CY) * k]);
    for (let i = 0; i < outer.length; i++) {
        const j = (i + 1) % outer.length, a = outer[i], b = outer[j];
        s += poly([a, b, inner[j], inner[i]], tone((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, p));
    }
    s += poly(inner, face);
    const edge = outer.map(q => [CX + (q[0] - CX) * (k - 0.05), CY + (q[1] - CY) * (k - 0.05)]);
    return s + poly(edge, 'none', `stroke="${p[2]}" stroke-width="0.8"`);
}

function gem(cx, cy, r, c = RUBY) {
    return poly([[cx, cy - r], [cx + r * 0.8, cy], [cx, cy]], c[0])
        + poly([[cx - r * 0.8, cy], [cx, cy - r], [cx, cy]], c[1])
        + poly([[cx - r * 0.8, cy], [cx, cy + r], [cx, cy]], c[1])
        + poly([[cx + r * 0.8, cy], [cx, cy + r], [cx, cy]], c[2]);
}

function ribbon(p, level, label, y = CY + 37) {
    const w = level >= 6 ? 32 : 28;
    let s = '';
    for (const d of [-1, 1]) {
        s += poly([[CX + d * w, y - 3], [CX + d * (w + 10), y - 3], [CX + d * (w + 5), y + 3], [CX + d * (w + 10), y + 9], [CX + d * w, y + 9]], p[2]);
    }
    s += poly([[CX - w, y - 7], [CX + w, y - 7], [CX + w, y + 6], [CX - w, y + 6]], p[1]);
    s += poly([[CX - w, y - 7], [CX + w, y - 7], [CX + w, y - 4], [CX - w, y - 4]], p[0]);
    return s + `<text x="${CX}" y="${y + 3.5}" text-anchor="middle" font-family="Outfit, system-ui, sans-serif" font-size="10" font-weight="600" fill="${p[3]}">${label}</text>`;
}

function laurel(p) {
    let s = '';
    for (const d of [-1, 1]) {
        const P0 = [CX + d * 8, CY + 40], P1 = [CX + d * 50, CY + 30], P2 = [CX + d * 42, CY - 26];
        const at = t => [(1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
        const tangent = t => {
            const x = 2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]);
            const y = 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
            const m = Math.hypot(x, y);
            return [x / m, y / m];
        };
        s += `<path d="M${f(P0[0])} ${f(P0[1])} Q${f(P1[0])} ${f(P1[1])} ${f(P2[0])} ${f(P2[1])}" fill="none" stroke="${p[2]}" stroke-width="2.2" stroke-linecap="round"/>`;
        const leaf = (t, side, len, color) => {
            const b = at(t), g = tangent(t), n = [-g[1] * side * d, g[0] * side * d];
            const dir = [g[0] * Math.cos(0.55) + n[0] * Math.sin(0.55), g[1] * Math.cos(0.55) + n[1] * Math.sin(0.55)];
            const tip = [b[0] + dir[0] * len, b[1] + dir[1] * len];
            const perp = [-dir[1], dir[0]], width = len * 0.32, mid = [(b[0] + tip[0]) / 2, (b[1] + tip[1]) / 2];
            return `<path d="M${f(b[0])} ${f(b[1])} Q${f(mid[0] + perp[0] * width)} ${f(mid[1] + perp[1] * width)} ${f(tip[0])} ${f(tip[1])} Q${f(mid[0] - perp[0] * width)} ${f(mid[1] - perp[1] * width)} ${f(b[0])} ${f(b[1])} Z" fill="${color}"/>`
                + `<path d="M${f(b[0])} ${f(b[1])} L${f(mid[0])} ${f(mid[1])}" stroke="${p[3]}" stroke-width="0.6" opacity=".5"/>`;
        };
        for (let i = 0; i < 6; i++) {
            const t = 0.14 + i * 0.15;
            s += leaf(t, 1, 11 - i * 0.6, p[1]) + leaf(t + 0.06, -1, 10 - i * 0.6, p[2]);
        }
        s += leaf(1, 1, 9, p[0]);
        const knot = at(0.08);
        s += `<circle cx="${f(knot[0])}" cy="${f(knot[1])}" r="2.2" fill="${p[0]}"/>`;
    }
    return s + `<circle cx="${CX}" cy="${CY + 41}" r="3.2" fill="${p[2]}"/>`;
}

function wings(p, big) {
    let s = '';
    const n = big ? 5 : 4;
    for (const d of [-1, 1]) {
        for (let j = n - 1; j >= 0; j--) {
            const bx = CX + d * 26, by = CY - 14 + j * 7, len = (big ? 30 : 24) - j * 3.2;
            const tx = CX + d * (26 + len), ty = by - 14 + j * 3;
            s += poly([[bx, by - 3.5], [tx, ty], [tx - d * 4, ty + 5], [bx, by + 3.5]], j % 2 ? p[2] : p[1]);
            s += poly([[bx, by - 3.5], [tx, ty], [bx + d * len * 0.5, by - 1]], p[0]);
        }
    }
    return s;
}

function rays(p, inner = 20) {
    let s = '';
    for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8, w = inner > 20 ? 0.05 : 0.12, b = a + w, c = a - w;
        s += poly([[CX + inner * Math.cos(c), CY + inner * Math.sin(c)], [CX + 58 * Math.cos(a), CY + 58 * Math.sin(a)], [CX + inner * Math.cos(b), CY + inner * Math.sin(b)]], i % 2 ? p[1] : p[0], 'fill-opacity="0.55"');
    }
    return s;
}

function crown(p, sideGems, y = CY - 41) {
    let s = poly([[CX - 15, y], [CX - 17, y - 13], [CX - 8, y - 6], [CX, y - 17], [CX + 8, y - 6], [CX + 17, y - 13], [CX + 15, y]], p[1], `stroke="${p[2]}" stroke-width="0.8" stroke-linejoin="round"`);
    s += poly([[CX - 15, y], [CX + 15, y], [CX + 15, y - 3], [CX - 15, y - 3]], p[2]);
    s += gem(CX, y - 17, 4);
    if (sideGems) s += `<circle cx="${CX - 17}" cy="${y - 13}" r="2.3" fill="${RUBY[1]}"/><circle cx="${CX + 17}" cy="${y - 13}" r="2.3" fill="${RUBY[1]}"/>`;
    return s;
}

/** The rater's clapperboard, which gains stripes, a star and size with the tier. */
function clapper(level, p, cy) {
    const w = level >= 3 ? 17 : 15, x0 = CX - w, x1 = CX + w, top = cy - 2, bottom = cy + 17;
    let s = '';
    if (level === 1) {
        s += `<rect x="${f(x0)}" y="${f(top)}" width="${f(2 * w)}" height="${f(bottom - top)}" rx="2.5" fill="${p[1]}" stroke="${p[0]}" stroke-width="1"/>`;
        return s + poly([[x0, top - 1], [x1 - 1, top - 10], [x1 - 2.5, top - 15], [x0 - 1.5, top - 6]], p[1], `stroke="${p[0]}" stroke-width="1" stroke-linejoin="round"`);
    }
    s += `<rect x="${f(x0)}" y="${f(top)}" width="${f(2 * w)}" height="${f(bottom - top)}" rx="2.5" fill="${p[1]}"/>`;
    s += `<rect x="${f(x0)}" y="${f(top)}" width="${f(2 * w)}" height="${f((bottom - top) / 2)}" rx="2.5" fill="${p[0]}" opacity=".55"/>`;
    s += `<rect x="${f(x0)}" y="${f(bottom - 4)}" width="${f(2 * w)}" height="4" rx="1.5" fill="${p[2]}"/>`;
    s += `<rect x="${f(x0)}" y="${f(top)}" width="${f(2 * w)}" height="5" fill="${p[0]}"/>`;
    for (let k = 0; k < 4; k++) {
        const x = x0 + 3 + k * (2 * w - 4) / 4;
        s += poly([[x, top], [x + 4, top], [x + 2.2, top + 5], [x - 1.8, top + 5]], p[3]);
    }
    const A = [x0, top - 1], B = [x1 - 1, top - 11], C = [x1 - 2.6, top - 16.5], D = [x0 - 1.6, top - 6.5];
    s += poly([A, B, C, D], p[0]) + poly([A, B, [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2], [(A[0] + D[0]) / 2, (A[1] + D[1]) / 2]], p[1]);
    const lower = t => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    const upper = t => [D[0] + (C[0] - D[0]) * t, D[1] + (C[1] - D[1]) * t];
    for (let k = 0; k < 4; k++) {
        const t0 = 0.12 + k * 0.22, t1 = t0 + 0.11;
        s += poly([lower(t0), lower(t1), upper(t1 + 0.06), upper(t0 + 0.06)], p[3]);
    }
    if (level >= 3) {
        const big = level >= 6;
        s += poly(starPts(CX, cy + 9, big ? 6.8 : 5.6, big ? 2.9 : 2.4), p[3]);
        s += poly(starPts(CX, cy + 9, big ? 4.4 : 3.4, big ? 1.9 : 1.5), p[0]);
    }
    return s;
}

// Line icons on a 24-unit grid, drawn in the tier's light metal.
const GLYPHS = {
    tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M17 2 12 7 7 2"/>',
    ten: '<path d="M5 8l3-2v12"/><rect x="12" y="6" width="7" height="12" rx="3.5"/>',
    thumbsDown: '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    shapes: '<path d="M8.3 10a.7.7 0 0 1-.63-1.08L11.4 3a.7.7 0 0 1 1.2-.04L16.3 8.9a.7.7 0 0 1-.57 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
    hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    landmark: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>',
    sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    camera: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    playCircle: '<circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    thumbsUp: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
    wheel: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/><path d="M12 2v8"/><path d="M12 14v8"/><path d="M2 12h8"/><path d="M14 12h8"/><path d="m4.93 4.93 5.66 5.66"/><path d="m13.41 13.41 5.66 5.66"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-3"/><path d="M11 16v-6"/><path d="M15 16v-9"/><path d="M19 16V4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    pumpkin: '<ellipse cx="12" cy="14.5" rx="9" ry="7"/><path d="M12 7.5c-2.5 2-2.5 12 0 14"/><path d="M12 7.5c2.5 2 2.5 12 0 14"/><path d="M12 7.5V4c1-1 2.5-1 3 0"/>'
};

function glyph(icon, level, p, cy) {
    const paths = GLYPHS[icon];
    if (!paths) return '';
    const scale = level >= 3 ? 1.42 : 1.3;
    const size = 24 * scale;
    let s = '';
    if (level >= 4) s += `<circle cx="${CX}" cy="${f(cy + 4)}" r="${f(size * 0.62)}" fill="${p[2]}" opacity=".45"/>`;
    s += `<g transform="translate(${f(CX - size / 2)} ${f(cy + 4 - size / 2)}) scale(${scale})" fill="none" stroke="${p[0]}" stroke-width="${f(2.1 / scale * 1.25)}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
    return s;
}

function accents(level, p, cy) {
    let s = '';
    if (level >= 5) for (const [x, y] of [[-24, -14], [24, -12], [-23, 14], [23, 14]]) s += poly(starPts(CX + x, cy + y + 4, 3.8, 1.3), p[0]);
    if (level === 7) s += `<circle cx="${CX}" cy="${f(cy + 3)}" r="25" fill="none" stroke="${p[1]}" stroke-width="1" stroke-dasharray="1.5 2.5"/>`;
    return s;
}

/**
 * SVG markup of one badge.
 * @param {Object} def - catalog entry
 * @param {number} tier - 1-based tier to draw (a one-off uses its own frame)
 * @param {{label?: string, title?: string}} [options]
 */
export function renderBadge(def, tier, { title = '' } = {}) {
    const oneOff = Boolean(def?.oneOff);
    const level = oneOff ? 5 : Math.max(1, Math.min(7, Number(tier) || 1));
    const p = PALETTES[level - 1];
    const shieldTop = level <= 2 ? CY - 6 : CY - 9;
    let s = '';
    if (level === 7) s += rays(p);
    if (level >= 5) s += wings(p, level >= 6);
    if (level === 4) s += laurel(p);
    if (level <= 2) s += bevel(circlePts(36), 0.78, p, p[3]);
    else s += bevel(offset([[-30, -34], [0, -38], [30, -34], [33, -8], [27, 14], [15, 30], [0, 38], [-15, 30], [-27, 14], [-33, -8]], 1, -2), 0.8, p, p[3]);
    s += def?.icon === 'clapper' ? clapper(level, p, shieldTop) : glyph(def?.icon, level, p, shieldTop);
    s += accents(level, p, shieldTop);
    if (level === 4 || level === 5) s += gem(CX, CY - 42, 6);
    if (level >= 6) s += crown(p, level === 7);
    if (level >= 2) s += ribbon(p, level, oneOff ? '★' : level === 7 ? '★ VII ★' : ROMAN[level - 1]);
    const label = title ? ` role="img" aria-label="${String(title).replace(/[&<>"]/g, '')}"` : ' aria-hidden="true"';
    return `<svg class="achievement-badge" viewBox="0 0 120 120"${label}>${s}</svg>`;
}

/**
 * Profile rank frame around the avatar: the same metals and ornaments as the
 * badge tiers drawn as a ring. The ring's inner edge (radius 39 of 120) sits
 * on the avatar's edge, so the overlay is sized 120/78 of the avatar.
 * @param {number} level - rank 1..7
 * @param {{label?: boolean}} [options] - label: false leaves the ribbon blank for small previews
 */
export function renderAvatarFrame(level, { label = true } = {}) {
    const rank = Math.max(1, Math.min(7, Number(level) || 1));
    const p = PALETTES[rank - 1];
    let s = '';
    // The frame sits above the photo, so rays and wings start outside the ring.
    if (rank === 7) s += rays(p, 45);
    if (rank >= 5) s += frameWings(p, rank >= 6);
    if (rank === 4) s += laurel(p);
    s += bevel(circlePts(46, 40), 0.85, p, 'none');
    // A dark outline keeps pale metals (silver, platinum) visible on the light theme.
    s += `<circle cx="${CX}" cy="${CY}" r="46" fill="none" stroke="${p[3]}" stroke-width="0.9" opacity=".7"/>`;
    s += `<circle cx="${CX}" cy="${CY}" r="39.2" fill="none" stroke="${p[3]}" stroke-width="0.7" opacity=".7"/>`;
    // II: a second, inner band.
    if (rank >= 2) {
        s += `<circle cx="${CX}" cy="${CY}" r="40.7" fill="none" stroke="${p[0]}" stroke-width="2.2"/>`;
        s += `<circle cx="${CX}" cy="${CY}" r="42" fill="none" stroke="${p[2]}" stroke-width="0.6"/>`;
    }
    // III: notches around the rim and rivets.
    if (rank >= 3) {
        for (let i = 0; i < 40; i++) {
            const a = i * Math.PI / 20;
            s += `<line x1="${f(CX + 43.6 * Math.cos(a))}" y1="${f(CY + 43.6 * Math.sin(a))}" x2="${f(CX + 45.6 * Math.cos(a))}" y2="${f(CY + 45.6 * Math.sin(a))}" stroke="${p[2]}" stroke-width="0.7"/>`;
        }
        for (let i = 0; i < 8; i++) {
            const a = -Math.PI / 2 + Math.PI / 8 + i * Math.PI / 4;
            s += `<circle cx="${f(CX + 43.6 * Math.cos(a))}" cy="${f(CY + 43.6 * Math.sin(a))}" r="2.3" fill="${p[0]}" stroke="${p[3]}" stroke-width="0.6"/>`;
        }
    }
    if (rank === 4 || rank === 5) s += gem(CX, CY - 47, 6);
    if (rank === 5) for (const d of [-1, 1]) s += gem(CX + d * 46, CY, 4.2);
    if (rank >= 6) s += crown(p, rank === 7, CY - 44);
    s += ribbon(p, rank, label ? (rank === 7 ? '★ VII ★' : ROMAN[rank - 1]) : '', CY + 41);
    return `<svg class="rank-frame" viewBox="0 0 120 120" aria-hidden="true">${s}</svg>`;
}

/** Wings for the avatar frame: rooted at the ring so the feathers stay outside the photo. */
function frameWings(p, big) {
    let s = '';
    const n = big ? 5 : 4;
    for (const d of [-1, 1]) {
        for (let j = n - 1; j >= 0; j--) {
            const bx = CX + d * 40, by = CY - 22 + j * 8, len = (big ? 19 : 15) - j * 2.2;
            const tx = CX + d * (40 + len), ty = by - 9 + j * 2;
            s += poly([[bx, by - 3.2], [tx, ty], [tx - d * 3, ty + 4.5], [bx, by + 3.2]], j % 2 ? p[2] : p[1], `stroke="${p[3]}" stroke-width="0.4" stroke-opacity=".5"`);
            s += poly([[bx, by - 3.2], [tx, ty], [bx + d * len * 0.5, by - 0.8]], p[0]);
        }
    }
    return s;
}

export const BADGE_ICONS = Object.keys(GLYPHS).concat('clapper');
