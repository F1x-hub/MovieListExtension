import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CylinderGeometry,
    ExtrudeGeometry,
    Shape,
    ShapeGeometry
} from '../../../../libs/three.games.min.js';

/**
 * Low-poly warships for the WebGL Battleship board, one per fleet length:
 * a patrol boat (1), a destroyer (2), a cruiser (3) and a battleship (4).
 *
 * Every model lies along +X with the bow at +X, is centred on the origin and
 * floats with its waterline at y = 0. Its parts are merged into four
 * geometries, one per material (hull, deck, superstructure, dark metal), so a
 * ship costs four draw calls. Geometry only: materials and colours belong to
 * the renderer.
 */

export const SHIP_PARTS = Object.freeze(['hull', 'deck', 'structure', 'metal']);

const MARGIN = 0.16;
const BEVEL = 0.02;
const DRAFT = 0.06;
const BEAM = Object.freeze({ 1: 0.4, 2: 0.46, 3: 0.52, 4: 0.58 });
const HULL_HEIGHT = Object.freeze({ 1: 0.13, 2: 0.17, 3: 0.17, 4: 0.17 });

/** Deck height above the waterline, per length. */
export const SHIP_DECK = Object.freeze(Object.fromEntries(
    Object.entries(HULL_HEIGHT).map(([length, height]) => [length, height - DRAFT + BEVEL])
));

/** Overall hull length, per length (the ship leaves a margin inside its cells). */
export const SHIP_LENGTH = Object.freeze({ 1: 1 - MARGIN, 2: 2 - MARGIN, 3: 3 - MARGIN, 4: 4 - MARGIN });

/**
 * Concatenates geometries into one non-indexed geometry with position, normal
 * and uv. The inputs are disposed.
 */
export function mergeGeometries(geometries) {
    const parts = geometries.map(geometry => (geometry.index ? geometry.toNonIndexed() : geometry));
    const total = parts.reduce((sum, part) => sum + part.attributes.position.count, 0);
    const merged = new BufferGeometry();
    [['position', 3], ['normal', 3], ['uv', 2]].forEach(([name, size]) => {
        const array = new Float32Array(total * size);
        let offset = 0;
        parts.forEach(part => {
            const attribute = part.attributes[name];
            const count = part.attributes.position.count;
            if (attribute) {
                const source = attribute.array;
                const stride = attribute.itemSize;
                for (let i = 0; i < count; i++) {
                    for (let k = 0; k < size; k++) array[offset + i * size + k] = source[i * stride + k];
                }
            }
            offset += count * size;
        });
        merged.setAttribute(name, new BufferAttribute(array, size));
    });
    new Set([...geometries, ...parts]).forEach(geometry => geometry.dispose());
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
}

/** Top view of a hull: straight sides, a pointed bow at +x, a rounded transom. */
function hullShape(length, beam) {
    const half = length / 2;
    const side = beam / 2;
    const bow = Math.min(length * 0.34, 0.5);
    const stern = Math.min(0.1, side * 0.55);
    const shape = new Shape();
    shape.moveTo(-half + stern, -side);
    shape.lineTo(half - bow, -side);
    shape.bezierCurveTo(half - bow * 0.42, -side, half - bow * 0.1, -side * 0.4, half, 0);
    shape.bezierCurveTo(half - bow * 0.1, side * 0.4, half - bow * 0.42, side, half - bow, side);
    shape.lineTo(-half + stern, side);
    shape.quadraticCurveTo(-half, side, -half, side - stern);
    shape.lineTo(-half, -side + stern);
    shape.quadraticCurveTo(-half, -side, -half + stern, -side);
    return shape;
}

/** A shape in the board plane, turned so it faces up. */
function lay(geometry) {
    geometry.rotateX(-Math.PI / 2);
    return geometry;
}

function box(length, height, width, x, y, z = 0) {
    const geometry = new BoxGeometry(length, height, width);
    geometry.translate(x, y + height / 2, z);
    return geometry;
}

function cylinder(top, bottom, height, x, y, z = 0, segments = 12) {
    const geometry = new CylinderGeometry(top, bottom, height, segments);
    geometry.translate(x, y + height / 2, z);
    return geometry;
}

/** A twin-gun turret; `facing` is +1 for guns towards the bow, -1 towards the stern. */
function turret(parts, x, y, scale, facing) {
    const s = scale;
    parts.structure.push(cylinder(0.082 * s, 0.092 * s, 0.045 * s, x, y, 0, 16));
    parts.structure.push(box(0.17 * s, 0.062 * s, 0.15 * s, x - facing * 0.012 * s, y + 0.045 * s));
    [-1, 1].forEach(side => {
        const barrel = new CylinderGeometry(0.0105 * s, 0.0125 * s, 0.21 * s, 6);
        barrel.rotateZ(Math.PI / 2);
        barrel.translate(x + facing * 0.17 * s, y + 0.078 * s, side * 0.034 * s);
        parts.metal.push(barrel);
    });
}

/** A raked funnel with a dark cap. */
function funnel(parts, x, y, radius, height) {
    const body = new CylinderGeometry(radius * 0.92, radius, height, 14);
    body.translate(0, height / 2, 0);
    body.rotateZ(0.1);
    body.translate(x, y, 0);
    parts.structure.push(body);
    const cap = new CylinderGeometry(radius * 0.96, radius * 0.96, height * 0.16, 14);
    cap.translate(0, height * 0.94, 0);
    cap.rotateZ(0.1);
    cap.translate(x, y, 0);
    parts.metal.push(cap);
}

/** A pole mast with one yard. */
function mast(parts, x, y, height) {
    parts.metal.push(cylinder(0.009, 0.012, height, x, y, 0, 6));
    parts.metal.push(box(0.012, 0.012, height * 0.42, x, y + height * 0.72));
}

/** A bridge: stacked blocks with a dark band of windows on the top one. */
function bridge(parts, x, y, tiers) {
    let level = y;
    tiers.forEach(([length, height, width], index) => {
        parts.structure.push(box(length, height, width, x - index * 0.01, level));
        level += height;
    });
    const [length, height, width] = tiers[tiers.length - 1];
    parts.metal.push(box(length + 0.006, height * 0.32, width + 0.006, x - (tiers.length - 1) * 0.01, level - height * 0.55));
    return level;
}

const LAYOUTS = {
    1(parts, deck) {
        bridge(parts, -0.06, deck, [[0.26, 0.085, 0.22], [0.15, 0.06, 0.17]]);
        mast(parts, -0.1, deck + 0.145, 0.16);
        parts.structure.push(cylinder(0.035, 0.04, 0.035, 0.22, deck, 0, 10));
        const gun = new CylinderGeometry(0.009, 0.011, 0.12, 6);
        gun.rotateZ(Math.PI / 2);
        gun.translate(0.27, deck + 0.05, 0);
        parts.metal.push(gun);
    },
    2(parts, deck) {
        turret(parts, 0.5, deck, 0.82, 1);
        const top = bridge(parts, 0.16, deck, [[0.32, 0.11, 0.3], [0.2, 0.075, 0.24]]);
        mast(parts, 0.02, top - 0.04, 0.34);
        funnel(parts, -0.2, deck, 0.058, 0.17);
        parts.structure.push(box(0.26, 0.065, 0.22, -0.43, deck));
        turret(parts, -0.68, deck, 0.82, -1);
    },
    3(parts, deck) {
        turret(parts, 1.0, deck, 1, 1);
        parts.structure.push(cylinder(0.088, 0.096, 0.05, 0.66, deck, 0, 16));
        turret(parts, 0.66, deck + 0.05, 1, 1);
        const top = bridge(parts, 0.3, deck, [[0.38, 0.13, 0.34], [0.26, 0.095, 0.28], [0.15, 0.07, 0.2]]);
        mast(parts, 0.12, top - 0.05, 0.44);
        funnel(parts, -0.12, deck, 0.066, 0.2);
        funnel(parts, -0.42, deck, 0.066, 0.2);
        parts.structure.push(box(0.36, 0.075, 0.28, -0.72, deck));
        turret(parts, -1.02, deck, 1, -1);
    },
    4(parts, deck) {
        turret(parts, 1.42, deck, 1.16, 1);
        parts.structure.push(cylinder(0.1, 0.11, 0.06, 1.05, deck, 0, 16));
        turret(parts, 1.05, deck + 0.06, 1.16, 1);
        const top = bridge(parts, 0.6, deck, [[0.5, 0.14, 0.4], [0.36, 0.11, 0.32], [0.22, 0.095, 0.24]]);
        mast(parts, 0.42, top - 0.05, 0.5);
        funnel(parts, 0.14, deck, 0.08, 0.22);
        funnel(parts, -0.2, deck, 0.08, 0.22);
        bridge(parts, -0.58, deck, [[0.4, 0.09, 0.32], [0.18, 0.075, 0.2]]);
        parts.structure.push(cylinder(0.1, 0.11, 0.06, -0.98, deck, 0, 16));
        turret(parts, -0.98, deck + 0.06, 1.16, -1);
        turret(parts, -1.36, deck, 1.16, -1);
    }
};

/** The four merged geometries of one ship length. */
export function createShipModel(length) {
    if (!LAYOUTS[length]) throw new Error(`No ship model for length ${length}`);
    const hullLength = SHIP_LENGTH[length];
    const beam = BEAM[length];
    const height = HULL_HEIGHT[length];
    const deck = SHIP_DECK[length];
    const parts = { hull: [], deck: [], structure: [], metal: [] };

    const hull = lay(new ExtrudeGeometry(hullShape(hullLength - BEVEL * 2, beam - BEVEL * 2), {
        depth: height,
        bevelEnabled: true,
        bevelThickness: BEVEL,
        bevelSize: BEVEL,
        bevelSegments: 2,
        curveSegments: 10
    }));
    hull.translate(0, -DRAFT, 0);
    parts.hull.push(hull);

    const plank = lay(new ShapeGeometry(hullShape(hullLength * 0.95, beam * 0.8), 10));
    plank.translate(0, deck + 0.002, 0);
    parts.deck.push(plank);

    LAYOUTS[length](parts, deck);
    return Object.fromEntries(SHIP_PARTS.map(name => [name, mergeGeometries(parts[name])]));
}

/** Models for every fleet length: `{ 1: { hull, deck, structure, metal }, … }`. */
export function createShipModels() {
    return Object.fromEntries([1, 2, 3, 4].map(length => [length, createShipModel(length)]));
}

export function disposeShipModels(models) {
    Object.values(models || {}).forEach(model => SHIP_PARTS.forEach(name => model[name]?.dispose()));
}
