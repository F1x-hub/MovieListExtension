// Salvo (Залп): a recorded turn replays identically elsewhere, a game rebuilt from seed + craters + snapshot
// matches the live one, the turn stream codec, team split and turn order, and solo control (one fighter is yours).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.ZalpRules = require('../src/shared/games/zalp/ZalpRules.js');
const Rules = globalThis.ZalpRules;
const { Z } = await import('../src/shared/games/zalp/ZalpCore.js');
await import('../src/shared/games/zalp/ZalpWorld.js');
await import('../src/shared/games/zalp/ZalpEntities.js');
await import('../src/shared/games/zalp/ZalpWeapons.js');
await import('../src/shared/games/zalp/ZalpAI.js');
await import('../src/shared/games/zalp/ZalpGame.js');

// ---------------------------------------------------------------- teams and turn order
assert.deepEqual(Rules.splitTeams(2, Math.random), [0, 1], 'two players: one on one');
assert.deepEqual(Rules.splitTeams(3, Math.random), [0, 1, 2], 'three players: everyone for themselves');
assert.deepEqual(Rules.splitTeams(5, Math.random), [0, 1, 2, 3, 4], 'five players: everyone for themselves');
for (const n of [4, 6, 8]) {
    const teams = Rules.splitTeams(n, Z.rng(n));
    assert.equal(teams.filter((x) => x === 0).length, n / 2, `${n} players: two equal teams`);
    assert.equal(teams.filter((x) => x === 1).length, n / 2);
}
{
    const seats = [{ team: 0 }, { team: 1 }, { team: 0 }, { team: 1 }];
    const alive = [true, true, true, true];
    let cur = -1, last = [], order = [];
    for (let i = 0; i < 6; i++) { const r = Rules.nextSeat(seats, alive, cur, last); order.push(r.seat); cur = r.seat; last = r.lastByTeam; }
    assert.deepEqual(order, [0, 1, 2, 3, 0, 1], 'teams alternate and members rotate');
    alive[2] = false;
    seats[3].left = true;
    order = [];
    for (let i = 0; i < 4; i++) { const r = Rules.nextSeat(seats, alive, cur, last); order.push(r.seat); cur = r.seat; last = r.lastByTeam; }
    assert.deepEqual(order, [0, 1, 0, 1], 'dead and departed members are skipped; each team still gets one turn per round');
    assert.deepEqual(Rules.livingTeams(seats, alive), [0, 1]);
    alive[1] = false;
    assert.deepEqual(Rules.livingTeams(seats, alive), [0], 'one team left: the game is over');
}

// ---------------------------------------------------------------- stream codec
{
    const enc = new Rules.StreamEncoder();
    enc.push(0, []); enc.push(0, []); enc.push(2, [{ t: 'w', id: 'grenade' }]); enc.push(2, []);
    const first = enc.drain();
    enc.push(2, []); enc.push(16, [{ t: 'f', n: 4 }, { t: 'c', x: 123.4, y: -5.6 }]);
    const second = enc.drain();
    assert.equal(first.from, 0); assert.equal(first.ticks, 4); assert.equal(second.from, 4); assert.equal(second.ticks, 2);
    assert.equal(Rules.chunkTicks(first.data), 4); assert.equal(Rules.chunkTicks(second.data), 2);
    const dec = new Rules.StreamDecoder();
    dec.append(first.data); dec.append(second.data);
    assert.equal(dec.total, 6);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => dec.at(i).mask), [0, 0, 2, 2, 2, 16]);
    assert.deepEqual(dec.at(2).events, [{ t: 'w', id: 'grenade' }]);
    assert.deepEqual(dec.at(5).events, [{ t: 'f', n: 4 }, { t: 'c', x: 123.4, y: -5.6 }]);
    assert.equal(Rules.chunkTicks('0x5.!w:nuke'), -1, 'unknown weapons are refused');
    assert.equal(Rules.chunkTicks('zz9x1'), -1, 'malformed runs are refused');
}

// ---------------------------------------------------------------- one turn, two computers
const seats = [{ name: 'Аня', team: 0 }, { name: 'Борис', team: 1 }];
const opts = (mySeat) => ({ mode: 'online', seed: 424242, theme: 'meadow', seats, mySeat, headless: true });
const A = new Z.Game(opts(0)), B = new Z.Game(opts(1));
assert.equal(A.stateHash(), B.stateHash(), 'both computers start from the same map and spawn');

const run = (g, ticks, keys = []) => {
    keys.forEach((k) => Z.input.press(k));
    for (let i = 0; i < ticks && g.state !== 'done'; i++) g.tick();
    keys.forEach((k) => Z.input.release(k));
};
A.startOnlineTurn(1, 0);
assert.equal(A.control.kind, 'local', 'seat 0 plays on computer A');
const shooter = A.units[0], target = A.units[1];
shooter.facing = target.x > shooter.x ? 1 : -1;
run(A, 60, [shooter.facing > 0 ? 'ArrowRight' : 'ArrowLeft']);
run(A, 30, ['ArrowUp']);
run(A, 70, ['Space']);
for (let i = 0; i < 120 * 60 && A.state !== 'done'; i++) A.tick();
assert.equal(A.state, 'done', 'the turn ends after the shot settles');
const turn = A.control === null ? null : A.control;
assert.equal(turn, null);
assert.ok(A.craters.length >= 3, 'the rocket left a crater');

B.startOnlineTurn(1, 0);
assert.equal(B.control.kind, 'replay', 'computer B replays seat 0');
const encoder = A.lastEncoder;
assert.ok(encoder, 'the finished turn keeps its recording');
const chunk = encoder.drain();
B.control.feed(chunk.data, true);
for (let i = 0; i < 120 * 70 && B.state !== 'done'; i++) if (!B.tick()) break;
assert.equal(B.state, 'done', 'the replay reaches the end of the turn too');
assert.equal(B.turnTicks, A.turnTicks, 'in the same number of ticks');
assert.deepEqual(B.craters, A.craters, 'with the same craters');
assert.ok(Buffer.from(B.world.data).equals(Buffer.from(A.world.data)), 'and the same terrain, byte for byte');
assert.equal(B.stateHash(), A.stateHash(), 'and the same fighters, mines, crates and teams');

// ---------------------------------------------------------------- rebuild from seed + craters + snapshot
const snap = A.snapshot();
const R = Z.Game.restore(opts(1), A.craters, snap);
assert.equal(R.stateHash(), A.stateHash(), 'a rebuilt game matches the live one');
assert.ok(Buffer.from(R.world.data).equals(Buffer.from(A.world.data)), 'terrain included');
A.applySnapshot(snap); B.applySnapshot(snap);
A.startOnlineTurn(2, 1); B.startOnlineTurn(2, 1); R.startOnlineTurn(2, 1);
assert.equal(A.control.kind, 'replay'); assert.equal(B.control.kind, 'local'); assert.equal(R.control.kind, 'local');
assert.equal(A.wind, B.wind, 'every computer draws the same wind for a turn');

// ---------------------------------------------------------------- solo: one fighter is yours, the rest are bots
const solo = new Z.Game({ mode: 'solo', diff: 1, count: 2, teams: 2, theme: 'desert', headless: true });
assert.equal(solo.mine, solo.teams[0].units[0], 'you play the first fighter of the first team');
const kinds = new Map();
for (let i = 0; i < 120 * 400 && kinds.size < 4 && solo.state !== 'over'; i++) {
    solo.tick();
    if (solo.active && solo.state === 'aim') kinds.set(solo.active, solo.control.kind);
}
for (const [u, kind] of kinds) assert.equal(kind, u === solo.mine ? 'local' : 'ai', `${u.name}: ${kind}`);
assert.ok(kinds.size >= 3, 'several fighters had turns');

console.log('zalpReplay tests passed');
