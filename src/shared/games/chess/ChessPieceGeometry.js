import {
    BufferAttribute,
    BufferGeometry,
    ExtrudeGeometry,
    LatheGeometry,
    Path,
    Shape,
    SphereGeometry
} from '../../../../libs/three.games.min.js';

/**
 * Turned Staunton-style pieces built from code, one geometry per piece type.
 * Units: a board square is 1. Every piece stands on y = 0. The knight faces +x
 * until the renderer turns it toward the opponent; the king's cross faces ±z.
 *
 * Bodies are lathed from a profile (radius, height); the knight's head is an
 * extruded, bevelled silhouette, the rook's battlements extruded ring sectors,
 * the queen's coronet small spheres. Parts are merged into one geometry so a
 * piece is one mesh for shadows and picking.
 */

const LATHE_SEGMENTS = 48;
const CURVE_STEPS = 10;

/** The shared foot of every piece: a rounded disc, a bead and the cove above it. */
function footProfile(radius, coveTop, coveRadius) {
    const path = new Path();
    path.moveTo(0, 0);
    path.lineTo(radius - 0.016, 0);
    path.quadraticCurveTo(radius, 0, radius, 0.016);
    path.lineTo(radius, 0.052);
    path.quadraticCurveTo(radius, 0.078, radius - 0.03, 0.084);
    path.quadraticCurveTo(radius - 0.012, 0.098, radius - 0.04, 0.114);
    path.quadraticCurveTo(coveRadius + 0.02, 0.135, coveRadius, coveTop);
    return path;
}

function lathe(path) {
    const points = path.getPoints(CURVE_STEPS);
    // Lathing needs every radius at or above zero.
    points.forEach(point => { point.x = Math.max(0, point.x); });
    return new LatheGeometry(points, LATHE_SEGMENTS);
}

/** Merges non-indexed copies of geometries (positions, normals, uvs) into one. */
function mergeGeometries(geometries) {
    const parts = geometries.map(geometry => (geometry.index ? geometry.toNonIndexed() : geometry));
    const total = parts.reduce((sum, part) => sum + part.attributes.position.count, 0);
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    let offset = 0;
    parts.forEach(part => {
        position.set(part.attributes.position.array, offset * 3);
        normal.set(part.attributes.normal.array, offset * 3);
        if (part.attributes.uv) uv.set(part.attributes.uv.array, offset * 2);
        offset += part.attributes.position.count;
    });
    geometries.forEach(geometry => geometry.dispose());
    parts.forEach(part => part.dispose());
    const merged = new BufferGeometry();
    merged.setAttribute('position', new BufferAttribute(position, 3));
    merged.setAttribute('normal', new BufferAttribute(normal, 3));
    merged.setAttribute('uv', new BufferAttribute(uv, 2));
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
}

function pawn() {
    const path = footProfile(0.27, 0.2, 0.13);
    path.quadraticCurveTo(0.115, 0.27, 0.112, 0.305);
    path.quadraticCurveTo(0.172, 0.306, 0.176, 0.326);
    path.quadraticCurveTo(0.176, 0.346, 0.1, 0.352);
    path.lineTo(0.064, 0.358);
    path.absarc(0, 0.452, 0.114, -0.96, Math.PI / 2, false);
    return lathe(path);
}

function rook() {
    const path = footProfile(0.295, 0.22, 0.168);
    path.quadraticCurveTo(0.158, 0.38, 0.174, 0.468);
    path.lineTo(0.19, 0.488);
    path.quadraticCurveTo(0.226, 0.49, 0.226, 0.51);
    path.quadraticCurveTo(0.226, 0.53, 0.19, 0.536);
    path.lineTo(0.2, 0.55);
    path.lineTo(0.218, 0.558);
    path.lineTo(0.218, 0.622);
    path.lineTo(0.142, 0.622);
    path.lineTo(0.142, 0.585);
    path.lineTo(0, 0.585);
    const parts = [lathe(path)];
    // Five battlements on the rim, extruded upward from y = 0.622.
    const count = 5;
    const span = (Math.PI * 2) / count;
    for (let i = 0; i < count; i++) {
        const start = i * span + span * 0.16;
        const end = (i + 1) * span - span * 0.16;
        const shape = new Shape();
        shape.absarc(0, 0, 0.212, start, end, false);
        shape.absarc(0, 0, 0.146, end, start, true);
        shape.closePath();
        const merlon = new ExtrudeGeometry(shape, {
            depth: 0.058,
            bevelEnabled: true,
            bevelThickness: 0.01,
            bevelSize: 0.008,
            bevelSegments: 2,
            curveSegments: 6
        });
        merlon.rotateX(-Math.PI / 2);
        merlon.translate(0, 0.632, 0);
        parts.push(merlon);
    }
    return mergeGeometries(parts);
}

function knight() {
    const foot = footProfile(0.295, 0.15, 0.2);
    foot.lineTo(0.2, 0.17);
    foot.lineTo(0, 0.17);
    const head = new Shape();
    head.moveTo(-0.165, 0.15);
    head.lineTo(0.15, 0.15);
    head.bezierCurveTo(0.175, 0.24, 0.1, 0.3, 0.088, 0.362);
    head.bezierCurveTo(0.12, 0.402, 0.215, 0.41, 0.262, 0.458);
    head.bezierCurveTo(0.292, 0.49, 0.29, 0.548, 0.256, 0.576);
    head.bezierCurveTo(0.2, 0.62, 0.14, 0.66, 0.092, 0.704);
    head.lineTo(0.078, 0.792);
    head.lineTo(0.022, 0.742);
    head.bezierCurveTo(-0.06, 0.742, -0.152, 0.682, -0.19, 0.58);
    head.bezierCurveTo(-0.232, 0.46, -0.212, 0.3, -0.165, 0.15);
    const depth = 0.17;
    const bevel = 0.05;
    const extruded = new ExtrudeGeometry(head, {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: 0.034,
        bevelSegments: 5,
        curveSegments: 18
    });
    extruded.translate(0, 0, -depth / 2);
    return mergeGeometries([lathe(foot), extruded]);
}

function bishop() {
    const path = footProfile(0.3, 0.22, 0.156);
    path.quadraticCurveTo(0.13, 0.4, 0.116, 0.498);
    path.quadraticCurveTo(0.176, 0.5, 0.18, 0.52);
    path.quadraticCurveTo(0.18, 0.545, 0.115, 0.55);
    path.lineTo(0.104, 0.566);
    path.bezierCurveTo(0.172, 0.602, 0.174, 0.702, 0.122, 0.772);
    path.bezierCurveTo(0.092, 0.81, 0.052, 0.836, 0.03, 0.846);
    path.lineTo(0.012, 0.848);
    path.absarc(0, 0.878, 0.033, -1.2, Math.PI / 2, false);
    return lathe(path);
}

function queen() {
    const path = footProfile(0.33, 0.24, 0.17);
    path.quadraticCurveTo(0.14, 0.46, 0.12, 0.6);
    path.quadraticCurveTo(0.19, 0.6, 0.195, 0.624);
    path.quadraticCurveTo(0.195, 0.646, 0.13, 0.65);
    path.quadraticCurveTo(0.17, 0.66, 0.166, 0.676);
    path.quadraticCurveTo(0.16, 0.69, 0.124, 0.696);
    path.bezierCurveTo(0.142, 0.742, 0.19, 0.842, 0.205, 0.882);
    path.lineTo(0.2, 0.896);
    path.quadraticCurveTo(0.172, 0.9, 0.15, 0.906);
    path.bezierCurveTo(0.1, 0.93, 0.062, 0.95, 0.034, 0.96);
    path.lineTo(0.028, 0.964);
    path.absarc(0, 0.994, 0.044, -0.86, Math.PI / 2, false);
    const parts = [lathe(path)];
    const points = 9;
    for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const bead = new SphereGeometry(0.03, 12, 8);
        bead.translate(Math.cos(angle) * 0.192, 0.912, Math.sin(angle) * 0.192);
        parts.push(bead);
    }
    return mergeGeometries(parts);
}

function king() {
    const path = footProfile(0.34, 0.25, 0.18);
    path.quadraticCurveTo(0.15, 0.48, 0.13, 0.63);
    path.quadraticCurveTo(0.2, 0.63, 0.205, 0.655);
    path.quadraticCurveTo(0.205, 0.676, 0.14, 0.68);
    path.quadraticCurveTo(0.18, 0.69, 0.176, 0.706);
    path.quadraticCurveTo(0.17, 0.72, 0.134, 0.726);
    path.bezierCurveTo(0.15, 0.772, 0.19, 0.862, 0.2, 0.9);
    path.lineTo(0.195, 0.914);
    path.quadraticCurveTo(0.17, 0.92, 0.15, 0.928);
    path.bezierCurveTo(0.11, 0.95, 0.075, 0.972, 0.06, 0.984);
    path.lineTo(0.05, 1.0);
    path.quadraticCurveTo(0.075, 1.006, 0.074, 1.02);
    path.quadraticCurveTo(0.07, 1.034, 0.04, 1.036);
    path.lineTo(0, 1.036);
    const arm = 0.04;
    const cross = new Shape();
    cross.moveTo(-arm, 1.02);
    cross.lineTo(arm, 1.02);
    cross.lineTo(arm, 1.135);
    cross.lineTo(0.118, 1.135);
    cross.lineTo(0.118, 1.205);
    cross.lineTo(arm, 1.205);
    cross.lineTo(arm, 1.29);
    cross.lineTo(-arm, 1.29);
    cross.lineTo(-arm, 1.205);
    cross.lineTo(-0.118, 1.205);
    cross.lineTo(-0.118, 1.135);
    cross.lineTo(-arm, 1.135);
    cross.closePath();
    const depth = 0.05;
    const crossGeometry = new ExtrudeGeometry(cross, {
        depth,
        bevelEnabled: true,
        bevelThickness: 0.016,
        bevelSize: 0.012,
        bevelSegments: 3
    });
    // Arms along x, so both players see the cross face-on.
    crossGeometry.translate(0, 0, -depth / 2);
    return mergeGeometries([lathe(path), crossGeometry]);
}

const BUILDERS = { p: pawn, n: knight, b: bishop, r: rook, q: queen, k: king };

/** Pieces are authored for a 0.68-wide king base and drawn a fifth larger. */
export const PIECE_SCALE = 1.2;

/** Builds one geometry per piece type: { p, n, b, r, q, k }. */
export function createPieceGeometries() {
    return Object.fromEntries(Object.entries(BUILDERS).map(([type, build]) => {
        const geometry = build();
        geometry.scale(PIECE_SCALE, PIECE_SCALE, PIECE_SCALE);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return [type, geometry];
    }));
}

/** Height of each piece as drawn, for keeping tall pieces in frame. */
export const PIECE_HEIGHTS = Object.freeze(Object.fromEntries(
    Object.entries({ p: 0.57, n: 0.8, b: 0.91, r: 0.7, q: 1.04, k: 1.31 }).map(([type, height]) => [type, height * PIECE_SCALE])
));
