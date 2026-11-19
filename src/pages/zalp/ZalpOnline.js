import { Z } from '../../shared/games/zalp/ZalpCore.js';

// Networked Salvo on the page: one room or game at a time. The server keeps the order of turns; this
// controller plays our turn (streaming its controls), replays everyone else's from their stream, applies
// each turn's result and rebuilds the game from seed + craters + snapshot when a turn was skipped or a
// replay came out different.
const SEND_EVERY_MS = 800;
const TOUCH_EVERY_MS = 2 * 60 * 1000;

export class ZalpOnline {
    constructor(ui, service) {
        this.ui = ui;
        this.service = service;
        this.reset();
    }

    reset() {
        this.code = null; this.doc = null; this.game = null; this.mySeat = -1;
        this.unsubGame = null; this.unsubTurn = null; this.turnOf = 0;
        this.streams = {}; this.turnDocs = {}; this.applied = {};
        this.outbox = []; this.sending = false; this.endPayload = null; this.timeoutAsked = 0;
        this.sendTimer = null; this.touchTimer = null; this.watchTimer = null; this.craterStart = 0;
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
        this.close(false);
        this.code = code;
        history.replaceState(null, '', `?game=${code}`);
        this.unsubGame = this.service.subscribeGame(code, (doc) => this.onGame(doc), (error) => this.ui.onlineError(error));
        this.touchTimer = setInterval(() => {
            if (this.doc?.status === 'waiting' && this.doc.host === this.uid()) this.service.touch(this.code).catch(() => {});
        }, TOUCH_EVERY_MS);
        this.watchTimer = setInterval(() => this.watchDeadline(), 2000);
    }

    async leave() {
        const code = this.code;
        this.close();
        if (code) await this.service.leave(code).catch(() => {});
    }

    close(clearUrl = true) {
        this.unsubGame?.(); this.unsubTurn?.();
        clearInterval(this.sendTimer); clearInterval(this.touchTimer); clearInterval(this.watchTimer);
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
        this.pump();
    }

    opts(doc) {
        return { mode: 'online', seed: doc.seed, theme: doc.theme, seats: doc.seats.map((s) => ({ name: s.name, team: s.team })), mySeat: this.mySeat };
    }

    build(doc) {
        const old = this.game;
        const g = Z.Game.restore(this.opts(doc), doc.craters || [], doc.snapshot);
        if (old) { g.cam = old.cam; g.fx = old.fx; } else g.fitCamera();
        g.onTurnDone = () => this.onTurnDone();
        if (doc.snapshot) this.applied[doc.snapshot.n] = true;
        this.game = g;
        this.ui.attachOnlineGame(g, doc);
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
            if ((doc.turn && doc.turn.n > cur && last < cur) || (doc.status === 'finished' && last < cur)) { this.build(doc); return this.pump(); }
            return;
        }
        if (g.state === 'done' && !this.applied[cur]) {
            if (last < cur) {
                if ((doc.turn && doc.turn.n > cur) || doc.status === 'finished') { this.build(doc); return this.pump(); }
                return; // our result (or theirs) is not on the server yet
            }
            const hash = this.turnDocs[cur]?.hash || this.endPayload?.hash || null;
            const same = (!hash || hash === g.stateHash()) && (doc.craters || []).length === g.craters.length;
            this.applied[cur] = true;
            if (!same) { console.warn('[Salvo] turn', cur, 'came out different here; rebuilding from the server'); this.build(doc); return this.pump(); }
            g.applySnapshot(doc.snapshot);
        }
        if (doc.status === 'finished') {
            if (g.state !== 'over') g.gameOver(doc.winnerTeam === null || doc.winnerTeam === undefined ? null : g.teams[doc.winnerTeam] || null);
            return;
        }
        if (doc.status !== 'playing' || !doc.turn || doc.turn.n <= g.turnNo) return;
        const left = doc.seats.map((s, i) => (s.left ? i : -1)).filter((i) => i >= 0);
        this.craterStart = g.craters.length;
        g.startOnlineTurn(doc.turn.n, doc.turn.seat, left);
        this.beginTurn(doc.turn.n);
    }

    beginTurn(n) {
        const g = this.game;
        this.unsubTurn?.(); this.unsubTurn = null;
        clearInterval(this.sendTimer); this.sendTimer = null;
        this.turnOf = n;
        if (g.control && g.control.kind === 'local') {
            this.outbox = []; this.endPayload = null;
            this.sendTimer = setInterval(() => this.flush(), SEND_EVERY_MS);
        } else {
            const fed = { length: 0 };
            const feed = (doc) => {
                if (!doc || this.turnOf !== n) return;
                this.turnDocs[n] = doc;
                const control = this.game.control;
                if (control && control.kind === 'replay' && this.game.turnNo === n) {
                    const fresh = (doc.stream || '').slice(fed.length);
                    fed.length = (doc.stream || '').length;
                    control.feed(fresh, !!doc.final);
                }
                if (doc.final) this.pump();
            };
            this.unsubTurn = this.service.subscribeTurn(this.code, n, feed, (error) => console.warn('[Salvo] turn stream unavailable', error));
        }
    }

    // ---------------------------------------------------------------- our turn
    flush() {
        const g = this.game, enc = g?.control?.encoder || null;
        if (enc) { const chunk = enc.drain(); if (chunk.ticks) this.outbox.push(chunk); }
        this.sendNext();
    }

    sendNext() {
        if (this.sending || !this.code) return;
        const n = this.turnOf;
        if (this.outbox.length) {
            const chunk = this.outbox[0];
            this.sending = true;
            this.service.stream(this.code, n, chunk.from, chunk.data)
                .then(() => { this.outbox.shift(); })
                .catch((error) => { if (error.code === 'STALE_TURN' || error.code === 'NOT_YOUR_TURN') this.outbox = []; else console.warn('[Salvo] chunk not sent, retrying', error); })
                .finally(() => { this.sending = false; if (this.outbox.length || this.endPayload) setTimeout(() => this.sendNext(), this.outbox.length ? 0 : 50); });
            return;
        }
        if (this.endPayload) {
            const payload = this.endPayload;
            this.sending = true;
            this.service.endTurn(this.code, n, payload)
                .then(() => { if (this.endPayload === payload) this.endPayload = null; })
                .catch((error) => {
                    if (['STALE_TURN', 'NOT_YOUR_TURN', 'GAME_NOT_PLAYING'].includes(error.code)) this.endPayload = null;
                    else { console.warn('[Salvo] turn result not sent, retrying', error); setTimeout(() => this.sendNext(), 1500); }
                })
                .finally(() => { this.sending = false; });
        }
    }

    onTurnDone() {
        const g = this.game;
        if (this.turnOf === g.turnNo && g.lastEncoder && this.sendTimer) {
            clearInterval(this.sendTimer); this.sendTimer = null;
            const chunk = g.lastEncoder.drain();
            this.endPayload = { from: chunk.from, data: chunk.data, snapshot: g.snapshot(), craters: g.craters.slice(this.craterStart), hash: g.stateHash() };
            this.sendNext();
        }
        this.pump();
    }

    // ---------------------------------------------------------------- someone else's lost turn
    watchDeadline() {
        const doc = this.doc, g = this.game;
        // a finished stream that ran out before the replay reached the end of its turn: take the server's result
        if (g && doc && g.control && g.control.kind === 'replay' && g.control.final && !g.control.ready() && doc.snapshot && doc.snapshot.n >= g.turnNo) {
            console.warn('[Salvo] replay of turn', g.turnNo, 'ran past its stream; rebuilding from the server');
            this.build(doc);
            this.pump();
            return;
        }
        if (!doc || doc.status !== 'playing' || !doc.turn || doc.turn.seat === this.mySeat || this.mySeat < 0) return;
        if (this.service.serverNow() < doc.turn.deadlineMs + 1500 || this.timeoutAsked === doc.turn.n) return;
        this.timeoutAsked = doc.turn.n;
        this.service.timeout(this.code, doc.turn.n).catch(() => { this.timeoutAsked = 0; });
    }
}
