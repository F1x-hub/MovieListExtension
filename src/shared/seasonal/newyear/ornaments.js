/**
 * New Year season: the ornaments on the tree.
 *
 * Each one is painted once into a small canvas and then only swings. None of them is
 * yellow: the needles and the air around them already glow warm, and a yellow ornament
 * would disappear there. Cool glass, white figures and deep reds stand out instead.
 */
(function (g) {
    'use strict';

    const A = g.NyArt;
    const TAU = A.TAU, rng = A.rng, mix = A.mix, rgb = A.rgb;
    const WHITE = [255, 255, 255];
    const NIGHT = [8, 12, 38];

    const GLASS = {
        ruby: [196, 22, 44],
        blue: [24, 70, 190],
        pearl: [228, 236, 248],
        silver: [168, 186, 214],
        violet: [112, 48, 188],
        berry: [204, 30, 112],
        teal: [8, 132, 150]
    };
    /* The pattern on a ball, by the color of its glass. */
    const INK = {
        ruby: 'rgba(255,240,226,0.96)',
        blue: 'rgba(226,238,255,0.96)',
        pearl: 'rgba(176,24,48,0.9)',
        silver: 'rgba(22,60,150,0.88)',
        violet: 'rgba(244,226,255,0.96)',
        berry: 'rgba(255,236,246,0.96)',
        teal: 'rgba(232,252,255,0.96)'
    };

    function linear(x, x0, y0, x1, y1, stops) {
        const gr = x.createLinearGradient(x0, y0, x1, y1);
        stops.forEach(stop => gr.addColorStop(stop[0], stop[1]));
        return gr;
    }

    function dot(x, cx, cy, r) {
        x.beginPath();
        x.arc(cx, cy, r, 0, TAU);
        x.fill();
    }

    /* Six arms with a pair of side branches each, as one path. */
    function flakePath(x, cx, cy, R) {
        x.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = -Math.PI / 2 + i * Math.PI / 3, ux = Math.cos(a), uy = Math.sin(a);
            x.moveTo(cx, cy);
            x.lineTo(cx + ux * R, cy + uy * R);
            [0.62, 0.34].forEach((q, n) => {
                const bx = cx + ux * R * q, by = cy + uy * R * q, len = R * (n ? 0.2 : 0.27);
                [1, -1].forEach(d => {
                    const b = a + d * 1.02;
                    x.moveTo(bx, by);
                    x.lineTo(bx + Math.cos(b) * len, by + Math.sin(b) * len);
                });
            });
        }
    }

    /* ---------- Glass balls ---------- */

    function ball(x, top, R, o) {
        const cy = top + R, c = GLASS[o.tone], ink = INK[o.tone], r = rng(o.seed);
        const gr = x.createRadialGradient(-R * 0.36, cy - R * 0.42, R * 0.05, 0, cy, R * 1.14);
        gr.addColorStop(0, rgb(mix(c, WHITE, 0.8)));
        gr.addColorStop(0.17, rgb(mix(c, WHITE, 0.34)));
        gr.addColorStop(0.46, rgb(c));
        gr.addColorStop(0.82, rgb(mix(c, NIGHT, 0.56)));
        gr.addColorStop(1, rgb(mix(c, NIGHT, 0.82)));
        x.fillStyle = gr;
        dot(x, 0, cy, R);

        x.save();
        x.beginPath();
        x.arc(0, cy, R, 0, TAU);
        x.clip();
        x.lineCap = 'round';
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
                dot(x, Math.sin(a) * R * 0.98, cy + Math.cos(a) * R * 0.22 + R * 0.02, R * 0.07);
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
                g.NyTree.fivePoint(x, Math.cos(a) * q, cy + Math.sin(a) * q, R * 0.18, R * 0.075, r());
                x.fill();
            }
        } else if (o.deco === 'frost') {
            x.strokeStyle = 'rgba(255,255,255,0.78)';
            x.lineWidth = R * 0.055;
            for (let i = 0; i < 5; i++) {
                const a = i * 1.26 + 0.4;
                x.beginPath();
                x.moveTo(0, cy);
                x.quadraticCurveTo(Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.1, Math.cos(a + 0.5) * R * 0.92, cy + Math.sin(a + 0.5) * R * 0.92);
                x.stroke();
            }
        } else if (o.deco === 'dots') {
            x.fillStyle = ink;
            for (let row = -2; row <= 2; row++) {
                const count = 5 - Math.abs(row);
                for (let i = 0; i < count; i++) {
                    const u = (i + 0.5) / count - 0.5;
                    dot(x, Math.sin(u * 2.6) * R * (1 - Math.abs(row) * 0.2), cy + row * R * 0.4, R * 0.085);
                }
            }
        } else if (o.deco === 'flake') {
            x.strokeStyle = ink;
            x.lineWidth = R * 0.085;
            flakePath(x, 0, cy + R * 0.06, R * 0.62);
            x.stroke();
        } else if (o.deco === 'stripes') {
            x.fillStyle = ink;
            for (let i = -2; i <= 2; i++) {
                const y = cy + i * R * 0.46;
                x.beginPath();
                x.moveTo(-R * 1.1, y - R * 0.08);
                x.quadraticCurveTo(0, y + R * 0.2, R * 1.1, y - R * 0.08);
                x.lineTo(R * 1.1, y + R * 0.08);
                x.quadraticCurveTo(0, y + R * 0.36, -R * 1.1, y + R * 0.08);
                x.closePath();
                x.fill();
            }
        }
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
        dot(x, R * 0.2, cy - R * 0.66, R * 0.055);
    }

    /* ---------- Icicle, cone, star, snowflake: the old glass ones ---------- */

    function icicle(x, top, R) {
        const L = R * 3.6, W = R * 0.66;
        x.beginPath();
        x.moveTo(-W * 0.45, top);
        x.bezierCurveTo(-W, top + L * 0.16, -W * 0.62, top + L * 0.5, 0, top + L);
        x.bezierCurveTo(W * 0.62, top + L * 0.5, W, top + L * 0.16, W * 0.45, top);
        x.closePath();
        x.fillStyle = linear(x, -W, 0, W, 0, [[0, '#5f86c2'], [0.32, '#eaf5ff'], [0.62, '#a8c8ee'], [1, '#3f629f']]);
        x.fill();
        x.save();
        x.clip();
        x.strokeStyle = 'rgba(255,255,255,0.72)';
        x.lineWidth = Math.max(0.5, R * 0.09);
        for (let i = 0; i < 7; i++) {
            const y = top + i * L / 7;
            x.beginPath();
            x.moveTo(-W, y + R * 0.3);
            x.quadraticCurveTo(0, y + R * 0.1, W, y - R * 0.3);
            x.stroke();
        }
        x.restore();
    }

    /* A frosted cone: dark blue scales with snow on their edges. */
    function cone(x, top, R) {
        const L = R * 2.5, W = R * 0.92;
        x.beginPath();
        x.ellipse(0, top + L / 2, W, L / 2, 0, 0, TAU);
        x.fillStyle = linear(x, -W, 0, W, 0, [[0, '#1f3160'], [0.4, '#6f8fc8'], [1, '#172449']]);
        x.fill();
        x.save();
        x.clip();
        const rows = 7;
        for (let i = rows; i >= 0; i--) {
            const y = top + i * L / rows;
            for (let c = -5; c <= 5; c++) {
                const px = (c + (i % 2) * 0.5) * W * 0.46;
                x.lineWidth = Math.max(0.4, R * 0.05);
                x.beginPath();
                x.arc(px, y, W * 0.27, 0, Math.PI);
                x.strokeStyle = 'rgba(8,16,44,0.8)';
                x.stroke();
                x.lineWidth = Math.max(0.5, R * 0.08);
                x.beginPath();
                x.arc(px, y + 0.5, W * 0.21, 0.5, Math.PI - 0.5);
                x.strokeStyle = 'rgba(255,255,255,0.92)';
                x.stroke();
            }
        }
        x.restore();
    }

    function star(x, top, R) {
        const RR = R * 1.26, cy = top + R * 1.3;
        for (let i = 0; i < 10; i++) {
            const a0 = -Math.PI / 2 + i * Math.PI / 5, a1 = a0 + Math.PI / 5;
            const r0 = i % 2 ? RR * 0.44 : RR, r1 = i % 2 ? RR : RR * 0.44;
            x.fillStyle = i % 2 ? '#ff6272' : '#a30d24';
            x.beginPath();
            x.moveTo(0, cy);
            x.lineTo(Math.cos(a0) * r0, cy + Math.sin(a0) * r0);
            x.lineTo(Math.cos(a1) * r1, cy + Math.sin(a1) * r1);
            x.closePath();
            x.fill();
        }
        x.fillStyle = 'rgba(255,255,255,0.86)';
        dot(x, -R * 0.1, cy - R * 0.12, R * 0.09);
    }

    function snowflake(x, top, R) {
        const cy = top + R * 1.45, r = R * 1.38;
        x.lineCap = 'round';
        flakePath(x, 0, cy, r);
        x.strokeStyle = '#2c5da6';
        x.lineWidth = R * 0.27;
        x.stroke();
        flakePath(x, 0, cy, r);
        x.strokeStyle = '#f6fbff';
        x.lineWidth = R * 0.13;
        x.stroke();
        x.fillStyle = '#ffffff';
        dot(x, 0, cy, R * 0.15);
    }

    /* ---------- Figures ---------- */

    function angel(x, top, R) {
        const u = R * 1.32;
        x.save();
        x.translate(0, top);
        x.scale(u, u);
        x.lineJoin = 'round';
        x.lineCap = 'round';

        /* Wings first: everything else stands in front of them. */
        [1, -1].forEach(side => {
            x.save();
            x.scale(side, 1);
            x.beginPath();
            x.moveTo(0.12, 1.0);
            x.bezierCurveTo(0.4, 0.6, 0.84, 0.36, 1.2, 0.44);
            x.bezierCurveTo(1.25, 0.72, 1.13, 0.92, 0.99, 1.0);
            x.bezierCurveTo(1.02, 1.17, 0.9, 1.31, 0.75, 1.31);
            x.bezierCurveTo(0.76, 1.5, 0.6, 1.6, 0.45, 1.56);
            x.bezierCurveTo(0.3, 1.47, 0.16, 1.25, 0.12, 1.0);
            x.closePath();
            x.fillStyle = linear(x, 0.1, 1.2, 1.2, 0.46, [[0, '#ffffff'], [0.55, '#edf4ff'], [1, '#a9c4ee']]);
            x.fill();
            x.strokeStyle = '#4d70ad';
            x.lineWidth = 0.05;
            x.stroke();
            x.strokeStyle = 'rgba(77,112,173,0.75)';
            x.lineWidth = 0.04;
            [[0.99, 1.0, 0.6, 0.86], [0.75, 1.31, 0.46, 1.08]].forEach(p => {
                x.beginPath();
                x.moveTo(p[0], p[1]);
                x.quadraticCurveTo(p[2], p[3], 0.28, 1.0);
                x.stroke();
            });
            x.restore();
        });

        /* The gown: a bell of white cloth with folds. */
        x.beginPath();
        x.moveTo(-0.17, 0.86);
        x.bezierCurveTo(-0.34, 1.05, -0.5, 1.7, -0.8, 2.3);
        x.quadraticCurveTo(0, 2.56, 0.8, 2.3);
        x.bezierCurveTo(0.5, 1.7, 0.34, 1.05, 0.17, 0.86);
        x.closePath();
        x.fillStyle = linear(x, -0.8, 0, 0.8, 0, [[0, '#a9bddf'], [0.3, '#ffffff'], [0.62, '#f2f6ff'], [1, '#8ea5cd']]);
        x.fill();
        x.strokeStyle = '#4d70ad';
        x.lineWidth = 0.045;
        x.stroke();
        x.save();
        x.clip();
        x.strokeStyle = 'rgba(92,124,182,0.6)';
        x.lineWidth = 0.05;
        [[-0.14, -0.42], [0.14, 0.42], [-0.04, -0.12]].forEach(p => {
            x.beginPath();
            x.moveTo(p[0], 1.52);
            x.lineTo(p[1], 2.5);
            x.stroke();
        });
        /* A blue hem with a row of little stars of light. */
        x.fillStyle = '#2b5fc0';
        x.beginPath();
        x.moveTo(-1, 2.12);
        x.quadraticCurveTo(0, 2.38, 1, 2.12);
        x.lineTo(1, 2.7);
        x.lineTo(-1, 2.7);
        x.closePath();
        x.fill();
        x.fillStyle = '#ffffff';
        for (let i = -2; i <= 2; i++) dot(x, i * 0.28, 2.33 - Math.abs(i) * 0.035, 0.035);
        x.restore();

        /* Sleeves meeting at folded hands. */
        [1, -1].forEach(side => {
            x.beginPath();
            x.moveTo(side * 0.2, 0.98);
            x.quadraticCurveTo(side * 0.42, 1.2, side * 0.12, 1.42);
            x.quadraticCurveTo(side * 0.04, 1.3, side * 0.04, 1.24);
            x.quadraticCurveTo(side * 0.1, 1.14, side * 0.08, 1.0);
            x.closePath();
            x.fillStyle = side > 0 ? '#d5e0f3' : '#ffffff';
            x.fill();
            x.strokeStyle = '#6484bb';
            x.lineWidth = 0.035;
            x.stroke();
        });
        x.fillStyle = '#ffd9c2';
        dot(x, 0, 1.3, 0.085);

        /* Head, curls, closed eyes. */
        x.fillStyle = '#a4501f';
        dot(x, 0, 0.5, 0.39);
        [[-0.32, 0.72], [0.32, 0.72], [-0.38, 0.54], [0.38, 0.54]].forEach(p => dot(x, p[0], p[1], 0.12));
        const face = x.createRadialGradient(-0.08, 0.5, 0.04, 0, 0.56, 0.32);
        face.addColorStop(0, '#ffeadb');
        face.addColorStop(1, '#f6bfa0');
        x.fillStyle = face;
        dot(x, 0, 0.58, 0.29);
        x.fillStyle = '#a4501f';
        x.beginPath();
        x.arc(0, 0.5, 0.3, Math.PI * 1.02, Math.PI * 1.98);
        x.quadraticCurveTo(0.12, 0.52, 0, 0.42);
        x.quadraticCurveTo(-0.12, 0.52, -0.3, 0.5);
        x.closePath();
        x.fill();
        x.strokeStyle = '#3d2413';
        x.lineWidth = 0.04;
        [-0.13, 0.13].forEach(ex => {
            x.beginPath();
            x.arc(ex, 0.58, 0.06, 0.2, Math.PI - 0.2);
            x.stroke();
        });
        x.fillStyle = 'rgba(232,96,96,0.5)';
        [-0.17, 0.17].forEach(ex => dot(x, ex, 0.69, 0.05));

        /* The halo is the one bit of gold: it sits against white and the dark hair. */
        x.strokeStyle = '#ffe68f';
        x.lineWidth = 0.085;
        x.shadowColor = 'rgba(255,240,180,0.9)';
        x.shadowBlur = 3;
        x.beginPath();
        x.ellipse(0, 0.1, 0.36, 0.1, 0, 0, TAU);
        x.stroke();
        x.restore();
    }

    function snowman(x, top, R) {
        const u = R * 1.05;
        x.save();
        x.translate(0, top);
        x.scale(u, u);
        x.lineCap = 'round';
        x.lineJoin = 'round';

        /* Twig arms behind the body. */
        x.strokeStyle = '#3b2412';
        x.lineWidth = 0.09;
        [1, -1].forEach(side => {
            x.beginPath();
            x.moveTo(side * 0.6, 1.72);
            x.lineTo(side * 1.02, 1.4);
            x.moveTo(side * 0.86, 1.52);
            x.lineTo(side * 1.04, 1.58);
            x.stroke();
        });

        const snow = (cx, cy, r) => {
            const gr = x.createRadialGradient(cx - r * 0.34, cy - r * 0.38, r * 0.1, cx, cy, r);
            gr.addColorStop(0, '#ffffff');
            gr.addColorStop(0.62, '#eef4fd');
            gr.addColorStop(1, '#90aad4');
            x.fillStyle = gr;
            dot(x, cx, cy, r);
        };
        snow(0, 2.02, 0.76);
        snow(0, 0.94, 0.48);

        /* Scarf with a tail. */
        x.fillStyle = '#c8142c';
        x.beginPath();
        x.moveTo(-0.44, 1.26);
        x.quadraticCurveTo(0, 1.5, 0.44, 1.26);
        x.lineTo(0.46, 1.42);
        x.quadraticCurveTo(0, 1.68, -0.46, 1.42);
        x.closePath();
        x.fill();
        x.beginPath();
        x.moveTo(0.14, 1.5);
        x.lineTo(0.42, 1.46);
        x.lineTo(0.52, 2.0);
        x.lineTo(0.24, 2.04);
        x.closePath();
        x.fill();
        x.fillStyle = '#ffffff';
        x.fillRect(0.3, 1.74, 0.24, 0.07);

        /* Face and coal buttons. */
        x.fillStyle = '#10131c';
        [-0.17, 0.17].forEach(ex => dot(x, ex, 0.84, 0.06));
        [1.84, 2.14, 2.44].forEach(y => dot(x, -0.03, y, 0.075));
        x.fillStyle = '#f0701c';
        x.beginPath();
        x.moveTo(-0.02, 0.93);
        x.lineTo(0.46, 1.03);
        x.lineTo(-0.02, 1.08);
        x.closePath();
        x.fill();

        /* The hat last, sitting on the head. */
        x.fillStyle = '#12141c';
        x.beginPath();
        x.ellipse(0, 0.56, 0.54, 0.11, 0, 0, TAU);
        x.fill();
        x.fillStyle = linear(x, -0.3, 0, 0.3, 0, [[0, '#2c3244'], [0.35, '#12141c'], [1, '#0a0b10']]);
        x.fillRect(-0.3, 0, 0.6, 0.56);
        x.fillStyle = '#c8142c';
        x.fillRect(-0.3, 0.38, 0.6, 0.12);
        x.restore();
    }

    function bell(x, top, R, o) {
        const u = R * 1.14;
        const metal = o.tone === 'ruby'
            ? [[0, '#5c0814'], [0.26, '#ff6d7b'], [0.36, '#ffd8db'], [0.62, '#c2162e'], [1, '#4c0610']]
            : [[0, '#46597c'], [0.26, '#e6eefa'], [0.36, '#ffffff'], [0.62, '#a4b7d3'], [1, '#34445f']];
        x.save();
        x.translate(0, top);
        x.scale(u, u);
        x.lineCap = 'round';
        x.lineJoin = 'round';

        /* The clapper hangs below the mouth. */
        x.fillStyle = linear(x, -0.18, 0, 0.18, 0, metal);
        dot(x, 0, 2.14, 0.17);

        x.beginPath();
        x.moveTo(-0.2, 0.42);
        x.bezierCurveTo(-0.2, 0.2, 0.2, 0.2, 0.2, 0.42);
        x.bezierCurveTo(0.46, 0.56, 0.5, 0.96, 0.57, 1.28);
        x.bezierCurveTo(0.63, 1.62, 0.88, 1.76, 1, 1.94);
        x.bezierCurveTo(0.6, 2.2, -0.6, 2.2, -1, 1.94);
        x.bezierCurveTo(-0.88, 1.76, -0.63, 1.62, -0.57, 1.28);
        x.bezierCurveTo(-0.5, 0.96, -0.46, 0.56, -0.2, 0.42);
        x.closePath();
        x.fillStyle = linear(x, -1, 0, 1, 0, metal);
        x.fill();
        x.save();
        x.clip();
        x.strokeStyle = o.tone === 'ruby' ? 'rgba(255,224,226,0.85)' : 'rgba(30,46,86,0.6)';
        x.lineWidth = 0.05;
        x.beginPath();
        x.moveTo(-1, 1.62);
        x.quadraticCurveTo(0, 1.86, 1, 1.62);
        x.stroke();
        x.beginPath();
        x.moveTo(-1, 1.74);
        x.quadraticCurveTo(0, 1.98, 1, 1.74);
        x.stroke();
        x.restore();

        /* A bow where it is tied on. */
        const bowFill = o.tone === 'ruby' ? '#f4f8ff' : '#d0142c', bowEdge = o.tone === 'ruby' ? '#7f97c2' : '#7c0818';
        x.fillStyle = bowFill;
        x.strokeStyle = bowEdge;
        x.lineWidth = 0.04;
        [1, -1].forEach(side => {
            x.beginPath();
            x.moveTo(0, 0.28);
            x.bezierCurveTo(side * 0.26, 0, side * 0.66, 0.02, side * 0.62, 0.26);
            x.bezierCurveTo(side * 0.6, 0.48, side * 0.26, 0.42, 0, 0.28);
            x.closePath();
            x.fill();
            x.stroke();
            x.beginPath();
            x.moveTo(side * 0.04, 0.3);
            x.lineTo(side * 0.3, 0.72);
            x.lineTo(side * 0.14, 0.68);
            x.closePath();
            x.fill();
            x.stroke();
        });
        dot(x, 0, 0.28, 0.1);
        x.restore();
    }

    function cane(x, top, R) {
        const u = R * 1.06, w = 0.46;
        const path = () => {
            x.beginPath();
            x.moveTo(0.4, 3.0);
            x.lineTo(0.4, 0.62);
            x.arc(0, 0.62, 0.4, 0, Math.PI, true);
            x.lineTo(-0.4, 0.98);
        };
        x.save();
        x.translate(0, top);
        x.scale(u, u);
        x.lineCap = 'round';
        x.lineJoin = 'round';
        path();
        x.strokeStyle = '#7c0a1c';
        x.lineWidth = w + 0.09;
        x.stroke();
        path();
        x.strokeStyle = '#ffffff';
        x.lineWidth = w;
        x.stroke();

        /* Slanting stripes only where the white already is. */
        x.globalCompositeOperation = 'source-atop';
        x.fillStyle = '#d4142e';
        for (let i = -2; i < 9; i++) {
            const y = i * 0.46;
            x.beginPath();
            x.moveTo(-1, y + 0.3);
            x.lineTo(1, y - 0.16);
            x.lineTo(1, y + 0.06);
            x.lineTo(-1, y + 0.52);
            x.closePath();
            x.fill();
        }
        /* Roundness: the right side of the shaft turns away. */
        x.fillStyle = linear(x, 0.34, 0, 0.63, 0, [[0, 'rgba(10,14,40,0)'], [1, 'rgba(10,14,40,0.34)']]);
        x.fillRect(0.17, 0.62, 0.46, 2.6);
                x.restore();
    }

    function mitten(x, top, R, o) {
        const u = R * 1.12, knit = o.tone === 'blue' ? ['#3f79e0', '#163a94', '#0d2566'] : ['#ec3145', '#ae1228', '#6e0a18'];
        x.save();
        x.translate(0, top);
        x.scale(u, u);
        x.lineJoin = 'round';
        x.lineCap = 'round';

        x.beginPath();
        x.moveTo(-0.6, 0.44);
        x.lineTo(-0.66, 1.34);
        x.bezierCurveTo(-0.7, 1.86, -0.42, 2.26, 0, 2.26);
        x.bezierCurveTo(0.42, 2.26, 0.66, 1.9, 0.64, 1.4);
        x.lineTo(0.63, 1.22);
        x.bezierCurveTo(0.84, 1.38, 1.1, 1.2, 1.04, 0.96);
        x.bezierCurveTo(0.98, 0.76, 0.78, 0.7, 0.62, 0.84);
        x.lineTo(0.6, 0.44);
        x.closePath();
        x.fillStyle = linear(x, -0.7, 0, 1.04, 0, [[0, knit[1]], [0.3, knit[0]], [0.76, knit[1]], [1, knit[2]]]);
        x.fill();
        x.strokeStyle = knit[2];
        x.lineWidth = 0.05;
        x.stroke();

        /* A knitted snowflake with a row of dots above it. */
        x.strokeStyle = '#ffffff';
        x.lineWidth = 0.075;
        flakePath(x, -0.03, 1.5, 0.42);
        x.stroke();
        x.fillStyle = '#ffffff';
        for (let i = -2; i <= 2; i++) dot(x, i * 0.24, 0.8, 0.055);

        /* Fluffy white cuff, where it hangs from. */
        x.beginPath();
        x.moveTo(-0.72, 0.1);
        x.quadraticCurveTo(-0.78, 0, -0.66, 0);
        x.lineTo(0.66, 0);
        x.quadraticCurveTo(0.78, 0, 0.72, 0.1);
        x.lineTo(0.7, 0.46);
        x.quadraticCurveTo(0.7, 0.56, 0.6, 0.56);
        x.lineTo(-0.6, 0.56);
        x.quadraticCurveTo(-0.7, 0.56, -0.7, 0.46);
        x.closePath();
        x.fillStyle = linear(x, -0.72, 0, 0.72, 0, [[0, '#c9d8ef'], [0.3, '#ffffff'], [1, '#a9bedf']]);
        x.fill();
        x.strokeStyle = 'rgba(96,126,180,0.75)';
        x.lineWidth = 0.04;
        for (let i = -3; i <= 3; i++) {
            x.beginPath();
            x.moveTo(i * 0.19, 0.08);
            x.lineTo(i * 0.19, 0.48);
            x.stroke();
        }
        x.restore();
    }

    /* ---------- From the cinema: this tree stands in a film theatre ---------- */

    function popcorn(x, top, R, o) {
        const u = R * 1.08, r = rng(o.seed);
        x.save();
        x.translate(0, top);
        x.scale(u, u);

        /* The kernels behind the rim, then the striped tub in front. */
        const kernels = [[0, 0.24], [-0.34, 0.38], [0.34, 0.36], [-0.6, 0.66], [-0.2, 0.62], [0.2, 0.6], [0.58, 0.64], [0, 0.82], [-0.42, 0.84], [0.42, 0.84]];
        kernels.forEach(p => {
            const q = 0.2 + r() * 0.05;
            const gr = x.createRadialGradient(p[0] - q * 0.3, p[1] - q * 0.3, q * 0.1, p[0], p[1], q);
            gr.addColorStop(0, '#ffffff');
            gr.addColorStop(0.7, '#fff6e2');
            gr.addColorStop(1, '#d9bf92');
            x.fillStyle = gr;
            [[0, 0], [q * 0.56, q * 0.3], [-q * 0.5, q * 0.32]].forEach(b => dot(x, p[0] + b[0], p[1] + b[1], q * 0.72));
        });

        x.beginPath();
        x.moveTo(-0.78, 0.92);
        x.lineTo(0.78, 0.92);
        x.lineTo(0.54, 2.4);
        x.quadraticCurveTo(0, 2.5, -0.54, 2.4);
        x.closePath();
        x.save();
        x.clip();
        x.fillStyle = '#ffffff';
        x.fillRect(-1, 0.8, 2, 1.8);
        x.fillStyle = '#d4142e';
        for (let i = -3; i <= 3; i += 2) {
            const q = i / 7;
            x.beginPath();
            x.moveTo(q * 1.56 - 0.11, 0.9);
            x.lineTo(q * 1.56 + 0.11, 0.9);
            x.lineTo(q * 1.08 + 0.076, 2.5);
            x.lineTo(q * 1.08 - 0.076, 2.5);
            x.closePath();
            x.fill();
        }
        x.fillStyle = linear(x, -0.8, 0, 0.8, 0, [[0, 'rgba(10,14,40,0.32)'], [0.28, 'rgba(10,14,40,0)'], [0.66, 'rgba(10,14,40,0)'], [1, 'rgba(10,14,40,0.46)']]);
        x.fillRect(-1, 0.8, 2, 1.8);
        x.restore();
        x.strokeStyle = '#7c0a1c';
        x.lineWidth = 0.05;
        x.beginPath();
        x.moveTo(-0.78, 0.92);
        x.lineTo(0.78, 0.92);
        x.lineTo(0.54, 2.4);
        x.quadraticCurveTo(0, 2.5, -0.54, 2.4);
        x.closePath();
        x.stroke();
        x.restore();
    }

    function clapper(x, top, R) {
        const u = R * 1.16;
        x.save();
        x.translate(0, top);
        x.scale(u, u);
        x.lineJoin = 'round';

        const stripes = (y0, y1) => {
            x.save();
            x.beginPath();
            x.rect(-1, y0, 2, y1 - y0);
            x.clip();
            x.fillStyle = '#10121a';
            x.fillRect(-1, y0, 2, y1 - y0);
            x.fillStyle = '#ffffff';
            for (let i = -3; i <= 3; i++) {
                const bx = i * 0.46;
                x.beginPath();
                x.moveTo(bx, y0);
                x.lineTo(bx + 0.23, y0);
                x.lineTo(bx + 0.11, y1);
                x.lineTo(bx - 0.12, y1);
                x.closePath();
                x.fill();
            }
            x.restore();
        };

        /* The open stick, hinged on the left. */
        x.save();
        x.translate(-0.96, 0.66);
        x.rotate(-0.2);
        x.translate(0.96, -0.66);
        stripes(0.34, 0.64);
        x.strokeStyle = '#f2f5fb';
        x.lineWidth = 0.04;
        x.strokeRect(-1, 0.34, 2, 0.3);
        x.restore();

        /* The slate. */
        stripes(0.7, 0.98);
        x.fillStyle = linear(x, 0, 0.98, 0, 2.06, [[0, '#23262f'], [1, '#0c0d13']]);
        x.fillRect(-1, 0.98, 2, 1.08);
        x.strokeStyle = '#f2f5fb';
        x.lineWidth = 0.05;
        x.strokeRect(-1, 0.7, 2, 1.36);

        /* The white Play window from our own logo. */
        x.fillStyle = '#f4f7fd';
        x.beginPath();
        x.moveTo(-0.26, 1.2);
        x.lineTo(0.34, 1.52);
        x.lineTo(-0.26, 1.84);
        x.closePath();
        x.fill();
        x.restore();
    }

    function reel(x, top, R) {
        const r = R * 1.14, cy = top + r;
        const gr = x.createRadialGradient(-r * 0.3, cy - r * 0.4, r * 0.1, 0, cy, r);
        gr.addColorStop(0, '#ffffff');
        gr.addColorStop(0.55, '#c6d4ea');
        gr.addColorStop(1, '#5c7096');
        x.fillStyle = gr;
        dot(x, 0, cy, r);
        x.strokeStyle = '#34445f';
        x.lineWidth = Math.max(0.6, R * 0.09);
        x.beginPath();
        x.arc(0, cy, r * 0.94, 0, TAU);
        x.stroke();
        /* Real holes: the tree shows through them. */
        x.save();
        x.globalCompositeOperation = 'destination-out';
        x.fillStyle = '#000000';
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + i * TAU / 5;
            dot(x, Math.cos(a) * r * 0.54, cy + Math.sin(a) * r * 0.54, r * 0.24);
        }
        x.restore();
        x.strokeStyle = 'rgba(40,54,84,0.9)';
        x.lineWidth = Math.max(0.5, R * 0.05);
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + i * TAU / 5;
            x.beginPath();
            x.arc(Math.cos(a) * r * 0.54, cy + Math.sin(a) * r * 0.54, r * 0.25, 0, TAU);
            x.stroke();
        }
        x.fillStyle = '#34445f';
        dot(x, 0, cy, r * 0.14);
        x.fillStyle = '#eef3fb';
        dot(x, 0, cy, r * 0.06);
    }

    /* ---------- Sprites ---------- */

    /* Sizes in ornament radii. `hung` shapes wear a little metal cap, `flat` ones turn slowly. */
    const SHAPES = {
        ball: { halfW: 1, tall: 2, hung: true, paint: ball, glass: true },
        icicle: { halfW: 0.7, tall: 3.6, hung: true, paint: icicle },
        cone: { halfW: 1, tall: 2.5, hung: true, paint: cone },
        star: { halfW: 1.3, tall: 2.6, flat: true, paint: star },
        snowflake: { halfW: 1.45, tall: 2.9, flat: true, paint: snowflake },
        reel: { halfW: 1.16, tall: 2.3, flat: true, paint: reel },
        angel: { halfW: 1.7, tall: 3.42, paint: angel },
        snowman: { halfW: 1.14, tall: 2.98, paint: snowman },
        bell: { halfW: 1.16, tall: 2.66, paint: bell, glass: true },
        cane: { halfW: 0.74, tall: 3.42, paint: cane },
        mitten: { halfW: 1.2, tall: 2.56, paint: mitten },
        popcorn: { halfW: 0.92, tall: 2.72, paint: popcorn },
        clapper: { halfW: 1.18, tall: 2.42, paint: clapper }
    };

    const PAD = 5;

    function sprite(o, scale) {
        const shape = SHAPES[o.type], R = o.R;
        const capH = shape.hung ? R * 0.36 : 0;
        const tall = shape.tall * R;
        const w = Math.ceil(shape.halfW * R * 2 + PAD * 2), h = Math.ceil(PAD + o.len + capH + tall + PAD);
        const art = document.createElement('canvas');
        art.width = Math.ceil(w * scale);
        art.height = Math.ceil(h * scale);
        const x = art.getContext('2d');
        x.scale(scale, scale);
        x.translate(w / 2, PAD);

        const top = o.len + capH - 1;
        x.save();
        shape.paint(x, top, R, o);
        x.restore();

        /* A little warm light from the tree falls on one side, and only on the ornament itself. */
        x.save();
        x.globalCompositeOperation = 'source-atop';
        const bx = R * 0.55, by = top + tall * 0.78;
        const bounce = x.createRadialGradient(bx, by, 0, bx, by, R * 1.1);
        bounce.addColorStop(0, 'rgba(255,186,120,0.24)');
        bounce.addColorStop(1, 'rgba(255,186,120,0)');
        x.fillStyle = bounce;
        x.fillRect(-w / 2, 0, w, h);
        x.restore();

        x.strokeStyle = 'rgba(232,238,248,0.8)';
        x.lineWidth = 0.6;
        x.beginPath();
        x.moveTo(0, 0);
        x.lineTo(0, o.len + 1);
        x.stroke();
        if (capH) {
            const cw = R * 0.64;
            x.fillStyle = linear(x, -cw / 2, 0, cw / 2, 0, [[0, '#5a6b8c'], [0.42, '#f4f8ff'], [1, '#4b5a78']]);
            x.fillRect(-cw / 2, o.len, cw, capH);
            x.fillStyle = 'rgba(16,24,46,0.5)';
            for (let i = 1; i < 3; i++) x.fillRect(-cw / 2, o.len + capH * i / 3, cw, Math.max(0.4, capH * 0.08));
        }

        /* A soft dark edge keeps the shape apart from the glowing needles behind it. */
        const c = document.createElement('canvas');
        c.width = art.width;
        c.height = art.height;
        const f = c.getContext('2d');
        f.shadowColor = 'rgba(2,8,10,0.72)';
        f.shadowBlur = 3.4 * scale;
        f.shadowOffsetY = 1.1 * scale;
        f.drawImage(art, 0, 0);
        return {
            canvas: c, ox: w / 2, oy: PAD, w, h,
            flat: !!shape.flat,
            inFront: !shape.hung,
            bodyHalfW: shape.halfW * R, bodyTop: top, bodyH: tall,
            glass: !!shape.glass
        };
    }

    /* Who hangs where, slot by slot from the top of the tree down. Neighbors differ in shape
       and color. The slots past the list are behind the gifts, where plain glass is enough. */
    const B = (tone, deco) => ({ type: 'ball', tone, deco: deco || 'plain' });
    const T = (type, tone) => ({ type, tone });
    const ARRANGEMENT = [
        B('pearl'),
        B('ruby'), T('snowflake'),
        T('reel'), T('angel'),
        T('bell', 'ruby'), B('violet', 'dots'), T('cane'),
        T('mitten', 'blue'), T('bell', 'silver'), T('snowman'),
        T('clapper'), T('star'),
        T('cone'), T('icicle'), T('angel'), B('blue', 'stars'), T('popcorn'),
        B('teal', 'dots'), B('berry', 'stripes'), B('violet', 'frost')
    ];
    const SPARE = [B('ruby'), B('blue', 'stars'), B('pearl', 'band'), B('violet'), B('silver', 'flake'), B('berry'), B('teal', 'dots')];

    /* Angels are the largest: nothing hangs in front of them. */
    function dress(slots) {
        return slots.map((slot, i) => Object.assign({}, slot, ARRANGEMENT[i] || SPARE[i % SPARE.length]))
            .sort((a, b) => (a.type === 'angel' ? 1 : 0) - (b.type === 'angel' ? 1 : 0) || a.y - b.y);
    }

    g.NyOrnaments = { GLASS, sprite, dress, types: () => Object.keys(SHAPES) };
})(window);
