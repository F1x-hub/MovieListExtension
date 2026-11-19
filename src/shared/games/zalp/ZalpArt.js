import { Z } from './ZalpCore.js';
// Procedural sprite atlas: every sprite is drawn with Canvas 2D once at startup, packed, then uploaded to WebGL.
// Sizes are in world units; the atlas stores them at S pixels per unit so zooming in stays crisp.
Z.Art = (function () {
    const S = 3;
    const TAU = Math.PI * 2;
    const defs = {};
    const def = (name, w, h, ax, ay, draw) => { defs[name] = { w, h, ax, ay, draw }; };

    const ell = (c, x, y, rx, ry) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); };
    const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
    const ink = 'rgba(18,18,28,0.92)';
    const stroke = (c, w = 0.9, s = ink) => { c.lineWidth = w; c.strokeStyle = s; c.stroke(); };
    const fill = (c, s) => { c.fillStyle = s; c.fill(); };
    const lin = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };

    // ---------------------------------------------------------------- fighter (all share a 24x24 box, centre at 12,13.5)
    const BX = 0.5, BY = 13.5 / 24;
    def('body', 24, 24, BX, BY, (c) => {
        const g = c.createRadialGradient(8.5, 8, 1.5, 12, 13.5, 12.5);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#e4e4e4'); g.addColorStop(1, '#8f8f8f');
        ell(c, 12, 13.5, 10.2, 9.8); fill(c, g); stroke(c, 1.1);
    });
    const feet = (a, b) => (c) => {
        c.fillStyle = '#2b2420';
        ell(c, a[0], a[1], 3.3, 1.9); c.fill();
        ell(c, b[0], b[1], 3.3, 1.9); c.fill();
    };
    def('feet0', 24, 24, BX, BY, feet([8, 22.6], [16.5, 22.6]));
    def('feet1', 24, 24, BX, BY, feet([5.8, 22.2], [17.8, 22.9]));
    def('feet2', 24, 24, BX, BY, feet([9.8, 22.9], [14.2, 22.2]));
    const belly = (c) => { ell(c, 12.8, 18.4, 5.4, 3.7); fill(c, 'rgba(255,244,222,0.95)'); };
    const eye = (c, x, y, px, py) => {
        ell(c, x, y, 2.6, 3.1); fill(c, '#fff'); stroke(c, 0.7);
        ell(c, x + px, y + py, 1.35, 1.5); fill(c, '#16121c');
        ell(c, x + px - 0.5, y + py - 0.7, 0.45, 0.45); fill(c, '#fff');
    };
    def('face', 24, 24, BX, BY, (c) => {
        belly(c); eye(c, 13.2, 10.6, 0.9, 0.5); eye(c, 18.4, 10.8, 0.8, 0.5);
        c.beginPath(); c.arc(16.6, 14.2, 1.6, 0.2, Math.PI - 0.2); stroke(c, 0.7);
    });
    def('face_blink', 24, 24, BX, BY, (c) => {
        belly(c);
        c.beginPath(); c.moveTo(10.8, 11); c.quadraticCurveTo(13.2, 12.4, 15.6, 11); stroke(c, 0.9);
        c.beginPath(); c.moveTo(16, 11.2); c.quadraticCurveTo(18.4, 12.6, 20.8, 11.2); stroke(c, 0.9);
        c.beginPath(); c.arc(16.6, 14.2, 1.6, 0.2, Math.PI - 0.2); stroke(c, 0.7);
    });
    def('face_hurt', 24, 24, BX, BY, (c) => {
        belly(c);
        const x = (cx, cy) => { c.beginPath(); c.moveTo(cx - 1.7, cy - 1.7); c.lineTo(cx + 1.7, cy + 1.7); c.moveTo(cx + 1.7, cy - 1.7); c.lineTo(cx - 1.7, cy + 1.7); stroke(c, 1); };
        x(13.2, 10.8); x(18.4, 11);
        ell(c, 16.6, 15, 1.4, 1.7); fill(c, '#3a1418');
    });
    def('face_aim', 24, 24, BX, BY, (c) => {
        belly(c); eye(c, 13.2, 10.8, 1.1, 0.2); eye(c, 18.4, 11, 1.0, 0.2);
        c.beginPath(); c.moveTo(10.6, 7.6); c.lineTo(15.2, 8.6); c.moveTo(16.2, 8.6); c.lineTo(20.6, 7.8); stroke(c, 0.9);
        c.beginPath(); c.moveTo(15.4, 15); c.lineTo(18.2, 14.6); stroke(c, 0.7);
    });
    def('helmet', 24, 24, BX, BY, (c) => {
        c.beginPath(); c.arc(11.4, 8.6, 8.4, Math.PI, TAU); c.closePath();
        fill(c, lin(c, 0, 0, 0, 9, [[0, '#7f8f52'], [1, '#4c5a2c']])); stroke(c, 0.9);
        rr(c, 1.6, 7.8, 21.4, 2.1, 1); fill(c, '#3f4a24'); stroke(c, 0.7);
        ell(c, 8.4, 4.2, 2.4, 1.1); fill(c, 'rgba(255,255,255,0.28)');
    });
    def('grave', 14, 18, 0.5, 1, (c) => {
        c.beginPath(); c.moveTo(1.5, 17.5); c.lineTo(1.5, 6.5); c.arc(7, 6.5, 5.5, Math.PI, TAU); c.lineTo(12.5, 17.5); c.closePath();
        fill(c, lin(c, 0, 0, 14, 0, [[0, '#f2f2f2'], [1, '#a7a7a7']])); stroke(c, 0.9);
        c.fillStyle = 'rgba(40,40,50,0.55)'; c.fillRect(6.2, 4.5, 1.6, 8); c.fillRect(4, 6.8, 6, 1.5);
        c.fillStyle = 'rgba(60,110,40,0.85)'; c.fillRect(0.5, 16.6, 13, 1.4);
    });

    // ---------------------------------------------------------------- held weapons (point right, anchor = grip)
    def('w_rocket', 30, 12, 0.36, 0.5, (c) => {
        c.beginPath(); c.moveTo(0.5, 2.5); c.lineTo(4.5, 4); c.lineTo(4.5, 8); c.lineTo(0.5, 9.5); c.closePath(); fill(c, '#3c4a26'); stroke(c, 0.7);
        rr(c, 4, 3.6, 24.5, 4.8, 1.2); fill(c, lin(c, 0, 3.6, 0, 8.4, [[0, '#93ad5c'], [1, '#4f6a2c']])); stroke(c, 0.8);
        c.fillStyle = '#e8c33a'; c.fillRect(22.5, 3.6, 2, 4.8);
        rr(c, 10, 1.2, 5, 2.4, 0.6); fill(c, '#2c3320');
        rr(c, 9, 8.2, 3, 3.3, 0.6); fill(c, '#2c3320');
    });
    def('w_homing', 30, 12, 0.36, 0.5, (c) => {
        c.beginPath(); c.moveTo(0.5, 2.5); c.lineTo(4.5, 4); c.lineTo(4.5, 8); c.lineTo(0.5, 9.5); c.closePath(); fill(c, '#3b2c63'); stroke(c, 0.7);
        rr(c, 4, 3.6, 24.5, 4.8, 1.2); fill(c, lin(c, 0, 3.6, 0, 8.4, [[0, '#a98cf5'], [1, '#5a3fae']])); stroke(c, 0.8);
        ell(c, 17, 6, 1.9, 1.9); fill(c, '#ffe066'); ell(c, 17, 6, 0.8, 0.8); fill(c, '#d6336c');
        rr(c, 9, 8.2, 3, 3.3, 0.6); fill(c, '#2a2240');
    });
    def('w_shotgun', 30, 10, 0.32, 0.55, (c) => {
        c.beginPath(); c.moveTo(0.5, 4.2); c.lineTo(9.5, 3.2); c.lineTo(10, 6.4); c.lineTo(1.8, 8.8); c.closePath(); fill(c, '#8a5a2b'); stroke(c, 0.7);
        rr(c, 9, 2.6, 20.5, 2.4, 0.7); fill(c, lin(c, 0, 2.6, 0, 5, [[0, '#c9ced6'], [1, '#6b7280']])); stroke(c, 0.6);
        rr(c, 13.5, 5, 7, 2.4, 0.8); fill(c, '#6d4320'); stroke(c, 0.6);
    });
    def('w_hammer', 30, 18, 0.1, 0.62, (c) => {
        rr(c, 0.5, 10, 21, 2.6, 1.2); fill(c, lin(c, 0, 10, 0, 12.6, [[0, '#c48b4f'], [1, '#7a4f22']])); stroke(c, 0.6);
        rr(c, 19, 2.5, 10, 15, 1.6); fill(c, lin(c, 19, 0, 29, 0, [[0, '#d5dae2'], [1, '#737b88']])); stroke(c, 0.9);
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(20.5, 4, 1.4, 12);
    });
    def('w_air', 16, 18, 0.3, 0.62, (c) => {
        c.fillStyle = '#20242b'; c.fillRect(10.4, 0.5, 1.2, 7);
        rr(c, 3, 6, 10, 11.5, 1.6); fill(c, '#3b4350'); stroke(c, 0.8);
        rr(c, 4.6, 7.6, 6.8, 4, 0.8); fill(c, '#9fe3a8');
        ell(c, 6.2, 14.6, 1.2, 1.2); fill(c, '#ff5b4f'); ell(c, 9.8, 14.6, 1.2, 1.2); fill(c, '#ffc23d');
    });
    def('w_tele', 26, 12, 0.3, 0.5, (c) => {
        rr(c, 0.5, 4.6, 17, 2.8, 1.2); fill(c, lin(c, 0, 4.6, 0, 7.4, [[0, '#9aa4b3'], [1, '#4b5361']])); stroke(c, 0.6);
        const g = c.createRadialGradient(21, 6, 0.5, 21, 6, 5); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#7ff3ff'); g.addColorStop(1, 'rgba(60,180,255,0)');
        ell(c, 21, 6, 5, 5); fill(c, g);
    });
    def('w_skip', 22, 22, 0.12, 0.92, (c) => {
        c.fillStyle = '#7a4f22'; c.fillRect(1.5, 1, 1.4, 20.5);
        c.beginPath(); c.moveTo(2.9, 2); c.quadraticCurveTo(10, -0.5, 13, 3); c.quadraticCurveTo(17, 6.5, 21, 4.5); c.lineTo(21, 12); c.quadraticCurveTo(17, 14, 13, 10.5); c.quadraticCurveTo(10, 7.5, 2.9, 10); c.closePath();
        fill(c, '#f7f7f2'); stroke(c, 0.7);
    });

    // ---------------------------------------------------------------- projectiles (point right, centred)
    const missile = (body, nose, fin) => (c) => {
        c.beginPath(); c.moveTo(1, 0.8); c.lineTo(5, 2.8); c.lineTo(5, 5.2); c.lineTo(1, 7.2); c.closePath(); fill(c, fin); stroke(c, 0.6);
        rr(c, 3.5, 2.2, 10, 3.6, 1); fill(c, body); stroke(c, 0.6);
        c.beginPath(); c.moveTo(13.4, 2.2); c.quadraticCurveTo(17.6, 4, 13.4, 5.8); c.closePath(); fill(c, nose); stroke(c, 0.6);
    };
    def('p_rocket', 18, 8, 0.5, 0.5, missile('#eef0f2', '#e2443a', '#4b5563'));
    def('p_homing', 18, 8, 0.5, 0.5, missile('#a98cf5', '#ffd43b', '#3b2c63'));
    def('p_bomb', 18, 8, 0.5, 0.5, missile('#59673a', '#3c4527', '#2b3220'));
    def('p_grenade', 10, 12, 0.5, 0.58, (c) => {
        ell(c, 5, 7.2, 4, 4.4); fill(c, lin(c, 1, 3, 9, 11, [[0, '#8fc25a'], [1, '#3f6a22']])); stroke(c, 0.7);
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(1.2, 7.2); c.lineTo(8.8, 7.2); c.moveTo(5, 2.9); c.lineTo(5, 11.5); c.stroke();
        rr(c, 3.3, 1.2, 3.4, 2.2, 0.5); fill(c, '#55606e'); stroke(c, 0.5);
        c.beginPath(); c.moveTo(6.6, 1.8); c.quadraticCurveTo(9.6, 2.4, 8.4, 6); stroke(c, 0.8, '#9aa4b3');
    });
    def('p_cluster', 11, 12, 0.5, 0.58, (c) => {
        ell(c, 5.5, 7.2, 4.6, 4.5); fill(c, lin(c, 1, 3, 9, 11, [[0, '#ff9b6b'], [1, '#b23a1f']])); stroke(c, 0.7);
        c.fillStyle = 'rgba(255,240,200,0.8)'; [[3.6, 6.2], [6.8, 5.4], [5.4, 8.8], [7.8, 8.4]].forEach(([x, y]) => { ell(c, x, y, 0.8, 0.8); c.fill(); });
        rr(c, 3.8, 1.2, 3.4, 2.2, 0.5); fill(c, '#55606e'); stroke(c, 0.5);
    });
    def('p_bomblet', 6, 6, 0.5, 0.5, (c) => { ell(c, 3, 3, 2.4, 2.4); fill(c, '#3a2d28'); stroke(c, 0.5); ell(c, 2.2, 2.2, 0.8, 0.8); fill(c, '#ffb070'); });
    def('p_dyn', 8, 18, 0.5, 0.6, (c) => {
        c.beginPath(); c.moveTo(4, 4); c.quadraticCurveTo(6.5, 2, 5, 0.5); stroke(c, 0.7, '#d9d2c5');
        rr(c, 1.2, 3.6, 5.6, 13.8, 1.2); fill(c, lin(c, 1, 0, 7, 0, [[0, '#ff6b5b'], [1, '#a61e14']])); stroke(c, 0.7);
        c.fillStyle = '#f1e4c4'; c.fillRect(1.2, 8, 5.6, 1.4); c.fillRect(1.2, 12.4, 5.6, 1.4);
    });
    const mine = (light) => (c) => {
        c.beginPath(); c.moveTo(0.8, 7.4); c.quadraticCurveTo(1.4, 1.4, 7, 1.2); c.quadraticCurveTo(12.6, 1.4, 13.2, 7.4); c.closePath();
        fill(c, lin(c, 0, 1, 0, 7.4, [[0, '#6b7280'], [1, '#2d3340']])); stroke(c, 0.7);
        ell(c, 7, 2.3, 1.3, 1); fill(c, light);
    };
    def('p_mine', 14, 8, 0.5, 0.92, mine('#5b1a1a'));
    def('p_mine_on', 14, 8, 0.5, 0.92, mine('#ff3b30'));
    def('plane', 64, 26, 0.5, 0.5, (c) => {
        c.fillStyle = '#40505f';
        c.beginPath(); c.moveTo(2, 7); c.lineTo(9, 7); c.lineTo(13, 12); c.lineTo(4, 12); c.closePath(); c.fill(); stroke(c, 0.7);
        ell(c, 31, 13, 26, 5.6); fill(c, lin(c, 0, 7, 0, 19, [[0, '#a7b6c4'], [1, '#4c5b6b']])); stroke(c, 0.8);
        c.beginPath(); c.moveTo(24, 13); c.lineTo(38, 13); c.lineTo(30, 24.5); c.lineTo(22, 24.5); c.closePath(); fill(c, '#5b6b7b'); stroke(c, 0.7);
        ell(c, 44, 10.5, 5, 2.6); fill(c, 'rgba(180,230,255,0.85)'); stroke(c, 0.6);
        ell(c, 59, 13, 1.4, 9); fill(c, 'rgba(220,220,220,0.35)');
    });
    def('crate_hp', 18, 18, 0.5, 0.5, (c) => {
        rr(c, 1, 1, 16, 16, 2); fill(c, lin(c, 0, 1, 0, 17, [[0, '#ffffff'], [1, '#cfd6df']])); stroke(c, 0.9);
        c.beginPath(); c.moveTo(9, 13.6); c.bezierCurveTo(2.4, 9.4, 4.2, 4, 9, 6.6); c.bezierCurveTo(13.8, 4, 15.6, 9.4, 9, 13.6); fill(c, '#ef4444'); stroke(c, 0.6);
    });
    def('crate_w', 18, 18, 0.5, 0.5, (c) => {
        rr(c, 1, 1, 16, 16, 1.6); fill(c, lin(c, 0, 1, 0, 17, [[0, '#d59a57'], [1, '#8d5a26']])); stroke(c, 0.9);
        c.fillStyle = 'rgba(60,30,10,0.45)'; c.fillRect(1, 5, 16, 1.2); c.fillRect(1, 11.8, 16, 1.2);
        c.font = '900 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffe066'; c.fillText('?', 9, 9.4);
        c.lineWidth = 0.6; c.strokeStyle = '#3a2008'; c.strokeText('?', 9, 9.4);
    });
    def('chute', 30, 24, 0.5, 1, (c) => {
        c.beginPath(); c.moveTo(1, 9); c.quadraticCurveTo(15, -5, 29, 9); c.quadraticCurveTo(22, 6, 15, 9); c.quadraticCurveTo(8, 6, 1, 9); c.closePath();
        fill(c, lin(c, 1, 0, 29, 0, [[0, '#ff6b5b'], [0.33, '#ff6b5b'], [0.33, '#f8f8f8'], [0.66, '#f8f8f8'], [0.66, '#ff6b5b'], [1, '#ff6b5b']])); stroke(c, 0.7);
        c.beginPath(); c.moveTo(1.5, 9); c.lineTo(15, 23.5); c.moveTo(15, 9); c.lineTo(15, 23.5); c.moveTo(28.5, 9); c.lineTo(15, 23.5); stroke(c, 0.4, 'rgba(30,30,30,0.7)');
    });

    // ---------------------------------------------------------------- effects (white, tinted at draw time)
    def('soft', 16, 16, 0.5, 0.5, (c) => {
        const g = c.createRadialGradient(8, 8, 0, 8, 8, 8); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, 16, 16);
    });
    def('smoke', 16, 16, 0.5, 0.5, (c) => {
        [[8, 8, 6.5, 0.55], [5.5, 9, 4, 0.5], [10.5, 6.5, 4.2, 0.5], [9, 10.5, 3.8, 0.45]].forEach(([x, y, r, a]) => {
            const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = g; c.fillRect(0, 0, 16, 16);
        });
    });
    def('ring', 32, 32, 0.5, 0.5, (c) => { c.beginPath(); c.arc(16, 16, 13.5, 0, TAU); c.lineWidth = 2.6; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke(); });
    def('spark', 16, 4, 0.5, 0.5, (c) => {
        const g = c.createRadialGradient(8, 2, 0, 8, 2, 8); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.save(); c.scale(1, 0.25); c.fillRect(0, 0, 16, 16); c.restore();
    });
    def('sq', 4, 4, 0.5, 0.5, (c) => { c.fillStyle = '#fff'; c.fillRect(0.4, 0.4, 3.2, 3.2); });
    def('dot', 4, 4, 0.5, 0.5, (c) => { ell(c, 2, 2, 1.8, 1.8); fill(c, '#fff'); });
    def('cross', 20, 20, 0.5, 0.5, (c) => {
        for (const [col, w] of [['rgba(0,0,0,0.6)', 2.6], ['#fff', 1.3]]) {
            c.lineWidth = w; c.strokeStyle = col;
            for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(10, 10, 6.5, i * Math.PI / 2 + 0.35, (i + 1) * Math.PI / 2 - 0.35); c.stroke(); }
            c.beginPath(); c.moveTo(10, 1); c.lineTo(10, 5); c.moveTo(10, 15); c.lineTo(10, 19); c.moveTo(1, 10); c.lineTo(5, 10); c.moveTo(15, 10); c.lineTo(19, 10); c.stroke();
        }
        ell(c, 10, 10, 1.1, 1.1); fill(c, '#fff');
    });
    def('arrow', 14, 14, 0.5, 1, (c) => {
        c.beginPath(); c.moveTo(4.5, 1); c.lineTo(9.5, 1); c.lineTo(9.5, 6); c.lineTo(13, 6); c.lineTo(7, 13); c.lineTo(1, 6); c.lineTo(4.5, 6); c.closePath();
        fill(c, '#fff'); stroke(c, 0.9);
    });
    def('star', 16, 16, 0.5, 0.5, (c) => {
        const g = c.createRadialGradient(8, 8, 0, 8, 8, 8); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.beginPath(); c.moveTo(8, 0); c.quadraticCurveTo(8.6, 7.4, 16, 8); c.quadraticCurveTo(8.6, 8.6, 8, 16); c.quadraticCurveTo(7.4, 8.6, 0, 8); c.quadraticCurveTo(7.4, 7.4, 8, 0); c.fill();
    });

    function build() {
        const cv = document.createElement('canvas');
        cv.width = 1024; cv.height = 1024;
        const ctx = cv.getContext('2d');
        const frames = {};
        let x = 2, y = 2, rowH = 0;
        for (const [name, d] of Object.entries(defs)) {
            const pw = Math.ceil(d.w * S) + 2, ph = Math.ceil(d.h * S) + 2;
            if (x + pw + 2 > cv.width) { x = 2; y += rowH + 3; rowH = 0; }
            ctx.save(); ctx.translate(x + 1, y + 1); ctx.scale(S, S);
            ctx.beginPath(); ctx.rect(0, 0, d.w, d.h); ctx.clip();
            d.draw(ctx, d.w, d.h);
            ctx.restore();
            frames[name] = {
                w: d.w, h: d.h, ax: d.ax, ay: d.ay,
                u0: (x + 1.5) / cv.width, v0: (y + 1.5) / cv.height,
                u1: (x + 0.5 + d.w * S) / cv.width, v1: (y + 0.5 + d.h * S) / cv.height,
            };
            x += pw + 3; rowH = Math.max(rowH, ph);
        }
        return { canvas: cv, frames };
    }

    const iconCache = {};
    function icon(name, size = 64) {
        if (iconCache[name]) return iconCache[name];
        const d = defs[name];
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const c = cv.getContext('2d');
        const k = (size * 0.78) / Math.max(d.w, d.h);
        c.translate(size / 2 - (d.w * k) / 2, size / 2 - (d.h * k) / 2);
        c.scale(k, k);
        c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 3; c.shadowOffsetY = 1.2;
        d.draw(c, d.w, d.h);
        return (iconCache[name] = cv.toDataURL());
    }

    return { build, icon, S };
})();
