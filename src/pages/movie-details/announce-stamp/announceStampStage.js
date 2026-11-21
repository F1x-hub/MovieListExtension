/**
 * The announce stamp in WebGL. A lacquered office stamp with a zinc collar and
 * the extension's clapperboard on its knob drops from above over the poster,
 * which lies on a dark desk, while the date rollers in its front window spin to
 * the screening date. Then the owner aims it: it follows the pointer over the
 * poster with a dashed outline of the ticket where the ink will land, the wheel
 * turns it, and a click (or `strike()`) slams it down. It leaves the ink and
 * lifts away while the camera rises to straight above the poster. That last
 * frame draws the poster and the ink unlit at the size of the exported JPEG, so
 * the scene cross-fades to it.
 *
 * The choreography (timeline, poses, easing, aim limits) is pure and lives in
 * announceStampCore.js; this module builds the scene, reads the pointer and
 * draws. The stamp, the desk and the ink are content (docs/design-system.md,
 * exception 8). Loaded on demand by AnnounceStampScene.js, so the film page
 * does not pay for three.js until an announcement plays.
 */
import {
    BackSide,
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    CanvasTexture,
    CircleGeometry,
    Color,
    CylinderGeometry,
    DirectionalLight,
    ExtrudeGeometry,
    Group,
    HemisphereLight,
    LatheGeometry,
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
    Scene,
    ShadowMaterial,
    Shape,
    SRGBColorSpace,
    Vector2,
    Vector3,
    WebGLRenderer
} from '../../../../libs/three.games.min.js';
import {
    CLAPPER_MARK,
    IMPRESSION_VIEWBOX,
    MONTHS_SHORT_RU,
    STAMP_FLIGHT,
    buildStampTimeline,
    cameraPoseAt,
    clampImpressionCentre,
    createSeededRandom,
    nudgeAim,
    rollerIndexAt,
    shadowForHeight,
    stampPoseAt,
    strikeStartFor,
    ticketOutlinePath
} from './announceStampCore.js';

const DEG = Math.PI / 180;
const POSTER_THICKNESS = 0.008;
const UI_FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
// Degrees per wheel notch; Shift turns finely.
const WHEEL_STEP = 3;
const WHEEL_FINE_STEP = 0.5;

// Proportions are drawn for an impression 0.66 poster widths wide (the default
// size); the stamp scales with the impression it prints.
const DESIGN_WIDTH = 0.66;
// Turned handle, [radius, height] from the collar up: a slim neck flaring into a knob with a flat top.
const HANDLE_PROFILE = [
    [0.058, 0], [0.05, 0.012], [0.043, 0.04], [0.04, 0.08], [0.041, 0.12], [0.046, 0.15],
    [0.058, 0.175], [0.076, 0.197], [0.092, 0.222], [0.101, 0.25], [0.102, 0.272],
    [0.097, 0.293], [0.086, 0.309], [0.072, 0.318], [0.064, 0.321], [0, 0.321]
];

// Obsidian and zinc: the extension's two poles as materials.
const PALETTE = Object.freeze({
    lacquer: '#131317',
    zinc: '#babac2',
    zincLight: '#e4e4e7',
    zincDeep: '#86868f',
    mark: '#141418',
    paperEdge: '#e6e4dd',
    rubberBase: '#18181b',
    rollerText: '#f4f4f5',
    rollerFrame: '#5b5b64',
    engrave: '#d4d4d8'
});

export function isWebGLAvailable(doc = globalThis.document) {
    if (typeof globalThis.WebGLRenderingContext === 'undefined') return false;
    try {
        const canvas = doc.createElement('canvas');
        return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
        return false;
    }
}

const abortError = () => new DOMException('Announce stamp scene closed', 'AbortError');
const lerp = (from, to, t) => from + (to - from) * t;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = value => clamp(value, 0, 1);
const ease = (dt, tau) => 1 - Math.exp(-dt / tau);

function canvas2d(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return { canvas, ctx: canvas.getContext('2d') };
}

function colorTexture(canvas, renderer) {
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
}

function roundedRect(width, height, radius) {
    const r = Math.max(1e-4, Math.min(radius, width / 2, height / 2));
    const x = -width / 2;
    const y = -height / 2;
    const shape = new Shape();
    shape.moveTo(x + r, y);
    shape.lineTo(x + width - r, y);
    shape.absarc(x + width - r, y + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(x + width, y + height - r);
    shape.absarc(x + width - r, y + height - r, r, 0, Math.PI / 2, false);
    shape.lineTo(x + r, y + height);
    shape.absarc(x + r, y + height - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(x, y + r);
    shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    return shape;
}

/**
 * Welds an extruded geometry's vertices so its bevels shade smoothly; without
 * it every bevel facet catches the light on its own. UVs are dropped: the
 * slabs carry plain materials.
 */
function smoothed(geometry) {
    const source = geometry.getAttribute('position');
    const ids = new Map();
    const positions = [];
    const index = [];
    for (let i = 0; i < source.count; i++) {
        const x = source.getX(i);
        const y = source.getY(i);
        const z = source.getZ(i);
        const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
        let id = ids.get(key);
        if (id === undefined) {
            id = positions.length / 3;
            ids.set(key, id);
            positions.push(x, y, z);
        }
        index.push(id);
    }
    geometry.dispose();
    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    result.setIndex(index);
    result.computeVertexNormals();
    return result;
}

/** A rounded, bevelled block standing on y = 0, `height` tall. */
function slab(width, depth, height, radius, bevel) {
    const b = Math.max(1e-4, Math.min(bevel, height / 2 - 1e-4, width / 4, depth / 4));
    const geometry = new ExtrudeGeometry(roundedRect(width - 2 * b, depth - 2 * b, radius - b), {
        depth: Math.max(1e-4, height - 2 * b),
        bevelEnabled: true,
        bevelThickness: b,
        bevelSize: b,
        bevelSegments: 5,
        curveSegments: 14
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, b, 0);
    return smoothed(geometry);
}

/** Studio light for reflections: a dim room with soft boxes, so lacquer and zinc read as volumes. */
function studioEnvironment(renderer) {
    const pmrem = new PMREMGenerator(renderer);
    const room = new Scene();
    const disposables = [];
    const roomGeometry = new BoxGeometry(24, 14, 24);
    const roomMaterial = new MeshBasicMaterial({ color: new Color(0.1, 0.1, 0.11), side: BackSide });
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
    panel(9, 3.5, [0, 6.6, 0], 6);
    panel(3, 7, [-10, 3, 2], 3.2);
    panel(2, 7, [10, 3, -4], 2.6);
    panel(8, 2, [0, 2, 11], 1.2);
    const target = pmrem.fromScene(room, 0.035);
    disposables.forEach(item => item.dispose());
    pmrem.dispose();
    return target;
}

function radialTexture(renderer, stops, size = 256) {
    const { canvas, ctx } = canvas2d(size, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return colorTexture(canvas, renderer);
}

/** The knob's zinc cap with the clapperboard engraved in obsidian. */
function capTexture(renderer) {
    const size = 512;
    const { canvas, ctx } = canvas2d(size, size);
    const metal = ctx.createRadialGradient(size * 0.38, size * 0.34, size * 0.05, size / 2, size / 2, size / 2);
    metal.addColorStop(0, PALETTE.zincLight);
    metal.addColorStop(1, PALETTE.zincDeep);
    ctx.fillStyle = metal;
    ctx.fillRect(0, 0, size, size);
    // Turned rings, as on a lathe-cut cap.
    ctx.strokeStyle = 'rgb(0 0 0 / 0.07)';
    for (let r = 20; r < size / 2; r += 9) {
        ctx.lineWidth = 1 + (r % 3);
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgb(0 0 0 / 0.4)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2);
    ctx.stroke();
    const { box } = CLAPPER_MARK;
    const scale = size * 0.5 / box.height;
    ctx.save();
    ctx.translate(size / 2 - (box.x + box.width / 2) * scale, size / 2 - (box.y + box.height / 2) * scale);
    ctx.scale(scale, scale);
    ctx.fillStyle = PALETTE.mark;
    ctx.save();
    ctx.translate(28, 112);
    ctx.rotate(-14 * DEG);
    ctx.translate(0, -42);
    ctx.fill(new Path2D(CLAPPER_MARK.clapper), 'evenodd');
    ctx.restore();
    ctx.fill(new Path2D(CLAPPER_MARK.board), 'evenodd');
    ctx.restore();
    return colorTexture(canvas, renderer);
}

/** The label inlaid in zinc on the base's top, in front of the handle. */
function labelTexture(renderer, label, aspect) {
    const width = 1024;
    const height = Math.round(width / aspect);
    const { canvas, ctx } = canvas2d(width, height);
    const chars = Array.from(label);
    let size = height * 0.72;
    const spacing = () => size * 0.28;
    const measure = () => {
        ctx.font = `800 ${size}px ${UI_FONT}`;
        return chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0) + spacing() * (chars.length - 1);
    };
    while (measure() > width * 0.94 && size > 8) size -= 2;
    ctx.font = `800 ${size}px ${UI_FONT}`;
    ctx.textBaseline = 'middle';
    let x = (width - measure()) / 2;
    for (const char of chars) {
        // Engraved: a dark lip under each letter.
        ctx.fillStyle = 'rgb(0 0 0 / 0.65)';
        ctx.fillText(char, x, height / 2 + size * 0.05);
        ctx.fillStyle = PALETTE.engrave;
        ctx.fillText(char, x, height / 2);
        x += ctx.measureText(char).width + spacing();
    }
    return colorTexture(canvas, renderer);
}

const isLightInk = ink => {
    const [r, g, b] = [1, 3, 5].map(offset => parseInt(ink.slice(offset, offset + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
};

/** Paints the aiming outline: the ticket's silhouette, dashed in the ink, where it will land. */
function paintAim(ctx, ink) {
    const scale = ctx.canvas.width / IMPRESSION_VIEWBOX.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.scale(scale, scale);
    const outline = new Path2D(ticketOutlinePath());
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgb(255 255 255 / 0.1)';
    ctx.fill(outline);
    ctx.lineJoin = 'round';
    // A contrasting halo first, so the dashes read on any poster.
    ctx.setLineDash([10, 7]);
    ctx.strokeStyle = isLightInk(ink) ? 'rgb(0 0 0 / 0.6)' : 'rgb(255 255 255 / 0.7)';
    ctx.lineWidth = 7;
    ctx.stroke(outline);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3.5;
    ctx.stroke(outline);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
}

/**
 * The stage. `prepare()` builds and compiles the scene and draws its first
 * frame; `play()` runs the opening, follows the owner's aim until `strike()`
 * (or a click on the canvas) and resolves on the strike's last frame (straight
 * above, poster at `paper` size); `dispose()` frees the GPU and removes the canvas.
 */
export class StampStage {
    /**
     * @param {{ host: HTMLElement, poster: { bitmap: ImageBitmap, aspect: number },
     *   impressions: Map<string, CanvasImageSource>, ink: string,
     *   layout: ReturnType<import('./announceStampCore.js').createImpressionLayout>,
     *   parts: ReturnType<import('./announceStampCore.js').formatImpressionParts>,
     *   settings: ReturnType<import('./announceStampCore.js').mergeStampSettings>,
     *   paper: { width: number, height: number }, seed: number,
     *   onStrike?: (layout: object) => void, onImpact?: () => void }} options
     */
    constructor(options) {
        this.options = options;
        this.settings = options.settings;
        this.layout = options.layout;
        this.aspect = options.poster.aspect;
        this.timeline = buildStampTimeline(options.settings.timings);
        this.depth = 1 / options.poster.aspect;
        this.disposed = false;
        this.disposables = [];
        this.raf = 0;
        // Aim: where the owner points (`aim`) and where the stamp is on its way there (`current`).
        this.aim = { x: options.layout.x, y: options.layout.y, rotation: options.layout.rotation };
        this.current = { ...this.aim };
        this.sway = { x: 0, z: 0, vx: 0, vz: 0 };
        this.strikeRequestedAt = null;
        this.strikeAt = Infinity;
        this.clock = 0;

        const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = NeutralToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;
        renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
        renderer.domElement.className = 'announce-stamp__canvas';
        this.renderer = renderer;
        options.host.append(renderer.domElement);

        this.scene = new Scene();
        this.environment = studioEnvironment(renderer);
        this.scene.environment = this.environment.texture;
        this.scene.environmentIntensity = 0.85;
        this.camera = new PerspectiveCamera(30, 1, 0.05, 80);
        this.target = new Vector3();
        this.raycaster = new Raycaster();
        this.pointer = new Vector2();
        this.posterPlane = new Plane(new Vector3(0, 1, 0), -POSTER_THICKNESS);
        this.hit = new Vector3();

        this.buildLights();
        this.buildDesk();
        this.buildPoster();
        this.buildStamp();
        this.setInk(options.ink || options.settings.inkColor);
        this.bindPointer();
        this.resize();
        this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
        this.resizeObserver?.observe(options.host);
    }

    track(...items) {
        this.disposables.push(...items);
        return items[0];
    }

    get aiming() {
        return this.strikeRequestedAt === null && !this.disposed;
    }

    buildLights() {
        this.scene.add(new HemisphereLight('#ffffff', '#202024', 0.45));
        const key = new DirectionalLight('#ffffff', 2.7);
        key.position.set(-1.7, 3.6, 1.5);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 9 });
        key.shadow.radius = 5;
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.012;
        this.scene.add(key);
        // A cool rim from behind traces the black body against the dark desk.
        const rim = new DirectionalLight('#dce2ee', 1.9);
        rim.position.set(2.3, 1.7, -2.6);
        this.scene.add(rim);
        const fill = new DirectionalLight('#ffffff', 0.4);
        fill.position.set(1.4, 1.2, 2.8);
        this.scene.add(fill);
    }

    buildDesk() {
        const map = this.track(radialTexture(this.renderer, [
            [0, 'rgb(46 46 52)'], [0.45, 'rgb(32 32 37 / 0.92)'], [0.78, 'rgb(22 22 26 / 0.45)'], [1, 'rgb(16 16 19 / 0)']
        ], 512));
        const geometry = this.track(new PlaneGeometry(5.5, 5.5));
        geometry.rotateX(-Math.PI / 2);
        const material = this.track(new MeshStandardMaterial({ map, transparent: true, roughness: 0.95, metalness: 0, depthWrite: false }));
        this.desk = new Mesh(geometry, material);
        this.desk.position.y = -0.002;
        this.desk.receiveShadow = true;
        this.scene.add(this.desk);
    }

    buildPoster() {
        const { renderer } = this;
        const { bitmap } = this.options.poster;
        const longSide = Math.min(2048, Math.max(bitmap.width, bitmap.height));
        const scale = longSide / Math.max(bitmap.width, bitmap.height);
        const posterCanvas = canvas2d(bitmap.width * scale, bitmap.height * scale);
        posterCanvas.ctx.imageSmoothingQuality = 'high';
        posterCanvas.ctx.drawImage(bitmap, 0, 0, posterCanvas.canvas.width, posterCanvas.canvas.height);
        const posterMap = this.track(colorTexture(posterCanvas.canvas, renderer));
        // Unlit and untoned: from straight above it is the JPEG's poster exactly.
        const face = this.track(new MeshBasicMaterial({ map: posterMap, toneMapped: false }));
        const edge = this.track(new MeshStandardMaterial({ color: PALETTE.paperEdge, roughness: 0.85 }));
        const posterGeometry = this.track(new BoxGeometry(1, POSTER_THICKNESS, this.depth));
        const poster = new Mesh(posterGeometry, [edge, edge, face, edge, edge, edge]);
        poster.position.y = POSTER_THICKNESS / 2;
        // It casts no shadow: its top sits a hair under the shadow catcher and would
        // shadow it in a grid of acne. A soft painted shadow grounds it instead.
        poster.castShadow = false;
        this.scene.add(poster);

        const shadowPad = 0.12;
        const { canvas: shadowCanvas, ctx: shadowCtx } = canvas2d(512, 512 * (this.depth + shadowPad * 2) / (1 + shadowPad * 2));
        const inset = shadowCanvas.width * shadowPad / (1 + shadowPad * 2);
        shadowCtx.filter = `blur(${Math.round(inset * 0.45)}px)`;
        shadowCtx.fillStyle = 'rgb(0 0 0 / 0.75)';
        shadowCtx.fillRect(inset, inset * 1.25, shadowCanvas.width - inset * 2, shadowCanvas.height - inset * 2);
        const groundGeometry = this.track(new PlaneGeometry(1 + shadowPad * 2, this.depth + shadowPad * 2));
        groundGeometry.rotateX(-Math.PI / 2);
        const groundMap = this.track(colorTexture(shadowCanvas, renderer));
        this.posterShadow = new Mesh(groundGeometry, this.track(new MeshBasicMaterial({ map: groundMap, transparent: true, depthWrite: false, toneMapped: false })));
        this.posterShadow.position.y = -0.001;
        this.scene.add(this.posterShadow);

        const inkWidth = this.layout.width;
        const inkDepth = inkWidth * IMPRESSION_VIEWBOX.height / IMPRESSION_VIEWBOX.width;
        const flatPlane = () => {
            const geometry = this.track(new PlaneGeometry(inkWidth, inkDepth));
            geometry.rotateX(-Math.PI / 2);
            return geometry;
        };
        this.inkCanvas = canvas2d(2048, 2048 * IMPRESSION_VIEWBOX.height / IMPRESSION_VIEWBOX.width);
        const inkMap = this.track(colorTexture(this.inkCanvas.canvas, renderer));
        this.ink = new Mesh(flatPlane(), this.track(new MeshBasicMaterial({ map: inkMap, transparent: true, opacity: 0, toneMapped: false, depthWrite: false })));
        this.ink.renderOrder = 1;
        this.scene.add(this.ink);

        // Only the stamp's shadow lands on the poster: the poster itself stays unlit.
        const catcherGeometry = this.track(new PlaneGeometry(1, this.depth));
        catcherGeometry.rotateX(-Math.PI / 2);
        this.catcher = new Mesh(catcherGeometry, this.track(new ShadowMaterial({ opacity: 0.5, depthWrite: false })));
        this.catcher.position.y = POSTER_THICKNESS + 0.0006;
        this.catcher.receiveShadow = true;
        this.catcher.renderOrder = 2;
        this.scene.add(this.catcher);

        // Soft darkening right under the stamp that tightens as it comes down.
        const blobGeometry = this.track(new PlaneGeometry(1, 1));
        blobGeometry.rotateX(-Math.PI / 2);
        const blobMap = this.track(radialTexture(renderer, [[0, 'rgb(0 0 0 / 0.75)'], [0.5, 'rgb(0 0 0 / 0.35)'], [1, 'rgb(0 0 0 / 0)']]));
        this.blob = new Mesh(blobGeometry, this.track(new MeshBasicMaterial({ map: blobMap, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })));
        this.blob.renderOrder = 3;
        this.scene.add(this.blob);

        // Where the ink will land while the owner aims.
        const { width: W, height: H } = IMPRESSION_VIEWBOX;
        this.aimCanvas = canvas2d(1024, 1024 * H / W);
        const aimMap = this.track(colorTexture(this.aimCanvas.canvas, renderer));
        this.aimOutline = new Mesh(flatPlane(), this.track(new MeshBasicMaterial({ map: aimMap, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })));
        this.aimOutline.renderOrder = 4;
        this.scene.add(this.aimOutline);
    }

    buildStamp() {
        const { renderer, layout, settings } = this;
        const s = layout.width / DESIGN_WIDTH;
        const rubberWidth = layout.width;
        const rubberDepth = rubberWidth * IMPRESSION_VIEWBOX.height / IMPRESSION_VIEWBOX.width;
        const rubberRadius = 14 / IMPRESSION_VIEWBOX.width * rubberWidth;
        const rubberHeight = 0.016 * s;
        const plateHeight = 0.012 * s;
        const baseHeight = 0.13 * s;
        const baseWidth = rubberWidth + 0.044 * s;
        const baseDepth = rubberDepth + 0.044 * s;
        const baseRadius = rubberRadius + 0.022 * s;
        const baseBottom = rubberHeight + plateHeight;
        const baseTop = baseBottom + baseHeight;
        const collarHeight = 0.026 * s;
        const handleHeight = HANDLE_PROFILE[HANDLE_PROFILE.length - 1][1] * s;
        this.stampSize = { width: baseWidth, depth: baseDepth, height: baseTop + collarHeight + handleHeight };

        const lacquer = this.track(new MeshPhysicalMaterial({ color: PALETTE.lacquer, roughness: 0.4, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 }));
        const zinc = this.track(new MeshStandardMaterial({ color: PALETTE.zinc, roughness: 0.26, metalness: 1 }));
        // The rubber is stained with the ink it carries (setInk recolours it).
        const rubber = this.track(new MeshStandardMaterial({ color: new Color(settings.inkColor), roughness: 0.92 }));
        this.rubber = rubber;

        // root: where it is; sway: leaning in world directions (the hand's motion);
        // spin: the angle the owner turned it to; body: the stamp, squashed on the hit.
        const root = new Group();
        const sway = new Group();
        const spin = new Group();
        const body = new Group();
        root.add(sway);
        sway.add(spin);
        spin.add(body);

        const add = (geometry, material, y = 0) => {
            this.track(geometry);
            const mesh = new Mesh(geometry, material);
            mesh.position.y = y;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            body.add(mesh);
            return mesh;
        };
        add(slab(rubberWidth, rubberDepth, rubberHeight, rubberRadius, 0.004 * s), rubber);
        add(slab(rubberWidth + 0.014 * s, rubberDepth + 0.014 * s, plateHeight, rubberRadius + 0.007 * s, 0.003 * s), zinc, rubberHeight);
        add(slab(baseWidth, baseDepth, baseHeight, baseRadius, 0.02 * s), lacquer, baseBottom);
        add(new CylinderGeometry(0.094 * s, 0.1 * s, collarHeight, 72), zinc, baseTop + collarHeight / 2);
        add(new LatheGeometry(HANDLE_PROFILE.map(([r, y]) => new Vector2(r * s, y * s)), 72), lacquer, baseTop + collarHeight);

        const capMap = this.track(capTexture(renderer));
        const cap = add(new CircleGeometry(0.058 * s, 72), this.track(new MeshStandardMaterial({ map: capMap, metalness: 0.95, roughness: 0.3 })),
            baseTop + collarHeight + HANDLE_PROFILE[HANDLE_PROFILE.length - 1][1] * s + 0.0006);
        cap.rotation.x = -Math.PI / 2;
        cap.castShadow = false;

        // Label on the top face, between the collar and the front edge.
        const labelFront = baseDepth / 2 - 0.022 * s;
        const labelBack = 0.1 * s + 0.012 * s;
        const labelDepth = (labelFront - labelBack) * 0.8;
        const labelWidth = Math.min(baseWidth - 2 * baseRadius, 0.42 * s);
        const labelMap = this.track(labelTexture(renderer, settings.label, labelWidth / labelDepth));
        const label = add(new PlaneGeometry(labelWidth, labelDepth),
            this.track(new MeshStandardMaterial({ map: labelMap, transparent: true, metalness: 0.75, roughness: 0.38, depthWrite: false })),
            baseTop + 0.0007);
        label.rotation.x = -Math.PI / 2;
        label.position.z = (labelFront + labelBack) / 2;
        label.castShadow = false;

        // Date rollers behind a window in the front wall.
        const windowWidth = baseWidth - 2 * baseRadius - 0.03 * s;
        const windowHeight = baseHeight * 0.5;
        const rollerCanvas = canvas2d(1536, 1536 * windowHeight / windowWidth);
        const rollerMap = this.track(colorTexture(rollerCanvas.canvas, renderer));
        const windowMesh = add(new PlaneGeometry(windowWidth, windowHeight), this.track(new MeshBasicMaterial({ map: rollerMap, toneMapped: false })),
            baseBottom + baseHeight / 2);
        windowMesh.position.z = baseDepth / 2 + 0.0012;
        windowMesh.castShadow = false;
        this.rollers = { ...rollerCanvas, texture: rollerMap, columns: this.rollerColumns(), settled: false };
        this.drawRollers(0);

        this.stamp = { root, sway, spin, body };
        this.scene.add(root);
    }

    rollerColumns() {
        const { parts } = this.options;
        const random = createSeededRandom(this.options.seed ^ 0x5f3759df);
        const range = (count, start = 0) => Array.from({ length: count }, (_, i) => String(i + start).padStart(2, '0'));
        const baseYear = Number(parts.year);
        const specs = [
            { values: range(31, 1), target: parts.dayIndex, width: 1.5 },
            { values: [...MONTHS_SHORT_RU], target: parts.monthIndex, width: 2.5 },
            { values: Array.from({ length: 6 }, (_, i) => String(baseYear - 2 + i)), target: 2, width: 2.7 },
            { values: range(24), target: Number(parts.hours), width: 1.5, gap: 0.8 },
            { values: range(60), target: Number(parts.minutes), width: 1.5, colon: true }
        ];
        return specs.map(spec => ({ ...spec, from: Math.floor(random() * spec.values.length) }));
    }

    /** Paints the window: five rollers on a glass strip, the middle row under a lens. */
    drawRollers(time) {
        const { ctx, canvas, columns } = this.rollers;
        const W = canvas.width;
        const H = canvas.height;
        const item = H * 0.4;
        const font = item * 0.86;
        const pad = font * 0.28;
        ctx.clearRect(0, 0, W, H);
        const glass = ctx.createLinearGradient(0, 0, 0, H);
        glass.addColorStop(0, '#030304');
        glass.addColorStop(0.5, '#101014');
        glass.addColorStop(1, '#030304');
        drawRoundedRect(ctx, 0, 0, W, H, H * 0.16);
        ctx.fillStyle = glass;
        ctx.fill();

        const units = columns.reduce((sum, column) => sum + column.width + (column.gap || 0) + (column.colon ? 0.5 : 0), 0) + 0.25 * (columns.length - 1);
        const unit = Math.min(font, (W - pad * 2) / units);
        let x = (W - units * unit) / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        columns.forEach((column, index) => {
            x += (column.gap || 0) * unit;
            if (column.colon) {
                ctx.font = `700 ${font}px ${UI_FONT}`;
                ctx.fillStyle = PALETTE.rollerText;
                ctx.globalAlpha = 0.7;
                ctx.fillText(':', x + unit * 0.25, H / 2 - font * 0.04);
                ctx.globalAlpha = 1;
                x += unit * 0.5;
            }
            const width = column.width * unit;
            const band = ctx.createLinearGradient(0, 0, 0, H);
            band.addColorStop(0, '#0d0d10');
            band.addColorStop(0.5, '#1d1d22');
            band.addColorStop(1, '#0d0d10');
            ctx.fillStyle = band;
            ctx.fillRect(x, H * 0.06, width, H * 0.88);
            const position = rollerIndexAt(time, this.timeline, {
                from: column.from, to: column.target, length: column.values.length, column: index, columns: columns.length
            });
            const whole = Math.floor(position);
            const fraction = position - whole;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, H * 0.06, width, H * 0.88);
            ctx.clip();
            ctx.font = `700 ${font}px ${UI_FONT}`;
            for (let k = -2; k <= 2; k++) {
                const offset = k - fraction;
                const value = column.values[(((whole + k) % column.values.length) + column.values.length) % column.values.length];
                ctx.globalAlpha = clamp01(1 - Math.abs(offset) * 0.62);
                ctx.fillStyle = PALETTE.rollerText;
                // Rows squeeze toward the edges, as on a drum.
                ctx.save();
                ctx.translate(x + width / 2, H / 2 + Math.sin(offset * 0.9) * item * 1.12);
                ctx.scale(1, Math.max(0.2, Math.cos(offset * 0.9)));
                ctx.fillText(value, 0, 0);
                ctx.restore();
            }
            ctx.restore();
            ctx.globalAlpha = 1;
            const shade = ctx.createLinearGradient(0, 0, 0, H);
            shade.addColorStop(0, 'rgb(0 0 0 / 0.92)');
            shade.addColorStop(0.32, 'rgb(0 0 0 / 0)');
            shade.addColorStop(0.68, 'rgb(0 0 0 / 0)');
            shade.addColorStop(1, 'rgb(0 0 0 / 0.92)');
            ctx.fillStyle = shade;
            ctx.fillRect(x, H * 0.06, width, H * 0.88);
            x += width + 0.25 * unit;
        });
        // Lens over the reading row and the window's zinc frame.
        ctx.fillStyle = 'rgb(255 255 255 / 0.06)';
        ctx.fillRect(pad * 0.5, H / 2 - item / 2, W - pad, item);
        ctx.strokeStyle = 'rgb(255 255 255 / 0.2)';
        ctx.lineWidth = Math.max(1, H * 0.015);
        ctx.beginPath();
        ctx.moveTo(pad * 0.5, H / 2 - item / 2);
        ctx.lineTo(W - pad * 0.5, H / 2 - item / 2);
        ctx.moveTo(pad * 0.5, H / 2 + item / 2);
        ctx.lineTo(W - pad * 0.5, H / 2 + item / 2);
        ctx.stroke();
        drawRoundedRect(ctx, H * 0.025, H * 0.025, W - H * 0.05, H * 0.95, H * 0.14);
        ctx.strokeStyle = PALETTE.rollerFrame;
        ctx.lineWidth = H * 0.05;
        ctx.stroke();
        this.rollers.texture.needsUpdate = true;
    }

    // --- Aim ------------------------------------------------------------------------------

    bindPointer() {
        const canvas = this.renderer.domElement;
        this.onPointerMove = event => {
            if (!this.aiming) return;
            const point = this.pick(event);
            if (point) this.setAim(point);
        };
        this.onWheel = event => {
            if (!this.aiming) return;
            event.preventDefault();
            // Shift+wheel arrives as a horizontal scroll in Chrome.
            const delta = event.deltaY || event.deltaX;
            if (!delta) return;
            this.nudge({ rotation: Math.sign(delta) * (event.shiftKey ? WHEEL_FINE_STEP : WHEEL_STEP) });
        };
        this.onClick = event => {
            if (!this.aiming) return;
            const point = this.pick(event);
            if (point) this.setAim(point);
            this.strike();
        };
        // Right click changes the ink while aiming.
        this.onContextMenu = event => {
            event.preventDefault();
            if (this.aiming) this.options.onInkSwitch?.();
        };
        canvas.addEventListener('pointermove', this.onPointerMove);
        canvas.addEventListener('wheel', this.onWheel, { passive: false });
        canvas.addEventListener('click', this.onClick);
        canvas.addEventListener('contextmenu', this.onContextMenu);
    }

    /** Puts `ink` on the stamp: the impression texture, the outline and the rubber. */
    setInk(ink) {
        const image = this.options.impressions?.get(ink);
        if (!image || this.disposed) return;
        this.inkColor = ink;
        const { ctx, canvas } = this.inkCanvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        this.ink.material.map.needsUpdate = true;
        paintAim(this.aimCanvas.ctx, ink);
        this.aimOutline.material.map.needsUpdate = true;
        this.rubber.color.set(ink).lerp(new Color(PALETTE.rubberBase), 0.5);
    }

    /** The point of the poster under the pointer, in poster fractions (may lie outside 0–1). */
    pick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const point = this.raycaster.ray.intersectPlane(this.posterPlane, this.hit);
        return point ? { x: point.x + 0.5, y: point.z / this.depth + 0.5 } : null;
    }

    setAim({ x, y }) {
        if (!this.aiming) return;
        const centre = clampImpressionCentre({ x, y, rotation: this.aim.rotation, width: this.layout.width, aspect: this.aspect });
        this.aim = { ...this.aim, ...centre };
        this.options.onAim?.({ ...this.aim });
    }

    /** Moves and turns the aim by `change` (poster fractions, degrees), as the keyboard does. */
    nudge(change) {
        if (!this.aiming) return;
        const next = nudgeAim({ ...this.layout, ...this.aim }, change, this.aspect);
        this.aim = { x: next.x, y: next.y, rotation: next.rotation };
        this.options.onAim?.({ ...this.aim });
    }

    /** Slams the stamp down where it is aimed (after it has settled, if it is still coming down). */
    strike() {
        if (!this.aiming) return false;
        this.strikeRequestedAt = this.clock;
        return true;
    }

    beginStrike() {
        this.strikeAt = strikeStartFor(this.strikeRequestedAt, this.timeline);
        this.finalAim = { ...this.aim };
        const world = this.toWorld(this.finalAim);
        this.ink.position.set(world.x, POSTER_THICKNESS + 0.0003, world.z);
        this.ink.rotation.y = -this.finalAim.rotation * DEG;
        this.options.onStrike?.({ ...this.layout, ...this.finalAim });
    }

    toWorld({ x, y }) {
        return { x: x - 0.5, z: (y - 0.5) * this.depth };
    }

    /**
     * The stamp eases after the aim and leans with its motion, like a hand
     * carrying it. Once the strike begins it straightens up, and from the hit on
     * it sits exactly where the ink is.
     */
    follow(time, dt) {
        const { current, sway } = this;
        const striking = time >= this.strikeAt;
        const goal = this.finalAim || this.aim;
        if (striking && time >= this.strikeAt + this.timeline.strike.impact) {
            Object.assign(current, goal);
            Object.assign(sway, { x: 0, z: 0, vx: 0, vz: 0 });
            return;
        }
        if (dt <= 0) return;
        const before = this.toWorld(current);
        const k = ease(dt, 75);
        current.x += (goal.x - current.x) * k;
        current.y += (goal.y - current.y) * k;
        current.rotation += (goal.rotation - current.rotation) * ease(dt, 90);
        const after = this.toWorld(current);
        const v = ease(dt, 90);
        sway.vx += ((after.x - before.x) / dt * 1000 - sway.vx) * v;
        sway.vz += ((after.z - before.z) / dt * 1000 - sway.vz) * v;
        const lean = ease(dt, striking ? 60 : 120);
        sway.x += ((striking ? 0 : clamp(sway.vz * 9, -9, 9)) - sway.x) * lean;
        sway.z += ((striking ? 0 : clamp(sway.vx * 9, -9, 9)) - sway.z) * lean;
    }

    // --- Frame ----------------------------------------------------------------------------

    resize() {
        if (this.disposed) return;
        const host = this.options.host;
        const width = host.clientWidth || 800;
        const height = host.clientHeight || 600;
        // The canvas fills the screen, but the panel floats over its bottom: the
        // optical centre is the middle of the space above it, where the JPEG sits.
        const panel = clamp(Number(this.options.panelSpace?.()) || 0, 0, height * 0.6);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / (height + panel);
        this.camera.setViewOffset(width, height + panel, 0, panel, width, height);
        this.camera.updateProjectionMatrix();
        const vfov = this.camera.fov * DEG;
        // Opening view: the box over the poster that the hovering stamp can reach,
        // so it stays in frame, clear of the panel, wherever the owner aims it.
        const reach = STAMP_FLIGHT.hover + STAMP_FLIGHT.breath + this.stampSize.height;
        const box = [];
        for (const x of [-0.5, 0.5]) {
            for (const z of [-this.depth / 2, this.depth / 2]) {
                for (const y of [0, reach]) box.push(new Vector3(x, y, z));
            }
        }
        this.openTarget = new Vector3(0, reach * 0.32, 0);
        const bottom = -1 + 2 * (panel + 12) / height;
        this.openDistance = this.fitDistance(box, this.openTarget, (90 - this.settings.tiltAngle) * DEG, this.settings.cameraYaw * DEG, { side: 0.9, top: 0.9, bottom });
        // Final view: straight above, the poster exactly `paper.height` CSS px tall at the JPEG's place.
        const paperHeight = this.options.paper?.height > 0 ? this.options.paper.height : (height - panel) * 0.8;
        this.topDistance = this.depth * (height + panel) / (2 * Math.tan(vfov / 2) * paperHeight);
        this.topTarget = new Vector3(0, POSTER_THICKNESS, 0);
        // Between frames of a running timeline the next frame redraws anyway.
        if (!this.raf && this.renderedOnce) this.render(this.clock, 0);
    }

    /** Puts the camera on its orbit around `target` (degrees in radians) with no roll. */
    placeCamera(target, elevation, yaw, distance) {
        this.camera.position.set(
            target.x + distance * Math.cos(elevation) * Math.sin(yaw),
            target.y + distance * Math.sin(elevation),
            target.z + distance * Math.cos(elevation) * Math.cos(yaw)
        );
        // Up is the view's forward on the desk: no roll, and still defined straight above.
        this.camera.up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        this.camera.lookAt(target);
    }

    /**
     * The smallest distance at which every point lies in front of the camera and
     * inside `limits` of the canvas (normalised device coordinates: ±`side`
     * across, from `bottom` to `top` up).
     */
    fitDistance(points, target, elevation, yaw, limits) {
        const view = new Vector3();
        const projected = new Vector3();
        const fits = distance => {
            this.placeCamera(target, elevation, yaw, distance);
            this.camera.updateMatrixWorld(true);
            return points.every(point => {
                view.copy(point).applyMatrix4(this.camera.matrixWorldInverse);
                if (view.z >= -this.camera.near) return false;
                projected.copy(point).project(this.camera);
                return Math.abs(projected.x) <= limits.side && projected.y <= limits.top && projected.y >= limits.bottom;
            });
        };
        let near = 0.5;
        let far = 30;
        if (!fits(far)) return far;
        for (let i = 0; i < 30; i++) {
            const middle = (near + far) / 2;
            if (fits(middle)) far = middle;
            else near = middle;
        }
        return far;
    }

    update(time, dt) {
        const { timeline, settings, stamp } = this;
        const strikeAt = this.strikeAt;
        const pose = stampPoseAt(time, timeline, { strikeAt, bounce: settings.bounce });
        this.follow(time, dt);
        const at = this.toWorld(this.current);
        stamp.root.visible = pose.visible;
        stamp.root.position.set(at.x + pose.offsetX, POSTER_THICKNESS + pose.y, at.z);
        stamp.sway.rotation.set((pose.tiltX + this.sway.x) * DEG, 0, -(pose.tiltZ + this.sway.z) * DEG);
        stamp.spin.rotation.y = -this.current.rotation * DEG;
        stamp.body.scale.set(1 + pose.squash * 0.4, 1 - pose.squash, 1 + pose.squash * 0.4);
        this.ink.material.opacity = pose.ink * settings.inkOpacity;

        const shade = shadowForHeight(pose.y, STAMP_FLIGHT.hover * 2.4);
        this.blob.visible = pose.visible;
        this.blob.material.opacity = Math.min(1, shade.contact.opacity + shade.soft.opacity * 0.8);
        this.blob.position.set(stamp.root.position.x, POSTER_THICKNESS + 0.0009, stamp.root.position.z);
        this.blob.rotation.y = stamp.spin.rotation.y;
        this.blob.scale.set(this.stampSize.width * 1.3 * shade.soft.scale, 1, this.stampSize.depth * 1.5 * shade.soft.scale);

        // The outline shows up with the stamp and goes as it winds up to strike.
        const shown = clamp01((time - timeline.enterStart) / 450);
        const leaving = Number.isFinite(strikeAt) ? clamp01((time - strikeAt) / Math.max(1, timeline.strike.windupEnd)) : 0;
        this.aimOutline.material.opacity = 0.95 * shown * (1 - leaving);
        this.aimOutline.visible = this.aimOutline.material.opacity > 0.001;
        this.aimOutline.position.set(at.x, POSTER_THICKNESS + 0.0012, at.z);
        this.aimOutline.rotation.y = stamp.spin.rotation.y;

        if (!this.rollers.settled) {
            this.drawRollers(time);
            if (time > timeline.rollersEnd) this.rollers.settled = true;
        }

        const camera = cameraPoseAt(time, timeline, { strikeAt, bounce: settings.bounce });
        const yaw = lerp(lerp((settings.cameraYaw - 12) * DEG, settings.cameraYaw * DEG, camera.orbit), 0, camera.reveal);
        const elevation = lerp((90 - settings.tiltAngle) * DEG, Math.PI / 2, camera.reveal);
        const distance = Math.exp(lerp(Math.log(this.openDistance * camera.push), Math.log(this.topDistance), camera.reveal));
        this.target.lerpVectors(this.openTarget, this.topTarget, camera.reveal);
        this.placeCamera(this.target, elevation, yaw, distance);
        if (camera.shake) {
            this.camera.position.x += camera.shake * 0.6;
            this.camera.position.y += camera.shake;
        }

        // The desk and the stamp's shadow leave with the stamp; the poster and the ink stay.
        const revealStart = strikeAt + timeline.strike.revealStart;
        const span = timeline.strike.revealEnd - timeline.strike.revealStart;
        const fade = Number.isFinite(revealStart) ? 1 - clamp01((time - revealStart - span * 0.3) / (span * 0.7 || 1)) : 1;
        this.desk.material.opacity = fade;
        this.catcher.material.opacity = 0.5 * fade;
    }

    render(time, dt = 0) {
        this.update(time, dt);
        this.renderer.render(this.scene, this.camera);
        this.renderedOnce = true;
    }

    /** Builds shaders before the first frame (without blocking where the browser compiles in parallel). */
    async prepare(signal) {
        // compileAsync only visits visible objects: show everything while compiling.
        this.update(this.timeline.enterEnd, 0);
        this.stamp.root.visible = true;
        this.aimOutline.visible = true;
        this.ink.material.opacity = 1;
        let timer;
        try {
            await Promise.race([
                Promise.resolve(this.renderer.compileAsync?.(this.scene, this.camera)),
                new Promise(resolve => { timer = setTimeout(resolve, 4000); })
            ]);
        } finally {
            clearTimeout(timer);
        }
        if (signal?.aborted || this.disposed) throw abortError();
        this.render(0, 0);
    }

    /**
     * Runs the opening, then follows the aim until the strike; resolves on the
     * strike's last frame and rejects with AbortError when the scene closes.
     */
    play(signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted || this.disposed) return reject(abortError());
            let start = null;
            let impacted = false;
            const onAbort = () => {
                cancelAnimationFrame(this.raf);
                this.raf = 0;
                reject(abortError());
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            const frame = now => {
                if (this.disposed) return;
                start ??= now;
                const time = now - start;
                // Frames can stall (a hidden tab); the aim must not jump when they resume.
                const dt = clamp(time - this.clock, 0, 50);
                this.clock = time;
                if (this.strikeRequestedAt !== null && !Number.isFinite(this.strikeAt)) this.beginStrike();
                const end = this.strikeAt + this.timeline.strike.end;
                this.render(Math.min(time, end), dt);
                if (!impacted && time >= this.strikeAt + this.timeline.strike.impact) {
                    impacted = true;
                    this.options.onImpact?.();
                }
                if (time >= end) {
                    this.raf = 0;
                    signal?.removeEventListener('abort', onAbort);
                    resolve({ ...this.layout, ...this.finalAim });
                    return;
                }
                this.raf = requestAnimationFrame(frame);
            };
            this.raf = requestAnimationFrame(frame);
        });
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.raf);
        this.resizeObserver?.disconnect();
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('pointermove', this.onPointerMove);
        canvas.removeEventListener('wheel', this.onWheel);
        canvas.removeEventListener('click', this.onClick);
        canvas.removeEventListener('contextmenu', this.onContextMenu);
        this.disposables.forEach(item => item.dispose?.());
        this.environment.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss?.();
        canvas.remove();
    }
}
