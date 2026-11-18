import { t, plural, escapeHtml } from '../../shared/games/gamesI18n.js';
import { BattleshipBoard } from '../../shared/games/battleship/BattleshipBoard.js';
import { BattleshipPlacement } from '../../shared/games/battleship/BattleshipPlacement.js';
import { PLACING_IDLE_MS, TURN_IDLE_MS, battleshipPageUrl } from '../../shared/services/BattleshipService.js';

const tb = (key, params) => t(`battleship.${key}`, params);
const DRAG_THRESHOLD_PX = 5;
// The player to move is warned this long before the opponent may claim the game.
const IDLE_WARNING_MS = 60 * 1000;
// The opponent's thinking time is shown once it passes this.
const IDLE_VISIBLE_MS = 30 * 1000;
const DRAFT_PREFIX = 'battleshipDraft:';

function formatDuration(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function initialOf(name) {
    return String(name || '?').trim().charAt(0).toLocaleUpperCase() || '?';
}

function avatarHtml(name, photo) {
    const safe = typeof photo === 'string' && /^https:\/\//i.test(photo) ? photo : null;
    return safe
        ? `<span class="bs-avatar"><img src="${escapeHtml(safe)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
        : `<span class="bs-avatar" aria-hidden="true">${escapeHtml(initialOf(name))}</span>`;
}

function shipBlocksHtml(length, extraClass = '') {
    return `<span class="bs-ship-blocks ${extraClass}" aria-hidden="true">${'<span class="bs-ship-blocks__deck"></span>'.repeat(length)}</span>`;
}

/**
 * The game screen for one game: waiting room, fleet placement, the battle and
 * its result. Reads the game and the player's own fleet from Firestore and sends
 * every action through BattleshipService.
 */
export class BattleshipGameView {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.root
     * @param {import('../../shared/services/BattleshipService.js').BattleshipService} options.service
     * @param {string} options.uid
     * @param {string} options.gameId
     * @param {Object} options.rules - BattleshipRules
     * @param {import('../../shared/games/battleship/BattleshipSounds.js').BattleshipSounds} options.sounds
     * @param {() => string} options.locale
     * @param {(gameId?: string) => void} options.onNavigate - null opens the lobby
     * @param {(text: string, tone?: string) => void} options.onToast
     * @param {(state: {myTurn: boolean, title: string}|null) => void} options.onAttention
     * @param {(error: Error) => string} options.describeError
     * @param {Function|null} [options.Board3D] - BattleshipBoardRenderer where WebGL works
     * @param {'3d'|'top'} [options.boardView] - the camera of the 3D boards
     * @param {(view: '3d'|'top') => void} [options.onBoardView]
     * @param {{ levelName: string }|null} [options.local] - a game against the computer
     *   (BattleshipLocalGame as the service): no idle claims, no code, «Ещё партия»
     */
    constructor(options) {
        this.options = options;
        this.local = options.local || null;
        this.root = options.root;
        this.service = options.service;
        this.uid = options.uid;
        this.gameId = options.gameId;
        this.rules = options.rules;
        this.sounds = options.sounds;
        this.boardView = options.boardView === 'top' ? 'top' : '3d';
        this.game = null;
        this.fleet = null;
        this.fleetLoaded = false;
        this.access = 'loading';
        this.layout = null;
        this.placement = null;
        this.pendingShot = null;
        this.busy = new Set();
        this.hoverIndex = null;
        this.drag = null;
        this.suppressClick = false;
        this.lastSoundMove = null;
        this.lastTurnUid = null;
        this.unsubscribers = [];
        this.timer = null;
        this.disposed = false;
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleClick = this.handleClick.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
    }

    get locale() {
        return this.options.locale();
    }

    get opponentUid() {
        const game = this.game;
        if (!game) return null;
        if (this.uid === game.hostUid) return game.guestUid || game.invitedUid || null;
        return game.hostUid;
    }

    get opponentName() {
        if (this.local) return tb('bot.name');
        const uid = this.opponentUid;
        return (uid && this.game?.names?.[uid]) || tb('game.opponent');
    }

    get isSeated() {
        const game = this.game;
        return Boolean(game && (game.hostUid === this.uid || game.guestUid === this.uid));
    }

    get myReady() {
        return this.game?.ready?.[this.uid] === true;
    }

    get opponentReady() {
        return this.game?.ready?.[this.opponentUid] === true;
    }

    start() {
        this.root.addEventListener('click', this.handleClick);
        this.root.addEventListener('keydown', this.handleKeydown);
        this.renderLoading();
        this.subscribeGame();
        this.timer = setInterval(() => this.tick(), 1000);
    }

    destroy() {
        this.disposed = true;
        this.unsubscribers.forEach(unsubscribe => unsubscribe());
        this.unsubscribers = [];
        clearInterval(this.timer);
        this.endDrag();
        this.ownBoard?.destroy();
        this.enemyBoard?.destroy();
        this.ownBoard = null;
        this.enemyBoard = null;
        this.root.removeEventListener('click', this.handleClick);
        this.root.removeEventListener('keydown', this.handleKeydown);
        this.root.replaceChildren();
        this.options.onAttention(null);
    }

    subscribeGame() {
        this.unsubscribers.forEach(unsubscribe => unsubscribe());
        this.unsubscribers = [];
        const stopGame = this.service.subscribeGame(this.gameId, game => {
            if (this.disposed) return;
            this.access = game ? 'player' : 'missing';
            this.onGame(game);
        }, error => {
            if (this.disposed) return;
            // Rules hide a game from everyone who is not playing it (and a code that
            // does not exist looks the same), so the screen offers to join.
            this.access = error?.code === 'permission-denied' ? 'outsider' : 'error';
            this.game = null;
            this.render();
        });
        const stopFleet = this.service.subscribeFleet(this.gameId, this.uid, fleet => {
            if (this.disposed) return;
            this.fleetLoaded = true;
            const check = fleet ? this.rules.validateFleet(fleet.ships) : null;
            this.fleet = check?.ok ? check.ships : null;
            if (this.fleet) this.clearDraft();
            this.render();
        }, () => {
            this.fleetLoaded = true;
        });
        this.unsubscribers.push(stopGame, stopFleet);
    }

    onGame(game) {
        const previous = this.game;
        this.game = game;
        if (game && previous && previous.status === 'waiting' && game.status === 'placing' && previous.hostUid === this.uid) {
            this.options.onToast(tb('game.opponent_joined', { name: this.opponentName }));
        }
        this.playSnapshotSounds(previous, game);
        if (this.pendingShot && game && Number(game.moveCount) > this.pendingShot.move) this.pendingShot = null;
        this.render();
    }

    /**
     * Cues for what the opponent did. The first snapshot only sets the baseline, so
     * opening a game in progress is silent; our own shots sound from fire().
     */
    playSnapshotSounds(previous, game) {
        if (!game) return;
        const primed = this.soundsPrimed === true;
        this.soundsPrimed = true;
        const shot = game.lastShot;
        const shotMove = Number(shot?.move) || 0;
        if (primed && shot && shotMove > (this.lastSoundMove || 0) && shot.by !== this.uid
            && (shot.result === 'hit' || shot.result === 'sunk')) {
            this.sounds.incomingHit();
        }
        this.lastSoundMove = Math.max(this.lastSoundMove || 0, shotMove);
        if (primed && game.status === 'playing' && game.turnUid === this.uid && this.lastTurnUid !== this.uid) {
            this.sounds.yourTurn();
        }
        if (primed && previous?.status === 'playing' && game.status === 'finished') this.playEndSound(game);
        this.lastTurnUid = game.status === 'playing' ? game.turnUid || null : null;
    }

    playEndSound(game) {
        if (this.endSoundPlayed) return;
        this.endSoundPlayed = true;
        if (game.winnerUid === this.uid) this.sounds.victory();
        else this.sounds.defeat();
    }

    // --- Rendering ---------------------------------------------------------------

    renderLoading() {
        this.layout = 'loading';
        this.root.innerHTML = `
            <div class="bs-view--center">
                <div class="app-loader app-loader--section" role="status">
                    <div class="app-loader__indicator" aria-hidden="true"></div>
                    <span class="app-loader__label">${escapeHtml(tb('loading'))}</span>
                </div>
            </div>`;
    }

    targetLayout() {
        const game = this.game;
        if (this.access === 'outsider' || this.access === 'missing') return 'join';
        if (this.access === 'error') return 'error';
        if (!game) return 'loading';
        if (game.status === 'waiting') return game.hostUid === this.uid ? 'waiting-host' : 'waiting-invitee';
        if (game.status === 'cancelled' && !game.guestUid) return 'closed';
        return 'arena';
    }

    render() {
        if (this.disposed) return;
        const layout = this.targetLayout();
        if (layout !== this.layout || layout === 'waiting-host' || layout === 'waiting-invitee' || layout === 'closed' || layout === 'join' || layout === 'error') {
            this.renderLayout(layout);
        }
        if (layout === 'arena') this.updateArena();
        this.updateAttention();
    }

    renderLayout(layout) {
        const focusedAction = this.root.contains(document.activeElement) ? document.activeElement?.dataset?.action : null;
        if (this.layout === 'arena' && layout !== 'arena') {
            this.ownBoard?.destroy();
            this.enemyBoard?.destroy();
            this.ownBoard = null;
            this.enemyBoard = null;
        }
        this.layout = layout;
        if (layout === 'loading') {
            this.renderLoading();
            return;
        }
        if (layout === 'join') this.root.innerHTML = this.joinHtml();
        else if (layout === 'error') this.root.innerHTML = this.messageHtml(tb('errors.generic'), '', true);
        else if (layout === 'waiting-host') this.root.innerHTML = this.waitingHostHtml();
        else if (layout === 'waiting-invitee') this.root.innerHTML = this.waitingInviteeHtml();
        else if (layout === 'closed') this.root.innerHTML = this.closedHtml();
        else if (layout === 'arena') this.buildArena();
        if (focusedAction) this.root.querySelector(`[data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
    }

    backButtonHtml() {
        return `<button class="bs-back" type="button" data-action="lobby">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
            <span>${escapeHtml(tb('game.back'))}</span>
        </button>`;
    }

    messageHtml(title, text, withBack = true, actions = '') {
        return `
            <div class="bs-view--center">
                <div class="bs-panel bs-panel--message">
                    <h2>${escapeHtml(title)}</h2>
                    ${text ? `<p>${escapeHtml(text)}</p>` : ''}
                    <div class="bs-actions">${actions}${withBack ? `<button class="btn btn-secondary" type="button" data-action="lobby">${escapeHtml(tb('game.back'))}</button>` : ''}</div>
                </div>
            </div>`;
    }

    joinHtml() {
        const busy = this.busy.has('join');
        const error = this.joinError ? `<p class="bs-field-error" role="alert">${escapeHtml(this.joinError)}</p>` : '';
        return `
            <div class="bs-view--center">
                <div class="bs-panel bs-panel--message">
                    <h2>${escapeHtml(tb('game.join_title', { code: this.gameId }))}</h2>
                    <p>${escapeHtml(tb('game.join_text'))}</p>
                    ${error}
                    <div class="bs-actions">
                        <button class="btn btn-primary ${busy ? 'btn--pending' : ''}" type="button" data-action="join" ${busy ? 'disabled aria-busy="true"' : ''}>${escapeHtml(tb('game.join_button'))}</button>
                        <button class="btn btn-secondary" type="button" data-action="lobby">${escapeHtml(tb('game.back'))}</button>
                    </div>
                </div>
            </div>`;
    }

    waitingHostHtml() {
        const game = this.game;
        const invitedName = game.invitedUid ? game.names?.[game.invitedUid] || tb('game.opponent') : null;
        const mode = invitedName ? 'invite' : game.visibility === 'public' ? 'public' : 'private';
        const title = mode === 'invite' ? tb('game.waiting_invite_title', { name: invitedName }) : tb(`game.waiting_${mode}_title`);
        const text = mode === 'invite' ? tb('game.waiting_invite_text') : tb(`game.waiting_${mode}_text`);
        const expires = Number(game.expiresAtMs) > 0 && mode !== 'public'
            ? `<p class="bs-hint">${escapeHtml(tb('game.expires', { time: this.formatClock(game.expiresAtMs) }))}</p>` : '';
        const busy = this.busy.has('cancel');
        const share = mode === 'invite' ? '' : `
            <div class="bs-code" aria-label="${escapeHtml(tb('game.code'))}">
                <span class="bs-code__label">${escapeHtml(tb('game.code'))}</span>
                <span class="bs-code__value">${escapeHtml(game.id)}</span>
            </div>
            <div class="bs-actions">
                <button class="btn btn-secondary" type="button" data-action="copy-code">${escapeHtml(tb('game.copy_code'))}</button>
                <button class="btn btn-secondary" type="button" data-action="copy-link">${escapeHtml(tb('game.copy_link'))}</button>
            </div>`;
        return `
            <div class="bs-waiting">
                ${this.backButtonHtml()}
                <div class="bs-panel bs-panel--waiting">
                    <div class="bs-radar" aria-hidden="true"><span></span></div>
                    <h2>${escapeHtml(title)}</h2>
                    <p>${escapeHtml(text)}</p>
                    ${share}
                    ${expires}
                    <div class="bs-actions">
                        <button class="btn btn-ghost ${busy ? 'btn--pending' : ''}" type="button" data-action="cancel" ${busy ? 'disabled aria-busy="true"' : ''}>${escapeHtml(tb('game.cancel_game'))}</button>
                    </div>
                </div>
            </div>`;
    }

    waitingInviteeHtml() {
        const game = this.game;
        const hostName = game.names?.[game.hostUid] || tb('game.opponent');
        const title = game.rematchOf ? tb('game.invite_rematch_title', { name: hostName }) : tb('game.invite_title', { name: hostName });
        const accepting = this.busy.has('accept');
        const declining = this.busy.has('decline');
        return `
            <div class="bs-waiting">
                ${this.backButtonHtml()}
                <div class="bs-panel bs-panel--waiting">
                    <div class="bs-invite-from">${avatarHtml(hostName, game.photos?.[game.hostUid])}</div>
                    <h2>${escapeHtml(title)}</h2>
                    <p>${escapeHtml(tb('game.invite_text'))}</p>
                    <div class="bs-actions">
                        <button class="btn btn-primary ${accepting ? 'btn--pending' : ''}" type="button" data-action="accept" ${accepting || declining ? 'disabled' : ''}>${escapeHtml(tb('lobby.accept'))}</button>
                        <button class="btn btn-secondary ${declining ? 'btn--pending' : ''}" type="button" data-action="decline" ${accepting || declining ? 'disabled' : ''}>${escapeHtml(tb('lobby.decline'))}</button>
                    </div>
                </div>
            </div>`;
    }

    closedHtml() {
        const game = this.game;
        const name = this.opponentName;
        const reasonKey = { declined: 'declined', expired: 'expired', cancelled: 'cancelled' }[game.endReason] || 'cancelled';
        const text = tb(`game.reason_${reasonKey}`, { name });
        const actions = `<button class="btn btn-primary" type="button" data-action="new-game">${escapeHtml(tb('game.new_game'))}</button>`;
        return this.messageHtml(tb('game.result_cancelled'), text, true, actions);
    }

    buildArena() {
        const threeD = Boolean(this.options.Board3D);
        const viewLabel = escapeHtml(tb('game.view_top'));
        const viewButton = threeD
            ? `<button class="bs-icon-btn bs-view-btn" type="button" data-action="board-view" aria-pressed="${this.boardView === 'top'}" title="${viewLabel}" aria-label="${viewLabel}">${TOP_VIEW_ICON}</button>`
            : '';
        this.root.innerHTML = `
            <div class="bs-game">
                <div class="bs-game__top">
                    ${this.backButtonHtml()}
                    <div class="bs-versus" id="bsVersus"></div>
                    <div class="bs-game__tools">
                        ${this.local
        ? `<span class="bs-code-chip"><span>${escapeHtml(tb('bot.level_chip'))}</span> <strong>${escapeHtml(this.local.levelName)}</strong></span>`
        : `<span class="bs-code-chip"><span>${escapeHtml(tb('game.code'))}</span> <strong>${escapeHtml(this.gameId)}</strong></span>`}
                        ${viewButton}
                    </div>
                </div>
                <div class="bs-banner" id="bsBanner">
                    <span class="bs-banner__icon" id="bsBannerIcon" aria-hidden="true"></span>
                    <div class="bs-banner__copy">
                        <div role="status" aria-live="polite" aria-atomic="true">
                            <strong class="bs-banner__title" id="bsBannerTitle"></strong>
                            <span class="bs-banner__text" id="bsBannerText"></span>
                        </div>
                        <span class="bs-banner__timer" id="bsBannerTimer"></span>
                    </div>
                    <div class="bs-banner__actions" id="bsBannerActions"></div>
                </div>
                <div class="bs-arena${threeD ? ' is-3d' : ''}" id="bsArena">
                    <section class="bs-side bs-side--own" aria-labelledby="bsOwnTitle">
                        <header class="bs-side__head">
                            <h2 id="bsOwnTitle">${escapeHtml(tb('game.own_board'))}</h2>
                            <span class="bs-side__meta" id="bsOwnMeta"></span>
                        </header>
                        <div class="bs-board-host" id="bsOwnBoard"></div>
                        <div class="bs-fleet" id="bsOwnFleet"></div>
                    </section>
                    <section class="bs-side bs-side--enemy" id="bsEnemySide" aria-labelledby="bsEnemyTitle">
                        <header class="bs-side__head">
                            <h2 id="bsEnemyTitle"></h2>
                            <span class="bs-side__meta" id="bsEnemyMeta"></span>
                        </header>
                        <div class="bs-board-host" id="bsEnemyBoard"></div>
                        <div class="bs-fleet" id="bsEnemyFleet"></div>
                    </section>
                    <aside class="bs-side bs-tools" id="bsTools" aria-labelledby="bsToolsTitle" hidden>
                        <header class="bs-side__head">
                            <h2 id="bsToolsTitle">${escapeHtml(tb('game.dock_title'))}</h2>
                            <button class="btn btn-ghost btn-sm" type="button" data-action="clear">${escapeHtml(tb('game.clear'))}</button>
                        </header>
                        <ul class="bs-dock" id="bsDock"></ul>
                        <div class="bs-tools__actions">
                            <button class="btn btn-secondary" type="button" data-action="random">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
                                <span>${escapeHtml(tb('game.random'))}</span>
                            </button>
                            <button class="btn btn-secondary" type="button" data-action="rotate" aria-keyshortcuts="R">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                                <span>${escapeHtml(tb('game.rotate'))}</span>
                            </button>
                        </div>
                        <p class="bs-hint">${escapeHtml(tb('game.placing_keys'))}</p>
                        <p class="bs-placement-status" id="bsPlacementStatus" aria-live="polite"></p>
                        <button class="btn btn-primary bs-ready-btn" type="button" data-action="ready" id="bsReadyBtn">${escapeHtml(tb('game.ready'))}</button>
                    </aside>
                </div>
                <div class="bs-game__footer" id="bsFooter"></div>
            </div>`;

        const columns = this.rules.columnLabels(this.locale);
        this.ownBoard = this.createBoard(this.root.querySelector('#bsOwnBoard'), {
            rules: this.rules,
            columns,
            side: 'own',
            label: tb('game.own_board'),
            describeCell: (index, info) => this.describeCell(index, info, 'own'),
            onActivate: (index) => this.onOwnActivate(index),
            onHover: (index) => this.onOwnHover(index),
            onCellPointerDown: (index, event) => this.onOwnPointerDown(index, event),
            onContextMenu: (index) => this.onOwnContextMenu(index),
            onKey: (event, index) => this.onOwnKey(event, index)
        });
        this.enemyBoard = this.createBoard(this.root.querySelector('#bsEnemyBoard'), {
            rules: this.rules,
            columns,
            side: 'enemy',
            label: tb('game.enemy_board'),
            describeCell: (index, info) => this.describeCell(index, info, 'enemy'),
            onActivate: (index) => this.fireAt(index)
        });
        this.bindDock();
    }

    /** The WebGL board where it works (it plays on flat by itself if WebGL fails later). */
    createBoard(host, options) {
        const Board3D = this.options.Board3D;
        if (Board3D) {
            try {
                return new Board3D(host, { ...options, view: this.boardView, loadingLabel: tb('game.board_loading') });
            } catch (error) {
                console.warn('[Battleship] 3D board failed, using the flat board:', error);
            }
        }
        return new BattleshipBoard(host, options);
    }

    toggleBoardView(button) {
        this.boardView = this.boardView === 'top' ? '3d' : 'top';
        this.ownBoard?.setView?.(this.boardView);
        this.enemyBoard?.setView?.(this.boardView);
        button?.setAttribute('aria-pressed', String(this.boardView === 'top'));
        this.options.onBoardView?.(this.boardView);
    }

    describeCell(index, info, side) {
        const name = this.rules.cellName(index, this.locale);
        let state;
        if (info.preview) state = tb(info.preview === 'valid' ? 'cell.preview_valid' : 'cell.preview_invalid');
        else if (info.mark === 'unknown' || info.mark === 'clear') {
            if (info.ship) state = tb('cell.ship');
            else state = side === 'enemy' && info.mark === 'unknown' ? tb('cell.unknown') : tb('cell.clear');
        } else {
            state = tb(`cell.${info.mark}`);
        }
        if (info.pending) state = tb('cell.pending');
        else if (info.last) state = `${state}, ${tb('cell.last')}`;
        return `${name}: ${state}`;
    }

    updateArena() {
        const game = this.game;
        const phase = game.status;
        const placing = phase === 'placing' && !this.myReady && !this.fleet;
        if (placing && !this.placement) this.placement = this.loadDraft();
        if (!placing) {
            this.endDrag();
            this.placement = null;
        }
        const arena = this.root.querySelector('#bsArena');
        arena.dataset.phase = placing ? 'placing' : phase;
        const tools = this.root.querySelector('#bsTools');
        const enemySide = this.root.querySelector('#bsEnemySide');
        tools.hidden = !placing;
        enemySide.hidden = placing;

        this.root.querySelector('#bsVersus').innerHTML = this.versusHtml();
        this.root.querySelector('#bsEnemyTitle').textContent = tb('game.enemy_board_named', { name: this.opponentName });
        this.updateBanner();
        this.updateBoards();
        this.updateFleets();
        if (placing) this.updateTools();
        this.updateFooter();
    }

    versusHtml() {
        const game = this.game;
        const myName = game.names?.[this.uid] || tb('game.you');
        const opponent = this.opponentUid;
        const turnClass = uid => (game.status === 'playing' && game.turnUid === uid ? ' is-turn' : '');
        return `
            <span class="bs-versus__player${turnClass(this.uid)}">${avatarHtml(myName, game.photos?.[this.uid])}<span>${escapeHtml(tb('game.you'))}</span></span>
            <span class="bs-versus__vs" aria-hidden="true">vs</span>
            <span class="bs-versus__player${turnClass(opponent)}">${avatarHtml(this.opponentName, game.photos?.[opponent])}<span>${escapeHtml(this.opponentName)}</span></span>`;
    }

    shotText(shot) {
        if (!shot || !this.rules.isIndex(shot.index)) return '';
        const cell = this.rules.cellName(shot.index, this.locale);
        if (shot.by === this.uid) return tb(`game.mine_${shot.result}`, { cell });
        return tb(`game.theirs_${shot.result}`, { cell, name: this.opponentName });
    }

    bannerState() {
        const game = this.game;
        const name = this.opponentName;
        const now = this.service.serverNow();
        if (game.status === 'placing') {
            if (!this.myReady && !this.fleet) {
                return {
                    tone: 'info',
                    icon: 'anchor',
                    title: tb('game.placing_title'),
                    text: this.opponentReady ? tb('game.opponent_ready', { name }) : tb('game.placing_hint')
                };
            }
            const idle = now - Number(game.placingStartedAtMs || 0);
            const canClaim = !this.opponentReady && idle >= PLACING_IDLE_MS;
            return {
                tone: 'wait',
                icon: 'clock',
                title: tb('game.waiting_opponent_title'),
                text: canClaim ? tb('game.placing_claim_hint', { name }) : tb('game.waiting_opponent_placing', { name }),
                actions: canClaim ? [{ action: 'claim', label: tb('game.placing_claim'), kind: 'secondary' }] : []
            };
        }
        if (game.status === 'playing') {
            const myTurn = game.turnUid === this.uid;
            const idle = now - Number(game.turnStartedAtMs || 0);
            const last = this.shotText(game.lastShot);
            // Second-by-second clocks go to the timer line, outside the live region,
            // so a screen reader hears each state once rather than every tick.
            if (myTurn) {
                const left = TURN_IDLE_MS - idle;
                return {
                    tone: 'turn',
                    icon: 'target',
                    title: tb('game.your_turn'),
                    text: [last, tb('game.your_turn_hint')].filter(Boolean).join(' · '),
                    // The computer waits as long as it takes.
                    timer: !this.local && left <= IDLE_WARNING_MS ? tb('game.idle_warning', { time: formatDuration(left) }) : ''
                };
            }
            const canClaim = !this.local && idle >= TURN_IDLE_MS;
            return {
                tone: 'wait',
                icon: 'clock',
                title: tb('game.their_turn', { name }),
                text: canClaim ? tb('game.claim_hint', { name, minutes: Math.round(TURN_IDLE_MS / 60000) }) : last,
                timer: !this.local && !canClaim && idle >= IDLE_VISIBLE_MS ? tb('game.opponent_thinking', { time: formatDuration(idle) }) : '',
                actions: canClaim ? [{ action: 'claim', label: tb('game.claim'), kind: 'primary' }] : []
            };
        }
        if (game.status === 'finished') {
            const won = game.winnerUid === this.uid;
            const reason = game.endReason === 'all_sunk' || game.endReason === 'resigned' || game.endReason === 'timeout' ? game.endReason : 'all_sunk';
            return {
                tone: won ? 'win' : 'loss',
                icon: won ? 'trophy' : 'flag',
                title: tb(won ? 'game.result_win' : 'game.result_loss'),
                text: tb(`game.reason_${reason}_${won ? 'win' : 'loss'}`, { name }),
                actions: this.rematchActions()
            };
        }
        const reasonKey = { left: 'left', timeout: 'timeout_cancel', declined: 'declined', expired: 'expired' }[game.endReason] || 'cancelled';
        return {
            tone: 'neutral',
            icon: 'flag',
            title: tb('game.result_cancelled'),
            text: tb(`game.reason_${reasonKey}`, { name }),
            actions: [{ action: 'new-game', label: tb('game.new_game'), kind: 'primary' }]
        };
    }

    rematchActions() {
        if (this.local) return [{ action: 'rematch', label: tb('bot.again'), kind: 'primary' }];
        const game = this.game;
        if (!game.rematchGameId) return [{ action: 'rematch', label: tb('game.rematch'), kind: 'primary' }];
        if (game.rematchBy === this.uid) return [{ action: 'open-rematch', label: tb('game.rematch_waiting'), kind: 'secondary' }];
        return [{ action: 'rematch', label: tb('game.rematch_accept', { name: this.opponentName }), kind: 'primary' }];
    }

    updateBanner() {
        const state = this.bannerState();
        const banner = this.root.querySelector('#bsBanner');
        if (!banner) return;
        banner.dataset.tone = state.tone;
        this.root.querySelector('#bsBannerIcon').innerHTML = BANNER_ICONS[state.icon] || '';
        const title = this.root.querySelector('#bsBannerTitle');
        const text = this.root.querySelector('#bsBannerText');
        const timer = this.root.querySelector('#bsBannerTimer');
        if (title.textContent !== state.title) title.textContent = state.title;
        if (text.textContent !== (state.text || '')) text.textContent = state.text || '';
        if (timer.textContent !== (state.timer || '')) timer.textContent = state.timer || '';
        const actions = this.root.querySelector('#bsBannerActions');
        const html = (state.actions || []).map(({ action, label, kind }) => {
            const busy = this.busy.has(action);
            return `<button class="btn btn-${kind} ${busy ? 'btn--pending' : ''}" type="button" data-action="${action}" ${busy ? 'disabled aria-busy="true"' : ''}>${escapeHtml(label)}</button>`;
        }).join('');
        if (actions.dataset.html !== html) {
            const focused = actions.contains(document.activeElement) ? document.activeElement.dataset.action : null;
            actions.innerHTML = html;
            actions.dataset.html = html;
            if (focused) actions.querySelector(`[data-action="${focused}"]`)?.focus({ preventScroll: true });
        }
    }

    updateBoards() {
        const game = this.game;
        const opponent = this.opponentUid;
        const shot = game.lastShot;
        const placing = Boolean(this.placement);
        if (placing) {
            const preview = this.currentPreview();
            this.ownBoard.update({
                ships: this.placement.placedShips,
                preview,
                interactive: true,
                dragging: Boolean(this.drag?.active)
            });
        } else {
            this.ownBoard.update({
                marks: game.boards?.[this.uid] || null,
                ships: this.fleet || [],
                lastIndex: shot && shot.by !== this.uid ? shot.index : null,
                interactive: false
            });
        }
        if (!this.enemyBoard) return;
        const marks = game.boards?.[opponent] || this.rules.emptyMarks();
        const finished = game.status === 'finished';
        const enemyShips = finished && Array.isArray(game.revealed?.[opponent]) ? game.revealed[opponent] : game.sunk?.[opponent] || [];
        const canFire = game.status === 'playing' && game.turnUid === this.uid && !this.pendingShot;
        this.enemyBoard.update({
            marks,
            ships: enemyShips,
            lastIndex: shot && shot.by === this.uid ? shot.index : null,
            pendingIndex: this.pendingShot?.index ?? null,
            interactive: canFire,
            canTarget: index => marks[index] === '.',
            revealed: finished
        });
    }

    fleetHtml(sunkShips, total) {
        const sunk = Array.isArray(sunkShips) ? sunkShips : [];
        const left = this.rules.remainingFleet(sunk);
        const leftCounts = new Map();
        for (const length of left) leftCounts.set(length, (leftCounts.get(length) || 0) + 1);
        const items = this.rules.FLEET.map(length => {
            const afloat = (leftCounts.get(length) || 0) > 0;
            if (afloat) leftCounts.set(length, leftCounts.get(length) - 1);
            return `<li class="bs-fleet__ship ${afloat ? '' : 'is-sunk'}">${shipBlocksHtml(length)}</li>`;
        }).join('');
        const label = tb('game.fleet_left', { count: left.length, total });
        return `<span class="bs-fleet__label">${escapeHtml(label)}</span><ul class="bs-fleet__list" aria-hidden="true">${items}</ul>`;
    }

    updateFleets() {
        const game = this.game;
        const total = this.rules.FLEET.length;
        const own = this.root.querySelector('#bsOwnFleet');
        const enemy = this.root.querySelector('#bsEnemyFleet');
        const placing = Boolean(this.placement);
        const ownHtml = placing ? '' : this.fleetHtml(game.sunk?.[this.uid], total);
        const enemyHtml = this.fleetHtml(game.sunk?.[this.opponentUid], total);
        if (own.dataset.html !== ownHtml) {
            own.innerHTML = ownHtml;
            own.dataset.html = ownHtml;
        }
        if (enemy.dataset.html !== enemyHtml) {
            enemy.innerHTML = enemyHtml;
            enemy.dataset.html = enemyHtml;
        }
        const shots = Number(game.shots?.[this.uid] || 0);
        const hits = Number(game.hits?.[this.uid] || 0);
        const theirShots = Number(game.shots?.[this.opponentUid] || 0);
        const theirHits = Number(game.hits?.[this.opponentUid] || 0);
        const meta = (count, hitCount) => (count ? tb('game.accuracy', { hits: hitCount, shots: count, percent: Math.round((hitCount / count) * 100) }) : '');
        this.root.querySelector('#bsEnemyMeta').textContent = meta(shots, hits);
        this.root.querySelector('#bsOwnMeta').textContent = placing ? '' : meta(theirShots, theirHits);
    }

    updateTools() {
        const placement = this.placement;
        const dock = this.root.querySelector('#bsDock');
        const html = placement.slots.map(slot => {
            const placed = Boolean(slot.ship);
            const selected = placement.selectedId === slot.id && !placed;
            const name = tb(`game.ship_${slot.length}`);
            const label = placed ? tb('game.dock_placed', { name }) : name;
            return `<li><button class="bs-dock__ship ${placed ? 'is-placed' : ''} ${selected ? 'is-selected' : ''}" type="button" data-action="select-ship" data-slot="${slot.id}" aria-pressed="${selected}" aria-label="${escapeHtml(label)}" ${placed ? 'disabled' : ''}>
                ${shipBlocksHtml(slot.length, placement.vertical && selected ? 'is-vertical' : '')}
                <span class="bs-dock__name">${escapeHtml(name)}</span>
                ${placed ? '<svg class="bs-dock__check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
            </button></li>`;
        }).join('');
        if (dock.dataset.html !== html) {
            const focusedSlot = dock.contains(document.activeElement) ? document.activeElement.dataset.slot : null;
            dock.innerHTML = html;
            dock.dataset.html = html;
            if (focusedSlot !== null && focusedSlot !== undefined) {
                const next = dock.querySelector(`[data-slot="${focusedSlot}"]:not([disabled])`) || dock.querySelector('.bs-dock__ship:not([disabled])');
                next?.focus({ preventScroll: true });
            }
        }
        const waiting = placement.slots.filter(slot => !slot.ship).length;
        const status = this.root.querySelector('#bsPlacementStatus');
        const message = this.placementMessage
            || (waiting ? tb('game.ready_hint_incomplete', { count: waiting, ships_word: plural(waiting, 'battleship.ship_forms') }) : tb('game.ready_hint_complete'));
        if (status.textContent !== message) status.textContent = message;
        status.classList.toggle('is-warning', Boolean(this.placementMessage));
        const ready = this.root.querySelector('#bsReadyBtn');
        const busy = this.busy.has('ready');
        ready.disabled = !placement.isComplete() || busy;
        ready.classList.toggle('btn--pending', busy);
        ready.setAttribute('aria-busy', String(busy));
        this.root.querySelector('[data-action="rotate"]').setAttribute('aria-pressed', String(placement.vertical));
    }

    updateFooter() {
        const game = this.game;
        const footer = this.root.querySelector('#bsFooter');
        const [action, kind, label] = game.status === 'placing' ? ['leave', 'ghost', tb('game.leave')]
            : game.status === 'playing' ? ['resign', 'ghost', tb('game.resign')]
                : ['lobby', 'secondary', tb('game.back')];
        // A game against the computer waits in the lobby while its fleet is placed.
        const html = this.local && game.status === 'placing'
            ? ''
            : `<button class="btn btn-${kind}" type="button" data-action="${action}">${escapeHtml(label)}</button>`;
        if (footer.dataset.html !== html) {
            footer.innerHTML = html;
            footer.dataset.html = html;
        }
    }

    updateAttention() {
        const game = this.game;
        if (!game || this.layout !== 'arena') {
            this.options.onAttention(null);
            return;
        }
        const myTurn = game.status === 'playing' && game.turnUid === this.uid;
        const needsPlacement = game.status === 'placing' && !this.myReady && !this.fleet;
        this.options.onAttention({
            myTurn: myTurn || needsPlacement,
            title: myTurn ? tb('game.your_turn') : needsPlacement ? tb('game.placing_title') : tb('title')
        });
    }

    tick() {
        if (this.disposed || this.layout !== 'arena' || !this.game) return;
        if (this.game.status === 'playing' || this.game.status === 'placing') this.updateBanner();
    }

    formatClock(ms) {
        const local = Number(ms) - (this.service.serverNow() - Date.now());
        try {
            return new Date(local).toLocaleString(this.locale === 'ru' ? 'ru-RU' : 'en-US', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            });
        } catch {
            return new Date(local).toISOString();
        }
    }

    // --- Placement -------------------------------------------------------------------

    draftKey() {
        return `${DRAFT_PREFIX}${this.gameId}:${this.uid}`;
    }

    loadDraft() {
        const placement = new BattleshipPlacement({ rules: this.rules });
        try {
            const saved = JSON.parse(sessionStorage.getItem(this.draftKey()) || 'null');
            if (Array.isArray(saved?.slots)) {
                for (const entry of saved.slots) {
                    const slot = placement.slots.find(candidate => candidate.id === entry.id);
                    const ship = entry.ship ? this.rules.normalizeShip(entry.ship) : null;
                    const others = placement.placedShips;
                    if (slot && ship && ship.length === slot.length && this.rules.canPlace(others, ship)) slot.ship = ship;
                }
                placement.selectedId = placement.nextWaitingId();
            }
        } catch {
            // A broken draft starts the placement over.
        }
        return placement;
    }

    saveDraft() {
        if (!this.placement) return;
        try {
            sessionStorage.setItem(this.draftKey(), JSON.stringify({
                slots: this.placement.slots.map(slot => ({ id: slot.id, ship: slot.ship }))
            }));
        } catch {
            // The draft only survives a reload; losing it is harmless.
        }
    }

    clearDraft() {
        try {
            sessionStorage.removeItem(this.draftKey());
        } catch {
            // Nothing to clean up.
        }
    }

    currentPreview() {
        const placement = this.placement;
        if (!placement) return null;
        if (this.drag?.active) {
            return this.drag.index === null ? null : placement.previewAt(this.drag.index, this.drag.offset);
        }
        if (this.hoverIndex === null || placement.selectedId === null || placement.selectedId === undefined) return null;
        return placement.previewAt(this.hoverIndex, 0);
    }

    placementChanged(message = null) {
        this.placementMessage = message;
        this.saveDraft();
        this.updateArena();
    }

    onOwnHover(index) {
        if (!this.placement || this.drag?.active) return;
        if (this.hoverIndex === index) return;
        this.hoverIndex = index;
        this.updateBoards();
    }

    onOwnActivate(index) {
        const placement = this.placement;
        if (!placement) return;
        if (this.suppressClick) {
            this.suppressClick = false;
            return;
        }
        if (placement.selected && !placement.selected.ship) {
            if (placement.placeAt(index, 0)) {
                this.sounds.splash();
                this.placementChanged();
            } else {
                this.placementChanged(tb('game.invalid_spot'));
            }
            return;
        }
        // With nothing in hand, a click on a ship turns it.
        if (placement.slotAt(index)) {
            const turned = placement.rotateAt(index);
            this.placementChanged(turned ? null : tb('game.cannot_rotate'));
        }
    }

    onOwnContextMenu(index) {
        const placement = this.placement;
        if (!placement) return;
        if (placement.selected && !placement.selected.ship) {
            placement.rotate();
            this.placementChanged();
        } else if (placement.slotAt(index)) {
            const turned = placement.rotateAt(index);
            this.placementChanged(turned ? null : tb('game.cannot_rotate'));
        }
    }

    onOwnKey(event, index) {
        const placement = this.placement;
        if (!placement) return false;
        if (event.code === 'KeyR' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (placement.selected && !placement.selected.ship) placement.rotate();
            else if (placement.slotAt(index)) placement.rotateAt(index);
            this.placementChanged();
            return true;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && placement.slotAt(index)) {
            placement.removeAt(index);
            this.placementChanged();
            return true;
        }
        if ((event.key === 'Enter' || event.key === ' ') && !placement.selected && placement.slotAt(index)) {
            // With the whole fleet down, Enter picks a ship up to move it by keyboard.
            placement.liftAt(index);
            this.placementChanged();
            return true;
        }
        if (event.key === 'Escape' && placement.lifted) {
            placement.dropLifted();
            this.placementChanged();
            return true;
        }
        return false;
    }

    onOwnPointerDown(index, event) {
        const placement = this.placement;
        if (!placement || event.button !== 0 || !placement.slotAt(index)) return;
        this.drag = {
            source: 'board',
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            fromIndex: index,
            index,
            offset: 0,
            active: false
        };
        this.listenForDrag();
    }

    onDockPointerDown(slotId, event) {
        const placement = this.placement;
        if (!placement || event.button !== 0) return;
        placement.select(slotId);
        this.drag = {
            source: 'dock',
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            fromIndex: null,
            index: null,
            offset: 0,
            active: false
        };
        this.listenForDrag();
        this.updateArena();
    }

    listenForDrag() {
        document.addEventListener('pointermove', this.handlePointerMove);
        document.addEventListener('pointerup', this.handlePointerUp);
        document.addEventListener('pointercancel', this.handlePointerUp);
    }

    handlePointerMove(event) {
        const drag = this.drag;
        if (!drag || event.pointerId !== drag.pointerId || !this.placement) return;
        if (!drag.active) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
            drag.active = true;
            if (drag.source === 'board') {
                const offset = this.placement.liftAt(drag.fromIndex);
                if (offset === null) {
                    this.endDrag();
                    return;
                }
                drag.offset = offset;
            }
        }
        event.preventDefault();
        const index = this.ownBoard?.cellFromPoint(event.clientX, event.clientY) ?? null;
        if (index !== drag.index) {
            drag.index = index;
            this.updateBoards();
        }
    }

    handlePointerUp(event) {
        const drag = this.drag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        const placement = this.placement;
        this.endDrag();
        if (!drag.active || !placement) return;
        this.suppressClick = drag.source === 'board';
        const index = event.type === 'pointercancel' ? null : this.ownBoard?.cellFromPoint(event.clientX, event.clientY) ?? null;
        let message = null;
        if (index !== null && placement.placeAt(index, drag.offset)) {
            this.sounds.splash();
        } else {
            if (index !== null) message = tb('game.invalid_spot');
            placement.dropLifted();
        }
        this.hoverIndex = index;
        this.placementChanged(message);
        // A click that ends a drag lands on whatever is under the pointer; it is not a new action.
        setTimeout(() => { this.suppressClick = false; }, 0);
    }

    endDrag() {
        document.removeEventListener('pointermove', this.handlePointerMove);
        document.removeEventListener('pointerup', this.handlePointerUp);
        document.removeEventListener('pointercancel', this.handlePointerUp);
        this.drag = null;
    }

    async submitFleet() {
        const placement = this.placement;
        if (!placement?.isComplete() || this.busy.has('ready')) return;
        await this.runAction('ready', () => this.service.place(this.gameId, placement.toFleet()));
    }

    // --- Battle -----------------------------------------------------------------------

    canFireAt(index) {
        const game = this.game;
        if (!game || game.status !== 'playing' || game.turnUid !== this.uid || this.pendingShot) return false;
        return this.rules.isShootable(game.boards?.[this.opponentUid], index);
    }

    async fireAt(index) {
        if (!this.canFireAt(index)) return;
        const game = this.game;
        const move = Number(game.moveCount) || 0;
        this.pendingShot = { index, move };
        this.updateArena();
        try {
            const result = await this.service.fire(this.gameId, index, move);
            if (this.disposed) return;
            if (result.result === 'miss') this.sounds.splash();
            else if (result.result === 'sunk') this.sounds.sunk();
            else this.sounds.hit();
            if (result.status === 'finished') setTimeout(() => this.playEndSound(result), 320);
            this.lastSoundMove = Math.max(this.lastSoundMove || 0, Number(result.moveCount) || 0);
            this.lastTurnUid = result.status === 'playing' ? result.turnUid || null : null;
            // The answer can arrive before the snapshot: show it at once.
            if (this.game && Number(this.game.moveCount) < Number(result.moveCount)) this.applyShotResult(result);
        } catch (error) {
            if (!this.disposed) this.options.onToast(this.options.describeError(error), 'error');
        } finally {
            if (!this.disposed) {
                this.pendingShot = null;
                this.render();
                // Keep the keyboard where the shot was fired.
                if (this.game?.turnUid === this.uid) this.enemyBoard?.setActiveIndex(index);
            }
        }
    }

    applyShotResult(result) {
        const game = JSON.parse(JSON.stringify(this.game));
        const opponent = this.opponentUid;
        game.boards = { ...game.boards, [opponent]: result.marks };
        game.moveCount = result.moveCount;
        game.turnUid = result.turnUid;
        game.lastShot = { by: this.uid, index: result.index, result: result.result, move: result.moveCount, atMs: this.service.serverNow() };
        game.turnStartedAtMs = this.service.serverNow();
        game.shots = { ...game.shots, [this.uid]: Number(game.shots?.[this.uid] || 0) + 1 };
        if (result.result !== 'miss') game.hits = { ...game.hits, [this.uid]: Number(game.hits?.[this.uid] || 0) + 1 };
        if (result.ship) game.sunk = { ...game.sunk, [opponent]: [...(game.sunk?.[opponent] || []), result.ship] };
        if (result.status === 'finished') {
            // Revealed fleets come with the snapshot; keep playing state until then.
            game.status = 'finished';
            game.winnerUid = result.winnerUid;
            game.endReason = 'all_sunk';
        }
        this.game = game;
    }

    // --- Actions --------------------------------------------------------------------------

    async runAction(name, task) {
        if (this.busy.has(name)) return null;
        this.busy.add(name);
        this.render();
        try {
            return await task();
        } catch (error) {
            if (!this.disposed) this.options.onToast(this.options.describeError(error), 'error');
            return null;
        } finally {
            this.busy.delete(name);
            if (!this.disposed) this.render();
        }
    }

    async confirm(kind) {
        const dialog = globalThis.ConfirmDialog;
        if (!dialog?.confirm) return true;
        return dialog.confirm({
            title: tb(`game.${kind}_confirm_title`),
            message: tb(`game.${kind}_confirm_text`),
            confirmLabel: tb(`game.${kind}_confirm`),
            cancelLabel: tb('game.keep_playing'),
            danger: true
        });
    }

    async copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.options.onToast(tb('game.copied'));
        } catch {
            this.options.onToast(tb('game.copy_failed'), 'error');
        }
    }

    handleClick(event) {
        const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
        if (!target || !this.root.contains(target) || target.disabled) return;
        const action = target.dataset.action;
        const placement = this.placement;
        switch (action) {
            case 'lobby':
                this.options.onNavigate(null);
                break;
            case 'new-game':
                this.options.onNavigate(null, { focusNewGame: true });
                break;
            case 'join':
                this.joinError = null;
                this.runAction('join', async () => {
                    try {
                        await this.service.join(this.gameId);
                        this.access = 'loading';
                        this.subscribeGame();
                    } catch (error) {
                        this.joinError = this.options.describeError(error);
                        this.renderLayout('join');
                    }
                });
                break;
            case 'accept':
                this.runAction('accept', () => this.service.join(this.gameId));
                break;
            case 'decline':
                this.runAction('decline', async () => {
                    await this.service.decline(this.gameId);
                    this.options.onNavigate(null);
                });
                break;
            case 'cancel':
                this.runAction('cancel', async () => {
                    await this.service.cancel(this.gameId);
                    this.options.onNavigate(null);
                });
                break;
            case 'copy-code':
                this.copy(this.gameId);
                break;
            case 'copy-link':
                this.copy(battleshipPageUrl(this.gameId));
                break;
            case 'select-ship':
                if (placement && placement.select(Number(target.dataset.slot))) this.placementChanged();
                break;
            case 'random':
                if (placement) {
                    placement.randomize();
                    this.placementChanged();
                }
                break;
            case 'rotate':
                if (placement) {
                    placement.rotate();
                    this.placementChanged();
                }
                break;
            case 'clear':
                if (placement) {
                    placement.clear();
                    this.placementChanged();
                }
                break;
            case 'ready':
                this.submitFleet();
                break;
            case 'leave':
                this.confirm('leave').then(confirmed => {
                    if (confirmed) this.runAction('leave', () => this.service.resign(this.gameId));
                });
                break;
            case 'resign':
                this.confirm('resign').then(confirmed => {
                    if (confirmed) this.runAction('resign', () => this.service.resign(this.gameId));
                });
                break;
            case 'claim':
                this.runAction('claim', () => this.service.claim(this.gameId));
                break;
            case 'rematch':
                this.runAction('rematch', async () => {
                    const result = await this.service.rematch(this.gameId);
                    if (result?.gameId && result.gameId !== this.gameId) this.options.onNavigate(result.gameId);
                });
                break;
            case 'open-rematch':
                if (this.game?.rematchGameId) this.options.onNavigate(this.game.rematchGameId);
                break;
            case 'board-view':
                this.toggleBoardView(target);
                break;
            default:
                break;
        }
    }

    handleKeydown(event) {
        const ship = event.target instanceof Element ? event.target.closest('.bs-dock__ship') : null;
        if (ship && event.code === 'KeyR' && this.placement && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            this.placement.rotate();
            this.placementChanged();
        }
    }

    /** The dock starts drags itself: a press on a waiting ship picks it up. */
    bindDock() {
        const dock = this.root.querySelector('#bsDock');
        if (!dock || dock.dataset.bound) return;
        dock.dataset.bound = 'true';
        dock.addEventListener('pointerdown', event => {
            const button = event.target instanceof Element ? event.target.closest('.bs-dock__ship') : null;
            if (!button || button.disabled) return;
            this.onDockPointerDown(Number(button.dataset.slot), event);
        });
    }
}

const TOP_VIEW_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M4 12h16M12 4v16"></path></svg>';

const BANNER_ICONS = {
    anchor: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"></circle><line x1="12" y1="22" x2="12" y2="8"></line><path d="M5 12H2a10 10 0 0 0 20 0h-3"></path></svg>',
    clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
    target: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>',
    trophy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0z"></path><path d="M17 5h3v2a3 3 0 0 1-3 3"></path><path d="M7 5H4v2a3 3 0 0 0 3 3"></path></svg>',
    flag: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>'
};
