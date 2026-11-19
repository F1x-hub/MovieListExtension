import { Z } from './ZalpCore.js';
// Computer opponent. It simulates real shots with the same physics as the game (spread over frames),
// scores where they land, then plays the turn through the same controls a person uses.
Z.AI = class {
    constructor(g, u) {
        this.g = g; this.u = u;
        this.keys = new Set();
        this.moved = false;
        this.think(Z.rand(0.7, 1.3));
    }

    think(minTime) {
        this.phase = 'think'; this.t = 0; this.minThink = minTime;
        const g = this.g, u = this.u, diff = g.opts.diff;
        const enemies = g.units.filter((v) => !v.dead && v.team !== u.team);
        const friends = g.units.filter((v) => !v.dead && v.team === u.team && v !== u);
        const has = (id) => u.team.ammo[id] !== 0;
        const tasks = [{ kind: 'direct' }];
        const balls = ['rocket', 'grenade'];
        if (has('cluster') && Math.random() < 0.4) balls.push('cluster');
        for (const wid of balls) for (const facing of [-1, 1]) tasks.push({ kind: 'ballistic', wid, facing });
        if (has('homing') && diff > 0) for (const e of enemies) tasks.push({ kind: 'homing', e });
        this.job = { tasks, i: 0, enemies, friends, best: null, diff };
    }

    consider(c) { const j = this.job; if (!j.best || c.score > j.best.score) j.best = c; }

    work(budgetMs) {
        const t0 = performance.now(), j = this.job;
        while (j.i < j.tasks.length && performance.now() - t0 < budgetMs) this.runTask(j.tasks[j.i++]);
        return j.i >= j.tasks.length;
    }

    sim(def, facing, aim, power, extra) {
        const g = this.g, u = this.u;
        const dx = Math.cos(aim) * facing, dy = -Math.sin(aim);
        const s = Z.launchFrom(u.x, u.y, dx, dy, power, def.proj.k);
        if (g.world.solid(s.x, s.y)) return null;
        const p = new Z.Proj(Object.assign({}, def.proj, s, { owner: u }, extra));
        const units = this.simUnits || (this.simUnits = g.units.filter((v) => !v.dead));
        for (let t = 0; t < 6; t += Z.K.STEP) {
            const ev = Z.stepProj(p, Z.K.STEP, g.world, units, g.wind, true);
            if (!ev) continue;
            if (ev.type === 'explode') return { x: p.x, y: p.y };
            if (ev.type === 'water' || ev.type === 'gone') return null;
        }
        return { x: p.x, y: p.y };
    }

    score(x, y, rad, dmg) {
        const { enemies, friends } = this.job, u = this.u, w = this.g.world;
        let s = 0, near = 1e9;
        for (const e of enemies) {
            const d = Math.hypot(e.x - x, e.y - y);
            near = Math.min(near, d);
            const dm = Z.blast(d, rad, dmg);
            if (dm <= 0) continue;
            s += Math.min(dm, e.hp) + (dm >= e.hp ? 45 : 0);
            if (e.y > w.waterY - 120) s += 8;
        }
        for (const f of friends) { const dm = Z.blast(Math.hypot(f.x - x, f.y - y), rad, dmg); s -= Math.min(dm, f.hp) * 1.4 + (dm >= f.hp ? 50 : 0); }
        const self = Z.blast(Math.hypot(u.x - x, u.y - y), rad, dmg);
        s -= self * 1.6 + (self >= u.hp ? 90 : 0);
        if (s === 0) s = -near / 100;
        return s;
    }

    runTask(task) {
        const g = this.g, u = this.u, w = g.world, j = this.job, R = Z.K.UNIT_R;
        if (task.kind === 'ballistic') {
            const def = Z.WEAPON_BY_ID[task.wid];
            const na = j.diff === 0 ? 14 : 24, np = j.diff === 0 ? 9 : 15;
            for (let ai = 0; ai < na; ai++) {
                const aim = -0.5 + (ai / (na - 1)) * 1.95;
                for (let pi = 0; pi < np; pi++) {
                    const power = 0.22 + (pi / (np - 1)) * 0.78;
                    const hit = this.sim(def, task.facing, aim, power, def.fuse ? { fuse: 3 } : {});
                    if (!hit) continue;
                    const pr = def.proj;
                    this.consider({ w: def.id, facing: task.facing, aim, power, fuse: 3, score: this.score(hit.x, hit.y, pr.rad, pr.dmg + (pr.cluster ? 30 : 0)), hit });
                }
            }
        } else if (task.kind === 'homing') {
            const def = Z.WEAPON_BY_ID.homing, e = task.e, facing = e.x >= u.x ? 1 : -1;
            for (const aim of [0.55, 0.85, 1.15, 1.4]) for (const power of [0.45, 0.65, 0.85]) {
                const hit = this.sim(def, facing, aim, power, { homing: { x: e.x, y: e.y }, fuel: 3.5 });
                if (hit) this.consider({ w: 'homing', facing, aim, power, target: { x: e.x, y: e.y }, score: this.score(hit.x, hit.y, 46, 46) - 6, hit });
            }
        } else {
            const has = (id) => u.team.ammo[id] !== 0;
            for (const e of j.enemies) {
                const dx = e.x - u.x, dy = e.y - u.y, d = Math.hypot(dx, dy), facing = dx >= 0 ? 1 : -1;
                if (d < 27 && has('hammer')) {
                    const watery = e.y > w.waterY - 200 ? 20 : 0;
                    this.consider({ w: 'hammer', facing, aim: 0.6, score: Math.min(25, e.hp) + (e.hp <= 25 ? 45 : 0) + watery + 6 });
                }
                if (d < 600) {
                    const aim = Math.atan2(-(e.y - (u.y - 2)), Math.abs(dx));
                    if (Math.abs(aim) < 1.5) {
                        const mx = u.x + Math.cos(aim) * facing * 12, my = u.y - 2 - Math.sin(aim) * 12;
                        const ex = e.x - (Math.cos(aim) * facing) * R, ey = e.y + Math.sin(aim) * R;
                        if (!w.solid(mx, my) && !w.ray(mx, my, ex, ey, 2)) {
                            const blocked = j.friends.some((f) => { const t = ((f.x - mx) * (ex - mx) + (f.y - my) * (ey - my)) / ((ex - mx) ** 2 + (ey - my) ** 2 || 1); return t > 0 && t < 1 && Math.hypot(mx + (ex - mx) * t - f.x, my + (ey - my) * t - f.y) < R + 3; });
                            if (!blocked) this.consider({ w: 'shotgun', facing, aim, score: Math.min(42, e.hp) + (e.hp <= 42 ? 40 : 0) - 3 });
                        }
                    }
                }
                if (has('air') && !w.ray(e.x, 0, e.x, e.y - 16, 3)) {
                    let s = Math.min(40, e.hp) * 0.85 + (e.hp <= 40 ? 30 : 0);
                    for (const o of j.enemies) if (o !== e && Math.abs(o.x - e.x) < 70) s += 14;
                    for (const f of j.friends) if (Math.abs(f.x - e.x) < 80) s -= 30;
                    if (Math.abs(u.x - e.x) < 80) s -= 40;
                    this.consider({ w: 'air', facing, aim: u.aim, target: { x: e.x, y: e.y }, score: s });
                }
            }
            if (has('dyn')) {
                let s = 0;
                for (const e of j.enemies) { const dm = Z.blast(Math.hypot(e.x - u.x, e.y - u.y) + 8, 76, 72); s += Math.min(dm, e.hp) + (dm >= e.hp ? 40 : 0); }
                for (const f of j.friends) s -= Z.blast(Math.hypot(f.x - u.x, f.y - u.y) + 8, 76, 72) * 1.5;
                if (s > 0) this.consider({ w: 'dyn', facing: u.facing, aim: u.aim, score: s * 0.8 - 5, flee: true });
            }
        }
    }

    decide() {
        const j = this.job, best = j.best, g = this.g, u = this.u;
        if ((!best || best.score < -3) && !this.moved) {
            const target = j.enemies.reduce((a, e) => (!a || Math.abs(e.x - u.x) < Math.abs(a.x - u.x) ? e : a), null);
            this.moveDir = target && target.x < u.x ? -1 : 1;
            this.moveT = Z.rand(1.4, 2.6); this.lastX = u.x; this.stuck = 0;
            this.phase = 'move';
            return;
        }
        if (!best || best.score < -6) { this.plan = { w: 'skip', facing: u.facing, aim: u.aim }; }
        else {
            const sa = [0.085, 0.032, 0.01][j.diff], sp = [0.065, 0.028, 0.008][j.diff];
            this.plan = Object.assign({}, best);
            if (best.power !== undefined) { this.plan.aim += Z.gauss() * sa; this.plan.power = Z.clamp(best.power + Z.gauss() * sp, 0.05, 1); }
            if (best.w === 'shotgun') this.plan.aim += Z.gauss() * sa * 0.5;
            if (best.target) this.plan.target = { x: best.target.x + Z.gauss() * [40, 16, 4][j.diff], y: best.target.y };
        }
        g.selectWeapon(this.plan.w);
        if (this.plan.fuse) g.fuse = this.plan.fuse;
        if (this.plan.target && Z.WEAPON_BY_ID[this.plan.w].target) g.target = this.plan.target;
        u.facing = this.plan.facing;
        this.phase = 'aim'; this.t = 0;
    }

    safeAhead(dir) {
        const w = this.g.world, u = this.u, px = u.x + dir * 14;
        for (let y = u.y; y < u.y + 70; y += 2) if (w.solid(px, y)) return y < w.waterY - 16;
        return false;
    }

    update(dt) {
        const g = this.g, u = this.u;
        this.t += dt;
        if (u.dead) return;
        switch (this.phase) {
            case 'think':
                if (this.work(4) && this.t >= this.minThink) this.decide();
                break;
            case 'move': {
                const key = this.moveDir < 0 ? 'ArrowLeft' : 'ArrowRight';
                this.moveT -= dt;
                if (Math.abs(u.x - this.lastX) < 0.2) this.stuck += dt; else this.stuck = 0;
                this.lastX = u.x;
                if (this.moveT <= 0 || this.stuck > 0.35 || !this.safeAhead(this.moveDir) || g.timeLeft < 12) {
                    this.keys.delete(key);
                    if (u.onGround) { this.moved = true; this.simUnits = null; this.think(0.35); }
                } else this.keys.add(key);
                break;
            }
            case 'aim': {
                const p = this.plan;
                u.facing = p.facing;
                const d = p.aim - u.aim;
                u.aim += Z.clamp(d, -1.7 * dt, 1.7 * dt);
                u.aim = Z.clamp(u.aim, -1.5, 1.5);
                if (Math.abs(d) < 0.004 && this.t > 0.35) { u.aim = Z.clamp(p.aim, -1.5, 1.5); this.phase = 'act'; this.t = 0; }
                break;
            }
            case 'act': {
                const p = this.plan, def = Z.WEAPON_BY_ID[p.w];
                if (this.t < 0.25) break;
                if (def.mode === 'charge') {
                    g.charging = true;
                    g.power = Math.min(p.power, g.power + dt / Z.K.CHARGE_TIME);
                    if (g.power >= p.power - 1e-6) g.releaseFire();
                    else break;
                } else if (def.mode === 'target') g.fireAt(p.target);
                else g.releaseFire();
                this.phase = 'after'; this.t = 0;
                break;
            }
            case 'after':
                if (g.state === 'aim' && g.weapon.id === 'shotgun' && this.t > 0.6) {
                    this.plan.aim += Z.gauss() * 0.01; this.phase = 'aim'; this.t = 0;
                } else if (g.state === 'retreat') {
                    this.phase = 'retreat'; this.t = 0;
                    const hx = this.plan.hit ? this.plan.hit.x : u.x + u.facing * 40;
                    this.fleeDir = this.plan.flee || Math.abs(hx - u.x) < 110 ? (hx > u.x ? -1 : 1) : 0;
                    if (this.plan.flee) this.fleeDir = -u.facing;
                }
                break;
            case 'retreat': {
                const key = this.fleeDir < 0 ? 'ArrowLeft' : 'ArrowRight';
                if (this.fleeDir && this.t < 2.6 && this.safeAhead(this.fleeDir)) this.keys.add(key);
                else this.keys.clear();
                break;
            }
        }
    }
};
