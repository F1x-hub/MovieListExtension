import { Z } from './ZalpCore.js';
// Particles, fighters, graves, supply crates and the shared explosion rules.

// ---------------------------------------------------------------- particles
Z.Particles = class {
    constructor() { this.list = []; }
    add(p) {
        if (this.list.length > 2600) return;
        this.list.push(Object.assign({ vx: 0, vy: 0, life: 1, s0: 1, s1: 1, a0: 1, a1: 0, col: [1, 1, 1], col1: null, frame: 'soft', add: false, grav: 0, drag: 0, rot: 0, vr: 0, collide: false, align: false }, p, { max: p.life || 1 }));
    }
    update(dt, world) {
        const L = this.list;
        for (let i = L.length - 1; i >= 0; i--) {
            const p = L[i];
            p.life -= dt;
            if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
            p.vy += p.grav * dt;
            if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
            const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
            if (p.collide && world.solid(nx, ny)) { p.vy *= -0.35; p.vx *= 0.6; p.vr *= 0.5; }
            else { p.x = nx; p.y = ny; }
            p.rot += p.vr * dt;
        }
    }
    draw(R, add) {
        for (const p of this.list) {
            if (p.add !== add) continue;
            const t = 1 - p.life / p.max;
            const s = p.s0 + (p.s1 - p.s0) * t;
            const a = p.a0 + (p.a1 - p.a0) * t;
            const col = p.col1 ? Z.mix3(p.col, p.col1, t) : p.col;
            const rot = p.align ? Math.atan2(p.vy, p.vx) : p.rot;
            R.spr(p.frame, p.x, p.y, s * (p.sx || 1), s, rot, col, a, add);
        }
    }
};

Z.FX = {
    explosion(g, x, y, r, removed) {
        const P = g.fx, k = r / 16, th = g.world.theme;
        P.add({ x, y, life: 0.2, s0: k * 2.8, s1: k * 3.4, a0: 1, a1: 0, col: [1, 0.95, 0.8], add: true });
        P.add({ x, y, frame: 'ring', life: 0.35, s0: k * 0.15, s1: k * 1.05, a0: 0.9, a1: 0, col: [1, 0.9, 0.7], add: true });
        const nf = 8 + Math.round(r / 4);
        for (let i = 0; i < nf; i++) {
            const a = Math.random() * Math.PI * 2, sp = Z.rand(0.3, 1) * r * 3.2;
            P.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, drag: 4, life: Z.rand(0.3, 0.65), s0: k * Z.rand(0.7, 1.3), s1: k * 0.2, a0: 1, a1: 0, col: [1, 0.86, 0.45], col1: [0.85, 0.2, 0.05], add: true });
        }
        const ns = 5 + Math.round(r / 6);
        for (let i = 0; i < ns; i++) {
            const a = Math.random() * Math.PI * 2, sp = Z.rand(10, 60);
            P.add({ x: x + Z.rand(-r, r) * 0.4, y: y + Z.rand(-r, r) * 0.4, vx: Math.cos(a) * sp + g.wind * 0.1, vy: -Z.rand(15, 45), drag: 0.6, frame: 'smoke', life: Z.rand(1.2, 2.3), s0: k * 0.6, s1: k * Z.rand(1.4, 2), a0: 0.65, a1: 0, col: [0.22, 0.2, 0.19], rot: Math.random() * 6, vr: Z.rand(-1, 1) });
        }
        for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2, sp = Z.rand(200, 520);
            P.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 300, drag: 2, frame: 'spark', align: true, life: Z.rand(0.2, 0.45), s0: 0.9, s1: 0.3, a0: 1, a1: 0, col: [1, 0.85, 0.4], add: true });
        }
        const dcol = Z.hex(th.debris).slice(0, 3), tcol = Z.hex(th.top0).slice(0, 3);
        const nd = Math.min(42, Math.round(removed / 45));
        for (let i = 0; i < nd; i++) {
            const a = -Math.PI / 2 + Z.rand(-1.3, 1.3), sp = Z.rand(120, 380);
            P.add({ x: x + Z.rand(-r, r) * 0.5, y: y + Z.rand(-r, r) * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 700, frame: 'sq', collide: true, life: Z.rand(0.9, 1.8), s0: Z.rand(0.5, 1.1), s1: 0.4, a0: 1, a1: 0.2, col: Math.random() < 0.25 ? tcol : dcol, rot: Math.random() * 6, vr: Z.rand(-12, 12) });
        }
        if (th.lava) for (let i = 0; i < 6; i++) P.add({ x, y, vx: Z.rand(-150, 150), vy: Z.rand(-300, -120), grav: 400, frame: 'dot', life: Z.rand(1, 2), s0: 1.2, s1: 0.4, a0: 1, a1: 0, col: [1, 0.6, 0.2], add: true });
    },
    splash(g, x, big = 1) {
        const th = g.world.theme, y = g.world.waterY;
        const col = th.lava ? [1, 0.6, 0.2] : Z.hex(th.wTop).slice(0, 3).map((c) => Math.min(1, c + 0.35));
        for (let i = 0; i < 18 * big; i++) {
            g.fx.add({ x: x + Z.rand(-8, 8), y: y - 2, vx: Z.rand(-110, 110) * big, vy: -Z.rand(160, 420) * big, grav: 800, frame: 'dot', life: Z.rand(0.5, 1.1), s0: Z.rand(0.8, 1.6), s1: 0.6, a0: 1, a1: 0.4, col, add: !!th.lava });
        }
        g.fx.add({ x, y: y + 2, frame: 'ring', life: 0.6, s0: 0.3, s1: 1.6 * big, a0: 0.8, a1: 0, col, add: true });
    },
    trail(g, x, y, homing) {
        g.fx.add({ x, y, vx: Z.rand(-12, 12), vy: Z.rand(-20, 0), drag: 1, frame: 'smoke', life: Z.rand(0.5, 0.9), s0: 0.35, s1: 0.9, a0: 0.45, a1: 0, col: [0.85, 0.85, 0.85], rot: Math.random() * 6 });
        g.fx.add({ x, y, life: 0.12, s0: 0.5, s1: 0.2, a0: 1, a1: 0, col: homing ? [0.75, 0.6, 1] : [1, 0.75, 0.35], add: true });
    },
    sparkle(g, x, y, col = [0.6, 0.95, 1], n = 22) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, sp = Z.rand(20, 140);
            g.fx.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 2.5, frame: 'star', life: Z.rand(0.5, 1), s0: Z.rand(0.5, 1), s1: 0.1, a0: 1, a1: 0, col, add: true, rot: Math.random() * 3 });
        }
    },
    dust(g, x, y, n = 6) {
        for (let i = 0; i < n; i++) g.fx.add({ x: x + Z.rand(-6, 6), y, vx: Z.rand(-60, 60), vy: -Z.rand(5, 30), drag: 3, frame: 'smoke', life: Z.rand(0.4, 0.8), s0: 0.25, s1: 0.7, a0: 0.5, a1: 0, col: [0.8, 0.76, 0.7] });
    },
    muzzle(g, x, y, ang) {
        g.fx.add({ x, y, life: 0.08, s0: 1.4, s1: 0.6, a0: 1, a1: 0, col: [1, 0.9, 0.5], add: true });
        for (let i = 0; i < 6; i++) { const a = ang + Z.rand(-0.25, 0.25), sp = Z.rand(300, 600); g.fx.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 6, frame: 'spark', align: true, life: 0.12, s0: 0.8, s1: 0.2, a0: 1, a1: 0, col: [1, 0.8, 0.4], add: true }); }
    },
    fuse(g, x, y) { g.fx.add({ x, y, vx: Z.rand(-40, 40), vy: -Z.rand(30, 90), grav: 200, frame: 'dot', life: 0.25, s0: 0.6, s1: 0.2, a0: 1, a1: 0, col: [1, 0.85, 0.3], add: true }); },
};

// damage from a blast at distance d (shared by the game and the AI's predictions)
Z.blast = (d, r, dmg) => {
    const reach = r + Z.K.UNIT_R + 6;
    if (d > reach) return 0;
    return Math.round(dmg * Z.clamp(1 - Math.max(0, d - Z.K.UNIT_R * 0.5) / reach, 0, 1));
};

Z.explode = function (g, x, y, r, dmg, push = 1) {
    // rounded so a rebuilt map (seed + every crater) carves exactly what the live game carved
    x = Math.round(x * 100) / 100; y = Math.round(y * 100) / 100;
    const removed = g.world.carve(x, y, r);
    g.craters?.push(x, y, r);
    Z.FX.explosion(g, x, y, r, removed);
    g.shake(Math.min(16, 3 + r * 0.16));
    Z.audio.play('boom', r / 45);
    for (const u of g.units) {
        if (u.dead) continue;
        const d = Math.hypot(u.x - x, u.y - y);
        const dm = Z.blast(d, r, dmg);
        if (dm <= 0) continue;
        g.damage(u, dm);
        let nx = (u.x - x) / (d || 1), ny = (u.y - y) / (d || 1) - 0.7;
        const l = Math.hypot(nx, ny) || 1;
        const f = dm / Math.max(1, dmg);
        u.knock((nx / l) * (160 + r * 6.5) * f * push, (ny / l) * (160 + r * 6.5) * f * push);
    }
    for (const p of g.projs) {
        if (p.dead || p.impact) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d > r + 24) continue;
        const f = 1 - d / (r + 24);
        p.vx += ((p.x - x) / (d || 1)) * 380 * f; p.vy += (((p.y - y) / (d || 1)) - 0.8) * 380 * f; p.rest = false;
        if (p.type === 'mine') { p.armed = true; p.armT = 0; if (p.fuse < 0 || p.fuse > 0.3) p.fuse = 0.08 + g.random() * 0.17; }
    }
    for (const c of g.crates) if (c.alive && Math.hypot(c.x - x, c.y - y) < r + 10) c.pop(g);
    for (const gr of g.graves) if (Math.hypot(gr.x - x, gr.y - 8 - y) < r + 14) { gr.vy = -220 * (1 - Math.hypot(gr.x - x, gr.y - y) / (r + 40)); gr.ground = false; }
};

// ---------------------------------------------------------------- fighter
Z.Unit = class {
    constructor(team, name, x, y) {
        Object.assign(this, { team, name, x, y, vx: 0, vy: 0, hp: 100, shownHp: 100, dead: false, drowned: false, onGround: false, knocked: false });
        this.facing = x < Z.K.W / 2 ? 1 : -1;
        this.aim = 0.35;
        this.walkT = 0; this.walking = false; this.blink = Z.rand(1, 4); this.hurtT = 0; this.sinkT = 0; this.swing = 0;
    }
    get dirX() { return Math.cos(this.aim) * this.facing; }
    get dirY() { return -Math.sin(this.aim); }
    supported(w) { const R = Z.K.UNIT_R; return w.solid(this.x, this.y + R + 1.5) || w.solid(this.x - 4, this.y + R + 1) || w.solid(this.x + 4, this.y + R + 1); }
    walk(dir, dt, w) {
        this.facing = dir;
        if (!this.onGround) return false;
        const nx = this.x + dir * Z.K.WALK * dt, R = Z.K.UNIT_R;
        for (let lift = 0; lift <= Z.K.CLIMB; lift++) {
            if (!w.circleHit(nx, this.y - lift, R)) { this.x = nx; this.y -= lift; this.walkT += dt; this.walking = true; return true; }
        }
        return false;
    }
    jump(kind) {
        if (!this.onGround) return;
        if (kind === 'fwd') { this.vx = this.facing * 150; this.vy = -235; }
        else { this.vx = -this.facing * 60; this.vy = -390; }
        this.onGround = false;
        Z.audio.play('jump');
    }
    knock(vx, vy) { this.vx += vx; this.vy += vy; this.onGround = false; this.knocked = true; }
    get resting() { return this.dead || (this.onGround && !this.walking); }

    physics(dt, g) {
        const w = g.world, R = Z.K.UNIT_R;
        // a drowned fighter sinks only while it is still visible: an unbounded y would break the turn snapshot
        if (this.dead) { if (this.drowned && this.sinkT < 1.5) { this.sinkT += dt; this.y += 20 * dt; } return; }
        if (this.onGround) {
            if (!this.supported(w)) { this.onGround = false; this.vx = 0; this.vy = 0; }
            else { for (let i = 0; i < 3 && !w.circleHit(this.x, this.y + 1, R); i++) this.y += 1; }
        }
        if (!this.onGround) {
            this.vy = Math.min(this.vy + Z.K.G * dt, 1100);
            const nx = this.x + this.vx * dt;
            if (w.circleHit(nx, this.y, R)) {
                let ok = false;
                for (let lift = 1; lift <= 4 && !ok; lift++) if (!w.circleHit(nx, this.y - lift, R)) { this.x = nx; this.y -= lift; ok = true; }
                if (!ok) this.vx *= -0.3;
            } else this.x = nx;
            const ny = this.y + this.vy * dt;
            if (w.circleHit(this.x, ny, R)) {
                if (this.vy > 0) {
                    for (let i = 0; i < 20 && !w.circleHit(this.x, this.y + 1, R); i++) this.y += 1;
                    const impact = this.vy;
                    if (this.knocked && impact > 220) { this.vy = -impact * 0.28; this.vx *= 0.55; }
                    else {
                        this.onGround = true; this.vx = 0; this.vy = 0; this.knocked = false;
                        if (impact > 160) { Z.FX.dust(g, this.x, this.y + R); Z.audio.play('land'); }
                        if (impact > Z.K.FALL_SAFE) g.damage(this, Math.round((impact - Z.K.FALL_SAFE) * 0.09), true);
                    }
                } else this.vy = 0;
            } else this.y = ny;
        }
        if (this.y > w.waterY + 4) g.drown(this);
    }

    tick(dt) {
        this.blink -= dt; if (this.blink < -0.12) this.blink = Z.rand(2, 5);
        this.hurtT = Math.max(0, this.hurtT - dt);
        this.swing = Math.max(0, this.swing - dt);
        if (this.shownHp > this.hp) this.shownHp = Math.max(this.hp, this.shownHp - 40 * dt);
        else this.shownHp = this.hp;
    }

    draw(R, g) {
        if (this.dead && !this.drowned) return;
        const alpha = this.drowned ? Math.max(0, 1 - this.sinkT / 1.4) : 1;
        if (alpha <= 0) return;
        const f = this.facing, col = this.team.color;
        const bob = this.onGround && this.walking ? Math.abs(Math.sin(this.walkT * 15)) * 1.4 : 0;
        const stretch = this.onGround ? 1 : Z.clamp(1 + Math.abs(this.vy) / 2400, 1, 1.12);
        const y = this.y - bob;
        const feet = !this.onGround ? 'feet1' : this.walking ? (Math.floor(this.walkT * 9) % 2 ? 'feet1' : 'feet2') : 'feet0';
        R.spr(feet, this.x, this.y, f, 1, 0, null, alpha);
        R.spr('body', this.x, y, f / stretch, stretch, 0, col, alpha);
        const active = g.active === this && g.state === 'aim';
        const face = this.hurtT > 0 ? 'face_hurt' : this.blink < 0 ? 'face_blink' : active && g.charging ? 'face_aim' : 'face';
        R.spr(face, this.x, y, f / stretch, stretch, 0, null, alpha);
        R.spr('helmet', this.x, y - (stretch - 1) * 8, f / stretch, stretch, 0, null, alpha);
        const wd = active ? g.weapon : null;
        if ((wd && wd.held) || this.swing > 0) {
            const name = this.swing > 0 ? 'w_hammer' : wd.held;
            let rot = -this.aim * f;
            if (this.swing > 0) rot += -f * (this.swing / 0.3) * 2.2;
            const sc = wd && wd.heldScale ? wd.heldScale : 0.8;
            R.spr(name, this.x + f * 4, y + 3, f * sc, sc, rot, null, alpha);
        }
    }
};

// ---------------------------------------------------------------- grave
Z.Grave = class {
    constructor(team, x, y) { Object.assign(this, { team, x, y: y + Z.K.UNIT_R, vy: -120, ground: false, gone: false }); }
    update(dt, g) {
        if (this.gone) return;
        const w = g.world;
        if (this.ground && !w.solid(this.x, this.y + 1)) this.ground = false;
        if (!this.ground) {
            this.vy = Math.min(this.vy + Z.K.G * dt, 900);
            const ny = this.y + this.vy * dt;
            if (this.vy > 0 && w.solid(this.x, ny)) { for (let i = 0; i < 20 && !w.solid(this.x, this.y + 1); i++) this.y += 1; this.vy = 0; this.ground = true; }
            else if (this.vy < 0 && w.solid(this.x, ny - 16)) this.vy = 0;
            else this.y = ny;
        }
        if (this.y > w.waterY + 30) this.gone = true;
    }
    draw(R) { if (!this.gone) R.spr('grave', this.x, this.y, 1, 1, 0, Z.mix3([0.92, 0.92, 0.92], this.team.color, 0.25)); }
};

// ---------------------------------------------------------------- supply crate
Z.Crate = class {
    constructor(kind, x, weapon) { Object.assign(this, { kind, x, y: -30, vx: 0, vy: 30, chute: true, alive: true, weapon, t: Math.random() * 6 }); }
    update(dt, g) {
        if (!this.alive) return;
        const w = g.world;
        this.t += dt;
        if (this.chute) { this.vy = Math.min(this.vy + Z.K.G * dt, 62); this.vx = g.wind * 0.22; }
        else { this.vy = Math.min(this.vy + Z.K.G * dt, 900); this.vx = 0; }
        const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
        if (!w.circleHit(nx, this.y, 8)) this.x = Z.clamp(nx, 10, w.W - 10);
        if (w.circleHit(this.x, ny, 8.5)) { if (this.vy > 0) { this.chute = false; this.vy = 0; this.landed = true; } else this.vy = 0; }
        else this.y = ny;
        if (this.y > w.waterY + 4) { this.alive = false; Z.FX.splash(g, this.x, 0.6); }
        if (!this.alive) return;
        for (const u of g.units) {
            if (u.dead || Math.hypot(u.x - this.x, u.y - this.y) > 20) continue;
            this.alive = false;
            Z.audio.play('pickup');
            Z.FX.sparkle(g, this.x, this.y, this.kind === 'hp' ? [1, 0.55, 0.6] : [1, 0.85, 0.4], 16);
            if (this.kind === 'hp') { u.hp = Math.min(150, u.hp + 30); u.shownHp = u.hp; g.popup(u.x, u.y - 24, '+30', '#7dffa0'); }
            else {
                const def = Z.WEAPON_BY_ID[this.weapon];
                if (u.team.ammo[def.id] >= 0) u.team.ammo[def.id] += 1;
                g.popup(u.x, u.y - 24, def.name + ' +1', '#ffd56b');
            }
            g.refreshHud();
            break;
        }
    }
    pop(g) {
        if (!this.alive) return;
        this.alive = false;
        if (this.kind === 'w') g.later(0.05, () => Z.explode(g, this.x, this.y, 30, 22));
        else Z.FX.sparkle(g, this.x, this.y, [1, 0.6, 0.65], 14);
    }
    draw(R) {
        if (!this.alive) return;
        const sway = this.chute ? Math.sin(this.t * 2.2) * 0.12 : 0;
        if (this.chute) R.spr('chute', this.x, this.y - 8, 1, 1, sway);
        R.spr(this.kind === 'hp' ? 'crate_hp' : 'crate_w', this.x, this.y, 1, 1, sway * 0.5);
    }
};
