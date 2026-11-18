import {
    BackSide,
    BoxGeometry,
    CanvasTexture,
    CircleGeometry,
    Color,
    CylinderGeometry,
    DirectionalLight,
    ExtrudeGeometry,
    Group,
    HemisphereLight,
    Mesh,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    MeshStandardMaterial,
    NeutralToneMapping,
    PCFShadowMap,
    PerspectiveCamera,
    Plane,
    PlaneGeometry,
    PMREMGenerator,
    Raycaster,
    RingGeometry,
    Scene,
    ShadowMaterial,
    Shape,
    ShapeGeometry,
    SRGBColorSpace,
    Vector2,
    Vector3,
    WebGLRenderer
} from '../../../../libs/three.games.min.js';
import { createPieceGeometries, PIECE_HEIGHTS } from './ChessPieceGeometry.js';

/**
 * WebGL chess board: lacquered frame, 64 stone tiles with real gaps between
 * them, turned pieces with shadows, legal-move markers, drag or click to move,
 * free orbit and captured pieces standing on the table beside the board.
 *
 * The renderer never owns the game. It draws what `setPosition()` gives it,
 * asks `selectable()` / `legalTargets()` while the player picks a move and
 * reports the choice through `onMove()`. Board and piece colours are game
 * content (docs/design-system.md, exception 3); the page around stays neutral.
 */

const FILES = 'abcdefgh';
const TILE = 0.965;
const TILE_DEPTH = 0.045;
const TILE_BEVEL = 0.012;
const TILE_TOP = TILE_DEPTH + TILE_BEVEL * 2;
const FRAME_SIZE = 9.9;
const FRAME_DEPTH = 0.32;
const FRAME_BEVEL = 0.06;
const GROUND_Y = -(FRAME_DEPTH + FRAME_BEVEL * 2) - 0.002;
const TRAY_X = 5.6;
const TRAY_STEP = 0.72;
const TRAY_SCALE = 0.8;
const LIFT = 0.07;
const DRAG_HEIGHT = 0.42;
const DRAG_THRESHOLD = 6;
const ELEVATION_MIN = 0.36;
const ELEVATION_MAX = 1.54;
const DEFAULT_ELEVATION = 0.84;
const TOP_ELEVATION = 1.36;

const PALETTE = Object.freeze({
    lightSquare: [188, 191, 198],
    lightCloud: [208, 210, 216],
    lightVein: [136, 140, 149],
    darkSquare: [76, 79, 87],
    darkCloud: [97, 100, 109],
    darkVein: [38, 40, 46],
    frame: '#1b1d21',
    trim: '#a4a8b0',
    label: 'rgba(190, 195, 204, 0.92)',
    whitePiece: '#e7e6e2',
    blackPiece: '#1b1c20',
    markerOnLight: '#17181c',
    markerOnDark: '#f4f5f7',
    lastMove: '#9aa6bd',
    select: '#ffffff',
    check: [229, 72, 77],
    hint: '#ffffff'
});

function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rgba = ([r, g, b], alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

/** Polished stone with soft clouds and thin veins, one texture for the whole board. */
function stoneTexture(doc, { base, cloud, vein, seed }) {
    const size = 1024;
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const random = mulberry32(seed);
    ctx.fillStyle = rgba(base, 1);
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 120; i++) {
        const x = random() * size;
        const y = random() * size;
        const radius = 50 + random() * 240;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        const tone = random() < 0.55 ? cloud : vein;
        gradient.addColorStop(0, rgba(tone, 0.05 + random() * 0.07));
        gradient.addColorStop(1, rgba(tone, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let v = 0; v < 26; v++) {
        let x = random() * size;
        let y = random() * size;
        let angle = random() * Math.PI * 2;
        ctx.strokeStyle = rgba(vein, 0.08 + random() * 0.16);
        ctx.lineWidth = 0.6 + random() * 2.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const steps = 30 + Math.floor(random() * 50);
        for (let s = 0; s < steps; s++) {
            angle += (random() - 0.5) * 0.55;
            x += Math.cos(angle) * 12;
            y += Math.sin(angle) * 12;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    // Tile caps carry board coordinates in -4…4; map that span onto the texture once.
    texture.repeat.set(1 / 8, 1 / 8);
    texture.offset.set(0.5, 0.5);
    return texture;
}

/** Coordinates engraved on the frame, readable from the nearer side. */
function labelTexture(doc) {
    const size = 1024;
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const unit = size / FRAME_SIZE;
    const toPixel = value => (value / FRAME_SIZE + 0.5) * size;
    ctx.fillStyle = PALETTE.label;
    ctx.font = `600 ${Math.round(unit * 0.3)}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const edge = 4.47;
    const draw = (text, x, z, flipped) => {
        ctx.save();
        ctx.translate(toPixel(x), toPixel(z));
        if (flipped) ctx.rotate(Math.PI);
        ctx.fillText(text, 0, 0);
        ctx.restore();
    };
    for (let i = 0; i < 8; i++) {
        const offset = i - 3.5;
        draw(FILES[i], offset, edge, false);
        draw(FILES[i], offset, -edge, true);
        draw(String(i + 1), -edge, -offset, false);
        draw(String(i + 1), edge, -offset, true);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

/** Soft red glow under a king in check. */
function glowTexture(doc) {
    const size = 256;
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, rgba(PALETTE.check, 0.95));
    gradient.addColorStop(0.45, rgba(PALETTE.check, 0.55));
    gradient.addColorStop(1, rgba(PALETTE.check, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

function roundedRectShape(width, height, radius, cx = 0, cy = 0) {
    const x = cx - width / 2;
    const y = cy - height / 2;
    const shape = new Shape();
    shape.moveTo(x + radius, y);
    shape.lineTo(x + width - radius, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + height - radius);
    shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    shape.lineTo(x + radius, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);
    return shape;
}

/** A square ring: outline of a square, `width` thick. */
function frameShape(outer, width, radius) {
    const shape = roundedRectShape(outer, outer, radius);
    const inner = outer - width * 2;
    const hole = roundedRectShape(inner, inner, Math.max(0.01, radius - width));
    shape.holes.push(hole);
    return shape;
}

/** Four corner brackets, the keyboard cursor. */
function bracketShapes(size, arm, width) {
    const half = size / 2;
    const shapes = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
        const shape = new Shape();
        const x = sx * half;
        const y = sy * half;
        shape.moveTo(x, y);
        shape.lineTo(x - sx * arm, y);
        shape.lineTo(x - sx * arm, y - sy * width);
        shape.lineTo(x - sx * width, y - sy * width);
        shape.lineTo(x - sx * width, y - sy * arm);
        shape.lineTo(x, y - sy * arm);
        shape.closePath();
        shapes.push(shape);
    });
    return shapes;
}

function flat(geometry) {
    geometry.rotateX(-Math.PI / 2);
    return geometry;
}

function overlayMaterial(color, opacity) {
    return new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
    });
}

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const easeOut = t => 1 - (1 - t) ** 3;

export function squareToWorld(square) {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    return { x: file - 3.5, z: 3.5 - rank };
}

export function worldToSquare(x, z) {
    const file = Math.floor(x + 4);
    const rank = Math.floor(4 - z);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return FILES[file] + (rank + 1);
}

function squareShade(square) {
    return (square.charCodeAt(0) - 97 + Number(square[1]) - 1) % 2 === 0 ? 'dark' : 'light';
}

/** Studio light for reflections: a dim room with three soft boxes. */
function studioEnvironment(renderer) {
    const pmrem = new PMREMGenerator(renderer);
    const room = new Scene();
    const disposables = [];
    const roomGeometry = new BoxGeometry(24, 14, 24);
    const roomMaterial = new MeshBasicMaterial({ color: new Color(0.16, 0.165, 0.18), side: BackSide });
    disposables.push(roomGeometry, roomMaterial);
    room.add(new Mesh(roomGeometry, roomMaterial));
    const panel = (width, height, position, intensity) => {
        const geometry = new PlaneGeometry(width, height);
        const material = new MeshBasicMaterial({ color: new Color(intensity, intensity, intensity * 1.02) });
        disposables.push(geometry, material);
        const mesh = new Mesh(geometry, material);
        mesh.position.set(...position);
        mesh.lookAt(0, 0, 0);
        room.add(mesh);
    };
    panel(10, 4, [0, 6.6, 0], 5.5);
    panel(4, 6, [-10, 3, 3], 2.4);
    panel(4, 6, [10, 3, -3], 1.8);
    panel(8, 2.5, [0, 2.5, 11], 1.4);
    const target = pmrem.fromScene(room, 0.04);
    disposables.forEach(item => item.dispose());
    pmrem.dispose();
    return target;
}

export class ChessBoardRenderer {
    static isSupported(doc = globalThis.document) {
        if (typeof globalThis.WebGLRenderingContext === 'undefined') return false;
        try {
            const canvas = doc.createElement('canvas');
            return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
        } catch {
            return false;
        }
    }

    /**
     * @param {HTMLElement} host
     * @param {{
     *   orientation?: 'w' | 'b',
     *   interactive?: () => boolean,
     *   selectable?: (square: string) => boolean,
     *   legalTargets?: (square: string) => Array<{ to: string, capture?: boolean }>,
     *   onMove?: (move: { from: string, to: string }) => void,
     *   onSelect?: (square: string | null) => void,
     *   onCursor?: (square: string) => void,
     *   label?: string
     * }} options
     */
    constructor(host, options = {}) {
        this.host = host;
        this.doc = host.ownerDocument || globalThis.document;
        this.options = options;
        this.orientation = options.orientation === 'b' ? 'b' : 'w';
        this.interactive = options.interactive || (() => true);
        this.selectable = options.selectable || (() => false);
        this.legalTargets = options.legalTargets || (() => []);
        this.onMove = options.onMove || (() => {});
        this.onSelect = options.onSelect || (() => {});
        this.onCursor = options.onCursor || (() => {});
        this.disposed = false;
        this.needsRender = true;
        this.frame = null;
        this.tweens = new Set();
        this.pointer = null;
        this.selected = null;
        this.targets = [];
        this.hovered = null;
        this.cursor = null;
        this.cursorVisible = false;
        this.pieces = new Map();
        this.trays = { w: [], b: [] };
        this.lastMove = null;
        this.checkSquare = null;
        this.hint = null;
        this.camera = new PerspectiveCamera(30, 1, 0.1, 200);
        this.view = {
            azimuth: this.orientation === 'w' ? 0 : Math.PI,
            elevation: DEFAULT_ELEVATION,
            zoom: 1,
            target: new Vector3(0, 0.2, 0)
        };

        this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.toneMapping = NeutralToneMapping;
        this.renderer.toneMappingExposure = 1;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFShadowMap;
        this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
        this.canvas = this.renderer.domElement;
        this.canvas.className = 'chess-canvas';
        this.canvas.tabIndex = 0;
        this.canvas.setAttribute('role', 'application');
        if (options.label) this.canvas.setAttribute('aria-label', options.label);
        host.appendChild(this.canvas);

        this.scene = new Scene();
        this.environment = studioEnvironment(this.renderer);
        this.scene.environment = this.environment.texture;
        this.scene.environmentIntensity = 0.62;

        this.buildLights();
        this.buildMaterials();
        this.buildBoard();
        this.buildOverlays();

        this.raycaster = new Raycaster();
        this.dragPlane = new Plane(new Vector3(0, 1, 0), -DRAG_HEIGHT);
        this.bindInput();
        this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
        this.resizeObserver?.observe(host);
        this.resize();
        this.warmUp();
        this.loop = this.loop.bind(this);
        this.frame = requestAnimationFrame(this.loop);
    }

    /**
     * Compiles every material before the first frame, without blocking where the
     * browser compiles in parallel, so the page does not freeze on the first
     * render or the first selection. Rendering waits for it (at most 5 s).
     */
    warmUp() {
        this.ready = false;
        const extras = [this.materials.w, this.materials.b, this.materials.wSelected, this.materials.bSelected].map(material => {
            const mesh = new Mesh(this.pieceGeometries.p, material);
            mesh.visible = false;
            this.scene.add(mesh);
            return mesh;
        });
        let timer = null;
        const finish = () => {
            if (this.ready || this.disposed) return;
            clearTimeout(timer);
            this.ready = true;
            extras.forEach(mesh => this.scene.remove(mesh));
            this.requestRender();
            this.options.onReady?.();
        };
        timer = setTimeout(finish, 5000);
        try {
            const compiling = this.renderer.compileAsync?.(this.scene, this.camera);
            if (compiling) compiling.then(finish, finish);
            else finish();
        } catch (error) {
            console.warn('[ChessBoard] shader warm-up failed', error);
            finish();
        }
    }

    // --- Scene ------------------------------------------------------------------------------

    buildLights() {
        this.scene.add(new HemisphereLight('#ffffff', '#2c2f36', 0.32));
        const key = new DirectionalLight('#ffffff', 2.7);
        key.position.set(-6, 10, 5);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.left = -8;
        key.shadow.camera.right = 8;
        key.shadow.camera.top = 8;
        key.shadow.camera.bottom = -8;
        key.shadow.camera.near = 2;
        key.shadow.camera.far = 30;
        key.shadow.radius = 4;
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.018;
        this.scene.add(key);
        const fill = new DirectionalLight('#e4e9f5', 0.42);
        fill.position.set(7, 5, -6);
        this.scene.add(fill);
    }

    buildMaterials() {
        this.lightStone = stoneTexture(this.doc, { base: PALETTE.lightSquare, cloud: PALETTE.lightCloud, vein: PALETTE.lightVein, seed: 11 });
        this.darkStone = stoneTexture(this.doc, { base: PALETTE.darkSquare, cloud: PALETTE.darkCloud, vein: PALETTE.darkVein, seed: 29 });
        this.labels = labelTexture(this.doc);
        this.glow = glowTexture(this.doc);
        this.materials = {
            light: new MeshPhysicalMaterial({ map: this.lightStone, roughness: 0.32, clearcoat: 0.55, clearcoatRoughness: 0.22 }),
            dark: new MeshPhysicalMaterial({ map: this.darkStone, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
            frame: new MeshPhysicalMaterial({ color: new Color(PALETTE.frame), roughness: 0.42, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.18 }),
            trim: new MeshStandardMaterial({ color: new Color(PALETTE.trim), roughness: 0.28, metalness: 0.92 }),
            labels: new MeshBasicMaterial({ map: this.labels, transparent: true, depthWrite: false, toneMapped: false }),
            w: new MeshPhysicalMaterial({ color: new Color(PALETTE.whitePiece), roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
            b: new MeshPhysicalMaterial({ color: new Color(PALETTE.blackPiece), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 }),
            ground: new ShadowMaterial({ opacity: 0.34 })
        };
        // A lifted piece glows faintly so the selection reads at any angle.
        this.materials.wSelected = this.materials.w.clone();
        this.materials.wSelected.emissive = new Color('#6f7685');
        this.materials.wSelected.emissiveIntensity = 0.35;
        this.materials.bSelected = this.materials.b.clone();
        this.materials.bSelected.emissive = new Color('#8a93a6');
        this.materials.bSelected.emissiveIntensity = 0.32;
        this.pieceGeometries = createPieceGeometries();
        this.pickGeometry = new CylinderGeometry(0.4, 0.42, 0.78, 14);
        this.pickGeometry.translate(0, 0.39, 0);
        this.pickMaterial = new MeshBasicMaterial({ visible: false });
    }

    buildBoard() {
        this.board = new Group();
        this.scene.add(this.board);
        this.disposables = [];

        const frameGeometry = flat(new ExtrudeGeometry(roundedRectShape(FRAME_SIZE - FRAME_BEVEL * 2, FRAME_SIZE - FRAME_BEVEL * 2, 0.32), {
            depth: FRAME_DEPTH,
            bevelEnabled: true,
            bevelThickness: FRAME_BEVEL,
            bevelSize: FRAME_BEVEL,
            bevelSegments: 4,
            curveSegments: 8
        }));
        frameGeometry.translate(0, -FRAME_DEPTH - FRAME_BEVEL, 0);
        const frame = new Mesh(frameGeometry, this.materials.frame);
        frame.castShadow = true;
        frame.receiveShadow = true;
        this.board.add(frame);
        this.disposables.push(frameGeometry);

        const trimGeometry = flat(new ExtrudeGeometry(frameShape(8.3, 0.1, 0.08), {
            depth: 0.026,
            bevelEnabled: true,
            bevelThickness: 0.008,
            bevelSize: 0.008,
            bevelSegments: 2
        }));
        const trim = new Mesh(trimGeometry, this.materials.trim);
        trim.receiveShadow = true;
        this.board.add(trim);
        this.disposables.push(trimGeometry);

        const labelGeometry = flat(new PlaneGeometry(FRAME_SIZE, FRAME_SIZE));
        const labels = new Mesh(labelGeometry, this.materials.labels);
        labels.position.y = 0.002;
        labels.renderOrder = 1;
        this.board.add(labels);
        this.disposables.push(labelGeometry);

        this.tiles = [];
        for (let rank = 0; rank < 8; rank++) {
            for (let file = 0; file < 8; file++) {
                const square = FILES[file] + (rank + 1);
                const { x, z } = squareToWorld(square);
                // The cap's UVs are the shape's own coordinates: board space, so
                // the stone runs on across neighbouring tiles.
                const geometry = flat(new ExtrudeGeometry(roundedRectShape(TILE - TILE_BEVEL * 2, TILE - TILE_BEVEL * 2, 0.045, x, -z), {
                    depth: TILE_DEPTH,
                    bevelEnabled: true,
                    bevelThickness: TILE_BEVEL,
                    bevelSize: TILE_BEVEL,
                    bevelSegments: 2,
                    curveSegments: 3
                }));
                geometry.translate(0, TILE_BEVEL, 0);
                const tile = new Mesh(geometry, squareShade(square) === 'dark' ? this.materials.dark : this.materials.light);
                tile.receiveShadow = true;
                tile.userData.square = square;
                this.board.add(tile);
                this.tiles.push(tile);
                this.disposables.push(geometry);
            }
        }

        const groundGeometry = flat(new PlaneGeometry(60, 60));
        const ground = new Mesh(groundGeometry, this.materials.ground);
        ground.position.y = GROUND_Y;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.disposables.push(groundGeometry);
    }

    buildOverlays() {
        const lift = TILE_TOP + 0.004;
        this.overlayGeometries = {
            fill: flat(new PlaneGeometry(TILE - 0.02, TILE - 0.02)),
            frame: flat(new ShapeGeometry(frameShape(TILE - 0.03, 0.065, 0.05), 4)),
            thinFrame: flat(new ShapeGeometry(frameShape(TILE - 0.03, 0.035, 0.05), 4)),
            brackets: flat(new ShapeGeometry(bracketShapes(TILE - 0.08, 0.24, 0.06))),
            dot: flat(new CircleGeometry(0.135, 40)),
            ring: flat(new RingGeometry(0.39, 0.45, 56)),
            glow: flat(new PlaneGeometry(1.5, 1.5))
        };
        this.overlayMaterials = {
            lastMove: overlayMaterial(PALETTE.lastMove, 0.5),
            select: overlayMaterial(PALETTE.select, 0.95),
            hover: overlayMaterial(PALETTE.select, 0.55),
            cursor: overlayMaterial(PALETTE.select, 0.95),
            hint: overlayMaterial(PALETTE.hint, 0.85),
            markerOnLight: overlayMaterial(PALETTE.markerOnLight, 0.34),
            markerOnDark: overlayMaterial(PALETTE.markerOnDark, 0.42),
            glow: new MeshBasicMaterial({ map: this.glow, transparent: true, depthWrite: false, toneMapped: false })
        };
        const make = (geometry, material, order = 2) => {
            const mesh = new Mesh(geometry, material);
            mesh.position.y = lift;
            mesh.renderOrder = order;
            mesh.visible = false;
            this.board.add(mesh);
            return mesh;
        };
        const g = this.overlayGeometries;
        const m = this.overlayMaterials;
        this.overlays = {
            lastFrom: make(g.fill, m.lastMove),
            lastTo: make(g.fill, m.lastMove),
            check: make(g.glow, m.glow, 3),
            select: make(g.frame, m.select, 4),
            hover: make(g.thinFrame, m.hover, 4),
            cursor: make(g.brackets, m.cursor, 5),
            hintFrom: make(g.thinFrame, m.hint, 4),
            hintTo: make(g.frame, m.hint, 4)
        };
        this.markers = [];
        this.hintArrow = null;
    }

    placeOverlay(mesh, square) {
        if (!square) {
            mesh.visible = false;
            return;
        }
        const { x, z } = squareToWorld(square);
        mesh.position.x = x;
        mesh.position.z = z;
        mesh.visible = true;
    }

    // --- Pieces ---------------------------------------------------------------------------

    createPiece(type, color) {
        const mesh = new Mesh(this.pieceGeometries[type], this.materials[color]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { type, color, square: null };
        mesh.visible = true;
        // Knights show their profile, facing left from their owner's side.
        if (type === 'n') mesh.rotation.y = color === 'w' ? Math.PI : 0;
        // Clicks hit a low invisible drum around the foot, not the whole piece:
        // the crown of a king in front must not cover the pawn behind it.
        const picker = new Mesh(this.pickGeometry, this.pickMaterial);
        picker.userData.piece = mesh;
        mesh.add(picker);
        mesh.userData.picker = picker;
        this.scene.add(mesh);
        return mesh;
    }

    removePiece(mesh) {
        this.tweens.forEach(tween => { if (tween.mesh === mesh) this.tweens.delete(tween); });
        this.scene.remove(mesh);
    }

    restPosition(square) {
        const { x, z } = squareToWorld(square);
        return new Vector3(x, TILE_TOP, z);
    }

    trayPosition(capturer, index) {
        const column = Math.floor(index / 8);
        const row = index % 8;
        const side = capturer === 'w' ? 1 : -1;
        return new Vector3(side * (TRAY_X + column * 0.66), GROUND_Y, side * (3.3 - row * TRAY_STEP));
    }

    /**
     * Shows a position without animation.
     * @param {Array<{ square: string, type: string, color: string }>} pieces
     * @param {{ lastMove?: { from: string, to: string } | null, check?: string | null,
     *   captured?: { w: string[], b: string[] } }} [extras] captured.w lists what white took
     */
    setPosition(pieces, { lastMove = null, check = null, captured = null } = {}) {
        this.finishTweens();
        const wanted = new Map(pieces.map(piece => [piece.square, piece]));
        const free = [];
        this.pieces.forEach((mesh, square) => {
            const piece = wanted.get(square);
            if (piece && piece.type === mesh.userData.type && piece.color === mesh.userData.color) return;
            this.pieces.delete(square);
            free.push(mesh);
        });
        wanted.forEach((piece, square) => {
            if (this.pieces.has(square)) return;
            const index = free.findIndex(mesh => mesh.userData.type === piece.type && mesh.userData.color === piece.color);
            const mesh = index >= 0 ? free.splice(index, 1)[0] : this.createPiece(piece.type, piece.color);
            this.pieces.set(square, mesh);
        });
        free.forEach(mesh => this.removePiece(mesh));
        this.pieces.forEach((mesh, square) => {
            mesh.userData.square = square;
            mesh.position.copy(this.restPosition(square));
            mesh.scale.setScalar(1);
            mesh.material = this.materials[mesh.userData.color];
        });
        if (captured) this.setTrays(captured);
        this.lastMove = lastMove;
        this.checkSquare = check;
        if (this.selected && !this.pieces.has(this.selected)) this.selected = null;
        this.refreshOverlays();
        this.requestRender();
    }

    setTrays(captured) {
        ['w', 'b'].forEach(capturer => {
            const victimColor = capturer === 'w' ? 'b' : 'w';
            const types = captured[capturer] || [];
            const tray = this.trays[capturer];
            while (tray.length > types.length) this.removePiece(tray.pop());
            types.forEach((type, index) => {
                let mesh = tray[index];
                if (!mesh || mesh.userData.type !== type) {
                    if (mesh) this.removePiece(mesh);
                    mesh = this.createPiece(type, victimColor);
                    tray[index] = mesh;
                }
                mesh.position.copy(this.trayPosition(capturer, index));
                mesh.scale.setScalar(TRAY_SCALE);
                mesh.visible = this.traysInFrame !== false;
            });
        });
    }

    /**
     * Animates a move made by either side. `move` is a ChessGame move
     * (from, to, color, captureSquare, rookFrom/rookTo, promotion). Resolves
     * when everything has landed; the caller then confirms with setPosition().
     */
    animateMove(move) {
        return new Promise(resolve => {
            if (this.disposed) { resolve(); return; }
            this.clearSelection();
            const mesh = this.pieces.get(move.from);
            if (!mesh) { resolve(); return; }
            const jobs = [];
            const victim = move.captureSquare ? this.pieces.get(move.captureSquare) : null;
            if (victim && victim !== mesh) {
                this.pieces.delete(move.captureSquare);
                const capturer = move.color;
                const tray = this.trays[capturer];
                tray.push(victim);
                const slot = this.trayPosition(capturer, tray.length - 1);
                const job = this.tweenPiece(victim, slot, { delay: 170, duration: 520, arc: 1.4, scale: this.traysInFrame ? TRAY_SCALE : 0.01 });
                jobs.push(job.then(() => { victim.visible = this.traysInFrame !== false; victim.scale.setScalar(TRAY_SCALE); }));
            }
            this.pieces.delete(move.from);
            this.pieces.set(move.to, mesh);
            mesh.userData.square = move.to;
            const distance = mesh.position.distanceTo(this.restPosition(move.to));
            const arc = move.piece === 'n' ? 0.75 : 0.18 + Math.min(0.3, distance * 0.04);
            jobs.push(this.tweenPiece(mesh, this.restPosition(move.to), { duration: 230 + Math.min(260, distance * 55), arc }));
            if (move.rookFrom && move.rookTo) {
                const rook = this.pieces.get(move.rookFrom);
                if (rook) {
                    this.pieces.delete(move.rookFrom);
                    this.pieces.set(move.rookTo, rook);
                    rook.userData.square = move.rookTo;
                    jobs.push(this.tweenPiece(rook, this.restPosition(move.rookTo), { delay: 90, duration: 360, arc: 0.55 }));
                }
            }
            Promise.all(jobs).then(() => {
                if (move.promotion && !this.disposed) {
                    this.removePiece(mesh);
                    const promoted = this.createPiece(move.promotion, move.color);
                    promoted.position.copy(this.restPosition(move.to));
                    promoted.userData.square = move.to;
                    promoted.scale.setScalar(0.2);
                    this.pieces.set(move.to, promoted);
                    this.tweenPiece(promoted, promoted.position.clone(), { duration: 260, arc: 0, scale: 1 }).then(resolve);
                    return;
                }
                resolve();
            });
        });
    }

    /** Moves a mesh along a hop to `target`; also eases its scale. */
    tweenPiece(mesh, target, { delay = 0, duration = 300, arc = 0.2, scale = null } = {}) {
        return new Promise(resolve => {
            const tween = {
                mesh,
                from: mesh.position.clone(),
                to: target.clone(),
                fromScale: mesh.scale.x,
                toScale: scale ?? mesh.scale.x,
                arc,
                delay,
                duration: Math.max(1, duration),
                start: null,
                resolve,
                timer: null
            };
            // Hidden tabs stop animation frames; a timer lands the piece anyway.
            tween.timer = setTimeout(() => this.finishTween(tween), delay + duration + 200);
            this.tweens.add(tween);
            this.requestRender();
        });
    }

    stepTweens(time) {
        this.tweens.forEach(tween => {
            if (tween.start === null) tween.start = time + tween.delay;
            const elapsed = time - tween.start;
            if (elapsed < 0) return;
            const t = Math.min(1, elapsed / tween.duration);
            const eased = easeInOut(t);
            tween.mesh.position.lerpVectors(tween.from, tween.to, eased);
            tween.mesh.position.y += Math.sin(Math.PI * eased) * tween.arc;
            tween.mesh.scale.setScalar(tween.fromScale + (tween.toScale - tween.fromScale) * easeOut(t));
            if (t >= 1) this.finishTween(tween);
        });
        this.requestRender();
    }

    finishTween(tween) {
        if (!this.tweens.has(tween)) return;
        clearTimeout(tween.timer);
        this.tweens.delete(tween);
        tween.mesh.position.copy(tween.to);
        tween.mesh.scale.setScalar(tween.toScale);
        this.requestRender();
        tween.resolve();
    }

    finishTweens() {
        Array.from(this.tweens).forEach(tween => this.finishTween(tween));
    }

    isAnimating() {
        return this.tweens.size > 0;
    }

    // --- Selection and markers --------------------------------------------------------------

    select(square) {
        if (this.selected === square) return;
        this.selected = square;
        this.targets = square ? this.legalTargets(square) : [];
        this.refreshOverlays();
        this.onSelect(square);
    }

    clearSelection() {
        if (!this.selected && !this.targets.length) return;
        this.selected = null;
        this.targets = [];
        this.hovered = null;
        this.refreshOverlays();
        this.onSelect(null);
    }

    isTarget(square) {
        return this.targets.some(target => target.to === square);
    }

    refreshOverlays() {
        const o = this.overlays;
        this.placeOverlay(o.lastFrom, this.lastMove?.from || null);
        this.placeOverlay(o.lastTo, this.lastMove?.to || null);
        this.placeOverlay(o.check, this.checkSquare);
        this.placeOverlay(o.select, this.selected);
        this.placeOverlay(o.hover, this.hovered && this.hovered !== this.selected && this.isTarget(this.hovered) ? this.hovered : null);
        this.placeOverlay(o.cursor, this.cursorVisible ? this.cursor : null);
        this.placeOverlay(o.hintFrom, this.hint?.from || null);
        this.placeOverlay(o.hintTo, this.hint?.to || null);
        this.updateHintArrow();

        while (this.markers.length < this.targets.length) {
            const mesh = new Mesh(this.overlayGeometries.dot, this.overlayMaterials.markerOnLight);
            mesh.renderOrder = 3;
            mesh.position.y = TILE_TOP + 0.005;
            this.board.add(mesh);
            this.markers.push(mesh);
        }
        this.markers.forEach((mesh, index) => {
            const target = this.targets[index];
            if (!target) {
                mesh.visible = false;
                return;
            }
            const occupied = this.pieces.has(target.to) || target.capture;
            mesh.geometry = occupied ? this.overlayGeometries.ring : this.overlayGeometries.dot;
            mesh.material = squareShade(target.to) === 'dark' ? this.overlayMaterials.markerOnDark : this.overlayMaterials.markerOnLight;
            this.placeOverlay(mesh, target.to);
        });

        this.pieces.forEach((mesh, square) => {
            const lifted = square === this.selected && this.pointer?.mode !== 'drag';
            mesh.material = this.materials[lifted ? `${mesh.userData.color}Selected` : mesh.userData.color];
            // Only a piece resting on its own square is lifted or lowered here; a
            // dropped piece keeps its height until its move animation takes it.
            const rest = this.restPosition(square);
            const onSquare = Math.abs(mesh.position.x - rest.x) < 0.01 && Math.abs(mesh.position.z - rest.z) < 0.01;
            if (onSquare && !this.isTweening(mesh) && this.pointer?.mesh !== mesh) {
                mesh.position.y = TILE_TOP + (lifted ? LIFT : 0);
            }
        });
        this.requestRender();
    }

    isTweening(mesh) {
        for (const tween of this.tweens) if (tween.mesh === mesh) return true;
        return false;
    }

    /** Shows a suggested move as framed squares and an arrow; null hides it. */
    setHint(move) {
        this.hint = move ? { from: move.from, to: move.to } : null;
        this.refreshOverlays();
    }

    updateHintArrow() {
        if (this.hintArrow) {
            this.board.remove(this.hintArrow);
            this.hintArrow.geometry.dispose();
            this.hintArrow = null;
        }
        if (!this.hint) return;
        const from = squareToWorld(this.hint.from);
        const to = squareToWorld(this.hint.to);
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.5) return;
        const shaft = 0.075;
        const head = 0.32;
        const start = 0.28;
        const end = length - 0.2;
        const shape = new Shape();
        shape.moveTo(start, -shaft);
        shape.lineTo(end - head, -shaft);
        shape.lineTo(end - head, -head * 0.62);
        shape.lineTo(end, 0);
        shape.lineTo(end - head, head * 0.62);
        shape.lineTo(end - head, shaft);
        shape.lineTo(start, shaft);
        shape.closePath();
        const geometry = new ShapeGeometry(shape);
        // Shape x runs along the move; turn it from the board's +x onto the move.
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(-Math.atan2(dz, dx));
        geometry.translate(from.x, TILE_TOP + 0.012, from.z);
        this.hintArrow = new Mesh(geometry, this.overlayMaterials.hint);
        this.hintArrow.renderOrder = 6;
        this.board.add(this.hintArrow);
    }

    // --- Camera --------------------------------------------------------------------------------

    /** Keeps the board (and the captured pieces when there is room) in frame. */
    fitDistance(includeTrays) {
        const halfBoard = FRAME_SIZE / 2;
        const halfWidth = includeTrays ? TRAY_X + 0.9 : halfBoard;
        const points = [];
        [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
            points.push(new Vector3(sx * halfBoard, 0, sz * halfBoard));
            points.push(new Vector3(sx * halfBoard, GROUND_Y, sz * halfBoard));
            points.push(new Vector3(sx * 3.5, 1.5, sz * 3.5));
            if (includeTrays) points.push(new Vector3(sx * halfWidth, GROUND_Y + 0.9, sz * 3.4));
        }));
        const direction = this.viewDirection();
        let low = 4;
        let high = 80;
        for (let i = 0; i < 24; i++) {
            const mid = (low + high) / 2;
            this.placeCamera(direction, mid);
            const inside = points.every(point => {
                const projected = point.clone().project(this.camera);
                return Math.abs(projected.x) <= 0.95 && Math.abs(projected.y) <= 0.93 && projected.z < 1;
            });
            if (inside) high = mid; else low = mid;
        }
        return high;
    }

    viewDirection() {
        const { azimuth, elevation } = this.view;
        return new Vector3(
            Math.sin(azimuth) * Math.cos(elevation),
            Math.sin(elevation),
            Math.cos(azimuth) * Math.cos(elevation)
        );
    }

    placeCamera(direction, distance) {
        this.camera.position.copy(this.view.target).addScaledVector(direction, distance);
        this.camera.lookAt(this.view.target);
        this.camera.updateMatrixWorld();
        this.camera.updateProjectionMatrix();
    }

    updateCamera() {
        const aspect = this.camera.aspect;
        const traysInFrame = aspect >= 1.22;
        if (traysInFrame !== this.traysInFrame) {
            this.traysInFrame = traysInFrame;
            // On narrow screens the captured pieces live only in the page's lists.
            ['w', 'b'].forEach(capturer => this.trays[capturer].forEach(mesh => { mesh.visible = traysInFrame; }));
        }
        const distance = this.fitDistance(this.traysInFrame) * this.view.zoom;
        this.placeCamera(this.viewDirection(), distance);
        this.requestRender();
    }

    resize() {
        const width = this.host.clientWidth || 1;
        const height = this.host.clientHeight || 1;
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.updateCamera();
    }

    orbit(dx, dy) {
        this.view.azimuth -= dx * 0.0085;
        this.view.elevation = Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, this.view.elevation + dy * 0.0065));
        this.updateCamera();
    }

    zoomBy(factor) {
        this.view.zoom = Math.min(1.45, Math.max(0.7, this.view.zoom * factor));
        this.updateCamera();
    }

    /** Turns the camera to a side ('w' or 'b') and/or a preset ('3d' or 'top'). */
    setView({ orientation = this.orientation, mode = this.viewMode || '3d', animate = true } = {}) {
        this.orientation = orientation;
        this.viewMode = mode;
        const targetAzimuth = orientation === 'w' ? 0 : Math.PI;
        // Turn the short way round from wherever the player left the camera.
        let delta = (targetAzimuth - this.view.azimuth) % (Math.PI * 2);
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        const targetElevation = mode === 'top' ? TOP_ELEVATION : DEFAULT_ELEVATION;
        const from = { azimuth: this.view.azimuth, elevation: this.view.elevation, zoom: this.view.zoom };
        const to = { azimuth: this.view.azimuth + delta, elevation: targetElevation, zoom: 1 };
        if (!animate) {
            Object.assign(this.view, to);
            this.updateCamera();
            return;
        }
        this.cameraTween = { from, to, start: null, duration: 650 };
        this.requestRender();
    }

    stepCamera(time) {
        const tween = this.cameraTween;
        if (tween.start === null) tween.start = time;
        const t = Math.min(1, (time - tween.start) / tween.duration);
        const eased = easeInOut(t);
        ['azimuth', 'elevation', 'zoom'].forEach(key => {
            this.view[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * eased;
        });
        if (t >= 1) this.cameraTween = null;
        this.updateCamera();
    }

    // --- Loop ------------------------------------------------------------------------------------

    requestRender() {
        this.needsRender = true;
    }

    loop(time) {
        if (this.disposed) return;
        if (this.cameraTween) this.stepCamera(time);
        if (this.tweens.size) this.stepTweens(time);
        if (this.needsRender && this.ready) {
            this.needsRender = false;
            this.renderer.render(this.scene, this.camera);
        }
        this.frame = requestAnimationFrame(this.loop);
    }

    // --- Input -------------------------------------------------------------------------------------

    bindInput() {
        const canvas = this.canvas;
        this.handlers = {
            down: event => this.onPointerDown(event),
            move: event => this.onPointerMove(event),
            up: event => this.onPointerUp(event),
            leave: () => this.setHover(null),
            wheel: event => this.onWheel(event),
            key: event => this.onKeyDown(event),
            blur: () => {
                this.cursorVisible = false;
                this.refreshOverlays();
            }
        };
        canvas.addEventListener('pointerdown', this.handlers.down);
        canvas.addEventListener('pointermove', this.handlers.move);
        canvas.addEventListener('pointerup', this.handlers.up);
        canvas.addEventListener('pointercancel', this.handlers.up);
        canvas.addEventListener('pointerleave', this.handlers.leave);
        canvas.addEventListener('wheel', this.handlers.wheel, { passive: false });
        canvas.addEventListener('keydown', this.handlers.key);
        canvas.addEventListener('blur', this.handlers.blur);
    }

    pointerRay(event) {
        const rect = this.canvas.getBoundingClientRect();
        const ndc = new Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        this.scene.updateMatrixWorld();
        this.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(ndc, this.camera);
        return this.raycaster;
    }

    /** The square under the pointer: a piece's pick drum wins over the tile behind it. */
    squareAt(event) {
        const raycaster = this.pointerRay(event);
        const pickers = [...this.pieces.values()].map(mesh => mesh.userData.picker).filter(Boolean);
        const hit = raycaster.intersectObjects([...pickers, ...this.tiles], false)[0];
        if (!hit) return null;
        const piece = hit.object.userData.piece;
        return (piece ? piece.userData.square : hit.object.userData.square) || null;
    }

    /** Client coordinates of a point above a square (for tests and overlays). */
    screenPoint(square, height = 0.3) {
        const { x, z } = squareToWorld(square);
        this.camera.updateMatrixWorld();
        const projected = new Vector3(x, TILE_TOP + height, z).project(this.camera);
        const rect = this.canvas.getBoundingClientRect();
        return { x: rect.left + ((projected.x + 1) / 2) * rect.width, y: rect.top + ((1 - projected.y) / 2) * rect.height };
    }

    /**
     * Can the player pick and move now? A piece still landing does not block it
     * (the position it shows is already the new one); a turning camera does,
     * because the squares move under the pointer.
     */
    canAct() {
        return this.ready && this.interactive() && !this.cameraTween;
    }

    onPointerDown(event) {
        if (event.button !== 0 || this.pointer) return;
        const square = this.squareAt(event);
        const act = this.canAct();
        let intent = 'orbit';
        if (act && square && this.selected && this.isTarget(square)) intent = 'target';
        else if (act && square && this.selectable(square)) intent = 'piece';
        this.pointer = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            square,
            intent,
            mode: null,
            mesh: null
        };
        this.capturePointer('set', event.pointerId);
    }

    onPointerMove(event) {
        const pointer = this.pointer;
        if (!pointer) {
            // Hover picking is throttled to about one ray per frame.
            const now = event.timeStamp || 0;
            if (now - (this.lastHoverAt || 0) < 32) return;
            this.lastHoverAt = now;
            this.setHover(this.canAct() ? this.squareAt(event) : null);
            return;
        }
        if (event.pointerId !== pointer.id) return;
        const dx = event.clientX - pointer.startX;
        const dy = event.clientY - pointer.startY;
        if (!pointer.mode) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            if (pointer.intent === 'piece') {
                pointer.mode = 'drag';
                this.select(pointer.square);
                pointer.mesh = this.pieces.get(pointer.square) || null;
                this.canvas.classList.add('is-dragging-piece');
            } else {
                pointer.mode = 'orbit';
                this.canvas.classList.add('is-orbiting');
            }
        }
        if (pointer.mode === 'orbit') {
            this.orbit(event.clientX - pointer.lastX, event.clientY - pointer.lastY);
        } else if (pointer.mesh) {
            const point = new Vector3();
            if (this.pointerRay(event).ray.intersectPlane(this.dragPlane, point)) {
                const limit = 4.4;
                pointer.mesh.position.set(Math.max(-limit, Math.min(limit, point.x)), DRAG_HEIGHT, Math.max(-limit, Math.min(limit, point.z)));
                this.setHover(worldToSquare(point.x, point.z));
                this.requestRender();
            }
        }
        pointer.lastX = event.clientX;
        pointer.lastY = event.clientY;
    }

    onPointerUp(event) {
        const pointer = this.pointer;
        if (!pointer || event.pointerId !== pointer.id) return;
        this.pointer = null;
        this.capturePointer('release', event.pointerId);
        this.canvas.classList.remove('is-dragging-piece', 'is-orbiting');
        if (pointer.mode === 'drag') {
            const drop = this.hovered;
            this.setHover(null);
            if (drop && drop !== pointer.square && this.isTarget(drop)) {
                this.onMove({ from: pointer.square, to: drop });
            } else if (pointer.mesh) {
                const back = this.restPosition(pointer.square);
                back.y += LIFT;
                this.tweenPiece(pointer.mesh, back, { duration: 180, arc: 0.05 }).then(() => this.refreshOverlays());
            }
            return;
        }
        if (pointer.mode === 'orbit') return;
        this.activateSquare(pointer.square, pointer.intent);
    }

    /** A click or Enter on a square: pick a piece, move the picked one, or let go. */
    activateSquare(square, intent = null) {
        if (!square) {
            this.clearSelection();
            return;
        }
        const act = this.canAct();
        const resolved = intent || (act && this.selected && this.isTarget(square) ? 'target'
            : act && this.selectable(square) ? 'piece' : 'none');
        if (resolved === 'target' && this.selected) {
            this.onMove({ from: this.selected, to: square });
        } else if (resolved === 'piece') {
            if (this.selected === square) this.clearSelection();
            else this.select(square);
        } else {
            this.clearSelection();
        }
    }

    capturePointer(action, pointerId) {
        try {
            this.canvas[`${action}PointerCapture`]?.(pointerId);
        } catch { /* Dragging still works without capture. */ }
    }

    setHover(square) {
        if (this.hovered === square) return;
        this.hovered = square;
        const own = square && this.canAct() && this.selectable(square);
        const target = square && this.isTarget(square);
        this.canvas.classList.toggle('is-pointing', Boolean(own || target));
        this.refreshOverlays();
    }

    onWheel(event) {
        // Ctrl + wheel (and trackpad pinch) zooms; a plain wheel scrolls the page.
        if (!event.ctrlKey) return;
        event.preventDefault();
        this.zoomBy(Math.exp(event.deltaY * 0.0022));
    }

    onKeyDown(event) {
        const steps = {
            ArrowUp: [0, 1],
            ArrowDown: [0, -1],
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0]
        };
        if (steps[event.code]) {
            event.preventDefault();
            const [df, dr] = steps[event.code];
            const flip = this.orientation === 'b' ? -1 : 1;
            const start = this.cursor || this.selected || (this.orientation === 'w' ? 'e2' : 'e7');
            let file = start.charCodeAt(0) - 97;
            let rank = Number(start[1]) - 1;
            if (this.cursorVisible) {
                file = Math.max(0, Math.min(7, file + df * flip));
                rank = Math.max(0, Math.min(7, rank + dr * flip));
            }
            this.cursor = FILES[file] + (rank + 1);
            this.cursorVisible = true;
            this.refreshOverlays();
            this.onCursor(this.cursor);
            return;
        }
        if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
            event.preventDefault();
            if (!this.cursorVisible) {
                this.cursor = this.cursor || this.selected || (this.orientation === 'w' ? 'e2' : 'e7');
                this.cursorVisible = true;
                this.refreshOverlays();
                this.onCursor(this.cursor);
                return;
            }
            this.activateSquare(this.cursor);
            return;
        }
        if (event.code === 'Escape' && this.selected) {
            event.preventDefault();
            event.stopPropagation();
            this.clearSelection();
        }
    }

    // --- Teardown ------------------------------------------------------------------------------

    dispose() {
        this.disposed = true;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.tweens.forEach(tween => clearTimeout(tween.timer));
        this.tweens.clear();
        this.resizeObserver?.disconnect();
        const canvas = this.canvas;
        canvas.removeEventListener('pointerdown', this.handlers.down);
        canvas.removeEventListener('pointermove', this.handlers.move);
        canvas.removeEventListener('pointerup', this.handlers.up);
        canvas.removeEventListener('pointercancel', this.handlers.up);
        canvas.removeEventListener('pointerleave', this.handlers.leave);
        canvas.removeEventListener('wheel', this.handlers.wheel);
        canvas.removeEventListener('keydown', this.handlers.key);
        canvas.removeEventListener('blur', this.handlers.blur);
        this.hintArrow?.geometry.dispose();
        this.disposables.forEach(geometry => geometry.dispose());
        Object.values(this.overlayGeometries).forEach(geometry => geometry.dispose());
        Object.values(this.overlayMaterials).forEach(material => material.dispose());
        Object.values(this.pieceGeometries).forEach(geometry => geometry.dispose());
        this.pickGeometry.dispose();
        this.pickMaterial.dispose();
        Object.values(this.materials).forEach(material => material.dispose());
        [this.lightStone, this.darkStone, this.labels, this.glow].forEach(texture => texture.dispose());
        this.environment.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss?.();
        canvas.remove();
    }
}

export const CHESS_BOARD_CONSTANTS = Object.freeze({ TILE_TOP, GROUND_Y, PIECE_HEIGHTS });
