import { escapeHtml } from '../../shared/games/gamesI18n.js';
import { ChessBotClient } from '../../shared/games/chess/ChessBotClient.js';
import { ChessGameView, ICONS, avatarHtml, tc } from './ChessGameView.js';

// The quick levels pretend to think a little, so their replies do not snap back.
const MIN_THINK_MS = { 1: 550, 2: 600, 3: 650, 4: 500, 5: 250, 6: 0 };

/**
 * A game against the bot. The position is saved in chrome.storage.local after
 * every move, so the player can leave and continue later; takebacks and hints
 * are allowed, and the result counts in the per-level record.
 */
export class ChessBotView extends ChessGameView {
    /**
     * @param {Object} options - ChessGameView options plus
     *   { store, level, playerColor, saved, userName, userPhoto, onStats }
     */
    constructor(options) {
        super(options);
        this.store = options.store;
        this.level = options.level;
        this.userColor = options.playerColor === 'b' ? 'b' : 'w';
        this.saved = options.saved || null;
        this.bot = new ChessBotClient();
        this.thinking = false;
        this.finished = null;
        this.hints = this.saved?.hints || 0;
        this.undos = this.saved?.undos || 0;
        this.startedAt = this.saved?.startedAt || Date.now();
        this.hintMove = null;
    }

    get playerColor() {
        return this.userColor;
    }

    start() {
        if (this.saved?.moves?.length) this.game = this.rules.ChessGame.fromMoves(this.saved.moves);
        this.orientation = this.userColor;
        super.start();
        this.save();
        this.refresh();
        if (!this.isOver() && this.game.turn() !== this.userColor) this.botTurn();
        else if (!this.saved?.moves?.length) this.sounds?.start();
    }

    destroy() {
        this.bot.dispose();
        super.destroy();
    }

    // --- State -------------------------------------------------------------------------------------

    isOver() {
        return Boolean(this.finished) || this.game.status().over;
    }

    /** { result, reason } once the game is over. */
    outcome() {
        if (this.finished) return this.finished;
        const status = this.game.status();
        return status.over ? { result: status.result, reason: status.reason } : null;
    }

    canUserMove() {
        return !this.thinking && !this.isOver() && this.game.turn() === this.userColor && !this.busy.has('hint');
    }

    save() {
        if (this.isOver()) return;
        this.store.saveBotGame({
            level: this.level,
            playerColor: this.userColor,
            moves: this.game.uciMoves(),
            hints: this.hints,
            undos: this.undos,
            startedAt: this.startedAt
        });
    }

    // --- Play ----------------------------------------------------------------------------------------

    async submitMove(input) {
        const move = this.game.move(input);
        if (!move) {
            this.syncBoard();
            return;
        }
        this.hintMove = null;
        this.save();
        await this.showMove(move);
        if (this.disposed || this.checkEnd()) return;
        this.botTurn();
    }

    async botTurn() {
        if (this.thinking || this.isOver() || this.disposed) return;
        this.thinking = true;
        this.refresh();
        const started = performance.now();
        let result;
        try {
            result = await this.bot.request({ moves: this.game.uciMoves(), level: this.level });
        } catch (error) {
            if (error?.code === 'CANCELLED' || this.disposed) return;
            console.error('[Chess] the bot could not move', error);
            this.thinking = false;
            this.options.onToast(tc('errors.bot_failed'), 'error');
            this.refresh();
            return;
        }
        const wait = (MIN_THINK_MS[this.level] || 0) - (performance.now() - started);
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        if (this.disposed || !this.thinking) return;
        const move = result ? this.game.move(result.uci) : null;
        this.thinking = false;
        if (!move) {
            this.refresh();
            return;
        }
        this.save();
        await this.showMove(move);
        if (!this.disposed) this.checkEnd();
    }

    /** Ends the game if the position says so; true when it did. */
    checkEnd() {
        const outcome = this.outcome();
        if (!outcome) return false;
        this.finish(outcome);
        return true;
    }

    async finish(outcome) {
        this.finished = outcome;
        this.thinking = false;
        this.bot.cancel();
        this.hintMove = null;
        this.board?.setHint?.(null);
        this.resultDismissed = false;
        const winner = outcome.result === '1-0' ? 'w' : outcome.result === '0-1' ? 'b' : null;
        const verdict = winner === null ? 'draw' : winner === this.userColor ? 'win' : 'loss';
        if (verdict === 'win') this.sounds?.win();
        else if (verdict === 'loss') this.sounds?.loss();
        else this.sounds?.draw();
        this.refresh();
        await this.store.clearBotGame();
        const stats = await this.store.recordResult(this.level, verdict);
        this.options.onStats?.(stats);
    }

    undo() {
        if (this.isOver() || !this.game.history().length) return;
        this.bot.cancel();
        this.thinking = false;
        // Back to the player's move: the bot's reply and the player's move.
        this.game.undo();
        if (this.game.turn() !== this.userColor && this.game.history().length) this.game.undo();
        if (this.game.turn() !== this.userColor) {
            // The bot moved first in this game; let it move again.
            this.undos += 1;
            this.save();
            this.syncBoard();
            this.refresh();
            this.botTurn();
            return;
        }
        this.undos += 1;
        this.hintMove = null;
        this.board?.setHint?.(null);
        this.save();
        this.reviewPly = null;
        this.syncBoard();
        this.refresh();
    }

    async hint() {
        if (!this.canUserMove()) return;
        await this.runBusy('hint', async () => {
            try {
                const result = await this.bot.request({ moves: this.game.uciMoves(), hint: true });
                if (!result || this.disposed) return;
                const move = this.game.findMove(result.uci);
                if (move === null) return;
                this.hints += 1;
                this.save();
                this.hintMove = { from: result.uci.slice(0, 2), to: result.uci.slice(2, 4), san: result.san };
                this.board?.setHint?.(this.hintMove);
                this.announce(tc('bot.hint_announce', { move: this.textSan(result.san) }));
            } catch (error) {
                if (error?.code !== 'CANCELLED') this.options.onToast(tc('errors.bot_failed'), 'error');
            }
        });
    }

    async resign() {
        if (this.isOver() || !(await this.confirm('resign'))) return;
        if (this.disposed) return;
        this.finish({ result: this.userColor === 'w' ? '0-1' : '1-0', reason: 'resigned' });
    }

    async newGame() {
        const inProgress = !this.isOver() && this.game.history().length > 0;
        if (inProgress && !(await this.confirm('restart'))) return;
        if (this.disposed) return;
        this.bot.cancel();
        await this.store.clearBotGame();
        this.options.onRestart?.();
    }

    // --- Mode hooks ---------------------------------------------------------------------------------

    playerInfo(color) {
        if (color === this.userColor) {
            const name = this.options.userName || tc('game.you');
            return { name, meta: tc(`colors.${color}`), avatar: avatarHtml(name, this.options.userPhoto) };
        }
        return {
            name: tc('bot.name', { level: tc(`levels.${this.level}.name`) }),
            meta: tc('bot.level_meta', { level: this.level }),
            avatar: `<span class="chess-avatar chess-avatar--bot" aria-hidden="true">${ICONS.robot}</span>`
        };
    }

    statusInfo() {
        const outcome = this.outcome();
        if (outcome) {
            const texts = this.resultTexts(outcome, this.userColor);
            return { tone: texts.tone, text: `${texts.title}. ${texts.text}`, icon: texts.tone === 'win' ? ICONS.trophy : ICONS.flag };
        }
        if (this.thinking) return { tone: 'thinking', text: tc('bot.thinking'), icon: ICONS.dots };
        const status = this.game.status();
        const yours = this.game.turn() === this.userColor;
        if (status.check) return { tone: 'check', text: tc(yours ? 'status.check_you' : 'status.check_them'), icon: ICONS.warning };
        if (this.hintMove) return { tone: 'turn', text: tc('bot.hint_shown', { move: this.textSan(this.hintMove.san) }), icon: ICONS.eye };
        return { tone: 'turn', text: tc(yours ? 'status.your_turn' : 'bot.turn'), icon: ICONS.clock };
    }

    actions() {
        if (this.isOver()) {
            return [
                { action: 'again', label: tc('bot.again'), kind: 'primary' },
                { action: 'lobby', label: tc('game.to_lobby'), kind: 'secondary' },
                ...(this.resultDismissed ? [{ action: 'show-result', label: tc('game.show_result'), kind: 'ghost' }] : [])
            ];
        }
        const moved = this.game.history().some(move => move.color === this.userColor);
        return [
            { action: 'undo', label: tc('bot.undo'), kind: 'secondary', disabled: !moved || this.busy.has('hint') },
            { action: 'hint', label: tc('bot.hint'), kind: 'secondary', disabled: !this.canUserMove() },
            { action: 'resign', label: tc('game.resign'), kind: 'ghost' },
            { action: 'new', label: tc('bot.new_game'), kind: 'ghost' }
        ];
    }

    resultInfo() {
        const outcome = this.outcome();
        if (!outcome) return null;
        const texts = this.resultTexts(outcome, this.userColor);
        const moves = Math.ceil(this.game.history().length / 2);
        const extra = `<p class="chess-result__meta">${escapeHtml(tc('bot.result_meta', { level: tc(`levels.${this.level}.name`), moves, hints: this.hints, undos: this.undos }))}</p>`;
        return {
            title: texts.title,
            text: texts.text,
            icon: texts.tone === 'win' ? ICONS.trophy : ICONS.flag,
            extra,
            actions: [
                { action: 'again', label: tc('bot.again'), kind: 'primary' },
                { action: 'lobby', label: tc('bot.change_level'), kind: 'secondary' }
            ]
        };
    }

    handleAction(action) {
        switch (action) {
            case 'lobby':
                this.options.onNavigate(null);
                break;
            case 'undo':
                this.undo();
                break;
            case 'hint':
                this.hint();
                break;
            case 'resign':
                this.resign();
                break;
            case 'new':
                this.newGame();
                break;
            case 'again':
                this.options.onRestart?.();
                break;
            default:
                break;
        }
    }

    subtitle() {
        return tc('bot.subtitle', { level: this.level, name: tc(`levels.${this.level}.name`) });
    }
}
