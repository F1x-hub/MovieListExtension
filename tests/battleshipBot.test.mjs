import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Rules = require('../src/shared/games/battleship/BattleshipRules.js');
const { BOT_LEVELS, chooseShot, normalizeBotLevel, shotDensity } = await import('../src/shared/games/battleship/BattleshipBot.js');
const { BattleshipLocalGame, BOT_STORAGE_KEY, BOT_UID, PLAYER_UID } = await import('../src/shared/games/battleship/BattleshipLocalGame.js');

function seeded(seed) {
    let state = seed;
    return () => ((state = (state * 16807) % 2147483647) / 2147483647);
}

/** The computer shoots a whole fleet down; returns the number of shots. */
function playOut(level, random) {
    const fleet = Rules.randomFleet(random);
    let marks = Rules.emptyMarks();
    const sunk = [];
    for (let shots = 1; shots <= 100; shots += 1) {
        const index = chooseShot({ rules: Rules, marks, sunk, level, random });
        assert.ok(Rules.isShootable(marks, index), `${level}: shot ${shots} goes into unknown water`);
        const shot = Rules.resolveShot(fleet, marks, index);
        marks = shot.marks;
        if (shot.ship) sunk.push(shot.ship);
        if (shot.allSunk) return shots;
    }
    throw new Error(`${level}: the fleet survived 100 shots`);
}

// --- Levels --------------------------------------------------------------------------
assert.deepEqual(BOT_LEVELS, ['easy', 'normal', 'hard']);
assert.equal(normalizeBotLevel('hard'), 'hard');
assert.equal(normalizeBotLevel('god'), 'normal', 'an unknown level is the default');

const averages = {};
for (const level of BOT_LEVELS) {
    const random = seeded(7 + level.length);
    let total = 0;
    const games = 40;
    for (let game = 0; game < games; game += 1) total += playOut(level, random);
    averages[level] = total / games;
}
assert.ok(averages.hard < averages.normal, `the admiral (${averages.hard}) beats the captain (${averages.normal})`);
assert.ok(averages.normal < averages.easy, `the captain (${averages.normal}) beats the cabin boy (${averages.easy})`);
assert.ok(averages.hard < 58, `the admiral needs fewer than 58 shots on average (${averages.hard})`);
assert.ok(averages.easy > 58, `the cabin boy stays beatable (${averages.easy})`);

// --- Finishing a wounded ship -------------------------------------------------------
const lone = Rules.resolveShot([{ x: 4, y: 4, length: 3, vertical: false }], Rules.emptyMarks(), Rules.toIndex(5, 4)).marks;
const around = new Set([Rules.toIndex(4, 4), Rules.toIndex(6, 4), Rules.toIndex(5, 3), Rules.toIndex(5, 5)]);
for (const level of ['normal', 'hard']) {
    for (let seed = 1; seed <= 20; seed += 1) {
        const shot = chooseShot({ rules: Rules, marks: lone, level, random: seeded(seed) });
        assert.ok(around.has(shot), `${level}: after a single hit the next shot is beside it (got ${shot})`);
    }
}
const line = Rules.resolveShot([{ x: 4, y: 4, length: 3, vertical: false }], lone, Rules.toIndex(6, 4)).marks;
const ends = new Set([Rules.toIndex(4, 4), Rules.toIndex(7, 4)]);
for (const level of ['normal', 'hard']) {
    for (let seed = 1; seed <= 20; seed += 1) {
        const shot = chooseShot({ rules: Rules, marks: line, level, random: seeded(seed) });
        assert.ok(ends.has(shot), `${level}: two hits in a row are followed along the line (got ${shot})`);
    }
}
const density = shotDensity({ rules: Rules, marks: line, remaining: Rules.remainingFleet([]) });
assert.equal(density[Rules.toIndex(5, 3)], 0, 'no ship can lie across a known line');
assert.ok(density[Rules.toIndex(7, 4)] > 0 && density[Rules.toIndex(4, 4)] > 0);

// Nothing left to shoot.
assert.equal(chooseShot({ rules: Rules, marks: 'o'.repeat(100), level: 'hard' }), null);

// --- A game against the computer --------------------------------------------------------
function memoryStorage() {
    const data = new Map();
    return {
        data,
        async get(key) { return data.has(key) ? JSON.parse(data.get(key)) : null; },
        async set(key, value) { data.set(key, JSON.stringify(value)); }
    };
}

function fakeTimers() {
    let queue = [];
    let id = 0;
    return {
        setTimer(fn) {
            id += 1;
            queue.push({ id, fn });
            return id;
        },
        clearTimer(handle) {
            queue = queue.filter(entry => entry.id !== handle);
        },
        /** Runs every pending timer, and the ones they start, in order. */
        run(limit = 500) {
            for (let step = 0; step < limit && queue.length; step += 1) queue.shift().fn();
        },
        get pending() {
            return queue.length;
        }
    };
}

const storage = memoryStorage();
const timers = fakeTimers();
const options = { rules: Rules, storage, random: seeded(3), now: () => 1_700_000_000_000, setTimer: timers.setTimer, clearTimer: timers.clearTimer };
const local = await new BattleshipLocalGame(options).load();
assert.equal(local.game, null, 'nothing is saved yet');
local.setLevel('hard');
const { gameId } = local.start({ playerName: 'Алиса', botName: 'Компьютер' });
assert.equal(local.game.status, 'placing');
assert.equal(local.game.ready[BOT_UID], true, 'the computer has placed its fleet');
assert.equal(local.game.level, 'hard');

const snapshots = [];
const stopGame = local.subscribeGame(gameId, game => snapshots.push(game));
let fleetSeen = null;
const stopFleet = local.subscribeFleet(gameId, PLAYER_UID, fleet => { fleetSeen = fleet; });
await Promise.resolve();
assert.equal(snapshots.at(-1).status, 'placing', 'a screen gets the game at once');
assert.equal(fleetSeen, null, 'no fleet of the player yet');

await assert.rejects(local.place(gameId, [{ x: 0, y: 0, length: 4, vertical: false }]), error => error.code === 'INVALID_FLEET');
const playerFleet = Rules.randomFleet(seeded(11));
await local.place(gameId, playerFleet);
assert.equal(local.game.status, 'playing');
assert.ok(fleetSeen?.ships?.length === 10, 'the placed fleet reaches the screen');

// Play it out: the player shoots only at the computer's ships, so every shot of
// the player hits and keeps the turn; the computer shoots whenever it has it.
const botCells = local.fleets[BOT_UID].flatMap(ship => Rules.shipCells(ship));
let guard = 0;
while (local.game.status === 'playing' && guard < 400) {
    guard += 1;
    if (local.game.turnUid === BOT_UID) {
        assert.ok(timers.pending > 0, 'the computer has its shot scheduled');
        timers.run(1);
        continue;
    }
    const target = botCells.find(index => local.game.boards[BOT_UID][index] === '.');
    const move = local.game.moveCount;
    const firing = local.fire(gameId, target, move);
    timers.run(1);
    const result = await firing;
    assert.notEqual(result.result, 'miss');
    assert.equal(result.moveCount, move + 1);
}
assert.equal(local.game.status, 'finished');
assert.equal(local.game.winnerUid, PLAYER_UID, 'the player wins without a miss');
assert.equal(local.game.endReason, 'all_sunk');
assert.equal(local.stats.hard.wins, 1);
assert.ok(local.game.revealed[BOT_UID].length === 10, 'both fleets are revealed at the end');
assert.equal(snapshots.at(-1).status, 'finished', 'the screen saw the end');
await assert.rejects(local.fire(gameId, 0, local.game.moveCount), error => error.code === 'GAME_NOT_ACTIVE');

// A reload brings back the record and the finished game.
await local.saving;
const reloaded = await new BattleshipLocalGame(options).load();
assert.equal(reloaded.level, 'hard');
assert.equal(reloaded.stats.hard.wins, 1);
assert.equal(reloaded.gameId, gameId);
assert.equal(reloaded.unfinished, null, 'a finished game is not offered to continue');

// «Ещё партия» starts over at the same level; the old screen hears nothing more.
const before = snapshots.length;
const { gameId: nextId } = await local.rematch(gameId);
assert.notEqual(nextId, gameId);
assert.equal(local.game.level, 'hard');
assert.equal(snapshots.length, before, 'the finished game’s screen is not told about the new one');
stopGame();
stopFleet();

// Resigning in battle is a loss; leaving while placing is not counted.
const watcher = local.subscribeGame(nextId, () => {});
await local.place(nextId, playerFleet);
if (local.game.turnUid === BOT_UID) timers.run(1);
await local.resign(nextId);
assert.equal(local.game.status, 'finished');
assert.equal(local.game.winnerUid, BOT_UID);
assert.equal(local.stats.hard.losses, 1);
watcher();
const third = local.start({ level: 'easy' }).gameId;
await local.resign(third);
assert.equal(local.game.status, 'cancelled');
assert.equal(local.stats.easy.wins + local.stats.easy.losses, 0, 'a game left before the battle does not count');

// The computer pauses while no screen is open and resumes when one is.
const paused = local.start({ level: 'normal' }).gameId;
const screen = local.subscribeGame(paused, () => {});
await local.place(paused, playerFleet);
if (local.game.turnUid !== BOT_UID) {
    local.game.turnUid = BOT_UID;
    local.wakeBot();
}
screen();
assert.equal(timers.pending, 0, 'closing the screen stops the computer');
const reopen = local.subscribeGame(paused, () => {});
assert.equal(timers.pending, 1, 'opening it again lets the computer shoot');
reopen();

// A broken save starts over.
storage.data.set(BOT_STORAGE_KEY, JSON.stringify({ version: 1, level: 'hard', game: { id: 'bot-x', boards: {} }, fleets: {} }));
const broken = await new BattleshipLocalGame(options).load();
assert.equal(broken.game, null);
assert.equal(broken.level, 'hard', 'the level survives a broken game');

console.log(`✅ Battleship computer tests passed (average shots: easy ${averages.easy}, normal ${averages.normal}, hard ${averages.hard})`);
