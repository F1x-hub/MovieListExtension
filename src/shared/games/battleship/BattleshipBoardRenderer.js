import {
    AdditiveBlending,
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
    RepeatWrapping,
    RingGeometry,
    Scene,
    ShadowMaterial,
    Shape,
    ShapeGeometry,
    SphereGeometry,
    SRGBColorSpace,
    Vector2,
    Vector3,
    WebGLRenderer
} from '../../../../libs/three.games.min.js';
import { BattleshipBoard } from './BattleshipBoard.js';
import { SHIP_DECK, SHIP_LENGTH, SHIP_PARTS, createShipModels, disposeShipModels } from './BattleshipShipModels.js';

/**
 * One Battleship board drawn with WebGL: a basin of moving water inside a
 * graphite frame with the coordinates engraved on it, warships that ride the
 * waves, misses as white dots, hits as red crosses with fire, sunk ships as
 * dark wrecks, and splashes and blasts when a shot lands.
 *
 * It keeps the interface of BattleshipBoard (`update`, `setActiveIndex`,
 * `focusCell`, `cellFromPoint`, `grid`, `destroy`) and keeps a BattleshipBoard
 * inside: an invisible ARIA grid that owns keyboard focus and what screen
 * readers hear, while the canvas takes the pointer. When WebGL is missing or
 * its context is lost, that grid is shown and the board plays on flat.
 *
 * Board colours are game content (docs/design-system.md, exception 3).
 */

const SIZE = 10;
const RIM = 0.92;
const FRAME_OUTER = SIZE + RIM * 2;
const FRAME_DEPTH = 0.3;
const FRAME_BEVEL = 0.05;
const FRAME_TOP = 0.1;
const GROUND_Y = FRAME_TOP - FRAME_DEPTH - FRAME_BEVEL * 2 - 0.01;
const OVERLAY_Y = 0.05;
const CROSS_Y = Object.freeze({ water: 0.064, ship: 0.36, wreck: 0.24 });
const PREVIEW_LIFT = 0.08;
const IMPACT_DELAY_MS = 120;
const IDLE_FRAME_MS = 32;
const VIEW_ELEVATION = Object.freeze({ '3d': 0.9, top: 1.5 });
export const WAVE_AMPLITUDE = 0.03;

const MARK = Object.freeze({ UNKNOWN: '.', MISS: 'o', HIT: 'x', SUNK: '#', CLEAR: '*' });
const DEFAULT_COLUMNS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);

const PALETTE = Object.freeze({
    seaOwn: '#1f3d4f',
    seaEnemy: '#1a3243',
    gridLine: '#d3e3ec',
    frame: '#1b1e23',
    trim: '#9aa1ab',
    label: 'rgba(200, 207, 216, 0.95)',
    hull: '#a9afb7',
    deck: '#565c64',
    structure: '#cfd3d8',
    metal: '#2d3137',
    wreckHull: '#5b6067',
    wreckDeck: '#2b2e33',
    wreckStructure: '#6a6f76',
    wreckMetal: '#1c1e21',
    ghost: '#d5dae1',
    preview: '#eef2f6',
    danger: '#e5484d',
    miss: '#eef2f6',
    clear: '#8f979f',
    marker: '#ffffff',
    flame: '#ff7a2e',
    flameCore: '#ffd27a',
    smoke: '#7b8189',
    debris: '#3a3d42',
    foam: '#f3f6f9'
});

// Sum of four travelling sines; the shader and the ships share it, so hulls ride
// the same swell the water shows.
const WAVE_GLSL = `
float bsWaveHeight(vec2 p, float t) {
    return 0.55 * sin(0.9 * p.x + 1.3 * t)
        + 0.35 * sin(1.4 * p.y - 1.1 * t + 0.7)
        + 0.25 * sin(1.9 * (p.x + p.y) + 1.7 * t + 1.3)
        + 0.12 * sin(3.1 * p.x - 2.3 * p.y + 2.1 * t);
}
vec2 bsWaveSlope(vec2 p, float t) {
    float c = 0.475 * cos(1.9 * (p.x + p.y) + 1.7 * t + 1.3);
    float d = 0.12 * cos(3.1 * p.x - 2.3 * p.y + 2.1 * t);
    return vec2(
        0.495 * cos(0.9 * p.x + 1.3 * t) + c + 3.1 * d,
        0.49 * cos(1.4 * p.y - 1.1 * t + 0.7) + c - 2.3 * d
    );
}`;

/** Unscaled swell height at a board point (x, z) and time t in seconds. */
export function waveHeight(x, z, t) {
    return 0.55 * Math.sin(0.9 * x + 1.3 * t)
        + 0.35 * Math.sin(1.4 * z - 1.1 * t + 0.7)
        + 0.25 * Math.sin(1.9 * (x + z) + 1.7 * t + 1.3)
        + 0.12 * Math.sin(3.1 * x - 2.3 * z + 2.1 * t);
}

/** d(waveHeight)/dx and d(waveHeight)/dz. */
export function waveSlope(x, z, t) {
    const c = 0.475 * Math.cos(1.9 * (x + z) + 1.7 * t + 1.3);
    const d = 0.12 * Math.cos(3.1 * x - 2.3 * z + 2.1 * t);
    return {
        x: 0.495 * Math.cos(0.9 * x + 1.3 * t) + c + 3.1 * d,
        z: 0.49 * Math.cos(1.4 * z - 1.1 * t + 0.7) + c - 2.3 * d
    };
}

/** Board-space centre of a cell: column A on the left (-x), row 1 at the far side (-z). */
export function cellCenter(index, size = SIZE) {
    const column = index % size;
    const row = Math.floor(index / size);
    return { x: column - (size - 1) / 2, z: row - (size - 1) / 2 };
}

export function cellAtWorld(x, z, size = SIZE) {
    const column = Math.floor(x + size / 2);
    const row = Math.floor(z + size / 2);
    if (!Number.isFinite(column) || !Number.isFinite(row)) return null;
    if (column < 0 || row < 0 || column >= size || row >= size) return null;
    return row * size + column;
}

/**
 * Where a ship model goes: the centre of its cells and its heading. Models lie
 * along +x with the bow forward, so horizontal ships face right and vertical
 * ones turn to face the far side.
 */
export function shipPose(ship, size = SIZE) {
    const offset = (ship.length - 1) / 2;
    const column = ship.vertical ? ship.x : ship.x + offset;
    const row = ship.vertical ? ship.y + offset : ship.y;
    return {
        x: column - (size - 1) / 2,
        z: row - (size - 1) / 2,
        rotationY: ship.vertical ? Math.PI / 2 : 0,
        bow: ship.vertical ? { x: 0, z: -1 } : { x: 1, z: 0 }
    };
}

export function shipKey(ship) {
    return `${ship.x},${ship.y},${ship.length},${ship.vertical ? 'v' : 'h'}`;
}

/** The ship a placement preview shows, from the cells it covers. */
export function shipFromCells(cells, size = SIZE) {
    if (!Array.isArray(cells) || !cells.length) return null;
    const sorted = [...cells].sort((a, b) => a - b);
    const vertical = sorted.length > 1 && sorted[1] - sorted[0] === size;
    return { x: sorted[0] % size, y: Math.floor(sorted[0] / size), length: sorted.length, vertical };
}

function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return hash >>> 0;
}

const clamp01 = value => Math.min(1, Math.max(0, value));
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const easeOut = t => 1 - (1 - t) ** 3;

function lay(geometry) {
    geometry.rotateX(-Math.PI / 2);
    return geometry;
}

function roundedRectShape(width, height, radius) {
    const x = -width / 2;
    const y = -height / 2;
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

function frameShape(outer, width, radius) {
    const shape = roundedRectShape(outer, outer, radius);
    shape.holes.push(roundedRectShape(outer - width * 2, outer - width * 2, Math.max(0.01, radius - width)));
    return shape;
}

/** Four corner brackets: the keyboard cursor. */
function bracketShapes(size, arm, width) {
    const half = size / 2;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
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
        return shape;
    });
}

/** Four short bars around a ring: the sight over the cell about to be shot. */
function tickShapes(inner, outer, width) {
    const w = width / 2;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => {
        const shape = new Shape();
        if (dx) {
            shape.moveTo(dx * inner, -w);
            shape.lineTo(dx * outer, -w);
            shape.lineTo(dx * outer, w);
            shape.lineTo(dx * inner, w);
        } else {
            shape.moveTo(-w, dy * inner);
            shape.lineTo(-w, dy * outer);
            shape.lineTo(w, dy * outer);
            shape.lineTo(w, dy * inner);
        }
        shape.closePath();
        return shape;
    });
}

/** A diagonal cross: a plus sign of `size` with arms `thickness` wide, turned 45°. */
function crossShape(size, thickness) {
    const a = size / 2;
    const h = thickness / 2;
    const points = [[h, h], [h, a], [-h, a], [-h, h], [-a, h], [-a, -h], [-h, -h], [-h, -a], [h, -a], [h, -h], [a, -h], [a, h]];
    const c = Math.SQRT1_2;
    const shape = new Shape();
    points.forEach(([x, y], index) => {
        const px = (x - y) * c;
        const py = (x + y) * c;
        if (index === 0) shape.moveTo(px, py);
        else shape.lineTo(px, py);
    });
    shape.closePath();
    return shape;
}

function canvas2d(doc, width, height = width) {
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { canvas, ctx: canvas.getContext('2d') };
}

/** Tileable ripples as a normal map: integer frequencies wrap seamlessly. */
function rippleTexture(doc) {
    const size = 256;
    const { canvas, ctx } = canvas2d(doc, size);
    const image = ctx.createImageData(size, size);
    const random = mulberry32(7);
    const tau = Math.PI * 2;
    const waves = Array.from({ length: 10 }, () => ({
        fx: Math.round(1 + random() * 6) * (random() < 0.5 ? -1 : 1),
        fy: Math.round(1 + random() * 6) * (random() < 0.5 ? -1 : 1),
        phase: random() * tau,
        amp: 0.35 + random() * 0.65
    }));
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            let dx = 0;
            let dy = 0;
            for (const wave of waves) {
                const c = Math.cos(tau * (wave.fx * i / size + wave.fy * j / size) + wave.phase) * wave.amp;
                dx += c * wave.fx;
                dy += c * wave.fy;
            }
            const nx = -dx * 0.05;
            const ny = -dy * 0.05;
            const length = Math.hypot(nx, ny, 1);
            const offset = (j * size + i) * 4;
            image.data[offset] = ((nx / length) * 0.5 + 0.5) * 255;
            image.data[offset + 1] = ((ny / length) * 0.5 + 0.5) * 255;
            image.data[offset + 2] = ((1 / length) * 0.5 + 0.5) * 255;
            image.data[offset + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(5, 5);
    return texture;
}

/** Column letters along the far and near rims, row numbers along the sides. */
function labelTexture(doc, columns) {
    const size = 1024;
    const { canvas, ctx } = canvas2d(doc, size);
    const unit = size / FRAME_OUTER;
    const toPixel = value => (value / FRAME_OUTER + 0.5) * size;
    ctx.fillStyle = PALETTE.label;
    ctx.font = `600 ${Math.round(unit * 0.38)}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const edge = SIZE / 2 + RIM * 0.5;
    for (let i = 0; i < SIZE; i++) {
        const offset = i - (SIZE - 1) / 2;
        const letter = String(columns[i] ?? DEFAULT_COLUMNS[i]);
        ctx.fillText(letter, toPixel(offset), toPixel(-edge));
        ctx.fillText(letter, toPixel(offset), toPixel(edge));
        ctx.fillText(String(i + 1), toPixel(-edge), toPixel(offset));
        ctx.fillText(String(i + 1), toPixel(edge), toPixel(offset));
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

/** A soft round blot for smoke. */
function softTexture(doc) {
    const size = 128;
    const { canvas, ctx } = canvas2d(doc, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.55)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/** Diagonal stripes: a refused placement is hatched, not only red. */
function hatchTexture(doc) {
    const size = 64;
    const { canvas, ctx } = canvas2d(doc, size);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 7;
    for (let k = -size; k <= size * 2; k += 21) {
        ctx.beginPath();
        ctx.moveTo(k, 0);
        ctx.lineTo(k - size, size);
        ctx.stroke();
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/** A dim room with soft boxes for reflections on water and steel. */
function studioEnvironment(renderer) {
    const pmrem = new PMREMGenerator(renderer);
    const room = new Scene();
    const disposables = [];
    const roomGeometry = new BoxGeometry(24, 14, 24);
    const roomMaterial = new MeshBasicMaterial({ color: new Color(0.13, 0.15, 0.17), side: BackSide });
    disposables.push(roomGeometry, roomMaterial);
    room.add(new Mesh(roomGeometry, roomMaterial));
    const panel = (width, height, position, intensity) => {
        const geometry = new PlaneGeometry(width, height);
        const material = new MeshBasicMaterial({ color: new Color(intensity * 0.96, intensity, intensity * 1.04) });
        disposables.push(geometry, material);
        const mesh = new Mesh(geometry, material);
        mesh.position.set(...position);
        mesh.lookAt(0, 0, 0);
        room.add(mesh);
    };
    panel(12, 4, [0, 6.6, -2], 4.6);
    panel(4, 6, [-10, 3, 3], 2.2);
    panel(4, 6, [10, 3, -3], 1.6);
    panel(9, 2.5, [0, 2.5, 11], 1.3);
    const target = pmrem.fromScene(room, 0.04);
    disposables.forEach(item => item.dispose());
    pmrem.dispose();
    return target;
}

let supportCache = null;

export class BattleshipBoardRenderer {
    /** WebGL 2 is available (three.js needs it). Probed once per page. */
    static isSupported(doc = globalThis.document) {
        if (supportCache !== null) return supportCache;
        supportCache = false;
        if (typeof globalThis.WebGL2RenderingContext === 'undefined' || !doc?.createElement) return supportCache;
        try {
            const context = doc.createElement('canvas').getContext('webgl2');
            supportCache = Boolean(context);
            context?.getExtension('WEBGL_lose_context')?.loseContext();
        } catch {
            supportCache = false;
        }
        return supportCache;
    }

    /**
     * @param {HTMLElement} root - an empty container that the board fills
     * @param {Object} options - the BattleshipBoard options, plus:
     * @param {'own'|'enemy'} [options.side]
     * @param {'3d'|'top'} [options.view]
     * @param {string} [options.loadingLabel]
     * @param {() => void} [options.onReady] - the first frame is on screen
     */
    constructor(root, options) {
        this.root = root;
        this.options = options;
        this.rules = options.rules;
        this.side = options.side === 'enemy' ? 'enemy' : 'own';
        this.doc = root.ownerDocument || globalThis.document;
        this.size = this.rules.SIZE;
        this.cellCount = this.size * this.size;
        this.disposed = false;
        this.flat = false;
        this.ready = false;
        this.primed = false;
        this.needsRender = true;
        this.frame = null;
        this.state = {
            marks: null, ships: [], preview: null, lastIndex: null, pendingIndex: null,
            interactive: false, canTarget: null, dragging: false, revealed: false
        };
        this.markSnapshot = new Array(this.cellCount).fill(MARK.UNKNOWN);
        this.hoverIndex = null;
        this.focusVisible = false;
        this.ships = new Map();
        this.cellShip = new Map();
        this.markers = new Map();
        this.fires = new Map();
        this.effects = new Set();
        this.viewMode = options.view === 'top' ? 'top' : '3d';
        this.time = 0;

        this.container = this.doc.createElement('div');
        this.container.className = 'bs-board3d';
        this.container.dataset.side = this.side;
        this.a11y = this.doc.createElement('div');
        this.a11y.className = 'bs-board3d__a11y';
        this.container.append(this.a11y);
        root.replaceChildren(this.container);
        this.dom = new BattleshipBoard(this.a11y, options);
        this.grid = this.dom.grid;

        try {
            this.initScene();
        } catch (error) {
            console.warn('[Battleship] 3D board unavailable, using the flat board:', error);
            this.fallBack();
        }
    }

    get activeIndex() {
        return this.dom.activeIndex;
    }

    get cells() {
        return this.dom.cells;
    }

    // --- Setup ------------------------------------------------------------------------------

    initScene() {
        const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer = renderer;
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = NeutralToneMapping;
        renderer.toneMappingExposure = 1;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;
        renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
        this.canvas = renderer.domElement;
        this.canvas.className = 'bs-board3d__canvas';
        this.canvas.setAttribute('aria-hidden', 'true');
        this.container.prepend(this.canvas);
        this.container.classList.add('is-3d', 'is-loading');
        this.loader = this.doc.createElement('div');
        this.loader.className = 'bs-board3d__loading';
        this.loader.innerHTML = '<div class="app-loader app-loader--section" role="status"><div class="app-loader__indicator" aria-hidden="true"></div><span class="app-loader__label"></span></div>';
        this.loader.querySelector('.app-loader__label').textContent = this.options.loadingLabel || '';
        this.container.append(this.loader);

        this.motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
        this.motion = !this.motionQuery?.matches;
        this.uniforms = { time: { value: 0 }, wave: { value: this.motion ? WAVE_AMPLITUDE : 0 } };

        this.scene = new Scene();
        this.environment = studioEnvironment(renderer);
        this.scene.environment = this.environment.texture;
        this.scene.environmentIntensity = 0.7;
        this.camera = new PerspectiveCamera(30, 1, 0.1, 200);
        this.view = { elevation: VIEW_ELEVATION[this.viewMode], target: new Vector3(0, 0, 0.25) };

        this.buildLights();
        this.buildMaterials();
        this.buildBoard();
        this.buildOverlays();

        this.raycaster = new Raycaster();
        this.waterPlane = new Plane(new Vector3(0, 1, 0), 0);
        this.bindInput();
        this.visible = true;
        this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
        this.resizeObserver?.observe(this.container);
        this.intersection = typeof IntersectionObserver === 'function'
            ? new IntersectionObserver(entries => {
                this.visible = entries[entries.length - 1].isIntersecting;
                if (this.visible) this.requestRender();
            })
            : null;
        this.intersection?.observe(this.container);
        this.resize();
        this.loop = this.loop.bind(this);
        this.warmUp();
        this.frame = requestAnimationFrame(this.loop);
    }

    /**
     * Compiles every material before the first frame, in parallel where the
     * browser can, so neither the first frame nor the first shot stalls. The
     * board renders once that is done (at most 5 s).
     */
    warmUp() {
        const extras = [];
        const add = (geometry, material) => {
            const mesh = new Mesh(geometry, material);
            mesh.visible = false;
            this.scene.add(mesh);
            extras.push(mesh);
        };
        const model = this.shipModels[2];
        ['solid', 'wreck', 'ghost', 'valid', 'invalid'].forEach(look => {
            SHIP_PARTS.forEach(part => add(model[part], this.shipMaterials[look][part]));
        });
        [...Object.values(this.effectMaterials), ...Object.values(this.fireMaterials)].forEach(material => add(this.overlayGeometries.puff, material));
        [this.overlayMaterials.miss, this.overlayMaterials.clear, this.overlayMaterials.cross,
            this.overlayMaterials.previewValid, this.overlayMaterials.previewInvalid].forEach(material => add(this.overlayGeometries.fill, material));
        const finish = () => {
            if (this.ready || this.disposed || this.flat) return;
            clearTimeout(this.warmTimer);
            this.ready = true;
            extras.forEach(mesh => this.scene.remove(mesh));
            this.loader?.remove();
            this.loader = null;
            this.container.classList.remove('is-loading');
            this.requestRender();
            this.options.onReady?.();
        };
        this.warmTimer = setTimeout(finish, 5000);
        try {
            const compiling = this.renderer.compileAsync?.(this.scene, this.camera);
            if (compiling) compiling.then(finish, finish);
            else finish();
        } catch (error) {
            console.warn('[Battleship] shader warm-up failed', error);
            finish();
        }
    }

    buildLights() {
        this.scene.add(new HemisphereLight('#e6eef5', '#1b2128', 0.55));
        const key = new DirectionalLight('#ffffff', 2.4);
        key.position.set(-5, 11, 7);
        key.castShadow = true;
        key.shadow.mapSize.set(1536, 1536);
        key.shadow.camera.left = -8.5;
        key.shadow.camera.right = 8.5;
        key.shadow.camera.top = 8.5;
        key.shadow.camera.bottom = -8.5;
        key.shadow.camera.near = 2;
        key.shadow.camera.far = 30;
        key.shadow.radius = 3;
        key.shadow.bias = -0.0005;
        key.shadow.normalBias = 0.02;
        this.scene.add(key);
        const fill = new DirectionalLight('#d6e3ef', 0.45);
        fill.position.set(7, 5, -6);
        this.scene.add(fill);
    }

    buildMaterials() {
        this.textures = {
            ripple: rippleTexture(this.doc),
            labels: labelTexture(this.doc, this.options.columns || DEFAULT_COLUMNS),
            soft: softTexture(this.doc),
            hatch: hatchTexture(this.doc)
        };
        const sea = new MeshPhysicalMaterial({
            color: new Color(this.side === 'enemy' ? PALETTE.seaEnemy : PALETTE.seaOwn),
            roughness: 0.34,
            metalness: 0,
            clearcoat: 0.45,
            clearcoatRoughness: 0.22,
            envMapIntensity: 0.36,
            normalMap: this.textures.ripple,
            normalScale: new Vector2(0.12, 0.12)
        });
        sea.onBeforeCompile = shader => this.patchSea(shader);
        sea.customProgramCacheKey = () => 'battleship-sea';
        this.materials = {
            sea,
            frame: new MeshPhysicalMaterial({ color: new Color(PALETTE.frame), roughness: 0.42, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
            trim: new MeshStandardMaterial({ color: new Color(PALETTE.trim), roughness: 0.3, metalness: 0.9 }),
            labels: new MeshBasicMaterial({ map: this.textures.labels, transparent: true, depthWrite: false, toneMapped: false }),
            ground: new ShadowMaterial({ opacity: 0.3 })
        };
        const lit = (color, roughness, metalness) => new MeshStandardMaterial({ color: new Color(color), roughness, metalness });
        const see = (color, opacity) => new MeshStandardMaterial({ color: new Color(color), roughness: 0.6, metalness: 0.05, transparent: true, opacity });
        const ghost = see(PALETTE.ghost, 0.42);
        const valid = see(PALETTE.preview, 0.62);
        const invalid = see(PALETTE.danger, 0.62);
        const same = material => Object.fromEntries(SHIP_PARTS.map(part => [part, material]));
        this.shipMaterials = {
            solid: {
                hull: lit(PALETTE.hull, 0.5, 0.35),
                deck: lit(PALETTE.deck, 0.8, 0.05),
                structure: lit(PALETTE.structure, 0.45, 0.25),
                metal: lit(PALETTE.metal, 0.4, 0.6)
            },
            wreck: {
                hull: lit(PALETTE.wreckHull, 0.85, 0.2),
                deck: lit(PALETTE.wreckDeck, 0.95, 0),
                structure: lit(PALETTE.wreckStructure, 0.85, 0.15),
                metal: lit(PALETTE.wreckMetal, 0.8, 0.3)
            },
            ghost: same(ghost),
            valid: same(valid),
            invalid: same(invalid)
        };
        this.shipModels = createShipModels();
        const glow = color => new MeshBasicMaterial({
            color: new Color(color), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, toneMapped: false
        });
        // Templates; every effect animates its own clones.
        this.effectMaterials = {
            foam: new MeshBasicMaterial({ color: new Color(PALETTE.foam), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
            smoke: new MeshBasicMaterial({ map: this.textures.soft, color: new Color(PALETTE.smoke), transparent: true, opacity: 0.7, depthWrite: false }),
            flash: glow(PALETTE.flameCore),
            flame: glow(PALETTE.flame),
            flameCore: glow(PALETTE.flameCore),
            streak: glow('#fff1d0'),
            debris: new MeshStandardMaterial({ color: new Color(PALETTE.debris), roughness: 0.7, metalness: 0.3 })
        };
        const onTop = color => {
            const material = glow(color);
            material.depthTest = false;
            return material;
        };
        this.fireMaterials = { flame: onTop(PALETTE.flame), core: onTop(PALETTE.flameCore) };
    }

    /** Swell, ripple normals and the grid lines, painted on the water itself. */
    patchSea(shader) {
        shader.uniforms.uBsTime = this.uniforms.time;
        shader.uniforms.uBsWave = this.uniforms.wave;
        shader.uniforms.uBsLine = { value: new Color(PALETTE.gridLine) };
        shader.uniforms.uBsLineAlpha = { value: this.side === 'enemy' ? 0.36 : 0.28 };
        const half = (SIZE / 2).toFixed(1);
        const span = SIZE.toFixed(1);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\nuniform float uBsTime;\nuniform float uBsWave;\nvarying vec2 vBsBoard;\n${WAVE_GLSL}`)
            .replace('#include <beginnormal_vertex>', [
                'vec2 bsSlope = bsWaveSlope(position.xz, uBsTime) * uBsWave;',
                'vec3 objectNormal = normalize(vec3(-bsSlope.x, 1.0, -bsSlope.y));',
                '#ifdef USE_TANGENT',
                'vec3 objectTangent = vec3(tangent.xyz);',
                '#endif'
            ].join('\n'))
            .replace('#include <begin_vertex>', [
                'vec3 transformed = vec3(position);',
                'transformed.y += bsWaveHeight(position.xz, uBsTime) * uBsWave;',
                'vBsBoard = position.xz;'
            ].join('\n'));
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 uBsLine;\nuniform float uBsLineAlpha;\nvarying vec2 vBsBoard;')
            .replace('#include <color_fragment>', [
                '#include <color_fragment>',
                `vec2 bsCell = vBsBoard + ${half};`,
                'vec2 bsEdge = abs(bsCell - floor(bsCell + 0.5));',
                'vec2 bsWidth = fwidth(bsCell);',
                'vec2 bsLines = 1.0 - smoothstep(bsWidth * 0.55, bsWidth * 1.5 + 0.01, bsEdge);',
                `float bsInside = step(-0.03, bsCell.x) * step(bsCell.x, ${span} + 0.03) * step(-0.03, bsCell.y) * step(bsCell.y, ${span} + 0.03);`,
                'float bsLine = max(bsLines.x, bsLines.y) * bsInside * uBsLineAlpha;',
                'diffuseColor.rgb = mix(diffuseColor.rgb, uBsLine, bsLine);'
            ].join('\n'))
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uBsLine * bsLine * 0.2;');
    }

    buildBoard() {
        this.board = new Group();
        this.scene.add(this.board);
        this.disposables = [];

        const outer = FRAME_OUTER - FRAME_BEVEL * 2;
        const hole = SIZE + 0.08 + FRAME_BEVEL * 2;
        const frameGeometry = lay(new ExtrudeGeometry(frameShape(outer, (outer - hole) / 2, 0.34), {
            depth: FRAME_DEPTH,
            bevelEnabled: true,
            bevelThickness: FRAME_BEVEL,
            bevelSize: FRAME_BEVEL,
            bevelSegments: 3,
            curveSegments: 8
        }));
        frameGeometry.translate(0, FRAME_TOP - FRAME_DEPTH - FRAME_BEVEL, 0);
        const frame = new Mesh(frameGeometry, this.materials.frame);
        frame.castShadow = true;
        frame.receiveShadow = true;
        this.board.add(frame);
        this.disposables.push(frameGeometry);

        const trimGeometry = lay(new ExtrudeGeometry(frameShape(SIZE + 0.34, 0.07, 0.05), {
            depth: 0.012,
            bevelEnabled: true,
            bevelThickness: 0.006,
            bevelSize: 0.006,
            bevelSegments: 2
        }));
        trimGeometry.translate(0, FRAME_TOP, 0);
        const trim = new Mesh(trimGeometry, this.materials.trim);
        this.board.add(trim);
        this.disposables.push(trimGeometry);

        const labelGeometry = lay(new PlaneGeometry(FRAME_OUTER, FRAME_OUTER));
        const labels = new Mesh(labelGeometry, this.materials.labels);
        labels.position.y = FRAME_TOP + 0.003;
        labels.renderOrder = 1;
        this.board.add(labels);
        this.disposables.push(labelGeometry);

        const seaGeometry = lay(new PlaneGeometry(SIZE + 0.16, SIZE + 0.16, 72, 72));
        const sea = new Mesh(seaGeometry, this.materials.sea);
        sea.receiveShadow = true;
        this.board.add(sea);
        this.sea = sea;
        this.disposables.push(seaGeometry);

        const groundGeometry = lay(new PlaneGeometry(60, 60));
        const ground = new Mesh(groundGeometry, this.materials.ground);
        ground.position.y = GROUND_Y;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.disposables.push(groundGeometry);

        this.shipLayer = new Group();
        this.markerLayer = new Group();
        this.effectLayer = new Group();
        this.scene.add(this.shipLayer, this.markerLayer, this.effectLayer);
    }

    buildOverlays() {
        const cone = (radius, height) => {
            const geometry = new CylinderGeometry(0, radius, height, 10, 1, true);
            geometry.translate(0, height / 2, 0);
            return geometry;
        };
        const column = new CylinderGeometry(0.07, 0.11, 1, 14, 1, true);
        column.translate(0, 0.5, 0);
        const streak = new CylinderGeometry(0.014, 0.005, 1, 6);
        streak.translate(0, 0.5, 0);
        this.overlayGeometries = {
            fill: lay(new PlaneGeometry(0.94, 0.94)),
            ring: lay(new RingGeometry(0.38, 0.45, 48)),
            reticleRing: lay(new RingGeometry(0.26, 0.305, 48)),
            reticleTicks: lay(new ShapeGeometry(tickShapes(0.33, 0.45, 0.05))),
            reticleDot: lay(new CircleGeometry(0.04, 16)),
            brackets: lay(new ShapeGeometry(bracketShapes(0.9, 0.24, 0.055))),
            missDot: new CylinderGeometry(0.1, 0.1, 0.03, 24),
            clearDot: lay(new CircleGeometry(0.055, 20)),
            cross: lay(new ShapeGeometry(crossShape(0.68, 0.12))),
            foamRing: lay(new RingGeometry(0.2, 0.26, 40)),
            column,
            droplet: new SphereGeometry(0.028, 8, 6),
            debris: new BoxGeometry(0.05, 0.032, 0.065),
            flash: new SphereGeometry(1, 20, 14),
            puff: new PlaneGeometry(1, 1),
            flame: cone(0.12, 0.36),
            flameCore: cone(0.07, 0.22),
            streak
        };
        const flat = (color, opacity) => new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity, depthWrite: false, toneMapped: false });
        this.overlayMaterials = {
            last: flat(PALETTE.marker, 0.85),
            reticle: flat(PALETTE.marker, 0.95),
            pending: flat(PALETTE.marker, 0.95),
            cursor: flat(PALETTE.marker, 0.95),
            previewValid: flat(PALETTE.preview, 0.2),
            previewInvalid: new MeshBasicMaterial({
                map: this.textures.hatch, color: new Color(PALETTE.danger), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false
            }),
            miss: new MeshStandardMaterial({ color: new Color(PALETTE.miss), roughness: 0.45, metalness: 0 }),
            clear: flat(PALETTE.clear, 0.75),
            // Crosses are drawn over everything: a hit stays readable behind a tall ship.
            cross: new MeshBasicMaterial({
                color: new Color(PALETTE.danger), transparent: true, opacity: 0.97, depthTest: false, depthWrite: false, toneMapped: false
            })
        };
        const g = this.overlayGeometries;
        const m = this.overlayMaterials;
        const sight = material => {
            const group = new Group();
            [g.reticleRing, g.reticleTicks, g.reticleDot].forEach(geometry => {
                const mesh = new Mesh(geometry, material);
                mesh.renderOrder = 4;
                group.add(mesh);
            });
            group.visible = false;
            this.board.add(group);
            return group;
        };
        const make = (geometry, material, order) => {
            const mesh = new Mesh(geometry, material);
            mesh.renderOrder = order;
            mesh.visible = false;
            this.board.add(mesh);
            return mesh;
        };
        this.overlays = {
            last: make(g.ring, m.last, 3),
            reticle: sight(m.reticle),
            pending: sight(m.pending),
            cursor: make(g.brackets, m.cursor, 5)
        };
        this.previewCells = [];
        this.previewShip = null;
    }

    // --- Board state ---------------------------------------------------------------------------

    /**
     * Same state as BattleshipBoard.update, plus `dragging` and `revealed`.
     * @param {Object} state
     */
    update(state = {}) {
        this.dom.update(state);
        this.state = {
            marks: typeof state.marks === 'string' ? state.marks : null,
            ships: Array.isArray(state.ships) ? state.ships : [],
            preview: state.preview || null,
            lastIndex: Number.isInteger(state.lastIndex) ? state.lastIndex : null,
            pendingIndex: Number.isInteger(state.pendingIndex) ? state.pendingIndex : null,
            interactive: Boolean(state.interactive),
            canTarget: typeof state.canTarget === 'function' ? state.canTarget : null,
            dragging: Boolean(state.dragging),
            revealed: Boolean(state.revealed)
        };
        if (this.flat || !this.scene) return;
        this.syncShips();
        this.syncMarks();
        this.syncPreview();
        this.refreshOverlays();
        this.primed = true;
    }

    markAt(index) {
        return this.state.marks?.[index] || MARK.UNKNOWN;
    }

    syncShips() {
        const wanted = new Map();
        this.state.ships.forEach(raw => {
            const ship = this.rules.normalizeShip(raw);
            if (ship) wanted.set(shipKey(ship), ship);
        });
        this.ships.forEach((entry, key) => {
            if (wanted.has(key)) return;
            this.shipLayer.remove(entry.root);
            this.ships.delete(key);
        });
        this.cellShip = new Map();
        wanted.forEach((ship, key) => {
            const cells = this.rules.shipCells(ship);
            const sunk = Boolean(this.state.marks) && cells.every(index => this.markAt(index) === MARK.SUNK);
            const look = sunk ? 'wreck' : this.side === 'enemy' && this.state.revealed ? 'ghost' : 'solid';
            let entry = this.ships.get(key);
            if (!entry) {
                entry = this.createShip(ship, key, look);
                // A ship already down when the board first draws it lies low at once;
                // one sunk by a shot just now goes down from afloat.
                entry.sinkValue = sunk && !this.primed ? 1 : 0;
                entry.appear = this.primed && look === 'ghost' ? 0 : 1;
                this.ships.set(key, entry);
            } else if (entry.look !== look) {
                this.setShipLook(entry, look);
            }
            entry.sinkTarget = sunk ? 1 : 0;
            entry.cells = cells;
            cells.forEach(index => this.cellShip.set(index, entry));
        });
    }

    createShip(ship, key, look) {
        const model = this.shipModels[ship.length];
        const root = new Group();
        const body = new Group();
        root.add(body);
        const meshes = SHIP_PARTS.map(part => {
            const mesh = new Mesh(model[part], this.shipMaterials[look][part]);
            mesh.castShadow = look !== 'ghost';
            mesh.receiveShadow = look !== 'ghost';
            mesh.userData.shipKey = key;
            body.add(mesh);
            return mesh;
        });
        const pose = shipPose(ship, this.size);
        root.position.set(pose.x, 0, pose.z);
        root.rotation.y = pose.rotationY;
        this.shipLayer.add(root);
        const random = mulberry32(hashString(key));
        return {
            key,
            ship,
            root,
            body,
            meshes,
            look,
            pose,
            cells: [],
            lift: 0,
            phase: random() * Math.PI * 2,
            rollSign: random() < 0.5 ? -1 : 1,
            pitchSign: random() < 0.5 ? -1 : 1,
            sinkValue: 0,
            sinkTarget: 0,
            appear: 1
        };
    }

    setShipLook(entry, look) {
        entry.look = look;
        entry.meshes.forEach((mesh, index) => {
            mesh.material = this.shipMaterials[look][SHIP_PARTS[index]];
            mesh.castShadow = look !== 'ghost';
            mesh.receiveShadow = look !== 'ghost';
        });
    }

    syncMarks() {
        for (let index = 0; index < this.cellCount; index++) {
            const mark = this.markAt(index);
            const previous = this.markSnapshot[index];
            if (mark === previous) continue;
            this.markSnapshot[index] = mark;
            // Only a shot into unknown water is news; neighbours of a sunk ship and
            // its other decks change in the same snapshot without a shot of their own.
            const fresh = this.primed && previous === MARK.UNKNOWN && (mark === MARK.MISS || mark === MARK.HIT || mark === MARK.SUNK);
            this.setMarker(index, mark, fresh && this.motion);
            if (fresh) this.playImpact(index, mark);
        }
        this.fires.forEach((fire, index) => {
            if (this.markAt(index) !== MARK.HIT) this.stopFire(index);
        });
        for (let index = 0; index < this.cellCount; index++) {
            if (this.markAt(index) === MARK.HIT && !this.fires.has(index)) this.startFire(index);
        }
    }

    setMarker(index, mark, delayed) {
        const current = this.markers.get(index);
        if (current) {
            this.markerLayer.remove(current.mesh);
            this.markers.delete(index);
        }
        const g = this.overlayGeometries;
        const m = this.overlayMaterials;
        let mesh = null;
        let kind = null;
        if (mark === MARK.MISS) {
            mesh = new Mesh(g.missDot, m.miss);
            kind = 'miss';
        } else if (mark === MARK.CLEAR) {
            mesh = new Mesh(g.clearDot, m.clear);
            mesh.renderOrder = 2;
            kind = 'clear';
        } else if (mark === MARK.HIT || mark === MARK.SUNK) {
            mesh = new Mesh(g.cross, m.cross);
            mesh.renderOrder = 20;
            kind = 'cross';
        }
        if (!mesh) return;
        const { x, z } = cellCenter(index, this.size);
        mesh.position.set(x, OVERLAY_Y, z);
        mesh.visible = !delayed;
        this.markerLayer.add(mesh);
        this.markers.set(index, { mesh, kind, x, z });
        this.placeMarker(index, this.markers.get(index));
    }

    startFire(index) {
        const g = this.overlayGeometries;
        const e = this.effectMaterials;
        const group = new Group();
        // Flames burn over the cross (both skip the depth test), so a hit reads as
        // a red cross on fire; the smoke stays behind ships like any object.
        const flame = new Mesh(g.flame, this.fireMaterials.flame);
        const core = new Mesh(g.flameCore, this.fireMaterials.core);
        flame.renderOrder = 21;
        core.renderOrder = 22;
        const puffs = [0, 1, 2].map(() => {
            const puff = new Mesh(g.puff, e.smoke.clone());
            puff.renderOrder = 23;
            group.add(puff);
            return puff;
        });
        group.add(flame, core);
        const { x, z } = cellCenter(index, this.size);
        group.position.set(x, 0, z);
        this.effectLayer.add(group);
        this.fires.set(index, { group, flame, core, puffs, seed: (index * 0.618) % 1 });
    }

    stopFire(index) {
        const fire = this.fires.get(index);
        if (!fire) return;
        this.effectLayer.remove(fire.group);
        fire.puffs.forEach(puff => puff.material.dispose());
        this.fires.delete(index);
    }

    syncPreview() {
        const preview = this.state.preview;
        const cells = preview?.cells || [];
        const g = this.overlayGeometries;
        const m = this.overlayMaterials;
        while (this.previewCells.length < cells.length) {
            const mesh = new Mesh(g.fill, m.previewValid);
            mesh.renderOrder = 2;
            mesh.visible = false;
            this.board.add(mesh);
            this.previewCells.push(mesh);
        }
        this.previewCells.forEach((mesh, index) => {
            if (index >= cells.length) {
                mesh.visible = false;
                return;
            }
            mesh.material = preview.valid ? m.previewValid : m.previewInvalid;
            this.placeAt(mesh, cells[index], OVERLAY_Y - 0.006);
        });
        const ship = preview ? shipFromCells(cells, this.size) : null;
        if (!ship || ship.length > 4) {
            if (this.previewShip) this.previewShip.root.visible = false;
            return;
        }
        let entry = this.previewShip;
        if (!entry || entry.ship.length !== ship.length) {
            if (entry) this.shipLayer.remove(entry.root);
            entry = this.createShip(ship, 'preview', 'ghost');
            entry.meshes.forEach(mesh => {
                mesh.userData.shipKey = null;
                mesh.castShadow = false;
                mesh.receiveShadow = false;
            });
            entry.lift = PREVIEW_LIFT;
            this.previewShip = entry;
        }
        entry.ship = ship;
        entry.pose = shipPose(ship, this.size);
        entry.root.position.set(entry.pose.x, 0, entry.pose.z);
        entry.root.rotation.y = entry.pose.rotationY;
        const material = this.shipMaterials[preview.valid ? 'valid' : 'invalid'].hull;
        entry.meshes.forEach(mesh => { mesh.material = material; });
        entry.root.visible = true;
        this.poseShip(entry, 0);
    }

    placeAt(object, index, y = OVERLAY_Y) {
        if (index === null || index === undefined || !this.rules.isIndex(index)) {
            object.visible = false;
            return;
        }
        const { x, z } = cellCenter(index, this.size);
        object.position.set(x, y, z);
        object.visible = true;
    }

    targetable(index) {
        if (index === null || !this.state.interactive) return false;
        return this.state.canTarget ? this.state.canTarget(index) : true;
    }

    refreshOverlays() {
        if (this.flat || !this.overlays) return;
        const state = this.state;
        this.placeAt(this.overlays.last, state.lastIndex, OVERLAY_Y - 0.002);
        this.placeAt(this.overlays.pending, state.pendingIndex, OVERLAY_Y + 0.004);
        const aim = this.side === 'enemy' && state.pendingIndex === null && this.targetable(this.hoverIndex) ? this.hoverIndex : null;
        this.placeAt(this.overlays.reticle, aim, OVERLAY_Y + 0.004);
        this.placeAt(this.overlays.cursor, this.focusVisible ? this.dom.activeIndex : null, OVERLAY_Y + 0.006);
        this.updateCursorStyle();
        this.requestRender();
    }

    updateCursorStyle() {
        const state = this.state;
        let cursor = '';
        if (state.dragging) cursor = 'grabbing';
        else if (state.interactive && this.hoverIndex !== null) {
            if (this.side === 'enemy') cursor = this.targetable(this.hoverIndex) ? 'crosshair' : '';
            else cursor = this.cellShip.has(this.hoverIndex) && !state.preview ? 'grab' : 'pointer';
        }
        if (this.canvas && this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
    }

    // --- Shots ----------------------------------------------------------------------------------

    playImpact(index, mark) {
        const { x, z } = cellCenter(index, this.size);
        const marker = this.markers.get(index);
        const reveal = () => { if (marker && this.markers.get(index) === marker) marker.mesh.visible = true; };
        if (!this.motion) {
            reveal();
            this.addEffect(this.pulseEffect(x, z));
            return;
        }
        const entry = this.cellShip.get(index);
        const height = entry ? SHIP_DECK[entry.ship.length] : 0.02;
        this.addEffect(this.streakEffect(x, z, height));
        this.addEffect(mark === MARK.MISS ? this.splashEffect(x, z, reveal) : this.blastEffect(x, z, height, mark === MARK.SUNK, reveal));
    }

    addEffect(effect) {
        effect.start = null;
        this.effects.add(effect);
        this.requestRender();
    }

    /** One group per effect; clones of the template materials so each fades alone. */
    effectGroup(x, z) {
        const group = new Group();
        group.position.set(x, 0, z);
        this.effectLayer.add(group);
        const materials = [];
        const mesh = (geometry, template, order = 7) => {
            const material = template.clone();
            materials.push(material);
            const item = new Mesh(geometry, material);
            item.renderOrder = order;
            group.add(item);
            return item;
        };
        const dispose = () => {
            this.effectLayer.remove(group);
            materials.forEach(material => material.dispose());
        };
        return { group, mesh, dispose };
    }

    streakEffect(x, z, height) {
        const { mesh, dispose } = this.effectGroup(x, z);
        const shell = mesh(this.overlayGeometries.streak, this.effectMaterials.streak, 11);
        shell.rotation.z = 0.18;
        const top = 3.2;
        return {
            update: elapsed => {
                const t = clamp01(elapsed / IMPACT_DELAY_MS);
                const tip = top + (height - top) * t;
                shell.position.set(-Math.sin(0.18) * (tip - height), tip, 0);
                shell.scale.set(1, 0.9 + t * 0.5, 1);
                shell.material.opacity = 0.9 * (1 - t * 0.4);
                shell.visible = t < 1;
                return t < 1;
            },
            dispose
        };
    }

    splashEffect(x, z, reveal) {
        const { mesh, dispose } = this.effectGroup(x, z);
        const g = this.overlayGeometries;
        const e = this.effectMaterials;
        const rings = [0, 1].map(() => mesh(g.foamRing, e.foam, 6));
        const column = mesh(g.column, e.foam, 7);
        const random = mulberry32(Math.floor(x * 97 + z * 13 + 1000));
        const drops = Array.from({ length: 14 }, () => {
            const drop = mesh(g.droplet, e.foam, 7);
            const angle = random() * Math.PI * 2;
            const speed = 0.35 + random() * 0.55;
            drop.userData.velocity = new Vector3(Math.cos(angle) * speed, 1.9 + random() * 1.2, Math.sin(angle) * speed);
            drop.visible = false;
            return drop;
        });
        let revealed = false;
        return {
            update: elapsed => {
                const local = elapsed - IMPACT_DELAY_MS;
                if (local < 0) {
                    rings.forEach(ring => { ring.visible = false; });
                    column.visible = false;
                    return true;
                }
                if (!revealed) {
                    revealed = true;
                    reveal();
                }
                rings.forEach((ring, k) => {
                    const t = clamp01((local - k * 160) / 950);
                    ring.visible = t > 0 && t < 1;
                    ring.position.y = OVERLAY_Y - 0.008;
                    ring.scale.setScalar(0.4 + easeOut(t) * 1.9);
                    ring.material.opacity = 0.8 * (1 - t);
                });
                const c = clamp01(local / 520);
                column.visible = c < 1;
                column.scale.set(0.7 + c * 0.7, Math.sin(Math.PI * c) * 0.8 + 0.001, 0.7 + c * 0.7);
                column.material.opacity = 0.75 * (1 - c);
                const seconds = local / 1000;
                drops.forEach(drop => {
                    const v = drop.userData.velocity;
                    const y = 0.04 + v.y * seconds - 4.9 * seconds * seconds;
                    drop.visible = y > 0;
                    drop.position.set(v.x * seconds * 0.5, y, v.z * seconds * 0.5);
                });
                return local < 1150;
            },
            dispose
        };
    }

    blastEffect(x, z, height, big, reveal) {
        const { mesh, dispose } = this.effectGroup(x, z);
        const g = this.overlayGeometries;
        const e = this.effectMaterials;
        const flash = mesh(g.flash, e.flash, 9);
        const shock = mesh(g.foamRing, e.smoke, 6);
        const random = mulberry32(Math.floor(x * 31 + z * 71 + 2000));
        const debris = Array.from({ length: big ? 12 : 8 }, () => {
            const piece = mesh(g.debris, e.debris, 7);
            const angle = random() * Math.PI * 2;
            const speed = 0.6 + random() * 0.9;
            piece.userData.velocity = new Vector3(Math.cos(angle) * speed, 1.6 + random() * 1.4, Math.sin(angle) * speed);
            piece.userData.spin = new Vector3(random() * 9, random() * 9, random() * 9);
            piece.visible = false;
            return piece;
        });
        const puffs = Array.from({ length: big ? 6 : 4 }, (_, k) => {
            const puff = mesh(g.puff, e.smoke, 10);
            puff.userData.drift = new Vector3((random() - 0.5) * 0.5, 0.5 + random() * 0.4, (random() - 0.5) * 0.5);
            puff.userData.delay = k * 70;
            puff.visible = false;
            return puff;
        });
        const peak = big ? 0.8 : 0.58;
        const hot = new Color(PALETTE.flameCore);
        const cool = new Color(PALETTE.flame);
        let revealed = false;
        return {
            update: elapsed => {
                const local = elapsed - IMPACT_DELAY_MS;
                if (local < 0) {
                    flash.visible = false;
                    shock.visible = false;
                    return true;
                }
                if (!revealed) {
                    revealed = true;
                    reveal();
                }
                const f = clamp01(local / 430);
                flash.visible = f < 1;
                flash.position.y = height + 0.08;
                flash.scale.setScalar(0.12 + easeOut(f) * peak);
                flash.material.opacity = (1 - f) ** 1.5;
                flash.material.color.copy(hot).lerp(cool, f);
                const s = clamp01(local / 800);
                shock.visible = s < 1;
                shock.position.y = OVERLAY_Y - 0.008;
                shock.scale.setScalar(0.5 + easeOut(s) * 2.2);
                shock.material.opacity = 0.6 * (1 - s);
                const seconds = local / 1000;
                debris.forEach(piece => {
                    const v = piece.userData.velocity;
                    const y = height + 0.05 + v.y * seconds - 4.9 * seconds * seconds;
                    piece.visible = y > 0;
                    piece.position.set(v.x * seconds * 0.6, y, v.z * seconds * 0.6);
                    piece.rotation.set(piece.userData.spin.x * seconds, piece.userData.spin.y * seconds, piece.userData.spin.z * seconds);
                });
                puffs.forEach(puff => {
                    const p = clamp01((local - puff.userData.delay) / 1300);
                    puff.visible = p > 0 && p < 1;
                    const d = puff.userData.drift;
                    puff.position.set(d.x * p, height + 0.12 + d.y * p * 1.4, d.z * p);
                    puff.scale.setScalar(0.25 + easeOut(p) * 0.75);
                    puff.quaternion.copy(this.camera.quaternion);
                    puff.material.opacity = 0.62 * Math.sin(Math.PI * p);
                });
                return local < 1450;
            },
            dispose
        };
    }

    /** Reduced motion: a ring that fades, nothing flies. */
    pulseEffect(x, z) {
        const { mesh, dispose } = this.effectGroup(x, z);
        const ring = mesh(this.overlayGeometries.foamRing, this.effectMaterials.foam, 6);
        ring.position.y = OVERLAY_Y - 0.008;
        ring.scale.setScalar(1.8);
        return {
            update: elapsed => {
                const t = clamp01(elapsed / 400);
                ring.material.opacity = 0.7 * (1 - t);
                return t < 1;
            },
            dispose
        };
    }

    // --- Animation ------------------------------------------------------------------------------

    /** Ships ride the swell; a sunk one settles low with a list. */
    poseShip(entry, dt) {
        const rate = this.motion ? 1 - Math.exp(-dt / 0.42) : 1;
        entry.sinkValue += (entry.sinkTarget - entry.sinkValue) * rate;
        if (Math.abs(entry.sinkTarget - entry.sinkValue) < 0.002) entry.sinkValue = entry.sinkTarget;
        entry.appear += (1 - entry.appear) * (this.motion ? 1 - Math.exp(-dt / 0.18) : 1);
        if (1 - entry.appear < 0.002) entry.appear = 1;
        const amplitude = this.uniforms.wave.value;
        const t = this.time;
        const { x, z, bow } = entry.pose;
        const half = SHIP_LENGTH[entry.ship.length] * 0.4;
        const front = waveHeight(x + bow.x * half, z + bow.z * half, t) * amplitude;
        const back = waveHeight(x - bow.x * half, z - bow.z * half, t) * amplitude;
        const sink = easeInOut(entry.sinkValue);
        const pitch = Math.atan2(front - back, half * 2);
        const roll = amplitude * 1.4 * Math.sin(t * 1.25 + entry.phase);
        const body = entry.body;
        body.position.y = ((front + back) / 2) * (1 - 0.5 * sink) - 0.15 * sink + entry.lift - (1 - entry.appear) * 0.35;
        body.rotation.z = pitch * (1 - sink) + 0.075 * sink * entry.pitchSign;
        body.rotation.x = roll * (1 - sink) + 0.24 * sink * entry.rollSign;
    }

    seaHeight(x, z) {
        return waveHeight(x, z, this.time) * this.uniforms.wave.value;
    }

    placeMarker(index, marker) {
        if (marker.kind === 'miss') {
            marker.mesh.position.y = this.seaHeight(marker.x, marker.z) + 0.01;
            return;
        }
        if (marker.kind === 'clear') {
            marker.mesh.position.y = OVERLAY_Y - 0.004;
            return;
        }
        const entry = this.cellShip.get(index);
        if (!entry) {
            marker.mesh.position.y = CROSS_Y.water;
            return;
        }
        const low = easeInOut(entry.sinkValue);
        marker.mesh.position.y = CROSS_Y.ship + (CROSS_Y.wreck - CROSS_Y.ship) * low + entry.body.position.y * 0.5;
    }

    stepFire(index, fire, now) {
        // A fresh hit catches fire when its shell lands, with the cross.
        const marker = this.markers.get(index);
        fire.group.visible = !marker || marker.mesh.visible;
        const entry = this.cellShip.get(index);
        const base = entry && entry.look !== 'ghost' ? SHIP_DECK[entry.ship.length] + entry.body.position.y : 0.02;
        const t = this.motion ? now / 1000 : 0.35;
        const flicker = this.motion ? Math.sin(t * 17 + fire.seed * 9) : 0;
        fire.flame.position.y = base;
        fire.core.position.y = base;
        fire.flame.scale.set(1 + 0.12 * flicker, 0.85 + 0.25 * (0.5 + 0.5 * Math.sin(t * 23 + fire.seed * 5)), 1 + 0.12 * flicker);
        fire.core.scale.set(1, 0.8 + 0.3 * (0.5 + 0.5 * Math.sin(t * 29 + fire.seed * 3)), 1);
        fire.flame.rotation.y = t * 2;
        fire.puffs.forEach((puff, k) => {
            const phase = (t * 0.42 + k / fire.puffs.length + fire.seed) % 1;
            puff.position.set(phase * 0.18, base + 0.2 + phase * 0.95, -phase * 0.1);
            puff.scale.setScalar(0.24 + phase * 0.62);
            puff.quaternion.copy(this.camera.quaternion);
            puff.material.opacity = 0.72 * Math.sin(Math.PI * phase);
        });
    }

    animate(now, dt) {
        if (this.motion) {
            this.time += dt;
            this.uniforms.time.value = this.time;
            this.textures.ripple.offset.set(this.time * 0.011, this.time * 0.006);
        }
        this.ships.forEach(entry => this.poseShip(entry, dt));
        if (this.previewShip?.root.visible) this.poseShip(this.previewShip, dt);
        this.markers.forEach((marker, index) => this.placeMarker(index, marker));
        this.fires.forEach((fire, index) => this.stepFire(index, fire, now));
        const pending = this.overlays.pending;
        if (pending.visible) {
            const pulse = this.motion ? 0.5 + 0.5 * Math.sin(now / 150) : 1;
            pending.scale.setScalar(0.82 + pulse * 0.26);
            pending.rotation.y = this.motion ? now / 700 : 0;
            this.overlayMaterials.pending.opacity = 0.5 + pulse * 0.45;
        }
        this.effects.forEach(effect => {
            if (effect.start === null) effect.start = now;
            if (!effect.update(now - effect.start)) {
                effect.dispose();
                this.effects.delete(effect);
            }
        });
    }

    isBusy() {
        if (this.effects.size || this.cameraTween || this.state.pendingIndex !== null) return true;
        for (const entry of this.ships.values()) {
            if (entry.sinkValue !== entry.sinkTarget || entry.appear !== 1) return true;
        }
        return false;
    }

    requestRender() {
        this.needsRender = true;
    }

    loop(now) {
        if (this.disposed || this.flat) return;
        this.frame = requestAnimationFrame(this.loop);
        if (!this.ready || !this.visible || !this.hasSize) {
            this.lastAnimateAt = null;
            return;
        }
        const busy = this.isBusy();
        if (!busy && !this.motion && !this.needsRender) return;
        // Calm water redraws at about 30 fps; shots and sinking ships at full rate.
        if (!busy && !this.needsRender && now - (this.lastRenderAt || 0) < IDLE_FRAME_MS) return;
        const dt = this.lastAnimateAt === null || this.lastAnimateAt === undefined ? 0 : Math.min(0.1, Math.max(0, (now - this.lastAnimateAt) / 1000));
        this.lastAnimateAt = now;
        if (this.cameraTween) this.stepCamera(now);
        this.animate(now, dt);
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
        this.lastRenderAt = now;
    }

    // --- Camera ---------------------------------------------------------------------------------

    /**
     * Brings the camera as close as the frame allows and shifts the lens so the
     * board sits in the middle of the canvas (a tilted board is wider at the
     * near edge, which would otherwise leave an empty band at the top).
     */
    fitCamera() {
        const half = FRAME_OUTER / 2;
        const points = [];
        [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
            points.push(new Vector3(sx * half, FRAME_TOP, sz * half));
            points.push(new Vector3(sx * half, GROUND_Y, sz * half));
        }));
        // Masts on the far row stay in frame.
        points.push(new Vector3(-SIZE / 2, 0.7, -SIZE / 2), new Vector3(SIZE / 2, 0.7, -SIZE / 2));
        this.camera.clearViewOffset();
        const projected = new Vector3();
        const measure = distance => {
            this.placeCamera(distance);
            const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
            for (const point of points) {
                projected.copy(point).project(this.camera);
                if (projected.z >= 1) return null;
                box.minX = Math.min(box.minX, projected.x);
                box.maxX = Math.max(box.maxX, projected.x);
                box.minY = Math.min(box.minY, projected.y);
                box.maxY = Math.max(box.maxY, projected.y);
            }
            return box;
        };
        let low = 4;
        let high = 140;
        for (let i = 0; i < 26; i++) {
            const mid = (low + high) / 2;
            const box = measure(mid);
            const fits = box && Math.max(-box.minX, box.maxX) <= 0.97 && box.maxY - box.minY <= 1.9;
            if (fits) high = mid;
            else low = mid;
        }
        const box = measure(high);
        const center = box ? (box.maxY + box.minY) / 2 : 0;
        const width = this.viewport?.width || 1;
        const height = this.viewport?.height || 1;
        this.camera.setViewOffset(width, height, 0, -center * height / 2, width, height);
        this.camera.updateProjectionMatrix();
    }

    placeCamera(distance) {
        const { elevation, target } = this.view;
        this.camera.position.set(target.x, target.y + Math.sin(elevation) * distance, target.z + Math.cos(elevation) * distance);
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld();
        this.camera.updateProjectionMatrix();
    }

    updateCamera() {
        if (!this.camera) return;
        this.fitCamera();
        this.requestRender();
    }

    resize() {
        if (this.flat || !this.renderer) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.hasSize = width > 0 && height > 0;
        if (!this.hasSize) return;
        this.viewport = { width, height };
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.updateCamera();
    }

    /** '3d' looks across the board; 'top' looks straight down. */
    setView(mode, { animate = true } = {}) {
        this.viewMode = mode === 'top' ? 'top' : '3d';
        if (this.flat || !this.camera) return;
        const to = VIEW_ELEVATION[this.viewMode];
        if (!animate || !this.motion) {
            this.cameraTween = null;
            this.view.elevation = to;
            this.updateCamera();
            return;
        }
        this.cameraTween = { from: this.view.elevation, to, start: null, duration: 520 };
        this.requestRender();
    }

    stepCamera(now) {
        const tween = this.cameraTween;
        if (tween.start === null) tween.start = now;
        const t = clamp01((now - tween.start) / tween.duration);
        this.view.elevation = tween.from + (tween.to - tween.from) * easeInOut(t);
        if (t >= 1) this.cameraTween = null;
        this.fitCamera();
    }

    // --- Input ----------------------------------------------------------------------------------

    bindInput() {
        const canvas = this.canvas;
        this.handlers = {
            move: event => this.onPointerMove(event),
            leave: () => this.setHover(null),
            down: event => this.onPointerDown(event),
            click: event => this.onClick(event),
            context: event => this.onContextMenu(event),
            lost: event => {
                event.preventDefault();
                console.warn('[Battleship] WebGL context lost; the board goes flat');
                this.fallBack();
            },
            // The bracket cursor is for the keyboard: focus that follows a click on
            // the canvas does not show it, Tab and the arrow keys do.
            focusIn: event => {
                this.focusVisible = !this.pointerFocus && Boolean(event.target?.matches?.(':focus-visible'));
                this.refreshOverlays();
            },
            focusOut: () => {
                // Focus moving between cells leaves and enters within one task.
                setTimeout(() => {
                    if (this.disposed) return;
                    const active = this.doc.activeElement;
                    if (active && this.grid.contains(active)) return;
                    this.focusVisible = false;
                    this.refreshOverlays();
                }, 0);
            },
            key: () => {
                const active = this.doc.activeElement;
                this.focusVisible = Boolean(active && this.grid.contains(active));
                this.refreshOverlays();
            }
        };
        canvas.addEventListener('pointermove', this.handlers.move);
        canvas.addEventListener('pointerleave', this.handlers.leave);
        canvas.addEventListener('pointerdown', this.handlers.down);
        canvas.addEventListener('click', this.handlers.click);
        canvas.addEventListener('contextmenu', this.handlers.context);
        canvas.addEventListener('webglcontextlost', this.handlers.lost);
        this.grid.addEventListener('focusin', this.handlers.focusIn);
        this.grid.addEventListener('focusout', this.handlers.focusOut);
        this.grid.addEventListener('keydown', this.handlers.key);
        if (this.motionQuery) {
            this.handlers.motion = () => {
                this.motion = !this.motionQuery.matches;
                this.uniforms.wave.value = this.motion ? WAVE_AMPLITUDE : 0;
                this.requestRender();
            };
            this.motionQuery.addEventListener?.('change', this.handlers.motion);
        }
    }

    unbindInput() {
        const canvas = this.canvas;
        if (!this.handlers) return;
        if (canvas) {
            canvas.removeEventListener('pointermove', this.handlers.move);
            canvas.removeEventListener('pointerleave', this.handlers.leave);
            canvas.removeEventListener('pointerdown', this.handlers.down);
            canvas.removeEventListener('click', this.handlers.click);
            canvas.removeEventListener('contextmenu', this.handlers.context);
            canvas.removeEventListener('webglcontextlost', this.handlers.lost);
        }
        this.grid.removeEventListener('focusin', this.handlers.focusIn);
        this.grid.removeEventListener('focusout', this.handlers.focusOut);
        this.grid.removeEventListener('keydown', this.handlers.key);
        if (this.handlers.motion) this.motionQuery?.removeEventListener?.('change', this.handlers.motion);
        this.handlers = null;
    }

    /**
     * The cell under a client point. On the own board a ship wins over the water
     * behind it, so pressing a tall bridge picks that ship.
     */
    pickCell(clientX, clientY) {
        if (this.flat || !this.canvas) return null;
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
        const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        this.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(ndc, this.camera);
        if (this.side === 'own' && this.ships.size) {
            this.shipLayer.updateMatrixWorld(true);
            const meshes = [];
            this.ships.forEach(entry => { if (entry.look === 'solid') meshes.push(...entry.meshes); });
            const hit = meshes.length ? this.raycaster.intersectObjects(meshes, false)[0] : null;
            const entry = hit ? this.ships.get(hit.object.userData.shipKey) : null;
            if (entry) {
                const { ship } = entry;
                const column = ship.vertical ? ship.x : Math.min(ship.x + ship.length - 1, Math.max(ship.x, Math.floor(hit.point.x + this.size / 2)));
                const row = ship.vertical ? Math.min(ship.y + ship.length - 1, Math.max(ship.y, Math.floor(hit.point.z + this.size / 2))) : ship.y;
                return row * this.size + column;
            }
        }
        const point = new Vector3();
        if (!this.raycaster.ray.intersectPlane(this.waterPlane, point)) return null;
        return cellAtWorld(point.x, point.z, this.size);
    }

    setHover(index) {
        if (this.hoverIndex === index) return;
        this.hoverIndex = index;
        this.options.onHover?.(index);
        this.refreshOverlays();
    }

    onPointerMove(event) {
        if (this.flat) return;
        this.setHover(this.pickCell(event.clientX, event.clientY));
    }

    onPointerDown(event) {
        if (this.flat) return;
        if (this.focusVisible) {
            this.focusVisible = false;
            this.refreshOverlays();
        }
        if (!this.state.interactive) return;
        const index = this.pickCell(event.clientX, event.clientY);
        if (index !== null) this.options.onCellPointerDown?.(index, event);
    }

    onClick(event) {
        if (this.flat || !this.state.interactive) return;
        const index = this.pickCell(event.clientX, event.clientY);
        if (index === null) return;
        // The hidden grid keeps the keyboard where the pointer acted.
        this.dom.setActiveIndex(index);
        this.pointerFocus = true;
        this.dom.cells[index]?.focus({ preventScroll: true });
        this.pointerFocus = false;
        this.options.onActivate?.(index, event);
    }

    onContextMenu(event) {
        if (this.flat || !this.state.interactive || !this.options.onContextMenu) return;
        const index = this.pickCell(event.clientX, event.clientY);
        if (index === null) return;
        event.preventDefault();
        this.options.onContextMenu(index, event);
    }

    // --- BattleshipBoard interface ------------------------------------------------------------

    setActiveIndex(index) {
        this.dom.setActiveIndex(index);
        this.refreshOverlays();
    }

    focusCell(index) {
        this.dom.focusCell(index);
    }

    /** The cell under a viewport point, for drags that start outside the board. */
    cellFromPoint(clientX, clientY) {
        if (this.flat) return this.dom.cellFromPoint(clientX, clientY);
        const element = this.doc.elementFromPoint(clientX, clientY);
        if (element !== this.canvas) return null;
        return this.pickCell(clientX, clientY);
    }

    /** Client coordinates of a cell's centre on the water (tests and overlays). */
    screenPoint(index) {
        if (this.flat) return this.dom.screenPoint(index);
        const { x, z } = cellCenter(index, this.size);
        this.camera.updateMatrixWorld();
        const projected = new Vector3(x, 0, z).project(this.camera);
        const rect = this.canvas.getBoundingClientRect();
        return { x: rect.left + ((projected.x + 1) / 2) * rect.width, y: rect.top + ((1 - projected.y) / 2) * rect.height };
    }

    // --- Teardown -------------------------------------------------------------------------------

    /** Shows the inner grid as a flat board and lets WebGL go. */
    fallBack() {
        if (this.flat) return;
        this.flat = true;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        try {
            this.disposeScene();
        } catch (error) {
            console.warn('[Battleship] 3D board cleanup failed', error);
        }
        this.container.classList.remove('is-3d', 'is-loading');
        this.container.classList.add('is-flat');
        this.options.onReady?.();
    }

    disposeScene() {
        clearTimeout(this.warmTimer);
        this.resizeObserver?.disconnect();
        this.intersection?.disconnect();
        this.unbindInput();
        this.effects.forEach(effect => effect.dispose());
        this.effects.clear();
        [...this.fires.keys()].forEach(index => this.stopFire(index));
        const geometries = new Set([...(this.disposables || []), ...Object.values(this.overlayGeometries || {})]);
        geometries.forEach(geometry => geometry.dispose());
        disposeShipModels(this.shipModels);
        const materials = new Set([
            ...Object.values(this.materials || {}),
            ...Object.values(this.overlayMaterials || {}),
            ...Object.values(this.effectMaterials || {}),
            ...Object.values(this.fireMaterials || {}),
            ...Object.values(this.shipMaterials || {}).flatMap(look => Object.values(look))
        ]);
        materials.forEach(material => material.dispose());
        Object.values(this.textures || {}).forEach(texture => texture.dispose());
        this.environment?.dispose();
        this.renderer?.dispose();
        this.renderer?.forceContextLoss?.();
        this.canvas?.remove();
        this.loader?.remove();
        this.loader = null;
        this.renderer = null;
        this.scene = null;
        this.ships.clear();
        this.markers.clear();
        this.cellShip.clear();
    }

    destroy() {
        if (this.disposed) return;
        this.disposed = true;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        if (!this.flat) {
            try {
                this.disposeScene();
            } catch (error) {
                console.warn('[Battleship] 3D board cleanup failed', error);
            }
        }
        this.dom.destroy();
        this.root.replaceChildren();
    }
}

export const BOARD_CONSTANTS = Object.freeze({ SIZE, FRAME_OUTER, FRAME_TOP, OVERLAY_Y, CROSS_Y, WAVE_AMPLITUDE, VIEW_ELEVATION });
