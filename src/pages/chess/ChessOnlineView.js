import { escapeHtml } from '../../shared/games/gamesI18n.js';
import { TIME_CONTROLS, chessPageUrl, clockState, colorOf, turnDeadline } from '../../shared/services/ChessService.js';
import { ChessGameView, ICONS, avatarHtml, tc } from './ChessGameView.js';

const TICK_MS = 200;
const LOW_TIME_BEEP_MS = 10 * 1000;
const short = color => (color === 'white' ? 'w' : color === 'black' ? 'b' : null);
const sameMoves = (a, b) => a.length === b.length && a.every((move, index) => move === b[index]);

/**
 * An online game against another extension user. The game document in
 * Firestore is the truth: every snapshot is replayed onto the local board, the
 * user's own move is shown at once and confirmed (or rolled back) by the
 * `chess` function. Clocks run on the server's time.
 */
export class ChessOnlineView extends ChessGameView {
    /**
     * @param {Object} options - ChessGameView options plus
     *   { service, uid, gameId, describeError }
     */
    constructor(options) {
        super(options);
        this.service = options.service;
        this.uid = options.uid;
        this.gameId = options.gameId;
        this.doc = null;
        this.loaded = false;
        this.accessDenied = false;
        this.missing = false;
        this.pendingMove = null;
        this.oriented = false;
        this.reportedDeadline = null;
        this.lowTimeBeeped = null;
        this.announcedEnd = false;
        this.applying = Promise.resolve();
        this.unsubscribe = null;
        this.tickTimer = null;
    }

    start() {
        super.start();
        this.subscribe();
        this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    }

    destroy() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        clearInterval(this.tickTimer);
        this.options.onAttention?.(null);
        super.destroy();
    }

    subscribe() {
        this.unsubscribe?.();
        try {
            this.unsubscribe = this.service.subscribeGame(this.gameId, doc => this.onDoc(doc), error => this.onDocError(error));
        } catch (error) {
            this.onDocError(error);
        }
    }

    onDocError(error) {
        if (this.disposed) return;
        this.unsubscribe = null;
        if (error?.code === 'permission-denied') {
            // Not a player (yet): the game opens to its players only.
            this.accessDenied = true;
        } else {
            console.warn('[Chess] game unavailable', error);
            this.options.onToast(this.options.describeError(error), 'error');
        }
        this.refresh();
    }

    onDoc(doc) {
        // Snapshots are applied in order; an animation finishes before the next one.
        this.applying = this.applying.then(() => this.applyDoc(doc)).catch(error => console.error('[Chess] could not apply the game', error));
    }

    async applyDoc(doc) {
        if (this.disposed) return;
        if (!doc) {
            this.missing = true;
            this.loaded = true;
            this.refresh();
            return;
        }
        const previous = this.doc;
        this.doc = doc;
        this.loaded = true;
        this.accessDenied = false;
        this.missing = false;
        const color = short(colorOf(doc, this.uid));
        if (!this.oriented && (color || doc.status !== 'waiting')) {
            this.setOrientation(color || 'w', false);
            this.oriented = true;
        } else if (!this.oriented && doc.hostUid === this.uid) {
            this.setOrientation(doc.hostColor === 'black' ? 'b' : 'w', false);
        }

        const remote = Array.isArray(doc.moves) ? doc.moves : [];
        if (this.pendingMove && remote.length >= this.pendingMove.ply && remote[this.pendingMove.ply - 1] === this.pendingMove.uci) {
            this.pendingMove = null;
        }
        const local = this.game.uciMoves();
        if (!this.pendingMove || remote.length > local.length) {
            if (remote.length === local.length + 1 && sameMoves(remote.slice(0, -1), local)) {
                const move = this.game.move(remote[remote.length - 1]);
                if (move) await this.showMove(move);
                else this.rebuild(remote);
            } else if (!sameMoves(remote, local)) {
                this.rebuild(remote);
            }
        }

        if (previous?.status === 'waiting' && doc.status === 'playing') this.sounds?.start();
        if (doc.status === 'finished' && !this.announcedEnd) {
            this.announcedEnd = true;
            this.resultDismissed = false;
            if (previous) this.playResultSound();
        }
        this.updateAttention();
        this.refresh();
    }

    rebuild(moves) {
        try {
            this.game = this.rules.ChessGame.fromMoves(moves);
        } catch (error) {
            console.error('[Chess] the stored moves do not replay', error);
            this.game = new this.rules.ChessGame();
        }
        this.syncBoard();
    }

    playResultSound() {
        const color = this.playerColor;
        const result = this.doc?.result;
        if (!result || !color) return;
        if (result === '1/2-1/2') this.sounds?.draw();
        else if ((result === '1-0') === (color === 'w')) this.sounds?.win();
        else this.sounds?.loss();
    }

    // --- Who and when ---------------------------------------------------------------------------------

    get playerColor() {
        return short(colorOf(this.doc, this.uid));
    }

    uidOf(color) {
        if (!this.doc) return null;
        if (this.doc.status === 'waiting') {
            const hostColor = this.doc.hostColor === 'black' ? 'b' : 'w';
            if (color === hostColor) return this.doc.hostUid;
            return this.doc.invitedUid || null;
        }
        return color === 'w' ? this.doc.whiteUid : this.doc.blackUid;
    }

    opponentUid() {
        if (!this.doc) return null;
        return this.doc.hostUid === this.uid ? (this.doc.guestUid || this.doc.invitedUid) : this.doc.hostUid;
    }

    nameOf(uid) {
        return (uid && this.doc?.names?.[uid]) || tc('online.opponent');
    }

    isPlaying() {
        return this.doc?.status === 'playing';
    }

    canUserMove() {
        return this.isPlaying() && Boolean(this.playerColor) && this.game.turn() === this.playerColor
            && !this.pendingMove && this.game.history().length === (this.doc.moves || []).length;
    }

    hasClocks() {
        return Boolean(TIME_CONTROLS[this.doc?.timeControl]) && this.doc?.status !== 'waiting' && this.doc?.status !== 'cancelled';
    }

    clocks() {
        if (!this.doc) return null;
        return clockState(this.doc, this.service.serverNow());
    }

    updateAttention() {
        const myTurn = this.isPlaying() && this.playerColor === this.game.turn();
        this.options.onAttention?.({ myTurn, title: tc('online.attention', { name: this.nameOf(this.opponentUid()) }) });
    }

    // --- Moves ------------------------------------------------------------------------------------------

    async submitMove(input) {
        if (!this.canUserMove()) return;
        const expected = this.game.history().length;
        const move = this.game.move(input);
        if (!move) {
            this.syncBoard();
            return;
        }
        this.pendingMove = { uci: move.uci, ply: expected + 1 };
        await this.showMove(move);
        try {
            const answer = await this.service.move(this.gameId, move.uci, expected);
            if (answer?.status === 'finished' && answer.endReason === 'timeout' && !(this.doc?.moves || []).includes(move.uci)) {
                // The flag fell before the move landed; the snapshot shows the result.
                this.pendingMove = null;
            }
        } catch (error) {
            if (this.disposed) return;
            this.pendingMove = null;
            this.rebuild(this.doc?.moves || []);
            this.refresh();
            this.options.onToast(this.options.describeError(error), 'error');
        }
    }

    tick() {
        if (this.disposed || !this.doc) return;
        if (this.isPlaying()) {
            const now = this.service.serverNow();
            const deadline = turnDeadline(this.doc);
            const timed = Boolean(TIME_CONTROLS[this.doc.timeControl]);
            const firstMoves = Number(this.doc.moveCount) < 2;
            // Report a fallen flag (or first moves that never came) once; the server checks.
            if ((timed || firstMoves) && now >= deadline + 250 && this.reportedDeadline !== deadline) {
                this.reportedDeadline = deadline;
                this.service.timeout(this.gameId).catch(error => {
                    if (error?.code !== 'TOO_EARLY') console.warn('[Chess] timeout report failed', error);
                    else this.reportedDeadline = null;
                });
            }
            const clocks = timed && !firstMoves ? this.clocks() : null;
            const mine = this.playerColor === 'w' ? 'white' : this.playerColor === 'b' ? 'black' : null;
            if (clocks && mine && clocks.running === mine && clocks[mine] < LOW_TIME_BEEP_MS && this.lowTimeBeeped !== this.doc.moveCount) {
                this.lowTimeBeeped = this.doc.moveCount;
                this.sounds?.lowTime();
            }
            this.renderPlayers();
            this.renderStatus();
        }
    }

    // --- Mode hooks -----------------------------------------------------------------------------------

    playerInfo(color) {
        const uid = this.uidOf(color);
        const doc = this.doc;
        if (!uid) {
            return { name: tc('online.waiting_seat'), meta: '', avatar: '<span class="chess-avatar" aria-hidden="true">?</span>', clockMs: null };
        }
        const name = uid === this.uid ? (doc?.names?.[uid] || tc('game.you')) : this.nameOf(uid);
        const rating = doc?.ratingsAfter?.[uid] ?? doc?.ratings?.[uid];
        const delta = doc?.ratingDelta?.[uid];
        let meta = rating ? tc('online.rating', { rating }) : '';
        if (Number.isFinite(delta)) meta += ` (${delta > 0 ? '+' : ''}${delta})`;
        if (uid === this.uid) meta = meta ? `${tc('game.you')} · ${meta}` : tc('game.you');
        const clocks = this.hasClocks() ? this.clocks() : null;
        const key = color === 'w' ? 'white' : 'black';
        return {
            name,
            meta,
            avatar: avatarHtml(name, doc?.photos?.[uid]),
            clockMs: clocks ? clocks[key] : null,
            clockRunning: clocks ? clocks.running === key : false
        };
    }

    statusInfo() {
        const doc = this.doc;
        if (this.accessDenied) return { tone: 'wait', text: tc('online.join_status'), icon: ICONS.clock };
        if (this.missing) return { tone: 'over', text: tc('online.missing'), icon: ICONS.warning };
        if (!this.loaded || !doc) return { tone: 'wait', text: tc('online.loading'), icon: ICONS.dots };
        if (doc.status === 'waiting') return { tone: 'wait', text: tc('online.waiting'), icon: ICONS.clock };
        if (doc.status === 'cancelled') return { tone: 'over', text: tc(`online.cancelled.${doc.endReason || 'cancelled'}`), icon: ICONS.flag };
        if (doc.status === 'finished') {
            const texts = this.resultTexts({ result: doc.result, reason: doc.endReason }, this.playerColor);
            return { tone: texts.tone, text: `${texts.title}. ${texts.text}`, icon: texts.tone === 'win' ? ICONS.trophy : ICONS.flag };
        }
        const opponent = this.nameOf(this.opponentUid());
        if (this.pendingMove) return { tone: 'wait', text: tc('online.sending'), icon: ICONS.dots };
        const offer = doc.drawOffer;
        if (offer && offer.by !== this.uid && this.playerColor) {
            return {
                tone: 'offer',
                text: tc('online.draw_offered', { name: opponent }),
                icon: ICONS.flag,
                actionHtml: `<span class="chess-status__buttons"><button class="btn btn-primary btn-sm" type="button" data-action="draw-accept">${escapeHtml(tc('online.draw_accept'))}</button><button class="btn btn-ghost btn-sm" type="button" data-action="draw-decline">${escapeHtml(tc('online.draw_decline'))}</button></span>`
            };
        }
        const yours = this.playerColor === this.game.turn();
        const now = this.service.serverNow();
        const deadline = turnDeadline(doc);
        const left = Math.max(0, deadline - now);
        if (Number(doc.moveCount) < 2) {
            const seconds = Math.ceil(left / 1000);
            if (!TIME_CONTROLS[doc.timeControl]) {
                return { tone: yours ? 'turn' : 'wait', text: tc(yours ? 'online.first_move_daily' : 'online.their_turn', { name: opponent }), icon: ICONS.clock };
            }
            return { tone: yours ? 'turn' : 'wait', text: tc(yours ? 'online.first_move' : 'online.first_move_theirs', { seconds, name: opponent }), icon: ICONS.clock };
        }
        if (this.game.status().check) return { tone: 'check', text: tc(yours ? 'status.check_you' : 'status.check_them'), icon: ICONS.warning };
        if (!TIME_CONTROLS[doc.timeControl]) {
            if (!yours && left <= 0) {
                return {
                    tone: 'offer',
                    text: tc('online.claim_hint', { name: opponent }),
                    icon: ICONS.flag,
                    actionHtml: `<button class="btn btn-primary btn-sm chess-status__action" type="button" data-action="claim">${escapeHtml(tc('online.claim'))}</button>`
                };
            }
            return {
                tone: yours ? 'turn' : 'wait',
                text: yours ? tc('online.your_turn_daily', { time: formatHours(left) }) : tc('online.their_turn', { name: opponent }),
                icon: ICONS.clock
            };
        }
        if (offer && offer.by === this.uid) return { tone: 'wait', text: tc('online.draw_sent', { name: opponent }), icon: ICONS.flag };
        return { tone: yours ? 'turn' : 'wait', text: yours ? tc('status.your_turn') : tc('online.their_turn', { name: opponent }), icon: ICONS.clock };
    }

    actions() {
        const doc = this.doc;
        if (!doc || this.accessDenied || this.missing) return [{ action: 'lobby', label: tc('game.to_lobby'), kind: 'secondary' }];
        if (doc.status === 'waiting') {
            if (doc.hostUid === this.uid) {
                return [
                    { action: 'cancel-game', label: tc('online.cancel_game'), kind: 'ghost' },
                    { action: 'lobby', label: tc('game.to_lobby'), kind: 'secondary' }
                ];
            }
            return [{ action: 'lobby', label: tc('game.to_lobby'), kind: 'secondary' }];
        }
        if (doc.status === 'playing' && this.playerColor) {
            const first = Number(doc.moveCount) < 2;
            const offered = doc.drawOffer?.by === this.uid;
            return [
                first
                    ? { action: 'abort', label: tc('online.abort'), kind: 'secondary' }
                    : { action: 'draw', label: offered ? tc('online.draw_pending') : tc('online.offer_draw'), kind: 'secondary', disabled: offered || Boolean(this.pendingMove) },
                { action: 'resign', label: tc('game.resign'), kind: 'ghost', disabled: first }
            ];
        }
        if (doc.status === 'finished' && this.playerColor) {
            return [
                this.rematchAction(),
                { action: 'lobby', label: tc('game.to_lobby'), kind: 'secondary' },
                ...(this.resultDismissed ? [{ action: 'show-result', label: tc('game.show_result'), kind: 'ghost' }] : [])
            ];
        }
        return [{ action: 'lobby', label: tc('game.to_lobby'), kind: 'secondary' }];
    }

    rematchAction() {
        const doc = this.doc;
        if (doc.rematchGameId && doc.rematchBy && doc.rematchBy !== this.uid) {
            return { action: 'rematch', label: tc('online.rematch_accept'), kind: 'primary' };
        }
        if (doc.rematchGameId && doc.rematchBy === this.uid) {
            return { action: 'rematch', label: tc('online.rematch_open'), kind: 'secondary' };
        }
        return { action: 'rematch', label: tc('online.rematch'), kind: 'primary' };
    }

    resultInfo() {
        const doc = this.doc;
        if (!doc || doc.status !== 'finished') return null;
        const texts = this.resultTexts({ result: doc.result, reason: doc.endReason }, this.playerColor);
        const delta = doc.ratingDelta?.[this.uid];
        const after = doc.ratingsAfter?.[this.uid];
        const extra = Number.isFinite(delta) && Number.isFinite(after)
            ? `<p class="chess-result__meta">${escapeHtml(tc('online.rating_change', { rating: after, delta: `${delta > 0 ? '+' : ''}${delta}` }))}</p>`
            : '';
        return {
            title: texts.title,
            text: texts.text,
            icon: texts.tone === 'win' ? ICONS.trophy : ICONS.flag,
            extra,
            actions: this.playerColor
                ? [this.rematchAction(), { action: 'lobby', label: tc('game.to_lobby'), kind: 'secondary' }]
                : [{ action: 'lobby', label: tc('game.to_lobby'), kind: 'secondary' }]
        };
    }

    stageCard() {
        const doc = this.doc;
        const code = escapeHtml(this.gameId);
        if (this.accessDenied) {
            return `<h3>${escapeHtml(tc('online.join_title', { code: this.gameId }))}</h3>
                <p>${escapeHtml(tc('online.join_text'))}</p>
                <div class="chess-stage-card__actions">
                    <button class="btn btn-primary ${this.busy.has('join') ? 'btn--pending' : ''}" type="button" data-action="join" ${this.busy.has('join') ? 'disabled' : ''}>${escapeHtml(tc('online.join_button'))}</button>
                    <button class="btn btn-secondary" type="button" data-action="lobby">${escapeHtml(tc('game.to_lobby'))}</button>
                </div>`;
        }
        if (this.missing) {
            return `<h3>${escapeHtml(tc('online.missing'))}</h3><p>${escapeHtml(tc('online.missing_text'))}</p>
                <div class="chess-stage-card__actions"><button class="btn btn-primary" type="button" data-action="lobby">${escapeHtml(tc('game.to_lobby'))}</button></div>`;
        }
        if (!doc) return null;
        const control = this.controlLabel(doc.timeControl);
        if (doc.status === 'waiting' && doc.hostUid === this.uid) {
            const invited = doc.invitedUid ? this.nameOf(doc.invitedUid) : null;
            const title = invited ? tc('online.waiting_invite_title', { name: invited })
                : doc.visibility === 'public' ? tc('online.waiting_public_title') : tc('online.waiting_private_title');
            const text = invited ? tc('online.waiting_invite_text')
                : doc.visibility === 'public' ? tc('online.waiting_public_text') : tc('online.waiting_private_text');
            return `<h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(text)}</p>
                <p class="chess-stage-card__meta">${escapeHtml(control)} · ${escapeHtml(tc(`online.host_color.${doc.hostColor || 'random'}`))}</p>
                <div class="chess-code" aria-label="${escapeHtml(tc('online.code'))}"><span class="chess-code__label">${escapeHtml(tc('online.code'))}</span><span class="chess-code__value">${code}</span></div>
                <div class="chess-stage-card__actions">
                    <button class="btn btn-secondary btn-sm" type="button" data-action="copy-code">${escapeHtml(tc('online.copy_code'))}</button>
                    <button class="btn btn-secondary btn-sm" type="button" data-action="copy-link">${escapeHtml(tc('online.copy_link'))}</button>
                </div>`;
        }
        if (doc.status === 'waiting' && doc.invitedUid === this.uid) {
            const host = this.nameOf(doc.hostUid);
            const theirColor = doc.hostColor === 'white' ? 'black' : doc.hostColor === 'black' ? 'white' : 'random';
            return `<h3>${escapeHtml(tc(doc.rematchOf ? 'online.invite_rematch_title' : 'online.invite_title', { name: host }))}</h3>
                <p>${escapeHtml(tc('online.invite_text', { control }))}</p>
                <p class="chess-stage-card__meta">${escapeHtml(tc(`online.your_color.${theirColor}`))}${doc.ratings?.[doc.hostUid] ? ` · ${escapeHtml(tc('online.rating', { rating: doc.ratings[doc.hostUid] }))}` : ''}</p>
                <div class="chess-stage-card__actions">
                    <button class="btn btn-primary ${this.busy.has('accept') ? 'btn--pending' : ''}" type="button" data-action="accept" ${this.busy.has('accept') ? 'disabled' : ''}>${escapeHtml(tc('online.accept'))}</button>
                    <button class="btn btn-secondary" type="button" data-action="decline">${escapeHtml(tc('online.decline'))}</button>
                </div>`;
        }
        if (doc.status === 'cancelled') {
            return `<h3>${escapeHtml(tc(`online.cancelled.${doc.endReason || 'cancelled'}`))}</h3>
                <div class="chess-stage-card__actions"><button class="btn btn-primary" type="button" data-action="lobby">${escapeHtml(tc('game.to_lobby'))}</button></div>`;
        }
        return null;
    }

    controlLabel(id) {
        return id && id !== 'none' ? tc('controls.timed', { control: id.replace('+', ' + ') }) : tc('controls.none');
    }

    async handleAction(action) {
        const service = this.service;
        const run = (name, task) => this.runBusy(name, async () => {
            try {
                return await task();
            } catch (error) {
                if (!this.disposed) this.options.onToast(this.options.describeError(error), 'error');
                return null;
            }
        });
        switch (action) {
            case 'lobby':
                this.options.onNavigate(null);
                break;
            case 'join':
            case 'accept': {
                const joined = await run(action, () => service.join(this.gameId));
                if (joined && !this.disposed) {
                    this.accessDenied = false;
                    this.subscribe();
                }
                break;
            }
            case 'decline':
                if (await run('decline', () => service.decline(this.gameId))) this.options.onNavigate(null);
                break;
            case 'cancel-game':
                if (!(await this.confirm('cancel'))) return;
                if (await run('cancel-game', () => service.cancel(this.gameId))) this.options.onNavigate(null);
                break;
            case 'copy-code':
                this.copy(this.gameId);
                break;
            case 'copy-link':
                this.copy(chessPageUrl(`?game=${encodeURIComponent(this.gameId)}`));
                break;
            case 'resign':
                if (!(await this.confirm('resign'))) return;
                await run('resign', () => service.resign(this.gameId));
                break;
            case 'abort':
                await run('abort', () => service.abort(this.gameId));
                break;
            case 'draw':
                if (await run('draw', () => service.offerDraw(this.gameId))) this.options.onToast(tc('online.draw_sent_toast'));
                break;
            case 'draw-accept':
                await run('draw-accept', () => service.answerDraw(this.gameId, true));
                break;
            case 'draw-decline':
                await run('draw-decline', () => service.answerDraw(this.gameId, false));
                break;
            case 'claim':
                await run('claim', () => service.timeout(this.gameId));
                break;
            case 'rematch': {
                const result = await run('rematch', () => service.rematch(this.gameId));
                if (result?.gameId && !this.disposed) this.options.onNavigate(result.gameId);
                break;
            }
            default:
                break;
        }
    }

    async copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.options.onToast(tc('online.copied'));
        } catch {
            this.options.onToast(tc('online.copy_failed'), 'error');
        }
    }

    subtitle() {
        const doc = this.doc;
        if (!doc) return tc('online.subtitle_code', { code: this.gameId });
        return tc('online.subtitle', { control: this.controlLabel(doc.timeControl), code: this.gameId });
    }
}

function formatHours(ms) {
    const minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return tc('online.minutes', { count: minutes });
    return tc('online.hours', { count: Math.round(minutes / 60) });
}
