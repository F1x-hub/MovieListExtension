/**
 * Classic worker that thinks for the chess bot, so the board keeps animating
 * while it searches. Request: { id, moves, level, hint }; answer:
 * { id, ok: true, result } or { id, ok: false, error }.
 */
/* global importScripts */
importScripts('./ChessRules.js', './ChessBot.js');

self.addEventListener('message', event => {
    const { id, moves = [], level = 3, hint = false } = event.data || {};
    try {
        const result = self.ChessBot.chooseMove({ moves, level, hint });
        self.postMessage({ id, ok: true, result });
    } catch (error) {
        self.postMessage({ id, ok: false, error: String(error?.message || error) });
    }
});
