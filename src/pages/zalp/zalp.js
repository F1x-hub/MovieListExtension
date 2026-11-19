import { i18n } from '../../shared/i18n/I18n.js';
import { t, plural } from '../../shared/games/gamesI18n.js';
import { ZalpService, normalizeZalpCode } from '../../shared/services/ZalpService.js';
import { Z } from '../../shared/games/zalp/ZalpCore.js';
import '../../shared/games/zalp/ZalpArt.js';
import '../../shared/games/zalp/ZalpRenderer.js';
import '../../shared/games/zalp/ZalpWorld.js';
import '../../shared/games/zalp/ZalpEntities.js';
import '../../shared/games/zalp/ZalpWeapons.js';
import '../../shared/games/zalp/ZalpAI.js';
import '../../shared/games/zalp/ZalpGame.js';
import { ZalpOnline } from './ZalpOnline.js';

// Salvo (Залп) page: menu (solo or online), the waiting room, HUD, arsenal, toasts, camera gestures,
// the 2D label overlay and the main loop.
const PREFS_KEY = 'zalpPrefsV1';
const $ = (id) => document.getElementById(id);
const storage = () => globalThis.chrome?.storage?.local;
const ERROR_KEYS = {
    GAME_NOT_FOUND: 'not_found', INVALID_GAME: 'not_found', GAME_CLOSED: 'closed', GAME_FULL: 'full', NOT_ENOUGH_PLAYERS: 'more_players',
    APPROVAL_REQUIRED: 'approval', AUTH_REQUIRED: 'auth', NETWORK: 'network', NOT_READY: 'network',
};

const UI = {
    game: null, paused: false, weaponsOpen: false, lastOpts: null, hintText: null, fsBeforePause: false, prefs: {},

    init(prefs) {
        this.prefs = prefs;
        this.service = new ZalpService();
        this.online = new ZalpOnline(this, this.service);
        this.el = {
            canvas: $('zlCanvas'), labels: $('zlLabels'), hud: $('zlHud'), turn: $('zlTurn'), timer: $('zlTimer'),
            windValue: $('zlWindValue'), windBar: $('zlWindBar'), sound: $('zlSound'), fullscreen: $('zlFullscreen'), fast: $('zlFast'),
            chip: $('zlWeaponChip'), teams: $('zlTeams'), hint: $('zlHint'), weapons: $('zlWeapons'), grid: $('zlWeaponGrid'),
            desc: $('zlWeaponDesc'), toast: $('zlToast'), touch: $('zlTouch'), menu: $('zlMenu'), pauseView: $('zlPause'),
            result: $('zlResult'), start: $('zlStart'), room: $('zlRoom'),
        };
        this.ctx = this.el.labels.getContext('2d');
        this.font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
        for (const [name, value] of [['zlMode', prefs.mode], ['zlDiff', prefs.diff], ['zlCount', prefs.count], ['zlTeams', prefs.teams], ['zlTheme', prefs.theme], ['zlVis', prefs.vis]]) {
            const input = value !== undefined && document.querySelector(`input[name=${name}][value="${value}"]`);
            if (input) input.checked = true;
        }
        this.setMuted(!!prefs.muted, false);

        document.querySelectorAll('input[name=zlMode]').forEach((r) => r.addEventListener('change', () => this.syncMode()));
        this.syncMode();
        this.el.start.addEventListener('click', () => {
            Z.audio.init();
            this.enterFullscreen();
            const opts = { mode: 'solo', diff: +this.choice('zlDiff'), count: +this.choice('zlCount'), teams: +this.choice('zlTeams'), theme: this.choice('zlTheme') };
            this.savePrefs({ mode: 'solo', diff: opts.diff, count: opts.count, teams: opts.teams, theme: opts.theme });
            this.start(opts);
        });
        $('zlCreate').addEventListener('click', () => this.onlineAction(() => {
            this.savePrefs({ mode: 'online', theme: this.choice('zlTheme'), vis: this.choice('zlVis') });
            return this.online.create(this.choice('zlVis'), this.choice('zlTheme'));
        }));
        $('zlJoinForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const code = normalizeZalpCode($('zlCode').value);
            if (!code) { this.showOnlineError(t('zalp.err.code')); return; }
            this.onlineAction(() => this.online.join(code));
        });
        $('zlRoomStart').addEventListener('click', () => this.onlineAction(() => { this.enterFullscreen(); return this.online.start(this.choice('zlTheme')); }, 'zlRoomError'));
        $('zlRoomLeave').addEventListener('click', () => { this.online.leave(); this.toMenu(); });
        $('zlRoomCopy').addEventListener('click', () => {
            navigator.clipboard?.writeText(this.online.code || '').then(() => this.toast(t('zalp.room_copied'))).catch(() => {});
        });
        $('zlResume').addEventListener('click', () => this.setPaused(false));
        $('zlQuit').addEventListener('click', () => { if (this.game?.online) this.online.leave(); this.toMenu(); });
        $('zlAgain').addEventListener('click', () => this.start(this.lastOpts));
        $('zlToMenu').addEventListener('click', () => { if (this.game?.online) this.online.close(); this.toMenu(); });
        $('zlPauseBtn').addEventListener('click', () => this.setPaused(true));
        this.el.sound.addEventListener('click', () => { Z.audio.init(); this.setMuted(!Z.audio.muted); });
        this.el.fullscreen.addEventListener('click', () => this.toggleFullscreen());
        this.el.fast.addEventListener('click', () => {
            if (!this.game) return;
            this.game.fast = !this.game.fast;
            this.el.fast.setAttribute('aria-pressed', String(this.game.fast));
        });
        this.el.chip.addEventListener('click', () => this.toggleWeapons());
        $('zlBack').addEventListener('click', (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } });
        document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
        window.addEventListener('authStateChanged', () => this.syncAccount());
        this.onFullscreenChange();
        this.initPointer();
    },

    choice(name) { return document.querySelector(`input[name=${name}]:checked`).value; },

    savePrefs(patch) {
        this.prefs = Object.assign({}, this.prefs, patch);
        storage()?.set({ [PREFS_KEY]: this.prefs }).catch(() => {});
    },

    setMuted(m, save = true) {
        Z.audio.setMuted(m);
        this.el.sound.setAttribute('aria-pressed', String(m));
        if (save) this.savePrefs({ muted: m });
    },

    // ---------------------------------------------------------------- menu and account
    syncMode() {
        const online = this.choice('zlMode') === 'online';
        $('zlSoloPanel').hidden = online;
        this.el.start.hidden = online;
        $('zlOnlinePanel').hidden = !online;
        this.syncAccount();
    },

    uid() { return this.service?.currentUser()?.uid || null; },

    syncAccount() {
        const online = this.choice('zlMode') === 'online', signedIn = !!this.uid();
        $('zlOnlineGuest').hidden = !online || signedIn;
        $('zlOnlineReady').hidden = !online || !signedIn;
        if (online && signedIn && !this.el.menu.hidden) this.watchLobby();
        else this.stopLobby();
    },

    watchLobby() {
        if (this.unsubLobby) return;
        try {
            this.unsubLobby = this.service.subscribeLobby((doc) => this.renderLobby(doc ? doc.games || [] : []), () => this.renderLobby([]));
        } catch { this.renderLobby([]); }
    },

    stopLobby() { this.unsubLobby?.(); this.unsubLobby = null; },

    renderLobby(games) {
        const box = $('zlLobby'), now = this.service.serverNow();
        box.textContent = '';
        const fresh = games.filter((g) => now - (g.touchedAtMs || 0) < 10 * 60 * 1000);
        if (!fresh.length) {
            const p = document.createElement('p'); p.className = 'zl-lobby__empty'; p.textContent = t('zalp.no_open_games');
            box.append(p);
            return;
        }
        for (const g of fresh) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'zl-lobby__item';
            const name = document.createElement('span'); name.textContent = g.hostName || g.code;
            const meta = document.createElement('small');
            meta.textContent = `${g.count} ${plural(g.count, 'zalp.players_forms')} · ${t('zalp.terrain_' + (g.theme || 'random'))}`;
            b.append(name, meta);
            b.addEventListener('click', () => this.onlineAction(() => this.online.join(g.code)));
            box.append(b);
        }
    },

    async onlineAction(fn, errorBox = 'zlOnlineError') {
        Z.audio.init();
        $(errorBox).hidden = true;
        try { await fn(); } catch (error) { this.showOnlineError(this.errorText(error), errorBox); }
    },

    errorText(error) { return t('zalp.err.' + (ERROR_KEYS[error?.code] || 'generic')); },

    showOnlineError(text, box = 'zlOnlineError') { const el = $(box); el.textContent = text; el.hidden = false; },

    onlineError(error) { this.showOnlineError(this.errorText(error), this.el.room.hidden ? 'zlOnlineError' : 'zlRoomError'); },

    onlineGone() {
        this.toast(t('zalp.toast.room_closed'));
        this.toMenu();
    },

    showRoom(doc, mySeat) {
        this.el.menu.hidden = true;
        this.el.room.hidden = false;
        this.stopLobby();
        $('zlRoomTitle').textContent = t('zalp.room_title', { code: doc.code });
        $('zlRoomCode').textContent = doc.code;
        const n = doc.seats.length;
        $('zlRoomSplit').textContent = n < 2 ? t('zalp.room_split_wait') : n === 2 ? t('zalp.room_split_duel')
            : n % 2 === 0 ? t('zalp.room_split_teams', { n: n / 2 }) : t('zalp.room_split_ffa');
        const list = $('zlRoomPlayers');
        list.textContent = '';
        doc.seats.forEach((seat, i) => {
            const li = document.createElement('li');
            li.textContent = seat.name;
            const tags = [];
            if (seat.uid === doc.host) tags.push(t('zalp.room_host'));
            if (i === mySeat) tags.push(t('zalp.you'));
            if (tags.length) { const s = document.createElement('small'); s.textContent = tags.join(' · '); li.append(s); }
            list.append(li);
        });
        const host = doc.host === this.uid();
        $('zlRoomNote').textContent = t(host ? 'zalp.room_note_host' : 'zalp.room_note_guest');
        const start = $('zlRoomStart');
        start.hidden = !host;
        start.disabled = n < 2;
    },

    attachOnlineGame(g, doc) {
        const first = this.game !== g && !(this.game && this.game.online);
        this.closeWeapons();
        this.game = g;
        this.lastOpts = null;
        this.el.menu.hidden = true; this.el.room.hidden = true; this.el.result.hidden = true;
        this.el.hud.hidden = false;
        this.el.fast.hidden = true;
        this.el.touch.classList.add('is-enabled');
        $('zlAgain').hidden = true;
        $('zlPauseNote').hidden = false;
        $('zlQuit').textContent = t('zalp.surrender');
        Z.input.capture = true;
        this.buildWeapons();
        this.teamsFor = null;
        this.refresh(g);
        if (first) this.toast(t('zalp.online_started'), t('zalp.online_started_sub', { n: doc.seats.length }));
    },

    // ---------------------------------------------------------------- full screen
    enterFullscreen() {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    },
    toggleFullscreen() {
        if (document.fullscreenElement) { this.fsLeaving = true; document.exitFullscreen().catch(() => { this.fsLeaving = false; }); }
        else this.enterFullscreen();
    },
    onFullscreenChange() {
        const on = !!document.fullscreenElement;
        this.el.fullscreen.setAttribute('aria-pressed', String(on));
        this.el.fullscreen.setAttribute('aria-label', t(on ? 'zalp.exit_fullscreen' : 'zalp.fullscreen'));
        if (on) return;
        // Esc in full screen belongs to the browser: leaving that way mid-round opens the pause menu,
        // while the corner button and F just leave
        if (this.fsLeaving) this.fsLeaving = false;
        else if (this.isPlaying() && !this.paused) { this.setPaused(true); this.fsBeforePause = true; }
    },

    isPlaying() { return !!(this.game && !this.game.demo && this.game.state !== 'over'); },

    start(opts) {
        if (!opts) { this.toMenu(); return; }
        this.lastOpts = opts;
        this.closeWeapons();
        this.stopLobby();
        this.el.menu.hidden = true; this.el.result.hidden = true; this.el.pauseView.hidden = true; this.el.room.hidden = true;
        this.paused = false;
        this.game = new Z.Game(opts);
        this.buildWeapons();
        this.teamsFor = null;
        this.el.hud.hidden = false;
        this.el.fast.hidden = false;
        this.el.fast.setAttribute('aria-pressed', 'false');
        this.el.touch.classList.add('is-enabled');
        $('zlAgain').hidden = false;
        $('zlPauseNote').hidden = true;
        $('zlQuit').textContent = t('zalp.quit');
        Z.input.capture = true;
        this.refresh(this.game);
    },

    toMenu() {
        this.closeWeapons();
        this.paused = false;
        this.game = new Z.Game({ count: 3, theme: 'random' }, true);
        this.el.hud.hidden = true; this.el.pauseView.hidden = true; this.el.result.hidden = true; this.el.room.hidden = true;
        this.el.touch.classList.remove('is-enabled');
        this.el.menu.hidden = false;
        Z.input.capture = false;
        this.syncAccount();
        this.el.start.focus({ preventScroll: true });
    },

    setPaused(p) {
        if (!this.isPlaying()) return;
        if (!p && this.fsBeforePause) { this.fsBeforePause = false; this.enterFullscreen(); }
        // online the round runs on: the menu only covers it
        this.paused = p && !this.game.online;
        this.menuOpen = p;
        this.el.pauseView.hidden = !p;
        Z.input.capture = !p;
        Z.input.clear();
        if (p) { this.closeWeapons(); $('zlResume').focus({ preventScroll: true }); }
    },

    toast(text, sub) {
        const el = this.el.toast;
        el.textContent = text;
        if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
        el.classList.add('is-visible');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => el.classList.remove('is-visible'), 1900);
    },

    // ---------------------------------------------------------------- arsenal
    buildWeapons() {
        this.el.grid.textContent = '';
        this.wbtns = {};
        for (const def of Z.WEAPONS) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'zl-wbtn'; b.id = 'zlWeapon-' + def.id;
            const img = document.createElement('img'); img.src = Z.Art.icon(def.icon); img.alt = '';
            const name = document.createElement('span'); name.textContent = def.name;
            const ammo = document.createElement('span'); ammo.className = 'zl-wbtn__ammo';
            b.append(img, name, ammo);
            b.addEventListener('click', () => { this.game.command({ t: 'w', id: def.id }); this.closeWeapons(); });
            const desc = () => { this.el.desc.textContent = def.desc; };
            b.addEventListener('pointerenter', desc);
            b.addEventListener('focus', desc);
            this.el.grid.append(b);
            this.wbtns[def.id] = { b, ammo };
        }
    },
    canPick() { const g = this.game; return !!(g && !g.demo && g.state === 'aim' && g.localTurn && !this.menuOpen); },
    toggleWeapons() { if (this.weaponsOpen) this.closeWeapons(); else if (this.canPick()) this.openWeapons(); },
    openWeapons() {
        this.weaponsOpen = true;
        this.el.weapons.hidden = false;
        this.el.desc.textContent = this.game.weapon.desc;
        this.refresh(this.game);
        this.wbtns[this.game.weapon.id]?.b.focus({ preventScroll: true });
    },
    closeWeapons() {
        this.weaponsOpen = false;
        this.el.weapons.hidden = true;
        if (document.activeElement?.classList.contains('zl-wbtn')) document.activeElement.blur();
    },

    // ---------------------------------------------------------------- HUD
    refresh(g) {
        if (!g || g.demo || g !== this.game) return;
        const team = g.active ? g.active.team : null;
        for (const def of Z.WEAPONS) {
            const w = this.wbtns?.[def.id];
            if (!w || !team) continue;
            const n = team.ammo[def.id];
            w.ammo.textContent = n < 0 ? '∞' : n;
            w.b.disabled = n === 0 || (g.shotsUsed > 0 && def !== g.weapon);
            w.b.setAttribute('aria-pressed', String(def === g.weapon));
        }
        const def = g.weapon;
        this.el.chip.querySelector('img').src = Z.Art.icon(def.icon);
        this.el.chip.querySelector('b').textContent = def.name;
        const n = team ? team.ammo[def.id] : -1;
        let sub = n < 0 ? t('zalp.hud.unlimited') : t('zalp.hud.left', { n });
        if (def.fuse) sub += ' · ' + t('zalp.hud.fuse', { n: g.fuse });
        if (def.shots) sub += ' · ' + t('zalp.hud.shot', { n: Math.min(def.shots, g.shotsUsed + 1), total: def.shots });
        this.el.chip.querySelector('small').textContent = sub;
        this.renderTeams(g, team);
        if (team) {
            this.el.turn.querySelector('.zl-turn__swatch').style.background = team.hex;
            this.el.turn.querySelector('b').textContent = g.ffa ? g.active.name : team.name;
            const who = g.active === g.mine ? t('zalp.you') : g.ffa ? '' : g.active.name;
            const bot = !g.online && g.active !== g.mine ? ' · ' + t('zalp.computer') : '';
            this.el.turn.querySelector('span').textContent = who + bot;
        }
    },

    renderTeams(g, active) {
        if (this.teamsFor !== g) {
            this.teamsFor = g;
            this.el.teams.textContent = '';
            this.teamRows = g.teams.map((tm) => {
                const row = document.createElement('div'); row.className = 'zl-team';
                const name = document.createElement('span'); name.className = 'zl-team__name'; name.style.color = tm.hex;
                name.textContent = tm.name + (g.mine && g.mine.team === tm ? ' · ' + t('zalp.you') : '');
                const bar = document.createElement('div'); bar.className = 'zl-team__bar';
                const fill = document.createElement('div'); fill.className = 'zl-team__fill'; fill.style.background = tm.hex;
                const hp = document.createElement('span'); hp.className = 'zl-team__hp';
                bar.append(fill); row.append(name, bar, hp); this.el.teams.append(row);
                return { tm, row, fill, hp };
            });
        }
        for (const r of this.teamRows) {
            const hp = r.tm.units.reduce((s, u) => s + (u.dead ? 0 : u.hp), 0);
            r.fill.style.width = Math.min(100, (hp / g.startHp) * 100) + '%';
            r.hp.textContent = hp;
            r.row.classList.toggle('is-active', r.tm === active);
        }
    },

    hintFor(g) {
        const u = g.active;
        if (!u || g.state === 'over') return '';
        const kind = g.control ? g.control.kind : null;
        if (kind === 'replay') return g.state === 'aim' || g.state === 'retreat' ? t('zalp.hint.watching', { name: u.name }) : '';
        if (kind === 'ai') return g.state === 'aim' ? t(g.control.ai.phase === 'think' ? 'zalp.hint.ai_thinking' : 'zalp.hint.ai_aiming') : '';
        if (g.state === 'retreat') return t('zalp.hint.retreat', { n: Math.ceil(g.retreatLeft) });
        if (g.state !== 'aim' || kind !== 'local') return '';
        const def = g.weapon;
        let h;
        if (def.mode === 'target') h = t('zalp.hint.target');
        else if (def.target && !g.target) h = t('zalp.hint.mark');
        else h = t(def.mode === 'charge' ? 'zalp.hint.charge' : 'zalp.hint.instant');
        if (def.fuse) h += t('zalp.hint.fuse');
        return h + t('zalp.hint.arsenal');
    },

    // hint copy marks keys as {space}, {up}, {down}, {tab}, {one}, {five}
    renderHint(text) {
        const el = this.el.hint, keys = { space: t('zalp.keys.space'), up: '↑', down: '↓', tab: 'Tab', one: '1', five: '5' };
        el.textContent = '';
        for (const part of text.split(/(\{\w+\})/)) {
            const m = part.match(/^\{(\w+)\}$/);
            if (m && keys[m[1]]) { const k = document.createElement('kbd'); k.textContent = keys[m[1]]; el.append(k); }
            else if (part) el.append(part);
        }
    },

    frame(g) {
        if (!g.demo) {
            const el = this.el.timer;
            let txt = '·', cls = 'zl-timer is-idle';
            if (g.state === 'aim') { txt = Math.max(0, Math.ceil(g.timeLeft)); cls = g.timeLeft <= 10 ? 'zl-timer is-warning' : 'zl-timer'; }
            else if (g.state === 'retreat') txt = Math.ceil(g.retreatLeft);
            if (el.textContent !== String(txt)) el.textContent = txt;
            if (el.className !== cls) el.className = cls;
            const w = g.wind / Z.K.WIND_MAX, pct = Math.round(Math.abs(w) * 100);
            this.el.windBar.style.left = (w < 0 ? 50 - pct / 2 : 50) + '%';
            this.el.windBar.style.width = pct / 2 + '%';
            const wv = pct === 0 ? t('zalp.calm') : w < 0 ? '← ' + pct + '%' : pct + '% →';
            if (this.el.windValue.textContent !== wv) this.el.windValue.textContent = wv;
            const hint = this.hintFor(g);
            if (hint !== this.hintText) { this.renderHint(hint); this.hintText = hint; }
            if (this.weaponsOpen && !this.canPick()) this.closeWeapons();
        }
        this.drawLabels(g);
    },

    drawLabels(g) {
        const ov = this.el.labels, v = Z.R.view, ctx = this.ctx, font = this.font;
        if (ov.width !== v.w || ov.height !== v.h) { ov.width = v.w; ov.height = v.h; }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ov.width, ov.height);
        ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
        const c = g.cam, cw = v.w / v.dpr, ch = v.h / v.dpr;
        const sx = (x) => (x - c.x) * c.zoom + cw / 2, sy = (y) => (y - c.y) * c.zoom + ch / 2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        // in-world labels belong to the scene: dark plates with the team colour, whatever the page theme
        for (const u of g.units) {
            if (u.dead) continue;
            const x = sx(u.x), y = sy(u.y - 16) - 14;
            if (x < -60 || x > cw + 60 || y < -40 || y > ch + 40) continue;
            const name = u === g.mine ? `${u.name} · ${t('zalp.you')}` : u.name;
            ctx.font = `800 11px ${font}`;
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,16,0.75)';
            ctx.strokeText(name, x, y - 14); ctx.fillStyle = u.team.hex; ctx.fillText(name, x, y - 14);
            const hp = String(Math.round(u.shownHp));
            ctx.font = `800 12px ${font}`;
            const bw = ctx.measureText(hp).width + 12;
            ctx.fillStyle = 'rgba(12,16,24,0.82)';
            ctx.beginPath(); ctx.roundRect(x - bw / 2, y - 8, bw, 16, 4); ctx.fill();
            ctx.strokeStyle = u.team.hex; ctx.lineWidth = u === g.mine ? 2.2 : 1.4; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.fillText(hp, x, y + 0.5);
        }
        for (const p of g.projs) {
            if (p.fuse <= 0 || p.type === 'mine') continue;
            const x = sx(p.x), y = sy(p.y) - 18, s = String(Math.ceil(p.fuse));
            ctx.font = `800 13px ${font}`;
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,16,0.8)';
            ctx.strokeText(s, x, y); ctx.fillStyle = p.fuse < 1.05 ? '#ff6b5b' : '#ffd56b'; ctx.fillText(s, x, y);
        }
        const ai = g.control && g.control.ai;
        if (ai && ai.phase === 'think' && g.active) {
            ctx.font = `800 16px ${font}`;
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillText('.'.repeat(1 + (Math.floor(g.clock * 3) % 3)), sx(g.active.x), sy(g.active.y) - 64);
        }
        for (const p of g.popups) {
            ctx.globalAlpha = Z.clamp(1.4 - p.t, 0, 1);
            ctx.font = `800 17px ${font}`;
            ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,10,16,0.85)';
            ctx.strokeText(p.text, sx(p.x), sy(p.y)); ctx.fillStyle = p.color; ctx.fillText(p.text, sx(p.x), sy(p.y));
            ctx.globalAlpha = 1;
        }
    },

    showResult(g, team) {
        const mine = g.mine ? g.mine.team : null;
        let title;
        if (!team) title = t('zalp.result.draw');
        else if (mine) title = t(team === mine ? 'zalp.result.you_won' : 'zalp.result.lose');
        else title = g.ffa ? t('zalp.toast.win', { team: team.name }) : t('zalp.result.winner', { team: team.name });
        $('zlResultTitle').textContent = title;
        const damage = g.teams.map((tm) => tm.name + ' — ' + tm.dealt).join(', ');
        const alive = team ? team.units.filter((u) => !u.dead).map((u) => `${u.name} (${u.hp})`).join(', ') : '—';
        let stats = t('zalp.result.stats', { rounds: g.round, damage, alive });
        if (!g.online && team === mine && g.opts.diff < 2) stats += ' ' + t('zalp.result.harder');
        $('zlResultStats').textContent = stats;
        this.el.result.hidden = false;
        Z.input.capture = false;
        (g.online ? $('zlToMenu') : $('zlAgain')).focus({ preventScroll: true });
    },

    // ---------------------------------------------------------------- camera gestures and clicks
    initPointer() {
        const cv = this.el.canvas, pts = new Map();
        let drag = null, pinch = null;
        const world = (e) => { const r = cv.getBoundingClientRect(), c = this.game.cam; return { x: c.x + (e.clientX - r.left - r.width / 2) / c.zoom, y: c.y + (e.clientY - r.top - r.height / 2) / c.zoom }; };
        const live = () => this.game && !this.game.demo && !this.paused;
        cv.addEventListener('contextmenu', (e) => e.preventDefault());
        cv.addEventListener('pointerdown', (e) => {
            Z.audio.init();
            if (!live()) return;
            if (e.button === 2) { this.toggleWeapons(); return; }
            cv.setPointerCapture(e.pointerId);
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.game.cam.tzoom }; drag = null; }
            else drag = { x: e.clientX, y: e.clientY, moved: false };
        });
        cv.addEventListener('pointermove', (e) => {
            if (!live()) return;
            this.game.mouse = world(e);
            const p = pts.get(e.pointerId);
            if (!p) return;
            const dx = e.clientX - p.x, dy = e.clientY - p.y;
            p.x = e.clientX; p.y = e.clientY;
            const c = this.game.cam;
            if (pinch && pts.size === 2) {
                const [a, b] = [...pts.values()];
                c.tzoom = Z.clamp(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), this.game.minZoom(), 3);
                c.manual = 3;
                return;
            }
            if (drag) {
                if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 7) { drag.moved = true; cv.style.cursor = 'grabbing'; }
                if (drag.moved) { c.x -= dx / c.zoom; c.y -= dy / c.zoom; c.tx = c.x; c.ty = c.y; c.manual = 3; }
            }
        });
        const end = (e) => {
            if (!pts.has(e.pointerId)) return;
            pts.delete(e.pointerId);
            cv.style.cursor = '';
            if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
            if (drag && !drag.moved && e.type === 'pointerup' && live()) {
                if (this.weaponsOpen) this.closeWeapons();
                else { const w = world(e); this.game.command({ t: 'c', x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10 }); }
            }
            drag = null;
        };
        cv.addEventListener('pointerup', end);
        cv.addEventListener('pointercancel', end);
        cv.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!live()) return;
            const c = this.game.cam;
            c.tzoom = Z.clamp(c.tzoom * Math.exp(-e.deltaY * 0.0014), this.game.minZoom(), 3);
        }, { passive: false });
    },

    keys() {
        const g = this.game;
        if (!g || g.demo) return;
        if (Z.input.wasHit('Escape')) { if (this.weaponsOpen) this.closeWeapons(); else this.setPaused(!this.menuOpen); }
        if (Z.input.wasHit('Tab')) this.toggleWeapons();
        if (Z.input.wasHit('KeyF') && !this.menuOpen) this.toggleFullscreen();
        const targeting = g.state === 'aim' && g.localTurn && (g.weapon.mode === 'target' || (g.weapon.target && !g.target));
        this.el.canvas.classList.toggle('is-targeting', !!targeting);
    },
};
Z.UI = UI;

async function boot() {
    await i18n.init();
    i18n.translatePage();
    document.title = t('zalp.page_title');
    let prefs = {};
    try { prefs = (await storage()?.get(PREFS_KEY))?.[PREFS_KEY] || {}; } catch { /* storage unavailable: defaults */ }
    try {
        Z.R.init($('zlCanvas'));
    } catch (err) {
        const box = $('zlError');
        box.textContent = t('zalp.no_webgl', { error: err.message });
        box.hidden = false;
        $('zlStart').disabled = true;
        return;
    }
    Z.input.init();
    UI.init(prefs);
    UI.toMenu();
    let last = performance.now();
    const loop = (now) => {
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        Z.R.resize();
        const g = UI.game;
        if (g) {
            if (!UI.paused) g.update(dt);
            g.render();
            UI.frame(g);
        }
        UI.keys();
        Z.input.endFrame();
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // the account decides whether online play is open; a ?game=CODE link opens that room
    await globalThis.firebaseManager?.waitForAuthReady?.(8000).catch(() => {});
    UI.syncAccount();
    const code = normalizeZalpCode(new URLSearchParams(location.search).get('game'));
    if (code && UI.uid()) {
        document.getElementById('zlModeOnline').checked = true;
        UI.syncMode();
        UI.onlineAction(() => UI.online.join(code));
    }
}

boot();
