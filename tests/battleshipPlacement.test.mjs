import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Rules = require('../src/shared/games/battleship/BattleshipRules.js');
const { BattleshipPlacement } = await import('../src/shared/games/battleship/BattleshipPlacement.js');
const {
    BattleshipService,
    BattleshipError,
    normalizeGameCode,
    profileDisplayName
} = await import('../src/shared/services/BattleshipService.js');

// --- Placement --------------------------------------------------------------------
const placement = new BattleshipPlacement({ rules: Rules });
assert.equal(placement.isComplete(), false);
assert.equal(placement.selected.length, 4, 'the largest ship is in hand first');

let preview = placement.previewAt(Rules.toIndex(8, 0));
assert.equal(preview.valid, true);
assert.deepEqual(preview.ship, { x: 6, y: 0, length: 4, vertical: false }, 'a ship near the edge is pushed back onto the board');
assert.equal(placement.placeAt(Rules.toIndex(0, 0)), true);
assert.equal(placement.selected.length, 3, 'placing a ship takes the next one');

preview = placement.previewAt(Rules.toIndex(0, 1));
assert.equal(preview.valid, false, 'a ship may not touch another');
assert.equal(placement.placeAt(Rules.toIndex(0, 1)), false);
assert.equal(placement.rotate(), true);
preview = placement.previewAt(Rules.toIndex(9, 9));
assert.deepEqual(preview.ship, { x: 9, y: 7, length: 3, vertical: true });
assert.equal(placement.placeAt(Rules.toIndex(9, 9)), true);

// Turning a placed ship in place, or shifted back onto the board.
assert.equal(placement.rotateAt(Rules.toIndex(9, 8)), true);
assert.deepEqual(placement.slotAt(Rules.toIndex(9, 7)).ship, { x: 7, y: 7, length: 3, vertical: false },
    'a ship turns about its top deck, and a turn that would leave the board slides back onto it');
assert.equal(placement.slotAt(Rules.toIndex(9, 9)), null);
assert.equal(placement.rotateAt(Rules.toIndex(1, 0)), true, 'the 4-deck turns down from its anchor');
assert.deepEqual(placement.slotAt(Rules.toIndex(0, 0)).ship, { x: 0, y: 0, length: 4, vertical: true });
assert.equal(placement.rotateAt(Rules.toIndex(5, 5)), false, 'an empty cell has nothing to turn');

// Lifting a ship keeps the deck that was grabbed under the pointer.
const grabbed = placement.liftAt(Rules.toIndex(0, 2));
assert.equal(grabbed, 2);
assert.equal(placement.slotAt(Rules.toIndex(0, 0)), null, 'a lifted ship leaves the board');
assert.equal(placement.selected.length, 4);
preview = placement.previewAt(Rules.toIndex(4, 6), grabbed);
assert.deepEqual(preview.ship, { x: 4, y: 4, length: 4, vertical: true }, 'the grabbed deck lands on the target cell');
assert.equal(placement.placeAt(Rules.toIndex(4, 6), grabbed), true);
assert.ok(placement.slotAt(Rules.toIndex(4, 4)));

// A drop on a bad cell returns the ship where it was.
placement.liftAt(Rules.toIndex(4, 4));
assert.equal(placement.placeAt(Rules.toIndex(7, 9), 0), false);
assert.equal(placement.dropLifted(), true);
assert.deepEqual(placement.slotAt(Rules.toIndex(4, 4)).ship, { x: 4, y: 4, length: 4, vertical: true });

// Removing sends a ship back to the dock and puts it in hand.
assert.equal(placement.removeAt(Rules.toIndex(4, 5)), true);
assert.equal(placement.selected.length, 4);
assert.equal(placement.select(placement.slots.find(slot => slot.length === 1).id), true);
assert.equal(placement.select(placement.slots.find(slot => slot.ship).id), false, 'a placed ship is not picked from the dock');

placement.randomize(() => 0.42);
assert.equal(placement.isComplete(), true);
assert.equal(placement.selectedId, null);
assert.equal(Rules.validateFleet(placement.toFleet()).ok, true, 'a random placement is a legal fleet');
assert.equal(placement.previewAt(0), null, 'nothing is in hand once the fleet is complete');
placement.clear();
assert.equal(placement.placedShips.length, 0);
assert.equal(placement.selected.length, 4);

// Placing ship after ship with the random fleet's anchors also completes it.
const target = Rules.randomFleet(() => 0.73);
const byLength = new Map();
for (const ship of target) {
    if (!byLength.has(ship.length)) byLength.set(ship.length, []);
    byLength.get(ship.length).push(ship);
}
while (!placement.isComplete()) {
    const ship = byLength.get(placement.selected.length).shift();
    placement.vertical = ship.vertical;
    assert.equal(placement.placeAt(Rules.toIndex(ship.x, ship.y)), true);
}
assert.deepEqual(Rules.validateFleet(placement.toFleet()).ships, Rules.validateFleet(target).ships);

// --- Client service helpers -----------------------------------------------------------
assert.equal(normalizeGameCode(' k7q-2mx '), 'K7Q2MX');
assert.equal(normalizeGameCode('K7Q 2MX'), 'K7Q2MX');
assert.equal(normalizeGameCode('chrome-extension://abc/src/pages/battleship/battleship.html?game=K7Q2MX'), 'K7Q2MX');
assert.equal(normalizeGameCode('K7Q2M0'), null, 'zero and O are not in the code alphabet');
assert.equal(normalizeGameCode('K7Q2'), null);
assert.equal(profileDisplayName({ displayNameFormat: 'username', username: 'nick', firstName: 'Имя' }), 'nick');
assert.equal(profileDisplayName({ firstName: 'Имя', lastName: 'Фамилия' }), 'Имя Фамилия');
assert.equal(profileDisplayName({ displayName: 'Display' }), 'Display');

const calls = [];
let clock = 10_000;
const service = new BattleshipService({
    firebaseManager: { auth: { currentUser: { uid: 'u1', getIdToken: async () => 'token-1' } } },
    now: () => clock,
    fetchImpl: async (url, init) => {
        calls.push({ url, init: { ...init, body: JSON.parse(init.body) } });
        clock += 100;
        if (init.body.includes('"fire"')) {
            return { ok: false, status: 409, json: async () => ({ ok: false, code: 'NOT_YOUR_TURN', error: 'It is not your turn', serverTimeMs: 50_000 }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, gameId: 'K7Q2MX', serverTimeMs: 50_000 }) };
    }
});
const created = await service.create({ visibility: 'public' });
assert.equal(created.gameId, 'K7Q2MX');
assert.equal(calls[0].init.headers.Authorization, 'Bearer token-1');
assert.deepEqual(calls[0].init.body, { visibility: 'public', action: 'create' });
assert.equal(service.serverNow(), clock + (50_000 - 10_050), 'the clock offset comes from the round-trip midpoint');
await service.place('K7Q2MX', [{ x: 1, y: 2, length: 3, vertical: 1, extra: 'dropped' }]);
assert.deepEqual(calls[1].init.body.ships, [{ x: 1, y: 2, length: 3, vertical: true }], 'only ship fields are sent');
await assert.rejects(service.fire('K7Q2MX', 5, 0), error => error instanceof BattleshipError
    && error.code === 'NOT_YOUR_TURN' && error.status === 409);
assert.deepEqual(calls[2].init.body, { gameId: 'K7Q2MX', index: 5, expectedMove: 0, action: 'fire' });

const offline = new BattleshipService({
    firebaseManager: { auth: { currentUser: { uid: 'u1', getIdToken: async () => 'token' } } },
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); }
});
await assert.rejects(offline.ping(), error => error.code === 'NETWORK');
const signedOut = new BattleshipService({ firebaseManager: { auth: { currentUser: null }, getCurrentUser: () => ({ uid: 'storage-copy' }) } });
await assert.rejects(signedOut.ping(), error => error.code === 'AUTH_REQUIRED', 'a session copy without a token cannot call the server');

console.log('✅ Battleship placement and client tests passed');
