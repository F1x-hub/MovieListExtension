import { i18n } from '../../shared/i18n/I18n.js';
import { t, escapeHtml } from '../../shared/games/gamesI18n.js';
import { BattleshipSounds } from '../../shared/games/battleship/BattleshipSounds.js';
import {
    BATTLESHIP_CHANNEL,
    TOUCH_INTERVAL_MS,
    BattleshipService,
    normalizeGameCode
} from '../../shared/services/BattleshipService.js';
import { BOT_LEVELS } from '../../shared/games/battleship/BattleshipBot.js';
import { BattleshipLocalGame, PLAYER_UID } from '../../shared/games/battleship/BattleshipLocalGame.js';
import { BattleshipGameView } from './BattleshipGameView.js';

const tb = (key, params) => t(`battleship.${key}`, params);
const SEARCH_DEBOUNCE_MS = 300;
const TOAST_MS = 3200;
const BOARD_VIEW_KEY = 'battleshipViewV1';

function initialOf(name) {
    return String(name || '?').trim().charAt(0).toLocaleUpperCase() || '?';
}

function avatarHtml(name, photo) {
    const safe = typeof photo === 'string' && /^https:\/\//i.test(photo) ? photo : null;
    return safe
        ? `<span class="bs-avatar"><img src="${escapeHtml(safe)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
        : `<span class="bs-avatar" aria-hidden="true">${escapeHtml(initialOf(name))}</span>`;
}

/**
 * The Battleship page: lobby (new games, codes, challenges, open games, results)
 * and, for `?game=CODE`, the game screen. Owns auth, routing, the player's own
 * document, the touch that keeps open games listed and the page title.
 */
class BattleshipPage {
    constructor() {
        this.rules = globalThis.BattleshipRules;
        this.service = new BattleshipService();
        this.sounds = new BattleshipSounds();
        this.uid = null;
        this.player = null;
        this.lobby = null;
        this.view = 'loading';
        this.gameView = null;
        this.unsubscribePlayer = null;
        this.unsubscribeLobby = null;
        this.busy = new Set();
        this.searchToken = 0;
        this.searchResults = null;
        this.searchError = null;
        this.toastTimer = null;
        this.touchTimer = null;
        this.attention = null;
        this.baseTitle = document.title;
        this.channel = null;
        this.Board3D = null;
        this.boardView = '3d';
        this.local = new BattleshipLocalGame({ rules: this.rules });
        this.elements = {
            loading: document.getElementById('bsLoading'),
            lobby: document.getElementById('bsLobby'),
            lobbyGrid: document.getElementById('bsLobbyGrid'),
            onlinePanels: [...document.querySelectorAll('#bsLobby [data-online]')],
            guestNote: document.getElementById('bsGuestNote'),
            botLevels: document.getElementById('bsBotLevels'),
            botRecord: document.getElementById('bsBotRecord'),
            botResume: document.getElementById('bsBotResume'),
            game: document.getElementById('bsGame'),
            toast: document.getElementById('bsToast'),
            mute: document.getElementById('bsMuteBtn'),
            muteLabel: document.getElementById('bsMuteLabel'),
            joinForm: document.getElementById('bsJoinForm'),
            joinCode: document.getElementById('bsJoinCode'),
            joinError: document.getElementById('bsJoinError'),
            search: document.getElementById('bsPlayerSearch'),
            searchResults: document.getElementById('bsPlayerResults'),
            invitesPanel: document.getElementById('bsInvitesPanel'),
            invites: document.getElementById('bsInvites'),
            myGames: document.getElementById('bsMyGames'),
            openGames: document.getElementById('bsOpenGames'),
            recent: document.getElementById('bsRecent'),
            stats: document.getElementById('bsStats')
        };
    }

    async init() {
        const boards = this.loadBoards();
        const localGame = this.local.load();
        await i18n.init();
        i18n.translatePage();
        this.baseTitle = tb('page_title');
        document.title = this.baseTitle;
        this.bindEvents();
        this.updateMute();
        this.openChannel();
        const manager = globalThis.firebaseManager;
        await manager?.waitForAuthReady?.(10000);
        await Promise.all([boards, localGame]);
        window.addEventListener('authStateChanged', () => this.onAuthChanged());
        window.addEventListener('popstate', () => this.route());
        chrome.runtime?.onMessage?.addListener?.(message => {
            if (message?.type === 'SETTINGS_UPDATED' && message.settings?.language) this.reloadLocale();
        });
        this.onAuthChanged();
    }

    /**
     * The WebGL boards and the saved camera. Without WebGL (or if the module
     * fails to load) games use the flat boards. Never rejects.
     */
    async loadBoards() {
        const [module, view] = await Promise.all([
            import('../../shared/games/battleship/BattleshipBoardRenderer.js').catch(error => {
                console.warn('[Battleship] 3D boards unavailable, using flat boards:', error);
                return null;
            }),
            this.readBoardView()
        ]);
        const Renderer = module?.BattleshipBoardRenderer || null;
        this.Board3D = Renderer?.isSupported(document) ? Renderer : null;
        this.boardView = view;
    }

    async readBoardView() {
        try {
            const stored = await chrome.storage?.local?.get?.(BOARD_VIEW_KEY);
            return stored?.[BOARD_VIEW_KEY] === 'top' ? 'top' : '3d';
        } catch {
            return '3d';
        }
    }

    saveBoardView(view) {
        this.boardView = view;
        try {
            chrome.storage?.local?.set?.({ [BOARD_VIEW_KEY]: view })?.catch?.(() => {});
        } catch {
            // The camera choice is a convenience; losing it is harmless.
        }
    }

    async reloadLocale() {
        await i18n.init();
        i18n.translatePage();
        this.baseTitle = tb('page_title');
        this.updateTitle();
        this.renderLobby();
        if (this.gameView) this.route(true);
    }

    bindEvents() {
        document.addEventListener('pointerdown', () => this.sounds.unlock(), { once: true, capture: true });
        document.addEventListener('keydown', () => this.sounds.unlock(), { once: true, capture: true });
        this.elements.mute.addEventListener('click', () => {
            this.sounds.setMuted(!this.sounds.muted);
            this.updateMute();
        });
        document.getElementById('bsSignInBtn')?.addEventListener('click', () => {
            const navigation = globalThis.navigationInstance;
            if (navigation?.showAuthModal) navigation.showAuthModal('login');
        });
        this.elements.lobby.addEventListener('click', event => this.handleLobbyClick(event));
        this.elements.botLevels.addEventListener('keydown', event => this.handleLevelKey(event));
        this.elements.joinForm.addEventListener('submit', event => {
            event.preventDefault();
            this.joinByCode();
        });
        this.elements.joinCode.addEventListener('input', () => {
            this.elements.joinError.hidden = true;
            this.elements.joinCode.removeAttribute('aria-invalid');
        });
        let searchTimer = null;
        this.elements.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => this.searchPlayers(), SEARCH_DEBOUNCE_MS);
        });
        document.addEventListener('visibilitychange', () => this.updateTitle());
    }

    updateMute() {
        const muted = this.sounds.muted;
        this.elements.mute.classList.toggle('is-muted', muted);
        this.elements.mute.setAttribute('aria-pressed', String(muted));
        const label = muted ? tb('sound_off') : tb('sound_on');
        this.elements.muteLabel.textContent = label;
        this.elements.mute.title = label;
    }

    /** Other extension pages ask here before announcing a turn in a game already open. */
    openChannel() {
        if (typeof BroadcastChannel !== 'function') return;
        this.channel = new BroadcastChannel(BATTLESHIP_CHANNEL);
        this.channel.addEventListener('message', event => {
            if (event.data?.type === 'ping') {
                this.channel.postMessage({ type: 'pong', id: event.data.id, gameId: this.gameView?.gameId || null });
            }
        });
    }

    // --- Auth and routing --------------------------------------------------------------

    onAuthChanged() {
        // Only a restored Firebase session can read the game documents; the
        // chrome.storage copy another tab writes first is not one yet.
        const uid = globalThis.firebaseManager?.auth?.currentUser?.uid || null;
        if (uid && uid === this.uid) return;
        this.teardownSession();
        this.uid = uid;
        if (!uid) {
            // Guests get the lobby too: the computer needs no account.
            this.route();
            return;
        }
        this.unsubscribePlayer = this.service.subscribePlayer(uid, player => {
            this.player = player;
            this.renderLobby();
        }, error => {
            console.warn('[Battleship] player document unavailable', error);
            this.player = null;
            this.renderLobby();
        });
        // Wakes the function up and learns the server clock before the first move.
        this.service.ping().catch(() => {});
        this.touchTimer = setInterval(() => this.touchOpenGames(), TOUCH_INTERVAL_MS);
        this.route();
    }

    teardownSession() {
        this.unsubscribePlayer?.();
        this.unsubscribePlayer = null;
        this.unsubscribeLobby?.();
        this.unsubscribeLobby = null;
        clearInterval(this.touchTimer);
        this.touchTimer = null;
        // A game against the computer does not depend on the account.
        if (!this.gameView?.local) {
            this.gameView?.destroy();
            this.gameView = null;
        }
        this.player = null;
        this.lobby = null;
    }

    currentGameParam() {
        return normalizeGameCode(new URLSearchParams(location.search).get('game'));
    }

    route(force = false) {
        if (new URLSearchParams(location.search).has('bot')) {
            this.openBotView(force);
            return;
        }
        const gameId = this.currentGameParam();
        if (gameId && !this.uid) {
            this.gameView?.destroy();
            this.gameView = null;
            this.showView('lobby');
            this.toast(tb('guest.online_link'));
            return;
        }
        if (gameId) {
            if (!force && this.gameView?.gameId === gameId) return;
            this.openGameView(gameId);
            return;
        }
        this.gameView?.destroy();
        this.gameView = null;
        this.showView('lobby');
    }

    /** @param {string|null} target - an online game code, 'bot', or null for the lobby */
    navigate(target, { replace = false, focusNewGame = false } = {}) {
        const url = new URL(location.href);
        url.searchParams.delete('game');
        url.searchParams.delete('bot');
        if (target === 'bot') url.searchParams.set('bot', '1');
        else if (target) url.searchParams.set('game', target);
        if (replace) history.replaceState(null, '', url);
        else history.pushState(null, '', url);
        this.route();
        if (!target && focusNewGame) this.elements.lobby.querySelector(this.uid ? '[data-action="create-public"]' : '[data-action="start-bot"]')?.focus();
        window.scrollTo({ top: 0 });
    }

    /** The game against the computer: the saved one, or a new one at the chosen level. */
    openBotView(force = false) {
        if (!this.local.game) this.startBotGame();
        if (!force && this.gameView?.local && this.gameView.gameId === this.local.gameId) return;
        this.gameView?.destroy();
        this.showView('game');
        this.gameView = new BattleshipGameView({
            root: this.elements.game,
            service: this.local,
            uid: PLAYER_UID,
            gameId: this.local.gameId,
            rules: this.rules,
            sounds: this.sounds,
            locale: () => i18n.currentLocale,
            // «Ещё партия» starts a new local game; the screen then shows it.
            onNavigate: (nextGameId, options) => (nextGameId ? this.openBotView(true) : this.navigate(null, options)),
            onToast: (text, tone) => this.toast(text, tone),
            onAttention: state => {
                this.attention = state;
                this.updateTitle();
            },
            describeError: error => this.describeError(error),
            Board3D: this.Board3D,
            boardView: this.boardView,
            onBoardView: view => this.saveBoardView(view),
            local: { levelName: this.levelName(this.local.game?.level || this.local.level) }
        });
        this.gameView.start();
    }

    startBotGame() {
        const user = globalThis.firebaseManager?.auth?.currentUser || null;
        const photo = typeof user?.photoURL === 'string' && /^https:\/\//i.test(user.photoURL) ? user.photoURL : null;
        this.local.start({
            level: this.local.level,
            playerName: user?.displayName || '',
            playerPhoto: photo,
            botName: tb('bot.name')
        });
    }

    levelName(level) {
        return tb(`bot.levels.${level}.name`);
    }

    openGameView(gameId) {
        this.gameView?.destroy();
        this.showView('game');
        this.gameView = new BattleshipGameView({
            root: this.elements.game,
            service: this.service,
            uid: this.uid,
            gameId,
            rules: this.rules,
            sounds: this.sounds,
            locale: () => i18n.currentLocale,
            onNavigate: (nextGameId, options) => this.navigate(nextGameId, options),
            onToast: (text, tone) => this.toast(text, tone),
            onAttention: state => {
                this.attention = state;
                this.updateTitle();
            },
            describeError: error => this.describeError(error),
            Board3D: this.Board3D,
            boardView: this.boardView,
            onBoardView: view => this.saveBoardView(view)
        });
        this.gameView.start();
    }

    showView(view) {
        this.view = view;
        for (const name of ['loading', 'lobby', 'game']) {
            this.elements[name].hidden = name !== view;
        }
        if (view === 'lobby') {
            this.attention = null;
            this.updateTitle();
            // Open games are listed for signed-in, approved users only.
            if (!this.unsubscribeLobby && this.uid) {
                this.unsubscribeLobby = this.service.subscribeLobby(lobby => {
                    this.lobby = lobby;
                    this.renderLobby();
                }, error => {
                    console.warn('[Battleship] lobby unavailable', error);
                    this.lobby = null;
                    this.renderLobby();
                });
            }
            this.renderLobby();
        } else {
            this.unsubscribeLobby?.();
            this.unsubscribeLobby = null;
        }
    }

    updateTitle() {
        const attention = this.attention;
        if (attention?.myTurn && document.visibilityState === 'hidden') {
            document.title = `● ${attention.title} · ${this.baseTitle}`;
        } else if (attention?.myTurn) {
            document.title = `${attention.title} · ${this.baseTitle}`;
        } else {
            document.title = this.baseTitle;
        }
    }

    toast(text, tone = 'info') {
        const toast = this.elements.toast;
        toast.textContent = text;
        toast.dataset.tone = tone;
        toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
        toast.hidden = false;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => { toast.hidden = true; }, tone === 'error' ? TOAST_MS * 1.5 : TOAST_MS);
    }

    describeError(error) {
        const code = String(error?.code || '');
        if (code === 'permission-denied') return tb('errors.NOT_A_PLAYER');
        if (code === 'unavailable' || code === 'NETWORK') return tb('errors.NETWORK');
        const key = `battleship.errors.${code}`;
        const message = t(key);
        return message !== key ? message : tb('errors.generic');
    }

    // --- Server-time helpers -------------------------------------------------------------

    isLive(entry) {
        const expires = Number(entry?.expiresAtMs);
        return !expires || expires > this.service.serverNow();
    }

    async touchOpenGames() {
        const games = this.player?.games || {};
        for (const [gameId, summary] of Object.entries(games)) {
            if (summary?.status === 'waiting' && summary.role === 'host' && summary.visibility === 'public') {
                try {
                    await this.service.touch(gameId);
                } catch (error) {
                    console.warn('[Battleship] could not keep the open game listed', error);
                }
            }
        }
    }

    // --- Lobby ----------------------------------------------------------------------------------

    renderLobby() {
        if (this.view !== 'lobby') return;
        this.renderBot();
        const signedIn = Boolean(this.uid);
        this.elements.guestNote.hidden = signedIn;
        this.elements.lobbyGrid.classList.toggle('is-guest', !signedIn);
        this.elements.onlinePanels.forEach(panel => { panel.hidden = !signedIn; });
        if (!signedIn) {
            this.elements.invitesPanel.hidden = true;
            return;
        }
        this.renderInvites();
        this.renderMyGames();
        this.renderOpenGames();
        this.renderRecent();
        this.renderSearch();
    }

    // --- Against the computer -----------------------------------------------------------

    renderBot() {
        const current = this.local.level;
        const html = BOT_LEVELS.map(level => {
            const checked = level === current;
            return `<button class="bs-level" type="button" role="radio" data-action="bot-level" data-level="${level}" aria-checked="${checked}" tabindex="${checked ? 0 : -1}">
                <span class="bs-level__name">${escapeHtml(this.levelName(level))}</span>
                <span class="bs-level__text">${escapeHtml(tb(`bot.levels.${level}.text`))}</span>
            </button>`;
        }).join('');
        const levels = this.elements.botLevels;
        if (levels.dataset.html !== html) {
            const focused = levels.contains(document.activeElement);
            levels.innerHTML = html;
            levels.dataset.html = html;
            if (focused) levels.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
        }
        const record = this.local.stats[current] || { wins: 0, losses: 0 };
        this.elements.botRecord.textContent = record.wins + record.losses
            ? tb('bot.record', { wins: record.wins, losses: record.losses })
            : tb('bot.record_empty');
        const saved = this.local.unfinished;
        const resume = this.elements.botResume;
        resume.hidden = !saved;
        if (!saved) {
            resume.innerHTML = '';
            return;
        }
        const detail = saved.status === 'placing'
            ? tb('bot.resume_placing', { level: this.levelName(saved.level) })
            : tb('bot.resume_playing', { level: this.levelName(saved.level), shots: Number(saved.shots?.[PLAYER_UID]) || 0 });
        resume.innerHTML = `
            <span class="bs-resume__copy">
                <strong>${escapeHtml(tb('bot.resume_title'))}</strong>
                <small>${escapeHtml(detail)}</small>
            </span>
            <button class="btn btn-secondary btn-sm" type="button" data-action="resume-bot">${escapeHtml(tb('bot.resume'))}</button>`;
    }

    selectLevel(level, focus = false) {
        if (!BOT_LEVELS.includes(level)) return;
        this.local.setLevel(level);
        this.renderBot();
        if (focus) this.elements.botLevels.querySelector(`[data-level="${level}"]`)?.focus();
    }

    /** Arrow keys move the choice within the level radio group. */
    handleLevelKey(event) {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const index = BOT_LEVELS.indexOf(this.local.level);
        this.selectLevel(BOT_LEVELS[(index + step + BOT_LEVELS.length) % BOT_LEVELS.length], true);
    }

    pendingButton(action, label, kind, attributes = '') {
        const key = `${action}:${attributes}`;
        const busy = this.busy.has(key);
        return `<button class="btn btn-${kind} btn-sm ${busy ? 'btn--pending' : ''}" type="button" data-action="${action}" ${attributes} ${busy ? 'disabled aria-busy="true"' : ''}>${escapeHtml(label)}</button>`;
    }

    renderInvites() {
        const invites = Object.entries(this.player?.invites || {})
            .filter(([, invite]) => this.isLive(invite))
            .sort(([, a], [, b]) => Number(b.createdAtMs) - Number(a.createdAtMs));
        this.elements.invitesPanel.hidden = invites.length === 0;
        this.elements.invites.innerHTML = invites.map(([gameId, invite]) => {
            const name = invite.fromName || tb('game.opponent');
            const attributes = `data-game="${escapeHtml(gameId)}"`;
            return `<li class="bs-row">
                ${avatarHtml(name, invite.fromPhoto)}
                <span class="bs-row__copy">
                    <strong>${escapeHtml(invite.rematch ? tb('lobby.invite_rematch', { name }) : tb('lobby.invite_from', { name }))}</strong>
                    <small>${escapeHtml(this.relativeTime(invite.createdAtMs))}</small>
                </span>
                <span class="bs-row__actions">
                    ${this.pendingButton('accept-invite', tb('lobby.accept'), 'primary', attributes)}
                    ${this.pendingButton('decline-invite', tb('lobby.decline'), 'ghost', attributes)}
                </span>
            </li>`;
        }).join('');
    }

    summaryStatus(summary) {
        if (summary.status === 'waiting') {
            return summary.opponentUid && summary.role === 'host'
                ? tb('lobby.status_waiting_invite', { name: summary.opponentName || tb('game.opponent') })
                : tb('lobby.status_waiting');
        }
        if (summary.status === 'placing') return tb('lobby.status_placing');
        if (summary.status === 'playing') {
            return summary.turnUid === this.uid ? tb('lobby.status_your_turn') : tb('lobby.status_their_turn');
        }
        return '';
    }

    renderMyGames() {
        const games = Object.entries(this.player?.games || {})
            .filter(([, summary]) => summary && this.isLive(summary))
            .sort(([, a], [, b]) => Number(b.updatedAtMs) - Number(a.updatedAtMs));
        if (!games.length) {
            this.elements.myGames.innerHTML = `<li class="bs-empty">${escapeHtml(tb('lobby.my_games_empty'))}</li>`;
            return;
        }
        this.elements.myGames.innerHTML = games.map(([gameId, summary]) => {
            const name = summary.opponentName;
            const myTurn = summary.status === 'playing' && summary.turnUid === this.uid;
            const placing = summary.status === 'placing';
            return `<li class="bs-row ${myTurn ? 'is-attention' : ''}">
                ${avatarHtml(name || '?', summary.opponentPhoto)}
                <span class="bs-row__copy">
                    <strong>${escapeHtml(name ? tb('lobby.vs', { name }) : tb('lobby.no_opponent'))}</strong>
                    <small><span class="bs-status-dot ${myTurn || placing ? 'is-active' : ''}" aria-hidden="true"></span>${escapeHtml(this.summaryStatus(summary))} · ${escapeHtml(gameId)}</small>
                </span>
                <span class="bs-row__actions">
                    <button class="btn ${myTurn ? 'btn-primary' : 'btn-secondary'} btn-sm" type="button" data-action="open-game" data-game="${escapeHtml(gameId)}">${escapeHtml(tb('lobby.open'))}</button>
                </span>
            </li>`;
        }).join('');
    }

    renderOpenGames() {
        const entries = Object.entries(this.lobby?.games || {})
            .filter(([, entry]) => entry && this.isLive(entry))
            .sort(([, a], [, b]) => Number(b.createdAtMs) - Number(a.createdAtMs));
        if (!entries.length) {
            this.elements.openGames.innerHTML = `<li class="bs-empty">${escapeHtml(tb('lobby.open_empty'))}</li>`;
            return;
        }
        this.elements.openGames.innerHTML = entries.map(([gameId, entry]) => {
            const name = entry.hostName || tb('game.opponent');
            const mine = entry.hostUid === this.uid;
            const attributes = `data-game="${escapeHtml(gameId)}"`;
            return `<li class="bs-row">
                ${avatarHtml(name, entry.hostPhoto)}
                <span class="bs-row__copy">
                    <strong>${escapeHtml(mine ? tb('lobby.open_yours') : name)}</strong>
                    <small>${escapeHtml(this.relativeTime(entry.createdAtMs))}</small>
                </span>
                <span class="bs-row__actions">
                    ${mine
                        ? `<button class="btn btn-secondary btn-sm" type="button" data-action="open-game" ${attributes}>${escapeHtml(tb('lobby.open'))}</button>`
                        : this.pendingButton('join-open', tb('lobby.open_join'), 'primary', attributes)}
                </span>
            </li>`;
        }).join('');
    }

    renderRecent() {
        const stats = this.player?.stats || { played: 0, wins: 0, losses: 0 };
        const played = Number(stats.played) || 0;
        const wins = Number(stats.wins) || 0;
        const losses = Number(stats.losses) || 0;
        this.elements.stats.innerHTML = `
            <div><dt>${escapeHtml(tb('lobby.stats_played'))}</dt><dd>${played}</dd></div>
            <div><dt>${escapeHtml(tb('lobby.stats_wins'))}</dt><dd>${wins}</dd></div>
            <div><dt>${escapeHtml(tb('lobby.stats_losses'))}</dt><dd>${losses}</dd></div>`;
        const recent = Array.isArray(this.player?.recent) ? this.player.recent : [];
        if (!recent.length) {
            this.elements.recent.innerHTML = `<li class="bs-empty">${escapeHtml(tb('lobby.recent_empty'))}</li>`;
            return;
        }
        this.elements.recent.innerHTML = recent.slice(0, 8).map(entry => {
            const won = entry.result === 'win';
            const name = entry.opponentName || tb('game.opponent');
            const accuracy = Number(entry.shots) > 0 ? Math.round((Number(entry.hits) / Number(entry.shots)) * 100) : null;
            const challengeAttributes = entry.opponentUid
                ? `data-uid="${escapeHtml(entry.opponentUid)}" data-name="${escapeHtml(name)}"` : '';
            return `<li class="bs-row bs-row--compact">
                <span class="bs-result ${won ? 'is-win' : 'is-loss'}">${escapeHtml(won ? tb('lobby.result_win') : tb('lobby.result_loss'))}</span>
                <span class="bs-row__copy">
                    <strong>${escapeHtml(tb('lobby.vs', { name }))}</strong>
                    <small>${escapeHtml([this.relativeTime(entry.finishedAtMs), accuracy !== null ? tb('lobby.accuracy', { percent: accuracy }) : ''].filter(Boolean).join(' · '))}</small>
                </span>
                ${entry.opponentUid ? `<span class="bs-row__actions">${this.pendingButton('challenge', tb('lobby.challenge_again'), 'ghost', challengeAttributes)}</span>` : ''}
            </li>`;
        }).join('');
    }

    renderSearch() {
        const list = this.elements.searchResults;
        const query = this.elements.search.value.trim();
        if (this.searchError) {
            list.innerHTML = `<li class="bs-empty">${escapeHtml(this.searchError)}</li>`;
            return;
        }
        if (query.length < 2 || this.searchResults === null) {
            list.innerHTML = this.searchResults === null && query.length >= 2
                ? `<li class="bs-empty">${escapeHtml(tb('lobby.challenge_searching'))}</li>` : '';
            return;
        }
        if (!this.searchResults.length) {
            list.innerHTML = `<li class="bs-empty">${escapeHtml(tb('lobby.challenge_empty'))}</li>`;
            return;
        }
        list.innerHTML = this.searchResults.map(player => {
            const attributes = `data-uid="${escapeHtml(player.uid)}" data-name="${escapeHtml(player.name)}"`;
            return `<li class="bs-row bs-row--compact">
                ${avatarHtml(player.name, player.photo)}
                <span class="bs-row__copy">
                    <strong>${escapeHtml(player.name)}</strong>
                    ${player.username ? `<small>@${escapeHtml(player.username)}</small>` : ''}
                </span>
                <span class="bs-row__actions">${this.pendingButton('challenge', tb('lobby.challenge_button'), 'secondary', attributes)}</span>
            </li>`;
        }).join('');
    }

    relativeTime(ms) {
        const value = Number(ms);
        if (!Number.isFinite(value) || value <= 0) return '';
        // Server times are moved onto the local clock before formatting.
        return i18n.formatRelativeTime(value - (this.service.serverNow() - Date.now()));
    }

    async searchPlayers() {
        const query = this.elements.search.value.trim();
        const token = ++this.searchToken;
        this.searchError = null;
        if (query.replace(/^@/, '').length < 2) {
            this.searchResults = null;
            this.renderSearch();
            return;
        }
        this.searchResults = null;
        this.renderSearch();
        try {
            const results = await this.service.searchPlayers(query);
            if (token !== this.searchToken) return;
            this.searchResults = results;
        } catch (error) {
            if (token !== this.searchToken) return;
            console.warn('[Battleship] player search failed', error);
            this.searchError = tb('errors.search_failed');
        }
        this.renderSearch();
    }

    async lobbyAction(key, task) {
        if (this.busy.has(key)) return;
        this.busy.add(key);
        this.renderLobby();
        try {
            await task();
        } catch (error) {
            this.toast(this.describeError(error), 'error');
        } finally {
            this.busy.delete(key);
            this.renderLobby();
        }
    }

    async createGame(visibility, button) {
        if (button?.disabled) return;
        if (button) {
            button.disabled = true;
            button.classList.add('is-pending');
        }
        try {
            const result = await this.service.create({ visibility });
            this.navigate(result.gameId);
        } catch (error) {
            this.toast(this.describeError(error), 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.classList.remove('is-pending');
            }
        }
    }

    async joinByCode() {
        const code = normalizeGameCode(this.elements.joinCode.value);
        if (!code) {
            this.elements.joinError.textContent = tb('lobby.join_invalid');
            this.elements.joinError.hidden = false;
            this.elements.joinCode.setAttribute('aria-invalid', 'true');
            this.elements.joinCode.focus();
            return;
        }
        const ownGame = this.player?.games?.[code];
        if (ownGame) {
            this.navigate(code);
            return;
        }
        await this.lobbyAction('join-code', async () => {
            try {
                await this.service.join(code);
            } catch (error) {
                // The player's own game opens as it is.
                if (error?.code !== 'OWN_GAME') throw error;
            }
            this.elements.joinCode.value = '';
            this.navigate(code);
        });
    }

    handleLobbyClick(event) {
        const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
        if (!target || target.disabled) return;
        const action = target.dataset.action;
        const gameId = target.dataset.game || null;
        const attributes = gameId ? `data-game="${escapeHtml(gameId)}"` : '';
        switch (action) {
            case 'create-public':
                this.createGame('public', target);
                break;
            case 'create-private':
                this.createGame('private', target);
                break;
            case 'open-game':
                if (gameId) this.navigate(gameId);
                break;
            case 'join-open':
                this.lobbyAction(`join-open:${attributes}`, async () => {
                    await this.service.join(gameId);
                    this.navigate(gameId);
                });
                break;
            case 'accept-invite':
                this.lobbyAction(`accept-invite:${attributes}`, async () => {
                    await this.service.join(gameId);
                    this.navigate(gameId);
                });
                break;
            case 'decline-invite':
                this.lobbyAction(`decline-invite:${attributes}`, () => this.service.decline(gameId));
                break;
            case 'challenge': {
                const uid = target.dataset.uid;
                const name = target.dataset.name || '';
                const key = `challenge:data-uid="${escapeHtml(uid)}" data-name="${escapeHtml(name)}"`;
                this.lobbyAction(key, async () => {
                    const result = await this.service.create({ invitedUid: uid });
                    this.toast(tb('lobby.challenge_sent', { name }));
                    this.navigate(result.gameId);
                });
                break;
            }
            case 'bot-level':
                this.selectLevel(target.dataset.level);
                break;
            case 'start-bot':
                this.startBotGame();
                this.navigate('bot');
                break;
            case 'resume-bot':
                this.navigate('bot');
                break;
            default:
                break;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const page = new BattleshipPage();
    globalThis.battleshipPage = page;
    page.init().catch(error => {
        console.error('[Battleship] page failed to start', error);
        page.showView('lobby');
    });
});
