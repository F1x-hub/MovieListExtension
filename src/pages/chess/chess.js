import { i18n } from '../../shared/i18n/I18n.js';
import { escapeHtml } from '../../shared/games/gamesI18n.js';
import { pieceGlyph } from '../../shared/games/chess/ChessIcons.js';
import { ChessSounds } from '../../shared/games/chess/ChessSounds.js';
import { ChessLocalStore } from '../../shared/games/chess/ChessLocalStore.js';
import { CHESS_CHANNEL, TOUCH_INTERVAL_MS, ChessService, normalizeGameCode } from '../../shared/services/ChessService.js';
import { avatarHtml, tc } from './ChessGameView.js';
import { ChessBotView } from './ChessBotView.js';
import { ChessOnlineView } from './ChessOnlineView.js';

const LEVELS = [1, 2, 3, 4, 5, 6];
const CLOCKS = ['3+2', '5+3', '10+5', '15+10', 'none'];
const SEARCH_DEBOUNCE_MS = 300;
const TOAST_MS = 3200;

/**
 * The chess page: the lobby (games against the bot; online games, codes,
 * challenges, open games, rating) and, for `?bot` or `?game=CODE`, the game
 * screen. Owns auth, routing, the player's own document, the touch that keeps
 * open games listed and the page title.
 */
class ChessPage {
    constructor() {
        this.rules = globalThis.ChessRules;
        this.store = new ChessLocalStore({ rules: this.rules });
        this.service = new ChessService();
        this.sounds = new ChessSounds();
        this.prefs = null;
        this.botStats = null;
        this.savedBotGame = null;
        this.botStart = null;
        this.uid = null;
        this.started = false;
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
        this.channel = null;
        this.baseTitle = document.title;
        const byId = id => document.getElementById(id);
        this.elements = {
            subtitle: byId('chessSubtitle'),
            loading: byId('chessLoading'),
            lobby: byId('chessLobby'),
            game: byId('chessGame'),
            toast: byId('chessToast'),
            mute: byId('chessMuteBtn'),
            muteLabel: byId('chessMuteLabel'),
            levels: byId('chessLevels'),
            sides: byId('chessSides'),
            botRecord: byId('chessBotRecord'),
            resume: byId('chessResume'),
            guest: byId('chessGuest'),
            onlineControls: byId('chessOnlineControls'),
            clocks: byId('chessClocks'),
            onlineSides: byId('chessOnlineSides'),
            joinForm: byId('chessJoinForm'),
            joinCode: byId('chessJoinCode'),
            joinError: byId('chessJoinError'),
            search: byId('chessPlayerSearch'),
            searchResults: byId('chessPlayerResults'),
            side: byId('chessLobbySide'),
            invitesPanel: byId('chessInvitesPanel'),
            invites: byId('chessInvites'),
            myGames: byId('chessMyGames'),
            openGames: byId('chessOpenGames'),
            stats: byId('chessStats'),
            recent: byId('chessRecent')
        };
    }

    async init() {
        await i18n.init();
        i18n.translatePage();
        this.baseTitle = tc('page_title');
        document.title = this.baseTitle;
        [this.prefs, this.botStats, this.savedBotGame] = await Promise.all([
            this.store.loadPrefs(),
            this.store.loadStats(),
            this.store.loadBotGame()
        ]);
        this.bindEvents();
        this.updateMute();
        this.openChannel();
        const manager = globalThis.firebaseManager;
        await manager?.waitForAuthReady?.(10000);
        window.addEventListener('authStateChanged', () => this.onAuthChanged());
        window.addEventListener('popstate', () => this.route());
        chrome.runtime?.onMessage?.addListener?.(message => {
            if (message?.type === 'SETTINGS_UPDATED' && message.settings?.language) this.reloadLocale();
        });
        this.onAuthChanged();
    }

    async reloadLocale() {
        await i18n.init();
        i18n.translatePage();
        this.baseTitle = tc('page_title');
        this.updateTitle();
        this.updateMute();
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
        document.getElementById('chessSignInBtn')?.addEventListener('click', () => {
            globalThis.navigationInstance?.showAuthModal?.('login');
        });
        this.elements.lobby.addEventListener('click', event => this.handleLobbyClick(event));
        this.elements.lobby.addEventListener('keydown', event => this.handleRadioKeys(event));
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
        const label = muted ? tc('sound_off') : tc('sound_on');
        this.elements.muteLabel.textContent = label;
        this.elements.mute.title = label;
    }

    /** Other extension pages ask here before announcing a turn in a game already open. */
    openChannel() {
        if (typeof BroadcastChannel !== 'function') return;
        this.channel = new BroadcastChannel(CHESS_CHANNEL);
        this.channel.addEventListener('message', event => {
            if (event.data?.type === 'ping') {
                this.channel.postMessage({ type: 'pong', id: event.data.id, gameId: this.gameView?.gameId || null });
            }
        });
    }

    // --- Auth and routing ---------------------------------------------------------------------------

    onAuthChanged() {
        // Only a restored Firebase session can read the game documents.
        const uid = globalThis.firebaseManager?.auth?.currentUser?.uid || null;
        if (this.started && uid === this.uid) return;
        this.started = true;
        this.teardownSession();
        this.uid = uid;
        if (uid) {
            this.unsubscribePlayer = this.service.subscribePlayer(uid, player => {
                this.player = player;
                this.renderLobby();
            }, error => {
                console.warn('[Chess] player document unavailable', error);
                this.player = null;
                this.renderLobby();
            });
            // Wakes the function up and learns the server clock before the first move.
            this.service.ping().catch(() => {});
            this.touchTimer = setInterval(() => this.touchOpenGames(), TOUCH_INTERVAL_MS);
        }
        this.route(true);
    }

    teardownSession() {
        this.unsubscribePlayer?.();
        this.unsubscribePlayer = null;
        this.unsubscribeLobby?.();
        this.unsubscribeLobby = null;
        clearInterval(this.touchTimer);
        this.touchTimer = null;
        if (this.gameView instanceof ChessOnlineView) {
            this.gameView.destroy();
            this.gameView = null;
        }
        this.player = null;
        this.lobby = null;
    }

    route(force = false) {
        const params = new URLSearchParams(location.search);
        const gameId = normalizeGameCode(params.get('game'));
        if (gameId) {
            if (!this.uid) {
                this.closeGameView();
                this.showView('lobby');
                this.toast(tc('guest.online_link'));
                return;
            }
            if (!force && this.gameView?.gameId === gameId) return;
            this.openOnline(gameId);
            return;
        }
        if (params.has('bot')) {
            if (!force && this.gameView instanceof ChessBotView) return;
            this.openBot();
            return;
        }
        this.closeGameView();
        this.showView('lobby');
    }

    /** @param {string|null} target - an online game code, 'bot', or null for the lobby */
    navigate(target, { replace = false } = {}) {
        const url = new URL(location.href);
        url.searchParams.delete('game');
        url.searchParams.delete('bot');
        if (target === 'bot') url.searchParams.set('bot', '1');
        else if (target) url.searchParams.set('game', target);
        if (replace) history.replaceState(null, '', url);
        else history.pushState(null, '', url);
        this.route(true);
        window.scrollTo({ top: 0 });
    }

    closeGameView() {
        this.gameView?.destroy();
        this.gameView = null;
        this.attention = null;
        this.updateTitle();
    }

    viewOptions() {
        return {
            root: this.elements.game,
            rules: this.rules,
            sounds: this.sounds,
            prefs: this.prefs,
            onPrefs: patch => this.savePrefs(patch),
            onNavigate: target => this.navigate(target),
            onToast: (text, tone) => this.toast(text, tone),
            onSubtitle: text => { if (this.view === 'game' && text) this.elements.subtitle.textContent = text; },
            onAttention: state => {
                this.attention = state;
                this.updateTitle();
            }
        };
    }

    async openBot() {
        this.closeGameView();
        const start = this.botStart;
        this.botStart = null;
        const token = this.openToken = (this.openToken || 0) + 1;
        // Read the save again: a view rebuilt after a sign-in or a language
        // change continues from the last move, not from what the lobby saw.
        const saved = start ? null : await this.store.loadBotGame();
        if (token !== this.openToken) return;
        const level = start?.level ?? saved?.level ?? this.prefs.level;
        const playerColor = start?.color ?? saved?.playerColor ?? this.resolveBotSide();
        this.showView('game');
        const user = globalThis.firebaseManager?.auth?.currentUser || null;
        this.gameView = new ChessBotView({
            ...this.viewOptions(),
            store: this.store,
            level,
            playerColor,
            saved,
            userName: user?.displayName || null,
            userPhoto: user?.photoURL || null,
            onStats: stats => {
                this.botStats = stats;
                this.savedBotGame = null;
            },
            onRestart: () => {
                this.botStart = { level, color: playerColor };
                this.savedBotGame = null;
                this.openBot();
            }
        });
        this.gameView.start();
    }

    openOnline(gameId) {
        this.openToken = (this.openToken || 0) + 1;
        this.closeGameView();
        this.showView('game');
        this.gameView = new ChessOnlineView({
            ...this.viewOptions(),
            service: this.service,
            uid: this.uid,
            gameId,
            describeError: error => this.describeError(error)
        });
        this.gameView.start();
    }

    async showView(view) {
        this.view = view;
        for (const name of ['loading', 'lobby', 'game']) {
            this.elements[name].hidden = name !== view;
        }
        if (view === 'lobby') {
            this.elements.subtitle.textContent = tc('subtitle');
            this.attention = null;
            this.updateTitle();
            if (this.uid && !this.unsubscribeLobby) {
                this.unsubscribeLobby = this.service.subscribeLobby(lobby => {
                    this.lobby = lobby;
                    this.renderLobby();
                }, error => {
                    console.warn('[Chess] lobby unavailable', error);
                    this.lobby = null;
                    this.renderLobby();
                });
            }
            this.savedBotGame = await this.store.loadBotGame();
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
        if (code === 'permission-denied') return tc('errors.NOT_A_PLAYER');
        if (code === 'unavailable' || code === 'NETWORK') return tc('errors.NETWORK');
        const key = `errors.${code}`;
        const message = tc(key);
        return message !== `chess.${key}` ? message : tc('errors.generic');
    }

    savePrefs(patch) {
        this.prefs = { ...this.prefs, ...patch };
        this.store.savePrefs(this.prefs);
    }

    resolveBotSide() {
        const side = this.prefs.botSide;
        if (side === 'w' || side === 'b') return side;
        return Math.random() < 0.5 ? 'w' : 'b';
    }

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
                    console.warn('[Chess] could not keep the open game listed', error);
                }
            }
        }
    }

    // --- Lobby ------------------------------------------------------------------------------------------

    renderLobby() {
        if (this.view !== 'lobby' || !this.prefs) return;
        this.renderLevels();
        this.renderSides();
        this.renderBotRecord();
        this.renderResume();
        const signedIn = Boolean(this.uid);
        this.elements.guest.hidden = signedIn;
        this.elements.onlineControls.hidden = !signedIn;
        this.elements.side.hidden = !signedIn;
        if (!signedIn) return;
        this.renderClocks();
        this.renderOnlineSides();
        this.renderInvites();
        this.renderMyGames();
        this.renderOpenGames();
        this.renderStats();
        this.renderSearch();
    }

    radioHtml(group, value, checked, content, extraClass = 'chess-choice') {
        return `<button class="${extraClass}" type="button" role="radio" data-group="${group}" data-value="${escapeHtml(value)}" aria-checked="${checked}" tabindex="${checked ? 0 : -1}">${content}</button>`;
    }

    renderLevels() {
        const level = this.prefs.level;
        this.elements.levels.innerHTML = LEVELS.map(value => this.radioHtml('level', String(value), value === level, `
            <span class="chess-level__head"><span class="chess-level__name">${escapeHtml(tc(`levels.${value}.name`))}</span><span class="chess-level__number">${value}/6</span></span>
            <span class="chess-level__text">${escapeHtml(tc(`levels.${value}.text`))}</span>
            <span class="chess-strength" aria-hidden="true">${LEVELS.map(bar => `<span class="${bar <= value ? 'is-on' : ''}"></span>`).join('')}</span>`, 'chess-level')).join('');
    }

    renderSides() {
        const side = this.prefs.botSide;
        this.elements.sides.innerHTML = [['w', 'white'], ['random', 'random'], ['b', 'black']].map(([value, key]) => this.radioHtml(
            'botSide', value, side === value,
            `${value === 'random' ? '' : pieceGlyph('k', value)}${escapeHtml(tc(`lobby.side_${key}`))}`
        )).join('');
    }

    renderBotRecord() {
        const entry = this.botStats?.[this.prefs.level] || { wins: 0, draws: 0, losses: 0 };
        const total = entry.wins + entry.draws + entry.losses;
        this.elements.botRecord.textContent = total
            ? tc('lobby.bot_record', { wins: entry.wins, draws: entry.draws, losses: entry.losses })
            : tc('lobby.bot_record_empty');
    }

    renderResume() {
        const saved = this.savedBotGame;
        const box = this.elements.resume;
        if (!saved) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        const move = Math.floor(saved.moves.length / 2) + 1;
        box.hidden = false;
        box.innerHTML = `
            <span class="chess-avatar chess-avatar--bot" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"></rect><path d="M12 8V4"></path><path d="M9 13h.01M15 13h.01"></path></svg></span>
            <span class="chess-resume__copy">
                <strong>${escapeHtml(tc('lobby.resume_title'))}</strong>
                <small>${escapeHtml(tc('lobby.resume_text', { level: tc(`levels.${saved.level}.name`), side: tc(`lobby.as_${saved.playerColor}`), move }))}</small>
            </span>
            <button class="btn btn-secondary btn-sm" type="button" data-action="resume-bot">${escapeHtml(tc('lobby.resume'))}</button>`;
    }

    renderClocks() {
        const current = this.prefs.timeControl;
        this.elements.clocks.innerHTML = CLOCKS.map(value => {
            const label = value === 'none' ? tc('controls.none') : value.replace('+', ' + ');
            const kind = tc(`controls.kind.${value === 'none' ? 'none' : value}`);
            return this.radioHtml('timeControl', value, value === current, `${escapeHtml(label)}${kind ? ` <small>${escapeHtml(kind)}</small>` : ''}`);
        }).join('');
    }

    renderOnlineSides() {
        const side = this.prefs.onlineSide;
        this.elements.onlineSides.innerHTML = [['white', 'w'], ['random', null], ['black', 'b']].map(([value, glyph]) => this.radioHtml(
            'onlineSide', value, side === value,
            `${glyph ? pieceGlyph('k', glyph) : ''}${escapeHtml(tc(`lobby.side_${value}`))}`
        )).join('');
    }

    pendingButton(action, label, kind, attributes = '') {
        const key = `${action}:${attributes}`;
        const busy = this.busy.has(key);
        return `<button class="btn btn-${kind} btn-sm ${busy ? 'btn--pending' : ''}" type="button" data-action="${action}" ${attributes} ${busy ? 'disabled aria-busy="true"' : ''}>${escapeHtml(label)}</button>`;
    }

    controlText(id) {
        return id && id !== 'none' ? tc('controls.timed', { control: id.replace('+', ' + ') }) : tc('controls.none');
    }

    ratingText(rating) {
        return rating ? ` · ${rating}` : '';
    }

    renderInvites() {
        const invites = Object.entries(this.player?.invites || {})
            .filter(([, invite]) => this.isLive(invite))
            .sort(([, a], [, b]) => Number(b.createdAtMs) - Number(a.createdAtMs));
        this.elements.invitesPanel.hidden = invites.length === 0;
        this.elements.invites.innerHTML = invites.map(([gameId, invite]) => {
            const name = invite.fromName || tc('online.opponent');
            const attributes = `data-game="${escapeHtml(gameId)}"`;
            return `<li class="chess-row is-attention">
                ${avatarHtml(name, invite.fromPhoto)}
                <span class="chess-row__copy">
                    <strong>${escapeHtml(invite.rematch ? tc('lobby.invite_rematch', { name }) : tc('lobby.invite_from', { name }))}${escapeHtml(this.ratingText(invite.fromRating))}</strong>
                    <small>${escapeHtml([this.controlText(invite.timeControl), this.relativeTime(invite.createdAtMs)].filter(Boolean).join(' · '))}</small>
                </span>
                <span class="chess-row__actions">
                    ${this.pendingButton('accept-invite', tc('online.accept'), 'primary', attributes)}
                    ${this.pendingButton('decline-invite', tc('online.decline'), 'ghost', attributes)}
                </span>
            </li>`;
        }).join('');
    }

    summaryStatus(summary) {
        if (summary.status === 'waiting') {
            return summary.opponentUid && summary.role === 'host'
                ? tc('lobby.status_waiting_invite', { name: summary.opponentName || tc('online.opponent') })
                : tc('lobby.status_waiting');
        }
        if (summary.status === 'playing') {
            if (summary.drawOfferBy && summary.drawOfferBy !== this.uid) return tc('lobby.status_draw_offer');
            return summary.turnUid === this.uid ? tc('lobby.status_your_turn') : tc('lobby.status_their_turn');
        }
        return '';
    }

    renderMyGames() {
        const games = Object.entries(this.player?.games || {})
            .filter(([, summary]) => summary && this.isLive(summary))
            .sort(([, a], [, b]) => Number(b.updatedAtMs) - Number(a.updatedAtMs));
        if (!games.length) {
            this.elements.myGames.innerHTML = `<li class="chess-empty">${escapeHtml(tc('lobby.my_games_empty'))}</li>`;
            return;
        }
        this.elements.myGames.innerHTML = games.map(([gameId, summary]) => {
            const name = summary.opponentName;
            const myTurn = summary.status === 'playing' && summary.turnUid === this.uid;
            const glyph = summary.color ? pieceGlyph('k', summary.color === 'white' ? 'w' : 'b') : '';
            return `<li class="chess-row ${myTurn ? 'is-attention' : ''}">
                ${avatarHtml(name || '?', summary.opponentPhoto)}
                <span class="chess-row__copy">
                    <strong>${glyph}${escapeHtml(name ? tc('lobby.vs', { name }) : tc('lobby.no_opponent'))}</strong>
                    <small><span class="chess-status-dot ${myTurn ? 'is-active' : ''}" aria-hidden="true"></span>${escapeHtml([this.summaryStatus(summary), this.controlText(summary.timeControl), gameId].join(' · '))}</small>
                </span>
                <span class="chess-row__actions">
                    <button class="btn ${myTurn ? 'btn-primary' : 'btn-secondary'} btn-sm" type="button" data-action="open-game" data-game="${escapeHtml(gameId)}">${escapeHtml(tc('lobby.open'))}</button>
                </span>
            </li>`;
        }).join('');
    }

    renderOpenGames() {
        const entries = Object.entries(this.lobby?.games || {})
            .filter(([, entry]) => entry && this.isLive(entry))
            .sort(([, a], [, b]) => Number(b.createdAtMs) - Number(a.createdAtMs));
        if (!entries.length) {
            this.elements.openGames.innerHTML = `<li class="chess-empty">${escapeHtml(tc('lobby.open_empty'))}</li>`;
            return;
        }
        this.elements.openGames.innerHTML = entries.map(([gameId, entry]) => {
            const name = entry.hostName || tc('online.opponent');
            const mine = entry.hostUid === this.uid;
            const attributes = `data-game="${escapeHtml(gameId)}"`;
            return `<li class="chess-row">
                ${avatarHtml(name, entry.hostPhoto)}
                <span class="chess-row__copy">
                    <strong>${escapeHtml(mine ? tc('lobby.open_yours') : name)}${escapeHtml(mine ? '' : this.ratingText(entry.hostRating))}</strong>
                    <small>${escapeHtml([this.controlText(entry.timeControl), tc(`online.host_color.${entry.hostColor || 'random'}`), this.relativeTime(entry.createdAtMs)].filter(Boolean).join(' · '))}</small>
                </span>
                <span class="chess-row__actions">
                    ${mine
                        ? `<button class="btn btn-secondary btn-sm" type="button" data-action="open-game" ${attributes}>${escapeHtml(tc('lobby.open'))}</button>`
                        : this.pendingButton('join-open', tc('lobby.open_join'), 'primary', attributes)}
                </span>
            </li>`;
        }).join('');
    }

    renderStats() {
        const player = this.player;
        const stats = player?.stats || { played: 0, wins: 0, draws: 0, losses: 0 };
        const rating = Number(player?.rating) || 1200;
        this.elements.stats.innerHTML = `
            <div><dt>${escapeHtml(tc('lobby.stats_rating'))}</dt><dd>${rating}</dd></div>
            <div><dt>${escapeHtml(tc('lobby.stats_wins'))}</dt><dd>${Number(stats.wins) || 0}</dd></div>
            <div><dt>${escapeHtml(tc('lobby.stats_draws'))}</dt><dd>${Number(stats.draws) || 0}</dd></div>
            <div><dt>${escapeHtml(tc('lobby.stats_losses'))}</dt><dd>${Number(stats.losses) || 0}</dd></div>`;
        const recent = Array.isArray(player?.recent) ? player.recent : [];
        if (!recent.length) {
            this.elements.recent.innerHTML = `<li class="chess-empty">${escapeHtml(tc('lobby.recent_empty'))}</li>`;
            return;
        }
        this.elements.recent.innerHTML = recent.slice(0, 8).map(entry => {
            const name = entry.opponentName || tc('online.opponent');
            const delta = Number(entry.ratingDelta);
            const deltaText = Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta}` : '';
            const challengeAttributes = entry.opponentUid
                ? `data-uid="${escapeHtml(entry.opponentUid)}" data-name="${escapeHtml(name)}"` : '';
            return `<li class="chess-row chess-row--compact">
                <span class="chess-result-tag is-${escapeHtml(entry.result)}">${escapeHtml(tc(`lobby.result_${entry.result}`))}</span>
                <span class="chess-row__copy">
                    <strong>${escapeHtml(tc('lobby.vs', { name }))}</strong>
                    <small>${escapeHtml([tc(`reasons_short.${entry.reason}`), deltaText, this.relativeTime(entry.finishedAtMs)].filter(Boolean).join(' · '))}</small>
                </span>
                ${entry.opponentUid ? `<span class="chess-row__actions">${this.pendingButton('challenge', tc('lobby.challenge_again'), 'ghost', challengeAttributes)}</span>` : ''}
            </li>`;
        }).join('');
    }

    renderSearch() {
        const list = this.elements.searchResults;
        const query = this.elements.search.value.trim();
        if (this.searchError) {
            list.innerHTML = `<li class="chess-empty">${escapeHtml(this.searchError)}</li>`;
            return;
        }
        if (query.length < 2 || this.searchResults === null) {
            list.innerHTML = this.searchResults === null && query.replace(/^@/, '').length >= 2
                ? `<li class="chess-empty">${escapeHtml(tc('lobby.challenge_searching'))}</li>` : '';
            return;
        }
        if (!this.searchResults.length) {
            list.innerHTML = `<li class="chess-empty">${escapeHtml(tc('lobby.challenge_empty'))}</li>`;
            return;
        }
        list.innerHTML = this.searchResults.map(player => {
            const attributes = `data-uid="${escapeHtml(player.uid)}" data-name="${escapeHtml(player.name)}"`;
            return `<li class="chess-row chess-row--compact">
                ${avatarHtml(player.name, player.photo)}
                <span class="chess-row__copy">
                    <strong>${escapeHtml(player.name)}</strong>
                    ${player.username ? `<small>@${escapeHtml(player.username)}</small>` : ''}
                </span>
                <span class="chess-row__actions">${this.pendingButton('challenge', tc('lobby.challenge_button'), 'secondary', attributes)}</span>
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
            console.warn('[Chess] player search failed', error);
            this.searchError = tc('errors.search_failed');
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
            const result = await this.service.create({ visibility, timeControl: this.prefs.timeControl, color: this.prefs.onlineSide });
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
            this.elements.joinError.textContent = tc('lobby.join_invalid');
            this.elements.joinError.hidden = false;
            this.elements.joinCode.setAttribute('aria-invalid', 'true');
            this.elements.joinCode.focus();
            return;
        }
        if (this.player?.games?.[code]) {
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

    async startBot() {
        if (this.savedBotGame) {
            const dialog = globalThis.ConfirmDialog;
            const replace = !dialog?.confirm || await dialog.confirm({
                title: tc('confirm.replace_title'),
                message: tc('confirm.replace_text'),
                confirmLabel: tc('confirm.replace'),
                cancelLabel: tc('confirm.keep')
            });
            if (!replace) return;
            await this.store.clearBotGame();
            this.savedBotGame = null;
        }
        this.botStart = { level: this.prefs.level, color: this.resolveBotSide() };
        this.navigate('bot');
    }

    setChoice(group, value) {
        if (group === 'level') this.savePrefs({ level: Number(value) });
        else if (group === 'botSide') this.savePrefs({ botSide: value });
        else if (group === 'timeControl') this.savePrefs({ timeControl: value });
        else if (group === 'onlineSide') this.savePrefs({ onlineSide: value });
        this.renderLobby();
        this.elements.lobby.querySelector(`[data-group="${group}"][aria-checked="true"]`)?.focus();
    }

    /** Arrow keys move the choice inside a radio group, as in a native one. */
    handleRadioKeys(event) {
        const radio = event.target.closest?.('[role="radio"][data-group]');
        if (!radio) return;
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const group = [...this.elements.lobby.querySelectorAll(`[role="radio"][data-group="${radio.dataset.group}"]`)];
        const next = group[(group.indexOf(radio) + step + group.length) % group.length];
        this.setChoice(next.dataset.group, next.dataset.value);
    }

    handleLobbyClick(event) {
        const target = event.target instanceof Element ? event.target.closest('[data-action], [role="radio"][data-group]') : null;
        if (!target || target.disabled) return;
        if (target.matches('[role="radio"][data-group]')) {
            this.setChoice(target.dataset.group, target.dataset.value);
            return;
        }
        const action = target.dataset.action;
        const gameId = target.dataset.game || null;
        const attributes = gameId ? `data-game="${escapeHtml(gameId)}"` : '';
        switch (action) {
            case 'start-bot':
                this.startBot();
                break;
            case 'resume-bot':
                this.botStart = null;
                this.navigate('bot');
                break;
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
            case 'accept-invite':
                this.lobbyAction(`${action}:${attributes}`, async () => {
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
                    const result = await this.service.create({
                        invitedUid: uid,
                        timeControl: this.prefs.timeControl,
                        color: this.prefs.onlineSide
                    });
                    this.toast(tc('lobby.challenge_sent', { name }));
                    this.navigate(result.gameId);
                });
                break;
            }
            default:
                break;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const page = new ChessPage();
    globalThis.chessPage = page;
    page.init().catch(error => {
        console.error('[Chess] page failed to start', error);
        page.showView('lobby');
    });
});
