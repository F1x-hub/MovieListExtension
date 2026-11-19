/*
 * Salvo (Залп) rules shared by the page and the `zalp` Cloud Function.
 * UMD and pure: the function keeps a byte-for-byte copy in functions/zalpRules.js
 * (tests/zalpFunction.test.cjs enforces it).
 *
 * - teams: an even number of players from four up plays as two equal teams, two players
 *   play one on one, an odd number plays every player for themselves;
 * - turns: teams take turns in order, and inside a team the living members take turns in seat order;
 * - a turn is recorded per simulation tick (120 per second) as a control mask plus rare events,
 *   streamed as text: runs "<mask>x<count>" in base 36 and events "!w:<weapon>", "!f:<fuse>",
 *   "!c:<x*10>:<y*10>", joined by dots. An event applies at the first tick of the run after it.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ZalpRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MIN_PLAYERS = 2;
    const MAX_PLAYERS = 8;
    const TICK_RATE = 120;
    const TURN_TICKS_MAX = TICK_RATE * 150;
    const MASK = Object.freeze({ LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, FIRE: 16, JUMP: 32, BACKFLIP: 64 });
    const WEAPON_IDS = Object.freeze(['rocket', 'grenade', 'cluster', 'shotgun', 'homing', 'air', 'dyn', 'mine', 'hammer', 'tele', 'skip']);
    const EVENT_PATTERN = /^(?:w:[a-z]{2,10}|f:[1-5]|c:-?\d{1,6}:-?\d{1,6})$/;
    const RUN_PATTERN = /^[0-9a-z]{1,2}x[0-9a-z]{1,4}$/;

    /** Team index for every seat. `random` returns [0, 1). */
    function splitTeams(count, random) {
        const n = Math.max(0, Math.floor(count));
        if (n === 2) return [0, 1];
        if (n >= 4 && n % 2 === 0) {
            const order = Array.from({ length: n }, (_, i) => i);
            for (let i = n - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            const teams = new Array(n);
            order.forEach((seat, k) => { teams[seat] = k % 2; });
            return teams;
        }
        return Array.from({ length: n }, (_, i) => i);
    }

    function teamOrder(seats) {
        const order = [];
        for (const seat of seats) if (!order.includes(seat.team)) order.push(seat.team);
        return order;
    }

    function canPlay(seats, alive, i) {
        return !seats[i].left && alive[i] !== false;
    }

    function livingTeams(seats, alive) {
        const teams = [];
        seats.forEach((seat, i) => { if (canPlay(seats, alive, i) && !teams.includes(seat.team)) teams.push(seat.team); });
        return teams;
    }

    /**
     * The next seat to play after `current` (-1 before the first turn), or null when nobody can.
     * `lastByTeam[team]` is the seat that last played for that team (-1 for none).
     */
    function nextSeat(seats, alive, current, lastByTeam) {
        const order = teamOrder(seats);
        if (!order.length) return null;
        const from = current >= 0 && seats[current] ? order.indexOf(seats[current].team) : -1;
        for (let k = 1; k <= order.length; k++) {
            const team = order[(from + k + order.length) % order.length];
            const members = [];
            seats.forEach((seat, i) => { if (seat.team === team && canPlay(seats, alive, i)) members.push(i); });
            if (!members.length) continue;
            const last = Number.isInteger(lastByTeam[team]) ? lastByTeam[team] : -1;
            const seat = members.find((i) => i > last) ?? members[0];
            const nextLast = lastByTeam.slice();
            while (nextLast.length <= team) nextLast.push(-1);
            nextLast[team] = seat;
            return { seat, lastByTeam: nextLast };
        }
        return null;
    }

    // ---------------------------------------------------------------- turn stream
    function encodeEvent(e) {
        if (e.t === 'w') return 'w:' + e.id;
        if (e.t === 'f') return 'f:' + e.n;
        return 'c:' + Math.round(e.x * 10) + ':' + Math.round(e.y * 10);
    }

    function decodeEvent(text) {
        const [kind, a, b] = text.split(':');
        if (kind === 'w') return { t: 'w', id: a };
        if (kind === 'f') return { t: 'f', n: Number(a) };
        return { t: 'c', x: Number(a) / 10, y: Number(b) / 10 };
    }

    /** Ticks in a stream chunk, or -1 when the chunk is malformed. */
    function chunkTicks(data) {
        if (typeof data !== 'string' || data.length > 200000) return -1;
        if (data === '') return 0;
        let ticks = 0;
        for (const token of data.split('.')) {
            if (token[0] === '!') {
                if (!EVENT_PATTERN.test(token.slice(1))) return -1;
                const e = decodeEvent(token.slice(1));
                if (e.t === 'w' && !WEAPON_IDS.includes(e.id)) return -1;
                continue;
            }
            if (!RUN_PATTERN.test(token)) return -1;
            const [mask, count] = token.split('x');
            const m = parseInt(mask, 36), c = parseInt(count, 36);
            if (m > 127 || c < 1) return -1;
            ticks += c;
        }
        return ticks;
    }

    class StreamEncoder {
        constructor() { this.parts = []; this.sent = 0; this.mask = -1; this.count = 0; this.ticks = 0; this.sentTicks = 0; }
        push(mask, events) {
            if ((events && events.length) || mask !== this.mask) {
                this.flush();
                if (events) for (const e of events) this.parts.push('!' + encodeEvent(e));
                this.mask = mask;
            }
            this.count++;
            this.ticks++;
        }
        flush() {
            if (this.count > 0) this.parts.push(this.mask.toString(36) + 'x' + this.count.toString(36));
            this.count = 0;
        }
        /** Everything recorded since the last drain; `from` is the tick it starts at. */
        drain() {
            this.flush();
            this.mask = -1;
            const data = this.parts.slice(this.sent).join('.');
            const from = this.sentTicks;
            this.sent = this.parts.length;
            this.sentTicks = this.ticks;
            return { from, data, ticks: this.ticks - from };
        }
    }

    const NO_EVENTS = Object.freeze([]);

    class StreamDecoder {
        constructor() { this.runs = []; this.total = 0; this.pending = []; this.index = 0; }
        append(data) {
            if (!data) return;
            for (const token of data.split('.')) {
                if (!token) continue;
                if (token[0] === '!') { this.pending.push(decodeEvent(token.slice(1))); continue; }
                const [mask, count] = token.split('x');
                const run = { start: this.total, count: parseInt(count, 36), mask: parseInt(mask, 36), events: this.pending };
                this.pending = [];
                this.runs.push(run);
                this.total += run.count;
            }
        }
        has(tick) { return tick < this.total; }
        at(tick) {
            if (this.runs[this.index] && tick < this.runs[this.index].start) this.index = 0;
            while (this.index < this.runs.length && tick >= this.runs[this.index].start + this.runs[this.index].count) this.index++;
            const run = this.runs[this.index];
            if (!run) return { mask: 0, events: NO_EVENTS };
            return { mask: run.mask, events: tick === run.start ? run.events : NO_EVENTS };
        }
    }

    return {
        MIN_PLAYERS, MAX_PLAYERS, TICK_RATE, TURN_TICKS_MAX, MASK, WEAPON_IDS,
        splitTeams, teamOrder, livingTeams, nextSeat,
        encodeEvent, decodeEvent, chunkTicks, StreamEncoder, StreamDecoder,
    };
});
