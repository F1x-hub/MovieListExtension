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

// Salvo (Залп) page: menu (solo or online), the waiting room, HUD, arsenal, toasts, camera gestures and keys,
// the 2D label overlay and the main loop.
const PREFS_KEY = 'zalpPrefsV1';
const $ = (id) => document.getElementById(id);
const storage = () => globalThis.chrome?.storage?.local;
const ERROR_KEYS = {
    GAME_NOT_FOUND: 'not_found', INVALID_GAME: 'not_found', GAME_CLOSED: 'closed', GAME_FULL: 'full', NOT_ENOUGH_PLAYERS: 'more_players',
    APPROVAL_REQUIRED: 'approval', AUTH_REQUIRED: 'auth', NETWORK: 'network', NOT_READY: 'network',
};
const TOAST_MS = 1900, TOAST_MIN_MS = 1200, CURSOR_SPEED = 520, PAN_SPEED = 700;
const OVERLAYS = ['zlMenu', 'zlRoom', 'zlPause', 'zlResult'];
// the controls list shown in the menu and the pause card: keys (plain separators as text) and the ctl.* line
const CONTROLS = [
    [['←', '→', '/', 'A', 'D'], 'walk'], [['↑', '↓', '/', 'W', 'S'], 'aim'], [['{space}'], 'fire'],
    [['Enter', '/', 'Backspace'], 'jump'], [['1', '…', '5'], 'fuse'], [['Tab', '/', 'Q'], 'arsenal'],
    [['T'], 'target'], [['Shift', '+', '← ↑ ↓ →'], 'pan'], [['+', '/', '−'], 'zoom'], [['M'], 'mute'],
    [['B'], 'fast'], [['F'], 'fullscreen'], [['Esc'], 'pause'], [['{mouse}'], 'mouse'],
];
const PLAIN = new Set(['/', '…', '+']);

const UI = {
    game: null, paused: false, menuOpen: false, weaponsOpen: false, cursorMode: false, lastOpts: null, hintText: null,
    fsBeforePause: false, prefs: {}, busy: false, pendingCode: null, toasts: [], toastShownAt: 0,

    init(prefs) {
        this.prefs = prefs;
        this.service = new ZalpService();
        this.online = new ZalpOnline(this, this.service);
        this.el = {
            canvas: $('zlCanvas'), labels: $('zlLabels'), stage: $('zlStage'), hud: $('zlHud'), turn: $('zlTurn'), timer: $('zlTimer'),
            windValue: $('zlWindValue'), windBar: $('zlWindBar'), sound: $('zlSound'), fullscreen: $('zlFullscreen'), fast: $('zlFast'),
            chip: $('zlWeaponChip'), teams: $('zlTeams'), hint: $('zlHint'), weapons: $('zlWeapons'), grid: $('zlWeaponGrid'),
            desc: $('zlWeaponDesc'), toast: $('zlToast'), touch: $('zlTouch'), menu: $('zlMenu'), pauseView: $('zlPause'),
            result: $('zlResult'), start: $('zlStart'), room: $('zlRoom'),
        };
        this.ctx = this.el.labels.getContext('2d');
        this.font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
        const motion = matchMedia('(prefers-reduced-motion: reduce)');
        Z.reducedMotion = motion.matches;
        motion.addEventListener('change', () => { Z.reducedMotion = motion.matches; });
        for (const [name, value] of [['zlMode', prefs.mode], ['zlDiff', prefs.diff], ['zlCount', prefs.count], ['zlTeams', prefs.teams], ['zlTheme', prefs.theme], ['zlVis', prefs.vis]]) {
            const input = value !== undefined && document.querySelector(`input[name=${name}][value="${value}"]`);
            if (input) input.checked = true;
        }
        this.setMuted(!!prefs.muted, false);
        this.labelButtons();
        document.querySelectorAll('[data-controls]').forEach((dl) => this.renderControls(dl));

        document.querySelectorAll('input[name=zlMode]').forEach((r) => r.addEventListener('change', () => this.syncMode()));
        this.syncMode();
        this.el.start.addEventListener('click', () => {
            Z.audio.init();
            this.enterFullscreen();
            const opts = { mode: 'solo', diff: +this.choice('zlDiff'), count: +this.choice('zlCount'), teams: +this.choice('zlTeams'), theme: this.choice('zlTheme') };
            this.savePrefs({ mode: 'solo', diff: opts.diff, count: opts.count, teams: opts.teams, theme: opts.theme });
            this.start(opts);
        });
        $('zlCreate').addEventListener('click', (e) => this.onlineAction(() => {
            this.savePrefs({ mode: 'online', theme: this.choice('zlTheme'), vis: this.choice('zlVis') });
            return this.online.create(this.choice('zlVis'), this.choice('zlTheme'));
        }, 'zlOnlineError', e.currentTarget));
        $('zlJoinForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const code = normalizeZalpCode($('zlCode').value);
            if (!code) { this.showOnlineError(t('zalp.err.code')); return; }
            this.onlineAction(() => this.online.join(code), 'zlOnlineError', $('zlJoin'));
        });
        $('zlSignIn').addEventListener('click', () => this.signIn());
        $('zlRoomStart').addEventListener('click', (e) => this.onlineAction(() => { this.enterFullscreen(); return this.online.start(this.choice('zlTheme')); }, 'zlRoomError', e.currentTarget));
        $('zlRoomLeave').addEventListener('click', () => { this.online.leave(); this.toMenu(); });
        $('zlRoomCopy').addEventListener('click', (e) => {
            const button = e.currentTarget;
            navigator.clipboard?.writeText(this.online.code || '').then(() => {
                button.textContent = t('zalp.room_copied');
                clearTimeout(this.copyTimer);
                this.copyTimer = setTimeout(() => { button.textContent = t('zalp.room_copy'); }, 2000);
            }).catch(() => {});
        });
        $('zlResume').addEventListener('click', () => this.setPaused(false));
        $('zlQuit').addEventListener('click', () => { if (this.game?.online) this.online.leave(); this.toMenu(); });
        $('zlAgain').addEventListener('click', () => this.start(this.lastOpts));
        $('zlToMenu').addEventListener('click', () => { if (this.game?.online) this.online.close(); this.toMenu(); });
        $('zlPauseBtn').addEventListener('click', () => this.setPaused(true));
        this.el.sound.addEventListener('click', () => this.toggleSound());
        this.el.fullscreen.addEventListener('click', () => this.toggleFullscreen());
        this.el.fast.addEventListener('click', () => this.toggleFast());
        this.el.chip.addEventListener('click', () => this.toggleWeapons());
        $('zlBack').addEventListener('click', (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } });
        document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
        window.addEventListener('authStateChanged', () => this.syncAccount());
        this.onFullscreenChange();
        this.initPointer();
    },

    renderControls(dl) {
        dl.textContent = '';
        for (const [keys, line] of CONTROLS) {
            const dt = document.createElement('dt');
            keys.forEach((k, i) => {
                if (i) dt.append(' ');
                if (k === '{mouse}') dt.append(t('zalp.keys.mouse'));
                else if (PLAIN.has(k)) dt.append(k);
                else { const kbd = document.createElement('kbd'); kbd.textContent = k === '{space}' ? t('zalp.keys.space') : k; dt.append(kbd); }
            });
            const dd = document.createElement('dd');
            dd.textContent = t('zalp.ctl.' + line);
            dl.append(dt, dd);
        }
    },

    /** Icon buttons carry their shortcut in the tooltip. */
    labelButtons() {
        const pairs = [[this.el.sound, 'zalp.sound', 'M'], [this.el.fast, 'zalp.fast', 'B'], [$('zlPauseBtn'), 'zalp.pause', 'Esc']];
        for (const [b, key, short] of pairs) { b.setAttribute('aria-label', t(key)); b.title = `${t(key)} (${short})`; }
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
    toggleSound() { Z.audio.init(); this.setMuted(!Z.audio.muted); },
    toggleFast() {
        if (!this.game || this.game.online || this.game.demo) return;
        this.game.fast = !this.game.fast;
        this.el.fast.setAttribute('aria-pressed', String(this.game.fast));
    },

    /** No navigation bar on this page: sign in through the extension popup, or Home if the popup cannot open. */
    signIn() {
        const fallback = () => window.open(chrome.runtime.getURL('src/pages/home/home.html'), '_blank');
        try { chrome.action.openPopup().catch(fallback); } catch { fallback(); }
    },

    // ---------------------------------------------------------------- overlays and focus
    syncInert() {
        const covered = OVERLAYS.some((id) => !$(id).hidden);
        for (const el of [this.el.hud, this.el.stage, this.el.touch]) el.inert = covered;
    },

    focusMenu() {
        const online = this.choice('zlMode') === 'online';
        const target = !online ? this.el.start : !$('zlOnlineReady').hidden ? $('zlCreate') : !$('zlOnlineGuest').hidden ? $('zlSignIn') : null;
        (target || document.querySelector('input[name=zlMode]:checked')).focus({ preventScroll: true });
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
        $('zlGuestText').textContent = this.pendingCode ? t('zalp.online_guest_code', { code: this.pendingCode }) : t('zalp.online_guest');
        if (online && signedIn && !this.el.menu.hidden) this.watchLobby();
        else this.stopLobby();
        if (signedIn && this.pendingCode && !this.el.menu.hidden) {
            const code = this.pendingCode;
            this.pendingCode = null;
            this.onlineAction(() => this.online.join(code));
        }
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
        const focused = box.contains(document.activeElement) ? document.activeElement.dataset.code : null;
        box.textContent = '';
        const fresh = games.filter((g) => now - (g.touchedAtMs || 0) < 10 * 60 * 1000);
        if (!fresh.length) {
            const p = document.createElement('p'); p.className = 'zl-lobby__empty'; p.textContent = t('zalp.no_open_games');
            box.append(p);
            return;
        }
        for (const g of fresh) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'zl-lobby__item'; b.dataset.code = g.code;
            const name = document.createElement('span'); name.textContent = g.hostName || g.code;
            const meta = document.createElement('small');
            meta.textContent = `${g.count} ${plural(g.count, 'zalp.players_forms')} · ${t('zalp.terrain_' + (g.theme || 'random'))}`;
            b.append(name, meta);
            b.addEventListener('click', () => this.onlineAction(() => this.online.join(g.code), 'zlOnlineError', b));
            box.append(b);
            if (g.code === focused) b.focus({ preventScroll: true });
        }
    },

    /** Runs one server call at a time; the pressed button shows it is waiting and cannot be pressed twice. */
    async onlineAction(fn, errorBox = 'zlOnlineError', button = null) {
        if (this.busy) return;
        Z.audio.init();
        $(errorBox).hidden = true;
        this.busy = true;
        if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
        try { await fn(); } catch (error) { this.showOnlineError(this.errorText(error), errorBox); }
        finally {
            this.busy = false;
            if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
        }
    },

    errorText(error) { return t('zalp.err.' + (ERROR_KEYS[error?.code] || 'generic')); },

    showOnlineError(text, box = 'zlOnlineError') { const el = $(box); el.textContent = text; el.hidden = false; },

    onlineError(error) { this.showOnlineError(this.errorText(error), this.el.room.hidden ? 'zlOnlineError' : 'zlRoomError'); },

    onlineGone() {
        this.toMenu();
        document.getElementById('zlModeOnline').checked = true;
        this.syncMode();
        this.showOnlineError(t('zalp.toast.room_closed'));
    },

    showRoom(doc, mySeat) {
        const firstShow = this.el.room.hidden;
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
        if (!this.busy) start.disabled = n < 2;
        this.syncInert();
        if (firstShow) (host ? $('zlRoomCopy') : $('zlRoomLeave')).focus({ preventScroll: true });
    },

    attachOnlineGame(g, doc) {
        const first = this.game !== g && !(this.game && this.game.online);
        if (first) { this.paused = false; this.menuOpen = false; this.el.pauseView.hidden = true; }
        this.closeWeapons();
        this.cursorMode = false;
        this.game = g;
        this.lastOpts = null;
        this.el.menu.hidden = true; this.el.room.hidden = true; this.el.result.hidden = true;
        this.el.hud.hidden = false;
        this.el.fast.hidden = true;
        this.el.touch.classList.add('is-enabled');
        $('zlAgain').hidden = true;
        $('zlPauseNote').hidden = false;
        Z.input.capture = !this.menuOpen;
        this.buildWeapons();
        this.teamsFor = null;
        this.refresh(g);
        this.syncInert();
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
        this.el.fullscreen.classList.toggle('is-on', on);
        this.el.fullscreen.setAttribute('aria-label', t(on ? 'zalp.exit_fullscreen' : 'zalp.fullscreen'));
        this.el.fullscreen.title = `${t(on ? 'zalp.exit_fullscreen' : 'zalp.fullscreen')} (F)`;
        if (on) return;
        // Esc in full screen belongs to the browser: leaving that way mid-round opens the pause menu in solo,
        // while the corner button, F and any online battle (which never stops) just leave it
        if (this.fsLeaving) this.fsLeaving = false;
        else if (this.isPlaying() && !this.paused && !this.game.online) { this.setPaused(true); this.fsBeforePause = true; }
    },

    isPlaying() { return !!(this.game && !this.game.demo && this.game.state !== 'over'); },

    start(opts) {
        if (!opts) { this.toMenu(); return; }
        this.lastOpts = opts;
        this.closeWeapons();
        this.stopLobby();
        this.el.menu.hidden = true; this.el.result.hidden = true; this.el.pauseView.hidden = true; this.el.room.hidden = true;
        this.paused = false; this.menuOpen = false; this.cursorMode = false;
        this.game = new Z.Game(opts);
        this.buildWeapons();
        this.teamsFor = null;
        this.el.hud.hidden = false;
        this.el.fast.hidden = false;
        this.el.fast.setAttribute('aria-pressed', 'false');
        this.el.touch.classList.add('is-enabled');
        $('zlAgain').hidden = false;
        $('zlPauseNote').hidden = true;
        Z.input.capture = true;
        this.refresh(this.game);
        this.syncInert();
    },

    toMenu() {
        this.closeWeapons();
        this.paused = false; this.menuOpen = false; this.cursorMode = false;
        this.game = new Z.Game({ count: 3, theme: 'random' }, true);
        this.el.hud.hidden = true; this.el.pauseView.hidden = true; this.el.result.hidden = true; this.el.room.hidden = true;
        this.el.touch.classList.remove('is-enabled');
        this.el.menu.hidden = false;
        Z.input.capture = false;
        this.syncAccount();
        this.syncInert();
        this.focusMenu();
    },

    setPaused(p) {
        if (!this.isPlaying()) return;
        if (!p && this.fsBeforePause) { this.fsBeforePause = false; this.enterFullscreen(); }
        // online the round runs on: the menu only covers it
        this.paused = p && !this.game.online;
        this.menuOpen = p;
        this.cursorMode = false;
        const g = this.game;
        $('zlQuit').textContent = t(g.online && g.mine && !g.mine.dead ? 'zalp.surrender' : 'zalp.quit');
        this.el.pauseView.hidden = !p;
        Z.input.capture = !p;
        Z.input.clear();
        this.syncInert();
        if (p) { this.closeWeapons(); $('zlResume').focus({ preventScroll: true }); }
    },

    /** Toasts queue up: each stays at least TOAST_MIN_MS before the next replaces it. */
    toast(text, sub) {
        this.toasts.push({ text, sub });
        if (this.toasts.length > 3) this.toasts.splice(0, this.toasts.length - 3);
        this.pumpToast();
    },
    pumpToast() {
        if (!this.toasts.length) return;
        const wait = this.toastShownAt + TOAST_MIN_MS - performance.now();
        if (this.toastTimer && wait > 0) { clearTimeout(this.pumpTimer); this.pumpTimer = setTimeout(() => this.pumpToast(), wait); return; }
        const { text, sub } = this.toasts.shift();
        const el = this.el.toast;
        el.textContent = text;
        if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
        el.classList.add('is-visible');
        this.toastShownAt = performance.now();
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => { el.classList.remove('is-visible'); this.toastTimer = null; this.pumpToast(); }, TOAST_MS);
        if (this.toasts.length) { clearTimeout(this.pumpTimer); this.pumpTimer = setTimeout(() => this.pumpToast(), TOAST_MIN_MS); }
    },

    /** A hidden tab does not draw, so an online turn would run out unseen: mark the tab title until it is back. */
    notifyMyTurn() {
        if (!document.hidden) return;
        this.titleBefore = this.titleBefore || document.title;
        document.title = '● ' + t('zalp.turn_you') + ' — ' + t('zalp.page_title');
        if (!this.titleWatch) {
            this.titleWatch = () => {
                if (document.hidden || !this.titleBefore) return;
                document.title = this.titleBefore;
                this.titleBefore = null;
            };
            document.addEventListener('visibilitychange', this.titleWatch);
        }
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
            const desc = () => {
                const locked = b.disabled && this.game.shotsUsed > 0 && this.game.team?.ammo?.[def.id] !== 0;
                this.el.desc.textContent = locked || (b.disabled && this.game.shotsUsed > 0) ? t('zalp.shotgun_locked') : def.desc;
            };
            b.addEventListener('pointerenter', desc);
            b.addEventListener('focus', desc);
            this.el.grid.append(b);
            this.wbtns[def.id] = { b, ammo };
        }
    },
    canPick() { const g = this.game; return !!(g && !g.demo && g.state === 'aim' && g.localTurn && !this.menuOpen); },
    toggleWeapons() { if (this.weaponsOpen) this.closeWeapons(); else if (this.canPick()) this.openWeapons(); },
    openWeapons() {
        this.cursorMode = false;
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
                // the team colour sits in a swatch and the bar; the name stays in the readable chrome colour
                const name = document.createElement('span'); name.className = 'zl-team__name';
                const swatch = document.createElement('i'); swatch.className = 'zl-team__swatch'; swatch.style.background = tm.hex;
                name.append(swatch, document.createTextNode(tm.name + (g.mine && g.mine.team === tm ? ' · ' + t('zalp.you') : '')));
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
        if (kind === 'replay') {
            if (g.state !== 'aim' && g.state !== 'retreat') return '';
            const stall = this.online.stalledMs();
            if (stall > 3000 && !g.control.ready()) return t('zalp.hint.waiting', { name: u.name, n: Math.max(0, Math.ceil(this.online.deadlineLeftMs() / 1000)) });
            return t('zalp.hint.watching', { name: u.name });
        }
        if (kind === 'ai') return g.state === 'aim' ? t(g.control.ai.phase === 'think' ? 'zalp.hint.ai_thinking' : 'zalp.hint.ai_aiming') : '';
        if (g.state === 'retreat') return t('zalp.hint.retreat', { n: Math.ceil(g.retreatLeft) });
        if (g.state !== 'aim' || kind !== 'local') return '';
        if (this.cursorMode) return t('zalp.hint.cursor');
        const def = g.weapon;
        let h;
        if (def.mode === 'target') h = t('zalp.hint.target');
        else if (def.target && !g.target) h = t('zalp.hint.mark');
        else h = t(def.mode === 'charge' ? 'zalp.hint.charge' : 'zalp.hint.instant');
        if (def.fuse) h += t('zalp.hint.fuse');
        return h + t('zalp.hint.arsenal');
    },

    // hint copy marks keys as {space}, {up}, {down}, {tab}, {one}, {five}, {t}, {esc}
    renderHint(text) {
        const el = this.el.hint, keys = { space: t('zalp.keys.space'), up: '↑', down: '↓', tab: 'Tab', one: '1', five: '5', t: 'T', esc: 'Esc' };
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
            if (this.cursorMode && !this.canTarget()) this.cursorMode = false;
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
        else title = g.ffa ? t('zalp.toast.win_one', { name: team.name }) : t('zalp.result.winner', { team: team.name });
        $('zlResultTitle').textContent = title;
        const damage = g.teams.map((tm) => tm.name + ' — ' + tm.dealt).join(', ');
        const alive = team ? team.units.filter((u) => !u.dead).map((u) => `${u.name} (${u.hp})`).join(', ') : '—';
        let stats = t('zalp.result.stats', { rounds: g.round, damage, alive });
        if (!g.online && team === mine && g.opts.diff < 2) stats += ' ' + t('zalp.result.harder');
        $('zlResultStats').textContent = stats;
        this.el.result.hidden = false;
        this.cursorMode = false;
        Z.input.capture = false;
        this.syncInert();
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
            if (!this.cursorMode) this.game.mouse = world(e);
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
                else { this.cursorMode = false; const w = world(e); this.pickPoint(w.x, w.y); }
            }
            drag = null;
        };
        cv.addEventListener('pointerup', end);
        cv.addEventListener('pointercancel', end);
        cv.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!live()) return;
            this.zoomBy(Math.exp(-e.deltaY * 0.0014));
        }, { passive: false });
    },

    pickPoint(x, y) { this.game.command({ t: 'c', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }); },
    zoomBy(k) { const c = this.game.cam; c.tzoom = Z.clamp(c.tzoom * k, this.game.minZoom(), 3); },
    canTarget() { const g = this.game; return !!(g && g.state === 'aim' && g.localTurn && (g.weapon.mode === 'target' || g.weapon.target)); },

    // ---------------------------------------------------------------- keys
    /** Arrows move through the arsenal grid, Enter or Space takes the weapon, Home/End jump to the ends. */
    arsenalKeys() {
        const I = Z.input, all = Z.WEAPONS.map((d) => ({ def: d, ...this.wbtns[d.id] })).filter((w) => w.b);
        if (!all.length) return;
        let i = all.findIndex((w) => w.b === document.activeElement);
        if (i < 0) i = Math.max(0, all.findIndex((w) => w.b.getAttribute('aria-pressed') === 'true'));
        const start = i;
        const first = all[0].b.offsetTop, cols = Math.max(1, all.filter((w) => w.b.offsetTop === first).length);
        // every key of this frame, in the order it was pressed (fast typing can put two in one frame)
        for (const code of I.hit) {
            if (code === 'Enter' || code === 'Space') {
                I.suppress('Enter'); I.suppress('Space');
                if (!all[i].b.disabled) { this.game.command({ t: 'w', id: all[i].def.id }); this.closeWeapons(); }
                return;
            }
            const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[code] || 0;
            if (code === 'Home') i = all.findIndex((w) => !w.b.disabled);
            else if (code === 'End') i = all.length - 1 - [...all].reverse().findIndex((w) => !w.b.disabled);
            else if (step) {
                // a row step wraps around; a column step stops at the edge; disabled weapons are skipped
                for (let k = 1; k <= all.length; k++) {
                    let j = i + step * k;
                    if (Math.abs(step) === 1) j = (j + all.length * k) % all.length;
                    else if (j < 0 || j >= all.length) break;
                    if (!all[j].b.disabled) { i = j; break; }
                }
            }
        }
        if (i !== start && all[i]) all[i].b.focus({ preventScroll: true });
    },

    /** T: a crosshair moved with the arrows picks the point for the air strike, teleport or homing mark. */
    cursorKeys(dt) {
        const I = Z.input, g = this.game, c = g.cam;
        if (I.wasHit('KeyT') || I.wasHit('Escape')) { this.cursorMode = false; return; }
        if (I.wasHit('Enter') || I.wasHit('Space')) {
            I.suppress('Enter'); I.suppress('Space');
            this.cursorMode = false;
            this.pickPoint(g.mouse.x, g.mouse.y);
            return;
        }
        const dx = (I.isDown('ArrowRight') ? 1 : 0) - (I.isDown('ArrowLeft') ? 1 : 0), dy = (I.isDown('ArrowDown') ? 1 : 0) - (I.isDown('ArrowUp') ? 1 : 0);
        const sp = CURSOR_SPEED * dt / Math.max(0.6, c.zoom);
        g.mouse.x = Z.clamp(g.mouse.x + dx * sp, 0, g.world.W);
        g.mouse.y = Z.clamp(g.mouse.y + dy * sp, -250, g.world.H);
        c.tx = g.mouse.x; c.ty = g.mouse.y; c.manual = 0.6;
    },

    keys() {
        const g = this.game, I = Z.input;
        const now = performance.now(), dt = Math.min(0.05, (now - (this.keysAt || now)) / 1000);
        this.keysAt = now;
        if (!g || g.demo) return;
        if (this.cursorMode) { this.cursorKeys(dt); return; }
        if (this.weaponsOpen) this.arsenalKeys();
        if (I.wasHit('Escape')) { if (this.weaponsOpen) this.closeWeapons(); else this.setPaused(!this.menuOpen); }
        if (this.menuOpen || !this.el.result.hidden) return;
        if (I.wasHit('Tab')) this.toggleWeapons();
        if (I.wasHit('KeyF')) this.toggleFullscreen();
        if (I.wasHit('KeyM')) this.toggleSound();
        if (I.wasHit('KeyB')) this.toggleFast();
        if (I.wasHit('Equal') || I.wasHit('NumpadAdd')) this.zoomBy(1.2);
        if (I.wasHit('Minus') || I.wasHit('NumpadSubtract')) this.zoomBy(1 / 1.2);
        if (I.wasHit('KeyT') && this.canTarget() && !this.weaponsOpen) {
            this.cursorMode = true;
            const u = g.active;
            if (!g.mouse || Math.hypot(g.mouse.x - u.x, g.mouse.y - u.y) > 1200) g.mouse = { x: u.x + u.facing * 140, y: u.y - 60 };
        }
        if ((I.isDown('ShiftLeft') || I.isDown('ShiftRight')) && !this.weaponsOpen) {
            const dx = (I.isDown('ArrowRight') ? 1 : 0) - (I.isDown('ArrowLeft') ? 1 : 0), dy = (I.isDown('ArrowDown') ? 1 : 0) - (I.isDown('ArrowUp') ? 1 : 0);
            if (dx || dy) { const c = g.cam, sp = PAN_SPEED * dt / c.zoom; c.x += dx * sp; c.y += dy * sp; c.tx = c.x; c.ty = c.y; c.manual = 3; }
        }
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
    UI.pendingCode = normalizeZalpCode(new URLSearchParams(location.search).get('game'));
    UI.toMenu();
    let last = performance.now(), failure = null;
    const loop = (now) => {
        requestAnimationFrame(loop);
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        // one bug must not freeze the page: log it once and keep drawing
        try {
            Z.R.resize();
            const g = UI.game;
            if (g) {
                if (!UI.paused) g.update(dt);
                g.render();
                UI.frame(g);
            }
            UI.keys();
        } catch (error) {
            if (failure !== error.message) { failure = error.message; console.error('[Salvo] frame failed', error); }
        }
        Z.input.endFrame();
    };
    requestAnimationFrame(loop);
    // the account decides whether online play is open; a ?game=CODE link opens that room (now or after signing in)
    if (UI.pendingCode) {
        document.getElementById('zlModeOnline').checked = true;
        UI.syncMode();
    }
    await globalThis.firebaseManager?.waitForAuthReady?.(8000).catch(() => {});
    UI.syncAccount();
    if (UI.pendingCode && !UI.el.menu.hidden) UI.focusMenu();
}

boot();
