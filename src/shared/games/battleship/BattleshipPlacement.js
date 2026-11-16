/**
 * Fleet placement before a Battleship game: which ships are on the board, which
 * one is in hand and where it would land. DOM-free, so the page and the tests
 * share it; the rules come from BattleshipRules (passed in, or the global).
 *
 * Each of the ten fleet slots keeps its length; `slot.ship` is its position on the
 * board or null while it waits in the dock. A ship "in hand" is the selected slot:
 * a waiting one, or a placed one picked up to move (its old position is kept, so
 * a drop on a bad cell puts it back).
 */
export class BattleshipPlacement {
    constructor({ rules = globalThis.BattleshipRules } = {}) {
        if (!rules) throw new Error('BattleshipRules is not loaded');
        this.rules = rules;
        this.slots = rules.FLEET.map((length, id) => ({ id, length, ship: null }));
        this.selectedId = 0;
        this.vertical = false;
        this.lifted = null;
    }

    get placedShips() {
        return this.slots.filter(slot => slot.ship).map(slot => slot.ship);
    }

    get selected() {
        return this.slots.find(slot => slot.id === this.selectedId) || null;
    }

    isComplete() {
        return this.slots.every(slot => slot.ship);
    }

    /** The fleet in the shape the server expects. */
    toFleet() {
        return this.slots.filter(slot => slot.ship).map(slot => ({ ...slot.ship }));
    }

    slotAt(index) {
        return this.slots.find(slot => slot.ship && this.rules.shipCells(slot.ship).includes(index)) || null;
    }

    /** The next waiting ship, largest first, or null when the fleet is complete. */
    nextWaitingId() {
        return this.slots.find(slot => !slot.ship)?.id ?? null;
    }

    select(id) {
        const slot = this.slots.find(candidate => candidate.id === id);
        if (!slot || slot.ship) return false;
        this.dropLifted();
        this.selectedId = id;
        return true;
    }

    rotate() {
        this.vertical = !this.vertical;
        return this.vertical;
    }

    /**
     * Where the ship in hand would land with the grabbed deck on `index`. The ship
     * is pushed back inside the board near an edge rather than refused.
     */
    previewAt(index, grabOffset = 0) {
        const slot = this.selected;
        if (!slot || slot.ship || !this.rules.isIndex(index)) return null;
        const { x, y } = this.rules.toPoint(index);
        const span = this.rules.SIZE - slot.length;
        const offset = Math.max(0, Math.min(slot.length - 1, Number(grabOffset) || 0));
        const ship = this.rules.normalizeShip({
            x: this.vertical ? x : Math.max(0, Math.min(span, x - offset)),
            y: this.vertical ? Math.max(0, Math.min(span, y - offset)) : y,
            length: slot.length,
            vertical: this.vertical
        });
        if (!ship) return null;
        const others = this.slots.filter(other => other.id !== slot.id && other.ship).map(other => other.ship);
        return { ship, cells: this.rules.shipCells(ship), valid: this.rules.canPlace(others, ship) };
    }

    /** Puts the ship in hand down; selects the next waiting ship. */
    placeAt(index, grabOffset = 0) {
        const preview = this.previewAt(index, grabOffset);
        if (!preview || !preview.valid) return false;
        this.selected.ship = preview.ship;
        this.lifted = null;
        this.selectedId = this.nextWaitingId();
        return true;
    }

    /**
     * Picks up the placed ship covering `index`, keeping its orientation.
     * @returns {number|null} the grabbed deck (0 = top/left), or null
     */
    liftAt(index) {
        const slot = this.slotAt(index);
        if (!slot) return null;
        this.dropLifted();
        const cells = this.rules.shipCells(slot.ship);
        this.lifted = { id: slot.id, ship: slot.ship };
        this.vertical = slot.ship.vertical;
        this.selectedId = slot.id;
        slot.ship = null;
        return Math.max(0, cells.indexOf(index));
    }

    /** Returns a lifted ship to where it was (a drop off the board or on a bad cell). */
    dropLifted() {
        if (!this.lifted) return false;
        const slot = this.slots.find(candidate => candidate.id === this.lifted.id);
        if (slot && !slot.ship) slot.ship = this.lifted.ship;
        this.lifted = null;
        this.selectedId = this.nextWaitingId();
        return true;
    }

    /** Turns a placed ship in place, or shifted back onto the board; false when no turn fits. */
    rotateAt(index) {
        const slot = this.slotAt(index);
        if (!slot || slot.length === 1) return false;
        const others = this.slots.filter(other => other.id !== slot.id && other.ship).map(other => other.ship);
        const { x, y } = slot.ship;
        const vertical = !slot.ship.vertical;
        const span = this.rules.SIZE - slot.length;
        const candidates = [];
        for (let shift = 0; shift < slot.length; shift += 1) {
            candidates.push(vertical
                ? { x, y: Math.max(0, Math.min(span, y - shift)) }
                : { x: Math.max(0, Math.min(span, x - shift)), y });
        }
        for (const anchor of candidates) {
            const ship = this.rules.normalizeShip({ ...anchor, length: slot.length, vertical });
            if (ship && this.rules.canPlace(others, ship)) {
                slot.ship = ship;
                return true;
            }
        }
        return false;
    }

    /** Sends the ship covering `index` back to the dock and puts it in hand. */
    removeAt(index) {
        const slot = this.slotAt(index);
        if (!slot) return false;
        this.dropLifted();
        slot.ship = null;
        this.selectedId = slot.id;
        this.vertical = false;
        return true;
    }

    randomize(random = Math.random) {
        const fleet = this.rules.randomFleet(random);
        const byLength = new Map();
        for (const ship of fleet) {
            if (!byLength.has(ship.length)) byLength.set(ship.length, []);
            byLength.get(ship.length).push(ship);
        }
        for (const slot of this.slots) slot.ship = byLength.get(slot.length).shift();
        this.lifted = null;
        this.selectedId = null;
    }

    clear() {
        for (const slot of this.slots) slot.ship = null;
        this.lifted = null;
        this.selectedId = 0;
        this.vertical = false;
    }
}
