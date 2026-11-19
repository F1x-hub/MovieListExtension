// Salvo (Залп) Cloud Function: rooms, teams, the turn stream, turn order, the end, skipped turns and leaving,
// on an in-memory Firestore stand-in.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createZalpHandler, createZalpService, TURN_MS, turnId } = require('../functions/zalp');

assert.equal(
    fs.readFileSync(path.join(__dirname, '../functions/zalpRules.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../src/shared/games/zalp/ZalpRules.js'), 'utf8'),
    'functions/zalpRules.js is a byte-for-byte copy of src/shared/games/zalp/ZalpRules.js'
);

// ---------------------------------------------------------------- Firestore stand-in
function containsUndefined(value) {
    if (value === undefined) return true;
    if (Array.isArray(value)) return value.some(containsUndefined);
    if (value && typeof value === 'object') return Object.values(value).some(containsUndefined);
    return false;
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
class Snap { constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._d = data; } data() { return clone(this._d); } }
class Ref {
    constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').pop(); }
    async get() { return new Snap(this, this.db.store.get(this.path)); }
}
class FakeDb {
    constructor() { this.store = new Map(); }
    collection(name) { return { doc: (id) => new Ref(this, `${name}/${id}`) }; }
    async runTransaction(callback) {
        const writes = [];
        const tx = {
            get: async (ref) => {
                if (writes.length) throw new Error('Firestore transactions require all reads before writes');
                return new Snap(ref, this.store.get(ref.path));
            },
            set: (ref, data) => {
                if (containsUndefined(data)) throw new Error(`undefined value written to ${ref.path}`);
                writes.push([ref.path, clone(data)]);
            },
        };
        const result = await callback(tx);
        for (const [p, d] of writes) this.store.set(p, d);
        return result;
    }
    read(p) { return this.store.get(p); }
}

const db = new FakeDb();
let clock = 1_000_000;
const seq = [0.11, 0.52, 0.73, 0.94, 0.35, 0.66, 0.27, 0.88];
let si = 0;
const random = () => seq[si++ % seq.length];
const service = createZalpService({ db, now: () => clock, random });
const players = ['ann', 'bob', 'cat', 'dan', 'eve', 'fox', 'gus', 'hal', 'ivy'].map((uid) => ({ uid, name: uid.toUpperCase() }));
const [ann, bob, cat, dan, eve] = players;

async function rejects(promise, code) {
    await assert.rejects(promise, (error) => { assert.equal(error.code, code); return true; });
}
const game = (code) => db.read(`zalpGames/${code}`);
const turnDoc = (code, n) => db.read(`zalpTurns/${turnId(code, n)}`);
const snapshotFor = (n, dead = []) => ({
    n, water: 1122,
    units: Array.from({ length: n }, (_, i) => ({ x: 100 + i * 200, y: 400, hp: dead.includes(i) ? 0 : 100, dead: dead.includes(i), drowned: false, facing: 1, aim: 0.35 })),
    mines: [], crates: [], graves: [], teams: [], craters: 0,
});

(async () => {
    // ---------------------------------------------------------------- rooms
    const { gameId: code } = await service.create(ann, { visibility: 'public', theme: 'random' });
    assert.equal(game(code).status, 'waiting');
    assert.deepEqual(db.read('zalpLobby/open').games.map((e) => e.code), [code], 'a public room is listed');
    for (const p of [bob, cat, dan]) await service.join(p, { gameId: code });
    await service.join(bob, { gameId: code });
    assert.equal(game(code).seats.length, 4, 'joining twice keeps one seat');
    assert.equal(db.read('zalpLobby/open').games[0].count, 4);
    await rejects(service.start(bob, { gameId: code }), 'NOT_HOST');

    // ---------------------------------------------------------------- start: four players are two teams of two
    await service.start(ann, { gameId: code, theme: 'snow' });
    let g = game(code);
    assert.equal(g.status, 'playing');
    assert.equal(g.theme, 'snow');
    assert.ok(Number.isInteger(g.seed));
    const teams = g.seats.map((s) => s.team);
    assert.equal(teams.filter((t) => t === 0).length, 2, 'two equal teams');
    assert.equal(teams.filter((t) => t === 1).length, 2);
    assert.equal(g.turn.n, 1);
    assert.equal(turnDoc(code, 1).uid, g.seats[g.turn.seat].uid, 'turn 1 belongs to its seat');
    assert.deepEqual(turnDoc(code, 1).players, ['ann', 'bob', 'cat', 'dan'], 'turn documents carry the players for the read rule');
    assert.deepEqual(db.read('zalpLobby/open').games, [], 'a started room leaves the lobby');
    await rejects(service.join(eve, { gameId: code }), 'GAME_CLOSED');

    // ---------------------------------------------------------------- the stream
    const who = (gm) => players.find((p) => p.uid === gm.seats[gm.turn.seat].uid);
    const other = (gm) => players.find((p) => p.uid !== gm.seats[gm.turn.seat].uid && gm.players.includes(p.uid));
    await rejects(service.stream(other(g), { gameId: code, turn: 1, from: 0, data: '0x5' }), 'NOT_YOUR_TURN');
    assert.equal((await service.stream(who(g), { gameId: code, turn: 1, from: 0, data: '0x5' })).ticks, 5);
    assert.equal((await service.stream(who(g), { gameId: code, turn: 1, from: 0, data: '0x5' })).ticks, 5, 'a resent chunk is ignored');
    await rejects(service.stream(who(g), { gameId: code, turn: 1, from: 9, data: '1x2' }), 'STREAM_GAP');
    await rejects(service.stream(who(g), { gameId: code, turn: 1, from: 5, data: 'nope' }), 'INVALID_STREAM');
    await service.stream(who(g), { gameId: code, turn: 1, from: 5, data: '!w:grenade.2x3' });
    assert.equal(turnDoc(code, 1).stream, '0x5.!w:grenade.2x3');
    await rejects(service.endTurn(who(g), { gameId: code, turn: 1, from: 8, data: '0x4', snapshot: { units: [] }, craters: [] }), 'INVALID_SNAPSHOT');

    // ---------------------------------------------------------------- turns alternate teams, members rotate
    const order = [];
    for (let n = 1; n <= 4; n++) {
        g = game(code);
        order.push(g.turn.seat);
        const t = turnDoc(code, n);
        await service.endTurn(who(g), { gameId: code, turn: n, from: t.ticks, data: '0x4', snapshot: snapshotFor(4), craters: [300, 400, 50], hash: 'abc' });
        assert.equal(turnDoc(code, n).final, true);
    }
    g = game(code);
    assert.equal(g.craters.length, 12, 'craters accumulate');
    const teamOf = (seat) => g.seats[seat].team;
    assert.notEqual(teamOf(order[0]), teamOf(order[1]), 'teams alternate');
    assert.equal(teamOf(order[0]), teamOf(order[2]));
    assert.notEqual(order[0], order[2], 'a team rotates its members');
    assert.equal(new Set(order).size, 4, 'everyone played once in four turns');
    await rejects(service.endTurn(who(g), { gameId: code, turn: 3, from: 0, data: '', snapshot: snapshotFor(4), craters: [] }), 'STALE_TURN');

    // ---------------------------------------------------------------- a skipped turn, then leaving by skipping twice
    g = game(code);
    const sleeper = g.turn.seat;
    await rejects(service.timeout(other(g), { gameId: code, turn: g.turn.n }), 'TOO_EARLY');
    clock += TURN_MS + 1;
    await service.timeout(other(g), { gameId: code, turn: g.turn.n });
    let g2 = game(code);
    assert.equal(turnDoc(code, g.turn.n).skipped, true);
    assert.equal(g2.seats[sleeper].skips, 1);
    assert.equal(g2.seats[sleeper].left, false);
    // play until the sleeper's next turn and let it lapse again
    for (let guard = 0; guard < 8 && game(code).turn.seat !== sleeper; guard++) {
        const cur = game(code);
        await service.endTurn(who(cur), { gameId: code, turn: cur.turn.n, from: turnDoc(code, cur.turn.n).ticks, data: '0x2', snapshot: snapshotFor(4), craters: [] });
    }
    g = game(code);
    assert.equal(g.turn.seat, sleeper);
    clock += TURN_MS + 1;
    await service.timeout(other(g), { gameId: code, turn: g.turn.n });
    assert.equal(game(code).seats[sleeper].left, true, 'two skipped turns count as leaving');

    // ---------------------------------------------------------------- the end: the last living team wins
    g = game(code);
    const loserTeam = g.seats[sleeper].team;
    const deadSeats = g.seats.map((s, i) => (s.team === loserTeam ? i : -1)).filter((i) => i >= 0);
    await service.endTurn(who(g), { gameId: code, turn: g.turn.n, from: turnDoc(code, g.turn.n).ticks, data: '0x2', snapshot: snapshotFor(4, deadSeats), craters: [] });
    g = game(code);
    assert.equal(g.status, 'finished');
    assert.equal(g.winnerTeam, 1 - loserTeam);

    // ---------------------------------------------------------------- three players: everyone for themselves
    const { gameId: ffa } = await service.create(cat, { theme: 'meadow' });
    await service.join(dan, { gameId: ffa });
    await service.join(eve, { gameId: ffa });
    await service.start(cat, { gameId: ffa });
    assert.deepEqual(game(ffa).seats.map((s) => s.team).sort(), [0, 1, 2]);
    // leaving mid-game on your own turn passes it on
    const cur = game(ffa);
    await service.leave(who(cur), { gameId: ffa });
    assert.equal(game(ffa).seats[cur.turn.seat].left, true);
    assert.notEqual(game(ffa).turn.seat, cur.turn.seat);

    // ---------------------------------------------------------------- waiting rooms: leaving, host hand-over, full rooms
    const { gameId: room } = await service.create(ann, {});
    await service.join(bob, { gameId: room });
    await service.leave(ann, { gameId: room });
    assert.equal(game(room).host, 'bob', 'the host hands the room over');
    await service.leave(bob, { gameId: room });
    assert.equal(game(room).status, 'closed');
    const { gameId: big } = await service.create(players[0], {});
    for (const p of players.slice(1, 8)) await service.join(p, { gameId: big });
    await rejects(service.join(players[8], { gameId: big }), 'GAME_FULL');

    // ---------------------------------------------------------------- the HTTP handler
    const auth = { verifyIdToken: async (token) => { if (token !== 'good') { const e = new Error('bad'); e.code = 'auth/invalid'; throw e; } return { uid: 'ann' }; } };
    db.store.set('users/ann', { approvalStatus: 'approved', firstName: 'Аня' });
    const handler = createZalpHandler({ db, auth, now: () => clock, random });
    const call = async ({ origin = 'chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd', method = 'POST', token = 'good', body = {} } = {}) => {
        const res = { code: 0, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; } };
        const req = { method, body, get: (h) => ({ origin, authorization: token ? `Bearer ${token}` : '' })[h.toLowerCase()] };
        await handler(req, res);
        return res;
    };
    assert.equal((await call({ origin: 'https://evil.example' })).code, 403);
    assert.equal((await call({ method: 'OPTIONS' })).code, 204);
    assert.equal((await call({ token: 'bad', body: { action: 'ping' } })).code, 401);
    assert.equal((await call({ body: { action: 'nope' } })).code, 400);
    const ping = await call({ body: { action: 'ping' } });
    assert.equal(ping.code, 200); assert.equal(ping.body.ok, true); assert.equal(ping.body.serverTimeMs, clock);
    db.store.set('users/ann', { approvalStatus: 'pending' });
    assert.equal((await call({ body: { action: 'ping' } })).body.code, 'APPROVAL_REQUIRED');

    console.log('zalpFunction tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
