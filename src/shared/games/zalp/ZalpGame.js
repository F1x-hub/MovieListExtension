import { Z } from './ZalpCore.js';
import { t } from '../gamesI18n.js';

// Salvo match: teams and turns, who controls the active fighter, the fixed-step simulation, the camera
// and the WebGL frame. Every rule of play runs in tick() at 120 Hz on controls taken per tick, with per-turn
// seeded randomness, so a recorded turn replays identically on another computer (online play).
// Camera, particles, popups and toasts run per frame and never feed back into the simulation.
const Rules = () => globalThis.ZalpRules;
const NONE = Object.freeze({ mask: 0, events: Object.freeze([]) });
const r2 = (v) => Math.round(v * 100) / 100;

Z.TEAMS = [
    { key: 'red', hex: '#ff5b4f' }, { key: 'blue', hex: '#43a0ff' }, { key: 'green', hex: '#43c76b' },
    { key: 'yellow', hex: '#f2c230' }, { key: 'purple', hex: '#a77bff' }, { key: 'orange', hex: '#ff9431' },
    { key: 'cyan', hex: '#2fd0c8' }, { key: 'pink', hex: '#ff6fae' },
];

// ---------------------------------------------------------------- controllers
/** The person at this computer: the keyboard sampled per tick plus queued commands; online it records the turn. */
Z.LocalControl = class {
    constructor(record) {
        this.kind = 'local';
        this.queue = [];
        this.encoder = record ? new (Rules().StreamEncoder)() : null;
        Z.input.pending.clear();
    }
    ready() { return true; }
    push(ev) { this.queue.push(ev); }
    next() {
        const I = Z.input, M = Rules().MASK;
        let mask = 0;
        if (!Z.UI?.weaponsOpen) {
            mask = (I.isDown('ArrowLeft') ? M.LEFT : 0) | (I.isDown('ArrowRight') ? M.RIGHT : 0)
                | (I.isDown('ArrowUp') ? M.UP : 0) | (I.isDown('ArrowDown') ? M.DOWN : 0);
            if (I.take('Space') || I.isDown('Space')) mask |= M.FIRE;
            if (I.take('Enter')) mask |= M.JUMP;
            if (I.take('Backspace')) mask |= M.BACKFLIP;
            for (let k = 1; k <= 5; k++) if (I.take('Digit' + k)) this.queue.push({ t: 'f', n: k });
        }
        const events = this.queue.splice(0);
        if (this.encoder) this.encoder.push(mask, events);
        return { mask, events };
    }
};

/** Another player's turn, replayed tick by tick from the stream their computer sends. */
Z.ReplayControl = class {
    constructor() { this.kind = 'replay'; this.decoder = new (Rules().StreamDecoder)(); this.tick = 0; this.final = false; }
    feed(data, final) { this.decoder.append(data); if (final) this.final = true; }
    ready() { return this.decoder.has(this.tick); }
    backlog() { return this.decoder.total - this.tick; }
    push() {}
    next() { return this.decoder.at(this.tick++); }
};

/** A computer-controlled fighter (solo only): walking through the mask, aim and fire directly. */
Z.AIControl = class {
    constructor(g, u) { this.kind = 'ai'; this.direct = true; this.ai = new Z.AI(g, u); }
    ready() { return true; }
    push() {}
    next() {
        this.ai.update(Z.K.STEP);
        const keys = this.ai.keys, M = Rules().MASK;
        return { mask: (keys.has('ArrowLeft') ? M.LEFT : 0) | (keys.has('ArrowRight') ? M.RIGHT : 0), events: NONE.events };
    }
};

Z.Game = class {
    /**
     * opts: solo { mode: 'solo', diff, count (fighters per team), teams, theme }
     *       online { mode: 'online', seed, theme, seats: [{ name, team }], mySeat }
     *       demo (menu backdrop) { count, theme } with demo = true; headless skips the GPU (tests)
     */
    constructor(opts, demo = false) {
        this.opts = opts; this.demo = demo;
        this.online = opts.mode === 'online';
        const themeKey = Z.THEMES[opts.theme] ? opts.theme : Z.pick(Object.keys(Z.THEMES));
        this.seed = Number.isInteger(opts.seed) ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
        this.world = new Z.World(this.seed, themeKey);
        if (Z.R && !opts.headless) Z.R.uploadMask(this.world.data, this.world.W, this.world.H);
        this.waterTarget = this.world.waterY;
        Object.assign(this, { units: [], projs: [], crates: [], graves: [], planes: [], popups: [], timers: [], uiTimers: [], craters: [], fx: new Z.Particles() });
        Object.assign(this, { time: 0, clock: 0, acc: 0, ticks: 0, turnTicks: 0, wind: 0, windTarget: 0, cloudX: 0, state: 'start', teamIdx: -1, round: 0, turnNo: 0 });
        Object.assign(this, { weapon: Z.WEAPON_BY_ID.rocket, fuse: 3, power: 0, charging: false, target: null, markTarget: null, shotsUsed: 0, prevFire: false, walkDir: 0 });
        Object.assign(this, { timeLeft: Z.K.TURN_TIME, retreatLeft: 0, settleT: 0, active: null, control: null, hurtEnd: false, crateDone: true, mouse: null, lastTick: 0 });
        Object.assign(this, { fast: false, mine: null, heroOutShown: false, waterToastShown: false, onTurnDone: null });
        this.rand = Z.rng(this.seed ^ 0x5bd1e995);
        this.trand = this.rand;
        this.buildTeams(opts);

        const view = Z.R && !opts.headless ? Z.R.view : { w: 1280, h: 720, dpr: 1 };
        const fit = Z.clamp(view.w / view.dpr / 1250, 0.55, 2);
        this.cam = { x: Z.K.W / 2, y: Z.K.H * 0.45, zoom: demo ? fit * 0.9 : fit, tx: Z.K.W / 2, ty: Z.K.H * 0.45, tzoom: fit, shakeA: 0, shakeT: 0, manual: 0, focus: null };
        if (!demo && !this.online) this.later(0.9, () => this.nextTurn());
    }

    buildTeams(opts) {
        const seats = this.online ? opts.seats : null;
        let teamIds, unitTeams, names;
        if (seats) {
            teamIds = [...new Set(seats.map((s) => s.team))].sort((a, b) => a - b);
            unitTeams = seats.map((s) => s.team);
            names = seats.map((s) => String(s.name || '').slice(0, 16) || '—');
        } else {
            const nTeams = this.demo ? 2 : Z.clamp(opts.teams || 2, 2, 4), per = Z.clamp(opts.count || 3, 1, 5);
            teamIds = Array.from({ length: nTeams }, (_, i) => i);
            unitTeams = [];
            for (let k = 0; k < per; k++) unitTeams.push(...teamIds);
            const pool = Z.shuffleWith(t('zalp.names').split('|'), this.rand);
            names = unitTeams.map((_, i) => pool[i % pool.length]);
        }
        this.ffa = !!seats && seats.length > 2 && teamIds.length === seats.length;
        this.teams = teamIds.map((id) => {
            const c = Z.TEAMS[id % Z.TEAMS.length];
            const first = seats ? seats.findIndex((s) => s.team === id) : -1;
            return {
                id, idx: id, key: c.key, hex: c.hex, color: Z.hex(c.hex).slice(0, 3),
                name: this.ffa ? names[first] : t('zalp.teams.' + c.key),
                units: [], next: 0, dealt: 0, lastWeapon: 'rocket',
                ammo: Object.fromEntries(Z.WEAPONS.map((w) => [w.id, w.ammo])),
            };
        });
        const pts = this.world.spawnPoints(unitTeams.length, 170, this.rand);
        unitTeams.forEach((id, i) => {
            const team = this.teams[id];
            const u = new Z.Unit(team, names[i], pts[i].x, pts[i].y);
            u.seat = i;
            team.units.push(u);
            this.units.push(u);
        });
        this.startHp = Math.max(...this.teams.map((tm) => tm.units.length)) * 100;
        if (this.online) this.mine = this.units[opts.mySeat] || null;
        else if (!this.demo) this.mine = this.teams[0].units[0];
    }

    // ---------------------------------------------------------------- hooks used by entities and weapons
    random() { return this.trand(); }
    later(t, fn) { this.timers.push({ t, fn }); }
    uiLater(t, fn) { this.uiTimers.push({ t, fn }); }
    shake(a) { this.cam.shakeA = Math.max(this.cam.shakeA, a); this.cam.shakeT = 0.45; }
    popup(x, y, text, color) { this.popups.push({ x, y, text, color, t: 0 }); }
    toast(text, sub) { if (!this.demo) Z.UI?.toast(text, sub); }
    refreshHud() { if (!this.demo) Z.UI?.refresh(this); }
    get localTurn() { return !!(this.control && this.control.kind === 'local'); }
    command(ev) { if (this.localTurn && (this.state === 'aim' || this.state === 'retreat')) this.control.push(ev); }

    damage(u, dm, fall) {
        if (u.dead || dm <= 0) return;
        u.hp = Math.max(0, u.hp - dm);
        u.hurtT = 0.9;
        this.popup(u.x, u.y - 22, '−' + dm, u.team.hex);
        if (this.active && this.active.team !== u.team) this.active.team.dealt += dm;
        if (u === this.active && (this.state === 'aim' || this.state === 'retreat')) this.hurtEnd = true;
        this.refreshHud();
    }

    drown(u) {
        if (u.dead) return;
        u.dead = true; u.drowned = true; u.hp = 0;
        Z.FX.splash(this, u.x, 1);
        Z.audio.play('splash'); Z.audio.play('drown');
        this.toast(t(this.world.theme.lava ? 'zalp.toast.burned' : 'zalp.toast.drowned', { name: u.name }));
        if (u === this.active && (this.state === 'aim' || this.state === 'retreat')) this.hurtEnd = true;
        this.refreshHud();
    }

    // ---------------------------------------------------------------- actions
    selectWeapon(id) {
        if (this.state !== 'aim' || !this.active) return false;
        const def = Z.WEAPON_BY_ID[id], team = this.active.team;
        if (!def) return false;
        if (team.ammo[id] === 0) { this.toast(t('zalp.toast.no_ammo', { weapon: def.name })); return false; }
        if (this.shotsUsed > 0 && def !== this.weapon) return false;
        this.weapon = def; team.lastWeapon = id;
        this.target = null; this.power = 0; this.charging = false;
        Z.audio.play('click');
        this.refreshHud();
        return true;
    }

    releaseFire() {
        if (this.state !== 'aim') return;
        if (this.weapon.mode === 'target') { this.charging = false; this.toast(t('zalp.toast.pick_point')); return; }
        this.fire({ power: this.power, fuse: this.fuse, target: this.target });
    }

    fireAt(target) { if (this.state === 'aim') this.fire({ power: this.power, fuse: this.fuse, target }); }

    clickAt(x, y) {
        if (this.state !== 'aim') return;
        const def = this.weapon;
        if (def.mode === 'target') this.fireAt({ x, y });
        else if (def.target) { this.target = { x, y }; Z.audio.play('click'); this.refreshHud(); }
    }

    fire(o) {
        const def = this.weapon, u = this.active, team = u.team;
        if (team.ammo[def.id] === 0) return;
        const r = def.fire(this, u, o);
        this.charging = false; this.power = 0;
        if (r === false) return;
        if (team.ammo[def.id] > 0 && this.shotsUsed === 0) team.ammo[def.id]--;
        if (def.shots && ++this.shotsUsed < def.shots) { this.refreshHud(); return; }
        if (def.ends) this.toSettle();
        else { this.state = 'retreat'; this.retreatLeft = Z.K.RETREAT_TIME; }
        this.target = null;
        this.refreshHud();
    }

    toSettle() {
        this.state = 'settle'; this.settleT = 0; this.charging = false; this.power = 0; this.walkDir = 0;
        if (this.control && this.control.ai) this.control.ai.keys.clear();
        this.refreshHud();
    }

    busy() {
        for (const p of this.projs) if (!p.dead && !(p.rest && p.fuse < 0)) return true;
        if (this.planes.length || this.timers.length) return true;
        for (const u of this.units) if (u.dead ? u.drowned && u.sinkT < 1.2 : !u.onGround) return true;
        for (const c of this.crates) if (c.alive && !c.landed) return true;
        for (const g of this.graves) if (!g.gone && !g.ground) return true;
        return false;
    }

    aliveTeams() { return this.teams.filter((tm) => tm.units.some((u) => !u.dead)); }

    // ---------------------------------------------------------------- turns
    controlFor(u) {
        if (u === this.mine && !this.mine.dead) return new Z.LocalControl(this.online);
        if (this.online) return new Z.ReplayControl();
        return new Z.AIControl(this, u);
    }

    beginTurn(u) {
        this.turnNo++;
        this.trand = Z.rng((this.seed ^ Math.imul(this.turnNo + 1, 0x9e3779b1)) >>> 0);
        this.active = u;
        this.windTarget = Z.clamp(Z.gaussWith(this.trand) * 0.42, -1, 1) * Z.K.WIND_MAX;
        this.wind = this.windTarget;
        Object.assign(this, { state: 'aim', timeLeft: Z.K.TURN_TIME, shotsUsed: 0, power: 0, charging: false, target: null, hurtEnd: false, crateDone: false, lastTick: 0, prevFire: false, fuse: 3, turnTicks: 0, walkDir: 0 });
        const team = u.team, lw = Z.WEAPON_BY_ID[team.lastWeapon];
        this.weapon = lw && team.ammo[lw.id] !== 0 ? lw : Z.WEAPON_BY_ID.rocket;
        if (this.turnNo > 8 * this.teams.length) {
            this.waterTarget = Math.max(this.world.H * 0.35, this.waterTarget - 16 / this.teams.length);
            if (!this.waterToastShown) { this.waterToastShown = true; this.uiLater(0.1, () => this.toast(t('zalp.toast.water_rises'), t('zalp.toast.water_rises_sub'))); }
        }
        this.control = this.controlFor(u);
        this.cam.manual = 0; this.cam.focus = null;
        Z.audio.play('turn');
        const title = this.ffa ? u.name : team.name + ' · ' + u.name;
        let sub;
        if (u === this.mine) sub = t('zalp.turn_you');
        else if (this.mine && u.team === this.mine.team) sub = t(this.online ? 'zalp.turn_ally' : 'zalp.turn_ally_bot');
        else sub = this.online ? t('zalp.turn_other', { name: u.name }) : t('zalp.turn_ai');
        this.toast(title, sub);
        this.refreshHud();
    }

    /** Solo: teams take turns, members rotate inside a team. */
    nextTurn() {
        const alive = this.aliveTeams();
        if (alive.length <= 1) return this.gameOver(alive[0] || null);
        let idx = this.teamIdx;
        for (let i = 0; i < this.teams.length; i++) {
            idx = (idx + 1) % this.teams.length;
            if (idx === 0) this.round++;
            if (alive.includes(this.teams[idx])) break;
        }
        this.teamIdx = idx;
        const team = this.teams[idx];
        let u = null;
        for (let i = 0; i < team.units.length && !u; i++) {
            const c = team.units[(team.next + i) % team.units.length];
            if (!c.dead) { u = c; team.next = (team.next + i + 1) % team.units.length; }
        }
        this.beginTurn(u);
    }

    /** Online: the server names turn n and its seat; seats that left lose their fighter first. */
    startOnlineTurn(n, seat, leftSeats = []) {
        for (const i of leftSeats) {
            const u = this.units[i];
            if (u && !u.dead) { u.dead = true; u.hp = 0; Z.FX.sparkle(this, u.x, u.y, [0.8, 0.8, 0.85], 14); }
        }
        this.turnNo = n - 1;
        this.round = Math.floor((n - 1) / this.teams.length) + 1;
        this.beginTurn(this.units[seat]);
    }

    endTurn() {
        if (this.online) {
            // the recording outlives the turn: the page sends its last chunk with the snapshot
            this.lastEncoder = this.control ? this.control.encoder : null;
            this.state = 'done'; this.control = null;
            this.onTurnDone?.(this);
        }
        else this.nextTurn();
    }

    gameOver(team) {
        this.state = 'over'; this.active = null; this.control = null;
        Z.audio.play('win');
        this.toast(team ? t('zalp.toast.win', { team: team.name }) : t('zalp.toast.draw'));
        this.uiLater(1.6, () => Z.UI?.showResult(this, team));
    }

    dropCrate() {
        for (let tries = 0; tries < 30; tries++) {
            const x = 160 + this.random() * (this.world.W - 320);
            let ok = false;
            for (let y = 40; y < this.world.waterY - 20; y += 4) if (this.world.solid(x, y)) { ok = true; break; }
            if (!ok) continue;
            const kind = this.random() < 0.55 ? 'w' : 'hp';
            const pool = Z.CRATE_POOL;
            const c = new Z.Crate(kind, x, pool[Math.floor(this.random() * pool.length)]);
            this.crates.push(c);
            this.cam.focus = c;
            this.toast(t('zalp.toast.supplies'), t(kind === 'hp' ? 'zalp.toast.supplies_hp' : 'zalp.toast.supplies_weapon'));
            return;
        }
    }

    // ---------------------------------------------------------------- simulation (fixed step)
    applyControls(ctl) {
        for (const ev of ctl.events) this.applyEvent(ev);
        const u = this.active, st = this.state, M = Rules().MASK, m = ctl.mask;
        this.walkDir = 0;
        if (!u || u.dead || (st !== 'aim' && st !== 'retreat')) return;
        if (!this.charging) this.walkDir = (m & M.LEFT ? -1 : 0) + (m & M.RIGHT ? 1 : 0);
        if (m & M.JUMP) u.jump('fwd');
        if (m & M.BACKFLIP) u.jump('back');
        if (st !== 'aim' || (this.control && this.control.direct)) return;
        const up = !!(m & M.UP), down = !!(m & M.DOWN);
        if (up !== down) u.aim = Z.clamp(u.aim + (up ? 1 : -1) * 1.45 * Z.K.STEP, -1.5, 1.5);
        const fire = !!(m & M.FIRE), rise = fire && !this.prevFire;
        this.prevFire = fire;
        const def = this.weapon;
        if (def.mode === 'charge') {
            if (rise) {
                if (def.target && !this.target) this.toast(t('zalp.toast.mark_first'));
                else { this.charging = true; this.power = 0; }
            }
            if (this.charging) {
                this.power = Math.min(1, this.power + Z.K.STEP / Z.K.CHARGE_TIME);
                if (!fire || this.power >= 1) this.releaseFire();
            }
        } else if (rise) this.releaseFire();
    }

    applyEvent(ev) {
        if (ev.t === 'w') this.selectWeapon(ev.id);
        else if (ev.t === 'f') { if (this.state === 'aim' && ev.n >= 1 && ev.n <= 5) { this.fuse = ev.n; Z.audio.play('click'); this.refreshHud(); } }
        else if (ev.t === 'c') this.clickAt(ev.x, ev.y);
    }

    physics(dt) {
        const u = this.active;
        for (const v of this.units) v.walking = false;
        if (u && !u.dead && this.walkDir && (this.state === 'aim' || this.state === 'retreat')) u.walk(this.walkDir, dt, this.world);
        for (const v of this.units) v.physics(dt, this);
        for (const p of this.projs) if (!p.dead) Z.updateProj(this, p, dt);
        for (const pl of this.planes) pl.update(dt, this);
        for (const c of this.crates) c.update(dt, this);
        for (const g of this.graves) g.update(dt, this);
        this.projs = this.projs.filter((p) => !p.dead);
        this.planes = this.planes.filter((p) => !p.done);
        this.crates = this.crates.filter((c) => c.alive);
        this.world.waterY += (this.waterTarget - this.world.waterY) * Math.min(1, dt * 1.2);
    }

    /** One 1/120 s step. Returns false when nothing could run (a replay waiting for data, a finished turn). */
    tick() {
        const dt = Z.K.STEP, st = this.state;
        if (this.demo) { this.physics(dt); return true; }
        if (st === 'over' || st === 'done' || (this.online && st === 'start')) return false;
        let ctl = NONE;
        const c = this.control;
        if (c && (st === 'aim' || st === 'retreat' || (this.online && st === 'settle'))) {
            if (!c.ready()) return false;
            ctl = c.next();
        }
        this.ticks++; this.turnTicks++;
        this.time += dt;
        for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
        this.applyControls(ctl);
        this.physics(dt);
        this.step(dt);
        return true;
    }

    step(dt) {
        if (this.mine && this.mine.dead && !this.heroOutShown && !this.online && this.state !== 'over') {
            this.heroOutShown = true;
            this.uiLater(1.2, () => this.toast(t('zalp.toast.hero_out'), t('zalp.toast.hero_out_sub')));
        }
        if (this.hurtEnd) { this.hurtEnd = false; if (this.state === 'aim' || this.state === 'retreat') this.toSettle(); }
        if (this.state === 'aim') {
            this.timeLeft -= dt;
            const s = Math.ceil(this.timeLeft);
            if (s <= 5 && s !== this.lastTick && s > 0) { this.lastTick = s; if (this.localTurn) Z.audio.play('tick'); }
            if (this.timeLeft <= 0) { this.toast(t('zalp.toast.time_up')); this.toSettle(); }
        } else if (this.state === 'retreat') {
            this.retreatLeft -= dt;
            if (this.retreatLeft <= 0) this.toSettle();
        } else if (this.state === 'settle') {
            this.settleT += dt;
            if (this.settleT > 0.7 && (!this.busy() || this.settleT > 20)) {
                const dying = this.units.find((v) => !v.dead && v.hp <= 0);
                if (dying) {
                    dying.dead = true;
                    this.cam.focus = dying;
                    this.graves.push(new Z.Grave(dying.team, dying.x, dying.y));
                    Z.explode(this, dying.x, dying.y, 24, 12);
                    this.toast(t('zalp.toast.out', { name: dying.name }));
                    this.settleT = 0.2;
                    this.refreshHud();
                } else if (!this.crateDone && this.aliveTeams().length > 1) {
                    this.crateDone = true;
                    if (this.turnNo > 1 && this.random() < 0.4) { this.dropCrate(); this.settleT = 0.3; }
                } else this.endTurn();
            }
        } else if (this.state === 'start' && !this.online && this.timers.length === 0 && !this.active) {
            this.nextTurn();
        }
    }

    /** Per frame: run the simulation at its fixed rate, then everything that only shows. */
    update(dt) {
        this.clock += dt;
        let speed = 1;
        if (this.fast && this.control && this.control.kind === 'ai') speed = 3;
        if (this.control && this.control.kind === 'replay' && this.control.backlog() > 90) speed = 2;
        this.acc = Math.min(this.acc + dt * speed, 0.1 * speed);
        while (this.acc >= Z.K.STEP) {
            if (!this.tick()) { this.acc = 0; break; }
            this.acc -= Z.K.STEP;
        }
        for (let i = this.uiTimers.length - 1; i >= 0; i--) { const tm = this.uiTimers[i]; tm.t -= dt; if (tm.t <= 0) { this.uiTimers.splice(i, 1); tm.fn(); } }
        this.fx.update(dt, this.world);
        for (const v of this.units) v.tick(dt);
        for (const p of this.popups) { p.t += dt; p.y -= 26 * dt; }
        this.popups = this.popups.filter((p) => p.t < 1.4);
        if (this.markTarget && (this.markTarget.t -= dt) <= 0) this.markTarget = null;
        this.cloudX += (4 + (this.wind / Z.K.WIND_MAX) * 45) * dt;
        this.ambient(dt);
        this.updateCamera(dt);
        this.world.flushDirty();
    }

    // ---------------------------------------------------------------- online state
    /** The state after a turn: every client applies it, the sender included, so all start the next turn alike. */
    snapshot() {
        return {
            n: this.turnNo,
            water: r2(this.waterTarget),
            units: this.units.map((u) => ({ x: r2(u.x), y: r2(u.y), hp: u.hp, dead: u.dead, drowned: u.drowned, facing: u.facing, aim: r2(u.aim) })),
            mines: this.projs.filter((p) => !p.dead && p.type === 'mine').map((p) => ({ x: r2(p.x), y: r2(p.y), armed: !!p.armed, armT: r2(p.armT) })),
            crates: this.crates.filter((c) => c.alive).map((c) => ({ kind: c.kind, weapon: c.weapon, x: r2(c.x), y: r2(c.y) })),
            graves: this.graves.filter((gr) => !gr.gone).map((gr) => ({ team: gr.team.id, x: r2(gr.x), y: r2(gr.y) })),
            teams: this.teams.map((tm) => ({ ammo: { ...tm.ammo }, next: tm.next, last: tm.lastWeapon, dealt: tm.dealt })),
            craters: this.craters.length / 3,
        };
    }

    applySnapshot(s) {
        this.turnNo = s.n;
        this.waterTarget = s.water; this.world.waterY = s.water;
        s.units.forEach((d, i) => {
            const u = this.units[i];
            if (!u) return;
            Object.assign(u, { x: d.x, y: d.y, hp: d.hp, shownHp: d.hp, dead: d.dead, drowned: d.drowned, facing: d.facing, aim: d.aim, vx: 0, vy: 0, knocked: false, onGround: !d.dead, walking: false });
            if (u.drowned) u.sinkT = 9;
        });
        this.projs = s.mines.map((m) => new Z.Proj(Object.assign({}, Z.WEAPON_BY_ID.mine.proj, { x: m.x, y: m.y, armed: m.armed, armT: m.armT, rest: true })));
        this.crates = s.crates.map((c) => Object.assign(new Z.Crate(c.kind, c.x, c.weapon), { y: c.y, vy: 0, chute: false, landed: true }));
        this.graves = s.graves.map((gr) => Object.assign(new Z.Grave(this.teams[gr.team], gr.x, gr.y - Z.K.UNIT_R), { y: gr.y, vy: 0, ground: true }));
        s.teams.forEach((d, i) => { if (this.teams[i]) Object.assign(this.teams[i], { ammo: { ...d.ammo }, next: d.next, lastWeapon: d.last, dealt: d.dealt }); });
        this.planes = []; this.timers = [];
        this.refreshHud();
    }

    /** FNV-1a over the snapshot: equal hashes mean two computers ended a turn in the same state. */
    stateHash() {
        const text = JSON.stringify(this.snapshot());
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return (h >>> 0).toString(36);
    }

    /** A game rebuilt from its seed, every crater so far and the last snapshot (joining late or resyncing). */
    static restore(opts, craters, snapshot) {
        const g = new Z.Game(Object.assign({}, opts, { headless: true }));
        for (let i = 0; i + 2 < craters.length; i += 3) {
            g.world.carve(craters[i], craters[i + 1], craters[i + 2]);
            g.craters.push(craters[i], craters[i + 1], craters[i + 2]);
        }
        g.world.dirty = null;
        if (snapshot) g.applySnapshot(snapshot);
        g.opts = opts;
        if (Z.R && !opts.headless) Z.R.uploadMask(g.world.data, g.world.W, g.world.H);
        return g;
    }

    // ---------------------------------------------------------------- frame
    ambient(dt) {
        const th = this.world.theme, v = Z.R ? Z.R.view : { w: 1280, h: 720, dpr: 1 }, z = this.cam.zoom * v.dpr;
        const hw = v.w / z / 2, hh = v.h / z / 2;
        if (th.lava && Math.random() < dt * 25) {
            this.fx.add({ x: this.cam.x + Z.rand(-hw, hw), y: this.world.waterY, vx: this.wind * 0.15, vy: -Z.rand(25, 70), frame: 'dot', life: Z.rand(2, 4), s0: Z.rand(0.6, 1.3), s1: 0.2, a0: 1, a1: 0, col: [1, 0.55, 0.15], add: true });
        }
        if (this.world.themeKey === 'snow' && Math.random() < dt * 40) {
            this.fx.add({ x: this.cam.x + Z.rand(-hw * 1.4, hw * 1.4), y: this.cam.y - hh - 10, vx: this.wind * 0.5 + Z.rand(-10, 10), vy: Z.rand(30, 60), frame: 'dot', life: (hh * 2.2) / 45, s0: Z.rand(0.5, 1), s1: 0.5, a0: 0.9, a1: 0.6, col: [1, 1, 1] });
        }
    }

    updateCamera(dt) {
        const c = this.cam, v = Z.R ? Z.R.view : { w: 1280, h: 720, dpr: 1 }, W = this.world.W;
        if (this.demo) {
            c.tx = W / 2 + Math.sin(this.clock * 0.06) * (W * 0.32);
            c.ty = this.world.H * 0.47;
        } else if (c.manual > 0) c.manual -= dt;
        else {
            let tg = null;
            for (let i = this.projs.length - 1; i >= 0 && !tg; i--) { const p = this.projs[i]; if (!p.dead && !p.rest) tg = p; }
            if (!tg && this.planes[0]) tg = { x: this.planes[0].x, y: 120 };
            if (!tg && c.focus && c.focus.alive !== false && !c.focus.landed) tg = c.focus;
            if (!tg && this.state === 'settle') tg = this.units.find((u) => !u.dead && !u.onGround) || (c.focus && c.focus.dead ? c.focus : null);
            if (!tg && this.active && !this.active.dead) tg = this.active;
            if (!tg && this.mine && !this.mine.dead) tg = this.mine;
            if (tg) { c.tx = tg.x; c.ty = tg.y - 40; }
        }
        const k = 1 - Math.exp(-dt * 4);
        c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k;
        c.zoom += (c.tzoom - c.zoom) * (1 - Math.exp(-dt * 8));
        const z = c.zoom * v.dpr, hw = v.w / z / 2, hh = v.h / z / 2;
        c.x = hw * 2 > W + 400 ? W / 2 : Z.clamp(c.x, hw - 200, W + 200 - hw);
        const top = -320 + hh, bot = this.world.H + 40 - hh;
        c.y = top > bot ? (top + bot) / 2 : Z.clamp(c.y, top, bot);
        if (c.shakeT > 0) c.shakeT -= dt; else c.shakeA = 0;
    }

    fitCamera() {
        if (!Z.R) return;
        const v = Z.R.view, fit = Z.clamp(v.w / v.dpr / 1250, 0.55, 2);
        this.cam.zoom = this.cam.tzoom = fit;
    }

    minZoom() { const v = Z.R.view; return Math.max(0.25, Math.min(v.w / v.dpr / (this.world.W + 300), v.h / v.dpr / (this.world.H + 300))); }

    render() {
        const R = Z.R, c = this.cam, v = R.view, th = this.world.theme;
        const s = c.shakeT > 0 ? c.shakeA * (c.shakeT / 0.45) : 0;
        R.setView(c.x + Z.rand(-s, s), c.y + Z.rand(-s, s), c.zoom * v.dpr);
        R.clear();
        R.drawSky(th, this.clock, this.cloudX, this.seed);
        R.drawWater(th, this.world.waterY, this.clock, false);
        R.drawTerrain(th);
        for (const g of this.graves) g.draw(R);
        for (const cr of this.crates) cr.draw(R);
        for (const p of this.projs) if (p.type === 'mine' || p.type === 'dyn') Z.drawProj(R, p, this.clock);
        for (const u of this.units) u.draw(R, this);
        for (const p of this.projs) if (p.type !== 'mine' && p.type !== 'dyn') Z.drawProj(R, p, this.clock);
        for (const pl of this.planes) pl.draw(R);
        this.drawAim(R);
        this.fx.draw(R, false);
        this.fx.draw(R, true);
        R.flush();
        R.drawWater(th, this.world.waterY, this.clock, true);
    }

    drawAim(R) {
        const u = this.active, tc = this.clock;
        if (this.markTarget) R.spr('cross', this.markTarget.x, this.markTarget.y, 1.4, 1.4, tc * 2, [1, 0.35, 0.3]);
        if (this.target) R.spr('cross', this.target.x, this.target.y, 1.3, 1.3, -tc * 2, [1, 0.3, 0.3]);
        if (this.mine && !this.mine.dead && this.mine !== u) R.spr('arrow', this.mine.x, this.mine.y - 27, 0.6, 0.6, 0, [1, 1, 1], 0.55);
        if (!u || u.dead || this.state !== 'aim') return;
        const col = u.team.color, ai = this.control && this.control.ai;
        if (!ai || ai.phase !== 'think') {
            if (this.weapon.mode !== 'target') R.spr('cross', u.x + u.dirX * 58, u.y - 2 + u.dirY * 58, 1, 1, 0, Z.mix3([1, 1, 1], col, 0.35));
            if (this.charging) {
                const n = 16;
                for (let i = 0; i < n * this.power; i++) {
                    const f = i / n, d = 16 + f * 70;
                    R.spr('dot', u.x + u.dirX * d, u.y - 2 + u.dirY * d, 1 + f * 1.8, 1 + f * 1.8, 0, Z.mix3([1, 0.9, 0.3], [1, 0.2, 0.1], f), 1);
                }
            }
        }
        if (this.mouse && this.localTurn && (this.weapon.mode === 'target' || (this.weapon.target && !this.target))) R.spr('cross', this.mouse.x, this.mouse.y, 1.2, 1.2, tc, [1, 1, 1], 0.8);
        if (this.timeLeft > Z.K.TURN_TIME - 4 || !this.localTurn) R.spr('arrow', u.x, u.y - 26 - Math.abs(Math.sin(tc * 4)) * 7, 1, 1, 0, col);
    }
};
