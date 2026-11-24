'use strict';

/**
 * Geometry of the icon set: an outline plus the exact right half of its area.
 * The result is plain paths in currentColor, without masks, clips or ids, so one
 * icon can stand on a page any number of times and in either theme.
 *
 * A cubic is [p0, p1, p2, p3]; `straight` marks a line so it prints as L.
 */

const num = value => String(+value.toFixed(2));
const point = p => `${num(p[0])} ${num(p[1])}`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const line = (a, b) => Object.assign([a, mix(a, b, 1 / 3), mix(a, b, 2 / 3), b], { straight: true });

function at(c, t) {
    const u = 1 - t;
    return [0, 1].map(i => u ** 3 * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t ** 3 * c[3][i]);
}

function splitAt(c, t) {
    const p = mix(c[0], c[1], t);
    const q = mix(c[1], c[2], t);
    const r = mix(c[2], c[3], t);
    const s = mix(p, q, t);
    const u = mix(q, r, t);
    const v = mix(s, u, t);
    return [[c[0], p, s, v], [v, u, r, c[3]]].map(piece => Object.assign(piece, { straight: c.straight }));
}

function part(c, from, to) {
    const tail = splitAt(c, from)[1];
    return splitAt(tail, (to - from) / (1 - from))[0];
}

const flip = c => Object.assign([...c].reverse(), { straight: c.straight });

/** SVG elliptical arc as cubics (endpoint to centre parameterization). */
function arc(p, rx, ry, phi, large, sweep, q) {
    if (!rx || !ry) return [line(p, q)];
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (p[0] - q[0]) / 2;
    const dy = (p[1] - q[1]) / 2;
    const x = cos * dx + sin * dy;
    const y = -sin * dx + cos * dy;
    const scale = Math.sqrt(x * x / rx / rx + y * y / ry / ry);
    if (scale > 1) {
        rx *= scale;
        ry *= scale;
    }
    const root = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) / (rx * rx * y * y + ry * ry * x * x)));
    const k = root * (large === sweep ? -1 : 1);
    const cx = k * rx * y / ry;
    const cy = -k * ry * x / rx;
    const ox = cos * cx - sin * cy + (p[0] + q[0]) / 2;
    const oy = sin * cx + cos * cy + (p[1] + q[1]) / 2;
    const start = Math.atan2((y - cy) / ry, (x - cx) / rx);
    let delta = Math.atan2((-y - cy) / ry, (-x - cx) / rx) - start;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    const count = Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-6);
    const step = delta / count;
    const handle = 4 / 3 * Math.tan(step / 4);
    const on = (u, v) => [ox + cos * rx * u - sin * ry * v, oy + sin * rx * u + cos * ry * v];
    return Array.from({ length: count }, (_, i) => {
        const a = start + i * step;
        const b = a + step;
        return [
            on(Math.cos(a), Math.sin(a)),
            on(Math.cos(a) - handle * Math.sin(a), Math.sin(a) + handle * Math.cos(a)),
            on(Math.cos(b) + handle * Math.sin(b), Math.sin(b) - handle * Math.cos(b)),
            on(Math.cos(b), Math.sin(b))
        ];
    });
}

/** Absolute path data (M L H V C Q A Z) as cubics. */
function parse(d) {
    const out = [];
    let p = [0, 0];
    let start = p;
    const go = q => {
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) out.push(line(p, q));
        p = q;
    };
    for (const [, command, rest] of d.matchAll(/([MLHVCQAZ])([^MLHVCQAZ]*)/g)) {
        const v = (rest.match(/-?\d*\.?\d+/g) || []).map(Number);
        if (command === 'M') p = start = [v[0], v[1]];
        else if (command === 'L') for (let i = 0; i < v.length; i += 2) go([v[i], v[i + 1]]);
        else if (command === 'H') go([v[0], p[1]]);
        else if (command === 'V') go([p[0], v[0]]);
        else if (command === 'C') {
            out.push([p, [v[0], v[1]], [v[2], v[3]], [v[4], v[5]]]);
            p = [v[4], v[5]];
        } else if (command === 'Q') {
            const q = [v[0], v[1]];
            const r = [v[2], v[3]];
            out.push([p, mix(p, q, 2 / 3), mix(r, q, 2 / 3), r]);
            p = r;
        } else if (command === 'A') {
            const q = [v[5], v[6]];
            out.push(...arc(p, v[0], v[1], v[2] * Math.PI / 180, v[3], v[4], q));
            p = q;
        } else if (command === 'Z') go(start);
    }
    return out;
}

function crossings(curve, shape) {
    const hits = [];
    const M = 160;
    const K = 80;
    curve.forEach((w, wi) => {
        const wp = Array.from({ length: M + 1 }, (_, i) => at(w, i / M));
        shape.forEach((g, gi) => {
            const steps = g.straight ? 1 : K;
            const gp = Array.from({ length: steps + 1 }, (_, i) => at(g, i / steps));
            for (let i = 0; i < M; i++) {
                for (let j = 0; j < steps; j++) {
                    const a = wp[i];
                    const c = gp[j];
                    const rx = wp[i + 1][0] - a[0];
                    const ry = wp[i + 1][1] - a[1];
                    const sx = gp[j + 1][0] - c[0];
                    const sy = gp[j + 1][1] - c[1];
                    const den = rx * sy - ry * sx;
                    if (Math.abs(den) < 1e-12) continue;
                    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
                    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
                    if (t >= 0 && t < 1 && u >= 0 && u < 1) hits.push({ w: wi, t: (i + t) / M, g: gi, u: (j + u) / steps });
                }
            }
        });
    });
    return hits.sort((a, b) => a.w + a.t - b.w - b.t);
}

function along(curve, from, to) {
    const out = [];
    for (let i = from.w; i <= to.w; i++) {
        const a = i === from.w ? from.t : 0;
        const b = i === to.w ? to.t : 1;
        if (b - a > 1e-6) out.push(part(curve[i], a, b));
    }
    return out;
}

function around(shape, from, to) {
    if (from.g === to.g && to.u > from.u) return [part(shape[from.g], from.u, to.u)];
    const out = [];
    if (from.u < 1 - 1e-6) out.push(part(shape[from.g], from.u, 1));
    for (let i = (from.g + 1) % shape.length; i !== to.g; i = (i + 1) % shape.length) out.push(shape[i]);
    if (to.u > 1e-6) out.push(part(shape[to.g], 0, to.u));
    return out;
}

function area(curves) {
    const pts = curves.flatMap(c => Array.from({ length: 12 }, (_, i) => at(c, i / 12)));
    return pts.reduce((sum, p, i) => {
        const q = pts[(i + 1) % pts.length];
        return sum + p[0] * q[1] - p[1] * q[0];
    }, 0);
}

function print(curves) {
    const step = c => (c.straight ? `L${point(c[3])}` : `C${point(c[1])} ${point(c[2])} ${point(c[3])}`);
    return `M${point(curves[0][0])}${curves.map(step).join('')}Z`;
}

/** Path data for the part of the closed outline `d` to the right of x. */
function rightHalf(d, x) {
    // A hair off x: a vertex exactly on the cut would count as no crossing.
    const cut = [line([x + 0.004, -100], [x + 0.004, 200])];
    const shape = parse(d);
    const hits = crossings(cut, shape);
    if (hits.length < 2) throw new Error(`x = ${x} does not cross the outline: ${d.slice(0, 40)}`);
    const a = hits[0];
    const b = hits[hits.length - 1];
    const edge = along(cut, a, b);
    const reversed = shape.map(flip).reverse();
    const mirror = hit => ({ ...hit, g: shape.length - 1 - hit.g, u: 1 - hit.u });
    const right = [...edge, ...around(shape, b, a)];
    const left = [...edge, ...around(reversed, mirror(b), mirror(a))];
    // Going down the cut, its right side closes counter-clockwise on screen.
    return print(area(right) < 0 ? right : left);
}

// The unused paint is spelled out: page styles may set fill or stroke on the whole svg.
const fill = d => `<path fill="currentColor" stroke="none" fill-rule="evenodd" d="${d}"/>`;
const stroke = (d, width = 2) => `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${width}" d="${d}"/>`;
const dot = (x, y, r) => `M${num(x)} ${num(y - r)}A${r} ${r} 0 1 0 ${num(x)} ${num(y + r)}A${r} ${r} 0 1 0 ${num(x)} ${num(y - r)}Z`;

function box(x, y, w, h, r) {
    const right = x + w;
    const bottom = y + h;
    return `M${num(x + r)} ${num(y)}H${num(right - r)}A${r} ${r} 0 0 1 ${num(right)} ${num(y + r)}V${num(bottom - r)}`
        + `A${r} ${r} 0 0 1 ${num(right - r)} ${num(bottom)}H${num(x + r)}A${r} ${r} 0 0 1 ${num(x)} ${num(bottom - r)}`
        + `V${num(y + r)}A${r} ${r} 0 0 1 ${num(x + r)} ${num(y)}Z`;
}

/** Whole outline with its right half solid; `cut` is detail punched out of that half. */
const half = (d, x, cut = '') => stroke(d) + fill(rightHalf(d, x) + cut);

/** The whole shape solid: the active state of an outlined icon. */
const solid = d => stroke(d) + fill(d);

module.exports = { num, point, fill, stroke, dot, box, half, rightHalf, solid };
