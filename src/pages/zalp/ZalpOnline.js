import { Z } from '../../shared/games/zalp/ZalpCore.js';
import { t } from '../../shared/games/gamesI18n.js';

// Networked Salvo on the page: one room or game at a time. The server keeps the order of turns; this
// controller plays our turn (streaming its controls), replays everyone else's from their stream, applies
// each turn's result once its final record arrives, and rebuilds the game from seed + craters + snapshot
// when a turn was skipped, a replay came out different or the stream stopped arriving.
const SEND_EVERY_MS = 800;
const TOUCH_EVERY_MS = 2 * 60 * 1000;
const STALL_REBUILD_MS = 5000;
// errors after which a chunk or a turn result will never be accepted: stop sending and let the server decide
const TERMINAL = new Set(['STALE_TURN', 'NOT_YOUR_TURN', 'GAME_NOT_PLAYING', 'GAME_NOT_FOUND', 'STREAM_POSITION', 'INVALID_STREAM', 'TURN_TOO_LONG', 'INVALID_SNAPSHOT', 'INVALID_CRATERS', 'AUTH_REQUIRED', 'APPROVAL_REQUIRED']);

export class ZalpOnline {
    constructor(ui, service) {
        this.ui = ui;
        this.service = service;
        this.reset();
    }

    reset() {
        this.code = null; this.doc = null; this.game = null; this.mySeat = -1;
        this.unsubGame = null; this.unsubTurn = null; this.turnOf = 0;
        this.turnDocs = {}; this.fed = {}; this.applied = {}; this.lastFeedAt = 0;
        this.stopSending();
        this.timeoutAsked = 0; this.touchTimer = null; this.watchTimer = null; this.resumeTimer = null; this.craterStart = 0;
    }

    stopSending() {
        clearInterval(this.sendTimer); clearTimeout(this.retryTimer); clearInterval(this.resumeTimer);
        this.sendTimer = null; this.retryTimer = null; this.resumeTimer = null;
        this.outbox = []; this.endPayload = null; this.sending = false; this.backoff = 0; this.sentHash = null; this.resume = null;
    }

    uid() { return this.service.currentUser()?.uid || null; }

    // ---------------------------------------------------------------- rooms
    async create(visibility, theme) {
        const r = await this.service.create({ visibility, theme });
        this.enter(r.gameId);
    }

    async join(code) {
        await this.service.join(code);
        this.enter(code);
    }

    enter(code) {
        // a room we opened and are leaving for another one must not stay listed with nobody to start it
        const previous = this.code, wasHost = this.doc?.status === 'waiting' && this.doc.host === this.uid();
        if (previous && previous !== code && wasHost) this.service.leave(previous).catch(() => {});
        this.close(false);
        this.code = code;
        history.replaceState(null, '', `?game=${code}`);
        this.unsubGame = this.service.subscribeGame(code, (doc) => this.onGame(doc), (error) => this.ui.onlineError(error));
        this.touchTimer = setInterval(() => {
            if (this.doc?.status === 'waiting' && this.doc.host === this.uid()) this.service.touch(this.code).catch(() => {});
        }, TOUCH_EVERY_MS);
        this.watchTimer = setInterval(() => this.watch(), 1000);
    }

    async leave() {
        const code = this.code;
        this.close();
        if (code) await this.service.leave(code).catch(() => {});
    }

    close(clearUrl = true) {
        this.unsubGame?.(); this.unsubTurn?.();
        clearInterval(this.touchTimer); clearInterval(this.watchTimer);
        if (this.game) this.game.onTurnDone = null;
        this.reset();
        if (clearUrl) history.replaceState(null, '', location.pathname);
    }

    start(theme) { return this.service.start(this.code, theme); }

    // ---------------------------------------------------------------- game document
    onGame(doc) {
        if (!doc || doc.status === 'closed') { this.close(); this.ui.onlineGone(); return; }
        this.doc = doc;
        this.mySeat = doc.seats.findIndex((s) => s.uid === this.uid());
        if (doc.status === 'waiting') { this.ui.showRoom(doc, this.mySeat); return; }
        if (!this.game) this.build(doc);
        if (doc.status === 'finished') this.stopSending();
        this.pump();
    }

    opts(doc) {
        return { mode: 'online', seed: doc.seed, theme: doc.theme, seats: doc.seats.map((s) => ({ name: s.name, team: s.team })), mySeat: this.mySeat };
    }

    build(doc) {
        const old = this.game;
        const g = Z.Game.restore(this.opts(doc), doc.craters || [], doc.snapshot);
        if (old) { g.cam = old.cam; g.fx = old.fx; old.onTurnDone = null; } else g.fitCamera();
        g.onTurnDone = () => this.onTurnDone();
        if (doc.snapshot) this.applied[doc.snapshot.n] = true;
        // whatever was being sent belongs to the game being replaced
        this.stopSending();
        this.unsubTurn?.(); this.unsubTurn = null; this.turnOf = 0;
        this.game = g;
        this.ui.attachOnlineGame(g, doc);
    }

    sameCraters(list) {
        const mine = this.game.craters;
        return list.length === mine.length && list.every((v, i) => v === mine[i]);
    }

    /** Moves the local game forward as far as the server allows. Safe to call any time. */
    pump() {
        const g = this.game, doc = this.doc;
        if (!g || !doc) return;
        const last = doc.snapshot ? doc.snapshot.n : 0;
        const cur = g.turnNo;
        const idle = g.state === 'start' || g.state === 'done' || g.state === 'over';
        if (!idle) {
            // our game is inside turn `cur`; the server moved on without a result for it: that turn was skipped
            if ((doc.turn && doc.turn.n > cur && last < cur) || (doc.status === 'finished' && last < cur)) return this.rebuildAfterSkip(doc, cur);
            return;
        }
        if (g.state === 'done' && !this.applied[cur]) {
            if (last < cur) {
                if ((doc.turn && doc.turn.n > cur) || doc.status === 'finished') return this.rebuildAfterSkip(doc, cur);
                return; // the result is not on the server yet
            }
            const record = this.turnDocs[cur];
            const hash = this.sentHash || (record && record.final ? record.hash : null);
            if (!hash && !(record && record.final)) return; // wait for the turn's final record and its hash
            this.applied[cur] = true;
            if ((hash && hash !== g.stateHash()) || !this.sameCraters(doc.craters || [])) {
                console.warn('[Salvo] turn', cur, 'came out different here; rebuilding from the server');
                this.build(doc);
                return this.pump();
            }
            g.applySnapshot(doc.snapshot);
            this.sentHash = null;
        }
        if (doc.status === 'finished') {
            if (g.state !== 'over') g.gameOver(doc.winnerTeam === null || doc.winnerTeam === undefined ? null : g.teams[doc.winnerTeam] || null);
            return;
        }
        if (doc.status !== 'playing' || !doc.turn || doc.turn.n <= g.turnNo) return;
        const left = Array.isArray(doc.turn.left) ? doc.turn.left : doc.seats.map((s, i) => (s.left ? i : -1)).filter((i) => i >= 0);
        this.craterStart = g.craters.length;
        g.startOnlineTurn(doc.turn.n, doc.turn.seat, left);
        this.beginTurn(doc.turn.n);
    }

    rebuildAfterSkip(doc, n) {
        const mine = this.game.active && this.game.active === this.game.mine;
        console.warn('[Salvo] turn', n, 'ended on the server without its result; rebuilding');
        this.build(doc);
        if (mine) this.ui.toast(t('zalp.toast.skipped_you'));
        this.pump();
    }

    beginTurn(n) {
        const g = this.game;
        this.unsubTurn?.(); this.unsubTurn = null;
        this.stopSending();
        this.turnOf = n;
        this.lastFeedAt = Date.now();
        if (g.control && g.control.kind === 'local') {
            this.ui.notifyMyTurn?.();
            this.checkResume(n);
            this.sendTimer = setInterval(() => this.flush(), SEND_EVERY_MS);
        } else {
            this.fed[n] = 0; // a fresh replay control needs the stream from its start
            this.listenTurn(n);
        }
    }

    listenTurn(n) {
        this.fed[n] = this.fed[n] || 0;
        this.unsubTurn = this.service.subscribeTurn(this.code, n, (doc) => this.onTurnDoc(n, doc), (error) => {
            console.warn('[Salvo] turn stream unavailable, listening again', error);
            setTimeout(() => { if (this.turnOf === n && this.game && this.game.turnNo === n) { this.unsubTurn?.(); this.listenTurn(n); } }, 1500);
        });
    }

    onTurnDoc(n, doc) {
        if (!doc || this.turnOf !== n) return;
        this.turnDocs[n] = doc;
        const control = this.game.control;
        if (control && control.kind === 'replay' && this.game.turnNo === n) {
            const stream = doc.stream || '';
            if (stream.length > this.fed[n]) { control.feed(stream.slice(this.fed[n]), !!doc.final); this.fed[n] = stream.length; this.lastFeedAt = Date.now(); }
            else if (doc.final && !control.final) control.feed('', true);
        }
        if (doc.final) this.pump();
    }

    /** After a reload in the middle of our own turn: replay what the server already has, then play on from there. */
    checkResume(n) {
        // nothing runs until the answer: local ticks played meanwhile would put the replay on a moved state
        this.game.hold = true;
        let unsub = null;
        const release = () => { unsub?.(); unsub = null; if (this.game) this.game.hold = false; };
        unsub = this.service.subscribeTurn(this.code, n, (doc) => {
            const g = this.game;
            release();
            if (!doc || doc.final || !doc.ticks || this.turnOf !== n || g.turnNo !== n || !g.control || g.control.kind !== 'local') return;
            const replay = new Z.ReplayControl();
            replay.feed(doc.stream || '', true);
            g.control = replay;
            this.resume = { n, ticks: doc.ticks };
            this.resumeTimer = setInterval(() => this.resumeLocal(), 30);
        }, release);
        setTimeout(release, 4000); // no answer: play the turn from here rather than not at all
    }

    resumeLocal() {
        const g = this.game, r = this.resume;
        if (!r || !g || g.turnNo !== r.n || !g.control) { clearInterval(this.resumeTimer); this.resumeTimer = null; return; }
        if (g.control.kind !== 'replay' || g.control.tick < r.ticks) return;
        clearInterval(this.resumeTimer); this.resumeTimer = null;
        if (g.state === 'done') return;
        const local = new Z.LocalControl(true);
        local.encoder.ticks = local.encoder.sentTicks = r.ticks;
        g.control = local;
    }

    // ---------------------------------------------------------------- our turn
    flush() {
        const enc = this.game?.control?.encoder || null;
        if (enc) { const chunk = enc.drain(); if (chunk.ticks) this.outbox.push(chunk); }
        this.sendNext();
    }

    retry(error) {
        // a transient failure (no connection, a server error): try again later, a little later each time
        this.backoff = Math.min(8000, this.backoff ? this.backoff * 2 : 500);
        console.warn(`[Salvo] sending failed, retrying in ${this.backoff} ms`, error);
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => { this.retryTimer = null; this.sendNext(); }, this.backoff);
    }

    sendNext() {
        if (this.sending || this.retryTimer || !this.code) return;
        const n = this.turnOf;
        const done = () => { this.sending = false; this.backoff = 0; if (this.outbox.length || this.endPayload) this.sendNext(); };
        const fail = (error) => {
            this.sending = false;
            if (TERMINAL.has(error.code)) { console.warn('[Salvo] the server refused our turn data:', error.code); this.outbox = []; this.endPayload = null; return; }
            this.retry(error);
        };
        if (this.outbox.length) {
            const chunk = this.outbox[0];
            this.sending = true;
            this.service.stream(this.code, n, chunk.from, chunk.data).then(() => { this.outbox.shift(); done(); }, fail);
            return;
        }
        if (this.endPayload) {
            const payload = this.endPayload;
            this.sending = true;
            this.service.endTurn(this.code, n, payload).then(() => { if (this.endPayload === payload) this.endPayload = null; done(); }, fail);
        }
    }

    onTurnDone() {
        const g = this.game, doc = this.doc;
        const mine = doc && doc.turn && doc.turn.n === g.turnNo && doc.turn.seat === this.mySeat && this.turnOf === g.turnNo;
        if (mine && !this.endPayload && (this.sendTimer || this.resume)) {
            clearInterval(this.sendTimer); this.sendTimer = null;
            clearInterval(this.resumeTimer); this.resumeTimer = null;
            let from, data;
            if (g.lastEncoder) { const chunk = g.lastEncoder.drain(); from = chunk.from; data = chunk.data; }
            else { from = this.resume ? this.resume.ticks : 0; data = ''; }
            this.resume = null;
            this.sentHash = g.stateHash();
            this.endPayload = { from, data, snapshot: g.snapshot(), craters: g.craters.slice(this.craterStart), hash: this.sentHash };
            this.sendNext();
        }
        this.pump();
    }

    // ---------------------------------------------------------------- watchdog
    stalledMs() {
        const c = this.game?.control;
        return c && c.kind === 'replay' && !c.ready() ? Date.now() - this.lastFeedAt : 0;
    }

    deadlineLeftMs() { return this.doc?.turn ? this.doc.turn.deadlineMs - this.service.serverNow() : 0; }

    watch() {
        const doc = this.doc, g = this.game;
        if (!doc || !g) return;
        // a replay that ran out of stream while the server already has the turn's result: take that result
        const c = g.control;
        if (c && c.kind === 'replay' && !c.ready() && doc.snapshot && doc.snapshot.n >= g.turnNo && (c.final || this.stalledMs() > STALL_REBUILD_MS)) {
            console.warn('[Salvo] replay of turn', g.turnNo, 'stopped short of its result; rebuilding from the server');
            this.build(doc);
            this.pump();
            return;
        }
        // someone else's turn that nobody finishes: ask the server to skip it once its deadline has passed
        if (doc.status !== 'playing' || !doc.turn || doc.turn.seat === this.mySeat || this.mySeat < 0) return;
        if (this.deadlineLeftMs() > -1500 || this.timeoutAsked === doc.turn.n) return;
        this.timeoutAsked = doc.turn.n;
        this.service.timeout(this.code, doc.turn.n).catch(() => { this.timeoutAsked = 0; });
    }
}
