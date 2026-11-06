/**
 * New Year season: Santa's flight.
 * Reindeer run on a keyframed gait, Santa's hat, beard and sack have their own
 * secondary motion, and the whole team follows one path through the sky, so it
 * bends like a ribbon instead of sliding as a single picture. Art colors are part
 * of the illustration, like the season's pictures, and do not follow the theme.
 */
(function (g) {
    'use strict';

    const TAU = Math.PI * 2, RAD = Math.PI / 180;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;

    /* ---------- Drawing helpers ---------- */

    /* A smooth curve through points. A third value on a point keeps that corner sharp. */
    function spline(path, pts, closed) {
        const n = pts.length;
        const at = i => (closed ? pts[(i + n) % n] : pts[i < 0 ? 0 : i >= n ? n - 1 : i]);
        path.moveTo(pts[0][0], pts[0][1]);
        const last = closed ? n : n - 1;
        for (let i = 0; i < last; i++) {
            const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
            const c1x = p1[2] ? p1[0] : p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[2] ? p1[1] : p1[1] + (p2[1] - p0[1]) / 6;
            const c2x = p2[2] ? p2[0] : p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[2] ? p2[1] : p2[1] - (p3[1] - p1[1]) / 6;
            path.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
        }
        if (closed) path.closePath();
        return path;
    }

    const blob = pts => spline(new Path2D(), pts, true);

    /* A ribbon around a centre line, with a width at every point. */
    function taper(pts, widths) {
        const n = pts.length, left = [], right = [];
        for (let i = 0; i < n; i++) {
            const a = pts[i > 0 ? i - 1 : 0], b = pts[i < n - 1 ? i + 1 : n - 1];
            let dx = b[0] - a[0], dy = b[1] - a[1];
            const l = Math.hypot(dx, dy) || 1;
            dx /= l; dy /= l;
            const w = (widths.length === n ? widths[i] : lerp(widths[0], widths[1], i / (n - 1))) / 2;
            left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
            right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
        }
        return blob(left.concat(right.reverse()));
    }

    /* Flat colour with a band of shadow low on the right and a thin rim of light up on the left. */
    function cel(x, path, fill, shade, rim, w) {
        x.fillStyle = fill;
        x.fill(path);
        if (!shade && !rim) return;
        x.save();
        x.clip(path);
        if (shade) {
            x.translate(-w * 0.34, -w * 0.5);
            x.strokeStyle = shade;
            x.lineWidth = w * 1.5;
            x.stroke(path);
            x.translate(w * 0.34, w * 0.5);
        }
        if (rim) {
            x.translate(w * 0.16, w * 0.24);
            x.strokeStyle = rim;
            x.lineWidth = w * 0.42;
            x.stroke(path);
        }
        x.restore();
    }

    function circle(x, cx, cy, r, fill) {
        x.fillStyle = fill;
        x.beginPath();
        x.arc(cx, cy, r, 0, TAU);
        x.fill();
    }

    /* ---------- Colours ---------- */

    const GOLD = '#f2c063', GOLD_HI = '#ffe9b0', GOLD_LO = '#a8701c';
    const RED = '#d6232d', RED_SHADE = 'rgba(76,0,12,0.6)', RED_RIM = 'rgba(255,176,150,0.75)';
    const FUR = '#fbf7ef', FUR_SHADE = 'rgba(110,132,186,0.55)';

    const DEER_NEAR = {
        coat: '#bd7f47', shade: 'rgba(66,28,10,0.55)', rim: 'rgba(255,232,186,0.85)', belly: '#ecd2a6',
        legs: '#a96d3a', far: '#7b4e2b', hoof: '#21110a', white: '#fbf6ea', whiteShade: 'rgba(120,120,150,0.5)',
        antler: '#f4e4c0', antlerShade: 'rgba(120,88,44,0.7)', harness: '#c41f2c', ink: '#22120a'
    };
    const DEER_FAR = {
        coat: '#8d5c34', shade: 'rgba(36,16,10,0.6)', rim: 'rgba(170,196,240,0.42)', belly: '#b0946a',
        legs: '#7a4e2c', far: '#5a3a20', hoof: '#160b06', white: '#c9c8c8', whiteShade: 'rgba(60,60,90,0.5)',
        antler: '#b8a784', antlerShade: 'rgba(60,44,24,0.7)', harness: '#8f1722', ink: '#150b06'
    };

    /* ---------- A gait in four poses, interpolated around the cycle ---------- */

    const POSES = {
        /* Angles in degrees from straight down; positive reaches forward. */
        fore: [[66, 74, 82], [24, 14, 28], [-30, -42, -26], [42, -48, -92]],
        hind: [[-42, -66, -52, -44], [14, -60, -10, 8], [62, 22, 52, 66], [8, -24, 0, 10]],
        pitch: [-7, -2, 6, 1],
        bob: [-5.5, -1, 5, 1.5],
        neck: [6, 2, -6, 0]
    };

    function cyc(list, p) {
        const n = list.length, f = ((p % 1) + 1) % 1 * n, i = Math.floor(f), u = f - i;
        const a = list[(i + n - 1) % n], b = list[i % n], c = list[(i + 1) % n], d = list[(i + 2) % n];
        return 0.5 * ((2 * b) + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
    }

    function cycAll(list, p) {
        const out = [];
        for (let j = 0; j < list[0].length; j++) out.push(cyc(list.map(k => k[j]), p));
        return out;
    }

    const FORE_LEN = [25, 25, 11], FORE_W = [15, 7.4, 4.4, 3.8];
    const HIND_LEN = [27, 25, 19, 9], HIND_W = [25, 11.5, 5.8, 4.2, 3.8];

    function limb(x, jx, jy, angles, lens, widths, fill, shade, rim, hoof) {
        const centre = [[jx, jy]], ws = [widths[0]];
        let px = jx, py = jy, a = 0;
        for (let i = 0; i < angles.length; i++) {
            a = angles[i] * RAD;
            const nx = px + Math.sin(a) * lens[i], ny = py + Math.cos(a) * lens[i];
            centre.push([(px + nx) / 2, (py + ny) / 2]);
            ws.push((widths[i] + widths[i + 1]) / 2 - 0.4);
            centre.push([nx, ny]);
            ws.push(widths[i + 1]);
            px = nx; py = ny;
        }
        const legPath = taper(centre, ws);
        if (rim) {
            const gr = x.createLinearGradient(jx, jy - 6, jx, jy + lens[0] * 0.92);
            gr.addColorStop(0, rim);
            gr.addColorStop(1, fill);
            x.fillStyle = gr;
            x.fill(legPath);
            x.save();
            x.clip(legPath);
            x.translate(-1.1, -1.5);
            x.strokeStyle = shade;
            x.lineWidth = 3;
            x.beginPath();
            for (let i = 2; i < centre.length; i++) {
                const q = centre[i];
                if (i === 2) x.moveTo(q[0] + ws[i] / 2, q[1]);
                else x.lineTo(q[0] + ws[i] / 2, q[1]);
            }
            x.stroke();
            x.restore();
        } else {
            cel(x, legPath, fill, shade, null, 2.4);
        }
        x.save();
        x.translate(px, py);
        x.rotate(-a);
        x.fillStyle = hoof;
        x.beginPath();
        x.moveTo(-2.2, -0.5);
        x.lineTo(2.2, -0.5);
        x.quadraticCurveTo(4.4, 3, 3.8, 6);
        x.lineTo(-3, 6);
        x.quadraticCurveTo(-3.2, 2.6, -2.2, -0.5);
        x.fill();
        x.restore();
        return [px + Math.sin(a) * 6, py + Math.cos(a) * 6];
    }

    function antler(x, C, w) {
        const fill = C.antler;
        const prong = (pts, a, b) => {
            cel(x, taper(pts, [a, b]), fill, C.antlerShade, null, 1.2 * w);
        };
        prong([[0, -3], [10, -7], [16, -16]], 3.2 * w, 0.8);
        prong([[-11, -16], [-3, -23], [3, -34]], 2.9 * w, 0.7);
        prong([[-13, -30], [-5, -39], [1, -51]], 2.6 * w, 0.7);
        prong([[-13, -34], [-23, -39], [-28, -49]], 2.4 * w, 0.7);
        cel(x, taper([[-1, -1], [-9, -13], [-14, -27], [-11, -42], [-3, -55]], [5 * w, 1.4]), fill, C.antlerShade, 'rgba(255,255,255,0.6)', 1.6 * w);
    }

    /* One reindeer, facing right, centred on its barrel. Returns where its hooves are. */
    function deer(x, p, t, C, seed) {
        const pitch = cyc(POSES.pitch, p), bob = cyc(POSES.bob, p), neck = cyc(POSES.neck, p + 0.05);
        x.save();
        x.translate(0, bob);
        x.rotate(pitch * RAD);

        limb(x, 30, 8, cycAll(POSES.fore, p + 0.08), FORE_LEN, FORE_W, C.far, C.shade, null, C.hoof);
        limb(x, -34, 0, cycAll(POSES.hind, p + 0.11), HIND_LEN, HIND_W, C.far, C.shade, null, C.hoof);

        const wag = Math.sin(t * 8.5 + seed) * 2.6;
        cel(x, taper([[-50, -18], [-60, -25 + wag * 0.3], [-71, -24 + wag]], [9, 8, 1.5]), C.white, C.whiteShade, null, 1.8);

        /* Body and neck share one outline, so there is no seam at the shoulder. */
        const a = neck * RAD, ca = Math.cos(a), sa = Math.sin(a);
        const N = (px, py) => {
            const dx = px - 36, dy = py + 12;
            return [36 + dx * ca - dy * sa, -12 + dx * sa + dy * ca];
        };
        const outline = [
            N(70, -60), N(58, -52), N(44, -38), [29, -27], [6, -23], [-18, -23], [-38, -27], [-52, -20], [-57, -6],
            [-50, 8], [-34, 14], [-12, 13], [12, 17], [30, 21], [42, 16], [50, 4], N(57, -12), N(68, -30), N(78, -46)
        ];
        const body = blob(outline);
        cel(x, body, C.coat, C.shade, C.rim, 3.4);
        x.save();
        x.clip(body);
        x.fillStyle = C.belly;
        x.beginPath();
        x.ellipse(6, 23, 44, 12, -0.06, 0, TAU);
        x.fill();
        x.restore();

        /* The shaggy pale throat that makes it a reindeer. */
        const sway = Math.sin(t * 6 + seed) * 1.2;
        const r0 = N(76, -44), r1 = N(68, -30), r2 = N(59, -16), r3 = N(52, -2);
        cel(x, blob([
            [r0[0] - 3, r0[1] - 3], [r0[0] + 2, r0[1] + 2], [r0[0] + 1 + sway, r0[1] + 9], [r1[0] + 3, r1[1] + 2],
            [r1[0] + 3 + sway, r1[1] + 10], [r2[0] + 3, r2[1] + 3], [r2[0] + 2 + sway, r2[1] + 11], [r3[0] + 2, r3[1] + 3],
            [r3[0] - 2 + sway, r3[1] + 10], [r3[0] - 7, r3[1] + 2], [r2[0] - 4, r2[1] - 2], [r1[0] - 4, r1[1] - 3]
        ]), C.white, C.whiteShade, 'rgba(255,255,255,0.9)', 2.4);

        /* Head, carried steadier than the body. */
        const poll = N(72, -58);
        x.save();
        x.translate(poll[0], poll[1]);
        x.rotate((-pitch * 0.62 + neck * 0.35 + Math.sin(t * 3.1 + seed) * 1.2) * RAD);

        x.save();
        x.translate(11, -1);
        x.rotate(0.13);
        x.scale(0.9, 0.9);
        antler(x, { antler: C.far === DEER_FAR.far ? '#8f7f5f' : '#cdb78c', antlerShade: 'rgba(60,40,20,0.75)' }, 0.9);
        x.restore();

        const head = blob([[-5, -6], [6, -7], [18, -2], [29, 4], [35, 11], [33, 17], [25, 19], [12, 16], [2, 11], [-6, 4]]);
        const ear = Math.sin(t * 4.2 + seed * 2) * 6;
        x.save();
        x.translate(-3, -5);
        x.rotate((ear - 6) * RAD);
        cel(x, blob([[0, 2], [-8, -6], [-19, -8, 1], [-13, 1], [-5, 6]]), C.coat, C.shade, C.rim, 2);
        x.restore();
        cel(x, head, C.coat, C.shade, C.rim, 2.6);
        x.save();
        x.clip(head);
        x.fillStyle = C.belly;
        x.beginPath();
        x.ellipse(29, 17, 12, 6, 0.3, 0, TAU);
        x.fill();
        x.restore();
        circle(x, 33.4, 11.6, 2.5, C.ink);
        circle(x, 11, 1.6, 2.5, C.ink);
        circle(x, 10.2, 0.8, 0.8, 'rgba(255,255,255,0.95)');

        /* Bridle: a thin red line with a gold stud. */
        x.strokeStyle = C.harness;
        x.lineWidth = 1.5;
        x.beginPath();
        x.moveTo(22, 0.5);
        x.quadraticCurveTo(25, 9, 26, 18);
        x.moveTo(1, -5);
        x.quadraticCurveTo(10, 9, 24, 9.5);
        x.stroke();
        circle(x, 24.4, 9.4, 1.5, GOLD);

        antler(x, C, 1);
        x.restore();

        const hooves = [
            limb(x, 34, 6, cycAll(POSES.fore, p), FORE_LEN, FORE_W, C.legs, C.shade, C.coat, C.hoof),
            limb(x, -38, -2, cycAll(POSES.hind, p + 0.03), HIND_LEN, HIND_W, C.legs, C.shade, C.coat, C.hoof)
        ];

        /* Harness: collar with bells, a girth strap. */
        cel(x, taper([[14, -25], [13, -2], [15, 20]], [4, 4]), C.harness, 'rgba(40,0,6,0.5)', null, 1);
        const c1 = N(44, -38), c2 = N(50, -20), c3 = N(50, 2);
        cel(x, taper([c1, c2, c3], [6.5, 6.5]), C.harness, 'rgba(40,0,6,0.5)', 'rgba(255,200,170,0.5)', 1.3);
        [0.4, 0.68, 0.94].forEach((u, i) => {
            const px = lerp(c1[0], c3[0], u) + 1.6, py = lerp(c1[1], c3[1], u) + 2 + Math.sin(t * 9 + i) * 0.6;
            circle(x, px, py, 2.7, GOLD_LO);
            circle(x, px - 0.5, py - 0.6, 2, GOLD);
            circle(x, px - 0.9, py - 1.1, 0.7, GOLD_HI);
        });
        x.restore();

        return { hooves: hooves.map(h => {
            const c = Math.cos(pitch * RAD), s = Math.sin(pitch * RAD);
            return [h[0] * c - h[1] * s, h[0] * s + h[1] * c + bob];
        }) };
    }

    /* ---------- The sleigh: lacquer and gold, painted once ---------- */

    const HULL = [
        [-104, 4], [-114, -20], [-118, -52], [-112, -76], [-96, -86], [-84, -78], [-88, -62], [-74, -40],
        [-34, -32], [18, -32], [44, -40], [58, -64], [80, -92], [102, -100], [116, -90], [112, -74], [98, -72], [90, -60],
        [82, -26], [64, 2], [10, 12], [-60, 12]
    ];

    function curl(x, cx, cy, r, dir, turns) {
        x.beginPath();
        const steps = 34;
        for (let i = 0; i <= steps; i++) {
            const u = i / steps, a = dir * u * turns * TAU, q = r * (1 - u * 0.88);
            const px = cx + Math.cos(a) * q, py = cy + Math.sin(a) * q;
            if (i) x.lineTo(px, py);
            else x.moveTo(px, py);
        }
        x.stroke();
    }

    function runner(x, dx, dy, fill, lo) {
        x.save();
        x.translate(dx, dy);
        const pts = [[-114, 38], [-60, 39], [10, 39], [62, 38], [96, 30], [120, 8], [128, -12], [120, -24], [108, -22], [106, -10], [114, -8]];
        cel(x, taper(pts, [5.2, 5, 5, 5, 4.6, 4.2, 3.6, 3, 2.4, 2, 1.2]), fill, lo, null, 1.6);
        x.lineCap = 'round';
        [[-72, 12, -80, 38], [-18, 12, -24, 39], [40, 8, 34, 38]].forEach(q => {
            x.strokeStyle = fill;
            x.lineWidth = 4;
            x.beginPath();
            x.moveTo(q[0], q[1]);
            x.quadraticCurveTo(q[0] - 12, (q[1] + q[3]) / 2, q[2], q[3]);
            x.stroke();
        });
        x.restore();
    }

    function sleighBack(x) {
        runner(x, 10, -7, '#8a6220', 'rgba(40,20,0,0.5)');
        const wall = blob([[-92, -30], [-78, -52], [-30, -44], [18, -44], [46, -54], [62, -40], [48, -24], [-70, -22]]);
        x.fillStyle = '#3c0a14';
        x.fill(wall);
    }

    function sleighFront(x) {
        const hull = blob(HULL);
        const gr = x.createLinearGradient(0, -100, 0, 14);
        gr.addColorStop(0, '#b71a2a');
        gr.addColorStop(0.45, '#8c1020');
        gr.addColorStop(1, '#4c0812');
        x.fillStyle = gr;
        x.fill(hull);
        x.save();
        x.clip(hull);
        x.translate(-2, -3);
        x.strokeStyle = 'rgba(30,0,6,0.6)';
        x.lineWidth = 6;
        x.stroke(hull);
        x.translate(3, 4);
        x.strokeStyle = 'rgba(255,190,170,0.5)';
        x.lineWidth = 1.5;
        x.stroke(hull);
        x.restore();

        /* Gold edge along the whole outline. */
        x.strokeStyle = GOLD;
        x.lineWidth = 2.4;
        x.stroke(hull);
        x.strokeStyle = GOLD_HI;
        x.lineWidth = 0.7;
        x.stroke(hull);

        /* The inset panel and its scrollwork. */
        const panel = blob([[-94, -6], [-99, -38], [-70, -24], [-32, -19], [20, -19], [52, -28], [66, -18], [52, 0], [0, 6], [-62, 6]]);
        x.strokeStyle = 'rgba(242,192,99,0.85)';
        x.lineWidth = 1.2;
        x.stroke(panel);
        x.save();
        x.clip(panel);
        x.lineCap = 'round';
        x.strokeStyle = GOLD;
        x.lineWidth = 1.5;
        const tiles = [[-70, -9, 1], [-44, -7, -1], [-18, -7, 1], [8, -7, -1], [34, -9, 1]];
        tiles.forEach(q => {
            curl(x, q[0], q[1], 10.5, q[2], 1.35);
            x.beginPath();
            x.moveTo(q[0] + 10 * q[2], q[1] - 1);
            x.quadraticCurveTo(q[0] + 16 * q[2], q[1] + 9, q[0] + 26 * q[2], q[1] + 7);
            x.stroke();
            circle(x, q[0] + 14 * q[2], q[1] - 7, 1.3, GOLD_HI);
        });
        x.restore();

        /* Rolled ends, front and back. */
        x.strokeStyle = GOLD_HI;
        x.lineWidth = 1.6;
        x.lineCap = 'round';
        curl(x, 104, -86, 9, 1, 1.25);
        curl(x, -100, -74, 8, -1, 1.25);

        runner(x, 0, 0, GOLD, 'rgba(120,70,0,0.75)');
        x.strokeStyle = 'rgba(255,240,200,0.75)';
        x.lineWidth = 0.9;
        x.beginPath();
        x.moveTo(-112, 36.8);
        x.lineTo(62, 36.6);
        x.stroke();
    }

    function sackArt(x) {
        /* Gifts peeking out of the sack. */
        const box = (cx, cy, w, h, rot, a, b) => {
            x.save();
            x.translate(cx, cy);
            x.rotate(rot);
            x.fillStyle = a;
            x.fillRect(-w / 2, -h / 2, w, h);
            x.fillStyle = 'rgba(0,0,0,0.22)';
            x.fillRect(w * 0.2, -h / 2, w * 0.3, h);
            x.fillStyle = b;
            x.fillRect(-w * 0.09, -h / 2, w * 0.18, h);
            x.fillRect(-w / 2, -h * 0.09, w, h * 0.18);
            x.fillStyle = b;
            x.beginPath();
            x.ellipse(-w * 0.2, -h / 2 - 2, w * 0.2, 3.4, -0.5, 0, TAU);
            x.ellipse(w * 0.2, -h / 2 - 2, w * 0.2, 3.4, 0.5, 0, TAU);
            x.fill();
            x.restore();
        };
        box(-108, -116, 26, 24, -0.26, '#1c7a58', '#f6e7c0');
        box(-84, -118, 22, 26, 0.2, '#e8ad3c', '#c41f2c');
        box(-96, -131, 19, 15, 0.08, '#2c52b0', '#ffe2a0');

        const sack = blob([[-120, -34], [-134, -66], [-128, -96], [-106, -110], [-82, -108], [-66, -94], [-60, -64], [-70, -32]]);
        cel(x, sack, '#2f6d4d', 'rgba(4,28,22,0.62)', 'rgba(200,240,210,0.42)', 5);
        x.strokeStyle = 'rgba(4,30,22,0.55)';
        x.lineWidth = 1.5;
        x.lineCap = 'round';
        [[-118, -92, -104, -60], [-96, -102, -92, -56], [-76, -96, -76, -58]].forEach(q => {
            x.beginPath();
            x.moveTo(q[0], q[1]);
            x.quadraticCurveTo((q[0] + q[2]) / 2 - 4, (q[1] + q[3]) / 2, q[2], q[3]);
            x.stroke();
        });
        const rim = taper([[-130, -94], [-108, -106], [-84, -106], [-66, -92]], [6, 6]);
        cel(x, rim, GOLD, 'rgba(110,60,0,0.6)', null, 1.6);
    }

    /* ---------- Santa ---------- */

    function santaBack(x, t) {
        /* The far arm: holds the reins, and now and then waves. */
        const w = clamp(Math.sin(t * 0.72 - 1) * 2.2 - 0.8, 0, 1);
        const waveX = Math.sin(t * 8) * 9 * w;
        const elbow = [lerp(-6, -2, w), lerp(-80, -128, w)];
        const hand = [lerp(30, 18 + waveX, w), lerp(-88, -166, w)];
        cel(x, taper([[-34, -100], elbow, hand], [24, 21, 15]), '#a81722', RED_SHADE, null, 3);
        const a = Math.atan2(hand[1] - elbow[1], hand[0] - elbow[0]);
        x.save();
        x.translate(hand[0], hand[1]);
        x.rotate(a);
        cel(x, blob([[-5, -11], [3, -11], [4, 11], [-5, 11]]), '#dcd6cc', FUR_SHADE, null, 2);
        circle(x, 11, 0, 8, '#201410');
        x.restore();
        return w;
    }

    function santaFront(x, t) {
        const breathe = Math.sin(t * 2.3) * 0.8;

        /* Coat, a big soft shape; the sleigh hides everything below the lap. */
        const coat = blob([[-70, -24], [-73, -60], [-66, -92 + breathe], [-46, -110 + breathe], [-20, -113 + breathe], [-4, -100 + breathe], [9, -78], [15, -54], [9, -24]]);
        cel(x, coat, RED, RED_SHADE, RED_RIM, 6);

        /* Fur down the front and the belt across it. */
        cel(x, taper([[-5, -100], [9, -78], [15, -54], [9, -26]], [10, 13, 13, 12]), FUR, FUR_SHADE, null, 3);
        x.save();
        x.clip(coat);
        cel(x, taper([[-76, -56], [-34, -49], [18, -55]], [10, 10]), '#1a1211', null, 'rgba(255,255,255,0.32)', 1.4);
        x.restore();
        x.fillStyle = GOLD;
        x.fillRect(1, -61, 13, 13);
        x.fillStyle = '#1a1211';
        x.fillRect(4.4, -57.6, 6.2, 6.2);

        /* Head. */
        x.save();
        x.translate(-15, -128);
        x.rotate(Math.sin(t * 1.9) * 0.03);
        santaHead(x, t);
        x.restore();

        /* Near arm with the reins; it tugs in time with the team. */
        const tug = Math.sin(t * 4.7) * 2.2;
        const hand = [24 + tug, -72 + tug * 0.3];
        const elbow = [-13, -66 + tug * 0.3];
        cel(x, taper([[-46, -96], [-34, -82], elbow, [hand[0] - 3, hand[1]]], [26, 28, 24, 17]), RED, RED_SHADE, RED_RIM, 4.5);
        x.save();
        x.translate(hand[0], hand[1]);
        x.rotate(-0.1);
        cel(x, blob([[-5, -12], [4, -12], [5, 12], [-5, 12]]), FUR, FUR_SHADE, null, 2.4);
        cel(x, blob([[3, -9], [14, -9], [19, -2], [17, 8], [6, 9]]), '#201410', 'rgba(0,0,0,0.5)', 'rgba(255,255,255,0.32)', 2);
        x.restore();
        return [hand[0] + 16, hand[1] + 2];
    }

    function santaHead(x, t) {
        /* Hair behind, moved by the wind. */
        const f = i => Math.sin(t * 5.2 - i * 0.8);
        cel(x, blob([[-6, -10], [-18, -6], [-27, 6 + f(1)], [-40, 17 + f(2) * 2], [-25, 21 + f(3)], [-10, 16], [2, 8]]), FUR, FUR_SHADE, null, 3);

        /* The hat's tail streams behind, thick at the head and thin at the pompom. */
        const pts = [[4, -15]];
        const widths = [33];
        const seg = [[-4, -28], [-18, -35], [-34, -34], [-49, -26]];
        const ws = [28, 19, 11, 5];
        seg.forEach((q, i) => {
            const w = Math.sin(t * 4.6 - i * 0.9) * (i + 1) * 1.2;
            pts.push([q[0], q[1] + w]);
            widths.push(ws[i]);
        });
        cel(x, taper(pts, widths), RED, RED_SHADE, RED_RIM, 4);
        const end = pts[pts.length - 1];
        cel(x, blob([[end[0] - 7, end[1]], [end[0] - 1, end[1] - 7], [end[0] + 6, end[1] - 1], [end[0] + 2, end[1] + 6], [end[0] - 5, end[1] + 6]]), FUR, FUR_SHADE, null, 3);

        /* Face. */
        const skin = blob([[-10, -12], [6, -14], [16, -8], [19, 2], [15, 12], [2, 16], [-10, 10]]);
        cel(x, skin, '#f6c8a6', 'rgba(170,84,60,0.42)', null, 3);

        /* Beard: lobes that trail in the wind. */
        const b0 = Math.sin(t * 4.1) * 1.8, b1 = Math.sin(t * 4.1 - 1) * 2.6, b2 = Math.sin(t * 4.1 - 2) * 3.2;
        cel(x, blob([
            [-8, 0], [-11, 16], [-22 + b0, 30], [-35 + b1, 46], [-17 + b1, 43], [-14 + b2, 56], [1 + b1, 47], [11 + b0, 34], [17, 20], [19, 10], [10, 11], [2, 7]
        ]), FUR, FUR_SHADE, 'rgba(255,255,255,0.9)', 4.5);
        x.strokeStyle = 'rgba(120,140,190,0.5)';
        x.lineWidth = 1;
        x.lineCap = 'round';
        x.beginPath();
        x.moveTo(-3, 15);
        x.quadraticCurveTo(-8 + b0, 28, -18 + b1, 40);
        x.moveTo(6, 16);
        x.quadraticCurveTo(2 + b0, 30, -6 + b2, 46);
        x.stroke();

        /* Moustache, nose, cheek, eye. */
        cel(x, blob([[1, 10], [9, 5], [18, 6], [26, 11], [17, 14], [8, 15]]), FUR, FUR_SHADE, null, 2.4);
        circle(x, 9, 2.4, 5, 'rgba(232,108,96,0.55)');
        cel(x, blob([[13, -2], [19, -3], [23, 1], [20, 6], [14, 5]]), '#f2a68c', 'rgba(170,60,50,0.4)', 'rgba(255,255,255,0.6)', 1.6);
        x.fillStyle = '#23120c';
        x.beginPath();
        x.ellipse(10, -3, 2, 2.5, 0, 0, TAU);
        x.fill();
        circle(x, 9.4, -3.8, 0.7, '#ffffff');
        cel(x, taper([[3, -9], [10, -11.5], [17, -9]], [3.6, 2.4]), FUR, null, null, 1);

        /* Fur band of the hat, on top of everything. */
        cel(x, taper([[-16, -13], [-6, -18], [8, -19], [21, -13]], [11, 12.5, 12.5, 11]), FUR, FUR_SHADE, 'rgba(255,255,255,0.9)', 3);
    }

    /* ---------- The flight ---------- */

    function buildPath(points) {
        const samples = [];
        const P = i => points[clamp(i, 0, points.length - 1)];
        for (let i = 0; i < points.length - 1; i++) {
            const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
            for (let k = 0; k < 40; k++) {
                const u = k / 40, u2 = u * u, u3 = u2 * u;
                const f = j => 0.5 * (2 * b[j] + (c[j] - a[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * u2 + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * u3);
                samples.push({ x: f(0), y: f(1), s: f(2), d: 0 });
            }
        }
        const end = points[points.length - 1];
        samples.push({ x: end[0], y: end[1], s: end[2], d: 0 });
        let dist = 0;
        for (let i = 1; i < samples.length; i++) {
            dist += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
            samples[i].d = dist;
        }
        return { samples, total: dist };
    }

    function pathAt(path, d, out) {
        const S = path.samples;
        if (d <= 0) {
            const a = S[0], b = S[1], l = b.d || 1;
            out.x = a.x + (b.x - a.x) * d / l;
            out.y = a.y + (b.y - a.y) * d / l;
            out.s = a.s;
            out.a = Math.atan2(b.y - a.y, b.x - a.x);
            return out;
        }
        if (d >= path.total) {
            const a = S[S.length - 2], b = S[S.length - 1], l = b.d - a.d || 1;
            out.x = b.x + (b.x - a.x) * (d - b.d) / l;
            out.y = b.y + (b.y - a.y) * (d - b.d) / l;
            out.s = b.s;
            out.a = Math.atan2(b.y - a.y, b.x - a.x);
            return out;
        }
        let lo = 0, hi = S.length - 1;
        while (hi - lo > 1) {
            const m = (lo + hi) >> 1;
            if (S[m].d < d) lo = m;
            else hi = m;
        }
        const a = S[lo], b = S[hi], u = (d - a.d) / (b.d - a.d || 1);
        out.x = a.x + (b.x - a.x) * u;
        out.y = a.y + (b.y - a.y) * u;
        out.s = a.s + (b.s - a.s) * u;
        out.a = Math.atan2(b.y - a.y, b.x - a.x);
        return out;
    }

    function Flight(canvas, o) {
        const S = g.NyArt.sprites;
        let W = o.W, H = o.H;
        const dpr = Math.min(g.devicePixelRatio || 1, o.maxDpr || 1.5);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        const x = canvas.getContext('2d');
        const light = !!o.light;
        const gold = light ? '214,120,24' : '255,204,120';
        const dust = S.core(gold), glow = S.glow(gold), star = S.glint(light ? '226,134,30' : '255,240,205');

        /* Painted once, at a size that stays sharp at the largest scale of the flight. */
        const q = 3;
        const paintSprite = (x0, y0, w, h, fn) => {
            const c = document.createElement('canvas');
            c.width = w * q;
            c.height = h * q;
            const k = c.getContext('2d');
            k.scale(q, q);
            k.translate(-x0, -y0);
            k.lineJoin = 'round';
            fn(k);
            return { c, x0, y0, w, h };
        };
        const back = paintSprite(-130, -112, 280, 160, sleighBack);
        const front = paintSprite(-130, -112, 280, 160, sleighFront);
        const sack = paintSprite(-145, -150, 95, 125, sackArt);
        const place = (s, sp) => s.drawImage(sp.c, sp.x0, sp.y0, sp.w, sp.h);

        const PAIRS = o.pairs || 3, GAP = 158, SLEIGH = 196;
        const team = [];
        for (let i = 0; i < PAIRS; i++) team.push({ near: { x: 0, y: 0, s: 1, a: 0 }, phase: i * 0.21, next: [0, 0], tail: [0, 0] });
        const sleighAt = { x: 0, y: 0, s: 1, a: 0 };
        const lead = { x: 0, y: 0, s: 1, a: 0 };

        let path = null, d = 0, active = false, gait = 0, now = 0, onDone = null, lastHoof = [];
        const parts = [], ribbon = [];
        const base = o.speed || 240;
        let ribbonEvery = 0;

        function emit(px, py, vx, vy, life, size, kind) {
            if (parts.length > 500) return;
            parts.push({ x: px, y: py, vx, vy, age: 0, life, size, kind, ph: Math.random() * TAU });
        }

        function setObject(p, ox, oy, sc) {
            const s = p.s * (sc || 1), c = Math.cos(p.a * 0.86), n = Math.sin(p.a * 0.86);
            x.setTransform(dpr * s * c, dpr * s * n, -dpr * s * n, dpr * s * c, dpr * (p.x + (ox || 0) * p.s), dpr * (p.y + (oy || 0) * p.s));
        }

        function toWorld(p, lx, ly) {
            const c = Math.cos(p.a * 0.86), n = Math.sin(p.a * 0.86);
            return [p.x + p.s * (lx * c - ly * n), p.y + p.s * (lx * n + ly * c)];
        }

        function rope(a, b, sag, width, color) {
            x.strokeStyle = color;
            x.lineWidth = width;
            x.beginPath();
            x.moveTo(a[0], a[1]);
            x.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag, b[0], b[1]);
            x.stroke();
        }

        function draw(dt) {
            x.setTransform(dpr, 0, 0, dpr, 0, 0);
            x.clearRect(0, 0, W, H);
            if (!path) return;

            /* Positions: every pair follows the same path, one behind the other. */
            pathAt(path, d, lead);
            let cur = d;
            for (let i = 0; i < PAIRS; i++) {
                pathAt(path, cur, team[i].near);
                cur -= GAP * team[i].near.s;
            }
            pathAt(path, cur - (SLEIGH - GAP) * team[PAIRS - 1].near.s, sleighAt);
            const slS = sleighAt.s * 0.92;
            const bobS = Math.sin(now * 2.6) * 2.4 * sleighAt.s;
            sleighAt.y += bobS;
            sleighAt.a += Math.sin(now * 2.6 - 0.8) * 0.028;

            /* The trail lingers in the air behind the sleigh. */
            const rear = toWorld(sleighAt, -104, 34);
            ribbonEvery += dt;
            if (active && ribbonEvery > 0.03) {
                ribbon.push({ x: rear[0], y: rear[1], s: sleighAt.s, age: 0 });
                ribbonEvery = 0;
            }
            x.lineCap = 'round';
            x.globalCompositeOperation = light ? 'source-over' : 'lighter';
            for (let i = ribbon.length - 1; i >= 0; i--) {
                ribbon[i].age += dt;
                if (ribbon[i].age > 3.4) { ribbon.splice(0, i + 1); break; }
            }
            for (let i = 1; i < ribbon.length; i++) {
                const a = ribbon[i - 1], b = ribbon[i], u = 1 - b.age / 3.4;
                const w = (2 + (1 - u) * 13) * b.s;
                x.strokeStyle = 'rgba(' + gold + ',' + (u * u * (light ? 0.14 : 0.1)) + ')';
                x.lineWidth = w;
                x.beginPath();
                x.moveTo(a.x, a.y + (1 - u) * 26);
                x.lineTo(b.x, b.y + (1 - u) * 26);
                x.stroke();
                x.strokeStyle = 'rgba(' + gold + ',' + (u * u * u * 0.55) + ')';
                x.lineWidth = 1.5 * b.s;
                x.beginPath();
                x.moveTo(a.x, a.y);
                x.lineTo(b.x, b.y);
                x.stroke();
            }

            /* Gold dust from the runners. */
            if (active) {
                for (let i = 0; i < 3; i++) {
                    emit(rear[0] + (Math.random() - 0.5) * 34 * sleighAt.s, rear[1] + (Math.random() - 0.5) * 8 * sleighAt.s, (Math.random() - 0.5) * 34, 6 + Math.random() * 16, 1.3 + Math.random() * 2, (1 + Math.random() * 1.8) * sleighAt.s, Math.random() < 0.14 ? 1 : 0);
                }
            }

            for (let i = parts.length - 1; i >= 0; i--) {
                const p = parts[i];
                p.age += dt;
                if (p.age >= p.life) { parts.splice(i, 1); continue; }
                p.vx *= Math.exp(-dt * 1.1);
                p.vy = p.vy * Math.exp(-dt * 1.1) + 13 * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                const u = p.age / p.life, tw = 0.55 + 0.45 * Math.sin(p.age * 11 + p.ph);
                x.globalAlpha = (1 - u) * (1 - u) * tw;
                if (p.kind === 1) {
                    const sz = p.size * 7;
                    x.drawImage(star, p.x - sz / 2, p.y - sz / 2, sz, sz);
                } else {
                    const sz = p.size * 2.6;
                    x.drawImage(dust, p.x - sz / 2, p.y - sz / 2, sz, sz);
                }
            }
            x.globalAlpha = 1;
            x.globalCompositeOperation = 'source-over';

            if (!active && d >= 0 && parts.length === 0 && ribbon.length === 0) return;

            /* Far row of reindeer. */
            x.lineJoin = 'round';
            for (let i = PAIRS - 1; i >= 0; i--) {
                const t = team[i];
                setObject(t.near, 30, -13, 0.92);
                deer(x, gait + t.phase + 0.13, now, DEER_FAR, i * 3 + 1);
            }

            /* Traces between the pairs, then the near row over them. */
            x.setTransform(dpr, 0, 0, dpr, 0, 0);
            const hook = toWorld(sleighAt, 92, -46);
            let from = hook;
            for (let i = PAIRS - 1; i >= 0; i--) {
                const t = team[i];
                const girth = toWorld(t.near, 14, -2 + cyc(POSES.bob, gait + t.phase));
                rope(from, [girth[0], girth[1]], 7 * t.near.s, Math.max(0.9, 1.5 * t.near.s), light ? 'rgba(90,50,14,0.9)' : 'rgba(255,226,170,0.82)');
                const midX = (from[0] + girth[0]) / 2, midY = (from[1] + girth[1]) / 2 + 3.6 * t.near.s;
                x.fillStyle = GOLD;
                x.beginPath();
                x.arc(midX, midY, 2.3 * t.near.s, 0, TAU);
                x.fill();
                from = toWorld(t.near, 44, 2 + cyc(POSES.bob, gait + t.phase));
            }

            for (let i = PAIRS - 1; i >= 0; i--) {
                const t = team[i];
                const p = gait + t.phase;
                setObject(t.near, -4, 5, 1);
                const out = deer(x, p, now, DEER_NEAR, i * 3 + 7);

                /* A hoof that comes down strikes a little star out of the air. */
                const ph = ((p % 1) + 1) % 1, was = lastHoof[i] == null ? ph : lastHoof[i];
                lastHoof[i] = ph;
                if (active) {
                    const crossed = v => (was < v && ph >= v);
                    if (crossed(0.22) || crossed(0.72)) {
                        const hf = out.hooves[crossed(0.22) ? 0 : 1];
                        const w = toWorld(t.near, hf[0] - 4, hf[1] + 5);
                        const amount = 4;
                        for (let k = 0; k < amount; k++) {
                            const a = Math.random() * TAU, v = 10 + Math.random() * 44;
                            emit(w[0], w[1], Math.cos(a) * v - 16, Math.sin(a) * v * 0.6, 0.7 + Math.random() * 1, (0.9 + Math.random() * 1.2) * t.near.s, k === 0 ? 1 : 0);
                        }
                    }
                }
            }

            /* The sleigh with Santa in it. */
            const sc = slS / sleighAt.s;
            setObject(sleighAt, 0, 0, sc);
            place(x, back);
            x.save();
            x.translate(-92, -30);
            x.rotate(Math.sin(now * 2.6 - 1.6) * 0.022);
            x.translate(92, 30);
            place(x, sack);
            x.restore();
            santaBack(x, now);
            const hand = santaFront(x, now);
            place(x, front);

            /* A lantern on the prow: the warm point the eye follows. */
            const sw = Math.sin(now * 3.4) * 0.16;
            x.save();
            x.translate(106, -72);
            x.rotate(sw);
            x.strokeStyle = GOLD;
            x.lineWidth = 1;
            x.beginPath();
            x.moveTo(0, 0);
            x.lineTo(0, 8);
            x.stroke();
            x.fillStyle = GOLD_LO;
            x.fillRect(-4.6, 7, 9.2, 2);
            x.fillRect(-4.6, 20, 9.2, 2);
            x.fillStyle = '#fff0bf';
            x.fillRect(-3.6, 9, 7.2, 11);
            x.strokeStyle = GOLD_LO;
            x.lineWidth = 0.7;
            x.strokeRect(-3.6, 9, 7.2, 11);
            if (!light) {
                x.globalCompositeOperation = 'lighter';
                x.globalAlpha = 0.72 + 0.14 * Math.sin(now * 11) + 0.08 * Math.sin(now * 17);
                x.drawImage(glow, -36, -21, 72, 72);
                x.globalAlpha = 1;
                x.globalCompositeOperation = 'source-over';
            }
            x.restore();

            /* Reins, from Santa's hand to the last pair. */
            const reinFrom = toWorld(sleighAt, hand[0] * 0.92, hand[1] * 0.92);
            x.setTransform(dpr, 0, 0, dpr, 0, 0);
            const lastPair = team[PAIRS - 1];
            const neck = toWorld(lastPair.near, 50, -22 + cyc(POSES.bob, gait + lastPair.phase));
            rope(reinFrom, neck, 11 * sleighAt.s, Math.max(0.8, 1.2 * sleighAt.s), light ? 'rgba(70,36,10,0.9)' : 'rgba(255,232,186,0.8)');
        }

        function update(dt) {
            now += dt;
            gait += dt * (o.gait || 1.55);
            if (active) {
                pathAt(path, d, lead);
                d += base * (lead.s / 0.72) * dt;
                pathAt(path, d - GAP * PAIRS * lead.s - SLEIGH * lead.s, sleighAt);
                if (d > path.total + 400 || sleighAt.x > W + 340 || sleighAt.y < -320) {
                    active = false;
                }
            }
            if (active || parts.length || ribbon.length) {
                draw(dt);
                return true;
            }
            canvas.style.visibility = 'hidden';
            if (onDone) {
                const fn = onDone;
                onDone = null;
                fn();
            }
            return false;
        }

        return {
            get active() { return active || parts.length > 0 || ribbon.length > 0; },
            start(points, done) {
                path = buildPath(points);
                d = 0;
                active = true;
                onDone = done || null;
                parts.length = 0;
                ribbon.length = 0;
                canvas.style.visibility = 'visible';
            },
            update,
            resize(width, height) {
                W = width;
                H = height;
                canvas.width = Math.round(W * dpr);
                canvas.height = Math.round(H * dpr);
            },
            /* Jumps to a point of the flight: used to inspect a moment. */
            seek(u) {
                d = path.total * u;
                active = true;
                canvas.style.visibility = 'visible';
                return d;
            }
        };
    }

    /* The route depends on where the free band of sky is on this page and how wide it is. */
    function route(W, y, compact) {
        if (compact) {
            const k = W / 390;
            return [
                [-150, y - 150, 0.24], [40, y - 60, 0.31], [195, y + 2, 0.4], [340, y - 26, 0.46],
                [560, y - 150, 0.56], [860, y - 340, 0.66], [1300, y - 620, 0.72]
            ].map(p => [p[0] * k, p[1], p[2]]);
        }
        const k = W / 1920, sk = clamp(Math.sqrt(k), 0.72, 1.18);
        return [
            [-300, y - 340, 0.34], [110, y - 230, 0.44], [430, y - 60, 0.6], [800, y + 6, 0.7],
            [1240, y + 4, 0.74], [1620, y - 74, 0.92], [1900, y - 270, 1.2], [2460, y - 600, 1.6], [3200, y - 980, 1.9]
        ].map(p => [p[0] * k, p[1], p[2] * sk]);
    }

    g.NySleigh = { Flight, route };
})(window);
