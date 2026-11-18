import { t } from '../games/gamesI18n.js';
import { BattleshipNotifier } from './BattleshipNotifier.js';

/**
 * Chess news on every extension page except the chess page: a challenge or a
 * rematch, an opponent who accepted your game, your move, a draw offer. The
 * same notices and storage rules as Battleship (BattleshipNotifier), fed by the
 * player's own `chessPlayers/{uid}` document.
 */

export const CHESS_NOTIFIED_STORAGE_KEY = 'chessNotifiedV1';

const tc = (key, params) => t(`chess.${key}`, params);

/**
 * Everything in a chess player document worth telling about, newest first.
 * Keys are stable per event, so a seen event is never shown again.
 * @param {Object|null} player - chessPlayers/{uid} data
 * @param {string} uid
 * @param {number} now
 */
export function chessEvents(player, uid, now) {
    if (!player || !uid) return [];
    const events = [];
    for (const [gameId, invite] of Object.entries(player.invites || {})) {
        if (!invite || Number(invite.expiresAtMs) <= now) continue;
        events.push({
            key: `invite:${gameId}`,
            kind: invite.rematch ? 'rematch' : 'invite',
            gameId,
            name: invite.fromName || tc('online.opponent'),
            photo: invite.fromPhoto || null,
            at: Number(invite.createdAtMs) || 0
        });
    }
    for (const [gameId, summary] of Object.entries(player.games || {})) {
        if (!summary || summary.status !== 'playing') continue;
        const name = summary.opponentName || tc('online.opponent');
        const at = Number(summary.updatedAtMs) || 0;
        const photo = summary.opponentPhoto || null;
        if (summary.role === 'host' && Number(summary.moveCount) === 0) {
            events.push({ key: `joined:${gameId}`, kind: 'joined', gameId, name, photo, at });
        }
        if (summary.drawOfferBy && summary.drawOfferBy !== uid) {
            events.push({ key: `draw:${gameId}:${at}`, kind: 'draw', gameId, name, photo, at });
        } else if (summary.turnUid === uid && Number(summary.moveCount) > 0) {
            events.push({ key: `turn:${gameId}:${at}`, kind: 'turn', gameId, name, photo, at });
        }
    }
    return events.sort((a, b) => b.at - a.at);
}

export const CHESS_NOTIFIER_CONFIG = Object.freeze({
    source: 'chess',
    collection: 'chessPlayers',
    channel: 'movielist-chess',
    pagePath: 'src/pages/chess/chess.html',
    storageKey: CHESS_NOTIFIED_STORAGE_KEY,
    prefix: 'chess',
    events: chessEvents
});

export class ChessNotifier extends BattleshipNotifier {
    constructor(options) {
        super({ ...options, config: CHESS_NOTIFIER_CONFIG });
    }
}
