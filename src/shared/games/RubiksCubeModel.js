/**
 * N×N×N Rubik's Cube state as stickers on cubie positions.
 *
 * Coordinates are doubled so even and odd cubes share integer math: on an N-cube
 * each axis runs over -(N-1), -(N-3), …, N-1 in steps of 2. Every sticker keeps
 * its cubie position and the outward normal it currently faces, so any layer turn
 * is a rotation of those two vectors. Moves follow standard (SiGN) notation:
 * outer faces (U R F D L B), inner layers ("2R"), wide turns ("Rw", "3Rw",
 * lowercase "r"), middle slices on odd cubes (M E S), and cube rotations (x y z).
 */

export const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
export const OUTER_FACES = FACE_ORDER;
export const SLICE_MOVES = ['M', 'E', 'S'];
export const ROTATION_MOVES = ['x', 'y', 'z'];
export const CUBE_SIZES = [2, 3, 4, 5, 6, 7];

export const FACE_DEFINITIONS = Object.freeze({
    U: { normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1], color: 'white' },
    R: { normal: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0], color: 'red' },
    F: { normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0], color: 'green' },
    D: { normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1], color: 'yellow' },
    L: { normal: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0], color: 'orange' },
    B: { normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0], color: 'blue' }
});

// Middle slices turn like the face named in the comment.
const SLICE_AXES = { M: [-1, 0, 0] /* L */, E: [0, -1, 0] /* D */, S: [0, 0, 1] /* F */ };
const ROTATION_AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXIS_FACES = [['R', 'L'], ['U', 'D'], ['F', 'B']];
const SUFFIX = "(2'|'2|2|')?";

export function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

/** Quarter turn of an integer vector; direction +1 is a right-hand +90°. */
function rotateVector(vector, axis, direction) {
    const along = dot(axis, vector);
    const perpendicular = cross(axis, vector);
    return [0, 1, 2].map(index => Math.round(axis[index] * along + direction * perpendicular[index]));
}

function mod4(value) {
    return ((Math.round(value) % 4) + 4) % 4;
}

/** Doubled coordinate of layer `depth` (1 = the face itself) seen from a face. */
function layerCoordinate(size, depth) {
    return size - 1 - 2 * (depth - 1);
}

export function stickerPosition(face, row, col, size = 3) {
    const { normal, right, down } = FACE_DEFINITIONS[face];
    const max = size - 1;
    return [0, 1, 2].map(index => normal[index] * max
        + right[index] * (2 * col - max)
        + down[index] * (2 * row - max));
}

function withSuffix(base, quarterTurns, direction) {
    if (quarterTurns === 2) return `${base}2`;
    return direction === 1 ? `${base}'` : base;
}

/**
 * Parses one move token for a cube of `size`. Returns null for anything that is
 * not a valid move on that cube. `direction` is the right-hand quarter-turn sign
 * about `axis` (-1 = clockwise seen from that side).
 */
export function parseMove(move, size = 3) {
    const text = String(move || '').trim().replace(/[’`´]/g, "'");
    let match;
    let base;
    let axis;
    let layers;
    let rotation = false;
    let suffix;
    if ((match = text.match(new RegExp(`^(\\d*)([URFDLB])(w?)${SUFFIX}$`)))) {
        const [, digits, face, wide] = match;
        suffix = match[4];
        const depth = digits ? Number(digits) : wide ? 2 : 1;
        if (depth < 1 || depth >= size || (digits && !wide && depth === 1) || (wide && depth < 2)) return null;
        axis = FACE_DEFINITIONS[face].normal;
        if (wide) {
            layers = Array.from({ length: depth }, (_, index) => layerCoordinate(size, index + 1));
            base = depth === 2 ? `${face}w` : `${depth}${face}w`;
        } else {
            layers = [layerCoordinate(size, depth)];
            base = depth === 1 ? face : `${depth}${face}`;
        }
    } else if ((match = text.match(new RegExp(`^([urfdlb])${SUFFIX}$`)))) {
        return parseMove(`${match[1].toUpperCase()}w${match[2] || ''}`, size);
    } else if ((match = text.match(new RegExp(`^([MES])${SUFFIX}$`)))) {
        if (size % 2 === 0) return null;
        base = match[1];
        axis = SLICE_AXES[base];
        layers = [0];
        suffix = match[2];
    } else if ((match = text.match(new RegExp(`^([xyzXYZ])${SUFFIX}$`)))) {
        base = match[1].toLowerCase();
        axis = ROTATION_AXES[base];
        layers = Array.from({ length: size }, (_, index) => 2 * index - (size - 1));
        rotation = true;
        suffix = match[2];
    } else {
        return null;
    }
    suffix = suffix || '';
    const quarterTurns = suffix.includes('2') ? 2 : 1;
    const direction = suffix === "'" ? 1 : -1;
    return {
        token: base,
        face: base,
        axis,
        layers,
        rotation,
        quarterTurns,
        direction,
        notation: withSuffix(base, quarterTurns, direction)
    };
}

export function invertMove(move, size = 3) {
    const parsed = parseMove(move, size);
    if (!parsed) return null;
    return withSuffix(parsed.token, parsed.quarterTurns, parsed.quarterTurns === 2 ? -1 : -parsed.direction);
}

/**
 * Turns a physical layer rotation into notation: `axis` is a unit grid axis
 * (possibly negative), `layer` the doubled coordinate `dot(position, axis)` of
 * the slice, and `quarterTurns` the signed right-hand quarter turns about `axis`.
 * Returns null for a zero turn.
 */
export function moveFromLayerTurn(axis, layer, quarterTurns, size = 3) {
    if (mod4(quarterTurns) === 0) return null;
    const axisIndex = axis.findIndex(value => value !== 0);
    const axisSign = axis[axisIndex];
    const coordinate = layer * axisSign;
    const positiveTurns = quarterTurns * axisSign;
    const max = size - 1;
    let base;
    let sign;
    if (coordinate === 0) {
        base = SLICE_MOVES[axisIndex];
        sign = SLICE_AXES[base][axisIndex];
    } else {
        sign = coordinate > 0 ? 1 : -1;
        const face = AXIS_FACES[axisIndex][coordinate > 0 ? 0 : 1];
        const depth = (max - Math.abs(coordinate)) / 2 + 1;
        base = depth === 1 ? face : `${depth}${face}`;
    }
    // Right-hand turns about the move's own axis; -1 (= 3) is the plain turn.
    const own = mod4(positiveTurns * sign);
    return withSuffix(base, own === 2 ? 2 : 1, own === 1 ? 1 : -1);
}

export class RubiksCubeState {
    constructor(size = 3) {
        this.size = size;
        this.reset();
    }

    reset() {
        this.stickers = [];
        FACE_ORDER.forEach(face => {
            const definition = FACE_DEFINITIONS[face];
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    this.stickers.push({
                        color: definition.color,
                        normal: [...definition.normal],
                        position: stickerPosition(face, row, col, this.size)
                    });
                }
            }
        });
        this.index = null;
        return this;
    }

    clone() {
        const copy = Object.create(RubiksCubeState.prototype);
        copy.size = this.size;
        copy.index = null;
        copy.stickers = this.stickers.map(sticker => ({
            color: sticker.color,
            normal: [...sticker.normal],
            position: [...sticker.position]
        }));
        return copy;
    }

    applyMove(move) {
        const parsed = typeof move === 'string' ? parseMove(move, this.size) : move;
        if (!parsed) return false;
        for (let turn = 0; turn < parsed.quarterTurns; turn++) {
            this.stickers.forEach(sticker => {
                if (!parsed.layers.includes(dot(sticker.position, parsed.axis))) return;
                sticker.position = rotateVector(sticker.position, parsed.axis, parsed.direction);
                sticker.normal = rotateVector(sticker.normal, parsed.axis, parsed.direction);
            });
        }
        this.index = null;
        return true;
    }

    applyAlgorithm(algorithm) {
        const moves = tokenizeAlgorithm(algorithm, this.size);
        if (!moves) return false;
        moves.forEach(move => this.applyMove(move));
        return true;
    }

    /** Colour of the sticker at a cubie position facing `normal`, if any. */
    colorAt(position, normal) {
        if (!this.index) {
            this.index = new Map(this.stickers.map(sticker => [
                `${sticker.position.join()}|${sticker.normal.join()}`, sticker.color
            ]));
        }
        return this.index.get(`${position.join()}|${normal.join()}`) || null;
    }

    /** The N×N colours seen on a fixed side of the cube (row-major, viewer's frame). */
    getFace(face) {
        const definition = FACE_DEFINITIONS[face];
        if (!definition) return [];
        return Array.from({ length: this.size }, (_, row) => Array.from({ length: this.size }, (_, col) => (
            this.colorAt(stickerPosition(face, row, col, this.size), definition.normal) || 'unknown'
        )));
    }

    /** Solved means every side shows one colour, whatever the cube's orientation. */
    isSolved() {
        return FACE_ORDER.every(face => new Set(this.getFace(face).flat()).size === 1);
    }

    static parseMove(move, size = 3) {
        return parseMove(move, size);
    }
}

/** Splits "R U R' U'" (or "RUR'U'") into move tokens; null if anything is invalid. */
export function tokenizeAlgorithm(algorithm, size = 3) {
    const source = String(algorithm || '').replace(/[()[\]]/g, ' ').replace(/[’`´]/g, "'");
    const tokens = source.match(/\d*[URFDLB]w?(?:2'|'2|2|')?|[urfdlbMESxyzXYZ](?:2'|'2|2|')?|\S/g) || [];
    const moves = [];
    for (const token of tokens) {
        const parsed = parseMove(token, size);
        if (!parsed) return null;
        moves.push(parsed.notation);
    }
    return moves;
}

/** Scramble length per cube size, close to the official WCA scrambles. */
export const SCRAMBLE_LENGTHS = Object.freeze({ 2: 11, 3: 20, 4: 40, 5: 60, 6: 80, 7: 100 });

const AXIS_OF_FACE = { U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 };

/**
 * Random-move scramble in the usual competition style: no face is turned twice
 * in a row and no axis gets three moves in a row (avoids "R L R"). Cubes of 4
 * and more also get wide turns up to half the cube deep.
 */
export function generateScramble(size = 3, length = SCRAMBLE_LENGTHS[size] || 20, random = Math.random) {
    const moves = [];
    const faces = [];
    const suffixes = ['', "'", '2'];
    const maxDepth = size >= 4 ? Math.floor(size / 2) : 1;
    while (moves.length < length) {
        const face = OUTER_FACES[Math.floor(random() * OUTER_FACES.length)];
        const last = faces[faces.length - 1];
        const beforeLast = faces[faces.length - 2];
        if (face === last) continue;
        if (last && beforeLast && AXIS_OF_FACE[face] === AXIS_OF_FACE[last]
            && AXIS_OF_FACE[face] === AXIS_OF_FACE[beforeLast]) continue;
        if (last && AXIS_OF_FACE[face] === AXIS_OF_FACE[last] && face === beforeLast) continue;
        const depth = 1 + Math.floor(random() * maxDepth);
        const base = depth === 1 ? face : depth === 2 ? `${face}w` : `${depth}${face}w`;
        moves.push(`${base}${suffixes[Math.floor(random() * suffixes.length)]}`);
        faces.push(face);
    }
    return moves;
}
