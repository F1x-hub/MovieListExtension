/**
 * The computer's shots in Battleship. Pure and stateless: every shot is chosen
 * from what the computer can see, the marks on the player's board and the
 * ships already sunk, so a saved game resumes with the same opponent.
 *
 * - easy («Юнга»): shoots at random and follows up a hit only now and then;
 * - normal («Капитан»): finishes a wounded ship along its line and searches the
 *   rest of the board on a checkerboard;
 * - hard («Адмирал»): counts every way the remaining ships can still lie and
 *   shoots where most of them overlap.
 *
 * Ships never touch, not even at a corner, so the cells diagonal to a hit and
 * the cells beside a known line of hits are water; normal and hard use that.
 */

export const BOT_LEVELS = Object.freeze(['easy', 'normal', 'hard']);
export const DEFAULT_BOT_LEVEL = 'normal';

const UNKNOWN = '.';
const HIT = 'x';

export function normalizeBotLevel(level) {
    return BOT_LEVELS.includes(level) ? level : DEFAULT_BOT_LEVEL;
}

function pick(cells, random) {
    return cells.length ? cells[Math.min(cells.length - 1, Math.floor(random() * cells.length))] : null;
}

function orthogonal(rules, index) {
    const { x, y } = rules.toPoint(index);
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .filter(([cx, cy]) => rules.inBounds(cx, cy))
        .map(([cx, cy]) => rules.toIndex(cx, cy));
}

/** Hits that belong to ships still afloat, grouped into orthogonally joined runs. */
function hitGroups(rules, marks) {
    const seen = new Set();
    const groups = [];
    for (let index = 0; index < marks.length; index += 1) {
        if (marks[index] !== HIT || seen.has(index)) continue;
        const group = [];
        const queue = [index];
        seen.add(index);
        while (queue.length) {
            const cell = queue.shift();
            group.push(cell);
            for (const next of orthogonal(rules, cell)) {
                if (marks[next] === HIT && !seen.has(next)) {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
        groups.push(group.sort((a, b) => a - b));
    }
    return groups;
}

/** Unknown cells that cannot hold a ship because they touch a hit at a corner or flank a line. */
function knownWater(rules, marks, groups) {
    const water = new Set();
    for (const group of groups) {
        for (const cell of group) {
            for (const near of rules.neighbors(cell, { diagonalOnly: true })) water.add(near);
        }
        if (group.length > 1) {
            const vertical = group[1] - group[0] === rules.SIZE;
            for (const cell of group) {
                const { x, y } = rules.toPoint(cell);
                const sides = vertical ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
                sides.filter(([sx, sy]) => rules.inBounds(sx, sy)).forEach(([sx, sy]) => water.add(rules.toIndex(sx, sy)));
            }
        }
    }
    return new Set([...water].filter(cell => marks[cell] === UNKNOWN));
}

/** Where a wounded ship continues: past either end of its line, or around a single hit. */
function targetCells(rules, marks, group) {
    if (group.length > 1) {
        const vertical = group[1] - group[0] === rules.SIZE;
        const first = rules.toPoint(group[0]);
        const last = rules.toPoint(group[group.length - 1]);
        const ends = vertical ? [[first.x, first.y - 1], [last.x, last.y + 1]] : [[first.x - 1, first.y], [last.x + 1, last.y]];
        return ends.filter(([x, y]) => rules.inBounds(x, y)).map(([x, y]) => rules.toIndex(x, y)).filter(cell => marks[cell] === UNKNOWN);
    }
    return orthogonal(rules, group[0]).filter(cell => marks[cell] === UNKNOWN);
}

function easyShot({ rules, marks, random }) {
    const groups = hitGroups(rules, marks);
    if (groups.length && random() < 0.3) {
        const around = targetCells(rules, marks, [pick(groups, random)[0]]);
        if (around.length) return pick(around, random);
    }
    const open = [];
    for (let index = 0; index < marks.length; index += 1) if (marks[index] === UNKNOWN) open.push(index);
    return pick(open, random);
}

function normalShot({ rules, marks, remaining, random }) {
    const groups = hitGroups(rules, marks);
    if (groups.length) {
        const next = targetCells(rules, marks, groups[0]);
        if (next.length) return pick(next, random);
    }
    const water = knownWater(rules, marks, groups);
    const open = [];
    for (let index = 0; index < marks.length; index += 1) {
        if (marks[index] === UNKNOWN && !water.has(index)) open.push(index);
    }
    // While no single-deck ship is left, every ship covers a black square.
    const smallest = Math.min(...remaining);
    if (smallest > 1) {
        const parity = Math.floor(random() * 2);
        const even = open.filter(cell => {
            const { x, y } = rules.toPoint(cell);
            return (x + y) % 2 === parity;
        });
        if (even.length) return pick(even, random);
    }
    return pick(open, random) ?? easyShot({ rules, marks, random });
}

/**
 * How many ways the ships still afloat can cover each cell. A ship may cover
 * unknown cells and hits only, and may not touch a hit outside it (that hit
 * would be another ship touching it). With hits on the board only placements
 * through a hit count, weighted by how many hits they explain.
 */
export function shotDensity({ rules, marks, remaining }) {
    const counts = new Float64Array(rules.CELL_COUNT);
    const lengths = new Map();
    remaining.forEach(length => lengths.set(length, (lengths.get(length) || 0) + 1));
    const hunting = !marks.includes(HIT);
    for (const [length, copies] of lengths) {
        for (const vertical of length > 1 ? [false, true] : [false]) {
            const xMax = vertical ? rules.SIZE - 1 : rules.SIZE - length;
            const yMax = vertical ? rules.SIZE - length : rules.SIZE - 1;
            for (let y = 0; y <= yMax; y += 1) {
                for (let x = 0; x <= xMax; x += 1) {
                    const ship = { x, y, length, vertical };
                    const cells = rules.shipCells(ship);
                    if (cells.some(cell => marks[cell] !== UNKNOWN && marks[cell] !== HIT)) continue;
                    const inside = new Set(cells);
                    if (rules.shipHalo(ship).some(cell => !inside.has(cell) && marks[cell] === HIT)) continue;
                    const hits = cells.filter(cell => marks[cell] === HIT).length;
                    if (!hunting && hits === 0) continue;
                    const weight = copies * (hunting ? 1 : 40 ** hits);
                    cells.forEach(cell => { if (marks[cell] === UNKNOWN) counts[cell] += weight; });
                }
            }
        }
    }
    return counts;
}

function hardShot({ rules, marks, remaining, random }) {
    const counts = shotDensity({ rules, marks, remaining });
    let best = 0;
    let choices = [];
    for (let index = 0; index < counts.length; index += 1) {
        if (marks[index] !== UNKNOWN) continue;
        if (counts[index] > best + 1e-9) {
            best = counts[index];
            choices = [index];
        } else if (best > 0 && Math.abs(counts[index] - best) <= 1e-9) {
            choices.push(index);
        }
    }
    return best > 0 ? pick(choices, random) : normalShot({ rules, marks, remaining, random });
}

/**
 * The computer's next shot at the player's board.
 * @param {Object} options
 * @param {Object} options.rules - BattleshipRules
 * @param {string} options.marks - the player's board as the computer knows it
 * @param {Object[]} [options.sunk] - the player's ships already sunk
 * @param {'easy'|'normal'|'hard'} [options.level]
 * @param {() => number} [options.random]
 * @returns {number|null} a cell index, or null when nothing is left to shoot
 */
export function chooseShot({ rules, marks, sunk = [], level = DEFAULT_BOT_LEVEL, random = Math.random }) {
    if (typeof marks !== 'string' || !marks.includes(UNKNOWN)) return null;
    const remaining = rules.remainingFleet(sunk);
    if (!remaining.length) return null;
    const state = { rules, marks, remaining, random };
    const shot = { easy: easyShot, normal: normalShot, hard: hardShot }[normalizeBotLevel(level)](state);
    return rules.isShootable(marks, shot) ? shot : easyShot(state);
}
