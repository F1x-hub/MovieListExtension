/**
 * Illustrated achievement scenes that grow with the tier (an owlet becomes a
 * great horned owl, a candle becomes a phoenix). A scene is drawn in its own
 * space around (60,54) with radius ~32; AchievementBadge clips and fits it into
 * the frame face. Like the frames, scenes are content art with fixed colors.
 * An icon without a scene keeps its line glyph.
 */

const f = n => n.toFixed(1);

function fluffPath(cx, cy, r, bumps, amp) {
    let d = '';
    for (let i = 0; i <= bumps; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / bumps;
        const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        if (i === 0) { d = `M${f(x)} ${f(y)}`; continue; }
        const m = a - Math.PI / bumps, R = r + amp;
        d += ` Q${f(cx + R * Math.cos(m))} ${f(cy + R * Math.sin(m))} ${f(x)} ${f(y)}`;
    }
    return d + 'Z';
}

const backdrop = fill => `<rect x="-20" y="-20" width="160" height="160" fill="${fill}"/>`;
const radial = (id, stops, at = 'cx="50%" cy="50%" r="50%"') => `<radialGradient id="${id}" ${at}>${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
const linear = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;

/* ── Night owl ─────────────────────────────────────────────────────────── */

function owlEyes(u, x, y, r, pupil, glow) {
    let s = '';
    for (const dx of [-x, x]) {
        if (glow) s += `<circle cx="${dx}" cy="${y}" r="${f(r * 2.1)}" fill="url(#${u}h)"/>`;
        s += `<circle cx="${dx}" cy="${y}" r="${f(r * 1.35)}" fill="#E8D3B0"/><circle cx="${dx}" cy="${y}" r="${r}" fill="url(#${u}e)"/>`;
        s += `<circle cx="${f(dx + r * 0.08)}" cy="${f(y + r * 0.08)}" r="${f(r * pupil)}" fill="#140C04"/>`;
        s += `<circle cx="${f(dx - r * 0.3)}" cy="${f(y - r * 0.32)}" r="${f(r * 0.24)}" fill="#fff"/>`;
    }
    return s;
}

/** Owlet (I–II): one round ball of down with huge eyes, sitting in a nest. */
function owlet(level, u) {
    let s = `<path d="${fluffPath(0, -13, 13, 18, 1.6)}" fill="url(#${u}d)"/>`;
    s += `<path d="${fluffPath(0, -8, 7.5, 12, 1)}" fill="#EFE3CF" opacity=".9"/>`;
    if (level === 2) {
        s += '<path d="M-8 -24 l-1.5 -4 3.5 2.5z M8 -24 l1.5 -4 -3.5 2.5z" fill="#A8947E"/>';
        s += '<path d="M-12.5 -12 q-2 6 2 10 M12.5 -12 q2 6 -2 10" stroke="#7E6A56" stroke-width="1.2" fill="none" stroke-linecap="round"/>';
    }
    return s + owlEyes(u, 5.2, -15.5, 4.3, 0.62, false) + '<path d="M-1.2 -11.5 L0 -9 1.2 -11.5Z" fill="#E09A2A"/>';
}

function feather(x, y, a, len, w, fill) {
    const r = a * Math.PI / 180, cx = x + Math.cos(r) * len / 2, cy = y + Math.sin(r) * len / 2;
    return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(len / 2)}" ry="${w}" fill="${fill}" stroke="#2A1206" stroke-width=".5" transform="rotate(${f(a)} ${f(cx)} ${f(cy)})"/>`;
}

/** Side wings behind the body: folded at VI, opening outward at VII. */
function owlWings(level) {
    const open = level === 7;
    const rows = open
        ? [[38, 27, '#8A4E1C'], [50, 27, '#B5762E'], [62, 26, '#8A4E1C'], [74, 24, '#C88A3E'], [86, 22, '#9A5E24']]
        : [[72, 26, '#4A3220'], [80, 27, '#5E4230'], [88, 25, '#4A3220']];
    const coverts = open ? [[48, 14], [64, 14], [80, 12]] : [[76, 13], [86, 12]];
    let s = '';
    for (const d of [-1, 1]) {
        const ang = a => d > 0 ? a : 180 - a;
        const x = d * (open ? 13 : 14), y = open ? -27 : -26;
        rows.forEach(([a, len, c]) => { s += feather(x, y, ang(a), len, 3.2, c); });
        coverts.forEach(([a, len]) => { s += feather(x, y, ang(a), len, 3, open ? '#E9B45E' : '#8A6A4C'); });
    }
    return s;
}

/** Owl (III–VII): ear tufts lengthen, brows harden, wings open. */
function owl(level, u) {
    const tuft = [0, 0, -4, 0, 1.5, 3, 4][level - 1];
    const tx = 15 + tuft * 0.9, ty = -40 - tuft;
    let s = level >= 6 ? owlWings(level) : '';
    s += `<path d="M-15 -2 C-20 -12 -20 -26 -13 -32 L${f(-tx)} ${f(ty)} L-9 -35 Q0 -38 9 -35 L${f(tx)} ${f(ty)} L13 -32 C20 -26 20 -12 15 -2Z" fill="url(#${u}b)"${level >= 6 ? ' stroke="#2A1206" stroke-width=".9"' : ''}/>`;
    if (level === 3) s += `<path d="${fluffPath(0, -31, 5, 9, 1.2)}" fill="#BFAE98" opacity=".7"/>`;
    s += `<path d="M-10 -2 C-13 -10 -12 -18 -7 -21 Q0 -23 7 -21 C12 -18 13 -10 10 -2Z" fill="url(#${u}y)"/>`;
    s += '<g stroke="#7A5E42" stroke-width=".7" fill="none" opacity=".85">';
    for (let r = 0; r < Math.min(4, level - 1); r++) {
        for (const x of r % 2 ? [-4.5, 1.5] : [-6, 0, 6].slice(0, level >= 5 ? 3 : 2)) s += `<path d="M${x - 1.5} ${-17 + r * 4}q1.5 1.5 3 0"/>`;
    }
    s += '</g><path d="M-15 -20C-18 -14 -17 -6 -13 -2" stroke="#3A2716" stroke-width="1.2" fill="none"/><path d="M15 -20C18 -14 17 -6 13 -2" stroke="#3A2716" stroke-width="1.2" fill="none"/>';
    s += owlEyes(u, 6, -27, level === 3 ? 4.9 : 4.6, level >= 6 ? 0.42 : 0.5, level >= 5);
    if (level >= 5) {
        const dip = level >= 6 ? 4 : 2.5;
        s += `<path d="M-12 -33.5 L-2 ${-33.5 + dip} M12 -33.5 L2 ${-33.5 + dip}" stroke="#2A1A0E" stroke-width="${level >= 6 ? 1.8 : 1.2}" stroke-linecap="round"/>`;
    }
    s += '<path d="M-1.6 -24 L0 -19.5 1.6 -24Z" fill="#E09A2A"/>';
    s += `<g stroke="${level >= 6 ? '#F2B517' : '#D9A21A'}" stroke-width="${level >= 6 ? 1.3 : 1}" stroke-linecap="round" fill="none">`;
    for (const x of [-5, -3, 3, 5]) s += level >= 6 ? `<path d="M${x} -1 q0 2.5 ${x > 0 ? 1 : -1} 3"/>` : `<path d="M${x} -1v2"/>`;
    return s + '</g>';
}

function nest(level) {
    let s = '<path d="M-21 -6 Q0 -2 21 -6 Q19 6 0 7 Q-19 6 -21 -6Z" fill="#5A3D22"/>';
    s += '<g stroke="#8A6238" stroke-width="1" fill="none" stroke-linecap="round"><path d="M-19 -4 Q-4 2 12 -2"/><path d="M-14 1 Q2 4 18 -3"/><path d="M-20 -6 L-25 -9"/><path d="M19 -5 L25 -8"/><path d="M-6 5 Q6 6 14 2"/></g>';
    if (level === 1) s += '<path d="M12 -8 l2 -4 2 3 2 -3 2 4 Q17 -3 12 -8Z" fill="#F4ECDD" stroke="#CDBFA6" stroke-width=".5"/>';
    return s;
}

function nightOwl(level, u) {
    const sky = [
        ['#3A2A22', '#120B08'], ['#34404F', '#0D1219'], ['#3B3060', '#100C24'], ['#1D4A5E', '#071820'],
        ['#3B2D8F', '#0A0824'], ['#5B2558', '#16061A'], ['#3A1430', '#0C0310']
    ][level - 1];
    const gold = level === 7;
    const moon = gold ? { x: 60, y: 40, r: 19 } : { x: 72, y: 35, r: [7, 7.5, 9, 10, 11, 12.5][level - 1] };
    const glow = [0.14, 0.18, 0.28, 0.36, 0.44, 0.52, 0.75][level - 1];
    let s = '<defs>'
        + radial(`${u}s`, [[0, sky[0]], [1, sky[1]]], 'cx="62%" cy="28%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE9A0', glow], [1, '#FFE9A0', 0]])
        + radial(`${u}m`, [[0, '#FFF8D6'], [0.7, '#F5D97A'], [1, '#C99A2E']], 'cx="35%" cy="35%" r="75%"')
        + linear(`${u}b`, gold ? [[0, '#E9B45E'], [1, '#7A3E12']] : level >= 5 ? [[0, '#8A6A4C'], [1, '#3E2A1A']] : [[0, '#A08266'], [1, '#5A4230']])
        + linear(`${u}d`, [[0, '#D8C9B6'], [1, '#8E7C6A']])
        + linear(`${u}y`, [[0, gold ? '#FFE6B0' : '#EAD6B2'], [1, '#A88A64']])
        + radial(`${u}e`, [[0, '#FFF3A8'], [0.6, level >= 6 ? '#FF9A0A' : '#F2B517'], [1, '#B26A00']], 'cx="40%" cy="40%" r="60%"')
        + radial(`${u}h`, [[0, '#FFB020', 0.5], [1, '#FFB020', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (gold) s += '<path d="M14 50 Q34 32 58 42 T106 32 L106 44 Q80 52 58 50 T14 60Z" fill="#7CF2C8" opacity=".2"/>';
    s += `<circle cx="${moon.x}" cy="${moon.y}" r="${moon.r + 13}" fill="url(#${u}g)"/>`;
    if (gold) s += `<circle cx="${moon.x}" cy="${moon.y}" r="${moon.r}" fill="#FFF4DA" opacity=".92"/><circle cx="54" cy="34" r="2.4" fill="#E8D6B0" opacity=".5"/><circle cx="68" cy="46" r="3" fill="#E8D6B0" opacity=".5"/>`;
    else s += `<mask id="${u}k"><circle cx="${moon.x}" cy="${moon.y}" r="${moon.r}" fill="#fff"/><circle cx="${f(moon.x + moon.r * 0.48)}" cy="${f(moon.y - moon.r * 0.32)}" r="${f(moon.r * 0.86)}" fill="#000"/></mask><circle cx="${moon.x}" cy="${moon.y}" r="${moon.r}" fill="url(#${u}m)" mask="url(#${u}k)"/>`;
    [[40, 32, 0.9], [88, 56, 0.7], [48, 24, 0.6], [34, 46, 0.6], [86, 66, 0.5], [30, 60, 0.6], [92, 44, 0.5], [44, 40, 0.5]]
        .slice(0, 1 + level).forEach(([x, y, r]) => { s += `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFF6D0"/>`; });
    [[36, 66], [86, 72], [38, 52]].slice(0, Math.max(0, level - 3)).forEach(([x, y]) => {
        s += `<circle cx="${x}" cy="${y}" r="2.4" fill="#D6FF7A" opacity=".3"/><circle cx="${x}" cy="${y}" r=".9" fill="#F4FFB0"/>`;
    });
    s += `<path d="M20 92 Q40 74 60 78 Q82 74 100 92Z" fill="${sky[1]}"/>`;
    s += '<path d="M22 75 Q60 68 98 75" stroke="#3A2716" stroke-width="3.4" fill="none" stroke-linecap="round"/>';
    if (level >= 2) s += '<path d="M82 73q6-4 9-9" stroke="#3A2716" stroke-width="1.6" fill="none" stroke-linecap="round"/><ellipse cx="91" cy="63" rx="3" ry="1.6" fill="#3E6A44" transform="rotate(-40 91 63)"/>';
    if (level >= 4) s += '<ellipse cx="31" cy="71" rx="2.8" ry="1.4" fill="#3E6A44" transform="rotate(30 31 71)"/>';
    const scale = [1.05, 1.15, 0.82, 0.92, 1, 1.06, 1.04][level - 1];
    return s + `<g transform="translate(60 ${level <= 2 ? 72 : 74}) scale(${scale})">${level <= 2 ? owlet(level, u) + nest(level) : owl(level, u)}</g>`;
}

/* ── Streak: candle → campfire → bonfire → phoenix ─────────────────────── */

function flameShape(x, base, h, w, fill, extra = '') {
    return `<path d="M${f(x)} ${f(base)} C${f(x - w)} ${f(base)} ${f(x - w * 1.05)} ${f(base - h * 0.45)} ${f(x - w * 0.35)} ${f(base - h * 0.72)}`
        + ` C${f(x - w * 0.1)} ${f(base - h * 0.85)} ${f(x - w * 0.05)} ${f(base - h * 0.93)} ${f(x)} ${f(base - h)}`
        + ` C${f(x + w * 0.25)} ${f(base - h * 0.8)} ${f(x + w * 0.55)} ${f(base - h * 0.72)} ${f(x + w * 0.75)} ${f(base - h * 0.5)}`
        + ` C${f(x + w * 1.05)} ${f(base - h * 0.2)} ${f(x + w * 0.7)} ${f(base)} ${f(x)} ${f(base)}Z" fill="${fill}"${extra}/>`;
}

const FLAME = ['#C9301A', '#F2701C', '#FFC23D', '#FFF3C4'];

function layeredFlame(x, base, h, w, colors = FLAME, extra = '') {
    return [1, 0.74, 0.5, 0.28].map((k, i) => flameShape(x, base, h * k, w * k, colors[i], extra)).join('');
}

function candle(u, x, base, h, flameH) {
    let s = `<ellipse cx="${x}" cy="${base}" rx="7" ry="2" fill="#6B4A2A"/>`;
    s += `<rect x="${x - 4}" y="${base - h}" width="8" height="${h}" rx="1.5" fill="url(#${u}w)"/>`;
    s += `<path d="M${x - 4} ${base - h + 1} q2 3 3 0 q1 5 3 1 q1 2 2 -1" fill="#FFF7E6"/>`;
    s += `<path d="M${x} ${base - h} v-2.5" stroke="#2A1A10" stroke-width=".8"/>`;
    return s + layeredFlame(x, base - h - 1.5, flameH, flameH * 0.36);
}

function logs(cx, base, len, thick) {
    let s = '';
    for (const [a, dx] of [[-18, -4], [18, 4]]) {
        s += `<g transform="rotate(${a} ${cx + dx} ${base})"><rect x="${cx + dx - len / 2}" y="${base - thick / 2}" width="${len}" height="${thick}" rx="${thick / 2}" fill="#6A4122"/>`
            + `<rect x="${cx + dx - len / 2}" y="${base - thick / 2}" width="${len}" height="${thick * 0.35}" rx="${thick * 0.17}" fill="#8A5A30"/>`
            + `<circle cx="${cx + dx + (a < 0 ? -1 : 1) * len / 2}" cy="${base}" r="${thick / 2}" fill="#C8955C"/><circle cx="${cx + dx + (a < 0 ? -1 : 1) * len / 2}" cy="${base}" r="${thick / 4}" fill="#8A5A30"/></g>`;
    }
    return s;
}

function embers(count, seed, area) {
    let s = '';
    for (let i = 0; i < count; i++) {
        const t = (i * 0.618 + seed) % 1, x = area[0] + t * (area[2] - area[0]);
        const y = area[1] + ((i * 0.37 + seed * 2) % 1) * (area[3] - area[1]);
        s += `<circle cx="${f(x)}" cy="${f(y)}" r="${i % 3 ? 0.7 : 1.1}" fill="${i % 2 ? '#FFC23D' : '#FF7A1E'}"/>`;
    }
    return s;
}

function streak(level, u) {
    const glow = [0.35, 0.45, 0.55, 0.7, 0.85][Math.min(level, 5) - 1];
    let s = '<defs>'
        + radial(`${u}s`, [[0, level >= 5 ? '#4A1E1A' : '#3A2218'], [1, '#0E0706']], 'cx="50%" cy="70%" r="80%"')
        + radial(`${u}g`, [[0, '#FF9A3C', glow], [1, '#FF9A3C', 0]])
        + `<linearGradient id="${u}w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F3E2C4"/><stop offset=".5" stop-color="#FFF6E4"/><stop offset="1" stop-color="#CDB48C"/></linearGradient>`
        + linear(`${u}au`, [[0, '#FFE79A'], [0.5, '#D9A441'], [1, '#7A5210']])
        + '</defs>' + backdrop(`url(#${u}s)`);
    const glowR = [16, 22, 26, 32, 40][Math.min(level, 5) - 1];
    s += `<circle cx="60" cy="${level >= 5 ? 54 : 62}" r="${glowR}" fill="url(#${u}g)"/>`;
    s += '<path d="M10 80 Q60 70 110 80 L110 120 L10 120Z" fill="#1A0E0A"/>';
    if (level === 1) return s + candle(u, 60, 78, 16, 12);
    if (level === 2) return s + candle(u, 48, 79, 11, 9) + candle(u, 72, 79, 13, 10) + candle(u, 60, 78, 19, 13);
    if (level === 3) {
        s += logs(60, 77, 30, 6);
        return s + layeredFlame(60, 75, 32, 11) + embers(5, 0.2, [48, 38, 72, 58]);
    }
    if (level === 4) {
        for (let i = 0; i < 9; i++) {
            const a = Math.PI * (0.05 + i * 0.1125);
            s += `<ellipse cx="${f(60 + 24 * Math.cos(a))}" cy="${f(79 + 4 * Math.sin(a))}" rx="4.2" ry="2.6" fill="${i % 2 ? '#5E5A58' : '#77716C'}"/>`;
        }
        s += logs(60, 76, 32, 6);
        s += layeredFlame(52, 75, 26, 8) + layeredFlame(68, 75, 28, 8) + layeredFlame(60, 74, 38, 11);
        return s + embers(9, 0.4, [40, 26, 80, 54]);
    }
    // V: an eternal flame in a golden cauldron — uneven living tongues of fire and a column of sparks.
    s += '<rect x="46" y="86" width="28" height="4" rx="1" fill="#5A3A10"/><path d="M54 86 L56 78 H64 L66 86Z" fill="url(#' + u + 'au)"/>';
    const tongues = [[44, 20, 8, -22], [52, 32, 9, -9], [60, 46, 12, 2], [68, 30, 9, 12], [76, 18, 7, 24]];
    for (const [x, h, w, lean] of tongues) s += `<g transform="rotate(${lean} ${x} 66)">${flameShape(x, 66, h, w, FLAME[0])}</g>`;
    for (const [x, h, w, lean] of tongues) s += `<g transform="rotate(${lean} ${x} 66)">${flameShape(x, 66, h * 0.72, w * 0.72, FLAME[1])}</g>`;
    for (const [x, h, w, lean] of tongues.slice(1, 4)) s += `<g transform="rotate(${lean} ${x} 66)">${flameShape(x, 66, h * 0.5, w * 0.5, FLAME[2])}</g>`;
    s += flameShape(60, 66, 18, 5.4, FLAME[3]);
    s += [[50, 26, 3], [70, 30, 2.6], [58, 14, 3.4], [64, 20, 2.2]].map(([x, y, h]) => flameShape(x, y, h * 2, h * 0.7, FLAME[1])).join('');
    s += '<path d="M32 64 H88 Q86 80 60 80 Q34 80 32 64Z" fill="url(#' + u + 'au)"/><rect x="30" y="62" width="60" height="4" rx="2" fill="#FFE79A"/>';
    s += '<path d="M36 70 H84" stroke="#7A5210" stroke-width=".8"/><g fill="#7A5210">' + [42, 51, 60, 69, 78].map(x => `<circle cx="${x}" cy="74" r="1.3"/>`).join('') + '</g>';
    let sp = '';
    for (let i = 0; i < 16; i++) {
        const t = i / 15, x = 60 + Math.sin(t * 9) * (6 + t * 14), y = 46 - t * 30;
        sp += `<circle cx="${f(x)}" cy="${f(y)}" r="${i % 3 ? 0.7 : 1.1}" fill="${i % 2 ? '#FFC23D' : '#FF7A1E'}"/>`;
    }
    return s + sp;
}

/* ── Collector: one cassette → shelf → bookcase → library ──────────────── */

const SPINES = ['#B8432F', '#2F6E8E', '#D9A441', '#5B8A4A', '#7A4A8C', '#C8683A', '#3E4F7A', '#A33A5A'];

function spineRow(x0, x1, base, seed, ribbons) {
    let s = '', x = x0, i = 0;
    while (x < x1 - 3) {
        const w = 3.6 + ((i * 7 + seed) % 3) * 0.9, h = 12 + ((i * 5 + seed) % 4) * 1.6;
        const c = SPINES[(i + seed) % SPINES.length];
        const tilt = i === 3 && seed % 2 ? ` transform="rotate(-8 ${f(x + w)} ${base})"` : '';
        s += `<g${tilt}><rect x="${f(x)}" y="${f(base - h)}" width="${f(w)}" height="${f(h)}" rx=".6" fill="${c}"/>`
            + `<rect x="${f(x)}" y="${f(base - h)}" width="${f(w * 0.3)}" height="${f(h)}" fill="#fff" opacity=".14"/>`
            + `<rect x="${f(x + 0.6)}" y="${f(base - h * 0.7)}" width="${f(w - 1.2)}" height="1.3" fill="#F6E7C8" opacity=".75"/></g>`;
        if (ribbons.includes(i)) s += `<path d="M${f(x + w / 2 - 0.9)} ${f(base - h)} v${f(h * 0.75)} l.9 -1.4 .9 1.4 v${f(-h * 0.75)}Z" fill="#E5484D"/>`;
        x += w + 0.7; i++;
    }
    return s;
}

function plank(x0, x1, y) {
    return `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="3" rx=".8" fill="#7A4E2A"/><rect x="${x0}" y="${y}" width="${x1 - x0}" height="1" fill="#A8743F"/>`;
}

function cassette(x, y, w, ribbon) {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${w * 0.55}" rx="1.5" fill="#2A2A30"/>`;
    s += `<rect x="${x + w * 0.12}" y="${y + w * 0.09}" width="${w * 0.76}" height="${w * 0.2}" rx=".8" fill="#F1E3C6"/>`;
    s += `<rect x="${x + w * 0.22}" y="${y + w * 0.33}" width="${w * 0.56}" height="${w * 0.14}" rx="${w * 0.07}" fill="#141418"/>`;
    s += `<circle cx="${x + w * 0.33}" cy="${y + w * 0.4}" r="${w * 0.05}" fill="#8E8E96"/><circle cx="${x + w * 0.67}" cy="${y + w * 0.4}" r="${w * 0.05}" fill="#8E8E96"/>`;
    if (ribbon) s += `<path d="M${x + w * 0.78} ${y - 1} v${w * 0.75} l1.4 -2 1.4 2 v${-w * 0.75}Z" fill="#E5484D"/>`;
    return s;
}

function collector(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, '#5A3A26'], [1, '#1E120B']], 'cx="70%" cy="20%" r="90%"')
        + radial(`${u}g`, [[0, '#FFD98A', 0.55], [1, '#FFD98A', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    s += '<g stroke="#2A1810" stroke-width=".6" opacity=".35">' + [30, 46, 62, 78].map(x => `<path d="M${x} 10V100"/>`).join('') + '</g>';
    if (level === 1) {
        s += '<circle cx="60" cy="56" r="20" fill="url(#' + u + 'g)" opacity=".6"/>';
        s += plank(36, 84, 72);
        return s + cassette(44, 56, 32, true);
    }
    if (level === 2) {
        s += plank(30, 90, 70);
        return s + spineRow(33, 66, 70, 1, [2]) + cassette(66, 61, 20, false);
    }
    if (level === 3) {
        s += plank(28, 92, 52) + plank(28, 92, 74);
        s += spineRow(31, 89, 52, 2, [1, 6]) + spineRow(31, 70, 74, 5, [3]);
        s += '<path d="M74 74 l2 -13 h12 l2 13Z" fill="#F4F0E6"/><g fill="#E5484D"><rect x="77" y="61" width="2" height="13"/><rect x="83" y="61" width="2" height="13"/></g>';
        return s + '<g fill="#FFF3C8"><circle cx="78" cy="59" r="2.2"/><circle cx="82" cy="58" r="2.4"/><circle cx="86" cy="59.5" r="2"/></g>';
    }
    // IV: a full bookcase under a warm hanging lamp, golden ribbons marking favourites.
    s += '<rect x="26" y="32" width="68" height="60" rx="2" fill="#4A2E1A"/>';
    s += plank(26, 94, 52) + plank(26, 94, 70) + plank(26, 94, 88);
    s += spineRow(29, 91, 52, 3, [2, 8]) + spineRow(29, 91, 70, 6, [4]) + spineRow(29, 91, 88, 4, [1, 7]);
    s += `<circle cx="60" cy="30" r="24" fill="url(#${u}g)"/><path d="M60 14 v8" stroke="#2A1810" stroke-width=".8"/>`;
    s += '<path d="M52 28 Q60 19 68 28Z" fill="#D9A441"/><ellipse cx="60" cy="28.3" rx="8" ry="1.3" fill="#B5832E"/><circle cx="60" cy="29.8" r="1.8" fill="#FFF3C8"/>';
    return s + '<g fill="#F2C14E"><path d="M44 52 v8 l1 -1.5 1 1.5 v-8Z"/><path d="M60 70 v8 l1 -1.5 1 1.5 v-8Z"/><path d="M70 88 v4 l1 -1.5 1 1.5 v-4Z"/></g>';
}

/* ── Traveler: folded map → compass → suitcase → globe → flight round the world ── */

function pin(x, y, c = '#E5484D') {
    return `<path d="M${x} ${y + 6} L${x - 2.6} ${y + 1} A3 3 0 1 1 ${x + 2.6} ${y + 1}Z" fill="${c}" stroke="#7A1E22" stroke-width=".4"/><circle cx="${x}" cy="${y - 0.4}" r="1.1" fill="#fff"/>`;
}

function globe(u, cx, cy, r, routes, pins) {
    let s = `<clipPath id="${u}gc"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${u}o)"/><g clip-path="url(#${u}gc)"><g transform="translate(${cx} ${cy}) scale(${f(r / 18)})">`;
    s += '<path d="M-14 -12 q6 -4 12 -1 q3 4 -1 7 q-5 1 -6 6 q-4 2 -6 -2 q-3 -5 1 -10Z" fill="#5BAA5E"/>';
    s += '<path d="M2 -16 q8 -2 13 4 q1 5 -4 6 q-3 3 -7 1 q-4 -4 -2 -11Z" fill="#6DBB62"/>';
    s += '<path d="M4 2 q6 -1 8 4 q0 6 -5 9 q-4 -1 -4 -6 q-2 -4 1 -7Z" fill="#5BAA5E"/><path d="M-12 8 q4 0 5 4 q-2 4 -6 2Z" fill="#6DBB62"/>';
    s += '<g fill="none" stroke="#fff" stroke-width=".4" opacity=".35"><ellipse rx="18" ry="6"/><ellipse rx="7" ry="18"/><path d="M-18 0H18M0 -18V18"/></g>';
    if (routes) s += '<g fill="none" stroke="#FFF3C8" stroke-width=".9" stroke-dasharray="1.6 1.4"><path d="M-9 -6 Q0 -16 9 -9"/><path d="M9 -9 Q14 0 7 7"/><path d="M-9 -6 Q-12 6 -9 11"/></g>';
    s += '</g></g>' + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${u}sh)"/>`;
    return s + pins.map(([x, y]) => pin(cx + x * r / 18, cy + y * r / 18 - 5)).join('');
}

function traveler(level, u) {
    const dusk = level >= 5;
    let s = '<defs>'
        + linear(`${u}s`, dusk ? [[0, '#2B2F6E'], [0.6, '#8A4E8C'], [1, '#F2A46B']] : [[0, '#2E78B8'], [1, '#A8D8EE']])
        + radial(`${u}o`, [[0, '#5FB8E8'], [1, '#1F5E9A']], 'cx="38%" cy="35%" r="70%"')
        + radial(`${u}sh`, [[0, '#fff', 0], [0.7, '#fff', 0], [1, '#0A1E3A', 0.45]], 'cx="40%" cy="38%" r="62%"')
        + radial(`${u}g`, [[0, '#BFE8FF', 0.6], [1, '#BFE8FF', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    const cloud = (x, y, k) => `<g fill="#fff" opacity=".85" transform="translate(${x} ${y}) scale(${k})"><circle cx="0" cy="0" r="4"/><circle cx="5" cy="-2" r="5"/><circle cx="10" cy="0" r="4"/><rect x="0" y="0" width="10" height="4"/></g>`;
    if (level <= 2) {
        s += cloud(34, 34, 0.8) + cloud(76, 28, 0.6);
        const top = level === 1 ? 44 : 58;
        const k = level === 1 ? 1 : 0.8, m = (x, y) => `${f(60 + (x - 60) * k)},${f(top + (y - 44) * k)}`;
        s += `<polygon points="${[[34, 48], [47, 44], [60, 48], [73, 44], [86, 48], [86, 76], [73, 72], [60, 76], [47, 72], [34, 76]].map(q => m(...q)).join(' ')}" fill="#F3E6C4"/>`;
        s += `<polygon points="${[[47, 44], [60, 48], [60, 76], [47, 72]].map(q => m(...q)).join(' ')}" fill="#E0CFA6"/><polygon points="${[[73, 44], [86, 48], [86, 76], [73, 72]].map(q => m(...q)).join(' ')}" fill="#E0CFA6"/>`;
        s += `<g transform="translate(${f(60 - 60 * k)} ${f(top - 44 * k)}) scale(${k})"><path d="M38 54 q6 -4 12 0 q4 6 -2 10 q-8 2 -10 -4Z" fill="#8CC48A"/><path d="M64 60 q8 -5 16 0 q2 7 -6 9 q-8 0 -10 -9Z" fill="#8CC48A"/>`
            + '<path d="M42 66 Q56 50 68 60 T82 54" fill="none" stroke="#C0392B" stroke-width="1" stroke-dasharray="2 1.6"/></g>';
        if (level === 1) return s + pin(68, 52);
        s += `<circle cx="60" cy="50" r="13" fill="#B5832E"/><circle cx="60" cy="50" r="11" fill="#FFF8E8"/>`;
        s += '<g stroke="#5A3D22" stroke-width=".8"><path d="M60 40.5v2.5M60 57v2.5M50.5 50h2.5M67 50h2.5"/></g>';
        return s + '<path d="M60 41.5 L62.4 50 L57.6 50Z" fill="#E5484D"/><path d="M60 58.5 L62.4 50 L57.6 50Z" fill="#4A4F5A"/><circle cx="60" cy="50" r="1.3" fill="#B5832E"/>';
    }
    if (level === 3) {
        s += cloud(30, 34, 0.7) + cloud(80, 38, 0.55);
        s += '<path d="M52 46 v-5 q0 -3 3 -3 h10 q3 0 3 3 v5" fill="none" stroke="#3A2716" stroke-width="2.4"/>';
        s += '<rect x="34" y="46" width="52" height="34" rx="4" fill="#A0582A"/><rect x="34" y="46" width="52" height="5" rx="2" fill="#C0743C"/>';
        s += '<g fill="#5A3010"><rect x="44" y="46" width="3" height="34"/><rect x="73" y="46" width="3" height="34"/></g>';
        s += '<circle cx="56" cy="60" r="6" fill="#2E78B8"/><path d="M52 60 h8 M56 56 v8" stroke="#FFF3C8" stroke-width=".8"/>';
        s += '<rect x="61" y="66" width="10" height="7" rx="1" fill="#F2C14E" transform="rotate(-10 66 69)"/><circle cx="40" cy="70" r="3.6" fill="#E5484D"/><rect x="77" y="54" width="7" height="9" rx="1" fill="#5BAA5E" transform="rotate(8 80 58)"/>';
        return s + '<path d="M38 56 l6 2 -6 2 1 -2Z" fill="#fff"/><rect x="34" y="80" width="6" height="3" rx="1" fill="#2A1A10"/><rect x="80" y="80" width="6" height="3" rx="1" fill="#2A1A10"/>';
    }
    if (level === 4) {
        s += cloud(28, 36, 0.6) + cloud(82, 70, 0.6);
        s += '<path d="M60 84 v-6" stroke="#8A6238" stroke-width="2.4"/><ellipse cx="60" cy="85" rx="12" ry="3" fill="#5A3D22"/>';
        s += '<path d="M40 70 A21 21 0 0 0 80 40" fill="none" stroke="#C8955C" stroke-width="2.2"/>';
        return s + globe(u, 60, 54, 18, true, [[-9, -6], [9, -9], [7, 7]]);
    }
    s += `<circle cx="60" cy="56" r="34" fill="url(#${u}g)"/>`;
    s += [[36, 32], [84, 30], [30, 52], [92, 48]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".7" fill="#FFF6D0"/>`).join('');
    s += '<ellipse cx="60" cy="56" rx="30" ry="9" fill="none" stroke="#FFF3C8" stroke-width=".9" stroke-dasharray="2 1.6" transform="rotate(-14 60 56)"/>';
    s += globe(u, 60, 56, 21, true, [[-9, -6], [9, -9], [7, 7], [-9, 11]]);
    s += cloud(30, 74, 0.7) + cloud(76, 80, 0.6);
    return s + '<g transform="translate(86 46) rotate(-30)"><path d="M-8 0 Q0 -2 8 0 Q0 2 -8 0Z" fill="#fff"/><path d="M-1 0 L-4 -6 L-2 -6 L3 0Z M-1 0 L-4 6 L-2 6 L3 0Z" fill="#E6EEF5"/><path d="M-8 0 l-2 -3 h2 l2 3Z" fill="#E5484D"/></g>';
}

/* ── Hours watched: wristwatch → alarm clock → wall clock → grandfather clock → clock tower ── */

function clockFace(cx, cy, r, rim, glow = false) {
    let s = `<circle cx="${cx}" cy="${cy}" r="${f(r + 1.6)}" fill="${rim}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${glow ? '#FFF1C2' : '#FBF5E6'}"/>`;
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6, k = i % 3 ? 0.86 : 0.76;
        s += `<path d="M${f(cx + r * 0.95 * Math.cos(a))} ${f(cy + r * 0.95 * Math.sin(a))} L${f(cx + r * k * Math.cos(a))} ${f(cy + r * k * Math.sin(a))}" stroke="#3A2A1A" stroke-width="${i % 3 ? 0.5 : 0.9}"/>`;
    }
    s += `<path d="M${cx} ${cy} L${f(cx - r * 0.42)} ${f(cy - r * 0.3)}" stroke="#2A1A10" stroke-width="${f(Math.max(1, r * 0.09))}" stroke-linecap="round"/>`;
    s += `<path d="M${cx} ${cy} L${f(cx + r * 0.5)} ${f(cy - r * 0.55)}" stroke="#2A1A10" stroke-width="${f(Math.max(0.7, r * 0.06))}" stroke-linecap="round"/>`;
    return s + `<circle cx="${cx}" cy="${cy}" r="${f(Math.max(0.8, r * 0.08))}" fill="#C0392B"/>`;
}

function hours(level, u) {
    const night = level >= 5;
    let s = '<defs>'
        + radial(`${u}s`, night ? [[0, '#2E3570'], [1, '#0B0C22']] : [[0, '#4A3A5E'], [1, '#17111F']], 'cx="50%" cy="30%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.55], [1, '#FFE6A0', 0]])
        + linear(`${u}w`, [[0, '#9A5E30'], [1, '#5A3418']])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) {
        s += '<rect x="53" y="28" width="14" height="52" rx="4" fill="#6B3E1E"/><g fill="#4A2A12">' + [34, 40, 70, 76].map(y => `<rect x="53" y="${y}" width="14" height="1"/>`).join('') + '</g>';
        return s + `<circle cx="60" cy="54" r="18" fill="url(#${u}g)"/>` + '<rect x="69" y="52" width="3" height="4" rx="1" fill="#D9A441"/>' + clockFace(60, 54, 11, '#D9A441');
    }
    if (level === 2) {
        s += `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>`;
        s += '<path d="M47 70 l-4 6 M73 70 l4 6" stroke="#8E1E22" stroke-width="2.4" stroke-linecap="round"/>';
        s += '<path d="M45 40 a6 6 0 0 1 10 -6 Z M75 40 a6 6 0 0 0 -10 -6 Z" fill="#D9A441"/><path d="M60 37 v-4 M56 32 h8" stroke="#8E1E22" stroke-width="1.6" stroke-linecap="round"/>';
        return s + '<circle cx="60" cy="55" r="17" fill="#C0392B"/>' + clockFace(60, 55, 13, '#E5484D');
    }
    if (level === 3) {
        s += '<path d="M60 24 L80 36 V60 Q80 64 76 64 H44 Q40 64 40 60 V36Z" fill="url(#' + u + 'w)"/>';
        s += '<rect x="52" y="64" width="16" height="20" rx="1" fill="#4A2A12"/><path d="M60 64 L57 79" stroke="#D9A441" stroke-width=".8"/><circle cx="57" cy="80" r="2.6" fill="#D9A441"/>';
        return s + clockFace(60, 46, 12, '#D9A441') + '<path d="M60 24 L80 36 L78 37 L60 26 L42 37 L40 36Z" fill="#C8955C"/>';
    }
    if (level === 4) {
        s += `<circle cx="60" cy="44" r="24" fill="url(#${u}g)"/>`;
        s += '<path d="M47 36 Q60 22 73 36 V90 H47Z" fill="url(#' + u + 'w)"/><rect x="45" y="86" width="30" height="4" rx="1" fill="#3A2010"/>';
        s += '<rect x="53" y="56" width="14" height="26" rx="6" fill="#2A1A10"/><path d="M60 56 V76" stroke="#D9A441" stroke-width=".8"/><circle cx="60" cy="77" r="3.2" fill="#F2C14E"/>';
        s += '<g fill="#D9A441"><circle cx="60" cy="27" r="1.6"/><circle cx="48" cy="36" r="1.2"/><circle cx="72" cy="36" r="1.2"/></g>';
        return s + clockFace(60, 42, 9.5, '#D9A441');
    }
    s += [[34, 30], [86, 28], [30, 46], [90, 58], [80, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".7" fill="#FFF6D0"/>`).join('');
    s += '<mask id="' + u + 'k"><circle cx="82" cy="34" r="6" fill="#fff"/><circle cx="85" cy="32" r="5" fill="#000"/></mask><circle cx="82" cy="34" r="6" fill="#F5D97A" mask="url(#' + u + 'k)"/>';
    s += '<path d="M60 18 L70 34 H50Z" fill="#3A4A6A"/><rect x="48" y="34" width="24" height="60" fill="#5A5E78"/><rect x="48" y="34" width="6" height="60" fill="#6E7290"/>';
    s += `<circle cx="60" cy="50" r="20" fill="url(#${u}g)"/>` + clockFace(60, 50, 9.5, '#C8A24A', true);
    s += '<g fill="#FFD98A">' + [66, 76].map(y => `<rect x="52" y="${y}" width="4" height="6" rx="2"/><rect x="64" y="${y}" width="4" height="6" rx="2"/>`).join('') + '</g>';
    return s + '<path d="M20 94 H100 V100 H20Z" fill="#0B0C22"/><path d="M30 88 h12 v6 h-12Z M78 86 h14 v8 h-14Z" fill="#1C1E3A"/>';
}

/* ── Rater: a clapperboard grows into a film set and a golden statuette ── */

function clapperboard(x, y, w) {
    const h = w * 0.62, arm = w * 0.2;
    let s = `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="1.4" fill="#22222A"/>`;
    s += `<rect x="${f(x + w * 0.08)}" y="${f(y + h * 0.42)}" width="${f(w * 0.84)}" height="${f(h * 0.12)}" fill="#F1E9D8" opacity=".85"/><rect x="${f(x + w * 0.08)}" y="${f(y + h * 0.66)}" width="${f(w * 0.5)}" height="${f(h * 0.1)}" fill="#F1E9D8" opacity=".6"/>`;
    s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(arm)}" fill="#F1E9D8"/>`;
    for (let i = 0; i < 4; i++) s += `<path d="M${f(x + w * (0.05 + i * 0.25))} ${f(y)} h${f(w * 0.12)} l${f(-w * 0.08)} ${f(arm)} h${f(-w * 0.12)}Z" fill="#22222A"/>`;
    s += `<g transform="rotate(-18 ${f(x)} ${f(y)})"><rect x="${f(x)}" y="${f(y - arm)}" width="${f(w)}" height="${f(arm)}" fill="#F1E9D8"/>`;
    for (let i = 0; i < 4; i++) s += `<path d="M${f(x + w * (0.05 + i * 0.25))} ${f(y - arm)} h${f(w * 0.12)} l${f(-w * 0.08)} ${f(arm)} h${f(-w * 0.12)}Z" fill="#22222A"/>`;
    return s + '</g>';
}

function star5(cx, cy, R, fill) {
    return `<polygon points="${Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? R * 0.42 : R; return `${f(cx + k * Math.cos(a))},${f(cy + k * Math.sin(a))}`; }).join(' ')}" fill="${fill}"/>`;
}

function spotlight(x, y, toX, spread, u) {
    return `<path d="M${x} ${y} L${toX - spread} 96 L${toX + spread} 96Z" fill="url(#${u}b)"/>`;
}

function camera(x, y) {
    let s = `<g stroke="#2A2A30" stroke-width="1.6" stroke-linecap="round"><path d="M${x} ${y + 10} L${x - 9} ${y + 30} M${x} ${y + 10} L${x + 9} ${y + 30} M${x} ${y + 10} V${y + 30}"/></g>`;
    s += `<circle cx="${x - 6}" cy="${y - 8}" r="6.5" fill="#3A3A44"/><circle cx="${x + 6}" cy="${y - 8}" r="6.5" fill="#3A3A44"/>`;
    s += `<circle cx="${x - 6}" cy="${y - 8}" r="2" fill="#8E8E96"/><circle cx="${x + 6}" cy="${y - 8}" r="2" fill="#8E8E96"/>`;
    s += `<rect x="${x - 11}" y="${y - 2}" width="22" height="13" rx="2" fill="#2A2A30"/><path d="M${x + 11} ${y + 1} l7 -3 v15 l-7 -3Z" fill="#3A3A44"/>`;
    return s + `<circle cx="${x - 5}" cy="${y + 4.5}" r="1.6" fill="#E5484D"/>`;
}

function rater(level, u) {
    const lit = level >= 6;
    let s = '<defs>'
        + radial(`${u}s`, [[0, level >= 4 ? '#4A1E2A' : '#2E2230'], [1, '#0E0A10']], 'cx="50%" cy="35%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + linear(`${u}b`, [[0, '#FFF3C8'], [1, '#FFF3C8']]).replace('<stop offset="1" stop-color="#FFF3C8"/>', '<stop offset="1" stop-color="#FFF3C8" stop-opacity="0"/>')
        + linear(`${u}au`, [[0, '#FFE79A'], [0.5, '#E8B23A'], [1, '#9A6A10']])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level >= 4) {
        s += '<g fill="#7A1E2A">' + [24, 32].map(x => `<path d="M${x} 10 q4 40 0 90 h8 q-3 -50 0 -90Z"/>`).join('') + [88, 96].map(x => `<path d="M${x} 10 q-4 40 0 90 h-8 q3 -50 0 -90Z"/>`).join('') + '</g>';
    }
    s += '<path d="M10 82 Q60 76 110 82 V120 H10Z" fill="#1A1016"/>';
    if (lit) s += `<g opacity=".4">${spotlight(34, 22, 54, 12, u)}${spotlight(86, 22, 66, 12, u)}</g><circle cx="34" cy="22" r="3" fill="#FFF3C8"/><circle cx="86" cy="22" r="3" fill="#FFF3C8"/>`;
    if (level >= 6) s += '<path d="M48 96 L54 80 H66 L72 96Z" fill="#B8243A"/><path d="M54 80 H66 L67 83 H53Z" fill="#D6324A"/>';
    if (level <= 3) {
        s += `<circle cx="60" cy="56" r="${16 + level * 4}" fill="url(#${u}g)"/>`;
        const w = [26, 26, 24][level - 1];
        s += clapperboard(level === 3 ? 42 : 60 - w / 2, level === 1 ? 54 : 58, w);
        if (level >= 2) s += star5(level === 3 ? 54 : 60, 40, 6, '#F2C14E');
        if (level === 3) {
            s += '<path d="M68 82 l2 -18 h14 l2 18Z" fill="#F4F0E6"/><g fill="#E5484D"><rect x="72" y="64" width="2.4" height="18"/><rect x="79" y="64" width="2.4" height="18"/></g>';
            s += '<g fill="#FFF3C8"><circle cx="71" cy="62" r="3"/><circle cx="76" cy="60" r="3.3"/><circle cx="81" cy="61.5" r="3"/><circle cx="74" cy="58" r="2.4"/></g>';
        }
        return s;
    }
    if (level === 4) {
        s += `<circle cx="60" cy="58" r="26" fill="url(#${u}g)"/>`;
        s += '<g stroke="#8A5A30" stroke-width="2" stroke-linecap="round"><path d="M46 84 L56 62 M74 84 L64 62 M46 62 L74 84 M74 62 L46 84"/></g>';
        s += '<rect x="44" y="60" width="32" height="4" rx="1" fill="#2A2A30"/><rect x="47" y="42" width="26" height="12" rx="1" fill="#2A2A30"/><path d="M47 42 V64 M73 42 V64" stroke="#8A5A30" stroke-width="2"/>';
        return s + clapperboard(52, 50, 16) + '<path d="M56 46 h8" stroke="#F2C14E" stroke-width="1.2"/>';
    }
    if (level === 5) {
        s += `<circle cx="56" cy="52" r="26" fill="url(#${u}g)"/>`;
        return s + camera(54, 52) + clapperboard(70, 74, 14);
    }
    if (level === 6) return s + `<circle cx="60" cy="54" r="24" fill="url(#${u}g)"/>` + camera(52, 50) + clapperboard(66, 70, 16) + star5(74, 38, 4.5, '#F2C14E') + star5(46, 30, 3, '#F2C14E');
    // VII: a golden film-award statuette raising a star, standing on a film reel, under crossed spotlights.
    s += `<circle cx="60" cy="44" r="30" fill="url(#${u}g)"/>`;
    s += '<path d="M46 86 L49 78 H71 L74 86Z" fill="#1E1E24"/><path d="M49 78 H71 L71.6 80 H48.4Z" fill="#3A3A44"/><rect x="50" y="82" width="20" height="1" fill="#C8A24A"/>';
    s += `<rect x="51" y="72" width="18" height="6" rx="1" fill="url(#${u}au)"/>`;
    s += '<g fill="#5A3E0A">' + [53.5, 57.5, 61.5, 65.5].map(x => `<circle cx="${x}" cy="75" r="1.1"/>`).join('') + '</g>';
    s += `<path d="M55 45 Q60 43 65 45 L63.6 53 Q62.6 57 63.2 61 L64.4 72 H55.6 L56.8 61 Q57.4 57 56.4 53Z" fill="url(#${u}au)"/>`;
    s += '<path d="M60 58 V72" stroke="#9A6A10" stroke-width=".6" opacity=".7"/><path d="M57.2 47 Q57 54 58 60" stroke="#FFF3C8" stroke-width="1" fill="none" opacity=".6" stroke-linecap="round"/>';
    s += `<path d="M55.6 45.6 Q52.6 41 55.4 34.6 M64.4 45.6 Q67.4 41 64.6 34.6" fill="none" stroke="url(#${u}au)" stroke-width="2.2" stroke-linecap="round"/>`;
    s += `<rect x="58.6" y="41.4" width="2.8" height="2.6" fill="url(#${u}au)"/><circle cx="60" cy="38.6" r="3.4" fill="url(#${u}au)"/><circle cx="58.9" cy="37.6" r="1" fill="#FFF3C8" opacity=".6"/>`;
    s += star5(60, 29, 7.5, '#FFE79A') + star5(60, 29, 3.6, '#FFF6D0');
    return s + [[40, 34, '#E5484D'], [78, 30, '#5BAA5E'], [36, 56, '#F2C14E'], [84, 52, '#2F6E8E'], [46, 24, '#F2C14E'], [74, 62, '#E5484D']]
        .map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="2.4" height="1.4" fill="${c}" transform="rotate(${i * 37} ${x} ${y})"/>`).join('');
}

/* ── Series: one old TV → retro set → couch → episode wall → binge wall of screens ── */

const PICTURES = ['#4AA3D9', '#E5484D', '#F2C14E', '#5BAA5E', '#7A4A8C', '#C8683A', '#2F6E8E', '#D9A441', '#A33A5A'];

function screen(x, y, w, h, i, u) {
    return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="1" fill="${PICTURES[i % PICTURES.length]}"/>`
        + `<path d="M${f(x)} ${f(y + h)} L${f(x + w * 0.35)} ${f(y + h * 0.55)} L${f(x + w * 0.55)} ${f(y + h * 0.75)} L${f(x + w * 0.75)} ${f(y + h * 0.45)} L${f(x + w)} ${f(y + h)}Z" fill="#000" opacity=".22"/>`
        + `<circle cx="${f(x + w * 0.75)}" cy="${f(y + h * 0.28)}" r="${f(h * 0.12)}" fill="#FFF6D0" opacity=".8"/>`
        + `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="1" fill="url(#${u}gl)"/>`;
}

function series(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, '#2E3550'], [1, '#0C0E18']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#9FD6FF', 0.45], [1, '#9FD6FF', 0]])
        + '<linearGradient id="' + u + 'gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>'
        + '</defs>' + backdrop(`url(#${u}s)`);
    s += '<path d="M10 80 H110 V120 H10Z" fill="#1A1C2A"/>';
    if (level <= 2) {
        s += `<circle cx="60" cy="54" r="${level === 1 ? 20 : 26}" fill="url(#${u}g)"/>`;
        s += '<path d="M56 38 L48 26 M64 38 L72 26" stroke="#8E8E96" stroke-width="1.2" stroke-linecap="round"/><circle cx="48" cy="26" r="1.4" fill="#C0392B"/><circle cx="72" cy="26" r="1.4" fill="#C0392B"/>';
        s += '<rect x="40" y="38" width="40" height="30" rx="5" fill="#8A5A30"/><rect x="40" y="38" width="40" height="4" rx="2" fill="#A8743F"/>';
        if (level === 1) {
            s += '<rect x="44" y="42" width="26" height="22" rx="4" fill="#5E6670"/>';
            s += '<g fill="#C9D2DA" opacity=".7">' + Array.from({ length: 14 }, (_, i) => `<rect x="${46 + (i * 7) % 22}" y="${44 + (i * 5) % 18}" width="2" height="1" />`).join('') + '</g>';
        } else s += screen(44, 42, 26, 22, 0, u);
        s += '<circle cx="75" cy="47" r="2" fill="#3A2716"/><circle cx="75" cy="54" r="2" fill="#3A2716"/>';
        return s + (level === 2 ? '<path d="M46 68 L43 78 M74 68 L77 78" stroke="#5A3418" stroke-width="2" stroke-linecap="round"/>' : '<rect x="44" y="68" width="32" height="3" rx="1" fill="#5A3418"/>');
    }
    if (level === 3) {
        s += `<circle cx="60" cy="44" r="26" fill="url(#${u}g)"/>`;
        s += '<rect x="40" y="30" width="40" height="26" rx="2" fill="#1A1A20"/>' + screen(42, 32, 36, 22, 3, u) + '<rect x="56" y="56" width="8" height="4" fill="#2A2A30"/><rect x="50" y="60" width="20" height="2" rx="1" fill="#2A2A30"/>';
        s += '<path d="M30 92 V74 Q30 68 36 68 H84 Q90 68 90 74 V92Z" fill="#7A2E3A"/><rect x="28" y="76" width="8" height="16" rx="3" fill="#8E3A48"/><rect x="84" y="76" width="8" height="16" rx="3" fill="#8E3A48"/>';
        return s + '<rect x="40" y="70" width="18" height="8" rx="3" fill="#9A4656"/><rect x="62" y="70" width="18" height="8" rx="3" fill="#9A4656"/><rect x="64" y="72" width="7" height="3" rx="1" fill="#2A2A30" transform="rotate(-15 67 73)"/>';
    }
    if (level === 4) {
        s += `<circle cx="60" cy="52" r="30" fill="url(#${u}g)"/>`;
        s += '<rect x="30" y="32" width="60" height="38" rx="2" fill="#141418"/><rect x="32" y="34" width="56" height="34" fill="#1E2436"/>';
        for (let i = 0; i < 6; i++) s += screen(34 + (i % 3) * 18, 36 + Math.floor(i / 3) * 14, 16, 11, i + 1, u);
        s += '<rect x="34" y="64" width="52" height="2" rx="1" fill="#3A3F52"/><rect x="34" y="64" width="34" height="2" rx="1" fill="#E5484D"/>';
        return s + '<rect x="54" y="70" width="12" height="3" fill="#2A2A30"/><rect x="46" y="73" width="28" height="2" rx="1" fill="#2A2A30"/>';
    }
    s += `<circle cx="60" cy="54" r="36" fill="url(#${u}g)"/>`;
    s += '<rect x="28" y="26" width="64" height="54" rx="2" fill="#0E0E12"/>';
    for (let i = 0; i < 9; i++) s += screen(30 + (i % 3) * 21, 28 + Math.floor(i / 3) * 17, 19, 15, i, u);
    return s + '<g fill="#F2C14E">' + [[30, 28], [72, 45], [51, 62]].map(([x, y]) => `<rect x="${x + 1}" y="${y + 1}" width="5" height="3" rx="1"/>`).join('') + '</g>';
}

/* ── Time machine: hourglass → sepia film → projector of decades → time vortex ── */

function hourglass(cx, cy, h, u, sand = 0.5) {
    const w = h * 0.42, top = cy - h / 2, bot = cy + h / 2;
    let s = `<rect x="${f(cx - w - 2)}" y="${f(top - 3)}" width="${f(2 * w + 4)}" height="3" rx="1" fill="#8A5A30"/><rect x="${f(cx - w - 2)}" y="${f(bot)}" width="${f(2 * w + 4)}" height="3" rx="1" fill="#8A5A30"/>`;
    s += `<path d="M${f(cx - w)} ${f(top)} H${f(cx + w)} Q${f(cx + w)} ${f(cy - h * 0.12)} ${f(cx + 1.2)} ${f(cy)} Q${f(cx + w)} ${f(cy + h * 0.12)} ${f(cx + w)} ${f(bot)} H${f(cx - w)} Q${f(cx - w)} ${f(cy + h * 0.12)} ${f(cx - 1.2)} ${f(cy)} Q${f(cx - w)} ${f(cy - h * 0.12)} ${f(cx - w)} ${f(top)}Z" fill="#DDF3FA" opacity=".35" stroke="#BFE3EE" stroke-width=".6"/>`;
    const st = cy - h * 0.5 * (1 - sand) * 0.8;
    s += `<path d="M${f(cx - w * 0.75 * sand)} ${f(st)} H${f(cx + w * 0.75 * sand)} L${f(cx + 1)} ${f(cy - 1)} H${f(cx - 1)}Z" fill="url(#${u}sd)"/>`;
    s += `<path d="M${f(cx)} ${f(cy)} V${f(bot - h * 0.18)}" stroke="#E8B24A" stroke-width=".7"/>`;
    s += `<path d="M${f(cx - w * 0.9)} ${f(bot)} Q${f(cx)} ${f(bot - h * 0.32 * (1 - sand + 0.3))} ${f(cx + w * 0.9)} ${f(bot)}Z" fill="url(#${u}sd)"/>`;
    return s + `<g stroke="#8A5A30" stroke-width="1.6"><path d="M${f(cx - w - 1)} ${f(top)} V${f(bot)}"/><path d="M${f(cx + w + 1)} ${f(top)} V${f(bot)}"/></g>`;
}

function filmStrip(x, y, len, angle, tint) {
    let s = `<g transform="rotate(${angle} ${x} ${y})"><rect x="${x}" y="${y - 4}" width="${len}" height="8" fill="#2A2420"/>`;
    for (let i = 0; i < len / 4; i++) s += `<rect x="${x + 0.8 + i * 4}" y="${y - 3.4}" width="2" height="1.2" fill="#E8DCC4"/><rect x="${x + 0.8 + i * 4}" y="${y + 2.2}" width="2" height="1.2" fill="#E8DCC4"/>`;
    for (let i = 0; i < len / 9; i++) s += `<rect x="${x + 1 + i * 9}" y="${y - 2}" width="7.4" height="4" fill="${tint}" opacity=".85"/>`;
    return s + '</g>';
}

function timeMachine(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, level >= 4 ? [[0, '#3A2A6E'], [1, '#0A0818']] : [[0, '#4A3A2A'], [1, '#140E08']], 'cx="50%" cy="45%" r="80%"')
        + radial(`${u}g`, [[0, '#FFD98A', 0.5], [1, '#FFD98A', 0]])
        + linear(`${u}sd`, [[0, '#F2C14E'], [1, '#C8862A']])
        + '<linearGradient id="' + u + 'bm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFF3C8" stop-opacity=".55"/><stop offset="1" stop-color="#FFF3C8" stop-opacity="0"/></linearGradient>'
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) return s + `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + hourglass(60, 54, 30, u, 0.7);
    if (level === 2) {
        s += filmStrip(22, 40, 80, 12, '#C8A070') + filmStrip(22, 70, 80, -10, '#A88A64');
        return s + `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + hourglass(60, 54, 32, u, 0.5);
    }
    if (level === 3) {
        s += '<path d="M62 52 L92 32 V74Z" fill="url(#' + u + 'bm)"/>';
        s += [['#C8A070', 76, 40], ['#8CC4D8', 80, 50], ['#E5484D', 76, 60]].map(([c, x, y]) => `<rect x="${x}" y="${y}" width="9" height="6.5" rx="1" fill="${c}" opacity=".85"/>`).join('');
        s += '<circle cx="45" cy="38" r="7" fill="#3A3A44"/><circle cx="58" cy="38" r="7" fill="#3A3A44"/><circle cx="45" cy="38" r="2.2" fill="#8E8E96"/><circle cx="58" cy="38" r="2.2" fill="#8E8E96"/>';
        s += '<rect x="40" y="45" width="22" height="14" rx="2" fill="#2A2A30"/><path d="M62 48 h4 v8 h-4Z" fill="#5A5E70"/><circle cx="45" cy="52" r="1.4" fill="#E5484D"/>';
        s += '<path d="M44 59 L40 80 M58 59 L62 80 M51 59 V80" stroke="#2A2A30" stroke-width="2" stroke-linecap="round"/>';
        s += '<rect x="66" y="74" width="20" height="3" rx="1" fill="#6A4122"/><path d="M68 77 V86 M84 77 V86" stroke="#6A4122" stroke-width="1.6"/>';
        return s + hourglass(76, 66, 13, u, 0.35);
    }
    for (let i = 0; i < 5; i++) {
        const r = 34 - i * 6;
        s += `<circle cx="60" cy="54" r="${r}" fill="none" stroke="${i % 2 ? '#7A5AE0' : '#3FB8D8'}" stroke-width="${2.4 - i * 0.3}" stroke-dasharray="${f(r * 0.9)} ${f(r * 0.5)}" transform="rotate(${i * 40} 60 54)" opacity=".75"/>`;
    }
    s += `<circle cx="60" cy="54" r="20" fill="url(#${u}g)"/>`;
    s += filmStrip(26, 34, 26, -30, '#C8A070') + filmStrip(70, 76, 26, -30, '#8CC4D8') + filmStrip(76, 30, 20, 40, '#E5484D');
    s += hourglass(60, 54, 30, u, 0.5);
    return s + [[38, 70], [84, 50], [44, 30]].map(([x, y]) => star5(x, y, 2.4, '#FFF6D0')).join('');
}

/* ── Perfect ten: a star → a row of stars → a "10" ticket → a scorecard → a "10" in fireworks ── */

function ten(cx, cy, h, fill, stroke) {
    const w = h * 0.12, r = h * 0.3;
    return `<path d="M${f(cx - h * 0.46)} ${f(cy - h * 0.32)} L${f(cx - h * 0.3)} ${f(cy - h * 0.5)} V${f(cy + h * 0.5)}" fill="none" stroke="${fill}" stroke-width="${f(w * 1.6)}" stroke-linecap="round" stroke-linejoin="round"/>`
        + `<ellipse cx="${f(cx + h * 0.2)}" cy="${cy}" rx="${f(r)}" ry="${f(h * 0.46)}" fill="none" stroke="${fill}" stroke-width="${f(w * 1.6)}"/>`
        + (stroke ? `<ellipse cx="${f(cx + h * 0.2)}" cy="${cy}" rx="${f(r)}" ry="${f(h * 0.46)}" fill="none" stroke="${stroke}" stroke-width=".5"/>` : '');
}

function perfect(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, level >= 5 ? '#4A2060' : '#2A2040'], [1, '#0C0A18']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE79A', 0.55], [1, '#FFE79A', 0]])
        + linear(`${u}au`, [[0, '#FFF0B0'], [0.5, '#F2C14E'], [1, '#B4840C']])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) return s + `<circle cx="60" cy="53" r="22" fill="url(#${u}g)"/>` + star5(60, 54, 15, `url(#${u}au)`) + star5(56, 50, 4, '#FFF6D0');
    if (level === 2) {
        s += `<circle cx="60" cy="53" r="26" fill="url(#${u}g)"/>`;
        return s + star5(44, 58, 8, `url(#${u}au)`) + star5(76, 58, 8, `url(#${u}au)`) + star5(60, 48, 12, `url(#${u}au)`) + star5(57, 45, 3, '#FFF6D0');
    }
    if (level === 3) {
        s += `<circle cx="60" cy="54" r="26" fill="url(#${u}g)"/>`;
        s += '<g transform="rotate(-8 60 56)"><path d="M32 42 H88 V48 A4 4 0 0 0 88 56 V70 H32 V56 A4 4 0 0 0 32 48Z" fill="#E5484D"/><path d="M34 44 H86 V68 H34Z" fill="none" stroke="#FFD0D2" stroke-width=".6" stroke-dasharray="1.6 1.2"/>';
        return s + '<path d="M72 42 V70" stroke="#B8243A" stroke-width=".8" stroke-dasharray="1.4 1.2"/>' + ten(54, 56, 18, '#FFF6D0') + star5(80, 56, 4, '#F2C14E') + '</g>';
    }
    if (level === 4) {
        s += `<circle cx="60" cy="52" r="30" fill="url(#${u}g)"/>`;
        s += '<rect x="38" y="30" width="44" height="50" rx="3" fill="#F6EEDC"/><rect x="52" y="27" width="16" height="6" rx="2" fill="#8A5A30"/>';
        s += ten(60, 50, 20, '#C0392B') + '<g fill="#C8B89A">' + [66, 71].map(y => `<rect x="44" y="${y}" width="32" height="1.6" rx=".8"/>`).join('') + '</g>';
        return s + [[34, 36], [86, 40], [32, 70], [88, 72]].map(([x, y]) => star5(x, y, 4, `url(#${u}au)`)).join('');
    }
    for (const [x, y, c, r] of [[36, 34, '#E5484D', 10], [86, 36, '#4AA3D9', 9], [40, 74, '#5BAA5E', 8], [84, 72, '#F2C14E', 9]]) {
        for (let i = 0; i < 10; i++) {
            const a = i * Math.PI / 5;
            s += `<path d="M${f(x + r * 0.35 * Math.cos(a))} ${f(y + r * 0.35 * Math.sin(a))} L${f(x + r * Math.cos(a))} ${f(y + r * Math.sin(a))}" stroke="${c}" stroke-width="1" stroke-linecap="round"/>`;
        }
    }
    s += `<circle cx="60" cy="54" r="30" fill="url(#${u}g)"/>`;
    for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8;
        s += `<path d="M60 54 L${f(60 + 34 * Math.cos(a - 0.06))} ${f(54 + 34 * Math.sin(a - 0.06))} L${f(60 + 34 * Math.cos(a + 0.06))} ${f(54 + 34 * Math.sin(a + 0.06))}Z" fill="#FFE79A" opacity=".18"/>`;
    }
    return s + ten(60, 54, 30, `url(#${u}au)`, '#8A5A0A') + star5(78, 34, 4, '#FFF6D0');
}

/* ── Merciless: a red pen → a crossed-out poster → tomatoes on the screen → a gavel cracking a reel ── */

function redPen(x, y, angle, len = 30) {
    return `<g transform="rotate(${angle} ${x} ${y})"><rect x="${x}" y="${y - 2.6}" width="${len}" height="5.2" rx="2.6" fill="#C0392B"/><rect x="${x + len * 0.62}" y="${y - 2.6}" width="${len * 0.12}" height="5.2" fill="#2A2A30"/>`
        + `<path d="M${x} ${y - 2.6} L${x - 6} ${y} L${x} ${y + 2.6}Z" fill="#F1E3C6"/><path d="M${x - 4.4} ${y - 0.7} L${x - 6} ${y} L${x - 4.4} ${y + 0.7}Z" fill="#C0392B"/>`
        + `<rect x="${x + len * 0.2}" y="${y - 3.4}" width="${len * 0.5}" height="1.2" rx=".6" fill="#D9D9DE"/></g>`;
}

function poster(x, y, w, h, c) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="#F1E9D8"/><rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h * 0.62}" fill="${c}"/>`
        + `<circle cx="${x + w * 0.5}" cy="${y + h * 0.34}" r="${w * 0.17}" fill="#000" opacity=".2"/><rect x="${x + 3}" y="${y + h * 0.74}" width="${w - 6}" height="1.6" fill="#8A7A64"/><rect x="${x + 5}" y="${y + h * 0.84}" width="${w - 10}" height="1.2" fill="#B5A88E"/>`;
}

function splat(x, y, r) {
    let d = '';
    for (let i = 0; i < 9; i++) {
        const a = i * Math.PI * 2 / 9, k = i % 2 ? 0.6 : 1;
        d += `${i ? 'L' : 'M'}${f(x + r * k * Math.cos(a))} ${f(y + r * k * Math.sin(a))}`;
    }
    return `<path d="${d}Z" fill="#D43A2A"/><circle cx="${x}" cy="${y}" r="${f(r * 0.45)}" fill="#E85A3A"/><circle cx="${f(x + r * 0.2)}" cy="${f(y + r * 0.9)}" r="${f(r * 0.18)}" fill="#D43A2A"/>`;
}

function tomato(x, y, r) {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#E0412E"/><circle cx="${f(x - r * 0.35)}" cy="${f(y - r * 0.35)}" r="${f(r * 0.25)}" fill="#FF8A6A" opacity=".7"/>`
        + `<path d="M${x} ${f(y - r)} l-2.4 -1.4 2.4 .4 0 -2.4 1 2.6 2.4 -.6 -2 1.6Z" fill="#3E7A3A"/>`;
}

function merciless(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, level >= 4 ? [[0, '#6A1A1A'], [1, '#120404']] : [[0, '#3A2A30'], [1, '#100A0C']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FF8A6A', 0.4], [1, '#FF8A6A', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) {
        s += '<rect x="40" y="36" width="34" height="42" rx="2" fill="#F6EEDC" transform="rotate(-6 57 57)"/>';
        s += '<g transform="rotate(-6 57 57)" fill="#C8B89A">' + [46, 52, 58].map(y => `<rect x="45" y="${y}" width="22" height="1.4" rx=".7"/>`).join('') + '</g>';
        s += '<path d="M47 66 q4 -6 8 0 t8 0" stroke="#C0392B" stroke-width="1.6" fill="none" stroke-linecap="round" transform="rotate(-6 57 57)"/>';
        return s + redPen(66, 72, -40, 26);
    }
    if (level === 2) {
        s += poster(40, 30, 32, 46, '#4A6E9A');
        s += '<path d="M38 30 L76 78 M76 30 L38 78" stroke="#C0392B" stroke-width="4" stroke-linecap="round"/>';
        return s + redPen(70, 78, -35, 24);
    }
    if (level === 3) {
        s += '<rect x="30" y="30" width="60" height="38" rx="1" fill="#E8E2D4"/><rect x="30" y="30" width="60" height="38" fill="url(#' + u + 'g)"/>';
        s += '<path d="M24 26 h72 v4 h-72Z" fill="#5A1E2A"/><path d="M24 26 q4 30 0 70 h8 q-3 -40 0 -70Z M96 26 q-4 30 0 70 h-8 q3 -40 0 -70Z" fill="#8A1E2A"/>';
        s += splat(46, 42, 6) + splat(72, 52, 7) + splat(58, 60, 4.5);
        s += '<path d="M10 80 Q60 74 110 80 V120 H10Z" fill="#140C10"/>';
        return s + tomato(52, 80, 5) + tomato(76, 84, 4.4) + '<path d="M64 78 q8 -10 14 -20" stroke="#F1E3C6" stroke-width=".7" stroke-dasharray="1.4 1.4" fill="none"/>';
    }
    s += `<circle cx="60" cy="58" r="30" fill="url(#${u}g)"/>`;
    s += '<path d="M30 30 l6 10 -4 2 8 10 M88 26 l-5 9 4 2 -7 11" stroke="#FFB08A" stroke-width="1.2" fill="none" stroke-linejoin="round"/>';
    s += '<circle cx="56" cy="66" r="17" fill="#3A3A44"/><circle cx="56" cy="66" r="15" fill="#2A2A30"/>';
    for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        s += `<circle cx="${f(56 + 9 * Math.cos(a))}" cy="${f(66 + 9 * Math.sin(a))}" r="3.4" fill="#14141A"/>`;
    }
    s += '<circle cx="56" cy="66" r="3" fill="#8E8E96"/><path d="M50 52 L56 62 L52 68 L60 78 M58 60 L66 58 L70 64" stroke="#FFB08A" stroke-width="1.3" fill="none"/>';
    s += '<g transform="rotate(-30 72 42)"><rect x="70" y="44" width="4.4" height="30" rx="2.2" fill="#8A5A30"/><rect x="70" y="44" width="1.4" height="30" fill="#B5763E"/>'
        + '<rect x="58" y="30" width="28" height="14" rx="3" fill="#6A4122"/><rect x="58" y="30" width="28" height="4" rx="2" fill="#8A5A30"/>'
        + '<rect x="61" y="30" width="3" height="14" fill="#D9A441"/><rect x="80" y="30" width="3" height="14" fill="#D9A441"/></g>';
    return s + '<g stroke="#FFD0A0" stroke-width="1.2" stroke-linecap="round"><path d="M64 52 l-4 -5"/><path d="M68 56 l3 -5"/><path d="M62 58 l-6 -1"/></g>';
}

/* ── Classics: a sepia frame → a hand-crank camera → a marquee → a column-fronted film palace ── */

function marqueeBulbs(x0, x1, y, step) {
    let s = '';
    for (let x = x0; x <= x1; x += step) s += `<circle cx="${f(x)}" cy="${y}" r="1.1" fill="#FFE79A"/>`;
    return s;
}

function classics(level, u) {
    const sepia = level <= 2;
    let s = '<defs>'
        + radial(`${u}s`, sepia ? [[0, '#6A5338'], [1, '#1E160C']] : [[0, '#2A2448'], [1, '#0A0814']], 'cx="50%" cy="35%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + linear(`${u}scr`, [[0, '#E8E8E8'], [1, '#9A9A9A']])
        + linear(`${u}dc`, [[0, '#F3E6C4'], [1, '#C8A86A']])
        + linear(`${u}b`, [[0, '#FFF3C8']]).replace('</linearGradient>', '<stop offset="1" stop-color="#FFF3C8" stop-opacity="0"/></linearGradient>')
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) {
        s += '<rect x="34" y="32" width="52" height="44" fill="#2A2420"/>';
        for (let i = 0; i < 6; i++) s += `<rect x="${36 + i * 8.4}" y="34" width="4" height="2.6" rx=".6" fill="#E8DCC4"/><rect x="${36 + i * 8.4}" y="71.4" width="4" height="2.6" rx=".6" fill="#E8DCC4"/>`;
        s += '<rect x="37" y="39" width="46" height="30" fill="#C8B08A"/><rect x="37" y="39" width="46" height="30" fill="url(#' + u + 'g)"/>';
        s += '<path d="M37 69 H83 V64 H37Z" fill="#8A7458"/><ellipse cx="60" cy="47" rx="4.6" ry="1.4" fill="#2A2018"/><rect x="57" y="42" width="6" height="5" rx="1" fill="#2A2018"/>';
        s += '<path d="M56.6 49 h6.8 l1 12 h-8.8Z" fill="#3A2E24"/><circle cx="60" cy="49.6" r="2.4" fill="#E8D8B8"/><path d="M64 56 l5 8" stroke="#2A2018" stroke-width="1" stroke-linecap="round"/>';
        return s + '<g stroke="#5A4A38" stroke-width=".4" opacity=".6"><path d="M44 39 V69"/><path d="M71 39 V69"/></g>';
    }
    if (level === 2) {
        s += `<circle cx="58" cy="50" r="26" fill="url(#${u}g)"/>`;
        s += '<path d="M56 62 L46 86 M60 62 V86 M64 62 L74 86" stroke="#5A3418" stroke-width="2" stroke-linecap="round"/>';
        s += '<rect x="44" y="44" width="28" height="18" rx="2" fill="#6A4122"/><rect x="44" y="44" width="28" height="3" fill="#8A5A30"/>';
        s += '<path d="M72 48 h6 l4 -3 v14 l-4 -3 h-6Z" fill="#3A2A20"/><circle cx="84" cy="52" r="2.6" fill="#B8A888"/>';
        s += '<circle cx="52" cy="36" r="8" fill="#3A2A20"/><circle cx="52" cy="36" r="2.4" fill="#C8A070"/><circle cx="66" cy="38" r="6" fill="#3A2A20"/><circle cx="66" cy="38" r="2" fill="#C8A070"/>';
        return s + '<path d="M44 54 h-5 v6" stroke="#C8A070" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="39" cy="61" r="1.6" fill="#C8A070"/>';
    }
    if (level === 3) {
        // III: an old picture house — a black-and-white film on the screen, rows of red seats in front.
        s += '<g fill="#7A1E2A"><path d="M14 18 q6 34 0 72 h12 q-4 -38 0 -72Z"/><path d="M106 18 q-6 34 0 72 h-12 q4 -38 0 -72Z"/></g>';
        s += '<rect x="30" y="28" width="60" height="36" fill="#1A1A1A"/>' + `<rect x="32" y="30" width="56" height="32" fill="url(#${u}scr)"/>`;
        s += '<path d="M32 54 H88 V62 H32Z" fill="#6A6A6A"/><ellipse cx="54" cy="38" rx="5" ry="1.4" fill="#1A1A1A"/><rect x="50.6" y="33" width="6.8" height="5" rx="1" fill="#1A1A1A"/>';
        s += '<path d="M50 40.6 h8 l1.4 14 h-10.8Z" fill="#2A2A2A"/><circle cx="54" cy="40.8" r="2.6" fill="#D8D8D8"/><path d="M59 47 q5 2 6 8" stroke="#1A1A1A" stroke-width="1.1" fill="none" stroke-linecap="round"/>';
        s += '<g stroke="#fff" stroke-width=".35" opacity=".5"><path d="M40 30 V62"/><path d="M76 30 V62"/></g>' + `<path d="M60 18 L32 30 H88Z" fill="url(#${u}b)" opacity=".25"/>`;
        for (const [y, n, w] of [[72, 7, 8], [82, 8, 8]]) {
            const x0 = 60 - (n * w) / 2;
            for (let i = 0; i < n; i++) s += `<rect x="${f(x0 + i * w + 0.6)}" y="${y}" width="${f(w - 1.2)}" height="7" rx="2.4" fill="${y === 72 ? '#B8243A' : '#9E1E30'}"/><rect x="${f(x0 + i * w + 0.6)}" y="${y}" width="${f(w - 1.2)}" height="2" rx="1" fill="#D6324A"/>`;
        }
        return s;
    }
    // IV: an art-deco movie palace — a lit vertical sign, a marquee of bulbs, posters and crossed searchlights.
    s += `<g opacity=".3"><path d="M34 92 L18 14 L28 14Z" fill="url(#${u}b)"/><path d="M86 92 L102 14 L92 14Z" fill="url(#${u}b)"/></g>`;
    s += `<path d="M30 92 V48 H90 V92Z" fill="url(#${u}dc)"/><path d="M46 48 V34 H74 V48Z" fill="url(#${u}dc)"/><path d="M50 34 V26 H70 V34Z" fill="url(#${u}dc)"/>`;
    s += '<g stroke="#A8864A" stroke-width=".6">' + [38, 46, 74, 82].map(x => `<path d="M${x} 50 V92"/>`).join('') + '</g>';
    s += '<rect x="54" y="18" width="12" height="40" rx="1" fill="#B8243A"/>' + marqueeBulbs(56, 64, 19.4, 4).replace(/cy="19.4"/g, 'cy="19.6"');
    for (let y = 22; y <= 56; y += 4) s += `<circle cx="55.6" cy="${y}" r=".9" fill="#FFE79A"/><circle cx="64.4" cy="${y}" r=".9" fill="#FFE79A"/>`;
    s += star5(60, 26, 3, '#FFE79A') + '<g fill="#FFF3C8">' + [33, 39, 45, 51].map(y => `<rect x="58" y="${y}" width="4" height="3.4" rx=".6"/>`).join('') + '</g>';
    s += '<path d="M24 58 H96 L92 68 H28Z" fill="#2A1E2A"/>' + marqueeBulbs(26, 94, 58.8, 3.4) + marqueeBulbs(30, 90, 67, 3.4);
    s += '<g fill="#F6EEDC">' + [36, 44, 52, 60, 68, 76].map(x => `<rect x="${x}" y="61" width="6" height="3.6" rx=".5"/>`).join('') + '</g>';
    s += '<g fill="#FFD98A">' + [[48, 72], [56, 72], [64, 72]].map(([x, y]) => `<path d="M${x} 92 V${y + 4} Q${x + 4} ${y} ${x + 8} ${y + 4} V92Z"/>`).join('') + '</g>';
    s += poster(33, 72, 9, 14, '#2F6E8E') + poster(78, 72, 9, 14, '#B8432F');
    return s + '<path d="M52 92 L48 100 H72 L68 92Z" fill="#B8243A"/>';
}

/* ── Anime: a sakura branch → a lantern → a torii → torii at night → a mountain sunrise ── */

function blossom(x, y, r, c = '#F7B6CC') {
    let s = '';
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        s += `<ellipse cx="${f(x + r * 0.6 * Math.cos(a))}" cy="${f(y + r * 0.6 * Math.sin(a))}" rx="${f(r * 0.55)}" ry="${f(r * 0.4)}" fill="${c}" transform="rotate(${f(a * 57.3 + 90)} ${f(x + r * 0.6 * Math.cos(a))} ${f(y + r * 0.6 * Math.sin(a))})"/>`;
    }
    return s + `<circle cx="${x}" cy="${y}" r="${f(r * 0.25)}" fill="#E8648C"/>`;
}

function branch(x, y, len, flowers) {
    let s = `<path d="M${x} ${y} q${len * 0.4} -6 ${len} -2" stroke="#4A2A22" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    s += `<path d="M${x + len * 0.45} ${y - 3} q4 -6 10 -7" stroke="#4A2A22" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
    return s + flowers.map(([dx, dy, r]) => blossom(x + dx, y + dy, r)).join('');
}

function petals(count, seed, area) {
    let s = '';
    for (let i = 0; i < count; i++) {
        const x = area[0] + ((i * 0.618 + seed) % 1) * (area[2] - area[0]), y = area[1] + ((i * 0.41 + seed * 3) % 1) * (area[3] - area[1]);
        s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="1.4" ry=".8" fill="#F7B6CC" transform="rotate(${i * 47} ${f(x)} ${f(y)})"/>`;
    }
    return s;
}

function torii(cx, base, h, red = '#D63A2A', black = '#1E1416') {
    const w = h, yT = base - h * 0.92, X = k => f(cx + w * k), Y = k => f(base - h * k);
    let s = '';
    for (const d of [-1, 1]) {
        s += `<path d="M${X(d * 0.35)} ${f(base)} L${X(d * 0.3)} ${Y(0.84)} L${X(d * 0.3 - d * 0.07)} ${Y(0.84)} L${X(d * 0.35 - d * 0.08)} ${f(base)}Z" fill="${red}"/>`;
        s += `<rect x="${X(d > 0 ? 0.265 : -0.355)}" y="${Y(0.07)}" width="${f(w * 0.09)}" height="${f(h * 0.07)}" fill="${black}"/>`;
    }
    s += `<rect x="${X(-0.46)}" y="${Y(0.64)}" width="${f(w * 0.92)}" height="${f(h * 0.06)}" fill="${red}"/>`;
    s += `<rect x="${X(-0.025)}" y="${Y(0.8)}" width="${f(w * 0.05)}" height="${f(h * 0.17)}" fill="${red}"/>`;
    s += `<rect x="${X(-0.44)}" y="${Y(0.84)}" width="${f(w * 0.88)}" height="${f(h * 0.05)}" fill="${red}"/>`;
    s += `<path d="M${X(-0.58)} ${f(yT - h * 0.07)} Q${f(cx)} ${f(yT + h * 0.03)} ${X(0.58)} ${f(yT - h * 0.07)} L${X(0.54)} ${f(yT - h * 0.01)} Q${f(cx)} ${f(yT + h * 0.11)} ${X(-0.54)} ${f(yT - h * 0.01)}Z" fill="${black}"/>`;
    return s;
}

function lantern(x, y, s = 1) {
    return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -12 V-8" stroke="#2A1A10" stroke-width=".8"/><rect x="-4" y="-8" width="8" height="1.6" fill="#2A1A10"/>`
        + '<ellipse cx="0" cy="0" rx="7" ry="8" fill="#E5484D"/><ellipse cx="0" cy="0" rx="7" ry="8" fill="#FFB86A" opacity=".35"/>'
        + '<g stroke="#9E2329" stroke-width=".5" fill="none"><ellipse rx="7" ry="3"/><ellipse rx="7" ry="6"/></g><rect x="-4" y="6.6" width="8" height="1.6" fill="#2A1A10"/><path d="M0 8 v4" stroke="#F2C14E" stroke-width="1"/></g>';
}

function anime(level, u) {
    const sky = [
        [['#9FD6F2', 0], ['#F7D6E4', 1]], [['#6E8FD0', 0], ['#F2B6CC', 1]], [['#F29A6A', 0], ['#F7D6A4', 1]],
        [['#1E2050', 0], ['#4A2A6A', 1]], [['#2E3A7A', 0], ['#B86A9A', 0.5], ['#FFC28A', 1]]
    ][Math.min(level, 5) - 1];
    let s = '<defs>'
        + linear(`${u}s`, sky.map(([c, o]) => [o, c]))
        + radial(`${u}g`, [[0, '#FFE6A0', 0.55], [1, '#FFE6A0', 0]])
        + linear(`${u}l`, [[0, '#3A4A8A'], [1, '#1E2450']])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) return s + branch(28, 60, 60, [[10, -4, 5], [24, -6, 6.5], [40, -7, 5.5], [52, -3, 4.5], [28, -14, 4.6]]) + petals(4, 0.3, [40, 66, 80, 84]);
    if (level === 2) {
        s += branch(26, 38, 62, [[12, -4, 4.6], [26, -6, 5.6], [44, -6, 5], [30, -14, 4]]);
        s += `<circle cx="60" cy="62" r="18" fill="url(#${u}g)"/>` + lantern(60, 62, 1.4);
        return s + petals(6, 0.5, [30, 46, 90, 86]);
    }
    if (level === 3) {
        s += '<circle cx="60" cy="52" r="13" fill="#FFE6B0" opacity=".9"/>';
        s += '<path d="M10 84 Q60 76 110 84 V120 H10Z" fill="#8A5A5A"/><path d="M52 84 L48 96 H72 L68 84Z" fill="#B8A090"/>';
        s += torii(60, 86, 40);
        return s + branch(22, 34, 30, [[8, -3, 4], [20, -5, 5], [14, -11, 3.6]]) + petals(7, 0.2, [30, 40, 92, 82]);
    }
    if (level === 4) {
        s += '<circle cx="76" cy="32" r="8" fill="#FFF1C8"/><circle cx="76" cy="32" r="15" fill="#FFF1C8" opacity=".12"/>';
        s += [[36, 30], [48, 22], [90, 50], [30, 48]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".7" fill="#FFF6D0"/>`).join('');
        s += '<path d="M10 84 Q60 78 110 84 V120 H10Z" fill="#140E24"/>';
        s += torii(60, 86, 40, '#B8302A', '#0E0A14') + lantern(34, 70, 0.75) + lantern(86, 70, 0.75);
        s += [[46, 76], [76, 52], [40, 54]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#D6FF7A" opacity=".3"/><circle cx="${x}" cy="${y}" r=".8" fill="#F4FFB0"/>`).join('');
        return s + petals(8, 0.6, [28, 30, 92, 80]);
    }
    // V: Mount Fuji with a snow cap, the red rising sun behind it, bands of cloud, a lake and a torii in the water.
    s += '<circle cx="60" cy="40" r="13" fill="#E5484D"/><circle cx="60" cy="40" r="20" fill="#FF8A6A" opacity=".18"/>';
    s += `<path d="M12 80 L50 50 Q54 47 57 48 L60 46 L63 48 Q66 47 70 50 L108 80Z" fill="url(#${u}l)"/>`;
    s += '<path d="M50 50 Q54 47 57 48 L60 46 L63 48 Q66 47 70 50 L66 55 L63 52 L60 56 L57 52 L54 55Z" fill="#F7F4FF"/>';
    s += '<g fill="#FBE6EE" opacity=".75"><rect x="20" y="64" width="34" height="2.2" rx="1.1"/><rect x="66" y="60" width="30" height="2.2" rx="1.1"/><rect x="34" y="70" width="26" height="1.8" rx=".9"/></g>';
    s += '<path d="M10 80 H110 V120 H10Z" fill="#2A3A6A"/><g stroke="#E5728A" stroke-width=".8" opacity=".6"><path d="M50 84 H70"/><path d="M53 88 H67"/></g>';
    s += '<g stroke="#7A8AC8" stroke-width=".6" opacity=".6"><path d="M24 86 H38"/><path d="M82 90 H96"/></g>';
    s += torii(84, 90, 16);
    s += branch(20, 30, 30, [[6, -2, 4.4], [16, -4, 5.2], [26, -2, 4.2], [12, -10, 3.6]]);
    return s + petals(12, 0.4, [26, 30, 94, 80]);
}

/* ── Cartoons: a crayon sun → a palette → a flipbook with a rainbow → a cartoon castle under a rainbow ── */

function rainbow(cx, cy, r, w) {
    return ['#E5484D', '#F7913A', '#F2C14E', '#5BAA5E', '#4AA3D9', '#7A4A8C']
        .map((c, i) => `<path d="M${f(cx - r + i * w)} ${cy} A${f(r - i * w)} ${f(r - i * w)} 0 0 1 ${f(cx + r - i * w)} ${cy}" fill="none" stroke="${c}" stroke-width="${w + 0.2}"/>`).join('');
}

function cartoonCloud(x, y, k) {
    return `<g transform="translate(${x} ${y}) scale(${k})" fill="#fff" stroke="#3A3A5A" stroke-width=".8"><path d="M-10 4 a5 5 0 0 1 2 -9 a6 6 0 0 1 11 -2 a5 5 0 0 1 8 4 a4 4 0 0 1 -1 7Z"/></g>`;
}

function smiley(cx, cy, r, fill) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#3A2A10" stroke-width=".8"/><circle cx="${f(cx - r * 0.35)}" cy="${f(cy - r * 0.2)}" r="${f(r * 0.12)}" fill="#3A2A10"/><circle cx="${f(cx + r * 0.35)}" cy="${f(cy - r * 0.2)}" r="${f(r * 0.12)}" fill="#3A2A10"/>`
        + `<path d="M${f(cx - r * 0.45)} ${f(cy + r * 0.2)} Q${cx} ${f(cy + r * 0.7)} ${f(cx + r * 0.45)} ${f(cy + r * 0.2)}" fill="none" stroke="#3A2A10" stroke-width="${f(r * 0.1)}" stroke-linecap="round"/>`;
}

function cartoons(level, u) {
    let s = '<defs>' + linear(`${u}s`, level >= 3 ? [[0, '#6EC6F2'], [1, '#C8F0FF']] : [[0, '#F7E6C8'], [1, '#E8D0A8']]) + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) {
        s += '<rect x="34" y="32" width="52" height="44" rx="1" fill="#FFFDF6" transform="rotate(-4 60 54)"/>';
        for (let i = 0; i < 10; i++) {
            const a = i * Math.PI / 5;
            s += `<path d="M${f(60 + 11 * Math.cos(a))} ${f(52 + 11 * Math.sin(a))} L${f(60 + 16 * Math.cos(a))} ${f(52 + 16 * Math.sin(a))}" stroke="#F7913A" stroke-width="1.6" stroke-linecap="round"/>`;
        }
        s += smiley(60, 52, 8.5, '#F2C14E') + '<path d="M38 70 q6 -3 12 0 t12 0 t12 0" stroke="#5BAA5E" stroke-width="1.6" fill="none"/>';
        return s + '<g transform="rotate(35 80 74)"><rect x="70" y="72" width="22" height="4.6" rx="1" fill="#E5484D"/><path d="M70 72 l-5 2.3 5 2.3Z" fill="#E5484D"/><rect x="76" y="72" width="8" height="4.6" fill="#FFF3C8" opacity=".6"/></g>';
    }
    if (level === 2) {
        s += '<path d="M34 60 Q30 38 54 34 Q80 30 86 50 Q90 64 76 66 Q68 66 70 74 Q72 84 56 82 Q36 80 34 60Z" fill="#E8C89A" stroke="#8A6238" stroke-width="1"/><ellipse cx="60" cy="72" rx="4" ry="3" fill="#F7E6C8"/>';
        s += ['#E5484D', '#F2C14E', '#5BAA5E', '#4AA3D9', '#7A4A8C'].map((c, i) => `<circle cx="${[44, 52, 64, 76, 46][i]}" cy="${[52, 42, 40, 48, 66][i]}" r="4.6" fill="${c}"/>`).join('');
        return s + '<g transform="rotate(-40 72 66)"><rect x="60" y="64" width="30" height="3" rx="1.5" fill="#8A5A30"/><rect x="56" y="63.4" width="6" height="4.2" fill="#B8B8C0"/><path d="M56 63.4 q-6 2.1 0 4.2Z" fill="#E5484D"/></g>';
    }
    if (level === 3) {
        // III: a cartoon landscape — a smiling sun and cloud, a rainbow, rolling hills and flowers.
        s += rainbow(70, 74, 26, 2.8);
        s += '<ellipse cx="38" cy="90" rx="34" ry="18" fill="#6CC05A" stroke="#3A6A2A" stroke-width=".8"/><ellipse cx="86" cy="92" rx="34" ry="16" fill="#7CD06A" stroke="#3A6A2A" stroke-width=".8"/>';
        s += cartoonSun(40, 44, 8) + faceCloud(76, 44, 1.3);
        return s + [[34, 78, '#E5484D'], [46, 80, '#F2C14E'], [80, 82, '#F7B6CC'], [90, 80, '#E5484D']]
            .map(([x, y, c]) => `<path d="M${x} ${y} v6" stroke="#3A6A2A" stroke-width=".8"/>${blossom(x, y, 2.6, c).replace(/fill="#E8648C"/, 'fill="#F2C14E"')}`).join('');
    }
    // IV: a fairy-tale castle on a hill — battlements, cone roofs with flags, a gate, a rainbow and sparkles.
    s += rainbow(60, 72, 34, 3);
    s += '<ellipse cx="60" cy="96" rx="52" ry="18" fill="#6CC05A" stroke="#3A6A2A" stroke-width=".8"/>';
    const line = 'stroke="#3A2A5A" stroke-width=".8"';
    s += `<rect x="44" y="52" width="32" height="30" fill="#F7C6D8" ${line}/>`;
    s += [44, 50, 56, 62, 68].map(x => `<rect x="${x}" y="48" width="4" height="4" fill="#F7C6D8" ${line}/>`).join('');
    for (const x of [34, 78]) {
        s += `<rect x="${x}" y="46" width="10" height="36" fill="#F4AFC8" ${line}/><path d="M${x - 2} 46 L${x + 5} 30 L${x + 12} 46Z" fill="#8A5AD8" ${line}/>`;
        s += `<path d="M${x + 5} 30 V25 l4 1.4 -4 1.4" fill="#E5484D" stroke="#3A2A5A" stroke-width=".5"/><rect x="${x + 3}" y="54" width="4" height="6" rx="2" fill="#5A3A8A"/>`;
    }
    s += `<rect x="54" y="36" width="12" height="16" fill="#F4AFC8" ${line}/><path d="M52 36 L60 18 L68 36Z" fill="#4AA3D9" ${line}/><path d="M60 18 V13 l4 1.4 -4 1.4" fill="#F2C14E" stroke="#3A2A5A" stroke-width=".5"/>`;
    s += '<circle cx="60" cy="43" r="2.4" fill="#5A3A8A"/>';
    s += `<path d="M53 82 V71 Q60 64 67 71 V82Z" fill="#8A5A30" ${line}/><g stroke="#5A3418" stroke-width=".6"><path d="M56.5 69 V82"/><path d="M60 67 V82"/><path d="M63.5 69 V82"/></g>`;
    s += '<rect x="48" y="58" width="4" height="6" rx="2" fill="#5A3A8A"/><rect x="68" y="58" width="4" height="6" rx="2" fill="#5A3A8A"/>';
    return s + cartoonCloud(28, 30, 0.8) + [[90, 28], [26, 56], [94, 56], [80, 18]].map(([x, y]) => star5(x, y, 2.8, '#FFF3A0')).join('');
}

/* ── Genres: one mask → comedy and tragedy → masks among genre props → a spotlight carousel of genres ── */

function mask(cx, cy, r, happy, fill) {
    const mouth = happy
        ? `M${f(cx - r * 0.45)} ${f(cy + r * 0.25)} Q${cx} ${f(cy + r * 0.85)} ${f(cx + r * 0.45)} ${f(cy + r * 0.25)}Z`
        : `M${f(cx - r * 0.42)} ${f(cy + r * 0.6)} Q${cx} ${f(cy + r * 0.05)} ${f(cx + r * 0.42)} ${f(cy + r * 0.6)}Z`;
    const brow = happy ? -0.5 : -0.3;
    return `<path d="M${f(cx - r)} ${f(cy - r * 0.7)} Q${cx} ${f(cy - r * 1.05)} ${f(cx + r)} ${f(cy - r * 0.7)} Q${f(cx + r * 1.05)} ${f(cy + r * 0.6)} ${cx} ${f(cy + r * 1.05)} Q${f(cx - r * 1.05)} ${f(cy + r * 0.6)} ${f(cx - r)} ${f(cy - r * 0.7)}Z" fill="${fill}" stroke="#2A1A10" stroke-width=".7"/>`
        + `<path d="M${f(cx - r * 0.62)} ${f(cy - r * 0.1)} Q${f(cx - r * 0.38)} ${f(cy + (happy ? -r * 0.4 : r * 0.1))} ${f(cx - r * 0.14)} ${f(cy - r * 0.1)} Q${f(cx - r * 0.38)} ${f(cy + r * 0.05)} ${f(cx - r * 0.62)} ${f(cy - r * 0.1)}Z" fill="#2A1A10"/>`
        + `<path d="M${f(cx + r * 0.62)} ${f(cy - r * 0.1)} Q${f(cx + r * 0.38)} ${f(cy + (happy ? -r * 0.4 : r * 0.1))} ${f(cx + r * 0.14)} ${f(cy - r * 0.1)} Q${f(cx + r * 0.38)} ${f(cy + r * 0.05)} ${f(cx + r * 0.62)} ${f(cy - r * 0.1)}Z" fill="#2A1A10"/>`
        + `<path d="M${f(cx - r * 0.6)} ${f(cy + r * (brow - 0.1))} l${f(r * 0.4)} ${f(happy ? -r * 0.1 : r * 0.15)} M${f(cx + r * 0.6)} ${f(cy + r * (brow - 0.1))} l${f(-r * 0.4)} ${f(happy ? -r * 0.1 : r * 0.15)}" stroke="#2A1A10" stroke-width=".8" stroke-linecap="round"/>`
        + `<path d="${mouth}" fill="#2A1A10"/>`;
}

const GENRE_PROPS = {
    rocket: (x, y) => `<g transform="translate(${x} ${y}) rotate(35)"><path d="M0 -9 Q4 -4 3 4 H-3 Q-4 -4 0 -9Z" fill="#E8EEF5"/><circle cx="0" cy="-2" r="1.4" fill="#4AA3D9"/><path d="M-3 2 l-2.4 4 h2.4Z M3 2 l2.4 4 h-2.4Z" fill="#E5484D"/><path d="M-1.6 4 L0 9 L1.6 4Z" fill="#F7913A"/></g>`,
    heart: (x, y) => `<path d="M${x} ${y + 5} C${x - 9} ${y - 1} ${x - 5} ${y - 8} ${x} ${y - 3} C${x + 5} ${y - 8} ${x + 9} ${y - 1} ${x} ${y + 5}Z" fill="#E5484D"/>`,
    ghost: (x, y) => `<path d="M${x - 5} ${y + 6} V${y - 1} a5 5 0 0 1 10 0 V${y + 6} l-2 -2 -1.6 2 -1.4 -2 -1.4 2 -1.6 -2Z" fill="#F4F2FA"/><circle cx="${x - 1.8}" cy="${y - 1}" r=".9" fill="#2A2A3A"/><circle cx="${x + 1.8}" cy="${y - 1}" r=".9" fill="#2A2A3A"/>`,
    sword: (x, y) => `<g transform="translate(${x} ${y}) rotate(-35)"><rect x="-1" y="-10" width="2" height="13" fill="#D9D9DE"/><path d="M-1 -10 L0 -12 L1 -10Z" fill="#D9D9DE"/><rect x="-4" y="3" width="8" height="1.6" fill="#D9A441"/><rect x="-.8" y="4.6" width="1.6" height="4" fill="#6A4122"/></g>`,
    magnifier: (x, y) => `<circle cx="${x - 1}" cy="${y - 1}" r="4" fill="#BFE3EE" fill-opacity=".4" stroke="#8A6238" stroke-width="1.6"/><path d="M${x + 2} ${y + 2} l4 4" stroke="#8A6238" stroke-width="2" stroke-linecap="round"/>`
};

function genres(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, '#3A2450'], [1, '#0E0A18']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) return s + `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + mask(60, 54, 14, true, '#F2C14E');
    if (level === 2) {
        s += `<circle cx="60" cy="54" r="26" fill="url(#${u}g)"/>`;
        s += `<g transform="rotate(-12 50 52)">${mask(50, 52, 12, true, '#F2C14E')}</g><g transform="rotate(12 70 58)">${mask(70, 58, 12, false, '#8CC4D8')}</g>`;
        return s;
    }
    if (level === 3) {
        s += `<circle cx="60" cy="54" r="28" fill="url(#${u}g)"/>`;
        s += `<g transform="rotate(-12 52 58)">${mask(52, 58, 10, true, '#F2C14E')}</g><g transform="rotate(12 68 62)">${mask(68, 62, 10, false, '#8CC4D8')}</g>`;
        return s + GENRE_PROPS.rocket(40, 36) + GENRE_PROPS.heart(78, 38) + GENRE_PROPS.ghost(84, 72);
    }
    s += '<g fill="#FFF3C8" opacity=".25"><path d="M60 10 L40 96 H80Z"/></g>';
    s += '<ellipse cx="60" cy="86" rx="28" ry="5" fill="#5A2A3A"/><ellipse cx="60" cy="84" rx="28" ry="5" fill="#7A3A4A"/>';
    s += `<circle cx="60" cy="56" r="30" fill="url(#${u}g)"/>`;
    s += `<g transform="rotate(-12 54 62)">${mask(54, 62, 11, true, '#F2C14E')}</g><g transform="rotate(12 68 66)">${mask(68, 66, 11, false, '#8CC4D8')}</g>`;
    const props = ['rocket', 'heart', 'ghost', 'sword', 'magnifier'];
    return s + props.map((k, i) => {
        const a = Math.PI * (1.08 + i * 0.21);
        return GENRE_PROPS[k](Math.round(60 + 26 * Math.cos(a)), Math.round(50 + 20 * Math.sin(a)));
    }).join('');
}

/* ── Actors: a headshot → a casting wall → a soloist in the spotlight → the company bowing to roses ── */

function silhouette(x, base, h, fill, bow = 0) {
    const head = h * 0.2;
    return `<g transform="rotate(${bow} ${x} ${base})"><circle cx="${x}" cy="${f(base - h + head)}" r="${f(head)}" fill="${fill}"/>`
        + `<path d="M${f(x - h * 0.26)} ${base} Q${f(x - h * 0.28)} ${f(base - h * 0.55)} ${x} ${f(base - h * 0.6)} Q${f(x + h * 0.28)} ${f(base - h * 0.55)} ${f(x + h * 0.26)} ${base}Z" fill="${fill}"/></g>`;
}

function headshot(x, y, w, tint) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${f(w * 1.25)}" fill="#FFFDF6"/><rect x="${f(x + 1.4)}" y="${f(y + 1.4)}" width="${f(w - 2.8)}" height="${f(w * 0.95)}" fill="${tint}"/>`
        + silhouette(x + w / 2, y + 1.4 + w * 0.95, w * 0.8, '#2A2A3A')
        + `<rect x="${f(x + w * 0.2)}" y="${f(y + w * 1.08)}" width="${f(w * 0.6)}" height="1" fill="#8A7A64"/>`;
}

function actors(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, level >= 3 ? '#4A1E2A' : '#2E3040'], [1, '#0E0A10']], 'cx="50%" cy="35%" r="85%"')
        + linear(`${u}b`, [[0, '#FFF3C8']]).replace('</linearGradient>', '<stop offset="1" stop-color="#FFF3C8" stop-opacity="0"/></linearGradient>')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + linear(`${u}st`, [[0, '#F7A8B8'], [1, '#D6728A']])
        + linear(`${u}br`, [[0, '#FFE79A'], [1, '#B4840C']])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) return s + `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + `<g transform="rotate(-5 60 56)">${headshot(48, 38, 24, '#8CC4D8')}</g>`;
    if (level === 2) {
        s += '<path d="M28 34 Q60 28 92 34" stroke="#8A7A64" stroke-width=".6" fill="none"/>';
        s += `<g transform="rotate(-8 40 52)">${headshot(30, 40, 20, '#F7B6CC')}</g><g transform="rotate(7 80 52)">${headshot(70, 40, 20, '#B8E0A8')}</g>`;
        return s + `<g transform="rotate(-2 60 50)">${headshot(49, 36, 22, '#8CC4D8')}</g>` + '<g fill="#E5484D"><circle cx="40" cy="41" r="1.4"/><circle cx="60" cy="37" r="1.4"/><circle cx="80" cy="41" r="1.4"/></g>';
    }
    if (level === 3) {
        // III: a soloist in the spotlight, raising a skull like Hamlet.
        s += '<g fill="#8A1E2A">' + [20, 28].map(x => `<path d="M${x} 10 q4 40 0 90 h8 q-3 -50 0 -90Z"/>`).join('') + [92, 100].map(x => `<path d="M${x} 10 q-4 40 0 90 h-8 q3 -50 0 -90Z"/>`).join('') + '</g>';
        s += `<path d="M60 12 L42 78 H78Z" fill="url(#${u}b)" opacity=".5"/>`;
        s += '<path d="M10 78 H110 V120 H10Z" fill="#3A1E14"/><path d="M10 78 H110" stroke="#8A5A30" stroke-width="1"/><ellipse cx="60" cy="78" rx="16" ry="3" fill="#FFF3C8" opacity=".35"/>';
        s += person(60, 78, 38, '#1E141A', 'raise');
        s += '<circle cx="68.4" cy="40.2" r="2.8" fill="#F1E9D8"/><rect x="67" y="42" width="2.8" height="1.6" fill="#F1E9D8"/><circle cx="67.4" cy="40" r=".7" fill="#1E141A"/><circle cx="69.4" cy="40" r=".7" fill="#1E141A"/>';
        return s + [34, 46, 74, 86].map(x => `<circle cx="${x}" cy="92" r="5" fill="#0E0A10"/>`).join('');
    }
    // IV: a star on the Walk of Fame — a pink terrazzo star with a brass rim, a camera emblem and press flashes.
    s += '<rect x="-20" y="-20" width="160" height="160" fill="#4A3A40"/>';
    s += '<g fill="#6A5A60" opacity=".7">' + Array.from({ length: 30 }, (_, i) => `<circle cx="${(i * 37) % 110 + 5}" cy="${(i * 23) % 100 + 8}" r="${i % 3 ? 0.6 : 1}"/>`).join('') + '</g>';
    s += '<g stroke="#2A1E22" stroke-width=".6"><path d="M10 30 H110"/><path d="M10 90 H110"/></g>';
    s += star5(60, 58, 26, `url(#${u}br)`) + star5(60, 58, 23, `url(#${u}st)`);
    s += '<rect x="46" y="42" width="28" height="4" rx="1" fill="url(#' + u + 'br)"/><rect x="49" y="43.4" width="22" height="1.2" fill="#7A5210"/>';
    s += `<circle cx="60" cy="62" r="7" fill="url(#${u}br)"/><circle cx="60" cy="62" r="5.4" fill="#C88A3E"/>`;
    s += '<g fill="#5A3A10"><rect x="56" y="60.4" width="6" height="4" rx=".6"/><path d="M62 61 l2 -1 v4 l-2 -1Z"/><circle cx="57.6" cy="59.4" r="1.2"/><circle cx="60.4" cy="59.4" r="1.2"/></g>';
    return s + flash(30, 34, 5) + flash(90, 30, 6) + flash(28, 80, 4) + flash(92, 82, 5) + '<path d="M10 22 Q60 30 110 22" stroke="#B8243A" stroke-width="2.4" fill="none"/>';
}

/* ── Directors: a megaphone → the director's chair → a camera dolly on rails → a camera crane over the set ── */

function megaphone(x, y, k, angle) {
    return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${k})"><path d="M-10 -3 L8 -9 V9 L-10 3Z" fill="#F2C14E" stroke="#8A6A10" stroke-width=".6"/><ellipse cx="8" cy="0" rx="2.4" ry="9" fill="#D9A441"/>`
        + '<rect x="-14" y="-3" width="5" height="6" rx="1" fill="#2A2A30"/><path d="M-8 3 v6 h3" stroke="#2A2A30" stroke-width="1.6" fill="none"/><path d="M-3 -4.6 L1 -6 V6 L-3 4.6Z" fill="#E5484D" opacity=".85"/></g>';
}

function directorChair(cx, base, k) {
    return `<g transform="translate(${cx} ${base}) scale(${k})"><g stroke="#8A5A30" stroke-width="2" stroke-linecap="round"><path d="M-12 0 L10 -18 M12 0 L-10 -18"/><path d="M-12 -36 V-14 M12 -36 V-14"/></g>`
        + '<rect x="-14" y="-20" width="28" height="4" rx="1" fill="#2A2A30"/><rect x="-12" y="-34" width="24" height="10" rx="1" fill="#2A2A30"/><rect x="-8" y="-31" width="16" height="3" rx=".6" fill="#F2C14E"/></g>';
}

function directors(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, level >= 3 ? '#3A3050' : '#3A2E2A'], [1, '#0E0A10']], 'cx="50%" cy="35%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + linear(`${u}b`, [[0, '#FFF3C8']]).replace('</linearGradient>', '<stop offset="1" stop-color="#FFF3C8" stop-opacity="0"/></linearGradient>')
        + linear(`${u}au`, [[0, '#FFE79A'], [0.5, '#E8B23A'], [1, '#9A6A10']])
        + '</defs>' + backdrop(`url(#${u}s)`);
    s += '<path d="M10 80 Q60 74 110 80 V120 H10Z" fill="#1A1418"/>';
    if (level === 1) {
        s += `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + megaphone(58, 54, 1.4, -15);
        return s + '<g stroke="#FFF3C8" stroke-width="1.2" stroke-linecap="round" opacity=".8"><path d="M80 44 l5 -3"/><path d="M82 52 h6"/><path d="M80 60 l5 3"/></g>';
    }
    if (level === 2) return s + `<circle cx="60" cy="56" r="26" fill="url(#${u}g)"/>` + directorChair(58, 82, 1.1) + megaphone(80, 74, 0.7, 20);
    if (level === 3) {
        s += `<circle cx="54" cy="50" r="28" fill="url(#${u}g)"/>`;
        s += '<g stroke="#8E92A8" stroke-width="1.4"><path d="M22 78 L98 75"/><path d="M22 84 L98 81"/></g>';
        s += '<g stroke="#5A5E70" stroke-width="1.2">' + [28, 40, 52, 64, 76, 88].map(x => `<path d="M${x} 78 L${x} 84"/>`).join('') + '</g>';
        s += '<rect x="38" y="66" width="30" height="8" rx="2" fill="#4A4E60"/><circle cx="43" cy="76" r="3" fill="#2A2A30"/><circle cx="63" cy="76" r="3" fill="#2A2A30"/><path d="M53 66 V58" stroke="#2A2A30" stroke-width="3"/>';
        return s + `<g transform="translate(53 46) scale(.9) translate(-53 -46)">${camera(53, 46).replace(/<g stroke="#2A2A30" stroke-width="1.6"[^]*?<\/g>/, '')}</g>` + directorChair(84, 76, 0.55);
    }
    // IV: the director's place on set — a golden chair with a star, a megaphone on the seat, camera, light and clapperboard.
    s += `<path d="M86 50 L50 82 H76Z" fill="url(#${u}b)" opacity=".35"/>` + lightStand(88, 80, -30);
    s += `<circle cx="58" cy="56" r="28" fill="url(#${u}g)"/>`;
    s += `<g transform="translate(58 82) scale(1.25)"><g stroke="url(#${u}au)" stroke-width="2.2" stroke-linecap="round"><path d="M-12 0 L10 -18 M12 0 L-10 -18"/><path d="M-12 -36 V-14 M12 -36 V-14"/></g>`
        + '<rect x="-14" y="-20" width="28" height="4" rx="1" fill="#2A1A2A"/><rect x="-12" y="-35" width="24" height="11" rx="1" fill="#2A1A2A"/></g>';
    s += star5(58, 56.5, 5, '#F2C14E') + megaphone(56, 54.5, 0.5, 10).replace('translate(56 54.5)', 'translate(60 59)');
    s += `<g transform="translate(30 48) scale(.75) translate(-30 -48)">${camera(30, 48)}</g>`;
    return s + clapperboard(66, 82, 14);
}

/* ── In progress: a paused play button → half a ring with popcorn → three quarters on a tablet → a full ring of screens ── */

function progressRing(cx, cy, r, frac, color, width) {
    const end = -Math.PI / 2 + frac * Math.PI * 2, big = frac > 0.5 ? 1 : 0;
    const arc = frac >= 1
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"/>`
        : `<path d="M${cx} ${f(cy - r)} A${r} ${r} 0 ${big} 1 ${f(cx + r * Math.cos(end))} ${f(cy + r * Math.sin(end))}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2A2E44" stroke-width="${width}"/>` + arc;
}

function playButton(cx, cy, r, fill) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/><path d="M${f(cx - r * 0.3)} ${f(cy - r * 0.45)} L${f(cx + r * 0.5)} ${cy} L${f(cx - r * 0.3)} ${f(cy + r * 0.45)}Z" fill="#fff"/>`;
}

function popcorn(x, base, k) {
    return `<g transform="translate(${x} ${base}) scale(${k})"><path d="M-7 0 L-9 -16 H9 L7 0Z" fill="#F4F0E6"/><g fill="#E5484D"><rect x="-6" y="-16" width="2.4" height="16"/><rect x="0" y="-16" width="2.4" height="16"/></g>`
        + '<g fill="#FFF3C8"><circle cx="-6" cy="-18" r="3"/><circle cx="-1" cy="-20" r="3.4"/><circle cx="4" cy="-18.5" r="3"/><circle cx="1" cy="-23" r="2.6"/></g></g>';
}

function inProgress(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, '#26304E'], [1, '#0A0C18']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#7CD0FF', 0.45], [1, '#7CD0FF', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    const frac = [0.25, 0.5, 0.75, 1][Math.min(level, 4) - 1];
    if (level <= 2) {
        s += `<circle cx="60" cy="52" r="24" fill="url(#${u}g)"/>` + progressRing(60, 52, 15, frac, '#E5484D', 3.4) + playButton(60, 52, 10, '#3A4A7A');
        return level === 2 ? s + popcorn(80, 82, 0.8) : s;
    }
    if (level === 3) {
        s += '<rect x="30" y="34" width="60" height="42" rx="4" fill="#14141A"/><rect x="33" y="37" width="54" height="36" rx="2" fill="#1E2A48"/>';
        s += `<circle cx="60" cy="52" r="20" fill="url(#${u}g)"/>` + progressRing(60, 52, 12, frac, '#E5484D', 3) + playButton(60, 52, 8, '#3A4A7A');
        s += '<rect x="36" y="68" width="48" height="2" rx="1" fill="#3A3F52"/><rect x="36" y="68" width="36" height="2" rx="1" fill="#E5484D"/>';
        return s + popcorn(86, 88, 0.7);
    }
    s += `<circle cx="60" cy="54" r="34" fill="url(#${u}g)"/>`;
    for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 3, x = 60 + 27 * Math.cos(a), y = 54 + 24 * Math.sin(a);
        s += `<rect x="${f(x - 6)}" y="${f(y - 4.2)}" width="12" height="8.4" rx="1" fill="${PICTURES[i]}"/><rect x="${f(x - 6)}" y="${f(y + 3)}" width="${f(12 * (0.3 + i * 0.12))}" height="1.2" fill="#E5484D"/>`;
    }
    return s + progressRing(60, 54, 15, 1, '#F2C14E', 3.6) + playButton(60, 54, 10.5, '#E5484D') + star5(74, 40, 3, '#FFF6D0');
}

/* ── Curator: one labelled box → stacked boxes → an archive shelf → a gallery of framed posters behind a rope ── */

function filmBox(x, y, w, h, c, label = true) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" fill="${c}"/><rect x="${x}" y="${y}" width="${w}" height="${f(h * 0.22)}" rx="1.2" fill="#000" opacity=".18"/>`
        + (label ? `<rect x="${f(x + w * 0.25)}" y="${f(y + h * 0.42)}" width="${f(w * 0.5)}" height="${f(h * 0.26)}" rx=".6" fill="#F6EEDC"/><rect x="${f(x + w * 0.32)}" y="${f(y + h * 0.52)}" width="${f(w * 0.36)}" height=".9" fill="#8A7A64"/>` : '');
}

function frame(x, y, w, h, c) {
    return `<rect x="${x - 2}" y="${y - 2}" width="${w + 4}" height="${h + 4}" fill="#D9A441"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`
        + `<circle cx="${f(x + w / 2)}" cy="${f(y + h * 0.4)}" r="${f(w * 0.2)}" fill="#000" opacity=".22"/><path d="M${x} ${y + h} L${f(x + w * 0.4)} ${f(y + h * 0.6)} L${x + w} ${y + h}Z" fill="#000" opacity=".2"/>`;
}

function curator(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, level >= 4 ? [[0, '#3A4A5E'], [1, '#121820']] : [[0, '#4A3A2E'], [1, '#160F0A']], 'cx="50%" cy="30%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.45], [1, '#FFE6A0', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) {
        s += `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + filmBox(42, 42, 36, 26, '#B8432F');
        return s + '<path d="M48 42 V34 Q60 28 72 34 V42" fill="none" stroke="#2A2420" stroke-width="2"/>' + star5(72, 38, 3.4, '#F2C14E');
    }
    if (level === 2) {
        s += `<circle cx="60" cy="54" r="26" fill="url(#${u}g)"/>`;
        return s + filmBox(38, 60, 44, 18, '#2F6E8E') + filmBox(42, 44, 36, 16, '#B8432F') + filmBox(46, 30, 28, 14, '#D9A441');
    }
    if (level === 3) {
        s += plank(26, 94, 54) + plank(26, 94, 80);
        const colors = ['#B8432F', '#2F6E8E', '#D9A441', '#5B8A4A', '#7A4A8C', '#C8683A'];
        for (let i = 0; i < 4; i++) s += filmBox(29 + i * 16, 38, 14, 16, colors[i]);
        for (let i = 0; i < 4; i++) s += filmBox(29 + i * 16, 64, 14, 16, colors[(i + 2) % 6]);
        return s + '<rect x="44" y="26" width="32" height="8" rx="1" fill="#F6EEDC"/><rect x="48" y="29" width="24" height="1.6" fill="#8A7A64"/>';
    }
    s += '<path d="M10 78 H110 V120 H10Z" fill="#5A3A26"/>';
    s += `<circle cx="60" cy="44" r="30" fill="url(#${u}g)"/>`;
    s += frame(48, 32, 24, 32, '#B8432F') + frame(30, 38, 12, 16, '#2F6E8E') + frame(78, 38, 12, 16, '#5B8A4A') + frame(30, 60, 12, 10, '#D9A441') + frame(78, 60, 12, 10, '#7A4A8C');
    s += '<g fill="#FFF3C8" opacity=".8"><path d="M54 24 h12 l-2 4 h-8Z"/></g>';
    s += '<g stroke="#D9A441" stroke-width="1.8"><path d="M30 86 V74 M90 86 V74"/></g><circle cx="30" cy="73" r="2" fill="#F2C14E"/><circle cx="90" cy="73" r="2" fill="#F2C14E"/>';
    return s + '<path d="M30 75 Q60 86 90 75" stroke="#B8243A" stroke-width="2.4" fill="none"/>';
}

/* ── Filler: one reel → a crate of reels → an overflowing crate → an open treasure chest spilling film ── */

function reel(cx, cy, r, c = '#3A3A44') {
    let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/><circle cx="${cx}" cy="${cy}" r="${f(r * 0.82)}" fill="#8E8E96" opacity=".35"/>`;
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        s += `<circle cx="${f(cx + r * 0.52 * Math.cos(a))}" cy="${f(cy + r * 0.52 * Math.sin(a))}" r="${f(r * 0.2)}" fill="#14141A"/>`;
    }
    return s + `<circle cx="${cx}" cy="${cy}" r="${f(r * 0.14)}" fill="#D9D9DE"/>`;
}

function crate(x, y, w, h) {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#A0582A"/>`;
    for (let i = 1; i < 3; i++) s += `<rect x="${x}" y="${f(y + i * h / 3 - 0.6)}" width="${w}" height="1.2" fill="#6A3A18"/>`;
    return s + `<rect x="${x}" y="${y}" width="3" height="${h}" fill="#7A4220"/><rect x="${x + w - 3}" y="${y}" width="3" height="${h}" fill="#7A4220"/>`;
}

function filler(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, '#3A3040'], [1, '#0E0A12']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FFD98A', 0.55], [1, '#FFD98A', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) return s + `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + reel(60, 54, 15) + '<path d="M70 64 Q80 74 92 70" stroke="#2A2420" stroke-width="5" fill="none"/>';
    if (level === 2) {
        s += `<circle cx="60" cy="56" r="26" fill="url(#${u}g)"/>`;
        return s + reel(50, 52, 9, '#B8432F') + reel(68, 50, 9, '#2F6E8E') + crate(36, 56, 48, 22);
    }
    if (level === 3) {
        s += `<circle cx="60" cy="54" r="30" fill="url(#${u}g)"/>`;
        s += reel(44, 48, 9, '#B8432F') + reel(60, 42, 10, '#2F6E8E') + reel(76, 48, 9, '#5B8A4A') + reel(52, 34, 7, '#D9A441') + reel(70, 33, 6.5, '#7A4A8C');
        return s + crate(32, 54, 56, 26) + cassette(76, 76, 14, false) + reel(30, 80, 6, '#C8683A');
    }
    s += `<circle cx="60" cy="50" r="34" fill="url(#${u}g)"/>`;
    s += '<g fill="#FFF3C8" opacity=".3"><path d="M40 56 L28 20 L46 20Z"/><path d="M80 56 L92 20 L74 20Z"/><path d="M60 54 L54 14 H66Z"/></g>';
    s += '<path d="M34 54 Q34 34 60 34 Q86 34 86 54Z" fill="#7A4220" transform="rotate(-14 34 54)"/>';
    s += reel(46, 52, 8, '#B8432F') + reel(62, 48, 9, '#2F6E8E') + reel(76, 54, 7.5, '#5B8A4A');
    s += '<rect x="32" y="56" width="56" height="26" rx="2" fill="#A0582A"/><rect x="32" y="56" width="56" height="5" fill="#C0743C"/>';
    s += '<g fill="#D9A441"><rect x="32" y="56" width="4" height="26"/><rect x="84" y="56" width="4" height="26"/><rect x="56" y="58" width="8" height="9" rx="1.4"/></g><circle cx="60" cy="63" r="1.6" fill="#5A3010"/>';
    s += reel(28, 84, 5.5, '#D9A441') + cassette(84, 80, 13, false);
    return s + [[46, 36], [74, 32], [60, 26]].map(([x, y]) => star5(x, y, 3, '#FFE79A')).join('');
}

/* ── Reviewer: a quill and a sheet → a notebook of stars → a typewriter → a newspaper column → a laptop under flying stars ── */

function quill(x, y, angle, len = 30) {
    return `<g transform="rotate(${angle} ${x} ${y})"><path d="M${x} ${y} Q${x + len * 0.4} ${y - len * 0.25} ${x + len} ${y - len * 0.1} Q${x + len * 0.55} ${y + len * 0.05} ${x} ${y}Z" fill="#F4F0E6" stroke="#B8B0A0" stroke-width=".5"/>`
        + `<path d="M${x} ${y} L${x + len * 0.9} ${y - len * 0.1}" stroke="#B8B0A0" stroke-width=".5"/><path d="M${x} ${y} l-3 1.4" stroke="#2A2A30" stroke-width="1.2" stroke-linecap="round"/></g>`;
}

function textLines(x, y, w, rows, gap = 3.4, c = '#B5A88E') {
    return Array.from({ length: rows }, (_, i) => `<rect x="${x}" y="${f(y + i * gap)}" width="${f(i === rows - 1 ? w * 0.6 : w)}" height="1.2" rx=".6" fill="${c}"/>`).join('');
}

function starRow(x, y, n, r, filled) {
    return Array.from({ length: n }, (_, i) => star5(x + i * r * 2.3, y, r, i < filled ? '#F2C14E' : '#5A5468')).join('');
}

function reviewer(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, '#3A3440'], [1, '#100C12']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) {
        s += `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>`;
        s += '<rect x="42" y="36" width="30" height="38" rx="1" fill="#F6EEDC" transform="rotate(-5 57 55)"/>' + `<g transform="rotate(-5 57 55)">${textLines(46, 44, 22, 5)}</g>`;
        return s + quill(66, 70, -50, 28);
    }
    if (level === 2) {
        s += `<circle cx="60" cy="54" r="26" fill="url(#${u}g)"/>`;
        s += '<rect x="38" y="34" width="44" height="40" rx="2" fill="#2F6E8E"/><rect x="41" y="34" width="40" height="40" rx="1" fill="#F6EEDC"/>';
        s += '<g fill="#8A8A96">' + [38, 46, 54, 62, 70].map(y => `<circle cx="38" cy="${y}" r="1.4"/>`).join('') + '</g>';
        return s + starRow(46, 44, 5, 2.6, 4) + textLines(45, 54, 32, 4) + quill(78, 74, -60, 22);
    }
    if (level === 3) {
        s += `<circle cx="60" cy="50" r="28" fill="url(#${u}g)"/>`;
        s += '<rect x="46" y="28" width="28" height="22" fill="#F6EEDC"/>' + starRow(50, 34, 5, 2, 5) + textLines(49, 40, 22, 3);
        s += '<path d="M34 50 H86 L90 74 H30Z" fill="#3A3A44"/><rect x="38" y="48" width="44" height="5" rx="2.4" fill="#2A2A30"/>';
        s += '<g fill="#D9D9DE">' + Array.from({ length: 18 }, (_, i) => `<circle cx="${40 + (i % 9) * 5 + (i > 8 ? 2.4 : 0)}" cy="${60 + Math.floor(i / 9) * 6}" r="1.8"/>`).join('') + '</g>';
        return s + '<rect x="44" y="70" width="32" height="2.4" rx="1.2" fill="#D9D9DE"/><circle cx="32" cy="50" r="2.6" fill="#8E8E96"/>';
    }
    if (level === 4) {
        s += `<circle cx="60" cy="54" r="30" fill="url(#${u}g)"/>`;
        s += '<rect x="30" y="30" width="60" height="50" fill="#F1E9D8" transform="rotate(-4 60 55)"/><g transform="rotate(-4 60 55)">';
        s += '<rect x="34" y="34" width="52" height="7" fill="#2A2A30"/><rect x="38" y="36" width="44" height="3" fill="#F1E9D8" opacity=".85"/>';
        s += '<rect x="34" y="45" width="22" height="16" fill="#8CC4D8"/><circle cx="45" cy="52" r="4" fill="#000" opacity=".2"/>';
        s += textLines(34, 64, 22, 4) + textLines(60, 45, 26, 3) + starRow(61, 58, 5, 2.2, 5) + textLines(60, 64, 26, 4);
        return s + '</g>';
    }
    s += `<circle cx="60" cy="50" r="34" fill="url(#${u}g)"/>`;
    s += '<rect x="34" y="32" width="52" height="34" rx="2" fill="#2A2A30"/><rect x="37" y="35" width="46" height="28" rx="1" fill="#F6EEDC"/>';
    s += starRow(42, 41, 5, 2.4, 5) + textLines(41, 48, 38, 4);
    s += '<path d="M28 66 H92 L96 72 H24Z" fill="#5A5E70"/><rect x="54" y="68" width="12" height="1.6" rx=".8" fill="#3A3A44"/>';
    s += [[30, 30, 3], [90, 34, 3.4], [26, 52, 2.4], [94, 54, 2.6], [60, 22, 3.6]].map(([x, y, r]) => star5(x, y, r, '#FFE79A')).join('');
    return s + quill(82, 84, -70, 22);
}

/* ── Writer: an open book → a stack with an inkwell → a great glowing book with pages taking flight ── */

function openBook(cx, cy, w, h, cover = '#7A2E3A') {
    const hw = w / 2;
    return `<path d="M${cx} ${cy + h * 0.5} L${cx - hw - 2} ${cy + h * 0.42} V${cy - h * 0.5} L${cx} ${cy - h * 0.42} L${cx + hw + 2} ${cy - h * 0.5} V${cy + h * 0.42}Z" fill="${cover}"/>`
        + `<path d="M${cx} ${cy + h * 0.44} Q${cx - hw * 0.5} ${cy + h * 0.32} ${cx - hw} ${cy + h * 0.38} V${cy - h * 0.46} Q${cx - hw * 0.5} ${cy - h * 0.52} ${cx} ${cy - h * 0.38}Z" fill="#FBF5E6"/>`
        + `<path d="M${cx} ${cy + h * 0.44} Q${cx + hw * 0.5} ${cy + h * 0.32} ${cx + hw} ${cy + h * 0.38} V${cy - h * 0.46} Q${cx + hw * 0.5} ${cy - h * 0.52} ${cx} ${cy - h * 0.38}Z" fill="#F3EAD4"/>`
        + textLines(cx - hw + 3, cy - h * 0.26, hw - 6, 5, h * 0.12) + textLines(cx + 3, cy - h * 0.26, hw - 6, 5, h * 0.12)
        + `<path d="M${cx} ${cy - h * 0.38} V${cy + h * 0.44}" stroke="#C8B89A" stroke-width=".6"/>`;
}

function writer(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, level >= 3 ? '#3A2A5A' : '#3A2A22'], [1, '#100A12']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.55], [1, '#FFE6A0', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) return s + `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + openBook(60, 56, 44, 30);
    if (level === 2) {
        s += `<circle cx="60" cy="52" r="26" fill="url(#${u}g)"/>`;
        s += '<rect x="34" y="70" width="40" height="8" rx="1" fill="#2F6E8E"/><rect x="36" y="62" width="36" height="8" rx="1" fill="#B8432F"/><rect x="38" y="54" width="34" height="8" rx="1" fill="#5B8A4A"/>';
        s += '<g fill="#F6EEDC" opacity=".8"><rect x="34" y="72" width="40" height="1"/><rect x="36" y="64" width="36" height="1"/><rect x="38" y="56" width="34" height="1"/></g>';
        s += openBook(56, 44, 30, 18, '#7A4A8C');
        return s + '<path d="M76 78 h12 l-1 -9 h-10Z" fill="#2A2A3A"/><rect x="79" y="66" width="6" height="3" fill="#2A2A3A"/>' + quill(84, 66, -80, 22);
    }
    s += `<circle cx="60" cy="52" r="34" fill="url(#${u}g)"/>`;
    s += '<g fill="#FFF3C8" opacity=".2"><path d="M60 64 L30 18 H90Z"/></g>';
    s += [[34, 36, -20], [82, 30, 25], [44, 24, 10], [88, 50, -15]].map(([x, y, a]) => `<g transform="rotate(${a} ${x} ${y})"><path d="M${x - 5} ${y - 3} Q${x} ${y - 5} ${x + 5} ${y - 3} V${y + 4} Q${x} ${y + 2} ${x - 5} ${y + 4}Z" fill="#FBF5E6"/>${textLines(x - 3.6, y - 1.4, 7, 3, 1.8)}</g>`).join('');
    s += '<path d="M24 84 H96 L92 78 H28Z" fill="#3A2420"/>';
    s += openBook(60, 62, 56, 32, '#8A1E2A');
    return s + [[56, 40], [66, 36], [60, 30]].map(([x, y], i) => star5(x, y, 2.4 - i * 0.3, '#FFE79A')).join('');
}

/* ── Voice: one heart → a speech bubble of hearts → a microphone → a stage mic → a cheering crowd → a giant heart balloon ── */

function heart(x, y, r, fill = '#E5484D') {
    return `<path d="M${f(x)} ${f(y + r)} C${f(x - r * 1.8)} ${f(y - r * 0.2)} ${f(x - r)} ${f(y - r * 1.6)} ${f(x)} ${f(y - r * 0.6)} C${f(x + r)} ${f(y - r * 1.6)} ${f(x + r * 1.8)} ${f(y - r * 0.2)} ${f(x)} ${f(y + r)}Z" fill="${fill}"/>`
        + `<ellipse cx="${f(x - r * 0.6)}" cy="${f(y - r * 0.7)}" rx="${f(r * 0.28)}" ry="${f(r * 0.18)}" fill="#fff" opacity=".45" transform="rotate(-30 ${f(x - r * 0.6)} ${f(y - r * 0.7)})"/>`;
}

function microphone(x, y, k) {
    return `<g transform="translate(${x} ${y}) scale(${k})"><path d="M-8 2 Q-8 12 0 12 Q8 12 8 2" stroke="#8E8E96" stroke-width="1.6" fill="none"/><path d="M0 12 V22 M-6 22 H6" stroke="#8E8E96" stroke-width="1.8" stroke-linecap="round"/>`
        + '<rect x="-5.5" y="-14" width="11" height="20" rx="5.5" fill="#3A3A44"/><g stroke="#8E8E96" stroke-width=".5">' + [-10, -6, -2].map(y => `<path d="M-5 ${y} H5"/>`).join('') + '</g><rect x="-5.5" y="0" width="11" height="2" fill="#D9A441"/></g>';
}

function crowd(base, n, color) {
    let s = '';
    for (let i = 0; i < n; i++) {
        const x = 18 + i * (84 / (n - 1)), h = 12 + (i % 3) * 2;
        s += `<circle cx="${f(x)}" cy="${f(base - h)}" r="4.2" fill="${color}"/><path d="M${f(x - 6)} ${base + 4} Q${f(x)} ${f(base - h + 2)} ${f(x + 6)} ${base + 4}Z" fill="${color}"/>`;
        if (i % 2) s += `<path d="M${f(x + 2)} ${f(base - h)} L${f(x + 5)} ${f(base - h - 9)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
    return s;
}

function voice(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, level >= 4 ? '#4A1E40' : '#3A2438'], [1, '#100810']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FF9AB8', 0.5], [1, '#FF9AB8', 0]])
        + linear(`${u}b`, [[0, '#FFF3C8']]).replace('</linearGradient>', '<stop offset="1" stop-color="#FFF3C8" stop-opacity="0"/></linearGradient>')
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) return s + `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + heart(60, 56, 12);
    if (level === 2) {
        s += `<circle cx="60" cy="56" r="26" fill="url(#${u}g)"/>`;
        s += '<path d="M36 46 Q36 34 52 34 H70 Q84 34 84 46 Q84 58 70 58 H52 L44 66 L46 58 Q36 58 36 46Z" fill="#F6EEDC"/>';
        return s + heart(52, 47, 5) + heart(68, 46, 5, '#F27BAE') + heart(78, 26, 4) + heart(88, 36, 3, '#F27BAE');
    }
    if (level === 3) {
        s += `<circle cx="58" cy="52" r="28" fill="url(#${u}g)"/>` + microphone(56, 52, 1.2);
        return s + heart(80, 36, 5) + heart(84, 52, 3.6, '#F27BAE') + heart(36, 34, 4, '#F27BAE') + heart(32, 58, 3.4);
    }
    if (level === 4) {
        s += '<path d="M60 12 L42 80 H78Z" fill="url(#' + u + 'b)" opacity=".45"/><path d="M10 80 H110 V120 H10Z" fill="#2A1420"/>';
        s += microphone(60, 52, 1.3);
        return s + [[36, 40, 5], [84, 38, 5.4], [30, 62, 3.6], [90, 60, 4], [72, 24, 3.4]].map(([x, y, r], i) => heart(x, y, r, i % 2 ? '#F27BAE' : '#E5484D')).join('');
    }
    if (level === 5) {
        s += '<path d="M60 12 L40 70 H80Z" fill="url(#' + u + 'b)" opacity=".4"/>' + microphone(60, 44, 1.1);
        s += [[34, 30, 4.4], [86, 30, 4.4], [44, 20, 3], [76, 20, 3]].map(([x, y, r]) => heart(x, y, r)).join('');
        return s + crowd(80, 7, '#1A0A14') + [[26, 56], [46, 54], [66, 56], [86, 54]].map(([x, y], i) => heart(x, y, 3, i % 2 ? '#F27BAE' : '#FFB3C8')).join('');
    }
    s += `<circle cx="60" cy="44" r="34" fill="url(#${u}g)"/>`;
    s += '<path d="M60 64 Q58 74 62 84" stroke="#F6EEDC" stroke-width=".8" fill="none"/>' + heart(60, 42, 19) + heart(60, 42, 13, '#F25A6A');
    s += [[34, 26, '#F2C14E'], [86, 24, '#5BAA5E'], [28, 50, '#4AA3D9'], [92, 52, '#F2C14E'], [40, 64, '#F27BAE'], [80, 66, '#4AA3D9']]
        .map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="2.6" height="1.4" fill="${c}" transform="rotate(${i * 41} ${x} ${y})"/>`).join('');
    return s + crowd(82, 7, '#1A0A14');
}

/* ── Generous: a small gift → a gift with a heart → a pile of gifts → a balloon dropping gifts and hearts ── */

function gift(x, y, w, h, box, ribbon) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${box}"/><rect x="${f(x - 1)}" y="${y}" width="${w + 2}" height="${f(h * 0.26)}" rx="1" fill="${box}"/><rect x="${f(x - 1)}" y="${y}" width="${w + 2}" height="${f(h * 0.26)}" rx="1" fill="#fff" opacity=".18"/>`
        + `<rect x="${f(x + w / 2 - w * 0.08)}" y="${y}" width="${f(w * 0.16)}" height="${h}" fill="${ribbon}"/>`
        + `<path d="M${f(x + w / 2)} ${y} Q${f(x + w * 0.15)} ${f(y - h * 0.4)} ${f(x + w * 0.3)} ${y}Z M${f(x + w / 2)} ${y} Q${f(x + w * 0.85)} ${f(y - h * 0.4)} ${f(x + w * 0.7)} ${y}Z" fill="${ribbon}"/>`;
}

function generous(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, level >= 4 ? [[0, '#6EC6F2'], [1, '#2E78B8']] : [[0, '#3A3050'], [1, '#100C18']], 'cx="50%" cy="35%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) return s + `<circle cx="60" cy="56" r="22" fill="url(#${u}g)"/>` + gift(48, 52, 24, 22, '#4AA3D9', '#F2C14E');
    if (level === 2) {
        s += `<circle cx="60" cy="56" r="26" fill="url(#${u}g)"/>` + gift(44, 50, 30, 26, '#E5484D', '#F2C14E');
        return s + heart(78, 38, 6) + heart(86, 26, 3.4, '#F27BAE');
    }
    if (level === 3) {
        s += `<circle cx="60" cy="56" r="30" fill="url(#${u}g)"/>`;
        s += gift(30, 62, 26, 20, '#4AA3D9', '#F2C14E') + gift(62, 60, 28, 22, '#5BAA5E', '#E5484D') + gift(46, 40, 26, 22, '#E5484D', '#F2C14E');
        return s + heart(84, 40, 5) + heart(32, 44, 4, '#F27BAE');
    }
    s += '<g fill="#fff" opacity=".85"><circle cx="30" cy="70" r="6"/><circle cx="38" cy="68" r="7"/><circle cx="84" cy="76" r="5"/><circle cx="92" cy="74" r="6"/></g>';
    s += '<path d="M60 14 C42 14 38 30 44 42 Q50 52 56 56 H64 Q70 52 76 42 C82 30 78 14 60 14Z" fill="#E5484D"/>';
    s += '<path d="M60 14 C54 14 52 30 54 42 Q56 52 58 56 H62 Q64 52 66 42 C68 30 66 14 60 14Z" fill="#F2C14E"/><path d="M44 30 H76" stroke="#9E2329" stroke-width=".8"/>';
    s += '<path d="M56 56 L55 64 M64 56 L65 64" stroke="#5A3418" stroke-width=".8"/><rect x="53" y="64" width="14" height="8" rx="1" fill="#8A5A30"/>';
    s += gift(34, 50, 10, 9, '#5BAA5E', '#F2C14E') + gift(74, 60, 11, 10, '#7A4A8C', '#F2C14E') + gift(50, 80, 12, 10, '#4AA3D9', '#E5484D');
    return s + heart(38, 76, 3.4) + heart(82, 46, 4, '#F27BAE') + heart(70, 84, 3);
}

/* ── Marathoner: a small wheel → a wheel with a pointer → a wheel on a stand → a wheel and a stopwatch → a game-show wheel in lights ── */

function wheelOf(cx, cy, r, spokes, colors) {
    let s = '';
    for (let i = 0; i < spokes; i++) {
        const a0 = i * Math.PI * 2 / spokes - Math.PI / 2, a1 = a0 + Math.PI * 2 / spokes;
        s += `<path d="M${cx} ${cy} L${f(cx + r * Math.cos(a0))} ${f(cy + r * Math.sin(a0))} A${r} ${r} 0 0 1 ${f(cx + r * Math.cos(a1))} ${f(cy + r * Math.sin(a1))}Z" fill="${colors[i % colors.length]}"/>`;
        const am = (a0 + a1) / 2;
        s += `<rect x="${f(cx + r * 0.62 * Math.cos(am) - 2)}" y="${f(cy + r * 0.62 * Math.sin(am) - 1.4)}" width="4" height="2.8" rx=".5" fill="#F6EEDC" opacity=".8" transform="rotate(${f(am * 57.3)} ${f(cx + r * 0.62 * Math.cos(am))} ${f(cy + r * 0.62 * Math.sin(am))})"/>`;
    }
    return s + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#D9A441" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="${f(r * 0.16)}" fill="#D9A441"/>`;
}

const WHEEL = ['#E5484D', '#F2C14E', '#4AA3D9', '#5BAA5E', '#7A4A8C', '#F7913A'];

function marathoner(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, level >= 5 ? '#4A1E3A' : '#2E2A4A'], [1, '#0C0A18']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + linear(`${u}b`, [[0, '#FFF3C8']]).replace('</linearGradient>', '<stop offset="1" stop-color="#FFF3C8" stop-opacity="0"/></linearGradient>')
        + '</defs>' + backdrop(`url(#${u}s)`);
    const pointer = (y) => `<path d="M60 ${y + 8} L55 ${y} H65Z" fill="#F6EEDC" stroke="#8A6A10" stroke-width=".6"/>`;
    if (level === 1) return s + `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + wheelOf(60, 54, 14, 6, WHEEL);
    if (level === 2) {
        s += `<circle cx="60" cy="54" r="26" fill="url(#${u}g)"/>` + wheelOf(60, 56, 17, 8, WHEEL);
        return s + pointer(34) + popcorn(84, 82, 0.6);
    }
    s += '<path d="M10 82 Q60 76 110 82 V120 H10Z" fill="#1A1424"/>';
    if (level === 3) {
        s += `<circle cx="60" cy="50" r="28" fill="url(#${u}g)"/>`;
        s += '<path d="M60 68 L50 84 H70Z" fill="#8A5A30"/>' + wheelOf(60, 50, 20, 10, WHEEL);
        return s + pointer(22);
    }
    if (level === 4) {
        // IV: the wheel gets a ring of bulbs, with the night's reels and popcorn beside it.
        s += `<circle cx="60" cy="48" r="30" fill="url(#${u}g)"/>`;
        s += '<path d="M60 70 L48 84 H72Z" fill="#8A5A30"/>' + wheelLights(60, 48, 21, 18) + wheelOf(60, 48, 19, 10, WHEEL) + pointer(20);
        s += reel(26, 76, 7, '#B8432F') + reel(30, 66, 6, '#2F6E8E') + reel(24, 58, 5, '#5B8A4A');
        return s + popcorn(92, 84, 0.75);
    }
    // V: the grand finale — a big golden wheel on a stage between curtains, under spotlights, with confetti.
    s += '<g fill="#8A1E3A">' + [20, 28].map(x => `<path d="M${x} 8 q4 40 0 90 h8 q-3 -50 0 -90Z"/>`).join('') + [92, 100].map(x => `<path d="M${x} 8 q-4 40 0 90 h-8 q3 -50 0 -90Z"/>`).join('') + '</g>';
    s += `<g opacity=".35"><path d="M24 12 L48 80 H58Z" fill="url(#${u}b)"/><path d="M96 12 L72 80 H62Z" fill="url(#${u}b)"/></g>`;
    s += `<circle cx="60" cy="46" r="32" fill="url(#${u}g)"/>`;
    s += '<rect x="30" y="80" width="60" height="5" fill="#C8A24A"/><rect x="34" y="76" width="52" height="5" fill="#E8B23A"/><path d="M60 70 L50 76 H70Z" fill="#C8A24A"/>';
    s += wheelLights(60, 44, 25, 22).replace('#2A1A30', '#5A3A10').replace('stroke="#D9A441"', 'stroke="#FFE79A"') + wheelOf(60, 44, 23, 12, WHEEL) + pointer(13);
    s += star5(60, 44, 4.4, '#FFE79A');
    return s + [[36, 22, '#E5484D'], [84, 20, '#5BAA5E'], [32, 60, '#F2C14E'], [88, 58, '#4AA3D9'], [44, 14, '#F2C14E'], [76, 70, '#E5484D']]
        .map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="2.6" height="1.4" fill="${c}" transform="rotate(${i * 53} ${x} ${y})"/>`).join('');
}

/* ── Provider: a disc → a stack of discs → a projector with reels → a projector beaming to a full house ── */

function disc(cx, cy, r) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${'__'}d)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#8E8E96" stroke-width=".5"/>`
        + `<circle cx="${cx}" cy="${cy}" r="${f(r * 0.3)}" fill="#E8E8EE"/><circle cx="${cx}" cy="${cy}" r="${f(r * 0.12)}" fill="#14141A"/>`;
}

function provider(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, '#2E2A40'], [1, '#0C0A14']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + `<linearGradient id="${u}d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E8F4FF"/><stop offset=".35" stop-color="#F7B6CC"/><stop offset=".6" stop-color="#BFE8C8"/><stop offset="1" stop-color="#9FB8E8"/></linearGradient>`
        + linear(`${u}b`, [[0, '#FFF3C8']]).replace('</linearGradient>', '<stop offset="1" stop-color="#FFF3C8" stop-opacity="0"/></linearGradient>')
        + '</defs>' + backdrop(`url(#${u}s)`);
    const d = (cx, cy, r) => disc(cx, cy, r).replace('#__d', `#${u}d`);
    if (level === 1) return s + `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>` + d(60, 54, 15);
    if (level === 2) {
        s += `<circle cx="60" cy="56" r="26" fill="url(#${u}g)"/>`;
        s += [76, 72, 68].map((y, i) => `<ellipse cx="60" cy="${y}" rx="20" ry="5" fill="${['#9FB8E8', '#BFE8C8', '#F7B6CC'][i]}" stroke="#8E8E96" stroke-width=".5"/>`).join('');
        return s + d(60, 46, 15);
    }
    if (level === 3) {
        s += `<circle cx="56" cy="52" r="28" fill="url(#${u}g)"/>` + '<path d="M70 54 L98 40 V70Z" fill="url(#' + u + 'b)" opacity=".5"/>';
        s += reel(46, 36, 9) + reel(64, 36, 9);
        return s + '<rect x="36" y="46" width="34" height="18" rx="2" fill="#2A2A30"/><path d="M70 50 h5 v10 h-5Z" fill="#5A5E70"/><path d="M42 64 L38 80 M64 64 L68 80" stroke="#2A2A30" stroke-width="2" stroke-linecap="round"/><circle cx="42" cy="55" r="1.6" fill="#E5484D"/>';
    }
    s += '<rect x="58" y="26" width="34" height="24" fill="#E8E2D4"/><rect x="58" y="26" width="34" height="24" fill="url(#' + u + 'g)"/><circle cx="76" cy="36" r="4" fill="#4AA3D9" opacity=".7"/>';
    s += '<path d="M40 48 L58 28 V50Z" fill="url(#' + u + 'b)" opacity=".55"/>';
    s += reel(28, 36, 6) + reel(40, 36, 6) + '<rect x="22" y="42" width="22" height="12" rx="2" fill="#2A2A30"/><path d="M44 45 h3 v6 h-3Z" fill="#5A5E70"/>';
    s += '<path d="M10 64 H110 V120 H10Z" fill="#140E14"/>';
    return s + [30, 42, 54, 66, 78, 90].map((x, i) => `<circle cx="${x}" cy="${68 - (i % 2) * 2}" r="4.4" fill="#3A2A3A"/><path d="M${x - 6} 80 Q${x} ${64 - (i % 2) * 2} ${x + 6} 80Z" fill="#3A2A3A"/>`).join('');
}

/* ── Showcase: one pinned poster → a corkboard of posters → a lit glass display case ── */

function pushpin(x, y, c = '#E5484D') {
    return `<circle cx="${x}" cy="${y}" r="2.2" fill="${c}"/><circle cx="${x - 0.7}" cy="${y - 0.7}" r=".7" fill="#fff" opacity=".6"/>`;
}

function showcase(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, '#3A3040'], [1, '#100C14']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) {
        s += '<rect x="30" y="30" width="60" height="50" rx="2" fill="#C8955C"/><g fill="#A8743F" opacity=".5">' + Array.from({ length: 16 }, (_, i) => `<circle cx="${34 + (i * 13) % 54}" cy="${34 + (i * 7) % 42}" r=".8"/>`).join('') + '</g>';
        return s + `<g transform="rotate(-4 60 56)">${poster(48, 38, 24, 34, '#B8432F')}</g>` + pushpin(60, 39);
    }
    if (level === 2) {
        s += '<rect x="26" y="28" width="68" height="54" rx="2" fill="#C8955C"/><rect x="26" y="28" width="68" height="54" rx="2" fill="none" stroke="#6A4122" stroke-width="2"/>';
        s += `<g transform="rotate(-6 40 52)">${poster(31, 36, 18, 26, '#2F6E8E')}</g><g transform="rotate(5 80 52)">${poster(71, 38, 18, 26, '#5B8A4A')}</g>${poster(50, 34, 20, 30, '#B8432F')}`;
        s += '<path d="M40 37 Q60 46 80 39" stroke="#E5484D" stroke-width=".7" fill="none"/>';
        return s + pushpin(40, 37) + pushpin(60, 35, '#F2C14E') + pushpin(80, 39, '#4AA3D9');
    }
    s += `<circle cx="60" cy="50" r="32" fill="url(#${u}g)"/>`;
    s += '<rect x="28" y="26" width="64" height="56" rx="2" fill="#2A1E1A"/><rect x="30" y="28" width="60" height="52" fill="#4A2A3A"/>';
    s += poster(34, 34, 15, 22, '#2F6E8E') + poster(52, 32, 16, 24, '#B8432F') + poster(71, 34, 15, 22, '#5B8A4A');
    s += '<rect x="30" y="62" width="60" height="3" fill="#7A4E2A"/>' + reel(44, 72, 5, '#D9A441') + cassette(54, 67, 14, false) + reel(80, 72, 5, '#D9A441');
    s += '<path d="M30 28 L50 28 L36 80 H30Z" fill="#fff" opacity=".08"/><rect x="28" y="26" width="64" height="56" rx="2" fill="none" stroke="#D9A441" stroke-width="2"/>';
    return s + pushpin(41, 34, '#F2C14E') + pushpin(60, 32, '#F2C14E') + pushpin(78, 34, '#F2C14E') + '<path d="M52 22 h16 l-2 4 h-12Z" fill="#FFF3C8" opacity=".8"/>';
}

/* ── Tenure: a tear-off page → a month of ticks → a wall calendar and clock → a stack of years → an anniversary cake ── */

function calendarPage(x, y, w, h, head, body) {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.6" fill="#FBF5E6"/><rect x="${x}" y="${y}" width="${w}" height="${f(h * 0.24)}" rx="1.6" fill="${head}"/>`;
    s += `<g fill="#8E8E96"><circle cx="${f(x + w * 0.28)}" cy="${y}" r="1.4"/><circle cx="${f(x + w * 0.72)}" cy="${y}" r="1.4"/></g>`;
    return s + body;
}

function dayGrid(x, y, cols, rows, step, ticks) {
    let s = '';
    for (let i = 0; i < cols * rows; i++) {
        const cx = x + (i % cols) * step, cy = y + Math.floor(i / cols) * step;
        s += i < ticks ? `<path d="M${f(cx - 1.2)} ${f(cy)} l1 1.2 2 -2.4" stroke="#5BAA5E" stroke-width=".9" fill="none" stroke-linecap="round"/>` : `<rect x="${f(cx - 1)}" y="${f(cy - 1)}" width="2" height="2" fill="#D6CCB8"/>`;
    }
    return s;
}

function candle2(x, base, h, c) {
    return `<rect x="${x - 1.4}" y="${base - h}" width="2.8" height="${h}" rx=".6" fill="${c}"/>` + flameShape(x, base - h - 0.6, 5, 1.8, '#F7913A') + flameShape(x, base - h - 0.6, 3, 1.1, '#FFF3C4');
}

function tenure(level, u) {
    let s = '<defs>'
        + radial(`${u}s`, [[0, level >= 5 ? '#4A2A5A' : '#2E3448'], [1, '#0C0C18']], 'cx="50%" cy="40%" r="85%"')
        + radial(`${u}g`, [[0, '#FFE6A0', 0.5], [1, '#FFE6A0', 0]])
        + '</defs>' + backdrop(`url(#${u}s)`);
    if (level === 1) {
        s += `<circle cx="60" cy="54" r="22" fill="url(#${u}g)"/>`;
        return s + calendarPage(46, 38, 28, 32, '#E5484D', `<path d="M58 54 l3 -2 v12" stroke="#2A2A30" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    if (level === 2) return s + `<circle cx="60" cy="54" r="26" fill="url(#${u}g)"/>` + calendarPage(38, 34, 44, 40, '#2F6E8E', dayGrid(43, 48, 7, 4, 5.6, 20));
    if (level === 3) {
        s += calendarPage(30, 36, 40, 40, '#5B8A4A', dayGrid(35, 50, 6, 4, 6, 24));
        return s + clockFace(80, 46, 9, '#D9A441') + '<path d="M80 55 V66" stroke="#D9A441" stroke-width=".8"/><circle cx="80" cy="67" r="2.4" fill="#D9A441"/>';
    }
    if (level === 4) {
        s += `<circle cx="60" cy="54" r="30" fill="url(#${u}g)"/>`;
        return s + calendarPage(32, 46, 32, 30, '#2F6E8E', dayGrid(36, 58, 5, 3, 6, 15)) + calendarPage(56, 44, 32, 30, '#5B8A4A', dayGrid(60, 56, 5, 3, 6, 15))
            + calendarPage(44, 30, 32, 32, '#E5484D', dayGrid(48, 43, 5, 3, 6, 15)) + star5(84, 32, 3.4, '#F2C14E');
    }
    s += `<circle cx="60" cy="50" r="34" fill="url(#${u}g)"/>`;
    s += '<ellipse cx="60" cy="82" rx="30" ry="4" fill="#E8E2D4"/>';
    s += '<rect x="36" y="62" width="48" height="18" rx="3" fill="#F7B6CC"/><path d="M36 66 q6 5 12 0 t12 0 t12 0 t12 0" fill="#FBF5E6"/><rect x="42" y="50" width="36" height="14" rx="3" fill="#E5728A"/><path d="M42 53 q4.5 4 9 0 t9 0 t9 0 t9 0" fill="#FBF5E6"/>';
    s += [48, 55, 62, 69, 76].map((x, i) => candle2(x, 50, 8, ['#4AA3D9', '#F2C14E', '#5BAA5E', '#E5484D', '#7A4A8C'][i])).join('');
    return s + [[28, 30, '#F2C14E'], [92, 28, '#4AA3D9'], [26, 56, '#E5484D'], [94, 54, '#5BAA5E']].map(([x, y, c]) => star5(x, y, 3, c)).join('');
}

/* ── One-off scenes: First step (a flag on a sunrise summit), Full spectrum (a rainbow of ten bars), Halloween (a glowing jack-o'-lantern) ── */

function firstStep(level, u) {
    let s = '<defs>' + linear(`${u}s`, [[0, '#3A3A8A'], [0.55, '#E5728A'], [1, '#FFC27A']]) + radial(`${u}g`, [[0, '#FFE6A0', 0.7], [1, '#FFE6A0', 0]]) + '</defs>' + backdrop(`url(#${u}s)`);
    s += `<circle cx="60" cy="64" r="30" fill="url(#${u}g)"/><circle cx="60" cy="66" r="11" fill="#FFE6A0"/>`;
    s += '<path d="M10 92 L40 58 L52 66 L66 44 L110 92Z" fill="#4A3A6A"/><path d="M58 54 L66 44 L72 52 L68 54 L64 50Z" fill="#F7F2FF"/>';
    s += '<path d="M10 92 Q40 78 60 84 T110 82 V120 H10Z" fill="#2A1E44"/>';
    s += '<g fill="#F7F2FF" opacity=".7">' + [[30, 88], [38, 84], [46, 82], [52, 76], [58, 70], [62, 62], [64, 54]].map(([x, y], i) => `<ellipse cx="${x + (i % 2 ? 1.6 : -1.6)}" cy="${y}" rx="1.1" ry="1.6"/>`).join('') + '</g>';
    s += '<path d="M66 44 V24" stroke="#8A5A30" stroke-width="1.6"/><path d="M66 25 Q74 22 80 27 Q74 30 66 33Z" fill="#E5484D"/>';
    return s + star5(73, 28, 2, '#FFE79A');
}

function fullSpectrum(level, u) {
    let s = '<defs>' + radial(`${u}s`, [[0, '#2A2448'], [1, '#0A0818']], 'cx="50%" cy="45%" r="85%"') + radial(`${u}g`, [[0, '#FFFFFF', 0.25], [1, '#FFFFFF', 0]]) + '</defs>' + backdrop(`url(#${u}s)`);
    s += `<circle cx="60" cy="54" r="32" fill="url(#${u}g)"/>`;
    const colors = ['#7A2E8C', '#5A4AC8', '#3A78D8', '#2FA8C8', '#3AB88A', '#7CC84A', '#E8C83A', '#F7913A', '#E8603A', '#E5484D'];
    s += '<path d="M32 72 H90" stroke="#8E8E96" stroke-width="1"/>';
    colors.forEach((c, i) => {
        const h = 6 + i * 3.6, x = 33 + i * 5.6;
        s += `<rect x="${f(x)}" y="${f(72 - h)}" width="4.6" height="${f(h)}" rx="1" fill="${c}"/><rect x="${f(x)}" y="${f(72 - h)}" width="1.4" height="${f(h)}" fill="#fff" opacity=".25"/>`;
    });
    return s + '<path d="M34 64 Q60 28 88 32" stroke="#FFF6D0" stroke-width="1" stroke-dasharray="2 2" fill="none"/>' + star5(88, 30, 4, '#FFE79A');
}

function halloween(level, u) {
    let s = '<defs>' + radial(`${u}s`, [[0, '#3A2050'], [1, '#0A0612']], 'cx="60%" cy="25%" r="85%"')
        + radial(`${u}g`, [[0, '#FF9A2A', 0.55], [1, '#FF9A2A', 0]])
        + linear(`${u}p`, [[0, '#FFA23F'], [1, '#D0581A']]) + linear(`${u}p2`, [[0, '#F58A2A'], [1, '#B8460E']])
        + radial(`${u}fire`, [[0, '#FFF6B0'], [0.6, '#FFC23D'], [1, '#FF8A1E']])
        + '</defs>' + backdrop(`url(#${u}s)`);
    s += '<circle cx="82" cy="30" r="9" fill="#F5E6B0"/><circle cx="82" cy="30" r="15" fill="#F5E6B0" opacity=".12"/>';
    s += bat(36, 32, 0.9) + bat(50, 24, 0.6) + bat(92, 48, 0.55);
    s += '<path d="M10 84 Q60 78 110 84 V120 H10Z" fill="#140A18"/>';
    s += `<circle cx="60" cy="64" r="32" fill="url(#${u}g)"/>`;
    s += '<path d="M60 47 Q58 40 63 36" stroke="#4A6A2A" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M62 42 q10 -6 14 2 q-8 4 -14 -2Z" fill="#5B8A3A"/><path d="M64 44 q6 4 4 10" stroke="#5B8A3A" stroke-width=".8" fill="none"/>';
    s += `<ellipse cx="44" cy="66" rx="13" ry="16" fill="url(#${u}p2)"/><ellipse cx="76" cy="66" rx="13" ry="16" fill="url(#${u}p2)"/>`;
    s += `<ellipse cx="52" cy="66" rx="12" ry="18" fill="url(#${u}p)"/><ellipse cx="68" cy="66" rx="12" ry="18" fill="url(#${u}p)"/><ellipse cx="60" cy="66" rx="10" ry="18.6" fill="url(#${u}p)"/>`;
    s += '<g stroke="#A8400C" stroke-width=".7" fill="none" opacity=".7"><path d="M50 49 Q46 66 50 83"/><path d="M70 49 Q74 66 70 83"/><path d="M57 48 Q55 66 57 84"/><path d="M63 48 Q65 66 63 84"/></g>';
    const carve = (d) => `<path d="${d}" fill="#7A2A06" transform="translate(0 .8)"/><path d="${d}" fill="url(#${u}fire)"/>`;
    s += carve('M44 61 L52 61 L48 54Z') + carve('M68 61 L76 61 L72 54Z') + carve('M58 66 L62 66 L60 62.4Z');
    s += carve('M43 70 Q60 82 77 70 Q74 76 70 77 L69 73.6 L66 76.6 L63 74 L60 77.6 L57 74 L54 76.6 L51 73.6 L50 77 Q46 76 43 70Z');
    return s + candle2(30, 86, 6, '#F1E9D8') + candle2(90, 86, 5, '#F1E9D8');
}

function cartoonSun(cx, cy, r) {
    let s = '';
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        s += `<path d="M${f(cx + r * 1.25 * Math.cos(a))} ${f(cy + r * 1.25 * Math.sin(a))} L${f(cx + r * 1.65 * Math.cos(a))} ${f(cy + r * 1.65 * Math.sin(a))}" stroke="#F7913A" stroke-width="1.6" stroke-linecap="round"/>`;
    }
    return s + smiley(cx, cy, r, '#F2C14E');
}

function faceCloud(x, y, k) {
    return cartoonCloud(x, y, k) + `<circle cx="${f(x - 1 * k)}" cy="${f(y - 1 * k)}" r="${f(0.7 * k)}" fill="#3A3A5A"/><circle cx="${f(x + 4 * k)}" cy="${f(y - 1 * k)}" r="${f(0.7 * k)}" fill="#3A3A5A"/>`
        + `<path d="M${f(x)} ${f(y + 1 * k)} q${f(1.5 * k)} ${f(1.4 * k)} ${f(3 * k)} 0" stroke="#3A3A5A" stroke-width="${f(0.6 * k)}" fill="none" stroke-linecap="round"/>`;
}

function person(x, base, h, fill, pose = 'stand') {
    const lw = f(h * 0.075), hy = base - h * 0.89, sh = base - h * 0.74, hip = base - h * 0.42;
    let s = `<g stroke="${fill}" stroke-width="${lw}" stroke-linecap="round" fill="none">`;
    s += `<path d="M${f(x - h * 0.05)} ${f(hip)} L${f(x - h * 0.12)} ${f(base)}"/><path d="M${f(x + h * 0.05)} ${f(hip)} L${f(x + h * 0.1)} ${f(base)}"/>`;
    s += pose === 'raise'
        ? `<path d="M${f(x + h * 0.1)} ${f(sh)} L${f(x + h * 0.2)} ${f(sh - h * 0.16)} L${f(x + h * 0.22)} ${f(sh - h * 0.3)}"/><path d="M${f(x - h * 0.1)} ${f(sh)} L${f(x - h * 0.24)} ${f(sh + h * 0.12)} L${f(x - h * 0.32)} ${f(sh + h * 0.06)}"/>`
        : `<path d="M${f(x + h * 0.1)} ${f(sh)} L${f(x + h * 0.14)} ${f(hip)}"/><path d="M${f(x - h * 0.1)} ${f(sh)} L${f(x - h * 0.14)} ${f(hip)}"/>`;
    s += '</g>';
    s += `<path d="M${f(x - h * 0.12)} ${f(sh)} L${f(x + h * 0.12)} ${f(sh)} L${f(x + h * 0.08)} ${f(hip)} L${f(x - h * 0.08)} ${f(hip)}Z" fill="${fill}"/>`;
    return s + `<rect x="${f(x - h * 0.03)}" y="${f(hy + h * 0.08)}" width="${f(h * 0.06)}" height="${f(h * 0.08)}" fill="${fill}"/><circle cx="${x}" cy="${f(hy)}" r="${f(h * 0.1)}" fill="${fill}"/>`;
}

function flash(x, y, r) {
    return `<path d="M${x} ${y - r} L${f(x + r * 0.22)} ${f(y - r * 0.22)} L${x + r} ${y} L${f(x + r * 0.22)} ${f(y + r * 0.22)} L${x} ${y + r} L${f(x - r * 0.22)} ${f(y + r * 0.22)} L${x - r} ${y} L${f(x - r * 0.22)} ${f(y - r * 0.22)}Z" fill="#FFFDF0"/><circle cx="${x}" cy="${y}" r="${f(r * 0.9)}" fill="#FFFDF0" opacity=".25"/>`;
}

function lightStand(x, base, aim) {
    return `<g stroke="#2A2A30" stroke-width="1.4" stroke-linecap="round"><path d="M${x} ${base - 26} V${base - 4} M${x} ${base - 4} L${x - 6} ${base} M${x} ${base - 4} L${x + 6} ${base}"/></g>`
        + `<g transform="rotate(${aim} ${x} ${base - 28})"><path d="M${x - 5} ${base - 33} H${x + 5} L${x + 7} ${base - 23} H${x - 7}Z" fill="#3A3A44"/><rect x="${x - 6}" y="${base - 24}" width="12" height="2" fill="#FFF3C8"/></g>`;
}

function wheelLights(cx, cy, r, n) {
    let s = `<circle cx="${cx}" cy="${cy}" r="${f(r + 4)}" fill="#2A1A30" stroke="#D9A441" stroke-width="1.2"/>`;
    for (let i = 0; i < n; i++) {
        const a = i * Math.PI * 2 / n;
        s += `<circle cx="${f(cx + (r + 2) * Math.cos(a))}" cy="${f(cy + (r + 2) * Math.sin(a))}" r="1.1" fill="${i % 2 ? '#FFE79A' : '#FFF6D0'}"/>`;
    }
    return s;
}

function bat(x, y, k) {
    return `<g transform="translate(${x} ${y}) scale(${k})" fill="#14081C"><path d="M0 0 C-3 -4 -8 -4 -12 -1 Q-10 0 -9 2.4 Q-7 0.6 -5 2.4 Q-3 0.6 0 2.4 Q3 0.6 5 2.4 Q7 0.6 9 2.4 Q10 0 12 -1 C8 -4 3 -4 0 0Z"/>`
        + '<ellipse cx="0" cy="0.6" rx="1.6" ry="2.4"/><path d="M-1.2 -1.2 l-.4 -1.8 1 1Z M1.2 -1.2 l.4 -1.8 -1 1Z"/></g>';
}

const SCENES = {
    trophy: provider, pin: showcase, calendar: tenure, flag: firstStep, chart: fullSpectrum, pumpkin: halloween,
    heart: voice, thumbsUp: generous, wheel: marathoner,
    layers: filler, pen: reviewer, book: writer,
    camera: directors, playCircle: inProgress, folder: curator,
    moon: nightOwl, flame: streak, bookmark: collector, globe: traveler, clock: hours, clapper: rater,
    tv: series, hourglass: timeMachine, ten: perfect, thumbsDown: merciless, landmark: classics, sparkles: anime,
    smile: cartoons, shapes: genres, users: actors
};

/** Scene markup for an icon at a tier level, or '' when the icon has no scene. */
export function renderScene(icon, level, uid) {
    const scene = SCENES[icon];
    return scene ? scene(level, uid) : '';
}

export const SCENE_ICONS = Object.keys(SCENES);
