import { Z } from './ZalpCore.js';
import { t } from '../gamesI18n.js';
// Projectiles (one step function shared by the game and the AI's simulations) and the arsenal.

Z.Proj = class {
    constructor(o) {
        Object.assign(this, {
            x: 0, y: 0, vx: 0, vy: 0, r: 2, type: 'rocket', frame: 'p_rocket', wind: 1, bounce: 0, fuse: -1, impact: true,
            rad: 45, dmg: 45, age: 0, rot: 0, spin: 0, dead: false, rest: false, owner: null, ignoreOwner: 0.12,
            trail: false, homing: null, fuel: 0, armed: false, armT: 0, cluster: 0,
        }, o);
    }
};

Z.launchFrom = (x, y, dx, dy, power, k = 1) => {
    const sp = Z.K.MAX_V * k * Z.clamp(power, 0.04, 1);
    return { x: x + dx * 13, y: y - 2 + dy * 13, vx: dx * sp, vy: dy * sp };
};

// advance one projectile by dt; returns null or an event {type: 'explode' | 'bounce' | 'water' | 'gone'}
Z.stepProj = function (p, dt, world, units, wind, sim) {
    p.age += dt;
    if (p.homing && p.age > 0.45 && p.fuel > 0) {
        p.fuel -= dt;
        let cur = Math.atan2(p.vy, p.vx);
        let da = Math.atan2(p.homing.y - p.y, p.homing.x - p.x) - cur;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        cur += Z.clamp(da, -5.5 * dt, 5.5 * dt);
        const sp = Math.min(600, Math.hypot(p.vx, p.vy) + 520 * dt);
        p.vx = Math.cos(cur) * sp; p.vy = Math.sin(cur) * sp;
    } else {
        p.vy += Z.K.G * dt;
        p.vx += wind * p.wind * dt;
    }
    if (p.fuse > 0) { p.fuse -= dt; if (p.fuse <= 0) return { type: 'explode' }; }
    if (!sim && p.type === 'mine') {
        if (!p.armed) { p.armT -= dt; if (p.armT <= 0) p.armed = true; }
        else if (p.fuse < 0) for (const u of units) if (!u.dead && Math.hypot(u.x - p.x, u.y - p.y) < 34) { p.fuse = 1; break; }
    }
    if (p.rest) {
        if (world.circleHit(p.x, p.y + 1.5, p.r)) { p.vx = 0; p.vy = 0; return null; }
        p.rest = false;
    }
    const n = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * dt) / 2));
    for (let i = 0; i < n; i++) {
        const nx = p.x + (p.vx * dt) / n, ny = p.y + (p.vy * dt) / n;
        if (p.impact) {
            for (const u of units) {
                if (u.dead || (u === p.owner && p.age < p.ignoreOwner)) continue;
                if (Math.hypot(u.x - nx, u.y - ny) < Z.K.UNIT_R + p.r) { p.x = nx; p.y = ny; return { type: 'explode' }; }
            }
        }
        if (world.solid(nx, ny) || (p.r > 2 && world.circleHit(nx, ny, p.r))) {
            if (p.impact) { p.x = nx; p.y = ny; return { type: 'explode' }; }
            const nn = world.normal(nx, ny, 4);
            const vn = p.vx * nn.x + p.vy * nn.y;
            if (vn < 0) { p.vx -= (1 + p.bounce) * vn * nn.x; p.vy -= (1 + p.bounce) * vn * nn.y; }
            p.vx *= 0.8; p.vy *= 0.8;
            p.spin = p.type === 'mine' ? 0 : p.vx * 0.05;
            for (let k = 0; k < 8 && world.circleHit(p.x, p.y, p.r); k++) { p.x += nn.x; p.y += nn.y; }
            if (Math.hypot(p.vx, p.vy) < 30 && nn.y < -0.45) { p.rest = true; p.vx = 0; p.vy = 0; }
            return { type: 'bounce', v: Math.abs(vn) };
        }
        p.x = nx; p.y = ny;
    }
    if (!p.impact) p.rot += p.spin * dt;
    if (p.y > world.waterY + 4) return { type: 'water' };
    if (p.x < -500 || p.x > world.W + 500) return { type: 'gone' };
    return null;
};

Z.detonate = function (g, p) {
    p.dead = true;
    Z.explode(g, p.x, p.y, p.rad, p.dmg);
    for (let i = 0; i < p.cluster; i++) {
        g.projs.push(new Z.Proj({ type: 'bomblet', frame: 'p_bomblet', impact: true, wind: 0, rad: 22, dmg: 20, r: 2, x: p.x, y: p.y - 6, vx: -190 + g.random() * 380, vy: -420 + g.random() * 200, ignoreOwner: 0 }));
    }
};

Z.updateProj = function (g, p, dt) {
    const ev = Z.stepProj(p, dt, g.world, g.units, g.wind, false);
    if (p.trail && !p.dead) {
        p.trailT = (p.trailT || 0) - dt;
        if (p.trailT <= 0) { p.trailT = 0.018; Z.FX.trail(g, p.x - p.vx * 0.012, p.y - p.vy * 0.012, !!p.homing); }
    }
    if (p.type === 'dyn' && Math.random() < dt * 45) Z.FX.fuse(g, p.x + Math.sin(p.rot) * 8, p.y - Math.cos(p.rot) * 8);
    if (p.type === 'mine' && p.fuse > 0) { p.beepT = (p.beepT || 0) - dt; if (p.beepT <= 0) { p.beepT = 0.2; Z.audio.play('beep'); } }
    if (!ev) return;
    if (ev.type === 'bounce') { if (ev.v > 70) Z.audio.play('bounce', p.type === 'mine' ? 0.7 : 1); }
    else if (ev.type === 'explode') Z.detonate(g, p);
    else if (ev.type === 'water') { p.dead = true; Z.FX.splash(g, p.x, 0.6); Z.audio.play('splash'); }
    else p.dead = true;
};

Z.drawProj = function (R, p, time) {
    let f = p.frame;
    if (p.type === 'mine') f = (p.fuse > 0 ? (time * 10) % 1 < 0.5 : p.armed && (time * 1.5) % 1 < 0.18) ? 'p_mine_on' : 'p_mine';
    R.spr(f, p.x, p.y, 1, 1, p.impact ? Math.atan2(p.vy, p.vx) : p.rot);
    if (p.homing && p.age > 0.45 && p.fuel > 0) R.spr('soft', p.x, p.y, 1.1, 1.1, 0, [0.7, 0.55, 1], 0.8, true);
};

// ---------------------------------------------------------------- airstrike plane
Z.Plane = class {
    constructor(tx, ty, dir) {
        this.dir = dir; this.y = -80; this.vx = dir * 440; this.bvx = this.vx * 0.45;
        const fallT = Math.sqrt((2 * Math.max(80, ty - this.y)) / Z.K.G);
        this.drops = [-60, -30, 0, 30, 60].map((o) => tx + o - this.bvx * fallT).sort((a, b) => (a - b) * dir);
        this.x = this.drops[0] - dir * 800;
        this.i = 0; this.done = false;
        Z.audio.play('plane');
    }
    update(dt, g) {
        this.x += this.vx * dt;
        while (this.i < this.drops.length && (this.x - this.drops[this.i]) * this.dir >= 0) {
            g.projs.push(new Z.Proj({ type: 'bomb', frame: 'p_bomb', impact: true, wind: 0.4, rad: 30, dmg: 28, r: 2, x: this.drops[this.i], y: this.y + 10, vx: this.bvx, vy: 30, ignoreOwner: 0 }));
            this.i++;
        }
        if (this.i >= this.drops.length && (this.x - this.drops[this.drops.length - 1]) * this.dir > 900) this.done = true;
    }
    draw(R) { R.spr('plane', this.x, this.y, this.dir, 1, 0); }
};

// ---------------------------------------------------------------- arsenal
function launch(g, u, spec, power, extra) {
    const s = Z.launchFrom(u.x, u.y, u.dirX, u.dirY, power, spec.k);
    g.projs.push(new Z.Proj(Object.assign({}, spec, s, { owner: u }, extra)));
}
function place(g, u, spec) {
    g.projs.push(new Z.Proj(Object.assign({}, spec, { x: u.x + u.facing * 7, y: u.y, vx: u.facing * 60, vy: -70, owner: u })));
    Z.audio.play('throw');
}

Z.WEAPONS = [
    {
        id: 'rocket', icon: 'w_rocket', held: 'w_rocket', ammo: -1, mode: 'charge',
        proj: { type: 'rocket', frame: 'p_rocket', wind: 1, impact: true, rad: 50, dmg: 50, r: 2, trail: true, k: 1 },
        fire(g, u, o) { launch(g, u, this.proj, o.power); Z.FX.muzzle(g, u.x + u.dirX * 16, u.y - 2 + u.dirY * 16, Math.atan2(u.dirY, u.dirX)); Z.audio.play('launch'); },
    },
    {
        id: 'grenade', icon: 'p_grenade', held: 'p_grenade', heldScale: 1, ammo: -1, mode: 'charge', fuse: true,
        proj: { type: 'grenade', frame: 'p_grenade', wind: 0, impact: false, bounce: 0.45, rad: 44, dmg: 45, r: 3.5, k: 0.82 },
        fire(g, u, o) { launch(g, u, this.proj, o.power, { fuse: o.fuse, spin: u.facing * 8 }); Z.audio.play('throw'); },
    },
    {
        id: 'cluster', icon: 'p_cluster', held: 'p_cluster', heldScale: 1, ammo: 2, mode: 'charge', fuse: true,
        proj: { type: 'cluster', frame: 'p_cluster', wind: 0, impact: false, bounce: 0.4, rad: 30, dmg: 28, r: 3.5, k: 0.82, cluster: 5 },
        fire(g, u, o) { launch(g, u, this.proj, o.power, { fuse: o.fuse, spin: u.facing * 8 }); Z.audio.play('throw'); },
    },
    {
        id: 'shotgun', icon: 'w_shotgun', held: 'w_shotgun', ammo: -1, mode: 'instant', shots: 2,
        fire(g, u) {
            const dx = u.dirX, dy = u.dirY, x0 = u.x + dx * 12, y0 = u.y - 2 + dy * 12, len = 680;
            let hx = x0 + dx * len, hy = y0 + dy * len;
            outer: for (let s = 0; s <= len; s += 2) {
                const x = x0 + dx * s, y = y0 + dy * s;
                if (g.world.solid(x, y)) { hx = x; hy = y; break; }
                for (const v of g.units) if (v !== u && !v.dead && Math.hypot(v.x - x, v.y - y) < Z.K.UNIT_R) { hx = x; hy = y; break outer; }
            }
            const L = Math.hypot(hx - x0, hy - y0);
            g.fx.add({ x: (x0 + hx) / 2, y: (y0 + hy) / 2, frame: 'spark', sx: L / 16, rot: Math.atan2(dy, dx), life: 0.14, s0: 1, s1: 1, a0: 0.9, a1: 0, col: [1, 0.95, 0.7], add: true });
            Z.FX.muzzle(g, x0, y0, Math.atan2(dy, dx));
            Z.audio.play('shot');
            Z.explode(g, hx, hy, 14, 25, 1.6);
        },
    },
    {
        id: 'homing', icon: 'p_homing', held: 'w_homing', ammo: 1, mode: 'charge', target: true,
        proj: { type: 'homing', frame: 'p_homing', wind: 0.3, impact: true, rad: 46, dmg: 46, r: 2, trail: true, k: 0.85 },
        fire(g, u, o) {
            if (!o.target) { g.toast(t('zalp.toast.mark_first')); return false; }
            launch(g, u, this.proj, o.power, { homing: { x: o.target.x, y: o.target.y }, fuel: 3.5 });
            Z.audio.play('launch');
        },
    },
    {
        id: 'air', icon: 'plane', held: 'w_air', heldScale: 0.9, ammo: 1, mode: 'target',
        fire(g, u, o) {
            if (!o.target) return false;
            g.planes.push(new Z.Plane(o.target.x, o.target.y, o.target.x >= u.x ? 1 : -1));
            g.markTarget = { x: o.target.x, y: o.target.y, t: 3 };
        },
    },
    {
        id: 'dyn', icon: 'p_dyn', held: 'p_dyn', heldScale: 0.9, ammo: 2, mode: 'instant',
        proj: { type: 'dyn', frame: 'p_dyn', impact: false, wind: 0, bounce: 0.15, fuse: 5, rad: 76, dmg: 72, r: 4 },
        fire(g, u) { place(g, u, this.proj); },
    },
    {
        id: 'mine', icon: 'p_mine_on', held: 'p_mine', heldScale: 1, ammo: 2, mode: 'instant',
        proj: { type: 'mine', frame: 'p_mine', impact: false, wind: 0, bounce: 0.25, rad: 42, dmg: 42, r: 2.5, armT: 2 },
        fire(g, u) { place(g, u, this.proj); },
    },
    {
        id: 'hammer', icon: 'w_hammer', held: 'w_hammer', ammo: -1, mode: 'instant',
        fire(g, u) {
            u.swing = 0.3;
            Z.audio.play('swing');
            let hit = false;
            for (const v of g.units) {
                if (v === u || v.dead) continue;
                const dx = v.x - u.x, dy = v.y - u.y;
                if (Math.hypot(dx, dy) < 30 && dx * u.facing > -6) {
                    const a = Math.max(u.aim, 0.55);
                    g.damage(v, 25);
                    v.knock(u.facing * Math.cos(a) * 540, -Math.sin(a) * 540);
                    Z.FX.sparkle(g, (u.x + v.x) / 2, (u.y + v.y) / 2, [1, 0.9, 0.5], 12);
                    hit = true;
                }
            }
            if (hit) { Z.audio.play('hit'); g.shake(7); }
        },
    },
    {
        id: 'tele', icon: 'w_tele', held: 'w_tele', ammo: 2, mode: 'target', ends: true,
        fire(g, u, o) {
            const t = o.target, w = g.world;
            if (!t || t.x < 12 || t.x > w.W - 12 || t.y < 10 || t.y > w.waterY - 24 || w.circleHit(t.x, t.y, Z.K.UNIT_R + 1)) { g.toast(t('zalp.toast.bad_teleport')); return false; }
            Z.FX.sparkle(g, u.x, u.y);
            u.x = t.x; u.y = t.y; u.vx = 0; u.vy = 0; u.onGround = false;
            Z.FX.sparkle(g, u.x, u.y);
            Z.audio.play('teleport');
        },
    },
    {
        id: 'skip', icon: 'w_skip', held: 'w_skip', heldScale: 0.9, ammo: -1, mode: 'instant', ends: true,
        fire() {},
    },
];
// names and descriptions follow the active locale
for (const w of Z.WEAPONS) {
    Object.defineProperties(w, {
        name: { get() { return t(`zalp.weapons.${this.id}.name`); } },
        desc: { get() { return t(`zalp.weapons.${this.id}.desc`); } },
    });
}
Z.WEAPON_BY_ID = Object.fromEntries(Z.WEAPONS.map((w) => [w.id, w]));
Z.CRATE_POOL = ['cluster', 'homing', 'air', 'dyn', 'mine', 'tele'];
